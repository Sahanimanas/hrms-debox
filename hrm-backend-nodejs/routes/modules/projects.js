/**
 * projects module (Xeno PM) — mounted at /api/v2/projects
 *
 * Project & work management alongside the HRMS, modelled on the common
 * feature set of Jira / Linear / Asana / ClickUp / monday.com:
 *   - projects from templates (Kanban, Scrum, bug tracking, business) with
 *     editable workflows, labels, members and project roles
 *   - tasks / bugs / stories / epics with sub-tasks, checklists, dependencies,
 *     priorities, estimates, story points, watchers, comments and @mentions
 *   - board / list / calendar / timeline views (frontend), bulk edits, search
 *   - sprints (backlog, start, complete with carry-over), milestones, docs
 *   - activity feed, reports (burndown, velocity, flow, cycle time)
 *
 * HR integration:
 *   - members come from the employee directory; exited employees drop out
 *   - workload uses HR shifts, holidays and leaves for real capacity, and
 *     assigning work during someone's approved leave returns a warning
 *   - time logged on tasks flows into HR weekly timesheets (draft entries)
 *   - in-app notifications use the HR notification centre
 *
 * Collections: pm_projects, pm_tasks, pm_comments, pm_worklogs, pm_sprints,
 * pm_milestones, pm_docs, pm_activity, pm_user_prefs (+ timesheet `projects`
 * / `timesheet_entries` / `timesheets` via services/projects/timesheetSync.js).
 */
const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { emitEvent } = require('../../services/events');
const {
  PROJECT_ROLES, PROJECT_STATUSES, TASK_TYPES, PRIORITIES, STATUS_CATEGORIES, COLORS, TEMPLATES,
  templateLabels, stripId, httpError, escapeRegex, addDays, actorOf,
  projectRole, visibleProjectsFilter, loadProject, loadTask, loadPeople, personName,
  logActivity, notifyPeople, extractMentions
} = require('../../services/projects/common');
const { ensureTimesheetProject, syncWorklog, unsyncWorklog } = require('../../services/projects/timesheetSync');
const { workload, projectReport, leaveConflicts } = require('../../services/projects/insights');

router.get('/health', (req, res) => res.json({ module: 'projects', status: 'ok' }));

// ============= INDEXES / AUTH =============

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('pm_projects').createIndex({ id: 1 }, { unique: true }),
    db.collection('pm_projects').createIndex({ key: 1 }, { unique: true }),
    db.collection('pm_projects').createIndex({ 'members.email': 1 }),
    db.collection('pm_tasks').createIndex({ id: 1 }, { unique: true }),
    db.collection('pm_tasks').createIndex({ project_id: 1, number: 1 }, { unique: true }),
    db.collection('pm_tasks').createIndex({ project_id: 1, status: 1, position: 1 }),
    db.collection('pm_tasks').createIndex({ assignee_email: 1, status_category: 1 }),
    db.collection('pm_tasks').createIndex({ parent_id: 1 }),
    db.collection('pm_tasks').createIndex({ sprint_id: 1 }),
    db.collection('pm_comments').createIndex({ task_id: 1, created_at: 1 }),
    db.collection('pm_worklogs').createIndex({ task_id: 1, date: -1 }),
    db.collection('pm_worklogs').createIndex({ project_id: 1 }),
    db.collection('pm_worklogs').createIndex({ user_email: 1, date: 1 }),
    db.collection('pm_sprints').createIndex({ project_id: 1, status: 1 }),
    db.collection('pm_milestones').createIndex({ project_id: 1, due_date: 1 }),
    db.collection('pm_docs').createIndex({ project_id: 1, updated_at: -1 }),
    db.collection('pm_activity').createIndex({ project_id: 1, at: -1 }),
    db.collection('pm_activity').createIndex({ task_id: 1, at: -1 }),
    db.collection('pm_user_prefs').createIndex({ email: 1 }, { unique: true })
  ]);
  indexesReady = true;
};

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Projects index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

const handle = (label, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || '';
      return res.status(409).json({ detail: field === 'key' ? 'A project with this key already exists' : 'Duplicate record' });
    }
    if (error.status) return res.status(error.status).json({ detail: error.message });
    console.error(`${label} error:`, error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

// ============= SCHEMAS =============

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = () => Joi.string().pattern(DATE).allow(null, '');
const color = () => Joi.string().pattern(/^#[0-9a-fA-F]{6}$/);
const email = () => Joi.string().email().lowercase().trim();

const schemas = {
  projectCreate: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    key: Joi.string().trim().uppercase().pattern(/^[A-Z][A-Z0-9]{1,9}$/).required()
      .messages({ 'string.pattern.base': 'Key must be 2-10 letters/digits and start with a letter' }),
    description: Joi.string().trim().max(5000).allow('', null),
    template: Joi.string().valid(...Object.keys(TEMPLATES)).default('kanban'),
    color: color().default(COLORS[1]),
    visibility: Joi.string().valid('private', 'organization').default('private'),
    lead_email: email().allow(null, ''),
    member_emails: Joi.array().items(email()).max(200).default([]),
    start_date: date(),
    due_date: date(),
    client: Joi.string().trim().max(100).allow('', null),
    budget_hours: Joi.number().min(0).max(1000000).allow(null),
    billable: Joi.boolean().default(true)
  }),
  projectUpdate: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    description: Joi.string().trim().max(5000).allow('', null),
    color: color(),
    status: Joi.string().valid(...PROJECT_STATUSES),
    visibility: Joi.string().valid('private', 'organization'),
    methodology: Joi.string().valid('kanban', 'scrum'),
    lead_email: email(),
    start_date: date(),
    due_date: date(),
    client: Joi.string().trim().max(100).allow('', null),
    budget_hours: Joi.number().min(0).max(1000000).allow(null),
    billable: Joi.boolean(),
    archived: Joi.boolean()
  }).min(1),
  member: Joi.object({
    email: email().required(),
    role: Joi.string().valid(...PROJECT_ROLES).default('member')
  }),
  memberRole: Joi.object({ role: Joi.string().valid(...PROJECT_ROLES).required() }),
  statuses: Joi.object({
    statuses: Joi.array().items(Joi.object({
      key: Joi.string().trim().pattern(/^[a-z0-9_]{1,30}$/).allow('', null),
      label: Joi.string().trim().min(1).max(40).required(),
      category: Joi.string().valid(...STATUS_CATEGORIES).required(),
      color: color().default('#64748b')
    })).min(2).max(15).required(),
    remap: Joi.object().pattern(Joi.string(), Joi.string()).default({})
  }),
  labels: Joi.object({
    labels: Joi.array().items(Joi.object({
      id: Joi.string().allow('', null),
      name: Joi.string().trim().min(1).max(30).required(),
      color: color().default('#64748b')
    })).max(50).required()
  }),
  taskCreate: Joi.object({
    title: Joi.string().trim().min(1).max(250).required(),
    description: Joi.string().max(50000).allow('', null),
    type: Joi.string().valid(...TASK_TYPES),
    status: Joi.string().max(30),
    priority: Joi.string().valid(...PRIORITIES).default('medium'),
    assignee_email: email().allow(null, ''),
    start_date: date(),
    due_date: date(),
    estimate_hours: Joi.number().min(0).max(10000).allow(null),
    story_points: Joi.number().min(0).max(1000).allow(null),
    label_ids: Joi.array().items(Joi.string()).max(20).default([]),
    parent_id: Joi.string().allow(null, ''),
    sprint_id: Joi.string().allow(null, ''),
    milestone_id: Joi.string().allow(null, '')
  }),
  taskUpdate: Joi.object({
    title: Joi.string().trim().min(1).max(250),
    description: Joi.string().max(50000).allow('', null),
    type: Joi.string().valid(...TASK_TYPES),
    status: Joi.string().max(30),
    priority: Joi.string().valid(...PRIORITIES),
    assignee_email: email().allow(null, ''),
    start_date: date(),
    due_date: date(),
    estimate_hours: Joi.number().min(0).max(10000).allow(null),
    story_points: Joi.number().min(0).max(1000).allow(null),
    label_ids: Joi.array().items(Joi.string()).max(20),
    parent_id: Joi.string().allow(null, ''),
    sprint_id: Joi.string().allow(null, ''),
    milestone_id: Joi.string().allow(null, ''),
    blocked_by: Joi.array().items(Joi.string()).max(50),
    checklist: Joi.array().items(Joi.object({
      id: Joi.string().allow('', null),
      text: Joi.string().trim().min(1).max(300).required(),
      done: Joi.boolean().default(false)
    })).max(100)
  }).min(1),
  move: Joi.object({
    status: Joi.string().max(30).required(),
    position: Joi.number().required(),
    sprint_id: Joi.string().allow(null, '')
  }),
  bulk: Joi.object({
    task_ids: Joi.array().items(Joi.string()).min(1).max(200).required(),
    action: Joi.string().valid('update', 'delete').default('update'),
    changes: Joi.object({
      status: Joi.string().max(30),
      priority: Joi.string().valid(...PRIORITIES),
      assignee_email: email().allow(null, ''),
      sprint_id: Joi.string().allow(null, ''),
      milestone_id: Joi.string().allow(null, ''),
      due_date: date()
    }).default({})
  }),
  comment: Joi.object({ body: Joi.string().trim().min(1).max(10000).required() }),
  worklog: Joi.object({
    date: Joi.string().pattern(DATE),
    minutes: Joi.number().integer().min(1).max(1440).required(),
    note: Joi.string().trim().max(500).allow('', null),
    billable: Joi.boolean()
  }),
  sprint: Joi.object({
    name: Joi.string().trim().min(1).max(80),
    goal: Joi.string().trim().max(1000).allow('', null),
    start_date: date(),
    end_date: date()
  }),
  sprintComplete: Joi.object({ move_to: Joi.string().default('backlog') }),
  milestone: Joi.object({
    name: Joi.string().trim().min(1).max(120),
    description: Joi.string().trim().max(2000).allow('', null),
    due_date: date(),
    status: Joi.string().valid('open', 'done')
  }),
  doc: Joi.object({
    title: Joi.string().trim().min(1).max(150),
    body: Joi.string().max(200000).allow(''),
    pinned: Joi.boolean()
  })
};

