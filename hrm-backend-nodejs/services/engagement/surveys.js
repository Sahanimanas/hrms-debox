/**
 * EN-4 Surveys and eNPS.
 *
 * Collections:
 *   surveys               { id, title, description, anonymous, audience, questions: [{ id, type, text, required, options }],
 *                           opens_at, closes_at, status: 'draft'|'published'|'closed', participation_salt (never returned),
 *                           response_count, created_by, created_at, updated_at, published_at, closed_at }
 *   survey_responses      { _id (random), id, survey_id, answers: { <question id>: value }, department,
 *                           respondent: { email, name, employee_id } | absent for anonymous surveys,
 *                           submitted_at (identified) | submitted_on 'YYYY-MM-DD' (anonymous) }
 *   survey_participation  { _id (random), survey_id, participant: HMAC(survey salt + survey id + user) }
 *
 * Anonymous surveys never store who answered next to the answers: the
 * participation marker is a salted hash used only to stop double submission,
 * and both documents use random _ids so insertion time can't link them.
 */

const express = require('express');
const crypto = require('crypto');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { config } = require('../../config/config');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { emitEvent } = require('../events');
const {
  handle, validateQuery, getViewer, audienceSchema, audienceObject, normalizeAudience, inAudience,
  audienceFilter, audienceMembers, notifyPeople, todayLocal
} = require('./common');
const { toCsv } = require('./csv');

const router = express.Router();
const admin = requireRole(['admin']);

const MIN_ANONYMOUS_RESPONSES = 3;
const QUESTION_TYPES = ['rating', 'nps', 'single_choice', 'multiple_choice', 'text'];
const CHOICE_TYPES = ['single_choice', 'multiple_choice'];

const questionSchema = Joi.object({
  id: Joi.string().trim().max(64),
  type: Joi.string().valid(...QUESTION_TYPES).required(),
  text: Joi.string().trim().min(1).max(500).required(),
  required: Joi.boolean().default(false),
  options: Joi.when('type', {
    is: Joi.valid(...CHOICE_TYPES),
    then: Joi.array().items(Joi.string().trim().min(1).max(200)).min(2).max(20).unique().required(),
    otherwise: Joi.forbidden()
  })
});

const fields = {
  title: Joi.string().trim().min(1).max(200),
  description: Joi.string().trim().max(2000).allow(''),
  anonymous: Joi.boolean(),
  audience: audienceObject,
  questions: Joi.array().items(questionSchema).min(1).max(50),
  opens_at: Joi.date().iso().allow(null),
  closes_at: Joi.date().iso().allow(null)
};

const createSchema = Joi.object({
  ...fields,
  title: fields.title.required(),
  description: fields.description.default(''),
  anonymous: fields.anonymous.default(false),
  audience: audienceSchema,
  questions: fields.questions.required(),
  opens_at: fields.opens_at.default(null),
  closes_at: fields.closes_at.default(null),
  publish: Joi.boolean().default(false)
});

const updateSchema = Joi.object(fields).min(1);

const responseSchema = Joi.object({
  answers: Joi.array().items(Joi.object({
    question_id: Joi.string().required(),
    value: Joi.alternatives().try(
      Joi.string().max(5000).allow(''),
      Joi.number(),
      Joi.array().items(Joi.string().max(200)).max(20),
      Joi.valid(null)
    )
  })).max(100).required()
});

const HIDDEN = { _id: 0, participation_salt: 0 };

// ============= HELPERS =============

const stateOf = (s, now = new Date()) => {
  if (s.status === 'draft') return 'draft';
  if (s.status === 'closed') return 'closed';
  if (s.closes_at && s.closes_at <= now) return 'closed';
  if (s.opens_at && s.opens_at > now) return 'scheduled';
  return 'open';
};

const participantHash = (survey, email) =>
  crypto.createHmac('sha256', config.jwtSecret)
    .update(`${survey.participation_salt}:${survey.id}:${String(email).toLowerCase()}`)
    .digest('hex');

const normalizeQuestions = (questions) => {
  const seen = new Set();
  return questions.map(q => {
    let id = q.id && !seen.has(q.id) ? q.id : generateUUID();
    seen.add(id);
    const out = { id, type: q.type, text: q.text, required: !!q.required };
    if (CHOICE_TYPES.includes(q.type)) out.options = q.options;
    return out;
  });
};

