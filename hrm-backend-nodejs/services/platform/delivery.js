/**
 * Event delivery (PL-6 / PL-7): outbound webhooks and Slack / Microsoft Teams
 * incoming-webhook messages for domain events from services/events.js.
 *
 * Collections
 *   webhook_endpoints    { id, url, description, events[], secret_enc, secret_prefix, enabled, created_by, created_at, updated_at }
 *   integration_targets  { id, type: 'slack'|'teams', name, url_enc, url_hint, events[], enabled, created_by, created_at }
 *   webhook_deliveries   { id, target_type: 'webhook'|'slack'|'teams', target_id, event, event_id, payload,
 *                          status: 'pending'|'retrying'|'success'|'failed', attempts, attempt_log[],
 *                          response_status, response_body, error, next_attempt_at, created_at, completed_at }
 *
 * Webhook requests carry:
 *   X-XenoHR-Event, X-XenoHR-Delivery, X-XenoHR-Timestamp (unix seconds) and
 *   X-XenoHR-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *
 * Up to 3 attempts with exponential backoff (WEBHOOK_RETRY_BASE_MS, default
 * 10 s → 10 s, 40 s). A cron sweeper ('webhook-retry') resumes deliveries
 * whose timer was lost (e.g. server restart).
 */

const crypto = require('crypto');
const { getDB } = require('../../config/database');
const { generateUUID } = require('../../utils/helpers');
const { decryptSecret } = require('./common');
const { sanitize } = require('./audit');
const { postJson } = require('./outbound');

const MAX_ATTEMPTS = 3;
const retryBase = () => Math.max(50, parseInt(process.env.WEBHOOK_RETRY_BASE_MS || '10000', 10) || 10000);
const retryDelay = (attempt) => retryBase() * Math.pow(4, attempt - 1); // after attempt 1 → base, after 2 → 4×base

const EVENT_CATALOG = [
  { name: 'employee.joined', label: 'Employee joined' },
  { name: 'employee.exited', label: 'Employee exited' },
  { name: 'leave.applied', label: 'Leave applied' },
  { name: 'leave.approved', label: 'Leave approved' },
  { name: 'leave.rejected', label: 'Leave rejected' },
  { name: 'candidate.hired', label: 'Candidate hired' },
  { name: 'payroll.run.locked', label: 'Payroll run locked' },
  { name: 'payroll.run.paid', label: 'Payroll run paid' },
  { name: 'announcement.published', label: 'Announcement published' },
  { name: 'expense.approved', label: 'Expense approved' },
  { name: 'asset.assigned', label: 'Asset assigned' },
  { name: 'kudos.given', label: 'Kudos given' }
];
const EVENT_NAMES = EVENT_CATALOG.map(e => e.name);
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;

const subscribed = (events, name) => Array.isArray(events) && (events.includes('*') || events.includes(name));

// ============= MESSAGE FORMATTING (Slack / Teams) =============

const labelFor = (name) => EVENT_CATALOG.find(e => e.name === name)?.label
  || name.split('.').map(w => w.replace(/_/g, ' ')).join(' ').replace(/^\w/, c => c.toUpperCase());

const HIDDEN_FIELD = /(^|_)(id|uid|uuid)$|^_|email_hash|token|secret|password|salary|amount_paid|bank|pan|aadhaar/i;

/** Human-friendly key facts from an event payload (top-level scalars only). */
function eventFacts(payload) {
  const facts = [];
  for (const [key, value] of Object.entries(payload || {})) {
    if (facts.length >= 8) break;
    if (value == null || typeof value === 'object' && !(value instanceof Date)) continue;
    if (HIDDEN_FIELD.test(key)) continue;
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    facts.push({ name: key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()), value: text.slice(0, 200) });
  }
  return facts;
}

const appUrl = () => (process.env.FRONTEND_URL || '').replace(/\/$/, '');

