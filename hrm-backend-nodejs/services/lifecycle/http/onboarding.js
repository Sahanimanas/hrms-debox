/**
 * EL-1 Onboarding checklists — routes.
 */

const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const {
  generateUUID, serverError, findEmployeeByUid, relationTo, findMyEmployee, teamQuery, notifyMany
} = require('../common');
const {
  TASK_OWNERS, withTaskIds, ensureDefaultTemplate, progressOf, startOnboarding, resolveAssignees
} = require('../onboarding');

const taskSchema = Joi.object({
  id: Joi.string().allow(null, ''),
  title: Joi.string().trim().min(2).max(200).required(),
  description: Joi.string().trim().max(1000).allow('', null),
  owner: Joi.string().valid(...TASK_OWNERS).required(),
  due_offset_days: Joi.number().integer().min(-60).max(365).default(0)
});

const templateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  description: Joi.string().trim().max(500).allow('', null),
  is_default: Joi.boolean().default(false),
  tasks: Joi.array().items(taskSchema).min(1).max(100).required()
});

const startSchema = Joi.object({
  employee_uid: Joi.string().required(),
  template_id: Joi.string().allow(null, '')
});

const taskUpdateSchema = Joi.object({
  done: Joi.boolean(),
  notes: Joi.string().max(1000).allow(''),
  assignee_email: Joi.string().email(),
  due_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)
}).min(1);

const addTaskSchema = Joi.object({
  title: Joi.string().trim().min(2).max(200).required(),
  description: Joi.string().trim().max(1000).allow('', null),
  owner: Joi.string().valid(...TASK_OWNERS).required(),
  assignee_email: Joi.string().email().allow(null, ''),
  due_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
});

const decorate = (c) => ({ ...c, progress: progressOf(c.tasks), total_tasks: c.tasks.length, done_tasks: c.tasks.filter(t => t.done).length });

/** Access to a checklist: admin, the employee, their manager, or someone with a task on it. */
const checklistAccess = async (db, user, checklist) => {
  if (user.role === 'admin') return 'admin';
  if (checklist.employee_email === user.email) return 'self';
  if (user.role === 'manager') {
    const employee = await db.collection('employees').findOne({ email: checklist.employee_email });
    const rel = employee ? await relationTo(db, user, employee) : null;
    if (rel === 'manager') return 'manager';
  }
  if (checklist.tasks.some(t => t.assignee_email === user.email)) return 'assignee';
  return null;
};

const canEditTask = (user, access, task) => {
  if (access === 'admin' || access === 'manager') return true;
  if (task.assignee_email === user.email) return true;
  return access === 'self' && task.owner === 'employee';
};

const syncStatus = async (db, checklist) => {
  const progress = progressOf(checklist.tasks);
  const allDone = checklist.tasks.length > 0 && checklist.tasks.every(t => t.done);
  const status = checklist.status === 'cancelled' ? 'cancelled' : (allDone ? 'completed' : 'in_progress');
  const update = { tasks: checklist.tasks, progress, status, updated_at: new Date() };
  if (status === 'completed' && checklist.status !== 'completed') update.completed_at = new Date();
  if (status !== 'completed') update.completed_at = null;
  await db.collection('onboarding_checklists').updateOne({ id: checklist.id }, { $set: update });
  if (status === 'completed' && checklist.status !== 'completed') {
    notifyMany(db, [checklist.employee_email, checklist.manager_email], {
      type: 'onboarding_completed',
      title: 'Onboarding completed',
      message: `All onboarding tasks for ${checklist.employee_name} are done.`,
      actionUrl: '/my-onboarding',
      metadata: { checklist_id: checklist.id }
    });
  }
  return { ...checklist, ...update };
};

