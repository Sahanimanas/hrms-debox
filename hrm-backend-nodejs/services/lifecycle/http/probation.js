/**
 * EL-7 Probation and confirmation.
 */

const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const {
  serverError, findEmployeeByUid, findMyEmployee, relationTo, teamQuery, todayStr, toDateStr, dateFromStr, diffDays,
  employeeCard, notifyMany
} = require('../common');
const { recordJobEvent } = require('../jobHistory');

const DATE = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });

const confirmSchema = Joi.object({
  confirmation_date: DATE.allow(null, ''),
  notes: Joi.string().trim().max(1000).allow('', null)
});

const extendSchema = Joi.object({
  new_end_date: DATE.required(),
  reason: Joi.string().trim().min(3).max(1000).required()
});

const setSchema = Joi.object({
  probation_end_date: DATE.required()
});

const row = (e, today) => {
  const end = toDateStr(e.probation_end_date);
  return {
    ...employeeCard(e),
    probation_end_date: end,
    days_left: end ? diffDays(today, end) : null,
    overdue: !!end && end < today,
    extensions: e.probation_extensions || []
  };
};

const loadTarget = async (req, res) => {
  const db = getDB();
  const employee = await findEmployeeByUid(db, req.params.uid);
  if (!employee) { res.status(404).json({ detail: 'Employee not found' }); return null; }
  const rel = await relationTo(db, req.user, employee);
  if (rel !== 'admin' && rel !== 'manager') { res.status(403).json({ detail: 'Not enough permissions' }); return null; }
  return { db, employee };
};

module.exports = (router) => {
  /** GET /probation — employees currently on probation (admin: all, manager: team). ?within_days= */
  router.get('/probation', requireRole(['admin', 'manager']), async (req, res) => {
    try {
      const db = getDB();
      let query = { employment_status: 'probation' };
      if (req.user.role === 'manager') {
        const me = await findMyEmployee(db, req.user.email);
        if (!me) return res.json([]);
        query = { $and: [query, teamQuery(me)] };
      }
      const today = todayStr();
      let list = (await db.collection('employees').find(query, { projection: { _id: 0 } }).toArray()).map(e => row(e, today));
      const within = parseInt(req.query.within_days, 10);
      if (!isNaN(within)) list = list.filter(r => r.days_left != null && r.days_left <= within);
      list.sort((a, b) => String(a.probation_end_date || '9999').localeCompare(String(b.probation_end_date || '9999')));
      res.json(list);
    } catch (error) {
      serverError(res, 'probation list', error);
    }
  });

  /** GET /probation/my — my probation status. */
  router.get('/probation/my', async (req, res) => {
    try {
      const me = await findMyEmployee(getDB(), req.user.email);
      if (!me) return res.json(null);
      res.json({
        employment_status: me.employment_status || 'active',
        probation_end_date: toDateStr(me.probation_end_date),
        confirmation_date: toDateStr(me.confirmation_date),
        extensions: me.probation_extensions || []
      });
    } catch (error) {
      serverError(res, 'my probation', error);
    }
  });

  router.post('/probation/:uid/confirm', requireRole(['admin', 'manager']), validate(confirmSchema), async (req, res) => {
    try {
      const ctx = await loadTarget(req, res);
      if (!ctx) return;
      const { db, employee } = ctx;
      if (employee.employment_status !== 'probation') return res.status(400).json({ detail: 'Employee is not on probation' });
      const date = req.validatedBody.confirmation_date || todayStr();
      const joining = toDateStr(employee.joining_date);
      if (joining && date < joining) return res.status(400).json({ detail: 'Confirmation date cannot be before the joining date' });
      await db.collection('employees').updateOne({ email: employee.email }, {
        $set: { employment_status: 'active', confirmation_date: dateFromStr(date), confirmed_by: req.user.email }
      });
      await recordJobEvent(db, {
        employee,
        type: 'confirmation',
        title: 'Confirmed after probation',
        effective_date: date,
        notes: req.validatedBody.notes,
        actor: req.user
      });
      notifyMany(db, [employee.email], {
        type: 'probation_confirmed',
        title: 'Congratulations — you are confirmed',
        message: `Your employment has been confirmed with effect from ${date}.`,
        actionUrl: '/profile',
        metadata: {}
      });
      res.json({ ...row({ ...employee, employment_status: 'active' }, todayStr()), confirmation_date: date });
    } catch (error) {
      serverError(res, 'confirm probation', error);
    }
  });

  router.post('/probation/:uid/extend', requireRole(['admin', 'manager']), validate(extendSchema), async (req, res) => {
    try {
      const ctx = await loadTarget(req, res);
      if (!ctx) return;
      const { db, employee } = ctx;
      if (employee.employment_status !== 'probation') return res.status(400).json({ detail: 'Employee is not on probation' });
      const { new_end_date: newEnd, reason } = req.validatedBody;
      const current = toDateStr(employee.probation_end_date);
      if (current && newEnd <= current) return res.status(400).json({ detail: `New end date must be after the current end date (${current})` });
      if (newEnd <= todayStr()) return res.status(400).json({ detail: 'New end date must be in the future' });
      const extension = { from: current, to: newEnd, reason, by: req.user.email, by_name: req.user.full_name, at: new Date() };
      await db.collection('employees').updateOne({ email: employee.email }, {
        $set: { probation_end_date: dateFromStr(newEnd), probation_reminders_sent: [] },
        $push: { probation_extensions: extension }
      });
      await recordJobEvent(db, {
        employee,
        type: 'probation_extension',
        title: 'Probation extended',
        changes: [{ field: 'probation_end_date', label: 'Probation end date', from: current, to: newEnd }],
        effective_date: todayStr(),
        notes: reason,
        actor: req.user
      });
      notifyMany(db, [employee.email], {
        type: 'probation_extended',
        title: 'Probation extended',
        message: `Your probation has been extended until ${newEnd}.`,
        actionUrl: '/profile',
        metadata: {}
      });
      const updated = { ...employee, probation_end_date: dateFromStr(newEnd), probation_extensions: [...(employee.probation_extensions || []), extension] };
      res.json(row(updated, todayStr()));
    } catch (error) {
      serverError(res, 'extend probation', error);
    }
  });

  /** PUT /probation/:uid — admin: put an existing (pre-module) employee on probation or correct the end date. */
  router.put('/probation/:uid', requireRole(['admin']), validate(setSchema), async (req, res) => {
    try {
      const ctx = await loadTarget(req, res);
      if (!ctx) return;
      const { db, employee } = ctx;
      if (['notice', 'exited'].includes(employee.employment_status)) return res.status(400).json({ detail: 'Employee is leaving or has exited' });
      const end = req.validatedBody.probation_end_date;
      const joining = toDateStr(employee.joining_date);
      if (joining && end <= joining) return res.status(400).json({ detail: 'Probation end must be after the joining date' });
      await db.collection('employees').updateOne({ email: employee.email }, {
        $set: { employment_status: 'probation', probation_end_date: dateFromStr(end), confirmation_date: null, probation_reminders_sent: [] }
      });
      res.json(row({ ...employee, employment_status: 'probation', probation_end_date: dateFromStr(end) }, todayStr()));
    } catch (error) {
      serverError(res, 'set probation', error);
    }
  });
};
