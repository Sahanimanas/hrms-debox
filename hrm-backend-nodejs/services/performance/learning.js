/**
 * PF-5 Learning and skills.
 *
 * Collections:
 *  - courses             course catalog
 *  - course_assignments  one per employee per course (assigned or self-enrolled)
 *  - certifications      employee certifications with expiry tracking
 *  - skills              skills catalog
 *  - employee_skills     self rating + manager validation per employee per skill
 *  - skill_targets       target proficiency per designation (for gap analysis)
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { storeFile, removeFile } = require('../fileStorage');
const { emitEvent } = require('../events');
const {
  h, fail, stripId, now, todayStr, addDays, generateUUID, employeeUid, DATE,
  findEmployee, isManagerOf, teamMembers, teamEmails, notify, isActiveEmployee, singleFile
} = require('./common');

const router = express.Router();

const ASSIGNMENT_STATUSES = ['not_started', 'in_progress', 'completed'];

// ============= SCHEMAS =============

const courseFields = {
  title: Joi.string().trim().min(2).max(200),
  description: Joi.string().trim().max(5000).allow('', null),
  provider: Joi.string().trim().max(120).allow('', null),
  link: Joi.string().trim().uri().max(1000).allow('', null),
  duration_hours: Joi.number().min(0).max(1000),
  category: Joi.string().trim().max(80).allow('', null),
  mandatory: Joi.boolean(),
  active: Joi.boolean()
};
const courseCreate = Joi.object({
  ...courseFields,
  title: courseFields.title.required(),
  duration_hours: courseFields.duration_hours.default(0),
  mandatory: courseFields.mandatory.default(false),
  active: courseFields.active.default(true)
});
const courseUpdate = Joi.object(courseFields).min(1);
const assignSchema = Joi.object({
  employee_emails: Joi.array().items(Joi.string().email()).unique().default([]),
  departments: Joi.array().items(Joi.string().trim().min(1)).unique().default([]),
  due_date: Joi.string().pattern(DATE).allow(null, '')
}).custom((v, helpers) => (v.employee_emails.length || v.departments.length ? v : helpers.error('any.custom')), 'target check')
  .messages({ 'any.custom': 'Choose at least one employee or department' });
const progressSchema = Joi.object({
  status: Joi.string().valid(...ASSIGNMENT_STATUSES).required(),
  progress_note: Joi.string().trim().max(2000).allow('', null)
});
const assignmentUpdate = Joi.object({ due_date: Joi.string().pattern(DATE).allow(null, '') });

const certFields = {
  name: Joi.string().trim().min(2).max(200),
  issuer: Joi.string().trim().max(200).allow('', null),
  issued_date: Joi.string().pattern(DATE).allow(null, ''),
  expiry_date: Joi.string().pattern(DATE).allow(null, ''),
  credential_id: Joi.string().trim().max(200).allow('', null),
  credential_url: Joi.string().trim().uri().max(1000).allow('', null)
};
const certCreate = Joi.object({ ...certFields, name: certFields.name.required(), employee_email: Joi.string().email().allow(null, '') });
const certUpdate = Joi.object(certFields).min(1);

const skillSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  category: Joi.string().trim().max(80).allow('', null),
  description: Joi.string().trim().max(1000).allow('', null)
});
const skillUpdate = Joi.object({
  name: Joi.string().trim().min(1).max(120),
  category: Joi.string().trim().max(80).allow('', null),
  description: Joi.string().trim().max(1000).allow('', null)
}).min(1);
const level = Joi.number().integer().min(1).max(5);
const selfRateSchema = Joi.object({
  ratings: Joi.array().items(Joi.object({ skill_id: Joi.string().required(), rating: level.allow(null).required() })).min(1).unique('skill_id').required()
});
const validateSchema = Joi.object({
  ratings: Joi.array().items(Joi.object({ skill_id: Joi.string().required(), rating: level.required(), comment: Joi.string().trim().max(500).allow('', null) })).min(1).unique('skill_id').required()
});
const targetsSchema = Joi.object({
  designation: Joi.string().trim().min(1).max(120).required(),
  targets: Joi.array().items(Joi.object({ skill_id: Joi.string().required(), level: level.allow(null).required() })).unique('skill_id').required()
});

// ============= HELPERS =============

const getCourse = async (db, id) => {
  const c = await db.collection('courses').findOne({ id }, { projection: { _id: 0 } });
  if (!c) fail(404, 'Course not found');
  return c;
};

const withAssignmentFlags = (a, today = todayStr()) => ({
  ...a,
  overdue: a.status !== 'completed' && !!a.due_date && a.due_date < today,
  due_soon: a.status !== 'completed' && !!a.due_date && a.due_date >= today && a.due_date <= addDays(today, 7)
});

const certStatus = (c, today = todayStr()) => {
  if (!c.expiry_date) return 'valid';
  if (c.expiry_date < today) return 'expired';
  if (c.expiry_date <= addDays(today, 30)) return 'expiring';
  return 'valid';
};

const scopeFilter = async (db, req, scope, field = 'employee_email') => {
  if (scope === 'my') return { [field]: req.user.email };
  if (scope === 'team') return { [field]: { $in: await teamEmails(db, req) } };
  if (scope === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Not enough permissions');
    return {};
  }
  fail(400, 'Unknown scope');
};

// ============= COURSES =============

router.get('/courses', h(async (req, res) => {
  const db = getDB();
  const filter = {};
  if (req.user.role !== 'admin' || req.query.include_inactive !== 'true') filter.active = { $ne: false };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.q) filter.title = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const courses = await db.collection('courses').find(filter, { projection: { _id: 0 } }).sort({ mandatory: -1, title: 1 }).toArray();
  const stats = await db.collection('course_assignments').aggregate([
    { $match: { course_id: { $in: courses.map(c => c.id) } } },
    { $group: { _id: '$course_id', assigned: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }
  ]).toArray();
  const mine = await db.collection('course_assignments').find({ employee_email: req.user.email }, { projection: { _id: 0, course_id: 1, id: 1, status: 1 } }).toArray();
  const statMap = Object.fromEntries(stats.map(s => [s._id, s]));
  const mineMap = Object.fromEntries(mine.map(m => [m.course_id, m]));
  res.json(courses.map(c => ({
    ...c,
    ...(req.user.role === 'admin' ? { assigned_count: statMap[c.id]?.assigned || 0, completed_count: statMap[c.id]?.completed || 0 } : {}),
    my_assignment: mineMap[c.id] || null
  })));
}));

router.post('/courses', requireRole(['admin']), validate(courseCreate), h(async (req, res) => {
  const db = getDB();
  const course = { id: generateUUID(), ...req.validatedBody, created_by: req.user.email, created_at: now(), updated_at: now() };
  for (const k of ['description', 'provider', 'link', 'category']) course[k] = course[k] || '';
  await db.collection('courses').insertOne(course);
  res.status(201).json(stripId(course));
}));

router.put('/courses/:id', requireRole(['admin']), validate(courseUpdate), h(async (req, res) => {
  const db = getDB();
  const course = await getCourse(db, req.params.id);
  await db.collection('courses').updateOne({ id: course.id }, { $set: { ...req.validatedBody, updated_at: now() } });
  const fresh = await getCourse(db, course.id);
  const sync = {};
  if (req.validatedBody.title) sync.course_title = fresh.title;
  if (req.validatedBody.mandatory !== undefined) sync.mandatory = fresh.mandatory;
  if (Object.keys(sync).length) await db.collection('course_assignments').updateMany({ course_id: course.id }, { $set: sync });
  res.json(fresh);
}));

/** Courses with assignments are archived (active=false) instead of deleted. */
router.delete('/courses/:id', requireRole(['admin']), h(async (req, res) => {
  const db = getDB();
  const course = await getCourse(db, req.params.id);
  const used = await db.collection('course_assignments').countDocuments({ course_id: course.id });
  if (used) {
    await db.collection('courses').updateOne({ id: course.id }, { $set: { active: false, updated_at: now() } });
    return res.json({ message: 'Course archived (it has assignments)', archived: true });
  }
  await db.collection('courses').deleteOne({ id: course.id });
  res.json({ message: 'Course deleted', archived: false });
}));

