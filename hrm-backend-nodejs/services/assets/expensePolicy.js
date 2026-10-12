/**
 * Expense policy evaluation (AS-2).
 *
 * A policy applies to one reimbursement category and can set:
 *   max_per_claim          — maximum amount of a single claim
 *   monthly_cap            — total per employee per calendar month (by expense date)
 *   receipt_required_above — a receipt must be attached above this amount (0 = always)
 *   allowed_roles / allowed_departments — who may claim this category (empty = everyone)
 *   enforcement            — 'hard' blocks the claim, 'soft' allows it but flags it for the approver
 */

const { round2, escapeRegex } = require('./common');

// Mirrors the categories offered on the reimbursement form
const DEFAULT_EXPENSE_CATEGORIES = [
  'Travel',
  'Food & Meals',
  'Accommodation',
  'Office Supplies',
  'Equipment',
  'Software & Tools',
  'Training & Courses',
  'Medical',
  'Communication',
  'Other'
];

const fmtINR = (n) => `₹${round2(n).toLocaleString('en-IN')}`;

const findPolicy = (db, category) => {
  if (!category) return null;
  return db.collection('expense_policies').findOne(
    { category: { $regex: `^${escapeRegex(String(category).trim())}$`, $options: 'i' }, active: { $ne: false } },
    { projection: { _id: 0 } }
  );
};

const monthOf = (expenseDate) => {
  const s = expenseDate instanceof Date ? expenseDate.toISOString() : String(expenseDate || '');
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  return isNaN(d) ? new Date().toISOString().slice(0, 7) : d.toISOString().slice(0, 7);
};

/** Total already claimed (not rejected) by the employee in the category for that month. */
const monthToDate = async (db, { employeeEmail, category, month, excludeId }) => {
  const claims = await db.collection('reimbursements').find(
    {
      employee_email: employeeEmail,
      category: { $regex: `^${escapeRegex(String(category).trim())}$`, $options: 'i' },
      status: { $ne: 'rejected' },
      ...(excludeId ? { id: { $ne: excludeId } } : {})
    },
    { projection: { _id: 0, amount: 1, expense_date: 1 } }
  ).toArray();
  return round2(claims.filter(c => monthOf(c.expense_date) === month).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0));
};

/**
 * Check a claim against its category policy.
 * @returns {Promise<{ status: 'ok'|'warning'|'blocked', has_policy, enforcement, policy, violations, month, month_to_date, monthly_remaining, receipt_required }>}
 */
async function evaluatePolicy(db, { employee, role, category, amount, expenseDate, hasReceipt, excludeId }) {
  const policy = await findPolicy(db, category);
  const value = round2(amount);
  const month = monthOf(expenseDate || new Date());
  const result = {
    status: 'ok',
    has_policy: !!policy,
    enforcement: policy?.enforcement || null,
    policy: policy ? {
      id: policy.id,
      category: policy.category,
      max_per_claim: policy.max_per_claim ?? null,
      monthly_cap: policy.monthly_cap ?? null,
      receipt_required_above: policy.receipt_required_above ?? null,
      allowed_roles: policy.allowed_roles || [],
      allowed_departments: policy.allowed_departments || [],
      enforcement: policy.enforcement
    } : null,
    violations: [],
    month,
    month_to_date: null,
    monthly_remaining: null,
    receipt_required: false,
    checked_at: new Date()
  };
  if (!policy) return result;

  const v = result.violations;
  const employeeRole = role || employee?.role;
  if (policy.allowed_roles?.length && !policy.allowed_roles.includes(employeeRole)) {
    v.push({ code: 'role_not_allowed', message: `${policy.category} claims are limited to: ${policy.allowed_roles.join(', ')}` });
  }
  if (policy.allowed_departments?.length) {
    const dept = String(employee?.department || '').toLowerCase();
    if (!policy.allowed_departments.some(d => String(d).toLowerCase() === dept)) {
      v.push({ code: 'department_not_allowed', message: `${policy.category} claims are limited to these departments: ${policy.allowed_departments.join(', ')}` });
    }
  }
  if (policy.max_per_claim != null && value > policy.max_per_claim) {
    v.push({ code: 'max_per_claim', message: `Amount ${fmtINR(value)} exceeds the per-claim limit of ${fmtINR(policy.max_per_claim)}` });
  }
  if (policy.monthly_cap != null && employee?.email) {
    const used = await monthToDate(db, { employeeEmail: employee.email, category: policy.category, month, excludeId });
    result.month_to_date = used;
    result.monthly_remaining = round2(Math.max(0, policy.monthly_cap - used));
    if (used + value > policy.monthly_cap) {
      v.push({ code: 'monthly_cap', message: `This claim takes ${month} ${policy.category} spend to ${fmtINR(used + value)}, above the monthly cap of ${fmtINR(policy.monthly_cap)} (${fmtINR(result.monthly_remaining)} remaining)` });
    }
  }
  if (policy.receipt_required_above != null && value > policy.receipt_required_above) {
    result.receipt_required = true;
    if (!hasReceipt) {
      v.push({ code: 'receipt_required', message: policy.receipt_required_above > 0
        ? `A receipt is required for ${policy.category} claims above ${fmtINR(policy.receipt_required_above)}`
        : `A receipt is required for ${policy.category} claims` });
    }
  }

  if (v.length) result.status = policy.enforcement === 'hard' ? 'blocked' : 'warning';
  return result;
}

module.exports = { evaluatePolicy, findPolicy, DEFAULT_EXPENSE_CATEGORIES, monthOf };