const checkDates = (opensAt, closesAt) => {
  if (opensAt && closesAt && closesAt <= opensAt) return 'The close date must be after the open date';
  return null;
};

/** Validate answers against the survey; returns { answers } or { error }. */
const checkAnswers = (survey, submitted) => {
  const byId = new Map();
  for (const a of submitted) {
    if (byId.has(a.question_id)) return { error: 'Each question can only be answered once' };
    byId.set(a.question_id, a.value);
  }
  const known = new Set(survey.questions.map(q => q.id));
  for (const id of byId.keys()) if (!known.has(id)) return { error: 'Answer refers to an unknown question' };

  const answers = {};
  for (const q of survey.questions) {
    let v = byId.get(q.id);
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required) return { error: `"${q.text}" is required` };
      continue;
    }
    switch (q.type) {
      case 'rating':
      case 'nps': {
        const [min, max] = q.type === 'rating' ? [1, 5] : [0, 10];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
          return { error: `"${q.text}" needs a whole number from ${min} to ${max}` };
        }
        break;
      }
      case 'single_choice':
        if (typeof v !== 'string' || !q.options.includes(v)) return { error: `"${q.text}" needs one of the listed options` };
        break;
      case 'multiple_choice':
        if (typeof v === 'string') v = [v];
        if (!Array.isArray(v) || v.some(x => !q.options.includes(x)) || new Set(v).size !== v.length) {
          return { error: `"${q.text}" needs one or more of the listed options` };
        }
        break;
      case 'text':
        if (typeof v !== 'string') return { error: `"${q.text}" needs a text answer` };
        v = v.trim().slice(0, 2000);
        if (!v) {
          if (q.required) return { error: `"${q.text}" is required` };
          continue;
        }
        break;
      default:
        return { error: 'Unsupported question type' };
    }
    answers[q.id] = v;
  }
  return { answers };
};

const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

const enpsOf = (scores) => {
  if (!scores.length) return null;
  const promoters = scores.filter(s => s >= 9).length;
  const detractors = scores.filter(s => s <= 6).length;
  const passives = scores.length - promoters - detractors;
  return {
    promoters,
    passives,
    detractors,
    promoters_percent: round((promoters / scores.length) * 100),
    detractors_percent: round((detractors / scores.length) * 100),
    score: Math.round(((promoters - detractors) / scores.length) * 100)
  };
};

/** Per-question aggregation. */
const aggregate = (survey, responses) => survey.questions.map(q => {
  const values = responses.map(r => r.answers?.[q.id]).filter(v => v !== undefined && v !== null);
  const base = { id: q.id, type: q.type, text: q.text, required: q.required, answered: values.length };
  if (q.type === 'rating' || q.type === 'nps') {
    const [min, max] = q.type === 'rating' ? [1, 5] : [0, 10];
    const distribution = {};
    for (let i = min; i <= max; i++) distribution[i] = 0;
    values.forEach(v => { distribution[v] = (distribution[v] || 0) + 1; });
    const average = values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : null;
    return { ...base, average, distribution, ...(q.type === 'nps' ? { enps: enpsOf(values) } : {}) };
  }
  if (CHOICE_TYPES.includes(q.type)) {
    const counts = Object.fromEntries(q.options.map(o => [o, 0]));
    values.forEach(v => (Array.isArray(v) ? v : [v]).forEach(o => { if (o in counts) counts[o] += 1; }));
    return {
      ...base,
      options: q.options.map(o => ({ option: o, count: counts[o], percent: values.length ? round((counts[o] / values.length) * 100) : 0 }))
    };
  }
  // Text answers: sorted so their order can't be matched to submission order
  return { ...base, responses: values.map(String).sort((a, b) => a.localeCompare(b)) };
});

const loadSurvey = (db, id) => db.collection('surveys').findOne({ id });

const publicSurvey = (s, extra = {}) => {
  const { _id: _i, participation_salt: _s, ...rest } = s;
  return { ...rest, state: stateOf(s), ...extra };
};

