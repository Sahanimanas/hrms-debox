/**
 * EL-1 Onboarding checklists: templates, starting a checklist for an
 * employee, assignee resolution and progress.
 */

const {
  generateUUID, uidOf, toDateStr, addDaysStr, todayStr, getSettings, admins, notifyMany
} = require('./common');

const TASK_OWNERS = ['hr', 'manager', 'employee', 'it'];

const OWNER_LABELS = { hr: 'HR', manager: 'Manager', employee: 'Employee', it: 'IT' };

const DEFAULT_TEMPLATE_TASKS = [
  { title: 'Send welcome email and first-day schedule', owner: 'hr', due_offset_days: -2, description: 'Share reporting time, location and who to meet on day one.' },
  { title: 'Prepare laptop and peripherals', owner: 'it', due_offset_days: -1, description: 'Image the laptop and keep it ready with charger, mouse and headset.' },
  { title: 'Create email, chat and tool accounts', owner: 'it', due_offset_days: 0, description: 'Company email, chat workspace, code / document tools as per role.' },
  { title: 'Submit ID proof, address proof and education documents', owner: 'employee', due_offset_days: 0, description: 'Upload them in My Documents.' },
  { title: 'Sign appointment letter and company policies', owner: 'employee', due_offset_days: 1 },
  { title: 'Share bank account and PAN for payroll', owner: 'employee', due_offset_days: 2 },
  { title: 'Collect signed documents and verify', owner: 'hr', due_offset_days: 3 },
  { title: 'Team introduction and buddy assignment', owner: 'manager', due_offset_days: 0 },
  { title: 'Set 30-60-90 day goals', owner: 'manager', due_offset_days: 7 },
  { title: 'Probation check-in after the first month', owner: 'manager', due_offset_days: 30 }
];

const withTaskIds = (tasks) => tasks.map(t => ({
  id: t.id || generateUUID(),
  title: t.title,
  description: t.description || '',
  owner: t.owner,
  due_offset_days: Number(t.due_offset_days) || 0
}));

/** Make sure at least one template exists; returns the default one. */
const ensureDefaultTemplate = async (db) => {
  const col = db.collection('onboarding_templates');
  let def = await col.findOne({ is_default: true }, { projection: { _id: 0 } });
  if (def) return def;
  const any = await col.findOne({}, { projection: { _id: 0 }, sort: { created_at: 1 } });
  if (any) {
    await col.updateOne({ id: any.id }, { $set: { is_default: true } });
    return { ...any, is_default: true };
  }
  const now = new Date();
  def = {
    id: generateUUID(),
    name: 'Standard onboarding',
    description: 'Default checklist for new joiners',
    is_default: true,
    tasks: withTaskIds(DEFAULT_TEMPLATE_TASKS),
    created_by: 'system',
    created_at: now,
    updated_at: now
  };
  try {
    await col.insertOne(def);
  } catch (error) {
    // Lost a race with another request — read whatever is there now
    return col.findOne({ is_default: true }, { projection: { _id: 0 } });
  }
  delete def._id;
  return def;
};

/** Decide who does a task based on its owner type. */
const resolveAssignees = async (db, employee, actor) => {
  const settings = await getSettings(db);
  const adminList = await admins(db);
  const fallbackAdmin = (actor?.role === 'admin' ? actor.email : null) || adminList[0]?.email || null;
  const lookup = async (email) => {
    if (!email) return null;
    const e = await db.collection('employees').findOne({ email }, { projection: { email: 1, full_name: 1 } });
    return e ? { email: e.email, name: e.full_name } : { email, name: email };
  };
  const hr = await lookup(settings.hr_email || fallbackAdmin);
  const it = await lookup(settings.it_email || settings.hr_email || fallbackAdmin);
  const manager = await lookup(employee.manager_email || null) || hr;
  return {
    hr,
    it,
    manager,
    employee: { email: employee.email, name: employee.full_name }
  };
};

const progressOf = (tasks) => {
  if (!tasks?.length) return 0;
  return Math.round((tasks.filter(t => t.done).length / tasks.length) * 100);
};

/**
 * Start onboarding for an employee. Returns { checklist } or { error, status }.
 * One active (in-progress) checklist per employee.
 */
const startOnboarding = async (db, employee, actor, { templateId = null, notify = true } = {}) => {
  const uid = uidOf(employee);
  const existing = await db.collection('onboarding_checklists').findOne({ employee_uid: uid, status: 'in_progress' });
  if (existing) return { error: 'Onboarding is already in progress for this employee', status: 409 };

  let template;
  if (templateId) {
    template = await db.collection('onboarding_templates').findOne({ id: templateId }, { projection: { _id: 0 } });
    if (!template) return { error: 'Template not found', status: 404 };
  } else {
    template = await ensureDefaultTemplate(db);
  }

  const joining = toDateStr(employee.joining_date) || todayStr();
  const people = await resolveAssignees(db, employee, actor);
  const tasks = (template.tasks || []).map(t => {
    const who = people[t.owner] || people.hr || people.employee;
    return {
      id: generateUUID(),
      title: t.title,
      description: t.description || '',
      owner: t.owner,
      assignee_email: who?.email || null,
      assignee_name: who?.name || null,
      due_date: addDaysStr(joining, Number(t.due_offset_days) || 0),
      done: false,
      done_at: null,
      done_by: null,
      notes: ''
    };
  });

  const now = new Date();
  const checklist = {
    id: generateUUID(),
    employee_uid: uid,
    employee_id: employee.id || null,
    employee_email: employee.email,
    employee_name: employee.full_name,
    department: employee.department || null,
    designation: employee.designation || null,
    manager_email: employee.manager_email || null,
    joining_date: joining,
    template_id: template.id,
    template_name: template.name,
    status: tasks.length ? 'in_progress' : 'completed',
    tasks,
    progress: tasks.length ? 0 : 100,
    started_by: actor?.email || 'system',
    created_at: now,
    updated_at: now,
    completed_at: tasks.length ? null : now
  };
  await db.collection('onboarding_checklists').insertOne(checklist);
  delete checklist._id;

  if (notify) {
    const byAssignee = new Map();
    for (const t of tasks) {
      if (!t.assignee_email) continue;
      byAssignee.set(t.assignee_email, (byAssignee.get(t.assignee_email) || 0) + 1);
    }
    for (const [email, count] of byAssignee) {
      const self = email === employee.email;
      notifyMany(db, [email], {
        type: 'onboarding_task_assigned',
        title: self ? 'Welcome! Your onboarding checklist is ready' : `Onboarding tasks for ${employee.full_name}`,
        message: self
          ? `You have ${count} onboarding task${count === 1 ? '' : 's'} to complete.`
          : `You have ${count} onboarding task${count === 1 ? '' : 's'} for ${employee.full_name} (joining ${joining}).`,
        actionUrl: self ? '/my-onboarding' : '/my-onboarding?tab=assigned',
        metadata: { checklist_id: checklist.id, employee_uid: uid }
      });
    }
  }

  return { checklist };
};

module.exports = {
  TASK_OWNERS,
  OWNER_LABELS,
  DEFAULT_TEMPLATE_TASKS,
  withTaskIds,
  ensureDefaultTemplate,
  resolveAssignees,
  progressOf,
  startOnboarding
};
