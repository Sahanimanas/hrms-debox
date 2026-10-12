/**
 * Shared helpers for the lifecycle module (Phase 3).
 */

const { generateUUID, employeeUid, localParts } = require('../../utils/helpers');
const { createNotification } = require('../notificationService');

const SETTINGS_KEY = 'default';

const DEFAULT_SETTINGS = {
  notice_period_days: 30,
  probation_months: 6,
  company_name: 'Xeno-HR',
  company_address: '',
  hr_email: null,       // owner for 'hr' onboarding tasks (falls back to an admin)
  it_email: null,       // owner for 'it' onboarding tasks (falls back to an admin)
  basic_percent_of_gross: 50, // used when an employee has no salary structure
  earned_leave_key: 'earned_leave'
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const stripId = (doc) => {
  if (doc) delete doc._id;
  return doc;
};

const nowDate = () => new Date();

/** Today's date in the company timezone, 'YYYY-MM-DD'. */
const todayStr = () => localParts(new Date()).date;

/** 'YYYY-MM-DD' for a Date/string in the company timezone (null-safe). */
const toDateStr = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return localParts(d).date;
};

/** Add days to a 'YYYY-MM-DD' string. */
const addDaysStr = (dateStr, n) =>
  new Date(Date.parse(`${dateStr}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Add months to a 'YYYY-MM-DD' string (clamps to month end). */
const addMonthsStr = (dateStr, months) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
};

/** Whole days from a to b ('YYYY-MM-DD'), b - a. */
const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Date stored at noon UTC for a 'YYYY-MM-DD' (stays on the same calendar day in IST and UTC). */
const dateFromStr = (dateStr) => (dateStr ? new Date(`${dateStr}T12:00:00Z`) : null);

const uidOf = (employee) => (employee ? employeeUid(employee) : null);

/** Find an employee by any of its identifiers (employee_id code, legacy employee_code, uuid id). */
const findEmployeeByUid = (db, uid) => {
  if (!uid || typeof uid !== 'string') return null;
  return db.collection('employees').findOne({ $or: [{ employee_id: uid }, { employee_code: uid }, { id: uid }] });
};

const findMyEmployee = (db, email) => db.collection('employees').findOne({ email });

/** Team rule shared with time tracking: direct reports + same department (excluding the manager). */
const teamQuery = (manager) => ({
  email: { $ne: manager.email },
  $or: [
    { manager_email: manager.email },
    ...(manager.department ? [{ department: manager.department }] : [])
  ]
});

const isInTeam = (manager, employee) =>
  !!manager && !!employee && employee.email !== manager.email &&
  (employee.manager_email === manager.email || (!!manager.department && employee.department === manager.department));

/**
 * How the current user relates to an employee: 'admin' | 'self' | 'manager' | null.
 * Admin wins over self so admins keep full rights on their own record.
 */
const relationTo = async (db, user, employee) => {
  if (!employee) return null;
  if (user.role === 'admin') return 'admin';
  if (employee.email === user.email) return 'self';
  if (user.role === 'manager') {
    const me = await findMyEmployee(db, user.email);
    if (isInTeam(me, employee)) return 'manager';
  }
  return null;
};

/** Emails of employees in a manager's team. */
const teamEmails = async (db, managerEmail) => {
  const me = await findMyEmployee(db, managerEmail);
  if (!me) return [];
  const team = await db.collection('employees').find(teamQuery(me), { projection: { email: 1 } }).toArray();
  return team.map(t => t.email);
};

const getSettings = async (db) => {
  const doc = await db.collection('lifecycle_settings').findOne({ key: SETTINGS_KEY }, { projection: { _id: 0 } });
  const core = await db.collection('settings').findOne({}, { projection: { _id: 0, notice_period_days: 1, probation_months: 1, company_name: 1 } });
  const merged = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (core && core[k] != null) merged[k] = core[k];
  }
  if (doc) {
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (doc[k] !== undefined) merged[k] = doc[k];
    }
    merged.letters_seeded = !!doc.letters_seeded;
  }
  return merged;
};

const admins = (db) =>
  db.collection('employees').find({ role: 'admin', employment_status: { $ne: 'exited' } }, { projection: { _id: 0, id: 1, email: 1, full_name: 1 } }).toArray();

/** Fire-and-forget in-app notification to an employee (by email). */
const notify = async (db, email, { type, title, message, actionUrl, metadata }) => {
  if (!email) return;
  try {
    const emp = await db.collection('employees').findOne({ email }, { projection: { id: 1, email: 1 } });
    const user = emp ? null : await db.collection('users').findOne({ email }, { projection: { id: 1 } });
    await createNotification({
      userId: emp?.id || user?.id || null,
      userEmail: email,
      type,
      title,
      message,
      actionUrl: actionUrl || null,
      metadata: metadata || {}
    });
  } catch (error) {
    console.error('[lifecycle] notify failed:', error.message);
  }
};

/** Notify many emails (deduplicated, never blocks the caller). */
const notifyMany = (db, emails, payload) => {
  const unique = [...new Set((emails || []).filter(Boolean))];
  Promise.all(unique.map(e => notify(db, e, payload))).catch(() => {});
};

const notifyAdmins = async (db, payload, exceptEmail) => {
  const list = await admins(db);
  notifyMany(db, list.map(a => a.email).filter(e => e !== exceptEmail), payload);
};

const actorOf = (user) => ({ email: user.email, name: user.full_name || user.email });

const serverError = (res, label, error) => {
  console.error(`[lifecycle] ${label}:`, error);
  res.status(500).json({ detail: 'Internal server error' });
};

/** Public-safe employee summary (no salary, no leave balances). */
const employeeCard = (e) => e && ({
  uid: uidOf(e),
  id: e.id || null,
  employee_id: e.employee_id || e.employee_code || null,
  full_name: e.full_name,
  email: e.email,
  department: e.department || null,
  designation: e.designation || null,
  role: e.role,
  manager_email: e.manager_email || null,
  manager_name: e.manager_name || null,
  joining_date: e.joining_date || null,
  employment_status: e.employment_status || 'active',
  profile_picture_url: e.profile_picture_url || null
});

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  generateUUID,
  round2,
  stripId,
  nowDate,
  todayStr,
  toDateStr,
  addDaysStr,
  addMonthsStr,
  diffDays,
  dateFromStr,
  uidOf,
  findEmployeeByUid,
  findMyEmployee,
  teamQuery,
  isInTeam,
  relationTo,
  teamEmails,
  getSettings,
  admins,
  notify,
  notifyMany,
  notifyAdmins,
  actorOf,
  serverError,
  employeeCard
};
