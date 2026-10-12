/**
 * Year-end leave processing (LV-1).
 *
 * Closing year Y, per employee and per leave type that resets every year:
 *   carry  = min(balance, max_carry_forward_days)   when carry_forward_allowed (0 / empty cap = no cap)
 *   encash = the rest, up to max_encashment_days     when encashment_allowed
 *   lapse  = whatever is left
 * Encashments are written to `leave_encashments` (status 'pending'; the payroll
 * module pays them) at days × basic / 26. Every decision is logged in
 * `leave_year_end_logs`, and the carried days are stored on the employee as
 * `leave_carry_forward = { year: Y + 1, balances }`.
 *
 * The January reset in cron/monthlyLeaveCredit.js then sets each balance to the
 * new year's credit PLUS the carried days, once per employee per year
 * (`leave_reset_year`). Closing is idempotent per employee (`leave_year_end_year`).
 */

const { generateUUID, normalizeLeaveType, employeeUid, localParts } = require('../../utils/helpers');
const { createNotification, NotificationType } = require('../notificationService');
const { getPolicyDoc, resetsYearly, effectiveBalance, round1, round2 } = require('./common');

const LOGS = 'leave_year_end_logs';
const RUNS = 'leave_year_end_runs';
const ENCASHMENTS = 'leave_encashments';
const WORKING_DAYS_PER_MONTH = 26;

let indexesReady = false;
async function ensureIndexes(db) {
  if (indexesReady) return;
  await Promise.all([
    db.collection(ENCASHMENTS).createIndex({ employee_id: 1, leave_type: 1, year: 1 }, { unique: true }),
    db.collection(ENCASHMENTS).createIndex({ status: 1 }),
    db.collection(LOGS).createIndex({ year: 1, employee_uid: 1 }, { unique: true }),
    db.collection(RUNS).createIndex({ year: 1, started_at: -1 })
  ]);
  indexesReady = true;
}

/** Employees the year-end applies to: not exited / inactive and joined by the end of the year. */
function eligibilityFilter(year) {
  const yearEnd = new Date(`${year}-12-31T23:59:59.999Z`);
  return {
    status: { $ne: 'inactive' },
    employment_status: { $ne: 'exited' },
    $or: [
      { joining_date: { $exists: false } },
      { joining_date: null },
      { joining_date: { $lte: yearEnd } },
      { joining_date: { $type: 'string', $lte: `${year}-12-31T23:59:59.999Z` } }
    ]
  };
}

/** Monthly basic used for encashment: salary structure basic, else monthly salary. */
async function basicSalaryFor(db, employee) {
  const ids = [employee.employee_id, employee.id, employee.employee_code].filter(Boolean);
  if (ids.length) {
    const structure = await db.collection('salary_structures').findOne(
      { employee_id: { $in: ids } },
      { projection: { _id: 0, basic_salary: 1 } }
    );
    if (structure && Number(structure.basic_salary) > 0) return { basic: Number(structure.basic_salary), source: 'salary_structure' };
  }
  if (Number(employee.monthly_salary) > 0) return { basic: Number(employee.monthly_salary), source: 'monthly_salary' };
  return { basic: 0, source: 'none' };
}

