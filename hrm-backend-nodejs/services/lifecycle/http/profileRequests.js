/**
 * EL-8 Profile change requests — employees request changes to personal
 * fields; an admin approves (applied to the employees document) or rejects.
 */

const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const {
  generateUUID, serverError, findEmployeeByUid, findMyEmployee, relationTo, toDateStr, dateFromStr, todayStr,
  notifyMany, notifyAdmins, uidOf
} = require('../common');

const GENDERS = ['male', 'female', 'non_binary', 'other', 'prefer_not_to_say'];
const MARITAL = ['single', 'married', 'divorced', 'widowed', 'separated', 'other'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const PHONE = Joi.string().trim().pattern(/^\+?[0-9][0-9\s-]{6,18}$/).messages({ 'string.pattern.base': '{{#label}} must be a valid phone number' });

const FIELDS = [
  { key: 'phone', label: 'Phone', type: 'phone', schema: PHONE },
  { key: 'personal_email', label: 'Personal email', type: 'email', schema: Joi.string().trim().lowercase().email() },
  { key: 'address', label: 'Address', type: 'textarea', schema: Joi.string().trim().min(5).max(500) },
  { key: 'emergency_contact_name', label: 'Emergency contact name', type: 'text', schema: Joi.string().trim().min(2).max(100) },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', type: 'phone', schema: PHONE },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date', schema: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' }) },
  { key: 'gender', label: 'Gender', type: 'select', options: GENDERS, schema: Joi.string().valid(...GENDERS) },
  { key: 'marital_status', label: 'Marital status', type: 'select', options: MARITAL, schema: Joi.string().valid(...MARITAL) },
  { key: 'blood_group', label: 'Blood group', type: 'select', options: BLOOD, schema: Joi.string().valid(...BLOOD) }
];
const FIELD_MAP = Object.fromEntries(FIELDS.map(f => [f.key, f]));

const changesSchema = Joi.object(Object.fromEntries(FIELDS.map(f => [f.key, f.schema]))).min(1);

const requestSchema = Joi.object({
  changes: changesSchema.required(),
  reason: Joi.string().trim().max(500).allow('', null)
});

const directSchema = changesSchema;

const rejectSchema = Joi.object({ reason: Joi.string().trim().min(3).max(500).required() });

/** Extra checks Joi can't express simply. Returns an error message or null. */
const checkValues = (changes) => {
  if (changes.date_of_birth) {
    const dob = changes.date_of_birth;
    if (isNaN(Date.parse(dob))) return 'Date of birth is not a valid date';
    const today = todayStr();
    const [ty] = today.split('-').map(Number);
    if (dob >= today) return 'Date of birth must be in the past';
    if (Number(dob.slice(0, 4)) > ty - 14) return 'Employee must be at least 14 years old';
    if (Number(dob.slice(0, 4)) < ty - 100) return 'Date of birth is too far in the past';
  }
  return null;
};

const currentValue = (employee, key) => (key === 'date_of_birth' ? toDateStr(employee.date_of_birth) : (employee[key] ?? null));

const toDbValue = (key, value) => (key === 'date_of_birth' ? dateFromStr(value) : value);

/** Personal details of an employee in API shape. */
const personalOf = (employee) => Object.fromEntries(FIELDS.map(f => [f.key, currentValue(employee, f.key)]));

const applyChanges = async (db, employee, changes) => {
  const set = {};
  for (const [k, v] of Object.entries(changes)) set[k] = toDbValue(k, v);
  set.personal_updated_at = new Date();
  await db.collection('employees').updateOne({ email: employee.email }, { $set: set });
  if ('phone' in changes) {
    await db.collection('users').updateOne({ email: employee.email }, { $set: { phone: changes.phone } });
  }
};

module.exports = (router) => {
  router.get('/profile-requests/fields', (req, res) =>
    res.json(FIELDS.map(({ key, label, type, options }) => ({ key, label, type, ...(options ? { options } : {}) }))));

  /** GET /personal/my — my personal details. */
  router.get('/personal/my', async (req, res) => {
    try {
      const me = await findMyEmployee(getDB(), req.user.email);
      if (!me) return res.status(404).json({ detail: 'Employee profile not found' });
      res.json(personalOf(me));
    } catch (error) {
      serverError(res, 'my personal', error);
    }
  });

  /** GET /personal/:uid — personal details (self, manager of, admin). */
  router.get('/personal/:uid', async (req, res) => {
    try {
      const db = getDB();
      const employee = await findEmployeeByUid(db, req.params.uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      if (!(await relationTo(db, req.user, employee))) return res.status(403).json({ detail: 'Not enough permissions' });
      res.json(personalOf(employee));
    } catch (error) {
      serverError(res, 'personal', error);
    }
  });

  /** PUT /personal/:uid — admin edits personal details directly. */
  router.put('/personal/:uid', requireRole(['admin']), validate(directSchema), async (req, res) => {
    try {
      const db = getDB();
      const employee = await findEmployeeByUid(db, req.params.uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      const problem = checkValues(req.validatedBody);
      if (problem) return res.status(422).json({ detail: problem });
      await applyChanges(db, employee, req.validatedBody);
      const updated = await db.collection('employees').findOne({ email: employee.email });
      res.json(personalOf(updated));
    } catch (error) {
      serverError(res, 'update personal', error);
    }
  });

  router.get('/profile-requests/my', async (req, res) => {
    try {
      const list = await getDB().collection('profile_change_requests')
        .find({ employee_email: req.user.email }, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
      res.json(list);
    } catch (error) {
      serverError(res, 'my profile requests', error);
    }
  });

  router.post('/profile-requests', validate(requestSchema), async (req, res) => {
    try {
      const db = getDB();
      const employee = await findMyEmployee(db, req.user.email);
      if (!employee) return res.status(404).json({ detail: 'Employee profile not found' });
      const pending = await db.collection('profile_change_requests').findOne({ employee_email: employee.email, status: 'pending' });
      if (pending) return res.status(409).json({ detail: 'You already have a pending change request. Cancel it or wait for a decision.' });

      const { changes, reason } = req.validatedBody;
      const problem = checkValues(changes);
      if (problem) return res.status(422).json({ detail: problem });

      const diff = [];
      for (const [key, to] of Object.entries(changes)) {
        const from = currentValue(employee, key);
        if (String(from ?? '') === String(to ?? '')) continue;
        diff.push({ field: key, label: FIELD_MAP[key].label, from, to });
      }
      if (!diff.length) return res.status(400).json({ detail: 'Nothing to change — the new values match your current details' });

      const now = new Date();
      const doc = {
        id: generateUUID(),
        employee_uid: uidOf(employee),
        employee_email: employee.email,
        employee_name: employee.full_name,
        department: employee.department || null,
        changes: diff,
        reason: reason || null,
        status: 'pending',
        created_at: now,
        updated_at: now
      };
      await db.collection('profile_change_requests').insertOne(doc);
      delete doc._id;
      notifyAdmins(db, {
        type: 'profile_change_requested',
        title: 'Profile change request',
        message: `${employee.full_name} requested changes to: ${diff.map(d => d.label).join(', ')}.`,
        actionUrl: '/profile-requests',
        metadata: { request_id: doc.id }
      }, employee.email);
      res.status(201).json(doc);
    } catch (error) {
      serverError(res, 'create profile request', error);
    }
  });

  router.delete('/profile-requests/:id', async (req, res) => {
    try {
      const db = getDB();
      const doc = await db.collection('profile_change_requests').findOne({ id: req.params.id });
      if (!doc) return res.status(404).json({ detail: 'Request not found' });
      if (doc.employee_email !== req.user.email) return res.status(403).json({ detail: 'You can only cancel your own requests' });
      if (doc.status !== 'pending') return res.status(400).json({ detail: 'Only pending requests can be cancelled' });
      await db.collection('profile_change_requests').updateOne({ id: doc.id }, { $set: { status: 'cancelled', updated_at: new Date() } });
      res.json({ message: 'Request cancelled' });
    } catch (error) {
      serverError(res, 'cancel profile request', error);
    }
  });

  router.get('/profile-requests/pending-count', requireRole(['admin']), async (req, res) => {
    try {
      res.json({ count: await getDB().collection('profile_change_requests').countDocuments({ status: 'pending' }) });
    } catch (error) {
      serverError(res, 'pending count', error);
    }
  });

  router.get('/profile-requests', requireRole(['admin']), async (req, res) => {
    try {
      const query = {};
      if (req.query.status) query.status = String(req.query.status);
      const list = await getDB().collection('profile_change_requests')
        .find(query, { projection: { _id: 0 } }).sort({ status: -1, created_at: -1 }).limit(1000).toArray();
      // pending first
      list.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
      res.json(list);
    } catch (error) {
      serverError(res, 'list profile requests', error);
    }
  });

  router.post('/profile-requests/:id/approve', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      const doc = await db.collection('profile_change_requests').findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!doc) return res.status(404).json({ detail: 'Request not found' });
      if (doc.status !== 'pending') return res.status(400).json({ detail: `Request is already ${doc.status}` });
      if (doc.employee_email === req.user.email) return res.status(400).json({ detail: 'You cannot approve your own request' });
      const employee = await db.collection('employees').findOne({ email: doc.employee_email });
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      await applyChanges(db, employee, Object.fromEntries(doc.changes.map(c => [c.field, c.to])));
      const update = { status: 'approved', reviewed_by: req.user.email, reviewed_by_name: req.user.full_name, reviewed_at: new Date(), updated_at: new Date() };
      await db.collection('profile_change_requests').updateOne({ id: doc.id }, { $set: update });
      notifyMany(db, [doc.employee_email], {
        type: 'profile_change_approved',
        title: 'Profile change approved',
        message: `Your requested changes (${doc.changes.map(c => c.label).join(', ')}) were applied.`,
        actionUrl: '/profile',
        metadata: { request_id: doc.id }
      });
      res.json({ ...doc, ...update });
    } catch (error) {
      serverError(res, 'approve profile request', error);
    }
  });

  router.post('/profile-requests/:id/reject', requireRole(['admin']), validate(rejectSchema), async (req, res) => {
    try {
      const db = getDB();
      const doc = await db.collection('profile_change_requests').findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!doc) return res.status(404).json({ detail: 'Request not found' });
      if (doc.status !== 'pending') return res.status(400).json({ detail: `Request is already ${doc.status}` });
      const update = {
        status: 'rejected',
        rejection_reason: req.validatedBody.reason,
        reviewed_by: req.user.email,
        reviewed_by_name: req.user.full_name,
        reviewed_at: new Date(),
        updated_at: new Date()
      };
      await db.collection('profile_change_requests').updateOne({ id: doc.id }, { $set: update });
      notifyMany(db, [doc.employee_email], {
        type: 'profile_change_rejected',
        title: 'Profile change rejected',
        message: `Your profile change request was rejected: ${req.validatedBody.reason}`,
        actionUrl: '/profile',
        metadata: { request_id: doc.id }
      });
      res.json({ ...doc, ...update });
    } catch (error) {
      serverError(res, 'reject profile request', error);
    }
  });
};