const notifyOpened = async (db, survey) => {
  const members = await audienceMembers(db, survey.audience);
  return notifyPeople(members, {
    type: 'survey_published',
    title: `New survey: ${survey.title}`,
    message: `${survey.anonymous ? 'Anonymous survey. ' : ''}${survey.closes_at ? `Open until ${survey.closes_at.toISOString().slice(0, 10)}.` : 'Your feedback matters.'}`,
    actionUrl: '/engagement/surveys',
    metadata: { survey_id: survey.id }
  }, { exclude: [survey.created_by] });
};

// ============= LIST / READ =============

/**
 * GET /surveys
 * Admin: every survey with state and response counts.
 * Others: open surveys for their audience with a `responded` flag.
 */
router.get('/', validateQuery(Joi.object({ state: Joi.string().valid('draft', 'scheduled', 'open', 'closed') })), handle('List surveys', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const filter = viewer.isAdmin ? {} : { $and: [{ status: 'published' }, audienceFilter(viewer)] };
  const surveys = await db.collection('surveys').find(filter).sort({ created_at: -1 }).toArray();
  const out = [];
  for (const s of surveys) {
    const state = stateOf(s);
    if (!viewer.isAdmin && state !== 'open') continue;
    if (req.validatedQuery.state && state !== req.validatedQuery.state) continue;
    const responded = !!(await db.collection('survey_participation').findOne({ survey_id: s.id, participant: participantHash(s, viewer.email) }));
    out.push(publicSurvey(s, { responded, question_count: s.questions.length }));
  }
  res.json(out);
}));

/**
 * GET /surveys/:id — survey definition for answering (or for the admin builder).
 */
router.get('/:id', handle('Get survey', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const s = await loadSurvey(db, req.params.id);
  if (!s) return res.status(404).json({ detail: 'Survey not found' });
  if (!viewer.isAdmin && (s.status === 'draft' || !inAudience(s.audience, viewer))) {
    return res.status(404).json({ detail: 'Survey not found' });
  }
  const responded = !!(await db.collection('survey_participation').findOne({ survey_id: s.id, participant: participantHash(s, viewer.email) }));
  res.json(publicSurvey(s, { responded }));
}));

// ============= RESPOND =============

/**
 * POST /surveys/:id/responses { answers: [{ question_id, value }] }
 * One response per person; responses can't be edited after submitting.
 */
router.post('/:id/responses', validate(responseSchema), handle('Submit survey', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const s = await loadSurvey(db, req.params.id);
  if (!s || s.status === 'draft' || !inAudience(s.audience, viewer)) return res.status(404).json({ detail: 'Survey not found' });
  const state = stateOf(s);
  if (state !== 'open') return res.status(400).json({ detail: state === 'scheduled' ? 'This survey is not open yet' : 'This survey is closed' });

  const checked = checkAnswers(s, req.validatedBody.answers);
  if (checked.error) return res.status(400).json({ detail: checked.error });
  if (!Object.keys(checked.answers).length) return res.status(400).json({ detail: 'Answer at least one question' });

  const marker = { _id: generateUUID(), survey_id: s.id, participant: participantHash(s, viewer.email) };
  try {
    await db.collection('survey_participation').insertOne(marker);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ detail: 'You have already responded to this survey' });
    throw error;
  }

  const response = {
    _id: generateUUID(),
    id: generateUUID(),
    survey_id: s.id,
    answers: checked.answers,
    department: viewer.department || null
  };
  if (s.anonymous) {
    response.submitted_on = todayLocal();
  } else {
    response.respondent = { email: viewer.email, name: viewer.name, employee_id: viewer.employee?.employee_id || null };
    response.submitted_at = new Date();
  }
  try {
    await db.collection('survey_responses').insertOne(response);
  } catch (error) {
    await db.collection('survey_participation').deleteOne({ _id: marker._id });
    throw error;
  }
  await db.collection('surveys').updateOne({ id: s.id }, { $inc: { response_count: 1 } });
  res.status(201).json({ message: 'Thank you for your response', survey_id: s.id, anonymous: !!s.anonymous });
}));

// ============= ADMIN =============

