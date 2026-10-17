/**
 * Loss of pay from attendance (PY-2).
 *
 * Per employee per month:
 *  - `attendance` grid: 'absent' = 1 day, 'half-day' = 0.5 day
 *  - approved 'Unpaid Leave' in `leaves` (half-day leave = 0.5)
 *  - days before the joining date / after the exit date in that month
 * A day is never counted twice (the larger fraction wins).
 *
 * Working days with no attendance mark and no leave are reported as
 * `unmarked_days` (only days that have already passed: future days of an
 * in-progress month are never counted). They follow the nightly auto-absent
 * rule (TA-11, Time settings): when auto-absent is on they are loss of pay,
 * otherwise they are paid but flagged for review.
 */

const { employeeUid, localParts, getDaysInMonth } = require('../../utils/helpers');
const { lopBasisDays } = require('./settings');
const { round2 } = require('./statutory');
const { getShiftForEmployee } = require('../time/core');
const { getTimeSettings } = require('../time/dailyClose');

const UNPAID_RE = /unpaid|loss\s*of\s*pay|^lop$|^lwp$/i;
const OPEN_LEAVE_STATUSES = ['approved', 'manager_approved', 'pending'];

const localDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return localParts(d).date;
};

/** Identifiers an employee's attendance / leave records may be stored under. */
const employeeKeys = (employee) =>
  [...new Set([employeeUid(employee), employee.employee_id, employee.employee_code, employee.id].filter(Boolean))];

/**
 * Days of `month` whose attendance is final: the whole month when it is over,
 * up to yesterday for the current month (today is still in progress), 0 for a future month.
 */
function elapsedDays(month, daysInMonth, today = localParts(new Date()).date) {
  const current = today.slice(0, 7);
  if (month < current) return daysInMonth;
  if (month > current) return 0;
  return parseInt(today.slice(8, 10), 10) - 1;
}

