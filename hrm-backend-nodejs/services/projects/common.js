/**
 * Shared helpers for the projects (Xeno PM) module.
 *
 * Access model:
 *   - Global admins can see and manage every project.
 *   - Project members carry a project role: 'admin' (manage settings and
 *     members), 'member' (create / edit tasks) or 'viewer' (read only).
 *   - Projects with visibility 'organization' are readable by everyone;
 *     non-members get the 'viewer' role. 'private' projects are invisible to
 *     non-members (404, so their existence isn't leaked).
 */

const { createNotification } = require('../notificationService');
const { generateUUID } = require('../../utils/helpers');

const PROJECT_ROLES = ['admin', 'member', 'viewer'];
const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const TASK_TYPES = ['task', 'bug', 'story', 'epic', 'subtask'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];
const STATUS_CATEGORIES = ['todo', 'in_progress', 'done'];
const COLORS = ['#0f172a', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c'];

const st = (key, label, category, color) => ({ key, label, category, color });

/** Workflow + labels each new project starts from (editable afterwards). */
const TEMPLATES = {
  kanban: {
    label: 'Kanban',
    methodology: 'kanban',
    statuses: [
      st('todo', 'To Do', 'todo', '#64748b'),
      st('in_progress', 'In Progress', 'in_progress', '#2563eb'),
      st('review', 'In Review', 'in_progress', '#7c3aed'),
      st('done', 'Done', 'done', '#16a34a')
    ],
    labels: ['Frontend', 'Backend', 'Design', 'Docs']
  },
  scrum: {
    label: 'Scrum',
    methodology: 'scrum',
    statuses: [
      st('backlog', 'Backlog', 'todo', '#94a3b8'),
      st('todo', 'Selected', 'todo', '#64748b'),
      st('in_progress', 'In Progress', 'in_progress', '#2563eb'),
      st('qa', 'QA', 'in_progress', '#d97706'),
      st('done', 'Done', 'done', '#16a34a')
    ],
    labels: ['Feature', 'Tech debt', 'Spike']
  },
  bug_tracking: {
    label: 'Bug tracking',
    methodology: 'kanban',
    statuses: [
      st('triage', 'Triage', 'todo', '#94a3b8'),
      st('confirmed', 'Confirmed', 'todo', '#dc2626'),
      st('fixing', 'Fixing', 'in_progress', '#2563eb'),
      st('verify', 'Verify', 'in_progress', '#d97706'),
      st('closed', 'Closed', 'done', '#16a34a')
    ],
    labels: ['Regression', 'UI', 'Performance', 'Security']
  },
  business: {
    label: 'Business / marketing',
    methodology: 'kanban',
    statuses: [
      st('ideas', 'Ideas', 'todo', '#94a3b8'),
      st('planned', 'Planned', 'todo', '#64748b'),
      st('in_progress', 'In Progress', 'in_progress', '#2563eb'),
      st('approval', 'Approval', 'in_progress', '#7c3aed'),
      st('published', 'Done', 'done', '#16a34a')
    ],
    labels: ['Campaign', 'Content', 'Event', 'Social']
  }
};

const templateLabels = (names) => names.map((name, i) => ({ id: generateUUID(), name, color: COLORS[(i + 1) % COLORS.length] }));

const stripId = (doc) => {
  if (doc) delete doc._id;
  return doc;
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 'YYYY-MM-DD' in UTC for a Date (or the date part of an ISO string). */
const dayKey = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const actorOf = (user) => ({ email: user.email, name: user.full_name || user.email });

/** Role of `user` in `project`: 'admin' | 'member' | 'viewer' | null. */
const projectRole = (project, user) => {
  if (!project || !user) return null;
  if (user.role === 'admin') return 'admin';
  if (project.lead_email === user.email || project.created_by === user.email) return 'admin';
  const member = (project.members || []).find(m => m.email === user.email);
  if (member) return member.role;
  return project.visibility === 'organization' ? 'viewer' : null;
};

/** Mongo filter for projects `user` may see. */
const visibleProjectsFilter = (user) => (user.role === 'admin'
  ? {}
  : { $or: [{ visibility: 'organization' }, { 'members.email': user.email }, { lead_email: user.email }, { created_by: user.email }] });

/**
 * Load a project and the caller's role, enforcing a minimum role.
 * need: 'viewer' (read) | 'member' (edit tasks) | 'admin' (manage project).
 */
const RANK = { viewer: 1, member: 2, admin: 3 };
const loadProject = async (db, user, projectId, need = 'viewer') => {
  const project = await db.collection('pm_projects').findOne({ id: projectId }, { projection: { _id: 0 } });
  const role = projectRole(project, user);
  if (!project || !role) throw httpError(404, 'Project not found');
  if (RANK[role] < RANK[need]) throw httpError(403, need === 'admin' ? 'Only project admins can do this' : 'You have view-only access to this project');
  if (project.archived && need !== 'viewer' && need !== 'admin') throw httpError(409, 'This project is archived');
  return { project, role };
};

/** Load a task plus its project and the caller's role. */
const loadTask = async (db, user, taskId, need = 'viewer') => {
  const task = await db.collection('pm_tasks').findOne({ id: taskId }, { projection: { _id: 0 } });
  if (!task) throw httpError(404, 'Task not found');
  const { project, role } = await loadProject(db, user, task.project_id, need);
  return { task, project, role };
};

/**
 * People directory used by pickers: active employees, plus user accounts
 * without an employee profile (e.g. the initial admin). Keyed by email.
 */
const loadPeople = async (db, emails = null) => {
  const filter = emails ? { email: { $in: emails } } : {};
  const [employees, users] = await Promise.all([
    db.collection('employees').find(
      { ...filter, is_active: { $ne: false }, employment_status: { $ne: 'exited' } },
      { projection: { _id: 0, id: 1, email: 1, full_name: 1, designation: 1, department: 1, profile_picture_url: 1, role: 1 } }
    ).toArray(),
    db.collection('users').find(
      { ...filter, is_active: { $ne: false } },
      { projection: { _id: 0, id: 1, email: 1, full_name: 1, name: 1, role: 1 } }
    ).toArray()
  ]);
  const map = new Map();
  for (const e of employees) {
    if (!e.email) continue;
    map.set(e.email, { id: e.id, email: e.email, name: e.full_name || e.email, designation: e.designation || null, department: e.department || null, picture: e.profile_picture_url || null, role: e.role || null });
  }
  for (const u of users) {
    if (!u.email || map.has(u.email)) continue;
    map.set(u.email, { id: u.id, email: u.email, name: u.full_name || u.name || u.email, designation: null, department: null, picture: null, role: u.role || null });
  }
  return map;
};

const personName = async (db, email) => {
  if (!email) return null;
  const people = await loadPeople(db, [email]);
  return people.get(email)?.name || email;
};

/** Append to the project / task activity feed. Never throws. */
const logActivity = (db, { project_id, task_id = null, task_key = null, actor, action, detail = null }) =>
  db.collection('pm_activity').insertOne({
    id: generateUUID(),
    project_id,
    task_id,
    task_key,
    actor_email: actor.email,
    actor_name: actor.name,
    action,
    detail,
    at: new Date()
  }).catch(err => console.error('[projects] activity log failed:', err.message));

/** In-app notification(s) for project events; skips the actor. Fire-and-forget. */
const notifyPeople = (db, emails, actorEmail, payload) => {
  const list = [...new Set((emails || []).filter(e => e && e !== actorEmail))];
  if (!list.length) return;
  Promise.resolve().then(async () => {
    const users = await db.collection('users').find({ email: { $in: list } }, { projection: { _id: 0, id: 1, email: 1 } }).toArray();
    const ids = Object.fromEntries(users.map(u => [u.email, u.id]));
    for (const email of list) {
      await createNotification({ userId: ids[email] || null, userEmail: email, type: 'project_update', ...payload });
    }
  }).catch(err => console.error('[projects] notification failed:', err.message));
};

/** @mentions in a comment: "@user@company.com" or "@[Full Name](email)". */
const extractMentions = (body) => {
  const emails = new Set();
  const re = /@\[[^\]]+\]\(([^)\s]+@[^)\s]+)\)|@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  let m;
  while ((m = re.exec(body || '')) !== null) emails.add((m[1] || m[2]).toLowerCase());
  return [...emails];
};

module.exports = {
  PROJECT_ROLES,
  PROJECT_STATUSES,
  TASK_TYPES,
  PRIORITIES,
  STATUS_CATEGORIES,
  COLORS,
  TEMPLATES,
  templateLabels,
  stripId,
  httpError,
  escapeRegex,
  dayKey,
  addDays,
  actorOf,
  projectRole,
  visibleProjectsFilter,
  loadProject,
  loadTask,
  loadPeople,
  personName,
  logActivity,
  notifyPeople,
  extractMentions
};
