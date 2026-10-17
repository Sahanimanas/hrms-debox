/**
 * Multi-level leave approvals and delegation (LV-4).
 *
 * Each new leave gets an `approval_chain` built from the approval settings
 * (default: reporting manager → HR/admin, which is exactly the original
 * pending → manager_approved → approved flow). The leave's `status` keeps the
 * original meaning so existing screens and reports keep working:
 *   pending           — no level approved yet
 *   manager_approved  — at least one level approved, more to go (balance already deducted)
 *   approved          — every level approved
 *   rejected          — rejected at any level
 *
 * Leaves created before chains existed get an equivalent chain synthesised on
 * the fly (legacyChain) so they can still be acted on.
 *
 * Delegation: an approver hands their approvals to another manager/admin for a
 * date range; the delegate sees and acts on them and the action records
 * "on behalf of".
 */

const Joi = require('joi');
const { createNotification, NotificationType } = require('../notificationService');
const { resolveManager, listAdmins, todayKey, findEmployeeByEmail } = require('./common');

const SETTINGS_COLLECTION = 'leave_settings';
const SETTINGS_ID = 'approval_chain';
const DELEGATIONS = 'leave_delegations';

const DEFAULT_APPROVAL_SETTINGS = {
  steps: [
    { name: 'Reporting manager', approver_type: 'manager', approver_email: null, min_days: 0 },
    { name: 'HR / Admin', approver_type: 'admin', approver_email: null, min_days: 0 }
  ],
  // An admin's approval completes every remaining level (the original behaviour)
  admin_override: true
};

const approvalSettingsSchema = Joi.object({
  steps: Joi.array().items(Joi.object({
    name: Joi.string().trim().min(1).max(60).required(),
    approver_type: Joi.string().valid('manager', 'admin', 'user').required(),
    approver_email: Joi.when('approver_type', {
      is: 'user',
      then: Joi.string().trim().lowercase().email().required(),
      otherwise: Joi.any().strip()
    }),
    // The level only applies when the leave is longer than this many days (0 = always)
    min_days: Joi.number().min(0).max(366).default(0)
  })).min(1).max(5).required(),
  admin_override: Joi.boolean().default(true)
});

const delegationSchema = Joi.object({
  delegate_email: Joi.string().trim().lowercase().email().required(),
  delegator_email: Joi.string().trim().lowercase().email(), // admin only: set up on someone's behalf
  start_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  end_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  reason: Joi.string().trim().max(300).allow('', null)
});

async function getApprovalSettings(db) {
  const doc = await db.collection(SETTINGS_COLLECTION).findOne({ id: SETTINGS_ID }, { projection: { _id: 0 } });
  if (!doc || !Array.isArray(doc.steps) || !doc.steps.length) {
    return { ...DEFAULT_APPROVAL_SETTINGS, steps: DEFAULT_APPROVAL_SETTINGS.steps.map(s => ({ ...s })), is_default: true };
  }
  return { admin_override: true, ...doc, is_default: false };
}

const emptyActor = () => ({
  acted_by_email: null,
  acted_by_name: null,
  on_behalf_of_email: null,
  on_behalf_of_name: null,
  acted_at: null,
  comments: null,
  via: null
});

/**
 * Build the approval chain for a new leave from the settings.
 */
