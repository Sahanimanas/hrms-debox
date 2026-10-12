/**
 * PF-1 Goals / OKRs / KRAs: review cycles, goals with key results,
 * approval workflow, check-ins and cascading (parent goals).
 *
 * Collections: review_cycles, goals
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { emitEvent } = require('../events');
const {
  h, fail, stripId, now, todayStr, round2, generateUUID, employeeUid, DATE,
  findEmployee, isManagerOf, teamEmails, resolveManager, notify
} = require('./common');

const router = express.Router();

const GOAL_TYPES = ['OKR', 'KRA', 'KPI'];
const GOAL_STATUSES = ['not_started', 'on_track', 'at_risk', 'behind', 'done'];
const CYCLE_STATUSES = ['draft', 'active', 'closed'];

// ============= SCHEMAS =============

const cycleFields = {
  name: Joi.string().trim().min(2).max(120),
  description: Joi.string().trim().max(1000).allow('', null),
  period_start: Joi.string().pattern(DATE),
  period_end: Joi.string().pattern(DATE),
  goal_deadline: Joi.string().pattern(DATE).allow(null, ''),
  status: Joi.string().valid(...CYCLE_STATUSES)
};
const cycleCreate = Joi.object({
  ...cycleFields,
  name: cycleFields.name.required(),
  period_start: cycleFields.period_start.required(),
  period_end: cycleFields.period_end.required(),
  status: cycleFields.status.default('draft')
});
const cycleUpdate = Joi.object(cycleFields).min(1);

const keyResult = Joi.object({
  id: Joi.string().max(64),
  title: Joi.string().trim().min(1).max(300).required(),
  start_value: Joi.number().default(0),
  target_value: Joi.number().required(),
  current_value: Joi.number(),
  unit: Joi.string().trim().max(20).allow('', null)
});

const goalFields = {
  title: Joi.string().trim().min(2).max(200),
  description: Joi.string().trim().max(3000).allow('', null),
  type: Joi.string().valid(...GOAL_TYPES),
  weightage: Joi.number().min(0).max(100),
  key_results: Joi.array().items(keyResult).max(10),
  parent_goal_id: Joi.string().allow(null, ''),
  due_date: Joi.string().pattern(DATE).allow(null, ''),
  progress: Joi.number().min(0).max(100),
  status: Joi.string().valid(...GOAL_STATUSES)
};
const goalCreate = Joi.object({
  cycle_id: Joi.string().required(),
  employee_email: Joi.string().email().allow(null, ''),
  is_company_goal: Joi.boolean().default(false),
  ...goalFields,
  title: goalFields.title.required(),
  type: goalFields.type.default('OKR'),
  weightage: goalFields.weightage.default(0),
  key_results: goalFields.key_results.default([])
});
const goalUpdate = Joi.object(goalFields).min(1);

const submitSchema = Joi.object({ cycle_id: Joi.string().required() });
const reviewSchema = Joi.object({
  action: Joi.string().valid('approve', 'send_back').required(),
  comments: Joi.string().trim().max(2000).allow('', null)
});
const bulkReviewSchema = reviewSchema.keys({
  cycle_id: Joi.string().required(),
  employee_email: Joi.string().email().required()
});
const checkInSchema = Joi.object({
  key_results: Joi.array().items(Joi.object({ id: Joi.string().required(), current_value: Joi.number().required() })).default([]),
  progress: Joi.number().min(0).max(100),
  status: Joi.string().valid(...GOAL_STATUSES),
  note: Joi.string().trim().max(2000).allow('', null)
});

// ============= HELPERS =============

/** Progress (0-100) of one key result, works for increasing and decreasing targets. */
const krProgress = (kr) => {
  const start = Number(kr.start_value) || 0;
  const target = Number(kr.target_value);
  const current = kr.current_value == null ? start : Number(kr.current_value);
  if (target === start) return current === target ? 100 : 0;
  const ratio = (current - start) / (target - start);
  return Math.min(100, Math.max(0, ratio * 100));
};

