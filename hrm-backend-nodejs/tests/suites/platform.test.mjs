// Phase 10 — platform & security (PL-1 … PL-9; PL-1 is frontend-only)
//
// Self-contained: besides the server started by tests/run.mjs (the "primary",
// default configuration), this suite starts a SECOND backend on API port + 1000
// against the same database with test-only configuration:
//   GOOGLE_CLIENT_ID / MICROSOFT_CLIENT_ID + SSO_TEST_JWKS_JSON (a key pair generated here),
//   ALLOW_PRIVATE_WEBHOOKS=true (so deliveries can reach the local receiver below),
//   WEBHOOK_RETRY_BASE_MS=150, ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL (a local fake Messages API).
// No real Google / Microsoft / Slack / Anthropic calls are made.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { generate as totp } from 'otplib';
import {
  run, section, check, get, post, put, del, http as api, bootstrap, createUser, withDb, login,
  BASE, BACKEND_DIR, ADMIN_EMAIL, ADMIN_PASSWORD, DEFAULT_PASSWORD
} from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// ============= LOCAL RECEIVER (webhooks, Slack, Teams) =============

const received = [];
let flakyHits = 0;
const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    received.push({ path: req.url, headers: req.headers, body, at: Date.now() });
    if (req.url === '/fail') { res.writeHead(500); return res.end('nope'); }
    if (req.url === '/flaky') {
      flakyHits += 1;
      if (flakyHits === 1) { res.writeHead(503); return res.end('try later'); }
    }
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
});

// ============= FAKE ANTHROPIC MESSAGES API =============

const anthropicRequests = [];
const fakeAnthropic = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const params = body ? JSON.parse(body) : {};
    anthropicRequests.push({ path: req.url, headers: req.headers, params });
    const reply = (content, stop_reason) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_test' });
      res.end(JSON.stringify({
        id: `msg_${crypto.randomUUID()}`, type: 'message', role: 'assistant', model: params.model,
        content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }
      }));
    };
    const msgs = params.messages || [];
    const last = msgs[msgs.length - 1];
    const lastText = typeof last?.content === 'string' ? last.content : '';
    if (lastText.includes('REFUSE')) return reply([], 'refusal');
    if (Array.isArray(last?.content) && last.content[0]?.type === 'tool_result') {
      const data = JSON.parse(last.content[0].content);
      return reply([{ type: 'text', text: `You have ${data.balances?.casual_leave ?? '?'} casual leave days left.` }], 'end_turn');
    }
    return reply([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: `toolu_${crypto.randomUUID().slice(0, 8)}`, name: 'get_my_leave_balance', input: {} }
    ], 'tool_use');
  });
});

const listen = (server) => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

// ============= SSO KEYS =============

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid-1';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };
const GOOGLE_CLIENT = 'test-client.apps.googleusercontent.com';
const MS_CLIENT = '11111111-2222-3333-4444-555555555555';
const MS_TID = '9188040d-6c67-4c5b-b112-36a304b66dad';

function signJwt(claims, { key = privateKey, kid = KID, alg = 'RS256' } = {}) {
  const head = b64url({ alg, kid, typ: 'JWT' });
  const payload = b64url(claims);
  const sig = alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), key).toString('base64url');
  return `${head}.${payload}.${sig}`;
}

const googleClaims = (email, nonce, extra = {}) => ({
  iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT, sub: `g-${email}`, email, email_verified: true,
  name: 'SSO Person', iat: nowSec(), exp: nowSec() + 600, nonce, ...extra
});
const msClaims = (email, nonce, extra = {}) => ({
  iss: `https://login.microsoftonline.com/${MS_TID}/v2.0`, tid: MS_TID, aud: MS_CLIENT, sub: `m-${email}`,
  email, preferred_username: email, xms_edov: true, name: 'MS Person', iat: nowSec(), exp: nowSec() + 600, nonce, ...extra
});

// ============= SECOND SERVER =============

const PRIMARY_PORT = Number(new URL(BASE).port || 80);
const S2_PORT = PRIMARY_PORT + 1000;
const S2 = `http://localhost:${S2_PORT}/api`;
let s2proc = null;

async function startSecondServer(receiverPort, anthropicPort) {
  const env = {
    ...process.env,
    PORT: String(S2_PORT),
    BACKEND_PUBLIC_URL: `http://localhost:${S2_PORT}`,
    CRON_ENABLED: 'false',
    GOOGLE_CLIENT_ID: GOOGLE_CLIENT,
    MICROSOFT_CLIENT_ID: MS_CLIENT,
    MICROSOFT_TENANT_ID: 'common',
    SSO_TEST_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
    ALLOW_PRIVATE_WEBHOOKS: 'true',
    WEBHOOK_RETRY_BASE_MS: '150',
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropicPort}`,
    ASSISTANT_RATE_LIMIT: '100'
  };
  s2proc = spawn(process.execPath, ['server.js'], { cwd: BACKEND_DIR, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${S2_PORT}/health`);
      if ((await r.json()).database === 'connected') return true;
    } catch { /* not yet */ }
    await sleep(500);
  }
  return false;
}

