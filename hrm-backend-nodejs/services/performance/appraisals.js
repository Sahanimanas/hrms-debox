/**
 * PF-2 Appraisal cycles.
 *
 * One appraisal configuration per review cycle (rating scale, competencies,
 * weights, phase). Phases run strictly in order:
 *   setup → self_review → manager_review → peer_feedback (optional) → calibration → released
 *
 * Collections: appraisal_configs, appraisals, peer_feedback
 *
 * Visibility rules:
 *  - the reviewee never sees manager ratings, scores or peer feedback before release
 *  - peer identity is never returned to the reviewee (feedback is anonymised and shuffled)
 *  - managers see a self review only once it is submitted
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { emitEvent } = require('../events');
const {
  h, fail, stripId, now, round2, generateUUID, employeeUid, DATE,
  findEmployee, isManagerOf, teamEmails, resolveManager, notify, isActiveEmployee
} = require('./common');
const { getCycle } = require('./goals');

const router = express.Router();

const PHASES = ['setup', 'self_review', 'manager_review', 'peer_feedback', 'calibration', 'released'];
const PHASE_LABELS = {
  setup: 'Setup',
  self_review: 'Self review',
  manager_review: 'Manager review',
  peer_feedback: '360° peer feedback',
  calibration: 'Calibration',
  released: 'Released'
};
const DEFAULT_MIN_PEER_RESPONSES = 2;
const minPeerResponses = (config) => config.min_peer_responses ?? DEFAULT_MIN_PEER_RESPONSES;

const DEFAULT_SCALE = [
  { value: 1, label: 'Unsatisfactory' },
  { value: 2, label: 'Needs improvement' },
  { value: 3, label: 'Meets expectations' },
  { value: 4, label: 'Exceeds expectations' },
  { value: 5, label: 'Outstanding' }
];

// ============= SCHEMAS =============

const configSchema = Joi.object({
  rating_scale: Joi.array().items(Joi.object({
    value: Joi.number().integer().min(1).max(5).required(),
    label: Joi.string().trim().min(1).max(60).required()
  })).length(5).unique('value'),
  competencies: Joi.array().items(Joi.object({
    id: Joi.string().max(64),
    name: Joi.string().trim().min(1).max(120).required(),
    description: Joi.string().trim().max(500).allow('', null)
  })).max(20).unique('name'),
  competency_weight: Joi.number().min(0).max(100),
  peer_feedback_enabled: Joi.boolean(),
  max_peers: Joi.number().integer().min(1).max(10),
  min_peer_responses: Joi.number().integer().min(1).max(10),
  self_review_due: Joi.string().pattern(DATE).allow(null, ''),
  manager_review_due: Joi.string().pattern(DATE).allow(null, '')
}).min(1);

const rating = Joi.number().integer().min(1).max(5);
const ratingsList = (idKey) => Joi.array().items(Joi.object({
  [idKey]: Joi.string().required(),
  rating: rating.required(),
  comment: Joi.string().trim().max(2000).allow('', null)
})).unique(idKey);

const selfReviewSchema = Joi.object({
  goal_ratings: ratingsList('goal_id').default([]),
  competency_ratings: ratingsList('competency_id').default([]),
  overall_comment: Joi.string().trim().max(5000).allow('', null),
  submit: Joi.boolean().default(false)
});
const managerReviewSchema = selfReviewSchema.keys({
  strengths: Joi.string().trim().max(3000).allow('', null),
  improvements: Joi.string().trim().max(3000).allow('', null)
});
const peersSchema = Joi.object({ peer_emails: Joi.array().items(Joi.string().email()).min(1).max(10).unique().required() });
const decisionSchema = Joi.object({
  action: Joi.string().valid('approve', 'reject').required(),
  comment: Joi.string().trim().max(1000).allow('', null)
});
const peerFeedbackSchema = Joi.object({
  ratings: ratingsList('competency_id').default([]),
  strengths: Joi.string().trim().max(3000).allow('', null),
  improvements: Joi.string().trim().max(3000).allow('', null),
  submit: Joi.boolean().default(false)
});
const calibrateSchema = Joi.object({
  rating: Joi.number().min(1).max(5).precision(2).required(),
  reason: Joi.string().trim().min(3).max(2000).required()
});
const ackSchema = Joi.object({
  agrees: Joi.boolean().default(true),
  comment: Joi.string().trim().max(2000).allow('', null)
});
const advanceSchema = Joi.object({ force: Joi.boolean().default(false) });

// ============= HELPERS =============

const getConfig = async (db, cycleId, { required = true } = {}) => {
  const config = await db.collection('appraisal_configs').findOne({ cycle_id: cycleId }, { projection: { _id: 0 } });
  if (!config && required) fail(404, 'Appraisals have not been configured for this cycle');
  return config;
};

const getAppraisal = async (db, id) => {
  const a = await db.collection('appraisals').findOne({ id }, { projection: { _id: 0 } });
  if (!a) fail(404, 'Appraisal not found');
  return a;
};

const nextPhase = (config) => {
  let i = PHASES.indexOf(config.phase) + 1;
  if (PHASES[i] === 'peer_feedback' && !config.peer_feedback_enabled) i += 1;
  return PHASES[i] || null;
};


const employeeGoals = (db, cycleId, email) => db.collection('goals').find(
  { cycle_id: cycleId, employee_email: email, approval_status: 'approved', is_company_goal: { $ne: true } },
  { projection: { _id: 0, id: 1, title: 1, description: 1, type: 1, weightage: 1, progress: 1, status: 1, key_results: 1 } }
).sort({ created_at: 1 }).toArray();

/** Weighted overall score from goal ratings (by weightage) and competency ratings. */
const computeScore = (review, goals, config) => {
  if (!review) return null;
  const goalMap = Object.fromEntries(goals.map(g => [g.id, g]));
  const rated = (review.goal_ratings || []).filter(r => goalMap[r.goal_id]);
  let goalScore = null;
  if (rated.length) {
    const totalW = rated.reduce((s, r) => s + (Number(goalMap[r.goal_id].weightage) || 0), 0);
    goalScore = totalW > 0
      ? rated.reduce((s, r) => s + r.rating * (Number(goalMap[r.goal_id].weightage) || 0), 0) / totalW
      : rated.reduce((s, r) => s + r.rating, 0) / rated.length;
  }
  const comps = review.competency_ratings || [];
  const compScore = comps.length ? comps.reduce((s, r) => s + r.rating, 0) / comps.length : null;
  if (goalScore == null && compScore == null) return null;
  if (goalScore == null) return round2(compScore);
  if (compScore == null) return round2(goalScore);
  const cw = (config.competency_weight ?? 0) / 100;
  return round2(goalScore * (1 - cw) + compScore * cw);
};

