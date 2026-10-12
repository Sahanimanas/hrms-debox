/**
 * Xeno PM analytics: team workload (capacity from HR shifts, holidays and
 * leaves) and per-project reports (breakdowns, burndown, velocity, flow).
 */

const { getShiftForEmployee } = require('../time/core');
const { dayKey, addDays, loadPeople } = require('./common');

const HOURS_PER_DAY = 8;
const DAY_MS = 86400000;

const datesBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};

/** holidays in [from, to] as { 'YYYY-MM-DD': name } */
const holidayMap = async (db, from, to) => {
  const all = await db.collection('holidays').find({}, { projection: { _id: 0, date: 1, name: 1, title: 1 } }).toArray();
  const map = {};
  for (const h of all) {
    const d = dayKey(h.date);
    if (d && d >= from && d <= to) map[d] = h.name || h.title || 'Holiday';
  }
  return map;
};

/**
 * Leaves overlapping [from, to] for `emails`:
 * { email: { 'YYYY-MM-DD': { status, type, fraction } } } — approved and pending.
 */
const leaveMap = async (db, emails, from, to) => {
  const leaves = await db.collection('leaves').find(
    { employee_email: { $in: emails }, status: { $in: ['approved', 'pending', 'manager_approved'] } },
    { projection: { _id: 0, employee_email: 1, dates: 1, status: 1, leave_type: 1, is_half_day: 1 } }
  ).toArray();
  const map = {};
  for (const l of leaves) {
    for (const raw of l.dates || []) {
      const d = dayKey(raw);
      if (!d || d < from || d > to) continue;
      map[l.employee_email] = map[l.employee_email] || {};
      map[l.employee_email][d] = {
        status: l.status === 'approved' ? 'approved' : 'pending',
        type: l.leave_type,
        fraction: l.is_half_day ? 0.5 : 1
      };
    }
  }
  return map;
};

/** Approved leave of `email` on any of `dates` — used to warn when assigning work. */
const leaveConflicts = async (db, email, dates) => {
  const wanted = dates.filter(Boolean);
  if (!email || !wanted.length) return [];
  const lo = wanted.reduce((a, b) => (a < b ? a : b));
  const hi = wanted.reduce((a, b) => (a > b ? a : b));
  const leaves = (await leaveMap(db, [email], lo, hi))[email] || {};
  return wanted.filter(d => leaves[d]).map(d => ({ date: d, ...leaves[d] }));
};

/**
 * Workload per person across `projects` for [from, to].
 * Estimates of open tasks due in the window (or overdue) are compared with
 * capacity = working days (shift weekly offs, holidays and approved leave
 * removed) x 8h.
 */