/**
 * POST /courses/:id/assign { employee_emails, departments, due_date }
 * Admin: anyone / whole departments. Manager: only their team members.
 */
router.post('/courses/:id/assign', requireRole(['admin', 'manager']), validate(assignSchema), h(async (req, res) => {
  const db = getDB();
  const course = await getCourse(db, req.params.id);
  if (course.active === false) fail(400, 'This course is archived');
  const { employee_emails, departments, due_date } = req.validatedBody;
  if (due_date && due_date < todayStr()) fail(400, 'Due date cannot be in the past');
  if (departments.length && req.user.role !== 'admin') fail(403, 'Only admins can assign courses to whole departments');

  const targets = new Map();
  if (employee_emails.length) {
    const found = await db.collection('employees').find({ email: { $in: employee_emails } }, { projection: { _id: 0 } }).toArray();
    const missing = employee_emails.filter(e => !found.some(f => f.email === e));
    if (missing.length) fail(404, `Employee not found: ${missing.join(', ')}`);
    for (const e of found) {
      if (req.user.role !== 'admin' && !isManagerOf(req, e)) fail(403, `${e.full_name} is not in your team`);
      if (isActiveEmployee(e)) targets.set(e.email, e);
    }
  }
  if (departments.length) {
    const inDeps = await db.collection('employees').find({ department: { $in: departments } }, { projection: { _id: 0 } }).toArray();
    inDeps.filter(isActiveEmployee).forEach(e => targets.set(e.email, e));
  }
  if (!targets.size) fail(400, 'No active employees matched');

  const existing = await db.collection('course_assignments').find({ course_id: course.id, employee_email: { $in: [...targets.keys()] }, status: { $ne: 'completed' } }).toArray();
  const skip = new Set(existing.map(a => a.employee_email));
  const docs = [...targets.values()].filter(e => !skip.has(e.email)).map(e => ({
    id: generateUUID(),
    course_id: course.id,
    course_title: course.title,
    mandatory: !!course.mandatory,
    employee_email: e.email,
    employee_name: e.full_name,
    employee_uid: employeeUid(e),
    department: e.department || null,
    assigned_by: req.user.email,
    assigned_by_name: req.user.full_name,
    self_enrolled: false,
    due_date: due_date || null,
    status: 'not_started',
    progress_note: '',
    started_at: null,
    completed_at: null,
    certificate: null,
    last_reminder_date: null,
    created_at: now(),
    updated_at: now()
  }));
  if (docs.length) await db.collection('course_assignments').insertMany(docs);
  docs.forEach(d => notify(d.employee_email, {
    type: 'course_assigned',
    title: course.mandatory ? 'Mandatory course assigned' : 'Course assigned',
    message: `${req.user.full_name} assigned you "${course.title}"${d.due_date ? ` (due ${d.due_date})` : ''}`,
    actionUrl: '/performance/learning?tab=my',
    metadata: { assignment_id: d.id, course_id: course.id }
  }));
  res.status(201).json({ assigned: docs.length, skipped_existing: skip.size });
}));

