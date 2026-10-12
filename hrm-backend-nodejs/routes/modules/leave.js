/**
 * leave module — mounted at /api/v2/leave
 *
 * Advanced leave features on top of the existing /api/leaves endpoints:
 *   LV-1  year-end carry-forward / encashment / lapse (preview, run, logs, encashments)
 *   LV-2  extra leave types (types + balances, standard types, restricted holidays)
 *   LV-4  approval chain settings and delegation
 *   LV-5  team "who's out" calendar and today's absentees
 * (LV-3 sandwich counting lives in services/leave/rules.js and is applied by
 *  /api/leaves on apply, edit and validate-application.)
 */
const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID, normalizeLeaveType } = require('../../utils/helpers');
const { createNotification } = require('../../services/notificationService');
const {
  getPolicyDoc,
  tracksBalance,
  isOccurrenceType,
  effectiveBalance,
  STANDARD_EXTRA_TYPES,
  leaveCategory,
  teamQuery,
  findEmployeeByEmail,
  todayKey,
  dateKey,
  addDaysKey,
  getHolidayMap,
  round1
} = require('../../services/leave/common');
const approvals = require('../../services/leave/approvals');
const yearEnd = require('../../services/leave/yearEnd');

const ACTIVE = ['pending', 'manager_approved', 'approved'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

let indexesReady = false;
async function ensureIndexes(db) {
  if (indexesReady) return;
  await Promise.all([
    db.collection(approvals.DELEGATIONS).createIndex({ id: 1 }, { unique: true }),
    db.collection(approvals.DELEGATIONS).createIndex({ delegate_email: 1, status: 1 }),
    db.collection(approvals.DELEGATIONS).createIndex({ delegator_email: 1, status: 1 }),
    db.collection('leaves').createIndex({ current_approver_email: 1, status: 1 }),
    db.collection('leaves').createIndex({ employee_email: 1, status: 1 }),
    yearEnd.ensureIndexes(db)
  ]);
  indexesReady = true;
}

router.get('/health', (req, res) => res.json({ module: 'leave', status: 'ok' }));

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Leave module index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

const fail500 = (label) => (error, res) => {
  console.error(`${label} error:`, error);
  res.status(500).json({ detail: 'Internal server error' });
};

// ============= LV-2: LEAVE TYPES & BALANCES =============

const describeType = (p) => ({
  leave_type: p.leave_type,
  key: normalizeLeaveType(p.leave_type),
  order: p.order ?? 0,
  credit_type: p.credit_type || 'annually',
  event_scope: p.credit_type === 'event' ? (p.event_scope || 'occurrence') : null,
  annual_quota: Number(p.annual_quota) || 0,
  monthly_credit: Number(p.monthly_credit) || 0,
  is_unlimited: !!p.is_unlimited,
  tracks_balance: tracksBalance(p),
  per_occurrence: isOccurrenceType(p),
  max_occurrences_per_year: p.max_occurrences_per_year || null,
  gender_restriction: p.gender_restriction || null,
  restricted_holiday_only: !!p.restricted_holiday_only,
  sandwich_rule: !!p.sandwich_rule,
  advance_days_required: Number(p.advance_days_required) || 0,
  carry_forward_allowed: !!p.carry_forward_allowed,
  max_carry_forward_days: Number(p.max_carry_forward_days) || 0,
  encashment_allowed: !!p.encashment_allowed,
  clubbing_not_allowed_with: p.clubbing_not_allowed_with || [],
  category: leaveCategory(p.leave_type),
  description: p.description || null
});

/**
 * GET /api/v2/leave/types
 * Leave types from the policy with how each one is credited / counted.
 */
router.get('/types', async (req, res) => {
  try {
    const db = getDB();
    const policyDoc = await getPolicyDoc(db);
    const names = new Set((policyDoc.policies || []).map(p => normalizeLeaveType(p.leave_type)));
    res.json({
      types: (policyDoc.policies || []).map(describeType).sort((a, b) => a.order - b.order),
      policy_saved: !policyDoc.is_default,
      missing_standard_types: STANDARD_EXTRA_TYPES.filter(t => !names.has(normalizeLeaveType(t.leave_type))).map(t => t.leave_type)
    });
  } catch (error) {
    fail500('Get leave types')(error, res);
  }
});

/**
 * GET /api/v2/leave/my-balance
 * The current user's balance per policy type, with usage this year.
 */
router.get('/my-balance', async (req, res) => {
  try {
    const db = getDB();
    const employee = await findEmployeeByEmail(db, req.user.email);
    const policyDoc = await getPolicyDoc(db);
    if (!employee) return res.json({ has_profile: false, types: [], comp_off: 0 });

    const year = todayKey().slice(0, 4);
    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email, status: { $in: ACTIVE } }, { projection: { _id: 0, leave_type: 1, dates: 1, days_count: 1, status: 1 } })
      .toArray();
    const thisYear = leaves.filter(l => (dateKey((l.dates || [])[0]) || '').startsWith(year));

    const types = (policyDoc.policies || []).map(p => {
      const t = describeType(p);
      const mine = thisYear.filter(l => normalizeLeaveType(l.leave_type || '') === t.key);
      return {
        ...t,
        available: t.is_unlimited ? null : round1(effectiveBalance(employee, p, t.key)),
        used_this_year: round1(mine.filter(l => l.status !== 'pending').reduce((s, l) => s + (l.days_count || 0), 0)),
        pending_days: round1(mine.filter(l => l.status === 'pending').reduce((s, l) => s + (l.days_count || 0), 0)),
        occurrences_this_year: mine.length,
        eligible: !(p.gender_restriction && employee.gender && String(employee.gender).toLowerCase() !== p.gender_restriction)
      };
    }).sort((a, b) => a.order - b.order);

    res.json({
      has_profile: true,
      year: Number(year),
      types,
      comp_off: Number(employee.leave_balance?.comp_off) || 0,
      carry_forward: employee.leave_carry_forward || null
    });
  } catch (error) {
    fail500('Get my balance')(error, res);
  }
});

