/**
 * Shared attendance logic used by self clock-in (routes/timeTracking.js),
 * device punches (routes/timeDevices.js) and the nightly close job.
 */

const { AttendanceStatus } = require('../../models/schemas');
const { employeeUid, localParts, timeToMinutes, generateUUID } = require('../../utils/helpers');

// Used when no shift has been created yet
const FALLBACK_SHIFT = {
  id: null,
  name: 'General',
  start_time: '09:30',
  end_time: '18:30',
  grace_minutes: 15,
  early_exit_grace_minutes: 15,
  half_day_minutes: 240,
  full_day_minutes: 480,
  weekly_offs: [0]
};

// A clock-out must happen within this window of the clock-in (covers night shifts)
const MAX_OPEN_PUNCH_MS = 20 * 60 * 60 * 1000;

const stripId = (doc) => {
  if (doc) delete doc._id;
  return doc;
};

const findMyEmployee = (db, email) =>
  db.collection('employees').findOne({ email });

const getShiftForEmployee = async (db, employee) => {
  if (employee?.shift_id) {
    const shift = await db.collection('shifts').findOne({ id: employee.shift_id });
    if (shift) return stripId(shift);
  }
  const defaultShift = await db.collection('shifts').findOne({ is_default: true });
  return defaultShift ? stripId(defaultShift) : { ...FALLBACK_SHIFT };
};

const shiftSnapshot = (shift) => ({
  id: shift.id,
  name: shift.name,
  start_time: shift.start_time,
  end_time: shift.end_time
});

const findHoliday = async (db, dateStr) => {
  const holidays = await db.collection('holidays').find({}).toArray();
  return holidays.find(h => {
    const d = new Date(h.date);
    if (isNaN(d)) return false;
    return d.toISOString().slice(0, 10) === dateStr || localParts(d).date === dateStr;
  }) || null;
};

/**
 * Late / early-exit / worked / overtime minutes for a punch pair, measured
 * against the shift in the company timezone. Handles shifts that cross midnight.
 */
const computeMetrics = (shift, clockIn, clockOut) => {
  const start = timeToMinutes(shift.start_time);
  let end = timeToMinutes(shift.end_time);
  if (end <= start) end += 1440; // overnight shift
  const shiftLength = end - start;

  const inParts = localParts(clockIn);
  // On an overnight shift, a clock-in in the small hours belongs to the shift
  // that started the previous evening, so measure it on that timeline.
  const afterMidnight = end > 1440 && inParts.minutes < start - 720;
  const inMin = inParts.minutes + (afterMidnight ? 1440 : 0);
  const lateMinutes = inMin > start + (shift.grace_minutes || 0) ? inMin - start : 0;

  const metrics = {
    late_minutes: lateMinutes,
    is_late: lateMinutes > 0,
    early_exit_minutes: 0,
    worked_minutes: 0,
    overtime_minutes: 0
  };

  if (clockOut) {
    const worked = Math.max(0, Math.round((clockOut - clockIn) / 60000));
    // Clock-out position on the clock-in day's timeline (adds 1440 per day crossed)
    const outParts = localParts(clockOut);
    const dayOffset = Math.round((Date.parse(`${outParts.date}T00:00:00Z`) - Date.parse(`${inParts.date}T00:00:00Z`)) / 86400000);
    const outMin = outParts.minutes + dayOffset * 1440 + (afterMidnight ? 1440 : 0);
    const earlyExit = outMin < end - (shift.early_exit_grace_minutes || 0) ? end - outMin : 0;

    metrics.worked_minutes = worked;
    metrics.early_exit_minutes = Math.max(0, earlyExit);
    metrics.overtime_minutes = Math.max(0, worked - shiftLength);
  }

  return metrics;
};

/**
 * Attendance grid status implied by worked minutes.
 */
const statusFromWorked = (shift, workedMinutes) => {
  if (workedMinutes >= (shift.full_day_minutes ?? FALLBACK_SHIFT.full_day_minutes)) return AttendanceStatus.PRESENT;
  if (workedMinutes >= (shift.half_day_minutes ?? FALLBACK_SHIFT.half_day_minutes)) return AttendanceStatus.HALF_DAY;
  return AttendanceStatus.ABSENT;
};

/**
 * Mirror a status into the monthly attendance grid. Days already marked as
 * leave are left alone so approved leave is never overwritten by a punch.
 */