const computeProgress = (goal) => {
  if (goal.key_results?.length) {
    const sum = goal.key_results.reduce((s, kr) => s + krProgress(kr), 0);
    return round2(sum / goal.key_results.length);
  }
  return round2(Number(goal.manual_progress) || 0);
};

const normalizeKeyResults = (list, previous = []) => (list || []).map(kr => {
  const prev = previous.find(p => p.id && p.id === kr.id);
  const start = kr.start_value ?? 0;
  const out = {
    id: prev ? prev.id : generateUUID(),
    title: kr.title,
    start_value: start,
    target_value: kr.target_value,
    current_value: kr.current_value ?? prev?.current_value ?? start,
    unit: kr.unit || ''
  };
  out.progress = round2(krProgress(out));
  return out;
});

const getCycle = async (db, id) => {
  const cycle = id ? await db.collection('review_cycles').findOne({ id }, { projection: { _id: 0 } }) : null;
  if (!cycle) fail(404, 'Review cycle not found');
  return cycle;
};

const getGoal = async (db, id) => {
  const goal = await db.collection('goals').findOne({ id }, { projection: { _id: 0 } });
  if (!goal) fail(404, 'Goal not found');
  return goal;
};

/** Can the caller see this goal? */
const canViewGoal = async (db, req, goal) => {
  if (goal.is_company_goal || req.user.role === 'admin') return true;
  if (goal.employee_email === req.user.email) return true;
  const owner = await findEmployee(db, goal.employee_email);
  return isManagerOf(req, owner);
};

/** Can the caller manage (edit/approve/delete) this goal as a manager? */
const canManageGoal = async (db, req, goal) => {
  if (req.user.role === 'admin') return true;
  if (goal.is_company_goal) return false;
  const owner = await findEmployee(db, goal.employee_email);
  return isManagerOf(req, owner);
};

/** Is `candidateEmail` a manager of `owner` (manager_email, or a department manager)? */
const isManagerEmailOf = async (db, owner, candidateEmail) => {
  if (!owner || !candidateEmail || owner.email === candidateEmail) return false;
  if (owner.manager_email) return owner.manager_email === candidateEmail;
  const candidate = await findEmployee(db, candidateEmail);
  return !!candidate && candidate.role === 'manager' && !!owner.department && candidate.department === owner.department;
};

/** Validate a parent goal link; returns { parent_goal_id, parent_goal_title } */
const resolveParent = async (db, req, { parentId, cycleId, ownerEmail, goalId }) => {
  if (!parentId) return { parent_goal_id: null, parent_goal_title: null };
  const parent = await db.collection('goals').findOne({ id: parentId });
  if (!parent) fail(400, 'Parent goal not found');
  if (parent.cycle_id !== cycleId) fail(400, 'Parent goal must be in the same review cycle');
  if (goalId && parent.id === goalId) fail(400, 'A goal cannot be its own parent');
  if (goalId) {
    // Walk up to make sure we don't create a loop
    let cursor = parent;
    for (let i = 0; cursor?.parent_goal_id && i < 20; i++) {
      if (cursor.parent_goal_id === goalId) fail(400, 'That link would create a loop');
      cursor = await db.collection('goals').findOne({ id: cursor.parent_goal_id });
    }
  }
  if (!parent.is_company_goal && req.user.role !== 'admin') {
    const owner = await findEmployee(db, ownerEmail);
    if (!(await isManagerEmailOf(db, owner, parent.employee_email))) {
      fail(400, "A goal can only be aligned to a company goal or one of the owner's manager's goals");
    }
  }
  return { parent_goal_id: parent.id, parent_goal_title: parent.title };
};

const historyEntry = (req, action, comment) => ({
  action,
  by: req.user.email,
  by_name: req.user.full_name,
  comment: comment || null,
  at: now()
});

const deadlinePassed = (cycle) => !!cycle.goal_deadline && todayStr() > cycle.goal_deadline;

// ============= CYCLES =============