/**
 * POST /api/v2/leave/policy/add-standard-types
 * Body: { types?: ['Maternity Leave', …] } — appends the standard types missing from the saved policy.
 */
router.post('/policy/add-standard-types', requireRole(['admin']), validate(Joi.object({
  types: Joi.array().items(Joi.string().valid(...STANDARD_EXTRA_TYPES.map(t => t.leave_type))).unique()
})), async (req, res) => {
  try {
    const db = getDB();
    const policyDoc = await getPolicyDoc(db);
    const policies = [...(policyDoc.policies || [])];
    const present = new Set(policies.map(p => normalizeLeaveType(p.leave_type)));
    const wanted = req.validatedBody.types || STANDARD_EXTRA_TYPES.map(t => t.leave_type);
    const added = [];
    for (const t of STANDARD_EXTRA_TYPES) {
      if (!wanted.includes(t.leave_type) || present.has(normalizeLeaveType(t.leave_type))) continue;
      policies.push({ ...t, order: policies.length + 1 });
      added.push(t.leave_type);
    }

    const policy = {
      id: 'default_policy',
      policies,
      clubbing_rules: policyDoc.clubbing_rules || [],
      updated_at: new Date().toISOString(),
      updated_by: req.user.email
    };
    await db.collection('leave_policies').updateOne({ id: 'default_policy' }, { $set: policy }, { upsert: true });
    // Old installs may hold the policy under another id; keep a single document
    await db.collection('leave_policies').deleteMany({ id: { $ne: 'default_policy' } });

    res.json({ added, message: added.length ? `Added ${added.join(', ')}` : 'All standard leave types are already in the policy', policy });
  } catch (error) {
    fail500('Add standard leave types')(error, res);
  }
});

/**
 * GET /api/v2/leave/restricted-holidays?year=
 * Optional / restricted holidays an employee may use their RH quota on.
 */
