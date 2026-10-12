/**
 * EN-3 Policy acknowledgement.
 *
 * Collection `policy_documents` (shared contract):
 *   { id, title, category, body, file_url, file_key, file_name, version, published_at,
 *     requires_ack, due_date, audience, history: [{ version, published_at, body, file_url, file_name, change_note }],
 *     created_by, created_at, updated_at, last_reminded_at }
 * Collection `policy_acknowledgements`:
 *   { id, policy_id, version, user_email, employee_id, employee_name, department, acknowledged_at }
 *
 * Publishing a new version bumps `version`; acknowledgements only count for the
 * current version, so everyone has to acknowledge again.
 */

const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { storeFile, removeFile } = require('../fileStorage');
const { emitEvent } = require('../events');
const {
  handle, validateQuery, getViewer, audienceSchema, audienceObject, normalizeAudience, inAudience,
  audienceFilter, audienceMembers, notifyPeople, teamQuery, todayLocal
} = require('./common');

const router = express.Router();
const admin = requireRole(['admin']);

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname || '');
    if (!ok) {
      const err = new Error('Only PDF files are allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

/** Accept multipart (with an optional PDF) or JSON; JSON-encoded fields in multipart are parsed. */
const acceptUpload = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : (err.status || 400)).json({ detail: tooBig ? 'File is larger than 10 MB' : err.message });
    }
    for (const field of ['audience']) {
      if (typeof req.body[field] === 'string') {
        try { req.body[field] = JSON.parse(req.body[field]); } catch {
          return res.status(422).json({ detail: 'Validation failed', errors: [{ field, message: `"${field}" must be JSON` }] });
        }
      }
    }
    for (const field of ['due_date', 'body', 'change_note', 'category']) {
      if (req.body[field] === '' || req.body[field] === 'null') req.body[field] = field === 'body' ? '' : null;
    }
    next();
  });
};

const baseFields = {
  title: Joi.string().trim().min(1).max(200),
  category: Joi.string().trim().max(80).allow(null, ''),
  body: Joi.string().trim().max(100000).allow(''),
  requires_ack: Joi.boolean(),
  due_date: Joi.date().iso().allow(null),
  audience: audienceObject
};

const createSchema = Joi.object({
  ...baseFields,
  title: baseFields.title.required(),
  body: baseFields.body.default(''),
  requires_ack: baseFields.requires_ack.default(true),
  due_date: baseFields.due_date.default(null),
  audience: audienceSchema
});

const updateSchema = Joi.object({ ...baseFields }).min(1);

const versionSchema = Joi.object({
  body: Joi.string().trim().max(100000).allow(''),
  change_note: Joi.string().trim().max(500).allow(null, ''),
  due_date: Joi.date().iso().allow(null),
  keep_file: Joi.boolean().default(true)
});

const ackSchema = Joi.object({ version: Joi.number().integer().min(1) });

const PROJECTION = { _id: 0, file_key: 0 };

const stripHistory = (p) => {
  const { history: _h, last_reminded_at: _r, ...rest } = p;
  return rest;
};

/** Required acknowledgers: active employees in the audience. */
const requiredPeople = async (db, policy) =>
  policy.requires_ack ? audienceMembers(db, policy.audience, { includeUsersWithoutEmployee: false }) : [];

/** Ack status for a policy's current version. */
const ackStatus = async (db, policy, peopleFilter = null) => {
  let people = await requiredPeople(db, policy);
  if (peopleFilter) people = people.filter(peopleFilter);
  const acks = await db.collection('policy_acknowledgements')
    .find({ policy_id: policy.id, version: policy.version }, { projection: { _id: 0 } })
    .toArray();
  const ackMap = new Map(acks.map(a => [a.user_email, a]));
  const acknowledged = [];
  const pending = [];
  for (const p of people) {
    const ack = ackMap.get(p.email);
    const row = { employee_id: p.id, employee_code: p.employee_id || null, full_name: p.full_name, email: p.email, department: p.department || null };
    if (ack) acknowledged.push({ ...row, acknowledged_at: ack.acknowledged_at, version: ack.version });
    else pending.push(row);
  }
  return {
    total: people.length,
    acknowledged_count: acknowledged.length,
    pending_count: pending.length,
    percent: people.length ? Math.round((acknowledged.length / people.length) * 1000) / 10 : 0,
    acknowledged,
    pending
  };
};

const isOverdue = (policy) => !!policy.due_date && policy.due_date.toISOString().slice(0, 10) < todayLocal();

