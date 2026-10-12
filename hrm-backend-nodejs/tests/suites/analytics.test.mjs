// Phase 9 — Analytics: people, attendance & leave, payroll cost, exports, custom & scheduled reports (AN-1 … AN-5)
import { run, section, check, get, post, put, del, http, bootstrap, createUser, withDb } from '../lib/harness.mjs';

const D = (s) => new Date(`${s}T00:00:00Z`);
const iso = (s) => `${s}T00:00:00.000Z`;
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const near = (a, b, eps = 0.011) => typeof a === 'number' && Math.abs(a - b) < eps;
const kolkata = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const kolkataParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
const addMonths = (m, n) => {
  const [y, mm] = m.split('-').map(Number);
  const idx = y * 12 + mm - 1 + n;
  return `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, '0')}`;
};
const csvLines = (r) => r.buf.toString('utf8').replace(/^﻿/, '').split('\r\n');
const A = '/v2/analytics';

await run(async () => {
  const admin = await bootstrap();
  const mgr = await createUser(admin, { role: 'manager', name: 'Maya Sales', department: 'Sales', designation: 'Sales Manager', joining_date: '2023-01-01' });
  const emp = await createUser(admin, { role: 'employee', name: 'Eli Sales', department: 'Sales', designation: 'Account Executive', manager_email: mgr.email, joining_date: '2023-06-01' });

  // ---------- Seed data ----------
  const today = kolkata();
  const [ty, tm, td] = today.split('-').map(Number);
  let empUuid;
  await withDb(async (db) => {
    await db.collection('employees').updateOne({ email: 'admin@example.com' }, { $set: { joining_date: D('2020-01-01'), department: 'Administration', gender: 'female' } });
    await db.collection('employees').updateOne({ email: mgr.email }, { $set: { gender: 'M', date_of_birth: D('1985-05-10'), employment_status: 'active' } });
    // No employment_status at all ⇒ treated as active
    await db.collection('employees').updateOne({ email: emp.email }, { $set: { gender: 'Female', date_of_birth: D('1995-02-01') }, $unset: { employment_status: '' } });
    empUuid = (await db.collection('employees').findOne({ email: emp.email })).id;

    const base = { role: 'employee', created_at: new Date() };
    const acme = { organization_id: 'org-a', organization_name: 'Acme' };
    await db.collection('employees').insertMany([
      { ...base, ...acme, id: 'u-e1', employee_id: 'T001', email: 'e1@t.test', full_name: 'Arjun Rao', department: 'Engineering', designation: 'Engineer', manager_email: 'e2@t.test', joining_date: D('2022-03-15'), gender: 'Male', date_of_birth: D('1990-07-01'), monthly_salary: 60000, leave_balance: { casual_leave: 4, sick_leave: 3, earned_leave: 10, unpaid_leave: 2 } },
      { ...base, ...acme, id: 'u-e2', employee_id: 'T002', email: 'e2@t.test', full_name: 'Bina Shah', department: 'Engineering', designation: 'Engineering Lead', joining_date: D('2021-01-10'), gender: 'Female', date_of_birth: D('1982-11-20'), leave_balance: { casual_leave: 2, sick_leave: 5, earned_leave: 6.5 } },
      { ...base, ...acme, id: 'u-e3', employee_id: 'T003', email: 'e3@t.test', full_name: 'Chetan Iyer', department: 'Engineering', designation: 'Engineer', manager_email: 'e2@t.test', joining_date: D('2025-02-10'), gender: 'Male', date_of_birth: D('2001-04-04'), monthly_salary: 30000, leave_balance: { casual_leave: 1, sick_leave: 1 } },
      { ...base, ...acme, id: 'u-e4', employee_id: 'T004', email: 'e4@t.test', full_name: 'Divya Nair', department: 'Engineering', designation: 'Engineer', manager_email: 'e2@t.test', joining_date: D('2024-05-01'), exit_date: D('2025-03-31'), employment_status: 'exited', gender: 'Female', date_of_birth: D('1998-09-09') },
      { ...base, ...acme, id: 'u-e5', employee_id: 'T005', email: 'e5@t.test', full_name: 'Farhan Ali', department: 'Sales', designation: 'Account Executive', manager_email: mgr.email, joining_date: D('2025-03-03'), exit_date: D('2025-08-14'), employment_status: 'exited', gender: 'Male', monthly_salary: 35000 },
      { ...base, organization_id: 'org-b', organization_name: 'Beta', id: 'u-e6', employee_id: 'T006', email: 'e6@t.test', full_name: 'Gauri Patil', department: 'Sales', designation: 'Account Executive', manager_email: mgr.email, joining_date: D('2024-11-20'), gender: 'Female', date_of_birth: D('1993-12-31') },
      { ...base, ...acme, id: 'u-e7', employee_id: 'T007', email: 'e7@t.test', full_name: 'Hari Kumar', department: 'HR', designation: 'HR Executive', manager_email: 'e8@t.test', joining_date: D('2025-06-16'), employment_status: 'probation', date_of_birth: D('1999-06-30') },
      { ...base, ...acme, role: 'manager', id: 'u-e8', employee_id: 'T008', email: 'e8@t.test', full_name: 'Indira Menon', department: 'HR', designation: 'HR Manager', joining_date: D('2019-08-01'), gender: 'Female', date_of_birth: D('1975-01-15') },
      { ...base, ...acme, id: 'u-e9', employee_id: 'T009', email: 'e9@t.test', full_name: 'Jay Verma', department: 'Engineering', designation: 'Engineer', joining_date: D('2026-01-05'), gender: 'Male', monthly_salary: 45000, leave_balance: { casual_leave: 1.5 } },
      { ...base, ...acme, id: 'u-e10', employee_id: 'T010', email: 'e10@t.test', full_name: 'Kiran Das', department: 'Engineering', designation: 'Engineer', manager_email: 'e2@t.test', joining_date: D('2023-09-01'), exit_date: D('2025-12-31'), employment_status: 'exited', gender: 'Male', date_of_birth: D('1992-03-03'), monthly_salary: 70000, leave_balance: { casual_leave: 0, earned_leave: 4 } }
    ]);
    await db.collection('salary_structures').insertMany([
      { employee_id: 'T002', basic_salary: 45000, components: [], gross_salary: 90000, total_deductions: 12000, net_salary: 78000 },
      { employee_id: 'T006', basic_salary: 25000, components: [], gross_salary: 50000, total_deductions: 5000, net_salary: 45000 }
    ]);

    // Attendance grid, November 2025
    const empCode = (await db.collection('employees').findOne({ email: emp.email })).employee_id;
    await db.collection('attendance').insertMany([
      { employee_id: 'T001', month: 11, year: 2025, attendance: { 3: 'present', 4: 'present', 5: 'absent', 6: 'present', 7: 'leave' } },
      { employee_id: 'T002', month: 11, year: 2025, attendance: { 3: 'present', 4: 'half-day', 5: 'present', 6: 'present', 7: 'present' } },
      { employee_id: 'T003', month: 11, year: 2025, attendance: { 3: 'absent', 4: 'present', 5: 'present', 7: 'present' } },
      { employee_id: empCode, month: 11, year: 2025, attendance: { 3: 'present', 4: 'absent', 5: 'present', 6: 'present', 7: 'present' } },
      { employee_id: 'T006', month: 11, year: 2025, attendance: { 3: 'present', 4: 'present', 5: 'present', 6: 'present', 7: 'present' } },
      // Today (dashboard widget)
      { employee_id: 'T001', month: tm, year: ty, attendance: { [td]: 'present' } },
      { employee_id: 'T002', month: tm, year: ty, attendance: { [td]: 'absent' } },
      { employee_id: 'T003', month: tm, year: ty, attendance: { [td]: 'half-day' } }
    ]);
    const log = (uid, name, dept, date, late, worked, ot, status = 'present') => ({
      id: `log-${uid}-${date}`, employee_uid: uid, employee_name: name, user_email: `${uid}@x`, department: dept, date,
      clock_in: at(date, '09:30'), clock_out: at(date, '18:30'), late_minutes: late, is_late: late > 0,
      worked_minutes: worked, overtime_minutes: ot, early_exit_minutes: 0, status, work_mode: 'office', source: 'self',
      clock_in_location: { latitude: 1, longitude: 2 }
    });
    await db.collection('attendance_logs').insertMany([
      log('T001', 'Arjun Rao', 'Engineering', '2025-11-03', 20, 500, 20),
      log('T001', 'Arjun Rao', 'Engineering', '2025-11-04', 0, 480, 0),
      log('T002', 'Bina Shah', 'Engineering', '2025-11-03', 0, 540, 60),
      log('T003', 'Chetan Iyer', 'Engineering', '2025-11-04', 35, 450, 0),
      log('T003', 'Chetan Iyer', 'Engineering', '2025-11-06', 10, 470, 0),
      log('T001', 'Arjun Rao', 'Engineering', '2025-11-06', 15, 495, 15),
      log(empCode, 'Eli Sales', 'Sales', '2025-11-05', 40, 400, 0),
      { ...log('T006', 'Gauri Patil', 'Sales', today, 0, 0, 0), clock_out: null, worked_minutes: 0 }
    ]);

    const leave = (id, e, email, name, type, dates, days, status, half = false) => ({
      id, employee_id: e, employee_email: email, employee_name: name, leave_type: type, dates: dates.map(iso),
      days_count: days, is_half_day: half, status, reason: 'Personal', created_at: iso(dates[0])
    });
    await db.collection('leaves').insertMany([
      leave('L1', 'u-e1', 'e1@t.test', 'Arjun Rao', 'Casual Leave', ['2025-11-07'], 1, 'approved'),
      leave('L2', 'u-e2', 'e2@t.test', 'Bina Shah', 'Sick Leave', ['2025-10-20', '2025-10-21'], 2, 'approved'),
      leave('L3', 'u-e3', 'e3@t.test', 'Chetan Iyer', 'Casual Leave', ['2025-11-20'], 0.5, 'approved', true),
      leave('L4', 'u-e1', 'e1@t.test', 'Arjun Rao', 'Earned Leave', ['2025-10-27', '2025-10-28', '2025-10-29'], 3, 'approved'),
      leave('L5', 'u-e2', 'e2@t.test', 'Bina Shah', 'Casual Leave', ['2025-11-25'], 1, 'pending'),
      leave('L6', 'u-e3', 'e3@t.test', 'Chetan Iyer', 'Sick Leave', ['2025-10-10'], 1, 'rejected'),
      leave('L7', 'u-e1', 'e1@t.test', 'Arjun Rao', 'Casual Leave', ['2025-09-30', '2025-10-01'], 2, 'approved'),
      leave('L8', empUuid, emp.email, 'Eli Sales', 'Casual Leave', ['2025-11-12'], 1, 'approved')
    ]);

    const slip = (month, uid, name, dept, gross, ded, net, pf, esi = 0, lop = 0) => ({
      id: `ps-${month}-${uid}`, run_id: `run-${month}`, month, employee_uid: uid, employee_name: name, department: dept,
      gross_earnings: gross, total_deductions: ded, net_pay: net, lop_days: lop ? 2 : 0, lop_amount: lop, earnings: [], deductions: [],
      employer_contributions: { pf, esi }, status: 'final', bank_account_number: '000111222'
    });
    await db.collection('payslips').insertMany([
      slip('2025-09', 'T001', 'Arjun Rao', 'Engineering', 60000, 7200, 52800, 1800),
      slip('2025-09', 'T002', 'Bina Shah', 'Engineering', 90000, 12000, 78000, 1800),
      slip('2025-09', empCode, 'Eli Sales', 'Sales', 40000, 4000, 36000, 1800, 1300),
      slip('2025-10', 'T001', 'Arjun Rao', 'Engineering', 62000, 7400, 54600, 1800),
      slip('2025-10', 'T002', 'Bina Shah', 'Engineering', 90000, 12000, 78000, 1800),
      slip('2025-10', empCode, 'Eli Sales', 'Sales', 40000, 4000, 36000, 1800, 1300),
      slip('2025-10', 'T003', 'Chetan Iyer', 'Engineering', 30000, 4000, 26000, 1800, 975, 2000),
      { ...slip('2025-10', 'T010', 'Kiran Das', 'Engineering', 99999, 0, 99999, 0), id: 'ps-cancelled', status: 'cancelled' }
    ]);
    await db.collection('job_postings').insertMany([
      { id: 'j1', title: 'Backend Engineer', status: 'open', openings: 3 },
      { id: 'j2', title: 'Recruiter', status: 'published' },
      { id: 'j3', title: 'Designer', status: 'closed', openings: 2 }
    ]);
  });

  // =====================================================================
  section('AN-1 People analytics');
  let r = await get(`${A}/people?from=2025-01&to=2025-12`, admin);
  check('admin gets people analytics', r.s === 200, r);
  const p = r.d;
  check('headcount trend by month (closing)', JSON.stringify(p.trend.map(t => t.headcount)) === JSON.stringify([9, 10, 10, 10, 10, 11, 11, 10, 10, 10, 10, 9]), p.trend);
  check('opening headcount of the range is 9', p.summary.opening_headcount === 9 && p.trend[0].opening === 9, p.summary);
  check('joiners per month (Feb, Mar, Jun)', JSON.stringify(p.trend.map(t => t.joiners)) === JSON.stringify([0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]), p.trend.map(t => t.joiners));
  check('leavers per month (Mar, Aug, Dec 31st)', JSON.stringify(p.trend.map(t => t.leavers)) === JSON.stringify([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1]), p.trend.map(t => t.leavers));
  check('monthly attrition: Mar 10%, Aug 9.52%, Dec 10.53%', p.trend[2].attrition_pct === 10 && p.trend[7].attrition_pct === 9.52 && p.trend[11].attrition_pct === 10.53, p.trend.map(t => t.attrition_pct));
  check('summary: 3 joiners, 3 leavers, avg headcount 10', p.summary.joiners === 3 && p.summary.leavers === 3 && p.summary.avg_headcount === 10, p.summary);
  check('attrition 30% (annualised 30%)', p.summary.attrition_pct === 30 && p.summary.attrition_annualised_pct === 30, p.summary);
  check('snapshot headcount as of 2025-12-31 is 9', p.summary.headcount === 9 && p.range.as_of === '2025-12-31', p.summary);
  const split = (rows) => Object.fromEntries(rows.map(x => [x.key, x.count]));
  check('department split', JSON.stringify(split(p.splits.department)) === JSON.stringify({ Engineering: 3, Sales: 3, HR: 2, Administration: 1 }), p.splits.department);
  check('gender split normalises values; missing ⇒ Unspecified', JSON.stringify(split(p.splits.gender)) === JSON.stringify({ Female: 5, Male: 3, Unspecified: 1 }), p.splits.gender);
  check('employment status split (missing ⇒ active)', split(p.splits.employment_status).Active === 8 && split(p.splits.employment_status).Probation === 1, p.splits.employment_status);
  check('designation split', split(p.splits.designation)['Account Executive'] === 2 && split(p.splits.designation).Engineer === 2 && split(p.splits.designation)['HR Manager'] === 1, p.splits.designation);
  check('organization split', JSON.stringify(split(p.splits.organization)) === JSON.stringify({ Acme: 5, 'No organization': 3, Beta: 1 }), p.splits.organization);
  check('tenure bands', JSON.stringify(p.tenure_bands.map(b => b.count)) === JSON.stringify([0, 2, 1, 4, 2]), p.tenure_bands);
  check('average tenure 38.3 months', p.summary.avg_tenure_months === 38.3, p.summary);
  check('age bands use DOB only (8 of 9)', JSON.stringify(p.age_bands.map(b => b.count)) === JSON.stringify([1, 3, 3, 1, 0]) && p.data_quality.dob_coverage_pct === 88.9, { bands: p.age_bands, dq: p.data_quality });
  check('average age 35', p.summary.avg_age === 35, p.summary);
  const span = p.span_of_control;
  check('span of control: 3 managers, avg 1.67, max 2', span.managers === 3 && span.avg_direct_reports === 1.67 && span.max_direct_reports === 2, span);
  check('span rows name managers', span.rows[0].manager_name === 'Bina Shah' && span.rows[0].direct_reports === 2 && span.rows[1].manager_name === 'Maya Sales' && span.rows[2].manager_name === 'Indira Menon', span.rows);
  check('roster lists active employees, no secrets', p.roster.length === 9 && !JSON.stringify(p).includes('hashed_password'), p.roster.length);

  r = await get(`${A}/people?from=2025-01&to=2025-12&department=Engineering`, admin);
  check('department filter: Engineering trend', JSON.stringify(r.d?.trend?.map(t => t.headcount)) === JSON.stringify([4, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3]), r.d?.trend);
  check('department filter: 2 leavers on avg 4.04 ⇒ 49.48% attrition', r.d.summary.leavers === 2 && r.d.summary.avg_headcount === 4.04 && r.d.summary.attrition_pct === 49.48, r.d.summary);
  r = await get(`${A}/people?from=2025-01&to=2025-12&organization_id=org-a`, admin);
  check('organization filter: Acme 3 leavers on avg 6 ⇒ 50%', r.d?.summary?.avg_headcount === 6 && r.d.summary.attrition_pct === 50 && r.d.trend[11].headcount === 5, r.d?.summary);
  r = await get(`${A}/people?from=2025-01&to=2025-12&organization_id=org-b`, admin);
  check('organization filter: Beta steady at 1', r.d?.trend?.every(t => t.headcount === 1) && r.d.summary.attrition_pct === 0, r.d?.trend);
  r = await get(`${A}/people?from=2025-07&to=2025-12`, admin);
  check('6-month range annualises attrition (2 leavers)', r.d?.summary?.leavers === 2 && near(r.d.summary.attrition_annualised_pct, r.d.summary.attrition_pct * 2, 0.02), r.d?.summary);

  r = await get(`${A}/people?from=2025-01&to=2025-12`, mgr.token);
  check('manager sees only their team (3 people)', r.s === 200 && r.d.summary.opening_headcount === 2 && r.d.summary.joiners === 1 && r.d.summary.leavers === 1 && r.d.summary.headcount === 2, r.d?.summary);
  check('manager team attrition 41.38% on avg 2.42', r.d.summary.avg_headcount === 2.42 && r.d.summary.attrition_pct === 41.38, r.d.summary);
  check('manager response never includes other departments', !JSON.stringify(r.d).includes('Arjun') && !JSON.stringify(r.d).includes('Engineering'), r.d.splits);
  r = await get(`${A}/people?from=2025-01&to=2025-12&department=Engineering`, mgr.token);
  check('manager cannot widen scope with a department filter', r.s === 200 && r.d.summary.headcount === 0 && r.d.roster.length === 0, r.d?.summary);
  r = await get(`${A}/people`, emp.token);
  check('employee cannot view people analytics', r.s === 403, r);
  r = await get(`${A}/people?from=2025-13`, admin);
  check('invalid month rejected (422)', r.s === 422, r);
  r = await get(`${A}/people?from=2025-12&to=2025-01`, admin);
  check('reversed range rejected (400)', r.s === 400, r);
  r = await get(`${A}/people?from=2019-01&to=2025-12`, admin);
  check('range over 60 months rejected', r.s === 400, r);
  r = await get(`${A}/people`, null);
  check('unauthenticated request rejected', r.s === 401, r);

  // =====================================================================
  section('AN-2 Attendance and leave trends');
  r = await get(`${A}/attendance?from=2025-10-01&to=2025-11-30&department=Engineering`, admin);
  check('admin gets attendance analytics', r.s === 200 && r.d.daily.length === 61, r.s);
  const a = r.d;
  const day = (d) => a.daily.find(x => x.date === d);
  check('2025-11-03: 2 present / 1 absent ⇒ 66.67%, unmarked counted separately', day('2025-11-03').attendance_pct === 66.67 && day('2025-11-03').unmarked === 1 && day('2025-11-03').active_headcount === 4, day('2025-11-03'));
  check('2025-11-04: half-day counts 0.5 ⇒ 83.33%', day('2025-11-04').attendance_pct === 83.33, day('2025-11-04'));
  check('2025-11-06: punch log fills a missing grid cell ⇒ 100%', day('2025-11-06').attendance_pct === 100 && day('2025-11-06').present === 3, day('2025-11-06'));
  check('2025-11-07: leave excluded from attendance %', day('2025-11-07').attendance_pct === 100 && day('2025-11-07').on_leave === 1, day('2025-11-07'));
  check('unmarked days have no attendance %', day('2025-10-15').attendance_pct === null, day('2025-10-15'));
  check('overall attendance 82.14%, absenteeism 16.67%', a.summary.attendance_pct === 82.14 && a.summary.absenteeism_pct === 16.67 && a.summary.tracked_days === 5, a.summary);
  const eng = a.absenteeism_by_department.find(x => x.department === 'Engineering');
  check('absenteeism by department', eng && eng.employees === 4 && eng.absence_days === 2.5 && eng.marked_days === 15 && eng.absenteeism_pct === 16.67, eng);
  const late = (d) => a.late_trend.find(x => x.date === d)?.late_arrivals;
  check('late arrivals trend (1, 1, 0, 2)', late('2025-11-03') === 1 && late('2025-11-04') === 1 && late('2025-11-05') === 0 && late('2025-11-06') === 2 && a.summary.late_arrivals === 4, a.late_trend.filter(x => x.late_arrivals));
  check('top late arrivers ordered by count then minutes', a.top_late_arrivers.length === 2 && a.top_late_arrivers[0].full_name === 'Chetan Iyer' && a.top_late_arrivers[0].late_minutes === 45 && a.top_late_arrivers[0].avg_late_minutes === 22.5 && a.top_late_arrivers[1].late_minutes === 35, a.top_late_arrivers);
  check('average worked hours 8.15 and 95 overtime minutes', a.summary.avg_worked_hours === 8.15 && a.summary.avg_worked_minutes === 489.17 && a.summary.total_overtime_minutes === 95 && a.summary.overtime_days === 3, a.summary);
  check('hours by department', a.hours_by_department[0]?.avg_worked_hours === 8.15 && a.hours_by_department[0].total_overtime_hours === 1.58 && a.hours_by_department[0].avg_overtime_minutes === 15.8, a.hours_by_department);
  const lu = a.leave_usage;
  check('leave types used', JSON.stringify(lu.types) === JSON.stringify(['Casual Leave', 'Earned Leave', 'Sick Leave']), lu.types);
  check('leave usage Oct: casual 1 (range-clipped), earned 3, sick 2', lu.months[0]['Casual Leave'] === 1 && lu.months[0]['Earned Leave'] === 3 && lu.months[0]['Sick Leave'] === 2 && lu.months[0].total === 6, lu.months[0]);
  check('leave usage Nov: casual 1.5 (half day), pending/rejected ignored', lu.months[1]['Casual Leave'] === 1.5 && lu.months[1].total === 1.5, lu.months[1]);
  check('leave days taken 7.5', a.summary.leave_days_taken === 7.5, a.summary);
  check('top leave takers', a.top_leave_takers.map(t => `${t.full_name}:${t.days}`).join(',') === 'Arjun Rao:5,Bina Shah:2,Chetan Iyer:0.5', a.top_leave_takers);
  const liab = a.leave_liability;
  check('leave liability counts currently employed staff (4) and skips unpaid leave', liab.employees === 4 && liab.total_days === 34, liab);
  check('liability by type', liab.by_type.map(t => `${t.leave_type}:${t.days}`).join(',') === 'Earned Leave:16.5,Sick Leave:9,Casual Leave:8.5', liab.by_type);
  check('encashable value from salary (structure first) = 39500', liab.encashable_value === 39500 && liab.valued_employees === 4, liab);

  r = await get(`${A}/attendance?from=2025-10-01&to=2025-11-30`, mgr.token);
  check('manager sees team attendance only (90%)', r.s === 200 && r.d.summary.attendance_pct === 90 && r.d.summary.present_days === 9 && r.d.summary.absent_days === 1, r.d?.summary);
  check('manager late arrivers are team members only', r.d.top_late_arrivers.length === 1 && r.d.top_late_arrivers[0].full_name === 'Eli Sales' && r.d.summary.late_arrivals === 1, r.d.top_late_arrivers);
  check('manager leave usage is team only', r.d.summary.leave_days_taken === 1 && !JSON.stringify(r.d).includes('Arjun'), r.d.summary);
  check('manager does not get salary-based liability value', r.d.leave_liability.encashable_value === null, r.d.leave_liability);
  r = await get(`${A}/attendance`, emp.token);
  check('employee cannot view attendance analytics', r.s === 403, r);
  r = await get(`${A}/attendance?from=2025/11/01`, admin);
  check('bad date format rejected (422)', r.s === 422, r);
  r = await get(`${A}/attendance?from=2024-01-01&to=2025-12-31`, admin);
  check('range over 366 days rejected', r.s === 400, r);
  r = await get(`${A}/attendance?from=2025-11-30&to=2025-11-01`, admin);
  check('reversed date range rejected', r.s === 400, r);
  r = await get(`${A}/attendance?from=2025-02-30&to=2025-03-05`, admin);
  check('impossible calendar date rejected', r.s === 422, r);

  // =====================================================================
  section('AN-3 Payroll cost analytics');
  r = await get(`${A}/payroll-cost?from=2025-08&to=2025-11`, admin);
  check('admin gets payroll cost', r.s === 200 && r.d.months.length === 4, r);
  const pc = r.d;
  const m = (k) => pc.months.find(x => x.month === k);
  check('mixed source reported', pc.source === 'mixed' && m('2025-08').source === 'estimated' && m('2025-09').source === 'payslips', pc.months.map(x => x.source));
  check('Aug estimated from structures (2) + monthly salary (4)', m('2025-08').gross === 335000 && m('2025-08').net === 318000 && m('2025-08').headcount === 6 && m('2025-08').basis.salary_structures === 2 && m('2025-08').basis.monthly_salary === 4, m('2025-08'));
  check('Sep from payslips: gross 190000, net 166800, employer cost 196700', m('2025-09').gross === 190000 && m('2025-09').net === 166800 && m('2025-09').deductions === 23200 && m('2025-09').employer_contributions === 6700 && m('2025-09').employer_cost === 196700, m('2025-09'));
  check('Oct ignores cancelled payslips: employer cost 229475, 4 heads', m('2025-10').employer_cost === 229475 && m('2025-10').headcount === 4, m('2025-10'));
  check('Oct LOP: earned gross 220000, deductions excl. LOP 25400, LOP 2000, net 194600', m('2025-10').gross === 220000 && m('2025-10').deductions === 25400 && m('2025-10').lop === 2000 && m('2025-10').net === 194600, m('2025-10'));
  check('cost per head trend', m('2025-08').cost_per_head === 55833.33 && m('2025-09').cost_per_head === 65566.67 && m('2025-10').cost_per_head === 57368.75 && m('2025-11').cost_per_head === 60000, pc.months.map(x => x.cost_per_head));
  check('month-over-month change %', m('2025-08').mom_change_pct === null && m('2025-09').mom_change_pct === -41.28 && m('2025-10').mom_change_pct === 16.66 && m('2025-11').mom_change_pct === 30.73, pc.months.map(x => x.mom_change_pct));
  check('totals', pc.summary.total_employer_cost === 1061175 && pc.summary.total_gross === 1045000 && pc.summary.total_net === 962400, pc.summary);
  const dep = Object.fromEntries(pc.by_department.map(x => [x.department, x]));
  check('cost by department', dep.Engineering?.employer_cost === 839975 && dep.Sales?.employer_cost === 221200 && dep.Engineering.share_pct === 79.2 && dep.Engineering.avg_headcount === 3.25 && dep.Sales.avg_headcount === 1.25, pc.by_department);
  check('employees without salary data reported', pc.data_quality.employees_without_salary === 5, pc.data_quality);
  r = await get(`${A}/payroll-cost?from=2025-08&to=2025-11&department=Engineering`, admin);
  check('department filter', JSON.stringify(r.d?.months?.map(x => x.employer_cost)) === JSON.stringify([250000, 153600, 186375, 250000]), r.d?.months);
  r = await get(`${A}/payroll-cost?from=2025-09&to=2025-10`, admin);
  check('payslip-only range reports payslips source', r.d?.source === 'payslips', r.d?.source);
  r = await get(`${A}/payroll-cost?from=2099-01&to=2099-02`, admin);
  check('future-only range rejected after clamping to current month', r.s === 400, r);
  r = await get(`${A}/payroll-cost`, mgr.token);
  check('manager cannot view payroll cost', r.s === 403, r);
  r = await get(`${A}/payroll-cost`, emp.token);
  check('employee cannot view payroll cost', r.s === 403, r);
  r = await get(`${A}/payroll-cost?to=bad`, admin);
  check('invalid month rejected', r.s === 422, r);

  // =====================================================================
  section('AN-4 Exports');
  r = await get(`${A}/export?section=people&table=headcount_trend&from=2025-01&to=2025-12`, admin, { raw: true });
  let lines = csvLines(r);
  check('people headcount CSV', r.s === 200 && r.headers.get('content-type').includes('text/csv') && lines.length === 13, { s: r.s, lines: lines.length });
  check('CSV header and March row', lines[0] === 'Month,Opening headcount,Closing headcount,Joiners,Leavers,Average headcount,Attrition %' && lines[3] === '2025-03,10,10,1,1,10,10', lines.slice(0, 4));
  check('download filename', /attachment; filename="people-headcount-trend-2025-01_2025-12\.csv"/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'));
  r = await get(`${A}/export?section=attendance&table=punch_logs&from=2025-11-01&to=2025-11-30&department=Engineering`, admin, { raw: true });
  lines = csvLines(r);
  check('raw punch log CSV (6 rows, no location)', r.s === 200 && lines.length === 7 && !lines.join().includes('latitude'), lines);
  r = await get(`${A}/export?section=attendance&table=leave_usage&from=2025-10-01&to=2025-11-30&department=Engineering`, admin, { raw: true });
  lines = csvLines(r);
  check('leave usage CSV has a column per leave type', lines[0] === 'Month,Casual Leave,Earned Leave,Sick Leave,Total days' && lines[1] === '2025-10,1,3,2,6', lines);
  r = await get(`${A}/export?section=payroll-cost&table=by_department&from=2025-08&to=2025-11`, admin, { raw: true });
  lines = csvLines(r);
  check('payroll by-department CSV', r.s === 200 && lines[1].startsWith('Engineering,') && lines[1].includes('839975'), lines);
  r = await get(`${A}/export?section=payroll-cost&table=months`, mgr.token);
  check('manager cannot export payroll cost', r.s === 403, r);
  r = await get(`${A}/export?section=attendance&table=punch_logs&from=2025-11-01&to=2025-11-30`, mgr.token, { raw: true });
  lines = csvLines(r);
  check('manager punch-log export is team only', r.s === 200 && lines.length === 2 && lines[1].includes('Eli Sales'), lines);
  r = await get(`${A}/export?section=people&table=nope`, admin);
  check('unknown table rejected', r.s === 400, r);
  r = await get(`${A}/export?section=people&table=roster&from=bad`, admin);
  check('export validates filters', r.s === 422, r);
  r = await get(`${A}/export?section=people&table=roster`, emp.token);
  check('employee cannot export', r.s === 403, r);

  r = await get(`${A}/leave-report?month=2025-11`, admin);
  check('leave report (Reports page): 4 leaves in Nov', r.s === 200 && r.d.rows.length === 4 && r.d.summary.approved === 3 && r.d.summary.pending === 1, r.d);
  check('leave report joins employee details', r.d.rows[0].start_date === '2025-11-07' && r.d.rows[0].department === 'Engineering' && r.d.rows[0].employee_code === 'T001', r.d.rows[0]);
  r = await get(`${A}/leave-report?month=2025-11&status=approved&department=Engineering`, admin);
  check('leave report filters', r.d?.rows?.length === 2, r.d?.rows);
  r = await get(`${A}/leave-report?month=2025-11`, mgr.token);
  check('manager leave report is team only', r.s === 200 && r.d.rows.length === 1 && r.d.rows[0].employee_name === 'Eli Sales', r.d);
  r = await get(`${A}/leave-report?month=2025-11&employee_email=e1@t.test`, mgr.token);
  check('manager cannot pull an outsider by email', r.s === 200 && r.d.rows.length === 0, r.d);
  r = await get(`${A}/leave-report?month=2025-11&employee_email=${encodeURIComponent(emp.email)}`, mgr.token);
  check('manager can narrow to a team member by email', r.s === 200 && r.d.rows.length === 1, r.d);
  r = await get(`${A}/attendance?from=2025-11-01&to=2025-11-30&organization_id=org-a`, mgr.token);
  check('manager attendance with an org filter stays within the team', r.s === 200 && !JSON.stringify(r.d).includes('Arjun') && r.d.summary.employees <= 3, r.d?.summary);
  r = await get(`${A}/leave-report?month=2025-11&format=csv`, admin, { raw: true });
  lines = csvLines(r);
  check('leave report CSV', r.s === 200 && lines.length === 5 && lines[0].startsWith('Employee Name,Employee ID,Department'), lines);
  r = await get(`${A}/leave-report`, emp.token);
  check('employee cannot use leave report', r.s === 403, r);

  // =====================================================================
  section('AN-1/2 Dashboard widget');
  r = await get(`${A}/summary`, admin);
  check('summary for admin', r.s === 200, r);
  const curMonth = today.slice(0, 7);
  const e10InWindow = '2025-12' >= addMonths(curMonth, -11) ? 1 : 0;
  check('headcount today is 10', r.d.headcount === 10, r.d);
  check('leavers in the last 12 months', r.d.leavers_last_12_months === e10InWindow, r.d);
  check('attrition = leavers ÷ average headcount', near(r.d.attrition_12m_pct, r.d.avg_headcount_12m ? Math.round(r.d.leavers_last_12_months / r.d.avg_headcount_12m * 10000) / 100 : 0, 0.02), r.d);
  check("today's attendance 62.5% (grid + punch log)", r.d.today.attendance_pct === 62.5 && r.d.today.present === 2 && r.d.today.half_day === 1 && r.d.today.absent === 1, r.d.today);
  check('open positions from job_postings (3 + 1)', r.d.open_positions === 4, r.d);
  r = await get(`${A}/summary`, mgr.token);
  check('manager cannot read the admin widget', r.s === 403, r);

  // =====================================================================
  section('AN-5 Custom and scheduled reports');
  r = await get(`${A}/reports/datasets`, admin);
  const dsKeys = r.d?.datasets?.map(d => d.key) || [];
  check('dataset whitelist', ['employees', 'leaves', 'attendance_logs', 'attendance', 'payslips', 'reimbursements', 'assets'].every(k => dsKeys.includes(k)), dsKeys);
  check('no secret fields are offered', !JSON.stringify(r.d).match(/password|hashed|token|secret|bank_account|location/i), null);
  r = await get(`${A}/reports/datasets`, mgr.token);
  check('managers do not see the payslips dataset', r.s === 200 && !r.d.datasets.some(d => d.key === 'payslips'), r.d?.datasets?.map(d => d.key));
  r = await get(`${A}/reports/datasets`, emp.token);
  check('employee cannot use the report builder', r.s === 403, r);

  const preview = (definition, token = admin) => post(`${A}/reports/preview`, token, { definition });
  r = await preview({ dataset: 'employees', fields: ['full_name', 'department'], filters: [{ field: 'department', op: 'equals', value: 'engineering' }], sort: [{ field: 'full_name', direction: 'asc' }] });
  check('equals filter (case-insensitive) + sort', r.s === 200 && r.d.total_rows === 6 && r.d.rows.map(x => x.full_name).join(',') === 'Arjun Rao,Bina Shah,Chetan Iyer,Divya Nair,Jay Verma,Kiran Das', r.d);
  check('only the selected columns are returned', JSON.stringify(Object.keys(r.d.rows[0])) === '["full_name","department"]' && r.d.columns[0].label === 'Name', r.d.rows[0]);
  r = await preview({ dataset: 'employees', group_by: ['department'], aggregates: [{ fn: 'count' }], sort: [{ field: 'count', direction: 'desc' }] });
  check('group by department with count', r.s === 200 && r.d.rows.map(x => `${x.department}:${x.count}`).join(',') === 'Engineering:6,Sales:4,HR:2,Administration:1', r.d?.rows);
  r = await preview({ dataset: 'employees', fields: ['full_name'], filters: [{ field: 'joining_date', op: 'between', value: ['2025-01-01', '2025-12-31'] }] });
  check('date between filter', r.d?.total_rows === 3, r.d);
  r = await preview({ dataset: 'employees', fields: ['full_name'], filters: [{ field: 'department', op: 'in', value: ['HR', 'Sales'] }] });
  check('in filter', r.d?.total_rows === 6, r.d);
  r = await preview({ dataset: 'employees', fields: ['full_name', 'monthly_salary'], filters: [{ field: 'monthly_salary', op: 'between', value: [30000, 60000] }], sort: [{ field: 'monthly_salary', direction: 'desc' }] });
  check('number between filter + numeric sort', r.d?.total_rows === 4 && r.d.rows.map(x => x.monthly_salary).join(',') === '60000,45000,35000,30000', r.d?.rows);
  r = await preview({ dataset: 'employees', fields: ['full_name'], filters: [{ field: 'full_name', op: 'contains', value: 'SHAH' }] });
  check('contains filter', r.d?.total_rows === 1 && r.d.rows[0].full_name === 'Bina Shah', r.d);
  r = await preview({ dataset: 'payslips', group_by: ['month'], aggregates: [{ fn: 'sum', field: 'net_pay' }, { fn: 'avg', field: 'gross_earnings' }], filters: [{ field: 'status', op: 'not_equals', value: 'cancelled' }] });
  check('payslips sum / avg by month', JSON.stringify(r.d?.rows) === JSON.stringify([{ month: '2025-09', sum_net_pay: 166800, avg_gross_earnings: 63333.33 }, { month: '2025-10', sum_net_pay: 194600, avg_gross_earnings: 55500 }]), r.d);
  r = await preview({ dataset: 'payslips', group_by: ['month'], aggregates: [{ fn: 'sum', field: 'earned_gross' }, { fn: 'sum', field: 'lop_amount' }, { fn: 'sum', field: 'employer_cost' }], filters: [{ field: 'month', op: 'equals', value: '2025-10' }, { field: 'status', op: 'not_equals', value: 'cancelled' }] });
  check('payslips dataset nets out LOP (earned gross / employer cost)', JSON.stringify(r.d?.rows) === JSON.stringify([{ month: '2025-10', sum_earned_gross: 220000, sum_lop_amount: 2000, sum_employer_cost: 229475 }]), r.d);
  r = await preview({ dataset: 'leaves', group_by: ['leave_type'], aggregates: [{ fn: 'sum', field: 'days_count' }], filters: [{ field: 'status', op: 'equals', value: 'approved' }] });
  check('leaves sum of days by type', r.d?.rows?.map(x => `${x.leave_type}:${x.sum_days_count}`).join(',') === 'Casual Leave:4.5,Earned Leave:3,Sick Leave:2', r.d);
  r = await preview({ dataset: 'attendance', fields: ['date', 'employee_name', 'status'], filters: [{ field: 'date', op: 'between', value: ['2025-11-03', '2025-11-07'] }, { field: 'status', op: 'equals', value: 'absent' }] });
  check('attendance grid dataset (one row per marked day)', r.d?.total_rows === 3, r.d);
  r = await preview({ dataset: 'attendance_logs', group_by: ['department'], aggregates: [{ fn: 'count' }, { fn: 'max', field: 'late_minutes' }], filters: [{ field: 'is_late', op: 'equals', value: true }] });
  check('attendance logs: late count by department', r.d?.rows?.map(x => `${x.department}:${x.count}:${x.max_late_minutes}`).join(',') === 'Engineering:4:35,Sales:1:40', r.d);
  r = await preview({ dataset: 'employees', fields: ['full_name'], limit: 2 });
  check('limit with total and truncated flag', r.d?.rows?.length === 2 && r.d.total_rows === 13 && r.d.truncated === true, r.d);
  r = await post(`${A}/reports/preview`, admin, { definition: { dataset: 'employees', fields: ['full_name', 'department'], sort: [{ field: 'full_name' }] }, format: 'csv' }, { raw: true });
  lines = csvLines(r);
  check('preview as CSV', r.s === 200 && lines[0] === 'Name,Department' && lines.length === 14, lines.slice(0, 2));

  r = await preview({ dataset: 'employees', fields: ['full_name'], filters: [{ field: 'hashed_password', op: 'equals', value: 'x' }] });
  check('non-whitelisted field rejected', r.s === 400, r);
  r = await preview({ dataset: 'employees', fields: ['hashed_password'] });
  check('non-whitelisted column rejected', r.s === 400, r);
  r = await preview({ dataset: 'employees', group_by: ['department'], aggregates: [{ fn: 'sum', field: 'full_name' }] });
  check('sum on a text field rejected', r.s === 400, r);
  r = await preview({ dataset: 'employees', filters: [{ field: 'joining_date', op: 'between', value: ['2025-01-01'] }] });
  check('between with one value rejected', r.s === 400, r);
  r = await preview({ dataset: 'employees', filters: [{ field: 'monthly_salary', op: 'contains', value: '5' }] });
  check('operator/type mismatch rejected', r.s === 400, r);
  r = await preview({ dataset: 'employees', fields: ['full_name'], sort: [{ field: 'department' }] });
  check('sort on a non-column rejected', r.s === 400, r);
  r = await preview({ dataset: 'users', fields: ['email'] });
  check('unknown dataset rejected (422)', r.s === 422, r);
  r = await preview({ dataset: 'employees' }, mgr.token);
  check('manager cannot run ad-hoc reports', r.s === 403, r);

  // ----- Saved reports -----
  const definition = { dataset: 'employees', fields: ['full_name', 'department'], sort: [{ field: 'full_name', direction: 'asc' }] };
  r = await post(`${A}/reports`, admin, { name: 'Roster', definition, schedule: { frequency: 'weekly', time: '09:00', day_of_week: 1, recipients: ['hr@example.com'] } });
  check('admin saves a scheduled report', r.s === 201 && r.d.id && r.d.schedule?.next_run_at, r);
  const reportId = r.d?.id;
  let next = new Date(r.d?.schedule?.next_run_at);
  let parts = kolkataParts(next);
  check('weekly schedule: next run is a future Monday 09:00 (company time)', next > new Date() && parts.weekday === 'Mon' && `${parts.hour}:${parts.minute}` === '09:00' && next - new Date() <= 7 * 86400000, { next, parts });
  r = await post(`${A}/reports`, admin, { name: 'Bad', definition, schedule: { frequency: 'weekly', time: '09:00', recipients: ['hr@example.com'] } });
  check('weekly schedule needs day_of_week', r.s === 422, r);
  r = await post(`${A}/reports`, admin, { name: 'Bad', definition, schedule: { frequency: 'daily', time: '9am', recipients: ['not-an-email'] } });
  check('bad time / recipient rejected', r.s === 422, r);
  r = await post(`${A}/reports`, admin, { name: 'Bad', definition: { dataset: 'employees', fields: ['hashed_password'] } });
  check('saved definitions are validated against the whitelist', r.s === 400, r);
  r = await post(`${A}/reports`, mgr.token, { name: 'Mine', definition });
  check('manager cannot save reports', r.s === 403, r);
  r = await post(`${A}/reports`, admin, { name: 'Payslip totals', definition: { dataset: 'payslips', group_by: ['month'], aggregates: [{ fn: 'sum', field: 'net_pay' }] }, shared_with_managers: true });
  const payslipReportId = r.d?.id;
  check('save unscheduled payslip report', r.s === 201 && r.d.schedule === null, r);

  r = await put(`${A}/reports/${reportId}`, admin, { name: 'Team roster', schedule: { frequency: 'monthly', time: '07:30', day_of_month: 5, recipients: ['hr@example.com', 'ceo@example.com'] } });
  next = new Date(r.d?.schedule?.next_run_at);
  parts = kolkataParts(next);
  check('edit report: monthly schedule on the 5th at 07:30', r.s === 200 && r.d.name === 'Team roster' && kolkata(next).endsWith('-05') && `${parts.hour}:${parts.minute}` === '07:30' && next > new Date(), r.d);
  r = await put(`${A}/reports/${reportId}`, admin, { definition: { dataset: 'employees', fields: ['full_name', 'department'], sort: [{ field: 'nope' }] } });
  check('edit validates the definition', r.s === 400, r);
  r = await get(`${A}/reports`, admin);
  check('admin lists saved reports', r.s === 200 && r.d.length === 2, r.d);
  r = await get(`${A}/reports/${reportId}/run`, admin);
  check('run saved report', r.s === 200 && r.d.total_rows === 13 && r.d.rows[0].full_name === 'Arjun Rao', r.d);
  r = await get(`${A}/reports/${reportId}/run?format=csv`, admin, { raw: true });
  lines = csvLines(r);
  check('download saved report as CSV', r.s === 200 && lines.length === 14 && lines[1] === 'Arjun Rao,Engineering', lines.slice(0, 2));

  r = await get(`${A}/reports`, mgr.token);
  check('manager sees no unshared reports; admin-only datasets never shared', r.s === 200 && r.d.length === 0, r.d);
  r = await get(`${A}/reports/${reportId}/run`, mgr.token);
  check('manager cannot run an unshared report', r.s === 404, r);
  await put(`${A}/reports/${reportId}`, admin, { shared_with_managers: true });
  r = await get(`${A}/reports`, mgr.token);
  check('manager sees a shared report without delivery details', r.d?.length === 1 && r.d[0].id === reportId && r.d[0].schedule === undefined, r.d);
  r = await get(`${A}/reports/${reportId}/run`, mgr.token);
  check('shared report runs scoped to the manager team', r.s === 200 && r.d.rows.map(x => x.full_name).join(',') === 'Eli Sales,Farhan Ali,Gauri Patil', r.d);
  r = await get(`${A}/reports/${payslipReportId}/run`, mgr.token);
  check('manager cannot run a shared payslip report', r.s === 404, r);
  r = await put(`${A}/reports/${reportId}`, mgr.token, { name: 'x' });
  check('manager cannot edit reports', r.s === 403, r);
  r = await get(`${A}/reports`, emp.token);
  check('employee cannot list reports', r.s === 403, r);

  // ----- Delivery: run now -----
  r = await post(`${A}/reports/${reportId}/send`, admin, {});
  check('run now: delivery logged as skipped without Mailjet', r.s === 200 && r.d.status === 'skipped' && r.d.row_count === 13 && r.d.recipients.length === 2 && r.d.trigger === 'manual', r.d);
  r = await post(`${A}/reports/${payslipReportId}/send`, admin, {});
  check('run now without recipients rejected', r.s === 400, r);
  r = await post(`${A}/reports/${payslipReportId}/send`, admin, { recipients: ['bad'] });
  check('run now validates recipient emails', r.s === 422, r);
  r = await post(`${A}/reports/${reportId}/send`, mgr.token, {});
  check('manager cannot trigger deliveries', r.s === 403, r);

  // ----- Delivery: cron job -----
  await withDb(db => db.collection('analytics_reports').updateOne({ id: reportId }, { $set: { 'schedule.next_run_at': new Date(Date.now() - 60000) } }));
  r = await post('/v2/jobs/scheduled-reports/run', admin, {});
  check('scheduled-reports job delivers due reports', r.s === 200 && r.d.result?.due === 1 && r.d.result.skipped === 1, r.d);
  r = await get(`${A}/reports/${reportId}`, admin);
  check('next run moved forward after delivery', new Date(r.d?.schedule?.next_run_at) > new Date() && r.d.last_delivery_status === 'skipped', r.d?.schedule);
  r = await post('/v2/jobs/scheduled-reports/run', admin, {});
  check('job does not resend a report that is not due', r.d?.result?.due === 0, r.d);
  r = await get(`${A}/reports/deliveries?report_id=${reportId}`, admin);
  check('delivery log lists manual and scheduled runs', r.s === 200 && r.d.length === 2 && r.d[0].trigger === 'schedule' && r.d[0].row_count === 13 && r.d[1].trigger === 'manual' && /not configured/i.test(r.d[0].error), r.d);
  r = await get(`${A}/reports/deliveries`, mgr.token);
  check('manager cannot read the delivery log', r.s === 403, r);

  // ----- Delete -----
  r = await del(`${A}/reports/${reportId}`, mgr.token);
  check('manager cannot delete reports', r.s === 403, r);
  r = await del(`${A}/reports/${reportId}`, admin);
  check('admin deletes report', r.s === 200, r);
  r = await get(`${A}/reports/${reportId}`, admin);
  check('deleted report is gone', r.s === 404, r);
  r = await get(`${A}/reports/deliveries?report_id=${reportId}`, admin);
  check('delivery history is kept after delete', r.d?.length === 2, r.d);
  r = await http('GET', `${A}/health`, null);
  check('health endpoint', r.s === 200 && r.d.module === 'analytics', r);
});