const labelFor = (config, value) => {
  if (value == null) return null;
  const v = Math.min(5, Math.max(1, Math.round(value)));
  return (config.rating_scale || DEFAULT_SCALE).find(s => s.value === v)?.label || null;
};

/** Check ratings refer to real goals / competencies; when `complete`, everything must be rated. */
const checkRatings = (body, goals, config, complete) => {
  const goalIds = new Set(goals.map(g => g.id));
  const compIds = new Set((config.competencies || []).map(c => c.id));
  for (const r of body.goal_ratings || []) if (!goalIds.has(r.goal_id)) fail(400, 'A rating refers to a goal that is not part of this appraisal');
  for (const r of body.competency_ratings || []) if (!compIds.has(r.competency_id)) fail(400, 'A rating refers to an unknown competency');
  if (complete) {
    if ((body.goal_ratings || []).length !== goalIds.size) fail(400, 'Rate every goal before submitting');
    if ((body.competency_ratings || []).length !== compIds.size) fail(400, 'Rate every competency before submitting');
  }
};

const viewerRole = (req, appraisal, employee) => {
  if (appraisal.employee_email === req.user.email) return 'self';
  if (req.user.role === 'admin') return 'admin';
  if (isManagerOf(req, employee)) return 'manager';
  return null;
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Shape an appraisal for the viewer. `detail` adds goals, config and peer data.
 */
const viewAppraisal = async (db, req, appraisal, config, role, { detail = false } = {}) => {
  const released = config.phase === 'released';
  const out = {
    id: appraisal.id,
    cycle_id: appraisal.cycle_id,
    cycle_name: appraisal.cycle_name,
    employee_email: appraisal.employee_email,
    employee_name: appraisal.employee_name,
    employee_uid: appraisal.employee_uid,
    department: appraisal.department,
    designation: appraisal.designation,
    manager_email: appraisal.manager_email,
    manager_name: appraisal.manager_name,
    phase: config.phase,
    phase_label: PHASE_LABELS[config.phase],
    self_status: appraisal.self_status,
    manager_status: appraisal.manager_status,
    released_at: released ? appraisal.released_at || null : null,
    acknowledgement: appraisal.acknowledgement || null,
    viewer_role: role,
    created_at: appraisal.created_at
  };

  const showSelf = role === 'self' || role === 'admin' || appraisal.self_status === 'submitted';
  out.self_review = showSelf ? appraisal.self_review || null : null;
  out.self_score = showSelf ? appraisal.self_score ?? null : null;

  const showManager = role === 'admin' || role === 'manager' || (role === 'self' && released);
  out.manager_review = showManager ? appraisal.manager_review || null : null;
  out.manager_score = showManager ? appraisal.manager_score ?? null : null;
  // Calibration adjustments become visible to managers / employees only on release
  if (role === 'admin' || (showManager && released)) out.final_rating = appraisal.final_rating ?? null;
  else if (role === 'manager') out.final_rating = appraisal.manager_status === 'submitted' ? appraisal.manager_score ?? null : null;
  else out.final_rating = null;
  out.final_label = out.final_rating != null ? labelFor(config, out.final_rating) : null;
  if (role === 'admin' || (role === 'manager' && released)) {
    out.calibration = appraisal.calibration || null;
  } else {
    out.calibration = null;
    if (role === 'self' && released) out.calibrated = !!appraisal.calibration;
  }

  if (!detail) return out;

  out.goals = await employeeGoals(db, appraisal.cycle_id, appraisal.employee_email);
  out.config = {
    rating_scale: config.rating_scale,
    competencies: config.competencies,
    competency_weight: config.competency_weight,
    peer_feedback_enabled: config.peer_feedback_enabled,
    max_peers: config.max_peers,
    min_peer_responses: minPeerResponses(config),
    self_review_due: config.self_review_due,
    manager_review_due: config.manager_review_due
  };

  const peers = await db.collection('peer_feedback').find({ appraisal_id: appraisal.id }, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray();
  if (role === 'self') {
    // Only the reviewee's own nominations, without submission state, so feedback
    // can't be matched to a person; peers added by the manager stay anonymous.
    const own = peers.filter(p => p.nominated_by === req.user.email);
    out.peer_nominations = own.map(p => ({
      id: p.id,
      peer_name: p.peer_name,
      peer_email: p.peer_email,
      status: p.status === 'submitted' ? 'approved' : p.status
    }));
    out.other_peer_count = peers.filter(p => p.nominated_by !== req.user.email && p.status !== 'rejected').length;
    // Below the minimum number of responses the feedback is withheld entirely
    // (no text, no ratings) so a single reviewer can't be identified.
    const submitted = peers.filter(p => p.status === 'submitted');
    const enough = submitted.length >= minPeerResponses(config);
    out.peer_feedback = released && enough
      ? shuffle(submitted.map(p => ({
        ratings: p.ratings || [],
        strengths: p.strengths || '',
        improvements: p.improvements || ''
      })))
      : [];
    out.peer_feedback_withheld = released && !enough && submitted.length > 0;
  } else {
    out.peer_nominations = peers.map(p => ({
      id: p.id, peer_name: p.peer_name, peer_email: p.peer_email, status: p.status, nominated_by: p.nominated_by, decided_by: p.decided_by || null
    }));
    out.peer_feedback = peers.filter(p => p.status === 'submitted').map(p => ({
      id: p.id, peer_name: p.peer_name, peer_email: p.peer_email, ratings: p.ratings || [], strengths: p.strengths || '', improvements: p.improvements || '', submitted_at: p.submitted_at
    }));
  }

  out.permissions = {
    can_self_review: role === 'self' && config.phase === 'self_review' && appraisal.self_status !== 'submitted',
    can_manager_review: (role === 'manager' || role === 'admin') && config.phase === 'manager_review' && appraisal.manager_status !== 'submitted',
    can_nominate: !!config.peer_feedback_enabled && (
      (role === 'self' && ['self_review', 'manager_review'].includes(config.phase)) ||
      ((role === 'manager' || role === 'admin') && ['self_review', 'manager_review', 'peer_feedback'].includes(config.phase))
    ),
    can_decide_peers: (role === 'manager' || role === 'admin') && ['self_review', 'manager_review', 'peer_feedback'].includes(config.phase),
    can_calibrate: role === 'admin' && config.phase === 'calibration' && appraisal.manager_status === 'submitted',
    can_acknowledge: role === 'self' && released && !appraisal.acknowledgement
  };
  return out;
};

const loadForViewer = async (db, req, id) => {
  const appraisal = await getAppraisal(db, id);
  const config = await getConfig(db, appraisal.cycle_id);
  const employee = await findEmployee(db, appraisal.employee_email);
  const role = viewerRole(req, appraisal, employee);
  if (!role) fail(403, 'Not enough permissions');
  return { appraisal, config, employee, role };
};

// ============= CONFIG & PHASES =============

router.get('/appraisal-configs/:cycleId', h(async (req, res) => {
  const db = getDB();
  const cycle = await getCycle(db, req.params.cycleId);
  if (cycle.status === 'draft' && req.user.role !== 'admin') fail(404, 'Review cycle not found');
  const config = await getConfig(db, cycle.id, { required: false });
  if (!config) {
    return res.json({
      cycle_id: cycle.id, cycle_name: cycle.name, configured: false, phase: 'setup', phase_label: PHASE_LABELS.setup,
      rating_scale: DEFAULT_SCALE, competencies: [], competency_weight: 30, peer_feedback_enabled: false, max_peers: 5,
      min_peer_responses: DEFAULT_MIN_PEER_RESPONSES
    });
  }
  res.json({ ...config, min_peer_responses: minPeerResponses(config), configured: true, phase_label: PHASE_LABELS[config.phase], next_phase: nextPhase(config) });
}));

router.put('/appraisal-configs/:cycleId', requireRole(['admin']), validate(configSchema), h(async (req, res) => {
  const db = getDB();
  const cycle = await getCycle(db, req.params.cycleId);
  const data = req.validatedBody;
  const existing = await getConfig(db, cycle.id, { required: false });

  if (existing && existing.phase !== 'setup') {
    const locked = ['competencies', 'competency_weight', 'peer_feedback_enabled'].filter(k => data[k] !== undefined);
    if (locked.length) fail(400, `Cannot change ${locked.join(', ')} after the appraisal has started`);
    if (existing.phase === 'released') fail(400, 'This appraisal has been released');
  }
  if (data.rating_scale) data.rating_scale = [...data.rating_scale].sort((a, b) => a.value - b.value);
  if (data.competencies) {
    const prev = existing?.competencies || [];
    data.competencies = data.competencies.map(c => ({
      id: prev.find(p => p.id === c.id)?.id || generateUUID(),
      name: c.name,
      description: c.description || ''
    }));
  }
  for (const k of ['self_review_due', 'manager_review_due']) if (data[k] === '') data[k] = null;
  // Managers review after the self review, so their deadline can't come first
  const selfDue = data.self_review_due !== undefined ? data.self_review_due : existing?.self_review_due;
  const managerDue = data.manager_review_due !== undefined ? data.manager_review_due : existing?.manager_review_due;
  if (selfDue && managerDue && managerDue < selfDue) fail(400, 'Manager review due date cannot be before the self review due date');

  if (existing) {
    await db.collection('appraisal_configs').updateOne({ cycle_id: cycle.id }, { $set: { ...data, updated_at: now() } });
  } else {
    await db.collection('appraisal_configs').insertOne({
      id: generateUUID(),
      cycle_id: cycle.id,
      cycle_name: cycle.name,
      rating_scale: DEFAULT_SCALE,
      competencies: [],
      competency_weight: 30,
      peer_feedback_enabled: false,
      max_peers: 5,
      min_peer_responses: DEFAULT_MIN_PEER_RESPONSES,
      self_review_due: null,
      manager_review_due: null,
      ...data,
      phase: 'setup',
      phase_history: [],
      created_by: req.user.email,
      created_at: now(),
      updated_at: now()
    });
  }
  const config = await getConfig(db, cycle.id);
  res.json({ ...config, configured: true, phase_label: PHASE_LABELS[config.phase], next_phase: nextPhase(config) });
}));

/**
 * POST /appraisal-configs/:cycleId/advance { force }
 * Move to the next phase. Pending work blocks the move unless force=true.
 */
router.post('/appraisal-configs/:cycleId/advance', requireRole(['admin']), validate(advanceSchema), h(async (req, res) => {
  const db = getDB();
  const cycle = await getCycle(db, req.params.cycleId);
  const config = await getConfig(db, cycle.id);
  const to = nextPhase(config);
  if (!to) fail(400, 'This appraisal has already been released');
  const { force } = req.validatedBody;
  const result = { from: config.phase, to };
  const appraisals = db.collection('appraisals');

  if (to === 'self_review') {
    if (cycle.status !== 'active') fail(400, 'Activate the review cycle before starting appraisals');
    const employees = (await db.collection('employees').find({ role: { $ne: 'admin' } }, { projection: { _id: 0 } }).toArray()).filter(isActiveEmployee);
    if (!employees.length) fail(400, 'There are no employees to appraise');
    let created = 0;
    for (const e of employees) {
      const manager = await resolveManager(db, e);
      const r = await appraisals.updateOne(
        { cycle_id: cycle.id, employee_email: e.email },
        {
          $setOnInsert: {
            id: generateUUID(),
            cycle_id: cycle.id,
            cycle_name: cycle.name,
            employee_email: e.email,
            employee_name: e.full_name,
            employee_uid: employeeUid(e),
            department: e.department || null,
            designation: e.designation || null,
            manager_email: manager?.email || null,
            manager_name: manager?.full_name || null,
            self_status: 'pending',
            self_review: null,
            manager_status: 'pending',
            manager_review: null,
            self_score: null,
            manager_score: null,
            final_rating: null,
            calibration: null,
            acknowledgement: null,
            created_at: now()
          },
          $set: { updated_at: now() }
        },
        { upsert: true }
      );
      if (r.upsertedCount) {
        created += 1;
        notify(e.email, {
          type: 'appraisal_self_review_open',
          title: 'Self review is open',
          message: `Your self review for ${cycle.name} is open${config.self_review_due ? ` (due ${config.self_review_due})` : ''}`,
          actionUrl: '/performance/appraisals',
          metadata: { cycle_id: cycle.id }
        });
      }
    }
    result.appraisals_created = created;
  } else if (to === 'manager_review') {
    const pending = await appraisals.countDocuments({ cycle_id: cycle.id, self_status: { $ne: 'submitted' } });
    if (pending && !force) fail(400, `${pending} self review(s) are not submitted yet. Pass force to continue anyway.`);
    result.pending_self_reviews = pending;
    const managers = await appraisals.distinct('manager_email', { cycle_id: cycle.id });
    managers.filter(Boolean).forEach(email => notify(email, {
      type: 'appraisal_manager_review_open',
      title: 'Manager reviews are open',
      message: `Rate your team for ${cycle.name}`,
      actionUrl: '/performance/appraisals?tab=team',
      metadata: { cycle_id: cycle.id }
    }));
  } else if (config.phase === 'manager_review') {
    const pending = await appraisals.countDocuments({ cycle_id: cycle.id, manager_status: { $ne: 'submitted' } });
    if (pending && !force) fail(400, `${pending} manager review(s) are not submitted yet. Pass force to continue anyway.`);
    result.pending_manager_reviews = pending;
    if (to === 'peer_feedback') {
      const peers = await db.collection('peer_feedback').find({ cycle_id: cycle.id, status: 'approved' }).toArray();
      peers.forEach(p => notify(p.peer_email, {
        type: 'peer_feedback_requested',
        title: 'Peer feedback requested',
        message: `Please share feedback for ${p.reviewee_name} (${cycle.name})`,
        actionUrl: '/performance/appraisals?tab=peer',
        metadata: { peer_feedback_id: p.id }
      }));
    }
  }

  if (to === 'calibration') {
    // Expire nominations that never got approved
    await db.collection('peer_feedback').updateMany({ cycle_id: cycle.id, status: 'nominated' }, { $set: { status: 'rejected', decided_by: 'system', updated_at: now() } });
  }

  if (to === 'released') {
    const released = await appraisals.find({ cycle_id: cycle.id }).toArray();
    await appraisals.updateMany({ cycle_id: cycle.id }, { $set: { released_at: now(), updated_at: now() } });
    released.forEach(a => notify(a.employee_email, {
      type: 'appraisal_released',
      title: 'Your appraisal results are available',
      message: `Your ${cycle.name} appraisal has been released. Please review and acknowledge it.`,
      actionUrl: '/performance/appraisals?tab=results',
      metadata: { appraisal_id: a.id }
    }));
    result.released = released.length;
    emitEvent('performance.appraisal.released', { cycle_id: cycle.id, count: released.length });
  }

  await db.collection('appraisal_configs').updateOne(
    { cycle_id: cycle.id },
    { $set: { phase: to, updated_at: now() }, $push: { phase_history: { from: config.phase, to, at: now(), by: req.user.email } } }
  );
  res.json({ ...result, phase_label: PHASE_LABELS[to] });
}));

// ============= APPRAISALS =============

/**
 * GET /appraisals?cycle_id&scope=my|team|all
 */
router.get('/appraisals', h(async (req, res) => {
  const db = getDB();
  const scope = req.query.scope || 'my';
  const filter = {};
  if (req.query.cycle_id) filter.cycle_id = req.query.cycle_id;
  if (scope === 'my') filter.employee_email = req.user.email;
  else if (scope === 'team') filter.employee_email = { $in: await teamEmails(db, req) };
  else if (scope === 'all') { if (req.user.role !== 'admin') fail(403, 'Not enough permissions'); }
  else fail(400, 'Unknown scope');

  const list = await db.collection('appraisals').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1, employee_name: 1 }).toArray();
  const configs = {};
  const out = [];
  for (const a of list) {
    configs[a.cycle_id] = configs[a.cycle_id] || await getConfig(db, a.cycle_id, { required: false });
    const config = configs[a.cycle_id];
    if (!config) continue;
    const role = scope === 'my' ? 'self' : (req.user.role === 'admin' ? 'admin' : 'manager');
    out.push(await viewAppraisal(db, req, a, config, role));
  }
  res.json(out);
}));

