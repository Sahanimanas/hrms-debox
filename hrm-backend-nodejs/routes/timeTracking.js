/**
 * Time tracking: shifts, employee clock-in/out, and attendance requests
 * (missed punch / work from home / on duty).
 *
 * Every punch is stored in `attendance_logs` (one document per employee per day)
 * and mirrored into the monthly `attendance` grid that the admin Attendance page
 * and payroll already read, so both views stay in sync.
 */

const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, AttendanceStatus, AttendanceRequestType } = require('../models/schemas');
const {
  generateUUID,
  employeeUid,
  localParts,
  zonedTimeToDate,
  timeToMinutes,
  APP_TIMEZONE
} = require('../utils/helpers');
const { createNotification, NotificationType } = require('../services/notificationService');
const Joi = require('joi');
const { closeDay, getTimeSettings } = require('../services/time/dailyClose');
const {
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
  canActOnEmployee
} = require('../services/time/core');


const REQUEST_TYPE_LABELS = {
  [AttendanceRequestType.MISSED_PUNCH]: 'Attendance correction',
  [AttendanceRequestType.WORK_FROM_HOME]: 'Work from home',
  [AttendanceRequestType.ON_DUTY]: 'On duty'
};

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('attendance_logs').createIndex({ employee_uid: 1, date: 1 }, { unique: true }),
    db.collection('attendance_logs').createIndex({ date: 1 }),
    db.collection('attendance_requests').createIndex({ employee_uid: 1, date: 1 }),
    db.collection('attendance_requests').createIndex({ status: 1 }),
    db.collection('shifts').createIndex({ id: 1 }, { unique: true })
  ]);
  indexesReady = true;
};

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Time tracking index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= HELPERS =============

const notifyApprovers = async (db, employee, request) => {
  const label = REQUEST_TYPE_LABELS[request.type];
  const recipients = new Map();

  const manager = employee.manager_email
    ? await db.collection('employees').findOne({ email: employee.manager_email })
    : await db.collection('employees').findOne({ department: employee.department, role: 'manager', email: { $ne: employee.email } });
  if (manager) recipients.set(manager.email, manager);

  const admins = await db.collection('employees').find({ role: 'admin' }).toArray();
  admins.forEach(a => recipients.set(a.email, a));
  recipients.delete(employee.email);

  for (const r of recipients.values()) {
    await createNotification({
      userId: r.id,
      userEmail: r.email,
      type: NotificationType.ATTENDANCE_REQUEST_APPLIED,
      title: `New ${label} request`,
      message: `${employee.full_name} requested ${label.toLowerCase()} for ${request.date}`,
      actionUrl: '/time-tracking',
      metadata: { request_id: request.id, employee_name: employee.full_name }
    });
  }
};

// ============= SHIFTS =============

/**
 * GET /api/time/shifts
 * All shifts plus how many employees are on each.
 */
