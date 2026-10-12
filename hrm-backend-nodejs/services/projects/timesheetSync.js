/**
 * Xeno PM <-> HR timesheets (TA-10, routes/timesheets.js).
 *
 * Every PM project is mirrored by a timesheet project (collection `projects`)
 * so time logged on a task lands in the employee's weekly HR timesheet as a
 * draft entry — managers then approve it through the normal timesheet flow.
 * Weeks that are already submitted / approved are never modified; the
 * worklog is kept in PM and reported back as not synced.
 */

const { generateUUID, employeeUid } = require('../../utils/helpers');
const { findMyEmployee } = require('../time/core');
const { addDays } = require('./common');

const EDITABLE = ['draft', 'rejected'];

const mondayOf = (dateStr) => {
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, day === 0 ? -6 : 1 - day);
};

/** Create or refresh the timesheet project mirroring a PM project. Returns its id. */
const ensureTimesheetProject = async (db, project) => {
  const fields = {
    name: project.name,
    client: project.client || null,
    description: project.description ? String(project.description).slice(0, 1000) : null,
    billable: project.billable !== false,
    status: project.archived ? 'archived' : 'active',
    member_emails: [...new Set([project.lead_email, ...(project.members || []).filter(m => m.role !== 'viewer').map(m => m.email)].filter(Boolean))],
    updated_at: new Date()
  };

  if (project.timesheet_project_id) {
    const { matchedCount } = await db.collection('projects').updateOne({ id: project.timesheet_project_id }, { $set: fields });
    if (matchedCount) return project.timesheet_project_id;
  }

  // Prefer the project key as the timesheet code; fall back if it's taken
  let code = project.key;
  const taken = await db.collection('projects').findOne({ code });
  if (taken && taken.pm_project_id !== project.id) code = `${project.key}-PM`.slice(0, 20);
  const existing = await db.collection('projects').findOne({ code });
  if (existing) {
    await db.collection('projects').updateOne({ id: existing.id }, { $set: { ...fields, pm_project_id: project.id } });
    return existing.id;
  }

  const id = generateUUID();
  await db.collection('projects').insertOne({
    id,
    code,
    ...fields,
    pm_project_id: project.id,
    created_by: project.created_by,
    created_at: new Date()
  });
  return id;
};

/**
 * Add a worklog to the owner's HR timesheet.
 * Returns { synced: true, entry_id } or { synced: false, reason }.
 */
const syncWorklog = async (db, { project, task, worklog }) => {
  try {
    const employee = await findMyEmployee(db, worklog.user_email);
    if (!employee) return { synced: false, reason: 'No employee profile linked to this account' };
    const uid = employeeUid(employee);
    const weekStart = mondayOf(worklog.date);

    const sheet = await db.collection('timesheets').findOne({ employee_uid: uid, week_start: weekStart });
    if (sheet && !EDITABLE.includes(sheet.status)) {
      return { synced: false, reason: `Timesheet for week of ${weekStart} is ${sheet.status}` };
    }

    const dayEntries = await db.collection('timesheet_entries').find({ employee_uid: uid, date: worklog.date }, { projection: { minutes: 1 } }).toArray();
    const dayTotal = dayEntries.reduce((s, e) => s + (e.minutes || 0), 0);
    if (dayTotal + worklog.minutes > 1440) return { synced: false, reason: `More than 24 hours would be logged on ${worklog.date}` };

    const tsProjectId = project.timesheet_project_id || await ensureTimesheetProject(db, project);
    const tsProject = await db.collection('projects').findOne({ id: tsProjectId });
    const now = new Date();
    const entry = {
      id: generateUUID(),
      employee_uid: uid,
      user_email: employee.email,
      employee_name: employee.full_name,
      department: employee.department || null,
      date: worklog.date,
      week_start: weekStart,
      project_id: tsProjectId,
      project_name: project.name,
      project_code: tsProject?.code || project.key,
      task: `${task.key} ${task.title}`.slice(0, 120),
      billable: worklog.billable,
      notes: worklog.note || '',
      minutes: worklog.minutes,
      source: 'pm',
      worklog_id: worklog.id,
      created_at: now
    };
    await db.collection('timesheet_entries').insertOne(entry);
    await db.collection('timesheets').updateOne(
      { employee_uid: uid, week_start: weekStart },
      {
        $inc: { total_minutes: worklog.minutes },
        $set: { updated_at: now },
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
    return { synced: true, entry_id: entry.id };
  } catch (error) {
    console.error('[projects] timesheet sync failed:', error.message);
    return { synced: false, reason: 'Timesheet sync failed' };
  }
};

/** Remove a worklog's timesheet entry if its week is still editable. */
const unsyncWorklog = async (db, worklog) => {
  try {
    const entry = await db.collection('timesheet_entries').findOne({ worklog_id: worklog.id });
    if (!entry) return { removed: false };
    const sheet = await db.collection('timesheets').findOne({ employee_uid: entry.employee_uid, week_start: entry.week_start });
    if (sheet && !EDITABLE.includes(sheet.status)) return { removed: false, reason: `Timesheet is ${sheet.status}` };
    await db.collection('timesheet_entries').deleteOne({ id: entry.id });
    if (sheet) await db.collection('timesheets').updateOne({ id: sheet.id }, { $inc: { total_minutes: -entry.minutes }, $set: { updated_at: new Date() } });
    return { removed: true };
  } catch (error) {
    console.error('[projects] timesheet unsync failed:', error.message);
    return { removed: false };
  }
};

module.exports = { ensureTimesheetProject, syncWorklog, unsyncWorklog, mondayOf };
