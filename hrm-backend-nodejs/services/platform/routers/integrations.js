/**
 * PL-6 Integrations.
 *
 * Chat (permission integrations.manage):
 *   GET    /events                         event catalog
 *   POST   /events/test       { event }    emit a sample event through services/events.js
 *   GET    /integrations/targets
 *   POST   /integrations/targets           { type: slack|teams, name, url, events[] }
 *   PUT    /integrations/targets/:id       { name?, url?, events?, enabled? }
 *   DELETE /integrations/targets/:id
 *   POST   /integrations/targets/:id/test  send a test message (waits for the result)
 *   GET    /integrations/targets/:id/deliveries
 *
 * Calendar (every user):
 *   GET    /calendar/feed                  { active, created_at, token_prefix, last_accessed_at }
 *   POST   /calendar/feed                  create / regenerate → { url, webcal_url } (shown once)
 *   DELETE /calendar/feed
 *   (public) GET /calendar/:token.ics      — see publicRouter
 *
 * Accounting (permission payroll.view):
 *   GET /accounting/summary?month=YYYY-MM
 *   GET /accounting/tally?month=YYYY-MM    Tally XML (Journal voucher)
 *   GET /accounting/zoho?month=YYYY-MM     Zoho Books journal CSV
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { validate } = require('../../../middleware/roleCheck');
const { generateUUID } = require('../../../utils/helpers');
const { emitEvent } = require('../../events');
const { requirePermission } = require('../permissions');
const { handle, validateQuery, encryptSecret, decryptSecret, sha256, randomToken, stripId } = require('../common');
const { EVENT_CATALOG, EVENT_NAMES, EVENT_NAME_PATTERN, enqueue, ensureDeliveryIndexes } = require('../delivery');
const { assertSafeUrl, UnsafeUrlError, allowPrivate } = require('../outbound');
const { buildFeed } = require('../calendar');
const { buildJournal, toTallyXml, toZohoCsv } = require('../accounting');

const router = express.Router();
const publicRouter = express.Router();

const eventList = Joi.array().items(Joi.alternatives().try(Joi.string().valid('*', ...EVENT_NAMES), Joi.string().pattern(EVENT_NAME_PATTERN).max(80))).min(1).max(50).unique();

// ============= EVENTS =============

router.get('/events', requirePermission('integrations.manage'), (req, res) => {
  res.json({ events: EVENT_CATALOG });
});

const testEventSchema = Joi.object({ event: Joi.string().valid(...EVENT_NAMES).required() });

router.post('/events/test', requirePermission('integrations.manage'), validate(testEventSchema), handle('emit test event', async (req, res) => {
  const { event } = req.validatedBody;
  emitEvent(event, {
    test: true,
    message: `This is a test "${event}" event sent by ${req.user.full_name || req.user.email}.`,
    sent_by: req.user.email
  });
  res.status(202).json({ emitted: event });
}));

// ============= CHAT TARGETS (Slack / Teams) =============

/** Hosts accepted for each chat type (skipped when ALLOW_PRIVATE_WEBHOOKS=true, for local testing). */
const CHAT_HOSTS = {
  slack: (h) => h === 'hooks.slack.com' || h === 'hooks.slack-gov.com',
  teams: (h) => /\.webhook\.office\.com$/.test(h) || /\.logic\.azure\.com$/.test(h) || /\.powerplatform\.com$/.test(h) || h === 'outlook.office.com'
};

function validateChatUrl(type, raw) {
  const url = assertSafeUrl(raw);
  if (!allowPrivate() && !CHAT_HOSTS[type](url.hostname.toLowerCase())) {
    throw new UnsafeUrlError(type === 'slack'
      ? 'Enter a Slack incoming-webhook URL (https://hooks.slack.com/services/…)'
      : 'Enter a Microsoft Teams incoming-webhook / workflow URL');
  }
  return url.toString();
}

const urlHint = (raw) => {
  try {
    const u = new URL(raw);
    const tail = u.pathname.slice(-4);
    return `${u.protocol}//${u.host}/…${tail}`;
  } catch {
    return '…';
  }
};

const publicTarget = (t) => {
  const { url_enc, _id, ...rest } = t; // never return the webhook URL itself
  return rest;
};

