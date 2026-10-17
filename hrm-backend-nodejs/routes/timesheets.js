/**
 * Projects and weekly timesheets (TA-10).
 *
 * Employees log hours against projects in a weekly grid, submit the week,
 * and their manager (or an admin) approves or sends it back. Mounted at
 * /api/timesheets.
 */

const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { generateUUID, employeeUid } = require('../utils/helpers');
const { findMyEmployee, teamQuery, canActOnEmployee, stripId } = require('../services/time/core');
const { createNotification } = require('../services/notificationService');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE = ['draft', 'rejected'];

const schemas = {
  project: Joi.object({
    name: Joi.string().trim().max(100).required(),
    code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]{2,20}$/).required(),
    client: Joi.string().trim().max(100).allow('', null),
    description: Joi.string().trim().max(1000).allow('', null),
    billable: Joi.boolean().default(true),
    member_emails: Joi.array().items(Joi.string().email()).default([])
  }),
  projectUpdate: Joi.object({
    name: Joi.string().trim().max(100),
    client: Joi.string().trim().max(100).allow('', null),
    description: Joi.string().trim().max(1000).allow('', null),
    billable: Joi.boolean(),
    status: Joi.string().valid('active', 'archived'),
    member_emails: Joi.array().items(Joi.string().email())
  }).min(1),
  week: Joi.object({
    week_start: Joi.string().pattern(DATE).required(),
    rows: Joi.array().items(Joi.object({
      project_id: Joi.string().required(),
      task: Joi.string().trim().max(120).allow('', null),
      billable: Joi.boolean(),
      notes: Joi.string().trim().max(500).allow('', null),
      minutes: Joi.object().pattern(Joi.string().pattern(DATE), Joi.number().integer().min(0).max(1440).messages({
        'number.base': 'Hours must be a number',
        'number.min': 'Hours cannot be negative',
        'number.max': 'A day has at most 24 hours'
      })).required()
    })).max(50).required()
  }),
  weekRef: Joi.object({ week_start: Joi.string().pattern(DATE).required() }),
  action: Joi.object({
    action: Joi.string().valid('approve', 'reject').required(),
    comments: Joi.string().max(500).allow('', null)
  })
};

const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isMonday = (dateStr) => new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 1;
const weekDates = (weekStart) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('projects').createIndex({ id: 1 }, { unique: true }),
    db.collection('projects').createIndex({ code: 1 }, { unique: true }),
    db.collection('timesheet_entries').createIndex({ employee_uid: 1, date: 1 }),
    db.collection('timesheet_entries').createIndex({ project_id: 1, date: 1 }),
    db.collection('timesheets').createIndex({ employee_uid: 1, week_start: 1 }, { unique: true })
  ]);
  indexesReady = true;
};

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Timesheet index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

const canUseProject = (project, user) =>
  project.status === 'active' &&
  (user.role === 'admin' || !project.member_emails?.length || project.member_emails.includes(user.email));

// ============= PROJECTS =============

