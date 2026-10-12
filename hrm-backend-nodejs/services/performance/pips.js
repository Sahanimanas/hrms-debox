/**
 * PF-4 Performance improvement plans.
 *
 * Collection: pips
 * Visible only to the employee, their manager and admins.
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { validate } = require('../../middleware/roleCheck');
const { emitEvent } = require('../events');
const {
  h, fail, stripId, now, todayStr, addDays, generateUUID, employeeUid, DATE,
  findEmployee, isManagerOf, teamEmails, resolveManager, notify, isActiveEmployee
} = require('./common');

const router = express.Router();

const OBJECTIVE_STATUSES = ['not_started', 'in_progress', 'met', 'not_met'];
const OUTCOMES = ['successful', 'extended', 'unsuccessful'];

const objective = Joi.object({
  id: Joi.string().max(64),
  title: Joi.string().trim().min(2).max(300).required(),
  success_criteria: Joi.string().trim().min(2).max(2000).required(),
  status: Joi.string().valid(...OBJECTIVE_STATUSES)
});

const pipCreate = Joi.object({
  employee_email: Joi.string().email().required(),
  start_date: Joi.string().pattern(DATE).required(),
  end_date: Joi.string().pattern(DATE).required(),
  reason: Joi.string().trim().min(5).max(5000).required(),
  objectives: Joi.array().items(objective).min(1).max(20).required(),
  support: Joi.string().trim().max(5000).allow('', null),
  check_in_frequency_days: Joi.number().integer().min(1).max(60).default(7)
});
const pipUpdate = Joi.object({
  start_date: Joi.string().pattern(DATE),
  end_date: Joi.string().pattern(DATE),
  reason: Joi.string().trim().min(5).max(5000),
  objectives: Joi.array().items(objective).min(1).max(20),
  support: Joi.string().trim().max(5000).allow('', null),
  check_in_frequency_days: Joi.number().integer().min(1).max(60)
}).min(1);
const checkInSchema = Joi.object({
  date: Joi.string().pattern(DATE).required(),
  note: Joi.string().trim().min(2).max(5000).required(),
  objective_updates: Joi.array().items(Joi.object({
    objective_id: Joi.string().required(),
    status: Joi.string().valid(...OBJECTIVE_STATUSES).required()
  })).default([])
});
const outcomeSchema = Joi.object({
  outcome: Joi.string().valid(...OUTCOMES).required(),
  notes: Joi.string().trim().max(5000).allow('', null),
  extended_end_date: Joi.string().pattern(DATE).when('outcome', { is: 'extended', then: Joi.required(), otherwise: Joi.forbidden() })
});
const ackSchema = Joi.object({ comment: Joi.string().trim().max(2000).allow('', null) });
const commentSchema = Joi.object({ text: Joi.string().trim().min(1).max(3000).required() });

const getPip = async (db, id) => {
  const pip = await db.collection('pips').findOne({ id }, { projection: { _id: 0 } });
  if (!pip) fail(404, 'PIP not found');
  return pip;
};

/** 'employee' | 'manager' | 'admin' | null */
const pipRole = async (db, req, pip) => {
  if (pip.employee_email === req.user.email) return 'employee';
  if (req.user.role === 'admin') return 'admin';
  const employee = await findEmployee(db, pip.employee_email);
  return isManagerOf(req, employee) ? 'manager' : null;
};

const loadPip = async (db, req, id) => {
  const pip = await getPip(db, id);
  const role = await pipRole(db, req, pip);
  // 404 rather than 403 so the existence of a PIP isn't leaked
  if (!role) fail(404, 'PIP not found');
  return { pip, role };
};

const withComputed = (pip, role) => ({
  ...pip,
  viewer_role: role,
  days_remaining: pip.status === 'active' ? Math.round((Date.parse(`${pip.end_date}T12:00:00Z`) - Date.parse(`${todayStr()}T12:00:00Z`)) / 86400000) : null,
  check_in_due: pip.status === 'active' && !!pip.next_check_in_date && pip.next_check_in_date <= todayStr(),
  objectives_met: (pip.objectives || []).filter(o => o.status === 'met').length
});

const normalizeObjectives = (list, previous = []) => list.map(o => {
  const prev = previous.find(p => p.id && p.id === o.id);
  return {
    id: prev?.id || generateUUID(),
    title: o.title,
    success_criteria: o.success_criteria,
    status: o.status || prev?.status || 'not_started'
  };
});

const pipNotify = (pip, email, type, title, message) => notify(email, {
  type, title, message, actionUrl: `/performance/pips?id=${pip.id}`, metadata: { pip_id: pip.id }
});

/**
 * GET /pips?scope=my|team|all&status=active|closed
 */