// ============= HELPERS =============

const today = () => new Date().toISOString().slice(0, 10);
const blank = (v) => (v === '' || v === undefined ? null : v);
const statusMap = (project) => Object.fromEntries((project.statuses || []).map(s => [s.key, s]));
const firstStatus = (project, category = 'todo') =>
  (project.statuses || []).find(s => s.category === category) || project.statuses[0];
const projectBrief = (p) => ({ id: p.id, key: p.key, name: p.name, color: p.color });
const taskUrl = (project, task) => `/pm/projects/${project.id}?task=${task.id}`;

/** Board / list shape: no description, checklist summarised. */
const liteTask = (t) => {
  const { description, checklist, ...rest } = t;
  return {
    ...rest,
    has_description: !!description,
    checklist_total: checklist?.length || 0,
    checklist_done: checklist?.filter(c => c.done).length || 0
  };
};

const slug = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'status';

const assignableEmails = (project) => new Set([project.lead_email, ...(project.members || []).filter(m => m.role !== 'viewer').map(m => m.email)].filter(Boolean));

/**
 * Make sure `email` can be assigned work in `project`. Project admins
 * implicitly add a non-member as a 'member'; others get a 400.
 * Returns the (possibly updated) project.
 */
const ensureAssignable = async (db, project, role, email) => {
  if (!email || assignableEmails(project).has(email)) return project;
  const people = await loadPeople(db, [email]);
  const person = people.get(email);
  if (!person) throw httpError(400, `${email} is not an active employee`);
  if (role !== 'admin') throw httpError(400, `${person.name} is not a member of this project`);
  const members = [...(project.members || []).filter(m => m.email !== email), { email, name: person.name, role: 'member', added_at: new Date() }];
  await db.collection('pm_projects').updateOne({ id: project.id }, { $set: { members, updated_at: new Date() } });
  const updated = { ...project, members };
  ensureTimesheetProject(db, updated).catch(err => console.error('[projects] timesheet project sync failed:', err.message));
  return updated;
};

/** Warnings for assigning `email` work on dates that fall in approved / pending leave. */
const leaveWarnings = async (db, email, name, dates) => {
  const conflicts = await leaveConflicts(db, email, dates);
  return conflicts.map(c => `${name || email} is ${c.status === 'approved' ? 'on leave' : 'requesting leave'} on ${c.date}${c.type ? ` (${c.type})` : ''}`);
};

const validateRefs = async (db, project, { parent_id, sprint_id, milestone_id, label_ids, blocked_by }, taskId = null) => {
  if (parent_id) {
    const parent = await db.collection('pm_tasks').findOne({ id: parent_id, project_id: project.id }, { projection: { id: 1, parent_id: 1 } });
    if (!parent) throw httpError(400, 'Parent task not found in this project');
    if (parent.id === taskId) throw httpError(400, 'A task cannot be its own parent');
    if (parent.parent_id) throw httpError(400, 'Sub-tasks cannot have their own sub-tasks');
    if (taskId && await db.collection('pm_tasks').findOne({ parent_id: taskId })) throw httpError(400, 'A task with sub-tasks cannot become a sub-task');
  }
  if (sprint_id) {
    const sprint = await db.collection('pm_sprints').findOne({ id: sprint_id, project_id: project.id });
    if (!sprint) throw httpError(400, 'Sprint not found in this project');
    if (sprint.status === 'completed') throw httpError(400, 'That sprint is already completed');
  }
  if (milestone_id && !await db.collection('pm_milestones').findOne({ id: milestone_id, project_id: project.id })) {
    throw httpError(400, 'Milestone not found in this project');
  }
  if (label_ids?.length) {
    const known = new Set((project.labels || []).map(l => l.id));
    if (label_ids.some(id => !known.has(id))) throw httpError(400, 'Unknown label');
  }
  if (blocked_by?.length) {
    if (blocked_by.includes(taskId)) throw httpError(400, 'A task cannot block itself');
    const found = await db.collection('pm_tasks').countDocuments({ id: { $in: blocked_by }, project_id: project.id });
    if (found !== new Set(blocked_by).size) throw httpError(400, 'Dependencies must be tasks in this project');
  }
};

const nextPosition = async (db, projectId, status) => {
  const last = await db.collection('pm_tasks').find({ project_id: projectId, status }, { projection: { position: 1 } }).sort({ position: -1 }).limit(1).toArray();
  return (last[0]?.position || 0) + 1024;
};

const humanField = { type: 'type', priority: 'priority', start_date: 'start date', due_date: 'due date', estimate_hours: 'estimate', story_points: 'story points' };

/**
 * Apply a partial update to a task: validation, status transitions,
 * activity, notifications and leave warnings. Used by PUT, move and bulk.
 */
