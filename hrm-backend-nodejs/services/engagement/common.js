/**
 * Shared helpers for the engagement module (announcements, celebrations,
 * policies, surveys, polls, suggestions, grievances, kudos).
 */

const Joi = require('joi');
const { createNotification } = require('../notificationService');
const { localParts } = require('../../utils/helpers');
const { addDays, daysBetween, calendarParts, isLeapYear, pad } = require('./dates');

const DEFAULT_KUDOS_VALUES = ['Teamwork', 'Ownership', 'Customer First', 'Innovation', 'Integrity'];

// ============= RESPONSES =============

const stripId = (doc) => {
  if (doc && typeof doc === 'object') delete doc._id;
  return doc;
};

const serverError = (res, label, error) => {
  console.error(`[engagement] ${label}:`, error);
  return res.status(500).json({ detail: 'Internal server error' });
};

/** Wrap an async handler so unexpected errors return a 500 with a log line. */
const handle = (label, fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    serverError(res, label, error);
  }
};

/** Validate query params with Joi; failures return 422 like validate(). */
const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(422).json({
      detail: 'Validation failed',
      errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
    });
  }
  req.validatedQuery = value;
  next();
};

// ============= PEOPLE =============

const ACTIVE_EMPLOYEE = { employment_status: { $ne: 'exited' } };

/**
 * Who is calling: auth user + their employee record (admins may have none).
 */
const getViewer = async (db, user) => {
  const employee = await db.collection('employees').findOne({ email: user.email }, { projection: { _id: 0 } });
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: employee?.full_name || user.full_name || user.email,
    employee,
    department: employee?.department || null,
    isAdmin: user.role === 'admin'
  };
};

/** Minimal public view of a colleague (no email / salary / DOB). */
const publicPerson = (e) => e ? ({
  id: e.id,
  full_name: e.full_name,
  department: e.department || null,
  designation: e.designation || null
}) : null;

/**
 * Employees a manager is responsible for (same rule as time tracking):
 * direct reports or anyone in the manager's department.
 */
const teamQuery = (manager) => ({
  email: { $ne: manager.email },
  $or: [
    { manager_email: manager.email },
    ...(manager.department ? [{ department: manager.department }] : [])
  ]
});

// ============= AUDIENCE =============

const audienceObject = Joi.object({
  type: Joi.string().valid('everyone', 'departments').default('everyone'),
  departments: Joi.when('type', {
    is: 'departments',
    then: Joi.array().items(Joi.string().trim().min(1).max(100)).min(1).unique().required(),
    otherwise: Joi.array().items(Joi.string()).max(0).default([])
  })
});

const audienceSchema = audienceObject.default({ type: 'everyone', departments: [] });

const normalizeAudience = (audience) =>
  audience && audience.type === 'departments'
    ? { type: 'departments', departments: [...(audience.departments || [])] }
    : { type: 'everyone', departments: [] };

/** Does an audience include this viewer? Admins see everything when `adminSeesAll`. */
const inAudience = (audience, viewer, { adminSeesAll = false } = {}) => {
  if (adminSeesAll && viewer.isAdmin) return true;
  if (!audience || audience.type !== 'departments') return true;
  return !!viewer.department && audience.departments.includes(viewer.department);
};

/** Mongo filter matching documents whose `audience` includes the viewer. */
const audienceFilter = (viewer, field = 'audience') => ({
  $or: [
    { [field]: null },
    { [`${field}.type`]: 'everyone' },
    ...(viewer.department ? [{ [`${field}.departments`]: viewer.department }] : [])
  ]
});

/**
 * People in an audience: active employees (plus, for "everyone", user
 * accounts without an employee record such as the seeded admin).
 * Returns [{ id, email, full_name, department }].
 */
const audienceMembers = async (db, audience, { includeUsersWithoutEmployee = true } = {}) => {
  const aud = normalizeAudience(audience);
  const query = { ...ACTIVE_EMPLOYEE };
  if (aud.type === 'departments') query.department = { $in: aud.departments };
  const employees = await db.collection('employees')
    .find(query, { projection: { _id: 0, id: 1, email: 1, full_name: 1, department: 1, employee_id: 1 } })
    .toArray();
  const inactive = new Set(
    (await db.collection('users').find({ is_active: false }, { projection: { email: 1 } }).toArray()).map(u => u.email)
  );
  const members = employees.filter(e => e.email && !inactive.has(e.email));

  if (aud.type === 'everyone' && includeUsersWithoutEmployee) {
    const known = new Set(members.map(m => m.email));
    const users = await db.collection('users')
      .find({ is_active: { $ne: false } }, { projection: { _id: 0, id: 1, email: 1, full_name: 1, department: 1 } })
      .toArray();
    for (const u of users) {
      if (u.email && !known.has(u.email)) members.push({ id: u.id, email: u.email, full_name: u.full_name, department: u.department || null });
    }
  }
  return members;
};

const adminRecipients = async (db) => {
  const users = await db.collection('users')
    .find({ role: 'admin', is_active: { $ne: false } }, { projection: { _id: 0, id: 1, email: 1, full_name: 1 } })
    .toArray();
  return users;
};

// ============= NOTIFICATIONS =============

/**
 * Notify many people in the background (never blocks the response, never throws).
 * Returns a promise that resolves to the number of notifications created.
 */
const notifyPeople = (people, { type, title, message, actionUrl = null, metadata = {} }, { exclude = [] } = {}) => {
  const skip = new Set(exclude.filter(Boolean));
  const seen = new Set();
  const targets = people.filter(p => {
    if (!p?.email || skip.has(p.email) || seen.has(p.email)) return false;
    seen.add(p.email);
    return true;
  });
  return (async () => {
    let created = 0;
    for (const p of targets) {
      try {
        const n = await createNotification({ userId: p.id, userEmail: p.email, type, title, message, actionUrl, metadata });
        if (n) created += 1;
      } catch (error) {
        console.error('[engagement] notification failed:', error.message);
      }
    }
    return created;
  })();
};

// ============= DATES =============

const todayLocal = () => localParts(new Date()).date;

/** 'YYYY-MM' month boundaries in the company timezone as Dates. */
const monthRange = (monthStr) => {
  const { zonedTimeToDate } = require('../../utils/helpers');
  const [y, m] = monthStr.split('-').map(Number);
  const start = zonedTimeToDate(`${y}-${pad(m)}-01`, '00:00');
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { start, end: zonedTimeToDate(next, '00:00') };
};

// ============= SETTINGS =============

const SETTINGS_KEY = 'engagement';

const getSettings = async (db) => {
  const doc = await db.collection('engagement_settings').findOne({ key: SETTINGS_KEY }, { projection: { _id: 0 } });
  return {
    celebrations_company_wide: doc?.celebrations_company_wide ?? false,
    kudos_values: doc?.kudos_values?.length ? doc.kudos_values : DEFAULT_KUDOS_VALUES,
    updated_at: doc?.updated_at || null
  };
};

module.exports = {
  DEFAULT_KUDOS_VALUES,
  ACTIVE_EMPLOYEE,
  stripId,
  serverError,
  handle,
  validateQuery,
  getViewer,
  publicPerson,
  teamQuery,
  audienceObject,
  audienceSchema,
  normalizeAudience,
  inAudience,
  audienceFilter,
  audienceMembers,
  adminRecipients,
  notifyPeople,
  todayLocal,
  addDays,
  daysBetween,
  calendarParts,
  isLeapYear,
  pad,
  monthRange,
  getSettings,
  SETTINGS_KEY
};
