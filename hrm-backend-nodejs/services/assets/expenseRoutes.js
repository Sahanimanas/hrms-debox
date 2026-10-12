/**
 * AS-2 routes (mounted inside the assets module router, so already authenticated):
 *   /expense-categories, /expense-policies[...], /per-diem[...], /travel[...], /receipts/scan
 */
const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID, employeeUid } = require('../../utils/helpers');
const { emitEvent } = require('../events');
const {
  stripId, round2, escapeRegex, findMyEmployee, canActOnEmployee, findApprovingManager, teamQuery,
  notify, notifyAdmins, toDateOnly, dateKey, daysInclusive
} = require('./common');
const { evaluatePolicy, DEFAULT_EXPENSE_CATEGORIES } = require('./expensePolicy');
const { TIERS, getPerDiemConfig, calculatePerDiem } = require('./perDiem');
const { TRAVEL_MODES, tripSummary } = require('./travel');
const { extractReceipt, isOcrConfigured, ReceiptOcrError } = require('./receiptOcr');
const { receiptUpload } = require('./uploads');

const adminOnly = requireRole(['admin']);
const httpError = (status, message) => Object.assign(new Error(message), { status });

const handle = (label, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ detail: error.message });
    console.error(`${label} error:`, error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

const expenseCategories = async (db) => {
  const policyCats = await db.collection('expense_policies').distinct('category');
  const all = [...DEFAULT_EXPENSE_CATEGORIES];
  policyCats.forEach(c => { if (c && !all.some(x => x.toLowerCase() === String(c).toLowerCase())) all.push(c); });
  return all;
};

router.get('/expense-categories', handle('Expense categories', async (req, res) => {
  res.json(await expenseCategories(getDB()));
}));

// ============= EXPENSE POLICIES =============

const money = Joi.number().min(0).max(1e9).allow(null);
const policyBase = {
  category: Joi.string().trim().min(2).max(60),
  max_per_claim: money,
  monthly_cap: money,
  receipt_required_above: money,
  allowed_roles: Joi.array().items(Joi.string().valid('admin', 'manager', 'employee')).unique(),
  allowed_departments: Joi.array().items(Joi.string().trim().min(1).max(80)).unique(),
  enforcement: Joi.string().valid('hard', 'soft'),
  active: Joi.boolean(),
  description: Joi.string().max(500).allow('', null)
};
const policyCreateSchema = Joi.object({
  ...policyBase,
  category: policyBase.category.required(),
  allowed_roles: policyBase.allowed_roles.default([]),
  allowed_departments: policyBase.allowed_departments.default([]),
  enforcement: policyBase.enforcement.default('soft'),
  active: policyBase.active.default(true)
});
const policyUpdateSchema = Joi.object(policyBase).min(1);

const checkPolicyShape = (p) => {
  if (p.max_per_claim != null && p.monthly_cap != null && p.max_per_claim > p.monthly_cap) {
    throw httpError(422, 'Per-claim limit cannot be higher than the monthly cap');
  }
};

const categoryTaken = (db, category, excludeId) => db.collection('expense_policies').findOne({
  category: { $regex: `^${escapeRegex(category)}$`, $options: 'i' },
  ...(excludeId ? { id: { $ne: excludeId } } : {})
});

router.get('/expense-policies', handle('List expense policies', async (req, res) => {
  const db = getDB();
  const filter = req.user.role === 'admin' ? {} : { active: { $ne: false } };
  res.json(await db.collection('expense_policies').find(filter, { projection: { _id: 0 } }).sort({ category: 1 }).toArray());
}));

router.post('/expense-policies', adminOnly, validate(policyCreateSchema), handle('Create expense policy', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  checkPolicyShape(data);
  if (await categoryTaken(db, data.category)) return res.status(409).json({ detail: `A policy for ${data.category} already exists` });
  const now = new Date();
  const policy = {
    id: generateUUID(),
    max_per_claim: null, monthly_cap: null, receipt_required_above: null, description: '',
    ...data,
    created_by: req.user.email, created_at: now, updated_at: now
  };
  ['max_per_claim', 'monthly_cap', 'receipt_required_above'].forEach(k => { if (policy[k] != null) policy[k] = round2(policy[k]); });
  await db.collection('expense_policies').insertOne(policy);
  res.status(201).json(stripId(policy));
}));

