/**
 * API smoke test — verifies every backend endpoint is reachable and behaving.
 *
 * No test framework needed: uses Node's built-in fetch (Node 18+).
 *
 *   node tests/api-smoke.js              # read-only checks (safe on prod data)
 *   node tests/api-smoke.js --write      # also runs create/update/delete CRUD
 *                                        # flows (creates & cleans up TEST data)
 *
 * Env overrides:
 *   API_URL         (default http://localhost:4001/api)
 *   ADMIN_EMAIL     (default aditi.brainwave@gmail.com)
 *   ADMIN_PASSWORD  (default Admin@123)
 */

const BASE = (process.env.API_URL || 'http://localhost:4001/api').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'aditi.brainwave@gmail.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';
const RUN_WRITES = process.argv.includes('--write');

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m', c: '\x1b[36m' };
const results = [];
let TOKEN = null;

async function http(method, path, { token, body, noAuth } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const useToken = noAuth ? null : (token !== undefined ? token : TOKEN);
  if (useToken) headers.Authorization = `Bearer ${useToken}`;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, data, ok: res.ok };
  } catch (e) {
    return { status: 0, data: null, ok: false, error: e.message };
  }
}

/**
 * Record a check.
 * verdict: PASS (2xx) | WARN (400/403/soft-404) | FAIL (401-with-token/404/5xx/network)
 */
function classify(status, { soft } = {}) {
  if (status >= 200 && status < 300) return 'PASS';
  if (status === 400 || status === 403) return 'WARN';
  if (soft && status === 404) return 'WARN';
  return 'FAIL';
}

function record(module, name, method, path, res, opts = {}) {
  const verdict = opts.expect
    ? (opts.expect.includes(res.status) ? 'PASS' : 'FAIL')
    : classify(res.status, opts);
  results.push({ module, name, method, path, status: res.status, verdict, note: opts.note || (res.error || '') });
  return res;
}

async function get(module, name, path, opts = {}) {
  return record(module, name, 'GET', path, await http('GET', path, opts), opts);
}
async function post(module, name, path, body, opts = {}) {
  return record(module, name, 'POST', path, await http('POST', path, { body, ...opts }), opts);
}

async function run() {
  console.log(`\n${C.b}API smoke test${C.x} → ${C.c}${BASE}${C.x}  (writes: ${RUN_WRITES ? 'ON' : 'off'})\n`);

  // ---- 0. Public / setup ----
  await get('Setup', 'Setup status', '/setup/status', { noAuth: true });
  await post('Setup', 'Test DB connection', '/setup/test-connection',
    { mongo_url: process.env.MONGO_URL || '', db_name: process.env.DB_NAME || 'hrms' },
    { noAuth: true, expect: [200] });
  // ---- 1. Auth (positive + negative) ----
  const login = await post('Auth', 'Login (valid)', '/auth/login', { email: EMAIL, password: PASSWORD }, { noAuth: true, expect: [200] });
  TOKEN = login.data?.access_token || null;
  if (!TOKEN) {
    console.log(`${C.r}✖ Could not log in as ${EMAIL}. Aborting authed checks.${C.x}`);
    console.log(`${C.d}  (Is the backend running on ${BASE}? Are the admin creds correct?)${C.x}\n`);
    summarize();
    process.exitCode = 1;
    return;
  }
  await post('Auth', 'Login (bad password)', '/auth/login', { email: EMAIL, password: 'wrong-xyz' }, { noAuth: true, expect: [401] });
  await post('Auth', 'Login (unknown email)', '/auth/login', { email: 'nobody@example.com', password: 'x' }, { noAuth: true, expect: [401] });
  await get('Auth', 'Me (with token)', '/auth/me', { expect: [200] });
  await get('Auth', 'Me (no token → 401)', '/auth/me', { token: null, expect: [401] });
  // Security: public register must NOT allow admin role (validation → 400/422)
  await post('Auth', 'Register admin role (blocked)', '/auth/register',
    { email: 'x@x.com', password: 'pass123', full_name: 'X', role: 'admin', department: 'IT', designation: 'Dev' },
    { noAuth: true, expect: [400, 422] });
  await post('Auth', 'Register missing fields (rejected)', '/auth/register', { email: 'x@x.com' }, { noAuth: true, expect: [400, 422] });

  // Auth-required infra endpoints (need a token)
  await get('Uploads', 'Uploads health', '/uploads/health');
  await get('WhatsApp', 'WhatsApp status', '/whatsapp/status');

  // ---- 2. Discover ids for param routes ----
  const empRes = await get('Employees', 'List employees', '/employees', { expect: [200] });
  const employees = Array.isArray(empRes.data) ? empRes.data : (empRes.data?.employees || empRes.data?.data || []);
  const emp = employees[0] || {};
  const empId = emp.id || emp.employee_id || emp._id;
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // ---- 3. Read endpoints per module ----
  await get('Dashboard', 'Stats', '/dashboard/stats');

  await get('Employees', 'Employee-id settings', '/employees/employee-id-settings');
  await get('Employees', 'Check duplicates', '/employees/check-duplicates');

  await get('Leaves', 'My leaves', '/leaves/my-leaves');
  await get('Leaves', 'Pending', '/leaves/pending');
  await get('Leaves', 'All', '/leaves/all');
  await get('Leaves', 'Leave policy', '/leaves/leave-policy');
  await get('Leaves', 'Calendar (me)', '/leaves/calendar/me');
  if (empId) await get('Leaves', 'Calendar (employee)', `/leaves/calendar/${empId}`, { soft: true });

  await get('Organizations', 'List', '/organizations');

  await get('Holidays', 'List', '/holidays');
  await get('Holidays', 'Upcoming', '/holidays/list/upcoming');
  await get('Holidays', 'Check date', `/holidays/check/${today}`);

  await get('Attendance', 'Grid (current month)', '/attendance');
  await get('Attendance', 'Summary', '/attendance/summary');

  await get('Comp-Off', 'My requests', '/comp-off/my-requests');
  await get('Comp-Off', 'All requests', '/comp-off/all-requests');
  await get('Comp-Off', 'Team requests', '/comp-off/team-requests', { soft: true });
  await get('Comp-Off', 'Balance', '/comp-off/balance');
  await get('Comp-Off', 'Records', '/comp-off/records');

  await get('Reimbursements', 'Mine', '/reimbursements/my');
  await get('Reimbursements', 'All', '/reimbursements/all');
  await get('Reimbursements', 'Stats', '/reimbursements/stats');

  await get('Payroll', 'Salary template', '/salary-template');
  if (empId) await get('Payroll', 'Salary structure', `/salary-structure/${empId}`, { soft: true });
  await get('Payroll', 'Monthly summary', `/payroll/monthly-summary/${month}`, { soft: true });
  if (empId) await get('Payroll', 'Employee report', `/payroll/employee-report/${empId}/${month}`, { soft: true });

  await get('Notif-Settings', 'Get settings', '/notification-settings');

  await get('Notifications', 'List', '/notifications');
  await get('Notifications', 'Unread count', '/notifications/unread-count');
  await get('Notifications', 'Deleted', '/notifications/deleted');
  await get('Notifications', 'Admin all', '/notifications/admin/all');

  await get('Leave-Credit', 'Rules', '/admin/leave-credit/rules');
  await get('Leave-Credit', 'Logs', '/admin/leave-credit/logs');
  await get('Leave-Credit', 'Adjustment logs', '/admin/leave-credit/adjustment-logs');
  await get('Leave-Credit', 'Balance summary', '/admin/leave-credit/leave-balance/summary');

  await get('Password-Reset', 'Validate bogus token', '/password-reset/validate/bogus-token-123', { noAuth: true, soft: true });

  // ---- 4. Write flows (opt-in) ----
  if (RUN_WRITES) {
    await writeFlows();
  } else {
    ['Create org', 'Update org', 'Delete org', 'Create holiday', 'Update holiday', 'Delete holiday']
      .forEach((n) => results.push({ module: 'Writes', name: n, method: '-', path: '(use --write)', status: '-', verdict: 'SKIP', note: '' }));
  }

  summarize();
}

