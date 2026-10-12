/**
 * EL-2 Offboarding — resignation / termination, approval, exit checklist,
 * full and final settlement, finalization.
 */

const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { emitEvent } = require('../../events');
const {
  generateUUID, serverError, findEmployeeByUid, findMyEmployee, relationTo, teamQuery, getSettings,
  todayStr, addDaysStr, toDateStr, dateFromStr, uidOf, notifyMany, notifyAdmins, round2
} = require('../common');
const { resolveAssignees } = require('../onboarding');
const { recordJobEvent } = require('../jobHistory');
const { computeAutoLines, totalsOf } = require('../settlement');
const { buildSettlementPdf } = require('../pdf');
const { createVaultDocument, readStoredFile } = require('../vault');

const DATE = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });
const OWNERS = ['hr', 'manager', 'employee', 'it'];
const CATEGORIES = ['knowledge_transfer', 'access', 'assets', 'finance', 'other'];

const DEFAULT_EXIT_TASKS = [
  { title: 'Prepare handover document and complete knowledge transfer', category: 'knowledge_transfer', owner: 'employee' },
  { title: 'Sign off knowledge transfer', category: 'knowledge_transfer', owner: 'manager' },
  { title: 'Revoke email, VPN, chat and tool access', category: 'access', owner: 'it' },
  { title: 'Remove from attendance, payroll and building access', category: 'access', owner: 'hr' },
  { title: 'Return ID card and access card', category: 'assets', owner: 'employee' },
  { title: 'Clear pending reimbursements and advances', category: 'finance', owner: 'hr' },
  { title: 'No-dues sign-off', category: 'finance', owner: 'hr' }
];

const ACTIVE = ['pending', 'approved'];

const resignSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(2000).required(),
  last_working_day: DATE.allow(null, ''),
  notes: Joi.string().trim().max(2000).allow('', null)
});

const terminateSchema = Joi.object({
  employee_uid: Joi.string().required(),
  reason: Joi.string().trim().min(3).max(2000).required(),
  last_working_day: DATE.required(),
  notes: Joi.string().trim().max(2000).allow('', null),
  waive_notice_recovery: Joi.boolean().default(true)
});

const approveSchema = Joi.object({
  last_working_day: DATE.allow(null, ''),
  comments: Joi.string().trim().max(1000).allow('', null),
  waive_notice_recovery: Joi.boolean()
});

const rejectSchema = Joi.object({
  comments: Joi.string().trim().min(3).max(1000).required()
});

const exitTemplateSchema = Joi.object({
  tasks: Joi.array().items(Joi.object({
    title: Joi.string().trim().min(2).max(200).required(),
    description: Joi.string().trim().max(1000).allow('', null),
    category: Joi.string().valid(...CATEGORIES).default('other'),
    owner: Joi.string().valid(...OWNERS).required()
  })).min(1).max(100).required()
});

const checklistUpdateSchema = Joi.object({
  done: Joi.boolean(),
  notes: Joi.string().max(1000).allow('')
}).min(1);

const addItemSchema = Joi.object({
  title: Joi.string().trim().min(2).max(200).required(),
  description: Joi.string().trim().max(1000).allow('', null),
  category: Joi.string().valid(...CATEGORIES).default('other'),
  owner: Joi.string().valid(...OWNERS).required()
});

const lineSchema = Joi.object({
  label: Joi.string().trim().min(2).max(200).required(),
  type: Joi.string().valid('earning', 'deduction').required(),
  amount: Joi.number().positive().max(1e9).required(),
  detail: Joi.string().trim().max(500).allow('', null)
});

const finalizeSchema = Joi.object({ force: Joi.boolean().default(false) });

const getExitTemplate = async (db) => {
  const doc = await db.collection('lifecycle_settings').findOne({ key: 'exit_checklist_template' }, { projection: { _id: 0 } });
  return doc?.tasks?.length ? doc.tasks : DEFAULT_EXIT_TASKS;
};

/** Status an employee returns to when a separation is withdrawn / cancelled. */
const restingStatus = (employee) =>
  (employee.confirmation_date || !employee.probation_end_date ? 'active' : 'probation');

/**
 * Assets still held by the employee, per the assets module contract (collection may be empty / missing).
 * Matched on assigned_to_* regardless of status (assigned, in_repair, lost…) — only assets already
 * back in stock or retired are excluded.
 */
