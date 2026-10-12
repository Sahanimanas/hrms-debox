/**
 * analytics module — mounted at /api/v2/analytics
 *
 * AN-1 People analytics          GET /people
 * AN-2 Attendance & leave trends GET /attendance
 * AN-3 Payroll cost              GET /payroll-cost
 * AN-4 Server-side CSV exports   GET /export, GET /leave-report?format=csv
 * AN-5 Custom/scheduled reports  /reports…
 * Dashboard widget               GET /summary
 *
 * Admins see everyone; managers see their team (direct reports + department);
 * payroll cost and the report builder are admin only (managers may run saved
 * reports an admin shared with them, scoped to their team).
 */

const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { emitEvent } = require('../../services/events');
const {
  MONTH_RE, DAY_RE, isValidDay, round, todayStr, currentMonth, addDays, addMonths, monthsBetween, dayRange,
  monthStart, monthEnd, toDay, HttpError, loadScopedEmployees, loadAllEmployees, employedOn, sendCsv
} = require('../../services/analytics/common');
const { computePeople } = require('../../services/analytics/people');
const { computeAttendance } = require('../../services/analytics/attendance');
const { computePayrollCost } = require('../../services/analytics/payrollCost');
const { DATASETS, ALL_OPS, AGG_FNS, datasetCatalog, compileDefinition, runReport } = require('../../services/analytics/reports');
const { computeNextRun, deliverReport, REPORTS, DELIVERIES } = require('../../services/analytics/scheduler');
const { isEmailConfigured } = require('../../services/analytics/mailer');

router.get('/health', (req, res) => res.json({ module: 'analytics', status: 'ok' }));

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection(REPORTS).createIndex({ id: 1 }, { unique: true }),
    db.collection(REPORTS).createIndex({ 'schedule.enabled': 1, 'schedule.next_run_at': 1 }),
    db.collection(DELIVERIES).createIndex({ report_id: 1, created_at: -1 }),
    db.collection(DELIVERIES).createIndex({ created_at: -1 })
  ]);
  indexesReady = true;
};

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Analytics index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

const adminOrManager = requireRole(['admin', 'manager']);
const adminOnly = requireRole(['admin']);

// ============= HELPERS =============