const writeGrid = async (db, uid, dateStr, status) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const existing = await db.collection('attendance').findOne(
    { employee_id: uid, month, year },
    { projection: { [`attendance.${day}`]: 1 } }
  );
  if (existing?.attendance?.[day] === AttendanceStatus.LEAVE) return false;

  await db.collection('attendance').updateOne(
    { employee_id: uid, month, year },
    {
      $set: { [`attendance.${day}`]: status, updated_at: new Date() },
      $setOnInsert: { created_at: new Date() }
    },
    { upsert: true }
  );
  return true;
};

const locationFrom = (body) =>
  body.latitude != null && body.longitude != null
    ? { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy ?? null }
    : null;

/**
 * Employees a manager is responsible for: direct reports (manager_email) and
 * their department, matching how leave approvals pick a manager.
 */
const teamQuery = (manager) => ({
  email: { $ne: manager.email },
  $or: [
    { manager_email: manager.email },
    ...(manager.department ? [{ department: manager.department }] : [])
  ]
});

const canActOnEmployee = async (db, user, employeeEmail) => {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager' || user.email === employeeEmail) return false;
  const manager = await findMyEmployee(db, user.email);
  if (!manager) return false;
  // $and, not a spread: teamQuery has its own `email` condition, which would
  // otherwise replace the target email and match any team member.
  const match = await db.collection('employees').findOne({ $and: [{ email: employeeEmail }, teamQuery(manager)] });
  return !!match;
};

/**
 * The attendance date a punch belongs to. Punches in the small hours on an
 * overnight shift count towards the previous day's shift.
 */
const attributionDate = (shift, when) => {
  const parts = localParts(when);
  const start = timeToMinutes(shift.start_time);
  const overnight = timeToMinutes(shift.end_time) <= start;
  if (overnight && parts.minutes < start - 720) {
    return new Date(Date.parse(`${parts.date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  }
  return parts.date;
};

/**
 * Apply raw punches for one employee and date using "first in, last out":
 * the earliest punch is the clock-in and the latest (if later) the clock-out.
 * Used by biometric / RFID devices. Days fixed by an approved correction
 * request are left alone.
 * @returns {Promise<{ date, action: 'created'|'updated'|'skipped', log }>}
 */
const applyPunches = async (db, employee, date, punchTimes, { source = 'device', deviceId = null } = {}) => {
  const uid = employeeUid(employee);
  const existing = await db.collection('attendance_logs').findOne({ employee_uid: uid, date });
  if (existing?.source === 'regularization') return { date, action: 'skipped', log: stripId(existing) };

  const times = [...punchTimes];
  if (existing?.clock_in) times.push(new Date(existing.clock_in));
  if (existing?.clock_out) times.push(new Date(existing.clock_out));
  times.sort((a, b) => a - b);
  const clockIn = times[0];
  const last = times[times.length - 1];
  // Punches within a minute of each other are the same tap
  const clockOut = last - clockIn >= 60000 ? last : null;

  const shift = await getShiftForEmployee(db, employee);
  const holiday = await findHoliday(db, date);
  const metrics = computeMetrics(shift, clockIn, clockOut);
  const status = clockOut ? statusFromWorked(shift, metrics.worked_minutes) : AttendanceStatus.PRESENT;
  const now = new Date();

  const log = {
    id: existing?.id || generateUUID(),
    employee_uid: uid,
    employee_name: employee.full_name,
    user_email: employee.email,
    department: employee.department || null,
    date,
    shift: shiftSnapshot(shift),
    clock_in: clockIn,
    clock_out: clockOut,
    clock_in_location: existing?.clock_in_location || null,
    clock_out_location: existing?.clock_out_location || null,
    work_mode: existing?.work_mode || 'office',
    is_holiday: !!holiday,
    is_weekly_off: (shift.weekly_offs || []).includes(new Date(`${date}T12:00:00Z`).getUTCDay()),
    ...metrics,
    status,
    source: existing && existing.source !== source ? `${existing.source}+${source}` : source,
    device_id: deviceId || existing?.device_id || null,
    missed_clock_out: false,
    created_at: existing?.created_at || now,
    updated_at: now
  };
  await db.collection('attendance_logs').replaceOne({ employee_uid: uid, date }, log, { upsert: true });
  if (!holiday) await writeGrid(db, uid, date, status);
  return { date, action: existing ? 'updated' : 'created', log: stripId(log) };
};

module.exports = {
  FALLBACK_SHIFT,
  MAX_OPEN_PUNCH_MS,
  stripId,
  findMyEmployee,
  getShiftForEmployee,
  shiftSnapshot,
  findHoliday,
  computeMetrics,
  statusFromWorked,
  writeGrid,
  locationFrom,
  teamQuery,
  canActOnEmployee,
  attributionDate,
  applyPunches
};
