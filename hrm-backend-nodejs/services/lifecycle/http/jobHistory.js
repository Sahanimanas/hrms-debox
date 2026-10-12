/**
 * EL-6 Job history — timeline per employee.
 * Employee sees own, manager their team, admin everyone. Admin adds / removes manual entries.
 */

const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { serverError, findEmployeeByUid, relationTo, uidOf } = require('../common');
const { MANUAL_TYPES, TYPE_LABELS, recordJobEvent } = require('../jobHistory');

const DATE = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });

const manualSchema = Joi.object({
  employee_uid: Joi.string().required(),
  type: Joi.string().valid(...MANUAL_TYPES).required(),
  title: Joi.string().trim().max(150).allow('', null),
  effective_date: DATE.required(),
  notes: Joi.string().trim().max(2000).allow('', null),
  changes: Joi.array().items(Joi.object({
    label: Joi.string().trim().min(1).max(60).required(),
    from: Joi.alternatives(Joi.string().max(200), Joi.number()).allow(null, ''),
    to: Joi.alternatives(Joi.string().max(200), Joi.number()).allow(null, '')
  })).max(10).default([])
});

const listFor = (db, employee) =>
  db.collection('job_history')
    .find({ $or: [{ employee_uid: uidOf(employee) }, { employee_email: employee.email }] }, { projection: { _id: 0 } })
    .sort({ effective_date: -1, created_at: -1 })
    .toArray();

module.exports = (router) => {
  router.get('/job-history/types', (req, res) => res.json({ manual: MANUAL_TYPES, labels: TYPE_LABELS }));

  router.get('/job-history/my', async (req, res) => {
    try {
      const db = getDB();
      const me = await db.collection('employees').findOne({ email: req.user.email });
      if (!me) return res.json([]);
      res.json(await listFor(db, me));
    } catch (error) {
      serverError(res, 'my job history', error);
    }
  });

  router.get('/job-history/:uid', async (req, res) => {
    try {
      const db = getDB();
      const employee = await findEmployeeByUid(db, req.params.uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      const rel = await relationTo(db, req.user, employee);
      if (!rel) return res.status(403).json({ detail: 'Not enough permissions' });
      res.json(await listFor(db, employee));
    } catch (error) {
      serverError(res, 'job history', error);
    }
  });

  router.post('/job-history', requireRole(['admin']), validate(manualSchema), async (req, res) => {
    try {
      const db = getDB();
      const body = req.validatedBody;
      const employee = await findEmployeeByUid(db, body.employee_uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      const entry = await recordJobEvent(db, {
        employee,
        type: body.type,
        title: body.title || TYPE_LABELS[body.type],
        changes: body.changes.map(c => ({ field: 'manual', label: c.label, from: c.from ?? null, to: c.to ?? null })),
        effective_date: body.effective_date,
        notes: body.notes,
        source: 'manual',
        actor: req.user
      });
      if (!entry) return res.status(500).json({ detail: 'Internal server error' });
      res.status(201).json(entry);
    } catch (error) {
      serverError(res, 'add job history', error);
    }
  });

  router.delete('/job-history/:id', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      const entry = await db.collection('job_history').findOne({ id: req.params.id });
      if (!entry) return res.status(404).json({ detail: 'Entry not found' });
      if (entry.source !== 'manual') return res.status(400).json({ detail: 'Only manual entries can be deleted' });
      await db.collection('job_history').deleteOne({ id: entry.id });
      res.json({ message: 'Entry deleted' });
    } catch (error) {
      serverError(res, 'delete job history', error);
    }
  });
};