/**
 * GET /appraisals/stats?cycle_id — admin calibration overview.
 */
router.get('/appraisals/stats', requireRole(['admin']), h(async (req, res) => {
  const db = getDB();
  if (!req.query.cycle_id) fail(400, 'cycle_id is required');
  const config = await getConfig(db, req.query.cycle_id);
  const list = await db.collection('appraisals').find({ cycle_id: config.cycle_id }).toArray();
  const distribution = Object.fromEntries((config.rating_scale || DEFAULT_SCALE).map(s => [s.value, 0]));
  const deps = {};
  for (const a of list) {
    if (a.final_rating != null) {
      distribution[Math.min(5, Math.max(1, Math.round(a.final_rating)))] += 1;
      const d = a.department || 'Unassigned';
      deps[d] = deps[d] || { department: d, count: 0, sum: 0 };
      deps[d].count += 1;
      deps[d].sum += a.final_rating;
    }
  }
  res.json({
    phase: config.phase,
    phase_label: PHASE_LABELS[config.phase],
    total: list.length,
    self_submitted: list.filter(a => a.self_status === 'submitted').length,
    manager_submitted: list.filter(a => a.manager_status === 'submitted').length,
    calibrated: list.filter(a => a.calibration).length,
    acknowledged: list.filter(a => a.acknowledgement).length,
    disagreed: list.filter(a => a.acknowledgement && a.acknowledgement.agrees === false).length,
    distribution: (config.rating_scale || DEFAULT_SCALE).map(s => ({ value: s.value, label: s.label, count: distribution[s.value] })),
    by_department: Object.values(deps).map(d => ({ department: d.department, count: d.count, average: round2(d.sum / d.count) }))
  });
}));