router.get('/cycles', h(async (req, res) => {
  const db = getDB();
  const filter = req.user.role === 'admin' ? {} : { status: { $ne: 'draft' } };
  if (req.query.status) filter.status = req.user.role === 'admin' || req.query.status !== 'draft' ? req.query.status : '__none__';
  const cycles = await db.collection('review_cycles').find(filter, { projection: { _id: 0 } }).sort({ period_start: -1 }).toArray();
  const counts = await db.collection('goals').aggregate([
    { $match: { cycle_id: { $in: cycles.map(c => c.id) }, is_company_goal: { $ne: true } } },
    { $group: { _id: '$cycle_id', goals: { $sum: 1 }, employees: { $addToSet: '$employee_email' } } }
  ]).toArray();
  const map = Object.fromEntries(counts.map(c => [c._id, c]));
  res.json(cycles.map(c => ({
    ...c,
    goal_count: map[c.id]?.goals || 0,
    employee_count: map[c.id]?.employees?.length || 0,
    deadline_passed: deadlinePassed(c)
  })));
}));

router.get('/cycles/:id', h(async (req, res) => {
  const cycle = await getCycle(getDB(), req.params.id);
  if (cycle.status === 'draft' && req.user.role !== 'admin') fail(404, 'Review cycle not found');
  res.json({ ...cycle, deadline_passed: deadlinePassed(cycle) });
}));

const checkCycleDates = (c) => {
  if (c.period_end < c.period_start) fail(400, 'Period end must be on or after period start');
  if (c.goal_deadline && (c.goal_deadline < c.period_start || c.goal_deadline > c.period_end)) {
    fail(400, 'Goal-setting deadline must fall within the review period');
  }
};

router.post('/cycles', requireRole(['admin']), validate(cycleCreate), h(async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  checkCycleDates(data);
  const cycle = {
    id: generateUUID(),
    ...data,
    description: data.description || '',
    goal_deadline: data.goal_deadline || null,
    created_by: req.user.email,
    created_at: now(),
    updated_at: now()
  };
  await db.collection('review_cycles').insertOne(cycle);
  emitEvent('performance.cycle.created', { cycle_id: cycle.id, name: cycle.name });
  res.status(201).json(stripId(cycle));
}));

router.put('/cycles/:id', requireRole(['admin']), validate(cycleUpdate), h(async (req, res) => {
  const db = getDB();
  const cycle = await getCycle(db, req.params.id);
  const updates = { ...req.validatedBody };
  if (updates.goal_deadline === '') updates.goal_deadline = null;
  const merged = { ...cycle, ...updates };
  checkCycleDates(merged);
  if (updates.status === 'draft' && cycle.status !== 'draft') {
    const count = await db.collection('goals').countDocuments({ cycle_id: cycle.id });
    if (count) fail(400, 'A cycle with goals cannot be moved back to draft');
  }
  await db.collection('review_cycles').updateOne({ id: cycle.id }, { $set: { ...updates, updated_at: now() } });
  if (updates.status && updates.status !== cycle.status) {
    emitEvent(`performance.cycle.${updates.status}`, { cycle_id: cycle.id, name: merged.name });
  }
  res.json(await getCycle(db, cycle.id));
}));

router.delete('/cycles/:id', requireRole(['admin']), h(async (req, res) => {
  const db = getDB();
  const cycle = await getCycle(db, req.params.id);
  const goals = await db.collection('goals').countDocuments({ cycle_id: cycle.id });
  const appraisals = await db.collection('appraisals').countDocuments({ cycle_id: cycle.id });
  if (goals || appraisals) fail(400, 'This cycle has goals or appraisals; close it instead of deleting');
  await db.collection('review_cycles').deleteOne({ id: cycle.id });
  await db.collection('appraisal_configs').deleteOne({ cycle_id: cycle.id });
  res.json({ message: 'Review cycle deleted' });
}));

// ============= GOALS =============

/**
 * GET /goals?cycle_id&scope=my|team|all|company&employee_email&approval_status
 */
