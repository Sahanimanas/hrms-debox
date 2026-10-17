// Integration checks for the shared platform pieces (module loader, scheduler, file storage)
import { createRequire } from 'node:module';
import { run, section, check, get, post, put, bootstrap, createUser, withDb, BASE } from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const ORIGIN = BASE.replace(/\/api$/, '');

await run(async () => {
  const admin = await bootstrap();
  const emp = await createUser(admin, { role: 'employee' });

  section('Core module loader');
  const modules = ['payroll', 'lifecycle', 'leave', 'engagement', 'performance', 'recruitment', 'assets', 'analytics', 'platform'];
  for (const m of modules) {
    const r = await get(`/v2/${m}/health`, admin);
    check(`module ${m} is mounted`, r.s === 200, r);
  }

  section('Core scheduler');
  let r = await get('/v2/jobs', emp.token);
  check('employees cannot list scheduled jobs', r.s === 403, r);
  r = await get('/v2/jobs', admin);
  const names = (r.d || []).map(j => j.name);
  check('scheduled jobs registered from every module', r.s === 200 && names.length >= 15, names);
  const legacy = r.d?.find(j => j.name === 'monthly-leave-credit');
  check('legacy monthly leave credit stays off unless enabled', legacy && legacy.enabled === false, legacy);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check('job names are unique', dupes.length === 0, dupes);
  r = await post('/v2/jobs/no-such-job/run', admin, {});
  check('unknown job returns 404', r.s === 404, r);

  section('Core file storage');
  process.env.S3_ENDPOINT_URL = '';
  const { storeFile, readStoredFile } = require('../../services/fileStorage');
  const pub = await storeFile(Buffer.from('public-file'), 'note.txt', 'text/plain', 'core-test', 'x');
  const priv = await storeFile(Buffer.from('secret-file'), 'cv.pdf', 'application/pdf', 'core-test', 'x', { visibility: 'private' });
  check('private files have no public URL', priv.url === null && priv.key.startsWith('local/private/'), priv);
  let res = await fetch(`${ORIGIN}/uploads/${pub.key.slice('local/'.length)}`);
  check('public uploads are served', res.status === 200 && (await res.text()) === 'public-file');
  res = await fetch(`${ORIGIN}/uploads/${priv.key.slice('local/'.length)}`);
  check('private uploads are never served statically', res.status === 404);
  res = await fetch(`${ORIGIN}/uploads/PRIVATE/${priv.key.split('/').slice(2).join('/')}`);
  check('case variations of the private path are not served either', res.status === 404);
  res = await fetch(`${ORIGIN}/uploads/core-test/../private/core-test/x/${priv.key.split('/').pop()}`);
  check('path traversal into private files is not served', res.status === 404 || res.status === 400);
  const back = await readStoredFile(priv.key);
  check('private files can be read back server-side', back?.toString() === 'secret-file');

  await identityChecks(admin, emp);
});

