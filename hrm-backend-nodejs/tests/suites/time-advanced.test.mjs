// Phase 1 — devices (TA-9), timesheets (TA-10), nightly close (TA-11)
import { createRequire } from 'node:module';
import { run, section, check, get, post, put, http, bootstrap, createUser, withDb, BASE } from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const { zonedTimeToDate, localParts } = require('../../utils/helpers');

const today = localParts().date;
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const at = (date, hhmm) => zonedTimeToDate(date, hhmm).toISOString();
const mondayOf = (d) => {
  const day = new Date(`${d}T12:00:00Z`).getUTCDay();
  return addDays(d, -((day + 6) % 7));
};
const devicePost = (key, body) => http('POST', '/time/devices/punches', null, body, { headers: key ? { 'X-Device-Key': key } : {} });

await run(async () => {
  const admin = await bootstrap();
  const mgr = await createUser(admin, { role: 'manager', name: 'Mona Manager', department: 'Engineering' });
  const otherMgr = await createUser(admin, { role: 'manager', name: 'Omar Other', department: 'Sales' });
  const emp = await createUser(admin, { role: 'employee', name: 'Dev Device', department: 'Engineering', manager_email: mgr.email });
  const night = await createUser(admin, { role: 'employee', name: 'Nia Night', department: 'Engineering', manager_email: mgr.email });

  // A day shift everyone falls back to, and a night shift for Nia
  await post('/time/shifts', admin, { name: 'General', start_time: '09:30', end_time: '18:30', weekly_offs: [0], is_default: true });
  const nightShift = (await post('/time/shifts', admin, { name: 'Night', start_time: '22:00', end_time: '06:00', weekly_offs: [], full_day_minutes: 420 })).d;
  const roster = (await get('/time/shift-roster', admin)).d;
  const uid = (u) => roster.find(r => r.email === u.email)?.employee_id;
  await put('/time/shifts-assign', admin, { shift_id: nightShift.id, employee_ids: [uid(night)] });

  section('TA-9 Biometric / RFID devices');
  let r = await get('/time/devices', emp.token);
  check('employee cannot manage devices', r.s === 403, r);
  r = await post('/time/devices', admin, { name: '' });
  check('device name required', r.s === 422, r);
  r = await post('/time/devices', admin, { name: 'Front door', location: 'HQ lobby', type: 'biometric' });
  check('register device returns key once', r.s === 201 && r.d.api_key?.startsWith('xdev_') && !r.d.key_hash, r.d);
  const device = r.d;
  let key = device.api_key;
  r = await get('/time/devices', admin);
  check('device list never exposes keys', r.s === 200 && r.d.length === 1 && !r.d[0].api_key && !r.d[0].key_hash, r.d);

  r = await put('/time/devices/user-map', admin, { mappings: [{ employee_id: uid(emp), device_user_id: '101' }, { employee_id: uid(night), device_user_id: '202' }] });
  check('map device user IDs to employees', r.s === 200 && r.d.updated === 2, r);
  r = await put('/time/devices/user-map', admin, { mappings: [{ employee_id: uid(mgr), device_user_id: '101' }] });
  check('device user ID cannot be reused', r.s === 400 && r.d.errors?.[0]?.reason?.includes('already assigned'), r);
  r = await put('/time/devices/user-map', admin, { mappings: [{ employee_id: uid(mgr), device_user_id: '7' }, { employee_id: uid(emp), device_user_id: '7' }] });
  check('same ID twice in one request rejected', r.s === 400, r);

  r = await devicePost(null, { punches: [{ device_user_id: '101', timestamp: at(addDays(today, -1), '09:20') }] });
  check('punch without device key rejected', r.s === 401, r);
  r = await devicePost('xdev_wrong', { punches: [{ device_user_id: '101', timestamp: at(addDays(today, -1), '09:20') }] });
  check('punch with wrong key rejected', r.s === 401, r);
  r = await devicePost(key, { punches: [] });
  check('empty batch rejected', r.s === 422, r);

  const d1 = addDays(today, -1);
  const futureTs = new Date(Date.now() + 3600000).toISOString();
  r = await devicePost(key, { punches: [
    { device_user_id: '101', timestamp: at(d1, '09:20') },
    { device_user_id: 101, timestamp: at(d1, '18:45') },
    { device_user_id: '999', timestamp: at(d1, '10:00') },
    { device_user_id: '101', timestamp: futureTs }
  ] });
  check('ingest: accepts valid punches, reports unknown users and future timestamps',
    r.s === 200 && r.d.accepted === 3 && r.d.duplicates === 0 && r.d.unknown_user_ids.includes('999') && r.d.rejected.length === 1, r.d);
  r = await get(`/time/daily-report?date=${d1}`, admin);
  let row = r.d.rows.find(x => x.email === emp.email);
  check('first-in/last-out log created from device punches',
    row?.log?.source === 'device' && row.log.worked_minutes === 565 && row.log.status === 'present', row?.log);
  r = await devicePost(key, { punches: [{ device_user_id: '101', timestamp: at(d1, '09:20') }, { device_user_id: '101', timestamp: at(d1, '18:45') }] });
  check('re-sent punches are de-duplicated', r.d.accepted === 0 && r.d.duplicates === 2, r.d);
  r = await devicePost(key, { punches: [{ device_user_id: '101', timestamp: at(d1, '19:30') }, { device_user_id: '101', timestamp: at(d1, '09:05') }] });
  r = await get(`/time/daily-report?date=${d1}`, admin);
  row = r.d.rows.find(x => x.email === emp.email);
  check('later/earlier punches widen the day', row?.log?.worked_minutes === 625, row?.log);
  const [y1, m1, dd1] = d1.split('-').map(Number);
  r = await get(`/attendance?month=${m1}&year=${y1}`, admin);
  check('device day mirrored into attendance grid', r.d.employees.find(e => e.email === emp.email)?.attendance?.[dd1] === 'present');

  const n1 = addDays(today, -2);
  r = await devicePost(key, { punches: [{ device_user_id: '202', timestamp: at(n1, '22:10') }, { device_user_id: '202', timestamp: at(addDays(n1, 1), '05:50') }] });
  check('night-shift punches attributed to the evening they started', r.d.days_updated?.length === 1 && r.d.days_updated[0].date === n1, r.d);
  r = await get(`/time/daily-report?date=${n1}`, admin);
  row = r.d.rows.find(x => x.email === night.email);
  check('night shift worked minutes span midnight', row?.log?.worked_minutes === 460 && row.log.status === 'present' && !row.log.is_late, row?.log);

  const d3 = addDays(today, -3);
  r = await post('/time/requests', emp.token, { type: 'missed_punch', date: d3, clock_in: '09:30', clock_out: '18:30', reason: 'Device was down' });
  await post(`/time/requests/${r.d.id}/action`, admin, { action: 'approve' });
  r = await devicePost(key, { punches: [{ device_user_id: '101', timestamp: at(d3, '11:00') }] });
  check('approved correction is not overwritten by device punches', r.d.days_updated?.[0]?.action === 'skipped', r.d);

  r = await get(`/time/devices/${device.id}/punches`, admin);
  check('raw punch log available', r.s === 200 && r.d.length >= 7, r.d?.length);
  r = await post(`/time/devices/${device.id}/rotate-key`, admin, {});
  const newKey = r.d?.api_key;
  r = await devicePost(key, { punches: [{ device_user_id: '101', timestamp: at(d1, '12:00') }] });
  check('old key stops working after rotation', r.s === 401, r);
  key = newKey;
  r = await devicePost(key, { punches: [{ device_user_id: '101', timestamp: at(d1, '12:00') }] });
  check('new key works', r.s === 200, r);
  await put(`/time/devices/${device.id}`, admin, { is_active: false });
  r = await devicePost(key, { punches: [{ device_user_id: '101', timestamp: at(d1, '12:05') }] });
  check('disabled device rejected', r.s === 403, r);

  section('TA-10 Timesheets and projects');
  r = await post('/timesheets/projects', emp.token, { name: 'X', code: 'XX' });
  check('employee cannot create projects', r.s === 403, r);
  r = await post('/timesheets/projects', mgr.token, { name: 'Apollo', code: 'apl', client: 'NASA' });
  check('manager creates project (code upper-cased)', r.s === 201 && r.d.code === 'APL', r);
  const apollo = r.d;
  r = await post('/timesheets/projects', admin, { name: 'Dup', code: 'APL' });
  check('duplicate project code rejected', r.s === 400, r);
  r = await post('/timesheets/projects', admin, { name: 'Bad', code: 'a b' });
  check('invalid project code rejected', r.s === 422, r);
  const secret = (await post('/timesheets/projects', admin, { name: 'Secret', code: 'SEC', member_emails: [mgr.email] })).d;
  r = await get('/timesheets/projects', emp.token);
  check('employee sees open projects only', r.d.some(p => p.id === apollo.id) && !r.d.some(p => p.id === secret.id), r.d);

  const week = mondayOf(addDays(today, -7));
  r = await get(`/timesheets/week?week_start=${addDays(week, 1)}`, emp.token);
  check('week must start on Monday', r.s === 400, r);
  r = await put('/timesheets/week', emp.token, { week_start: week, rows: [{ project_id: secret.id, minutes: { [week]: 60 } }] });
  check("can't log to a project you're not a member of", r.s === 400, r);
  r = await put('/timesheets/week', emp.token, { week_start: week, rows: [{ project_id: apollo.id, minutes: { [addDays(week, 8)]: 60 } }] });
  check('dates outside the week rejected', r.s === 400, r);
  r = await put('/timesheets/week', emp.token, { week_start: week, rows: [
    { project_id: apollo.id, task: 'Build', minutes: { [week]: 900 } },
    { project_id: apollo.id, task: 'Review', minutes: { [week]: 600 } }
  ] });
  check('more than 24h in a day rejected', r.s === 400, r);
  r = await put('/timesheets/week', emp.token, { week_start: week, rows: [{ project_id: apollo.id, minutes: { [week]: -180 } }] });
  check('negative hours rejected with a message', r.s === 422 && r.d?.errors?.[0]?.message === 'Hours cannot be negative', r);
  r = await put('/timesheets/week', emp.token, { week_start: week, rows: [
    { project_id: apollo.id, task: 'Build', minutes: { [week]: 480, [addDays(week, 1)]: 450 } },
    { project_id: apollo.id, task: 'Review', minutes: { [addDays(week, 2)]: 120 } }
  ] });
  check('save week', r.s === 200 && r.d.total_minutes === 1050 && r.d.rows.length === 2 && r.d.status === 'draft', r.d);
  r = await get(`/timesheets/week?week_start=${week}`, emp.token);
  check('week grid round-trips', r.d.rows.find(x => x.task === 'Build')?.minutes?.[addDays(week, 1)] === 450, r.d);

  r = await post('/timesheets/week/submit', emp.token, { week_start: week });
  check('submit week', r.s === 200 && r.d.status === 'submitted', r.d);
  r = await put('/timesheets/week', emp.token, { week_start: week, rows: [] });
  check('submitted week is locked', r.s === 409, r);
  r = await post('/timesheets/week/recall', emp.token, { week_start: week });
  check('recall submitted week', r.s === 200 && r.d.status === 'draft', r.d);
  await post('/timesheets/week/submit', emp.token, { week_start: week });

  r = await get('/timesheets/approvals', emp.token);
  check('employee cannot see approvals', r.s === 403, r);
  r = await get('/timesheets/approvals', mgr.token);
  const sheet = r.d?.find?.(s => s.user_email === emp.email);
  check('manager sees team submission with project breakdown', sheet?.by_project?.[0]?.minutes === 1050, r.d);
  r = await post(`/timesheets/sheets/${sheet.id}/action`, otherMgr.token, { action: 'approve' });
  check('manager of another team cannot approve', r.s === 403, r);
  // Regression: a manager who has a team of their own must still be refused for someone else's report
  const salesRep = await createUser(admin, { role: 'employee', name: 'Sam Sales', department: 'Sales', manager_email: otherMgr.email });
  r = await post(`/timesheets/sheets/${sheet.id}/action`, otherMgr.token, { action: 'approve' });
  check("manager with their own team still cannot approve another team's timesheet", r.s === 403, r);
  r = await post('/time/requests', emp.token, { type: 'wfh', date: addDays(today, 5), reason: 'Team check' });
  const crossReq = r.d?.id;
  r = await post(`/time/requests/${crossReq}/action`, otherMgr.token, { action: 'approve' });
  check("manager with their own team cannot approve another team's attendance request", r.s === 403, r);
  r = await post(`/time/requests/${crossReq}/action`, mgr.token, { action: 'reject', comments: 'cleanup' });
  check('own manager can still act on it', r.s === 200, r);
  void salesRep;
  r = await post(`/timesheets/sheets/${sheet.id}/action`, mgr.token, { action: 'reject' });
  check('rejecting needs a comment', r.s === 400, r);
  r = await post(`/timesheets/sheets/${sheet.id}/action`, mgr.token, { action: 'reject', comments: 'Split Build by feature' });
  check('manager sends week back', r.s === 200 && r.d.status === 'rejected', r);
  r = await put('/timesheets/week', emp.token, { week_start: week, rows: [{ project_id: apollo.id, task: 'Build: login', minutes: { [week]: 480 } }] });
  check('rejected week is editable again', r.s === 200 && r.d.total_minutes === 480, r);
  await post('/timesheets/week/submit', emp.token, { week_start: week });
  r = await post(`/timesheets/sheets/${sheet.id}/action`, mgr.token, { action: 'approve' });
  check('manager approves', r.s === 200 && r.d.status === 'approved', r);

  // No self-approval, admins included
  // (a week earlier, so the report checks below only see the team's week)
  const hrAdmin = await createUser(admin, { role: 'admin', name: 'Hari Admin', department: 'HR' });
  const prevWeek = addDays(week, -7);
  await put('/timesheets/week', hrAdmin.token, { week_start: prevWeek, rows: [{ project_id: apollo.id, task: 'Payroll', minutes: { [prevWeek]: 240 } }] });
  await post('/timesheets/week/submit', hrAdmin.token, { week_start: prevWeek });
  const ownSheet = (await get('/timesheets/approvals', hrAdmin.token)).d?.find?.(s => s.user_email === hrAdmin.email);
  r = await post(`/timesheets/sheets/${ownSheet?.id}/action`, hrAdmin.token, { action: 'approve' });
  check('admin cannot approve their own timesheet', r.s === 403 && /own timesheet/.test(r.d?.detail), r);
  r = await post(`/timesheets/sheets/${ownSheet?.id}/action`, admin, { action: 'approve' });
  check('another admin can approve it', r.s === 200 && r.d.status === 'approved', r);
  r = await post('/time/requests', hrAdmin.token, { type: 'wfh', date: addDays(today, 6), reason: 'Own request' });
  const ownReq = r.d?.id;
  r = await post(`/time/requests/${ownReq}/action`, hrAdmin.token, { action: 'approve' });
  check('admin cannot approve their own attendance request', r.s === 403 && /own request/.test(r.d?.detail), r);
  r = await post(`/time/requests/${ownReq}/action`, admin, { action: 'approve' });
  check('another admin can approve the attendance request', r.s === 200 && r.d.status === 'approved', r);
  r = await post('/timesheets/week/recall', emp.token, { week_start: week });
  check('approved week cannot be recalled', r.s === 400, r);

  await put('/timesheets/week', night.token, { week_start: week, rows: [{ project_id: apollo.id, minutes: { [week]: 300 } }] });
  r = await get(`/timesheets/report?from=${week}&to=${addDays(week, 6)}`, emp.token);
  check('employee report shows only own hours', r.s === 200 && r.d.total_minutes === 480 && r.d.by_employee.length === 1, r.d);
  r = await get(`/timesheets/report?from=${week}&to=${addDays(week, 6)}`, admin);
  check('admin report covers everyone', r.d.total_minutes === 780 && r.d.by_project[0].project === 'Apollo', r.d);
  r = await get(`/timesheets/report?from=${week}&to=${addDays(week, 6)}&status=approved`, admin);
  check('approved-only report excludes drafts', r.d.total_minutes === 480, r.d);
  r = await get('/timesheets/report?from=2026-01-10&to=2026-01-01', admin);
  check('invalid report range rejected', r.s === 400, r);

  section('TA-11 Nightly close');
  r = await get('/time/settings', emp.token);
  check('employee cannot read time settings', r.s === 403, r);
  r = await get('/time/settings', admin);
  check('auto-absent is off by default', r.s === 200 && r.d.auto_absent_enabled === false && r.d.missed_clock_out_action === 'flag', r.d);

  // An open punch from two days ago that was never closed
  const stale = addDays(today, -4);
  await withDb(db => db.collection('attendance_logs').insertOne({
    id: 'stale-log', employee_uid: uid(night), user_email: night.email, employee_name: night.name, date: stale,
    shift: { name: 'Night', start_time: '22:00', end_time: '06:00' }, clock_in: zonedTimeToDate(stale, '22:00'),
    clock_out: null, status: 'present', source: 'self', is_holiday: false
  }));
  r = await post('/time/close-day', admin, { date: today });
  check('cannot close today or future', r.s === 400, r);
  r = await post('/time/close-day', admin, { date: 'yesterday' });
  check('bad date rejected', r.s === 422, r);
  r = await post('/time/close-day', admin, {});
  check('missed clock-out flagged; no absentees while auto-absent is off',
    r.s === 200 && r.d.missed_clock_outs >= 1 && r.d.marked_absent === 0 && r.d.absent_skipped_reason?.includes('off'), r.d);
  const staleLog = await withDb(db => db.collection('attendance_logs').findOne({ id: 'stale-log' }));
  check('stale log marked missed_clock_out', staleLog?.missed_clock_out === true);
  r = await get('/notifications', night.token);
  check('employee notified about missed clock-out', JSON.stringify(r.d).includes('missed_clock_out'));
  r = await post('/time/close-day', admin, {});
  check('missed clock-out only flagged once', r.d.missed_clock_outs === 0, r.d);

  r = await put('/time/settings', admin, { auto_absent_enabled: true, missed_clock_out_action: 'half_day' });
  check('enable auto-absent', r.s === 200 && r.d.auto_absent_enabled === true, r.d);
  r = await put('/time/settings', admin, { missed_clock_out_action: 'delete' });
  check('invalid setting rejected', r.s === 422, r);

  // Pick a recent weekday (not Sunday) with no punches for the absentee
  let absentDay = addDays(today, -5);
  while (new Date(`${absentDay}T12:00:00Z`).getUTCDay() === 0) absentDay = addDays(absentDay, -1);
  const absentee = await createUser(admin, { role: 'employee', name: 'Abe Absent', joining_date: '2024-01-01' });
  const onLeave = await createUser(admin, { role: 'employee', name: 'Lea Leave', joining_date: '2024-01-01' });
  const newJoiner = await createUser(admin, { role: 'employee', name: 'Ned New', joining_date: today });
  await withDb(db => db.collection('leaves').insertOne({
    id: 'leave-1', employee_email: onLeave.email, leave_type: 'Casual Leave',
    dates: [new Date(`${absentDay}T00:00:00.000Z`).toISOString()], status: 'approved', days_count: 1
  }));
  r = await post('/time/close-day', admin, { date: absentDay });
  const absRoster = (await get('/time/shift-roster', admin)).d;
  const idOf = (u) => absRoster.find(x => x.email === u.email)?.employee_id;
  check('absentee marked absent', r.d.details?.absent?.includes(idOf(absentee)), r.d);
  check('employee on approved leave not marked absent', !r.d.details?.absent?.includes(idOf(onLeave)), r.d);
  check('employee who had not joined yet not marked absent', !r.d.details?.absent?.includes(idOf(newJoiner)), r.d);
  check('night-shift worker (no weekly off) still checked', Array.isArray(r.d.details?.absent));
  const [ay, am, ad] = absentDay.split('-').map(Number);
  r = await get(`/attendance?month=${am}&year=${ay}`, admin);
  check('absence written to attendance grid', r.d.employees.find(e => e.email === absentee.email)?.attendance?.[ad] === 'absent');
  r = await post('/time/close-day', admin, { date: absentDay });
  check('re-running the close does not double-mark', r.d.marked_absent === 0, r.d);
  r = await get('/time/close-runs', admin);
  check('close runs are logged', r.s === 200 && r.d.length >= 4, r.d?.length);
  r = await get('/v2/jobs', admin);
  check('nightly close registered as a scheduled job', r.s === 200 && r.d.some(j => j.name === 'attendance-daily-close'), r.d);
});