router.put('/expense-policies/:id', adminOnly, validate(policyUpdateSchema), handle('Update expense policy', async (req, res) => {
  const db = getDB();
  const policy = await db.collection('expense_policies').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!policy) return res.status(404).json({ detail: 'Policy not found' });
  const data = req.validatedBody;
  checkPolicyShape({ ...policy, ...data });
  if (data.category && await categoryTaken(db, data.category, policy.id)) return res.status(409).json({ detail: `A policy for ${data.category} already exists` });
  ['max_per_claim', 'monthly_cap', 'receipt_required_above'].forEach(k => { if (data[k] != null) data[k] = round2(data[k]); });
  await db.collection('expense_policies').updateOne({ id: policy.id }, { $set: { ...data, updated_by: req.user.email, updated_at: new Date() } });
  res.json(await db.collection('expense_policies').findOne({ id: policy.id }, { projection: { _id: 0 } }));
}));

router.delete('/expense-policies/:id', adminOnly, handle('Delete expense policy', async (req, res) => {
  const db = getDB();
  const { deletedCount } = await db.collection('expense_policies').deleteOne({ id: req.params.id });
  if (!deletedCount) return res.status(404).json({ detail: 'Policy not found' });
  res.json({ message: 'Policy deleted' });
}));

const checkSchema = Joi.object({
  category: Joi.string().trim().max(60).required(),
  amount: Joi.number().positive().max(1e9).required(),
  expense_date: Joi.alternatives().try(Joi.date().iso(), Joi.valid(null, '')),
  has_receipt: Joi.boolean().default(false),
  reimbursement_id: Joi.string().trim().max(100).allow(null, '')
});

/**
 * POST /api/v2/assets/expense-policies/check
 * Pre-submit check of a claim for the current user (shown on the claim form).
 */
router.post('/expense-policies/check', validate(checkSchema), handle('Check expense policy', async (req, res) => {
  const db = getDB();
  const { category, amount, expense_date, has_receipt, reimbursement_id } = req.validatedBody;
  const employee = await findMyEmployee(db, req.user.email);
  let hasReceipt = has_receipt;
  if (reimbursement_id) {
    const existing = await db.collection('reimbursements').findOne({ id: reimbursement_id }, { projection: { _id: 0, employee_email: 1, bill_url: 1 } });
    if (!existing) return res.status(404).json({ detail: 'Reimbursement not found' });
    if (existing.employee_email !== req.user.email) return res.status(403).json({ detail: 'Not authorized' });
    hasReceipt = has_receipt || !!existing.bill_url;
  }
  const result = await evaluatePolicy(db, {
    employee: employee || { email: req.user.email, role: req.user.role },
    role: req.user.role,
    category,
    amount,
    expenseDate: expense_date ? dateKey(expense_date) : undefined,
    hasReceipt,
    excludeId: reimbursement_id || null
  });
  res.json(result);
}));

/** GET /api/v2/assets/expense-policies/check/:reimbursementId — re-run the check (admin or owner). */
router.get('/expense-policies/check/:reimbursementId', handle('Recheck expense policy', async (req, res) => {
  const db = getDB();
  const claim = await db.collection('reimbursements').findOne({ id: req.params.reimbursementId }, { projection: { _id: 0 } });
  if (!claim) return res.status(404).json({ detail: 'Reimbursement not found' });
  if (req.user.role !== 'admin' && claim.employee_email !== req.user.email) return res.status(403).json({ detail: 'Not authorized' });
  const employee = await findMyEmployee(db, claim.employee_email);
  const result = await evaluatePolicy(db, {
    employee: employee || { email: claim.employee_email },
    role: employee?.role,
    category: claim.category,
    amount: claim.amount,
    expenseDate: claim.expense_date,
    hasReceipt: !!claim.bill_url,
    excludeId: claim.id
  });
  res.json({ current: result, at_submission: claim.policy_check || null });
}));

// ============= PER-DIEM =============

router.get('/per-diem', handle('Get per-diem config', async (req, res) => {
  res.json(await getPerDiemConfig(getDB()));
}));

const perDiemSchema = Joi.object({
  rates: Joi.object({
    tier_1: Joi.number().min(0).max(1e6).required(),
    tier_2: Joi.number().min(0).max(1e6).required(),
    tier_3: Joi.number().min(0).max(1e6).required()
  }),
  default_tier: Joi.string().valid(...TIERS),
  cities: Joi.array().items(Joi.object({
    city: Joi.string().trim().min(2).max(80).required(),
    tier: Joi.string().valid(...TIERS).required()
  })).max(2000)
}).min(1);