const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) {
    return res.status(422).json({
      detail: 'Validation failed',
      errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
    });
  }
  req.validatedQuery = value;
  next();
};

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ detail: error.message });
    console.error(`Analytics ${req.method} ${req.path} error:`, error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

const optStr = Joi.string().trim().max(120).allow('', null);
const monthQuery = Joi.object({
  from: Joi.string().pattern(MONTH_RE),
  to: Joi.string().pattern(MONTH_RE),
  department: optStr,
  organization_id: optStr
});
const dayQuery = Joi.object({
  from: Joi.string().pattern(DAY_RE),
  to: Joi.string().pattern(DAY_RE),
  department: optStr,
  organization_id: optStr
});

const MAX_MONTHS = 60;
const MAX_DAYS = 366;

const monthWindow = ({ from, to }, { clampToCurrent = false } = {}) => {
  const now = currentMonth();
  let end = to || now;
  if (clampToCurrent && end > now) end = now;
  const start = from || addMonths(end, -11);
  if (start > end) throw new HttpError(400, '"from" must not be after "to"');
  if (monthsBetween(start, end) + 1 > MAX_MONTHS) throw new HttpError(400, `Range is limited to ${MAX_MONTHS} months`);
  return { from: start, to: end };
};

const dayWindow = ({ from, to }) => {
  const end = to || todayStr();
  const start = from || addDays(end, -29);
  if (!isValidDay(start) || !isValidDay(end)) throw new HttpError(422, 'Invalid date');
  if (start > end) throw new HttpError(400, '"from" must not be after "to"');
  if (dayRange(start, end).length > MAX_DAYS) throw new HttpError(400, `Range is limited to ${MAX_DAYS} days`);
  return { from: start, to: end };
};

const filtersOf = (q) => ({ department: q.department || null, organization_id: q.organization_id || null });

const managerInfoMap = async (db) => {
  const all = await db.collection('employees').find({}, { projection: { _id: 0, email: 1, full_name: 1, department: 1 } }).toArray();
  return new Map(all.map(e => [e.email, { name: e.full_name, department: e.department || null }]));
};

const peopleFor = async (req, q) => {
  const db = getDB();
  const window = monthWindow(q);
  const { employees, scope } = await loadScopedEmployees(db, req.user, filtersOf(q));
  const result = computePeople(employees, { ...window, managerInfo: await managerInfoMap(db) });
  return { scope, filters: filtersOf(q), ...result };
};

const attendanceFor = async (req, q) => {
  const db = getDB();
  const window = dayWindow(q);
  const { employees, scope } = await loadScopedEmployees(db, req.user, filtersOf(q));
  const result = await computeAttendance(db, employees, { ...window, includeValue: req.user.role === 'admin' });
  return { scope, filters: filtersOf(q), ...result };
};

const payrollFor = async (req, q) => {
  const db = getDB();
  const window = monthWindow(q, { clampToCurrent: true });
  let employees = await loadAllEmployees(db);
  if (q.organization_id) employees = employees.filter(e => e.organization_id === q.organization_id);
  const result = await computePayrollCost(db, employees, { ...window, department: q.department || null });
  return { filters: filtersOf(q), ...result };
};

// ============= FILTER OPTIONS =============

/**
 * GET /api/v2/analytics/filters
 * Departments, designations and organizations the caller can filter by.
 */
router.get('/filters', adminOrManager, handle(async (req, res) => {
  const db = getDB();
  const { employees, scope } = await loadScopedEmployees(db, req.user);
  const orgIds = new Set(employees.map(e => e.organization_id).filter(Boolean));
  const orgs = await db.collection('organizations').find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
  res.json({
    scope,
    departments: [...new Set(employees.map(e => e.department))].sort(),
    designations: [...new Set(employees.map(e => e.designation))].sort(),
    organizations: orgs.filter(o => req.user.role === 'admin' || orgIds.has(o.id)).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    email_configured: req.user.role === 'admin' ? isEmailConfigured() : undefined
  });
}));

// ============= AN-1 PEOPLE =============

/**
 * GET /api/v2/analytics/people?from=YYYY-MM&to=YYYY-MM&department=&organization_id=
 */
router.get('/people', adminOrManager, validateQuery(monthQuery), handle(async (req, res) => {
  const result = await peopleFor(req, req.validatedQuery);
  if (req.user.role !== 'admin') {
    // Managers get aggregate numbers for their team, not the full roster with ages
    result.roster = result.roster.map(({ age, ...r }) => r);
  }
  res.json(result);
}));

// ============= AN-2 ATTENDANCE & LEAVE =============

/**
 * GET /api/v2/analytics/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&department=&organization_id=
 */
router.get('/attendance', adminOrManager, validateQuery(dayQuery), handle(async (req, res) => {
  res.json(await attendanceFor(req, req.validatedQuery));
}));

// ============= AN-3 PAYROLL COST =============

/**
 * GET /api/v2/analytics/payroll-cost?from=YYYY-MM&to=YYYY-MM&department=&organization_id=
 */
router.get('/payroll-cost', adminOnly, validateQuery(monthQuery), handle(async (req, res) => {
  res.json(await payrollFor(req, req.validatedQuery));
}));

// ============= DASHBOARD SUMMARY =============

const JOB_COLLECTIONS = ['job_postings', 'job_requisitions', 'jobs', 'job_openings'];
const OPEN_JOB_STATUSES = ['open', 'published', 'active'];

const countOpenPositions = async (db) => {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  const name = JOB_COLLECTIONS.find(n => existing.has(n));
  if (!name) return null;
  const jobs = await db.collection(name).find({ status: { $in: OPEN_JOB_STATUSES } }, { projection: { _id: 0, openings: 1, positions: 1, vacancies: 1 } }).toArray();
  return jobs.reduce((s, j) => {
    const n = [j.openings, j.positions, j.vacancies].map(Number).find(v => Number.isFinite(v) && v > 0);
    return s + (n || 1);
  }, 0);
};

/**
 * GET /api/v2/analytics/summary — admin dashboard widget
 */
router.get('/summary', adminOnly, handle(async (req, res) => {
  const db = getDB();
  const today = todayStr();
  const to = currentMonth();
  const from = addMonths(to, -11);
  const employees = await loadAllEmployees(db);
  const people = computePeople(employees, { from, to, today });
  const attendance = await computeAttendance(db, employees, { from: today, to: today, today });
  const day = attendance.daily[0] || {};
  const openPositions = await countOpenPositions(db);

  res.json({
    as_of: today,
    headcount: employees.filter(e => employedOn(e, today)).length,
    joiners_this_month: people.trend[people.trend.length - 1]?.joiners ?? 0,
    leavers_last_12_months: people.summary.leavers,
    avg_headcount_12m: people.summary.avg_headcount,
    attrition_12m_pct: people.summary.attrition_pct,
    attrition_window: { from, to },
    trend: people.trend.map(t => ({ month: t.month, headcount: t.headcount })),
    today: {
      date: today,
      attendance_pct: day.attendance_pct ?? null,
      present: day.present || 0,
      half_day: day.half_day || 0,
      absent: day.absent || 0,
      on_leave: day.on_leave || 0,
      unmarked: day.unmarked || 0,
      active_headcount: day.active_headcount || 0
    },
    ...(openPositions != null ? { open_positions: openPositions } : {})
  });
}));

// ============= AN-4 SERVER-SIDE CSV =============

const C = (key, label) => ({ key, label });
const splitCols = (label) => [C('key', label), C('count', 'Employees'), C('pct', '% of total')];

const EXPORTS = {
  people: {
    load: peopleFor,
    query: monthQuery,
    tables: {
      headcount_trend: { rows: r => r.trend, columns: [C('month', 'Month'), C('opening', 'Opening headcount'), C('headcount', 'Closing headcount'), C('joiners', 'Joiners'), C('leavers', 'Leavers'), C('avg_headcount', 'Average headcount'), C('attrition_pct', 'Attrition %')] },
      department_split: { rows: r => r.splits.department, columns: splitCols('Department') },
      designation_split: { rows: r => r.splits.designation, columns: splitCols('Designation') },
      gender_split: { rows: r => r.splits.gender, columns: splitCols('Gender') },
      status_split: { rows: r => r.splits.employment_status, columns: splitCols('Employment status') },
      organization_split: { rows: r => r.splits.organization, columns: splitCols('Organization') },
      tenure_bands: { rows: r => r.tenure_bands, columns: splitCols('Tenure') },
      age_bands: { rows: r => r.age_bands, columns: splitCols('Age band') },
      span_of_control: { rows: r => r.span_of_control.rows, columns: [C('manager_name', 'Manager'), C('manager_email', 'Manager email'), C('department', 'Department'), C('direct_reports', 'Direct reports')] },
      roster: {
        rows: r => r.roster,
        columns: [C('employee_id', 'Employee ID'), C('full_name', 'Name'), C('email', 'Email'), C('department', 'Department'), C('designation', 'Designation'), C('organization', 'Organization'), C('gender', 'Gender'), C('employment_status', 'Status'), C('joining_date', 'Joining date'), C('tenure_months', 'Tenure (months)'), C('tenure_band', 'Tenure band'), C('age', 'Age'), C('age_band', 'Age band'), C('manager_email', 'Manager email')]
      }
    }
  },
  attendance: {
    load: attendanceFor,
    query: dayQuery,
    tables: {
      daily_trend: { rows: r => r.daily, columns: [C('date', 'Date'), C('active_headcount', 'Active headcount'), C('present', 'Present'), C('half_day', 'Half day'), C('absent', 'Absent'), C('on_leave', 'On leave'), C('unmarked', 'Unmarked'), C('attendance_pct', 'Attendance %'), C('holiday_name', 'Holiday')] },
      late_trend: { rows: r => r.late_trend, columns: [C('date', 'Date'), C('late_arrivals', 'Late arrivals')] },
      top_late_arrivers: { rows: r => r.top_late_arrivers, columns: [C('employee_id', 'Employee ID'), C('full_name', 'Name'), C('department', 'Department'), C('late_count', 'Late days'), C('late_minutes', 'Total late minutes'), C('avg_late_minutes', 'Average late minutes')] },
      absenteeism_by_department: { rows: r => r.absenteeism_by_department, columns: [C('department', 'Department'), C('employees', 'Employees'), C('present', 'Present'), C('half_day', 'Half day'), C('absent', 'Absent'), C('on_leave', 'On leave'), C('absence_days', 'Absence days'), C('marked_days', 'Marked days'), C('attendance_pct', 'Attendance %'), C('absenteeism_pct', 'Absenteeism %')] },
      hours_by_department: { rows: r => r.hours_by_department, columns: [C('department', 'Department'), C('logs', 'Punch days'), C('avg_worked_hours', 'Average worked hours'), C('total_overtime_hours', 'Overtime hours'), C('avg_overtime_minutes', 'Average overtime minutes')] },
      leave_usage: { rows: r => r.leave_usage.months, columns: r => [C('month', 'Month'), ...r.leave_usage.types.map(t => C(t, t)), C('total', 'Total days')] },
      top_leave_takers: { rows: r => r.top_leave_takers, columns: [C('employee_id', 'Employee ID'), C('full_name', 'Name'), C('department', 'Department'), C('days', 'Leave days')] },
      leave_liability: { rows: r => r.leave_liability.by_employee, columns: r => [C('employee_id', 'Employee ID'), C('full_name', 'Name'), C('department', 'Department'), C('balance_days', 'Balance days'), ...(r.leave_liability.encashable_value != null ? [C('encashable_value', 'Encashable value (INR)')] : [])] },
      punch_logs: {
        // Raw punches for the range — the large dataset, streamed as CSV only
        rows: async (r, req, q) => {
          const db = getDB();
          const { employees } = await loadScopedEmployees(db, req.user, filtersOf(q));
          const uids = employees.map(e => e.uid);
          const logs = await db.collection('attendance_logs')
            .find({ employee_uid: { $in: uids }, date: { $gte: r.range.from, $lte: r.range.to } }, { projection: DATASETS.attendance_logs.projection })
            .sort({ date: 1, employee_name: 1 })
            .limit(200000)
            .toArray();
          return logs.map(l => DATASETS.attendance_logs.row(l));
        },
        columns: DATASETS.attendance_logs.defaultFields.concat(['late_minutes', 'overtime_minutes', 'work_mode'])
          .filter((v, i, a) => a.indexOf(v) === i)
          .map(k => C(k, DATASETS.attendance_logs.fields[k].label))
      }
    }
  },
  'payroll-cost': {
    load: payrollFor,
    query: monthQuery,
    adminOnly: true,
    tables: {
      months: { rows: r => r.months, columns: [C('month', 'Month'), C('source', 'Source'), C('headcount', 'Headcount'), C('gross', 'Gross'), C('deductions', 'Deductions (excl. LOP)'), C('lop', 'Loss of pay'), C('net', 'Net'), C('employer_contributions', 'Employer contributions'), C('employer_cost', 'Employer cost'), C('cost_per_head', 'Cost per head'), C('mom_change_pct', 'MoM change %')] },
      by_department: { rows: r => r.by_department, columns: [C('department', 'Department'), C('gross', 'Gross'), C('net', 'Net'), C('employer_cost', 'Employer cost'), C('avg_headcount', 'Average headcount'), C('share_pct', 'Share %')] }
    }
  }
};

/**
 * GET /api/v2/analytics/export?section=people|attendance|payroll-cost&table=<name>&from&to&department&organization_id
 * Returns text/csv.
 */
router.get('/export', adminOrManager, handle(async (req, res) => {
  const { section, table, ...rest } = req.query;
  const def = EXPORTS[section];
  if (!def) throw new HttpError(400, `Unknown section. Use one of: ${Object.keys(EXPORTS).join(', ')}`);
  if (def.adminOnly && req.user.role !== 'admin') throw new HttpError(403, 'Not enough permissions');
  const t = def.tables[table];
  if (!t) throw new HttpError(400, `Unknown table. Use one of: ${Object.keys(def.tables).join(', ')}`);
  const { error, value } = def.query.validate(rest, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(422).json({ detail: 'Validation failed', errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message })) });

  const result = await def.load(req, value);
  const rows = await t.rows(result, req, value);
  const columns = typeof t.columns === 'function' ? t.columns(result) : t.columns;
  const range = result.range ? `${result.range.from}_${result.range.to}` : '';
  sendCsv(res, `${section}-${table.replace(/_/g, '-')}-${range}`, rows, columns);
}));

