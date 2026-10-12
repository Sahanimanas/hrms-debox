/**
 * Nightly attendance close (TA-11).
 *
 * 1. Missed clock-outs: any open punch whose shift ended more than
 *    MISSED_CLOCK_OUT_GRACE_HOURS ago is flagged (and, if configured, turned
 *    into a half day) and the employee is asked to raise a correction.
 * 2. Auto-absent (off by default): employees with no punch, no attendance
 *    mark and no leave on a working day are marked absent.
 */

const { AttendanceStatus } = require('../../models/schemas');
const { employeeUid, localParts, timeToMinutes } = require('../../utils/helpers');
const { getShiftForEmployee, findHoliday, writeGrid } = require('./core');
const { createNotification } = require('../notificationService');

const MISSED_CLOCK_OUT_GRACE_HOURS = 4;

const DEFAULT_SETTINGS = {
  auto_absent_enabled: false,
  missed_clock_out_action: 'flag' // 'flag' | 'half_day'
};

async function getTimeSettings(db) {
  const doc = await db.collection('time_settings').findOne({ id: 'default' }, { projection: { _id: 0 } });
  return { ...DEFAULT_SETTINGS, ...(doc || {}), id: 'default' };
}

const shiftLengthMinutes = (shift) => {
  const start = timeToMinutes(shift.start_time);
  let end = timeToMinutes(shift.end_time);
  if (end <= start) end += 1440;
  return end - start;
};

const yesterday = () => new Date(Date.parse(`${localParts().date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Same calendar date, tolerant of how leave dates were stored (UTC midnight vs local). */
const leaveCoversDate = (leave, dateStr) =>
  (leave.dates || []).some(d => {
    const parsed = new Date(d);
    if (isNaN(parsed)) return false;
    return parsed.toISOString().slice(0, 10) === dateStr || localParts(parsed).date === dateStr;
  });

async function flagMissedClockOuts(db, settings, now) {
  const open = await db.collection('attendance_logs')
    .find({ clock_out: null, missed_clock_out: { $ne: true } })
    .toArray();
  const flagged = [];
  for (const log of open) {
    const length = log.shift?.start_time ? shiftLengthMinutes(log.shift) : 540;
    const expectedEnd = new Date(log.clock_in).getTime() + length * 60000;
    if (now.getTime() < expectedEnd + MISSED_CLOCK_OUT_GRACE_HOURS * 3600000) continue;

    const update = { missed_clock_out: true, updated_at: now };
    if (settings.missed_clock_out_action === 'half_day') update.status = AttendanceStatus.HALF_DAY;
    await db.collection('attendance_logs').updateOne({ id: log.id }, { $set: update });
    if (update.status && !log.is_holiday) await writeGrid(db, log.employee_uid, log.date, update.status);

    createNotification({
      userEmail: log.user_email,
      type: 'missed_clock_out',
      title: 'You forgot to clock out',
      message: `There's no clock-out for ${log.date}. Raise an attendance correction from My Attendance so your hours are counted.`,
      actionUrl: '/my-attendance',
      metadata: { log_id: log.id, date: log.date }
    }).catch(() => {});
    flagged.push({ employee_id: log.employee_uid, date: log.date });
  }
  return flagged;
}

async function markAbsentees(db, dateStr) {
  const holiday = await findHoliday(db, dateStr);
  if (holiday) return { skipped_reason: `holiday: ${holiday.name}`, marked: [] };

  const employees = await db.collection('employees').find({ employment_status: { $ne: 'exited' } }).toArray();

  const [year, month, day] = dateStr.split('-').map(Number);
  const uids = employees.map(employeeUid);
  const [logs, grid, leaves] = await Promise.all([
    db.collection('attendance_logs').find({ date: dateStr, employee_uid: { $in: uids } }, { projection: { employee_uid: 1 } }).toArray(),
    db.collection('attendance').find({ month, year, employee_id: { $in: uids } }).toArray(),
    db.collection('leaves').find({ status: { $ne: 'rejected' }, employee_email: { $in: employees.map(e => e.email) } }).toArray()
  ]);
  const hasLog = new Set(logs.map(l => l.employee_uid));
  const gridMap = Object.fromEntries(grid.map(g => [g.employee_id, g.attendance?.[day]]));
  const onLeave = new Set(leaves.filter(l => leaveCoversDate(l, dateStr)).map(l => l.employee_email));
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();

  const marked = [];
  for (const employee of employees) {
    const uid = employeeUid(employee);
    if (hasLog.has(uid) || gridMap[uid] || onLeave.has(employee.email)) continue;
    const joined = employee.joining_date ? new Date(employee.joining_date) : null;
    if (joined && !isNaN(joined) && joined.toISOString().slice(0, 10) > dateStr) continue;
    if (employee.exit_date && new Date(employee.exit_date).toISOString().slice(0, 10) < dateStr) continue;
    const shift = await getShiftForEmployee(db, employee);
    if ((shift.weekly_offs || []).includes(weekday)) continue;
    await writeGrid(db, uid, dateStr, AttendanceStatus.ABSENT);
    marked.push(uid);
  }
  return { skipped_reason: null, marked };
}

/**
 * Run the close for one date (default: yesterday in the company timezone).
 */
async function closeDay(db, dateStr = yesterday(), now = new Date()) {
  const settings = await getTimeSettings(db);
  const missed = await flagMissedClockOuts(db, settings, now);
  const absent = settings.auto_absent_enabled
    ? await markAbsentees(db, dateStr)
    : { skipped_reason: 'auto-absent is turned off', marked: [] };

  const summary = {
    date: dateStr,
    ran_at: now,
    missed_clock_outs: missed.length,
    marked_absent: absent.marked.length,
    absent_skipped_reason: absent.skipped_reason,
    details: { missed, absent: absent.marked }
  };
  await db.collection('time_close_runs').insertOne({ ...summary });
  delete summary._id;
  return summary;
}

module.exports = { closeDay, getTimeSettings, DEFAULT_SETTINGS, yesterday };