const applyTaskUpdate = async (db, user, project, role, task, changes) => {
  const actor = actorOf(user);
  const statuses = statusMap(project);
  const set = {};
  const activity = [];
  const warnings = [];
  const now = new Date();

  if (changes.title !== undefined && changes.title !== task.title) {
    set.title = changes.title;
    activity.push(['renamed', changes.title]);
  }
  if (changes.description !== undefined && (changes.description || '') !== (task.description || '')) {
    set.description = changes.description || '';
    activity.push(['updated the description']);
  }
  for (const f of ['type', 'priority', 'start_date', 'due_date', 'estimate_hours', 'story_points']) {
    if (changes[f] === undefined) continue;
    const value = blank(changes[f]);
    if (value === (task[f] ?? null)) continue;
    set[f] = value;
    activity.push([`changed ${humanField[f]}`, `${task[f] ?? '—'} → ${value ?? '—'}`]);
  }
  const start = set.start_date !== undefined ? set.start_date : task.start_date;
  const due = set.due_date !== undefined ? set.due_date : task.due_date;
  if (start && due && start > due) throw httpError(400, 'Start date must be on or before the due date');

  if (changes.status !== undefined && changes.status !== task.status) {
    const next = statuses[changes.status];
    if (!next) throw httpError(400, 'Unknown status for this project');
    set.status = next.key;
    set.status_category = next.category;
    if (next.category === 'done' && task.status_category !== 'done') set.completed_at = now;
    if (next.category !== 'done') set.completed_at = null;
    if (next.category === 'in_progress' && !task.started_at) set.started_at = now;
    activity.push(['moved', `${statuses[task.status]?.label || task.status} → ${next.label}`]);
  }

  const refs = {};
  for (const f of ['parent_id', 'sprint_id', 'milestone_id']) {
    if (changes[f] !== undefined && blank(changes[f]) !== (task[f] ?? null)) refs[f] = blank(changes[f]);
  }
  if (changes.label_ids !== undefined) refs.label_ids = [...new Set(changes.label_ids)];
  if (changes.blocked_by !== undefined) refs.blocked_by = [...new Set(changes.blocked_by)];
  await validateRefs(db, project, refs, task.id);
  Object.assign(set, refs);
  if (refs.sprint_id !== undefined) activity.push([refs.sprint_id ? 'added to a sprint' : 'moved to the backlog']);
  if (refs.parent_id !== undefined) {
    activity.push([refs.parent_id ? 'made a sub-task' : 'promoted to a task']);
    if (refs.parent_id && changes.type === undefined) set.type = 'subtask';
    if (!refs.parent_id && task.type === 'subtask' && changes.type === undefined) set.type = 'task';
  }
  if (refs.blocked_by !== undefined) activity.push(['updated dependencies']);

  if (changes.checklist !== undefined) {
    set.checklist = changes.checklist.map(c => ({ id: c.id || generateUUID(), text: c.text, done: !!c.done }));
  }
  if (changes.position !== undefined) set.position = changes.position;

  let assigneeChanged = false;
  if (changes.assignee_email !== undefined && blank(changes.assignee_email) !== (task.assignee_email ?? null)) {
    const next = blank(changes.assignee_email);
    if (next) {
      project = await ensureAssignable(db, project, role, next);
      set.assignee_email = next;
      set.assignee_name = await personName(db, next);
      set.watchers = [...new Set([...(task.watchers || []), next])];
    } else {
      set.assignee_email = null;
      set.assignee_name = null;
    }
    assigneeChanged = true;
    activity.push([next ? 'assigned' : 'unassigned', next ? set.assignee_name : task.assignee_name]);
  }

  if (!Object.keys(set).length) return { task, warnings, project };
  set.updated_at = now;
  await db.collection('pm_tasks').updateOne({ id: task.id }, { $set: set });
  const updated = await db.collection('pm_tasks').findOne({ id: task.id }, { projection: { _id: 0 } });

  for (const [action, detail] of activity) {
    logActivity(db, { project_id: project.id, task_id: task.id, task_key: task.key, actor, action, detail: detail || null });
  }

  const label = `${updated.key}: ${updated.title}`;
  if (assigneeChanged && updated.assignee_email) {
    notifyPeople(db, [updated.assignee_email], user.email, {
      title: 'Task assigned to you',
      message: `${actor.name} assigned you ${label}`,
      actionUrl: taskUrl(project, updated),
      metadata: { project_id: project.id, task_id: updated.id }
    });
  }
  if (set.status) {
    notifyPeople(db, [...(updated.watchers || []), updated.reporter_email, updated.assignee_email], user.email, {
      title: `${updated.key} moved to ${statuses[set.status].label}`,
      message: `${actor.name} moved ${label} to ${statuses[set.status].label}`,
      actionUrl: taskUrl(project, updated),
      metadata: { project_id: project.id, task_id: updated.id }
    });
    if (set.status_category === 'done') {
      emitEvent('project.task.completed', { project: projectBrief(project), task: { id: updated.id, key: updated.key, title: updated.title, assignee_email: updated.assignee_email } }, { actor: user.email });
    }
  }

  if (updated.assignee_email && updated.status_category !== 'done' && (assigneeChanged || set.due_date !== undefined || set.start_date !== undefined)) {
    warnings.push(...await leaveWarnings(db, updated.assignee_email, updated.assignee_name, [updated.start_date, updated.due_date]));
  }
  return { task: updated, warnings, project };
};

/** Delete tasks (and their sub-tasks, comments, worklogs); unsync editable timesheet entries. */
const deleteTasks = async (db, project, ids) => {
  const subtasks = await db.collection('pm_tasks').find({ parent_id: { $in: ids } }, { projection: { id: 1 } }).toArray();
  const all = [...new Set([...ids, ...subtasks.map(s => s.id)])];
  const worklogs = await db.collection('pm_worklogs').find({ task_id: { $in: all } }).toArray();
  for (const w of worklogs) await unsyncWorklog(db, w);
  await Promise.all([
    db.collection('pm_tasks').deleteMany({ id: { $in: all }, project_id: project.id }),
    db.collection('pm_comments').deleteMany({ task_id: { $in: all } }),
    db.collection('pm_worklogs').deleteMany({ task_id: { $in: all } }),
    db.collection('pm_tasks').updateMany({ project_id: project.id, blocked_by: { $in: all } }, { $pull: { blocked_by: { $in: all } } })
  ]);
  return all.length;
};

/** Task counts per project id: { total, done, overdue }. */
const projectStats = async (db, projectIds) => {
  const rows = await db.collection('pm_tasks').aggregate([
    { $match: { project_id: { $in: projectIds } } },
    {
      $group: {
        _id: '$project_id',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status_category', 'done'] }, 1, 0] } },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$status_category', 'done'] }, { $ne: ['$due_date', null] }, { $lt: ['$due_date', today()] }] }, 1, 0] } }
      }
    }
  ]).toArray();
  return Object.fromEntries(rows.map(r => [r._id, { total: r.total, done: r.done, overdue: r.overdue }]));
};

const getFavorites = async (db, email) => (await db.collection('pm_user_prefs').findOne({ email }))?.favorites || [];

const visibleProjects = async (db, user, { includeArchived = false } = {}) => {
  const filter = visibleProjectsFilter(user);
  if (!includeArchived) filter.archived = { $ne: true };
  return db.collection('pm_projects').find(filter, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
};

const decorateProject = (project, user, stats, favorites) => ({
  ...project,
  my_role: projectRole(project, user),
  favorite: favorites.includes(project.id),
  stats: stats[project.id] || { total: 0, done: 0, overdue: 0 }
});

// ============= DIRECTORY / OVERVIEW / SEARCH =============

router.get('/people', handle('PM people', async (req, res) => {
  const people = await loadPeople(getDB());
  res.json([...people.values()].sort((a, b) => a.name.localeCompare(b.name)));
}));

router.get('/meta', (req, res) => res.json({
  templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, methodology: t.methodology, statuses: t.statuses, labels: t.labels })),
  task_types: TASK_TYPES,
  priorities: PRIORITIES,
  project_statuses: PROJECT_STATUSES,
  colors: COLORS,
  can_create_projects: ['admin', 'manager'].includes(req.user.role)
}));

/** PM home: my work, project health, milestones and recent activity. */
router.get('/overview', handle('PM overview', async (req, res) => {
  const db = getDB();
  const projects = await visibleProjects(db, req.user);
  const ids = projects.map(p => p.id);
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const t = today();
  const weekEnd = addDays(t, 7);

  const [stats, favorites, mine, activity, milestones] = await Promise.all([
    projectStats(db, ids),
    getFavorites(db, req.user.email),
    db.collection('pm_tasks').find(
      { project_id: { $in: ids }, assignee_email: req.user.email, status_category: { $ne: 'done' } },
      { projection: { _id: 0, description: 0, checklist: 0 } }
    ).toArray(),
    db.collection('pm_activity').find({ project_id: { $in: ids } }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(25).toArray(),
    db.collection('pm_milestones').find({ project_id: { $in: ids }, status: 'open', due_date: { $ne: null, $lte: addDays(t, 45) } }, { projection: { _id: 0 } }).sort({ due_date: 1 }).limit(10).toArray()
  ]);
  const doneThisWeek = await db.collection('pm_tasks').countDocuments({ project_id: { $in: ids }, assignee_email: req.user.email, completed_at: { $gte: new Date(Date.now() - 7 * 86400000) } });

  const withProject = (task) => {
    const p = byId[task.project_id];
    const s = statusMap(p)[task.status];
    return { ...task, project: projectBrief(p), status_label: s?.label || task.status, status_color: s?.color };
  };
  mine.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));

  res.json({
    my: {
      open: mine.length,
      overdue: mine.filter(x => x.due_date && x.due_date < t).length,
      due_today: mine.filter(x => x.due_date === t).length,
      due_this_week: mine.filter(x => x.due_date && x.due_date >= t && x.due_date <= weekEnd).length,
      done_this_week: doneThisWeek,
      tasks: mine.slice(0, 12).map(withProject)
    },
    projects: projects.map(p => decorateProject(p, req.user, stats, favorites)),
    milestones: milestones.map(m => ({ ...m, project: projectBrief(byId[m.project_id]) })),
    activity: activity.map(a => ({ ...a, project: byId[a.project_id] ? projectBrief(byId[a.project_id]) : null }))
  });
}));

router.get('/search', handle('PM search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ projects: [], tasks: [] });
  const db = getDB();
  const projects = await visibleProjects(db, req.user);
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const re = new RegExp(escapeRegex(q), 'i');
  const tasks = await db.collection('pm_tasks').find(
    { project_id: { $in: projects.map(p => p.id) }, $or: [{ title: re }, { key: re }] },
    { projection: { _id: 0, id: 1, key: 1, title: 1, project_id: 1, status: 1, status_category: 1, assignee_name: 1 } }
  ).limit(20).toArray();
  res.json({
    projects: projects.filter(p => re.test(p.name) || re.test(p.key)).slice(0, 8).map(projectBrief),
    tasks: tasks.map(x => ({ ...x, project: projectBrief(byId[x.project_id]), status_label: statusMap(byId[x.project_id])[x.status]?.label }))
  });
}));

