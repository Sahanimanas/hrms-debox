// Xeno PM — projects, tasks, sprints, milestones, docs, workload and HR integration
import { run, section, check, get, post, put, del, bootstrap, createUser, withDb } from '../lib/harness.mjs';

const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const today = addDays(0);

await run(async () => {
  const admin = await bootstrap();
  const mgr = await createUser(admin, { role: 'manager', name: 'Mira Manager' });
  const dev = await createUser(admin, { role: 'employee', name: 'Dev Developer', manager_email: mgr.email });
  const qa = await createUser(admin, { role: 'employee', name: 'Quinn QA', manager_email: mgr.email });
  const outsider = await createUser(admin, { role: 'employee', name: 'Otto Outsider', department: 'Finance' });

  section('Meta & directory');
  let r = await get('/v2/projects/meta', dev.token);
  check('templates listed', r.s === 200 && r.d.templates.some(t => t.key === 'scrum') && r.d.can_create_projects === false, r);
  r = await get('/v2/projects/people', dev.token);
  check('people directory includes employees', r.s === 200 && r.d.some(p => p.email === qa.email), r);

  section('Projects');
  r = await post('/v2/projects/projects', dev.token, { name: 'Nope', key: 'NOPE' });
  check('employee cannot create a project', r.s === 403, r);
  r = await post('/v2/projects/projects', mgr.token, { name: 'Bad', key: '1BAD' });
  check('invalid key rejected', r.s === 422, r);
  r = await post('/v2/projects/projects', mgr.token, { name: 'Web Platform', key: 'web', template: 'scrum', member_emails: [dev.email], budget_hours: 100 });
  check('manager creates a scrum project', r.s === 201 && r.d.key === 'WEB' && r.d.methodology === 'scrum' && r.d.statuses.length === 5, r);
  const project = r.d;
  check('creator is project admin', project.my_role === 'admin', project);
  r = await post('/v2/projects/projects', mgr.token, { name: 'Dup', key: 'WEB' });
  check('duplicate key rejected', r.s === 409, r);
  const tsProject = await withDb(db => db.collection('projects').findOne({ pm_project_id: project.id }));
  check('mirrored timesheet project created', !!tsProject && tsProject.code === 'WEB' && tsProject.member_emails.includes(dev.email), tsProject);

  r = await get(`/v2/projects/projects/${project.id}`, outsider.token);
  check('private project hidden from non-members', r.s === 404, r);
  r = await get('/v2/projects/projects', outsider.token);
  check('private project not listed for outsider', r.s === 200 && !r.d.some(p => p.id === project.id), r);
  r = await get(`/v2/projects/projects/${project.id}`, dev.token);
  check('member sees project with member role', r.s === 200 && r.d.my_role === 'member' && r.d.members.length === 2, r);

  r = await put(`/v2/projects/projects/${project.id}`, dev.token, { name: 'Hijack' });
  check('member cannot edit project settings', r.s === 403, r);
  r = await post(`/v2/projects/projects/${project.id}/members`, mgr.token, { email: qa.email, role: 'viewer' });
  check('admin adds a viewer', r.s === 201 && r.d.some(m => m.email === qa.email && m.role === 'viewer'), r);
  r = await post(`/v2/projects/projects/${project.id}/favorite`, dev.token);
  check('favorite toggled on', r.s === 200 && r.d.favorite === true, r);

  section('Tasks');
  r = await post(`/v2/projects/projects/${project.id}/tasks`, qa.token, { title: 'Viewer task' });
  check('viewer cannot create tasks', r.s === 403, r);
  r = await post(`/v2/projects/projects/${project.id}/tasks`, dev.token, { title: 'Login page', priority: 'high', estimate_hours: 6, due_date: addDays(3), story_points: 5 });
  check('member creates task with key', r.s === 201 && r.d.key === 'WEB-1' && r.d.status === 'backlog' && r.d.status_category === 'todo', r);
  const t1 = r.d;
  r = await post(`/v2/projects/projects/${project.id}/tasks`, dev.token, { title: 'Bad dates', start_date: addDays(5), due_date: addDays(1) });
  check('start after due rejected', r.s === 400, r);
  r = await post(`/v2/projects/projects/${project.id}/tasks`, dev.token, { title: 'Assign outsider', assignee_email: outsider.email });
  check('member cannot assign a non-member', r.s === 400, r);
  r = await post(`/v2/projects/projects/${project.id}/tasks`, mgr.token, { title: 'API endpoints', assignee_email: dev.email, story_points: 3, estimate_hours: 10, due_date: addDays(4) });
  check('admin assigns task to member', r.s === 201 && r.d.assignee_name === 'Dev Developer', r);
  const t2 = r.d;
  r = await post(`/v2/projects/projects/${project.id}/tasks`, dev.token, { title: 'Form validation', parent_id: t1.id });
  check('sub-task created', r.s === 201 && r.d.type === 'subtask' && r.d.parent_id === t1.id, r);
  const sub = r.d;
  r = await post(`/v2/projects/projects/${project.id}/tasks`, dev.token, { title: 'Nested', parent_id: sub.id });
  check('sub-sub-task rejected', r.s === 400, r);

  r = await put(`/v2/projects/tasks/${t1.id}`, dev.token, { status: 'in_progress', blocked_by: [t2.id], checklist: [{ text: 'Design' }, { text: 'Build', done: true }] });
  check('status, dependency and checklist updated', r.s === 200 && r.d.status_category === 'in_progress' && r.d.started_at && r.d.blocked_by[0] === t2.id && r.d.checklist.length === 2, r);
  r = await put(`/v2/projects/tasks/${t1.id}`, dev.token, { blocked_by: [t1.id] });
  check('self dependency rejected', r.s === 400, r);
  r = await put(`/v2/projects/tasks/${t1.id}`, dev.token, { status: 'nope' });
  check('unknown status rejected', r.s === 400, r);

  r = await post(`/v2/projects/tasks/${t2.id}/move`, dev.token, { status: 'done', position: 500 });
  check('board move to done sets completed_at', r.s === 200 && r.d.status_category === 'done' && r.d.completed_at && r.d.position === 500, r);
  r = await post(`/v2/projects/tasks/${t2.id}/move`, dev.token, { status: 'qa', position: 600 });
  check('moving out of done clears completed_at', r.s === 200 && r.d.completed_at === null, r);

  r = await get(`/v2/projects/projects/${project.id}/tasks`, dev.token);
  const listed = r.d?.find(t => t.id === t1.id);
  check('task list includes subtask & checklist counts', r.s === 200 && listed?.subtask_total === 1 && listed?.checklist_done === 1 && listed.description === undefined, r);
  r = await get(`/v2/projects/projects/${project.id}/tasks?assignee=me`, dev.token);
  check('filter by assignee=me', r.s === 200 && r.d.length === 1 && r.d[0].id === t2.id, r);

  r = await get(`/v2/projects/tasks/${t1.id}`, dev.token);
  check('task detail with subtasks, dependencies and activity', r.s === 200 && r.d.subtasks.length === 1 && r.d.blocked_by_tasks[0].id === t2.id && r.d.activity.length >= 2, r);
  r = await get(`/v2/projects/tasks/${t2.id}`, dev.token);
  check('reverse dependency (blocking) shown', r.s === 200 && r.d.blocking_tasks.some(t => t.id === t1.id), r);

  section('Comments & mentions');
  r = await post(`/v2/projects/tasks/${t1.id}/comments`, qa.token, { body: `Looks good @${dev.email} — please check` });
  check('viewer can comment, mentions parsed', r.s === 201 && r.d.mentions.includes(dev.email), r);
  const comment = r.d;
  await new Promise(res => setTimeout(res, 400));
  r = await get('/notifications', dev.token);
  const notes = Array.isArray(r.d) ? r.d : (r.d?.notifications || []);
  check('mentioned user notified', notes.some(n => n.type === 'project_update' && /mentioned you/.test(n.title)), r.d);
  r = await put(`/v2/projects/comments/${comment.id}`, dev.token, { body: 'edited' });
  check('cannot edit someone else\'s comment', r.s === 403, r);
  r = await del(`/v2/projects/comments/${comment.id}`, mgr.token);
  check('project admin deletes comment', r.s === 200, r);

  section('Time tracking → HR timesheets');
  r = await post(`/v2/projects/tasks/${t2.id}/worklogs`, dev.token, { minutes: 90, note: 'Endpoints' });
  check('worklog created and synced to timesheet', r.s === 201 && r.d.timesheet.synced === true, r);
  const worklog = r.d.worklog;
  const entry = await withDb(db => db.collection('timesheet_entries').findOne({ worklog_id: worklog.id }));
  check('timesheet entry carries task key', !!entry && entry.minutes === 90 && entry.task.startsWith('WEB-2') && entry.project_id === tsProject.id, entry);
  r = await get(`/v2/projects/tasks/${t2.id}`, dev.token);
  check('logged minutes rolled up on task', r.d.logged_minutes === 90, r.d);
  r = await post(`/v2/projects/tasks/${t2.id}/worklogs`, dev.token, { minutes: 30, date: addDays(2) });
  check('future worklog rejected', r.s === 400, r);
  r = await del(`/v2/projects/worklogs/${worklog.id}`, dev.token);
  check('deleting worklog removes timesheet entry', r.s === 200 && r.d.timesheet.removed === true, r);

  section('Leave-aware assignment & workload');
  const leaveDay = addDays(4);
  await withDb(db => db.collection('leaves').insertOne({
    id: `test-leave-${Date.now()}`, employee_email: qa.email, employee_name: 'Quinn QA', leave_type: 'Casual Leave',
    dates: [`${leaveDay}T00:00:00.000Z`], days_count: 1, status: 'approved', created_at: new Date().toISOString()
  }));
  await put(`/v2/projects/projects/${project.id}/members/${encodeURIComponent(qa.email)}`, mgr.token, { role: 'member' });
  r = await put(`/v2/projects/tasks/${t1.id}`, mgr.token, { assignee_email: qa.email, due_date: leaveDay });
  check('assigning during approved leave returns a warning', r.s === 200 && r.d.warnings.some(w => /on leave/.test(w)), r);
  r = await get(`/v2/projects/workload?from=${today}&to=${addDays(13)}`, mgr.token);
  const qaRow = r.d?.people?.find(p => p.email === qa.email);
  check('workload counts leave against capacity', r.s === 200 && qaRow && qaRow.leave_days >= 0 && qaRow.days.some(d => d.leave?.status === 'approved') && qaRow.open_tasks >= 1, qaRow || r);

  section('Sprints');
  r = await post(`/v2/projects/projects/${project.id}/sprints`, dev.token, { goal: 'Auth MVP' });
  check('sprint created with default name', r.s === 201 && r.d.name === 'WEB Sprint 1' && r.d.status === 'planned', r);
  const sprint = r.d;
  await post(`/v2/projects/projects/${project.id}/tasks/bulk`, dev.token, { task_ids: [t1.id, t2.id], changes: { sprint_id: sprint.id } });
  r = await post(`/v2/projects/sprints/${sprint.id}/start`, dev.token, {});
  check('sprint started with default dates', r.s === 200 && r.d.status === 'active' && r.d.start_date === today, r);
  r = await post(`/v2/projects/projects/${project.id}/sprints`, dev.token, {});
  const sprint2 = r.d;
  r = await post(`/v2/projects/sprints/${sprint2.id}/start`, dev.token, {});
  check('second active sprint blocked', r.s === 409, r);
  r = await get(`/v2/projects/projects/${project.id}/tasks?sprint=active`, dev.token);
  check('active sprint filter', r.s === 200 && r.d.length === 2, r);
  await post(`/v2/projects/tasks/${t2.id}/move`, dev.token, { status: 'done', position: 1 });
  r = await get(`/v2/projects/projects/${project.id}/reports`, dev.token);
  check('report has burndown for active sprint', r.s === 200 && r.d.burndown?.unit === 'points' && r.d.burndown.total === 8 && r.d.totals.done >= 1, r.d?.burndown || r);
  r = await post(`/v2/projects/sprints/${sprint.id}/complete`, dev.token, { move_to: sprint2.id });
  check('sprint completed with stats and carry-over', r.s === 200 && r.d.stats.completed === 3 && r.d.stats.committed === 8 && r.d.stats.carried_over === 1, r);
  r = await get(`/v2/projects/tasks/${t1.id}`, dev.token);
  check('open task carried to next sprint', r.d.sprint_id === sprint2.id, r.d);

  section('Milestones & docs');
  r = await post(`/v2/projects/projects/${project.id}/milestones`, dev.token, { name: 'Beta', due_date: addDays(20) });
  check('milestone created', r.s === 201, r);
  const ms = r.d;
  await put(`/v2/projects/tasks/${t2.id}`, dev.token, { milestone_id: ms.id });
  r = await get(`/v2/projects/projects/${project.id}/milestones`, dev.token);
  check('milestone progress computed', r.s === 200 && r.d[0].total === 1 && r.d[0].done === 1, r);
  r = await post(`/v2/projects/projects/${project.id}/docs`, dev.token, { title: 'Spec', body: '# Auth\n- SSO' });
  check('doc created', r.s === 201, r);
  const doc = r.d;
  r = await get(`/v2/projects/projects/${project.id}/docs`, dev.token);
  check('doc list omits body', r.s === 200 && r.d.length === 1 && r.d[0].body === undefined, r);
  r = await put(`/v2/projects/docs/${doc.id}`, qa.token, { body: 'changed' });
  check('member edits doc', r.s === 200 && r.d.body === 'changed', r);

  section('Workflow & labels');
  r = await put(`/v2/projects/projects/${project.id}/statuses`, mgr.token, { statuses: [{ label: 'Open', category: 'in_progress' }, { label: 'Done', category: 'done' }] });
  check('workflow needs a todo status', r.s === 400, r);
  r = await put(`/v2/projects/projects/${project.id}/statuses`, mgr.token, {
    statuses: [{ key: 'todo', label: 'To Do', category: 'todo' }, { key: 'doing', label: 'Doing', category: 'in_progress' }, { key: 'done', label: 'Done', category: 'done' }],
    remap: { in_progress: 'doing', qa: 'doing' }
  });
  check('workflow replaced', r.s === 200 && r.d.length === 3, r);
  r = await get(`/v2/projects/tasks/${t1.id}`, dev.token);
  check('tasks remapped to new statuses', ['todo', 'doing', 'done'].includes(r.d.status), r.d);
  const label = project.labels[0];
  await put(`/v2/projects/tasks/${t1.id}`, dev.token, { label_ids: [label.id] });
  r = await put(`/v2/projects/projects/${project.id}/labels`, mgr.token, { labels: [] });
  r = await get(`/v2/projects/tasks/${t1.id}`, dev.token);
  check('removed label pulled from tasks', r.d.label_ids.length === 0, r.d);

  section('Cross-project views');
  r = await get('/v2/projects/my-tasks', qa.token);
  check('my tasks lists assigned work with project', r.s === 200 && r.d.some(t => t.id === t1.id && t.project.key === 'WEB'), r);
  r = await get('/v2/projects/overview', dev.token);
  check('overview returns projects & activity', r.s === 200 && r.d.projects.some(p => p.id === project.id && p.favorite) && r.d.activity.length > 0, r);
  r = await get('/v2/projects/search?q=login', dev.token);
  check('search finds tasks', r.s === 200 && r.d.tasks.some(t => t.key === 'WEB-1'), r);
  r = await get('/v2/projects/search?q=login', outsider.token);
  check('search respects project access', r.s === 200 && r.d.tasks.length === 0, r);

  section('Deletion & archive');
  r = await del(`/v2/projects/tasks/${t1.id}`, qa.token);
  check('non-reporter member cannot delete task', r.s === 403, r);
  r = await del(`/v2/projects/tasks/${t1.id}`, dev.token);
  check('reporter deletes task with sub-tasks', r.s === 200 && r.d.deleted === 2, r);
  r = await put(`/v2/projects/projects/${project.id}`, mgr.token, { archived: true });
  check('project archived', r.s === 200 && r.d.archived === true, r);
  r = await post(`/v2/projects/projects/${project.id}/tasks`, dev.token, { title: 'After archive' });
  check('archived project is read-only', r.s === 409, r);
  r = await del(`/v2/projects/projects/${project.id}`, dev.token);
  check('member cannot delete project', r.s === 403, r);
  r = await del(`/v2/projects/projects/${project.id}`, mgr.token);
  check('creator deletes project', r.s === 200, r);
  const left = await withDb(db => db.collection('pm_tasks').countDocuments({ project_id: project.id }));
  check('project tasks cascaded', left === 0, left);
});