async function buildChain(db, settings, employee, daysCount) {
  const chain = [];
  for (const step of settings.steps || []) {
    const minDays = Number(step.min_days) || 0;
    if (minDays > 0 && !(daysCount > minDays)) continue;

    const item = {
      level: chain.length + 1,
      name: step.name,
      approver_type: step.approver_type,
      approver_email: null,
      approver_name: null,
      min_days: minDays,
      status: 'pending',
      ...emptyActor()
    };

    if (step.approver_type === 'manager') {
      const manager = await resolveManager(db, employee);
      if (manager?.email && manager.email !== employee.email) {
        item.approver_email = manager.email;
        item.approver_name = manager.full_name || manager.email;
      } else {
        item.status = 'skipped';
        item.comments = 'No reporting manager assigned';
      }
    } else if (step.approver_type === 'user') {
      item.approver_email = step.approver_email;
      const person = await db.collection('users').findOne({ email: step.approver_email }, { projection: { _id: 0, full_name: 1, name: 1 } });
      item.approver_name = person?.full_name || person?.name || step.approver_email;
      if (step.approver_email === employee.email) {
        item.status = 'skipped';
        item.comments = 'Approver is the applicant';
      }
    }

    // The same person never approves two levels of one leave
    if (item.status === 'pending' && item.approver_email &&
      chain.some(s => s.status === 'pending' && s.approver_email === item.approver_email)) {
      item.status = 'skipped';
      item.comments = 'Same approver as an earlier level';
    }
    chain.push(item);
  }

  // Never auto-approve: make sure someone has to look at it
  if (!chain.some(s => s.status === 'pending')) {
    chain.push({
      level: chain.length + 1,
      name: 'HR / Admin',
      approver_type: 'admin',
      approver_email: null,
      approver_name: null,
      min_days: 0,
      status: 'pending',
      ...emptyActor()
    });
  }
  return chain;
}

/**
 * Chain equivalent to the original two-step flow, for leaves created before chains existed.
 */
function legacyChain(leave) {
  const approvals = leave.approvals || [];
  const managerApproval = approvals.find(a => a.approver_role === 'manager' && a.action === 'approve');
  const managerReject = approvals.find(a => a.approver_role === 'manager' && a.action === 'reject');
  const adminAction = [...approvals].reverse().find(a => a.approver_role === 'admin' && ['approve', 'reject'].includes(a.action));
  const actor = (a) => a ? {
    acted_by_email: a.approver_email || null,
    acted_by_name: a.approver_name || null,
    on_behalf_of_email: a.on_behalf_of_email || null,
    on_behalf_of_name: a.on_behalf_of_name || null,
    acted_at: a.timestamp ? new Date(a.timestamp).toISOString() : null,
    comments: a.comments || null,
    via: 'direct'
  } : emptyActor();

  const manager = {
    level: 1,
    name: 'Reporting manager',
    approver_type: 'manager',
    approver_email: leave.manager_email || null,
    approver_name: null,
    min_days: 0,
    status: 'pending',
    ...emptyActor()
  };
  const admin = {
    level: 2,
    name: 'HR / Admin',
    approver_type: 'admin',
    approver_email: null,
    approver_name: null,
    min_days: 0,
    status: 'pending',
    ...emptyActor()
  };

  if (managerApproval) Object.assign(manager, actor(managerApproval), { status: 'approved' });
  else if (managerReject) Object.assign(manager, actor(managerReject), { status: 'rejected' });
  else if (!leave.manager_email || leave.status !== 'pending') manager.status = 'skipped';

  if (leave.status === 'approved') Object.assign(admin, actor(adminAction), { status: 'approved' });
  else if (leave.status === 'rejected') {
    if (manager.status === 'rejected') admin.status = 'cancelled';
    else Object.assign(admin, actor(adminAction), { status: 'rejected' });
  }

  return [manager, admin];
}

const chainOf = (leave) => (Array.isArray(leave.approval_chain) && leave.approval_chain.length
  ? leave.approval_chain.map(s => ({ ...s }))
  : legacyChain(leave));

const currentStep = (chain) => chain.find(s => s.status === 'pending') || null;

/** Denormalised fields that make "what's waiting for me" a cheap query. */
function currentFields(chain) {
  const cur = currentStep(chain);
  return {
    current_level: cur ? cur.level : null,
    current_step_name: cur ? cur.name : null,
    current_approver_type: cur ? cur.approver_type : null,
    current_approver_email: cur ? cur.approver_email : null
  };
}

// ============= DELEGATION =============

async function activeDelegationsFor(db, delegateEmail, onKey = todayKey()) {
  return db.collection(DELEGATIONS).find({
    delegate_email: delegateEmail,
    status: 'active',
    start_date: { $lte: onKey },
    end_date: { $gte: onKey }
  }, { projection: { _id: 0 } }).toArray();
}