router.get('/appraisals/:id', h(async (req, res) => {
  const db = getDB();
  const { appraisal, config, role } = await loadForViewer(db, req, req.params.id);
  res.json(await viewAppraisal(db, req, appraisal, config, role, { detail: true }));
}));

router.put('/appraisals/:id/self-review', validate(selfReviewSchema), h(async (req, res) => {
  const db = getDB();
  const { appraisal, config, role } = await loadForViewer(db, req, req.params.id);
  if (role !== 'self') fail(403, 'Only the employee can write their self review');
  if (config.phase !== 'self_review') fail(400, 'Self reviews are not open in the current phase');
  if (appraisal.self_status === 'submitted') fail(400, 'Your self review has already been submitted');

  const body = req.validatedBody;
  const goals = await employeeGoals(db, appraisal.cycle_id, appraisal.employee_email);
  checkRatings(body, goals, config, body.submit);
  const review = {
    goal_ratings: body.goal_ratings,
    competency_ratings: body.competency_ratings,
    overall_comment: body.overall_comment || '',
    submitted_at: body.submit ? now() : null
  };
  await db.collection('appraisals').updateOne({ id: appraisal.id }, {
    $set: {
      self_review: review,
      self_status: body.submit ? 'submitted' : 'draft',
      self_score: computeScore(review, goals, config),
      updated_at: now()
    }
  });
  if (body.submit && appraisal.manager_email) {
    notify(appraisal.manager_email, {
      type: 'appraisal_self_review_submitted',
      title: 'Self review submitted',
      message: `${appraisal.employee_name} submitted their self review`,
      actionUrl: '/performance/appraisals?tab=team',
      metadata: { appraisal_id: appraisal.id }
    });
  }
  const fresh = await getAppraisal(db, appraisal.id);
  res.json(await viewAppraisal(db, req, fresh, config, role, { detail: true }));
}));

