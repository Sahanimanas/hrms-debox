/**
 * Audit trail (PL-2): sanitising request bodies and writing `audit_logs`.
 *
 * Entry shape:
 *   { id, kind: 'request'|'auth', at: Date, actor_email, actor_role, action,
 *     method, path, status, duration_ms, ip, user_agent, body, query, files,
 *     outcome?, reason?, target? }
 *
 * Writing is fire-and-forget: it never throws and never blocks a response.
 */

const { getDB } = require('../../config/database');
const { generateUUID } = require('../../utils/helpers');
const { clientIp } = require('./common');

const MAX_STRING = 300;
const MAX_ARRAY = 25;
const MAX_KEYS = 60;
const MAX_DEPTH = 5;

// Keys whose values are never stored (matched case-insensitively against the key name)
const SENSITIVE_KEY = /(pass(word|wd|phrase)?|secret|token|api[-_]?key|authori[sz]ation|cookie|session|credential|private[-_]?key|signature|otp|totp|mfa|2fa|backup[-_]?codes?|cvv|pin$|aadhaa?r|^pan$|account[-_]?number|card[-_]?number|id_token|access_key|refresh)/i;
const SENSITIVE_EXACT = new Set(['code', 'codes', 'verification_code', 'auth_code', 'challenge', 'nonce', 'key', 'hash', 'hashed_password', 'salt']);

const isSensitiveKey = (key) => SENSITIVE_EXACT.has(String(key).toLowerCase()) || SENSITIVE_KEY.test(String(key));

/**
 * Deep-copy a value, redacting secrets, truncating long strings / arrays and
 * dropping binary or base64 file content.
 */
function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return '[binary omitted]';
  if (value instanceof Date) return value;
  const t = typeof value;
  if (t === 'string') {
    if (/^data:[^;]+;base64,/i.test(value) || (value.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(value))) return '[file content omitted]';
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [${value.length} chars]` : value;
  }
  if (t === 'number' || t === 'boolean') return value;
  if (t !== 'object') return undefined;
  if (depth >= MAX_DEPTH) return '[nested data omitted]';
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map(v => sanitize(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`… ${value.length - MAX_ARRAY} more`);
    return out;
  }
  const out = {};
  const keys = Object.keys(value);
  for (const key of keys.slice(0, MAX_KEYS)) {
    // Keys starting with "$" or containing "." can't be stored in MongoDB
    const safeKey = key.replace(/^\$/, '＄').replace(/\./g, '．');
    out[safeKey] = isSensitiveKey(key) ? '[REDACTED]' : sanitize(value[key], depth + 1);
  }
  if (keys.length > MAX_KEYS) out['…'] = `${keys.length - MAX_KEYS} more keys`;
  return out;
}

let indexesReady = false;
async function ensureAuditIndexes(db) {
  if (indexesReady) return;
  indexesReady = true;
  try {
    await Promise.all([
      db.collection('audit_logs').createIndex({ at: -1 }),
      db.collection('audit_logs').createIndex({ actor_email: 1, at: -1 }),
      db.collection('audit_logs').createIndex({ id: 1 }, { unique: true })
    ]);
  } catch (error) {
    indexesReady = false;
    throw error;
  }
}

/** Insert an audit entry without blocking the caller. */
function writeAudit(entry) {
  setImmediate(async () => {
    try {
      const db = getDB();
      if (!db) return;
      await ensureAuditIndexes(db);
      await db.collection('audit_logs').insertOne({ id: generateUUID(), at: new Date(), ...entry });
    } catch (error) {
      console.error('[audit] write failed:', error.message);
    }
  });
}

/**
 * Record an authentication event (login success/failure, 2FA, SSO, password reset).
 * event: e.g. 'auth.login.success', 'auth.login.failed', 'auth.2fa.failed'.
 */
function recordAuthEvent(req, event, { email = null, role = null, outcome = 'success', reason = null, details = null } = {}) {
  writeAudit({
    kind: 'auth',
    action: event,
    actor_email: email ? String(email).toLowerCase().slice(0, 254) : null,
    actor_role: role,
    outcome,
    reason,
    details: details ? sanitize(details) : null,
    method: req?.method || null,
    path: req?.originalUrl ? req.originalUrl.split('?')[0] : null,
    ip: req ? clientIp(req) : null,
    user_agent: req?.get ? (req.get('User-Agent') || '').slice(0, 300) : null
  });
}

// ============= ANONYMOUS ROUTES =============
//
// Requests to these routes are anonymous by design (grievances, suggestions,
// survey responses). Their audit entries keep only method, route template,
// status and timestamp — never the actor, IP, user agent, query or body.
// Matched against the request path without query string. Extend with
// addAnonymousRoute(/regex/) or AUDIT_ANONYMOUS_ROUTES (comma-separated regexes).

const ANONYMOUS_ROUTES = [
  /^\/api\/v2\/engagement\/grievances\/?$/,
  /^\/api\/v2\/engagement\/grievances\/track\/?$/,
  /^\/api\/v2\/engagement\/suggestions\/?$/,
  /^\/api\/v2\/engagement\/surveys\/[^/]+\/responses\/?$/
];

for (const raw of String(process.env.AUDIT_ANONYMOUS_ROUTES || '').split(',').map(s => s.trim()).filter(Boolean)) {
  try {
    ANONYMOUS_ROUTES.push(new RegExp(raw));
  } catch {
    console.error(`[audit] ignoring invalid AUDIT_ANONYMOUS_ROUTES pattern: ${raw}`);
  }
}

/** Register another anonymous route pattern (RegExp or string regex). */
function addAnonymousRoute(pattern) {
  ANONYMOUS_ROUTES.push(pattern instanceof RegExp ? pattern : new RegExp(pattern));
}

/** True when a mutating request to this path must be logged without identifying details. */
const isAnonymousRoute = (method, path) =>
  method !== 'GET' && ANONYMOUS_ROUTES.some(rx => rx.test(String(path || '').split('?')[0]));

module.exports = { sanitize, writeAudit, recordAuthEvent, isSensitiveKey, ensureAuditIndexes, isAnonymousRoute, addAnonymousRoute, ANONYMOUS_ROUTES };