// UAT 4/6/12/15/24: legacy employee identities, attendance grid keys and dates,
// unique organization names, phone validation
async function identityChecks(admin, emp) {
  const { ObjectId } = require('../../db/pgdoc');
  const { backfillEmployeeIdentity } = require('../../services/employeeIdentity');
  const ymdIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(d);
  const today = ymdIn(new Date());
  const tomorrow = ymdIn(new Date(Date.now() + 86400000));
  const [ty, tm] = today.split('-').map(Number);

  section('Employee identity backfill');
  // seed.js shape: Mongo _id + employee_code only, user.employee_id = employee _id.
  // Its code equals the code the app later issued to `emp` (the UAT "ef" case).
  const legacyId = new ObjectId();
  const legacyUserId = new ObjectId();
  const uuidC = '0b6f7c1e-3a1d-4c55-9f00-000000000c01';
  await withDb(async (db) => {
    await db.collection('employees').insertMany([
      { _id: legacyId, user_id: String(legacyUserId), employee_code: emp.employee_id, full_name: 'Legacy Admin', email: 'legacy.admin@t.test', role: 'admin', department: 'HR', created_at: new Date('2022-01-01') },
      { id: uuidC, employee_id: '', full_name: 'Empty Code', email: 'empty.code@t.test', role: 'employee', department: 'Sales', created_at: new Date('2023-01-01') }
    ]);
    await db.collection('users').insertMany([
      { _id: legacyUserId, email: 'legacy.admin@t.test', role: 'admin', employee_id: String(legacyId), hashed_password: 'x', created_at: new Date('2022-01-01') },
      { id: uuidC, email: 'empty.code@t.test', role: 'employee', employee_id: '', hashed_password: 'x' },
      { id: '0b6f7c1e-3a1d-4c55-9f00-000000000d01', email: 'orphan.user@t.test', full_name: 'Orphan User', role: 'employee', hashed_password: 'x' }
    ]);
    await db.collection('leaves').insertMany([
      { id: 'leave-emp', employee_id: emp.employee_id, employee_email: emp.email, status: 'approved' },
      { id: 'leave-legacy', employee_id: emp.employee_id, employee_email: 'legacy.admin@t.test', status: 'approved' }
    ]);
    await db.collection('attendance').insertMany([
      { employee_id: emp.employee_id, month: 1, year: 2020, attendance: { 1: 'present' } },
      { employee_id: uuidC, month: 1, year: 2020, attendance: { 2: 'present' } }
    ]);
    await db.collection('reimbursements').insertOne({ id: 'reimb-legacy', employee_id: String(legacyId), amount: 10 });
  });

  const dry = await withDb(db => backfillEmployeeIdentity(db, { dryRun: true }));
  const untouched = await withDb(db => db.collection('employees').findOne({ email: emp.email }));
  check('dry run reports changes but writes nothing', dry.codes.length >= 3 && dry.created.length === 1 && untouched.employee_id === emp.employee_id, dry);

  const report = await withDb(db => backfillEmployeeIdentity(db));
  const after = await withDb(async (db) => ({
    legacy: await db.collection('employees').findOne({ email: 'legacy.admin@t.test' }),
    emp: await db.collection('employees').findOne({ email: emp.email }),
    empty: await db.collection('employees').findOne({ email: 'empty.code@t.test' }),
    orphan: await db.collection('employees').findOne({ email: 'orphan.user@t.test' }),
    legacyUser: await db.collection('users').findOne({ email: 'legacy.admin@t.test' }),
    empUser: await db.collection('users').findOne({ email: emp.email }),
    leaves: await db.collection('leaves').find({ id: { $in: ['leave-emp', 'leave-legacy'] } }).toArray(),
    attendance: await db.collection('attendance').find({ year: 2020 }).toArray(),
    reimb: await db.collection('reimbursements').findOne({ id: 'reimb-legacy' })
  }));
  const oldCode = emp.employee_id;
  check('oldest employee keeps a duplicated code; seeded employee_code becomes employee_id', after.legacy.employee_id === oldCode && !!after.legacy.id, after.legacy);
  check('the later duplicate gets a new code from the counter', after.emp.employee_id && after.emp.employee_id !== oldCode && after.emp.employee_id.startsWith('EMP'), after.emp);
  check('an empty code is filled in', !!after.empty.employee_id && after.empty.id === uuidC, after.empty);
  check('a user without an employee row gets one', !!after.orphan?.employee_id && after.orphan.full_name === 'Orphan User', after.orphan);
  check('user accounts follow their employee code', after.legacyUser.employee_id === oldCode && after.legacyUser.id === after.legacy.id && after.empUser.employee_id === after.emp.employee_id, { u: after.legacyUser, e: after.empUser });
  const codes = [after.legacy, after.emp, after.empty, after.orphan].map(e => e.employee_id);
  check('all codes are unique', new Set(codes).size === codes.length, codes);
  const leave = (id) => after.leaves.find(l => l.id === id);
  check('records naming the re-coded employee by email move to the new code', leave('leave-emp').employee_id === after.emp.employee_id && leave('leave-legacy').employee_id === oldCode, after.leaves);
  const att = (day) => after.attendance.find(a => a.attendance?.[day]);
  check('ambiguous records stay with the original; uuid-keyed records follow', att(1).employee_id === oldCode && att(2).employee_id === after.empty.employee_id, after.attendance);
  check('seed references by Mongo _id point at the code', after.reimb.employee_id === oldCode, after.reimb);
  const again = await withDb(db => backfillEmployeeIdentity(db));
  check('backfill is idempotent', ['codes', 'ids', 'created', 'users', 'references'].every(k => again[k].length === 0), again);
  check('first run reported its changes', report.codes.length >= 3 && report.references.length >= 3, report);

  section('Unique employee code');
  const dupInsert = await withDb(db => db.collection('employees').insertOne({ id: 'dup-code', email: 'dup.code@t.test', employee_id: oldCode })
    .then(() => null, e => e));
  check('a duplicate employee_id is rejected by the unique index', dupInsert?.code === 11000, dupInsert?.message);
  const fresh = await createUser(admin, { role: 'employee' });
  check('new employees never reuse a legacy or existing code', fresh.employee_id && !codes.includes(fresh.employee_id), fresh.employee_id);
  const [a1, a2] = await Promise.all([createUser(admin), createUser(admin)]);
  check('concurrent creates get different codes', a1.employee_id && a2.employee_id && a1.employee_id !== a2.employee_id, [a1.employee_id, a2.employee_id]);

  section('Attendance grid');
  let r = await get(`/attendance?month=${tm}&year=${ty}`, admin);
  const rows = r.d?.employees || [];
  const rowOf = (email) => rows.find(e => e.email === email);
  check('grid rows have unique internal keys', r.s === 200 && rows.every(e => e.uid) && new Set(rows.map(e => e.uid)).size === rows.length, rows.map(e => e.uid));
  check('grid returns today and a display code', r.d?.today === today && rowOf(emp.email)?.employee_code === after.emp.employee_id, { today: r.d?.today, row: rowOf(emp.email) });
  r = await post('/attendance/mark', admin, { employee_id: rowOf(emp.email).uid, date: today, status: 'present' });
  check('mark by internal key', r.s === 200, r);
  r = await get(`/attendance?month=${tm}&year=${ty}`, admin);
  const day = Number(today.slice(8));
  const gridRow = (email) => r.d.employees.find(e => e.email === email);
  check('marking one employee does not mark the former duplicate', gridRow(emp.email)?.attendance?.[day] === 'present' && !gridRow('legacy.admin@t.test')?.attendance?.[day],
    [gridRow(emp.email), gridRow('legacy.admin@t.test')]);
  r = await post('/attendance/mark', admin, { employee_id: rowOf(emp.email).uid, date: tomorrow, status: 'present' });
  check('future date rejected (mark)', r.s === 400 && /future/i.test(r.d?.detail), r);
  r = await post('/attendance/bulk-mark', admin, { records: [{ employee_id: rowOf(emp.email).uid, date: tomorrow, status: 'present' }] });
  check('future date rejected (bulk)', r.s === 400 && /future/i.test(r.d?.detail), r);
  r = await post('/attendance/mark-column', admin, { date: tomorrow, status: 'present' });
  check('future date rejected (whole column)', r.s === 400, r);
  r = await post('/attendance/bulk-mark', admin, { records: [{ employee_id: rowOf(emp.email).uid, date: tomorrow, status: '' }] });
  check('clearing a future cell is still allowed', r.s === 200, r);
  r = await post('/attendance/mark', admin, { employee_id: 'no-such-employee', date: today, status: 'present' });
  check('unknown employee key is rejected', r.s === 404, r);

  section('Organization names');
  r = await post('/organizations', admin, { name: 'Dup Org Pvt. Ltd.' });
  check('create organization', r.s === 201, r);
  const orgId = r.d?.id;
  r = await post('/organizations', admin, { name: '  dup org pvt. ltd. ' });
  check('duplicate name (case / spaces) rejected with 409', r.s === 409 && /already exists/.test(r.d?.detail), r);
  r = await post('/organizations', admin, { name: 'Other Org' });
  r = await put(`/organizations/${r.d?.id}`, admin, { name: 'DUP ORG PVT. LTD.' });
  check('rename onto an existing name rejected', r.s === 409, r);
  r = await put(`/organizations/${orgId}`, admin, { name: 'Dup Org Pvt. Ltd.', description: 'same name' });
  check('saving an organization under its own name works', r.s === 200, r);

  section('Phone validation');
  r = await post('/employees', admin, { email: `phone.${Date.now()}@t.test`, password: 'Pass@1234', full_name: 'Phone Test', role: 'employee', department: 'HR', designation: 'X', phone: 'abcxyz' });
  check('letters in the phone number are rejected', r.s === 422, r);
}