const notifyNewPolicy = async (db, policy, isNewVersion) => {
  const members = await audienceMembers(db, policy.audience);
  return notifyPeople(members, {
    type: 'policy_published',
    title: isNewVersion ? `Policy updated: ${policy.title} (v${policy.version})` : `New policy: ${policy.title}`,
    message: policy.requires_ack
      ? `Please read and acknowledge${policy.due_date ? ` by ${policy.due_date.toISOString().slice(0, 10)}` : ''}.`
      : 'A new policy document has been published.',
    actionUrl: '/engagement/policies',
    metadata: { policy_id: policy.id, version: policy.version }
  }, { exclude: [policy.created_by] });
};

/** Notify pending acknowledgers of a policy; returns how many were notified. */
const remindPending = async (db, policy, { overdue = false } = {}) => {
  const status = await ackStatus(db, policy);
  if (!status.pending.length) return 0;
  const count = await notifyPeople(status.pending.map(p => ({ id: p.employee_id, email: p.email })), {
    type: 'policy_ack_reminder',
    title: overdue ? `Overdue: please acknowledge "${policy.title}"` : `Reminder: please acknowledge "${policy.title}"`,
    message: policy.due_date
      ? `Acknowledgement ${overdue ? 'was due' : 'is due'} on ${policy.due_date.toISOString().slice(0, 10)}.`
      : 'Please read the policy and confirm you agree.',
    actionUrl: '/engagement/policies',
    metadata: { policy_id: policy.id, version: policy.version }
  });
  await db.collection('policy_documents').updateOne({ id: policy.id }, { $set: { last_reminded_at: new Date() } });
  return count;
};

/** Daily job: remind everyone who has not acknowledged a policy past its due date. */
const runPolicyReminderJob = async (db) => {
  const today = todayLocal();
  const policies = await db.collection('policy_documents').find({ requires_ack: true, due_date: { $ne: null } }).toArray();
  let reminded = 0;
  let overduePolicies = 0;
  for (const p of policies) {
    if (p.due_date.toISOString().slice(0, 10) >= today) continue;
    overduePolicies += 1;
    reminded += await remindPending(db, p, { overdue: true });
  }
  return { overdue_policies: overduePolicies, reminded };
};

const fileFields = async (file, ownerId) => {
  if (!file) return null;
  const stored = await storeFile(file.buffer, file.originalname, file.mimetype, 'policies', ownerId);
  return { file_url: stored.url, file_key: stored.key, file_name: file.originalname, file_size: file.size };
};

// ============= EMPLOYEE VIEW =============

/**
 * GET /policies
 * Employees: policies for their audience with their acknowledgement status.
 * Admins: every policy with acknowledgement stats.
 */
router.get('/', validateQuery(Joi.object({ pending: Joi.boolean() })), handle('List policies', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const filter = viewer.isAdmin ? {} : audienceFilter(viewer);
  const policies = await db.collection('policy_documents')
    .find(filter, { projection: { ...PROJECTION, body: 0, history: 0, last_reminded_at: 0 } })
    .sort({ published_at: -1 })
    .toArray();

  const myAcks = await db.collection('policy_acknowledgements')
    .find({ user_email: viewer.email, policy_id: { $in: policies.map(p => p.id) } }, { projection: { _id: 0 } })
    .toArray();
  const ackByPolicy = new Map();
  for (const a of myAcks) {
    const prev = ackByPolicy.get(a.policy_id);
    if (!prev || a.version > prev.version) ackByPolicy.set(a.policy_id, a);
  }

  const result = [];
  for (const p of policies) {
    const ack = ackByPolicy.get(p.id);
    const myRequired = p.requires_ack && !!viewer.employee && inAudience(p.audience, viewer);
    const acknowledged = !!ack && ack.version === p.version;
    const row = {
      ...p,
      overdue: isOverdue(p),
      my_ack: {
        required: myRequired,
        acknowledged,
        acknowledged_at: acknowledged ? ack.acknowledged_at : null,
        acknowledged_version: ack?.version || null,
        pending: myRequired && !acknowledged
      }
    };
    if (viewer.isAdmin) {
      const s = await ackStatus(db, p);
      row.stats = { total: s.total, acknowledged: s.acknowledged_count, pending: s.pending_count, percent: s.percent };
    }
    if (req.validatedQuery.pending && !row.my_ack.pending) continue;
    result.push(row);
  }
  res.json(result);
}));

/**
 * GET /policies/:id — full policy (body, file, version history for admins).
 */