router.get('/restricted-holidays', async (req, res) => {
  try {
    const db = getDB();
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : todayKey().slice(0, 4);
    const map = await getHolidayMap(db, `${year}-01-01`, `${year}-12-31`);
    const booked = new Set();
    const employee = await findEmployeeByEmail(db, req.user.email);
    if (employee) {
      const leaves = await db.collection('leaves').find({ employee_email: employee.email, status: { $in: ACTIVE } }, { projection: { _id: 0, dates: 1 } }).toArray();
      leaves.forEach(l => (l.dates || []).forEach(d => booked.add(dateKey(d))));
    }
    const holidays = Object.entries(map)
      .filter(([, h]) => ['optional', 'restricted'].includes(h.type))
      .map(([date, h]) => ({ date, name: h.name, type: h.type, booked: booked.has(date) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    res.json({ year: Number(year), holidays });
  } catch (error) {
    fail500('Restricted holidays')(error, res);
  }
});

// ============= LV-4: APPROVAL SETTINGS & DELEGATION =============

/**
 * GET /api/v2/leave/approval-settings
 */
router.get('/approval-settings', async (req, res) => {
  try {
    res.json(await approvals.getApprovalSettings(getDB()));
  } catch (error) {
    fail500('Get approval settings')(error, res);
  }
});

/**
 * PUT /api/v2/leave/approval-settings (admin)
 * Body: { steps: [{ name, approver_type: manager|admin|user, approver_email?, min_days }], admin_override }
 */
router.put('/approval-settings', requireRole(['admin']), validate(approvals.approvalSettingsSchema), async (req, res) => {
  try {
    const db = getDB();
    const { steps, admin_override } = req.validatedBody;
    if (!steps.some(s => !s.min_days)) {
      return res.status(400).json({ detail: 'At least one approval level must apply to every leave (minimum days 0)' });
    }
    for (const step of steps.filter(s => s.approver_type === 'user')) {
      const user = await db.collection('users').findOne({ email: step.approver_email }, { projection: { _id: 0, role: 1, is_active: 1 } });
      if (!user || !['manager', 'admin'].includes(user.role) || user.is_active === false) {
        return res.status(400).json({ detail: `${step.approver_email} must be an active manager or admin to approve leave` });
      }
    }
    const doc = {
      id: approvals.SETTINGS_ID,
      steps: steps.map(s => ({ name: s.name, approver_type: s.approver_type, approver_email: s.approver_email || null, min_days: s.min_days || 0 })),
      admin_override,
      updated_by: req.user.email,
      updated_at: new Date()
    };
    await db.collection(approvals.SETTINGS_COLLECTION).updateOne({ id: approvals.SETTINGS_ID }, { $set: doc }, { upsert: true });
    res.json({ ...doc, is_default: false, message: 'Approval chain saved. It applies to leave applied from now on.' });
  } catch (error) {
    fail500('Save approval settings')(error, res);
  }
});

/**
 * GET /api/v2/leave/approvers — managers and admins (for approver / delegate pickers).
 */
router.get('/approvers', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const users = await db.collection('users')
      .find({ role: { $in: ['manager', 'admin'] }, is_active: { $ne: false } }, { projection: { _id: 0, email: 1, full_name: 1, name: 1, role: 1, department: 1 } })
      .sort({ full_name: 1 })
      .toArray();
    res.json(users.map(u => ({ email: u.email, full_name: u.full_name || u.name || u.email, role: u.role, department: u.department || null })));
  } catch (error) {
    fail500('List approvers')(error, res);
  }
});

const delegationView = (d, today) => ({
  ...d,
  is_current: d.status === 'active' && d.start_date <= today && d.end_date >= today,
  is_upcoming: d.status === 'active' && d.start_date > today,
  is_expired: d.status === 'active' && d.end_date < today
});

/**
 * GET /api/v2/leave/delegations
 * Managers: delegations they gave and received. Admins: all (or ?scope=mine).
 */
router.get('/delegations', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const me = req.user.email;
    const filter = req.user.role === 'admin' && req.query.scope !== 'mine'
      ? {}
      : { $or: [{ delegator_email: me }, { delegate_email: me }] };
    if (['active', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
    const rows = await db.collection(approvals.DELEGATIONS).find(filter, { projection: { _id: 0 } }).sort({ start_date: -1 }).limit(500).toArray();
    const today = todayKey();
    res.json(rows.map(d => delegationView(d, today)));
  } catch (error) {
    fail500('List delegations')(error, res);
  }
});

/**
 * POST /api/v2/leave/delegations
 * Body: { delegate_email, start_date, end_date, reason?, delegator_email? (admin only) }
 */
router.post('/delegations', requireRole(['admin', 'manager']), validate(approvals.delegationSchema), async (req, res) => {
  try {
    const db = getDB();
    const body = req.validatedBody;
    const delegatorEmail = body.delegator_email && body.delegator_email !== req.user.email ? body.delegator_email : req.user.email;
    if (delegatorEmail !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ detail: 'Only an admin can set up a delegation for someone else' });
    }
    if (body.end_date < body.start_date) {
      return res.status(400).json({ detail: 'End date must be on or after the start date' });
    }
    if (body.end_date < todayKey()) {
      return res.status(400).json({ detail: 'The delegation period has already ended' });
    }
    if (body.delegate_email === delegatorEmail) {
      return res.status(400).json({ detail: 'You cannot delegate approvals to yourself' });
    }

    const [delegator, delegate] = await Promise.all([
      db.collection('users').findOne({ email: delegatorEmail }, { projection: { _id: 0, email: 1, full_name: 1, name: 1, role: 1, is_active: 1 } }),
      db.collection('users').findOne({ email: body.delegate_email }, { projection: { _id: 0, email: 1, full_name: 1, name: 1, role: 1, is_active: 1 } })
    ]);
    if (!delegator || !['manager', 'admin'].includes(delegator.role)) {
      return res.status(400).json({ detail: 'Only managers and admins can delegate approvals' });
    }
    if (!delegate || !['manager', 'admin'].includes(delegate.role) || delegate.is_active === false) {
      return res.status(400).json({ detail: 'The delegate must be an active manager or admin' });
    }

    const clash = await db.collection(approvals.DELEGATIONS).findOne({
      delegator_email: delegatorEmail,
      status: 'active',
      start_date: { $lte: body.end_date },
      end_date: { $gte: body.start_date }
    });
    if (clash) {
      return res.status(409).json({ detail: `There is already a delegation to ${clash.delegate_name || clash.delegate_email} from ${clash.start_date} to ${clash.end_date}` });
    }

    const now = new Date();
    const delegation = {
      id: generateUUID(),
      delegator_email: delegatorEmail,
      delegator_name: delegator.full_name || delegator.name || delegatorEmail,
      delegator_role: delegator.role,
      delegate_email: delegate.email,
      delegate_name: delegate.full_name || delegate.name || delegate.email,
      delegate_role: delegate.role,
      start_date: body.start_date,
      end_date: body.end_date,
      reason: body.reason || null,
      status: 'active',
      created_by: req.user.email,
      created_at: now,
      updated_at: now
    };
    await db.collection(approvals.DELEGATIONS).insertOne(delegation);
    delete delegation._id;

    const delegateEmployee = await findEmployeeByEmail(db, delegate.email);
    createNotification({
      userId: delegateEmployee?.id,
      userEmail: delegate.email,
      type: 'leave_delegation',
      title: 'Leave approvals delegated to you',
      message: `${delegation.delegator_name} delegated their leave approvals to you from ${delegation.start_date} to ${delegation.end_date}`,
      actionUrl: '/approvals',
      metadata: { delegation_id: delegation.id }
    }).catch(() => {});

    res.status(201).json(delegationView(delegation, todayKey()));
  } catch (error) {
    fail500('Create delegation')(error, res);
  }
});

