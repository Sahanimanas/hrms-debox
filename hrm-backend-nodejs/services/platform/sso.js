/**
 * Single sign-on (PL-4): Google and Microsoft ID-token verification.
 *
 * The backend verifies ID tokens itself — no third-party auth library:
 *   1. fetch + cache the provider's JWKS (1 h; one forced refresh per minute on unknown kid)
 *   2. verify the RS256 signature with Node's crypto
 *   3. check iss / aud / exp / iat / nbf / nonce and that the email is verified
 *
 * Config (env):
 *   GOOGLE_CLIENT_ID                 enables Google
 *   MICROSOFT_CLIENT_ID              enables Microsoft
 *   MICROSOFT_TENANT_ID              default 'common' (any tenant)
 *   GOOGLE_JWKS_URL / MICROSOFT_JWKS_URL   override the key URLs
 *   SSO_TEST_JWKS_JSON               a JWKS document used for BOTH providers (tests only)
 *
 * Nonces (required for both providers) are issued by the backend (GET /api/auth/sso/nonce) as
 * "<random>.<expiry>.<hmac>" so they can be checked statelessly; each one is
 * also recorded in `sso_nonces` when used so it can't be replayed.
 */

const crypto = require('crypto');
const { config } = require('../../config/config');

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CLOCK_SKEW_SECONDS = 120;
const NONCE_TTL_SECONDS = 10 * 60;
const JWKS_TTL_MS = 60 * 60 * 1000;

class SsoError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason || 'invalid_token';
  }
}

// ============= CONFIG =============

const msTenant = () => process.env.MICROSOFT_TENANT_ID || 'common';

function providerConfig() {
  return {
    google: process.env.GOOGLE_CLIENT_ID
      ? { client_id: process.env.GOOGLE_CLIENT_ID }
      : null,
    microsoft: process.env.MICROSOFT_CLIENT_ID
      ? {
          client_id: process.env.MICROSOFT_CLIENT_ID,
          tenant: msTenant(),
          authorize_url: `https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/authorize`
        }
      : null
  };
}

const jwksUrl = (provider) => {
  if (provider === 'google') return process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
  return process.env.MICROSOFT_JWKS_URL || `https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/discovery/v2.0/keys`;
};

// ============= JWKS =============