function stopSecondServer() {
  if (!s2proc || s2proc.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(s2proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else s2proc.kill('SIGTERM');
}
process.on('exit', stopSecondServer);

async function s2(method, path, token, body, headers = {}) {
  const res = await fetch(S2 + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let d = null;
  try { d = await res.json(); } catch { /* not JSON */ }
  return { s: res.status, d };
}

async function rawGet(url, headers = {}) {
  const res = await fetch(url, { headers });
  return { s: res.status, headers: res.headers, text: await res.text() };
}

const auditFind = (filter) => withDb(db => db.collection('audit_logs').find(filter).sort({ at: -1 }).toArray());

// ============= SUITE =============

await run(async () => {
  const receiverPort = await listen(receiver);
  const anthropicPort = await listen(fakeAnthropic);
  const RX = `http://127.0.0.1:${receiverPort}`;

  try {
    const admin = await bootstrap();
    const mgr = await createUser(admin, { role: 'manager', name: 'Mira Manager', department: 'Engineering' });
    const emp = await createUser(admin, { role: 'employee', name: 'Eva Employee', manager_email: mgr.email, department: 'Engineering' });
    const other = await createUser(admin, { role: 'employee', name: 'Oscar Other', department: 'Sales' });
    const s2ok = await startSecondServer(receiverPort, anthropicPort);

    // In-process access to platform services (unit-level checks)
    const { connectDB, closeDB } = require('../../config/database');
    await connectDB(process.env.DATABASE_URL, process.env.DB_NAME || 'hrms_test_run');
    const auditSvc = require('../../services/platform/audit');
    const outbound = require('../../services/platform/outbound');
    const assistantSvc = require('../../services/platform/assistant');
    const { routeTemplate } = require('../../middleware/auditLog');

    section('PL-0 Setup');
    check('second test server started (SSO / webhooks / AI config)', s2ok);
    const primaryHooks = await get('/v2/platform/webhooks/config', admin);
    const primaryAllowsPrivate = primaryHooks.d?.allow_private === true;
    const primaryAi = await get('/v2/platform/assistant/status', admin);

    // =====================================================================
    section('PL-3 Two-factor authentication');
    let r = await get('/v2/platform/2fa/status', emp.token);
    check('status: not enabled', r.s === 200 && r.d.enabled === false && r.d.backup_codes_remaining === 0, r);
    r = await post('/v2/platform/2fa/enable', emp.token, { code: '123456' });
    check('enable without setup rejected', r.s === 400, r);
    r = await post('/v2/platform/2fa/setup', emp.token);
    const secret = r.d?.secret;
    check('setup returns otpauth URL + QR data URL', r.s === 200 && /^otpauth:\/\/totp\/Xeno-HR:/.test(r.d.otpauth_url) && /^data:image\/png;base64,/.test(r.d.qr_code) && !!secret, r.d && { ...r.d, qr_code: r.d.qr_code?.slice(0, 40) });
    const goodCode = await totp({ secret });
    const badCode = String((Number(goodCode) + 500000) % 1000000).padStart(6, '0');
    r = await post('/v2/platform/2fa/enable', emp.token, { code: badCode });
    check('enable with wrong code rejected', r.s === 400 && r.d?.error_code === 'INVALID_2FA_CODE', r);
    r = await post('/v2/platform/2fa/enable', emp.token, {});
    check('enable without code → 422', r.s === 422, r);
    r = await post('/v2/platform/2fa/enable', emp.token, { code: goodCode });
    const backupCodes = r.d?.backup_codes || [];
    check('enable returns 10 one-time backup codes', r.s === 200 && backupCodes.length === 10 && backupCodes.every(c => /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(c)), r);
    const stored = await withDb(db => db.collection('users').findOne({ email: emp.email }));
    check('backup codes stored as bcrypt hashes, secret encrypted at rest',
      stored.two_factor.backup_codes.every(h => h.startsWith('$2')) && !JSON.stringify(stored.two_factor).includes(secret) && !stored.two_factor.pending_secret_enc, stored.two_factor && Object.keys(stored.two_factor));
    r = await post('/v2/platform/2fa/setup', emp.token);
    check('setup refused while enabled', r.s === 400, r);
    r = await get('/auth/me', emp.token);
    check('/auth/me reports 2FA enabled without leaking secrets', r.d?.two_factor_enabled === true && !JSON.stringify(r.d).includes('secret') && !JSON.stringify(r.d).includes('backup'), r.d);

    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    let challenge = r.d?.challenge_token;
    check('login returns a 2FA challenge instead of a token', r.s === 200 && r.d.two_factor_required === true && !!challenge && !r.d.access_token, r);
    r = await get('/auth/me', challenge);
    check('challenge token cannot be used as an access token', r.s === 401, r);
    r = await post('/auth/2fa/verify', null, { challenge_token: challenge, code: badCode });
    check('wrong code → 401 with attempts left', r.s === 401 && r.d.attempts_left === 4, r);
    r = await post('/auth/2fa/verify', null, { challenge_token: 'garbage', code: goodCode });
    check('forged challenge token rejected', r.s === 401 && r.d.error_code === 'CHALLENGE_INVALID', r);
    const nextCode = await totp({ secret, epoch: nowSec() + 30 });
    r = await post('/auth/2fa/verify', null, { challenge_token: challenge, code: nextCode });
    check('valid code completes login with the normal response shape', r.s === 200 && !!r.d.access_token && r.d.token_type === 'bearer' && r.d.user?.email === emp.email, r);
    emp.token = r.d?.access_token || emp.token;
    r = await post('/auth/2fa/verify', null, { challenge_token: challenge, code: nextCode });
    check('a challenge can only be used once', r.s === 401, r);
    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    challenge = r.d.challenge_token;
    r = await post('/auth/2fa/verify', null, { challenge_token: challenge, code: nextCode });
    check('replayed TOTP code rejected', r.s === 401 && r.d.error_code === 'INVALID_2FA_CODE', r);
    r = await post('/auth/2fa/verify', null, { challenge_token: challenge, code: backupCodes[0].toUpperCase() });
    check('backup code accepted (case/format-insensitive)', r.s === 200 && !!r.d.access_token, r);
    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    r = await post('/auth/2fa/verify', null, { challenge_token: r.d.challenge_token, code: backupCodes[0] });
    check('backup code is single-use', r.s === 401, r);
    r = await get('/v2/platform/2fa/status', emp.token);
    check('status shows 9 backup codes remaining', r.d?.backup_codes_remaining === 9, r.d);

    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    challenge = r.d.challenge_token;
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post('/auth/2fa/verify', null, { challenge_token: challenge, code: badCode })).s);
    check('challenge locked after 5 failed codes', codes.slice(0, 4).every(s => s === 401) && codes[4] === 429, codes);
    r = await post('/auth/2fa/verify', null, { challenge_token: challenge, code: backupCodes[1] });
    check('locked challenge rejects even a correct code', r.s === 429, r);
    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    r = await post('/auth/2fa/verify', null, { challenge_token: r.d.challenge_token, code: backupCodes[1] });
    check('fresh challenge works after a lock', r.s === 200, r);

    // Manager: regenerate backup codes
    r = await post('/v2/platform/2fa/setup', mgr.token);
    const mgrSecret = r.d.secret;
    r = await post('/v2/platform/2fa/enable', mgr.token, { code: await totp({ secret: mgrSecret }) });
    const mgrOldCodes = r.d.backup_codes;
    r = await post('/v2/platform/2fa/backup-codes', mgr.token, { code: badCode });
    check('regenerating backup codes needs a valid code', r.s === 400, r);
    r = await post('/v2/platform/2fa/backup-codes', mgr.token, { code: await totp({ secret: mgrSecret, epoch: nowSec() + 30 }) });
    const mgrNewCodes = r.d?.backup_codes || [];
    check('backup codes regenerated', r.s === 200 && mgrNewCodes.length === 10 && mgrNewCodes[0] !== mgrOldCodes[0], r);
    r = await post('/auth/login', null, { email: mgr.email, password: DEFAULT_PASSWORD });
    const mgrChallenge = r.d.challenge_token;
    r = await post('/auth/2fa/verify', null, { challenge_token: mgrChallenge, code: mgrOldCodes[0] });
    check('old backup codes stop working after regeneration', r.s === 401, r);
    r = await post('/auth/2fa/verify', null, { challenge_token: mgrChallenge, code: mgrNewCodes[0] });
    check('new backup code works', r.s === 200, r);

    // Disable
    r = await post('/v2/platform/2fa/disable', emp.token, { password: 'wrong-password', code: backupCodes[2] });
    check('disable with wrong password rejected', r.s === 400, r);
    r = await post('/v2/platform/2fa/disable', emp.token, { password: DEFAULT_PASSWORD, code: badCode });
    check('disable with wrong code rejected', r.s === 400, r);
    r = await post('/v2/platform/2fa/disable', emp.token, { password: DEFAULT_PASSWORD });
    check('disable without code → 422', r.s === 422, r);
    r = await post('/v2/platform/2fa/disable', emp.token, { password: DEFAULT_PASSWORD, code: backupCodes[2] });
    check('disable with password + backup code', r.s === 200 && r.d.enabled === false, r);
    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    check('login without 2FA keeps the classic response', r.s === 200 && !!r.d.access_token && r.d.user?.role === 'employee' && !r.d.two_factor_required, r);
    emp.token = r.d.access_token;

    // Require 2FA for admins
    r = await put('/v2/platform/security/settings', emp.token, { require_admin_2fa: true });
    check('employee cannot change security settings', r.s === 403, r);
    r = await put('/v2/platform/security/settings', admin, { require_admin_2fa: 'yes please' });
    check('invalid settings → 422', r.s === 422, r);
    r = await put('/v2/platform/security/settings', admin, { require_admin_2fa: true });
    check('admin enables "require 2FA for admins"', r.s === 200 && r.d.require_admin_2fa === true, r);
    r = await post('/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('admin without 2FA is told to enrol after login', r.s === 200 && !!r.d.access_token && r.d.two_factor_setup_required === true, r);
    r = await get('/auth/me', admin);
    check('/auth/me flags two_factor_setup_required for the admin', r.d?.two_factor_setup_required === true, r.d);
    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    check('non-admins are not prompted', r.s === 200 && !r.d.two_factor_setup_required, r);
    await put('/v2/platform/security/settings', admin, { require_admin_2fa: false });

    // Deactivated accounts
    const leaver = await createUser(admin, { role: 'employee', name: 'Lee Leaver' });
    await withDb(db => db.collection('users').updateOne({ email: leaver.email }, { $set: { is_active: false } }));
    r = await post('/auth/login', null, { email: leaver.email, password: DEFAULT_PASSWORD });
    check('deactivated user cannot log in (clear message)', r.s === 403 && r.d.error_code === 'ACCOUNT_DISABLED' && /deactivated/i.test(r.d.detail), r);
    r = await get('/auth/me', leaver.token);
    check('deactivated user\'s existing token is rejected', r.s === 401 && r.d.error_code === 'ACCOUNT_DISABLED', r);
    r = await get('/time/today', leaver.token);
    check('…on every route (middleware)', r.s === 401, r);

    r = await get('/v2/platform/security/users', admin);
    const secUsers = JSON.stringify(r.d || []);
    check('admin user list exposes 2FA status but no secrets', r.s === 200 && r.d.some(u => u.email === mgr.email && u.two_factor_enabled) && !/hashed_password|secret_enc|backup_codes|\$2[aby]\$/.test(secUsers), r.s);
    r = await get('/v2/platform/security/users', emp.token);
    check('employee cannot list users', r.s === 403, r);

    // =====================================================================
    section('PL-4 Single sign-on');
    r = await get('/auth/sso/config', null);
    check('public SSO config endpoint (primary: env not set → disabled)', r.s === 200 && typeof r.d.google?.enabled === 'boolean' && typeof r.d.microsoft?.enabled === 'boolean', r);
    r = await s2('GET', '/auth/sso/config');
    check('configured providers are listed', r.d?.google?.enabled && r.d.google.client_id === GOOGLE_CLIENT && r.d.microsoft?.enabled && r.d.microsoft.tenant === 'common' && /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/.test(r.d.microsoft.authorize_url), r.d);
    const nonce = async () => (await s2('GET', '/auth/sso/nonce')).d.nonce;
    const ssoUser = await createUser(admin, { role: 'employee', name: 'Sam Sso' });

    let n = await nonce();
    let tok = signJwt(googleClaims(ssoUser.email, n));
    r = await s2('POST', '/auth/sso/google', null, { id_token: tok, nonce: n });
    check('valid Google ID token signs in the matching user', r.s === 200 && !!r.d.access_token && r.d.user?.email === ssoUser.email, r);
    const ssoToken = r.d?.access_token;
    r = await get('/auth/me', ssoToken);
    check('issued token is a normal access token', r.s === 200 && r.d.email === ssoUser.email, r.s);
    r = await s2('POST', '/auth/sso/google', null, { id_token: tok, nonce: n });
    check('replaying the same ID token / nonce fails', r.s === 401 && r.d.reason === 'bad_nonce', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, n, { aud: 'someone-else' })), nonce: n });
    check('wrong audience rejected', r.s === 401 && r.d.reason === 'wrong_audience', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, n, { exp: nowSec() - 3600, iat: nowSec() - 7200 })), nonce: n });
    check('expired token rejected', r.s === 401 && r.d.reason === 'expired', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, n), { key: otherKey }), nonce: n });
    check('bad signature rejected', r.s === 401 && r.d.reason === 'bad_signature', r);
    n = await nonce();
    const tampered = signJwt(googleClaims(ssoUser.email, n)).split('.');
    tampered[1] = b64url(googleClaims(admin === null ? '' : ADMIN_EMAIL, n));
    r = await s2('POST', '/auth/sso/google', null, { id_token: tampered.join('.'), nonce: n });
    check('tampered payload (email swapped to admin) rejected', r.s === 401 && r.d.reason === 'bad_signature', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, n), { alg: 'none' }), nonce: n });
    check('alg "none" rejected', r.s === 401 && r.d.reason === 'bad_algorithm', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, n, { iss: 'https://evil.example.com' })), nonce: n });
    check('wrong issuer rejected', r.s === 401 && r.d.reason === 'wrong_issuer', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, n, { email_verified: false })), nonce: n });
    check('unverified Google email rejected', r.s === 401 && r.d.reason === 'email_unverified', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, n)), nonce: `${n}x` });
    check('nonce mismatch rejected', r.s === 401 && r.d.reason === 'bad_nonce', r);
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(ssoUser.email, 'forged.9999999999.AAAA')), nonce: 'forged.9999999999.AAAA' });
    check('nonce not issued by the server rejected', r.s === 401 && r.d.reason === 'bad_nonce', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims('nobody@unknown-domain.test', n)), nonce: n });
    check('unknown user rejected (auto-provisioning off by default)', r.s === 401 && r.d.error_code === 'USER_NOT_FOUND', r);
    r = await s2('POST', '/auth/sso/google', null, { nonce: 'x' });
    check('missing id_token → 422', r.s === 422, r);
    r = await post('/auth/sso/google', null, { id_token: tok, nonce: 'x' });
    check('primary (not configured) refuses Google sign-in', r.s === 400 || r.s === 401, r);
    r = await s2('POST', '/auth/sso/github', null, { id_token: tok, nonce: 'x' });
    check('unknown provider → 404', r.s === 404, r);

    n = await nonce();
    r = await s2('POST', '/auth/sso/microsoft', null, { id_token: signJwt(msClaims(ssoUser.email, n)), nonce: n });
    check('valid Microsoft ID token signs in', r.s === 200 && !!r.d.access_token, r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/microsoft', null, { id_token: signJwt(msClaims(ssoUser.email, n, { xms_edov: undefined })), nonce: n });
    check('multi-tenant Microsoft token without verified-email signal rejected', r.s === 401 && r.d.reason === 'email_unverified', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/microsoft', null, { id_token: signJwt(msClaims(ssoUser.email, n, { iss: 'https://login.microsoftonline.com/not-a-tenant/v2.0' })), nonce: n });
    check('Microsoft token with bad issuer rejected', r.s === 401 && r.d.reason === 'wrong_issuer', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/microsoft', null, { id_token: signJwt(msClaims(ssoUser.email, n, { aud: GOOGLE_CLIENT })), nonce: n });
    check('Microsoft token for another app rejected', r.s === 401 && r.d.reason === 'wrong_audience', r);

    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(mgr.email, n)), nonce: n });
    check('SSO respects 2FA (challenge instead of token)', r.s === 200 && r.d.two_factor_required === true && !r.d.access_token, r);
    const ssoChallenge = r.d?.challenge_token;
    r = await post('/auth/2fa/verify', null, { challenge_token: ssoChallenge, code: mgrNewCodes[1] });
    check('…and completes after the second factor', r.s === 200 && !!r.d.access_token, r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims(leaver.email, n)), nonce: n });
    check('deactivated user blocked on SSO too', r.s === 403 && r.d.error_code === 'ACCOUNT_DISABLED', r);

    r = await s2('PUT', '/v2/platform/security/settings', admin, { sso_auto_provision: true, sso_allowed_domains: [] });
    check('auto-provisioning needs at least one domain', r.s === 400, r);
    r = await s2('PUT', '/v2/platform/security/settings', admin, { sso_auto_provision: true, sso_allowed_domains: ['newco-test.org'] });
    check('admin enables domain auto-provisioning', r.s === 200 && r.d.sso_auto_provision === true, r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims('new.joiner@newco-test.org', n)), nonce: n });
    const provisioned = await withDb(db => db.collection('users').findOne({ email: 'new.joiner@newco-test.org' }));
    check('allowed-domain user is auto-provisioned as an employee', r.s === 200 && !!r.d.access_token && provisioned?.role === 'employee', r);
    n = await nonce();
    r = await s2('POST', '/auth/sso/google', null, { id_token: signJwt(googleClaims('outsider@other-test.org', n)), nonce: n });
    check('other domains still rejected', r.s === 401, r);
    await s2('PUT', '/v2/platform/security/settings', admin, { sso_auto_provision: false });

    // =====================================================================
    section('PL-3 Two-factor authentication — admin reset');
    const mgrUser = await withDb(db => db.collection('users').findOne({ email: mgr.email }));
    r = await del(`/v2/platform/2fa/users/${mgrUser.id}`, emp.token);
    check('employee cannot reset someone\'s 2FA', r.s === 403, r);
    const adminUser = await withDb(db => db.collection('users').findOne({ email: ADMIN_EMAIL }));
    r = await del(`/v2/platform/2fa/users/${adminUser.id}`, admin);
    check('admin cannot reset own 2FA via the admin endpoint', r.s === 400, r);
    r = await del('/v2/platform/2fa/users/does-not-exist', admin);
    check('unknown user → 404', r.s === 404, r);
    r = await del(`/v2/platform/2fa/users/${mgrUser.id}`, admin);
    check('admin resets a user\'s 2FA', r.s === 200, r);
    r = await post('/auth/login', null, { email: mgr.email, password: DEFAULT_PASSWORD });
    check('user signs in without 2FA after reset', r.s === 200 && !!r.d.access_token, r);
    mgr.token = r.d.access_token;

    // =====================================================================
    section('PL-5 Custom roles and permissions');
    r = await get('/v2/platform/permissions', emp.token);
    check('permission catalog available; employee has none by default', r.s === 200 && r.d.permissions.some(p => p.key === 'audit.view') && Array.isArray(r.d.mine) && r.d.mine.length === 0, r.d);
    r = await get('/auth/me', mgr.token);
    check('manager defaults include leave.approve', r.d?.permissions?.includes('leave.approve') && !r.d.permissions.includes('payroll.run'), r.d?.permissions);
    r = await get('/auth/me', admin);
    check('admin holds every permission', r.d?.permissions?.includes('settings.manage') && r.d.permissions.includes('audit.view'), r.d?.permissions);
    r = await get('/v2/platform/roles', emp.token);
    check('employee cannot list roles', r.s === 403, r);
    r = await post('/v2/platform/roles', emp.token, { name: 'Hack', base_role: 'admin', permissions: [] });
    check('employee cannot create roles', r.s === 403, r);
    r = await post('/v2/platform/roles', admin, { name: 'Bad', base_role: 'employee', permissions: ['root.everything'] });
    check('unknown permission → 422', r.s === 422, r);
    r = await post('/v2/platform/roles', admin, { name: 'Bad', base_role: 'superuser', permissions: [] });
    check('invalid base role → 422', r.s === 422, r);
    r = await post('/v2/platform/roles', admin, { name: 'Auditor', description: 'Reads the audit log', base_role: 'employee', permissions: ['audit.view', 'reports.view', 'payroll.view'] });
    check('admin creates a custom role', r.s === 201 && r.d.id && r.d.permissions.length === 3, r);
    const auditorId = r.d?.id;
    r = await post('/v2/platform/roles', admin, { name: 'auditor', base_role: 'employee' });
    check('duplicate role name (case-insensitive) → 409', r.s === 409, r);
    r = await get(`/v2/platform/audit-logs`, emp.token);
    check('before assignment the employee cannot read the audit log', r.s === 403, r);
    const empUser = await withDb(db => db.collection('users').findOne({ email: emp.email }));
    r = await put('/v2/platform/roles-assign', admin, { user_id: empUser.id, role_id: auditorId });
    check('assign custom role → base role + custom_role_id', r.s === 200 && r.d.role === 'employee' && r.d.custom_role_id === auditorId && r.d.permissions.includes('audit.view'), r);
    r = await get('/auth/me', emp.token);
    check('/auth/me returns effective permissions and role name', r.d?.permissions?.includes('audit.view') && r.d.custom_role_name === 'Auditor' && r.d.role === 'employee', r.d && { p: r.d.permissions, n: r.d.custom_role_name });
    r = await get('/v2/platform/audit-logs?limit=1', emp.token);
    check('requirePermission lets the custom role through', r.s === 200, r.s);
    r = await get('/v2/platform/roles', emp.token);
    check('existing requireRole checks still apply (employee base role)', r.s === 403, r);
    r = await get('/v2/platform/roles', admin);
    check('role list shows member count', r.d?.find?.(x => x.id === auditorId)?.member_count === 1, r.d);
    r = await put(`/v2/platform/roles/${auditorId}`, admin, { base_role: 'manager' });
    const empNow = await withDb(db => db.collection('users').findOne({ email: emp.email }));
    const empProfile = await withDb(db => db.collection('employees').findOne({ email: emp.email }));
    check('changing base role moves members (users + employees)', r.s === 200 && r.d.members_moved === 1 && empNow.role === 'manager' && empProfile.role === 'manager', { r: r.d, role: empNow.role });
    r = await get('/time/requests', emp.token);
    check('member now passes requireRole([admin, manager])', r.s === 200, r.s);
    r = await put(`/v2/platform/roles/${auditorId}`, admin, { permissions: ['not.real'] });
    check('update with unknown permission → 422', r.s === 422, r);
    r = await del(`/v2/platform/roles/${auditorId}`, admin);
    check('cannot delete a role that is assigned', r.s === 409, r);
    r = await put('/v2/platform/roles-assign', admin, { user_id: adminUser.id, role_id: auditorId });
    check('admin cannot change their own role', r.s === 400, r);
    r = await put('/v2/platform/roles-assign', admin, { user_id: 'nope', role_id: auditorId });
    check('assign to unknown user → 404', r.s === 404, r);
    r = await put('/v2/platform/roles-assign', admin, { user_id: empUser.id, role_id: null, role: 'employee' });
    check('unassign back to a built-in role', r.s === 200 && r.d.role === 'employee' && r.d.custom_role_id === null, r);
    r = await del(`/v2/platform/roles/${auditorId}`, admin);
    check('delete unassigned role', r.s === 200, r);
    const { requirePermission, hasPermission, requireRole } = require('../../middleware/roleCheck');
    check('roleCheck exports keep working (requireRole, requirePermission, hasPermission)', typeof requireRole(['admin']) === 'function' && typeof requirePermission('audit.view') === 'function' && await hasPermission({ role: 'admin' }, 'payroll.run') === true && await hasPermission({ role: 'employee' }, 'payroll.run') === false);

    // =====================================================================
    section('PL-6 Integrations');
    r = await post('/v2/platform/integrations/targets', emp.token, { type: 'slack', name: 'x', url: 'https://hooks.slack.com/services/a', events: ['leave.approved'] });
    check('employee cannot manage integrations', r.s === 403, r);
    if (!primaryAllowsPrivate) {
      r = await post('/v2/platform/integrations/targets', admin, { type: 'slack', name: 'Local', url: `${RX}/slack`, events: ['leave.approved'] });
      check('Slack target must be a Slack webhook URL (primary)', r.s === 400, r);
      r = await post('/v2/platform/integrations/targets', admin, { type: 'teams', name: 'Bad', url: 'https://example.com/hook', events: ['leave.approved'] });
      check('Teams target must be a Teams/Office URL', r.s === 400, r);
    }
    r = await post('/v2/platform/integrations/targets', admin, { type: 'discord', name: 'x', url: 'https://hooks.slack.com/services/a', events: ['leave.approved'] });
    check('unknown integration type → 422', r.s === 422, r);
    r = await post('/v2/platform/integrations/targets', admin, { type: 'slack', name: 'x', url: 'https://hooks.slack.com/services/a', events: ['Not An Event!'] });
    check('invalid event name → 422', r.s === 422, r);
    r = await s2('POST', '/v2/platform/integrations/targets', admin, { type: 'slack', name: 'HR channel', url: `${RX}/slack`, events: ['leave.approved', 'employee.exited'] });
    const slackId = r.d?.id;
    check('create Slack target; URL never returned', r.s === 201 && !!slackId && !('url' in r.d) && !('url_enc' in r.d) && /…/.test(r.d.url_hint), r);
    r = await s2('POST', '/v2/platform/integrations/targets', admin, { type: 'teams', name: 'Teams HR', url: `${RX}/teams`, events: ['candidate.hired'] });
    const teamsId = r.d?.id;
    received.length = 0;
    r = await s2('POST', `/v2/platform/integrations/targets/${slackId}/test`, admin);
    const slackMsg = received.find(x => x.path === '/slack');
    const slackBody = slackMsg ? JSON.parse(slackMsg.body) : null;
    check('Slack test message delivered with text + blocks', r.s === 200 && r.d.status === 'success' && typeof slackBody?.text === 'string' && Array.isArray(slackBody.blocks), { r: r.d, slackBody });
    r = await s2('POST', `/v2/platform/integrations/targets/${teamsId}/test`, admin);
    const teamsMsg = received.find(x => x.path === '/teams');
    const teamsBody = teamsMsg ? JSON.parse(teamsMsg.body) : null;
    check('Teams test message delivered as a MessageCard', r.s === 200 && teamsBody?.['@type'] === 'MessageCard' && /Xeno-HR/.test(teamsBody.title), teamsBody);
    received.length = 0;
    r = await s2('POST', '/v2/platform/events/test', admin, { event: 'leave.approved' });
    await sleep(800);
    check('domain event fans out to subscribed targets only', r.s === 202 && received.some(x => x.path === '/slack' && /Leave approved/.test(x.body)) && !received.some(x => x.path === '/teams'), received.map(x => x.path));
    r = await s2('POST', '/v2/platform/events/test', admin, { event: 'made.up' });
    check('test event must be in the catalog → 422', r.s === 422, r);
    r = await s2('PUT', `/v2/platform/integrations/targets/${slackId}`, admin, { enabled: false });
    received.length = 0;
    await s2('POST', '/v2/platform/events/test', admin, { event: 'leave.approved' });
    await sleep(600);
    check('disabled target receives nothing', r.s === 200 && r.d.enabled === false && !received.some(x => x.path === '/slack'), received.map(x => x.path));
    r = await s2('GET', `/v2/platform/integrations/targets/${slackId}/deliveries`, admin);
    check('integration delivery log', r.s === 200 && r.d.length >= 2 && r.d.every(x => !('payload' in x)), r.d?.length);
    r = await s2('DELETE', `/v2/platform/integrations/targets/${teamsId}`, admin);
    check('delete target', r.s === 200, r);

    // Calendar feed
    const today = new Date();
    const futureDate = (days) => new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
    const empDoc = await withDb(db => db.collection('employees').findOne({ email: emp.email }));
    const mgrDoc = await withDb(db => db.collection('employees').findOne({ email: mgr.email }));
    await post('/holidays', admin, { name: 'Founders Day', date: futureDate(20), type: 'public' });
    await withDb(async db => {
      await db.collection('leaves').insertMany([
        { id: crypto.randomUUID(), employee_id: empDoc.id, employee_email: emp.email, employee_name: emp.name, leave_type: 'casual_leave', dates: [`${futureDate(5)}T00:00:00.000Z`, `${futureDate(6)}T00:00:00.000Z`], days_count: 2, status: 'approved', created_at: new Date() },
        { id: crypto.randomUUID(), employee_id: empDoc.id, employee_email: emp.email, employee_name: emp.name, leave_type: 'pending_trip_leave', dates: [`${futureDate(9)}T00:00:00.000Z`], days_count: 1, status: 'pending', created_at: new Date() },
        { id: crypto.randomUUID(), employee_id: mgrDoc.id, employee_email: mgr.email, employee_name: mgr.name, leave_type: 'secret_sabbatical', dates: [`${futureDate(7)}T00:00:00.000Z`], days_count: 1, status: 'approved', created_at: new Date() }
      ]);
      await db.collection('interviews').insertOne({ id: crypto.randomUUID(), candidate_name: 'Cara Candidate', job_title: 'Backend Engineer', scheduled_at: new Date(today.getTime() + 3 * 86400000), duration_minutes: 45, interviewer_emails: [emp.email], mode: 'video', meeting_link: 'https://meet.example.com/abc', status: 'scheduled' });
      await db.collection('one_on_ones').insertOne({ id: crypto.randomUUID(), manager_email: mgr.email, employee_email: emp.email, scheduled_at: new Date(today.getTime() + 2 * 86400000), duration_minutes: 30, status: 'scheduled' });
    });
    r = await get('/v2/platform/calendar/feed', emp.token);
    check('calendar feed inactive by default', r.s === 200 && r.d.active === false, r);
    r = await post('/v2/platform/calendar/feed', emp.token);
    const feedUrl = r.d?.url;
    check('create feed returns a secret ICS URL (+ webcal)', r.s === 201 && /\/api\/v2\/platform\/calendar\/cal_[A-Za-z0-9_-]+\.ics$/.test(feedUrl) && /^webcal:/.test(r.d.webcal_url), r);
    const feedPath = feedUrl ? new URL(feedUrl).pathname.replace(/^\/api/, '') : '';
    let ics = await rawGet(BASE + feedPath);
    check('feed is served without login as text/calendar', ics.s === 200 && /text\/calendar/.test(ics.headers.get('content-type')) && ics.text.startsWith('BEGIN:VCALENDAR\r\n') && ics.text.trim().endsWith('END:VCALENDAR'), ics.s);
    const unfolded = ics.text.replace(/\r\n /g, '');
    check('contains own approved leave as an all-day range', /SUMMARY:Casual Leave/.test(unfolded) && unfolded.includes(`DTSTART;VALUE=DATE:${futureDate(5).replace(/-/g, '')}`) && unfolded.includes(`DTEND;VALUE=DATE:${futureDate(7).replace(/-/g, '')}`), unfolded.slice(0, 600));
    check('contains holidays, interviews and 1:1s', /SUMMARY:Founders Day/.test(unfolded) && /SUMMARY:Interview: Cara Candidate \(Backend Engineer\)/.test(unfolded) && /SUMMARY:1:1 with Mira Manager/.test(unfolded), unfolded.slice(0, 1500));
    check("excludes other people's leave and pending leave", !/Secret Sabbatical/i.test(unfolded) && !/Pending Trip/i.test(unfolded));
    check('lines are folded at 75 octets', ics.text.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
    r = await get('/v2/platform/calendar/feed', emp.token);
    check('feed status never returns the token', r.d?.active === true && !JSON.stringify(r.d).includes(feedUrl.split('/').pop().replace('.ics', '')) && !('token_hash' in r.d), r.d);
    r = await post('/v2/platform/calendar/feed', emp.token);
    const newFeedPath = new URL(r.d.url).pathname.replace(/^\/api/, '');
    check('regenerating invalidates the old URL', (await rawGet(BASE + feedPath)).s === 404 && (await rawGet(BASE + newFeedPath)).s === 200);
    check('unknown / malformed tokens → 404', (await rawGet(`${BASE}/v2/platform/calendar/cal_${'x'.repeat(32)}.ics`)).s === 404 && (await rawGet(`${BASE}/v2/platform/calendar/../../auth/me`)).s !== 200);
    r = await del('/v2/platform/calendar/feed', emp.token);
    check('deleting the feed disables it', r.s === 200 && (await rawGet(BASE + newFeedPath)).s === 404);

    // Accounting export
    r = await get('/v2/platform/accounting/tally?month=2026-07', admin);
    check('no payslips → 404 with clear message', r.s === 404 && r.d.error_code === 'NO_PAYSLIPS', r);
    r = await get('/v2/platform/accounting/summary?month=2026-07', admin);
    check('summary for an empty month', r.s === 200 && r.d.employees === 0 && r.d.lines.length === 0, r);
    r = await get('/v2/platform/accounting/tally?month=2026-13', admin);
    check('invalid month → 422', r.s === 422, r);
    r = await get('/v2/platform/accounting/tally?month=2026-08', emp.token);
    check('employee cannot export payroll', r.s === 403, r);
    await withDb(db => db.collection('payslips').insertMany([
      { id: crypto.randomUUID(), run_id: 'run-1', month: '2026-08', employee_uid: empDoc.employee_id, employee_name: emp.name, department: 'Engineering', gross_earnings: 50000, total_deductions: 6200, net_pay: 43800, lop_days: 0, earnings: [{ name: 'Basic', amount: 25000 }, { name: 'HRA', amount: 25000 }], deductions: [{ name: 'PF', amount: 1800 }, { name: 'TDS', amount: 4200 }, { name: 'Professional Tax', amount: 200 }], employer_contributions: { pf: 1800, esi: 0 }, status: 'locked' },
      { id: crypto.randomUUID(), run_id: 'run-1', month: '2026-08', employee_uid: mgrDoc.employee_id, employee_name: mgr.name, department: 'Engineering', gross_earnings: 20000.55, total_deductions: 1950.15, net_pay: 18050.4, lop_days: 1, earnings: [{ name: 'Basic', amount: 20000.55 }], deductions: [{ name: 'PF', amount: 1800 }, { name: 'ESI', amount: 150.15 }], employer_contributions: { pf: 1800, esi: 650.02 }, status: 'locked' },
      { id: crypto.randomUUID(), run_id: 'run-2', month: '2026-08', employee_uid: 'DRAFT-1', employee_name: 'Draft Person', gross_earnings: 99999, total_deductions: 0, net_pay: 99999, earnings: [], deductions: [], employer_contributions: {}, status: 'draft' }
    ]));
    r = await get('/v2/platform/accounting/summary?month=2026-08', admin);
    check('journal balances and excludes draft payslips', r.s === 200 && r.d.employees === 2 && r.d.totals.debit === r.d.totals.credit && r.d.totals.net === 61850.4 && r.d.lines.some(l => l.ledger === 'TDS Payable' && l.credit === 4200), r.d);
    let raw = await api('GET', '/v2/platform/accounting/tally?month=2026-08', admin, undefined, { raw: true });
    const tallyXml = raw.buf?.toString('utf8') || '';
    const amounts = [...tallyXml.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map(m => Number(m[1]));
    check('Tally XML journal voucher (balanced, debits negative)', raw.s === 200 && /<TALLYREQUEST>Import Data<\/TALLYREQUEST>/.test(tallyXml) && /VCHTYPE="Journal"/.test(tallyXml) && /<DATE>20260831<\/DATE>/.test(tallyXml) && Math.abs(amounts.reduce((a, b) => a + b, 0)) < 0.001 && amounts.some(a => a < 0), tallyXml.slice(0, 400));
    raw = await api('GET', '/v2/platform/accounting/zoho?month=2026-08', admin, undefined, { raw: true });
    const zoho = raw.buf?.toString('utf8') || '';
    const zRows = zoho.trim().split('\r\n').slice(1).map(l => l.split(','));
    const zDebit = zRows.reduce((s, c) => s + Number(c[7] || 0), 0);
    const zCredit = zRows.reduce((s, c) => s + Number(c[8] || 0), 0);
    check('Zoho Books journal CSV (balanced)', raw.s === 200 && zoho.startsWith('Journal Date,Reference Number,Notes,Journal Type,Currency,Account,Description,Debit,Credit') && Math.abs(zDebit - zCredit) < 0.001 && zDebit > 0, zoho.slice(0, 300));

    // =====================================================================
    section('PL-7 Public API and webhooks');
    r = await post('/v2/platform/api-keys', emp.token, { name: 'Mine', scopes: ['read:employees'] });
    check('employee cannot create API keys', r.s === 403, r);
    r = await post('/v2/platform/api-keys', admin, { name: 'Bad', scopes: ['write:everything'] });
    check('unknown scope → 422', r.s === 422, r);
    r = await post('/v2/platform/api-keys', admin, { name: 'Bad', scopes: [] });
    check('at least one scope → 422', r.s === 422, r);
    r = await post('/v2/platform/api-keys', admin, { name: 'BI export', scopes: ['read:employees', 'read:leaves'] });
    const apiKey = r.d?.key;
    const keyId = r.d?.id;
    check('API key created and shown once', r.s === 201 && /^xhr_[a-z0-9]{8}_/.test(apiKey) && !('key_hash' in r.d), r);
    r = await get('/v2/platform/api-keys', admin);
    check('key list shows prefix only (no key, no hash)', r.s === 200 && r.d.keys.some(k => k.id === keyId && k.display_prefix.startsWith('xhr_')) && !JSON.stringify(r.d).includes(apiKey) && !JSON.stringify(r.d).includes('key_hash'), r.d);
    const keyDoc = await withDb(db => db.collection('api_keys').findOne({ id: keyId }));
    check('stored as SHA-256 hash', keyDoc.key_hash === crypto.createHash('sha256').update(apiKey).digest('hex') && !JSON.stringify(keyDoc).includes(apiKey));
    const pub = (path, key) => api('GET', path, null, undefined, { headers: key ? { 'X-API-Key': key } : {} });
    r = await pub('/v2/platform/public/employees?limit=2', apiKey);
    const empRow = r.d?.data?.[0] || {};
    check('public employees: paginated, minimal fields', r.s === 200 && r.d.data.length === 2 && r.d.has_more === true && r.d.total >= 4 && 'full_name' in empRow && !('phone' in empRow) && !('leave_balance' in empRow) && !('monthly_salary' in empRow) && !('_id' in empRow) && !('id' in empRow), r.d);
    r = await pub('/v2/platform/public/employees');
    check('missing key → 401', r.s === 401, r);
    r = await pub('/v2/platform/public/employees', `${apiKey.slice(0, 13)}${'A'.repeat(43)}`);
    check('wrong secret with a valid prefix → 401', r.s === 401, r);
    r = await pub('/v2/platform/public/employees', 'Bearer something');
    check('malformed key → 401', r.s === 401, r);
    r = await pub('/v2/platform/public/attendance?from=2026-08-01&to=2026-08-31', apiKey);
    check('key without read:attendance → 403', r.s === 403, r);
    r = await pub('/v2/platform/public/leaves?status=approved', apiKey);
    check('public leaves (no reasons / internal ids)', r.s === 200 && r.d.data.some(l => l.employee_email === emp.email && l.start_date) && r.d.data.every(l => !('reason' in l) && !('employee_id' in l)), r.d);
    r = await pub('/v2/platform/public/leaves?limit=500', apiKey);
    check('limit above 100 → 422', r.s === 422, r);
    r = await get('/v2/platform/public/employees', admin);
    check('a user JWT is not an API key', r.s === 401, r);
    r = await post('/v2/platform/api-keys', admin, { name: 'Attendance', scopes: ['read:attendance'] });
    const attKey = r.d.key;
    r = await pub('/v2/platform/public/attendance', attKey);
    check('attendance requires from/to → 422', r.s === 422, r);
    r = await pub('/v2/platform/public/attendance?from=2026-01-01&to=2026-12-31', attKey);
    check('attendance range capped at 92 days', r.s === 400, r);
    r = await pub('/v2/platform/public/attendance?from=2026-08-01&to=2026-08-31', attKey);
    check('attendance works with the scope', r.s === 200 && Array.isArray(r.d.data), r);
    await sleep(200);
    const used = await withDb(db => db.collection('api_keys').findOne({ id: keyId }));
    check('last_used_at recorded', !!used.last_used_at);
    r = await del(`/v2/platform/api-keys/${keyId}`, admin);
    check('revoke key', r.s === 200 && r.d.status === 'revoked', r);
    r = await pub('/v2/platform/public/employees', apiKey);
    check('revoked key → 401', r.s === 401, r);
    r = await del(`/v2/platform/api-keys/${keyId}`, admin);
    check('revoking twice → 404', r.s === 404, r);

    // SSRF (unit) — with private targets NOT allowed
    const savedAllow = process.env.ALLOW_PRIVATE_WEBHOOKS;
    delete process.env.ALLOW_PRIVATE_WEBHOOKS;
    const blocked = ['http://example.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'file:///etc/passwd', 'ftp://example.com', 'https://user:pw@example.com/x', 'https://example.com:8443/x', 'https://intranet/x'];
    const notBlocked = blocked.filter(u => { try { outbound.assertSafeUrl(u); return true; } catch { return false; } });
    check('SSRF: unsafe URLs rejected', notBlocked.length === 0, notBlocked);
    let okUrl = true;
    try { outbound.assertSafeUrl('https://hooks.example.com/xeno'); } catch { okUrl = false; }
    check('SSRF: public https URL accepted', okUrl);
    check('SSRF: private address classification', ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:a00:1'].every(outbound.isPrivateAddress) && !['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'].some(outbound.isPrivateAddress));
    let dnsBlocked = false;
    try { await outbound.postJson('https://localtest.me/x', '{}'); } catch (e) { dnsBlocked = /private|not allowed|ENOTFOUND|EAI_AGAIN/i.test(e.message); }
    check('SSRF: hostnames resolving to loopback are refused at connect time', dnsBlocked);
    if (savedAllow !== undefined) process.env.ALLOW_PRIVATE_WEBHOOKS = savedAllow;

    r = await post('/v2/platform/webhooks', emp.token, { url: 'https://example.com/hook', events: ['leave.approved'] });
    check('employee cannot create webhooks', r.s === 403, r);
    r = await post('/v2/platform/webhooks', admin, { url: 'ftp://example.com/hook', events: ['leave.approved'] });
    check('non-http(s) webhook URL rejected', r.s === 400 && r.d.error_code === 'UNSAFE_URL', r);
    if (!primaryAllowsPrivate) {
      r = await post('/v2/platform/webhooks', admin, { url: `${RX}/hook`, events: ['leave.approved'] });
      check('private / loopback webhook URL rejected (default config)', r.s === 400 && r.d.error_code === 'UNSAFE_URL', r);
    }
    r = await post('/v2/platform/webhooks', admin, { url: 'https://example.com/hook', events: [] });
    check('webhook needs at least one event → 422', r.s === 422, r);
    r = await s2('POST', '/v2/platform/webhooks', admin, { url: `${RX}/hook`, description: 'Receiver', events: ['leave.approved'] });
    let whSecret = r.d?.secret;
    const whId = r.d?.id;
    check('create webhook; secret shown once', r.s === 201 && /^whsec_/.test(whSecret) && !('secret_enc' in r.d), r);
    r = await s2('GET', '/v2/platform/webhooks', admin);
    check('webhook list hides the secret', r.s === 200 && !JSON.stringify(r.d).includes(whSecret) && !JSON.stringify(r.d).includes('secret_enc'), r.d);
    const whDoc = await withDb(db => db.collection('webhook_endpoints').findOne({ id: whId }));
    check('webhook secret encrypted at rest', !JSON.stringify(whDoc).includes(whSecret));

    const verifySig = (rec, sec) => {
      const ts = rec.headers['x-xenohr-timestamp'];
      const expected = `sha256=${crypto.createHmac('sha256', sec).update(`${ts}.${rec.body}`).digest('hex')}`;
      return rec.headers['x-xenohr-signature'] === expected && Math.abs(nowSec() - Number(ts)) < 60;
    };
    received.length = 0;
    r = await s2('POST', `/v2/platform/webhooks/${whId}/ping`, admin);
    const ping = received.find(x => x.path === '/hook');
    check('ping delivered with a valid HMAC-SHA256 signature + timestamp', r.s === 200 && r.d.status === 'success' && r.d.response_status === 200 && ping && verifySig(ping, whSecret) && JSON.parse(ping.body).event === 'ping' && ping.headers['x-xenohr-event'] === 'ping', { d: r.d, h: ping?.headers });
    check('signature does not verify with another secret', ping && !verifySig(ping, 'whsec_wrong'));
    received.length = 0;
    await s2('POST', '/v2/platform/events/test', admin, { event: 'leave.approved' });
    await sleep(800);
    const evt = received.find(x => x.path === '/hook');
    const evtBody = evt ? JSON.parse(evt.body) : null;
    check('subscribed event delivered as signed JSON { id, event, created_at, data }', evt && verifySig(evt, whSecret) && evtBody.event === 'leave.approved' && evtBody.id && evtBody.data?.test === true, evtBody);
    r = await s2('POST', `/v2/platform/webhooks/${whId}/rotate-secret`, admin);
    const rotated = r.d?.secret;
    received.length = 0;
    await s2('POST', `/v2/platform/webhooks/${whId}/ping`, admin);
    const ping2 = received.find(x => x.path === '/hook');
    check('rotated secret signs subsequent deliveries', rotated && rotated !== whSecret && ping2 && verifySig(ping2, rotated) && !verifySig(ping2, whSecret));
    whSecret = rotated;

    r = await s2('POST', '/v2/platform/webhooks', admin, { url: `${RX}/fail`, events: ['payroll.run.locked'] });
    const failId = r.d.id;
    r = await s2('POST', '/v2/platform/webhooks', admin, { url: `${RX}/flaky`, events: ['payroll.run.locked'] });
    const flakyId = r.d.id;
    await s2('POST', '/v2/platform/events/test', admin, { event: 'payroll.run.locked' });
    await sleep(2500);
    r = await s2('GET', `/v2/platform/webhooks/${failId}/deliveries`, admin);
    const failed = r.d?.[0];
    check('failing endpoint retried 3 times with backoff, then marked failed', failed?.status === 'failed' && failed.attempts === 3 && failed.attempt_log.length === 3 && failed.attempt_log.every(a => a.status === 500) && failed.response_status === 500, failed);
    const gaps = failed ? failed.attempt_log.slice(1).map((a, i) => new Date(a.at) - new Date(failed.attempt_log[i].at)) : [];
    check('backoff grows between attempts', gaps.length === 2 && gaps[1] > gaps[0], gaps);
    r = await s2('GET', `/v2/platform/webhooks/${flakyId}/deliveries`, admin);
    check('transient failure succeeds on retry', r.d?.[0]?.status === 'success' && r.d[0].attempts === 2, r.d?.[0]);
    r = await s2('POST', '/v2/platform/webhooks', admin, { url: `${RX}/redirect`, events: ['leave.approved'] });
    const redirId = r.d.id;
    r = await s2('POST', `/v2/platform/webhooks/${redirId}/ping`, admin);
    check('redirects are not followed (3xx = failure)', r.d?.status === 'failed' && r.d.response_status === 302, r.d);
    r = await s2('POST', `/v2/platform/webhooks/deliveries/${failed?.id}/redeliver`, admin);
    check('manual redelivery creates a new attempt', r.s === 200 && r.d.id !== failed?.id && r.d.event === 'payroll.run.locked', r);
    r = await s2('PUT', `/v2/platform/webhooks/${whId}`, admin, { url: 'gopher://x' });
    check('update with unsafe URL rejected', r.s === 400, r);
    r = await s2('DELETE', `/v2/platform/webhooks/${failId}`, admin);
    check('delete webhook', r.s === 200 && (await s2('POST', `/v2/platform/webhooks/${failId}/ping`, admin)).s === 404);

    // =====================================================================
    section('PL-8 Multiple languages and currencies');
    r = await put('/v2/platform/preferences/me', emp.token, { language: 'fr' });
    check('unsupported language → 422', r.s === 422, r);
    r = await put('/v2/platform/preferences/me', emp.token, { language: 'hi' });
    check('save language preference', r.s === 200 && r.d.language === 'hi', r);
    r = await get('/auth/me', emp.token);
    check('/auth/me returns the language', r.d?.language === 'hi', r.d?.language);
    r = await get('/v2/platform/preferences/me', emp.token);
    check('preferences endpoint lists languages', r.d?.language === 'hi' && r.d.languages.some(l => l.code === 'hi'), r.d);
    r = await get('/v2/platform/org-preferences', emp.token);
    check('org preferences default to INR / en-IN', r.s === 200 && r.d.currency === 'INR' && r.d.locale === 'en-IN' && r.d.options.currencies.includes('USD'), r.d);
    r = await put('/v2/platform/org-preferences/default', emp.token, { currency: 'USD', locale: 'en-US', date_format: 'MM/dd/yyyy' });
    check('employee cannot change org preferences', r.s === 403, r);
    r = await put('/v2/platform/org-preferences/default', admin, { currency: 'XYZ', locale: 'en-US', date_format: 'MM/dd/yyyy' });
    check('invalid currency → 422', r.s === 422, r);
    r = await put('/v2/platform/org-preferences/no-such-org', admin, { currency: 'USD', locale: 'en-US', date_format: 'MM/dd/yyyy' });
    check('unknown organization → 404', r.s === 404, r);
    r = await put('/v2/platform/org-preferences/default', admin, { currency: 'USD', locale: 'en-US', date_format: 'MM/dd/yyyy' });
    check('admin sets company default currency', r.s === 200 && r.d.currency === 'USD', r);
    r = await get('/v2/platform/org-preferences', emp.token);
    check('employees without an org inherit the default', r.d?.currency === 'USD' && r.d.locale === 'en-US', r.d);
    r = await get('/v2/platform/org-preferences/all', admin);
    check('admin lists organizations with preferences', r.s === 200 && r.d.organizations.some(o => o.organization_id === 'default' && o.currency === 'USD'), r.d);
    await put('/v2/platform/org-preferences/default', admin, { currency: 'INR', locale: 'en-IN', date_format: 'dd/MM/yyyy' });

    // =====================================================================
    section('PL-9 AI HR assistant');
    if (primaryAi.d?.configured === false) {
      r = await post('/v2/platform/assistant/chat', emp.token, { message: 'How many leaves do I have?' });
      check('not configured → 503 { configured: false }', r.s === 503 && r.d.configured === false, r);
      r = await get('/v2/platform/assistant/status', emp.token);
      check('status reports not configured', r.d?.configured === false, r.d);
    }
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    assistantSvc.setClientFactory(null);
    check('service: no key → not configured, no client', assistantSvc.isConfigured() === false && assistantSvc.getClient() === null);
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;

    const { getDB } = require('../../config/database');
    const db = getDB();
    const empFull = await db.collection('employees').findOne({ email: emp.email });
    const otherFull = await db.collection('employees').findOne({ email: other.email });
    const adminFull = await db.collection('employees').findOne({ email: ADMIN_EMAIL });
    await db.collection('employees').updateOne({ email: emp.email }, { $set: { 'leave_balance.casual_leave': 7 } });
    await db.collection('employees').updateOne({ email: other.email }, { $set: { 'leave_balance.casual_leave': 99 } });
    await db.collection('leaves').insertOne({ id: crypto.randomUUID(), employee_id: otherFull.id, employee_email: other.email, leave_type: 'other_persons_leave', dates: ['2026-09-01T00:00:00.000Z'], days_count: 1, status: 'approved', created_at: new Date() });
    await db.collection('payslips').insertOne({ id: crypto.randomUUID(), month: '2026-09', employee_uid: otherFull.employee_id, net_pay: 777777, gross_earnings: 800000, status: 'locked' });
    const ctxEmp = { user: { id: empFull.id, email: emp.email, role: 'employee', full_name: emp.name }, employee: { ...empFull, leave_balance: { ...empFull.leave_balance, casual_leave: 7 } } };
    const ctxAdmin = { user: { id: adminUser.id, email: ADMIN_EMAIL, role: 'admin' }, employee: adminFull };

    let out = await assistantSvc.runTool(db, ctxEmp, 'get_my_leave_history', {});
    check('tool: leave history only contains own leaves', out.count >= 1 && out.leaves.every(l => l.leave_type !== 'other_persons_leave' && l.leave_type !== 'secret_sabbatical'), out);
    out = await assistantSvc.runTool(db, ctxEmp, 'get_my_leave_history', { employee_email: other.email, employee_id: otherFull.id });
    check('tool ignores attempts to pass another employee', out.leaves.every(l => l.leave_type !== 'other_persons_leave'), out);
    out = await assistantSvc.runTool(db, ctxEmp, 'get_my_leave_balance', {});
    check('tool: leave balance is the caller\'s', out.balances.casual_leave === 7 && out.pending_requests >= 1, out);
    out = await assistantSvc.runTool(db, ctxEmp, 'get_my_latest_payslip', {});
    check('tool: latest payslip is the caller\'s (not another employee\'s)', out.available && out.month === '2026-08' && out.net_pay === 43800, out);
    out = await assistantSvc.runTool(db, ctxEmp, 'get_headcount_by_department', {});
    check('employee cannot run admin aggregate tools', !!out.error, out);
    check('employee is not offered admin tools', !assistantSvc.toolsFor(ctxEmp.user).some(t => t.adminOnly) && assistantSvc.toolsFor(ctxAdmin.user).some(t => t.name === 'get_pending_approvals_count'));
    out = await assistantSvc.runTool(db, ctxAdmin, 'get_headcount_by_department', {});
    check('admin aggregates return counts only', out.total >= 4 && out.departments.every(d => Object.keys(d).sort().join() === 'count,department'), out);
    out = await assistantSvc.runTool(db, ctxAdmin, 'get_pending_approvals_count', {});
    check('admin pending approvals count', typeof out.total === 'number' && out.leaves >= 1, out);
    out = await assistantSvc.runTool(db, ctxEmp, 'get_upcoming_holidays', { limit: 5 });
    check('tool: upcoming holidays', out.holidays.some(h => h.name === 'Founders Day'), out);
    out = await assistantSvc.runTool(db, ctxEmp, 'get_my_attendance_summary', { month: '2026-08' });
    check('tool: attendance summary for own record', out.month === '2026-08' && typeof out.punches.days_logged === 'number', out);
    out = await assistantSvc.runTool(db, { user: ctxAdmin.user, employee: null }, 'get_my_attendance_summary', {});
    check('tool: handles users without an employee profile', out.has_employee_profile === false, out);
    out = await assistantSvc.runTool(db, ctxEmp, 'delete_everything', {});
    check('unknown tool refused', !!out.error, out);

    // Full tool-use loop with a stubbed client (in-process)
    const stubCalls = [];
    const stub = {
      beta: {
        messages: {
          create: async (params) => {
            stubCalls.push(JSON.parse(JSON.stringify(params)));
            if (stubCalls.length === 1) {
              return { content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_my_leave_balance', input: {} }, { type: 'tool_use', id: 'toolu_2', name: 'get_my_leave_history', input: { status: 'approved' } }], stop_reason: 'tool_use' };
            }
            return { content: [{ type: 'text', text: 'You have 7 casual leave days left.' }], stop_reason: 'end_turn' };
          }
        }
      }
    };
    assistantSvc.setClientFactory(() => stub);
    const result = await assistantSvc.chat({ db, client: assistantSvc.getClient(), ctx: ctxEmp, history: [], message: 'How many casual leaves do I have?' });
    assistantSvc.setClientFactory(null);
    const second = stubCalls[1];
    const toolResults = second?.messages?.[2]?.content || [];
    check('stubbed loop: runs tools and returns the final answer', result.reply === 'You have 7 casual leave days left.' && result.tools_used.includes('get_my_leave_balance') && stubCalls.length === 2, result);
    check('stubbed loop: both tool results returned in one user message', toolResults.length === 2 && toolResults.every(t => t.type === 'tool_result') && toolResults[0].tool_use_id === 'toolu_1', second?.messages);
    const parsedResults = toolResults.map(t => JSON.parse(t.content));
    check('tool results contain only the caller\'s data', parsedResults[0]?.balances?.casual_leave === 7 && !JSON.stringify(parsedResults).includes('99') && !JSON.stringify(parsedResults).includes('other_persons_leave') && parsedResults[1]?.leaves?.length >= 1, parsedResults);
    check('request uses claude-opus-5-5 by default, refusal fallbacks, no admin tools for employees', stubCalls[0].model === 'claude-opus-5-5' && stubCalls[0].fallbacks === 'default' && stubCalls[0].betas?.includes('server-side-fallback-2026-07-01') && !stubCalls[0].tools.some(t => t.name === 'get_headcount_by_department') && stubCalls[0].tools.every(t => !('run' in t)), stubCalls[0] && { model: stubCalls[0].model, tools: stubCalls[0].tools.map(t => t.name) });
    check('history is append-only (user, assistant, tool results, assistant)', result.messages.length === 4 && result.messages.map(m => m.role).join() === 'user,assistant,user,assistant', result.messages.map(m => m.role));

    // Through the API with the real SDK against a fake Messages API (second server)
    anthropicRequests.length = 0;
    r = await s2('GET', '/v2/platform/assistant/status', emp.token);
    check('configured server reports model', r.d?.configured === true && r.d.model === 'claude-opus-5-5', r.d);
    r = await s2('POST', '/v2/platform/assistant/chat', emp.token, { message: '' });
    check('empty message → 422', r.s === 422, r);
    r = await s2('POST', '/v2/platform/assistant/chat', emp.token, { message: 'How many casual leaves do I have left?' });
    check('chat runs the tool loop end-to-end via the SDK', r.s === 200 && r.d.reply === 'You have 7 casual leave days left.' && r.d.tools_used.includes('get_my_leave_balance'), r);
    check('SDK sent the API key, beta header and tools to the Messages API', anthropicRequests.length === 2 && anthropicRequests[0].path.startsWith('/v1/messages') && anthropicRequests[0].headers['x-api-key'] === 'test-key' && /server-side-fallback-2026-07-01/.test(anthropicRequests[0].headers['anthropic-beta'] || ''), anthropicRequests.map(a => ({ p: a.path, b: a.headers['anthropic-beta'] })));
    r = await s2('GET', '/v2/platform/assistant/history', emp.token);
    check('conversation stored per user', r.s === 200 && r.d.messages.length === 2 && r.d.messages[1].role === 'assistant', r.d);
    r = await s2('GET', '/v2/platform/assistant/history', mgr.token);
    check("another user doesn't see it", r.s === 200 && r.d.messages.length === 0, r.d);
    r = await s2('POST', '/v2/platform/assistant/chat', emp.token, { message: 'Second question' });
    const lastReq = anthropicRequests[anthropicRequests.length - 1];
    check('follow-up sends the earlier turns as context', r.s === 200 && lastReq.params.messages.length >= 6 && lastReq.params.messages[0].content === 'How many casual leaves do I have left?', lastReq?.params?.messages?.length);
    r = await s2('POST', '/v2/platform/assistant/chat', emp.token, { message: 'REFUSE this' });
    check('refusal handled gracefully', r.s === 200 && /can't help/.test(r.d.reply), r);
    r = await s2('DELETE', '/v2/platform/assistant/history', emp.token);
    const h = await s2('GET', '/v2/platform/assistant/history', emp.token);
    check('history can be cleared', r.s === 200 && h.d.messages.length === 0, h.d);

    // =====================================================================
    section('PL-2 Audit trail');
    check('sanitize redacts secrets at any depth', (() => {
      const s = auditSvc.sanitize({ email: 'a@b.c', password: 'p', nested: { deep: { api_key: 'k', token: 't', Authorization: 'Bearer x', code: '123456', otp: '1', client_secret: 's', backup_codes: ['x'] } }, list: [{ new_password: 'n' }] });
      return s.email === 'a@b.c' && s.password === '[REDACTED]' && s.nested.deep.api_key === '[REDACTED]' && s.nested.deep.token === '[REDACTED]' && s.nested.deep.Authorization === '[REDACTED]' && s.nested.deep.code === '[REDACTED]' && s.nested.deep.otp === '[REDACTED]' && s.nested.deep.client_secret === '[REDACTED]' && s.nested.deep.backup_codes === '[REDACTED]' && s.list[0].new_password === '[REDACTED]';
    })());
    check('sanitize truncates long values and drops file contents', (() => {
      const s = auditSvc.sanitize({ note: 'x'.repeat(5000), file: `data:image/png;base64,${'A'.repeat(400)}`, buf: Buffer.from('hi'), many: Array.from({ length: 100 }, (_, i) => i), $where: 1 });
      return s.note.length < 400 && s.file === '[file content omitted]' && s.buf === '[binary omitted]' && s.many.length === 26 && !('$where' in s);
    })());
    check('route templates collapse ids', routeTemplate('/api/v2/assets/3f2a1b2c-1111-2222-3333-444455556666/assign') === '/api/v2/assets/:id/assign' && routeTemplate('/api/employees/EMP1001') === '/api/employees/:id');
    await put('/v2/platform/preferences/me', emp.token, { language: 'en' });
    await post('/auth/login', null, { email: emp.email, password: 'definitely-wrong' });
    await post('/auth/login', null, { email: 'ghost@nowhere-example.com', password: 'x' });
    await sleep(600);
    let entries = await auditFind({ action: 'PUT /api/v2/platform/preferences/me', actor_email: emp.email });
    check('mutating request recorded with actor, status, duration, IP, UA', entries.length >= 1 && entries[0].status === 200 && entries[0].method === 'PUT' && typeof entries[0].duration_ms === 'number' && !!entries[0].ip && entries[0].body?.language === 'en', entries[0]);
    entries = await auditFind({ path: '/api/auth/me', method: 'GET' });
    check('GET requests are not recorded', entries.length === 0, entries.length);
    entries = await auditFind({ kind: 'request', path: '/api/v2/platform/2fa/enable' });
    check('2FA codes are redacted in the trail', entries.length >= 2 && entries.every(e => !e.body?.code || e.body.code === '[REDACTED]'), entries.map(e => e.body));
    entries = await auditFind({ kind: 'request', path: '/api/auth/login' });
    check('passwords never stored', entries.length > 0 && entries.every(e => e.body?.password === '[REDACTED]'), entries[0]?.body);
    entries = await auditFind({ kind: 'request', path: '/api/auth/2fa/verify' });
    check('challenge tokens never stored', entries.length > 0 && entries.every(e => e.body?.challenge_token === '[REDACTED]' && e.body?.code === '[REDACTED]'), entries[0]?.body);
    entries = await auditFind({ action: 'auth.login.failed', actor_email: emp.email, reason: 'invalid_password' });
    check('failed login recorded with reason', entries.length >= 1 && entries[0].outcome === 'failure', entries[0]);
    entries = await auditFind({ action: 'auth.login.failed', reason: 'user_not_found' });
    check('unknown-user login recorded', entries.some(e => e.actor_email === 'ghost@nowhere-example.com'));
    const authActions = new Set((await auditFind({ kind: 'auth' })).map(e => e.action));
    check('auth events: login success, 2FA success/failure, enable/disable, SSO, admin reset', ['auth.login.success', 'auth.2fa.success', 'auth.2fa.failed', 'auth.2fa.enabled', 'auth.2fa.disabled', 'auth.sso.failed', 'auth.2fa.reset_by_admin', 'auth.login.2fa_challenge'].every(a => authActions.has(a)), [...authActions]);
    r = await post('/password-reset/request', null, { email: emp.email });
    await sleep(400);
    entries = await auditFind({ action: 'auth.password_reset.requested', actor_email: emp.email });
    check('password reset request logged', entries.length >= 1, entries.length);

    // Admin-triggered password reset emails
    const resetee = await createUser(admin, { role: 'employee', name: 'Rita Reset', department: 'Sales' });
    await post('/password-reset/request', null, { email: resetee.email.toUpperCase() });
    let resetTokens = await withDb(db => db.collection('password_reset_tokens').find({ email: resetee.email }).toArray());
    check('self-service reset matches the email case-insensitively', resetTokens.length === 1 && !resetTokens[0].used, resetTokens.length);
    r = await post('/password-reset/admin/send', emp.token, { employee_ids: [resetee.employee_id] });
    check('admin reset send is admin-only', r.s === 403, r.s);
    r = await post('/password-reset/admin/send', admin, { employee_ids: [] });
    check('admin reset send rejects an empty list', r.s === 400, r.s);
    r = await post('/password-reset/admin/send', admin, { employee_ids: [resetee.employee_id, 'NO-SUCH-EMP'] });
    check('admin reset send reports per-employee outcome (mail blanked → failed)', r.s === 200 && r.d.failed.some(f => f.employee_id === resetee.employee_id) && r.d.skipped.some(s => s.employee_id === 'NO-SUCH-EMP' && s.reason === 'not_found'), r.d);
    resetTokens = await withDb(db => db.collection('password_reset_tokens').find({ email: resetee.email }).sort({ created_at: -1 }).toArray());
    const adminToken = resetTokens[0];
    check('admin reset issues a fresh token and invalidates the earlier one', resetTokens.length === 2 && adminToken.initiated_by === ADMIN_EMAIL && !adminToken.used && resetTokens[1].used, resetTokens.map(t => ({ used: t.used, by: t.initiated_by })));
    r = await get(`/password-reset/validate/${adminToken.token}`, null);
    check('admin-issued reset link validates', r.s === 200 && r.d.email === resetee.email, r.d);
    r = await post('/password-reset/reset', null, { token: adminToken.token, new_password: 'NewPass@456' });
    check('admin-issued reset link sets a new password', r.s === 200, r.d);
    r = await post('/auth/login', null, { email: resetee.email, password: 'NewPass@456' });
    check('employee can log in with the new password', r.s === 200 && !!r.d.access_token, r.s);
    r = await post('/password-reset/reset', null, { token: adminToken.token, new_password: 'Another@789' });
    check('reset link is single-use', r.s === 400, r.s);
    entries = await auditFind({ action: 'auth.password_reset.admin_sent', actor_email: resetee.email });
    check('admin reset send audited', entries.length >= 1, entries.length);

    // Anonymous-by-design routes (engagement grievances / suggestions / survey responses)
    check('anonymous route patterns match the engagement endpoints', [
      ['POST', '/api/v2/engagement/grievances'],
      ['POST', '/api/v2/engagement/grievances/track'],
      ['POST', '/api/v2/engagement/suggestions'],
      ['POST', '/api/v2/engagement/surveys/3f2a1b2c-1111-2222-3333-444455556666/responses'],
      ['PUT', '/api/v2/engagement/surveys/abc/responses/']
    ].every(([m, p]) => auditSvc.isAnonymousRoute(m, p)));
    check('…and nothing else', ![
      ['GET', '/api/v2/engagement/grievances'],
      ['POST', '/api/v2/engagement/grievances/123/status'],
      ['POST', '/api/v2/engagement/surveys'],
      ['POST', '/api/v2/engagement/surveys/1/responses/extra'],
      ['POST', '/api/v2/platform/roles'],
      ['POST', '/api/v2/engagement/suggestions-admin']
    ].some(([m, p]) => auditSvc.isAnonymousRoute(m, p)));
    auditSvc.addAnonymousRoute('^/api/v2/custom/anon$');
    check('anonymous routes are configurable', auditSvc.isAnonymousRoute('POST', '/api/v2/custom/anon') && !auditSvc.isAnonymousRoute('POST', '/api/v2/custom/anon2'));
    const surveyId = crypto.randomUUID();
    const anonCalls = [
      await post('/v2/engagement/grievances', emp.token, { subject: 'Secret complaint XYZZY', description: 'Identifying details XYZZY', category: 'other', anonymous: true }),
      await post('/v2/engagement/grievances/track', emp.token, { tracking_code: 'XYZZY-TRACK' }),
      await post('/v2/engagement/suggestions', emp.token, { title: 'Idea XYZZY', body: 'XYZZY', anonymous: true }),
      await post(`/v2/engagement/surveys/${surveyId}/responses`, emp.token, { answers: { q1: 'XYZZY' } })
    ];
    await sleep(600);
    const anonEntries = await auditFind({ path: { $regex: '^/api/v2/engagement/(grievances|suggestions|surveys/)' } });
    const anonJson = JSON.stringify(anonEntries);
    check('anonymous requests are still recorded (method, route, status, time)', anonEntries.length >= 4 && anonEntries.every(e => e.anonymous === true && e.method === 'POST' && typeof e.status === 'number' && e.at), { n: anonEntries.length, statuses: anonCalls.map(c => c.s) });
    check('…without actor, IP, user agent or body', anonEntries.every(e => !e.actor_email && !e.actor_role && !e.ip && !e.user_agent && !e.body && !e.query && !e.duration_ms) && !anonJson.includes('XYZZY') && !anonJson.includes(emp.email), anonEntries[0]);
    check('…and survey ids are collapsed in the stored path', anonEntries.some(e => e.path === '/api/v2/engagement/surveys/:id/responses') && !anonJson.includes(surveyId), anonEntries.map(e => e.path));

    r = await get('/v2/platform/audit-logs', emp.token);
    check('employee cannot read the audit log', r.s === 403, r);
    r = await get(`/v2/platform/audit-logs?actor=${encodeURIComponent(emp.email)}&method=PUT&limit=2`, admin);
    check('filter by actor + method', r.s === 200 && r.d.items.length >= 1 && r.d.items.every(i => i.actor_email === emp.email && i.method === 'PUT'), r.d);
    r = await get('/v2/platform/audit-logs?status=4xx&limit=50', admin);
    check('filter by status class', r.s === 200 && r.d.items.length > 0 && r.d.items.every(i => i.status >= 400 && i.status < 500), r.d?.items?.map(i => i.status));
    r = await get('/v2/platform/audit-logs?action=roles-assign', admin);
    check('filter by action/path contains', r.s === 200 && r.d.items.length >= 1 && r.d.items.every(i => /roles-assign/.test(i.action) || /roles-assign/.test(i.path)), r.d?.items?.length);
    r = await get('/v2/platform/audit-logs?kind=auth&outcome=failure&limit=5', admin);
    check('filter auth failures', r.s === 200 && r.d.items.every(i => i.kind === 'auth' && i.outcome === 'failure'), r.d?.items?.length);
    const todayStr = new Date().toISOString().slice(0, 10);
    r = await get(`/v2/platform/audit-logs?from=2000-01-01&to=2000-01-02`, admin);
    check('date range filter', r.s === 200 && r.d.total === 0, r.d?.total);
    r = await get(`/v2/platform/audit-logs?from=${todayStr}&to=2000-01-01`, admin);
    check('from after to → 400', r.s === 400, r);
    r = await get('/v2/platform/audit-logs?method=GETS', admin);
    check('invalid filter → 422', r.s === 422, r);
    r = await get('/v2/platform/audit-logs?limit=1&page=2', admin);
    check('pagination', r.s === 200 && r.d.items.length === 1 && r.d.page === 2 && r.d.pages > 2, r.d && { page: r.d.page, pages: r.d.pages });
    raw = await api('GET', `/v2/platform/audit-logs/export?actor=${encodeURIComponent(emp.email)}`, admin, undefined, { raw: true });
    const csv = raw.buf?.toString('utf8') || '';
    check('CSV export', raw.s === 200 && /text\/csv/.test(raw.headers.get('content-type')) && csv.includes('Time (UTC),Kind,Actor') && csv.includes(emp.email) && !csv.includes(DEFAULT_PASSWORD), csv.slice(0, 200));
    r = await get('/v2/platform/audit-logs/summary', admin);
    check('summary counts for the dashboard', r.s === 200 && r.d.failed_logins >= 2 && r.d.changes > 0, r.d);

    await withDb(db2 => db2.collection('audit_logs').insertMany([
      { id: crypto.randomUUID(), kind: 'request', action: 'OLD', at: new Date(Date.now() - 400 * 86400000) },
      { id: crypto.randomUUID(), kind: 'request', action: 'RECENT', at: new Date(Date.now() - 10 * 86400000) }
    ]));
    r = await post('/v2/jobs/audit-retention/run', admin);
    const left = await auditFind({ action: { $in: ['OLD', 'RECENT'] } });
    check('retention job deletes entries older than AUDIT_RETENTION_DAYS (365)', r.s === 200 && r.d.result.deleted >= 1 && r.d.result.retention_days === 365 && left.length === 1 && left[0].action === 'RECENT', { r: r.d, left: left.map(x => x.action) });
    r = await get('/v2/jobs', admin);
    check('platform cron jobs registered', r.s === 200 && ['audit-retention', 'webhook-retry'].every(n => r.d.some(j => j.name === n && j.module === 'platform')), r.d?.map?.(j => j.name));
    const before = await withDb(db2 => db2.collection('audit_logs').countDocuments());
    r = await post('/auth/login', null, { email: emp.email, password: DEFAULT_PASSWORD });
    check('requests still succeed while auditing', r.s === 200);
    await sleep(400);
    check('…and are recorded asynchronously', (await withDb(db2 => db2.collection('audit_logs').countDocuments())) > before);

    await closeDB();
  } finally {
    stopSecondServer();
    receiver.close();
    fakeAnthropic.close();
  }
});
process.exit(process.exitCode || 0);