router.get('/pips', h(async (req, res) => {
  const db = getDB();
  const scope = req.query.scope || 'my';
  const filter = {};
  if (scope === 'my') filter.employee_email = req.user.email;
  else if (scope === 'team') {
    filter.employee_email = { $in: await teamEmails(db, req) };
  } else if (scope === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Not enough permissions');
  } else fail(400, 'Unknown scope');
  if (req.query.status) filter.status = req.query.status;
  const list = await db.collection('pips').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
  const role = scope === 'my' ? 'employee' : req.user.role === 'admin' ? 'admin' : 'manager';
  res.json(list.map(p => withComputed(p, role)));
}));

router.get('/pips/:id', h(async (req, res) => {
  const db = getDB();
  const { pip, role } = await loadPip(db, req, req.params.id);
  res.json(withComputed(pip, role));
}));

router.post('/pips', validate(pipCreate), h(async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  if (!['manager', 'admin'].includes(req.user.role)) fail(403, 'Not enough permissions');
  const employee = await findEmployee(db, data.employee_email);
  if (!employee || !isActiveEmployee(employee)) fail(404, 'Employee not found');
  if (!isManagerOf(req, employee)) fail(403, 'You can only create PIPs for your team');
  if (data.end_date <= data.start_date) fail(400, 'End date must be after the start date');
  const existing = await db.collection('pips').findOne({ employee_email: employee.email, status: 'active' });
  if (existing) fail(400, 'This employee already has an active PIP');

  const manager = req.user.role === 'manager' ? { email: req.user.email, full_name: req.user.full_name } : await resolveManager(db, employee);
  const pip = {
    id: generateUUID(),
    employee_email: employee.email,
    employee_name: employee.full_name,
    employee_uid: employeeUid(employee),
    department: employee.department || null,
    designation: employee.designation || null,
    manager_email: manager?.email || null,
    manager_name: manager?.full_name || null,
    created_by: req.user.email,
    created_by_name: req.user.full_name,
    start_date: data.start_date,
    end_date: data.end_date,
    original_end_date: data.end_date,
    reason: data.reason,
    objectives: normalizeObjectives(data.objectives),
    support: data.support || '',
    check_in_frequency_days: data.check_in_frequency_days,
    next_check_in_date: addDays(data.start_date, data.check_in_frequency_days),
    check_ins: [],
    comments: [],
    extensions: [],
    status: 'active',
    outcome: null,
    outcome_notes: null,
    closed_at: null,
    acknowledgement: null,
    last_reminder_date: null,
    created_at: now(),
    updated_at: now()
  };
  await db.collection('pips').insertOne(pip);
  pipNotify(pip, employee.email, 'pip_created', 'Performance improvement plan',
    `${req.user.full_name} has started a performance improvement plan with you (${pip.start_date} to ${pip.end_date}). Please review and acknowledge it.`);
  emitEvent('performance.pip.created', { id: pip.id, employee_email: pip.employee_email });
  res.status(201).json(withComputed(stripId(pip), req.user.role === 'admin' ? 'admin' : 'manager'));
}));

router.put('/pips/:id', validate(pipUpdate), h(async (req, res) => {
  const db = getDB();
  const { pip, role } = await loadPip(db, req, req.params.id);
  if (role === 'employee') fail(403, 'Not enough permissions');
  if (pip.status !== 'active') fail(400, 'This PIP is closed');
  const data = req.validatedBody;
  const merged = { ...pip, ...data };
  if (merged.end_date <= merged.start_date) fail(400, 'End date must be after the start date');
  const updates = { ...data, updated_at: now() };
  if (data.objectives) updates.objectives = normalizeObjectives(data.objectives, pip.objectives);
  if (data.check_in_frequency_days || data.start_date) {
    const last = pip.check_ins.length ? pip.check_ins[pip.check_ins.length - 1].date : merged.start_date;
    updates.next_check_in_date = addDays(last, merged.check_in_frequency_days);
  }
  if (data.end_date) updates.original_end_date = pip.extensions.length ? pip.original_end_date : data.end_date;
  await db.collection('pips').updateOne({ id: pip.id }, { $set: updates });
  pipNotify(pip, pip.employee_email, 'pip_updated', 'PIP updated', `${req.user.full_name} updated your performance improvement plan`);
  res.json(withComputed(await getPip(db, pip.id), role));
}));