router.get('/goals', h(async (req, res) => {
  const db = getDB();
  const scope = req.query.scope || 'my';
  const filter = {};
  if (req.query.cycle_id) filter.cycle_id = req.query.cycle_id;
  if (req.query.approval_status) filter.approval_status = req.query.approval_status;

  if (scope === 'company') {
    filter.is_company_goal = true;
  } else if (scope === 'my') {
    filter.employee_email = req.user.email;
  } else if (scope === 'team' || scope === 'all') {
    filter.is_company_goal = { $ne: true };
    if (req.user.role === 'admin') {
      if (scope === 'team') filter.employee_email = { $in: await teamEmails(db, req) };
      if (req.query.employee_email) filter.employee_email = req.query.employee_email;
    } else {
      if (scope === 'all') fail(403, 'Not enough permissions');
      const emails = await teamEmails(db, req);
      if (req.query.employee_email) {
        if (!emails.includes(req.query.employee_email)) fail(403, 'Not your team member');
        filter.employee_email = req.query.employee_email;
      } else {
        filter.employee_email = { $in: emails };
      }
    }
  } else {
    fail(400, 'Unknown scope');
  }
  const goals = await db.collection('goals').find(filter, { projection: { _id: 0 } })
    .sort({ employee_name: 1, created_at: 1 }).toArray();
  res.json(goals);
}));

/**
 * GET /goals/parent-options?cycle_id&employee_email
 * Company goals plus the owner's manager's goals, for cascading.
 */
router.get('/goals/parent-options', h(async (req, res) => {
  const db = getDB();
  if (!req.query.cycle_id) fail(400, 'cycle_id is required');
  const ownerEmail = req.query.employee_email || req.user.email;
  const owner = await findEmployee(db, ownerEmail);
  if (ownerEmail !== req.user.email && !isManagerOf(req, owner)) fail(403, 'Not enough permissions');

  const or = [{ is_company_goal: true }];
  if (owner) {
    if (owner.manager_email) {
      or.push({ employee_email: owner.manager_email });
    } else if (owner.department) {
      const managers = await db.collection('employees')
        .find({ department: owner.department, role: 'manager', email: { $ne: owner.email } }, { projection: { email: 1 } }).toArray();
      if (managers.length) or.push({ employee_email: { $in: managers.map(m => m.email) } });
    }
  }
  const goals = await db.collection('goals').find(
    { cycle_id: req.query.cycle_id, $or: or, approval_status: { $ne: 'sent_back' } },
    { projection: { _id: 0, id: 1, title: 1, type: 1, is_company_goal: 1, employee_name: 1, progress: 1 } }
  ).sort({ is_company_goal: -1, title: 1 }).toArray();
  res.json(goals);
}));

router.get('/goals/:id', h(async (req, res) => {
  const db = getDB();
  const goal = await getGoal(db, req.params.id);
  if (!(await canViewGoal(db, req, goal))) fail(403, 'Not enough permissions');
  const children = await db.collection('goals').find({ parent_goal_id: goal.id }, { projection: { _id: 0 } }).toArray();
  const visible = [];
  for (const c of children) {
    if (await canViewGoal(db, req, c)) {
      visible.push({ id: c.id, title: c.title, employee_name: c.employee_name, progress: c.progress, status: c.status });
    }
  }
  res.json({
    ...goal,
    can_manage: await canManageGoal(db, req, goal),
    aligned_goals: visible,
    aligned_goal_count: children.length
  });
}));

