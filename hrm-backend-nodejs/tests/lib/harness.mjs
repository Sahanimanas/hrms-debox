/**
 * Tiny test harness for module API tests (no framework, Node 18+).
 *
 * Suites are plain scripts in tests/suites/<name>.test.mjs that import this
 * file. Run them with tests/run.mjs, which starts a backend on a throwaway
 * database and points API_URL at it.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(__dirname, '..', '..');
export const BASE = (process.env.API_URL || 'http://localhost:4011/api').replace(/\/$/, '');
export const SUITE = process.env.TEST_SUITE || path.basename(process.argv[1] || 'suite').replace(/\.test\.mjs$/, '');

const results = [];
let currentSection = '';

export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'Admin@123';
export const DEFAULT_PASSWORD = 'Pass@123';

export function section(name) {
  currentSection = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

/** Record a check. `extra` is printed when the check fails. */
export function check(name, condition, extra) {
  const passed = !!condition;
  results.push({ section: currentSection, name, passed });
  console.log(`${passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}`);
  if (!passed && extra !== undefined) {
    let text;
    try { text = JSON.stringify(extra); } catch { text = String(extra); }
    console.log(`      ${String(text).slice(0, 500)}`);
  }
  return passed;
}

export async function http(method, urlPath, token, body, { raw = false, headers = {} } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (raw) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { s: res.status, headers: res.headers, buf };
  }
  let d = null;
  try { d = await res.json(); } catch { /* not JSON */ }
  return { s: res.status, d, headers: res.headers };
}

export const get = (p, t, o) => http('GET', p, t, undefined, o);
export const post = (p, t, b, o) => http('POST', p, t, b ?? {}, o);
export const put = (p, t, b, o) => http('PUT', p, t, b ?? {}, o);
export const patch = (p, t, b, o) => http('PATCH', p, t, b ?? {}, o);
export const del = (p, t, o) => http('DELETE', p, t, undefined, o);

/** multipart/form-data upload. files: [{ field, name, type, content (Buffer|string) }] */
export async function upload(urlPath, token, files, fields = {}, method = 'POST') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const f of files) form.append(f.field, new Blob([f.content], { type: f.type }), f.name);
  const res = await fetch(BASE + urlPath, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  let d = null;
  try { d = await res.json(); } catch { /* not JSON */ }
  return { s: res.status, d };
}

export async function login(email, password = DEFAULT_PASSWORD) {
  const r = await post('/auth/login', null, { email, password });
  return r.d?.access_token || null;
}

/**
 * Make sure the test DB has an admin and employee-ID settings; returns the admin token.
 * Uses DATABASE_URL / DB_NAME from the environment (set by tests/run.mjs).
 */
export async function bootstrap() {
  let token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!token) {
    spawnSync(process.execPath, ['seedAdmin.js', ADMIN_EMAIL, ADMIN_PASSWORD, 'Test Admin'], {
      cwd: BACKEND_DIR,
      env: process.env,
      stdio: 'ignore'
    });
    token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  }
  if (!token) throw new Error('Could not log in as test admin');
  // Initialise employee-ID settings once per database (re-setting the counter
  // would make later suites generate IDs that already exist)
  const initialised = await withDb(db => db.collection('settings').findOne({}));
  if (!initialised) {
    await post('/employee-id-settings', token, { prefix: 'EMP', counter: 1000 });
  }
  return token;
}

/**
 * Direct access to the test database for seeding/inspecting data the API
 * can't set up (e.g. back-dated records). Usage: await withDb(db => db.collection('x').insertOne(...))
 */
export async function withDb(fn) {
  const { PgDocClient } = createRequire(import.meta.url)('../../db/pgdoc');
  const client = new PgDocClient(process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/hrms');
  await client.connect();
  try {
    return await fn(client.db(process.env.DB_NAME || 'hrms_test_run'));
  } finally {
    await client.close();
  }
}

let userCounter = 0;
/**
 * Create an employee (via the admin API) and log in as them.
 * Returns { email, token, employee_id, user }.
 */
export async function createUser(adminToken, {
  role = 'employee',
  name,
  department = 'Engineering',
  designation = 'Engineer',
  manager_email = null,
  joining_date
} = {}) {
  userCounter += 1;
  const stamp = `${Date.now().toString(36)}${userCounter}`;
  const email = `${role}.${stamp}@example.com`;
  const body = {
    email,
    password: DEFAULT_PASSWORD,
    full_name: name || `${role[0].toUpperCase()}${role.slice(1)} ${stamp}`,
    role,
    department,
    designation,
    ...(manager_email ? { manager_email } : {}),
    ...(joining_date ? { joining_date } : {})
  };
  const r = await post('/employees', adminToken, body);
  if (r.s !== 200 && r.s !== 201) throw new Error(`createUser failed: ${r.s} ${JSON.stringify(r.d)}`);
  const token = await login(email);
  const me = await get('/auth/me', token);
  return { email, token, name: body.full_name, employee_id: me.d?.employee_id, user: me.d };
}

/** Print the summary, write tests/results/<suite>.json and exit with the right code. */
export function finish() {
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const resultsDir = path.join(BACKEND_DIR, 'tests', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, `${SUITE}.json`),
    JSON.stringify({ suite: SUITE, passed, failed, total: results.length, ran_at: new Date().toISOString(), results }, null, 2)
  );
  console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${SUITE}: ${passed}/${results.length} passed${failed ? `, ${failed} failed` : ''}\x1b[0m`);
  process.exitCode = failed ? 1 : 0;
}

/** Wrap a suite body so unexpected exceptions count as a failure instead of crashing silently. */
export async function run(body) {
  try {
    await body();
  } catch (error) {
    check(`suite crashed: ${error.message}`, false, error.stack);
  }
  finish();
}