router.post('/courses/:id/enroll', h(async (req, res) => {
  const db = getDB();
  const course = await getCourse(db, req.params.id);
  if (course.active === false) fail(400, 'This course is archived');
  const me = req.me;
  if (!me) fail(400, 'You need an employee profile to enroll');
  const existing = await db.collection('course_assignments').findOne({ course_id: course.id, employee_email: me.email, status: { $ne: 'completed' } });
  if (existing) fail(400, 'You are already enrolled in this course');
  const doc = {
    id: generateUUID(),
    course_id: course.id,
    course_title: course.title,
    mandatory: !!course.mandatory,
    employee_email: me.email,
    employee_name: me.full_name,
    employee_uid: employeeUid(me),
    department: me.department || null,
    assigned_by: me.email,
    assigned_by_name: me.full_name,
    self_enrolled: true,
    due_date: null,
    status: 'not_started',
    progress_note: '',
    started_at: null,
    completed_at: null,
    certificate: null,
    last_reminder_date: null,
    created_at: now(),
    updated_at: now()
  };
  await db.collection('course_assignments').insertOne(doc);
  res.status(201).json(withAssignmentFlags(stripId(doc)));
}));

// ============= ASSIGNMENTS =============

/**
 * GET /learning/assignments?scope=my|team|all&status&course_id&overdue=true
 */