router.get('/projects', async (req, res) => {
  try {
    const db = getDB();
    const filter = req.query.include_archived === 'true' && req.user.role !== 'employee' ? {} : { status: 'active' };
    const projects = await db.collection('projects').find(filter, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    res.json(req.user.role === 'employee' ? projects.filter(p => canUseProject(p, req.user)) : projects);
  } catch (error) {
    console.error('List projects error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.post('/projects', requireRole(['admin', 'manager']), validate(schemas.project), async (req, res) => {
  try {
    const db = getDB();
    if (await db.collection('projects').findOne({ code: req.validatedBody.code })) {
      return res.status(400).json({ detail: `Project code ${req.validatedBody.code} already exists` });
    }
    const project = {
      id: generateUUID(),
      ...req.validatedBody,
      status: 'active',
      created_by: req.user.email,
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.collection('projects').insertOne(project);
    res.status(201).json(stripId(project));
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.put('/projects/:id', requireRole(['admin', 'manager']), validate(schemas.projectUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { matchedCount } = await db.collection('projects').updateOne(
      { id: req.params.id },
      { $set: { ...req.validatedBody, updated_at: new Date() } }
    );
    if (!matchedCount) return res.status(404).json({ detail: 'Project not found' });
    res.json(await db.collection('projects').findOne({ id: req.params.id }, { projection: { _id: 0 } }));
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= MY WEEK =============

const loadWeek = async (db, uid, weekStart) => {
  const [sheet, entries] = await Promise.all([
    db.collection('timesheets').findOne({ employee_uid: uid, week_start: weekStart }, { projection: { _id: 0 } }),
    db.collection('timesheet_entries')
      .find({ employee_uid: uid, date: { $gte: weekStart, $lte: addDays(weekStart, 6) } }, { projection: { _id: 0 } })
      .toArray()
  ]);

  // Group entries back into grid rows (project + task)
  const rows = new Map();
  for (const e of entries) {
    const key = `${e.project_id}|${e.task || ''}`;
    if (!rows.has(key)) {
      rows.set(key, { project_id: e.project_id, project_name: e.project_name, task: e.task || '', billable: e.billable, notes: e.notes || '', minutes: {} });
    }
    rows.get(key).minutes[e.date] = (rows.get(key).minutes[e.date] || 0) + e.minutes;
  }
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  return {
    week_start: weekStart,
    dates: weekDates(weekStart),
    status: sheet?.status || 'draft',
    sheet: sheet || null,
    rows: [...rows.values()],
    total_minutes: total
  };
};

/**
 * GET /api/timesheets/week?week_start=YYYY-MM-DD (a Monday)
 */
router.get('/week', async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    if (!DATE.test(weekStart || '') || !isMonday(weekStart)) {
      return res.status(400).json({ detail: 'week_start must be a Monday (YYYY-MM-DD)' });
    }
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });
    res.json(await loadWeek(db, employeeUid(employee), weekStart));
  } catch (error) {
    console.error('Get timesheet week error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/timesheets/week — replace the week's entries
 */
router.put('/week', validate(schemas.week), async (req, res) => {
  try {
    const db = getDB();
    const { week_start: weekStart, rows } = req.validatedBody;
    if (!isMonday(weekStart)) return res.status(400).json({ detail: 'week_start must be a Monday' });

    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });
    const uid = employeeUid(employee);

    const sheet = await db.collection('timesheets').findOne({ employee_uid: uid, week_start: weekStart });
    if (sheet && !EDITABLE.includes(sheet.status)) {
      return res.status(409).json({ detail: `This week is ${sheet.status} and can no longer be edited` });
    }

    const dates = new Set(weekDates(weekStart));
    const projectIds = [...new Set(rows.map(r => r.project_id))];
    const projects = await db.collection('projects').find({ id: { $in: projectIds } }).toArray();
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));

    const perDay = {};
    const entries = [];
    const now = new Date();
    for (const row of rows) {
      const project = projectMap[row.project_id];
      if (!project) return res.status(400).json({ detail: 'Unknown project' });
      if (!canUseProject(project, req.user)) return res.status(400).json({ detail: `You can't log time to ${project.name}` });
      for (const [date, minutes] of Object.entries(row.minutes)) {
        if (!dates.has(date)) return res.status(400).json({ detail: `${date} is outside this week` });
        if (!minutes) continue;
        perDay[date] = (perDay[date] || 0) + minutes;
        entries.push({
          id: generateUUID(),
          employee_uid: uid,
          user_email: employee.email,
          employee_name: employee.full_name,
          department: employee.department || null,
          date,
          week_start: weekStart,
          project_id: project.id,
          project_name: project.name,
          project_code: project.code,
          task: row.task || '',
          billable: row.billable ?? project.billable,
          notes: row.notes || '',
          minutes,
          created_at: now
        });
      }
    }
    const overDay = Object.entries(perDay).find(([, m]) => m > 1440);
    if (overDay) return res.status(400).json({ detail: `More than 24 hours logged on ${overDay[0]}` });

    await db.collection('timesheet_entries').deleteMany({ employee_uid: uid, date: { $gte: weekStart, $lte: addDays(weekStart, 6) } });
    if (entries.length) await db.collection('timesheet_entries').insertMany(entries);
    await db.collection('timesheets').updateOne(
      { employee_uid: uid, week_start: weekStart },
      {
        $set: { total_minutes: entries.reduce((s, e) => s + e.minutes, 0), updated_at: now },
        $setOnInsert: {
          id: generateUUID(),
          user_email: employee.email,
          employee_name: employee.full_name,
          department: employee.department || null,
          manager_email: employee.manager_email || null,
          status: 'draft',
          created_at: now
        }
      },
      { upsert: true }
    );

    res.json(await loadWeek(db, uid, weekStart));
  } catch (error) {
    console.error('Save timesheet week error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/timesheets/week/submit { week_start }
 */
router.post('/week/submit', validate(schemas.weekRef), async (req, res) => {
  try {
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });
    const uid = employeeUid(employee);
    const { week_start: weekStart } = req.validatedBody;

    const sheet = await db.collection('timesheets').findOne({ employee_uid: uid, week_start: weekStart });
    if (!sheet || !sheet.total_minutes) return res.status(400).json({ detail: 'Log some hours before submitting' });
    if (!EDITABLE.includes(sheet.status)) return res.status(400).json({ detail: `This week is already ${sheet.status}` });

    await db.collection('timesheets').updateOne(
      { id: sheet.id },
      { $set: { status: 'submitted', submitted_at: new Date(), updated_at: new Date(), comments: null } }
    );

    const manager = employee.manager_email
      ? await db.collection('employees').findOne({ email: employee.manager_email })
      : await db.collection('employees').findOne({ department: employee.department, role: 'manager', email: { $ne: employee.email } });
    if (manager) {
      createNotification({
        userId: manager.id,
        userEmail: manager.email,
        type: 'timesheet_submitted',
        title: 'Timesheet submitted',
        message: `${employee.full_name} submitted their timesheet for the week of ${weekStart}`,
        actionUrl: '/timesheets?tab=approvals',
        metadata: { timesheet_id: sheet.id }
      }).catch(() => {});
    }

    res.json(await loadWeek(db, uid, weekStart));
  } catch (error) {
    console.error('Submit timesheet error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/timesheets/week/recall { week_start } — pull a submitted week back to draft
 */
router.post('/week/recall', validate(schemas.weekRef), async (req, res) => {
  try {
    const db = getDB();
    const employee = await findMyEmployee(db, req.user.email);
    if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });
    const uid = employeeUid(employee);
    const { week_start: weekStart } = req.validatedBody;
    const { matchedCount } = await db.collection('timesheets').updateOne(
      { employee_uid: uid, week_start: weekStart, status: 'submitted' },
      { $set: { status: 'draft', updated_at: new Date() } }
    );
    if (!matchedCount) return res.status(400).json({ detail: 'Only a submitted (not yet approved) week can be recalled' });
    res.json(await loadWeek(db, uid, weekStart));
  } catch (error) {
    console.error('Recall timesheet error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= APPROVALS =============

const teamEmails = async (db, user) => {
  if (user.role === 'admin') return null; // everyone
  const manager = await findMyEmployee(db, user.email);
  if (!manager) return [];
  const team = await db.collection('employees').find(teamQuery(manager), { projection: { email: 1 } }).toArray();
  return team.map(t => t.email);
};

/**
 * GET /api/timesheets/approvals?status=submitted|approved|rejected|all
 */
router.get('/approvals', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const status = req.query.status || 'submitted';
    const filter = status === 'all' ? { status: { $ne: 'draft' } } : { status };
    const emails = await teamEmails(db, req.user);
    if (emails) filter.user_email = { $in: emails };
    const sheets = await db.collection('timesheets').find(filter, { projection: { _id: 0 } }).sort({ week_start: -1 }).limit(300).toArray();

    // Attach per-project breakdown
    const result = [];
    for (const sheet of sheets) {
      const entries = await db.collection('timesheet_entries')
        .find({ employee_uid: sheet.employee_uid, week_start: sheet.week_start }, { projection: { project_name: 1, minutes: 1 } })
        .toArray();
      const byProject = {};
      entries.forEach(e => { byProject[e.project_name] = (byProject[e.project_name] || 0) + e.minutes; });
      result.push({ ...sheet, by_project: Object.entries(byProject).map(([project, minutes]) => ({ project, minutes })) });
    }
    res.json(result);
  } catch (error) {
    console.error('Timesheet approvals error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/timesheets/sheets/:id/action { action: approve|reject, comments }
 */
router.post('/sheets/:id/action', requireRole(['admin', 'manager']), validate(schemas.action), async (req, res) => {
  try {
    const db = getDB();
    const sheet = await db.collection('timesheets').findOne({ id: req.params.id });
    if (!sheet) return res.status(404).json({ detail: 'Timesheet not found' });
    if (sheet.status !== 'submitted') return res.status(400).json({ detail: `Timesheet is ${sheet.status}, not awaiting approval` });
    // Nobody approves their own timesheet, admins included (same rule as profile change requests)
    if (req.validatedBody.action === 'approve' && sheet.user_email === req.user.email) {
      return res.status(403).json({ detail: 'You cannot approve your own timesheet; another approver must act on it' });
    }
    if (!(await canActOnEmployee(db, req.user, sheet.user_email))) {
      return res.status(403).json({ detail: 'You can only approve timesheets from your team' });
    }
    const { action, comments } = req.validatedBody;
    if (action === 'reject' && !comments) return res.status(400).json({ detail: 'Say what needs fixing when sending a timesheet back' });
    // "Send back" keeps the stored status 'rejected' (existing data, filters and the
    // editable check rely on it); only the wording shown to people says "sent back".
    const status = action === 'approve' ? 'approved' : 'rejected';
    const verb = action === 'approve' ? 'approved' : 'sent back';
    await db.collection('timesheets').updateOne(
      { id: sheet.id },
      { $set: { status, comments: comments || null, actioned_by: req.user.email, actioned_by_name: req.user.full_name, actioned_at: new Date(), updated_at: new Date() } }
    );
    createNotification({
      userEmail: sheet.user_email,
      type: `timesheet_${status}`,
      title: `Timesheet ${verb}`,
      message: `Your timesheet for the week of ${sheet.week_start} was ${verb} by ${req.user.full_name}${comments ? `: ${comments}` : ''}`,
      actionUrl: `/timesheets?week=${sheet.week_start}`,
      metadata: { timesheet_id: sheet.id }
    }).catch(() => {});
    res.json(await db.collection('timesheets').findOne({ id: sheet.id }, { projection: { _id: 0 } }));
  } catch (error) {
    console.error('Timesheet action error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= REPORT =============

/**
 * GET /api/timesheets/report?from=&to=&project_id=&status=approved|all
 * Employees see their own hours, managers their team's, admins everyone's.
 */
router.get('/report', async (req, res) => {
  try {
    const db = getDB();
    const { from, to, project_id: projectId } = req.query;
    if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) {
      return res.status(400).json({ detail: 'Provide from and to dates (YYYY-MM-DD)' });
    }
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 370) {
      return res.status(400).json({ detail: 'Date range can be at most one year' });
    }

    const filter = { date: { $gte: from, $lte: to } };
    if (projectId) filter.project_id = projectId;
    if (req.user.role === 'employee') {
      filter.user_email = req.user.email;
    } else {
      const emails = await teamEmails(db, req.user);
      if (emails) filter.user_email = { $in: [...emails, req.user.email] };
    }

    let entries = await db.collection('timesheet_entries').find(filter, { projection: { _id: 0 } }).sort({ date: 1 }).toArray();
    if (req.query.status === 'approved') {
      const sheets = await db.collection('timesheets').find({ status: 'approved' }, { projection: { employee_uid: 1, week_start: 1 } }).toArray();
      const approved = new Set(sheets.map(s => `${s.employee_uid}|${s.week_start}`));
      entries = entries.filter(e => approved.has(`${e.employee_uid}|${e.week_start}`));
    }

    const sum = (key) => {
      const map = {};
      for (const e of entries) {
        const k = e[key];
        map[k] = map[k] || { minutes: 0, billable_minutes: 0 };
        map[k].minutes += e.minutes;
        if (e.billable) map[k].billable_minutes += e.minutes;
      }
      return map;
    };
    const byProject = sum('project_name');
    const byEmployee = sum('employee_name');

    res.json({
      from,
      to,
      total_minutes: entries.reduce((s, e) => s + e.minutes, 0),
      billable_minutes: entries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0),
      by_project: Object.entries(byProject).map(([project, v]) => ({ project, ...v })).sort((a, b) => b.minutes - a.minutes),
      by_employee: Object.entries(byEmployee).map(([employee, v]) => ({ employee, ...v })).sort((a, b) => b.minutes - a.minutes),
      entries
    });
  } catch (error) {
    console.error('Timesheet report error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