router.put('/appraisals/:id/manager-review', validate(managerReviewSchema), h(async (req, res) => {
  const db = getDB();
  const { appraisal, config, role } = await loadForViewer(db, req, req.params.id);
  if (role !== 'manager' && role !== 'admin') fail(403, "Only the employee's manager can write the manager review");
  if (config.phase !== 'manager_review') fail(400, 'Manager reviews are not open in the current phase');
  if (appraisal.manager_status === 'submitted') fail(400, 'The manager review has already been submitted');

  const body = req.validatedBody;
  const goals = await employeeGoals(db, appraisal.cycle_id, appraisal.employee_email);
  checkRatings(body, goals, config, body.submit);
  if (body.submit && !body.overall_comment) fail(400, 'Add overall comments before submitting');
  const review = {
    goal_ratings: body.goal_ratings,
    competency_ratings: body.competency_ratings,
    overall_comment: body.overall_comment || '',
    strengths: body.strengths || '',
    improvements: body.improvements || '',
    reviewer_email: req.user.email,
    reviewer_name: req.user.full_name,
    submitted_at: body.submit ? now() : null
  };
  const score = computeScore(review, goals, config);
  await db.collection('appraisals').updateOne({ id: appraisal.id }, {
    $set: {
      manager_review: review,
      manager_status: body.submit ? 'submitted' : 'draft',
      manager_score: score,
      final_rating: body.submit ? score : null,
      updated_at: now()
    }
  });
  const fresh = await getAppraisal(db, appraisal.id);
  res.json(await viewAppraisal(db, req, fresh, config, role, { detail: true }));
}));