router.put('/per-diem', adminOnly, validate(perDiemSchema), handle('Update per-diem config', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  if (data.cities) {
    const seen = new Set();
    for (const c of data.cities) {
      const key = c.city.toLowerCase();
      if (seen.has(key)) return res.status(422).json({ detail: `${c.city} is listed more than once` });
      seen.add(key);
    }
  }
  if (data.rates) data.rates = Object.fromEntries(Object.entries(data.rates).map(([k, v]) => [k, round2(v)]));
  const current = await getPerDiemConfig(db);
  const next = {
    id: 'default',
    rates: data.rates || current.rates,
    default_tier: data.default_tier || current.default_tier,
    cities: data.cities || current.cities,
    updated_at: new Date(),
    updated_by: req.user.email
  };
  await db.collection('per_diem_config').replaceOne({ id: 'default' }, next, { upsert: true });
  res.json(next);
}));

router.get('/per-diem/calculate', handle('Calculate per-diem', async (req, res) => {
  const { city, start_date, end_date } = req.query;
  if (!city || !toDateOnly(start_date) || !toDateOnly(end_date)) return res.status(422).json({ detail: 'city, start_date and end_date are required' });
  if (toDateOnly(end_date) < toDateOnly(start_date)) return res.status(422).json({ detail: 'End date cannot be before start date' });
  res.json(calculatePerDiem(await getPerDiemConfig(getDB()), { city, startDate: start_date, endDate: end_date }));
}));

// ============= TRAVEL REQUESTS =============

const travelSchema = Joi.object({
  purpose: Joi.string().trim().min(5).max(500).required(),
  from_city: Joi.string().trim().min(2).max(80).required(),
  to_city: Joi.string().trim().min(2).max(80).required(),
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().required(),
  travel_mode: Joi.string().valid(...TRAVEL_MODES).required(),
  accommodation_needed: Joi.boolean().default(false),
  estimated_cost: Joi.number().min(0).max(1e8).required(),
  advance_requested: Joi.number().min(0).max(1e8).default(0),
  notes: Joi.string().max(1000).allow('', null)
});

const loadTrip = async (db, id) => {
  const trip = await db.collection('travel_requests').findOne({ id }, { projection: { _id: 0 } });
  if (!trip) throw httpError(404, 'Travel request not found');
  return trip;
};

const canViewTrip = async (db, user, trip) =>
  user.role === 'admin' || trip.employee_email === user.email || await canActOnEmployee(db, user, trip.employee_email);

/** Whether `user` can approve/reject the trip at its current stage. */
const canActOnTrip = async (db, user, trip) => {
  if (trip.employee_email === user.email) return false;
  if (trip.status === 'pending_manager') return user.role === 'manager' && await canActOnEmployee(db, user, trip.employee_email);
  if (trip.status === 'pending_admin') return user.role === 'admin';
  return false;
};

const tripLabel = (t) => `${t.from_city} → ${t.to_city} (${dateKey(t.start_date)} to ${dateKey(t.end_date)})`;

router.post('/travel', validate(travelSchema), handle('Create travel request', async (req, res) => {
  const db = getDB();
  const employee = await findMyEmployee(db, req.user.email);
  if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });
  const data = req.validatedBody;
  const start = toDateOnly(data.start_date);
  const end = toDateOnly(data.end_date);
  if (end < start) return res.status(422).json({ detail: 'End date cannot be before start date' });
  if (daysInclusive(start, end) > 90) return res.status(422).json({ detail: 'A trip cannot be longer than 90 days' });
  if (data.from_city.toLowerCase() === data.to_city.toLowerCase()) return res.status(422).json({ detail: 'From and to cities must be different' });
  if (data.advance_requested > data.estimated_cost) return res.status(422).json({ detail: 'Advance cannot exceed the estimated cost' });

  const manager = await findApprovingManager(db, employee);
  const perDiem = calculatePerDiem(await getPerDiemConfig(db), { city: data.to_city, startDate: start, endDate: end });
  const now = new Date();
  const trip = {
    id: generateUUID(),
    employee_uid: employeeUid(employee),
    employee_email: employee.email,
    employee_name: employee.full_name,
    department: employee.department || null,
    manager_email: manager?.email || null,
    manager_name: manager?.full_name || null,
    purpose: data.purpose,
    from_city: data.from_city,
    to_city: data.to_city,
    start_date: start,
    end_date: end,
    days: daysInclusive(start, end),
    travel_mode: data.travel_mode,
    accommodation_needed: data.accommodation_needed,
    estimated_cost: round2(data.estimated_cost),
    advance_requested: round2(data.advance_requested),
    notes: data.notes || '',
    per_diem: perDiem,
    status: manager ? 'pending_manager' : 'pending_admin',
    approvals: [],
    advance_status: data.advance_requested > 0 ? 'pending' : 'not_requested',
    advance_disbursed_amount: null,
    advance_disbursed_at: null,
    advance_disbursed_by: null,
    advance_reference: null,
    settled_at: null,
    settlement: null,
    created_at: now,
    updated_at: now
  };
  await db.collection('travel_requests').insertOne(trip);

  const payload = {
    type: 'travel_request_submitted',
    title: 'New travel request',
    message: `${employee.full_name} requested travel ${tripLabel(trip)}`,
    actionUrl: '/travel?tab=approvals',
    metadata: { travel_id: trip.id }
  };
  if (manager) notify({ id: manager.id, email: manager.email }, payload);
  else notifyAdmins(db, payload, employee.email);

  res.status(201).json(stripId(trip));
}));