// ============= LEAVE REPORT (Reports page) =============

const leaveReportQuery = Joi.object({
  month: Joi.string().pattern(MONTH_RE),
  department: optStr,
  organization_id: optStr,
  employee_email: Joi.string().email({ tlds: { allow: false } }).allow('', null),
  status: Joi.string().valid('pending', 'manager_approved', 'approved', 'rejected', 'cancelled').allow('', null),
  format: Joi.string().valid('json', 'csv').default('json')
});

/**
 * GET /api/v2/analytics/leave-report?month=YYYY-MM&department&organization_id&employee_email&status&format=csv
 * Leave applications with any day in the month. Admin: everyone, manager: their team.
 */
router.get('/leave-report', adminOrManager, validateQuery(leaveReportQuery), handle(async (req, res) => {
  const db = getDB();
  const q = req.validatedQuery;
  const month = q.month || currentMonth();
  const { employees } = await loadScopedEmployees(db, req.user, filtersOf(q));
  const scoped = q.employee_email ? employees.filter(e => e.email === q.employee_email) : employees;
  const byEmail = new Map(scoped.map(e => [e.email, e]));
  const byId = new Map(scoped.filter(e => e.id).map(e => [e.id, e]));

  const leaves = await db.collection('leaves').find(
    {
      $or: [{ employee_email: { $in: [...byEmail.keys()] } }, { employee_id: { $in: [...byId.keys()] } }],
      ...(q.status ? { status: q.status } : {})
    },
    { projection: { _id: 0, id: 1, employee_id: 1, employee_email: 1, employee_name: 1, leave_type: 1, dates: 1, days_count: 1, is_half_day: 1, reason: 1, status: 1, created_at: 1 } }
  ).toArray();

  const first = monthStart(month), last = monthEnd(month);
  const rows = [];
  for (const l of leaves) {
    const dates = (Array.isArray(l.dates) ? l.dates : []).map(toDay).filter(Boolean).sort();
    if (!dates.some(d => d >= first && d <= last)) continue;
    const e = byEmail.get(l.employee_email) || byId.get(l.employee_id);
    if (!e) continue;
    rows.push({
      id: l.id,
      employee_name: e.full_name || l.employee_name,
      employee_code: e.employee_id,
      employee_email: e.email,
      department: e.department,
      designation: e.designation,
      leave_type: l.leave_type,
      start_date: dates[0],
      end_date: dates[dates.length - 1],
      days_count: round(l.days_count),
      is_half_day: !!l.is_half_day,
      status: l.status,
      reason: l.reason || '',
      applied_on: toDay(l.created_at)
    });
  }
  rows.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.employee_name.localeCompare(b.employee_name));

  if (q.format === 'csv') {
    return sendCsv(res, `leave-report-${month}`, rows, [
      C('employee_name', 'Employee Name'), C('employee_code', 'Employee ID'), C('department', 'Department'),
      C('designation', 'Designation'), C('leave_type', 'Leave Type'), C('start_date', 'Start Date'),
      C('end_date', 'End Date'), C('days_count', 'Days Count'), C('reason', 'Reason'), C('status', 'Status'),
      C('applied_on', 'Applied Date')
    ]);
  }

  const count = (s) => rows.filter(r => r.status === s).length;
  res.json({
    month,
    summary: {
      total: rows.length,
      approved: count('approved'),
      pending: count('pending') + count('manager_approved'),
      rejected: count('rejected'),
      days: round(rows.filter(r => r.status === 'approved').reduce((s, r) => s + r.days_count, 0))
    },
    rows
  });
}));

