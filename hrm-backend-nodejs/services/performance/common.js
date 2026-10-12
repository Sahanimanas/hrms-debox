/**
 * Shared helpers for the performance module (PF-1 … PF-5).
 *
 * "Manager" of an employee = employees.manager_email when set, otherwise a
 * manager (role 'manager') of the employee's department.
 */

const multer = require('multer');
const { getDB } = require('../../config/database');
const { generateUUID, employeeUid, localParts } = require('../../utils/helpers');
const { createNotification } = require('../notificationService');

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

const fail = (status, detail) => { throw new HttpError(status, detail); };

/** Wrap an async handler: HttpError → its status, anything else → 500. */
const h = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ detail: error.message });
    console.error(`[performance] ${req.method} ${req.originalUrl} error:`, error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

const stripId = (doc) => {
  if (doc && typeof doc === 'object') delete doc._id;
  return doc;
};

const now = () => new Date();
const todayStr = () => localParts(new Date()).date;

/** 'YYYY-MM-DD' + n days */
const addDays = (dateStr, n) =>
  new Date(Date.parse(`${dateStr}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

const round2 = (n) => Math.round(n * 100) / 100;

const isActiveEmployee = (e) => !!e && (e.employment_status || 'active') !== 'exited';

const findEmployee = (db, email) => (email ? db.collection('employees').findOne({ email }) : null);

/** Minimal public view of an employee (never expose anything sensitive). */
const personView = (e) => e ? ({
  email: e.email,
  full_name: e.full_name,
  employee_id: employeeUid(e),
  department: e.department || null,
  designation: e.designation || null,
  role: e.role || 'employee'
}) : null;

/** Middleware: attach the caller's employee record (may be null for admins without one). */
const loadMe = h(async (req, res, next) => {
  req.me = await findEmployee(getDB(), req.user.email);
  next();
});

/** Is `user` (req) the manager of `employee`? Admins always are. */
const isManagerOf = (req, employee) => {
  if (!employee) return false;
  if (req.user.role === 'admin') return true;
  if (employee.email === req.user.email) return false;
  if (employee.manager_email) return employee.manager_email === req.user.email;
  return req.user.role === 'manager' && !!req.me?.department && employee.department === req.me.department;
};

/** Mongo filter for the employees a (non-admin) user manages. */
const teamFilter = (req) => {
  const or = [{ manager_email: req.user.email }];
  if (req.user.role === 'manager' && req.me?.department) {
    or.push({ department: req.me.department, $or: [{ manager_email: null }, { manager_email: '' }, { manager_email: { $exists: false } }] });
  }
  return { email: { $ne: req.user.email }, $or: or };
};

/** Employees the caller manages (admin: everyone except themselves). */
const teamMembers = async (db, req) => {
  const filter = req.user.role === 'admin' ? { email: { $ne: req.user.email } } : teamFilter(req);
  const list = await db.collection('employees').find(filter, { projection: { _id: 0 } }).sort({ full_name: 1 }).toArray();
  return list.filter(isActiveEmployee);
};

const teamEmails = async (db, req) => (await teamMembers(db, req)).map(e => e.email);

/** The person who approves for this employee (first match). */
const resolveManager = async (db, employee) => {
  if (!employee) return null;
  if (employee.manager_email) return findEmployee(db, employee.manager_email);
  if (!employee.department) return null;
  return db.collection('employees').findOne({ department: employee.department, role: 'manager', email: { $ne: employee.email } });
};

/** Scope resolver for list endpoints: { emails: [..] } or null (= everyone, admin only). */
const scopeEmails = async (db, req, scope) => {
  if (scope === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Not enough permissions');
    return null;
  }
  if (scope === 'team') return teamEmails(db, req);
  return [req.user.email];
};

/** Fire-and-forget in-app notification by email. */
const notify = (email, { type, title, message, actionUrl, metadata }) => {
  if (!email) return;
  (async () => {
    const db = getDB();
    const user = await db.collection('users').findOne({ email }, { projection: { id: 1 } });
    const emp = user ? null : await db.collection('employees').findOne({ email }, { projection: { id: 1 } });
    await createNotification({
      userId: user?.id || emp?.id || null,
      userEmail: email,
      type,
      title,
      message,
      actionUrl: actionUrl || null,
      metadata: metadata || {}
    });
  })().catch(err => console.error('[performance] notify failed:', err.message));
};

const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ALLOWED_UPLOAD_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

/** multer single('file') with JSON errors */
const singleFile = (req, res, next) => {
  uploader.single('file')(req, res, (err) => {
    if (err) {
      const detail = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB)' : 'Invalid upload';
      return res.status(400).json({ detail });
    }
    if (!req.file) return res.status(400).json({ detail: 'Attach a file in the "file" field' });
    if (!ALLOWED_UPLOAD_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ detail: 'Only PDF or image files are allowed' });
    }
    next();
  });
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('review_cycles').createIndex({ id: 1 }, { unique: true }),
    db.collection('goals').createIndex({ id: 1 }, { unique: true }),
    db.collection('goals').createIndex({ cycle_id: 1, employee_email: 1 }),
    db.collection('appraisal_configs').createIndex({ cycle_id: 1 }, { unique: true }),
    db.collection('appraisals').createIndex({ id: 1 }, { unique: true }),
    db.collection('appraisals').createIndex({ cycle_id: 1, employee_email: 1 }, { unique: true }),
    db.collection('peer_feedback').createIndex({ appraisal_id: 1 }),
    db.collection('peer_feedback').createIndex({ peer_email: 1 }),
    db.collection('one_on_ones').createIndex({ id: 1 }, { unique: true }),
    db.collection('one_on_ones').createIndex({ manager_email: 1, scheduled_at: 1 }),
    db.collection('one_on_ones').createIndex({ employee_email: 1, scheduled_at: 1 }),
    db.collection('feedback').createIndex({ to_email: 1, created_at: -1 }),
    db.collection('feedback').createIndex({ from_email: 1, created_at: -1 }),
    db.collection('feedback_requests').createIndex({ recipient_email: 1, status: 1 }),
    db.collection('pips').createIndex({ id: 1 }, { unique: true }),
    db.collection('pips').createIndex({ employee_email: 1 }),
    db.collection('courses').createIndex({ id: 1 }, { unique: true }),
    db.collection('course_assignments').createIndex({ employee_email: 1, course_id: 1 }),
    db.collection('course_assignments').createIndex({ due_date: 1, status: 1 }),
    db.collection('certifications').createIndex({ employee_email: 1 }),
    db.collection('skills').createIndex({ id: 1 }, { unique: true }),
    db.collection('employee_skills').createIndex({ employee_email: 1, skill_id: 1 }, { unique: true }),
    db.collection('skill_targets').createIndex({ designation: 1, skill_id: 1 }, { unique: true })
  ]);
  indexesReady = true;
};

module.exports = {
  HttpError,
  fail,
  h,
  stripId,
  now,
  todayStr,
  addDays,
  daysBetween,
  round2,
  generateUUID,
  employeeUid,
  isActiveEmployee,
  findEmployee,
  personView,
  loadMe,
  isManagerOf,
  teamFilter,
  teamMembers,
  teamEmails,
  resolveManager,
  scopeEmails,
  notify,
  singleFile,
  DATE,
  ensureIndexes
};