/** What closing `year` does to one employee (no writes). */
async function computeEmployee(db, employee, policyDoc, year) {
  const rows = [];
  for (const p of policyDoc.policies || []) {
    if (!resetsYearly(p)) continue;
    const key = normalizeLeaveType(p.leave_type);
    const closing = Math.max(0, round1(effectiveBalance(employee, p, key)));

    let carry = 0;
    if (p.carry_forward_allowed) {
      const cap = Number(p.max_carry_forward_days) > 0 ? Number(p.max_carry_forward_days) : Infinity;
      carry = Math.min(closing, cap);
    }
    const excess = round1(closing - carry);
    let encash = 0;
    if (p.encashment_allowed && excess > 0) {
      const cap = Number(p.max_encashment_days) > 0 ? Number(p.max_encashment_days) : Infinity;
      encash = Math.min(excess, cap);
    }
    rows.push({
      leave_type: p.leave_type,
      key,
      closing,
      carry: round1(carry),
      encash: round1(encash),
      lapse: round1(excess - encash),
      carry_forward_allowed: !!p.carry_forward_allowed,
      max_carry_forward_days: Number(p.max_carry_forward_days) || 0,
      encashment_allowed: !!p.encashment_allowed
    });
  }

  const encashDays = round1(rows.reduce((s, r) => s + r.encash, 0));
  let salary = { basic: 0, source: 'none' };
  if (encashDays > 0) salary = await basicSalaryFor(db, employee);
  const perDay = round2(salary.basic / WORKING_DAYS_PER_MONTH);
  rows.forEach(r => { r.amount = round2(r.encash * salary.basic / WORKING_DAYS_PER_MONTH); });

  return {
    employee_id: employee.id || null,
    employee_uid: employeeUid(employee),
    employee_code: employee.employee_id || employee.employee_code || null,
    employee_name: employee.full_name,
    employee_email: employee.email,
    department: employee.department || null,
    rows,
    totals: {
      carry: round1(rows.reduce((s, r) => s + r.carry, 0)),
      encash: encashDays,
      lapse: round1(rows.reduce((s, r) => s + r.lapse, 0)),
      amount: round2(rows.reduce((s, r) => s + r.amount, 0))
    },
    basic_salary: salary.basic,
    basic_source: salary.source,
    per_day_amount: perDay
  };
}

const sumTotals = (list) => list.reduce((t, e) => ({
  carry: round1(t.carry + e.totals.carry),
  encash: round1(t.encash + e.totals.encash),
  lapse: round1(t.lapse + e.totals.lapse),
  amount: round2(t.amount + e.totals.amount)
}), { carry: 0, encash: 0, lapse: 0, amount: 0 });

/**
 * Dry run: per employee, what will carry / encash / lapse. Employees already
 * closed for the year show what was recorded.
 */
async function previewYearEnd(db, year) {
  await ensureIndexes(db);
  const policyDoc = await getPolicyDoc(db);
  const employees = await db.collection('employees')
    .find(eligibilityFilter(year), { projection: { hashed_password: 0 } })
    .sort({ full_name: 1 })
    .toArray();
  const logs = await db.collection(LOGS).find({ year }, { projection: { _id: 0 } }).toArray();
  const logMap = new Map(logs.map(l => [l.employee_uid, l]));

  const result = [];
  for (const employee of employees) {
    const uid = employeeUid(employee);
    const processed = (employee.leave_year_end_year || 0) >= year;
    if (processed && logMap.has(uid)) {
      const log = logMap.get(uid);
      result.push({ ...log, processed: true });
    } else {
      result.push({ ...(await computeEmployee(db, employee, policyDoc, year)), processed });
    }
  }

  return {
    year,
    opening_year: year + 1,
    policy: (policyDoc.policies || []).filter(resetsYearly).map(p => ({
      leave_type: p.leave_type,
      carry_forward_allowed: !!p.carry_forward_allowed,
      max_carry_forward_days: Number(p.max_carry_forward_days) || 0,
      encashment_allowed: !!p.encashment_allowed,
      max_encashment_days: Number(p.max_encashment_days) || 0
    })),
    employees: result,
    pending_count: result.filter(r => !r.processed).length,
    processed_count: result.filter(r => r.processed).length,
    totals: sumTotals(result)
  };
}

/**
 * Close `year`: record carry / encash / lapse for every employee not yet closed.
 * Does not change balances — the January reset applies the carried days.
 */
