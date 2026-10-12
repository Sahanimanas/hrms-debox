/**
 * Hooks called by routes/employees.js so lifecycle data stays in sync with
 * the core employee API. Every hook swallows its own errors: a lifecycle
 * bookkeeping failure must never fail creating or updating an employee.
 */

const { getSettings, toDateStr, todayStr, addMonthsStr, dateFromStr } = require('./common');
const { recordJobEvent, recordProfileChanges } = require('./jobHistory');
const { startOnboarding } = require('./onboarding');

/**
 * After POST /api/employees.
 * Sets probation fields, writes the "joined" job-history entry and starts onboarding.
 * Returns the fields that were added to the employee document.
 */
const onEmployeeCreated = async (db, employee, actor, options = {}) => {
  const added = {};
  try {
    const settings = await getSettings(db);
    const months = options.probation_months ?? settings.probation_months;
    const joining = toDateStr(employee.joining_date) || todayStr();
    if (months > 0) {
      added.employment_status = 'probation';
      added.probation_end_date = dateFromStr(addMonthsStr(joining, Number(months)));
    } else {
      added.employment_status = 'active';
      added.probation_end_date = null;
      added.confirmation_date = dateFromStr(joining);
    }
    await db.collection('employees').updateOne({ email: employee.email }, { $set: added });

    await recordJobEvent(db, {
      employee: { ...employee, ...added },
      type: 'joined',
      title: `Joined as ${employee.designation || 'employee'}`,
      changes: [
        { field: 'designation', label: 'Designation', from: null, to: employee.designation || null },
        { field: 'department', label: 'Department', from: null, to: employee.department || null }
      ],
      effective_date: joining,
      notes: months > 0 ? `Probation of ${months} month(s) until ${toDateStr(added.probation_end_date)}` : null,
      actor
    });

    if (!options.skip_onboarding) {
      await startOnboarding(db, { ...employee, ...added }, actor, { templateId: options.onboarding_template_id || null });
    }
  } catch (error) {
    console.error('[lifecycle] onEmployeeCreated failed:', error.message);
  }
  return added;
};

/** After PUT /api/employees/:id — records designation / department / manager / salary changes. */
const onEmployeeUpdated = async (db, before, updates, actor) => {
  try {
    await recordProfileChanges(db, before, updates, actor);
  } catch (error) {
    console.error('[lifecycle] onEmployeeUpdated failed:', error.message);
  }
};

/** After PUT /api/employees/:id/role. */
const onRoleChanged = async (db, employee, newRole, actor) => {
  try {
    await recordProfileChanges(db, employee, { role: newRole }, actor);
  } catch (error) {
    console.error('[lifecycle] onRoleChanged failed:', error.message);
  }
};

module.exports = { onEmployeeCreated, onEmployeeUpdated, onRoleChanged };
