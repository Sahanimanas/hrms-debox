/**
 * Custom roles and permissions (PL-5).
 *
 * Every user still has a built-in role (admin | manager | employee) in
 * users.role, so existing requireRole([...]) checks keep working. A custom
 * role ({ id, name, base_role, permissions[] } in `custom_roles`) is assigned
 * through users.custom_role_id; assigning it also sets users.role to the
 * role's base_role.
 *
 * Effective permissions = defaults of the built-in role ∪ the custom role's
 * permissions. Admins implicitly hold every permission.
 */

const { getDB } = require('../../config/database');

const PERMISSIONS = [
  { key: 'employees.view', label: 'View employees', group: 'People' },
  { key: 'employees.edit', label: 'Edit employees', group: 'People' },
  { key: 'attendance.manage', label: 'Manage attendance', group: 'Time & Attendance' },
  { key: 'leave.approve', label: 'Approve leave', group: 'Leave' },
  { key: 'payroll.view', label: 'View payroll', group: 'Payroll' },
  { key: 'payroll.run', label: 'Run payroll', group: 'Payroll' },
  { key: 'recruitment.manage', label: 'Manage recruitment', group: 'Recruitment' },
  { key: 'assets.manage', label: 'Manage assets', group: 'Assets & Expenses' },
  { key: 'expenses.approve', label: 'Approve expenses', group: 'Assets & Expenses' },
  { key: 'performance.manage', label: 'Manage performance reviews', group: 'Performance' },
  { key: 'engagement.manage', label: 'Manage announcements & surveys', group: 'Engagement' },
  { key: 'reports.view', label: 'View reports & analytics', group: 'Insights' },
  { key: 'settings.manage', label: 'Manage settings', group: 'Administration' },
  { key: 'audit.view', label: 'View audit log', group: 'Administration' },
  { key: 'integrations.manage', label: 'Manage integrations', group: 'Administration' }
];

const PERMISSION_KEYS = PERMISSIONS.map(p => p.key);
const BASE_ROLES = ['employee', 'manager', 'admin'];

const ROLE_DEFAULTS = {
  admin: PERMISSION_KEYS,
  manager: ['employees.view', 'attendance.manage', 'leave.approve', 'reports.view'],
  employee: []
};

/** Effective permission list for a user document / req.user ({ role, custom_role_id }). */
async function getEffectivePermissions(user, db = getDB()) {
  if (!user) return [];
  if (user.role === 'admin') return [...PERMISSION_KEYS];
  const perms = new Set(ROLE_DEFAULTS[user.role] || []);
  let customRole = null;
  if (user.custom_role_id && db) {
    customRole = await db.collection('custom_roles').findOne({ id: user.custom_role_id }, { projection: { _id: 0 } });
    for (const p of customRole?.permissions || []) if (PERMISSION_KEYS.includes(p)) perms.add(p);
  }
  return PERMISSION_KEYS.filter(p => perms.has(p));
}

/** Does the user hold this permission? Admins always do. */
async function hasPermission(user, permission, db = getDB()) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = await getEffectivePermissions(user, db);
  return perms.includes(permission);
}

/**
 * Express middleware: allow the request if the user holds ANY of the given
 * permissions (admins always pass). Use after authenticate.
 */
const requirePermission = (...required) => {
  const wanted = required.flat();
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ detail: 'Not authenticated' });
      if (req.user.role === 'admin') return next();
      if (!req.permissions) req.permissions = await getEffectivePermissions(req.user);
      if (wanted.some(p => req.permissions.includes(p))) return next();
      return res.status(403).json({ detail: 'Not enough permissions' });
    } catch (error) {
      console.error('[permissions] check failed:', error);
      return res.status(500).json({ detail: 'Internal server error' });
    }
  };
};

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  BASE_ROLES,
  ROLE_DEFAULTS,
  getEffectivePermissions,
  hasPermission,
  requirePermission
};