async function activeDelegatesOf(db, delegatorEmails, onKey = todayKey()) {
  if (!delegatorEmails.length) return [];
  return db.collection(DELEGATIONS).find({
    delegator_email: { $in: delegatorEmails },
    status: 'active',
    start_date: { $lte: onKey },
    end_date: { $gte: onKey }
  }, { projection: { _id: 0 } }).toArray();
}

const delegationMatchesStep = (d, step) =>
  (step.approver_email && d.delegator_email === step.approver_email) ||
  (step.approver_type === 'admin' && d.delegator_role === 'admin');

/** How `user` may act on the step: 'direct', a delegation, or admin override. */
function resolveAuthority({ user, step, delegations, settings, leave }) {
  if (step.approver_type === 'admin' && user.role === 'admin') return { mode: 'direct' };
  if (step.approver_email && step.approver_email === user.email) return { mode: 'direct' };
  const delegation = delegations.find(d => delegationMatchesStep(d, step) && d.delegator_email !== leave.employee_email);
  if (delegation) return { mode: 'delegate', delegation };
  if (user.role === 'admin' && settings.admin_override !== false) return { mode: 'override' };
  return null;
}

class ApprovalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Work out the result of an approve/reject by `user` on `leave`.
 * Pure apart from the delegation lookup; the caller persists the result.
 */
async function decideAction(db, { leave, user, actorName, action, comments, settings }) {
  if (!['pending', 'manager_approved'].includes(leave.status)) {
    throw new ApprovalError(400, 'Leave already processed');
  }
  // Nobody approves their own leave, admins included (same rule as profile change
  // requests). An admin may still reject (withdraw) their own.
  if (leave.employee_email === user.email && (action === 'approve' || user.role !== 'admin')) {
    throw new ApprovalError(403, action === 'approve'
      ? 'You cannot approve your own leave; another approver must act on it'
      : 'You cannot approve or reject your own leave');
  }

  const chain = chainOf(leave);
  const step = currentStep(chain);
  if (!step) throw new ApprovalError(400, 'Leave already processed');

  const delegations = ['admin', 'manager'].includes(user.role) ? await activeDelegationsFor(db, user.email) : [];
  const authority = resolveAuthority({ user, step, delegations, settings, leave });
  if (!authority) {
    throw new ApprovalError(403, step.approver_type === 'manager'
      ? 'Not your team member'
      : 'You are not an approver for the current level of this leave');
  }

  const finalizesAll = action === 'approve' && user.role === 'admin' && settings.admin_override !== false;
  const onBehalf = authority.delegation || null;

  if (action === 'approve' && !finalizesAll) {
    const who = new Set([user.email, onBehalf?.delegator_email].filter(Boolean));
    const earlier = chain.find(s => s.status === 'approved' && (who.has(s.acted_by_email) || who.has(s.on_behalf_of_email)));
    if (earlier) {
      throw new ApprovalError(400, `You already approved level ${earlier.level} (${earlier.name}); a different approver must approve this level`);
    }
  }

  const now = new Date().toISOString();
  const actor = {
    acted_by_email: user.email,
    acted_by_name: actorName,
    on_behalf_of_email: onBehalf?.delegator_email || null,
    on_behalf_of_name: onBehalf?.delegator_name || null,
    acted_at: now,
    comments: comments || null,
    via: authority.mode
  };

  let newStatus;
  if (action === 'reject') {
    Object.assign(step, actor, { status: 'rejected' });
    chain.filter(s => s.status === 'pending').forEach(s => { s.status = 'cancelled'; });
    newStatus = 'rejected';
  } else {
    Object.assign(step, actor, { status: 'approved' });
    if (finalizesAll) {
      chain.filter(s => s.status === 'pending').forEach(s => Object.assign(s, {
        ...actor,
        status: 'approved',
        via: 'override',
        comments: 'Completed by admin approval'
      }));
    }
    newStatus = currentStep(chain) ? 'manager_approved' : 'approved';
  }

  const approvalRecord = {
    approver_email: user.email,
    approver_name: actorName,
    approver_role: user.role,
    action,
    comments: comments || null,
    timestamp: now,
    level: step.level,
    step_name: step.name,
    on_behalf_of_email: actor.on_behalf_of_email,
    on_behalf_of_name: actor.on_behalf_of_name
  };

  return { chain, step, newStatus, next: currentStep(chain), approvalRecord, onBehalf, mode: authority.mode };
}