/**
 * GET /api/v2/assets/travel?scope=mine|team|approvals|all&status=
 *   mine (default for employees) · team (manager: their team; admin: all) ·
 *   approvals (awaiting the caller's action) · all (admin)
 */
router.get('/travel', handle('List travel requests', async (req, res) => {
  const db = getDB();
  const { role, email } = req.user;
  const scope = req.query.scope || (role === 'employee' ? 'mine' : 'approvals');
  let filter;

  if (scope === 'mine' || role === 'employee') {
    filter = { employee_email: email };
  } else if (role === 'admin') {
    filter = scope === 'approvals' ? { status: 'pending_admin', employee_email: { $ne: email } } : {};
  } else {
    const me = await findMyEmployee(db, email);
    const team = me ? await db.collection('employees').find(teamQuery(me), { projection: { _id: 0, email: 1 } }).toArray() : [];
    filter = { employee_email: { $in: team.map(t => t.email) } };
    if (scope === 'approvals') filter.status = 'pending_manager';
  }
  if (req.query.status) filter.status = String(req.query.status);
  const trips = await db.collection('travel_requests').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(2000).toArray();
  res.json(trips);
}));

/** GET /api/v2/assets/travel/linkable — the caller's approved trips that claims can be linked to. */
router.get('/travel/linkable', handle('Linkable trips', async (req, res) => {
  const db = getDB();
  const trips = await db.collection('travel_requests').find(
    { employee_email: req.user.email, status: 'approved' },
    { projection: { _id: 0, id: 1, purpose: 1, from_city: 1, to_city: 1, start_date: 1, end_date: 1 } }
  ).sort({ start_date: -1 }).toArray();
  res.json(trips.map(t => ({ ...t, label: `${tripLabel(t)} — ${t.purpose}` })));
}));

router.get('/travel/:id', handle('Get travel request', async (req, res) => {
  const db = getDB();
  const trip = await loadTrip(db, req.params.id);
  if (!(await canViewTrip(db, req.user, trip))) return res.status(403).json({ detail: 'Not authorized to view this travel request' });
  res.json({ ...trip, summary: await tripSummary(db, trip), can_act: await canActOnTrip(db, req.user, trip) });
}));

const actionSchema = Joi.object({ comments: Joi.string().trim().max(1000).allow('', null) });
const travelRejectSchema = Joi.object({ comments: Joi.string().trim().min(3).max(1000).required() });