router.get('/:id', handle('Get policy', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const p = await db.collection('policy_documents').findOne({ id: req.params.id }, { projection: PROJECTION });
  if (!p || !inAudience(p.audience, viewer, { adminSeesAll: true })) {
    return res.status(404).json({ detail: 'Policy not found' });
  }
  const ack = await db.collection('policy_acknowledgements').findOne(
    { policy_id: p.id, version: p.version, user_email: viewer.email },
    { projection: { _id: 0 } }
  );
  const out = viewer.isAdmin
    ? { ...p, history: (p.history || []).map(({ file_key: _k, ...h }) => h) }
    : stripHistory(p);
  out.overdue = isOverdue(p);
  out.my_ack = {
    required: p.requires_ack && !!viewer.employee && inAudience(p.audience, viewer),
    acknowledged: !!ack,
    acknowledged_at: ack?.acknowledged_at || null
  };
  res.json(out);
}));

/**
 * POST /policies/:id/acknowledge { version? } — "I have read and agree".
 */
router.post('/:id/acknowledge', validate(ackSchema), handle('Acknowledge policy', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const p = await db.collection('policy_documents').findOne({ id: req.params.id });
  if (!p || !inAudience(p.audience, viewer)) return res.status(404).json({ detail: 'Policy not found' });
  if (!p.requires_ack) return res.status(400).json({ detail: 'This policy does not require acknowledgement' });
  if (!viewer.employee) return res.status(400).json({ detail: 'Only employees can acknowledge policies' });
  const { version } = req.validatedBody;
  if (version && version !== p.version) {
    return res.status(409).json({ detail: `A newer version (v${p.version}) has been published. Please read it before acknowledging.`, current_version: p.version });
  }
  const ack = {
    id: generateUUID(),
    policy_id: p.id,
    version: p.version,
    user_email: viewer.email,
    employee_id: viewer.employee.id,
    employee_name: viewer.name,
    department: viewer.department,
    acknowledged_at: new Date()
  };
  const result = await db.collection('policy_acknowledgements').updateOne(
    { policy_id: p.id, version: p.version, user_email: viewer.email },
    { $setOnInsert: ack },
    { upsert: true }
  );
  const saved = await db.collection('policy_acknowledgements').findOne(
    { policy_id: p.id, version: p.version, user_email: viewer.email },
    { projection: { _id: 0 } }
  );
  if (result.upsertedCount) emitEvent('policy.acknowledged', { policy_id: p.id, version: p.version, employee_id: viewer.employee.id });
  res.status(result.upsertedCount ? 201 : 200).json(saved);
}));

// ============= ADMIN / MANAGER TRACKING =============

/**
 * GET /policies/:id/acknowledgements — acknowledgement % with pending list.
 * Admins see everyone; managers see their team only.
 */
router.get('/:id/acknowledgements', requireRole(['admin', 'manager']), handle('Policy acknowledgements', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const p = await db.collection('policy_documents').findOne({ id: req.params.id }, { projection: PROJECTION });
  if (!p) return res.status(404).json({ detail: 'Policy not found' });
  let filter = null;
  if (!viewer.isAdmin) {
    if (!viewer.employee) return res.status(403).json({ detail: 'Not enough permissions' });
    const team = await db.collection('employees').find(teamQuery(viewer.employee), { projection: { email: 1 } }).toArray();
    const emails = new Set(team.map(t => t.email));
    filter = (person) => emails.has(person.email);
  }
  const status = await ackStatus(db, p, filter);
  res.json({
    policy: { id: p.id, title: p.title, version: p.version, requires_ack: p.requires_ack, due_date: p.due_date, overdue: isOverdue(p) },
    scope: viewer.isAdmin ? 'company' : 'team',
    ...status
  });
}));

/**
 * POST /policies/:id/remind — notify everyone who has not acknowledged (admin).
 */
router.post('/:id/remind', admin, handle('Remind policy', async (req, res) => {
  const db = getDB();
  const p = await db.collection('policy_documents').findOne({ id: req.params.id });
  if (!p) return res.status(404).json({ detail: 'Policy not found' });
  if (!p.requires_ack) return res.status(400).json({ detail: 'This policy does not require acknowledgement' });
  const reminded = await remindPending(db, p, { overdue: isOverdue(p) });
  res.json({ message: reminded ? `Reminded ${reminded} employee(s)` : 'Everyone has acknowledged', reminded });
}));

/**
 * POST /policies (admin) — JSON or multipart with an optional PDF `file`.
 */
