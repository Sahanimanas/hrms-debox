// Phase 3 — employee lifecycle (EL-1 … EL-9)
import {
  run, section, check, get, post, put, patch, del, upload, bootstrap, createUser, withDb, login, http, ADMIN_EMAIL, DEFAULT_PASSWORD
} from '../lib/harness.mjs';

const L = '/v2/lifecycle';
const IST_OFFSET = 330 * 60000;
const today = new Date(Date.now() + IST_OFFSET).toISOString().slice(0, 10);
const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const addMonths = (dateStr, m) => {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
};
const ymd = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const notificationsFor = (email, type) => withDb(db => db.collection('notifications').find({ user_email: email, ...(type ? { type } : {}) }).toArray());

await run(async () => {
  const admin = await bootstrap();
  const mgr = await createUser(admin, { role: 'manager', name: 'Mira Manager', department: 'LC-Ops', designation: 'Ops Manager' });
  const mgr2 = await createUser(admin, { role: 'manager', name: 'Omar Othermanager', department: 'LC-Sales', designation: 'Sales Manager' });
  const emp = await createUser(admin, { role: 'employee', name: 'Ella Employee', department: 'LC-Ops', designation: 'Analyst', manager_email: mgr.email });
  const outsider = await createUser(admin, { role: 'employee', name: 'Otto Outsider', department: 'LC-Sales', designation: 'Rep', manager_email: mgr2.email });

  // ------------------------------------------------------------------
  section('CORE Employee ID allocation (employees.js)');
  let r = await post('/employee-id-settings', admin, { prefix: 'EMP', counter: 1000 });
  check('counter can be reset below existing IDs', r.s === 200, r);
  r = await post('/employees', admin, { email: `idreset.a.${Date.now()}@example.com`, password: DEFAULT_PASSWORD, full_name: 'Id Reset A', role: 'employee', department: 'LC-Misc', designation: 'Clerk', skip_onboarding: true });
  const idA = r.d?.employee_id;
  check('employee created after counter reset', r.s === 201 && /^EMP\d{4,}$/.test(idA || ''), r);
  r = await post('/employees', admin, { email: `idreset.b.${Date.now()}@example.com`, password: DEFAULT_PASSWORD, full_name: 'Id Reset B', role: 'employee', department: 'LC-Misc', designation: 'Clerk', skip_onboarding: true });
  const idB = r.d?.employee_id;
  check('second employee also created', r.s === 201 && !!idB, r);
  const allIds = await withDb(db => db.collection('employees').find({}, { projection: { employee_id: 1 } }).toArray());
  const ids = allIds.map(e => e.employee_id);
  check('all employee IDs are unique', new Set(ids).size === ids.length && idA !== idB, ids);

  // ------------------------------------------------------------------
  section('EL-1 Onboarding checklists');
  r = await get(`${L}/onboarding/my`, emp.token);
  const myChecklist = r.d?.checklist;
  check('checklist auto-created when employee was added', r.s === 200 && myChecklist?.status === 'in_progress' && myChecklist.tasks.length >= 5, r.d);
  check('progress starts at 0', myChecklist?.progress === 0, myChecklist);
  check('due dates derived from joining date', myChecklist?.tasks.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.due_date)), myChecklist?.tasks);
  const empTask = myChecklist?.tasks.find(t => t.owner === 'employee');
  const mgrTask = myChecklist?.tasks.find(t => t.owner === 'manager');
  const itTask = myChecklist?.tasks.find(t => t.owner === 'it');
  check('employee tasks assigned to the new joiner', empTask?.assignee_email === emp.email, empTask);
  check('manager tasks assigned to the reporting manager', mgrTask?.assignee_email === mgr.email, mgrTask);
  check('IT / HR tasks fall back to an admin', itTask?.assignee_email === ADMIN_EMAIL, itTask);
  const mgrNotes = await notificationsFor(mgr.email, 'onboarding_task_assigned');
  check('task owners notified', mgrNotes.length >= 1, mgrNotes.length);

  r = await get(`${L}/onboarding`, emp.token);
  check('employee cannot list all checklists', r.s === 403, r);
  r = await get(`${L}/onboarding/templates`, emp.token);
  check('employee cannot see templates', r.s === 403, r);
  r = await get(`${L}/onboarding/templates`, admin);
  check('admin sees a default template', r.s === 200 && r.d.some(t => t.is_default), r.d);
  const defaultTemplateId = r.d?.find(t => t.is_default)?.id;
  r = await post(`${L}/onboarding/templates`, admin, { name: 'Bad', tasks: [{ title: 'x task', owner: 'ceo', due_offset_days: 0 }] });
  check('invalid task owner rejected', r.s === 422, r);
  r = await post(`${L}/onboarding/templates`, admin, { name: 'Empty', tasks: [] });
  check('template without tasks rejected', r.s === 422, r);
  r = await post(`${L}/onboarding/templates`, emp.token, { name: 'Mine', tasks: [{ title: 'Do it', owner: 'hr' }] });
  check('employee cannot create template', r.s === 403, r);
  r = await post(`${L}/onboarding/templates`, admin, {
    name: 'Sales onboarding',
    tasks: [
      { title: 'CRM account', owner: 'it', due_offset_days: 0 },
      { title: 'Meet the sales team', owner: 'manager', due_offset_days: 1 },
      { title: 'Read the playbook', owner: 'employee', due_offset_days: 3 }
    ]
  });
  check('admin creates a template', r.s === 201 && r.d.tasks.length === 3 && r.d.tasks.every(t => t.id), r);
  const salesTemplateId = r.d?.id;

  r = await post(`${L}/onboarding/start`, admin, { employee_uid: emp.employee_id });
  check('second active checklist for same employee blocked', r.s === 409, r);
  r = await post(`${L}/onboarding/start`, admin, { employee_uid: 'NOPE-404' });
  check('start for unknown employee → 404', r.s === 404, r);
  r = await post(`${L}/onboarding/start`, mgr.token, { employee_uid: emp.employee_id });
  check('manager cannot start onboarding', r.s === 403, r);

  r = await post('/employees', admin, { email: `skip.${Date.now()}@example.com`, password: DEFAULT_PASSWORD, full_name: 'Sam Skip', role: 'employee', department: 'LC-Sales', designation: 'Rep', manager_email: mgr2.email, skip_onboarding: true, probation_months: 0, date_of_birth: '1995-04-12', gender: 'male' });
  const skipUid = r.d?.employee_id;
  check('skip_onboarding / probation_months 0 / DOB accepted on create', r.s === 201 && r.d.employment_status === 'active' && r.d.gender === 'male', r.d);
  r = await withDb(db => db.collection('onboarding_checklists').countDocuments({ employee_uid: skipUid }));
  check('no checklist when onboarding skipped', r === 0, r);
  r = await post('/employees', admin, { email: `badgender.${Date.now()}@example.com`, password: DEFAULT_PASSWORD, full_name: 'Bad Gender', role: 'employee', department: 'X', designation: 'Y', gender: 'robot' });
  check('invalid gender on create → 422', r.s === 422, r);
  r = await post(`${L}/onboarding/start`, admin, { employee_uid: skipUid, template_id: salesTemplateId });
  check('admin starts onboarding manually with a chosen template', r.s === 201 && r.d.template_name === 'Sales onboarding' && r.d.tasks.length === 3, r);
  const salesChecklistId = r.d?.id;

  r = await patch(`${L}/onboarding/${myChecklist.id}/tasks/${empTask.id}`, emp.token, { done: true, notes: 'Uploaded' });
  check('new joiner completes own task, progress updates', r.s === 200 && r.d.progress > 0 && r.d.tasks.find(t => t.id === empTask.id).done === true, r);
  r = await patch(`${L}/onboarding/${myChecklist.id}/tasks/${mgrTask.id}`, emp.token, { done: true });
  check("new joiner cannot tick the manager's task", r.s === 403, r);
  r = await patch(`${L}/onboarding/${myChecklist.id}/tasks/${empTask.id}`, emp.token, { assignee_email: emp.email });
  check('non-admin cannot reassign', r.s === 403, r);
  r = await patch(`${L}/onboarding/${myChecklist.id}/tasks/${empTask.id}`, emp.token, {});
  check('empty task update rejected', r.s === 422, r);
  r = await patch(`${L}/onboarding/${myChecklist.id}/tasks/${mgrTask.id}`, mgr.token, { done: true });
  check('manager ticks their task', r.s === 200, r);
  r = await get(`${L}/onboarding/${myChecklist.id}`, outsider.token);
  check('unrelated employee cannot view checklist', r.s === 403, r);
  r = await get(`${L}/onboarding/${myChecklist.id}`, mgr2.token);
  check("other team's manager cannot view checklist", r.s === 403, r);
  r = await get(`${L}/onboarding`, mgr.token);
  check("manager's list contains team checklists only", r.s === 200 && r.d.some(c => c.id === myChecklist.id) && !r.d.some(c => c.id === salesChecklistId), r.d?.map?.(c => c.employee_name));
  r = await get(`${L}/onboarding/my`, mgr.token);
  check("manager's assigned tasks include the new joiner's", r.d?.assigned_tasks?.some(t => t.checklist_id === myChecklist.id), r.d);
  r = await patch(`${L}/onboarding/${myChecklist.id}/tasks/${empTask.id}`, admin, { assignee_email: 'nobody.unknown@example.com' });
  check('reassign to unknown person rejected', r.s === 400, r);
  r = await post(`${L}/onboarding/${myChecklist.id}/tasks`, admin, { title: 'Extra security training', owner: 'employee', due_date: addDays(today, 5) });
  check('admin adds a task to a running checklist', r.s === 201 && r.d.tasks.length === myChecklist.tasks.length + 1, r);
  const full = r.d;
  for (const t of full.tasks.filter(x => !x.done)) {
    await patch(`${L}/onboarding/${full.id}/tasks/${t.id}`, admin, { done: true });
  }
  r = await get(`${L}/onboarding/${full.id}`, emp.token);
  check('checklist completes at 100%', r.d?.status === 'completed' && r.d.progress === 100, r.d);
  r = await get(`${L}/onboarding?status=completed`, admin);
  check('admin overview filters by status', r.s === 200 && r.d.every(c => c.status === 'completed') && r.d.some(c => c.id === full.id), r.d?.length);
  r = await del(`${L}/onboarding/templates/${defaultTemplateId}`, admin);
  check('default template cannot be deleted', r.s === 400, r);
  r = await del(`${L}/onboarding/templates/${salesTemplateId}`, admin);
  check('non-default template deleted', r.s === 200, r);

  // ------------------------------------------------------------------
  section('EL-7 Probation and confirmation');
  r = await get('/auth/me', emp.token);
  const empJoin = ymd(r.d?.joining_date);
  check('new employee on probation', r.d?.employment_status === 'probation', r.d?.employment_status);
  check('probation end = joining + 6 months', ymd(r.d?.probation_end_date) === addMonths(empJoin, 6), { join: empJoin, end: r.d?.probation_end_date });
  r = await get(`${L}/probation`, mgr.token);
  check('manager sees team member on probation', r.s === 200 && r.d.some(p => p.uid === emp.employee_id), r.d);
  check('probation list hides other teams from managers', !r.d?.some(p => p.uid === outsider.employee_id), r.d?.map?.(p => p.full_name));
  r = await get(`${L}/probation`, emp.token);
  check('employee cannot list probation', r.s === 403, r);
  const currentEnd = addMonths(empJoin, 6);
  r = await post(`${L}/probation/${emp.employee_id}/extend`, mgr.token, { new_end_date: addDays(currentEnd, -1), reason: 'More time' });
  check('extension must move the end date later', r.s === 400, r);
  r = await post(`${L}/probation/${emp.employee_id}/extend`, mgr.token, { new_end_date: addMonths(currentEnd, 2) });
  check('extension requires a reason', r.s === 422, r);
  r = await post(`${L}/probation/${emp.employee_id}/extend`, mgr2.token, { new_end_date: addMonths(currentEnd, 2), reason: 'x y z' });
  check("another team's manager (who has a team of their own) cannot extend", r.s === 403, r);
  r = await post(`${L}/probation/${emp.employee_id}/confirm`, mgr2.token, {});
  check("another team's manager cannot confirm", r.s === 403, r);
  r = await get(`${L}/people/${emp.employee_id}/overview`, mgr2.token);
  check("another team's manager cannot open the lifecycle overview", r.s === 403, r);
  r = await get(`${L}/personal/${emp.employee_id}`, mgr2.token);
  check("another team's manager cannot read personal details", r.s === 403, r);
  r = await get(`${L}/probation`, mgr2.token);
  check("another team's manager does not see this employee on the probation list", r.s === 200 && !r.d.some(p => p.uid === emp.employee_id) && r.d.some(p => p.uid === outsider.employee_id), r.d?.map?.(p => p.full_name));
  r = await post(`${L}/probation/${emp.employee_id}/extend`, mgr.token, { new_end_date: addMonths(currentEnd, 2), reason: 'Needs more ramp-up' });
  check('manager extends probation', r.s === 200 && r.d.probation_end_date === addMonths(currentEnd, 2) && r.d.extensions.length === 1, r);
  r = await get(`${L}/job-history/${emp.employee_id}`, mgr.token);
  check('extension logged in job history', r.d?.some?.(e => e.type === 'probation_extension'), r.d);
  r = await post(`${L}/probation/${emp.employee_id}/confirm`, emp.token, {});
  check('employee cannot confirm themselves', r.s === 403, r);
  r = await post(`${L}/probation/${emp.employee_id}/confirm`, mgr.token, { notes: 'Great work' });
  check('manager confirms', r.s === 200, r);
  r = await get('/auth/me', emp.token);
  check('confirmation sets status active + confirmation_date', r.d?.employment_status === 'active' && !!r.d.confirmation_date, r.d);
  r = await post(`${L}/probation/${emp.employee_id}/confirm`, mgr.token, {});
  check('cannot confirm twice', r.s === 400, r);
  r = await get(`${L}/job-history/${emp.employee_id}`, admin);
  check('confirmation logged in job history', r.d?.some?.(e => e.type === 'confirmation'), r.d);
  r = await get(`${L}/probation/my`, emp.token);
  check('employee sees own probation status', r.s === 200 && r.d.employment_status === 'active', r.d);

  // Reminder cron: an employee whose probation ends in 7 days
  const probe = await createUser(admin, { role: 'employee', name: 'Pia Probation', department: 'LC-Ops', designation: 'Analyst', manager_email: mgr.email });
  await withDb(db => db.collection('employees').updateOne({ email: probe.email }, { $set: { probation_end_date: new Date(`${addDays(today, 7)}T12:00:00Z`) } }));
  r = await post('/v2/jobs/probation-reminders/run', emp.token, {});
  check('employee cannot run jobs', r.s === 403, r);
  r = await post('/v2/jobs/probation-reminders/run', admin, {});
  check('probation-reminders job runs', r.s === 200 && r.d.result.reminded >= 1, r);
  let notes = await notificationsFor(mgr.email, 'probation_reminder');
  check('manager reminded 7 days before', notes.some(n => n.message.includes('Pia Probation')), notes.map(n => n.message));
  r = await post('/v2/jobs/probation-reminders/run', admin, {});
  check('reminder not repeated the same stage', r.s === 200 && r.d.result.reminded === 0, r.d);
  await withDb(db => db.collection('employees').updateOne({ email: probe.email }, { $set: { probation_end_date: new Date(`${today}T12:00:00Z`) } }));
  r = await post('/v2/jobs/probation-reminders/run', admin, {});
  check('end-date reminder fires on the day', r.d?.result?.reminded >= 1, r.d);
  r = await put(`${L}/probation/${skipUid}`, admin, { probation_end_date: addDays(today, 60) });
  check('admin puts an existing employee on probation', r.s === 200 && r.d.employment_status === 'probation', r);

  // ------------------------------------------------------------------
  section('EL-6 Job history');
  r = await get(`${L}/job-history/my`, emp.token);
  check('own history includes the joining entry', r.s === 200 && r.d.some(e => e.type === 'joined'), r.d);
  r = await put(`/employees/${emp.employee_id}`, admin, { designation: 'Senior Analyst' });
  check('admin changes designation', r.s === 200, r);
  r = await put(`/employees/${emp.employee_id}`, admin, { monthly_salary: 50000 });
  r = await put(`/employees/${emp.employee_id}`, admin, { monthly_salary: 55000 });
  r = await put(`/employees/${emp.employee_id}/role`, admin, { role: 'manager' });
  r = await put(`/employees/${emp.employee_id}/role`, admin, { role: 'employee' });
  r = await get(`${L}/job-history/${emp.employee_id}`, admin);
  const hist = r.d || [];
  check('designation change auto-logged with from/to', hist.some(e => e.type === 'designation_change' && e.changes.some(c => c.from === 'Analyst' && c.to === 'Senior Analyst')), hist);
  check('salary increase logged as increment', hist.some(e => e.type === 'increment' && e.changes.some(c => c.to === 55000)), hist.map(e => e.type));
  check('role change logged', hist.filter(e => e.type === 'role_change').length === 2, hist.map(e => e.type));
  r = await put(`/employees/${emp.employee_id}`, admin, { designation: 'Senior Analyst' });
  const after = await get(`${L}/job-history/${emp.employee_id}`, admin);
  check('unchanged values add no entry', after.d.length === hist.length, after.d.length);
  r = await put(`/employees/${emp.employee_id}`, admin, { manager_email: mgr2.email });
  r = await put(`/employees/${emp.employee_id}`, admin, { manager_email: mgr.email });
  r = await get(`${L}/job-history/${emp.employee_id}`, admin);
  check('manager change logged with names', r.d.some(e => e.type === 'manager_change' && e.changes[0].to_display === 'Omar Othermanager'), r.d.map(e => e.changes));
  r = await get(`${L}/job-history/${emp.employee_id}`, outsider.token);
  check("employee cannot read someone else's history", r.s === 403, r);
  r = await get(`${L}/job-history/${emp.employee_id}`, mgr.token);
  check("manager reads team member's history", r.s === 200, r);
  r = await get(`${L}/job-history/${emp.employee_id}`, mgr2.token);
  check("other manager cannot read history", r.s === 403, r);
  r = await post(`${L}/job-history`, admin, { employee_uid: emp.employee_id, type: 'demotion', effective_date: today });
  check('invalid manual type rejected', r.s === 422, r);
  r = await post(`${L}/job-history`, admin, { employee_uid: emp.employee_id, type: 'promotion', effective_date: '10-10-2026' });
  check('invalid date rejected', r.s === 422, r);
  r = await post(`${L}/job-history`, mgr.token, { employee_uid: emp.employee_id, type: 'promotion', effective_date: today });
  check('manager cannot add manual entries', r.s === 403, r);
  r = await post(`${L}/job-history`, admin, { employee_uid: emp.employee_id, type: 'promotion', effective_date: '2025-04-01', notes: 'Annual cycle', changes: [{ label: 'Grade', from: 'L1', to: 'L2' }] });
  check('admin adds manual promotion', r.s === 201 && r.d.source === 'manual' && r.d.effective_date === '2025-04-01', r);
  const manualId = r.d?.id;
  r = await del(`${L}/job-history/${manualId}`, admin);
  check('manual entry deleted', r.s === 200, r);
  const autoId = hist[0]?.id;
  r = await del(`${L}/job-history/${autoId}`, admin);
  check('auto entries cannot be deleted', r.s === 400, r);
  r = await put(`/employees/${emp.employee_id}`, emp.token, { designation: 'CEO' });
  check('employee cannot change own designation via employees API', r.s === 403, r);
  r = await put(`/employees/${emp.employee_id}`, emp.token, { monthly_salary: 999999 });
  check('employee cannot change own salary', r.s === 403, r);
  r = await put(`/employees/${emp.employee_id}`, emp.token, { phone: '+91 98765 43210' });
  check('employee can still update own phone directly', r.s === 200 && r.d.phone === '+91 98765 43210', r);

  // ------------------------------------------------------------------
  section('EL-8 Profile change requests');
  r = await get(`${L}/profile-requests/fields`, emp.token);
  check('field list available', r.s === 200 && r.d.some(f => f.key === 'blood_group'), r.d);
  r = await post(`${L}/profile-requests`, emp.token, { changes: { blood_group: 'Z+' } });
  check('invalid blood group rejected', r.s === 422, r);
  r = await post(`${L}/profile-requests`, emp.token, { changes: { date_of_birth: addDays(today, 3) } });
  check('future date of birth rejected', r.s === 422, r);
  r = await post(`${L}/profile-requests`, emp.token, { changes: { personal_email: 'not-an-email' } });
  check('invalid personal email rejected', r.s === 422, r);
  r = await post(`${L}/profile-requests`, emp.token, { changes: {} });
  check('empty change set rejected', r.s === 422, r);
  r = await post(`${L}/profile-requests`, emp.token, { changes: { phone: '+91 98765 43210' } });
  check('request identical to current values rejected', r.s === 400, r);
  r = await post(`${L}/profile-requests`, emp.token, { changes: { address: '12 MG Road, Bengaluru', blood_group: 'O+', date_of_birth: '1994-08-15', emergency_contact_name: 'Raj', emergency_contact_phone: '9876500000', marital_status: 'married' }, reason: 'Moved house' });
  check('employee submits change request', r.s === 201 && r.d.status === 'pending' && r.d.changes.length === 6, r);
  const reqId = r.d?.id;
  r = await post(`${L}/profile-requests`, emp.token, { changes: { gender: 'female' } });
  check('only one pending request at a time', r.s === 409, r);
  r = await get(`${L}/profile-requests/pending-count`, admin);
  check('admin pending count', r.s === 200 && r.d.count === 1, r);
  r = await get(`${L}/profile-requests/pending-count`, emp.token);
  check('employee cannot see pending count', r.s === 403, r);
  r = await post(`${L}/profile-requests/${reqId}/approve`, mgr.token, {});
  check('manager cannot approve profile changes', r.s === 403, r);
  r = await post(`${L}/profile-requests/${reqId}/reject`, admin, {});
  check('rejection needs a reason', r.s === 422, r);
  r = await del(`${L}/profile-requests/${reqId}`, outsider.token);
  check("cannot cancel someone else's request", r.s === 403, r);
  r = await post(`${L}/profile-requests/${reqId}/approve`, admin, {});
  check('admin approves', r.s === 200 && r.d.status === 'approved', r);
  r = await get(`${L}/personal/my`, emp.token);
  check('approved values applied to the employee record', r.d?.address === '12 MG Road, Bengaluru' && r.d.blood_group === 'O+' && r.d.date_of_birth === '1994-08-15', r.d);
  r = await post(`${L}/profile-requests/${reqId}/approve`, admin, {});
  check('cannot approve twice', r.s === 400, r);
  r = await post(`${L}/profile-requests`, emp.token, { changes: { gender: 'female' } });
  const req2 = r.d?.id;
  r = await del(`${L}/profile-requests/${req2}`, emp.token);
  check('employee cancels own pending request', r.s === 200, r);
  r = await post(`${L}/profile-requests`, emp.token, { changes: { phone: '+91 90000 11111' } });
  const req3 = r.d?.id;
  r = await post(`${L}/profile-requests/${req3}/reject`, admin, { reason: 'Please use your official number' });
  check('admin rejects with reason', r.s === 200 && r.d.status === 'rejected', r);
  r = await get(`${L}/profile-requests/my`, emp.token);
  check('history shows all statuses', ['approved', 'cancelled', 'rejected'].every(s => r.d?.some(x => x.status === s)), r.d?.map?.(x => x.status));
  r = await get(`${L}/profile-requests?status=pending`, admin);
  check('admin queue filter', r.s === 200 && r.d.length === 0, r.d);
  r = await get(`${L}/personal/${emp.employee_id}`, outsider.token);
  check("cannot read another employee's personal details", r.s === 403, r);
  r = await put(`${L}/personal/${emp.employee_id}`, admin, { gender: 'female' });
  check('admin edits personal details directly', r.s === 200 && r.d.gender === 'female', r);

  // ------------------------------------------------------------------
  section('EL-4 Document vault');
  r = await get(`${L}/documents/types`, emp.token);
  check('document types listed', r.s === 200 && r.d.length === 9, r.d);
  r = await upload(`${L}/documents`, emp.token, [{ field: 'file', name: 'id.pdf', type: 'application/pdf', content: PDF }], { type: 'id_proof', title: 'Aadhaar', expiry_date: addDays(today, 10) });
  check('employee uploads a PDF', r.s === 201 && r.d.verification_status === 'pending' && r.d.expiry_state === 'expiring' && !r.d.file_key && !r.d.file_url, r);
  const docId = r.d?.id;
  r = await upload(`${L}/documents`, emp.token, [{ field: 'file', name: 'notes.txt', type: 'text/plain', content: 'hello' }], { type: 'other' });
  check('disallowed file type rejected', r.s === 400, r);
  r = await upload(`${L}/documents`, emp.token, [{ field: 'file', name: 'fake.pdf', type: 'application/x-msdownload', content: 'MZ' }], { type: 'other' });
  check('mismatched MIME type rejected', r.s === 400, r);
  r = await upload(`${L}/documents`, emp.token, [{ field: 'file', name: 'a.pdf', type: 'application/pdf', content: PDF }], { type: 'passport' });
  check('unknown document type rejected', r.s === 422, r);
  r = await upload(`${L}/documents`, emp.token, [], { type: 'other' });
  check('missing file rejected', r.s === 400, r);
  r = await upload(`${L}/documents`, emp.token, [{ field: 'file', name: 'big.pdf', type: 'application/pdf', content: Buffer.alloc(10 * 1024 * 1024 + 10, 1) }], { type: 'other' });
  check('file over 10 MB rejected', r.s === 413, r);
  r = await upload(`${L}/documents`, emp.token, [{ field: 'file', name: 'x.pdf', type: 'application/pdf', content: PDF }], { type: 'other', employee_uid: outsider.employee_id });
  check("employee cannot upload into someone else's vault", r.s === 403, r);
  r = await get(`${L}/documents/my`, emp.token);
  check('my documents lists the upload', r.s === 200 && r.d.length === 1 && r.d[0].id === docId, r.d);
  r = await get(`${L}/documents/${docId}`, outsider.token);
  check("other employee cannot see the document", r.s === 403, r);
  r = await get(`${L}/documents/${docId}/download`, mgr.token, { raw: true });
  check('managers cannot download team documents', r.s === 403, r.s);
  r = await get(`${L}/documents/${docId}/download`, emp.token, { raw: true });
  check('owner downloads the exact file', r.s === 200 && r.buf.equals(PDF), r.s);
  r = await get(`${L}/documents`, emp.token);
  check('employee cannot list all documents', r.s === 403, r);
  r = await post(`${L}/documents/${docId}/verify`, admin, { status: 'rejected' });
  check('rejecting a document needs a reason', r.s === 422, r);
  r = await post(`${L}/documents/${docId}/verify`, admin, { status: 'verified' });
  check('admin verifies', r.s === 200 && r.d.verification_status === 'verified', r);
  r = await del(`${L}/documents/${docId}`, emp.token);
  check('employee cannot delete a verified document', r.s === 403, r);
  r = await patch(`${L}/documents/${docId}`, emp.token, { title: 'Changed' });
  check('employee cannot edit a verified document', r.s === 400, r);
  r = await upload(`${L}/documents`, emp.token, [{ field: 'file', name: 'deg.png', type: 'image/png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }], { type: 'education' });
  const pendingDoc = r.d?.id;
  r = await del(`${L}/documents/${pendingDoc}`, emp.token);
  check('employee deletes own unverified document', r.s === 200, r);
  r = await upload(`${L}/documents`, admin, [{ field: 'file', name: 'contract.pdf', type: 'application/pdf', content: PDF }], { type: 'contract', employee_uid: emp.employee_id, expiry_date: addDays(today, -2) });
  check('admin uploads for an employee (auto-verified)', r.s === 201 && r.d.verification_status === 'verified' && r.d.expiry_state === 'expired', r);
  r = await get(`${L}/documents?employee_uid=${emp.employee_id}`, admin);
  check('admin filters by employee', r.s === 200 && r.d.length === 2, r.d?.length);
  r = await get(`${L}/documents/expiring?days=30`, admin);
  check('expiring view lists expiring + expired', r.s === 200 && r.d.length === 2, r.d);
  r = await get(`${L}/documents/expiring`, emp.token);
  check('employee cannot see expiring view', r.s === 403, r);
  r = await post('/v2/jobs/document-expiry-alerts/run', admin, {});
  check('document-expiry-alerts job alerts both documents', r.s === 200 && r.d.result.alerted === 2, r);
  notes = await notificationsFor(emp.email, 'document_expiring');
  check('owner notified about expiry', notes.length === 2, notes.length);
  notes = await notificationsFor(ADMIN_EMAIL, 'documents_expiring_digest');
  check('admins get a digest', notes.length === 1, notes.length);
  r = await post('/v2/jobs/document-expiry-alerts/run', admin, {});
  check('alerts are not repeated', r.d?.result?.alerted === 0, r.d);

  // ------------------------------------------------------------------
  section('EL-5 Letter templates');
  r = await get(`${L}/letters/templates`, emp.token);
  check('employee cannot manage letter templates', r.s === 403, r);
  r = await get(`${L}/letters/templates`, admin);
  check('default templates seeded on first use', r.s === 200 && ['offer', 'appointment', 'experience', 'relieving'].every(t => r.d.some(x => x.type === t)), r.d?.map?.(t => t.type));
  const tpl = Object.fromEntries((r.d || []).map(t => [t.type, t]));
  r = await post(`${L}/letters/templates`, admin, { name: 'Bad', type: 'other', body: 'Hello {{nickname}}, welcome!' });
  check('unknown placeholder rejected', r.s === 400, r);
  r = await post(`${L}/letters/templates`, admin, { name: 'No body', type: 'other' });
  check('template without body rejected', r.s === 422, r);
  r = await post(`${L}/letters/templates`, admin, { name: 'Bonus letter', type: 'other', title: 'Bonus', body: 'Dear {{full_name}}, you get a bonus. Regards, {{company_name}} on {{today}}.' });
  check('admin creates a custom template', r.s === 201, r);
  const customId = r.d?.id;
  r = await put(`${L}/letters/templates/${customId}`, admin, { name: 'Bonus letter v2', type: 'other', title: 'Bonus', body: 'Dear {{full_name}} ({{employee_id}}), congratulations.' });
  check('admin updates a template', r.s === 200 && r.d.name === 'Bonus letter v2', r);
  r = await post(`${L}/letters/preview`, admin, { template_id: tpl.experience.id, employee_uid: emp.employee_id });
  check('preview fills employee data', r.s === 200 && r.d.body.includes('Ella Employee') && r.d.body.includes('Senior Analyst'), r.d);
  check('preview reports missing placeholders', r.d?.missing?.includes('exit_date'), r.d?.missing);
  r = await post(`${L}/letters/preview`, admin, { employee_uid: emp.employee_id, body: 'Hi {{full_name}}' });
  check('preview of ad-hoc text', r.s === 200 && r.d.body === 'Hi Ella Employee', r.d);
  r = await post(`${L}/letters/generate`, admin, { template_id: tpl.experience.id, employee_uid: emp.employee_id });
  check('generation blocked while data is missing', r.s === 400 && r.d.missing.includes('exit_date'), r);
  r = await post(`${L}/letters/generate`, admin, { template_id: tpl.offer.id, employee_uid: emp.employee_id });
  check('offer letter generated into the vault', r.s === 201 && r.d.type === 'offer_letter' && r.d.source === 'letter' && r.d.verification_status === 'verified', r);
  const letterDoc = r.d?.id;
  r = await post(`${L}/letters/generate`, admin, { template_id: tpl.experience.id, employee_uid: emp.employee_id, allow_missing: true });
  check('can generate anyway with allow_missing', r.s === 201 && r.d.type === 'experience', r);
  r = await post(`${L}/letters/generate`, emp.token, { template_id: tpl.offer.id, employee_uid: emp.employee_id });
  check('employee cannot generate letters', r.s === 403, r);
  r = await post(`${L}/letters/generate`, admin, { template_id: 'missing', employee_uid: emp.employee_id });
  check('unknown template → 404', r.s === 404, r);
  r = await get(`${L}/letters/my`, emp.token);
  check('employee sees letters issued to them', r.s === 200 && r.d.length === 2, r.d);
  r = await get(`${L}/documents/${letterDoc}/download`, emp.token, { raw: true });
  check('employee downloads the letter PDF', r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', r.s);
  r = await get(`${L}/documents/${letterDoc}/download`, outsider.token, { raw: true });
  check("others cannot download the letter", r.s === 403, r.s);
  r = await get(`${L}/letters/issued?employee_uid=${emp.employee_id}`, admin);
  check('admin sees issued letters', r.s === 200 && r.d.length === 2, r.d?.length);
  r = await del(`${L}/letters/templates/${customId}`, admin);
  check('admin deletes a template', r.s === 200, r);
  notes = await notificationsFor(emp.email, 'letter_issued');
  check('employee notified when a letter is issued', notes.length === 2, notes.length);

  // ------------------------------------------------------------------
  section('EL-2 Offboarding');
  r = await get(`${L}/settings`, emp.token);
  check('notice period defaults to 30 days', r.s === 200 && r.d.notice_period_days === 30, r.d);
  r = await put(`${L}/settings`, emp.token, { notice_period_days: 10 });
  check('employee cannot change settings', r.s === 403, r);
  r = await put(`${L}/settings`, admin, { notice_period_days: -3 });
  check('invalid settings rejected', r.s === 422, r);
  r = await put(`${L}/settings`, admin, { company_name: 'Acme Test Pvt Ltd', notice_period_days: 30 });
  check('admin updates settings', r.s === 200 && r.d.company_name === 'Acme Test Pvt Ltd', r.d);

  const joined = addDays(today, -Math.round(6.2 * 365));
  const leaver = await createUser(admin, { role: 'employee', name: 'Leo Leaver', department: 'LC-Ops', designation: 'Engineer', manager_email: mgr.email, joining_date: joined });
  await put(`/employees/${leaver.employee_id}`, admin, { monthly_salary: 60000 });
  const lwd = addDays(today, 20);
  await withDb(async db => {
    await db.collection('employees').updateOne({ email: leaver.email }, { $set: { 'leave_balance.earned_leave': 10 } });
    await db.collection('loans').insertOne({ id: 'loan-lc-1', employee_uid: leaver.employee_id, principal: 50000, outstanding: 12000, emi: 5000, status: 'active' });
    await db.collection('loans').insertOne({ id: 'loan-lc-2', employee_uid: leaver.employee_id, principal: 9000, outstanding: 0, emi: 3000, status: 'closed' });
    await db.collection('assets').insertOne({ id: 'asset-lc-1', asset_tag: 'LAP-001', name: 'MacBook Pro', category: 'laptop', status: 'assigned', assigned_to_uid: leaver.employee_id, assigned_to_email: leaver.email });
    await db.collection('assets').insertOne({ id: 'asset-lc-2', asset_tag: 'PHN-002', name: 'Phone', category: 'mobile', status: 'in_repair', assigned_to_uid: leaver.employee_id, assigned_to_email: leaver.email });
    await db.collection('assets').insertOne({ id: 'asset-lc-3', asset_tag: 'MON-003', name: 'Monitor', category: 'display', status: 'lost', assigned_to_email: leaver.email });
    await db.collection('assets').insertOne({ id: 'asset-lc-4', asset_tag: 'KEY-004', name: 'Keyboard', category: 'peripheral', status: 'available', assigned_to_uid: leaver.employee_id, assigned_to_email: leaver.email });
    await db.collection('assets').insertOne({ id: 'asset-lc-5', asset_tag: 'LAP-005', name: 'Other laptop', category: 'laptop', status: 'assigned', assigned_to_uid: outsider.employee_id, assigned_to_email: outsider.email });
  });

  r = await post(`${L}/offboarding/resign`, leaver.token, { last_working_day: lwd });
  check('resignation needs a reason', r.s === 422, r);
  r = await post(`${L}/offboarding/resign`, leaver.token, { reason: 'Moving on', last_working_day: addDays(today, -1) });
  check('last working day in the past rejected', r.s === 400, r);
  r = await post(`${L}/offboarding/resign`, leaver.token, { reason: 'Moving on', last_working_day: '2026/13/01' });
  check('malformed date rejected', r.s === 422, r);
  r = await post(`${L}/offboarding/resign`, leaver.token, { reason: 'Better opportunity' });
  check('resignation submitted; LWD defaults to notice end', r.s === 201 && r.d.status === 'pending' && r.d.requested_last_day === addDays(today, 30) && r.d.notice_period_days === 30, r);
  const firstSep = r.d?.id;
  r = await post(`${L}/offboarding/resign`, leaver.token, { reason: 'Again' });
  check('second active resignation blocked', r.s === 409, r);
  notes = await notificationsFor(mgr.email, 'resignation_submitted');
  check('manager notified of the resignation', notes.length >= 1, notes.length);
  r = await post(`${L}/offboarding/${firstSep}/withdraw`, emp.token, {});
  check("cannot withdraw someone else's resignation", r.s === 403, r);
  r = await post(`${L}/offboarding/${firstSep}/withdraw`, leaver.token, {});
  check('employee withdraws a pending resignation', r.s === 200 && r.d.status === 'withdrawn', r);
  r = await post(`${L}/offboarding/${firstSep}/withdraw`, leaver.token, {});
  check('cannot withdraw twice', r.s === 400, r);
  r = await post(`${L}/offboarding/resign`, leaver.token, { reason: 'Better opportunity', last_working_day: lwd, notes: 'Can help with handover' });
  check('resigns again with a proposed LWD', r.s === 201 && r.d.requested_last_day === lwd, r);
  const sepId = r.d?.id;
  r = await get(`${L}/offboarding`, emp.token);
  check('employee cannot view the pipeline', r.s === 403, r);
  r = await get(`${L}/offboarding`, mgr2.token);
  check("other manager does not see this resignation", r.s === 200 && !r.d.some(s => s.id === sepId), r.d);
  r = await post(`${L}/offboarding/${sepId}/approve`, mgr2.token, {});
  check("other team's manager cannot approve", r.s === 403, r);
  r = await post(`${L}/offboarding/${sepId}/approve`, leaver.token, {});
  check('employee cannot approve', r.s === 403, r);
  r = await post(`${L}/offboarding/${sepId}/reject`, mgr.token, {});
  check('rejection needs comments', r.s === 422, r);
  r = await post(`${L}/offboarding/${sepId}/approve`, mgr.token, { last_working_day: addDays(today, -400) });
  check('LWD before resignation date rejected', r.s === 400, r);
  r = await post(`${L}/offboarding/${sepId}/approve`, mgr.token, { comments: 'All the best' });
  check('manager approves', r.s === 200 && r.d.status === 'approved' && r.d.last_working_day === lwd, r);
  const checklist = r.d?.checklist || [];
  check('exit checklist created from template', checklist.some(i => i.category === 'knowledge_transfer') && checklist.some(i => i.category === 'access'), checklist);
  check("employee's assigned asset is on the checklist", checklist.some(i => i.asset_id === 'asset-lc-1' && i.title.includes('LAP-001')), checklist);
  check('assets in repair / lost are still listed for return', checklist.some(i => i.asset_id === 'asset-lc-2') && checklist.some(i => i.asset_id === 'asset-lc-3'), checklist.map(i => i.asset_id));
  check("returned assets and other people's assets are not listed", !checklist.some(i => ['asset-lc-4', 'asset-lc-5'].includes(i.asset_id)), checklist.map(i => i.asset_id));
  r = await get('/auth/me', leaver.token);
  check("employee is now 'notice' with exit_date", r.d?.employment_status === 'notice' && ymd(r.d.exit_date) === lwd, r.d);
  r = await post(`${L}/offboarding/${sepId}/approve`, mgr.token, {});
  check('cannot approve twice', r.s === 400, r);
  r = await get(`${L}/offboarding/my`, leaver.token);
  check('employee sees their approved separation', r.s === 200 && r.d.current?.id === sepId && r.d.current.status === 'approved', r.d);

  r = await post(`${L}/offboarding/${sepId}/settlement/compute`, mgr.token, {});
  check('manager cannot compute settlement', r.s === 403, r);
  r = await post(`${L}/offboarding/${sepId}/settlement/compute`, admin, {});
  const lines = r.d?.settlement?.lines || [];
  const lineBy = (key) => lines.find(l => l.key === key);
  check('settlement computed', r.s === 200 && r.d.settlement.status === 'draft', r);
  const [ly, lm, ld] = lwd.split('-').map(Number);
  const dim = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
  check('salary for days worked in final month', near(lineBy('salary')?.amount, Math.round((60000 * ld / dim) * 100) / 100), { line: lineBy('salary'), ld, dim });
  check('leave encashment = 10 × basic / 26', near(lineBy('leave_encashment')?.amount, Math.round((10 * 30000 / 26) * 100) / 100), lineBy('leave_encashment'));
  const grat = lineBy('gratuity');
  check('gratuity included for 6+ years of service', grat && grat.amount > 0 && (!grat.detail.includes('inline') || near(grat.amount, Math.round((15 / 26) * 30000 * 6 * 100) / 100)), grat);
  check('outstanding loan recovered (closed loans ignored)', lines.filter(l => l.key.startsWith('loan:')).length === 1 && near(lineBy('loan:loan-lc-1')?.amount, 12000), lines);
  check('notice shortfall recovery (10 of 30 days)', near(lineBy('notice_recovery')?.amount, 20000) && lineBy('notice_recovery').type === 'deduction', lineBy('notice_recovery'));
  const totals = r.d?.settlement?.totals;
  check('totals add up', totals && near(totals.net, totals.earnings - totals.deductions), totals);
  r = await post(`${L}/offboarding/${sepId}/settlement/lines`, admin, { label: 'Bonus', type: 'earning', amount: -5 });
  check('negative manual amount rejected', r.s === 422, r);
  r = await post(`${L}/offboarding/${sepId}/settlement/lines`, admin, { label: 'Retention bonus', type: 'earning', amount: 15000, detail: 'Pro-rata' });
  check('admin adds a manual line', r.s === 201 && r.d.settlement.lines.some(l => !l.auto && l.amount === 15000), r);
  const manualLine = r.d?.settlement?.lines?.find(l => !l.auto);
  r = await post(`${L}/offboarding/${sepId}/settlement/compute`, admin, {});
  check('recompute keeps manual lines', r.d?.settlement?.lines?.some(l => l.id === manualLine.id), r.d?.settlement?.lines);
  r = await del(`${L}/offboarding/${sepId}/settlement/lines/does-not-exist`, admin);
  check('removing an unknown line → 404', r.s === 404, r);
  r = await get(`${L}/offboarding/${sepId}`, admin);
  const noticeLine = r.d.settlement.lines.find(l => l.key === 'notice_recovery');
  r = await del(`${L}/offboarding/${sepId}/settlement/lines/${noticeLine.id}`, admin);
  check('admin can waive a line by deleting it', r.s === 200 && !r.d.settlement.lines.some(l => l.key === 'notice_recovery'), r);
  r = await get(`${L}/offboarding/${sepId}`, mgr.token);
  check('manager sees status but not settlement amounts', r.s === 200 && !r.d.settlement?.lines, r.d?.settlement);
  r = await get(`${L}/offboarding/${sepId}`, outsider.token);
  check('unrelated employee cannot view the separation', r.s === 403, r);

  const itItem = checklist.find(i => i.owner === 'it');
  const empItem = checklist.find(i => i.owner === 'employee');
  r = await patch(`${L}/offboarding/${sepId}/checklist/${itItem.id}`, leaver.token, { done: true });
  check('leaver cannot tick IT items', r.s === 403, r);
  r = await patch(`${L}/offboarding/${sepId}/checklist/${empItem.id}`, leaver.token, { done: true, notes: 'Handover doc shared' });
  check('leaver ticks own items', r.s === 200 && r.d.checklist.find(i => i.id === empItem.id).done, r);
  r = await post(`${L}/offboarding/${sepId}/finalize`, admin, {});
  check('finalize blocked while checklist open / LWD in future', r.s === 400 && r.d.blockers?.length >= 1, r);

  section('EL-3 Exit interviews');
  r = await get(`${L}/exit-interview/my`, emp.token);
  check('not eligible without an accepted resignation', r.s === 200 && r.d.eligible === false, r.d);
  r = await post(`${L}/exit-interview/my`, emp.token, { answers: [] });
  check('submission blocked without an accepted resignation', r.s === 400, r);
  r = await get(`${L}/exit-interview/my`, leaver.token);
  check('leaver is eligible during notice', r.s === 200 && r.d.eligible === true && r.d.questions.length > 0, r.d);
  const qs = r.d?.questions || [];
  const reasonQ = qs.find(q => q.is_reason);
  const ratingQs = qs.filter(q => q.type === 'rating');
  r = await post(`${L}/exit-interview/my`, leaver.token, { answers: [{ question_id: ratingQs[0].id, rating: 4 }] });
  check('required questions enforced', r.s === 422, r);
  r = await post(`${L}/exit-interview/my`, leaver.token, { answers: [{ question_id: ratingQs[0].id, rating: 9 }] });
  check('rating outside 1–5 rejected', r.s === 422, r);
  const answers = [
    { question_id: reasonQ.id, choice: 'Career growth' },
    ...ratingQs.map((q, i) => ({ question_id: q.id, rating: i % 2 ? 2 : 4 })),
    ...qs.filter(q => q.type === 'text').map(q => ({ question_id: q.id, text: 'Good team' }))
  ];
  r = await post(`${L}/exit-interview/my`, leaver.token, { answers: answers.map(a => a.question_id === reasonQ.id ? { ...a, choice: 'Free pizza' } : a) });
  check('choice outside the options rejected', r.s === 422, r);
  r = await post(`${L}/exit-interview/my`, leaver.token, { answers });
  check('leaver submits the exit interview', r.s === 201 && r.d.primary_reason === 'Career growth', r);
  r = await post(`${L}/exit-interview/my`, leaver.token, { answers });
  check('cannot submit twice', r.s === 409, r);

  section('EL-2 Offboarding — finalization');
  for (const item of checklist.filter(i => i.id !== empItem.id)) {
    await patch(`${L}/offboarding/${sepId}/checklist/${item.id}`, admin, { done: true });
  }
  r = await post(`${L}/offboarding/${sepId}/finalize`, admin, {});
  check('still blocked while LWD is in the future', r.s === 400 && r.d.blockers.length === 1, r);
  r = await post(`${L}/offboarding/${sepId}/finalize`, mgr.token, { force: true });
  check('manager cannot finalize', r.s === 403, r);
  r = await post(`${L}/offboarding/${sepId}/finalize`, admin, { force: true });
  check('admin finalizes the settlement', r.s === 200 && r.d.status === 'completed' && r.d.settlement.status === 'finalized' && !!r.d.settlement.document_id, r);
  const state = await withDb(async db => ({
    emp: await db.collection('employees').findOne({ email: leaver.email }),
    user: await db.collection('users').findOne({ email: leaver.email })
  }));
  check("employee marked 'exited' with exit date", state.emp.employment_status === 'exited' && ymd(state.emp.exit_date) === lwd && state.emp.exit_reason === 'Better opportunity', state.emp);
  check('login account deactivated (users.is_active = false)', state.user.is_active === false, state.user);
  check('password hash never exposed in API responses', !JSON.stringify(r.d).includes('hashed_password'), null);
  r = await http('GET', `${L}/offboarding/${sepId}/settlement/pdf`, admin, undefined, { raw: true });
  check('settlement PDF generated and downloadable', r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', r.s);
  r = await http('GET', `${L}/offboarding/my`, leaver.token);
  check("exited employee's session is no longer accepted", r.s === 401, r.s);
  r = await get(`${L}/offboarding/${sepId}/settlement/pdf`, outsider.token, { raw: true });
  check("others cannot download the settlement", r.s === 403, r.s);
  r = await post(`${L}/offboarding/${sepId}/settlement/compute`, admin, {});
  check('settlement locked after finalization', r.s === 400, r);
  r = await get(`${L}/job-history/${leaver.employee_id}`, admin);
  check('separation + exit logged in job history', r.d?.some(e => e.type === 'separation') && r.d.some(e => e.type === 'exit'), r.d?.map?.(e => e.type));
  r = await get(`${L}/documents?employee_uid=${leaver.employee_id}`, admin);
  check('settlement statement filed in the vault', r.d?.some(d => d.source === 'settlement'), r.d);
  r = await get(`${L}/offboarding?status=completed`, admin);
  check('pipeline filters by status', r.s === 200 && r.d.some(s => s.id === sepId), r.d?.length);

  // Termination flow
  const term = await createUser(admin, { role: 'employee', name: 'Tia Terminated', department: 'LC-Sales', designation: 'Rep', manager_email: mgr2.email });
  r = await post(`${L}/offboarding/terminate`, mgr2.token, { employee_uid: term.employee_id, reason: 'Policy breach', last_working_day: today });
  check('manager cannot terminate', r.s === 403, r);
  r = await post(`${L}/offboarding/terminate`, admin, { employee_uid: term.employee_id, reason: 'Policy breach' });
  check('termination needs a last working day', r.s === 422, r);
  const adminUid = (await get('/auth/me', admin)).d?.employee_id;
  r = await post(`${L}/offboarding/terminate`, admin, { employee_uid: adminUid, reason: 'Oops', last_working_day: today });
  check('admin cannot terminate themselves', r.s === 400, r);
  r = await post(`${L}/offboarding/terminate`, admin, { employee_uid: term.employee_id, reason: 'Restructuring', last_working_day: addDays(today, 5) });
  check('admin termination is approved immediately', r.s === 201 && r.d.status === 'approved' && r.d.type === 'termination', r);
  const termSep = r.d?.id;
  r = await post(`${L}/offboarding/resign`, term.token, { reason: 'x y z' });
  check('cannot resign while a separation is active', r.s === 409, r);

  section('EL-3 Exit interviews — template and analytics');
  r = await get(`${L}/exit-interview/my`, term.token);
  check('terminated employee can also give an exit interview', r.d?.eligible === true, r.d);
  const tAnswers = [
    { question_id: reasonQ.id, choice: 'Relocation' },
    ...ratingQs.map(q => ({ question_id: q.id, rating: 3 }))
  ];
  r = await post(`${L}/exit-interview/my`, term.token, { answers: tAnswers });
  check('second response stored', r.s === 201, r);
  r = await get(`${L}/exit-interviews/summary`, emp.token);
  check('employee cannot view exit analytics', r.s === 403, r);
  r = await get(`${L}/exit-interviews/summary`, admin);
  check('summary aggregates responses', r.s === 200 && r.d.responses === 2, r.d);
  const firstRating = r.d?.ratings?.find(x => x.question_id === ratingQs[0].id);
  check('average rating per question', firstRating && near(firstRating.average, (4 + 3) / 2), r.d?.ratings);
  check('reasons-for-leaving breakdown', r.d?.reasons?.some(x => x.reason === 'Career growth' && x.count === 1) && r.d.reasons.some(x => x.reason === 'Relocation'), r.d?.reasons);
  r = await get(`${L}/exit-interviews`, admin);
  check('admin lists individual responses', r.s === 200 && r.d.length === 2 && r.d.every(x => x.average_rating != null), r.d?.length);
  r = await get(`${L}/exit-interviews/${r.d[0].id}`, admin);
  check('admin reads one response', r.s === 200 && r.d.answers.length > 0, r);
  r = await put(`${L}/exit-interview/template`, admin, { questions: [{ type: 'choice', text: 'Why leave?' }] });
  check('choice question without options rejected', r.s === 422, r);
  r = await put(`${L}/exit-interview/template`, admin, { questions: [
    { type: 'choice', text: 'Why leave?', options: ['Pay', 'Growth'], is_reason: true },
    { type: 'choice', text: 'Another reason?', options: ['A', 'B'], is_reason: true }
  ] });
  check('only one reason question allowed', r.s === 400, r);
  r = await put(`${L}/exit-interview/template`, emp.token, { questions: [{ type: 'text', text: 'Anything else?' }] });
  check('employee cannot edit the questionnaire', r.s === 403, r);
  r = await put(`${L}/exit-interview/template`, admin, { questions: [
    { id: 'why', type: 'choice', text: 'Main reason for leaving?', options: ['Pay', 'Growth', 'Other'], is_reason: true, required: true },
    { id: 'score', type: 'rating', text: 'Rate your time here', required: true },
    { type: 'text', text: 'Anything else?' }
  ] });
  check('admin edits the questionnaire', r.s === 200 && r.d.questions.length === 3 && r.d.questions[2].id, r);

  section('EL-2 Offboarding — cancellation');
  r = await post(`${L}/offboarding/${termSep}/cancel`, mgr2.token, {});
  check('manager cannot cancel a separation', r.s === 403, r);
  r = await post(`${L}/offboarding/${termSep}/cancel`, admin, {});
  check('admin cancels an approved separation', r.s === 200 && r.d.status === 'cancelled', r);
  r = await get('/auth/me', term.token);
  check('employee restored to previous status', r.d?.employment_status === 'probation' && !r.d.exit_date, r.d);

  // ------------------------------------------------------------------
  section('EL-9 Org chart');
  r = await get(`${L}/org-chart`, emp.token);
  const nodes = r.d || [];
  const nodeOf = (uid) => nodes.find(n => n.uid === uid);
  check('org chart available to every employee', r.s === 200 && nodes.length >= 5, r);
  check('reporting line via manager_email', nodeOf(emp.employee_id)?.manager_uid === mgr.employee_id, nodeOf(emp.employee_id));
  check('direct report counts', nodeOf(mgr.employee_id)?.direct_reports >= 2, nodeOf(mgr.employee_id));
  check('roots have no manager', nodeOf(adminUid)?.manager_uid === null, nodeOf(adminUid));
  check('exited employees hidden', !nodeOf(leaver.employee_id), null);
  check('no salary / personal data exposed', !JSON.stringify(nodes).match(/monthly_salary|leave_balance|blood_group|hashed_password/), null);
  r = await get(`${L}/org-chart?include_exited=1`, admin);
  check('admin can include exited employees', r.d?.some(n => n.uid === leaver.employee_id), null);
  await withDb(async db => {
    await db.collection('employees').updateOne({ email: mgr2.email }, { $set: { manager_email: outsider.email } });
  });
  r = await get(`${L}/org-chart`, emp.token);
  const cyc = (r.d || []).filter(n => [mgr2.employee_id, outsider.employee_id].includes(n.uid));
  check('reporting cycles are broken into a root', r.s === 200 && cyc.some(n => n.manager_uid === null), cyc);
  await withDb(db => db.collection('employees').updateOne({ email: mgr2.email }, { $set: { manager_email: null } }));
  await withDb(db => db.collection('employees').updateOne({ email: emp.email }, { $set: { manager_email: 'ghost@nowhere.test' } }));
  r = await get(`${L}/org-chart`, emp.token);
  check('manager that no longer exists → shown as a root', r.d?.find(n => n.uid === emp.employee_id)?.manager_uid === null, null);
  await withDb(db => db.collection('employees').updateOne({ email: emp.email }, { $set: { manager_email: mgr.email } }));
  r = await get(`${L}/people/${emp.employee_id}/overview`, emp.token);
  check('employee lifecycle overview (self)', r.s === 200 && r.d.onboarding?.progress === 100 && r.d.documents >= 1, r.d);
  r = await get(`${L}/people/${emp.employee_id}/overview`, outsider.token);
  check('overview forbidden to unrelated employees', r.s === 403, r);
  r = await get(`${L}/summary`, admin);
  check('admin dashboard summary', r.s === 200 && typeof r.d.pending_profile_requests === 'number' && r.d.documents_expiring >= 2, r.d);
  r = await get(`${L}/summary`, emp.token);
  check('employee cannot read the dashboard summary', r.s === 403, r);

  const relogin = await login(leaver.email);
  check('exited employee cannot log in again', relogin === null, relogin);
});