router.get('/learning/assignments', h(async (req, res) => {
  const db = getDB();
  const filter = await scopeFilter(db, req, req.query.scope || 'my');
  if (req.query.status) filter.status = req.query.status;
  if (req.query.course_id) filter.course_id = req.query.course_id;
  if (req.query.department && req.user.role === 'admin') filter.department = req.query.department;
  const today = todayStr();
  if (req.query.overdue === 'true') {
    filter.status = { $ne: 'completed' };
    filter.due_date = { $ne: null, $lt: today };
  }
  const list = await db.collection('course_assignments').find(filter, { projection: { _id: 0 } }).sort({ due_date: 1, created_at: -1 }).toArray();
  res.json(list.map(a => withAssignmentFlags(a, today)));
}));

/**
 * GET /learning/summary — completion stats (admin: all, manager: team, employee: own).
 */
router.get('/learning/summary', h(async (req, res) => {
  const db = getDB();
  const scope = req.user.role === 'admin' ? 'all' : req.user.role === 'manager' ? 'team' : 'my';
  const filter = await scopeFilter(db, req, req.query.scope || scope);
  const list = (await db.collection('course_assignments').find(filter, { projection: { _id: 0 } }).toArray()).map(a => withAssignmentFlags(a));
  const byCourse = {};
  for (const a of list) {
    const c = byCourse[a.course_id] = byCourse[a.course_id] || { course_id: a.course_id, course_title: a.course_title, mandatory: a.mandatory, assigned: 0, completed: 0, in_progress: 0, overdue: 0 };
    c.assigned += 1;
    if (a.status === 'completed') c.completed += 1;
    if (a.status === 'in_progress') c.in_progress += 1;
    if (a.overdue) c.overdue += 1;
  }
  res.json({
    total: list.length,
    completed: list.filter(a => a.status === 'completed').length,
    in_progress: list.filter(a => a.status === 'in_progress').length,
    not_started: list.filter(a => a.status === 'not_started').length,
    overdue: list.filter(a => a.overdue).length,
    due_soon: list.filter(a => a.due_soon).length,
    by_course: Object.values(byCourse).sort((a, b) => b.assigned - a.assigned)
  });
}));

const getAssignment = async (db, id) => {
  const a = await db.collection('course_assignments').findOne({ id }, { projection: { _id: 0 } });
  if (!a) fail(404, 'Assignment not found');
  return a;
};

router.put('/learning/assignments/:id/progress', validate(progressSchema), h(async (req, res) => {
  const db = getDB();
  const a = await getAssignment(db, req.params.id);
  if (a.employee_email !== req.user.email) fail(403, 'You can only update your own learning');
  const { status, progress_note } = req.validatedBody;
  const set = { status, updated_at: now() };
  if (progress_note !== undefined) set.progress_note = progress_note || '';
  if (status !== 'not_started' && !a.started_at) set.started_at = now();
  set.completed_at = status === 'completed' ? (a.completed_at || now()) : null;
  await db.collection('course_assignments').updateOne({ id: a.id }, { $set: set });
  if (status === 'completed' && a.status !== 'completed') {
    emitEvent('learning.course.completed', { assignment_id: a.id, course_id: a.course_id, employee_email: a.employee_email });
    if (a.assigned_by && a.assigned_by !== a.employee_email) {
      notify(a.assigned_by, {
        type: 'course_completed',
        title: 'Course completed',
        message: `${a.employee_name} completed "${a.course_title}"`,
        actionUrl: '/performance/learning?tab=assignments',
        metadata: { assignment_id: a.id }
      });
    }
  }
  res.json(withAssignmentFlags(await getAssignment(db, a.id)));
}));

router.put('/learning/assignments/:id', validate(assignmentUpdate), h(async (req, res) => {
  const db = getDB();
  const a = await getAssignment(db, req.params.id);
  const owner = await findEmployee(db, a.employee_email);
  if (req.user.role !== 'admin' && !(req.user.role === 'manager' && isManagerOf(req, owner))) fail(403, 'Not enough permissions');
  await db.collection('course_assignments').updateOne({ id: a.id }, { $set: { due_date: req.validatedBody.due_date || null, updated_at: now() } });
  res.json(withAssignmentFlags(await getAssignment(db, a.id)));
}));