router.post('/travel/:id/approve', validate(actionSchema), handle('Approve travel request', async (req, res) => {
  const db = getDB();
  const trip = await loadTrip(db, req.params.id);
  if (!['pending_manager', 'pending_admin'].includes(trip.status)) return res.status(400).json({ detail: `Travel request is already ${trip.status.replace('_', ' ')}` });
  if (!(await canActOnTrip(db, req.user, trip))) {
    return res.status(403).json({ detail: trip.status === 'pending_manager' ? 'Awaiting approval from the employee\'s manager' : 'Only an admin can give final approval' });
  }
  const now = new Date();
  const stage = trip.status === 'pending_manager' ? 'manager' : 'admin';
  const approval = { stage, action: 'approved', by_email: req.user.email, by_name: req.user.full_name || req.user.email, comments: req.validatedBody.comments || '', at: now };
  const set = { updated_at: now };

  if (stage === 'manager') {
    set.status = 'pending_admin';
  } else {
    set.status = 'approved';
    set.approved_at = now;
    // Final approval locks the per-diem at the current rates
    set.per_diem = calculatePerDiem(await getPerDiemConfig(db), { city: trip.to_city, startDate: trip.start_date, endDate: trip.end_date });
  }
  // Only move forward if nobody else acted in the meantime
  const { modifiedCount } = await db.collection('travel_requests').updateOne({ id: trip.id, status: trip.status }, { $set: set, $push: { approvals: approval } });
  if (!modifiedCount) return res.status(409).json({ detail: 'This request was just updated by someone else' });

  if (stage === 'manager') {
    notifyAdmins(db, {
      type: 'travel_request_submitted',
      title: 'Travel request awaiting final approval',
      message: `${trip.employee_name}'s travel ${tripLabel(trip)} was approved by ${approval.by_name}`,
      actionUrl: '/travel?tab=approvals',
      metadata: { travel_id: trip.id }
    }, trip.employee_email);
  } else {
    emitEvent('travel.approved', { travel_id: trip.id, employee_uid: trip.employee_uid, employee_email: trip.employee_email, advance_requested: trip.advance_requested });
  }
  notify({ email: trip.employee_email }, {
    type: 'travel_request_updated',
    title: stage === 'manager' ? 'Travel request approved by manager' : 'Travel request approved',
    message: `Your travel ${tripLabel(trip)} was ${stage === 'manager' ? 'approved by your manager and sent for final approval' : 'approved'}`,
    actionUrl: '/travel',
    metadata: { travel_id: trip.id }
  });
  res.json(await loadTrip(db, trip.id));
}));

router.post('/travel/:id/reject', validate(travelRejectSchema), handle('Reject travel request', async (req, res) => {
  const db = getDB();
  const trip = await loadTrip(db, req.params.id);
  if (!['pending_manager', 'pending_admin'].includes(trip.status)) return res.status(400).json({ detail: `Travel request is already ${trip.status.replace('_', ' ')}` });
  const adminOverride = req.user.role === 'admin' && trip.employee_email !== req.user.email;
  if (!adminOverride && !(await canActOnTrip(db, req.user, trip))) return res.status(403).json({ detail: 'Not authorized to reject this travel request' });
  const now = new Date();
  const stage = trip.status === 'pending_manager' && req.user.role !== 'admin' ? 'manager' : 'admin';
  const approval = { stage, action: 'rejected', by_email: req.user.email, by_name: req.user.full_name || req.user.email, comments: req.validatedBody.comments, at: now };
  const { modifiedCount } = await db.collection('travel_requests').updateOne(
    { id: trip.id, status: trip.status },
    { $set: { status: 'rejected', advance_status: trip.advance_status === 'pending' ? 'not_requested' : trip.advance_status, updated_at: now }, $push: { approvals: approval } }
  );
  if (!modifiedCount) return res.status(409).json({ detail: 'This request was just updated by someone else' });
  notify({ email: trip.employee_email }, {
    type: 'travel_request_updated',
    title: 'Travel request rejected',
    message: `Your travel ${tripLabel(trip)} was rejected: ${approval.comments}`,
    actionUrl: '/travel',
    metadata: { travel_id: trip.id }
  });
  res.json(await loadTrip(db, trip.id));
}));

router.post('/travel/:id/cancel', handle('Cancel travel request', async (req, res) => {
  const db = getDB();
  const trip = await loadTrip(db, req.params.id);
  if (trip.employee_email !== req.user.email) return res.status(403).json({ detail: 'You can only cancel your own travel requests' });
  if (!['pending_manager', 'pending_admin', 'approved'].includes(trip.status)) return res.status(400).json({ detail: `Travel request is already ${trip.status.replace('_', ' ')}` });
  if (trip.advance_status === 'disbursed') return res.status(400).json({ detail: 'An advance has been paid for this trip; ask an admin to settle it instead' });
  const linked = await db.collection('reimbursements').countDocuments({ trip_id: trip.id, status: { $ne: 'rejected' } });
  if (linked) return res.status(400).json({ detail: 'Expense claims are linked to this trip; remove them first' });
  await db.collection('travel_requests').updateOne({ id: trip.id }, { $set: { status: 'cancelled', updated_at: new Date() } });
  res.json(await loadTrip(db, trip.id));
}));

const advanceSchema = Joi.object({
  amount: Joi.number().positive().max(1e8),
  reference: Joi.string().trim().max(120).allow('', null),
  notes: Joi.string().max(500).allow('', null)
});

