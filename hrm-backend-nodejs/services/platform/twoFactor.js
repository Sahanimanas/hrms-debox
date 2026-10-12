/**
 * Two-factor authentication (PL-3): TOTP (RFC 6238) via otplib v13 and
 * one-time backup codes.
 *
 * Stored on the user document (never returned by any API):
 *   users.two_factor = {
 *     enabled, enabled_at, secret_enc (AES-GCM), pending_secret_enc, pending_created_at,
 *     backup_codes: [bcrypt hash], last_used_step, failed_attempts, locked_until
 *   }
 *
 * Login challenges live in `auth_challenges` ({ id, user_email, attempts,
 * locked, used, expires_at }) and are referenced by a short-lived signed
 * challenge token (typ '2fa_challenge', signed with a key derived from the
 * JWT secret so it can never be used as an access token).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { generateSecret, generateURI, verify } = require('otplib');
const { config } = require('../../config/config');
const { generateUUID } = require('../../utils/helpers');
const { encryptSecret, decryptSecret } = require('./common');

const ISSUER = process.env.TOTP_ISSUER || 'Xeno-HR';
const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;
const USER_LOCK_THRESHOLD = 10;      // failed codes across challenges…
const USER_LOCK_MINUTES = 15;        // …lock 2FA verification for this long
const BACKUP_CODE_COUNT = 10;
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes

const challengeKey = () => crypto.createHash('sha256').update(`2fa-challenge:${config.jwtSecret}`).digest();

// ============= TOTP =============

function newSecret() {
  return generateSecret({ length: 20 });
}

async function enrolmentPayload(secret, email) {
  const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return { otpauth_url: otpauthUrl, qr_code: qrDataUrl, secret, issuer: ISSUER };
}

const normaliseCode = (code) => String(code || '').replace(/[\s-]/g, '').toLowerCase();
const looksLikeTotp = (code) => /^\d{6}$/.test(normaliseCode(code));

/**
 * Verify a TOTP code (±1 step of clock drift). Rejects replays of a step at
 * or before lastUsedStep. Returns { valid, step }.
 */
async function verifyTotp(secret, code, lastUsedStep = null) {
  const token = normaliseCode(code);
  if (!secret || !/^\d{6}$/.test(token)) return { valid: false };
  try {
    const opts = { secret, token, epochTolerance: 30 };
    if (Number.isInteger(lastUsedStep)) opts.afterTimeStep = lastUsedStep;
    const result = await verify(opts);
    return result.valid ? { valid: true, step: result.timeStep } : { valid: false };
  } catch {
    return { valid: false };
  }
}

// ============= BACKUP CODES =============

function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const bytes = crypto.randomBytes(10);
    let raw = '';
    for (const b of bytes) raw += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

const hashBackupCodes = (codes) => Promise.all(codes.map(c => bcrypt.hash(normaliseCode(c), 10)));

/** Returns the index of the matching hash, or -1. Checks every hash (no early exit). */
async function matchBackupCode(hashes, code) {
  const token = normaliseCode(code);
  if (!/^[a-z0-9]{10}$/.test(token) || !Array.isArray(hashes)) return -1;
  const results = await Promise.all(hashes.map(h => bcrypt.compare(token, h).catch(() => false)));
  return results.findIndex(Boolean);
}

// ============= VERIFY A SECOND FACTOR FOR A USER =============

/**
 * Check a TOTP or backup code against a user's enabled 2FA and persist the
 * side effects (last used step, consumed backup code). Returns
 * { valid, method: 'totp'|'backup_code', remaining_backup_codes }.
 */