const jwksCache = new Map(); // provider -> { keys, fetchedAt, lastForced }
let jwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS fetch failed with ${res.status}`);
  return res.json();
};

/** Tests can inject their own fetcher: setJwksFetcher(async (url) => jwks) */
function setJwksFetcher(fn) {
  jwksFetcher = fn;
  jwksCache.clear();
}

async function loadJwks(provider, force = false) {
  if (process.env.SSO_TEST_JWKS_JSON) {
    return JSON.parse(process.env.SSO_TEST_JWKS_JSON).keys || [];
  }
  const cached = jwksCache.get(provider);
  const now = Date.now();
  if (cached && !force && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  if (cached && force && now - (cached.lastForced || 0) < 60 * 1000) return cached.keys;
  const doc = await jwksFetcher(jwksUrl(provider));
  const keys = Array.isArray(doc?.keys) ? doc.keys : [];
  jwksCache.set(provider, { keys, fetchedAt: now, lastForced: force ? now : cached?.lastForced || 0 });
  return keys;
}

async function findKey(provider, kid) {
  let keys = await loadJwks(provider);
  let jwk = keys.find(k => k.kid === kid);
  if (!jwk) {
    keys = await loadJwks(provider, true);
    jwk = keys.find(k => k.kid === kid);
  }
  return jwk || null;
}

// ============= JWT =============

const b64json = (part) => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

/** Verify an RS256 JWT's signature against the provider JWKS; returns the claims. */
async function verifySignature(provider, token) {
  if (typeof token !== 'string' || token.length > 8192) throw new SsoError('Invalid ID token', 'malformed');
  const parts = token.split('.');
  if (parts.length !== 3) throw new SsoError('Invalid ID token', 'malformed');
  const header = b64json(parts[0]);
  const claims = b64json(parts[1]);
  if (!header || !claims) throw new SsoError('Invalid ID token', 'malformed');
  if (header.alg !== 'RS256') throw new SsoError('Unsupported token algorithm', 'bad_algorithm');
  const jwk = await findKey(provider, header.kid);
  if (!jwk || (jwk.kty && jwk.kty !== 'RSA') || (jwk.use && jwk.use !== 'sig')) {
    throw new SsoError('Unknown signing key', 'unknown_key');
  }
  let ok = false;
  try {
    const key = crypto.createPublicKey({ key: { kty: jwk.kty || 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw new SsoError('Invalid token signature', 'bad_signature');
  return claims;
}

function checkTimes(claims) {
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) throw new SsoError('ID token has expired', 'expired');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) throw new SsoError('ID token is not valid yet', 'not_yet_valid');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > now) throw new SsoError('ID token issued in the future', 'not_yet_valid');
}

const audMatches = (aud, clientId) => (Array.isArray(aud) ? aud.includes(clientId) : aud === clientId);

// ============= NONCES =============

const nonceKey = () => crypto.createHash('sha256').update(`sso-nonce:${config.jwtSecret}`).digest();

function issueNonce() {
  const random = crypto.randomBytes(18).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + NONCE_TTL_SECONDS;
  const mac = crypto.createHmac('sha256', nonceKey()).update(`${random}.${exp}`).digest('base64url');
  return { nonce: `${random}.${exp}.${mac}`, expires_in: NONCE_TTL_SECONDS };
}

function nonceIsAuthentic(nonce) {
  if (typeof nonce !== 'string') return false;
  const [random, exp, mac] = nonce.split('.');
  if (!random || !exp || !mac) return false;
  const expected = crypto.createHmac('sha256', nonceKey()).update(`${random}.${exp}`).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  return Number(exp) >= Math.floor(Date.now() / 1000);
}

/** Mark a nonce as used; false if it was already used. */
async function consumeNonce(db, nonce) {
  const col = db.collection('sso_nonces');
  await col.createIndex({ nonce_hash: 1 }, { unique: true }).catch(() => {});
  await col.createIndex({ used_at: 1 }, { expireAfterSeconds: NONCE_TTL_SECONDS * 2 }).catch(() => {});
  try {
    await col.insertOne({ nonce_hash: crypto.createHash('sha256').update(nonce).digest('hex'), used_at: new Date() });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

// ============= PROVIDERS =============

/**
 * Verify a provider ID token. Returns { email, subject, name, provider, tenant }.
 * Throws SsoError with a reason code on any failure.
 */
async function verifyIdToken(provider, idToken, { nonce } = {}) {
  const cfg = providerConfig()[provider];
  if (!cfg) throw new SsoError(`${provider} sign-in is not configured`, 'not_configured');

  const claims = await verifySignature(provider, idToken);
  checkTimes(claims);
  if (!audMatches(claims.aud, cfg.client_id)) throw new SsoError('ID token was issued for another application', 'wrong_audience');

  let email;
  if (provider === 'google') {
    if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new SsoError('Unexpected token issuer', 'wrong_issuer');
    if (claims.email_verified !== true && claims.email_verified !== 'true') throw new SsoError('Google account email is not verified', 'email_unverified');
    email = claims.email;
  } else {
    const tenant = cfg.tenant;
    const issMatch = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/i.exec(claims.iss || '');
    if (!issMatch || (claims.tid && issMatch[1].toLowerCase() !== String(claims.tid).toLowerCase())) {
      throw new SsoError('Unexpected token issuer', 'wrong_issuer');
    }
    const multiTenant = ['common', 'organizations', 'consumers'].includes(tenant.toLowerCase());
    if (!multiTenant && issMatch[1].toLowerCase() !== tenant.toLowerCase()) throw new SsoError('Token is from another Microsoft tenant', 'wrong_tenant');
    email = claims.email || claims.preferred_username;
    // In multi-tenant mode any tenant could assert any email, so require Microsoft's
    // "email domain owner verified" signal. A pinned tenant is trusted for its own users.
    if (multiTenant && claims.xms_edov !== true && claims.xms_edov !== 1 && claims.email_verified !== true) {
      throw new SsoError('Microsoft could not confirm this email address is verified. Ask your administrator to set MICROSOFT_TENANT_ID.', 'email_unverified');
    }
  }

  if (!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new SsoError('ID token has no usable email address', 'no_email');
  }

  // Nonce (both providers): must be one we issued, unexpired, and match what the client sent.
  if (!claims.nonce || claims.nonce !== nonce || !nonceIsAuthentic(claims.nonce)) {
    throw new SsoError('Sign-in request has expired or does not match. Please try again.', 'bad_nonce');
  }

  return {
    provider,
    email: email.toLowerCase(),
    subject: claims.sub,
    name: claims.name || null,
    tenant: claims.tid || null,
    nonce: claims.nonce || null
  };
}

module.exports = {
  SsoError,
  providerConfig,
  verifyIdToken,
  issueNonce,
  nonceIsAuthentic,
  consumeNonce,
  setJwksFetcher
};
