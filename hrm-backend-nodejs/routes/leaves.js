const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, UserRole, LeaveStatus, LeaveType, defaultLeavePolicy } = require('../models/schemas');
const { generateUUID, normalizeLeaveType, toISOString } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { generateLeaveApplicationEmail, generateLeaveApprovalEmail, generateLeaveEditEmail } = require('../utils/emailTemplates');
const { createNotification, NotificationType } = require('../services/notificationService');
const { emitEvent } = require('../services/events');
const Joi = require('joi');
const {
  toKeys,
  tracksBalance,
  effectiveBalance,
  ensureBalanceKey,
  findEmployeeByEmail
} = require('../services/leave/common');
const { computeLeaveDays, validateTypeRules, findOverlap } = require('../services/leave/rules');
const approvalsService = require('../services/leave/approvals');

/**
 * Default monthly credit rates for leave types
 * These are used as fallback if not defined in policy
 */
const DEFAULT_MONTHLY_CREDITS = {
  'casual_leave': 0.5,
  'sick_leave': 0.5,
  'earned_leave': 1
};

/**
 * Helper: Calculate days from dates array
 * A half-day application counts 0.5 for every selected date.
 * (Sandwich days are added by services/leave/rules.computeLeaveDays.)
 */
function calculateDaysFromDates(dates, isHalfDay = false) {
  if (!dates || dates.length === 0) return 0;
  if (isHalfDay) {
    return dates.length * 0.5;
  }
  return dates.length;
}

/** Payload for leave.approved / leave.rejected / leave.applied events. */
const leaveEventPayload = (leave, extra = {}) => ({
  leave_id: leave.id,
  employee_id: leave.employee_id,
  employee_email: leave.employee_email,
  employee_name: leave.employee_name,
  leave_type: leave.leave_type,
  dates: toKeys(leave.dates),
  days_count: leave.days_count,
  is_half_day: !!leave.is_half_day,
  status: leave.status,
  ...extra
});

/** Leaves from before approval chains get an equivalent chain for display. */
const withChain = (leave) => {
  if (!Array.isArray(leave.approval_chain) || !leave.approval_chain.length) {
    const chain = approvalsService.legacyChain(leave);
    Object.assign(leave, { approval_chain: chain, ...approvalsService.currentFields(chain) });
  }
  return leave;
};

const validateApplicationSchema = Joi.object({
  leave_type: Joi.string().trim().required(),
  dates: Joi.array().items(Joi.date()).min(1).max(400).required(),
  is_half_day: Joi.boolean().default(false),
  half_day_period: Joi.string().valid('morning', 'afternoon').allow(null),
  exclude_leave_id: Joi.string().allow(null, '')
});

/**
 * Helper: Format dates array for display
 */
function formatDatesForDisplay(dates) {
  if (!dates || dates.length === 0) return 'No dates';

  const sortedDates = dates
    .map(d => new Date(d))
    .sort((a, b) => a - b);

  if (sortedDates.length === 1) {
    return sortedDates[0].toLocaleDateString();
  }

  if (sortedDates.length <= 3) {
    return sortedDates.map(d => d.toLocaleDateString()).join(', ');
  }

  return `${sortedDates[0].toLocaleDateString()} to ${sortedDates[sortedDates.length - 1].toLocaleDateString()} (${sortedDates.length} days)`;
}

/**
 * Helper: Normalize dates in leave document
 */
function normalizeLeaveDates(leave) {
  if (leave.dates && Array.isArray(leave.dates)) {
    leave.dates = leave.dates.map(d => typeof d === 'string' ? new Date(d) : d);
  }

  for (const field of ['created_at', 'updated_at']) {
    if (typeof leave[field] === 'string') {
      leave[field] = new Date(leave[field]);
    }
  }

  for (const approval of leave.approvals || []) {
    if (typeof approval.timestamp === 'string') {
      approval.timestamp = new Date(approval.timestamp);
    }
  }

  return leave;
}

/**
 * Helper: Convert dates to ISO strings for storage
 */
function datesToISOStrings(dates) {
  if (!dates || !Array.isArray(dates)) return [];
  return dates.map(d => toISOString(d));
}

/**
 * Helper: Get leave policy for a specific leave type
 */
async function getLeavePolicyForType(db, leaveType) {
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

  if (!policy || !policy.policies) {
    // Return from default policy
    const defaultPolicy = defaultLeavePolicy.policies.find(
      p => p.leave_type.toLowerCase() === leaveType.toLowerCase()
    );
    return defaultPolicy || null;
  }

  return policy.policies.find(
    p => p.leave_type.toLowerCase() === leaveType.toLowerCase()
  ) || null;
}

/**
 * Helper: Calculate months since joining date
 * @param {Date} joiningDate - Employee's joining date
 * @returns {number} - Number of complete months since joining
 */
function calculateMonthsSinceJoining(joiningDate) {
  const now = new Date();
  const joining = new Date(joiningDate);

  // Calculate months since joining
  let months = (now.getFullYear() - joining.getFullYear()) * 12;
  months += now.getMonth() - joining.getMonth();

  // If current day is before joining day in the month, subtract one month
  if (now.getDate() < joining.getDate()) {
    months--;
  }

  // Ensure non-negative
  return Math.max(0, months);
}

/**
 * Helper: Calculate accrued leave balance based on joining date
 * @param {Date} joiningDate - Employee's joining date
 * @param {number} monthlyCredit - Days credited per month
 * @param {number} maxBalance - Maximum balance cap (annual quota)
 * @returns {number} - Accrued balance rounded to 1 decimal
 */
function calculateAccruedBalance(joiningDate, monthlyCredit, maxBalance = Infinity) {
  if (!joiningDate || !monthlyCredit) return 0;

  const months = calculateMonthsSinceJoining(joiningDate);
  const accrued = months * monthlyCredit;

  // Cap at max balance and round to 1 decimal
  return Math.min(Math.round(accrued * 10) / 10, maxBalance);
}

/**
 * Helper: Get monthly credit rate for a leave type
 * Uses policy if available, otherwise falls back to defaults
 * @param {Object} policyItem - Policy item for the leave type
 * @param {string} leaveKey - Normalized leave type key
 * @returns {number} - Monthly credit rate
 */
function getMonthlyCredit(policyItem, leaveKey) {
  // First check if policy has monthly_credit defined
  if (policyItem && policyItem.monthly_credit !== undefined && policyItem.monthly_credit > 0) {
    return policyItem.monthly_credit;
  }

  // Fall back to default rates
  return DEFAULT_MONTHLY_CREDITS[leaveKey] || 0;
}

/**
 * Helper: Validate advance notice requirement
 */
function validateAdvanceNotice(dates, advanceDaysRequired) {
  if (!advanceDaysRequired || advanceDaysRequired <= 0) {
    return { valid: true };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const earliestDate = dates
    .map(d => new Date(d))
    .sort((a, b) => a - b)[0];

  earliestDate.setHours(0, 0, 0, 0);

  const diffTime = earliestDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < advanceDaysRequired) {
    return {
      valid: false,
      message: `${advanceDaysRequired} days advance notice required. You're applying ${diffDays} day(s) in advance.`
    };
  }

  return { valid: true };
}