/** Tasks across projects: scope=assigned (default) | created | watching. */
router.get('/my-tasks', handle('PM my tasks', async (req, res) => {
  const db = getDB();
  const projects = await visibleProjects(db, req.user);
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const scope = req.query.scope || 'assigned';
  const filter = { project_id: { $in: projects.map(p => p.id) } };
  if (scope === 'created') filter.reporter_email = req.user.email;
  else if (scope === 'watching') filter.watchers = req.user.email;
  else filter.assignee_email = req.user.email;
  if (req.query.include_done !== 'true') filter.status_category = { $ne: 'done' };
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 500);

  const tasks = await db.collection('pm_tasks').find(filter, { projection: { _id: 0 } }).sort({ due_date: 1, updated_at: -1 }).limit(limit).toArray();
  res.json(tasks.map(x => {
    const s = statusMap(byId[x.project_id])[x.status];
    return { ...liteTask(x), project: projectBrief(byId[x.project_id]), status_label: s?.label || x.status, status_color: s?.color };
  }));
}));

/** Team workload with HR capacity (shifts, holidays, leave). */
router.get('/workload', handle('PM workload', async (req, res) => {
  const db = getDB();
  const from = DATE.test(req.query.from || '') ? req.query.from : today();
  let to = DATE.test(req.query.to || '') ? req.query.to : addDays(from, 13);
  if (to < from) throw httpError(400, '"to" must be after "from"');
  if (addDays(from, 92) < to) to = addDays(from, 92);

  let projects;
  if (req.query.project_id) projects = [(await loadProject(db, req.user, req.query.project_id)).project];
  else {
    projects = await visibleProjects(db, req.user);
    // Employees see workload only for projects they belong to
    if (req.user.role === 'employee') projects = projects.filter(p => ['admin', 'member'].includes(projectRole(p, req.user)));
  }
  res.json(await workload(db, { projects, from, to }));
}));

// ============= PROJECTS =============

router.get('/projects', handle('List PM projects', async (req, res) => {
  const db = getDB();
  const projects = await visibleProjects(db, req.user, { includeArchived: req.query.archived === 'true' });
  const [stats, favorites] = await Promise.all([projectStats(db, projects.map(p => p.id)), getFavorites(db, req.user.email)]);
  let list = projects.map(p => decorateProject(p, req.user, stats, favorites));
  if (req.query.archived === 'true') list = list.filter(p => p.archived);
  if (req.query.mine === 'true') list = list.filter(p => p.lead_email === req.user.email || (p.members || []).some(m => m.email === req.user.email));
  res.json(list);
}));

router.post('/projects', requireRole(['admin', 'manager']), validate(schemas.projectCreate), handle('Create PM project', async (req, res) => {
  const db = getDB();
  const body = req.validatedBody;
  const template = TEMPLATES[body.template];
  if (body.start_date && body.due_date && body.start_date > body.due_date) throw httpError(400, 'Start date must be before the due date');
  if (await db.collection('pm_projects').findOne({ key: body.key })) throw httpError(409, `Project key ${body.key} is already used`);

  const leadEmail = blank(body.lead_email) || req.user.email;
  const wanted = [...new Set([req.user.email, leadEmail, ...body.member_emails])];
  const people = await loadPeople(db, wanted);
  const unknown = wanted.filter(e => !people.has(e) && e !== req.user.email);
  if (unknown.length) throw httpError(400, `Not active employees: ${unknown.join(', ')}`);

  const now = new Date();
  const members = wanted.map(e => ({
    email: e,
    name: people.get(e)?.name || req.user.full_name || e,
    role: e === req.user.email || e === leadEmail ? 'admin' : 'member',
    added_at: now
  }));
  const project = {
    id: generateUUID(),
    key: body.key,
    name: body.name,
    description: body.description || '',
    color: body.color,
    template: body.template,
    methodology: template.methodology,
    status: 'active',
    visibility: body.visibility,
    lead_email: leadEmail,
    members,
    statuses: template.statuses.map(s => ({ ...s })),
    labels: templateLabels(template.labels),
    start_date: blank(body.start_date),
    due_date: blank(body.due_date),
    client: body.client || null,
    budget_hours: body.budget_hours ?? null,
    billable: body.billable,
    task_seq: 0,
    archived: false,
    created_by: req.user.email,
    created_at: now,
    updated_at: now
  };
  await db.collection('pm_projects').insertOne(project);
  try {
    project.timesheet_project_id = await ensureTimesheetProject(db, project);
    await db.collection('pm_projects').updateOne({ id: project.id }, { $set: { timesheet_project_id: project.timesheet_project_id } });
  } catch (error) {
    console.error('[projects] timesheet project creation failed:', error.message);
  }

  const actor = actorOf(req.user);
  logActivity(db, { project_id: project.id, actor, action: 'created the project', detail: project.name });
  notifyPeople(db, members.map(m => m.email), req.user.email, {
    title: `Added to ${project.name}`,
    message: `${actor.name} added you to the project ${project.key} · ${project.name}`,
    actionUrl: `/pm/projects/${project.id}`,
    metadata: { project_id: project.id }
  });
  emitEvent('project.created', projectBrief(project), { actor: req.user.email });
  res.status(201).json(decorateProject(stripId(project), req.user, {}, []));
}));

router.get('/projects/:id', handle('Get PM project', async (req, res) => {
  const db = getDB();
  const { project, role } = await loadProject(db, req.user, req.params.id);
  const emails = [...new Set([project.lead_email, ...(project.members || []).map(m => m.email)])];
  const [stats, favorites, people] = await Promise.all([projectStats(db, [project.id]), getFavorites(db, req.user.email), loadPeople(db, emails)]);
  res.json({
    ...decorateProject(project, req.user, stats, favorites),
    my_role: role,
    members: (project.members || []).map(m => ({ ...m, ...(people.get(m.email) || {}), role: m.role, active: people.has(m.email) }))
  });
}));

router.put('/projects/:id', validate(schemas.projectUpdate), handle('Update PM project', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'admin');
  const body = req.validatedBody;
  const set = { updated_at: new Date() };
  for (const [k, v] of Object.entries(body)) set[k] = ['start_date', 'due_date'].includes(k) ? blank(v) : v;
  const start = set.start_date !== undefined ? set.start_date : project.start_date;
  const due = set.due_date !== undefined ? set.due_date : project.due_date;
  if (start && due && start > due) throw httpError(400, 'Start date must be before the due date');

  if (body.lead_email && body.lead_email !== project.lead_email) {
    const lead = (await loadPeople(db, [body.lead_email])).get(body.lead_email);
    if (!lead) throw httpError(400, 'Lead must be an active employee');
    set.members = [...(project.members || []).filter(m => m.email !== body.lead_email), { email: body.lead_email, name: lead.name, role: 'admin', added_at: new Date() }];
  }
  await db.collection('pm_projects').updateOne({ id: project.id }, { $set: set });
  const updated = await db.collection('pm_projects').findOne({ id: project.id }, { projection: { _id: 0 } });
  ensureTimesheetProject(db, updated).catch(err => console.error('[projects] timesheet project sync failed:', err.message));

  const actor = actorOf(req.user);
  if (body.archived !== undefined && body.archived !== !!project.archived) {
    logActivity(db, { project_id: project.id, actor, action: body.archived ? 'archived the project' : 'restored the project' });
  } else {
    logActivity(db, { project_id: project.id, actor, action: 'updated project settings', detail: Object.keys(body).join(', ') });
  }
  res.json(decorateProject(updated, req.user, await projectStats(db, [project.id]), await getFavorites(db, req.user.email)));
}));

/** Permanent delete: global admins, or the project's creator. */
router.delete('/projects/:id', handle('Delete PM project', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'admin');
  if (req.user.role !== 'admin' && project.created_by !== req.user.email) throw httpError(403, 'Only an administrator or the project creator can delete a project');
  const pid = project.id;
  await Promise.all(['pm_tasks', 'pm_comments', 'pm_worklogs', 'pm_sprints', 'pm_milestones', 'pm_docs', 'pm_activity']
    .map(c => db.collection(c).deleteMany({ project_id: pid })));
  await db.collection('pm_projects').deleteOne({ id: pid });
  await db.collection('pm_user_prefs').updateMany({ favorites: pid }, { $pull: { favorites: pid } });
  // Keep HR timesheet history; just retire the mirrored timesheet project
  if (project.timesheet_project_id) await db.collection('projects').updateOne({ id: project.timesheet_project_id }, { $set: { status: 'archived', updated_at: new Date() } });
  res.json({ status: 'deleted' });
}));

