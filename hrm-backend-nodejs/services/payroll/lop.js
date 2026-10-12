/**
 * Loss of pay from attendance (PY-2).
 *
 * Per employee per month:
 *  - `attendance` grid: 'absent' = 1 day, 'half-day' = 0.5 day
 *  - approved 'Unpaid Leave' in `leaves` (half-day leave = 0.5)
 *  - days before the joining date / after the exit date in that month
 * A day is never counted twice (the larger fraction wins).
 */

const { employeeUid, localParts, getDaysInMonth } = require('../../utils/helpers');
const { lopBasisDays } = require('./settings');
const { round2 } = require('./statutory');

const UNPAID_RE = /unpaid|loss\s*of\s*pay|^lop$|^lwp$/i;

const localDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return localParts(d).date;
};

async function computeLop(db, employee, month, settings) {
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, mon);
  const basisDays = lopBasisDays(settings, daysInMonth);
  const perDay = new Map(); // day -> { fraction, reason }

  const mark = (day, fraction, reason) => {
    const prev = perDay.get(day);
    if (!prev || fraction > prev.fraction) perDay.set(day, { fraction, reason });
  };

  // Attendance grid
  const grid = await db.collection('attendance').findOne(
    { employee_id: employeeUid(employee), month: mon, year },
    { projection: { _id: 0, attendance: 1 } }
  );
  let absentDays = 0;
  let halfDays = 0;
  for (const [dayKey, status] of Object.entries(grid?.attendance || {})) {
    const day = parseInt(dayKey, 10);
    if (!day || day > daysInMonth) continue;
    if (status === 'absent') { mark(day, 1, 'absent'); absentDays += 1; }
    else if (status === 'half-day') { mark(day, 0.5, 'half-day'); halfDays += 1; }
  }

  // Approved unpaid leave
  const leaves = await db.collection('leaves').find({
    $or: [{ employee_id: employee.id }, { employee_email: employee.email }],
    status: 'approved'
  }, { projection: { _id: 0, leave_type: 1, dates: 1, is_half_day: 1, days_count: 1 } }).toArray();
  let unpaidLeaveDays = 0;
  for (const leave of leaves) {
    if (!UNPAID_RE.test(leave.leave_type || '')) continue;
    const dates = Array.isArray(leave.dates) ? leave.dates : [];
    const half = leave.is_half_day || (dates.length === 1 && Number(leave.days_count) === 0.5);
    for (const d of dates) {
      const ds = localDate(d);
      if (!ds || ds.slice(0, 7) !== month) continue;
      const fraction = half ? 0.5 : 1;
      mark(parseInt(ds.slice(8, 10), 10), fraction, 'unpaid leave');
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

  let lopDays = 0;
  for (const { fraction } of perDay.values()) lopDays += fraction;
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
      not_employed: notEmployedDays
    },
    days: [...perDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, v]) => ({
      date: `${month}-${String(day).padStart(2, '0')}`,
      fraction: v.fraction,
      reason: v.reason
    }))
  };
}

/** LOP amount = gross / basis days × LOP days (never more than gross). */
const lopAmount = (gross, lop) => round2(Math.min(gross, (gross / lop.basis_days) * lop.lop_days));

module.exports = { computeLop, lopAmount, UNPAID_RE };