function slackMessage(event, payload) {
  const title = labelFor(event);
  const facts = eventFacts(payload);
  const summary = payload?.message || payload?.title || payload?.employee_name || payload?.name || '';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `Xeno-HR · ${title}`.slice(0, 150) } }
  ];
  if (summary) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: String(summary).slice(0, 2900) } });
  if (facts.length) {
    blocks.push({ type: 'section', fields: facts.map(f => ({ type: 'mrkdwn', text: `*${f.name}*\n${f.value}` })) });
  }
  if (appUrl()) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${appUrl()}|Open Xeno-HR>` }] });
  return { text: `${title}${summary ? `: ${summary}` : ''}`.slice(0, 3000), blocks };
}

function teamsMessage(event, payload) {
  const title = labelFor(event);
  const facts = eventFacts(payload);
  const summary = payload?.message || payload?.title || payload?.employee_name || payload?.name || '';
  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: 'FACC15',
    summary: `Xeno-HR: ${title}`,
    title: `Xeno-HR · ${title}`,
    sections: [{ text: summary ? String(summary).slice(0, 2000) : undefined, facts }]
  };
  if (appUrl()) card.potentialAction = [{ '@type': 'OpenUri', name: 'Open Xeno-HR', targets: [{ os: 'default', uri: appUrl() }] }];
  return card;
}

// ============= SIGNING =============

const signBody = (secret, timestamp, body) =>
  `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

// ============= ATTEMPTS =============

async function loadTarget(db, delivery) {
  if (delivery.target_type === 'webhook') {
    return db.collection('webhook_endpoints').findOne({ id: delivery.target_id });
  }
  return db.collection('integration_targets').findOne({ id: delivery.target_id });
}

/** Build URL, body and headers for a delivery. */
function buildRequest(target, delivery) {
  if (delivery.target_type === 'webhook') {
    const secret = decryptSecret(target.secret_enc);
    if (!secret) throw new Error('Webhook secret could not be decrypted');
    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    return {
      url: target.url,
      body,
      headers: {
        'X-XenoHR-Event': delivery.event,
        'X-XenoHR-Delivery': delivery.id,
        'X-XenoHR-Timestamp': String(timestamp),
        'X-XenoHR-Signature': signBody(secret, timestamp, body)
      }
    };
  }
  const url = decryptSecret(target.url_enc);
  if (!url) throw new Error('Integration URL could not be decrypted');
  const message = delivery.target_type === 'slack'
    ? slackMessage(delivery.event, delivery.payload?.data)
    : teamsMessage(delivery.event, delivery.payload?.data);
  return { url, body: JSON.stringify(message), headers: {} };
}

const timers = new Set();

/**
 * Run one attempt of a delivery; schedules the next one on failure.
 * Returns the updated delivery document.
 */
async function attempt(db, deliveryId, { allowRetry = true } = {}) {
  const delivery = await db.collection('webhook_deliveries').findOne({ id: deliveryId });
  if (!delivery || ['success', 'failed'].includes(delivery.status)) return delivery;
  const target = await loadTarget(db, delivery);
  const attemptNo = (delivery.attempts || 0) + 1;
  const logEntry = { attempt: attemptNo, at: new Date() };
  let ok = false;
  let responseStatus = null;
  let responseBody = null;
  let error = null;

  if (!target) {
    error = 'Target was deleted';
  } else {
    try {
      const reqSpec = buildRequest(target, delivery);
      const res = await postJson(reqSpec.url, reqSpec.body, reqSpec.headers);
      responseStatus = res.status;
      responseBody = res.body;
      logEntry.duration_ms = res.duration_ms;
      ok = res.status >= 200 && res.status < 300;
      if (!ok) error = `Receiver responded with HTTP ${res.status}`;
    } catch (e) {
      error = String(e.message || e).slice(0, 300);
    }
  }
  Object.assign(logEntry, { status: responseStatus, error });

  const willRetry = !ok && target && allowRetry && attemptNo < MAX_ATTEMPTS;
  const set = {
    attempts: attemptNo,
    response_status: responseStatus,
    response_body: responseBody ? responseBody.slice(0, 1000) : null,
    error: ok ? null : error,
    status: ok ? 'success' : willRetry ? 'retrying' : 'failed',
    updated_at: new Date()
  };
  if (willRetry) set.next_attempt_at = new Date(Date.now() + retryDelay(attemptNo));
  else {
    set.next_attempt_at = null;
    set.completed_at = new Date();
  }
  await db.collection('webhook_deliveries').updateOne({ id: deliveryId }, { $set: set, $push: { attempt_log: logEntry } });

  if (target) {
    const col = delivery.target_type === 'webhook' ? 'webhook_endpoints' : 'integration_targets';
    await db.collection(col).updateOne(
      { id: target.id },
      { $set: { last_delivery_at: new Date(), last_delivery_status: set.status, last_response_status: responseStatus } }
    );
  }

  if (willRetry) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      attempt(db, deliveryId).catch(err => console.error('[webhooks] retry failed:', err.message));
    }, retryDelay(attemptNo));
    if (timer.unref) timer.unref();
    timers.add(timer);
  }
  return db.collection('webhook_deliveries').findOne({ id: deliveryId }, { projection: { _id: 0 } });
}

