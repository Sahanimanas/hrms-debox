/**
 * Shared helpers for the platform module (audit, 2FA, SSO, roles,
 * integrations, public API, preferences, AI assistant).
 */

const crypto = require('crypto');
const { config } = require('../../config/config');

// ============= RESPONSES =============

const stripId = (doc) => {
  if (doc && typeof doc === 'object') delete doc._id;
  return doc;
};

/** Wrap an async handler so unexpected errors return a 500 with a log line. */
const handle = (label, fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error(`[platform] ${label}:`, error);
    if (!res.headersSent) res.status(500).json({ detail: 'Internal server error' });
  }
};

/** Validate query params with Joi; failures return 422 like validate(). */
const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(422).json({
      detail: 'Validation failed',
      errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
    });
  }
  req.validatedQuery = value;
  next();
};

// ============= CRYPTO =============

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** Constant-time string comparison (hashes both sides so lengths never leak). */
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
};

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/**
 * Symmetric encryption for secrets that must be recoverable (TOTP secrets,
 * webhook signing secrets). Key: PLATFORM_ENCRYPTION_KEY (any string) or,
 * by default, derived from the JWT secret. AES-256-GCM.
 */
const encryptionKey = () =>
  crypto.createHash('sha256')
    .update(`xenohr-platform:${process.env.PLATFORM_ENCRYPTION_KEY || config.jwtSecret}`)
    .digest();

const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${data.toString('base64url')}`;
};

const decryptSecret = (box) => {
  if (typeof box !== 'string' || !box.startsWith('v1:')) return null;
  try {
    const [, iv, tag, data] = box.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

// ============= MISC =============

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PRIVATE_PEER = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd]|fe80:)/i;
const normalizeIp = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '').slice(0, 64);

/**
 * Real client address. Proxy headers are only believed when the request came
 * from our own reverse proxy (a loopback / private peer); then the first
 * X-Forwarded-For entry is the client, else X-Real-IP. Direct requests use
 * the socket address, so a client can't forge its IP.
 */
const clientIp = (req) => {
  const peer = normalizeIp(req.socket?.remoteAddress || req.ip);
  if (PRIVATE_PEER.test(peer)) {
    const fwd = req.headers['x-forwarded-for'];
    const first = normalizeIp(String(Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0]);
    if (first) return first;
    const real = normalizeIp(req.headers['x-real-ip']);
    if (real) return real;
  }
  return peer || normalizeIp(req.ip) || null;
};

/** Find a user by email (exact first, then case-insensitive). */
const findUserByEmail = async (db, email, projection = { _id: 0 }) => {
  if (!email) return null;
  const exact = await db.collection('users').findOne({ email }, { projection });
  if (exact) return exact;
  return db.collection('users').findOne(
    { email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } },
    { projection }
  );
};

const csvCell = (value) => {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formulas
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const toCsv = (rows, columns) => {
  const header = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return [header, ...body].join('\r\n');
};

module.exports = {
  stripId,
  handle,
  validateQuery,
  sha256,
  safeEqual,
  randomToken,
  encryptSecret,
  decryptSecret,
  escapeRegex,
  clientIp,
  findUserByEmail,
  csvCell,
  toCsv
};
