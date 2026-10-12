/**
 * Shared helpers for analytics: company-timezone day/month arithmetic,
 * employee normalisation (tolerant of missing lifecycle fields), access
 * scoping (admin = everyone, manager = their team) and CSV output.
 */

const { employeeUid, localParts } = require('../../utils/helpers');

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A real calendar day (rejects 2025-02-30). */
const isValidDay = (s) => {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

const round = (n, dp = 2) => {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  const f = 10 ** dp;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
};

/** Any date-ish value -> 'YYYY-MM-DD' in the company timezone (or null). */
const toDay = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && DAY_RE.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return localParts(d).date;
};

const todayStr = () => localParts(new Date()).date;
const currentMonth = () => todayStr().slice(0, 7);

const dayToUtc = (day) => Date.parse(`${day}T00:00:00Z`);
const utcToDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day, n) => utcToDay(dayToUtc(day) + n * 86400000);
const weekdayOf = (day) => new Date(dayToUtc(day)).getUTCDay();

const addMonths = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
};

const monthStart = (month) => `${month}-01`;
const monthEnd = (month) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
};

const monthRange = (from, to) => {
  const out = [];
  for (let m = from; m <= to && out.length < 1000; m = addMonths(m, 1)) out.push(m);
  return out;
};

const dayRange = (from, to) => {
  const out = [];
  for (let d = from; d <= to && out.length < 5000; d = addDays(d, 1)) out.push(d);
  return out;
};

const monthsBetween = (a, b) => (b.slice(0, 4) - a.slice(0, 4)) * 12 + (b.slice(5, 7) - a.slice(5, 7));

/** Whole months from day a to day b (a <= b). */
const fullMonthsBetween = (a, b) => {
  let months = monthsBetween(a, b);
  if (Number(b.slice(8, 10)) < Number(a.slice(8, 10))) months -= 1;
  return Math.max(0, months);
};

/** Age in whole years on day `on`. */
const ageOn = (dob, on) => {
  let years = Number(on.slice(0, 4)) - Number(dob.slice(0, 4));
  if (on.slice(5) < dob.slice(5)) years -= 1;
  return years;
};

const titleCase = (s) => String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const normalizeGender = (g) => {
  if (g == null || String(g).trim() === '') return 'Unspecified';
  const v = String(g).trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'Male';
  if (v === 'f' || v === 'female') return 'Female';
  return titleCase(v);
};

// Fields read from `employees`; never the whole document (no secrets leak by accident).
const EMPLOYEE_PROJECTION = {
  _id: 1, id: 1, employee_id: 1, employee_code: 1, email: 1, full_name: 1, role: 1,
  department: 1, designation: 1, organization_id: 1, organization_name: 1,
  manager_email: 1, manager_name: 1, gender: 1, employment_status: 1,
  joining_date: 1, created_at: 1, exit_date: 1, date_of_birth: 1,
  monthly_salary: 1, leave_balance: 1, phone: 1, probation_end_date: 1, confirmation_date: 1, exit_reason: 1
};

const normEmployee = (e) => {
  const status = String(e.employment_status || 'active').toLowerCase();
  const exit = toDay(e.exit_date);
  return {
    uid: employeeUid(e),
    id: e.id || null,
    employee_id: e.employee_id || e.employee_code || null,
    email: e.email || null,
    full_name: e.full_name || e.name || 'Unknown',
    role: e.role || 'employee',
    department: e.department || 'Unassigned',
    designation: e.designation || 'Unspecified',
    organization_id: e.organization_id || null,
    organization_name: e.organization_name || null,
    manager_email: e.manager_email || null,
    manager_name: e.manager_name || null,
    gender: normalizeGender(e.gender),
    status,
    join: toDay(e.joining_date) || toDay(e.created_at),
    exit,
    // Marked exited but with no exit date: can't be placed on a timeline
    exitedUnknown: status === 'exited' && !exit,
    dob: toDay(e.date_of_birth),
    monthly_salary: e.monthly_salary != null && e.monthly_salary !== '' ? num(e.monthly_salary) : null,
    leave_balance: e.leave_balance && typeof e.leave_balance === 'object' ? e.leave_balance : {},
    raw: e
  };
};