const targetSchema = Joi.object({
  type: Joi.string().valid('slack', 'teams').required(),
  name: Joi.string().trim().min(1).max(80).required(),
  url: Joi.string().trim().max(2048).required(),
  events: eventList.required(),
  enabled: Joi.boolean().default(true)
});
const targetUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80),
  url: Joi.string().trim().max(2048),
  events: eventList,
  enabled: Joi.boolean()
}).min(1);

router.get('/integrations/targets', requirePermission('integrations.manage'), handle('list targets', async (req, res) => {
  const db = getDB();
  const targets = await db.collection('integration_targets').find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
  res.json(targets.map(publicTarget));
}));

router.post('/integrations/targets', requirePermission('integrations.manage'), validate(targetSchema), handle('create target', async (req, res) => {
  const db = getDB();
  await ensureDeliveryIndexes(db);
  const body = req.validatedBody;
  let url;
  try {
    url = validateChatUrl(body.type, body.url);
  } catch (error) {
    if (error instanceof UnsafeUrlError) return res.status(400).json({ detail: error.message });
    throw error;
  }
  const now = new Date();
  const target = {
    id: generateUUID(),
    type: body.type,
    name: body.name,
    url_enc: encryptSecret(url),
    url_hint: urlHint(url),
    events: body.events,
    enabled: body.enabled,
    created_by: req.user.email,
    created_at: now,
    updated_at: now
  };
  await db.collection('integration_targets').insertOne(target);
  res.status(201).json(publicTarget(target));
}));

router.put('/integrations/targets/:id', requirePermission('integrations.manage'), validate(targetUpdateSchema), handle('update target', async (req, res) => {
  const db = getDB();
  const target = await db.collection('integration_targets').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!target) return res.status(404).json({ detail: 'Integration not found' });
  const body = req.validatedBody;
  const set = { updated_at: new Date() };
  if (body.name !== undefined) set.name = body.name;
  if (body.events !== undefined) set.events = body.events;
  if (body.enabled !== undefined) set.enabled = body.enabled;
  if (body.url !== undefined) {
    try {
      const url = validateChatUrl(target.type, body.url);
      set.url_enc = encryptSecret(url);
      set.url_hint = urlHint(url);
    } catch (error) {
      if (error instanceof UnsafeUrlError) return res.status(400).json({ detail: error.message });
      throw error;
    }
  }
  await db.collection('integration_targets').updateOne({ id: target.id }, { $set: set });
  res.json(publicTarget({ ...target, ...set }));
}));

router.delete('/integrations/targets/:id', requirePermission('integrations.manage'), handle('delete target', async (req, res) => {
  const db = getDB();
  const r = await db.collection('integration_targets').deleteOne({ id: req.params.id });
  if (!r.deletedCount) return res.status(404).json({ detail: 'Integration not found' });
  res.json({ deleted: true });
}));

router.post('/integrations/targets/:id/test', requirePermission('integrations.manage'), handle('test target', async (req, res) => {
  const db = getDB();
  const target = await db.collection('integration_targets').findOne({ id: req.params.id });
  if (!target) return res.status(404).json({ detail: 'Integration not found' });
  if (!decryptSecret(target.url_enc)) return res.status(400).json({ detail: 'Stored URL could not be read. Update the URL and try again.' });
  const delivery = await enqueue(db, target.type, target, 'integration.test', {
    message: `Test message from Xeno-HR, sent by ${req.user.full_name || req.user.email}. Your ${target.type === 'slack' ? 'Slack' : 'Teams'} integration works!`,
    integration: target.name
  }, { wait: true, allowRetry: false });
  res.json(stripId(delivery));
}));

router.get('/integrations/targets/:id/deliveries', requirePermission('integrations.manage'), handle('target deliveries', async (req, res) => {
  const db = getDB();
  const rows = await db.collection('webhook_deliveries')
    .find({ target_id: req.params.id }, { projection: { _id: 0, payload: 0 } })
    .sort({ created_at: -1 }).limit(50).toArray();
  res.json(rows);
}));

// ============= CALENDAR FEED =============