/**
 * Helper: Check leave clubbing rules
 */
async function validateLeaveClubbing(db, employeeEmail, newLeaveType, newDates) {
  // Get policy
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
  const policyItem = policy?.policies?.find(
    p => p.leave_type.toLowerCase() === newLeaveType.toLowerCase()
  );

  if (!policyItem) {
    return { valid: true };
  }

  const clubbingNotAllowedWith = policyItem.clubbing_not_allowed_with || [];

  if (clubbingNotAllowedWith.length === 0) {
    return { valid: true };
  }

  // Get the date range for new leave
  const newDateObjs = newDates.map(d => new Date(d)).sort((a, b) => a - b);
  const earliestNew = new Date(newDateObjs[0]);
  const latestNew = new Date(newDateObjs[newDateObjs.length - 1]);

  // Extend range by 1 day on each side to check for adjacent leaves
  earliestNew.setDate(earliestNew.getDate() - 1);
  latestNew.setDate(latestNew.getDate() + 1);

  // Find existing approved/pending leaves that might overlap or be adjacent
  const existingLeaves = await db.collection('leaves').find({
    employee_email: employeeEmail,
    status: { $in: [LeaveStatus.PENDING, LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED] }
  }).toArray();

  for (const existingLeave of existingLeaves) {
    const existingType = existingLeave.leave_type;

    // Check if this leave type is in the not-allowed list
    const isNotAllowed = clubbingNotAllowedWith.some(
      notAllowed => notAllowed.toLowerCase() === existingType.toLowerCase()
    );

    if (!isNotAllowed) continue;

    // Check if dates overlap or are adjacent
    const existingDates = (existingLeave.dates || []).map(d => new Date(d));

    for (const existingDate of existingDates) {
      const dateOnly = new Date(existingDate);
      dateOnly.setHours(0, 0, 0, 0);

      if (dateOnly >= earliestNew && dateOnly <= latestNew) {
        return {
          valid: false,
          message: `${newLeaveType} cannot be clubbed with ${existingType}. You have an existing ${existingType} on or adjacent to these dates.`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Helper: Get leave balance from policy based on joining date
 * Calculates accrued balance for monthly-credited leaves
 * @param {Object} db - Database connection
 * @param {Date} joiningDate - Employee's joining date
 * @returns {Object} - Leave balance object
 */
async function getLeaveBalanceFromPolicy(db, joiningDate = null) {
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
  const effectiveJoiningDate = joiningDate || new Date();

  // Default balance structure
  const defaultBalance = {
    earned_leave: 0,
    sick_leave: 0,
    casual_leave: 0,
    paid_leave: 0,
    unpaid_leave: 0,
    comp_off: 0
  };

  if (!policy || !policy.policies || policy.policies.length === 0) {
    // No policy configured - use default monthly credits
    const months = calculateMonthsSinceJoining(effectiveJoiningDate);

    return {
      earned_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.earned_leave * 10) / 10,
      sick_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.sick_leave * 10) / 10,
      casual_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.casual_leave * 10) / 10,
      paid_leave: 0,
      unpaid_leave: 0,
      comp_off: 0
    };
  }

  const balance = { ...defaultBalance };

  for (const policyItem of policy.policies) {
    const leaveKey = normalizeLeaveType(policyItem.leave_type);
    const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

    // Check credit type from policy
    if (policyItem.credit_type === 'monthly' || monthlyCredit > 0) {
      // Calculate accrued balance based on months since joining
      const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
      balance[leaveKey] = calculateAccruedBalance(effectiveJoiningDate, monthlyCredit, maxBalance);
    } else if (policyItem.credit_type === 'annually') {
      // Annual credit - assign full quota
      balance[leaveKey] = policyItem.annual_quota || 0;
    } else {
      // Fallback - use default monthly credit if available
      if (DEFAULT_MONTHLY_CREDITS[leaveKey]) {
        const maxBalance = policyItem.annual_quota || (DEFAULT_MONTHLY_CREDITS[leaveKey] * 12);
        balance[leaveKey] = calculateAccruedBalance(
          effectiveJoiningDate,
          DEFAULT_MONTHLY_CREDITS[leaveKey],
          maxBalance
        );
      } else {
        balance[leaveKey] = policyItem.annual_quota || 0;
      }
    }
  }

  // Ensure comp_off exists
  if (!('comp_off' in balance)) {
    balance.comp_off = 0;
  }

  return balance;
}

// ============================================
// LEAVE POLICY ROUTES (MUST BE BEFORE /:leaveId)
// ============================================

/**
 * GET /api/leaves/leave-policy
 * Get current leave policy
 */
router.get('/leave-policy', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

    if (!policy) {
      return res.json({
        ...defaultLeavePolicy,
        updated_at: new Date().toISOString()
      });
    }

    res.json(policy);
  } catch (error) {
    console.error('Get leave policy error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/leaves/leave-policy
 * Save leave policy (admin only)
 */
router.post('/leave-policy', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    // Validate known fields (unknown extra fields are kept so older/newer clients don't lose data)
    const { error, value: policyData } = schemas.leavePolicy.validate(
      { policies: req.body?.policies || [], clubbing_rules: req.body?.clubbing_rules || [] },
      { abortEarly: false, allowUnknown: true }
    );
    if (error) {
      return res.status(422).json({
        detail: 'Validation failed',
        errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
      });
    }
    const names = policyData.policies.map(p => normalizeLeaveType(p.leave_type));
    const duplicate = names.find((n, i) => names.indexOf(n) !== i);
    if (duplicate) {
      return res.status(422).json({ detail: `Leave type "${duplicate.replace(/_/g, ' ')}" is listed twice` });
    }

    const policy = {
      id: 'default_policy',
      policies: policyData.policies,
      clubbing_rules: policyData.clubbing_rules || [],
      updated_at: toISOString(new Date()),
      updated_by: req.user.email
    };

    await db.collection('leave_policies').updateOne(
      { id: 'default_policy' },
      { $set: policy },
      { upsert: true }
    );

    delete policy._id;

    res.json({
      status: 'success',
      message: 'Leave policy updated successfully',
      policy
    });
  } catch (error) {
    console.error('Save leave policy error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/leaves/leave-policy/apply-to-employee/:employeeId
 * Apply policy to specific employee (admin only)
 * Calculates leave balance based on employee's joining date
 */
router.post('/leave-policy/apply-to-employee/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;

    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
    if (!policy) {
      return res.status(404).json({ detail: 'Leave policy not configured' });
    }

    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { full_name: 1, joining_date: 1, email: 1 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    const joiningDate = employee.joining_date || new Date();
    const months = calculateMonthsSinceJoining(joiningDate);

    const newBalance = { comp_off: 0 };

    for (const policyItem of policy.policies || []) {
      const leaveKey = normalizeLeaveType(policyItem.leave_type);
      const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

      if (policyItem.credit_type === 'monthly' || monthlyCredit > 0) {
        // Calculate accrued balance based on joining date
        const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
        newBalance[leaveKey] = calculateAccruedBalance(joiningDate, monthlyCredit, maxBalance);
      } else {
        // Annual credit
        newBalance[leaveKey] = policyItem.annual_quota || 0;
      }
    }

    await db.collection('employees').updateOne(
      { employee_id: employeeId },
      { $set: { leave_balance: newBalance } }
    );

    res.json({
      status: 'success',
      message: `Leave policy applied to ${employee.full_name}`,
      joining_date: joiningDate,
      months_since_joining: months,
      new_balance: newBalance
    });
  } catch (error) {
    console.error('Apply policy to employee error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/leaves/leave-policy/apply-to-all
 * Apply policy to all employees (admin only)
 * Calculates leave balance based on each employee's joining date
 */
router.post('/leave-policy/apply-to-all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
    if (!policy) {
      return res.status(404).json({ detail: 'Leave policy not configured' });
    }

    // Get all employees
    const employees = await db.collection('employees').find({}).toArray();
    let updatedCount = 0;
    const results = [];

    for (const employee of employees) {
      const joiningDate = employee.joining_date || new Date();
      const months = calculateMonthsSinceJoining(joiningDate);

      const newBalance = { comp_off: employee.leave_balance?.comp_off || 0 }; // Preserve comp_off

      for (const policyItem of policy.policies || []) {
        const leaveKey = normalizeLeaveType(policyItem.leave_type);
        const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

        if (policyItem.credit_type === 'monthly' || monthlyCredit > 0) {
          const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
          newBalance[leaveKey] = calculateAccruedBalance(joiningDate, monthlyCredit, maxBalance);
        } else {
          newBalance[leaveKey] = policyItem.annual_quota || 0;
        }
      }

      await db.collection('employees').updateOne(
        { _id: employee._id },
        { $set: { leave_balance: newBalance } }
      );

      results.push({
        employee_id: employee.employee_id,
        name: employee.full_name,
        joining_date: joiningDate,
        months: months,
        balance: newBalance
      });

      updatedCount++;
    }

    res.json({
      status: 'success',
      message: `Leave policy applied to ${updatedCount} employees based on their joining dates`,
      employees_updated: updatedCount,
      details: results
    });
  } catch (error) {
    console.error('Apply policy to all error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * GET /api/leaves/validate-application
 * Validate leave application before submission (pre-check)
 */
router.post('/validate-application', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const { error: bodyError, value: body } = validateApplicationSchema.validate(req.body || {}, { stripUnknown: true });
    if (bodyError) {
      return res.status(422).json({ detail: 'Validation failed', errors: bodyError.details.map(d => ({ field: d.path.join('.'), message: d.message })) });
    }
    const { leave_type } = body;
    const dates = datesToISOStrings(body.dates);
    const employee = req.employee;

    const warnings = [];
    const errors = [];

    // Get leave policy for this type
    const policyItem = await getLeavePolicyForType(db, leave_type);

    // Day count including the sandwich rule (LV-3) — the same number apply will charge
    const days = await computeLeaveDays(db, { employee, dates, isHalfDay: body.is_half_day, policyItem });
    const keys = days.dates;

    if (!keys.length) {
      errors.push({ type: 'non_working_days', message: 'The selected dates are all weekly offs or holidays — no leave is needed', severity: 'error' });
    } else if (days.excluded_dates.length) {
      warnings.push({
        type: 'non_working_days',
        message: `${days.excluded_dates.length} weekly off/holiday day(s) in your selection are not counted`,
        severity: 'info',
        dates: days.excluded_dates
      });
    }

    const overlap = await findOverlap(db, employee.email, keys, {
      excludeLeaveId: body.exclude_leave_id || null,
      isHalfDay: body.is_half_day,
      halfDayPeriod: body.half_day_period
    });
    if (overlap) {
      errors.push({
        type: 'overlap',
        message: `You already have ${overlap.leave.leave_type} (${overlap.leave.status}) on ${overlap.date}`,
        severity: 'error'
      });
    }

    if (policyItem) {
      const rule = await validateTypeRules(db, { employee, policyItem, keys, daysCount: days.days_count, excludeLeaveId: body.exclude_leave_id || null });
      if (!rule.ok) {
        errors.push({ type: rule.rule || 'policy', message: rule.detail, severity: 'error' });
      }

      if (tracksBalance(policyItem)) {
        const leaveKey = normalizeLeaveType(leave_type);
        const available = effectiveBalance(employee, policyItem, leaveKey);
        if (available < days.days_count) {
          errors.push({
            type: 'balance',
            message: `Insufficient leave balance. Available: ${available} days, Requested: ${days.days_count} days`,
            severity: 'error',
            available,
            requested: days.days_count
          });
        }
      }

      if (days.sandwich_days > 0) {
        warnings.push({
          type: 'sandwich',
          message: `${days.sandwich_days} weekly off/holiday day(s) between your leave days are counted as leave (sandwich rule)`,
          severity: 'warning',
          dates: days.breakdown
        });
      }
    }

    if (policyItem) {
      // Check advance notice
      const advanceCheck = validateAdvanceNotice(dates, policyItem.advance_days_required);
      if (!advanceCheck.valid) {
        warnings.push({
          type: 'advance_notice',
          message: advanceCheck.message,
          severity: 'warning'
        });
      }

      // Check clubbing rules
      const clubbingCheck = await validateLeaveClubbing(db, employee.email, leave_type, dates);
      if (!clubbingCheck.valid) {
        errors.push({
          type: 'clubbing',
          message: clubbingCheck.message,
          severity: 'error'
        });
      }

      // Check balance - calculate accrued if monthly credit
      const leaveKey = normalizeLeaveType(leave_type);
      const currentBalance = employee.leave_balance?.[leaveKey] || 0;
      const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

      if (monthlyCredit > 0) {
        const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
        const accruedBalance = calculateAccruedBalance(
          employee.joining_date,
          monthlyCredit,
          maxBalance
        );

        const daysRequested = days.days_count;

        // Show accrued vs actual balance
        if (accruedBalance < daysRequested) {
          warnings.push({
            type: 'accrued_balance',
            message: `You have ${accruedBalance.toFixed(1)} days accrued based on your joining date. Requesting ${daysRequested} days.`,
            severity: 'info',
            accrued: accruedBalance,
            total: currentBalance,
            requested: daysRequested
          });
        }
      }

      // Add policy info
      warnings.push({
        type: 'policy_info',
        message: null,
        severity: 'info',
        policy: {
          credit_type: policyItem.credit_type,
          monthly_credit: monthlyCredit,
          advance_days_required: policyItem.advance_days_required,
          encashment_allowed: policyItem.encashment_allowed,
          carry_forward_allowed: policyItem.carry_forward_allowed,
          clubbing_not_allowed_with: policyItem.clubbing_not_allowed_with || [],
          sandwich_rule: !!policyItem.sandwich_rule,
          event_scope: policyItem.credit_type === 'event' ? (policyItem.event_scope || 'occurrence') : null,
          restricted_holiday_only: !!policyItem.restricted_holiday_only
        }
      });
    }

    res.json({
      valid: errors.length === 0,
      warnings,
      errors,
      days
    });
  } catch (error) {
    console.error('Validate application error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============================================
// LEAVE APPLICATION ROUTES
// ============================================

/**
 * POST /api/leaves
 * Apply for leave
 */
router.post('/', authenticate, getCurrentEmployee, validate(schemas.leaveApplication), async (req, res) => {
  try {
    const db = getDB();
    const leaveData = req.validatedBody;
    const employee = req.employee;

    // Get leave policy for validation
    const policyItem = await getLeavePolicyForType(db, leaveData.leave_type);

    // Days charged, including weekly offs / holidays sandwiched between leave days (LV-3)
    const dayInfo = await computeLeaveDays(db, {
      employee,
      dates: leaveData.dates,
      isHalfDay: leaveData.is_half_day,
      policyItem
    });
    const daysCount = dayInfo.days_count;

    // Sandwich rule off: weekly offs / holidays in the selection are skipped, not charged
    if (!dayInfo.dates.length) {
      return res.status(400).json({
        detail: 'The selected dates are all weekly offs or holidays — no leave is needed',
        warning_type: 'non_working_days',
        can_override: false
      });
    }
    const chargedDates = dayInfo.excluded_dates.length ? dayInfo.dates : leaveData.dates;

    // A date can only be on one active leave
    const overlap = await findOverlap(db, employee.email, dayInfo.dates, {
      isHalfDay: leaveData.is_half_day,
      halfDayPeriod: leaveData.half_day_period
    });
    if (overlap) {
      return res.status(400).json({
        detail: `You already have ${overlap.leave.leave_type} (${overlap.leave.status}) on ${overlap.date}`,
        warning_type: 'overlap',
        can_override: false
      });
    }

    // Type-specific rules: per-occurrence caps, restricted holidays, gender (LV-2)
    const typeRule = await validateTypeRules(db, { employee, policyItem, keys: dayInfo.dates, daysCount });
    if (!typeRule.ok) {
      return res.status(typeRule.status).json({ detail: typeRule.detail, warning_type: typeRule.rule, can_override: false });
    }

    // Validate advance notice (soft warning - allow override with force flag)
    if (policyItem && policyItem.advance_days_required > 0 && !req.body.force_submit) {
      const advanceCheck = validateAdvanceNotice(chargedDates, policyItem.advance_days_required);
      if (!advanceCheck.valid) {
        return res.status(400).json({
          detail: advanceCheck.message,
          warning_type: 'advance_notice',
          can_override: true
        });
      }
    }

    // Validate clubbing rules (hard error - cannot override)
    const clubbingCheck = await validateLeaveClubbing(db, employee.email, leaveData.leave_type, chargedDates);
    if (!clubbingCheck.valid) {
      return res.status(400).json({
        detail: clubbingCheck.message,
        warning_type: 'clubbing',
        can_override: false
      });
    }

    // Check leave balance (skip for unlimited and per-occurrence leave types)
    const leaveTypeKey = normalizeLeaveType(leaveData.leave_type);
    const usesBalance = tracksBalance(policyItem);
    const available = usesBalance ? effectiveBalance(employee, policyItem, leaveTypeKey) : Infinity;

    if (usesBalance && available < daysCount) {
      return res.status(400).json({
        detail: `Insufficient leave balance. Available: ${available} days, Requested: ${daysCount} days`
      });
    }
    // Types added to the policy after the employee joined start from their quota
    if (usesBalance && policyItem) await ensureBalanceKey(db, employee, policyItem, leaveTypeKey);

    // Approval chain (LV-4)
    const approvalSettings = await approvalsService.getApprovalSettings(db);
    const chain = await approvalsService.buildChain(db, approvalSettings, employee, daysCount);
    const managerStep = chain.find(s => s.approver_type === 'manager' && s.approver_email);

    // Create leave application
    const now = new Date();
    const monthlyCredit = policyItem ? getMonthlyCredit(policyItem, leaveTypeKey) : 0;

    const leaveDoc = {
      id: generateUUID(),
      employee_id: employee.id,
      employee_name: employee.full_name,
      employee_email: employee.email,
      department: employee.department || null,
      manager_email: employee.manager_email || managerStep?.approver_email || null,
      leave_type: leaveData.leave_type,
      dates: datesToISOStrings(chargedDates),
      days_count: daysCount,
      applied_days: dayInfo.applied_days,
      sandwich_days: dayInfo.sandwich_days,
      sandwich_dates: dayInfo.sandwich_dates,
      days_breakdown: dayInfo.breakdown,
      reason: leaveData.reason,
      is_half_day: leaveData.is_half_day || false,
      half_day_period: leaveData.half_day_period || null,
      status: LeaveStatus.PENDING,
      approvals: [],
      approval_chain: chain,
      ...approvalsService.currentFields(chain),
      policy_snapshot: policyItem ? {
        credit_type: policyItem.credit_type,
        monthly_credit: monthlyCredit,
        advance_days_required: policyItem.advance_days_required,
        encashment_allowed: policyItem.encashment_allowed,
        carry_forward_allowed: policyItem.carry_forward_allowed,
        sandwich_rule: !!policyItem.sandwich_rule,
        event_scope: policyItem.credit_type === 'event' ? (policyItem.event_scope || 'occurrence') : null,
        tracks_balance: usesBalance
      } : null,
      created_at: toISOString(now),
      updated_at: toISOString(now)
    };

    await db.collection('leaves').insertOne(leaveDoc);
    emitEvent('leave.applied', leaveEventPayload(leaveDoc));

    // Notify whoever approves first (and their delegates), plus email — don't block the response
    const firstStep = approvalsService.currentStep(chain);
    const datesDisplay = formatDatesForDisplay(chargedDates);
    (async () => {
      await approvalsService.notifyApprovers(db, leaveDoc, firstStep, {
        title: 'New Leave Application',
        message: `${employee.full_name} has applied for ${leaveData.leave_type} (${daysCount} day${daysCount === 1 ? '' : 's'}) from ${datesDisplay}`
      });
      const emailHtml = generateLeaveApplicationEmail(employee.full_name, leaveData.leave_type, datesDisplay, null, leaveData.reason);
      if (firstStep?.approver_email) {
        await sendEmailNotification(firstStep.approver_email, `Leave Application from ${employee.full_name}`, emailHtml);
      }
    })().catch(notifyError => console.error('Failed to send notification:', notifyError.message));

    delete leaveDoc._id;
    normalizeLeaveDates(leaveDoc);

    res.status(201).json(leaveDoc);
  } catch (error) {
    console.error('Apply leave error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/my-leaves
 * Get current user's leaves
 */
router.get('/my-leaves', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const employee = req.employee;

    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    leaves.forEach(normalizeLeaveDates);
    leaves.forEach(withChain);

    res.json(leaves);
  } catch (error) {
    console.error('Get my leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/pending
 * Get pending leaves for approval
 */
router.get('/pending', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const user = req.user;

    if (![UserRole.MANAGER, UserRole.ADMIN].includes(user.role)) {
      return res.status(403).json({ detail: 'Not enough permissions' });
    }

    // Leaves whose current approval level is mine (or delegated to me); admins see all open ones
    const query = await approvalsService.pendingQueryFor(db, user);
    const [leaves, delegations, settings] = await Promise.all([
      db.collection('leaves').find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray(),
      approvalsService.activeDelegationsFor(db, user.email),
      approvalsService.getApprovalSettings(db)
    ]);

    leaves.forEach(normalizeLeaveDates);

    res.json(leaves.map(l => approvalsService.decorateForApprover(l, user, delegations, settings)));
  } catch (error) {
    console.error('Get pending leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/all
 * Get all leaves (admin only)
 */
router.get('/all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const leaves = await db.collection('leaves')
      .find({}, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    leaves.forEach(normalizeLeaveDates);
    leaves.forEach(withChain);

    res.json(leaves);
  } catch (error) {
    console.error('Get all leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/calendar/me
 * Get current user's leaves for calendar
 */
router.get('/calendar/me', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const user = req.user;

    const employee = await db.collection('employees').findOne(
      { email: user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    req.params.employeeId = employee.employee_id;

    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    const leaveColors = {
      sick_leave: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
      casual_leave: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
      paid_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      earned_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      unpaid_leave: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
      comp_off: { bg: '#e9d5ff', border: '#a855f7', text: '#6b21a8' },
      maternity_leave: { bg: '#fce7f3', border: '#ec4899', text: '#9d174d' },
      paternity_leave: { bg: '#e0f2fe', border: '#0ea5e9', text: '#075985' },
      bereavement_leave: { bg: '#e2e8f0', border: '#475569', text: '#1e293b' },
      restricted_holiday: { bg: '#ffedd5', border: '#f97316', text: '#9a3412' }
    };

    const statusStyles = {
      pending: { opacity: '0.6', pattern: 'striped' },
      manager_approved: { opacity: '0.8', pattern: 'dotted' },
      approved: { opacity: '1', pattern: 'solid' },
      rejected: { opacity: '0.4', pattern: 'crossed' }
    };

    const { year, month } = req.query;
    const calendarEvents = [];

    for (const leave of leaves) {
      normalizeLeaveDates(leave);

      const leaveTypeKey = normalizeLeaveType(leave.leave_type);
      const colors = leaveColors[leaveTypeKey] || { bg: '#f1f5f9', border: '#64748b', text: '#334155' };
      const statusStyle = statusStyles[leave.status] || { opacity: '1', pattern: 'solid' };

      for (const date of leave.dates || []) {
        const dateObj = new Date(date);
        const dateStr = dateObj.toISOString().substring(0, 10);

        if (year && month) {
          const yearInt = parseInt(year, 10);
          const monthInt = parseInt(month, 10);
          const eventYear = dateObj.getFullYear();
          const eventMonth = dateObj.getMonth() + 1;

          if (eventYear !== yearInt || eventMonth !== monthInt) {
            continue;
          }
        } else if (year) {
          const yearInt = parseInt(year, 10);
          if (dateObj.getFullYear() !== yearInt) {
            continue;
          }
        }

        calendarEvents.push({
          id: `${leave.id}_${dateStr}`,
          leave_id: leave.id,
          title: leave.leave_type,
          date: dateStr,
          datetime: dateObj.toISOString(),
          leave_type: leave.leave_type,
          leave_type_key: leaveTypeKey,
          status: leave.status,
          reason: leave.reason,
          is_half_day: leave.is_half_day || false,
          half_day_period: leave.half_day_period,
          total_days_in_application: leave.days_count,
          colors,
          status_style: statusStyle
        });
      }
    }

    calendarEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      employee: {
        id: employee.employee_id,
        name: employee.full_name,
        email: employee.email,
        department: employee.department
      },
      leave_balance: employee.leave_balance || {},
      events: calendarEvents,
      color_legend: leaveColors,
      status_legend: statusStyles
    });
  } catch (error) {
    console.error('Get my calendar leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/calendar/:employeeId
 * Get employee leaves for calendar
 */
router.get('/calendar/:employeeId', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;
    const { year, month } = req.query;
    const user = req.user;

    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    if (![UserRole.ADMIN, UserRole.MANAGER].includes(user.role)) {
      if (employee.email !== user.email) {
        return res.status(403).json({ detail: "Not authorized to view this employee's leaves" });
      }
    }

    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    const leaveColors = {
      sick_leave: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
      casual_leave: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
      paid_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      earned_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      unpaid_leave: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
      comp_off: { bg: '#e9d5ff', border: '#a855f7', text: '#6b21a8' },
      maternity_leave: { bg: '#fce7f3', border: '#ec4899', text: '#9d174d' },
      paternity_leave: { bg: '#e0f2fe', border: '#0ea5e9', text: '#075985' },
      bereavement_leave: { bg: '#e2e8f0', border: '#475569', text: '#1e293b' },
      restricted_holiday: { bg: '#ffedd5', border: '#f97316', text: '#9a3412' }
    };

    const statusStyles = {
      pending: { opacity: '0.6', pattern: 'striped' },
      manager_approved: { opacity: '0.8', pattern: 'dotted' },
      approved: { opacity: '1', pattern: 'solid' },
      rejected: { opacity: '0.4', pattern: 'crossed' }
    };

    const calendarEvents = [];

    for (const leave of leaves) {
      normalizeLeaveDates(leave);

      const leaveTypeKey = normalizeLeaveType(leave.leave_type);
      const colors = leaveColors[leaveTypeKey] || { bg: '#f1f5f9', border: '#64748b', text: '#334155' };
      const statusStyle = statusStyles[leave.status] || { opacity: '1', pattern: 'solid' };

      for (const date of leave.dates || []) {
        const dateObj = new Date(date);
        const dateStr = dateObj.toISOString().substring(0, 10);

        if (year && month) {
          const yearInt = parseInt(year, 10);
          const monthInt = parseInt(month, 10);
          const eventYear = dateObj.getFullYear();
          const eventMonth = dateObj.getMonth() + 1;

          if (eventYear !== yearInt || eventMonth !== monthInt) {
            continue;
          }
        } else if (year) {
          const yearInt = parseInt(year, 10);
          if (dateObj.getFullYear() !== yearInt) {
            continue;
          }
        }

        calendarEvents.push({
          id: `${leave.id}_${dateStr}`,
          leave_id: leave.id,
          title: leave.leave_type,
          date: dateStr,
          datetime: dateObj.toISOString(),
          leave_type: leave.leave_type,
          leave_type_key: leaveTypeKey,
          status: leave.status,
          reason: leave.reason,
          is_half_day: leave.is_half_day || false,
          half_day_period: leave.half_day_period,
          total_days_in_application: leave.days_count,
          colors,
          status_style: statusStyle
        });
      }
    }

    calendarEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      employee: {
        id: employee.employee_id,
        name: employee.full_name,
        email: employee.email,
        department: employee.department
      },
      leave_balance: employee.leave_balance || {},
      events: calendarEvents,
      color_legend: leaveColors,
      status_legend: statusStyles
    });
  } catch (error) {
    console.error('Get calendar leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============================================
// PARAMETERIZED ROUTES (MUST BE LAST)
// ============================================

/**
 * PUT /api/leaves/:leaveId/action
 * Approve or reject leave
 */
router.put('/:leaveId/action', authenticate, getCurrentEmployee, validate(schemas.leaveAction), async (req, res) => {
  try {
    const db = getDB();
    const { leaveId } = req.params;
    const { action, comments } = req.validatedBody;
    const user = req.user;
    const employee = req.employee;

    if (![UserRole.MANAGER, UserRole.ADMIN].includes(user.role)) {
      return res.status(403).json({ detail: 'Not enough permissions' });
    }

    // The employee is told why: a rejection must carry a reason
    if (action === 'reject' && !String(comments || '').trim()) {
      return res.status(400).json({ detail: 'A reason is required to reject a leave' });
    }

    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    normalizeLeaveDates(leaveDoc);

    const originalStatus = leaveDoc.status;

    // Multi-level approval chain (LV-4): who may act, and what the new status is
    const settings = await approvalsService.getApprovalSettings(db);
    let decision;
    try {
      decision = await approvalsService.decideAction(db, {
        leave: leaveDoc,
        user,
        actorName: employee.full_name || user.full_name,
        action,
        comments,
        settings
      });
    } catch (error) {
      if (error instanceof approvalsService.ApprovalError) {
        return res.status(error.status).json({ detail: error.message });
      }
      throw error;
    }

    const newStatus = decision.newStatus;
    const approvalRecord = decision.approvalRecord;

    leaveDoc.approvals = [...(leaveDoc.approvals || []), approvalRecord];
    leaveDoc.approval_chain = decision.chain;
    Object.assign(leaveDoc, approvalsService.currentFields(decision.chain));
    leaveDoc.status = newStatus;
    leaveDoc.updated_at = toISOString(new Date());

    const updateDoc = {
      ...leaveDoc,
      dates: datesToISOStrings(leaveDoc.dates),
      created_at: toISOString(leaveDoc.created_at),
      updated_at: leaveDoc.updated_at
    };

    for (const approval of updateDoc.approvals) {
      if (approval.timestamp instanceof Date) {
        approval.timestamp = toISOString(approval.timestamp);
      }
    }

    // Only write if nobody acted on this leave since we read it (two approvers on one level)
    const priorActions = (leaveDoc.approvals || []).length - 1;
    const writeResult = await db.collection('leaves').updateOne(
      {
        id: leaveId,
        status: originalStatus,
        $or: [{ approvals: { $size: priorActions } }, ...(priorActions === 0 ? [{ approvals: { $exists: false } }] : [])]
      },
      { $set: updateDoc }
    );
    if (!writeResult.matchedCount) {
      return res.status(409).json({ detail: 'This leave was just updated by someone else. Refresh and try again.' });
    }

    // Per-occurrence and unlimited leave types don't move the balance
    const policyItem = await getLeavePolicyForType(db, leaveDoc.leave_type);
    const usesBalance = tracksBalance(policyItem);
    const leaveTypeKey = normalizeLeaveType(leaveDoc.leave_type);

    const wasBalanceNotYetDeducted = originalStatus === LeaveStatus.PENDING;
    const isNowApproved = newStatus === LeaveStatus.MANAGER_APPROVED || newStatus === LeaveStatus.APPROVED;

    if (wasBalanceNotYetDeducted && isNowApproved && usesBalance) {
      const owner = await db.collection('employees').findOne({ email: leaveDoc.employee_email }, { projection: { _id: 0, email: 1, leave_balance: 1 } });
      if (owner && policyItem) await ensureBalanceKey(db, owner, policyItem, leaveTypeKey);
      await db.collection('employees').updateOne(
        { email: leaveDoc.employee_email },
        { $inc: { [`leave_balance.${leaveTypeKey}`]: -leaveDoc.days_count } }
      );
      console.log(`Deducted ${leaveDoc.days_count} ${leaveTypeKey} from ${leaveDoc.employee_email}`);
    }

    const wasAlreadyDeducted = originalStatus === LeaveStatus.MANAGER_APPROVED;
    const isNowRejected = newStatus === LeaveStatus.REJECTED;

    if (wasAlreadyDeducted && isNowRejected && usesBalance) {
      await db.collection('employees').updateOne(
        { email: leaveDoc.employee_email },
        { $inc: { [`leave_balance.${leaveTypeKey}`]: leaveDoc.days_count } }
      );
      console.log(`Refunded ${leaveDoc.days_count} ${leaveTypeKey} to ${leaveDoc.employee_email} (rejected after manager approval)`);
    }

    // Events for integrations (PL-6/PL-7)
    const actedBy = { acted_by: user.email, acted_by_name: approvalRecord.approver_name, on_behalf_of: approvalRecord.on_behalf_of_email || null };
    if (newStatus === LeaveStatus.APPROVED) emitEvent('leave.approved', leaveEventPayload(leaveDoc, actedBy));
    if (newStatus === LeaveStatus.REJECTED) emitEvent('leave.rejected', leaveEventPayload(leaveDoc, { ...actedBy, comments: comments || null }));

    // Notifications at each step — don't block the response
    (async () => {
      const employeeRecord = await db.collection('employees').findOne(
        { email: leaveDoc.employee_email },
        { projection: { id: 1, phone: 1 } }
      );

      const datesDisplay = formatDatesForDisplay(leaveDoc.dates);
      const actorName = approvalRecord.approver_name;
      const behalf = approvalRecord.on_behalf_of_name ? ` on behalf of ${approvalRecord.on_behalf_of_name}` : '';

      if (newStatus === LeaveStatus.APPROVED || newStatus === LeaveStatus.REJECTED) {
        const statusText = newStatus === LeaveStatus.APPROVED ? 'approved' : 'rejected';
        const emailHtml = generateLeaveApprovalEmail(
          leaveDoc.employee_name,
          leaveDoc.leave_type,
          datesDisplay,
          null,
          statusText
        );

        await sendEmailNotification(
          leaveDoc.employee_email,
          `Leave ${statusText.charAt(0).toUpperCase() + statusText.slice(1)} - ${leaveDoc.leave_type}`,
          emailHtml
        );

        // Create in-app notification for employee
        const isApproved = newStatus === LeaveStatus.APPROVED;
        await createNotification({
          userId: employeeRecord?.id,
          userEmail: leaveDoc.employee_email,
          type: isApproved ? NotificationType.LEAVE_APPROVED : NotificationType.LEAVE_REJECTED,
          title: isApproved ? 'Leave Approved' : 'Leave Rejected',
          message: isApproved
            ? `Your ${leaveDoc.leave_type} request for ${datesDisplay} has been approved by ${actorName}${behalf}`
            : `Your ${leaveDoc.leave_type} request for ${datesDisplay} has been rejected by ${actorName}${behalf}${comments ? `. Reason: ${comments}` : ''}`,
          actionUrl: '/leaves',
          metadata: { leave_id: leaveDoc.id, action_by: actorName, level: decision.step.level }
        });
      } else if (newStatus === LeaveStatus.MANAGER_APPROVED) {
        const next = decision.next;
        const emailHtml = generateLeaveApprovalEmail(
          leaveDoc.employee_name,
          leaveDoc.leave_type,
          datesDisplay,
          null,
          `approved at level ${decision.step.level} (${decision.step.name}) — pending ${next?.name || 'final approval'}`
        );

        await sendEmailNotification(
          leaveDoc.employee_email,
          `Leave Approved by ${decision.step.name} - Pending ${next?.name || 'Final Approval'}`,
          emailHtml
        );

        // Create in-app notification for employee
        await createNotification({
          userId: employeeRecord?.id,
          userEmail: leaveDoc.employee_email,
          type: NotificationType.LEAVE_APPROVED,
          title: `Leave Approved by ${decision.step.name}`,
          message: `Your ${leaveDoc.leave_type} request for ${datesDisplay} has been approved by ${actorName}${behalf}. Pending ${next?.name || 'final approval'}.`,
          actionUrl: '/leaves',
          metadata: { leave_id: leaveDoc.id, action_by: actorName, level: decision.step.level }
        });

        // The next approver (and their delegates)
        await approvalsService.notifyApprovers(db, leaveDoc, next, {
          title: 'Leave Pending Your Approval',
          message: `${leaveDoc.employee_name}'s ${leaveDoc.leave_type} for ${datesDisplay} was approved by ${actorName} (${decision.step.name}) and needs your approval`
        });

        if (next?.approver_email) {
          const nextHtml = generateLeaveApplicationEmail(leaveDoc.employee_name, leaveDoc.leave_type, datesDisplay, null, leaveDoc.reason);
          await sendEmailNotification(next.approver_email, `Leave Pending Your Approval - ${leaveDoc.employee_name}`, nextHtml);
        }
      }
    })().catch(notifyError => console.error('Failed to send notification:', notifyError.message));

    normalizeLeaveDates(leaveDoc);

    res.json(leaveDoc);
  } catch (error) {
    console.error('Leave action error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/leaves/:leaveId
 * Edit leave (admin only)
 */
router.put('/:leaveId', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.leaveEdit), async (req, res) => {
  try {
    const db = getDB();
    const { leaveId } = req.params;
    const editData = req.validatedBody;
    const user = req.user;

    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    normalizeLeaveDates(leaveDoc);

    const originalLeave = { ...leaveDoc };
    const wasBalanceDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(originalLeave.status);
    const originalDays = originalLeave.days_count;
    const originalLeaveType = originalLeave.leave_type;

    const updateDict = {};

    if (editData.leave_type !== undefined) updateDict.leave_type = editData.leave_type;
    if (editData.reason !== undefined) updateDict.reason = editData.reason;
    if (editData.is_half_day !== undefined) updateDict.is_half_day = editData.is_half_day;
    if (editData.half_day_period !== undefined) updateDict.half_day_period = editData.half_day_period;

    const isHalfDay = editData.is_half_day !== undefined ? editData.is_half_day : originalLeave.is_half_day;
    let newDays = originalDays;
    const editedLeaveType = editData.leave_type !== undefined ? editData.leave_type : originalLeave.leave_type;

    // Recount (sandwich rule included) whenever dates, half-day or the leave type change
    if (editData.dates || editData.is_half_day !== undefined || (editData.leave_type !== undefined && editData.leave_type !== originalLeave.leave_type)) {
      const owner = (await findEmployeeByEmail(db, originalLeave.employee_email)) || { email: originalLeave.employee_email };
      const editedPolicyItem = await getLeavePolicyForType(db, editedLeaveType);
      const newDates = editData.dates ? editData.dates : originalLeave.dates;
      const dayInfo = await computeLeaveDays(db, { employee: owner, dates: newDates, isHalfDay, policyItem: editedPolicyItem });
      if (!dayInfo.dates.length) {
        return res.status(400).json({ detail: 'The selected dates are all weekly offs or holidays — no leave is needed' });
      }

      if (editData.dates) {
        const overlap = await findOverlap(db, originalLeave.employee_email, dayInfo.dates, {
          excludeLeaveId: leaveId,
          isHalfDay,
          halfDayPeriod: editData.half_day_period !== undefined ? editData.half_day_period : originalLeave.half_day_period
        });
        if (overlap) {
          return res.status(400).json({ detail: `The employee already has ${overlap.leave.leave_type} (${overlap.leave.status}) on ${overlap.date}` });
        }
      }
      const typeRule = await validateTypeRules(db, { employee: owner, policyItem: editedPolicyItem, keys: dayInfo.dates, daysCount: dayInfo.days_count, excludeLeaveId: leaveId });
      if (!typeRule.ok) {
        return res.status(typeRule.status).json({ detail: typeRule.detail });
      }

      if (editData.dates) updateDict.dates = datesToISOStrings(dayInfo.excluded_dates.length ? dayInfo.dates : editData.dates);
      newDays = dayInfo.days_count;
      updateDict.days_count = newDays;
      updateDict.applied_days = dayInfo.applied_days;
      updateDict.sandwich_days = dayInfo.sandwich_days;
      updateDict.sandwich_dates = dayInfo.sandwich_dates;
      updateDict.days_breakdown = dayInfo.breakdown;
    }

    const newStatus = editData.status !== undefined ? editData.status : originalLeave.status;
    if (editData.status !== undefined) {
      updateDict.status = newStatus;

      const approvalRecord = {
        approver_email: user.email,
        approver_name: user.full_name,
        approver_role: user.role,
        action: 'edited',
        comments: `Status changed to ${newStatus} by admin`,
        timestamp: toISOString(new Date())
      };

      const existingApprovals = (leaveDoc.approvals || []).map(a => ({
        ...a,
        timestamp: typeof a.timestamp === 'string' ? a.timestamp : toISOString(a.timestamp)
      }));
      existingApprovals.push(approvalRecord);
      updateDict.approvals = existingApprovals;

      // Keep the approval chain in step with the admin's status change (LV-4)
      if (newStatus !== originalLeave.status) {
        let chain = approvalsService.chainOf(leaveDoc);
        const stamp = { acted_by_email: user.email, acted_by_name: user.full_name, acted_at: approvalRecord.timestamp, via: 'admin_edit', comments: approvalRecord.comments };
        if (newStatus === LeaveStatus.PENDING) {
          const owner = (await findEmployeeByEmail(db, originalLeave.employee_email)) || { email: originalLeave.employee_email };
          chain = await approvalsService.buildChain(db, await approvalsService.getApprovalSettings(db), owner, newDays);
        } else if (newStatus === LeaveStatus.APPROVED) {
          chain.filter(s => s.status === 'pending').forEach(s => Object.assign(s, stamp, { status: 'approved' }));
        } else if (newStatus === LeaveStatus.REJECTED) {
          const cur = approvalsService.currentStep(chain) || chain[chain.length - 1];
          if (cur) Object.assign(cur, stamp, { status: 'rejected' });
          chain.filter(s => s.status === 'pending').forEach(s => { s.status = 'cancelled'; });
        } else if (newStatus === LeaveStatus.MANAGER_APPROVED) {
          const pendingSteps = chain.filter(s => s.status === 'pending');
          if (pendingSteps.length > 1) Object.assign(pendingSteps[0], stamp, { status: 'approved' });
        }
        updateDict.approval_chain = chain;
        Object.assign(updateDict, approvalsService.currentFields(chain));
      }
    }

    updateDict.updated_at = toISOString(new Date());

    const newLeaveType = updateDict.leave_type || originalLeaveType;
    const employeeEmail = originalLeave.employee_email;
    const willBalanceBeDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(newStatus);

    // Get policy items to check whether the leave types move the balance (unlimited / per-occurrence don't)
    const originalPolicyItem = await getLeavePolicyForType(db, originalLeaveType);
    const newPolicyItem = await getLeavePolicyForType(db, newLeaveType);
    const isOriginalUnlimited = !tracksBalance(originalPolicyItem);
    const isNewUnlimited = !tracksBalance(newPolicyItem);

    if (wasBalanceDeducted && !isOriginalUnlimited) {
      const originalKey = normalizeLeaveType(originalLeaveType);

      if (!willBalanceBeDeducted) {
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: originalDays } }
        );
        console.log(`Refunded ${originalDays} ${originalKey} to ${employeeEmail} (status changed to ${newStatus})`);
      } else if (newLeaveType !== originalLeaveType) {
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: originalDays } }
        );
        console.log(`Refunded ${originalDays} ${originalKey} to ${employeeEmail} (leave type changed)`);

        if (!isNewUnlimited) {
          const newKey = normalizeLeaveType(newLeaveType);
          await db.collection('employees').updateOne(
            { email: employeeEmail },
            { $inc: { [`leave_balance.${newKey}`]: -newDays } }
          );
          console.log(`Deducted ${newDays} ${newKey} from ${employeeEmail} (leave type changed)`);
        }
      } else if (newDays !== originalDays) {
        const daysDiff = newDays - originalDays;
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: -daysDiff } }
        );
        console.log(`Adjusted ${-daysDiff} ${originalKey} for ${employeeEmail} (days changed)`);
      }
    } else if (!wasBalanceDeducted && willBalanceBeDeducted) {
      if (!isNewUnlimited) {
        const newKey = normalizeLeaveType(newLeaveType);

        const emp = await db.collection('employees').findOne(
          { email: employeeEmail },
          { projection: { _id: 0, email: 1, leave_balance: 1 } }
        );
        const available = effectiveBalance(emp, newPolicyItem, newKey);
        if (emp && newPolicyItem) await ensureBalanceKey(db, emp, newPolicyItem, newKey);

        if (available < newDays) {
          return res.status(400).json({
            detail: `Insufficient ${newLeaveType} balance. Available: ${available}, Required: ${newDays}`
          });
        }

        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${newKey}`]: -newDays } }
        );
        console.log(`Deducted ${newDays} ${newKey} from ${employeeEmail} (status changed to ${newStatus})`);
      }
    }

    await db.collection('leaves').updateOne(
      { id: leaveId },
      { $set: updateDict }
    );

    await db.collection('leave_edit_logs').insertOne({
      leave_id: leaveId,
      edited_by: user.email,
      original_data: {
        leave_type: originalLeaveType,
        dates: datesToISOStrings(originalLeave.dates),
        days_count: originalDays,
        status: originalLeave.status
      },
      changes: editData,
      timestamp: new Date()
    });

    try {
      const emp = await db.collection('employees').findOne(
        { email: employeeEmail },
        { projection: { full_name: 1 } }
      );

      if (emp) {
        const changes = [];
        if (editData.leave_type) changes.push(`Leave type: ${originalLeaveType} → ${newLeaveType}`);
        if (editData.dates) changes.push('Dates updated');
        if (editData.status) changes.push(`Status: ${originalLeave.status} → ${newStatus}`);

        const emailHtml = generateLeaveEditEmail(emp.full_name, changes);
        await sendEmailNotification(employeeEmail, 'Leave Application Updated', emailHtml);
      }
    } catch (notifyError) {
      console.error('Failed to send leave edit notification:', notifyError.message);
    }

    const updatedLeave = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (newStatus !== originalLeave.status) {
      if (newStatus === LeaveStatus.APPROVED) emitEvent('leave.approved', leaveEventPayload(updatedLeave, { acted_by: user.email, via: 'admin_edit' }));
      if (newStatus === LeaveStatus.REJECTED) emitEvent('leave.rejected', leaveEventPayload(updatedLeave, { acted_by: user.email, via: 'admin_edit' }));
    }

    normalizeLeaveDates(updatedLeave);
    withChain(updatedLeave);

    res.json(updatedLeave);
  } catch (error) {
    console.error('Edit leave error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/leaves/:leaveId
 * Delete leave (admin only)
 */
router.delete('/:leaveId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { leaveId } = req.params;

    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    const wasBalanceDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(leaveDoc.status);

    // Get policy to check whether the leave type moves the balance (unlimited / per-occurrence don't)
    const policyItem = await getLeavePolicyForType(db, leaveDoc.leave_type);
    const isUnlimited = !tracksBalance(policyItem);

    if (wasBalanceDeducted && !isUnlimited) {
      const leaveTypeKey = normalizeLeaveType(leaveDoc.leave_type);
      await db.collection('employees').updateOne(
        { email: leaveDoc.employee_email },
        { $inc: { [`leave_balance.${leaveTypeKey}`]: leaveDoc.days_count } }
      );
      console.log(`Refunded ${leaveDoc.days_count} ${leaveTypeKey} to ${leaveDoc.employee_email} (leave deleted)`);
    }

    await db.collection('leaves').deleteOne({ id: leaveId });

    await db.collection('leave_edit_logs').insertOne({
      leave_id: leaveId,
      action: 'deleted',
      deleted_by: req.user.email,
      leave_data: leaveDoc,
      timestamp: new Date()
    });

    res.json({
      status: 'success',
      message: 'Leave deleted successfully',
      leave_id: leaveId
    });
  } catch (error) {
    console.error('Delete leave error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
module.exports.getLeaveBalanceFromPolicy = getLeaveBalanceFromPolicy;
module.exports.calculateAccruedBalance = calculateAccruedBalance;
module.exports.calculateMonthsSinceJoining = calculateMonthsSinceJoining;
module.exports.DEFAULT_MONTHLY_CREDITS = DEFAULT_MONTHLY_CREDITS;