/** POST /api/v2/assets/travel/:id/advance — admin marks the travel advance as paid. */
router.post('/travel/:id/advance', adminOnly, validate(advanceSchema), handle('Disburse travel advance', async (req, res) => {
  const db = getDB();
  const trip = await loadTrip(db, req.params.id);
  if (trip.status !== 'approved') return res.status(400).json({ detail: 'Advances can only be paid on approved trips' });
  if (trip.advance_status === 'disbursed') return res.status(400).json({ detail: 'Advance already disbursed' });
  if (!(trip.advance_requested > 0)) return res.status(400).json({ detail: 'No advance was requested for this trip' });
  const amount = round2(req.validatedBody.amount ?? trip.advance_requested);
  if (amount > trip.advance_requested) return res.status(422).json({ detail: 'Cannot pay more than the advance requested' });
  const now = new Date();
  await db.collection('travel_requests').updateOne({ id: trip.id }, {
    $set: {
      advance_status: 'disbursed', advance_disbursed_amount: amount, advance_disbursed_at: now,
      advance_disbursed_by: req.user.email, advance_reference: req.validatedBody.reference || null,
      advance_notes: req.validatedBody.notes || null, updated_at: now
    }
  });
  notify({ email: trip.employee_email }, {
    type: 'travel_advance_disbursed',
    title: 'Travel advance paid',
    message: `An advance of ₹${amount.toLocaleString('en-IN')} was paid for your travel ${tripLabel(trip)}`,
    actionUrl: '/travel',
    metadata: { travel_id: trip.id, amount }
  });
  emitEvent('travel.advance.disbursed', { travel_id: trip.id, employee_uid: trip.employee_uid, amount });
  res.json(await loadTrip(db, trip.id));
}));

/** POST /api/v2/assets/travel/:id/settle — admin closes the trip, snapshotting the settlement. */
router.post('/travel/:id/settle', adminOnly, validate(actionSchema), handle('Settle travel request', async (req, res) => {
  const db = getDB();
  const trip = await loadTrip(db, req.params.id);
  if (trip.status !== 'approved') return res.status(400).json({ detail: 'Only approved trips can be settled' });
  const summary = await tripSummary(db, trip);
  const pending = summary.claims.filter(c => c.status === 'pending').length;
  if (pending) return res.status(400).json({ detail: `${pending} linked claim(s) are still pending approval` });
  const now = new Date();
  const settlement = {
    total_claimed: summary.total_claimed,
    per_diem_amount: summary.per_diem_amount,
    advance_disbursed: summary.advance_disbursed,
    balance: summary.balance,
    direction: summary.settlement_direction,
    comments: req.validatedBody.comments || '',
    settled_by: req.user.email
  };
  await db.collection('travel_requests').updateOne({ id: trip.id }, { $set: { status: 'settled', settled_at: now, settlement, updated_at: now } });
  notify({ email: trip.employee_email }, {
    type: 'travel_settled',
    title: 'Travel settled',
    message: `Your travel ${tripLabel(trip)} has been settled. Balance: ₹${Math.abs(settlement.balance).toLocaleString('en-IN')} ${settlement.direction === 'payable_to_employee' ? 'payable to you' : settlement.direction === 'recoverable_from_employee' ? 'to be returned' : ''}`.trim(),
    actionUrl: '/travel',
    metadata: { travel_id: trip.id }
  });
  res.json(await loadTrip(db, trip.id));
}));

// ============= RECEIPT OCR =============

router.get('/receipts/scan/status', (req, res) => res.json({ configured: isOcrConfigured() }));

/**
 * POST /api/v2/assets/receipts/scan (multipart: receipt) — extract amount, date,
 * vendor and a suggested category. Returns { configured: false } when
 * ANTHROPIC_API_KEY is not set so the UI falls back to manual entry.
 */
router.post('/receipts/scan', receiptUpload('receipt'), handle('Scan receipt', async (req, res) => {
  if (!isOcrConfigured()) {
    return res.json({ configured: false, detail: 'Receipt scanning is not configured. Enter the details manually.' });
  }
  if (!req.file) return res.status(400).json({ detail: 'Attach the receipt in the "receipt" field' });
  try {
    const result = await extractReceipt({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      categories: await expenseCategories(getDB())
    });
    res.json(result);
  } catch (error) {
    if (error instanceof ReceiptOcrError) return res.status(error.status).json({ detail: error.message });
    console.error('Receipt OCR failed:', error.message);
    res.status(502).json({ detail: 'Receipt scanning failed. Enter the details manually.' });
  }
}));

module.exports = router;
