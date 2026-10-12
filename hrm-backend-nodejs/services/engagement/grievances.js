/**
 * EN-5c Grievances.
 *
 * Collection `grievances`:
 *   { id, tracking_code, category, subject, description, anonymous,
 *     reporter_email|null, reporter_name|null, reporter_department|null,
 *     status: 'open'|'investigating'|'resolved'|'closed',
 *     response (visible to the reporter), response_at,
 *     notes: [{ id, text, author_name, created_at }] (confidential, admins only),
 *     history: [{ status, at }], created_at, updated_at }
 *
 * Anonymous grievances store no reporter details. The reporter gets a random
 * tracking code and checks status with it via the public POST /grievances/track
 * endpoint (no login, nothing about the caller is recorded).
 * Only admins can list or read grievances.
 */

const express = require('express');
const crypto = require('crypto');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { emitEvent } = require('../events');
const { handle, validateQuery, getViewer, adminRecipients, notifyPeople } = require('./common');

const router = express.Router();
const publicRouter = express.Router();
const admin = requireRole(['admin']);

const CATEGORIES = ['harassment', 'discrimination', 'workplace_safety', 'compensation', 'workload', 'manager_conduct', 'policy_violation', 'other'];
const STATUSES = ['open', 'investigating', 'resolved', 'closed'];
const TRANSITIONS = {
  open: ['investigating', 'closed'],
  investigating: ['resolved', 'closed'],
  resolved: ['closed', 'investigating'],
  closed: ['investigating']
};
const STATUS_LABELS = { open: 'Open', investigating: 'Under investigation', resolved: 'Resolved', closed: 'Closed' };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newTrackingCode = () => {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `GRV-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
};
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/\s+/g, '').trim();

const createSchema = Joi.object({
  category: Joi.string().valid(...CATEGORIES).required(),
  subject: Joi.string().trim().min(3).max(200).required(),
  description: Joi.string().trim().min(10).max(10000).required(),
  anonymous: Joi.boolean().default(false)
});

const updateSchema = Joi.object({
  status: Joi.string().valid(...STATUSES),
  response: Joi.string().trim().max(5000).allow('')
}).min(1);

const noteSchema = Joi.object({ text: Joi.string().trim().min(1).max(5000).required() });
const trackSchema = Joi.object({ tracking_code: Joi.string().trim().min(6).max(40).required() });

/** What the reporter (or anyone holding the tracking code) may see. */
const reporterView = (g) => ({
  id: g.id,
  tracking_code: g.tracking_code,
  category: g.category,
  subject: g.subject,
  anonymous: g.anonymous,
  status: g.status,
  status_label: STATUS_LABELS[g.status],
  response: g.response || null,
  response_at: g.response_at || null,
  history: (g.history || []).map(h => ({ status: h.status, at: h.at })),
  created_at: g.created_at,
  updated_at: g.updated_at
});

// ============= PUBLIC =============

/**
 * POST /grievances/track { tracking_code } — status lookup without logging in.
 */
publicRouter.post('/grievances/track', validate(trackSchema), handle('Track grievance', async (req, res) => {
  const db = getDB();
  const g = await db.collection('grievances').findOne({ tracking_code: normalizeCode(req.validatedBody.tracking_code) });
  if (!g) return res.status(404).json({ detail: 'No grievance found for this tracking code' });
  res.json(reporterView(g));
}));

// ============= EMPLOYEE =============

router.get('/meta', (req, res) => res.json({ categories: CATEGORIES, statuses: STATUSES, transitions: TRANSITIONS }));

/**
 * POST /grievances — file a grievance (optionally anonymous). Returns the tracking code.
 */
router.post('/', validate(createSchema), handle('Create grievance', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const viewer = data.anonymous ? null : await getViewer(db, req.user);
  const now = new Date();
  const grievance = {
    id: generateUUID(),
    tracking_code: newTrackingCode(),
    category: data.category,
    subject: data.subject,
    description: data.description,
    anonymous: data.anonymous,
    reporter_email: viewer ? viewer.email : null,
    reporter_name: viewer ? viewer.name : null,
    reporter_department: viewer ? viewer.department : null,
    status: 'open',
    response: null,
    response_at: null,
    notes: [],
    history: [{ status: 'open', at: now }],
    created_at: now,
    updated_at: now
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await db.collection('grievances').insertOne(grievance);
      break;
    } catch (error) {
      if (error.code === 11000 && attempt < 3) {
        grievance.tracking_code = newTrackingCode();
        delete grievance._id;
        continue;
      }
      throw error;
    }
  }
  adminRecipients(db)
    .then(admins => notifyPeople(admins, {
      type: 'grievance_submitted',
      title: 'New grievance filed',
      message: `${data.anonymous ? 'Anonymous' : 'A'} grievance in "${data.category.replace(/_/g, ' ')}" needs attention.`,
      actionUrl: '/engagement/grievances',
      metadata: { grievance_id: grievance.id }
    }, { exclude: viewer ? [viewer.email] : [] }))
    .catch(err => console.error('[engagement] grievance notify:', err.message));
  emitEvent('grievance.filed', { id: grievance.id, category: grievance.category, anonymous: grievance.anonymous });
  res.status(201).json({ ...reporterView(grievance), description: grievance.description });
}));

/**
 * GET /grievances/mine — my non-anonymous grievances (no confidential notes).
 */
router.get('/mine', handle('My grievances', async (req, res) => {
  const db = getDB();
  const items = await db.collection('grievances')
    .find({ reporter_email: req.user.email, anonymous: false })
    .sort({ created_at: -1 })
    .toArray();
  res.json(items.map(g => ({ ...reporterView(g), description: g.description })));
}));

// ============= ADMIN =============

router.get('/', admin, validateQuery(Joi.object({
  status: Joi.string().valid(...STATUSES),
  category: Joi.string().valid(...CATEGORIES)
})), handle('List grievances', async (req, res) => {
  const db = getDB();
  const filter = {};
  if (req.validatedQuery.status) filter.status = req.validatedQuery.status;
  if (req.validatedQuery.category) filter.category = req.validatedQuery.category;
  const items = await db.collection('grievances')
    .find(filter, { projection: { _id: 0, notes: 0 } })
    .sort({ created_at: -1 })
    .toArray();
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  (await db.collection('grievances').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray())
    .forEach(c => { counts[c._id] = c.n; });
  res.json({ grievances: items, counts });
}));

router.get('/:id', admin, handle('Get grievance', async (req, res) => {
  const db = getDB();
  const g = await db.collection('grievances').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!g) return res.status(404).json({ detail: 'Grievance not found' });
  res.json({ ...g, allowed_transitions: TRANSITIONS[g.status] });
}));

/**
 * PATCH /grievances/:id (admin) { status?, response? }
 */
router.patch('/:id', admin, validate(updateSchema), handle('Update grievance', async (req, res) => {
  const db = getDB();
  const g = await db.collection('grievances').findOne({ id: req.params.id });
  if (!g) return res.status(404).json({ detail: 'Grievance not found' });
  const data = req.validatedBody;
  const now = new Date();
  const set = { updated_at: now };
  const update = { $set: set };
  if (data.status && data.status !== g.status) {
    if (!TRANSITIONS[g.status].includes(data.status)) {
      return res.status(400).json({ detail: `Cannot move a grievance from ${STATUS_LABELS[g.status].toLowerCase()} to ${STATUS_LABELS[data.status].toLowerCase()}` });
    }
    set.status = data.status;
    update.$push = { history: { status: data.status, at: now, by_name: req.user.full_name } };
  }
  if (data.response !== undefined) {
    set.response = data.response || null;
    set.response_at = data.response ? now : null;
  }
  await db.collection('grievances').updateOne({ id: g.id }, update);
  const updated = await db.collection('grievances').findOne({ id: g.id }, { projection: { _id: 0 } });
  if (g.reporter_email && (updated.status !== g.status || updated.response !== g.response)) {
    const reporter = await db.collection('users').findOne({ email: g.reporter_email }, { projection: { id: 1 } });
    notifyPeople([{ id: reporter?.id, email: g.reporter_email }], {
      type: 'grievance_updated',
      title: `Grievance ${g.tracking_code}: ${STATUS_LABELS[updated.status]}`,
      message: updated.response && updated.response !== g.response ? updated.response.slice(0, 160) : `Status: ${STATUS_LABELS[updated.status]}`,
      actionUrl: '/engagement/grievances',
      metadata: { grievance_id: g.id, status: updated.status }
    }).catch(() => {});
  }
  if (updated.status !== g.status) emitEvent('grievance.status_changed', { id: g.id, status: updated.status });
  res.json({ ...updated, allowed_transitions: TRANSITIONS[updated.status] });
}));

/**
 * POST /grievances/:id/notes (admin) — confidential investigation note.
 */
router.post('/:id/notes', admin, validate(noteSchema), handle('Add grievance note', async (req, res) => {
  const db = getDB();
  const note = { id: generateUUID(), text: req.validatedBody.text, author_name: req.user.full_name, author_email: req.user.email, created_at: new Date() };
  const { matchedCount } = await db.collection('grievances').updateOne(
    { id: req.params.id },
    { $push: { notes: note }, $set: { updated_at: new Date() } }
  );
  if (!matchedCount) return res.status(404).json({ detail: 'Grievance not found' });
  res.status(201).json(note);
}));

module.exports = { router, publicRouter, CATEGORIES, STATUSES, TRANSITIONS };