/**
 * DELETE /api/v2/leave/delegations/:id — cancel (delegator or admin).
 */
router.delete('/delegations/:id', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const delegation = await db.collection(approvals.DELEGATIONS).findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!delegation) return res.status(404).json({ detail: 'Delegation not found' });
    if (req.user.role !== 'admin' && delegation.delegator_email !== req.user.email) {
      return res.status(403).json({ detail: 'Only the person who delegated (or an admin) can cancel this' });
    }
    if (delegation.status !== 'active') return res.status(400).json({ detail: 'Delegation is already cancelled' });
    const now = new Date();
    await db.collection(approvals.DELEGATIONS).updateOne(
      { id: delegation.id },
      { $set: { status: 'cancelled', cancelled_by: req.user.email, cancelled_at: now, updated_at: now } }
    );
    res.json({ message: 'Delegation cancelled', id: delegation.id });
  } catch (error) {
    fail500('Cancel delegation')(error, res);
  }
});

// ============= LV-5: TEAM CALENDAR =============

/**
 * Whose leave the user may see on the team calendar:
 * admin → everyone (optional department), manager → team + self, employee → own department.
 */
async function calendarScope(db, user, department) {
  const me = await findEmployeeByEmail(db, user.email);
  if (user.role === 'admin') {
    return { level: 'admin', filter: department ? { department } : {}, me };
  }
  if (!me) return { level: user.role, filter: { email: user.email }, me };
  if (user.role === 'manager') {
    return { level: 'manager', filter: { $or: [teamQuery(me), { email: me.email }] }, me };
  }
  return { level: 'employee', filter: me.department ? { department: me.department } : { email: me.email }, me };
}