router.post('/projects/:id/favorite', handle('Toggle PM favorite', async (req, res) => {
  const db = getDB();
  await loadProject(db, req.user, req.params.id);
  const favorites = await getFavorites(db, req.user.email);
  const on = !favorites.includes(req.params.id);
  await db.collection('pm_user_prefs').updateOne(
    { email: req.user.email },
    on ? { $addToSet: { favorites: req.params.id } } : { $pull: { favorites: req.params.id } },
    { upsert: true }
  );
  res.json({ favorite: on });
}));

// ----- members -----

const saveMembers = async (db, project, members) => {
  await db.collection('pm_projects').updateOne({ id: project.id }, { $set: { members, updated_at: new Date() } });
  const updated = { ...project, members };
  ensureTimesheetProject(db, updated).catch(err => console.error('[projects] timesheet project sync failed:', err.message));
  return updated;
};

router.post('/projects/:id/members', validate(schemas.member), handle('Add PM member', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'admin');
  const { email, role } = req.validatedBody;
  const person = (await loadPeople(db, [email])).get(email);
  if (!person) throw httpError(400, `${email} is not an active employee`);
  if ((project.members || []).some(m => m.email === email)) throw httpError(409, `${person.name} is already a member`);
  const updated = await saveMembers(db, project, [...(project.members || []), { email, name: person.name, role, added_at: new Date() }]);
  const actor = actorOf(req.user);
  logActivity(db, { project_id: project.id, actor, action: 'added a member', detail: `${person.name} (${role})` });
  notifyPeople(db, [email], req.user.email, {
    title: `Added to ${project.name}`,
    message: `${actor.name} added you to ${project.key} · ${project.name} as ${role}`,
    actionUrl: `/pm/projects/${project.id}`,
    metadata: { project_id: project.id }
  });
  res.status(201).json(updated.members);
}));

router.put('/projects/:id/members/:email', validate(schemas.memberRole), handle('Update PM member', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'admin');
  const email = req.params.email.toLowerCase();
  if (email === project.lead_email && req.validatedBody.role !== 'admin') throw httpError(400, 'The project lead must stay a project admin');
  const members = project.members || [];
  if (!members.some(m => m.email === email)) throw httpError(404, 'Member not found');
  const updated = await saveMembers(db, project, members.map(m => (m.email === email ? { ...m, role: req.validatedBody.role } : m)));
  logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'changed a member role', detail: `${email} → ${req.validatedBody.role}` });
  res.json(updated.members);
}));

router.delete('/projects/:id/members/:email', handle('Remove PM member', async (req, res) => {
  const db = getDB();
  const email = req.params.email.toLowerCase();
  // Anyone may leave a project; removing others needs project admin
  const { project } = await loadProject(db, req.user, req.params.id, email === req.user.email ? 'viewer' : 'admin');
  if (email === project.lead_email) throw httpError(400, 'Change the project lead before removing them');
  const members = project.members || [];
  if (!members.some(m => m.email === email)) throw httpError(404, 'Member not found');
  const updated = await saveMembers(db, project, members.filter(m => m.email !== email));
  logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: email === req.user.email ? 'left the project' : 'removed a member', detail: email });
  res.json(updated.members);
}));

// ----- workflow & labels -----

router.put('/projects/:id/statuses', validate(schemas.statuses), handle('Update PM workflow', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'admin');
  const { statuses: input, remap } = req.validatedBody;

  const used = new Set();
  const statuses = input.map(s => {
    let key = s.key || slug(s.label);
    while (used.has(key)) key = `${key}_${used.size}`.slice(0, 30);
    used.add(key);
    return { key, label: s.label, category: s.category, color: s.color };
  });
  if (!statuses.some(s => s.category === 'todo') || !statuses.some(s => s.category === 'done')) {
    throw httpError(400, 'The workflow needs at least one "To do" and one "Done" status');
  }

  // Tasks in removed statuses move to the remap target, else the first status of the same category
  const byKey = Object.fromEntries(statuses.map(s => [s.key, s]));
  const now = new Date();
  for (const old of project.statuses || []) {
    const target = byKey[old.key] || byKey[remap[old.key]] || statuses.find(s => s.category === old.category) || statuses[0];
    const set = { status: target.key, status_category: target.category, updated_at: now };
    if (target.category === 'done' && old.category !== 'done') set.completed_at = now;
    if (target.category !== 'done') set.completed_at = null;
    if (old.key !== target.key || old.category !== target.category) {
      await db.collection('pm_tasks').updateMany({ project_id: project.id, status: old.key }, { $set: set });
    }
  }
  await db.collection('pm_projects').updateOne({ id: project.id }, { $set: { statuses, updated_at: now } });
  logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'updated the workflow', detail: statuses.map(s => s.label).join(' → ') });
  res.json(statuses);
}));

router.put('/projects/:id/labels', validate(schemas.labels), handle('Update PM labels', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'admin');
  const labels = req.validatedBody.labels.map(l => ({ id: l.id || generateUUID(), name: l.name, color: l.color }));
  const kept = new Set(labels.map(l => l.id));
  const removed = (project.labels || []).map(l => l.id).filter(id => !kept.has(id));
  await db.collection('pm_projects').updateOne({ id: project.id }, { $set: { labels, updated_at: new Date() } });
  if (removed.length) await db.collection('pm_tasks').updateMany({ project_id: project.id }, { $pull: { label_ids: { $in: removed } } });
  res.json(labels);
}));

router.get('/projects/:id/activity', handle('PM activity', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id);
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  const filter = { project_id: project.id };
  if (req.query.before) filter.at = { $lt: new Date(req.query.before) };
  res.json(await db.collection('pm_activity').find(filter, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray());
}));

router.get('/projects/:id/reports', handle('PM reports', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id);
  res.json(await projectReport(db, project));
}));

// ============= TASKS =============

/**
 * GET /projects/:id/tasks
 * ?q= &assignee=email|me|none &status= &priority= &type= &label= &sprint=id|backlog|active
 * &milestone= &include_done=false (default true) &parent=none
 */
router.get('/projects/:id/tasks', handle('List PM tasks', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id);
  const q = req.query;
  const filter = { project_id: project.id };
  if (q.q) {
    const re = new RegExp(escapeRegex(String(q.q).trim()), 'i');
    filter.$or = [{ title: re }, { key: re }];
  }
  if (q.assignee) filter.assignee_email = q.assignee === 'me' ? req.user.email : q.assignee === 'none' ? null : q.assignee;
  for (const f of ['status', 'priority', 'type']) if (q[f]) filter[f] = { $in: String(q[f]).split(',') };
  if (q.label) filter.label_ids = q.label;
  if (q.milestone) filter.milestone_id = q.milestone;
  if (q.parent === 'none') filter.parent_id = null;
  if (q.include_done === 'false') filter.status_category = { $ne: 'done' };
  if (q.sprint === 'backlog') filter.sprint_id = null;
  else if (q.sprint === 'active') {
    const active = await db.collection('pm_sprints').findOne({ project_id: project.id, status: 'active' });
    filter.sprint_id = active ? active.id : '__none__';
  } else if (q.sprint) filter.sprint_id = q.sprint;

  const tasks = await db.collection('pm_tasks').find(filter, { projection: { _id: 0 } }).sort({ position: 1 }).limit(5000).toArray();
  const counts = await db.collection('pm_tasks').aggregate([
    { $match: { project_id: project.id, parent_id: { $ne: null } } },
    { $group: { _id: '$parent_id', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status_category', 'done'] }, 1, 0] } } } }
  ]).toArray();
  const subs = Object.fromEntries(counts.map(c => [c._id, c]));
  res.json(tasks.map(t => ({ ...liteTask(t), subtask_total: subs[t.id]?.total || 0, subtask_done: subs[t.id]?.done || 0 })));
}));