async function closeYear(db, year, { by = 'system', runId = generateUUID(), notify = true } = {}) {
  await ensureIndexes(db);
  const policyDoc = await getPolicyDoc(db);
  const employees = await db.collection('employees').find(eligibilityFilter(year), { projection: { hashed_password: 0 } }).toArray();
  const summary = { year, closed: 0, already_closed: 0, encashments: 0, errors: [], employees: [] };
  const now = new Date();

  for (const employee of employees) {
    try {
      if ((employee.leave_year_end_year || 0) >= year) {
        summary.already_closed++;
        continue;
      }
      const computed = await computeEmployee(db, employee, policyDoc, year);
      const carryBalances = Object.fromEntries(computed.rows.filter(r => r.carry > 0).map(r => [r.key, r.carry]));

      // Claim the employee atomically so a concurrent run (cron + admin) can't close twice
      const claim = await db.collection('employees').updateOne(
        { _id: employee._id, $or: [{ leave_year_end_year: { $exists: false } }, { leave_year_end_year: null }, { leave_year_end_year: { $lt: year } }] },
        {
          $set: {
            leave_year_end_year: year,
            leave_carry_forward: { year: year + 1, from_year: year, balances: carryBalances, recorded_at: now }
          }
        }
      );
      if (!claim.modifiedCount) {
        summary.already_closed++;
        continue;
      }

      await db.collection(LOGS).updateOne(
        { year, employee_uid: computed.employee_uid },
        { $setOnInsert: { id: generateUUID(), run_id: runId, year, ...computed, processed_by: by, created_at: now } },
        { upsert: true }
      );

      for (const row of computed.rows.filter(r => r.encash > 0)) {
        const res = await db.collection(ENCASHMENTS).updateOne(
          { employee_id: computed.employee_id || computed.employee_uid, leave_type: row.leave_type, year },
          {
            $setOnInsert: {
              id: generateUUID(),
              employee_id: computed.employee_id || computed.employee_uid,
              employee_uid: computed.employee_uid,
              employee_code: computed.employee_code,
              employee_email: computed.employee_email,
              employee_name: computed.employee_name,
              department: computed.department,
              leave_type: row.leave_type,
              days: row.encash,
              year,
              basic_salary: computed.basic_salary,
              per_day_amount: computed.per_day_amount,
              amount: row.amount,
              status: 'pending',
              payroll_run_id: null,
              source: 'year_end',
              run_id: runId,
              created_by: by,
              created_at: now,
              updated_at: now
            }
          },
          { upsert: true }
        );
        if (res.upsertedCount) summary.encashments++;
      }

      summary.closed++;
      summary.employees.push({ employee_email: computed.employee_email, totals: computed.totals });

      const t = computed.totals;
      if (notify && (t.carry || t.encash || t.lapse)) {
        createNotification({
          userId: employee.id,
          userEmail: employee.email,
          type: 'leave_year_end',
          title: `Leave year ${year} closed`,
          message: `Carried forward ${t.carry} day(s), encashed ${t.encash} day(s)${t.amount ? ` (₹${t.amount})` : ''}, lapsed ${t.lapse} day(s).`,
          actionUrl: '/leaves',
          metadata: { year, totals: t }
        }).catch(() => {});
      }
    } catch (error) {
      console.error(`[leave-year-end] ${employee.email}:`, error.message);
      summary.errors.push({ employee_email: employee.email, error: error.message });
    }
  }
  return summary;
}

/**
 * Close `year` and apply the January opening of year + 1 (carry-forward included).
 */
async function runYearEnd(db, year, { by = 'system' } = {}) {
  await ensureIndexes(db);
  const runId = generateUUID();
  const run = {
    id: runId,
    year,
    status: 'running',
    run_by: by,
    started_at: new Date()
  };
  await db.collection(RUNS).insertOne(run);

  try {
    const close = await closeYear(db, year, { by, runId });
    // Lazy require: monthlyLeaveCredit also requires this file
    const { creditMonthlyLeaves } = require('../../cron/monthlyLeaveCredit');
    const opening = await creditMonthlyLeaves(db, new Date(`${year + 1}-01-01T00:00:00.000Z`), { by });
    const result = {
      year,
      closed: close.closed,
      already_closed: close.already_closed,
      encashments_created: close.encashments,
      opening_year: year + 1,
      opening_applied: opening.processed,
      opening_skipped: (opening.skipped || []).length,
      errors: [...close.errors, ...(opening.errors || [])]
    };
    await db.collection(RUNS).updateOne(
      { id: runId },
      { $set: { status: result.errors.length ? 'completed_with_errors' : 'completed', finished_at: new Date(), result } }
    );
    return { run_id: runId, ...result };
  } catch (error) {
    await db.collection(RUNS).updateOne({ id: runId }, { $set: { status: 'failed', finished_at: new Date(), error: error.message } });
    throw error;
  }
}

/** Company-timezone calendar year right now. */
const currentYear = () => localParts(new Date()).year;
const currentMonth = () => localParts(new Date()).month;

module.exports = {
  LOGS,
  RUNS,
  ENCASHMENTS,
  WORKING_DAYS_PER_MONTH,
  ensureIndexes,
  computeEmployee,
  previewYearEnd,
  closeYear,
  runYearEnd,
  currentYear,
  currentMonth
};
