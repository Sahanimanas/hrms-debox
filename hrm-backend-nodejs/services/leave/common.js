/**
 * Shared helpers for the leave module (policy lookup, dates, weekly offs,
 * holidays, team scoping). Used by routes/leaves.js, routes/modules/leave.js,
 * cron/monthlyLeaveCredit.js and the other services in this folder.
 */

const { defaultLeavePolicy } = require('../../models/schemas');
const { normalizeLeaveType, localParts } = require('../../utils/helpers');

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * Calendar date ('YYYY-MM-DD') of a leave date. Leave dates are stored as ISO
 * strings; the UI sends dates as UTC midnight, other clients may send a local
 * midnight in the company timezone — both map to the intended calendar day.
 */
function dateKey(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && KEY_RE.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  const iso = d.toISOString();
  if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  return localParts(d).date;
}

const keyToDate = (key) => new Date(`${key}T00:00:00.000Z`);
const addDaysKey = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOfKey = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
const daysBetweenKeys = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
const todayKey = () => localParts(new Date()).date;

/** Sorted, de-duplicated calendar keys for a list of leave dates. */
const toKeys = (dates) => [...new Set((dates || []).map(dateKey).filter(Boolean))].sort();

// ============= POLICY =============

/** The stored leave policy, or the built-in default when none is saved. */
async function getPolicyDoc(db) {
  const stored = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
  if (stored && Array.isArray(stored.policies)) return stored;
  return { ...defaultLeavePolicy, is_default: true };
}

function findPolicyItem(policyDoc, leaveType) {
  if (!leaveType) return null;
  const wanted = normalizeLeaveType(String(leaveType));
  return (policyDoc?.policies || []).find(p => normalizeLeaveType(p.leave_type || '') === wanted) || null;
}

async function getPolicyItem(db, leaveType) {
  const doc = await getPolicyDoc(db);
  return findPolicyItem(doc, leaveType);
}

/** Event leave granted per occurrence (maternity, bereavement …): no running balance. */
const isOccurrenceType = (p) => !!p && p.credit_type === 'event' && (p.event_scope || 'occurrence') === 'occurrence';

/** Whether approving this leave type moves the employee's leave_balance. */
const tracksBalance = (p) => !(p?.is_unlimited) && !isOccurrenceType(p);

/** Types whose balance is re-credited every January (and therefore closes at year end). */
const resetsYearly = (p) => !!p && !p.is_unlimited && !isOccurrenceType(p);

/**
 * Balance available for a leave type. Keys that were never initialised for an
 * annual / per-year event type (e.g. a type added to the policy after the
 * employee joined) fall back to the full quota.
 */
function effectiveBalance(employee, policyItem, key) {
  const balance = employee?.leave_balance || {};
  if (key in balance && balance[key] != null) return Number(balance[key]) || 0;
  if (policyItem && (policyItem.credit_type === 'annually' || policyItem.credit_type === 'event')) {
    return Number(policyItem.annual_quota) || 0;
  }
  return 0;
}

/** Initialise a missing balance key (see effectiveBalance) so later $inc updates start from the quota. */
async function ensureBalanceKey(db, employee, policyItem, key) {
  if (!employee?.email) return;
  const balance = employee.leave_balance || {};
  if (key in balance && balance[key] != null) return;
  const value = effectiveBalance(employee, policyItem, key);
  await db.collection('employees').updateOne(
    { email: employee.email, [`leave_balance.${key}`]: { $exists: false } },
    { $set: { [`leave_balance.${key}`]: value } }
  );
  employee.leave_balance = { ...balance, [key]: value };
}

// Leave types not in the default policy that the module knows how to run (LV-2)
const STANDARD_EXTRA_TYPES = [
  {
    leave_type: 'Maternity Leave',
    annual_quota: 182,
    credit_type: 'event',
    event_scope: 'occurrence',
    max_occurrences_per_year: 1,
    gender_restriction: 'female',
    monthly_credit: 0,
    advance_days_required: 0,
    encashment_allowed: false,
    carry_forward_allowed: false,
    max_carry_forward_days: 0,
    clubbing_allowed_with: [],
    clubbing_not_allowed_with: [],
    is_unlimited: false,
    sandwich_rule: true,
    restricted_holiday_only: false,
    description: '182 days (26 weeks) per occurrence'
  },
  {
    leave_type: 'Paternity Leave',
    annual_quota: 15,
    credit_type: 'event',
    event_scope: 'occurrence',
    max_occurrences_per_year: null,
    gender_restriction: null,
    monthly_credit: 0,
    advance_days_required: 0,
    encashment_allowed: false,
    carry_forward_allowed: false,
    max_carry_forward_days: 0,
    clubbing_allowed_with: [],
    clubbing_not_allowed_with: [],
    is_unlimited: false,
    sandwich_rule: false,
    restricted_holiday_only: false,
    description: 'Up to 15 days per occurrence'
  },
  {
    leave_type: 'Bereavement Leave',
    annual_quota: 5,
    credit_type: 'event',
    event_scope: 'occurrence',
    max_occurrences_per_year: null,
    gender_restriction: null,
    monthly_credit: 0,
    advance_days_required: 0,
    encashment_allowed: false,
    carry_forward_allowed: false,
    max_carry_forward_days: 0,
    clubbing_allowed_with: [],
    clubbing_not_allowed_with: [],
    is_unlimited: false,
    sandwich_rule: false,
    restricted_holiday_only: false,
    description: 'Up to 5 days per occurrence'
  },
  {
    leave_type: 'Restricted Holiday',
    annual_quota: 2,
    credit_type: 'annually',
    monthly_credit: 0,
    advance_days_required: 0,
    encashment_allowed: false,
    carry_forward_allowed: false,
    max_carry_forward_days: 0,
    clubbing_allowed_with: [],
    clubbing_not_allowed_with: [],
    is_unlimited: false,
    sandwich_rule: false,
    restricted_holiday_only: true,
    description: 'Optional / restricted holidays from the holiday calendar'
  }
];