const workload = async (db, { projects, from, to }) => {
  const projectIds = projects.map(p => p.id);
  const memberEmails = new Set();
  projects.forEach(p => {
    if (p.lead_email) memberEmails.add(p.lead_email);
    (p.members || []).filter(m => m.role !== 'viewer').forEach(m => memberEmails.add(m.email));
  });

  const tasks = await db.collection('pm_tasks').find(
    { project_id: { $in: projectIds }, status_category: { $ne: 'done' }, assignee_email: { $ne: null } },
    { projection: { _id: 0, id: 1, key: 1, title: 1, project_id: 1, assignee_email: 1, due_date: 1, start_date: 1, estimate_hours: 1, priority: 1, status: 1 } }
  ).toArray();
  tasks.forEach(t => memberEmails.add(t.assignee_email));

  const emails = [...memberEmails];
  const [people, holidays, leaves, employees] = await Promise.all([
    loadPeople(db, emails),
    holidayMap(db, from, to),
    leaveMap(db, emails, from, to),
    db.collection('employees').find({ email: { $in: emails } }).toArray()
  ]);
  const empByEmail = Object.fromEntries(employees.map(e => [e.email, e]));
  const dates = datesBetween(from, to);
  const projectName = Object.fromEntries(projects.map(p => [p.id, { key: p.key, name: p.name, color: p.color }]));

  const rows = [];
  for (const email of emails) {
    const person = people.get(email);
    if (!person) continue; // exited / unknown accounts drop out
    const shift = empByEmail[email] ? await getShiftForEmployee(db, empByEmail[email]) : null;
    const weeklyOffs = shift?.weekly_offs || [0, 6];
    const myLeaves = leaves[email] || {};
    const mine = tasks.filter(t => t.assignee_email === email);

    const days = dates.map(date => {
      const off = weeklyOffs.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
      const due = mine.filter(t => t.due_date === date);
      return {
        date,
        off,
        holiday: holidays[date] || null,
        leave: myLeaves[date] || null,
        tasks_due: due.length,
        hours_due: due.reduce((s, t) => s + (t.estimate_hours || 0), 0)
      };
    });

    const workingDays = days.filter(d => !d.off && !d.holiday).length;
    const leaveDays = days.filter(d => !d.off && !d.holiday && d.leave?.status === 'approved').reduce((s, d) => s + d.leave.fraction, 0);
    const capacity = Math.max(0, (workingDays - leaveDays) * HOURS_PER_DAY);
    const inWindow = mine.filter(t => t.due_date && t.due_date <= to);
    const planned = inWindow.reduce((s, t) => s + (t.estimate_hours || 0), 0);

    rows.push({
      ...person,
      open_tasks: mine.length,
      overdue: mine.filter(t => t.due_date && t.due_date < from).length,
      due_in_window: inWindow.length,
      planned_hours: Math.round(planned * 10) / 10,
      working_days: workingDays,
      leave_days: leaveDays,
      pending_leave_days: days.filter(d => d.leave?.status === 'pending').length,
      capacity_hours: capacity,
      utilization: capacity ? Math.round((planned / capacity) * 100) : (planned ? 999 : 0),
      days,
      tasks: mine
        .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))
        .slice(0, 50)
        .map(t => ({ ...t, project: projectName[t.project_id] }))
    });
  }
  rows.sort((a, b) => b.utilization - a.utilization || a.name.localeCompare(b.name));
  return { from, to, hours_per_day: HOURS_PER_DAY, holidays, people: rows };
};

/** ISO week start (Monday) for a Date. */
const weekStartOf = (d) => {
  const date = new Date(d);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return date.toISOString().slice(0, 10);
};