/**
 * Leaves waiting for this manager/admin (directly or as a delegate).
 */
async function pendingQueryFor(db, user) {
  const base = { status: { $in: ['pending', 'manager_approved'] } };
  if (user.role === 'admin') return base;

  const delegations = await activeDelegationsFor(db, user.email);
  const emails = [user.email, ...delegations.map(d => d.delegator_email)];
  const or = [
    { current_approver_email: { $in: emails } },
    { approval_chain: { $exists: false }, manager_email: { $in: emails }, status: 'pending' }
  ];
  if (delegations.some(d => d.delegator_role === 'admin')) {
    or.push({ current_approver_type: 'admin' });
    or.push({ approval_chain: { $exists: false }, status: 'manager_approved' });
  }
  return { ...base, employee_email: { $ne: user.email }, $or: or };
}

/** Add chain + "can I act / on whose behalf" hints to a leave for the approvals screen. */
function decorateForApprover(leave, user, delegations, settings) {
  const chain = chainOf(leave);
  const step = currentStep(chain);
  let authority = null;
  const isOwn = leave.employee_email === user.email;
  if (step && ['pending', 'manager_approved'].includes(leave.status) && !isOwn) {
    authority = resolveAuthority({ user, step, delegations, settings, leave });
  }
  return {
    ...leave,
    approval_chain: chain,
    ...currentFields(chain),
    can_act: !!authority,
    is_own: isOwn,
    acting_as: authority?.mode || null,
    on_behalf_of: authority?.delegation ? { email: authority.delegation.delegator_email, name: authority.delegation.delegator_name } : null
  };
}

/**
 * Notify whoever has to act on `step` (and their active delegates).
 */
async function notifyApprovers(db, leave, step, { title, message }) {
  if (!step) return;
  const recipients = new Map();
  let delegatorEmails = [];
  if (step.approver_type === 'admin') {
    const admins = await listAdmins(db);
    admins.forEach(a => recipients.set(a.email, a));
    delegatorEmails = admins.map(a => a.email);
  } else if (step.approver_email) {
    const person = await findEmployeeByEmail(db, step.approver_email);
    recipients.set(step.approver_email, { id: person?.id, email: step.approver_email });
    delegatorEmails = [step.approver_email];
  }
  const delegates = await activeDelegatesOf(db, delegatorEmails);
  for (const d of delegates) {
    if (!recipients.has(d.delegate_email)) {
      const person = await findEmployeeByEmail(db, d.delegate_email);
      recipients.set(d.delegate_email, { id: person?.id, email: d.delegate_email, on_behalf_of: d.delegator_name });
    }
  }
  recipients.delete(leave.employee_email);

  for (const r of recipients.values()) {
    await createNotification({
      userId: r.id,
      userEmail: r.email,
      type: NotificationType.LEAVE_APPLIED,
      title,
      message: r.on_behalf_of ? `${message} (on behalf of ${r.on_behalf_of})` : message,
      actionUrl: '/approvals',
      metadata: { leave_id: leave.id, employee_name: leave.employee_name, level: step.level }
    });
  }
}

module.exports = {
  SETTINGS_COLLECTION,
  SETTINGS_ID,
  DELEGATIONS,
  DEFAULT_APPROVAL_SETTINGS,
  approvalSettingsSchema,
  delegationSchema,
  getApprovalSettings,
  buildChain,
  legacyChain,
  chainOf,
  currentStep,
  currentFields,
  activeDelegationsFor,
  activeDelegatesOf,
  decideAction,
  pendingQueryFor,
  decorateForApprover,
  notifyApprovers,
  ApprovalError
};