router.get('/shifts', async (req, res) => {
  try {
    const db = getDB();
    const shifts = await db.collection('shifts').find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    const counts = await db.collection('employees').aggregate([
      { $group: { _id: '$shift_id', count: { $sum: 1 } } }
    ]).toArray();
    const countMap = Object.fromEntries(counts.map(c => [c._id ?? 'none', c.count]));
    const defaultShift = shifts.find(s => s.is_default);

    res.json({
      shifts: shifts.map(s => ({
        ...s,
        employee_count: (countMap[s.id] || 0) + (s.is_default ? countMap.none || 0 : 0)
      })),
      fallback_shift: defaultShift ? null : FALLBACK_SHIFT,
      timezone: APP_TIMEZONE
    });
  } catch (error) {
    console.error('Get shifts error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/time/shifts
 */
router.post('/shifts', requireRole(['admin']), validate(schemas.shiftCreate), async (req, res) => {
  try {
    const db = getDB();
    const data = req.validatedBody;
    if (data.half_day_minutes > data.full_day_minutes) {
      return res.status(400).json({ detail: 'Half-day hours cannot exceed full-day hours' });
    }

    // Only an explicit toggle makes a shift the default. Without one, employees with
    // no assigned shift stay on the built-in General shift.
    const shift = {
      id: generateUUID(),
      ...data,
      is_default: !!data.is_default,
      created_by: req.user.email,
      created_at: new Date(),
      updated_at: new Date()
    };

    if (shift.is_default) {
      await db.collection('shifts').updateMany({}, { $set: { is_default: false } });
    }
    await db.collection('shifts').insertOne(shift);
    res.status(201).json(stripId(shift));
  } catch (error) {
    console.error('Create shift error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/time/shifts/:id
 */
router.put('/shifts/:id', requireRole(['admin']), validate(schemas.shiftUpdate), async (req, res) => {
  try {
    const db = getDB();
    const shift = await db.collection('shifts').findOne({ id: req.params.id });
    if (!shift) return res.status(404).json({ detail: 'Shift not found' });

    const updates = req.validatedBody;
    const merged = { ...shift, ...updates };
    if (merged.half_day_minutes > merged.full_day_minutes) {
      return res.status(400).json({ detail: 'Half-day hours cannot exceed full-day hours' });
    }
    // Unsetting the default puts unassigned employees back on the built-in General shift
    if (updates.is_default) {
      await db.collection('shifts').updateMany({ id: { $ne: shift.id } }, { $set: { is_default: false } });
    }

    await db.collection('shifts').updateOne(
      { id: shift.id },
      { $set: { ...updates, updated_at: new Date() } }
    );
    const updated = await db.collection('shifts').findOne({ id: shift.id }, { projection: { _id: 0 } });
    res.json(updated);
  } catch (error) {
    console.error('Update shift error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/time/shifts/:id
 * Employees on the deleted shift fall back to the default shift.
 */
router.delete('/shifts/:id', requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const shift = await db.collection('shifts').findOne({ id: req.params.id });
    if (!shift) return res.status(404).json({ detail: 'Shift not found' });
    if (shift.is_default && (await db.collection('shifts').countDocuments()) > 1) {
      return res.status(400).json({ detail: 'Make another shift the default before deleting this one' });
    }

    await db.collection('shifts').deleteOne({ id: shift.id });
    const { modifiedCount } = await db.collection('employees').updateMany(
      { shift_id: shift.id },
      { $unset: { shift_id: '' } }
    );
    res.json({ message: 'Shift deleted', employees_moved_to_default: modifiedCount });
  } catch (error) {
    console.error('Delete shift error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/time/shifts-assign
 * Body: { shift_id (null = default shift), employee_ids: [employee uid] }
 */
router.put('/shifts-assign', requireRole(['admin']), validate(schemas.shiftAssign), async (req, res) => {
  try {
    const db = getDB();
    const { shift_id, employee_ids } = req.validatedBody;

    if (shift_id && !(await db.collection('shifts').findOne({ id: shift_id }))) {
      return res.status(404).json({ detail: 'Shift not found' });
    }

    const filter = {
      $or: [
        { employee_id: { $in: employee_ids } },
        { employee_code: { $in: employee_ids } },
        { id: { $in: employee_ids } }
      ]
    };
    const update = shift_id ? { $set: { shift_id } } : { $unset: { shift_id: '' } };
    const { modifiedCount, matchedCount } = await db.collection('employees').updateMany(filter, update);

    res.json({ message: 'Shift assigned', matched: matchedCount, updated: modifiedCount });
  } catch (error) {
    console.error('Assign shift error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/time/shift-roster
 * Employees with their assigned shift (admin).
 */
router.get('/shift-roster', requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const employees = await db.collection('employees')
      .find({}, { projection: { _id: 1, id: 1, employee_id: 1, employee_code: 1, full_name: 1, email: 1, department: 1, designation: 1, shift_id: 1 } })
      .sort({ full_name: 1 })
      .toArray();

    res.json(employees.map(e => ({
      employee_id: employeeUid(e),
      full_name: e.full_name,
      email: e.email,
      department: e.department,
      designation: e.designation,
      shift_id: e.shift_id || null
    })));
  } catch (error) {
    console.error('Shift roster error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= CLOCK IN / OUT =============

/**
 * GET /api/time/today
 * The current user's shift, today's punch log and whether they're clocked in.
 */
router.get('/today', async (req, res) => {
  try {
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) {
      return res.json({ has_profile: false });
    }

    const uid = employeeUid(employee);
    const now = new Date();
    const today = localParts(now);
    const shift = await getShiftForEmployee(db, employee);

    const todayLog = await db.collection('attendance_logs').findOne({ employee_uid: uid, date: today.date }, { projection: { _id: 0 } });
    // An open punch from yesterday (night shift) still counts as clocked in
    const openLog = await db.collection('attendance_logs').findOne(
      { employee_uid: uid, clock_out: null, clock_in: { $gte: new Date(now - MAX_OPEN_PUNCH_MS) } },
      { projection: { _id: 0 }, sort: { clock_in: -1 } }
    );
    const holiday = await findHoliday(db, today.date);

    res.json({
      has_profile: true,
      date: today.date,
      timezone: APP_TIMEZONE,
      server_time: now,
      shift,
      is_weekly_off: (shift.weekly_offs || []).includes(today.weekday),
      holiday: holiday ? { name: holiday.name } : null,
      log: openLog || todayLog || null,
      clocked_in: !!openLog
    });
  } catch (error) {
    console.error('Get today error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/time/clock-in
 * Body: { latitude?, longitude?, accuracy?, note? }
 */
router.post('/clock-in', validate(schemas.clockPunch), async (req, res) => {
  try {
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });

    const uid = employeeUid(employee);
    const now = new Date();
    const today = localParts(now);

    const openLog = await db.collection('attendance_logs').findOne({
      employee_uid: uid, clock_out: null, clock_in: { $gte: new Date(now - MAX_OPEN_PUNCH_MS) }
    });
    if (openLog) return res.status(400).json({ detail: 'You are already clocked in' });

    const existing = await db.collection('attendance_logs').findOne({ employee_uid: uid, date: today.date });
    if (existing?.clock_out) {
      return res.status(400).json({ detail: 'You have already clocked out for today. Raise a correction request if this is wrong.' });
    }

    const shift = await getShiftForEmployee(db, employee);
    const holiday = await findHoliday(db, today.date);
    const isWeeklyOff = (shift.weekly_offs || []).includes(today.weekday);

    const log = {
      id: existing?.id || generateUUID(),
      employee_uid: uid,
      employee_name: employee.full_name,
      user_email: employee.email,
      department: employee.department || null,
      date: today.date,
      shift: shiftSnapshot(shift),
      clock_in: now,
      clock_out: null,
      clock_in_location: locationFrom(req.validatedBody),
      clock_out_location: null,
      clock_in_note: req.validatedBody.note || null,
      work_mode: 'office',
      is_holiday: !!holiday,
      is_weekly_off: isWeeklyOff,
      ...computeMetrics(shift, now, null),
      status: AttendanceStatus.PRESENT,
      source: 'self',
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.collection('attendance_logs').replaceOne({ employee_uid: uid, date: today.date }, log, { upsert: true });
    // Holidays are blocked in the admin grid, so only the punch log records holiday work
    if (!holiday) await writeGrid(db, uid, today.date, AttendanceStatus.PRESENT);

    res.status(201).json(stripId(log));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ detail: 'You are already clocked in' });
    console.error('Clock-in error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/time/clock-out
 * Body: { latitude?, longitude?, accuracy?, note? }
 */
router.post('/clock-out', validate(schemas.clockPunch), async (req, res) => {
  try {
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });

    const uid = employeeUid(employee);
    const now = new Date();
    const openLog = await db.collection('attendance_logs').findOne(
      { employee_uid: uid, clock_out: null, clock_in: { $gte: new Date(now - MAX_OPEN_PUNCH_MS) } },
      { sort: { clock_in: -1 } }
    );
    if (!openLog) return res.status(400).json({ detail: 'You are not clocked in' });

    const shift = (await db.collection('shifts').findOne({ id: openLog.shift?.id })) ||
      await getShiftForEmployee(db, employee);
    const metrics = computeMetrics(shift, openLog.clock_in, now);
    const status = statusFromWorked(shift, metrics.worked_minutes);

    const updates = {
      clock_out: now,
      missed_clock_out: false,
      clock_out_location: locationFrom(req.validatedBody),
      clock_out_note: req.validatedBody.note || null,
      ...metrics,
      status,
      updated_at: now
    };
    await db.collection('attendance_logs').updateOne({ id: openLog.id }, { $set: updates });
    if (!openLog.is_holiday) await writeGrid(db, uid, openLog.date, status);

    res.json(stripId({ ...openLog, ...updates }));
  } catch (error) {
    console.error('Clock-out error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/time/my-logs?month=&year=
 */
router.get('/my-logs', async (req, res) => {
  try {
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.json({ logs: [], summary: null });

    const now = localParts();
    const month = parseInt(req.query.month, 10) || now.month;
    const year = parseInt(req.query.year, 10) || now.year;
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;

    const logs = await db.collection('attendance_logs')
      .find({ employee_uid: employeeUid(employee), date: { $regex: `^${prefix}` } }, { projection: { _id: 0 } })
      .sort({ date: -1 })
      .toArray();

    const summary = {
      days_present: logs.filter(l => l.status === AttendanceStatus.PRESENT).length,
      half_days: logs.filter(l => l.status === AttendanceStatus.HALF_DAY).length,
      late_days: logs.filter(l => l.is_late).length,
      total_worked_minutes: logs.reduce((s, l) => s + (l.worked_minutes || 0), 0),
      total_overtime_minutes: logs.reduce((s, l) => s + (l.overtime_minutes || 0), 0)
    };

    res.json({ month, year, logs, summary });
  } catch (error) {
    console.error('Get my logs error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/time/daily-report?date=YYYY-MM-DD
 * Everyone's punches for a day (admin) or the manager's team.
 */
router.get('/daily-report', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : localParts().date;

    let employeeFilter = {};
    if (req.user.role === 'manager') {
      const manager = await findMyEmployee(db, req.user.email);
      if (!manager) return res.json({ date, rows: [], summary: {} });
      employeeFilter = teamQuery(manager);
    }

    const employees = await db.collection('employees')
      .find(employeeFilter, { projection: { _id: 1, id: 1, employee_id: 1, employee_code: 1, full_name: 1, email: 1, department: 1, designation: 1, shift_id: 1 } })
      .sort({ full_name: 1 })
      .toArray();
    const uids = employees.map(employeeUid);

    const [year, month, day] = date.split('-').map(Number);
    const [logs, gridRows, shifts, holiday] = await Promise.all([
      db.collection('attendance_logs').find({ date, employee_uid: { $in: uids } }, { projection: { _id: 0 } }).toArray(),
      db.collection('attendance').find({ month, year, employee_id: { $in: uids } }).toArray(),
      db.collection('shifts').find({}, { projection: { _id: 0 } }).toArray(),
      findHoliday(db, date)
    ]);

    const logMap = Object.fromEntries(logs.map(l => [l.employee_uid, l]));
    const gridMap = Object.fromEntries(gridRows.map(g => [g.employee_id, g.attendance?.[day]]));
    const shiftMap = Object.fromEntries(shifts.map(s => [s.id, s]));
    const defaultShift = shifts.find(s => s.is_default) || FALLBACK_SHIFT;

    const rows = employees.map(e => {
      const uid = employeeUid(e);
      const log = logMap[uid] || null;
      const shift = shiftMap[e.shift_id] || defaultShift;
      return {
        employee_id: uid,
        full_name: e.full_name,
        email: e.email,
        department: e.department,
        designation: e.designation,
        shift_name: shift.name,
        grid_status: gridMap[uid] || null,
        log
      };
    });

    const summary = {
      total: rows.length,
      clocked_in: rows.filter(r => r.log).length,
      still_working: rows.filter(r => r.log && !r.log.clock_out).length,
      late: rows.filter(r => r.log?.is_late).length,
      on_leave: rows.filter(r => r.grid_status === AttendanceStatus.LEAVE).length,
      not_clocked_in: rows.filter(r => !r.log && r.grid_status !== AttendanceStatus.LEAVE).length
    };

    res.json({ date, holiday: holiday ? { name: holiday.name } : null, rows, summary });
  } catch (error) {
    console.error('Daily report error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= SETTINGS & DAILY CLOSE =============

const timeSettingsSchema = Joi.object({
  auto_absent_enabled: Joi.boolean(),
  missed_clock_out_action: Joi.string().valid('flag', 'half_day')
}).min(1);

/**
 * GET /api/time/settings
 */
router.get('/settings', requireRole(['admin']), async (req, res) => {
  try {
    res.json(await getTimeSettings(getDB()));
  } catch (error) {
    console.error('Get time settings error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/time/settings
 */
router.put('/settings', requireRole(['admin']), validate(timeSettingsSchema), async (req, res) => {
  try {
    const db = getDB();
    await db.collection('time_settings').updateOne(
      { id: 'default' },
      { $set: { ...req.validatedBody, updated_by: req.user.email, updated_at: new Date() } },
      { upsert: true }
    );
    res.json(await getTimeSettings(db));
  } catch (error) {
    console.error('Update time settings error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/time/close-day { date? } — run the nightly close now (admin)
 */
router.post('/close-day', requireRole(['admin']), async (req, res) => {
  try {
    const date = req.body?.date;
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(422).json({ detail: 'date must be YYYY-MM-DD' });
    }
    if (date && date >= localParts().date) {
      return res.status(400).json({ detail: 'Only past days can be closed' });
    }
    res.json(await closeDay(getDB(), date || undefined));
  } catch (error) {
    console.error('Close day error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/time/close-runs — recent nightly close results
 */
router.get('/close-runs', requireRole(['admin']), async (req, res) => {
  try {
    const runs = await getDB().collection('time_close_runs')
      .find({}, { projection: { _id: 0, details: 0 } })
      .sort({ ran_at: -1 })
      .limit(30)
      .toArray();
    res.json(runs);
  } catch (error) {
    console.error('Close runs error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= ATTENDANCE REQUESTS =============

/**
 * POST /api/time/requests
 * Body: { type: missed_punch|wfh|on_duty, date, clock_in?, clock_out?, reason }
 */
router.post('/requests', validate(schemas.attendanceRequest), async (req, res) => {
  try {
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });

    const { type, date, reason } = req.validatedBody;
    const clockIn = req.validatedBody.clock_in || null;
    const clockOut = req.validatedBody.clock_out || null;
    const today = localParts().date;

    if (type === AttendanceRequestType.MISSED_PUNCH) {
      if (date > today) return res.status(400).json({ detail: 'Corrections can only be requested for today or earlier' });
      if (!clockIn && !clockOut) return res.status(400).json({ detail: 'Enter the clock-in and/or clock-out time to correct' });
    }
    if (clockIn && clockOut && timeToMinutes(clockOut) <= timeToMinutes(clockIn)) {
      return res.status(400).json({ detail: 'Clock-out time must be after clock-in time' });
    }

    const uid = employeeUid(employee);
    const duplicate = await db.collection('attendance_requests').findOne({ employee_uid: uid, date, status: 'pending' });
    if (duplicate) {
      return res.status(400).json({ detail: 'You already have a pending request for this date' });
    }

    const request = {
      id: generateUUID(),
      employee_uid: uid,
      employee_name: employee.full_name,
      user_email: employee.email,
      department: employee.department || null,
      manager_email: employee.manager_email || null,
      type,
      date,
      clock_in: clockIn,
      clock_out: clockOut,
      reason,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.collection('attendance_requests').insertOne(request);

    notifyApprovers(db, employee, request).catch(err =>
      console.error('Attendance request notification error:', err.message)
    );

    res.status(201).json(stripId(request));
  } catch (error) {
    console.error('Create attendance request error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/time/requests/my
 */
router.get('/requests/my', async (req, res) => {
  try {
    const db = getDB();
    const requests = await db.collection('attendance_requests')
      .find({ user_email: req.user.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();
    res.json(requests);
  } catch (error) {
    console.error('Get my attendance requests error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/time/requests?status=pending|approved|rejected|all
 * Admin sees everyone; managers see their team.
 */
router.get('/requests', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const status = req.query.status || 'pending';
    const filter = status === 'all' ? {} : { status };

    if (req.user.role === 'manager') {
      const manager = await findMyEmployee(db, req.user.email);
      if (!manager) return res.json([]);
      const team = await db.collection('employees').find(teamQuery(manager), { projection: { email: 1 } }).toArray();
      filter.user_email = { $in: team.map(t => t.email) };
    }

    const requests = await db.collection('attendance_requests')
      .find(filter, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(500)
      .toArray();
    res.json(requests);
  } catch (error) {
    console.error('Get attendance requests error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/time/requests/:id/action
 * Body: { action: approve|reject, comments? }
 * Approving writes the punch log and the attendance grid for that date.
 */
router.post('/requests/:id/action', requireRole(['admin', 'manager']), validate(schemas.attendanceRequestAction), async (req, res) => {
  try {
    const db = getDB();
    const request = await db.collection('attendance_requests').findOne({ id: req.params.id });
    if (!request) return res.status(404).json({ detail: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ detail: `Request is already ${request.status}` });
    // Nobody approves their own request, admins included (same rule as profile change requests)
    if (req.validatedBody.action === 'approve' && request.user_email === req.user.email) {
      return res.status(403).json({ detail: 'You cannot approve your own request; another approver must act on it' });
    }
    if (!(await canActOnEmployee(db, req.user, request.user_email))) {
      return res.status(403).json({ detail: 'You can only act on requests from your team' });
    }

    const { action, comments } = req.validatedBody;
    const now = new Date();
    const status = action === 'approve' ? 'approved' : 'rejected';

    if (action === 'approve') {
      const employee = await findMyEmployee(db, request.user_email);
      if (!employee) return res.status(400).json({ detail: 'Employee no longer exists' });

      const shift = await getShiftForEmployee(db, employee);
      const existing = await db.collection('attendance_logs').findOne({ employee_uid: request.employee_uid, date: request.date });

      // Missed punch keeps whichever side wasn't corrected; WFH/on-duty default to shift hours
      const fallbackIn = request.type === AttendanceRequestType.MISSED_PUNCH ? null : shift.start_time;
      const fallbackOut = request.type === AttendanceRequestType.MISSED_PUNCH ? null : shift.end_time;
      const clockIn = request.clock_in
        ? zonedTimeToDate(request.date, request.clock_in)
        : existing?.clock_in || (fallbackIn && zonedTimeToDate(request.date, fallbackIn));
      let clockOut = request.clock_out
        ? zonedTimeToDate(request.date, request.clock_out)
        : existing?.clock_out || (fallbackOut && zonedTimeToDate(request.date, fallbackOut));
      if (clockOut && clockIn && clockOut <= clockIn) clockOut = new Date(clockOut.getTime() + 86400000); // overnight

      if (!clockIn) {
        return res.status(400).json({ detail: 'There is no clock-in for this date; the request must include a clock-in time' });
      }

      const metrics = computeMetrics(shift, clockIn, clockOut);
      const gridStatus = clockOut ? statusFromWorked(shift, metrics.worked_minutes) : AttendanceStatus.PRESENT;
      const holiday = await findHoliday(db, request.date);

      const log = {
        id: existing?.id || generateUUID(),
        employee_uid: request.employee_uid,
        employee_name: request.employee_name,
        user_email: request.user_email,
        department: request.department,
        date: request.date,
        shift: shiftSnapshot(shift),
        clock_in: clockIn,
        clock_out: clockOut || null,
        clock_in_location: existing?.clock_in_location || null,
        clock_out_location: existing?.clock_out_location || null,
        work_mode: request.type === AttendanceRequestType.WORK_FROM_HOME ? 'wfh'
          : request.type === AttendanceRequestType.ON_DUTY ? 'on_duty'
            : existing?.work_mode || 'office',
        is_holiday: !!holiday,
        is_weekly_off: (shift.weekly_offs || []).includes(new Date(`${request.date}T12:00:00Z`).getUTCDay()),
        ...metrics,
        status: gridStatus,
        source: 'regularization',
        request_id: request.id,
        created_at: existing?.created_at || now,
        updated_at: now
      };
      await db.collection('attendance_logs').replaceOne(
        { employee_uid: request.employee_uid, date: request.date },
        log,
        { upsert: true }
      );
      if (!holiday) await writeGrid(db, request.employee_uid, request.date, gridStatus);
    }

    await db.collection('attendance_requests').updateOne(
      { id: request.id },
      {
        $set: {
          status,
          actioned_by: req.user.email,
          actioned_by_name: req.user.full_name,
          action_comments: comments || null,
          actioned_at: now,
          updated_at: now
        }
      }
    );

    const label = REQUEST_TYPE_LABELS[request.type];
    createNotification({
      userEmail: request.user_email,
      type: action === 'approve' ? NotificationType.ATTENDANCE_REQUEST_APPROVED : NotificationType.ATTENDANCE_REQUEST_REJECTED,
      title: `${label} request ${status}`,
      message: `Your ${label.toLowerCase()} request for ${request.date} was ${status} by ${req.user.full_name}` +
        (comments ? `: ${comments}` : ''),
      actionUrl: '/my-attendance',
      metadata: { request_id: request.id }
    }).catch(err => console.error('Attendance action notification error:', err.message));

    const updated = await db.collection('attendance_requests').findOne({ id: request.id }, { projection: { _id: 0 } });
    res.json(updated);
  } catch (error) {
    console.error('Attendance request action error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/time/requests/:id
 * Employee withdraws their own pending request.
 */
router.delete('/requests/:id', async (req, res) => {
  try {
    const db = getDB();
    const request = await db.collection('attendance_requests').findOne({ id: req.params.id });
    if (!request) return res.status(404).json({ detail: 'Request not found' });
    if (request.user_email !== req.user.email) return res.status(403).json({ detail: 'Not your request' });
    if (request.status !== 'pending') return res.status(400).json({ detail: 'Only pending requests can be withdrawn' });

    await db.collection('attendance_requests').deleteOne({ id: request.id });
    res.json({ message: 'Request withdrawn' });
  } catch (error) {
    console.error('Withdraw attendance request error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
module.exports._internal = { computeMetrics, statusFromWorked };