router.post('/appraisals/:id/calibrate', requireRole(['admin']), validate(calibrateSchema), h(async (req, res) => {
  const db = getDB();
  const { appraisal, config, role } = await loadForViewer(db, req, req.params.id);
  if (role !== 'admin') fail(403, 'You cannot calibrate your own appraisal');
  if (config.phase !== 'calibration') fail(400, 'Calibration is not open in the current phase');
  if (appraisal.manager_status !== 'submitted') fail(400, 'The manager review must be submitted before calibration');
  const { rating, reason } = req.validatedBody;
  const calibration = {
    original_rating: appraisal.calibration?.original_rating ?? appraisal.manager_score,
    rating: round2(rating),
    reason,
    by: req.user.email,
    by_name: req.user.full_name,
    at: now()
  };
  await db.collection('appraisals').updateOne({ id: appraisal.id }, { $set: { calibration, final_rating: calibration.rating, updated_at: now() } });
  const fresh = await getAppraisal(db, appraisal.id);
  res.json(await viewAppraisal(db, req, fresh, config, role, { detail: true }));
}));

router.post('/appraisals/:id/acknowledge', validate(ackSchema), h(async (req, res) => {
  const db = getDB();
  const { appraisal, config, role } = await loadForViewer(db, req, req.params.id);
  if (role !== 'self') fail(403, 'Only the employee can acknowledge their appraisal');
  if (config.phase !== 'released') fail(400, 'The appraisal has not been released yet');
  if (appraisal.acknowledgement) fail(400, 'Already acknowledged');
  if (req.validatedBody.agrees === false && !req.validatedBody.comment) fail(400, 'Please explain why you disagree');
  const ack = { agrees: req.validatedBody.agrees, comment: req.validatedBody.comment || '', at: now() };
  await db.collection('appraisals').updateOne({ id: appraisal.id }, { $set: { acknowledgement: ack, updated_at: now() } });
  if (appraisal.manager_email) {
    notify(appraisal.manager_email, {
      type: 'appraisal_acknowledged',
      title: ack.agrees ? 'Appraisal acknowledged' : 'Appraisal disputed',
      message: `${appraisal.employee_name} ${ack.agrees ? 'acknowledged' : 'disagreed with'} their appraisal${ack.comment ? `: ${ack.comment}` : ''}`,
      actionUrl: '/performance/appraisals?tab=team',
      metadata: { appraisal_id: appraisal.id }
    });
  }
  const fresh = await getAppraisal(db, appraisal.id);
  res.json(await viewAppraisal(db, req, fresh, config, role, { detail: true }));
}));