router.post('/', admin, validate(createSchema), handle('Create survey', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const dateError = checkDates(data.opens_at, data.closes_at);
  if (dateError) return res.status(400).json({ detail: dateError });
  if (data.closes_at && data.closes_at <= new Date()) return res.status(400).json({ detail: 'The close date must be in the future' });
  const now = new Date();
  const survey = {
    id: generateUUID(),
    title: data.title,
    description: data.description,
    anonymous: data.anonymous,
    audience: normalizeAudience(data.audience),
    questions: normalizeQuestions(data.questions),
    opens_at: data.opens_at,
    closes_at: data.closes_at,
    status: data.publish ? 'published' : 'draft',
    participation_salt: crypto.randomBytes(32).toString('hex'),
    response_count: 0,
    created_by: req.user.email,
    created_by_name: req.user.full_name,
    created_at: now,
    updated_at: now,
    published_at: data.publish ? now : null,
    closed_at: null
  };
  await db.collection('surveys').insertOne(survey);
  if (data.publish) {
    notifyOpened(db, survey).catch(err => console.error('[engagement] survey notify:', err.message));
    emitEvent('survey.published', { id: survey.id, title: survey.title });
  }
  res.status(201).json(publicSurvey(survey));
}));

router.put('/:id', admin, validate(updateSchema), handle('Update survey', async (req, res) => {
  const db = getDB();
  const s = await loadSurvey(db, req.params.id);
  if (!s) return res.status(404).json({ detail: 'Survey not found' });
  const data = req.validatedBody;
  const locked = (s.response_count || 0) > 0;
  for (const f of ['questions', 'anonymous', 'audience']) {
    if (data[f] !== undefined && locked) {
      return res.status(400).json({ detail: `Cannot change ${f} after responses have been received` });
    }
  }
  const updates = { updated_at: new Date() };
  for (const f of ['title', 'description', 'anonymous', 'opens_at', 'closes_at']) if (data[f] !== undefined) updates[f] = data[f];
  if (data.audience !== undefined) updates.audience = normalizeAudience(data.audience);
  if (data.questions !== undefined) updates.questions = normalizeQuestions(data.questions);
  const dateError = checkDates(updates.opens_at !== undefined ? updates.opens_at : s.opens_at, updates.closes_at !== undefined ? updates.closes_at : s.closes_at);
  if (dateError) return res.status(400).json({ detail: dateError });
  await db.collection('surveys').updateOne({ id: s.id }, { $set: updates });
  res.json(publicSurvey(await loadSurvey(db, s.id)));
}));

router.post('/:id/publish', admin, handle('Publish survey', async (req, res) => {
  const db = getDB();
  const s = await loadSurvey(db, req.params.id);
  if (!s) return res.status(404).json({ detail: 'Survey not found' });
  if (s.status === 'published' && stateOf(s) !== 'closed') return res.status(400).json({ detail: 'Survey is already published' });
  if (s.closes_at && s.closes_at <= new Date()) return res.status(400).json({ detail: 'Move the close date into the future before reopening' });
  const now = new Date();
  await db.collection('surveys').updateOne({ id: s.id }, { $set: { status: 'published', published_at: s.published_at || now, closed_at: null, updated_at: now } });
  const updated = await loadSurvey(db, s.id);
  if (s.status === 'draft') {
    notifyOpened(db, updated).catch(err => console.error('[engagement] survey notify:', err.message));
    emitEvent('survey.published', { id: s.id, title: s.title });
  }
  res.json(publicSurvey(updated));
}));

router.post('/:id/close', admin, handle('Close survey', async (req, res) => {
  const db = getDB();
  const s = await loadSurvey(db, req.params.id);
  if (!s) return res.status(404).json({ detail: 'Survey not found' });
  if (s.status === 'draft') return res.status(400).json({ detail: 'A draft survey cannot be closed; delete it instead' });
  const now = new Date();
  await db.collection('surveys').updateOne({ id: s.id }, { $set: { status: 'closed', closed_at: now, updated_at: now } });
  res.json(publicSurvey(await loadSurvey(db, s.id)));
}));

router.delete('/:id', admin, handle('Delete survey', async (req, res) => {
  const db = getDB();
  const s = await loadSurvey(db, req.params.id);
  if (!s) return res.status(404).json({ detail: 'Survey not found' });
  await db.collection('surveys').deleteOne({ id: s.id });
  await db.collection('survey_responses').deleteMany({ survey_id: s.id });
  await db.collection('survey_participation').deleteMany({ survey_id: s.id });
  res.json({ message: 'Survey deleted' });
}));

/**
 * GET /surveys/:id/results (admin)
 * Per-question aggregation, eNPS and response rate. Anonymous surveys hide
 * every breakdown until at least 3 responses exist; department breakdowns only
 * include departments with at least 3 responses.
 */