router.post('/pips/:id/check-ins', validate(checkInSchema), h(async (req, res) => {
  const db = getDB();
  const { pip, role } = await loadPip(db, req, req.params.id);
  if (role === 'employee') fail(403, 'Only the manager can record check-ins');
  if (pip.status !== 'active') fail(400, 'This PIP is closed');
  const data = req.validatedBody;
  if (data.date < pip.start_date) fail(400, 'Check-in date is before the PIP started');
  if (data.date > todayStr()) fail(400, 'Check-in date cannot be in the future');
  const objectives = pip.objectives.map(o => ({ ...o }));
  for (const u of data.objective_updates) {
    const o = objectives.find(x => x.id === u.objective_id);
    if (!o) fail(400, 'Unknown objective');
    o.status = u.status;
  }
  const checkIn = {
    id: generateUUID(),
    date: data.date,
    note: data.note,
    objective_updates: data.objective_updates.map(u => ({ ...u, title: objectives.find(o => o.id === u.objective_id).title })),
    by: req.user.email,
    by_name: req.user.full_name,
    created_at: now()
  };
  const latest = [...pip.check_ins.map(c => c.date), data.date].sort().pop();
  await db.collection('pips').updateOne({ id: pip.id }, {
    $push: { check_ins: checkIn },
    $set: { objectives, next_check_in_date: addDays(latest, pip.check_in_frequency_days), updated_at: now() }
  });
  pipNotify(pip, pip.employee_email, 'pip_check_in', 'PIP check-in recorded', `${req.user.full_name} recorded a check-in on your PIP`);
  res.status(201).json(withComputed(await getPip(db, pip.id), role));
}));

router.post('/pips/:id/acknowledge', validate(ackSchema), h(async (req, res) => {
  const db = getDB();
  const { pip, role } = await loadPip(db, req, req.params.id);
  if (role !== 'employee') fail(403, 'Only the employee can acknowledge their PIP');
  if (pip.acknowledgement) fail(400, 'Already acknowledged');
  const ack = { at: now(), comment: req.validatedBody.comment || '' };
  await db.collection('pips').updateOne({ id: pip.id }, { $set: { acknowledgement: ack, updated_at: now() } });
  if (pip.manager_email) {
    pipNotify(pip, pip.manager_email, 'pip_acknowledged', 'PIP acknowledged',
      `${pip.employee_name} acknowledged their PIP${ack.comment ? `: ${ack.comment}` : ''}`);
  }
  res.json(withComputed(await getPip(db, pip.id), role));
}));

router.post('/pips/:id/comments', validate(commentSchema), h(async (req, res) => {
  const db = getDB();
  const { pip, role } = await loadPip(db, req, req.params.id);
  const comment = { id: generateUUID(), by: req.user.email, by_name: req.user.full_name, role, text: req.validatedBody.text, at: now() };
  await db.collection('pips').updateOne({ id: pip.id }, { $push: { comments: comment }, $set: { updated_at: now() } });
  const target = role === 'employee' ? pip.manager_email : pip.employee_email;
  if (target && target !== req.user.email) {
    pipNotify(pip, target, 'pip_comment', 'New comment on PIP', `${req.user.full_name}: ${comment.text.slice(0, 140)}`);
  }
  res.status(201).json(withComputed(await getPip(db, pip.id), role));
}));

router.post('/pips/:id/outcome', validate(outcomeSchema), h(async (req, res) => {
  const db = getDB();
  const { pip, role } = await loadPip(db, req, req.params.id);
  if (role === 'employee') fail(403, 'Not enough permissions');
  if (pip.status !== 'active') fail(400, 'This PIP is already closed');
  const { outcome, notes, extended_end_date } = req.validatedBody;
  let update;
  if (outcome === 'extended') {
    if (extended_end_date <= pip.end_date) fail(400, 'The extension must end after the current end date');
    update = {
      $set: { end_date: extended_end_date, outcome: 'extended', outcome_notes: notes || '', updated_at: now() },
      $push: { extensions: { from: pip.end_date, to: extended_end_date, notes: notes || '', by: req.user.email, at: now() } }
    };
  } else {
    update = { $set: { status: 'closed', outcome, outcome_notes: notes || '', closed_at: now(), closed_by: req.user.email, updated_at: now() } };
  }
  await db.collection('pips').updateOne({ id: pip.id }, update);
  const label = { successful: 'completed successfully', extended: `extended to ${extended_end_date}`, unsuccessful: 'closed as unsuccessful' }[outcome];
  pipNotify(pip, pip.employee_email, 'pip_outcome', 'PIP outcome', `Your performance improvement plan was ${label}`);
  emitEvent(`performance.pip.${outcome}`, { id: pip.id, employee_email: pip.employee_email });
  res.json(withComputed(await getPip(db, pip.id), role));
}));

router.delete('/pips/:id', h(async (req, res) => {
  const db = getDB();
  const { pip, role } = await loadPip(db, req, req.params.id);
  if (role !== 'admin') fail(403, 'Only admins can delete a PIP');
  await db.collection('pips').deleteOne({ id: pip.id });
  res.json({ message: 'PIP deleted' });
}));

module.exports = { router };