const RELEASED_ASSET_STATUSES = ['available', 'returned', 'retired', 'disposed'];
const assignedAssets = async (db, employee) => {
  const ids = [uidOf(employee), employee.id].filter(Boolean);
  try {
    return await db.collection('assets').find({
      status: { $nin: RELEASED_ASSET_STATUSES },
      $or: [
        ...(ids.length ? [{ assigned_to_uid: { $in: ids } }] : []),
        { assigned_to_email: employee.email }
      ]
    }, { projection: { _id: 0, id: 1, asset_tag: 1, name: 1, category: 1, status: 1 } }).toArray();
  } catch {
    return [];
  }
};

const buildChecklist = async (db, employee, actor) => {
  const tasks = await getExitTemplate(db);
  const people = await resolveAssignees(db, employee, actor);
  const items = tasks.map(t => {
    const who = people[t.owner] || people.hr;
    return {
      id: generateUUID(),
      title: t.title,
      description: t.description || '',
      category: t.category || 'other',
      owner: t.owner,
      assignee_email: who?.email || null,
      assignee_name: who?.name || null,
      asset_id: null,
      done: false,
      done_at: null,
      done_by: null,
      notes: ''
    };
  });
  const assets = await assignedAssets(db, employee);
  for (const a of assets) {
    const who = people.it || people.hr;
    items.push({
      id: generateUUID(),
      title: `Return asset: ${a.name || 'Asset'}${a.asset_tag ? ` (${a.asset_tag})` : ''}`,
      description: [a.category ? `Category: ${a.category}` : null, a.status && a.status !== 'assigned' ? `Currently ${String(a.status).replace(/_/g, ' ')}` : null].filter(Boolean).join(' · '),
      category: 'assets',
      owner: 'it',
      assignee_email: who?.email || null,
      assignee_name: who?.name || null,
      asset_id: a.id || null,
      asset_tag: a.asset_tag || null,
      done: false,
      done_at: null,
      done_by: null,
      notes: ''
    });
  }
  return items;
};

const approveSeparation = async (db, separation, employee, actor, { lastWorkingDay, comments, waive }) => {
  const now = new Date();
  const lwd = lastWorkingDay || separation.requested_last_day;
  const checklist = await buildChecklist(db, employee, actor);
  const update = {
    status: 'approved',
    last_working_day: lwd,
    actioned_by: actor.email,
    actioned_by_name: actor.full_name,
    action_comments: comments || null,
    actioned_at: now,
    checklist,
    updated_at: now
  };
  if (waive !== undefined) update.waive_notice_recovery = waive;
  await db.collection('separations').updateOne({ id: separation.id }, { $set: update });

  await db.collection('employees').updateOne({ email: employee.email }, {
    $set: {
      employment_status: 'notice',
      status_before_notice: employee.employment_status || 'active',
      exit_date: dateFromStr(lwd),
      exit_reason: separation.reason
    }
  });

  await recordJobEvent(db, {
    employee,
    type: 'separation',
    title: separation.type === 'termination' ? 'Termination approved' : 'Resignation accepted',
    effective_date: toDateStr(now),
    notes: `Last working day ${lwd}. ${separation.reason}`,
    actor
  });

  notifyMany(db, [employee.email], {
    type: 'separation_approved',
    title: separation.type === 'termination' ? 'Separation notice' : 'Resignation accepted',
    message: `Your last working day is ${lwd}. Please complete your exit checklist and exit interview.`,
    actionUrl: '/my-exit',
    metadata: { separation_id: separation.id }
  });
  const assignees = [...new Set(checklist.map(i => i.assignee_email).filter(e => e && e !== employee.email))];
  notifyMany(db, assignees, {
    type: 'exit_checklist_assigned',
    title: `Exit checklist for ${employee.full_name}`,
    message: `You have exit tasks for ${employee.full_name} (last working day ${lwd}).`,
    actionUrl: '/offboarding',
    metadata: { separation_id: separation.id }
  });
  return { ...separation, ...update };
};

/** Who may see / act on a separation. */
const access = async (db, user, separation) => {
  const employee = await findEmployeeByUid(db, separation.employee_uid)
    || await db.collection('employees').findOne({ email: separation.employee_email });
  const rel = employee ? await relationTo(db, user, employee) : (user.role === 'admin' ? 'admin' : null);
  const isAssignee = (separation.checklist || []).some(i => i.assignee_email === user.email);
  return { employee, rel, isAssignee };
};