router.get('/:id/results', admin, handle('Survey results', async (req, res) => {
  const db = getDB();
  const s = await loadSurvey(db, req.params.id);
  if (!s) return res.status(404).json({ detail: 'Survey not found' });
  const responses = await db.collection('survey_responses').find({ survey_id: s.id }, { projection: { _id: 0, answers: 1, department: 1 } }).toArray();
  const audienceSize = (await audienceMembers(db, s.audience)).length;
  const count = responses.length;
  const threshold = s.anonymous ? MIN_ANONYMOUS_RESPONSES : 1;
  const insufficient = s.anonymous && count < MIN_ANONYMOUS_RESPONSES;

  const out = {
    survey: publicSurvey(s),
    response_count: count,
    audience_size: audienceSize,
    response_rate: audienceSize ? round((count / audienceSize) * 100) : 0,
    min_responses: s.anonymous ? MIN_ANONYMOUS_RESPONSES : 0,
    insufficient_responses: insufficient
  };
  if (insufficient) {
    out.questions = s.questions.map(q => ({ id: q.id, type: q.type, text: q.text, hidden: true }));
    out.enps = null;
    out.by_department = [];
    return res.json(out);
  }

  out.questions = aggregate(s, responses);
  const npsQuestion = s.questions.find(q => q.type === 'nps');
  out.enps = npsQuestion ? out.questions.find(q => q.id === npsQuestion.id).enps : null;

  const groups = new Map();
  for (const r of responses) {
    const key = r.department || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const ratingIds = s.questions.filter(q => q.type === 'rating').map(q => q.id);
  out.by_department = [...groups.entries()]
    .filter(([, list]) => list.length >= threshold)
    .map(([department, list]) => {
      const ratings = list.flatMap(r => ratingIds.map(id => r.answers?.[id]).filter(v => typeof v === 'number'));
      const nps = npsQuestion ? list.map(r => r.answers?.[npsQuestion.id]).filter(v => typeof v === 'number') : [];
      return {
        department,
        responses: list.length,
        average_rating: ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length, 2) : null,
        enps: npsQuestion ? enpsOf(nps)?.score ?? null : null
      };
    })
    .sort((a, b) => b.responses - a.responses);
  out.hidden_departments = [...groups.values()].filter(list => list.length < threshold).length;
  res.json(out);
}));

/**
 * GET /surveys/:id/export (admin) — raw responses as CSV.
 * Anonymous surveys: no identity or department columns, shuffled rows, and only
 * once the anonymity threshold is met.
 */
router.get('/:id/export', admin, handle('Export survey', async (req, res) => {
  const db = getDB();
  const s = await loadSurvey(db, req.params.id);
  if (!s) return res.status(404).json({ detail: 'Survey not found' });
  const responses = await db.collection('survey_responses').find({ survey_id: s.id }, { projection: { _id: 0 } }).toArray();
  if (s.anonymous && responses.length < MIN_ANONYMOUS_RESPONSES) {
    return res.status(400).json({ detail: `At least ${MIN_ANONYMOUS_RESPONSES} responses are needed before anonymous results can be exported` });
  }
  const fmt = (q, v) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join('; ') : v);
  const columns = s.anonymous
    ? []
    : [
      { label: 'Respondent', value: r => r.respondent?.name },
      { label: 'Email', value: r => r.respondent?.email },
      { label: 'Employee ID', value: r => r.respondent?.employee_id },
      { label: 'Department', value: r => r.department },
      { label: 'Submitted at', value: r => r.submitted_at?.toISOString() }
    ];
  s.questions.forEach((q, i) => columns.push({ label: `Q${i + 1}. ${q.text}`, value: r => fmt(q, r.answers?.[q.id]) }));

  let rows = responses;
  if (s.anonymous) {
    rows = [...responses];
    for (let i = rows.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  } else {
    rows.sort((a, b) => (a.submitted_at || 0) - (b.submitted_at || 0));
  }
  const safeTitle = s.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'survey';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="survey-${safeTitle}.csv"`);
  res.send('﻿' + toCsv(rows, columns));
}));

module.exports = { router, stateOf, participantHash, enpsOf, checkAnswers, aggregate, MIN_ANONYMOUS_RESPONSES };