router.post('/learning/assignments/:id/certificate', singleFile, h(async (req, res) => {
  const db = getDB();
  const a = await getAssignment(db, req.params.id);
  if (a.employee_email !== req.user.email) fail(403, 'You can only upload certificates for your own courses');
  const stored = await storeFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'learning-certificates', a.employee_uid || a.employee_email);
  if (a.certificate?.key) await removeFile(a.certificate.key);
  const certificate = { key: stored.key, url: stored.url, name: req.file.originalname, mime_type: req.file.mimetype, size: req.file.size, uploaded_at: now() };
  const set = { certificate, updated_at: now() };
  if (a.status !== 'completed') {
    set.status = 'completed';
    set.completed_at = now();
    if (!a.started_at) set.started_at = now();
  }
  await db.collection('course_assignments').updateOne({ id: a.id }, { $set: set });
  res.json(withAssignmentFlags(await getAssignment(db, a.id)));
}));

router.delete('/learning/assignments/:id', h(async (req, res) => {
  const db = getDB();
  const a = await getAssignment(db, req.params.id);
  const isOwnEnrollment = a.self_enrolled && a.employee_email === req.user.email && a.status !== 'completed';
  const canAdmin = req.user.role === 'admin' || (a.assigned_by === req.user.email && req.user.role === 'manager');
  if (!isOwnEnrollment && !canAdmin) fail(403, 'Not enough permissions');
  await db.collection('course_assignments').deleteOne({ id: a.id });
  if (a.certificate?.key) await removeFile(a.certificate.key);
  res.json({ message: 'Assignment removed' });
}));

// ============= CERTIFICATIONS =============

const getCert = async (db, id) => {
  const c = await db.collection('certifications').findOne({ id }, { projection: { _id: 0 } });
  if (!c) fail(404, 'Certification not found');
  return c;
};

const canEditCert = (req, c) => c.employee_email === req.user.email || req.user.role === 'admin';

router.get('/certifications', h(async (req, res) => {
  const db = getDB();
  const filter = await scopeFilter(db, req, req.query.scope || 'my');
  const today = todayStr();
  let list = (await db.collection('certifications').find(filter, { projection: { _id: 0 } }).sort({ expiry_date: 1, name: 1 }).toArray())
    .map(c => ({ ...c, status: certStatus(c, today) }));
  if (req.query.status) list = list.filter(c => c.status === req.query.status);
  res.json(list);
}));

const checkCertDates = (c) => {
  if (c.issued_date && c.expiry_date && c.expiry_date < c.issued_date) fail(400, 'Expiry date must be after the issue date');
  if (c.issued_date && c.issued_date > todayStr()) fail(400, 'Issue date cannot be in the future');
};

router.post('/certifications', validate(certCreate), h(async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const ownerEmail = data.employee_email || req.user.email;
  if (ownerEmail !== req.user.email && req.user.role !== 'admin') fail(403, 'You can only add your own certifications');
  const owner = await findEmployee(db, ownerEmail);
  if (!owner) fail(404, 'Employee not found');
  checkCertDates(data);
  const cert = {
    id: generateUUID(),
    employee_email: owner.email,
    employee_name: owner.full_name,
    employee_uid: employeeUid(owner),
    department: owner.department || null,
    name: data.name,
    issuer: data.issuer || '',
    issued_date: data.issued_date || null,
    expiry_date: data.expiry_date || null,
    credential_id: data.credential_id || '',
    credential_url: data.credential_url || '',
    file: null,
    alerts_sent: [],
    added_by: req.user.email,
    created_at: now(),
    updated_at: now()
  };
  await db.collection('certifications').insertOne(cert);
  res.status(201).json({ ...stripId(cert), status: certStatus(cert) });
}));