// Category shown to colleagues on the team calendar instead of the exact type (LV-5)
const CATEGORY_BY_KEY = {
  casual_leave: 'Time off',
  earned_leave: 'Time off',
  paid_leave: 'Time off',
  comp_off: 'Time off',
  privilege_leave: 'Time off',
  sick_leave: 'Sick',
  maternity_leave: 'Family',
  paternity_leave: 'Family',
  bereavement_leave: 'Family',
  restricted_holiday: 'Optional holiday',
  optional_holiday: 'Optional holiday',
  unpaid_leave: 'Unpaid'
};
const leaveCategory = (leaveType) => CATEGORY_BY_KEY[normalizeLeaveType(String(leaveType || ''))] || 'Other';

// ============= PEOPLE =============

/** Same team rule as routes/timeTracking.js: direct reports + same department (excluding self). */
const teamQuery = (manager) => ({
  email: { $ne: manager.email },
  $or: [
    { manager_email: manager.email },
    ...(manager.department ? [{ department: manager.department }] : [])
  ]
});

const findEmployeeByEmail = (db, email) =>
  db.collection('employees').findOne({ email }, { projection: { _id: 0, hashed_password: 0 } });

/** The approver who stands in for "the employee's manager". */
async function resolveManager(db, employee) {
  if (!employee) return null;
  if (employee.manager_email && employee.manager_email !== employee.email) {
    const m = await findEmployeeByEmail(db, employee.manager_email);
    if (m) return m;
    return { email: employee.manager_email, full_name: employee.manager_name || employee.manager_email };
  }
  if (!employee.department) return null;
  return db.collection('employees').findOne(
    { department: employee.department, role: 'manager', email: { $ne: employee.email } },
    { projection: { _id: 0, hashed_password: 0 } }
  );
}

/** All admin accounts (users collection; admins may have no employee record). */
async function listAdmins(db) {
  const users = await db.collection('users')
    .find({ role: 'admin' }, { projection: { _id: 0, id: 1, email: 1, full_name: 1, name: 1, is_active: 1 } })
    .toArray();
  return users.filter(u => u.is_active !== false).map(u => ({ id: u.id, email: u.email, full_name: u.full_name || u.name || u.email }));
}

// ============= WORK CALENDAR =============

const FALLBACK_WEEKLY_OFFS = [0];

/** Weekly offs from the employee's shift (assigned → default shift → Sunday). */
async function getWeeklyOffs(db, employee) {
  let shift = null;
  if (employee?.shift_id) shift = await db.collection('shifts').findOne({ id: employee.shift_id });
  if (!shift) shift = await db.collection('shifts').findOne({ is_default: true });
  const offs = shift?.weekly_offs;
  return Array.isArray(offs) ? offs : FALLBACK_WEEKLY_OFFS;
}

const holidayKey = (h) => {
  if (typeof h.date === 'string' && KEY_RE.test(h.date.slice(0, 10))) return h.date.slice(0, 10);
  const d = new Date(h.date);
  return isNaN(d) ? null : dateKey(d);
};

/** Holidays between two keys (inclusive) as { key: { name, type } }. */
async function getHolidayMap(db, fromKey, toKey) {
  const from = `${fromKey}`;
  const to = `${toKey}T23:59:59.999Z`;
  const rows = await db.collection('holidays').find({
    $or: [
      { date: { $gte: from, $lte: to } },
      // Date-typed values (older data): widen by a day each side, filtered by calendar key below
      { date: { $gte: new Date(keyToDate(fromKey).getTime() - DAY_MS), $lte: new Date(Date.parse(`${toKey}T23:59:59.999Z`) + DAY_MS) } }
    ]
  }, { projection: { _id: 0 } }).toArray();
  const map = {};
  for (const h of rows) {
    const k = holidayKey(h);
    if (k && k >= fromKey && k <= toKey) map[k] = { name: h.name, type: h.type || 'public' };
  }
  return map;
}

/** Public holidays close the office; optional / restricted ones don't. */
const isPublicHoliday = (h) => !!h && !['optional', 'restricted'].includes(h.type);

module.exports = {
  KEY_RE,
  round1,
  round2,
  dateKey,
  keyToDate,
  addDaysKey,
  weekdayOfKey,
  daysBetweenKeys,
  todayKey,
  toKeys,
  getPolicyDoc,
  findPolicyItem,
  getPolicyItem,
  isOccurrenceType,
  tracksBalance,
  resetsYearly,
  effectiveBalance,
  ensureBalanceKey,
  STANDARD_EXTRA_TYPES,
  leaveCategory,
  teamQuery,
  findEmployeeByEmail,
  resolveManager,
  listAdmins,
  getWeeklyOffs,
  getHolidayMap,
  isPublicHoliday
};