router.post('/goals', validate(goalCreate), h(async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const cycle = await getCycle(db, data.cycle_id);

  let owner = null;
  let approvalStatus = 'draft';
  let assignedBy = null;

  if (data.is_company_goal) {
    if (req.user.role !== 'admin') fail(403, 'Only admins can create company goals');
    if (cycle.status === 'closed') fail(400, 'This review cycle is closed');
    approvalStatus = 'approved';
  } else {
    const ownerEmail = data.employee_email || req.user.email;
    owner = await findEmployee(db, ownerEmail);
    if (!owner) fail(ownerEmail === req.user.email ? 400 : 404, ownerEmail === req.user.email ? 'You need an employee profile to set goals' : 'Employee not found');
    if (cycle.status !== 'active') fail(400, 'Goals can only be added while the review cycle is active');
    if (ownerEmail !== req.user.email) {
      if (!isManagerOf(req, owner)) fail(403, 'You can only assign goals to your team');
      approvalStatus = 'approved';
      assignedBy = { email: req.user.email, name: req.user.full_name };
    } else if (deadlinePassed(cycle)) {
      fail(400, 'The goal-setting deadline for this cycle has passed');
    }
  }

  const ownerEmail = owner?.email || null;
  const parent = await resolveParent(db, req, { parentId: data.parent_goal_id, cycleId: cycle.id, ownerEmail });
  const goal = {
    id: generateUUID(),
    cycle_id: cycle.id,
    cycle_name: cycle.name,
    is_company_goal: !!data.is_company_goal,
    employee_email: ownerEmail,
    employee_name: owner ? owner.full_name : 'Company',
    employee_uid: owner ? employeeUid(owner) : null,
    department: owner?.department || null,
    title: data.title,
    description: data.description || '',
    type: data.type,
    weightage: data.is_company_goal ? 0 : data.weightage,
    key_results: normalizeKeyResults(data.key_results),
    manual_progress: data.progress ?? 0,
    due_date: data.due_date || null,
    ...parent,
    status: data.status || 'not_started',
    approval_status: approvalStatus,
    approval_comments: null,
    assigned_by: assignedBy,
    created_by: req.user.email,
    history: [historyEntry(req, assignedBy ? 'assigned' : 'created')],
    check_ins: [],
    created_at: now(),
    updated_at: now()
  };
  goal.progress = computeProgress(goal);
  await db.collection('goals').insertOne(goal);

  if (assignedBy) {
    notify(owner.email, {
      type: 'goal_assigned',
      title: 'New goal assigned',
      message: `${req.user.full_name} assigned you a goal: ${goal.title}`,
      actionUrl: '/performance/goals',
      metadata: { goal_id: goal.id }
    });
  }
  res.status(201).json(stripId(goal));
}));

router.put('/goals/:id', validate(goalUpdate), h(async (req, res) => {
  const db = getDB();
  const goal = await getGoal(db, req.params.id);
  const cycle = await getCycle(db, goal.cycle_id);
  if (cycle.status === 'closed') fail(400, 'This review cycle is closed');

  const isOwner = goal.employee_email === req.user.email;
  const manages = await canManageGoal(db, req, goal);
  if (!isOwner && !manages) fail(403, 'Not enough permissions');
  if (!manages && !['draft', 'sent_back'].includes(goal.approval_status)) {
    fail(400, 'Submitted or approved goals can only be changed by your manager; use check-ins to record progress');
  }

  const data = req.validatedBody;
  const updates = { updated_at: now() };
  for (const k of ['title', 'description', 'type', 'due_date']) if (data[k] !== undefined) updates[k] = data[k] || (k === 'due_date' ? null : data[k]);
  if (data.weightage !== undefined && !goal.is_company_goal) updates.weightage = data.weightage;
  if (data.status !== undefined) updates.status = data.status;
  if (data.progress !== undefined) updates.manual_progress = data.progress;
  if (data.key_results !== undefined) updates.key_results = normalizeKeyResults(data.key_results, goal.key_results);
  if (data.parent_goal_id !== undefined) {
    Object.assign(updates, await resolveParent(db, req, {
      parentId: data.parent_goal_id, cycleId: goal.cycle_id, ownerEmail: goal.employee_email, goalId: goal.id
    }));
  }
  const merged = { ...goal, ...updates };
  updates.progress = computeProgress(merged);

  await db.collection('goals').updateOne(
    { id: goal.id },
    { $set: updates, $push: { history: historyEntry(req, 'edited') } }
  );
  if (updates.title) await db.collection('goals').updateMany({ parent_goal_id: goal.id }, { $set: { parent_goal_title: updates.title } });
  res.json(await getGoal(db, goal.id));
}));