router.put('/certifications/:id', validate(certUpdate), h(async (req, res) => {
  const db = getDB();
  const cert = await getCert(db, req.params.id);
  if (!canEditCert(req, cert)) fail(403, 'Not enough permissions');
  const updates = { ...req.validatedBody };
  for (const k of ['issued_date', 'expiry_date']) if (updates[k] === '') updates[k] = null;
  checkCertDates({ ...cert, ...updates });
  if (updates.expiry_date !== undefined && updates.expiry_date !== cert.expiry_date) updates.alerts_sent = [];
  await db.collection('certifications').updateOne({ id: cert.id }, { $set: { ...updates, updated_at: now() } });
  const fresh = await getCert(db, cert.id);
  res.json({ ...fresh, status: certStatus(fresh) });
}));

router.post('/certifications/:id/file', singleFile, h(async (req, res) => {
  const db = getDB();
  const cert = await getCert(db, req.params.id);
  if (!canEditCert(req, cert)) fail(403, 'Not enough permissions');
  const stored = await storeFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'certifications', cert.employee_uid || cert.employee_email);
  if (cert.file?.key) await removeFile(cert.file.key);
  const file = { key: stored.key, url: stored.url, name: req.file.originalname, mime_type: req.file.mimetype, size: req.file.size, uploaded_at: now() };
  await db.collection('certifications').updateOne({ id: cert.id }, { $set: { file, updated_at: now() } });
  const fresh = await getCert(db, cert.id);
  res.json({ ...fresh, status: certStatus(fresh) });
}));

router.delete('/certifications/:id', h(async (req, res) => {
  const db = getDB();
  const cert = await getCert(db, req.params.id);
  if (!canEditCert(req, cert)) fail(403, 'Not enough permissions');
  await db.collection('certifications').deleteOne({ id: cert.id });
  if (cert.file?.key) await removeFile(cert.file.key);
  res.json({ message: 'Certification deleted' });
}));

// ============= SKILLS =============

router.get('/skills', h(async (req, res) => {
  const skills = await getDB().collection('skills').find({}, { projection: { _id: 0 } }).sort({ category: 1, name: 1 }).toArray();
  res.json(skills);
}));