// ============= AN-5 REPORT BUILDER =============

const fieldKey = Joi.string().trim().max(60).pattern(/^[a-z0-9_]+$/);
const definitionSchema = Joi.object({
  dataset: Joi.string().valid(...Object.keys(DATASETS)).required(),
  fields: Joi.array().items(fieldKey).max(40).default([]),
  filters: Joi.array().items(Joi.object({
    field: fieldKey.required(),
    op: Joi.string().valid(...ALL_OPS).required(),
    value: Joi.alternatives().try(
      Joi.string().allow('').max(500),
      Joi.number(),
      Joi.boolean(),
      Joi.array().items(Joi.alternatives().try(Joi.string().max(500), Joi.number())).max(200)
    ).allow(null)
  })).max(20).default([]),
  group_by: Joi.array().items(fieldKey).max(3).default([]),
  aggregates: Joi.array().items(Joi.object({
    fn: Joi.string().valid(...AGG_FNS).required(),
    field: fieldKey.allow(null, '')
  })).max(10).default([]),
  sort: Joi.array().items(Joi.object({
    field: fieldKey.required(),
    direction: Joi.string().valid('asc', 'desc').default('asc')
  })).max(3).default([]),
  limit: Joi.number().integer().min(1).max(10000).default(1000)
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const scheduleSchema = Joi.object({
  enabled: Joi.boolean().default(true),
  frequency: Joi.string().valid('daily', 'weekly', 'monthly').required(),
  time: Joi.string().pattern(TIME_RE).required(),
  day_of_week: Joi.when('frequency', { is: 'weekly', then: Joi.number().integer().min(0).max(6).required(), otherwise: Joi.any().strip() }),
  day_of_month: Joi.when('frequency', { is: 'monthly', then: Joi.number().integer().min(1).max(28).required(), otherwise: Joi.any().strip() }),
  recipients: Joi.array().items(Joi.string().trim().lowercase().email()).min(1).max(20).unique().required()
});

const reportCreateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  description: Joi.string().trim().max(500).allow('', null).default(''),
  definition: definitionSchema.required(),
  shared_with_managers: Joi.boolean().default(false),
  schedule: scheduleSchema.allow(null).default(null)
});

const reportUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120),
  description: Joi.string().trim().max(500).allow('', null),
  definition: definitionSchema,
  shared_with_managers: Joi.boolean(),
  schedule: scheduleSchema.allow(null)
}).min(1);

const previewSchema = Joi.object({
  definition: definitionSchema.required(),
  format: Joi.string().valid('json', 'csv').default('json')
});

const sendSchema = Joi.object({
  recipients: Joi.array().items(Joi.string().trim().lowercase().email()).min(1).max(20).unique()
});

const checkDefinition = (definition) => {
  const compiled = compileDefinition(definition); // throws HttpError(400)
  return compiled;
};

const withSchedule = (schedule) => (schedule ? { ...schedule, next_run_at: schedule.enabled ? computeNextRun(schedule) : null } : null);

/** What a manager may see of a shared report (no recipients or delivery state). */
const managerView = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  definition: r.definition,
  dataset: r.definition?.dataset,
  shared_with_managers: true,
  updated_at: r.updated_at
});

const findReportFor = async (db, user, id) => {
  const report = await db.collection(REPORTS).findOne({ id }, { projection: { _id: 0 } });
  if (!report) throw new HttpError(404, 'Report not found');
  if (user.role === 'admin') return report;
  if (user.role === 'manager' && report.shared_with_managers && !DATASETS[report.definition?.dataset]?.adminOnly) return report;
  throw new HttpError(404, 'Report not found');
};