// ============= 360° PEERS =============

router.post('/appraisals/:id/peers', validate(peersSchema), h(async (req, res) => {
  const db = getDB();
  const { appraisal, config, role } = await loadForViewer(db, req, req.params.id);
  if (!config.peer_feedback_enabled) fail(400, 'Peer feedback is not enabled for this cycle');
  const isReviewee = role === 'self';
  const allowed = isReviewee ? ['self_review', 'manager_review'] : ['self_review', 'manager_review', 'peer_feedback'];
  if (!allowed.includes(config.phase)) fail(400, 'Peers cannot be nominated in the current phase');

  const existing = await db.collection('peer_feedback').find({ appraisal_id: appraisal.id, status: { $ne: 'rejected' } }).toArray();
  const emails = req.validatedBody.peer_emails.filter(e => !existing.some(p => p.peer_email === e));
  if (!emails.length) fail(400, 'These peers are already nominated');
  if (existing.length + emails.length > (config.max_peers || 5)) fail(400, `At most ${config.max_peers || 5} peers can be nominated`);

  const docs = [];
  for (const email of emails) {
    if (email === appraisal.employee_email) fail(400, 'You cannot nominate yourself');
    const peer = await findEmployee(db, email);
    if (!peer || !isActiveEmployee(peer)) fail(400, `${email} is not an active employee`);
    docs.push({
      id: generateUUID(),
      appraisal_id: appraisal.id,
      cycle_id: appraisal.cycle_id,
      cycle_name: appraisal.cycle_name,
      reviewee_email: appraisal.employee_email,
      reviewee_name: appraisal.employee_name,
      peer_email: peer.email,
      peer_name: peer.full_name,
      nominated_by: req.user.email,
      status: isReviewee ? 'nominated' : 'approved',
      decided_by: isReviewee ? null : req.user.email,
      ratings: [],
      strengths: '',
      improvements: '',
      submitted_at: null,
      created_at: now(),
      updated_at: now()
    });
  }
  await db.collection('peer_feedback').insertMany(docs);
  docs.forEach(d => delete d._id);

  if (isReviewee && appraisal.manager_email) {
    notify(appraisal.manager_email, {
      type: 'peer_nominations_pending',
      title: 'Peer nominations to approve',
      message: `${appraisal.employee_name} nominated ${docs.length} peer(s) for 360° feedback`,
      actionUrl: '/performance/appraisals?tab=team',
      metadata: { appraisal_id: appraisal.id }
    });
  }
  if (!isReviewee && config.phase === 'peer_feedback') {
    docs.forEach(d => notify(d.peer_email, {
      type: 'peer_feedback_requested',
      title: 'Peer feedback requested',
      message: `Please share feedback for ${d.reviewee_name}`,
      actionUrl: '/performance/appraisals?tab=peer',
      metadata: { peer_feedback_id: d.id }
    }));
  }
  res.status(201).json(docs.map(d => ({ id: d.id, peer_name: d.peer_name, peer_email: d.peer_email, status: d.status })));
}));