/** Per-project report built from its tasks, sprints and worklogs. */
const projectReport = async (db, project) => {
  const [tasks, sprints, worklogs] = await Promise.all([
    db.collection('pm_tasks').find({ project_id: project.id }, { projection: { _id: 0, description: 0, checklist: 0 } }).toArray(),
    db.collection('pm_sprints').find({ project_id: project.id }, { projection: { _id: 0 } }).sort({ start_date: 1 }).toArray(),
    db.collection('pm_worklogs').find({ project_id: project.id }, { projection: { _id: 0, user_email: 1, user_name: 1, minutes: 1, date: 1, billable: 1 } }).toArray()
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const statusOf = Object.fromEntries((project.statuses || []).map(s => [s.key, s]));
  const count = (fn) => tasks.reduce((acc, t) => { const k = fn(t); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  const byStatus = (project.statuses || []).map(s => ({ key: s.key, label: s.label, color: s.color, category: s.category, count: tasks.filter(t => t.status === s.key).length }));
  const byPriority = count(t => t.priority || 'none');
  const byType = count(t => t.type || 'task');

  const assignees = {};
  for (const t of tasks) {
    const k = t.assignee_email || '__unassigned';
    assignees[k] = assignees[k] || { email: t.assignee_email || null, name: t.assignee_name || 'Unassigned', open: 0, done: 0, overdue: 0, estimate_hours: 0, logged_hours: 0 };
    if (t.status_category === 'done') assignees[k].done += 1;
    else {
      assignees[k].open += 1;
      assignees[k].estimate_hours += t.estimate_hours || 0;
      if (t.due_date && t.due_date < today) assignees[k].overdue += 1;
    }
  }
  for (const w of worklogs) {
    const k = w.user_email;
    assignees[k] = assignees[k] || { email: w.user_email, name: w.user_name, open: 0, done: 0, overdue: 0, estimate_hours: 0, logged_hours: 0 };
    assignees[k].logged_hours += w.minutes / 60;
  }
  Object.values(assignees).forEach(a => { a.logged_hours = Math.round(a.logged_hours * 10) / 10; a.estimate_hours = Math.round(a.estimate_hours * 10) / 10; });

  // Created vs completed, last 12 weeks
  const weeks = [];
  const thisWeek = weekStartOf(new Date());
  for (let i = 11; i >= 0; i--) weeks.push(addDays(thisWeek, -7 * i));
  const flow = weeks.map(w => ({
    week: w,
    created: tasks.filter(t => weekStartOf(t.created_at) === w).length,
    completed: tasks.filter(t => t.completed_at && weekStartOf(t.completed_at) === w).length
  }));

  // Burndown for the active sprint: remaining points (or task count) per day
  const active = sprints.find(s => s.status === 'active');
  let burndown = null;
  if (active?.start_date && active?.end_date) {
    const inSprint = tasks.filter(t => t.sprint_id === active.id);
    const usePoints = inSprint.some(t => t.story_points);
    const weight = (t) => (usePoints ? (t.story_points || 0) : 1);
    const total = inSprint.reduce((s, t) => s + weight(t), 0);
    const days = datesBetween(active.start_date, active.end_date);
    burndown = {
      sprint: { id: active.id, name: active.name },
      unit: usePoints ? 'points' : 'tasks',
      total,
      series: days.map((d, i) => ({
        date: d,
        ideal: Math.round((total - (total * i) / Math.max(1, days.length - 1)) * 10) / 10,
        remaining: d > today ? null : inSprint.filter(t => !(t.completed_at && dayKey(t.completed_at) <= d)).reduce((s, t) => s + weight(t), 0)
      }))
    };
  }

  const velocity = sprints.filter(s => s.status === 'completed').slice(-8).map(s => ({
    sprint: s.name,
    committed: s.stats?.committed ?? 0,
    completed: s.stats?.completed ?? 0
  }));

  const done = tasks.filter(t => t.status_category === 'done');
  const cycle = done.filter(t => t.started_at && t.completed_at).map(t => (new Date(t.completed_at) - new Date(t.started_at)) / DAY_MS);
  const loggedMinutes = worklogs.reduce((s, w) => s + w.minutes, 0);

  return {
    totals: {
      tasks: tasks.length,
      open: tasks.length - done.length,
      done: done.length,
      overdue: tasks.filter(t => t.status_category !== 'done' && t.due_date && t.due_date < today).length,
      unassigned: tasks.filter(t => t.status_category !== 'done' && !t.assignee_email).length,
      completion: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
      estimate_hours: Math.round(tasks.reduce((s, t) => s + (t.estimate_hours || 0), 0) * 10) / 10,
      logged_hours: Math.round((loggedMinutes / 60) * 10) / 10,
      billable_hours: Math.round((worklogs.filter(w => w.billable).reduce((s, w) => s + w.minutes, 0) / 60) * 10) / 10,
      budget_hours: project.budget_hours || null,
      avg_cycle_days: cycle.length ? Math.round((cycle.reduce((a, b) => a + b, 0) / cycle.length) * 10) / 10 : null
    },
    by_status: byStatus,
    by_priority: byPriority,
    by_type: byType,
    by_assignee: Object.values(assignees).sort((a, b) => (b.open + b.done) - (a.open + a.done)),
    flow,
    burndown,
    velocity,
    status_meta: statusOf
  };
};

module.exports = { workload, projectReport, leaveConflicts, holidayMap, HOURS_PER_DAY };