const sendResult = (res, result, name, format) => {
  if (format === 'csv') return sendCsv(res, `${name}-${todayStr()}`, result.rows, result.columns);
  res.json(result);
};

/**
 * GET /api/v2/analytics/reports/datasets — whitelisted datasets and fields
 */
router.get('/reports/datasets', adminOrManager, handle(async (req, res) => {
  res.json({ datasets: datasetCatalog(req.user.role), aggregates: AGG_FNS });
}));

/**
 * POST /api/v2/analytics/reports/preview — run an unsaved definition (admin)
 * Body: { definition, format?: 'json'|'csv' }
 */
router.post('/reports/preview', adminOnly, validate(previewSchema), handle(async (req, res) => {
  const { definition, format } = req.validatedBody;
  const result = await runReport(getDB(), definition, req.user);
  sendResult(res, result, `report-${definition.dataset}`, format);
}));

/**
 * GET /api/v2/analytics/reports/deliveries?report_id=&limit= — delivery log (admin)
 */
router.get('/reports/deliveries', adminOnly, validateQuery(Joi.object({
  report_id: Joi.string().max(64),
  status: Joi.string().valid('sent', 'skipped', 'failed'),
  limit: Joi.number().integer().min(1).max(500).default(100)
})), handle(async (req, res) => {
  const { report_id, status, limit } = req.validatedQuery;
  const query = {};
  if (report_id) query.report_id = report_id;
  if (status) query.status = status;
  const rows = await getDB().collection(DELIVERIES).find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(limit).toArray();
  res.json(rows);
}));

/**
 * GET /api/v2/analytics/reports — saved reports (admin: all; manager: shared with managers)
 */