router.post('/skills', requireRole(['admin']), validate(skillSchema), h(async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const dup = await db.collection('skills').findOne({ name: { $regex: `^${data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  if (dup) fail(400, 'A skill with this name already exists');
  const skill = { id: generateUUID(), name: data.name, category: data.category || 'General', description: data.description || '', created_at: now(), updated_at: now() };
  await db.collection('skills').insertOne(skill);
  res.status(201).json(stripId(skill));
}));

const skillRows = (db, emails) => db.collection('employee_skills').find({ employee_email: { $in: emails } }, { projection: { _id: 0 } }).toArray();

const effective = (r) => (r ? (r.manager_rating ?? r.self_rating ?? null) : null);

/** GET /skills/me — my ratings for every skill in the catalog. */
router.get('/skills/me', h(async (req, res) => {
  const db = getDB();
  const skills = await db.collection('skills').find({}, { projection: { _id: 0 } }).sort({ category: 1, name: 1 }).toArray();
  const rows = await skillRows(db, [req.user.email]);
  const targets = req.me?.designation
    ? await db.collection('skill_targets').find({ designation: req.me.designation }, { projection: { _id: 0 } }).toArray()
    : [];
  res.json(skills.map(s => {
    const r = rows.find(x => x.skill_id === s.id);
    return {
      skill_id: s.id,
      name: s.name,
      category: s.category,
      self_rating: r?.self_rating ?? null,
      manager_rating: r?.manager_rating ?? null,
      validated: r?.status === 'validated',
      validated_by_name: r?.validated_by_name || null,
      manager_comment: r?.manager_comment || '',
      target_level: targets.find(t => t.skill_id === s.id)?.level ?? null
    };
  }));
}));

router.put('/skills/me', validate(selfRateSchema), h(async (req, res) => {
  const db = getDB();
  const me = req.me;
  if (!me) fail(400, 'You need an employee profile to rate skills');
  const ids = req.validatedBody.ratings.map(r => r.skill_id);
  const known = await db.collection('skills').countDocuments({ id: { $in: ids } });
  if (known !== ids.length) fail(400, 'Unknown skill');
  for (const r of req.validatedBody.ratings) {
    const existing = await db.collection('employee_skills').findOne({ employee_email: me.email, skill_id: r.skill_id });
    if (r.rating == null) {
      if (existing) await db.collection('employee_skills').deleteOne({ employee_email: me.email, skill_id: r.skill_id });
      continue;
    }
    if (existing?.self_rating === r.rating) continue;
    await db.collection('employee_skills').updateOne(
      { employee_email: me.email, skill_id: r.skill_id },
      {
        $set: {
          self_rating: r.rating,
          status: 'pending_validation',
          employee_name: me.full_name,
          employee_uid: employeeUid(me),
          department: me.department || null,
          designation: me.designation || null,
          updated_at: now()
        },
        $setOnInsert: { id: generateUUID(), manager_rating: null, created_at: now() }
      },
      { upsert: true }
    );
  }
  res.json({ message: 'Skills updated', count: req.validatedBody.ratings.length });
}));

/**
 * PUT /skills/employee/:email/validate { ratings: [{ skill_id, rating, comment }] } — manager / admin.
 */
router.put('/skills/employee/:email/validate', validate(validateSchema), h(async (req, res) => {
  const db = getDB();
  const employee = await findEmployee(db, req.params.email);
  if (!employee) fail(404, 'Employee not found');
  if (!isManagerOf(req, employee)) fail(403, "You can only validate your team's skills");
  const ids = req.validatedBody.ratings.map(r => r.skill_id);
  const known = await db.collection('skills').countDocuments({ id: { $in: ids } });
  if (known !== ids.length) fail(400, 'Unknown skill');
  for (const r of req.validatedBody.ratings) {
    await db.collection('employee_skills').updateOne(
      { employee_email: employee.email, skill_id: r.skill_id },
      {
        $set: {
          manager_rating: r.rating,
          manager_comment: r.comment || '',
          status: 'validated',
          validated_by: req.user.email,
          validated_by_name: req.user.full_name,
          validated_at: now(),
          employee_name: employee.full_name,
          employee_uid: employeeUid(employee),
          department: employee.department || null,
          designation: employee.designation || null,
          updated_at: now()
        },
        $setOnInsert: { id: generateUUID(), self_rating: null, created_at: now() }
      },
      { upsert: true }
    );
  }
  notify(employee.email, {
    type: 'skills_validated',
    title: 'Skills validated',
    message: `${req.user.full_name} reviewed ${ids.length} of your skill rating(s)`,
    actionUrl: '/performance/skills',
    metadata: {}
  });
  res.json({ message: 'Skills validated', count: ids.length });
}));

/** People in scope for the matrix / gaps. */
const peopleInScope = async (db, req, scope) => {
  if (scope === 'my') return req.me ? [req.me] : [];
  if (scope === 'team') return teamMembers(db, req);
  if (scope === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Not enough permissions');
    const all = await db.collection('employees').find({}, { projection: { _id: 0 } }).sort({ full_name: 1 }).toArray();
    return all.filter(isActiveEmployee);
  }
  fail(400, 'Unknown scope');
};

/**
 * GET /skills/matrix?scope=team|all&department — employees × skills grid.
 */
router.get('/skills/matrix', h(async (req, res) => {
  const db = getDB();
  const scope = req.query.scope || (req.user.role === 'admin' ? 'all' : 'team');
  if (scope === 'my') fail(400, 'Use /skills/me for your own skills');
  let people = await peopleInScope(db, req, scope);
  if (req.query.department) people = people.filter(p => p.department === req.query.department);
  const skills = await db.collection('skills').find({}, { projection: { _id: 0 } }).sort({ category: 1, name: 1 }).toArray();
  const rows = await skillRows(db, people.map(p => p.email));
  res.json({
    skills,
    employees: people.map(p => {
      const mine = rows.filter(r => r.employee_email === p.email);
      const ratings = {};
      for (const r of mine) {
        ratings[r.skill_id] = { self: r.self_rating ?? null, manager: r.manager_rating ?? null, effective: effective(r), status: r.status };
      }
      return {
        email: p.email,
        full_name: p.full_name,
        department: p.department || null,
        designation: p.designation || null,
        pending_validation: mine.filter(r => r.status === 'pending_validation').length,
        ratings
      };
    })
  });
}));

router.get('/skills/targets', h(async (req, res) => {
  const filter = req.query.designation ? { designation: req.query.designation } : {};
  const list = await getDB().collection('skill_targets').find(filter, { projection: { _id: 0 } }).sort({ designation: 1 }).toArray();
  res.json(list);
}));

/** PUT /skills/targets { designation, targets: [{ skill_id, level|null }] } — admin. */
router.put('/skills/targets', requireRole(['admin']), validate(targetsSchema), h(async (req, res) => {
  const db = getDB();
  const { designation, targets } = req.validatedBody;
  const ids = targets.map(t => t.skill_id);
  const known = await db.collection('skills').countDocuments({ id: { $in: ids } });
  if (known !== ids.length) fail(400, 'Unknown skill');
  for (const t of targets) {
    if (t.level == null) {
      await db.collection('skill_targets').deleteOne({ designation, skill_id: t.skill_id });
    } else {
      await db.collection('skill_targets').updateOne(
        { designation, skill_id: t.skill_id },
        { $set: { level: t.level, updated_at: now() }, $setOnInsert: { id: generateUUID(), created_at: now() } },
        { upsert: true }
      );
    }
  }
  res.json(await db.collection('skill_targets').find({ designation }, { projection: { _id: 0 } }).toArray());
}));

/**
 * GET /skills/gaps?scope=my|team|all — gap of each person against their designation's targets.
 */
router.get('/skills/gaps', h(async (req, res) => {
  const db = getDB();
  const scope = req.query.scope || 'my';
  const people = await peopleInScope(db, req, scope);
  const skills = await db.collection('skills').find({}, { projection: { _id: 0 } }).toArray();
  const skillMap = Object.fromEntries(skills.map(s => [s.id, s]));
  const targets = await db.collection('skill_targets').find({ designation: { $in: [...new Set(people.map(p => p.designation).filter(Boolean))] } }).toArray();
  const rows = await skillRows(db, people.map(p => p.email));

  const bySkill = {};
  const employees = people.map(p => {
    const t = targets.filter(x => x.designation === p.designation && skillMap[x.skill_id]);
    const gaps = t.map(x => {
      const r = rows.find(y => y.employee_email === p.email && y.skill_id === x.skill_id);
      const current = effective(r) ?? 0;
      const gap = Math.max(0, x.level - current);
      const agg = bySkill[x.skill_id] = bySkill[x.skill_id] || { skill_id: x.skill_id, name: skillMap[x.skill_id].name, people: 0, with_gap: 0, total_gap: 0 };
      agg.people += 1;
      if (gap > 0) { agg.with_gap += 1; agg.total_gap += gap; }
      return { skill_id: x.skill_id, name: skillMap[x.skill_id].name, target: x.level, current, validated: r?.status === 'validated', gap };
    });
    return {
      email: p.email,
      full_name: p.full_name,
      department: p.department || null,
      designation: p.designation || null,
      targets_defined: t.length,
      total_gap: gaps.reduce((s, g) => s + g.gap, 0),
      gaps
    };
  });
  res.json({ employees, by_skill: Object.values(bySkill).sort((a, b) => b.total_gap - a.total_gap) });
}));

// Parameterised skill routes last so they don't shadow /skills/me and /skills/targets
router.put('/skills/:id', requireRole(['admin']), validate(skillUpdate), h(async (req, res) => {
  const db = getDB();
  const skill = await db.collection('skills').findOne({ id: req.params.id });
  if (!skill) fail(404, 'Skill not found');
  await db.collection('skills').updateOne({ id: skill.id }, { $set: { ...req.validatedBody, updated_at: now() } });
  res.json(await db.collection('skills').findOne({ id: skill.id }, { projection: { _id: 0 } }));
}));

router.delete('/skills/:id', requireRole(['admin']), h(async (req, res) => {
  const db = getDB();
  const skill = await db.collection('skills').findOne({ id: req.params.id });
  if (!skill) fail(404, 'Skill not found');
  await db.collection('skills').deleteOne({ id: skill.id });
  await db.collection('employee_skills').deleteMany({ skill_id: skill.id });
  await db.collection('skill_targets').deleteMany({ skill_id: skill.id });
  res.json({ message: 'Skill deleted' });
}));

module.exports = { router, certStatus, withAssignmentFlags };