async function writeFlows() {
  // Organizations CRUD
  const org = await post('Writes', 'Create org', '/organizations', { name: '__SMOKE_TEST_ORG__', description: 'temp' }, { expect: [201] });
  const orgId = org.data?.id;
  if (orgId) {
    record('Writes', 'Update org', 'PUT', `/organizations/${orgId}`, await http('PUT', `/organizations/${orgId}`, { body: { name: '__SMOKE_TEST_ORG2__' } }), { expect: [200] });
    record('Writes', 'Delete org', 'DELETE', `/organizations/${orgId}`, await http('DELETE', `/organizations/${orgId}`), { expect: [200] });
  }

  // Holidays CRUD (far-future date so it never clashes with real data)
  const hol = await post('Writes', 'Create holiday', '/holidays', { name: '__SMOKE_TEST_HOLIDAY__', date: '2099-01-01', type: 'public' }, { expect: [201] });
  const holId = hol.data?.id;
  if (holId) {
    record('Writes', 'Update holiday', 'PUT', `/holidays/${holId}`, await http('PUT', `/holidays/${holId}`, { body: { name: '__SMOKE_TEST_HOLIDAY2__' } }), { expect: [200] });
    record('Writes', 'Delete holiday', 'DELETE', `/holidays/${holId}`, await http('DELETE', `/holidays/${holId}`), { expect: [200] });
  }
}

function summarize() {
  const pad = (s, n) => String(s).padEnd(n);
  let curMod = null;
  for (const r of results) {
    if (r.module !== curMod) { console.log(`\n${C.b}${r.module}${C.x}`); curMod = r.module; }
    const color = r.verdict === 'PASS' ? C.g : r.verdict === 'WARN' ? C.y : r.verdict === 'SKIP' ? C.d : C.r;
    const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'WARN' ? '!' : r.verdict === 'SKIP' ? '·' : '✖';
    console.log(`  ${color}${mark} ${pad(r.verdict, 4)}${C.x} ${C.d}${pad(r.method, 6)}${C.x} ${pad(r.status, 4)} ${r.name} ${C.d}${r.note}${C.x}`);
  }
  const count = (v) => results.filter((r) => r.verdict === v).length;
  const pass = count('PASS'), warn = count('WARN'), fail = count('FAIL'), skip = count('SKIP');
  console.log(`\n${C.b}Summary:${C.x} ${C.g}${pass} pass${C.x}, ${C.y}${warn} warn${C.x}, ${C.r}${fail} fail${C.x}, ${C.d}${skip} skip${C.x}  (total ${results.length})`);
  console.log(`${C.d}WARN = endpoint responded but returned 400/403 (validation/permission) or a soft 404 — not necessarily broken.${C.x}\n`);
  if (fail > 0) process.exitCode = 1;
}

run();