router.post('/projects/:id/tasks', validate(schemas.taskCreate), handle('Create PM task', async (req, res) => {
  const db = getDB();
  let { project, role } = await loadProject(db, req.user, req.params.id, 'member');
  const body = req.validatedBody;
  const statuses = statusMap(project);
  const status = body.status ? statuses[body.status] : firstStatus(project);
  if (!status) throw httpError(400, 'Unknown status for this project');
  if (body.start_date && body.due_date && body.start_date > body.due_date) throw httpError(400, 'Start date must be on or before the due date');

  const refs = {
    parent_id: blank(body.parent_id),
    sprint_id: blank(body.sprint_id),
    milestone_id: blank(body.milestone_id),
    label_ids: [...new Set(body.label_ids)]
  };
  await validateRefs(db, project, refs);
  const assignee = blank(body.assignee_email);
  if (assignee) project = await ensureAssignable(db, project, role, assignee);

  // Inherit sprint / milestone from the parent for sub-tasks
  if (refs.parent_id && (!refs.sprint_id || !refs.milestone_id)) {
    const parent = await db.collection('pm_tasks').findOne({ id: refs.parent_id });
    refs.sprint_id = refs.sprint_id || parent?.sprint_id || null;
    refs.milestone_id = refs.milestone_id || parent?.milestone_id || null;
  }

  const counter = await db.collection('pm_projects').findOneAndUpdate({ id: project.id }, { $inc: { task_seq: 1 } }, { returnDocument: 'after' });
  const number = counter.task_seq;
  const now = new Date();
  const task = {
    id: generateUUID(),
    project_id: project.id,
    project_key: project.key,
    number,
    key: `${project.key}-${number}`,
    title: body.title,
    description: body.description || '',
    type: body.type || (refs.parent_id ? 'subtask' : 'task'),
    status: status.key,
    status_category: status.category,
    priority: body.priority,
    assignee_email: assignee,
    assignee_name: assignee ? await personName(db, assignee) : null,
    reporter_email: req.user.email,
    reporter_name: req.user.full_name || req.user.email,
    ...refs,
    start_date: blank(body.start_date),
    due_date: blank(body.due_date),
    estimate_hours: body.estimate_hours ?? null,
    story_points: body.story_points ?? null,
    blocked_by: [],
    checklist: [],
    watchers: [...new Set([req.user.email, assignee].filter(Boolean))],
    logged_minutes: 0,
    comment_count: 0,
    position: await nextPosition(db, project.id, status.key),
    started_at: status.category === 'in_progress' ? now : null,
    completed_at: status.category === 'done' ? now : null,
    created_at: now,
    updated_at: now
  };
  await db.collection('pm_tasks').insertOne(task);

  const actor = actorOf(req.user);
  logActivity(db, { project_id: project.id, task_id: task.id, task_key: task.key, actor, action: 'created', detail: task.title });
  if (assignee) {
    notifyPeople(db, [assignee], req.user.email, {
      title: 'Task assigned to you',
      message: `${actor.name} assigned you ${task.key}: ${task.title}`,
      actionUrl: taskUrl(project, task),
      metadata: { project_id: project.id, task_id: task.id }
    });
  }
  emitEvent('project.task.created', { project: projectBrief(project), task: { id: task.id, key: task.key, title: task.title, assignee_email: assignee } }, { actor: req.user.email });

  const warnings = assignee ? await leaveWarnings(db, assignee, task.assignee_name, [task.start_date, task.due_date]) : [];
  res.status(201).json({ ...liteTask(stripId(task)), subtask_total: 0, subtask_done: 0, warnings });
}));

router.post('/projects/:id/tasks/bulk', validate(schemas.bulk), handle('Bulk PM tasks', async (req, res) => {
  const db = getDB();
  let { project, role } = await loadProject(db, req.user, req.params.id, 'member');
  const { task_ids, action, changes } = req.validatedBody;
  const tasks = await db.collection('pm_tasks').find({ id: { $in: task_ids }, project_id: project.id }, { projection: { _id: 0 } }).toArray();

  if (action === 'delete') {
    if (role !== 'admin' && tasks.some(t => t.reporter_email !== req.user.email)) throw httpError(403, 'Only project admins can delete tasks created by others');
    const deleted = await deleteTasks(db, project, tasks.map(t => t.id));
    logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'deleted tasks', detail: tasks.map(t => t.key).join(', ') });
    return res.json({ deleted });
  }

  const warnings = [];
  let updated = 0;
  for (const task of tasks) {
    const result = await applyTaskUpdate(db, req.user, project, role, task, changes);
    project = result.project;
    warnings.push(...result.warnings);
    if (result.task !== task) updated += 1;
  }
  res.json({ updated, warnings: [...new Set(warnings)] });
}));

router.get('/tasks/:id', handle('Get PM task', async (req, res) => {
  const db = getDB();
  const { task, project, role } = await loadTask(db, req.user, req.params.id);
  const brief = { projection: { _id: 0, id: 1, key: 1, title: 1, status: 1, status_category: 1, assignee_email: 1, assignee_name: 1, priority: 1, due_date: 1, type: 1 } };
  const [comments, worklogs, subtasks, blockedBy, blocking, parent, activity, sprint, milestone] = await Promise.all([
    db.collection('pm_comments').find({ task_id: task.id }, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray(),
    db.collection('pm_worklogs').find({ task_id: task.id }, { projection: { _id: 0 } }).sort({ date: -1, created_at: -1 }).toArray(),
    db.collection('pm_tasks').find({ parent_id: task.id }, brief).sort({ number: 1 }).toArray(),
    db.collection('pm_tasks').find({ id: { $in: task.blocked_by || [] } }, brief).toArray(),
    db.collection('pm_tasks').find({ blocked_by: task.id }, brief).toArray(),
    task.parent_id ? db.collection('pm_tasks').findOne({ id: task.parent_id }, brief) : null,
    db.collection('pm_activity').find({ task_id: task.id }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(50).toArray(),
    task.sprint_id ? db.collection('pm_sprints').findOne({ id: task.sprint_id }, { projection: { _id: 0, id: 1, name: 1, status: 1 } }) : null,
    task.milestone_id ? db.collection('pm_milestones').findOne({ id: task.milestone_id }, { projection: { _id: 0, id: 1, name: 1, due_date: 1 } }) : null
  ]);
  res.json({
    ...task,
    my_role: role,
    project: { ...projectBrief(project), statuses: project.statuses, labels: project.labels },
    watching: (task.watchers || []).includes(req.user.email),
    comments,
    worklogs,
    subtasks,
    blocked_by_tasks: blockedBy,
    blocking_tasks: blocking,
    parent,
    sprint,
    milestone,
    activity
  });
}));

router.put('/tasks/:id', validate(schemas.taskUpdate), handle('Update PM task', async (req, res) => {
  const db = getDB();
  const { task, project, role } = await loadTask(db, req.user, req.params.id, 'member');
  const result = await applyTaskUpdate(db, req.user, project, role, task, req.validatedBody);
  res.json({ ...result.task, warnings: result.warnings });
}));

/** Board drag & drop: status + position (+ optional sprint). */
router.post('/tasks/:id/move', validate(schemas.move), handle('Move PM task', async (req, res) => {
  const db = getDB();
  const { task, project, role } = await loadTask(db, req.user, req.params.id, 'member');
  const changes = { status: req.validatedBody.status, position: req.validatedBody.position };
  if (req.validatedBody.sprint_id !== undefined) changes.sprint_id = req.validatedBody.sprint_id;
  const result = await applyTaskUpdate(db, req.user, project, role, task, changes);
  res.json({ ...liteTask(result.task), warnings: result.warnings });
}));

router.post('/tasks/:id/watch', handle('Watch PM task', async (req, res) => {
  const db = getDB();
  const { task } = await loadTask(db, req.user, req.params.id);
  const on = !(task.watchers || []).includes(req.user.email);
  await db.collection('pm_tasks').updateOne({ id: task.id }, on ? { $addToSet: { watchers: req.user.email } } : { $pull: { watchers: req.user.email } });
  res.json({ watching: on });
}));

router.delete('/tasks/:id', handle('Delete PM task', async (req, res) => {
  const db = getDB();
  const { task, project, role } = await loadTask(db, req.user, req.params.id, 'member');
  if (role !== 'admin' && task.reporter_email !== req.user.email) throw httpError(403, 'Only the reporter or a project admin can delete this task');
  const deleted = await deleteTasks(db, project, [task.id]);
  logActivity(db, { project_id: project.id, task_key: task.key, actor: actorOf(req.user), action: 'deleted', detail: `${task.key}: ${task.title}` });
  res.json({ deleted });
}));

// ----- comments -----

router.post('/tasks/:id/comments', validate(schemas.comment), handle('Add PM comment', async (req, res) => {
  const db = getDB();
  const { task, project } = await loadTask(db, req.user, req.params.id, 'viewer');
  if (project.archived) throw httpError(409, 'This project is archived');
  const actor = actorOf(req.user);
  const mentions = extractMentions(req.validatedBody.body);
  const comment = {
    id: generateUUID(),
    task_id: task.id,
    project_id: project.id,
    author_email: actor.email,
    author_name: actor.name,
    body: req.validatedBody.body,
    mentions,
    created_at: new Date(),
    edited_at: null
  };
  await db.collection('pm_comments').insertOne(comment);
  await db.collection('pm_tasks').updateOne({ id: task.id }, { $inc: { comment_count: 1 }, $addToSet: { watchers: actor.email }, $set: { updated_at: new Date() } });
  logActivity(db, { project_id: project.id, task_id: task.id, task_key: task.key, actor, action: 'commented' });

  const label = `${task.key}: ${task.title}`;
  const meta = { actionUrl: taskUrl(project, task), metadata: { project_id: project.id, task_id: task.id, comment_id: comment.id } };
  const snippet = comment.body.length > 120 ? `${comment.body.slice(0, 117)}…` : comment.body;
  notifyPeople(db, mentions, actor.email, { title: `${actor.name} mentioned you`, message: `${label} — ${snippet}`, ...meta });
  notifyPeople(db, [...(task.watchers || []), task.assignee_email, task.reporter_email].filter(e => !mentions.includes(e)), actor.email, {
    title: `New comment on ${task.key}`, message: `${actor.name}: ${snippet}`, ...meta
  });
  res.status(201).json(stripId(comment));
}));

router.put('/comments/:id', validate(schemas.comment), handle('Edit PM comment', async (req, res) => {
  const db = getDB();
  const comment = await db.collection('pm_comments').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!comment) throw httpError(404, 'Comment not found');
  await loadTask(db, req.user, comment.task_id);
  if (comment.author_email !== req.user.email) throw httpError(403, 'You can only edit your own comments');
  const set = { body: req.validatedBody.body, mentions: extractMentions(req.validatedBody.body), edited_at: new Date() };
  await db.collection('pm_comments').updateOne({ id: comment.id }, { $set: set });
  res.json({ ...comment, ...set });
}));

router.delete('/comments/:id', handle('Delete PM comment', async (req, res) => {
  const db = getDB();
  const comment = await db.collection('pm_comments').findOne({ id: req.params.id });
  if (!comment) throw httpError(404, 'Comment not found');
  const { role } = await loadTask(db, req.user, comment.task_id);
  if (comment.author_email !== req.user.email && role !== 'admin') throw httpError(403, 'You can only delete your own comments');
  await db.collection('pm_comments').deleteOne({ id: comment.id });
  await db.collection('pm_tasks').updateOne({ id: comment.task_id }, { $inc: { comment_count: -1 } });
  res.json({ status: 'deleted' });
}));

// ----- time tracking (synced to HR timesheets) -----

router.post('/tasks/:id/worklogs', validate(schemas.worklog), handle('Log PM time', async (req, res) => {
  const db = getDB();
  const { task, project } = await loadTask(db, req.user, req.params.id, 'member');
  const body = req.validatedBody;
  const day = body.date || today();
  if (day > today()) throw httpError(400, 'You cannot log time in the future');
  const worklog = {
    id: generateUUID(),
    task_id: task.id,
    task_key: task.key,
    project_id: project.id,
    user_email: req.user.email,
    user_name: req.user.full_name || req.user.email,
    date: day,
    minutes: body.minutes,
    note: body.note || '',
    billable: body.billable ?? project.billable !== false,
    created_at: new Date()
  };
  const timesheet = await syncWorklog(db, { project, task, worklog });
  worklog.timesheet_synced = timesheet.synced;
  worklog.timesheet_entry_id = timesheet.entry_id || null;
  await db.collection('pm_worklogs').insertOne(worklog);
  await db.collection('pm_tasks').updateOne({ id: task.id }, { $inc: { logged_minutes: worklog.minutes }, $set: { updated_at: new Date() } });
  logActivity(db, { project_id: project.id, task_id: task.id, task_key: task.key, actor: actorOf(req.user), action: 'logged time', detail: `${Math.round(worklog.minutes / 6) / 10}h on ${day}` });
  res.status(201).json({ worklog: stripId(worklog), timesheet });
}));

router.delete('/worklogs/:id', handle('Delete PM worklog', async (req, res) => {
  const db = getDB();
  const worklog = await db.collection('pm_worklogs').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!worklog) throw httpError(404, 'Time entry not found');
  const { role } = await loadTask(db, req.user, worklog.task_id);
  if (worklog.user_email !== req.user.email && role !== 'admin') throw httpError(403, 'You can only delete your own time entries');
  const timesheet = await unsyncWorklog(db, worklog);
  await db.collection('pm_worklogs').deleteOne({ id: worklog.id });
  await db.collection('pm_tasks').updateOne({ id: worklog.task_id }, { $inc: { logged_minutes: -worklog.minutes } });
  res.json({ status: 'deleted', timesheet });
}));