router.post('/', admin, acceptUpload, validate(createSchema), handle('Create policy', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  if (!data.body && !req.file) return res.status(400).json({ detail: 'Add the policy text or upload a PDF' });
  const id = generateUUID();
  const now = new Date();
  const file = await fileFields(req.file, id);
  const policy = {
    id,
    title: data.title,
    category: data.category || null,
    body: data.body || '',
    file_url: file?.file_url || null,
    file_key: file?.file_key || null,
    file_name: file?.file_name || null,
    version: 1,
    published_at: now,
    requires_ack: data.requires_ack,
    due_date: data.due_date || null,
    audience: normalizeAudience(data.audience),
    history: [],
    created_by: req.user.email,
    created_by_name: req.user.full_name,
    created_at: now,
    updated_at: now
  };
  await db.collection('policy_documents').insertOne(policy);
  notifyNewPolicy(db, policy, false).catch(err => console.error('[engagement] policy notify:', err.message));
  emitEvent('policy.published', { id: policy.id, title: policy.title, version: 1 });
  const p = await db.collection('policy_documents').findOne({ id }, { projection: PROJECTION });
  res.status(201).json(p);
}));

/**
 * PUT /policies/:id (admin) — edit details without a new version.
 */
router.put('/:id', admin, acceptUpload, validate(updateSchema), handle('Update policy', async (req, res) => {
  const db = getDB();
  const p = await db.collection('policy_documents').findOne({ id: req.params.id });
  if (!p) return res.status(404).json({ detail: 'Policy not found' });
  if (req.file) return res.status(400).json({ detail: 'Publish a new version to replace the document' });
  const data = req.validatedBody;
  const updates = { updated_at: new Date() };
  for (const f of ['title', 'requires_ack']) if (data[f] !== undefined) updates[f] = data[f];
  if (data.category !== undefined) updates.category = data.category || null;
  if (data.due_date !== undefined) updates.due_date = data.due_date || null;
  if (data.audience !== undefined) updates.audience = normalizeAudience(data.audience);
  if (data.body !== undefined) {
    if (data.body !== p.body) return res.status(400).json({ detail: 'Publish a new version to change the policy text' });
  }
  await db.collection('policy_documents').updateOne({ id: p.id }, { $set: updates });
  res.json(await db.collection('policy_documents').findOne({ id: p.id }, { projection: PROJECTION }));
}));

/**
 * POST /policies/:id/versions (admin) — publish a new version (new text and/or PDF).
 * Resets acknowledgements: everyone must acknowledge the new version.
 */
router.post('/:id/versions', admin, acceptUpload, validate(versionSchema), handle('New policy version', async (req, res) => {
  const db = getDB();
  const p = await db.collection('policy_documents').findOne({ id: req.params.id });
  if (!p) return res.status(404).json({ detail: 'Policy not found' });
  const data = req.validatedBody;
  const body = data.body !== undefined ? data.body : p.body;
  const keepFile = data.keep_file && !req.file;
  if (!body && !req.file && !(keepFile && p.file_url)) {
    return res.status(400).json({ detail: 'Add the policy text or upload a PDF' });
  }
  const file = await fileFields(req.file, p.id);
  const now = new Date();
  const historyEntry = {
    version: p.version,
    published_at: p.published_at,
    body: p.body,
    file_url: p.file_url,
    file_key: p.file_key,
    file_name: p.file_name,
    change_note: p.change_note || null
  };
  const updates = {
    version: p.version + 1,
    published_at: now,
    body,
    change_note: data.change_note || null,
    file_url: file ? file.file_url : (keepFile ? p.file_url : null),
    file_key: file ? file.file_key : (keepFile ? p.file_key : null),
    file_name: file ? file.file_name : (keepFile ? p.file_name : null),
    updated_at: now
  };
  if (data.due_date !== undefined) updates.due_date = data.due_date || null;
  await db.collection('policy_documents').updateOne({ id: p.id }, { $set: updates, $push: { history: historyEntry } });
  const updated = await db.collection('policy_documents').findOne({ id: p.id });
  notifyNewPolicy(db, updated, true).catch(err => console.error('[engagement] policy notify:', err.message));
  emitEvent('policy.published', { id: p.id, title: updated.title, version: updated.version });
  const { file_key: _k, _id: _i, ...out } = updated;
  out.history = (out.history || []).map(({ file_key: _fk, ...h }) => h);
  res.status(201).json(out);
}));

/**
 * DELETE /policies/:id (admin) — removes the policy, its files and acknowledgements.
 */
router.delete('/:id', admin, handle('Delete policy', async (req, res) => {
  const db = getDB();
  const p = await db.collection('policy_documents').findOne({ id: req.params.id });
  if (!p) return res.status(404).json({ detail: 'Policy not found' });
  await db.collection('policy_documents').deleteOne({ id: p.id });
  await db.collection('policy_acknowledgements').deleteMany({ policy_id: p.id });
  const keys = new Set([p.file_key, ...(p.history || []).map(h => h.file_key)].filter(Boolean));
  for (const key of keys) removeFile(key);
  res.json({ message: 'Policy deleted' });
}));

module.exports = { router, runPolicyReminderJob, ackStatus };
