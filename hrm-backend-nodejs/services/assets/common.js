/**
 * Shared helpers for the assets & expenses module.
 */

const { createNotification } = require('../notificationService');
const { localParts } = require('../../utils/helpers');

const stripId = (doc) => {
  if (doc) delete doc._id;
  return doc;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findMyEmployee = (db, email) =>
  db.collection('employees').findOne({ email }, { projection: { _id: 0, hashed_password: 0, password: 0 } });

/** Find an employee by employee code, uuid or email. */
const findEmployeeByRef = (db, ref) => {
  if (!ref) return null;
  const value = String(ref).trim();
  return db.collection('employees').findOne(
    { $or: [{ employee_id: value }, { employee_code: value }, { id: value }, { email: value.toLowerCase() }, { email: value }] },
    { projection: { _id: 0, hashed_password: 0, password: 0 } }
  );
};

/**
 * Employees a manager is responsible for: direct reports (manager_email) and
 * their department — same rule as teamQuery in routes/timeTracking.js.
 */
const teamQuery = (manager) => ({
  email: { $ne: manager.email },
  $or: [
    { manager_email: manager.email },
    ...(manager.department ? [{ department: manager.department }] : [])
  ]
});

/** Is `user` (req.user) allowed to act on `employeeEmail` as admin or their manager? */
const canActOnEmployee = async (db, user, employeeEmail) => {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager' || user.email === employeeEmail) return false;
  const manager = await findMyEmployee(db, user.email);
  if (!manager) return false;
  // $and so teamQuery's own `email` condition doesn't replace the target email
  const match = await db.collection('employees').findOne({ $and: [{ email: employeeEmail }, teamQuery(manager)] });
  return !!match;
};

/** The manager who approves for an employee: manager_email, else a manager in their department. */
const findApprovingManager = async (db, employee) => {
  if (!employee) return null;
  if (employee.manager_email) {
    const m = await db.collection('employees').findOne({ email: employee.manager_email }, { projection: { _id: 0, email: 1, id: 1, full_name: 1, role: 1 } });
    if (m && m.email !== employee.email) return m;
  }
  if (employee.department) {
    const m = await db.collection('employees').findOne(
      { department: employee.department, role: 'manager', email: { $ne: employee.email } },
      { projection: { _id: 0, email: 1, id: 1, full_name: 1, role: 1 } }
    );
    if (m) return m;
  }
  return null;
};

/** Admin accounts (from users, plus admin employee records), keyed by email. */
const adminRecipients = async (db) => {
  const map = new Map();
  const users = await db.collection('users').find({ role: 'admin' }, { projection: { _id: 0, id: 1, email: 1 } }).toArray();
  users.forEach(u => u.email && map.set(u.email, { id: u.id, email: u.email }));
  const emps = await db.collection('employees').find({ role: 'admin' }, { projection: { _id: 0, id: 1, email: 1 } }).toArray();
  emps.forEach(e => e.email && !map.has(e.email) && map.set(e.email, { id: e.id, email: e.email }));
  return [...map.values()];
};

/** Fire-and-forget notification(s); never throws. */
const notify = (recipients, payload) => {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  Promise.resolve().then(async () => {
    for (const r of list) {
      if (!r?.email) continue;
      await createNotification({ userId: r.id, userEmail: r.email, ...payload });
    }
  }).catch(err => console.error('[assets] notification failed:', err.message));
};

const notifyAdmins = (db, payload, exceptEmail) => {
  adminRecipients(db)
    .then(admins => notify(admins.filter(a => a.email !== exceptEmail), payload))
    .catch(err => console.error('[assets] admin lookup failed:', err.message));
};

/** 'YYYY-MM-DD' (company timezone) for a Date. */
const todayStr = () => localParts(new Date()).date;

/** Parse 'YYYY-MM-DD' (or ISO) into a Date at UTC midnight; null when empty/invalid. */
const toDateOnly = (value) => {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value) ? null : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const dateKey = (value) => {
  const d = toDateOnly(value);
  return d ? d.toISOString().slice(0, 10) : null;
};

/** Inclusive number of days between two YYYY-MM-DD strings. */
const daysInclusive = (start, end) => {
  const a = toDateOnly(start);
  const b = toDateOnly(end);
  if (!a || !b || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
};

const actorOf = (req) => ({ email: req.user.email, name: req.user.full_name || req.user.email });

module.exports = {
  stripId,
  round2,
  escapeRegex,
  findMyEmployee,
  findEmployeeByRef,
  teamQuery,
  canActOnEmployee,
  findApprovingManager,
  adminRecipients,
  notify,
  notifyAdmins,
  todayStr,
  toDateOnly,
  dateKey,
  daysInclusive,
  actorOf
};