/** In headcount after the end of `day` (joined on/before it, not exited on/before it). */
const inHeadcountAfter = (e, day) =>
  !e.exitedUnknown && (!e.join || e.join <= day) && (!e.exit || e.exit > day);

/** On the payroll / attendance roster on `day` (the exit date is the last working day). */
const employedOn = (e, day) =>
  !e.exitedUnknown && (!e.join || e.join <= day) && (!e.exit || e.exit >= day);

/** Employed at any point in [from, to]. */
const employedDuring = (e, from, to) =>
  !e.exitedUnknown && (!e.join || e.join <= to) && (!e.exit || e.exit >= from);

/**
 * Employees a manager is responsible for: direct reports (manager_email) and
 * their department, excluding themselves — same rule as routes/timeTracking.js.
 */
const teamQuery = (manager) => ({
  email: { $ne: manager.email },
  $or: [
    { manager_email: manager.email },
    ...(manager.department ? [{ department: manager.department }] : [])
  ]
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Employees the user may see analytics for, optionally narrowed by
 * department / organization. Admin: everyone. Manager: their team. Others: 403.
 */
const loadScopedEmployees = async (db, user, { department, organization_id } = {}) => {
  let query = {};
  let scope = 'all';
  if (user.role === 'manager') {
    scope = 'team';
    const me = await db.collection('employees').findOne({ email: user.email }, { projection: { email: 1, department: 1 } });
    if (!me) return { employees: [], scope };
    query = teamQuery(me);
  } else if (user.role !== 'admin') {
    throw new HttpError(403, 'Not enough permissions');
  }
  const and = [query];
  if (department) and.push({ department });
  if (organization_id) and.push({ organization_id });
  const docs = await db.collection('employees')
    .find(and.length > 1 ? { $and: and } : query, { projection: EMPLOYEE_PROJECTION })
    .toArray();
  return { employees: docs.map(normEmployee), scope };
};

const loadAllEmployees = async (db) =>
  (await db.collection('employees').find({}, { projection: EMPLOYEE_PROJECTION }).toArray()).map(normEmployee);

/** Count items by key -> [{ key, count, pct }] sorted by count desc, then key. */
const splitBy = (items, keyFn, order) => {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    map.set(k, (map.get(k) || 0) + 1);
  }
  const total = items.length;
  let rows = [...map.entries()].map(([key, count]) => ({ key, count, pct: total ? round(count / total * 100, 1) : 0 }));
  if (order) {
    rows = order.map(key => ({ key, count: map.get(key) || 0, pct: total ? round((map.get(key) || 0) / total * 100, 1) : 0 }));
  } else {
    rows.sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  }
  return rows;
};

// ============= CSV =============

const csvCell = (value) => {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Guard against spreadsheet formula injection from user-entered text
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** columns: [{ key, label }] */
const toCsv = (rows, columns) => {
  const header = columns.map(c => csvCell(c.label ?? c.key)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return '﻿' + [header, ...body].join('\r\n');
};

const sendCsv = (res, filename, rows, columns) => {
  const safeName = String(filename).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'export';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
  res.send(toCsv(rows, columns));
};

module.exports = {
  DAY_RE,
  MONTH_RE,
  isValidDay,
  round,
  num,
  toDay,
  todayStr,
  currentMonth,
  addDays,
  addMonths,
  weekdayOf,
  monthStart,
  monthEnd,
  monthRange,
  dayRange,
  monthsBetween,
  fullMonthsBetween,
  ageOn,
  titleCase,
  normalizeGender,
  normEmployee,
  inHeadcountAfter,
  employedOn,
  employedDuring,
  teamQuery,
  HttpError,
  loadScopedEmployees,
  loadAllEmployees,
  splitBy,
  EMPLOYEE_PROJECTION,
  csvCell,
  toCsv,
  sendCsv
};