router.get('/reports', adminOrManager, handle(async (req, res) => {
  const db = getDB();
  const query = req.user.role === 'admin'
    ? {}
    : { shared_with_managers: true, 'definition.dataset': { $in: Object.keys(DATASETS).filter(k => !DATASETS[k].adminOnly) } };
  const reports = await db.collection(REPORTS).find(query, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  res.json(req.user.role === 'admin' ? reports : reports.map(managerView));
}));

/**
 * POST /api/v2/analytics/reports — save a report definition (admin)
 */
router.post('/reports', adminOnly, validate(reportCreateSchema), handle(async (req, res) => {
  const body = req.validatedBody;
  checkDefinition(body.definition);
  const now = new Date();
  const report = {
    id: generateUUID(),
    name: body.name,
    description: body.description || '',
    definition: body.definition,
    shared_with_managers: body.shared_with_managers,
    schedule: withSchedule(body.schedule),
    created_by: { email: req.user.email, name: req.user.full_name || null },
    created_at: now,
    updated_at: now
  };
  await getDB().collection(REPORTS).insertOne({ ...report });
  emitEvent('report.created', { id: report.id, name: report.name, dataset: report.definition.dataset, scheduled: !!report.schedule });
  res.status(201).json(report);
}));

/**
 * GET /api/v2/analytics/reports/:id
 */
router.get('/reports/:id', adminOrManager, handle(async (req, res) => {
  const report = await findReportFor(getDB(), req.user, req.params.id);
  res.json(req.user.role === 'admin' ? report : managerView(report));
}));

/**
 * PUT /api/v2/analytics/reports/:id — edit (admin)
 */
router.put('/reports/:id', adminOnly, validate(reportUpdateSchema), handle(async (req, res) => {
  const db = getDB();
  const existing = await findReportFor(db, req.user, req.params.id);
  const body = req.validatedBody;
  if (body.definition) checkDefinition(body.definition);
  const update = { updated_at: new Date() };
  for (const k of ['name', 'description', 'definition', 'shared_with_managers']) {
    if (body[k] !== undefined) update[k] = body[k] ?? '';
  }
  if (body.schedule !== undefined) {
    update.schedule = withSchedule(body.schedule);
    if (update.schedule && existing.schedule?.last_run_at) update.schedule.last_run_at = existing.schedule.last_run_at;
  }
  await db.collection(REPORTS).updateOne({ id: existing.id }, { $set: update });
  res.json(await db.collection(REPORTS).findOne({ id: existing.id }, { projection: { _id: 0 } }));
}));

/**
 * DELETE /api/v2/analytics/reports/:id (admin) — delivery log entries are kept
 */
router.delete('/reports/:id', adminOnly, handle(async (req, res) => {
  const db = getDB();
  const existing = await findReportFor(db, req.user, req.params.id);
  await db.collection(REPORTS).deleteOne({ id: existing.id });
  res.json({ status: 'deleted', id: existing.id });
}));

/**
 * GET /api/v2/analytics/reports/:id/run?format=json|csv
 * Admin: full data. Manager: shared reports only, limited to their team.
 */
router.get('/reports/:id/run', adminOrManager, validateQuery(Joi.object({ format: Joi.string().valid('json', 'csv').default('json') })), handle(async (req, res) => {
  const db = getDB();
  const report = await findReportFor(db, req.user, req.params.id);
  const result = await runReport(db, report.definition, req.user);
  if (req.user.role === 'admin') {
    await db.collection(REPORTS).updateOne({ id: report.id }, { $set: { last_run_at: new Date(), last_row_count: result.rows.length } });
  }
  sendResult(res, { report: { id: report.id, name: report.name }, ...result }, report.name, req.validatedQuery.format);
}));

/**
 * POST /api/v2/analytics/reports/:id/send — "run now": e-mail the CSV to the
 * schedule's recipients (or the ones given) and log the delivery (admin)
 */
router.post('/reports/:id/send', adminOnly, validate(sendSchema), handle(async (req, res) => {
  const db = getDB();
  const report = await findReportFor(db, req.user, req.params.id);
  const recipients = req.validatedBody.recipients || report.schedule?.recipients || [];
  if (!recipients.length) throw new HttpError(400, 'Add recipients to the schedule or pass them in the request');
  const delivery = await deliverReport(db, report, { trigger: 'manual', recipients, actor: req.user });
  delete delivery._id;
  res.json(delivery);
}));

module.exports = router;