router.delete('/goals/:id', h(async (req, res) => {
  const db = getDB();
  const goal = await getGoal(db, req.params.id);
  const cycle = await getCycle(db, goal.cycle_id);
  if (cycle.status === 'closed') fail(400, 'This review cycle is closed');
  const isOwner = goal.employee_email === req.user.email;
  const manages = await canManageGoal(db, req, goal);
  if (!isOwner && !manages) fail(403, 'Not enough permissions');
  if (!manages && !['draft', 'sent_back'].includes(goal.approval_status)) fail(400, 'Only draft goals can be deleted');
  await db.collection('goals').deleteOne({ id: goal.id });
  await db.collection('goals').updateMany({ parent_goal_id: goal.id }, { $set: { parent_goal_id: null, parent_goal_title: null } });
  res.json({ message: 'Goal deleted' });
}));

/**
 * POST /goals/submit { cycle_id } — submit all my draft / sent-back goals.
 * Weightage of all my goals in the cycle must total exactly 100%.
 */
router.post('/goals/submit', validate(submitSchema), h(async (req, res) => {
  const db = getDB();
  const cycle = await getCycle(db, req.validatedBody.cycle_id);
  if (cycle.status !== 'active') fail(400, 'Goals can only be submitted while the cycle is active');
  if (deadlinePassed(cycle)) fail(400, 'The goal-setting deadline for this cycle has passed');

  const goals = await db.collection('goals').find({ cycle_id: cycle.id, employee_email: req.user.email }).toArray();
  const pending = goals.filter(g => ['draft', 'sent_back'].includes(g.approval_status));
  if (!pending.length) fail(400, 'You have no draft goals to submit');
  if (goals.some(g => !(g.weightage > 0))) fail(400, 'Every goal needs a weightage above 0%');
  const total = round2(goals.reduce((s, g) => s + (Number(g.weightage) || 0), 0));
  if (Math.abs(total - 100) > 0.01) fail(400, `Goal weightages must total 100% (currently ${total}%)`);

  await db.collection('goals').updateMany(
    { id: { $in: pending.map(g => g.id) } },
    { $set: { approval_status: 'submitted', submitted_at: now(), updated_at: now() }, $push: { history: historyEntry(req, 'submitted') } }
  );

  const me = req.me;
  const manager = await resolveManager(db, me);
  const recipients = manager ? [manager.email]
    : (await db.collection('employees').find({ role: 'admin', email: { $ne: req.user.email } }, { projection: { email: 1 } }).toArray()).map(a => a.email);
  recipients.forEach(email => notify(email, {
    type: 'goals_submitted',
    title: 'Goals awaiting your approval',
    message: `${req.user.full_name} submitted ${pending.length} goal(s) for ${cycle.name}`,
    actionUrl: '/performance/goals?tab=team',
    metadata: { cycle_id: cycle.id, employee_email: req.user.email }
  }));
  res.json({ submitted: pending.length, total_weightage: total });
}));

const applyReview = async (db, req, goals, action, comments) => {
  if (action === 'send_back' && !comments) fail(400, 'Add a comment explaining what to change');
  const approvalStatus = action === 'approve' ? 'approved' : 'sent_back';
  await db.collection('goals').updateMany(
    { id: { $in: goals.map(g => g.id) } },
    {
      $set: {
        approval_status: approvalStatus,
        approval_comments: comments || null,
        reviewed_by: req.user.email,
        reviewed_at: now(),
        updated_at: now()
      },
      $push: { history: historyEntry(req, approvalStatus, comments) }
    }
  );
  const owner = goals[0].employee_email;
  notify(owner, {
    type: action === 'approve' ? 'goals_approved' : 'goals_sent_back',
    title: action === 'approve' ? 'Goals approved' : 'Goals sent back',
    message: action === 'approve'
      ? `${req.user.full_name} approved ${goals.length} of your goal(s)`
      : `${req.user.full_name} sent back ${goals.length} goal(s): ${comments}`,
    actionUrl: '/performance/goals',
    metadata: { goal_ids: goals.map(g => g.id) }
  });
  if (action === 'approve') emitEvent('performance.goals.approved', { employee_email: owner, goal_ids: goals.map(g => g.id) });
};