// ============= SPRINTS =============

const sprintStats = async (db, sprintIds) => {
  const rows = await db.collection('pm_tasks').aggregate([
    { $match: { sprint_id: { $in: sprintIds } } },
    {
      $group: {
        _id: '$sprint_id',
        tasks: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status_category', 'done'] }, 1, 0] } },
        points: { $sum: { $ifNull: ['$story_points', 0] } },
        done_points: { $sum: { $cond: [{ $eq: ['$status_category', 'done'] }, { $ifNull: ['$story_points', 0] }, 0] } }
      }
    }
  ]).toArray();
  return Object.fromEntries(rows.map(r => [r._id, r]));
};

router.get('/projects/:id/sprints', handle('List PM sprints', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id);
  const sprints = await db.collection('pm_sprints').find({ project_id: project.id }, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray();
  const stats = await sprintStats(db, sprints.map(s => s.id));
  const order = { active: 0, planned: 1, completed: 2 };
  sprints.sort((a, b) => order[a.status] - order[b.status] || (a.status === 'completed' ? new Date(b.completed_at) - new Date(a.completed_at) : 0));
  res.json(sprints.map(s => ({ ...s, live: stats[s.id] || { tasks: 0, done: 0, points: 0, done_points: 0 } })));
}));

router.post('/projects/:id/sprints', validate(schemas.sprint), handle('Create PM sprint', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'member');
  const body = req.validatedBody;
  const count = await db.collection('pm_sprints').countDocuments({ project_id: project.id });
  if (body.start_date && body.end_date && body.start_date > body.end_date) throw httpError(400, 'Sprint must end after it starts');
  const sprint = {
    id: generateUUID(),
    project_id: project.id,
    name: body.name || `${project.key} Sprint ${count + 1}`,
    goal: body.goal || '',
    start_date: blank(body.start_date),
    end_date: blank(body.end_date),
    status: 'planned',
    stats: null,
    created_by: req.user.email,
    created_at: new Date()
  };
  await db.collection('pm_sprints').insertOne(sprint);
  logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'created a sprint', detail: sprint.name });
  res.status(201).json(stripId(sprint));
}));

const loadSprint = async (db, user, sprintId, need) => {
  const sprint = await db.collection('pm_sprints').findOne({ id: sprintId }, { projection: { _id: 0 } });
  if (!sprint) throw httpError(404, 'Sprint not found');
  const { project } = await loadProject(db, user, sprint.project_id, need);
  return { sprint, project };
};

router.put('/sprints/:id', validate(schemas.sprint), handle('Update PM sprint', async (req, res) => {
  const db = getDB();
  const { sprint } = await loadSprint(db, req.user, req.params.id, 'member');
  if (sprint.status === 'completed') throw httpError(409, 'Completed sprints cannot be edited');
  const set = {};
  for (const [k, v] of Object.entries(req.validatedBody)) set[k] = ['start_date', 'end_date'].includes(k) ? blank(v) : v;
  const start = set.start_date !== undefined ? set.start_date : sprint.start_date;
  const end = set.end_date !== undefined ? set.end_date : sprint.end_date;
  if (start && end && start > end) throw httpError(400, 'Sprint must end after it starts');
  await db.collection('pm_sprints').updateOne({ id: sprint.id }, { $set: set });
  res.json({ ...sprint, ...set });
}));

router.post('/sprints/:id/start', validate(schemas.sprint), handle('Start PM sprint', async (req, res) => {
  const db = getDB();
  const { sprint, project } = await loadSprint(db, req.user, req.params.id, 'member');
  if (sprint.status !== 'planned') throw httpError(409, 'Only planned sprints can be started');
  if (await db.collection('pm_sprints').findOne({ project_id: project.id, status: 'active' })) throw httpError(409, 'Complete the active sprint first');
  const start = blank(req.validatedBody.start_date) || sprint.start_date || today();
  const end = blank(req.validatedBody.end_date) || sprint.end_date || addDays(start, 13);
  if (start > end) throw httpError(400, 'Sprint must end after it starts');
  const set = { status: 'active', start_date: start, end_date: end, started_at: new Date(), ...(req.validatedBody.goal !== undefined ? { goal: req.validatedBody.goal || '' } : {}), ...(req.validatedBody.name ? { name: req.validatedBody.name } : {}) };
  await db.collection('pm_sprints').updateOne({ id: sprint.id }, { $set: set });

  const actor = actorOf(req.user);
  logActivity(db, { project_id: project.id, actor, action: 'started a sprint', detail: `${set.name || sprint.name} (${start} → ${end})` });
  const assignees = await db.collection('pm_tasks').distinct('assignee_email', { sprint_id: sprint.id, assignee_email: { $ne: null } });
  notifyPeople(db, assignees, req.user.email, {
    title: `${set.name || sprint.name} started`,
    message: `${project.key}: the sprint runs ${start} → ${end}${set.goal || sprint.goal ? ` — ${set.goal || sprint.goal}` : ''}`,
    actionUrl: `/pm/projects/${project.id}?view=board`,
    metadata: { project_id: project.id, sprint_id: sprint.id }
  });
  res.json({ ...sprint, ...set });
}));