module.exports = (router) => {
  // ---------- Templates (admin) ----------

  router.get('/onboarding/templates', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      await ensureDefaultTemplate(db);
      const list = await db.collection('onboarding_templates').find({}, { projection: { _id: 0 } }).sort({ is_default: -1, name: 1 }).toArray();
      res.json(list);
    } catch (error) {
      serverError(res, 'list onboarding templates', error);
    }
  });

  router.post('/onboarding/templates', requireRole(['admin']), validate(templateSchema), async (req, res) => {
    try {
      const db = getDB();
      const body = req.validatedBody;
      const now = new Date();
      const template = {
        id: generateUUID(),
        name: body.name,
        description: body.description || '',
        is_default: !!body.is_default,
        tasks: withTaskIds(body.tasks.map(t => ({ ...t, id: null }))),
        created_by: req.user.email,
        created_at: now,
        updated_at: now
      };
      if (template.is_default) await db.collection('onboarding_templates').updateMany({}, { $set: { is_default: false } });
      await db.collection('onboarding_templates').insertOne(template);
      delete template._id;
      res.status(201).json(template);
    } catch (error) {
      serverError(res, 'create onboarding template', error);
    }
  });

  router.put('/onboarding/templates/:id', requireRole(['admin']), validate(templateSchema), async (req, res) => {
    try {
      const db = getDB();
      const col = db.collection('onboarding_templates');
      const existing = await col.findOne({ id: req.params.id });
      if (!existing) return res.status(404).json({ detail: 'Template not found' });
      const body = req.validatedBody;
      if (existing.is_default && !body.is_default) {
        return res.status(400).json({ detail: 'Make another template the default instead of unsetting this one' });
      }
      if (body.is_default) await col.updateMany({ id: { $ne: existing.id } }, { $set: { is_default: false } });
      const update = {
        name: body.name,
        description: body.description || '',
        is_default: !!body.is_default,
        tasks: withTaskIds(body.tasks),
        updated_at: new Date()
      };
      await col.updateOne({ id: existing.id }, { $set: update });
      res.json({ ...existing, ...update, _id: undefined });
    } catch (error) {
      serverError(res, 'update onboarding template', error);
    }
  });

  router.delete('/onboarding/templates/:id', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      const existing = await db.collection('onboarding_templates').findOne({ id: req.params.id });
      if (!existing) return res.status(404).json({ detail: 'Template not found' });
      if (existing.is_default) return res.status(400).json({ detail: 'The default template cannot be deleted' });
      await db.collection('onboarding_templates').deleteOne({ id: existing.id });
      res.json({ message: 'Template deleted' });
    } catch (error) {
      serverError(res, 'delete onboarding template', error);
    }
  });

  // ---------- Starting ----------

  router.post('/onboarding/start', requireRole(['admin']), validate(startSchema), async (req, res) => {
    try {
      const db = getDB();
      const employee = await findEmployeeByUid(db, req.validatedBody.employee_uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      if (employee.employment_status === 'exited') return res.status(400).json({ detail: 'Employee has exited' });
      const result = await startOnboarding(db, employee, req.user, { templateId: req.validatedBody.template_id || null });
      if (result.error) return res.status(result.status).json({ detail: result.error });
      res.status(201).json(decorate(result.checklist));
    } catch (error) {
      serverError(res, 'start onboarding', error);
    }
  });

  // ---------- Views ----------

  /** GET /onboarding/my — my own checklist (latest) plus tasks assigned to me for other people. */
  router.get('/onboarding/my', async (req, res) => {
    try {
      const db = getDB();
      const mine = await db.collection('onboarding_checklists')
        .find({ employee_email: req.user.email, status: { $ne: 'cancelled' } }, { projection: { _id: 0 } })
        .sort({ created_at: -1 }).limit(1).toArray();
      const others = await db.collection('onboarding_checklists')
        .find({ status: 'in_progress', employee_email: { $ne: req.user.email }, 'tasks.assignee_email': req.user.email }, { projection: { _id: 0 } })
        .sort({ joining_date: 1 }).toArray();
      const assigned = [];
      for (const c of others) {
        for (const t of c.tasks) {
          if (t.assignee_email === req.user.email) {
            assigned.push({ ...t, checklist_id: c.id, employee_name: c.employee_name, employee_uid: c.employee_uid, joining_date: c.joining_date });
          }
        }
      }
      assigned.sort((a, b) => Number(a.done) - Number(b.done) || String(a.due_date).localeCompare(String(b.due_date)));
      res.json({ checklist: mine[0] ? decorate(mine[0]) : null, assigned_tasks: assigned });
    } catch (error) {
      serverError(res, 'my onboarding', error);
    }
  });

  /** GET /onboarding — admin: all; manager: their team. ?status=in_progress|completed|cancelled */
  router.get('/onboarding', requireRole(['admin', 'manager']), async (req, res) => {
    try {
      const db = getDB();
      const query = {};
      if (req.query.status) query.status = String(req.query.status);
      if (req.user.role === 'manager') {
        const me = await findMyEmployee(db, req.user.email);
        const team = me ? await db.collection('employees').find(teamQuery(me), { projection: { email: 1 } }).toArray() : [];
        query.employee_email = { $in: team.map(t => t.email) };
      }
      const list = await db.collection('onboarding_checklists').find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
      res.json(list.map(decorate));
    } catch (error) {
      serverError(res, 'list onboarding', error);
    }
  });

  router.get('/onboarding/:id', async (req, res) => {
    try {
      const db = getDB();
      const checklist = await db.collection('onboarding_checklists').findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!checklist) return res.status(404).json({ detail: 'Checklist not found' });
      const access = await checklistAccess(db, req.user, checklist);
      if (!access) return res.status(403).json({ detail: 'Not enough permissions' });
      res.json({ ...decorate(checklist), access });
    } catch (error) {
      serverError(res, 'get onboarding', error);
    }
  });

  // ---------- Task updates ----------

  router.patch('/onboarding/:id/tasks/:taskId', validate(taskUpdateSchema), async (req, res) => {
    try {
      const db = getDB();
      const checklist = await db.collection('onboarding_checklists').findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!checklist) return res.status(404).json({ detail: 'Checklist not found' });
      if (checklist.status === 'cancelled') return res.status(400).json({ detail: 'This checklist was cancelled' });
      const task = checklist.tasks.find(t => t.id === req.params.taskId);
      if (!task) return res.status(404).json({ detail: 'Task not found' });
      const access = await checklistAccess(db, req.user, checklist);
      if (!access || !canEditTask(req.user, access, task)) return res.status(403).json({ detail: 'You cannot update this task' });

      const body = req.validatedBody;
      if ((body.assignee_email || body.due_date) && access !== 'admin') {
        return res.status(403).json({ detail: 'Only an admin can reassign a task or change its due date' });
      }
      if (body.assignee_email && body.assignee_email !== task.assignee_email) {
        const assignee = await db.collection('employees').findOne({ email: body.assignee_email }, { projection: { email: 1, full_name: 1 } });
        if (!assignee) return res.status(400).json({ detail: 'Assignee must be an existing employee' });
        task.assignee_email = assignee.email;
        task.assignee_name = assignee.full_name;
        notifyMany(db, [assignee.email], {
          type: 'onboarding_task_assigned',
          title: `Onboarding task for ${checklist.employee_name}`,
          message: `"${task.title}" is now assigned to you (due ${task.due_date}).`,
          actionUrl: '/my-onboarding?tab=assigned',
          metadata: { checklist_id: checklist.id, task_id: task.id }
        });
      }
      if (body.due_date) task.due_date = body.due_date;
      if (body.notes !== undefined) task.notes = body.notes;
      if (body.done !== undefined && body.done !== task.done) {
        task.done = body.done;
        task.done_at = body.done ? new Date() : null;
        task.done_by = body.done ? req.user.email : null;
        task.done_by_name = body.done ? req.user.full_name : null;
      }
      const saved = await syncStatus(db, checklist);
      res.json(decorate(saved));
    } catch (error) {
      serverError(res, 'update onboarding task', error);
    }
  });

  router.post('/onboarding/:id/tasks', requireRole(['admin']), validate(addTaskSchema), async (req, res) => {
    try {
      const db = getDB();
      const checklist = await db.collection('onboarding_checklists').findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!checklist) return res.status(404).json({ detail: 'Checklist not found' });
      if (checklist.status === 'cancelled') return res.status(400).json({ detail: 'This checklist was cancelled' });
      const body = req.validatedBody;
      let assignee = null;
      if (body.assignee_email) {
        assignee = await db.collection('employees').findOne({ email: body.assignee_email }, { projection: { email: 1, full_name: 1 } });
        if (!assignee) return res.status(400).json({ detail: 'Assignee must be an existing employee' });
      } else {
        const employee = await findEmployeeByUid(db, checklist.employee_uid);
        const people = await resolveAssignees(db, employee || { email: checklist.employee_email, full_name: checklist.employee_name, manager_email: checklist.manager_email }, req.user);
        const who = people[body.owner];
        assignee = who ? { email: who.email, full_name: who.name } : null;
      }
      checklist.tasks.push({
        id: generateUUID(),
        title: body.title,
        description: body.description || '',
        owner: body.owner,
        assignee_email: assignee?.email || null,
        assignee_name: assignee?.full_name || null,
        due_date: body.due_date,
        done: false,
        done_at: null,
        done_by: null,
        notes: ''
      });
      const saved = await syncStatus(db, checklist);
      res.status(201).json(decorate(saved));
    } catch (error) {
      serverError(res, 'add onboarding task', error);
    }
  });

  router.delete('/onboarding/:id', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      const r = await db.collection('onboarding_checklists').updateOne(
        { id: req.params.id, status: { $ne: 'cancelled' } },
        { $set: { status: 'cancelled', cancelled_by: req.user.email, updated_at: new Date() } }
      );
      if (!r.matchedCount) return res.status(404).json({ detail: 'Checklist not found' });
      res.json({ message: 'Onboarding cancelled' });
    } catch (error) {
      serverError(res, 'cancel onboarding', error);
    }
  });
};

