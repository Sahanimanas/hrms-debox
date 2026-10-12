/**
 * Monthly Leave Credit Cron Job
 * 
 * This script should be run on the 1st of every month to credit leaves.
 * 
 * Leave Policy:
 * - Casual Leave: 6 days credited annually (on January 1st) - NO CARRY FORWARD
 * - Sick Leave: 0.5 days credited monthly - RESETS TO 0 on January 1st
 * - Earned Leave: 1 day credited monthly - RESETS TO 0 on January 1st
 * 
 * On January 1st:
 *   - Casual Leave: Reset to 6
 *   - Sick Leave: Reset to 0, then +0.5 = 0.5
 *   - Earned Leave: Reset to 0 (first credit on Feb 1st)
 * 
 * Setup with cron:
 *   0 0 1 * * node /path/to/cron/monthlyLeaveCredit.js
 * 
 * Or with node-cron in your app:
 *   cron.schedule('0 0 1 * *', () => { ... });
 */

const { PgDocClient } = require('../db/pgdoc');
const { localParts, normalizeLeaveType } = require('../utils/helpers');

// Configuration
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/hrms';
const DB_NAME = process.env.DB_NAME || 'hrms';

// Leave credit rules
const LEAVE_CREDIT_RULES = {
  casual_leave: {
    credit_type: 'annually',      // Credited once a year in January
    annual_credit: 6,             // 6 days per year
    credit_month: 1,              // January (1-12)
    max_balance: 6,               // Maximum balance cap
    carry_forward: false,         // No carry forward - resets each year
    reset_on_year_start: true     // Reset to 0 on January 1st before crediting
  },
  sick_leave: {
    credit_type: 'monthly',       // Credited every month
    monthly_credit: 0.5,          // 0.5 days per month
    max_balance: 6,               // Maximum balance cap
    carry_forward: false,         // No carry forward
    reset_on_year_start: true     // Reset to 0 on January 1st
  },
  earned_leave: {
    credit_type: 'monthly',       // Credited every month
    monthly_credit: 1,            // 1 day per month
    max_balance: 12,              // Maximum balance cap per year
    carry_forward: false,         // No carry forward (change to true if needed)
    reset_on_year_start: true     // Reset to 0 on January 1st
  }
};

const LEGACY_KEYS = Object.keys(LEAVE_CREDIT_RULES);
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * Policy leave types beyond the three legacy ones, credited from the leave
 * policy (LV-2): monthly types get monthly_credit each month (capped at the
 * annual quota), annual / per-year event types get their quota in January,
 * per-occurrence event types always show their per-occurrence entitlement.
 */
async function loadExtraPolicyTypes(db) {
  const { getPolicyDoc, resetsYearly, isOccurrenceType } = require('../services/leave/common');
  const policyDoc = await getPolicyDoc(db);
  return (policyDoc.policies || [])
    .map(p => ({ ...p, key: normalizeLeaveType(p.leave_type) }))
    .filter(p => !LEGACY_KEYS.includes(p.key) && !p.is_unlimited)
    .map(p => ({ ...p, occurrence: isOccurrenceType(p), yearly: resetsYearly(p) }));
}

/** Carried-forward days for `year` (written by the year-end close). */
const carryFor = (employee, year) =>
  employee.leave_carry_forward?.year === year ? (employee.leave_carry_forward.balances || {}) : {};

/**
 * Credit leaves to all active employees
 *
 * January: closes the previous leave year first (carry-forward / encashment /
 * lapse — services/leave/yearEnd.js), then resets balances to the new year's
 * credit plus carried days. Each employee is reset at most once per year
 * (`leave_reset_year`) and credited at most once per month
 * (`leave_credit_month`), so the cron and the admin "run monthly" button can
 * both run without double crediting.
 *
 * @param {Db} db - database instance (PostgreSQL document store)
 * @param {Date} creditDate - The date for which to credit (defaults to today)
 * @param {Object} options - { force: re-credit employees already credited this month, by }
 */
