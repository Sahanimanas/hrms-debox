/**
 * AN-2 Attendance and leave trends.
 *
 * Day status comes from the monthly `attendance` grid; when a day has no grid
 * entry the punch log (`attendance_logs`) status is used. Attendance % is
 * (present + ½ half-day) ÷ (present + half-day + absent) — leave, holidays
 * and unmarked days are left out. Absenteeism is (absent + ½ half-day) ÷ all
 * marked days including leave.
 */

const { defaultLeavePolicy } = require('../../models/schemas');
const {
  round, num, toDay, todayStr, dayRange, monthRange, employedOn, titleCase
} = require('./common');

const UNPAID_KEYS = new Set(['unpaid_leave', 'lop', 'loss_of_pay']);

const leaveKey = (type) => String(type || '').trim().toLowerCase().replace(/\s+/g, '_');

const emptyCounts = () => ({ present: 0, half_day: 0, absent: 0, on_leave: 0, holiday: 0, unmarked: 0 });

const bump = (c, status) => {
  switch (status) {
    case 'present': c.present += 1; break;
    case 'half-day': case 'half_day': c.half_day += 1; break;
    case 'absent': c.absent += 1; break;
    case 'leave': c.on_leave += 1; break;
    case 'holiday': case 'week-off': case 'weekly-off': case 'weekoff': c.holiday += 1; break;
    default: c.unmarked += 1;
  }
};

const attendancePct = (c) => {
  const denom = c.present + c.half_day + c.absent;
  return denom ? round((c.present + c.half_day * 0.5) / denom * 100) : null;
};

const absenteeismPct = (c) => {
  const marked = c.present + c.half_day + c.absent + c.on_leave;
  return marked ? round((c.absent + c.half_day * 0.5) / marked * 100) : null;
};

/** Days of an approved leave falling on each date. */
const perDayAmount = (leave, dateCount) => {
  const total = num(leave.days_count);
  if (total > 0 && dateCount > 0) return total / dateCount;
  return leave.is_half_day ? 0.5 : 1;
};

/** Monthly gross per employee uid (salary structure first, then monthly_salary). */
const loadDailyRates = async (db, employees) => {
  const ids = employees.map(e => e.employee_id).filter(Boolean);
  const structures = ids.length
    ? await db.collection('salary_structures').find({ employee_id: { $in: ids } }, { projection: { _id: 0, employee_id: 1, gross_salary: 1, basic_salary: 1 } }).toArray()
    : [];
  const byId = new Map(structures.map(s => [s.employee_id, s]));
  const rates = new Map();
  for (const e of employees) {
    const s = byId.get(e.employee_id);
    const monthly = s ? num(s.gross_salary) || num(s.basic_salary) : num(e.monthly_salary);
    if (monthly > 0) rates.set(e.uid, monthly / 30);
  }
  return rates;
};

const encashableKeys = async (db) => {
  const doc = await db.collection('leave_policies').findOne({}, { projection: { _id: 0, policies: 1 } });
  const policies = Array.isArray(doc?.policies) && doc.policies.length ? doc.policies : defaultLeavePolicy.policies;
  return new Set(policies.filter(p => p.encashment_allowed).map(p => leaveKey(p.leave_type)));
};

/**
 * @param employees normalised, scoped employees
 * @param opts { from, to: 'YYYY-MM-DD', today?, includeValue: bool (salary-based liability) }
 */