async function scopedLeaves(db, scope, fromKey, toKey, statuses) {
  const people = await db.collection('employees')
    .find(scope.filter, { projection: { _id: 0, email: 1, full_name: 1, department: 1, designation: 1 } })
    .toArray();
  const byEmail = new Map(people.map(p => [p.email, p]));
  if (!byEmail.size) return { people, rows: [] };

  // Dates are ISO strings; widen by a day so local-midnight values aren't missed, then filter by calendar day
  const lo = `${addDaysKey(fromKey, -1)}`;
  const hi = `${addDaysKey(toKey, 1)}T23:59:59.999Z`;
  const leaves = await db.collection('leaves').find({
    employee_email: { $in: [...byEmail.keys()] },
    status: { $in: statuses },
    dates: { $elemMatch: { $gte: lo, $lte: hi } }
  }, { projection: { _id: 0, reason: 0, approvals: 0, approval_chain: 0 } }).toArray();

  const rows = [];
  for (const l of leaves) {
    const keys = (l.dates || []).map(dateKey).filter(k => k && k >= fromKey && k <= toKey).sort();
    if (!keys.length) continue;
    const person = byEmail.get(l.employee_email) || {};
    const row = {
      leave_id: l.id,
      employee_name: l.employee_name || person.full_name,
      dates: keys,
      category: leaveCategory(l.leave_type),
      status: l.status === 'approved' ? 'approved' : 'pending',
      is_half_day: !!l.is_half_day,
      half_day_period: l.half_day_period || null
    };
    if (scope.level !== 'employee') {
      Object.assign(row, {
        employee_email: l.employee_email,
        department: person.department || l.department || null,
        designation: person.designation || null,
        leave_type: l.leave_type,
        days_count: l.days_count
      });
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || String(a.employee_name).localeCompare(String(b.employee_name)));
  return { people, rows };
}

/**
 * GET /api/v2/leave/team-calendar?month=YYYY-MM&include_pending=true&department=
 */
router.get('/team-calendar', async (req, res) => {
  try {
    const db = getDB();
    const month = MONTH_RE.test(req.query.month || '') ? req.query.month : todayKey().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const fromKey = `${month}-01`;
    const toKey = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const includePending = req.query.include_pending === 'true';
    const department = req.user.role === 'admin' && req.query.department ? String(req.query.department) : null;

    const scope = await calendarScope(db, req.user, department);
    const statuses = includePending ? ACTIVE : ['approved'];
    const [{ people, rows }, holidayMap] = await Promise.all([
      scopedLeaves(db, scope, fromKey, toKey, statuses),
      getHolidayMap(db, fromKey, toKey)
    ]);

    let departments = [];
    if (scope.level === 'admin') {
      departments = (await db.collection('employees').distinct('department')).filter(Boolean).sort();
    }

    res.json({
      month,
      from: fromKey,
      to: toKey,
      scope: scope.level,
      department: scope.level === 'employee' ? scope.me?.department || null : department,
      include_pending: includePending,
      people_count: people.length,
      departments,
      holidays: Object.entries(holidayMap).map(([date, h]) => ({ date, name: h.name, type: h.type })).sort((a, b) => a.date.localeCompare(b.date)),
      entries: rows
    });
  } catch (error) {
    fail500('Team calendar')(error, res);
  }
});

/**
 * GET /api/v2/leave/whos-out-today?include_pending=true
 */
router.get('/whos-out-today', async (req, res) => {
  try {
    const db = getDB();
    const today = todayKey();
    const scope = await calendarScope(db, req.user, null);
    const statuses = req.query.include_pending === 'true' ? ACTIVE : ['approved'];
    const [{ people, rows }, holidayMap] = await Promise.all([
      scopedLeaves(db, scope, today, today, statuses),
      getHolidayMap(db, today, today)
    ]);
    res.json({
      date: today,
      scope: scope.level,
      people_count: people.length,
      holiday: holidayMap[today] ? { name: holidayMap[today].name, type: holidayMap[today].type } : null,
      out: rows
    });
  } catch (error) {
    fail500("Who's out today")(error, res);
  }
});

// ============= LV-1: YEAR-END =============

const yearQuery = (value) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

/**
 * GET /api/v2/leave/year-end/preview?year=YYYY (admin) — dry run.
 */
router.get('/year-end/preview', requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const current = yearEnd.currentYear();
    const year = req.query.year !== undefined
      ? yearQuery(req.query.year)
      : (yearEnd.currentMonth() === 12 ? current : current - 1);
    if (!year) return res.status(422).json({ detail: 'year must be a 4-digit year' });
    if (year > current) return res.status(400).json({ detail: 'Cannot preview a future leave year' });
    res.json(await yearEnd.previewYearEnd(db, year));
  } catch (error) {
    fail500('Year-end preview')(error, res);
  }
});