const feedUrl = (req, token) => {
  const base = (process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/api/v2/platform/calendar/${token}.ics`;
};

router.get('/calendar/feed', handle('calendar feed status', async (req, res) => {
  const db = getDB();
  const feed = await db.collection('calendar_feeds').findOne({ user_email: req.user.email }, { projection: { _id: 0, token_hash: 0 } });
  res.json(feed ? { active: true, ...feed } : { active: false });
}));

router.post('/calendar/feed', handle('create calendar feed', async (req, res) => {
  const db = getDB();
  await db.collection('calendar_feeds').createIndex({ token_hash: 1 }, { unique: true }).catch(() => {});
  await db.collection('calendar_feeds').createIndex({ user_email: 1 }, { unique: true }).catch(() => {});
  const token = `cal_${randomToken(24)}`;
  const doc = { user_email: req.user.email, user_id: req.user.id, token_hash: sha256(token), token_prefix: token.slice(0, 10), created_at: new Date(), last_accessed_at: null };
  await db.collection('calendar_feeds').replaceOne({ user_email: req.user.email }, doc, { upsert: true });
  const url = feedUrl(req, token);
  res.status(201).json({
    active: true,
    url,
    webcal_url: url.replace(/^https?:/, 'webcal:'),
    token_prefix: doc.token_prefix,
    created_at: doc.created_at
  });
}));

router.delete('/calendar/feed', handle('delete calendar feed', async (req, res) => {
  const db = getDB();
  await db.collection('calendar_feeds').deleteOne({ user_email: req.user.email });
  res.json({ active: false });
}));

publicRouter.get('/calendar/:file', handle('calendar feed', async (req, res, next) => {
  if (!/\.ics$/.test(req.params.file || '')) return next(); // e.g. GET /calendar/feed (authenticated route)
  const m = /^(cal_[A-Za-z0-9_-]{20,64})\.ics$/.exec(req.params.file);
  if (!m) return res.status(404).json({ detail: 'Not found' });
  const db = getDB();
  const feed = await db.collection('calendar_feeds').findOne({ token_hash: sha256(m[1]) });
  if (!feed) return res.status(404).json({ detail: 'Not found' });
  const user = await db.collection('users').findOne({ email: feed.user_email }, { projection: { _id: 0, email: 1, is_active: 1 } });
  if (!user || user.is_active === false) return res.status(404).json({ detail: 'Not found' });
  const employee = await db.collection('employees').findOne({ email: feed.user_email }, { projection: { _id: 0, id: 1, email: 1 } });
  const { ics } = await buildFeed(db, feed.user_email, employee);
  db.collection('calendar_feeds').updateOne({ token_hash: feed.token_hash }, { $set: { last_accessed_at: new Date() } }).catch(() => {});
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="xeno-hr.ics"');
  res.set('Cache-Control', 'private, max-age=900');
  res.send(ics);
}));

// ============= ACCOUNTING EXPORT =============

const monthQuery = Joi.object({
  month: Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required(),
  company: Joi.string().trim().max(120).allow('')
});

const noPayslips = (res, month) => res.status(404).json({ detail: `No finalised payslips found for ${month}. Run payroll for that month first.`, error_code: 'NO_PAYSLIPS' });

router.get('/accounting/summary', requirePermission('payroll.view'), validateQuery(monthQuery), handle('accounting summary', async (req, res) => {
  const journal = await buildJournal(getDB(), req.validatedQuery.month);
  if (!journal) return res.json({ month: req.validatedQuery.month, employees: 0, lines: [], totals: null });
  res.json(journal);
}));

router.get('/accounting/tally', requirePermission('payroll.view'), validateQuery(monthQuery), handle('tally export', async (req, res) => {
  const { month, company } = req.validatedQuery;
  const journal = await buildJournal(getDB(), month);
  if (!journal) return noPayslips(res, month);
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="tally-payroll-${month}.xml"`);
  res.send(toTallyXml(journal, { company }));
}));

router.get('/accounting/zoho', requirePermission('payroll.view'), validateQuery(monthQuery), handle('zoho export', async (req, res) => {
  const { month } = req.validatedQuery;
  const db = getDB();
  const journal = await buildJournal(db, month);
  if (!journal) return noPayslips(res, month);
  const prefs = await db.collection('org_preferences').findOne({ organization_id: 'default' });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="zoho-books-payroll-${month}.csv"`);
  res.send(toZohoCsv(journal, { currency: prefs?.currency || 'INR' }));
}));

module.exports = { router, publicRouter };