async function computeLop(db, employee, month, settings, { today = localParts(new Date()).date } = {}) {
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, mon);
  const basisDays = lopBasisDays(settings, daysInMonth);
  const elapsed = elapsedDays(month, daysInMonth, today);
  const perDay = new Map(); // day -> { fraction, reason }

  const mark = (day, fraction, reason) => {
    const prev = perDay.get(day);
    if (!prev || fraction > prev.fraction) perDay.set(day, { fraction, reason });
  };

  // Attendance grid (an employee whose code changed can have more than one)
  const grids = await db.collection('attendance').find(
    { employee_id: { $in: employeeKeys(employee) }, month: mon, year },
    { projection: { _id: 0, attendance: 1 } }
  ).toArray();
  const gridStatus = new Map(); // day -> status
  for (const grid of grids) {
    for (const [dayKey, status] of Object.entries(grid.attendance || {})) {
      const day = parseInt(dayKey, 10);
      if (!day || day > daysInMonth || !status) continue;
      if (!gridStatus.has(day) || status === 'absent') gridStatus.set(day, status);
    }
  }
  let absentDays = 0;
  let halfDays = 0;
  for (const [day, status] of gridStatus) {
    if (status === 'absent') { mark(day, 1, 'absent'); absentDays += 1; }
    else if (status === 'half-day') { mark(day, 0.5, 'half-day'); halfDays += 1; }
  }

  // Approved unpaid leave is LOP; any open leave means the day is accounted for
  const leaves = await db.collection('leaves').find({
    $or: [{ employee_id: { $in: employeeKeys(employee) } }, { employee_email: employee.email }],
    status: { $in: OPEN_LEAVE_STATUSES }
  }, { projection: { _id: 0, leave_type: 1, dates: 1, is_half_day: 1, days_count: 1, status: 1 } }).toArray();
  let unpaidLeaveDays = 0;
  const onLeave = new Set();
  for (const leave of leaves) {
    const dates = Array.isArray(leave.dates) ? leave.dates : [];
    const unpaid = leave.status === 'approved' && UNPAID_RE.test(leave.leave_type || '');
    const half = leave.is_half_day || (dates.length === 1 && Number(leave.days_count) === 0.5);
    for (const d of dates) {
      const ds = localDate(d);
      if (!ds || ds.slice(0, 7) !== month) continue;
      const day = parseInt(ds.slice(8, 10), 10);
      onLeave.add(day);
      if (!unpaid) continue;
      const fraction = half ? 0.5 : 1;
      mark(day, fraction, 'unpaid leave');
      unpaidLeaveDays += fraction;
    }
  }

  // Not yet joined / already exited
  let notEmployedDays = 0;
  const joined = localDate(employee.joining_date);
  if (joined && joined.slice(0, 7) === month) {
    const joinDay = parseInt(joined.slice(8, 10), 10);
    for (let d = 1; d < joinDay; d++) { mark(d, 1, 'before joining'); notEmployedDays += 1; }
  } else if (joined && joined.slice(0, 7) > month) {
    for (let d = 1; d <= daysInMonth; d++) mark(d, 1, 'before joining');
    notEmployedDays = daysInMonth;
  }
  const exited = localDate(employee.exit_date);
  if (exited && exited.slice(0, 7) === month) {
    const exitDay = parseInt(exited.slice(8, 10), 10);
    for (let d = exitDay + 1; d <= daysInMonth; d++) { mark(d, 1, 'after exit'); notEmployedDays += 1; }
  }

  // Working days already passed with no attendance mark and no leave
  const unmarkedDates = [];
  if (elapsed > 0) {
    const shift = await getShiftForEmployee(db, employee);
    const weeklyOffs = shift.weekly_offs || [];
    const holidayDocs = await db.collection('holidays').find({}, { projection: { _id: 0, date: 1 } }).toArray();
    const holidays = new Set(holidayDocs.flatMap(h => {
      const d = h.date instanceof Date ? h.date : new Date(h.date);
      return isNaN(d) ? [] : [d.toISOString().slice(0, 10), localParts(d).date];
    }));
    for (let d = 1; d <= elapsed; d++) {
      const ds = `${month}-${String(d).padStart(2, '0')}`;
      if (perDay.has(d) || gridStatus.has(d) || onLeave.has(d) || holidays.has(ds)) continue;
      if (weeklyOffs.includes(new Date(`${ds}T12:00:00Z`).getUTCDay())) continue;
      unmarkedDates.push(ds);
    }
  }
  const unmarkedIsLop = unmarkedDates.length > 0 && !!(await getTimeSettings(db)).auto_absent_enabled;
  if (unmarkedIsLop) for (const ds of unmarkedDates) mark(parseInt(ds.slice(8, 10), 10), 1, 'no attendance');

  let lopDays = 0;
  let lopToDate = 0;
  for (const [day, { fraction }] of perDay) {
    lopDays += fraction;
    if (day <= elapsed) lopToDate += fraction;
  }
  // Fixed bases (26/30) can be smaller than the calendar month
  const fullMonthLost = lopDays >= daysInMonth;
  lopDays = fullMonthLost ? basisDays : Math.min(lopDays, basisDays);

  return {
    days_in_month: daysInMonth,
    basis_days: basisDays,
    lop_days: round2(lopDays),
    payable_days: round2(basisDays - lopDays),
    breakdown: {
      absent: absentDays,
      half_days: halfDays,
      unpaid_leave: unpaidLeaveDays,
      not_employed: notEmployedDays,
      no_attendance: unmarkedIsLop ? unmarkedDates.length : 0
    },
    // Attendance coverage of the month: 'closed', 'in_progress' (current month) or 'future'
    period: elapsed >= daysInMonth ? 'closed' : month === today.slice(0, 7) ? 'in_progress' : 'future',
    elapsed_days: elapsed,
    upcoming_days: daysInMonth - elapsed,
    payable_days_to_date: round2(Math.max(0, elapsed - lopToDate)),
    unmarked_days: unmarkedDates.length,
    unmarked_dates: unmarkedDates,
    unmarked_is_lop: unmarkedIsLop,
    days: [...perDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, v]) => ({
      date: `${month}-${String(day).padStart(2, '0')}`,
      fraction: v.fraction,
      reason: v.reason
    }))
  };
}

/** LOP amount = gross / basis days × LOP days (never more than gross). */
const lopAmount = (gross, lop) => round2(Math.min(gross, (gross / lop.basis_days) * lop.lop_days));

module.exports = { computeLop, lopAmount, elapsedDays, UNPAID_RE };