async function computeAttendance(db, employees, { from, to, today = todayStr(), includeValue = false }) {
  const lastDay = to < today ? to : today;
  const days = from <= lastDay ? dayRange(from, lastDay) : [];
  const months = monthRange(from.slice(0, 7), to.slice(0, 7));
  const uids = employees.map(e => e.uid).filter(Boolean);
  const emails = employees.map(e => e.email).filter(Boolean);
  const ids = employees.map(e => e.id).filter(Boolean);
  const byUid = new Map(employees.map(e => [e.uid, e]));
  const byEmail = new Map(employees.map(e => [e.email, e]));
  const byId = new Map(employees.map(e => [e.id, e]));

  const [gridDocs, logs, holidayDocs, leaves] = uids.length ? await Promise.all([
    db.collection('attendance').find({
      employee_id: { $in: uids },
      $or: months.map(m => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) }))
    }, { projection: { _id: 0, employee_id: 1, year: 1, month: 1, attendance: 1 } }).toArray(),
    db.collection('attendance_logs').find(
      { employee_uid: { $in: uids }, date: { $gte: from, $lte: to } },
      { projection: { _id: 0, employee_uid: 1, date: 1, status: 1, late_minutes: 1, is_late: 1, worked_minutes: 1, overtime_minutes: 1, clock_out: 1, early_exit_minutes: 1 } }
    ).toArray(),
    db.collection('holidays').find({}, { projection: { _id: 0, date: 1, name: 1 } }).toArray(),
    db.collection('leaves').find(
      { status: 'approved', $or: [{ employee_email: { $in: emails } }, { employee_id: { $in: ids } }] },
      { projection: { _id: 0, employee_id: 1, employee_email: 1, employee_name: 1, leave_type: 1, dates: 1, days_count: 1, is_half_day: 1 } }
    ).toArray()
  ]) : [[], [], [], []];

  const grid = new Map(); // `${uid}|${YYYY-MM}` -> { day: status }
  for (const g of gridDocs) {
    grid.set(`${g.employee_id}|${g.year}-${String(g.month).padStart(2, '0')}`, g.attendance || {});
  }
  const logByKey = new Map(logs.map(l => [`${l.employee_uid}|${l.date}`, l]));
  const holidays = new Map();
  for (const h of holidayDocs) {
    const d = toDay(h.date);
    if (d) holidays.set(d, h.name || 'Holiday');
  }

  const statusOf = (e, day) => {
    const cell = grid.get(`${e.uid}|${day.slice(0, 7)}`)?.[String(Number(day.slice(8, 10)))];
    if (cell) return cell;
    const log = logByKey.get(`${e.uid}|${day}`);
    return log?.status || null;
  };

  // ----- Daily attendance and department absenteeism -----
  const totals = emptyCounts();
  const deptCounts = new Map();
  const daily = days.map((day) => {
    const c = emptyCounts();
    let active = 0;
    for (const e of employees) {
      if (!employedOn(e, day)) continue;
      active += 1;
      const status = statusOf(e, day);
      bump(c, status);
      bump(totals, status);
      if (!deptCounts.has(e.department)) deptCounts.set(e.department, { ...emptyCounts(), employees: new Set() });
      const dc = deptCounts.get(e.department);
      dc.employees.add(e.uid);
      bump(dc, status);
    }
    return {
      date: day,
      active_headcount: active,
      ...c,
      is_holiday: holidays.has(day),
      holiday_name: holidays.get(day) || null,
      attendance_pct: attendancePct(c)
    };
  });

  const absenteeism = [...deptCounts.entries()].map(([department, c]) => ({
    department,
    employees: c.employees.size,
    present: c.present,
    half_day: c.half_day,
    absent: c.absent,
    on_leave: c.on_leave,
    absence_days: round(c.absent + c.half_day * 0.5, 1),
    marked_days: c.present + c.half_day + c.absent + c.on_leave,
    attendance_pct: attendancePct(c),
    absenteeism_pct: absenteeismPct(c)
  })).sort((a, b) => (b.absenteeism_pct ?? -1) - (a.absenteeism_pct ?? -1) || a.department.localeCompare(b.department));

  // ----- Late arrivals, hours and overtime from punch logs -----
  const lateByDay = new Map();
  const lateByEmp = new Map();
  const hoursByDept = new Map();
  let workedLogs = 0, workedTotal = 0, overtimeTotal = 0, overtimeLogs = 0, lateTotal = 0;
  for (const l of logs) {
    const e = byUid.get(l.employee_uid);
    if (!e) continue;
    const late = num(l.late_minutes);
    if (late > 0 || l.is_late === true) {
      lateTotal += 1;
      lateByDay.set(l.date, (lateByDay.get(l.date) || 0) + 1);
      const s = lateByEmp.get(e.uid) || { employee_id: e.employee_id, full_name: e.full_name, department: e.department, late_count: 0, late_minutes: 0 };
      s.late_count += 1;
      s.late_minutes += late;
      lateByEmp.set(e.uid, s);
    }
    if (l.clock_out && l.worked_minutes != null) {
      const worked = num(l.worked_minutes);
      const ot = num(l.overtime_minutes);
      workedLogs += 1;
      workedTotal += worked;
      overtimeTotal += ot;
      if (ot > 0) overtimeLogs += 1;
      const h = hoursByDept.get(e.department) || { department: e.department, logs: 0, worked_minutes: 0, overtime_minutes: 0 };
      h.logs += 1;
      h.worked_minutes += worked;
      h.overtime_minutes += ot;
      hoursByDept.set(e.department, h);
    }
  }

  const lateTrend = days.map(day => ({ date: day, late_arrivals: lateByDay.get(day) || 0 }));
  const topLate = [...lateByEmp.values()]
    .map(s => ({ ...s, avg_late_minutes: round(s.late_minutes / s.late_count, 1) }))
    .sort((a, b) => b.late_count - a.late_count || b.late_minutes - a.late_minutes || a.full_name.localeCompare(b.full_name))
    .slice(0, 10);
  const hours = [...hoursByDept.values()].map(h => ({
    department: h.department,
    logs: h.logs,
    avg_worked_hours: round(h.worked_minutes / h.logs / 60),
    total_overtime_hours: round(h.overtime_minutes / 60),
    avg_overtime_minutes: round(h.overtime_minutes / h.logs, 1)
  })).sort((a, b) => a.department.localeCompare(b.department));

  // ----- Leave usage -----
  const usage = new Map(months.map(m => [m, {}]));
  const typeTotals = new Map();
  const byTaker = new Map();
  for (const leave of leaves) {
    const e = byEmail.get(leave.employee_email) || byId.get(leave.employee_id);
    if (!e) continue;
    const dates = (Array.isArray(leave.dates) ? leave.dates : []).map(toDay).filter(Boolean);
    const per = perDayAmount(leave, dates.length);
    const type = leave.leave_type || 'Leave';
    for (const d of dates) {
      if (d < from || d > to) continue;
      const bucket = usage.get(d.slice(0, 7));
      if (!bucket) continue;
      bucket[type] = (bucket[type] || 0) + per;
      typeTotals.set(type, (typeTotals.get(type) || 0) + per);
      const t = byTaker.get(e.uid) || { employee_id: e.employee_id, full_name: e.full_name, department: e.department, days: 0, by_type: {} };
      t.days += per;
      t.by_type[type] = round((t.by_type[type] || 0) + per);
      byTaker.set(e.uid, t);
    }
  }
  const leaveTypes = [...typeTotals.keys()].sort();
  const usageRows = months.map(m => {
    const b = usage.get(m);
    const row = { month: m, total: round(Object.values(b).reduce((s, v) => s + v, 0)) };
    for (const t of leaveTypes) row[t] = round(b[t] || 0);
    return row;
  });
  const topTakers = [...byTaker.values()]
    .map(t => ({ ...t, days: round(t.days) }))
    .sort((a, b) => b.days - a.days || a.full_name.localeCompare(b.full_name))
    .slice(0, 10);

  // ----- Leave liability (current balances of currently employed staff) -----
  const current = employees.filter(e => employedOn(e, today));
  const liabilityByType = new Map();
  const encashable = includeValue ? await encashableKeys(db) : new Set();
  const rates = includeValue ? await loadDailyRates(db, current) : new Map();
  let liabilityValue = 0, valuedEmployees = 0;
  const liabilityRows = [];
  for (const e of current) {
    let empDays = 0, empValue = 0;
    for (const [key, raw] of Object.entries(e.leave_balance)) {
      const days = num(raw);
      if (UNPAID_KEYS.has(key) || days <= 0) continue;
      empDays += days;
      liabilityByType.set(key, (liabilityByType.get(key) || 0) + days);
      if (includeValue && encashable.has(key) && rates.has(e.uid)) empValue += days * rates.get(e.uid);
    }
    if (includeValue && rates.has(e.uid)) valuedEmployees += 1;
    liabilityValue += empValue;
    if (empDays > 0) {
      liabilityRows.push({
        employee_id: e.employee_id, full_name: e.full_name, department: e.department,
        balance_days: round(empDays), ...(includeValue ? { encashable_value: round(empValue) } : {})
      });
    }
  }
  liabilityRows.sort((a, b) => b.balance_days - a.balance_days || a.full_name.localeCompare(b.full_name));
  const liabilityTypes = [...liabilityByType.entries()]
    .map(([key, days]) => ({ leave_type: titleCase(key), key, days: round(days), encashable: includeValue ? encashable.has(key) : null }))
    .sort((a, b) => b.days - a.days || a.leave_type.localeCompare(b.leave_type));

  const workingDays = daily.filter(d => d.attendance_pct != null);

  return {
    range: { from, to, days: days.length },
    summary: {
      employees: employees.filter(e => days.some(d => employedOn(e, d))).length,
      attendance_pct: attendancePct(totals),
      absenteeism_pct: absenteeismPct(totals),
      present_days: totals.present,
      half_days: totals.half_day,
      absent_days: totals.absent,
      leave_days_marked: totals.on_leave,
      tracked_days: workingDays.length,
      late_arrivals: lateTotal,
      avg_worked_hours: workedLogs ? round(workedTotal / workedLogs / 60) : null,
      avg_worked_minutes: workedLogs ? round(workedTotal / workedLogs) : null,
      total_overtime_hours: round(overtimeTotal / 60),
      total_overtime_minutes: overtimeTotal,
      overtime_days: overtimeLogs,
      punch_logs: logs.length,
      leave_days_taken: round([...typeTotals.values()].reduce((s, v) => s + v, 0))
    },
    daily,
    late_trend: lateTrend,
    top_late_arrivers: topLate,
    absenteeism_by_department: absenteeism,
    hours_by_department: hours,
    leave_usage: { types: leaveTypes, months: usageRows, by_type: leaveTypes.map(t => ({ leave_type: t, days: round(typeTotals.get(t)) })) },
    top_leave_takers: topTakers,
    leave_liability: {
      employees: current.length,
      total_days: round(liabilityTypes.reduce((s, t) => s + t.days, 0)),
      by_type: liabilityTypes,
      by_employee: liabilityRows,
      encashable_value: includeValue ? round(liabilityValue) : null,
      valued_employees: includeValue ? valuedEmployees : null,
      value_basis: includeValue
        ? 'Encashable leave days × daily rate (monthly gross from salary structure, else monthly salary, ÷ 30)'
        : null
    }
  };
}

module.exports = { computeAttendance, leaveKey };