router.post('/sprints/:id/complete', validate(schemas.sprintComplete), handle('Complete PM sprint', async (req, res) => {
  const db = getDB();
  const { sprint, project } = await loadSprint(db, req.user, req.params.id, 'member');
  if (sprint.status !== 'active') throw httpError(409, 'Only the active sprint can be completed');
  const moveTo = req.validatedBody.move_to;
  if (moveTo !== 'backlog') {
    const target = await db.collection('pm_sprints').findOne({ id: moveTo, project_id: project.id, status: 'planned' });
    if (!target) throw httpError(400, 'Open tasks can only move to the backlog or a planned sprint');
  }

  const tasks = await db.collection('pm_tasks').find({ sprint_id: sprint.id }, { projection: { _id: 0, id: 1, status_category: 1, story_points: 1 } }).toArray();
  const usePoints = tasks.some(t => t.story_points);
  const weight = (t) => (usePoints ? (t.story_points || 0) : 1);
  const doneTasks = tasks.filter(t => t.status_category === 'done');
  const openIds = tasks.filter(t => t.status_category !== 'done').map(t => t.id);
  const stats = {
    unit: usePoints ? 'points' : 'tasks',
    committed: tasks.reduce((s, t) => s + weight(t), 0),
    completed: doneTasks.reduce((s, t) => s + weight(t), 0),
    tasks_total: tasks.length,
    tasks_done: doneTasks.length,
    carried_over: openIds.length
  };
  await db.collection('pm_sprints').updateOne({ id: sprint.id }, { $set: { status: 'completed', completed_at: new Date(), stats } });
  if (openIds.length) {
    await db.collection('pm_tasks').updateMany({ id: { $in: openIds } }, { $set: { sprint_id: moveTo === 'backlog' ? null : moveTo, updated_at: new Date() } });
  }
  logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'completed a sprint', detail: `${sprint.name}: ${stats.completed}/${stats.committed} ${stats.unit}, ${openIds.length} carried over` });
  emitEvent('project.sprint.completed', { project: projectBrief(project), sprint: { id: sprint.id, name: sprint.name }, stats }, { actor: req.user.email });
  res.json({ ...sprint, status: 'completed', stats });
}));

router.delete('/sprints/:id', handle('Delete PM sprint', async (req, res) => {
  const db = getDB();
  const { sprint, project } = await loadSprint(db, req.user, req.params.id, 'member');
  if (sprint.status !== 'planned') throw httpError(409, 'Only planned sprints can be deleted');
  await db.collection('pm_tasks').updateMany({ sprint_id: sprint.id }, { $set: { sprint_id: null } });
  await db.collection('pm_sprints').deleteOne({ id: sprint.id });
  logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'deleted a sprint', detail: sprint.name });
  res.json({ status: 'deleted' });
}));

// ============= MILESTONES =============

router.get('/projects/:id/milestones', handle('List PM milestones', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id);
  const milestones = await db.collection('pm_milestones').find({ project_id: project.id }, { projection: { _id: 0 } }).sort({ due_date: 1 }).toArray();
  const rows = await db.collection('pm_tasks').aggregate([
    { $match: { project_id: project.id, milestone_id: { $ne: null } } },
    { $group: { _id: '$milestone_id', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status_category', 'done'] }, 1, 0] } } } }
  ]).toArray();
  const stats = Object.fromEntries(rows.map(r => [r._id, r]));
  res.json(milestones.map(m => ({ ...m, total: stats[m.id]?.total || 0, done: stats[m.id]?.done || 0 })));
}));

router.post('/projects/:id/milestones', validate(schemas.milestone), handle('Create PM milestone', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'member');
  if (!req.validatedBody.name) throw httpError(400, 'Name is required');
  const milestone = {
    id: generateUUID(),
    project_id: project.id,
    name: req.validatedBody.name,
    description: req.validatedBody.description || '',
    due_date: blank(req.validatedBody.due_date),
    status: 'open',
    created_by: req.user.email,
    created_at: new Date()
  };
  await db.collection('pm_milestones').insertOne(milestone);
  logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'added a milestone', detail: milestone.name });
  res.status(201).json({ ...stripId(milestone), total: 0, done: 0 });
}));

router.put('/milestones/:id', validate(schemas.milestone), handle('Update PM milestone', async (req, res) => {
  const db = getDB();
  const milestone = await db.collection('pm_milestones').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!milestone) throw httpError(404, 'Milestone not found');
  const { project } = await loadProject(db, req.user, milestone.project_id, 'member');
  const set = {};
  for (const [k, v] of Object.entries(req.validatedBody)) set[k] = k === 'due_date' ? blank(v) : v;
  if (set.status === 'done' && milestone.status !== 'done') {
    set.completed_at = new Date();
    logActivity(db, { project_id: project.id, actor: actorOf(req.user), action: 'reached a milestone', detail: milestone.name });
  }
  await db.collection('pm_milestones').updateOne({ id: milestone.id }, { $set: set });
  res.json({ ...milestone, ...set });
}));

router.delete('/milestones/:id', handle('Delete PM milestone', async (req, res) => {
  const db = getDB();
  const milestone = await db.collection('pm_milestones').findOne({ id: req.params.id });
  if (!milestone) throw httpError(404, 'Milestone not found');
  await loadProject(db, req.user, milestone.project_id, 'member');
  await db.collection('pm_tasks').updateMany({ milestone_id: milestone.id }, { $set: { milestone_id: null } });
  await db.collection('pm_milestones').deleteOne({ id: milestone.id });
  res.json({ status: 'deleted' });
}));

// ============= DOCS (project wiki) =============

router.get('/projects/:id/docs', handle('List PM docs', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id);
  const docs = await db.collection('pm_docs').find({ project_id: project.id }, { projection: { _id: 0, body: 0 } }).sort({ pinned: -1, updated_at: -1 }).toArray();
  res.json(docs);
}));

router.get('/docs/:id', handle('Get PM doc', async (req, res) => {
  const db = getDB();
  const doc = await db.collection('pm_docs').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!doc) throw httpError(404, 'Document not found');
  const { role } = await loadProject(db, req.user, doc.project_id);
  res.json({ ...doc, my_role: role });
}));

router.post('/projects/:id/docs', validate(schemas.doc), handle('Create PM doc', async (req, res) => {
  const db = getDB();
  const { project } = await loadProject(db, req.user, req.params.id, 'member');
  const actor = actorOf(req.user);
  const now = new Date();
  const doc = {
    id: generateUUID(),
    project_id: project.id,
    title: req.validatedBody.title || 'Untitled',
    body: req.validatedBody.body || '',
    pinned: !!req.validatedBody.pinned,
    created_by: actor.email,
    created_by_name: actor.name,
    updated_by: actor.email,
    updated_by_name: actor.name,
    created_at: now,
    updated_at: now
  };
  await db.collection('pm_docs').insertOne(doc);
  logActivity(db, { project_id: project.id, actor, action: 'created a doc', detail: doc.title });
  res.status(201).json(stripId(doc));
}));

router.put('/docs/:id', validate(schemas.doc), handle('Update PM doc', async (req, res) => {
  const db = getDB();
  const doc = await db.collection('pm_docs').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!doc) throw httpError(404, 'Document not found');
  await loadProject(db, req.user, doc.project_id, 'member');
  const actor = actorOf(req.user);
  const set = { ...req.validatedBody, updated_by: actor.email, updated_by_name: actor.name, updated_at: new Date() };
  await db.collection('pm_docs').updateOne({ id: doc.id }, { $set: set });
  res.json({ ...doc, ...set });
}));

router.delete('/docs/:id', handle('Delete PM doc', async (req, res) => {
  const db = getDB();
  const doc = await db.collection('pm_docs').findOne({ id: req.params.id });
  if (!doc) throw httpError(404, 'Document not found');
  const { role } = await loadProject(db, req.user, doc.project_id, 'member');
  if (doc.created_by !== req.user.email && role !== 'admin') throw httpError(403, 'Only the author or a project admin can delete this doc');
  await db.collection('pm_docs').deleteOne({ id: doc.id });
  res.json({ status: 'deleted' });
}));

module.exports = router;