let indexesReady = false;
async function ensureDeliveryIndexes(db) {
  if (indexesReady) return;
  indexesReady = true;
  await Promise.all([
    db.collection('webhook_deliveries').createIndex({ id: 1 }, { unique: true }),
    db.collection('webhook_deliveries').createIndex({ target_id: 1, created_at: -1 }),
    db.collection('webhook_deliveries').createIndex({ status: 1, next_attempt_at: 1 }),
    db.collection('webhook_endpoints').createIndex({ id: 1 }, { unique: true }),
    db.collection('integration_targets').createIndex({ id: 1 }, { unique: true })
  ]).catch((e) => { indexesReady = false; throw e; });
}

/** Create a delivery record for a target and run its first attempt. */
async function enqueue(db, targetType, target, eventName, data, { eventId = generateUUID(), wait = false, allowRetry = true } = {}) {
  await ensureDeliveryIndexes(db);
  const payload = {
    id: eventId,
    event: eventName,
    created_at: new Date().toISOString(),
    data: sanitize(data || {})
  };
  const delivery = {
    id: generateUUID(),
    target_type: targetType,
    target_id: target.id,
    event: eventName,
    event_id: eventId,
    payload,
    status: 'pending',
    attempts: 0,
    attempt_log: [],
    created_at: new Date()
  };
  await db.collection('webhook_deliveries').insertOne(delivery);
  const run = attempt(db, delivery.id, { allowRetry });
  if (wait) return run;
  run.catch(err => console.error('[webhooks] delivery failed:', err.message));
  delete delivery._id;
  return delivery;
}

/** Event listener: fan an event out to every subscribed webhook and chat target. */
async function dispatchEvent(name, payload, meta = {}) {
  const db = getDB();
  if (!db || !name) return;
  const eventId = meta.event_id || generateUUID();
  const [endpoints, targets] = await Promise.all([
    db.collection('webhook_endpoints').find({ enabled: true }).toArray(),
    db.collection('integration_targets').find({ enabled: true }).toArray()
  ]);
  for (const ep of endpoints.filter(e => subscribed(e.events, name))) {
    await enqueue(db, 'webhook', ep, name, payload, { eventId });
  }
  for (const t of targets.filter(x => subscribed(x.events, name))) {
    await enqueue(db, t.type, t, name, payload, { eventId });
  }
}

/** Cron: resume deliveries whose retry timer was lost. */
async function retryStuckDeliveries(db) {
  const stuck = await db.collection('webhook_deliveries')
    .find({ status: { $in: ['retrying', 'pending'] }, $or: [{ next_attempt_at: { $lte: new Date(Date.now() - 60 * 1000) } }, { next_attempt_at: null, created_at: { $lte: new Date(Date.now() - 5 * 60 * 1000) } }] })
    .limit(200)
    .toArray();
  for (const d of stuck) await attempt(db, d.id);
  return { resumed: stuck.length };
}

module.exports = {
  EVENT_CATALOG,
  EVENT_NAMES,
  EVENT_NAME_PATTERN,
  MAX_ATTEMPTS,
  dispatchEvent,
  enqueue,
  attempt,
  retryStuckDeliveries,
  slackMessage,
  teamsMessage,
  signBody,
  ensureDeliveryIndexes
};