const getPeerDoc = async (db, id) => {
  const p = await db.collection('peer_feedback').findOne({ id }, { projection: { _id: 0 } });
  if (!p) fail(404, 'Peer nomination not found');
  return p;
};

router.delete('/peer-feedback/:id', h(async (req, res) => {
  const db = getDB();
  const p = await getPeerDoc(db, req.params.id);
  const { config, role } = await loadForViewer(db, req, p.appraisal_id);
  if (p.status === 'submitted') fail(400, 'Feedback has already been submitted');
  if (config.phase === 'released' || config.phase === 'calibration') fail(400, 'Nominations are closed');
  if (role === 'self') {
    if (p.status !== 'nominated' || p.nominated_by !== req.user.email) fail(400, 'Only pending nominations you made can be withdrawn');
  } else if (role !== 'manager' && role !== 'admin') {
    fail(403, 'Not enough permissions');
  }
  await db.collection('peer_feedback').deleteOne({ id: p.id });
  res.json({ message: 'Nomination removed' });
}));

router.post('/peer-feedback/:id/decision', validate(decisionSchema), h(async (req, res) => {
  const db = getDB();
  const p = await getPeerDoc(db, req.params.id);
  const { config, role } = await loadForViewer(db, req, p.appraisal_id);
  if (role !== 'manager' && role !== 'admin') fail(403, "Only the employee's manager can approve peers");
  if (!['self_review', 'manager_review', 'peer_feedback'].includes(config.phase)) fail(400, 'Nominations are closed');
  if (p.status !== 'nominated') fail(400, 'This nomination has already been decided');
  const status = req.validatedBody.action === 'approve' ? 'approved' : 'rejected';
  await db.collection('peer_feedback').updateOne({ id: p.id }, {
    $set: { status, decided_by: req.user.email, decision_comment: req.validatedBody.comment || '', updated_at: now() }
  });
  if (status === 'approved' && config.phase === 'peer_feedback') {
    notify(p.peer_email, {
      type: 'peer_feedback_requested',
      title: 'Peer feedback requested',
      message: `Please share feedback for ${p.reviewee_name}`,
      actionUrl: '/performance/appraisals?tab=peer',
      metadata: { peer_feedback_id: p.id }
    });
  }
  res.json({ id: p.id, status });
}));

/**
 * GET /peer-feedback/inbox — feedback I've been asked to give.
 */
router.get('/peer-feedback/inbox', h(async (req, res) => {
  const db = getDB();
  const list = await db.collection('peer_feedback')
    .find({ peer_email: req.user.email, status: { $in: ['approved', 'submitted'] } }, { projection: { _id: 0, peer_email: 0, nominated_by: 0, decided_by: 0 } })
    .sort({ created_at: -1 }).toArray();
  const configs = {};
  const out = [];
  for (const p of list) {
    configs[p.cycle_id] = configs[p.cycle_id] || await getConfig(db, p.cycle_id, { required: false });
    const c = configs[p.cycle_id];
    out.push({
      ...p,
      phase: c?.phase || null,
      phase_label: PHASE_LABELS[c?.phase] || null,
      can_submit: c?.phase === 'peer_feedback' && p.status === 'approved',
      competencies: c?.competencies || [],
      rating_scale: c?.rating_scale || DEFAULT_SCALE
    });
  }
  res.json(out);
}));

router.put('/peer-feedback/:id', validate(peerFeedbackSchema), h(async (req, res) => {
  const db = getDB();
  const p = await getPeerDoc(db, req.params.id);
  if (p.peer_email !== req.user.email) fail(403, 'This feedback request is not yours');
  if (p.status === 'submitted') fail(400, 'Feedback already submitted');
  if (p.status !== 'approved') fail(400, 'This nomination has not been approved');
  const config = await getConfig(db, p.cycle_id);
  if (config.phase !== 'peer_feedback') fail(400, 'Peer feedback is not open in the current phase');

  const body = req.validatedBody;
  const compIds = new Set((config.competencies || []).map(c => c.id));
  for (const r of body.ratings) if (!compIds.has(r.competency_id)) fail(400, 'A rating refers to an unknown competency');
  if (body.submit) {
    if (body.ratings.length !== compIds.size) fail(400, 'Rate every competency before submitting');
    if (!body.strengths && !body.improvements) fail(400, 'Add at least one comment before submitting');
  }
  await db.collection('peer_feedback').updateOne({ id: p.id }, {
    $set: {
      ratings: body.ratings,
      strengths: body.strengths || '',
      improvements: body.improvements || '',
      status: body.submit ? 'submitted' : 'approved',
      submitted_at: body.submit ? now() : null,
      updated_at: now()
    }
  });
  const fresh = await getPeerDoc(db, p.id);
  delete fresh.peer_email;
  res.json(fresh);
}));

module.exports = { router, PHASES, PHASE_LABELS, computeScore };