async function verifySecondFactor(db, user, code) {
  const tf = user.two_factor || {};
  if (!tf.enabled) return { valid: false };
  if (looksLikeTotp(code)) {
    const secret = decryptSecret(tf.secret_enc);
    const result = await verifyTotp(secret, code, tf.last_used_step);
    if (result.valid) {
      await db.collection('users').updateOne(
        { id: user.id, email: user.email },
        { $set: { 'two_factor.last_used_step': result.step } }
      );
      return { valid: true, method: 'totp' };
    }
    return { valid: false };
  }
  const index = await matchBackupCode(tf.backup_codes, code);
  if (index < 0) return { valid: false };
  const hash = tf.backup_codes[index];
  // $pull the exact hash so a concurrent request can't use the same code twice
  const r = await db.collection('users').updateOne(
    { email: user.email, 'two_factor.backup_codes': hash },
    { $pull: { 'two_factor.backup_codes': hash } }
  );
  if (!r.modifiedCount) return { valid: false };
  return { valid: true, method: 'backup_code', remaining_backup_codes: tf.backup_codes.length - 1 };
}

// ============= LOGIN CHALLENGES =============

let challengeIndexes = false;
async function ensureChallengeIndexes(db) {
  if (challengeIndexes) return;
  challengeIndexes = true;
  await Promise.all([
    db.collection('auth_challenges').createIndex({ id: 1 }, { unique: true }),
    db.collection('auth_challenges').createIndex({ expires_at: 1 }, { expireAfterSeconds: 3600 })
  ]).catch((e) => { challengeIndexes = false; throw e; });
}

async function createChallenge(db, user, method = 'password') {
  await ensureChallengeIndexes(db);
  const id = generateUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
  await db.collection('auth_challenges').insertOne({
    id,
    user_email: user.email,
    method,
    attempts: 0,
    locked: false,
    used: false,
    created_at: new Date(),
    expires_at: expiresAt
  });
  const token = jwt.sign({ sub: user.email, typ: '2fa_challenge', jti: id }, challengeKey(), {
    expiresIn: CHALLENGE_TTL_SECONDS,
    algorithm: 'HS256'
  });
  return { challenge_token: token, expires_in: CHALLENGE_TTL_SECONDS };
}

/** Decode a challenge token; returns payload or null. */
function readChallengeToken(token) {
  try {
    const payload = jwt.verify(String(token || ''), challengeKey(), { algorithms: ['HS256'] });
    return payload.typ === '2fa_challenge' && payload.jti && payload.sub ? payload : null;
  } catch {
    return null;
  }
}

const isUserLocked = (user) => {
  const until = user?.two_factor?.locked_until;
  return until && new Date(until) > new Date();
};

/** Record a failed code against the challenge and the user; returns { locked, attempts_left }. */
async function registerFailure(db, challenge, user) {
  const updated = await db.collection('auth_challenges').findOneAndUpdate(
    { id: challenge.id },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
  const attempts = (updated?.attempts ?? updated?.value?.attempts) || challenge.attempts + 1;
  const locked = attempts >= MAX_CHALLENGE_ATTEMPTS;
  if (locked) await db.collection('auth_challenges').updateOne({ id: challenge.id }, { $set: { locked: true } });

  await noteUserFailure(db, user);
  return { locked, attempts_left: Math.max(0, MAX_CHALLENGE_ATTEMPTS - attempts) };
}

/** Count a failed second-factor code against the user; locks 2FA for a while after too many. */
async function noteUserFailure(db, user) {
  const failed = (user.two_factor?.failed_attempts || 0) + 1;
  const set = { 'two_factor.failed_attempts': failed };
  if (failed >= USER_LOCK_THRESHOLD) {
    set['two_factor.locked_until'] = new Date(Date.now() + USER_LOCK_MINUTES * 60 * 1000);
    set['two_factor.failed_attempts'] = 0;
  }
  await db.collection('users').updateOne({ email: user.email }, { $set: set });
}

module.exports = {
  ISSUER,
  MAX_CHALLENGE_ATTEMPTS,
  BACKUP_CODE_COUNT,
  newSecret,
  enrolmentPayload,
  verifyTotp,
  generateBackupCodes,
  hashBackupCodes,
  matchBackupCode,
  verifySecondFactor,
  createChallenge,
  readChallengeToken,
  registerFailure,
  noteUserFailure,
  isUserLocked,
  encryptSecret,
  decryptSecret
};
