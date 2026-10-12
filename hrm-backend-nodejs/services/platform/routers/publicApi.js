/**
 * PL-7 Public API and webhooks.
 *
 * Admin:
 *   GET    /api-keys                     list (prefix, scopes, last_used_at — never the key)
 *   POST   /api-keys        { name, scopes[], expires_at? }  → { ..., key }  (shown once)
 *   DELETE /api-keys/:id                 revoke
 *   GET    /webhooks/config              { events, allow_private, signature }
 *   GET    /webhooks | POST | PUT /:id | DELETE /:id
 *   POST   /webhooks/:id/rotate-secret   → { secret } (shown once)
 *   POST   /webhooks/:id/ping            synchronous test delivery
 *   GET    /webhooks/:id/deliveries      delivery log
 *   POST   /webhooks/deliveries/:id/redeliver
 *
 * Public (X-API-Key header, read-only, paginated ?page=&limit=≤100):
 *   GET /public/employees    scope read:employees
 *   GET /public/leaves       scope read:leaves      ?status=&from=&to=
 *   GET /public/attendance   scope read:attendance  ?from=&to= (YYYY-MM-DD, max 92 days)
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { generateUUID } = require('../../../utils/helpers');
const { handle, validateQuery, sha256, safeEqual, randomToken, encryptSecret, stripId } = require('../common');
const { EVENT_CATALOG, EVENT_NAMES, EVENT_NAME_PATTERN, enqueue, attempt, ensureDeliveryIndexes, MAX_ATTEMPTS } = require('../delivery');
const { assertSafeUrl, UnsafeUrlError, allowPrivate } = require('../outbound');

const router = express.Router();
const publicRouter = express.Router();

const SCOPES = ['read:employees', 'read:leaves', 'read:attendance'];

// ============= API KEYS =============

let keyIndexes = false;
const ensureKeyIndexes = async (db) => {
  if (keyIndexes) return;
  keyIndexes = true;
  await Promise.all([
    db.collection('api_keys').createIndex({ id: 1 }, { unique: true }),
    db.collection('api_keys').createIndex({ prefix: 1 }, { unique: true })
  ]).catch(() => { keyIndexes = false; });
};

const publicKey = (k) => {
  const { key_hash, _id, ...rest } = k;
  return { ...rest, status: k.revoked_at ? 'revoked' : k.expires_at && new Date(k.expires_at) < new Date() ? 'expired' : 'active' };
};

const keySchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  scopes: Joi.array().items(Joi.string().valid(...SCOPES)).min(1).unique().required(),
  expires_at: Joi.date().greater('now').allow(null).default(null)
});

router.get('/api-keys', requireRole(['admin']), handle('list api keys', async (req, res) => {
  const keys = await getDB().collection('api_keys').find({}, { projection: { _id: 0, key_hash: 0 } }).sort({ created_at: -1 }).toArray();
  res.json({ scopes: SCOPES, keys: keys.map(publicKey) });
}));

router.post('/api-keys', requireRole(['admin']), validate(keySchema), handle('create api key', async (req, res) => {
  const db = getDB();
  await ensureKeyIndexes(db);
  const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8).toLowerCase();
  const key = `xhr_${prefix}_${randomToken(32)}`;
  const doc = {
    id: generateUUID(),
    name: req.validatedBody.name,
    prefix,
    display_prefix: `xhr_${prefix}_…`,
    key_hash: sha256(key),
    scopes: req.validatedBody.scopes,
    expires_at: req.validatedBody.expires_at,
    created_by: req.user.email,
    created_at: new Date(),
    last_used_at: null,
    revoked_at: null
  };
  await db.collection('api_keys').insertOne(doc);
  res.status(201).json({ ...publicKey(doc), key });
}));

router.delete('/api-keys/:id', requireRole(['admin']), handle('revoke api key', async (req, res) => {
  const db = getDB();
  const r = await db.collection('api_keys').findOneAndUpdate(
    { id: req.params.id, revoked_at: null },
    { $set: { revoked_at: new Date(), revoked_by: req.user.email } },
    { returnDocument: 'after', projection: { _id: 0, key_hash: 0 } }
  );
  const doc = r?.value !== undefined && r?.ok !== undefined ? r.value : r;
  if (!doc) return res.status(404).json({ detail: 'API key not found or already revoked' });
  res.json(publicKey(doc));
}));

// ============= PUBLIC API AUTH =============

const RATE_LIMIT = parseInt(process.env.PUBLIC_API_RATE_LIMIT || '120', 10); // requests per minute per key
const usage = new Map();

const apiKeyAuth = (scope) => async (req, res, next) => {
  try {
    const raw = req.get('X-API-Key') || '';
    const m = /^xhr_([a-z0-9]{8})_[A-Za-z0-9_-]{20,80}$/.exec(raw);
    if (!m) return res.status(401).json({ detail: 'Missing or invalid API key (send it in the X-API-Key header)' });
    const db = getDB();
    const doc = await db.collection('api_keys').findOne({ prefix: m[1] });
    if (!doc || !safeEqual(sha256(raw), doc.key_hash)) return res.status(401).json({ detail: 'Missing or invalid API key (send it in the X-API-Key header)' });
    if (doc.revoked_at) return res.status(401).json({ detail: 'This API key has been revoked' });
    if (doc.expires_at && new Date(doc.expires_at) < new Date()) return res.status(401).json({ detail: 'This API key has expired' });
    if (!doc.scopes?.includes(scope)) return res.status(403).json({ detail: `This API key is missing the ${scope} scope` });

    const now = Date.now();
    const u = usage.get(doc.id);
    if (!u || now - u.start > 60000) usage.set(doc.id, { start: now, count: 1 });
    else if (++u.count > RATE_LIMIT) {
      res.set('Retry-After', String(Math.ceil((u.start + 60000 - now) / 1000)));
      return res.status(429).json({ detail: 'Rate limit exceeded' });
    }

    req.apiKey = { id: doc.id, prefix: doc.prefix, name: doc.name };
    // Update last_used_at at most once a minute
    if (!doc.last_used_at || now - new Date(doc.last_used_at).getTime() > 60000) {
      db.collection('api_keys').updateOne({ id: doc.id }, { $set: { last_used_at: new Date() } }).catch(() => {});
    }
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) {
    console.error('[platform] api key auth:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

const pageSchema = {
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50)
};
const dateStr = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);

const paginate = async (col, filter, projection, sort, { page, limit }) => {
  const [data, total] = await Promise.all([
    col.find(filter, { projection: { _id: 0, ...projection } }).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter)
  ]);
  return { data, page, limit, total, has_more: page * limit < total };
};

const isoDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

publicRouter.get('/public/employees', apiKeyAuth('read:employees'), validateQuery(Joi.object({
  ...pageSchema,
  department: Joi.string().trim().max(100),
  include_exited: Joi.boolean().default(false)
})), handle('public employees', async (req, res) => {
  const q = req.validatedQuery;
  const filter = {};
  if (q.department) filter.department = q.department;
  if (!q.include_exited) filter.employment_status = { $ne: 'exited' };
  const out = await paginate(getDB().collection('employees'), filter,
    { employee_id: 1, full_name: 1, email: 1, department: 1, designation: 1, joining_date: 1, employment_status: 1, manager_email: 1 },
    { employee_id: 1 }, q);
  out.data = out.data.map(e => ({
    employee_id: e.employee_id || null,
    full_name: e.full_name,
    email: e.email,
    department: e.department || null,
    designation: e.designation || null,
    manager_email: e.manager_email || null,
    joining_date: isoDate(e.joining_date),
    employment_status: e.employment_status || 'active'
  }));
  res.json(out);
}));

publicRouter.get('/public/leaves', apiKeyAuth('read:leaves'), validateQuery(Joi.object({
  ...pageSchema,
  status: Joi.string().valid('pending', 'manager_approved', 'approved', 'rejected'),
  from: dateStr,
  to: dateStr
})), handle('public leaves', async (req, res) => {
  const q = req.validatedQuery;
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.from || q.to) {
    // dates are ISO strings; string comparison on the YYYY-MM-DD prefix works
    filter.dates = { $elemMatch: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: `${q.to}T23:59:59.999Z` } : {}) } };
  }
  const out = await paginate(getDB().collection('leaves'), filter,
    { id: 1, employee_email: 1, employee_name: 1, leave_type: 1, dates: 1, days_count: 1, is_half_day: 1, status: 1, created_at: 1 },
    { created_at: -1 }, q);
  out.data = out.data.map(l => {
    const dates = (Array.isArray(l.dates) ? l.dates : []).map(isoDate).filter(Boolean).sort();
    return {
      id: l.id,
      employee_email: l.employee_email,
      employee_name: l.employee_name,
      leave_type: l.leave_type,
      start_date: dates[0] || null,
      end_date: dates[dates.length - 1] || null,
      days: l.days_count,
      is_half_day: !!l.is_half_day,
      status: l.status
    };
  });
  res.json(out);
}));

publicRouter.get('/public/attendance', apiKeyAuth('read:attendance'), validateQuery(Joi.object({
  ...pageSchema,
  from: dateStr.required(),
  to: dateStr.required()
})), handle('public attendance', async (req, res) => {
  const q = req.validatedQuery;
  if (q.from > q.to) return res.status(400).json({ detail: "'from' must be on or before 'to'" });
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86400000 > 92) return res.status(400).json({ detail: 'Date range can be at most 92 days' });
  const out = await paginate(getDB().collection('attendance_logs'), { date: { $gte: q.from, $lte: q.to } },
    { employee_uid: 1, employee_name: 1, date: 1, status: 1, clock_in: 1, clock_out: 1, worked_minutes: 1, late_minutes: 1, overtime_minutes: 1, work_mode: 1 },
    { date: 1, employee_uid: 1 }, q);
  out.data = out.data.map(a => ({
    employee_id: a.employee_uid,
    employee_name: a.employee_name || null,
    date: a.date,
    status: a.status || null,
    clock_in: a.clock_in || null,
    clock_out: a.clock_out || null,
    worked_minutes: a.worked_minutes ?? null,
    late_minutes: a.late_minutes ?? null,
    overtime_minutes: a.overtime_minutes ?? null,
    work_mode: a.work_mode || null
  }));
  res.json(out);
}));

// ============= WEBHOOK ENDPOINTS =============

const publicEndpoint = (e) => {
  const { secret_enc, _id, ...rest } = e;
  return rest;
};

const eventList = Joi.array().items(Joi.alternatives().try(Joi.string().valid('*', ...EVENT_NAMES), Joi.string().pattern(EVENT_NAME_PATTERN).max(80))).min(1).max(50).unique();
const endpointSchema = Joi.object({
  url: Joi.string().trim().max(2048).required(),
  description: Joi.string().trim().max(200).allow('', null).default(null),
  events: eventList.required(),
  enabled: Joi.boolean().default(true)
});
const endpointUpdateSchema = Joi.object({
  url: Joi.string().trim().max(2048),
  description: Joi.string().trim().max(200).allow('', null),
  events: eventList,
  enabled: Joi.boolean()
}).min(1);

const checkUrl = (raw, res) => {
  try {
    return assertSafeUrl(raw).toString();
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      res.status(400).json({ detail: error.message, error_code: 'UNSAFE_URL' });
      return null;
    }
    throw error;
  }
};

const newSecret = () => `whsec_${randomToken(32)}`;

router.get('/webhooks/config', requireRole(['admin']), (req, res) => {
  res.json({
    events: EVENT_CATALOG,
    allow_private: allowPrivate(),
    max_attempts: MAX_ATTEMPTS,
    signature: {
      header: 'X-XenoHR-Signature',
      timestamp_header: 'X-XenoHR-Timestamp',
      scheme: 'sha256=HEX(HMAC_SHA256(secret, `${timestamp}.${raw_body}`))'
    }
  });
});

router.get('/webhooks', requireRole(['admin']), handle('list webhooks', async (req, res) => {
  const rows = await getDB().collection('webhook_endpoints').find({}, { projection: { _id: 0, secret_enc: 0 } }).sort({ created_at: -1 }).toArray();
  res.json(rows);
}));

router.post('/webhooks', requireRole(['admin']), validate(endpointSchema), handle('create webhook', async (req, res) => {
  const db = getDB();
  await ensureDeliveryIndexes(db);
  const body = req.validatedBody;
  const url = checkUrl(body.url, res);
  if (!url) return;
  const secret = newSecret();
  const now = new Date();
  const doc = {
    id: generateUUID(),
    url,
    description: body.description,
    events: body.events,
    enabled: body.enabled,
    secret_enc: encryptSecret(secret),
    secret_prefix: secret.slice(0, 10),
    created_by: req.user.email,
    created_at: now,
    updated_at: now
  };
  await db.collection('webhook_endpoints').insertOne(doc);
  res.status(201).json({ ...publicEndpoint(doc), secret });
}));

router.put('/webhooks/:id', requireRole(['admin']), validate(endpointUpdateSchema), handle('update webhook', async (req, res) => {
  const db = getDB();
  const ep = await db.collection('webhook_endpoints').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!ep) return res.status(404).json({ detail: 'Webhook not found' });
  const body = req.validatedBody;
  const set = { updated_at: new Date() };
  if (body.url !== undefined) {
    const url = checkUrl(body.url, res);
    if (!url) return;
    set.url = url;
  }
  for (const k of ['description', 'events', 'enabled']) if (body[k] !== undefined) set[k] = body[k];
  await db.collection('webhook_endpoints').updateOne({ id: ep.id }, { $set: set });
  res.json(publicEndpoint({ ...ep, ...set }));
}));

router.delete('/webhooks/:id', requireRole(['admin']), handle('delete webhook', async (req, res) => {
  const r = await getDB().collection('webhook_endpoints').deleteOne({ id: req.params.id });
  if (!r.deletedCount) return res.status(404).json({ detail: 'Webhook not found' });
  res.json({ deleted: true });
}));

router.post('/webhooks/:id/rotate-secret', requireRole(['admin']), handle('rotate webhook secret', async (req, res) => {
  const db = getDB();
  const secret = newSecret();
  const r = await db.collection('webhook_endpoints').updateOne(
    { id: req.params.id },
    { $set: { secret_enc: encryptSecret(secret), secret_prefix: secret.slice(0, 10), updated_at: new Date() } }
  );
  if (!r.matchedCount) return res.status(404).json({ detail: 'Webhook not found' });
  res.json({ secret, secret_prefix: secret.slice(0, 10) });
}));

router.post('/webhooks/:id/ping', requireRole(['admin']), handle('ping webhook', async (req, res) => {
  const db = getDB();
  const ep = await db.collection('webhook_endpoints').findOne({ id: req.params.id });
  if (!ep) return res.status(404).json({ detail: 'Webhook not found' });
  const delivery = await enqueue(db, 'webhook', ep, 'ping', { message: 'Ping from Xeno-HR', sent_by: req.user.email }, { wait: true, allowRetry: false });
  res.json(stripId(delivery));
}));

router.get('/webhooks/:id/deliveries', requireRole(['admin']), validateQuery(Joi.object({ limit: Joi.number().integer().min(1).max(200).default(50) })), handle('webhook deliveries', async (req, res) => {
  const rows = await getDB().collection('webhook_deliveries')
    .find({ target_type: 'webhook', target_id: req.params.id }, { projection: { _id: 0 } })
    .sort({ created_at: -1 }).limit(req.validatedQuery.limit).toArray();
  res.json(rows);
}));

router.post('/webhooks/deliveries/:id/redeliver', requireRole(['admin']), handle('redeliver', async (req, res) => {
  const db = getDB();
  const old = await db.collection('webhook_deliveries').findOne({ id: req.params.id, target_type: 'webhook' });
  if (!old) return res.status(404).json({ detail: 'Delivery not found' });
  const ep = await db.collection('webhook_endpoints').findOne({ id: old.target_id });
  if (!ep) return res.status(404).json({ detail: 'Webhook no longer exists' });
  const delivery = await enqueue(db, 'webhook', ep, old.event, old.payload?.data, { eventId: old.event_id, wait: true, allowRetry: false });
  res.json(stripId(delivery));
}));

module.exports = { router, publicRouter, SCOPES, attempt };
