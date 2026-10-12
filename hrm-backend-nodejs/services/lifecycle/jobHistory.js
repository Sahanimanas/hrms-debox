/**
 * EL-6 Job history: timeline entries per employee.
 *
 * Auto entries are written by the employees API (designation / department /
 * manager / role / salary changes) and by lifecycle actions (joining,
 * confirmation, probation extension, separation, exit). Admins can add manual
 * entries (promotion, transfer, increment, other).
 */

const { generateUUID, uidOf, todayStr, toDateStr } = require('./common');

const TRACKED_FIELDS = {
  designation: 'Designation',
  department: 'Department',
  manager_email: 'Manager',
  role: 'Role',
  monthly_salary: 'Monthly salary'
};

const MANUAL_TYPES = ['promotion', 'transfer', 'increment', 'other'];

const TYPE_LABELS = {
  joined: 'Joined',
  promotion: 'Promotion',
  transfer: 'Transfer',
  increment: 'Increment',
  salary_change: 'Salary change',
  designation_change: 'Designation change',
  department_change: 'Department change',
  manager_change: 'Manager change',
  role_change: 'Role change',
  confirmation: 'Confirmed',
  probation_extension: 'Probation extended',
  separation: 'Separation approved',
  exit: 'Exited',
  other: 'Other'
};

const norm = (v) => (v === undefined || v === '' ? null : v);

const sameValue = (field, a, b) => {
  a = norm(a); b = norm(b);
  if (field === 'monthly_salary') {
    if (a == null && b == null) return true;
    return Number(a) === Number(b);
  }
  return String(a ?? '') === String(b ?? '');
};

/** Tracked-field differences between two employee snapshots. */
const diffTracked = (before, after, nameLookup = {}) => {
  const changes = [];
  for (const [field, label] of Object.entries(TRACKED_FIELDS)) {
    if (!(field in after)) continue;
    if (sameValue(field, before[field], after[field])) continue;
    const change = { field, label, from: norm(before[field]), to: norm(after[field]) };
    if (field === 'manager_email') {
      change.from_display = before.manager_name || nameLookup[change.from] || change.from;
      change.to_display = after.manager_name || nameLookup[change.to] || change.to;
    }
    changes.push(change);
  }
  return changes;
};

/** Pick an entry type and title for a set of changes. */
const classify = (changes) => {
  const by = Object.fromEntries(changes.map(c => [c.field, c]));
  let type = 'other';
  if (by.designation) type = 'designation_change';
  else if (by.department) type = 'transfer';
  else if (by.monthly_salary) type = Number(by.monthly_salary.to) > Number(by.monthly_salary.from || 0) ? 'increment' : 'salary_change';
  else if (by.manager_email) type = 'manager_change';
  else if (by.role) type = 'role_change';
  const title = changes.length === 1
    ? `${changes[0].label} changed`
    : `${changes.map(c => c.label).join(', ')} changed`;
  return { type, title };
};

/**
 * Write a job history entry. Never throws (lifecycle bookkeeping must not
 * break the main request).
 */
const recordJobEvent = async (db, {
  employee,
  type,
  title,
  changes = [],
  effective_date,
  notes = null,
  source = 'auto',
  actor = null,
  meta = null
}) => {
  try {
    const entry = {
      id: generateUUID(),
      employee_uid: uidOf(employee),
      employee_email: employee.email,
      employee_name: employee.full_name,
      type,
      title: title || TYPE_LABELS[type] || 'Update',
      changes,
      effective_date: toDateStr(effective_date) || todayStr(),
      notes: notes || null,
      source,
      meta: meta || null,
      created_by: actor?.email || null,
      created_by_name: actor?.full_name || actor?.name || null,
      created_at: new Date()
    };
    await db.collection('job_history').insertOne(entry);
    delete entry._id;
    return entry;
  } catch (error) {
    console.error('[lifecycle] job history write failed:', error.message);
    return null;
  }
};

/** Record auto entries for an employees-API update. */
const recordProfileChanges = async (db, before, after, actor) => {
  const lookupEmails = [before.manager_email, after.manager_email].filter(Boolean);
  const nameLookup = {};
  if (lookupEmails.length) {
    const people = await db.collection('employees').find({ email: { $in: lookupEmails } }, { projection: { email: 1, full_name: 1 } }).toArray();
    people.forEach(p => { nameLookup[p.email] = p.full_name; });
  }
  const changes = diffTracked(before, after, nameLookup);
  if (!changes.length) return null;
  const { type, title } = classify(changes);
  return recordJobEvent(db, { employee: { ...before, ...after }, type, title, changes, actor, source: 'auto' });
};

module.exports = {
  TRACKED_FIELDS,
  MANUAL_TYPES,
  TYPE_LABELS,
  diffTracked,
  classify,
  recordJobEvent,
  recordProfileChanges
};