router.post('/goals/review', validate(bulkReviewSchema), h(async (req, res) => {
  const db = getDB();
  const { cycle_id, employee_email, action, comments } = req.validatedBody;
  const owner = await findEmployee(db, employee_email);
  if (!owner) fail(404, 'Employee not found');
  if (!isManagerOf(req, owner)) fail(403, "You can only review your team's goals");
  const goals = await db.collection('goals').find({ cycle_id, employee_email, approval_status: 'submitted' }).toArray();
  if (!goals.length) fail(400, 'No submitted goals to review');
  await applyReview(db, req, goals, action, comments);
  res.json({ reviewed: goals.length, approval_status: action === 'approve' ? 'approved' : 'sent_back' });
}));

router.post('/goals/:id/review', validate(reviewSchema), h(async (req, res) => {
  const db = getDB();
  const goal = await getGoal(db, req.params.id);
  if (goal.is_company_goal || !(await canManageGoal(db, req, goal))) fail(403, "You can only review your team's goals");
  if (goal.approval_status !== 'submitted') fail(400, 'Only submitted goals can be reviewed');
  await applyReview(db, req, [goal], req.validatedBody.action, req.validatedBody.comments);
  res.json(await getGoal(db, goal.id));
}));

/**
 * POST /goals/:id/check-ins — record progress (owner, their manager or admin).
 */
router.post('/goals/:id/check-ins', validate(checkInSchema), h(async (req, res) => {
  const db = getDB();
  const goal = await getGoal(db, req.params.id);
  const isOwner = goal.employee_email && goal.employee_email === req.user.email;
  if (!isOwner && !(await canManageGoal(db, req, goal))) fail(403, 'Not enough permissions');
  if (goal.approval_status !== 'approved') fail(400, 'Progress can be recorded only on approved goals');
  const cycle = await getCycle(db, goal.cycle_id);
  if (cycle.status !== 'active') fail(400, 'This review cycle is not active');

  const data = req.validatedBody;
  const keyResults = goal.key_results.map(kr => ({ ...kr }));
  for (const upd of data.key_results) {
    const kr = keyResults.find(k => k.id === upd.id);
    if (!kr) fail(400, `Unknown key result ${upd.id}`);
    kr.current_value = upd.current_value;
    kr.progress = round2(krProgress(kr));
  }
  if (!data.key_results.length && data.progress === undefined && !data.status && !data.note) {
    fail(400, 'Provide key result values, progress, a status or a note');
  }
  if (keyResults.length && data.progress !== undefined) {
    fail(400, 'Progress of a goal with key results is calculated from the key results');
  }
  const merged = { ...goal, key_results: keyResults, manual_progress: data.progress ?? goal.manual_progress };
  const progress = computeProgress(merged);
  let status = data.status || goal.status;
  if (!data.status) {
    if (progress >= 100) status = 'done';
    else if (goal.status === 'not_started' && progress > 0) status = 'on_track';
  }
  const checkIn = {
    id: generateUUID(),
    at: now(),
    by: req.user.email,
    by_name: req.user.full_name,
    progress,
    previous_progress: goal.progress,
    status,
    note: data.note || '',
    key_results: data.key_results
  };
  await db.collection('goals').updateOne(
    { id: goal.id },
    {
      $set: { key_results: keyResults, manual_progress: merged.manual_progress, progress, status, last_check_in_at: checkIn.at, updated_at: now() },
      $push: { check_ins: checkIn }
    }
  );
  if (!isOwner) {
    notify(goal.employee_email, {
      type: 'goal_check_in',
      title: 'Goal progress updated',
      message: `${req.user.full_name} updated "${goal.title}" to ${progress}%`,
      actionUrl: '/performance/goals',
      metadata: { goal_id: goal.id }
    });
  }
  res.status(201).json(await getGoal(db, goal.id));
}));

module.exports = { router, computeProgress, krProgress, getCycle };