async function creditMonthlyLeaves(db, creditDate = new Date(), options = {}) {
  const { force = false, by = 'system' } = options;
  // Month / year in the company timezone (the cron fires at local midnight)
  const parts = localParts(creditDate);
  const currentMonth = parts.month; // 1-12
  const currentYear = parts.year;
  const isJanuary = currentMonth === 1;
  const monthTag = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`MONTHLY LEAVE CREDIT - ${creditDate.toDateString()}`);
  if (isJanuary) {
    console.log('🔄 JANUARY - YEAR START RESET + CREDIT');
  }
  console.log(`${'='.repeat(60)}`);

  const results = {
    processed: 0,
    credited: [],
    skipped: [],
    errors: []
  };

  // Close the previous year before resetting so nothing carried forward is lost
  if (isJanuary) {
    const { closeYear } = require('../services/leave/yearEnd');
    const close = await closeYear(db, currentYear - 1, { by });
    results.year_end = {
      year: currentYear - 1,
      closed: close.closed,
      already_closed: close.already_closed,
      encashments_created: close.encashments,
      errors: close.errors
    };
  }

  const extraTypes = await loadExtraPolicyTypes(db);

  // Get all active employees
  const employees = await db.collection('employees').find({
    status: { $ne: 'inactive' },  // Exclude inactive employees
    employment_status: { $ne: 'exited' }
  }).toArray();

  console.log(`\nProcessing ${employees.length} employees...`);

  for (const employee of employees) {
    try {
      // Skip if employee hasn't joined yet
      const joiningDate = employee.joining_date ? new Date(employee.joining_date) : null;
      if (joiningDate && joiningDate > creditDate) {
        console.log(`  ⏭️  ${employee.full_name} - Not yet joined (joins ${joiningDate.toDateString()})`);
        continue;
      }

      if (isJanuary && employee.leave_reset_year === currentYear) {
        results.skipped.push({ employee_id: employee.employee_id, name: employee.full_name, reason: `Already reset for ${currentYear}` });
        continue;
      }
      if (!force && employee.leave_credit_month === monthTag) {
        results.skipped.push({ employee_id: employee.employee_id, name: employee.full_name, reason: `Already credited for ${monthTag}` });
        continue;
      }

      const currentBalance = employee.leave_balance || {};
      const newBalance = { ...currentBalance };
      const credits = [];
      const carry = carryFor(employee, currentYear);

      // ============================================
      // JANUARY - YEAR START RESET (+ carry forward)
      // ============================================
      if (isJanuary) {
        const withCarry = (key, base) => {
          const carried = Number(carry[key]) || 0;
          newBalance[key] = round1(base + carried);
          credits.push(`${key}: RESET to ${base}${carried ? ` + ${carried} carried forward` : ''} = ${newBalance[key]}`);
        };

        // Casual Leave: annual credit
        withCarry('casual_leave', LEAVE_CREDIT_RULES.casual_leave.annual_credit);
        // Sick Leave: reset to 0, then add first month credit
        withCarry('sick_leave', LEAVE_CREDIT_RULES.sick_leave.monthly_credit);
        // Earned Leave: reset to 0 (first credit will be on Feb 1st)
        withCarry('earned_leave', 0);

        for (const p of extraTypes) {
          if (p.occurrence) {
            newBalance[p.key] = Number(p.annual_quota) || 0;
            credits.push(`${p.key}: ${newBalance[p.key]} per occurrence`);
          } else if (p.yearly) {
            const base = p.credit_type === 'monthly' ? (Number(p.monthly_credit) || 0) : (Number(p.annual_quota) || 0);
            withCarry(p.key, base);
          }
        }
      }
      // ============================================
      // OTHER MONTHS - MONTHLY CREDITS
      // ============================================
      else {
        // Caps grow by whatever was carried into this year, so carry-forward isn't eaten by the cap
        const capFor = (key, max) => max + (Number(carry[key]) || 0);

        // Sick Leave: add 0.5
        const currentSick = newBalance.sick_leave || 0;
        newBalance.sick_leave = Math.min(
          currentSick + LEAVE_CREDIT_RULES.sick_leave.monthly_credit,
          capFor('sick_leave', LEAVE_CREDIT_RULES.sick_leave.max_balance)
        );
        newBalance.sick_leave = Math.round(newBalance.sick_leave * 10) / 10;
        credits.push(`sick_leave: ${currentSick} + ${LEAVE_CREDIT_RULES.sick_leave.monthly_credit} = ${newBalance.sick_leave}`);

        // Earned Leave: add 1
        const currentEarned = newBalance.earned_leave || 0;
        newBalance.earned_leave = Math.min(
          currentEarned + LEAVE_CREDIT_RULES.earned_leave.monthly_credit,
          capFor('earned_leave', LEAVE_CREDIT_RULES.earned_leave.max_balance)
        );
        newBalance.earned_leave = Math.round(newBalance.earned_leave * 10) / 10;
        credits.push(`earned_leave: ${currentEarned} + ${LEAVE_CREDIT_RULES.earned_leave.monthly_credit} = ${newBalance.earned_leave}`);

        // Casual Leave: no change in non-January months
        if (newBalance.casual_leave === undefined) {
          newBalance.casual_leave = 0;
        }

        // Other monthly policy types
        for (const p of extraTypes.filter(t => t.yearly && t.credit_type === 'monthly' && Number(t.monthly_credit) > 0)) {
          const current = Number(newBalance[p.key]) || 0;
          const max = Number(p.annual_quota) > 0 ? Number(p.annual_quota) : Number(p.monthly_credit) * 12;
          newBalance[p.key] = round1(Math.min(current + Number(p.monthly_credit), capFor(p.key, max)));
          credits.push(`${p.key}: ${current} + ${p.monthly_credit} = ${newBalance[p.key]}`);
        }
      }

      // Ensure all leave types exist
      newBalance.casual_leave = newBalance.casual_leave ?? 0;
      newBalance.sick_leave = newBalance.sick_leave ?? 0;
      newBalance.earned_leave = newBalance.earned_leave ?? 0;
      newBalance.comp_off = newBalance.comp_off ?? 0;
      newBalance.unpaid_leave = newBalance.unpaid_leave ?? 0;

      const markers = { leave_credit_month: monthTag };
      if (isJanuary) markers.leave_reset_year = currentYear;

      // Update employee balance (by _id: seed-created employees may have no uuid `id`)
      await db.collection('employees').updateOne(
        { _id: employee._id },
        {
          $set: {
            leave_balance: newBalance,
            last_leave_credit_date: creditDate,
            ...markers
          }
        }
      );

      // Log the credit transaction
      await db.collection('leave_credit_logs').insertOne({
        employee_id: employee.employee_id,
        employee_email: employee.email,
        credit_date: creditDate,
        credit_month: currentMonth,
        credit_year: currentYear,
        is_year_start_reset: isJanuary,
        carried_forward: isJanuary ? carry : undefined,
        previous_balance: currentBalance,
        credits_applied: credits,
        new_balance: newBalance,
        run_by: by,
        created_at: new Date()
      });

      results.processed++;
      results.credited.push({
        employee_id: employee.employee_id,
        name: employee.full_name,
        credits,
        new_balance: newBalance
      });

      console.log(`  ✅ ${employee.full_name}: ${credits.join(', ')}`);

    } catch (error) {
      console.error(`  ❌ ${employee.full_name}: ${error.message}`);
      results.errors.push({
        employee_id: employee.employee_id,
        error: error.message
      });
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Month: ${currentMonth}/${currentYear}`);
  console.log(`  Processed: ${results.processed}`);
  console.log(`  Skipped: ${results.skipped.length}`);
  console.log(`  Errors: ${results.errors.length}`);
  if (isJanuary) {
    console.log(`  Year Start Reset: Applied (carry-forward from ${currentYear - 1} included)`);
  }

  return results;
}

/**
 * Initialize leave balance for new employee
 * Called when employee is created
 * 
 * New employees get:
 * - Casual Leave: 6 (full annual quota)
 * - Sick Leave: 0.5 (first month credit, if joined before 15th)
 * - Earned Leave: 0 (credited from next month)
 * 
 * @param {Date} joiningDate - Employee's joining date
 */
function initializeLeaveBalance(joiningDate = new Date()) {
  const joinDay = new Date(joiningDate).getDate();

  return {
    casual_leave: 6,                    // Full annual quota
    sick_leave: joinDay <= 15 ? 0.5 : 0, // 0.5 if joined before 15th
    earned_leave: 0,                    // Credited from next month
    comp_off: 0,
    unpaid_leave: 0
  };
}

/**
 * Main execution for cron job
 */
async function main() {
  let client;

  try {
    console.log('Connecting to PostgreSQL...');
    client = new PgDocClient(DATABASE_URL);
    await client.connect();

    const db = client.db(DB_NAME);
    console.log(`Connected to database: ${DB_NAME}`);

    // Run monthly credit
    const results = await creditMonthlyLeaves(db);

    console.log('\nCron job completed successfully!');
    return results;

  } catch (error) {
    console.error('Cron job failed:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('Database connection closed.');
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

// Export for use in Express routes
module.exports = {
  creditMonthlyLeaves,
  initializeLeaveBalance,
  LEAVE_CREDIT_RULES
};
