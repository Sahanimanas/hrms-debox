/**
 * EL-9 Org chart data, plus a per-employee lifecycle overview.
 */

const { getDB } = require('../../../config/database');
const {
  serverError, findEmployeeByUid, relationTo, employeeCard, toDateStr, uidOf
} = require('../common');
const { progressOf } = require('../onboarding');

// Manager reference fields, in order of preference. The app writes manager_email;
// seed.js and older imports reference the manager's _id / id / code instead.
const MANAGER_REF_FIELDS = ['manager_id', 'reporting_manager_id', 'reporting_manager', 'manager_uid', 'manager_employee_id'];

const keyOf = (v) => (v == null || v === '' ? null : String(v).trim().toLowerCase() || null);

/**
 * Resolve each person's manager: manager_email first (case-insensitive), then
 * any id-style reference matched against _id, uuid id, employee_id or code.
 * Self-references resolve to no manager.
 */
const resolveManagers = (people) => {
  const byEmail = new Map();
  const byId = new Map();
  for (const p of people) {
    const email = keyOf(p.email);
    if (email && !byEmail.has(email)) byEmail.set(email, p);
    for (const k of [p._id, p.id, p.employee_id, p.employee_code]) {
      const key = keyOf(k);
      if (key && !byId.has(key)) byId.set(key, p);
    }
  }
  return people.map(p => {
    const candidates = [byEmail.get(keyOf(p.manager_email))];
    for (const field of MANAGER_REF_FIELDS) {
      const ref = p[field];
      const key = keyOf(ref && typeof ref === 'object' && !ref.toHexString ? (ref.email || ref.id || ref._id) : ref);
      if (key) candidates.push(byId.get(key) || byEmail.get(key));
    }
    return candidates.find(m => m && m !== p) || null;
  });
};

module.exports = (router) => {
  /**
   * GET /org-chart — directory fields for everyone (no salary / personal data).
   * Exited employees are hidden unless ?include_exited=1 (admin only).
   * Each person gets `manager_uid` (null for roots: no manager, or the manager no longer exists),
 * resolved from manager_email or an id-style manager reference (see resolveManagers).
   */
  router.get('/org-chart', async (req, res) => {
    try {
      const db = getDB();
      const includeExited = req.user.role === 'admin' && ['1', 'true'].includes(String(req.query.include_exited));
      const query = includeExited ? {} : { employment_status: { $ne: 'exited' } };
      const people = await db.collection('employees').find(query, {
        projection: { _id: 1, id: 1, employee_id: 1, employee_code: 1, full_name: 1, email: 1, department: 1, designation: 1, role: 1, manager_email: 1, manager_name: 1, joining_date: 1, employment_status: 1, profile_picture_url: 1, ...Object.fromEntries(MANAGER_REF_FIELDS.map(f => [f, 1])) }
      }).toArray();
      const managers = resolveManagers(people);
      const nodes = people.map((p, i) => {
        const card = employeeCard(p);
        const manager = managers[i];
        return { ...card, joining_date: toDateStr(p.joining_date), manager_uid: manager ? uidOf(manager) : null };
      });
      // Break cycles (A reports to B reports to A): the first node seen in a cycle becomes a root
      const byUid = new Map(nodes.map(n => [n.uid, n]));
      for (const n of nodes) {
        const seen = new Set([n.uid]);
        let cur = n;
        while (cur.manager_uid) {
          if (seen.has(cur.manager_uid)) { cur.manager_uid = null; break; }
          seen.add(cur.manager_uid);
          cur = byUid.get(cur.manager_uid);
          if (!cur) break;
        }
      }
      const reports = new Map();
      nodes.forEach(n => { if (n.manager_uid) reports.set(n.manager_uid, (reports.get(n.manager_uid) || 0) + 1); });
      res.json(nodes.map(n => ({ ...n, direct_reports: reports.get(n.uid) || 0 })));
    } catch (error) {
      serverError(res, 'org chart', error);
    }
  });

  /** GET /people/:uid/overview — lifecycle overview for one employee (self, manager, admin). */
  router.get('/people/:uid/overview', async (req, res) => {
    try {
      const db = getDB();
      const employee = await findEmployeeByUid(db, req.params.uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      const rel = await relationTo(db, req.user, employee);
      if (!rel) return res.status(403).json({ detail: 'Not enough permissions' });
      const [onboarding, separation, docCount] = await Promise.all([
        db.collection('onboarding_checklists').findOne({ employee_email: employee.email, status: { $ne: 'cancelled' } }, { projection: { _id: 0 }, sort: { created_at: -1 } }),
        db.collection('separations').findOne({ employee_email: employee.email, status: { $in: ['pending', 'approved', 'completed'] } }, { projection: { _id: 0, id: 1, status: 1, type: 1, last_working_day: 1, requested_last_day: 1 }, sort: { created_at: -1 } }),
        rel === 'manager' ? null : db.collection('employee_documents').countDocuments({ employee_email: employee.email })
      ]);
      res.json({
        employee: {
          ...employeeCard(employee),
          joining_date: toDateStr(employee.joining_date),
          probation_end_date: toDateStr(employee.probation_end_date),
          confirmation_date: toDateStr(employee.confirmation_date),
          exit_date: toDateStr(employee.exit_date),
          exit_reason: rel === 'manager' ? undefined : employee.exit_reason || null
        },
        onboarding: onboarding ? { id: onboarding.id, status: onboarding.status, progress: progressOf(onboarding.tasks), total: onboarding.tasks.length } : null,
        separation: separation || null,
        documents: docCount
      });
    } catch (error) {
      serverError(res, 'people overview', error);
    }
  });
};