/**
 * POST /api/v2/leave/year-end/run (admin)
 * Body: { year, force? } — closes `year` and applies the January opening of year + 1.
 */
router.post('/year-end/run', requireRole(['admin']), validate(Joi.object({
  year: Joi.number().integer().min(2000).max(2100).required(),
  force: Joi.boolean().default(false)
})), async (req, res) => {
  try {
    const db = getDB();
    const { year, force } = req.validatedBody;
    const current = yearEnd.currentYear();
    if (year >= current) {
      return res.status(400).json({ detail: `Leave year ${year} hasn't ended yet. Use the preview until 1 January ${year + 1}.` });
    }
    if (year < current - 1) {
      return res.status(400).json({ detail: `Only the most recent leave year (${current - 1}) can be closed` });
    }
    const outstanding = await db.collection('employees').countDocuments({
      status: { $ne: 'inactive' },
      employment_status: { $ne: 'exited' },
      leave_reset_year: { $ne: year + 1 }
    });
    if (yearEnd.currentMonth() > 1 && outstanding > 0 && !force) {
      return res.status(409).json({
        detail: `It is past January ${year + 1}: running now resets ${outstanding} employee balance(s) to the January opening plus carry-forward, discarding credits since then. Confirm with force to proceed.`,
        requires_force: true,
        outstanding
      });
    }
    const result = await yearEnd.runYearEnd(db, year, { by: req.user.email });
    res.json({ status: 'ok', ...result });
  } catch (error) {
    fail500('Year-end run')(error, res);
  }
});

/**
 * GET /api/v2/leave/year-end/runs (admin)
 */
router.get('/year-end/runs', requireRole(['admin']), async (req, res) => {
  try {
    const runs = await getDB().collection(yearEnd.RUNS).find({}, { projection: { _id: 0 } }).sort({ started_at: -1 }).limit(50).toArray();
    res.json(runs);
  } catch (error) {
    fail500('Year-end runs')(error, res);
  }
});

/**
 * GET /api/v2/leave/year-end/logs?year= (admin) — per-employee carry / encash / lapse records.
 */
router.get('/year-end/logs', requireRole(['admin']), async (req, res) => {
  try {
    const year = yearQuery(req.query.year);
    const filter = year ? { year } : {};
    const logs = await getDB().collection(yearEnd.LOGS).find(filter, { projection: { _id: 0 } }).sort({ year: -1, employee_name: 1 }).limit(5000).toArray();
    res.json(logs);
  } catch (error) {
    fail500('Year-end logs')(error, res);
  }
});

/**
 * GET /api/v2/leave/encashments?year=&status= (admin)
 */
router.get('/encashments', requireRole(['admin']), async (req, res) => {
  try {
    const filter = {};
    const year = yearQuery(req.query.year);
    if (year) filter.year = year;
    if (['pending', 'paid'].includes(req.query.status)) filter.status = req.query.status;
    const rows = await getDB().collection(yearEnd.ENCASHMENTS).find(filter, { projection: { _id: 0 } }).sort({ year: -1, employee_name: 1 }).limit(5000).toArray();
    res.json(rows);
  } catch (error) {
    fail500('List encashments')(error, res);
  }
});

/**
 * GET /api/v2/leave/encashments/my
 */
router.get('/encashments/my', async (req, res) => {
  try {
    const rows = await getDB().collection(yearEnd.ENCASHMENTS)
      .find({ employee_email: req.user.email }, { projection: { _id: 0, basic_salary: 0 } })
      .sort({ year: -1 })
      .toArray();
    res.json(rows);
  } catch (error) {
    fail500('My encashments')(error, res);
  }
});

module.exports = router;