const shapeFor = (separation, rel) => {
  const out = { ...separation };
  delete out._id;
  // Settlement detail is for HR and the employee; managers / assignees only see status
  if (rel !== 'admin' && rel !== 'self') {
    out.settlement = separation.settlement ? { status: separation.settlement.status } : null;
  }
  return out;
};

const loadSeparation = (db, id) => db.collection('separations').findOne({ id }, { projection: { _id: 0 } });

module.exports = (router) => {
  // ---------- Exit checklist template ----------

  router.get('/offboarding/template', requireRole(['admin']), async (req, res) => {
    try {
      res.json({ tasks: await getExitTemplate(getDB()) });
    } catch (error) {
      serverError(res, 'get exit template', error);
    }
  });

  router.put('/offboarding/template', requireRole(['admin']), validate(exitTemplateSchema), async (req, res) => {
    try {
      const db = getDB();
      const tasks = req.validatedBody.tasks.map(t => ({ title: t.title, description: t.description || '', category: t.category, owner: t.owner }));
      await db.collection('lifecycle_settings').updateOne(
        { key: 'exit_checklist_template' },
        { $set: { tasks, updated_at: new Date(), updated_by: req.user.email }, $setOnInsert: { key: 'exit_checklist_template' } },
        { upsert: true }
      );
      res.json({ tasks });
    } catch (error) {
      serverError(res, 'update exit template', error);
    }
  });

  // ---------- Resignation / termination ----------

  router.post('/offboarding/resign', validate(resignSchema), async (req, res) => {
    try {
      const db = getDB();
      const employee = await findMyEmployee(db, req.user.email);
      if (!employee) return res.status(404).json({ detail: 'Employee profile not found' });
      if (employee.employment_status === 'exited') return res.status(400).json({ detail: 'You have already exited' });
      const open = await db.collection('separations').findOne({ employee_email: employee.email, status: { $in: ACTIVE } });
      if (open) return res.status(409).json({ detail: 'You already have an active resignation' });

      const body = req.validatedBody;
      const settings = await getSettings(db);
      const today = todayStr();
      const noticeDays = Number(settings.notice_period_days) || 0;
      const noticeEnd = addDaysStr(today, noticeDays);
      const requested = body.last_working_day || noticeEnd;
      if (requested < today) return res.status(400).json({ detail: 'Last working day cannot be in the past' });

      const now = new Date();
      const separation = {
        id: generateUUID(),
        employee_uid: uidOf(employee),
        employee_id: employee.id || null,
        employee_email: employee.email,
        employee_name: employee.full_name,
        department: employee.department || null,
        designation: employee.designation || null,
        manager_email: employee.manager_email || null,
        type: 'resignation',
        reason: body.reason,
        notes: body.notes || null,
        submitted_on: today,
        notice_period_days: noticeDays,
        notice_end_date: noticeEnd,
        requested_last_day: requested,
        last_working_day: null,
        shortfall_days: Math.max(0, noticeDays - Math.max(0, Math.round((Date.parse(requested) - Date.parse(today)) / 86400000))),
        waive_notice_recovery: false,
        status: 'pending',
        initiated_by: req.user.email,
        checklist: [],
        settlement: null,
        created_at: now,
        updated_at: now
      };
      await db.collection('separations').insertOne(separation);
      delete separation._id;

      const payload = {
        type: 'resignation_submitted',
        title: 'New resignation',
        message: `${employee.full_name} has resigned (proposed last day ${requested}).`,
        actionUrl: '/offboarding',
        metadata: { separation_id: separation.id }
      };
      if (employee.manager_email) notifyMany(db, [employee.manager_email], payload);
      notifyAdmins(db, payload, employee.email);
      res.status(201).json(separation);
    } catch (error) {
      serverError(res, 'resign', error);
    }
  });

  router.post('/offboarding/terminate', requireRole(['admin']), validate(terminateSchema), async (req, res) => {
    try {
      const db = getDB();
      const body = req.validatedBody;
      const employee = await findEmployeeByUid(db, body.employee_uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      if (employee.email === req.user.email) return res.status(400).json({ detail: 'You cannot terminate yourself' });
      if (employee.employment_status === 'exited') return res.status(400).json({ detail: 'Employee has already exited' });
      const open = await db.collection('separations').findOne({ employee_email: employee.email, status: { $in: ACTIVE } });
      if (open) return res.status(409).json({ detail: 'This employee already has an active separation' });

      const now = new Date();
      const today = todayStr();
      const separation = {
        id: generateUUID(),
        employee_uid: uidOf(employee),
        employee_id: employee.id || null,
        employee_email: employee.email,
        employee_name: employee.full_name,
        department: employee.department || null,
        designation: employee.designation || null,
        manager_email: employee.manager_email || null,
        type: 'termination',
        reason: body.reason,
        notes: body.notes || null,
        submitted_on: today,
        notice_period_days: 0,
        notice_end_date: body.last_working_day,
        requested_last_day: body.last_working_day,
        last_working_day: null,
        shortfall_days: 0,
        waive_notice_recovery: body.waive_notice_recovery,
        status: 'pending',
        initiated_by: req.user.email,
        checklist: [],
        settlement: null,
        created_at: now,
        updated_at: now
      };
      await db.collection('separations').insertOne(separation);
      delete separation._id;
      // An admin-initiated termination is approved by that admin straight away
      const approved = await approveSeparation(db, separation, employee, req.user, { lastWorkingDay: body.last_working_day, comments: 'Termination initiated by admin' });
      res.status(201).json(approved);
    } catch (error) {
      serverError(res, 'terminate', error);
    }
  });

  // ---------- Views ----------

  router.get('/offboarding/my', async (req, res) => {
    try {
      const db = getDB();
      const list = await db.collection('separations').find({ employee_email: req.user.email }, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
      const settings = await getSettings(db);
      const interview = list[0] ? await db.collection('exit_interviews').findOne({ separation_id: list[0].id }, { projection: { _id: 0, id: 1, submitted_at: 1 } }) : null;
      res.json({
        current: list.find(s => ACTIVE.includes(s.status) || s.status === 'completed') || null,
        history: list,
        notice_period_days: settings.notice_period_days,
        exit_interview_submitted: !!interview
      });
    } catch (error) {
      serverError(res, 'my offboarding', error);
    }
  });

  /** GET /offboarding — admin: all; manager: team. ?status= */
  router.get('/offboarding', requireRole(['admin', 'manager']), async (req, res) => {
    try {
      const db = getDB();
      const query = {};
      if (req.query.status) query.status = String(req.query.status);
      if (req.user.role === 'manager') {
        const me = await findMyEmployee(db, req.user.email);
        const team = me ? await db.collection('employees').find(teamQuery(me), { projection: { email: 1 } }).toArray() : [];
        query.$or = [{ employee_email: { $in: team.map(t => t.email) } }, { 'checklist.assignee_email': req.user.email }];
      }
      const list = await db.collection('separations').find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
      const rel = req.user.role === 'admin' ? 'admin' : 'manager';
      res.json(list.map(s => ({
        ...shapeFor(s, rel),
        checklist_done: (s.checklist || []).filter(i => i.done).length,
        checklist_total: (s.checklist || []).length
      })));
    } catch (error) {
      serverError(res, 'list offboarding', error);
    }
  });

  router.get('/offboarding/:id', async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      const { rel, isAssignee } = await access(db, req.user, separation);
      if (!rel && !isAssignee) return res.status(403).json({ detail: 'Not enough permissions' });
      const assets = separation.status === 'approved' && rel === 'admin'
        ? await assignedAssets(db, { email: separation.employee_email, employee_id: separation.employee_uid })
        : undefined;
      res.json({ ...shapeFor(separation, rel || 'assignee'), access: rel || 'assignee', ...(assets ? { assigned_assets: assets } : {}) });
    } catch (error) {
      serverError(res, 'get separation', error);
    }
  });

  // ---------- Approval flow ----------

  router.post('/offboarding/:id/approve', requireRole(['admin', 'manager']), validate(approveSchema), async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      const { employee, rel } = await access(db, req.user, separation);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      if (rel !== 'admin' && rel !== 'manager') return res.status(403).json({ detail: 'Not enough permissions' });
      if (separation.status !== 'pending') return res.status(400).json({ detail: `Separation is already ${separation.status}` });
      const body = req.validatedBody;
      const lwd = body.last_working_day || separation.requested_last_day;
      if (lwd < separation.submitted_on) return res.status(400).json({ detail: 'Last working day cannot be before the resignation date' });
      const approved = await approveSeparation(db, separation, employee, req.user, {
        lastWorkingDay: lwd,
        comments: body.comments,
        waive: req.user.role === 'admin' ? body.waive_notice_recovery : undefined
      });
      res.json(approved);
    } catch (error) {
      serverError(res, 'approve separation', error);
    }
  });

  router.post('/offboarding/:id/reject', requireRole(['admin', 'manager']), validate(rejectSchema), async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      const { rel } = await access(db, req.user, separation);
      if (rel !== 'admin' && rel !== 'manager') return res.status(403).json({ detail: 'Not enough permissions' });
      if (separation.status !== 'pending') return res.status(400).json({ detail: `Separation is already ${separation.status}` });
      const update = {
        status: 'rejected',
        actioned_by: req.user.email,
        actioned_by_name: req.user.full_name,
        action_comments: req.validatedBody.comments,
        actioned_at: new Date(),
        updated_at: new Date()
      };
      await db.collection('separations').updateOne({ id: separation.id }, { $set: update });
      notifyMany(db, [separation.employee_email], {
        type: 'resignation_rejected',
        title: 'Resignation not accepted',
        message: `Your resignation was not accepted: ${req.validatedBody.comments}`,
        actionUrl: '/my-exit',
        metadata: { separation_id: separation.id }
      });
      res.json({ ...separation, ...update });
    } catch (error) {
      serverError(res, 'reject separation', error);
    }
  });

  router.post('/offboarding/:id/withdraw', async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      if (separation.employee_email !== req.user.email || separation.type !== 'resignation') {
        return res.status(403).json({ detail: 'You can only withdraw your own resignation' });
      }
      if (separation.status !== 'pending') return res.status(400).json({ detail: 'Only a pending resignation can be withdrawn' });
      await db.collection('separations').updateOne({ id: separation.id }, { $set: { status: 'withdrawn', withdrawn_at: new Date(), updated_at: new Date() } });
      const payload = {
        type: 'resignation_withdrawn',
        title: 'Resignation withdrawn',
        message: `${separation.employee_name} withdrew their resignation.`,
        actionUrl: '/offboarding',
        metadata: { separation_id: separation.id }
      };
      if (separation.manager_email) notifyMany(db, [separation.manager_email], payload);
      notifyAdmins(db, payload, separation.employee_email);
      res.json({ ...separation, status: 'withdrawn' });
    } catch (error) {
      serverError(res, 'withdraw separation', error);
    }
  });

  /** Admin: cancel an approved (not yet finalized) separation — the employee is retained. */
  router.post('/offboarding/:id/cancel', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      if (separation.status !== 'approved') return res.status(400).json({ detail: 'Only an approved, unfinalized separation can be cancelled' });
      const employee = await db.collection('employees').findOne({ email: separation.employee_email });
      await db.collection('separations').updateOne({ id: separation.id }, { $set: { status: 'cancelled', cancelled_by: req.user.email, updated_at: new Date() } });
      if (employee) {
        const status = employee.status_before_notice || restingStatus(employee);
        await db.collection('employees').updateOne({ email: employee.email }, {
          $set: { employment_status: status, exit_date: null, exit_reason: null },
          $unset: { status_before_notice: '' }
        });
      }
      res.json({ ...separation, status: 'cancelled' });
    } catch (error) {
      serverError(res, 'cancel separation', error);
    }
  });

  // ---------- Exit checklist ----------

  router.patch('/offboarding/:id/checklist/:itemId', validate(checklistUpdateSchema), async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      if (separation.status !== 'approved') return res.status(400).json({ detail: 'The exit checklist is only editable while the employee is serving notice' });
      const item = (separation.checklist || []).find(i => i.id === req.params.itemId);
      if (!item) return res.status(404).json({ detail: 'Checklist item not found' });
      const { rel } = await access(db, req.user, separation);
      const allowed = rel === 'admin' || rel === 'manager' || item.assignee_email === req.user.email || (rel === 'self' && item.owner === 'employee');
      if (!allowed) return res.status(403).json({ detail: 'You cannot update this item' });
      const body = req.validatedBody;
      if (body.notes !== undefined) item.notes = body.notes;
      if (body.done !== undefined && body.done !== item.done) {
        item.done = body.done;
        item.done_at = body.done ? new Date() : null;
        item.done_by = body.done ? req.user.email : null;
        item.done_by_name = body.done ? req.user.full_name : null;
      }
      await db.collection('separations').updateOne({ id: separation.id }, { $set: { checklist: separation.checklist, updated_at: new Date() } });
      res.json({ ...shapeFor(separation, rel || 'assignee') });
    } catch (error) {
      serverError(res, 'update exit checklist', error);
    }
  });

  router.post('/offboarding/:id/checklist', requireRole(['admin']), validate(addItemSchema), async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      if (separation.status !== 'approved') return res.status(400).json({ detail: 'Separation is not in notice period' });
      const employee = await db.collection('employees').findOne({ email: separation.employee_email });
      const people = await resolveAssignees(db, employee || { email: separation.employee_email, full_name: separation.employee_name }, req.user);
      const body = req.validatedBody;
      const who = people[body.owner] || people.hr;
      const item = {
        id: generateUUID(),
        title: body.title,
        description: body.description || '',
        category: body.category,
        owner: body.owner,
        assignee_email: who?.email || null,
        assignee_name: who?.name || null,
        asset_id: null,
        done: false,
        done_at: null,
        done_by: null,
        notes: ''
      };
      const checklist = [...(separation.checklist || []), item];
      await db.collection('separations').updateOne({ id: separation.id }, { $set: { checklist, updated_at: new Date() } });
      res.status(201).json({ ...separation, checklist });
    } catch (error) {
      serverError(res, 'add exit checklist item', error);
    }
  });

  // ---------- Settlement ----------

  const loadForSettlement = async (req, res) => {
    const db = getDB();
    const separation = await loadSeparation(db, req.params.id);
    if (!separation) { res.status(404).json({ detail: 'Separation not found' }); return null; }
    if (separation.status !== 'approved') { res.status(400).json({ detail: 'Settlement is only available for an approved separation that is not yet finalized' }); return null; }
    const employee = await db.collection('employees').findOne({ email: separation.employee_email });
    if (!employee) { res.status(404).json({ detail: 'Employee not found' }); return null; }
    return { db, separation, employee };
  };

  const saveSettlement = async (db, separation, lines, extra = {}) => {
    const settlement = {
      ...(separation.settlement || {}),
      ...extra,
      status: 'draft',
      lines,
      totals: totalsOf(lines),
      updated_at: new Date()
    };
    await db.collection('separations').updateOne({ id: separation.id }, { $set: { settlement, updated_at: new Date() } });
    return { ...separation, settlement };
  };

  const recompute = async (db, separation, employee, actor) => {
    const settings = await getSettings(db);
    const { lines, notes, basis } = await computeAutoLines(db, separation, employee, settings);
    const manual = (separation.settlement?.lines || []).filter(l => !l.auto);
    return saveSettlement(db, separation, [...lines, ...manual], { notes, basis, computed_at: new Date(), computed_by: actor.email });
  };

  router.post('/offboarding/:id/settlement/compute', requireRole(['admin']), async (req, res) => {
    try {
      const ctx = await loadForSettlement(req, res);
      if (!ctx) return;
      const saved = await recompute(ctx.db, ctx.separation, ctx.employee, req.user);
      res.json(saved);
    } catch (error) {
      serverError(res, 'compute settlement', error);
    }
  });

  router.post('/offboarding/:id/settlement/lines', requireRole(['admin']), validate(lineSchema), async (req, res) => {
    try {
      const ctx = await loadForSettlement(req, res);
      if (!ctx) return;
      const body = req.validatedBody;
      const lines = [...(ctx.separation.settlement?.lines || []), {
        id: generateUUID(),
        key: 'manual',
        label: body.label,
        type: body.type,
        amount: round2(body.amount),
        auto: false,
        detail: body.detail || null,
        added_by: req.user.email
      }];
      res.status(201).json(await saveSettlement(ctx.db, ctx.separation, lines));
    } catch (error) {
      serverError(res, 'add settlement line', error);
    }
  });

  router.delete('/offboarding/:id/settlement/lines/:lineId', requireRole(['admin']), async (req, res) => {
    try {
      const ctx = await loadForSettlement(req, res);
      if (!ctx) return;
      const lines = ctx.separation.settlement?.lines || [];
      if (!lines.some(l => l.id === req.params.lineId)) return res.status(404).json({ detail: 'Line not found' });
      res.json(await saveSettlement(ctx.db, ctx.separation, lines.filter(l => l.id !== req.params.lineId)));
    } catch (error) {
      serverError(res, 'remove settlement line', error);
    }
  });

  router.post('/offboarding/:id/finalize', requireRole(['admin']), validate(finalizeSchema), async (req, res) => {
    try {
      const ctx = await loadForSettlement(req, res);
      if (!ctx) return;
      const { db, employee } = ctx;
      let { separation } = ctx;
      if (employee.email === req.user.email) return res.status(400).json({ detail: 'You cannot finalize your own exit' });

      const blockers = [];
      const pending = (separation.checklist || []).filter(i => !i.done).length;
      if (pending) blockers.push(`${pending} exit checklist item(s) are still open`);
      if (separation.last_working_day > todayStr()) blockers.push(`the last working day (${separation.last_working_day}) is in the future`);
      if (blockers.length && !req.validatedBody.force) {
        return res.status(400).json({ detail: `Cannot finalize yet: ${blockers.join('; ')}. Pass force to finalize anyway.`, blockers });
      }

      if (!separation.settlement?.lines) {
        separation = await recompute(db, separation, employee, req.user);
      }
      const settings = await getSettings(db);
      const lines = separation.settlement.lines;
      const totals = totalsOf(lines);
      const pdf = await buildSettlementPdf({
        company: { name: settings.company_name, address: settings.company_address },
        employee,
        separation,
        lines,
        totals,
        notes: separation.settlement.notes || [],
        generatedBy: req.user.full_name
      });
      const doc = await createVaultDocument(db, {
        employee,
        type: 'other',
        title: 'Full and final settlement statement',
        buffer: pdf,
        fileName: `full-and-final-${uidOf(employee)}.pdf`,
        mimeType: 'application/pdf',
        source: 'settlement',
        verificationStatus: 'verified',
        actor: req.user,
        extra: { separation_id: separation.id }
      });

      const now = new Date();
      const settlement = {
        ...separation.settlement,
        totals,
        status: 'finalized',
        finalized_at: now,
        finalized_by: req.user.email,
        document_id: doc.id
      };
      await db.collection('separations').updateOne({ id: separation.id }, {
        $set: { status: 'completed', settlement, completed_at: now, updated_at: now }
      });

      const exitDate = dateFromStr(separation.last_working_day);
      await db.collection('employees').updateOne({ email: employee.email }, {
        $set: { employment_status: 'exited', exit_date: exitDate, exit_reason: separation.reason },
        $unset: { status_before_notice: '' }
      });
      await db.collection('users').updateOne({ email: employee.email }, { $set: { is_active: false, deactivated_at: now, deactivated_reason: 'exited' } });
      await db.collection('onboarding_checklists').updateMany(
        { employee_email: employee.email, status: 'in_progress' },
        { $set: { status: 'cancelled', updated_at: now } }
      );
      await recordJobEvent(db, {
        employee,
        type: 'exit',
        title: 'Exited the organisation',
        effective_date: separation.last_working_day,
        notes: `${separation.type === 'termination' ? 'Termination' : 'Resignation'}: ${separation.reason}. Net settlement ${totals.net}.`,
        actor: req.user
      });

      emitEvent('employee.exited', {
        employee_uid: uidOf(employee),
        employee_id: employee.id || null,
        email: employee.email,
        full_name: employee.full_name,
        department: employee.department || null,
        exit_date: separation.last_working_day,
        exit_reason: separation.reason,
        separation_type: separation.type,
        settlement_net: totals.net
      }, { actor: req.user.email });

      res.json({ ...separation, status: 'completed', settlement, completed_at: now });
    } catch (error) {
      serverError(res, 'finalize separation', error);
    }
  });

  router.get('/offboarding/:id/settlement/pdf', async (req, res) => {
    try {
      const db = getDB();
      const separation = await loadSeparation(db, req.params.id);
      if (!separation) return res.status(404).json({ detail: 'Separation not found' });
      const isAdmin = req.user.role === 'admin';
      if (!isAdmin && separation.employee_email !== req.user.email) return res.status(403).json({ detail: 'Not enough permissions' });
      if (separation.settlement?.status !== 'finalized' || !separation.settlement.document_id) {
        return res.status(404).json({ detail: 'Settlement has not been finalized yet' });
      }
      const doc = await db.collection('employee_documents').findOne({ id: separation.settlement.document_id });
      const buffer = doc ? await readStoredFile(doc) : null;
      if (!buffer) return res.status(404).json({ detail: 'Settlement file not found' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);
      res.send(buffer);
    } catch (error) {
      serverError(res, 'settlement pdf', error);
    }
  });
};
