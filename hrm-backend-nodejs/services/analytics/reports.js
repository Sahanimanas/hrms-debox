/**
 * AN-5 Custom report engine.
 *
 * Each dataset maps raw documents onto an explicit whitelist of safe fields
 * (no password hashes, tokens, bank details, IDs of uploaded files or
 * locations). Filters, grouping, aggregates, sorting and limits run on those
 * flattened rows only, so nothing outside the whitelist can ever be returned
 * or filtered on.
 */

const { employeeUid } = require('../../utils/helpers');
const { round, num, toDay, titleCase, HttpError, teamQuery } = require('./common');

const MAX_SCAN = 100000;

const S = (label) => ({ label, type: 'string' });
const N = (label) => ({ label, type: 'number' });
const D = (label) => ({ label, type: 'date' });
const B = (label) => ({ label, type: 'boolean' });

const isoOrNull = (v) => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d.toISOString();
};
const str = (v) => (v == null || v === '' ? null : String(v));
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const DATASETS = {
  employees: {
    label: 'Employees',
    description: 'One row per employee record',
    collection: 'employees',
    scopeField: 'email',
    fields: {
      employee_id: S('Employee ID'),
      full_name: S('Name'),
      email: S('Email'),
      phone: S('Phone'),
      role: S('Role'),
      department: S('Department'),
      designation: S('Designation'),
      organization: S('Organization'),
      manager_email: S('Manager email'),
      manager_name: S('Manager'),
      employment_status: S('Employment status'),
      gender: S('Gender'),
      joining_date: D('Joining date'),
      exit_date: D('Exit date'),
      exit_reason: S('Exit reason'),
      date_of_birth: D('Date of birth'),
      probation_end_date: D('Probation end date'),
      monthly_salary: N('Monthly salary'),
      casual_leave_balance: N('Casual leave balance'),
      sick_leave_balance: N('Sick leave balance'),
      earned_leave_balance: N('Earned leave balance'),
      comp_off_balance: N('Comp-off balance')
    },
    defaultFields: ['employee_id', 'full_name', 'department', 'designation', 'joining_date', 'employment_status'],
    projection: {
      _id: 1, id: 1, employee_id: 1, employee_code: 1, full_name: 1, email: 1, phone: 1, role: 1, department: 1,
      designation: 1, organization_name: 1, organization_id: 1, manager_email: 1, manager_name: 1,
      employment_status: 1, gender: 1, joining_date: 1, exit_date: 1, exit_reason: 1, date_of_birth: 1,
      probation_end_date: 1, monthly_salary: 1, leave_balance: 1, created_at: 1
    },
    row: (e) => ({
      employee_id: str(e.employee_id || e.employee_code),
      full_name: str(e.full_name),
      email: str(e.email),
      phone: str(e.phone),
      role: str(e.role),
      department: str(e.department),
      designation: str(e.designation),
      organization: str(e.organization_name || e.organization_id),
      manager_email: str(e.manager_email),
      manager_name: str(e.manager_name),
      employment_status: e.employment_status ? String(e.employment_status) : 'active',
      gender: str(e.gender),
      joining_date: toDay(e.joining_date) || toDay(e.created_at),
      exit_date: toDay(e.exit_date),
      exit_reason: str(e.exit_reason),
      date_of_birth: toDay(e.date_of_birth),
      probation_end_date: toDay(e.probation_end_date),
      monthly_salary: numOrNull(e.monthly_salary),
      casual_leave_balance: numOrNull(e.leave_balance?.casual_leave),
      sick_leave_balance: numOrNull(e.leave_balance?.sick_leave),
      earned_leave_balance: numOrNull(e.leave_balance?.earned_leave),
      comp_off_balance: numOrNull(e.leave_balance?.comp_off)
    })
  },

  leaves: {
    label: 'Leave requests',
    description: 'One row per leave application',
    collection: 'leaves',
    scopeField: 'employee_email',
    fields: {
      employee_name: S('Employee'),
      employee_email: S('Employee email'),
      department: S('Department'),
      leave_type: S('Leave type'),
      status: S('Status'),
      start_date: D('Start date'),
      end_date: D('End date'),
      days_count: N('Days'),
      is_half_day: B('Half day'),
      reason: S('Reason'),
      manager_email: S('Manager email'),
      applied_on: D('Applied on')
    },
    defaultFields: ['employee_name', 'leave_type', 'start_date', 'end_date', 'days_count', 'status'],
    projection: { _id: 0, employee_id: 1, employee_name: 1, employee_email: 1, leave_type: 1, status: 1, dates: 1, days_count: 1, is_half_day: 1, reason: 1, manager_email: 1, created_at: 1 },
    row: (l, ctx) => {
      const dates = (Array.isArray(l.dates) ? l.dates : []).map(toDay).filter(Boolean).sort();
      return {
        employee_name: str(l.employee_name),
        employee_email: str(l.employee_email),
        department: ctx.deptByEmail.get(l.employee_email) || null,
        leave_type: str(l.leave_type),
        status: str(l.status),
        start_date: dates[0] || null,
        end_date: dates[dates.length - 1] || null,
        days_count: numOrNull(l.days_count),
        is_half_day: !!l.is_half_day,
        reason: str(l.reason),
        manager_email: str(l.manager_email),
        applied_on: toDay(l.created_at)
      };
    }
  },

  attendance_logs: {
    label: 'Attendance punches',
    description: 'One row per employee per day with a clock-in',
    collection: 'attendance_logs',
    scopeField: 'employee_uid',
    scopeKey: 'uids',
    fields: {
      date: D('Date'),
      employee_uid: S('Employee ID'),
      employee_name: S('Employee'),
      email: S('Email'),
      department: S('Department'),
      shift: S('Shift'),
      clock_in: { label: 'Clock in', type: 'datetime' },
      clock_out: { label: 'Clock out', type: 'datetime' },
      status: S('Status'),
      work_mode: S('Work mode'),
      is_late: B('Late'),
      late_minutes: N('Late minutes'),
      early_exit_minutes: N('Early exit minutes'),
      worked_minutes: N('Worked minutes'),
      worked_hours: N('Worked hours'),
      overtime_minutes: N('Overtime minutes'),
      source: S('Source')
    },
    defaultFields: ['date', 'employee_name', 'department', 'clock_in', 'clock_out', 'worked_hours', 'late_minutes', 'status'],
    projection: { _id: 0, date: 1, employee_uid: 1, employee_name: 1, user_email: 1, department: 1, shift: 1, clock_in: 1, clock_out: 1, status: 1, work_mode: 1, is_late: 1, late_minutes: 1, early_exit_minutes: 1, worked_minutes: 1, overtime_minutes: 1, source: 1 },
    row: (l) => ({
      date: toDay(l.date),
      employee_uid: str(l.employee_uid),
      employee_name: str(l.employee_name),
      email: str(l.user_email),
      department: str(l.department),
      shift: str(l.shift?.name),
      clock_in: isoOrNull(l.clock_in),
      clock_out: isoOrNull(l.clock_out),
      status: str(l.status),
      work_mode: str(l.work_mode),
      is_late: l.is_late != null ? !!l.is_late : num(l.late_minutes) > 0,
      late_minutes: numOrNull(l.late_minutes),
      early_exit_minutes: numOrNull(l.early_exit_minutes),
      worked_minutes: numOrNull(l.worked_minutes),
      worked_hours: l.worked_minutes != null ? round(num(l.worked_minutes) / 60) : null,
      overtime_minutes: numOrNull(l.overtime_minutes),
      source: str(l.source)
    })
  },

  attendance: {
    label: 'Attendance grid',
    description: 'One row per employee per marked day from the monthly attendance grid',
    collection: 'attendance',
    scopeField: 'employee_id',
    scopeKey: 'uids',
    fields: {
      date: D('Date'),
      employee_id: S('Employee ID'),
      employee_name: S('Employee'),
      department: S('Department'),
      status: S('Status')
    },
    defaultFields: ['date', 'employee_id', 'employee_name', 'department', 'status'],
    projection: { _id: 0, employee_id: 1, month: 1, year: 1, attendance: 1 },
    // Expands one month document into one row per marked day
    rows: (g, ctx) => {
      const out = [];
      const y = Number(g.year), m = Number(g.month);
      if (!y || !m) return out;
      for (const [day, status] of Object.entries(g.attendance || {})) {
        const d = Number(day);
        if (!d) continue;
        out.push({
          date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          employee_id: str(g.employee_id),
          employee_name: ctx.nameByUid.get(g.employee_id) || null,
          department: ctx.deptByUid.get(g.employee_id) || null,
          status: str(status)
        });
      }
      return out;
    }
  },

  payslips: {
    label: 'Payslips',
    description: 'One row per payslip (admin only)',
    collection: 'payslips',
    adminOnly: true,
    fields: {
      month: S('Month'),
      employee_uid: S('Employee ID'),
      employee_name: S('Employee'),
      department: S('Department'),
      gross_earnings: N('Gross earnings (full rate)'),
      lop_amount: N('Loss of pay'),
      earned_gross: N('Earned gross (after LOP)'),
      total_deductions: N('Total deductions (incl. LOP)'),
      net_pay: N('Net pay'),
      lop_days: N('LOP days'),
      employer_pf: N('Employer PF'),
      employer_esi: N('Employer ESI'),
      employer_cost: N('Employer cost'),
      status: S('Status')
    },
    defaultFields: ['month', 'employee_name', 'department', 'earned_gross', 'total_deductions', 'net_pay'],
    projection: { _id: 0, month: 1, employee_uid: 1, employee_name: 1, department: 1, gross_earnings: 1, lop_amount: 1, total_deductions: 1, net_pay: 1, lop_days: 1, employer_contributions: 1, status: 1 },
    row: (p) => {
      const pf = num(p.employer_contributions?.pf);
      const esi = num(p.employer_contributions?.esi);
      const lop = num(p.lop_amount);
      return {
        month: str(p.month),
        employee_uid: str(p.employee_uid),
        employee_name: str(p.employee_name),
        department: str(p.department),
        gross_earnings: numOrNull(p.gross_earnings),
        lop_amount: lop,
        earned_gross: p.gross_earnings == null ? null : round(num(p.gross_earnings) - lop),
        total_deductions: numOrNull(p.total_deductions),
        net_pay: numOrNull(p.net_pay),
        lop_days: numOrNull(p.lop_days),
        employer_pf: pf,
        employer_esi: esi,
        employer_cost: round(num(p.gross_earnings) - lop + pf + esi),
        status: str(p.status)
      };
    }
  },

  reimbursements: {
    label: 'Reimbursements',
    description: 'One row per expense claim',
    collection: 'reimbursements',
    scopeField: 'employee_email',
    fields: {
      employee_id: S('Employee ID'),
      employee_name: S('Employee'),
      employee_email: S('Employee email'),
      department: S('Department'),
      title: S('Title'),
      category: S('Category'),
      amount: N('Amount'),
      status: S('Status'),
      expense_date: D('Expense date'),
      submitted_on: D('Submitted on'),
      processed_on: D('Processed on')
    },
    defaultFields: ['employee_name', 'category', 'title', 'amount', 'expense_date', 'status'],
    projection: { _id: 0, employee_id: 1, employee_name: 1, employee_email: 1, department: 1, title: 1, category: 1, amount: 1, status: 1, expense_date: 1, created_at: 1, processed_at: 1 },
    row: (r) => ({
      employee_id: str(r.employee_id),
      employee_name: str(r.employee_name),
      employee_email: str(r.employee_email),
      department: str(r.department),
      title: str(r.title),
      category: str(r.category),
      amount: numOrNull(r.amount),
      status: str(r.status),
      expense_date: toDay(r.expense_date),
      submitted_on: toDay(r.created_at),
      processed_on: toDay(r.processed_at)
    })
  },

  assets: {
    label: 'Assets',
    description: 'One row per asset in the register',
    collection: 'assets',
    scopeField: 'assigned_to_email',
    fields: {
      asset_tag: S('Asset tag'),
      name: S('Name'),
      category: S('Category'),
      status: S('Status'),
      assigned_to_email: S('Assigned to'),
      assigned_to_uid: S('Assignee employee ID'),
      serial_number: S('Serial number'),
      purchase_date: D('Purchase date'),
      purchase_cost: N('Purchase cost')
    },
    defaultFields: ['asset_tag', 'name', 'category', 'status', 'assigned_to_email'],
    projection: { _id: 0, asset_tag: 1, name: 1, category: 1, status: 1, assigned_to_email: 1, assigned_to_uid: 1, serial_number: 1, purchase_date: 1, purchase_cost: 1 },
    row: (a) => ({
      asset_tag: str(a.asset_tag),
      name: str(a.name),
      category: str(a.category),
      status: str(a.status),
      assigned_to_email: str(a.assigned_to_email),
      assigned_to_uid: str(a.assigned_to_uid),
      serial_number: str(a.serial_number),
      purchase_date: toDay(a.purchase_date),
      purchase_cost: numOrNull(a.purchase_cost)
    })
  }
};

const OPS_BY_TYPE = {
  string: ['equals', 'not_equals', 'contains', 'in', 'is_empty', 'not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'is_empty', 'not_empty'],
  date: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'between', 'is_empty', 'not_empty'],
  datetime: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'between', 'is_empty', 'not_empty'],
  boolean: ['equals', 'is_empty', 'not_empty']
};
const ALL_OPS = [...new Set(Object.values(OPS_BY_TYPE).flat())];
const AGG_FNS = ['count', 'sum', 'avg', 'min', 'max'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const datasetCatalog = (role) => Object.entries(DATASETS)
  .filter(([, d]) => role === 'admin' || !d.adminOnly)
  .map(([key, d]) => ({
    key,
    label: d.label,
    description: d.description,
    admin_only: !!d.adminOnly,
    default_fields: d.defaultFields,
    fields: Object.entries(d.fields).map(([k, f]) => ({ key: k, label: f.label, type: f.type, ops: OPS_BY_TYPE[f.type] }))
  }));

const aggAlias = (a) => (a.fn === 'count' ? 'count' : `${a.fn}_${a.field}`);
const aggLabel = (a, ds) => (a.fn === 'count' ? 'Count' : `${titleCase(a.fn === 'avg' ? 'average' : a.fn)} of ${ds.fields[a.field]?.label || a.field}`);

const coerceFilterValue = (type, op, value) => {
  const one = (v) => {
    if (type === 'number') {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, 'Filter value must be a number');
      return n;
    }
    if (type === 'date' || type === 'datetime') {
      if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, 'Date filter values must be YYYY-MM-DD');
      return v;
    }
    if (type === 'boolean') {
      if (v === true || v === 'true') return true;
      if (v === false || v === 'false') return false;
      throw new HttpError(400, 'Boolean filter value must be true or false');
    }
    if (v == null || typeof v === 'object') throw new HttpError(400, 'Filter value must be text');
    return String(v);
  };
  if (op === 'is_empty' || op === 'not_empty') return null;
  if (op === 'between') {
    if (!Array.isArray(value) || value.length !== 2) throw new HttpError(400, '"between" needs two values: [from, to]');
    const [a, b] = value.map(one);
    if (a > b) throw new HttpError(400, '"between" range is reversed');
    return [a, b];
  }
  if (op === 'in') {
    const list = Array.isArray(value) ? value : String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!list.length || list.length > 200) throw new HttpError(400, '"in" needs between 1 and 200 values');
    return list.map(one);
  }
  return one(value);
};

/**
 * Check a definition against the dataset whitelist and normalise it.
 * Throws HttpError(400) with a readable message.
 */
function compileDefinition(def) {
  const ds = DATASETS[def.dataset];
  if (!ds) throw new HttpError(400, `Unknown dataset "${def.dataset}"`);
  const fieldOf = (key, what) => {
    const f = ds.fields[key];
    if (!f) throw new HttpError(400, `${what} "${key}" is not available in ${ds.label}`);
    return f;
  };

  const groupBy = [...new Set(def.group_by || [])];
  groupBy.forEach(g => fieldOf(g, 'Group-by field'));
  let aggregates = def.aggregates || [];
  for (const a of aggregates) {
    if (a.fn === 'count') continue;
    if (!a.field) throw new HttpError(400, `"${a.fn}" needs a field`);
    const f = fieldOf(a.field, 'Aggregate field');
    if ((a.fn === 'sum' || a.fn === 'avg') && f.type !== 'number') throw new HttpError(400, `"${a.fn}" needs a number field; "${a.field}" is ${f.type}`);
    if ((a.fn === 'min' || a.fn === 'max') && !['number', 'date', 'datetime'].includes(f.type)) throw new HttpError(400, `"${a.fn}" needs a number or date field`);
  }
  aggregates = aggregates.map(a => (a.fn === 'count' ? { fn: 'count', field: null } : { fn: a.fn, field: a.field }));
  aggregates = aggregates.filter((a, i) => aggregates.findIndex(b => aggAlias(b) === aggAlias(a)) === i);
  const grouped = groupBy.length > 0 || aggregates.length > 0;
  if (groupBy.length && !aggregates.length) aggregates = [{ fn: 'count', field: null }];

  const fields = grouped ? [] : [...new Set(def.fields && def.fields.length ? def.fields : ds.defaultFields)];
  fields.forEach(f => fieldOf(f, 'Field'));

  const filters = (def.filters || []).map(f => {
    const field = fieldOf(f.field, 'Filter field');
    if (!OPS_BY_TYPE[field.type].includes(f.op)) throw new HttpError(400, `Operator "${f.op}" can't be used on ${field.type} field "${f.field}"`);
    return { field: f.field, op: f.op, type: field.type, value: coerceFilterValue(field.type, f.op, f.value) };
  });

  const columns = grouped
    ? [
      ...groupBy.map(g => ({ key: g, label: ds.fields[g].label, type: ds.fields[g].type })),
      ...aggregates.map(a => ({ key: aggAlias(a), label: aggLabel(a, ds), type: a.fn === 'count' ? 'number' : (a.fn === 'min' || a.fn === 'max' ? ds.fields[a.field].type : 'number') }))
    ]
    : fields.map(f => ({ key: f, label: ds.fields[f].label, type: ds.fields[f].type }));

  const sort = (def.sort || []).map(s => {
    if (!columns.some(c => c.key === s.field)) throw new HttpError(400, `Sort field "${s.field}" must be one of the report's columns`);
    return { field: s.field, direction: s.direction === 'desc' ? 'desc' : 'asc' };
  });

  const limit = Math.min(Math.max(parseInt(def.limit, 10) || 1000, 1), 10000);
  return { dataset: def.dataset, ds, fields, filters, groupBy, aggregates, grouped, columns, sort, limit };
}

const dayOf = (v, type) => (v == null ? null : type === 'datetime' ? toDay(v) : v);

const matches = (row, f) => {
  const raw = row[f.field];
  const empty = raw == null || raw === '';
  if (f.op === 'is_empty') return empty;
  if (f.op === 'not_empty') return !empty;
  if (empty) return f.op === 'not_equals';
  switch (f.type) {
    case 'string': {
      const v = String(raw).toLowerCase();
      if (f.op === 'equals') return v === f.value.toLowerCase();
      if (f.op === 'not_equals') return v !== f.value.toLowerCase();
      if (f.op === 'contains') return v.includes(f.value.toLowerCase());
      if (f.op === 'in') return f.value.some(x => x.toLowerCase() === v);
      return false;
    }
    case 'number': {
      const v = Number(raw);
      switch (f.op) {
        case 'equals': return v === f.value;
        case 'not_equals': return v !== f.value;
        case 'gt': return v > f.value;
        case 'gte': return v >= f.value;
        case 'lt': return v < f.value;
        case 'lte': return v <= f.value;
        case 'between': return v >= f.value[0] && v <= f.value[1];
        case 'in': return f.value.includes(v);
        default: return false;
      }
    }
    case 'date':
    case 'datetime': {
      const v = dayOf(raw, f.type);
      if (!v) return false;
      switch (f.op) {
        case 'equals': return v === f.value;
        case 'before': return v < f.value;
        case 'after': return v > f.value;
        case 'on_or_before': return v <= f.value;
        case 'on_or_after': return v >= f.value;
        case 'between': return v >= f.value[0] && v <= f.value[1];
        default: return false;
      }
    }
    case 'boolean':
      return f.op === 'equals' && !!raw === f.value;
    default:
      return false;
  }
};

const compare = (a, b) => {
  const ae = a == null || a === '';
  const be = b == null || b === '';
  if (ae && be) return 0;
  if (ae) return 1; // empties last
  if (be) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a === b) ? 0 : a ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * Who the report runs as. Admin: everything. Manager: their team only, and
 * admin-only datasets are refused.
 */
async function buildScope(db, user, dataset) {
  const ds = DATASETS[dataset];
  if (user.role === 'admin') return null;
  if (user.role !== 'manager') throw new HttpError(403, 'Not enough permissions');
  if (ds.adminOnly) throw new HttpError(403, `${ds.label} reports are available to admins only`);
  const me = await db.collection('employees').findOne({ email: user.email }, { projection: { email: 1, department: 1 } });
  if (!me) return { emails: [], uids: [] };
  const team = await db.collection('employees').find(teamQuery(me), { projection: { _id: 1, email: 1, employee_id: 1, employee_code: 1, id: 1 } }).toArray();
  return { emails: team.map(t => t.email).filter(Boolean), uids: team.map(employeeUid).filter(Boolean) };
}

async function loadRows(db, compiled, scope) {
  const { ds } = compiled;
  const query = {};
  if (scope) {
    const values = ds.scopeKey === 'uids' ? scope.uids : scope.emails;
    query[ds.scopeField] = { $in: values };
  }
  const docs = await db.collection(ds.collection).find(query, { projection: ds.projection }).limit(MAX_SCAN).toArray();

  // Lookups for datasets that join employee details
  const ctx = { deptByEmail: new Map(), deptByUid: new Map(), nameByUid: new Map() };
  if (compiled.dataset === 'leaves' || compiled.dataset === 'attendance') {
      const emps = await db.collection('employees').find({}, { projection: { _id: 1, id: 1, employee_id: 1, employee_code: 1, email: 1, full_name: 1, department: 1 } }).toArray();
    for (const e of emps) {
      ctx.deptByEmail.set(e.email, e.department || null);
      const uid = employeeUid(e);
      ctx.deptByUid.set(uid, e.department || null);
      ctx.nameByUid.set(uid, e.full_name || null);
    }
  }
  return ds.rows ? docs.flatMap(d => ds.rows(d, ctx)) : docs.map(d => ds.row(d, ctx));
}

function aggregate(rows, compiled) {
  const groups = new Map();
  for (const r of rows) {
    const key = JSON.stringify(compiled.groupBy.map(g => r[g] ?? null));
    if (!groups.has(key)) groups.set(key, { keyVals: compiled.groupBy.map(g => r[g] ?? null), rows: [] });
    groups.get(key).rows.push(r);
  }
  if (!compiled.groupBy.length && !groups.size) groups.set('[]', { keyVals: [], rows: [] });
  return [...groups.values()].map(g => {
    const out = {};
    compiled.groupBy.forEach((f, i) => { out[f] = g.keyVals[i]; });
    for (const a of compiled.aggregates) {
      const alias = aggAlias(a);
      if (a.fn === 'count') { out[alias] = g.rows.length; continue; }
      const vals = g.rows.map(r => r[a.field]).filter(v => v != null && v !== '');
      if (a.fn === 'sum') out[alias] = round(vals.reduce((s, v) => s + Number(v), 0));
      else if (a.fn === 'avg') out[alias] = vals.length ? round(vals.reduce((s, v) => s + Number(v), 0) / vals.length) : null;
      else {
        const sorted = [...vals].sort(compare);
        out[alias] = sorted.length ? (a.fn === 'min' ? sorted[0] : sorted[sorted.length - 1]) : null;
      }
    }
    return out;
  });
}

/**
 * Run a report definition for a user. Returns { columns, rows, total_rows, truncated }.
 */
async function runReport(db, definition, user) {
  const compiled = compileDefinition(definition);
  const scope = await buildScope(db, user, compiled.dataset);
  let rows = await loadRows(db, compiled, scope);
  for (const f of compiled.filters) rows = rows.filter(r => matches(r, f));

  if (compiled.grouped) {
    rows = aggregate(rows, compiled);
  } else {
    rows = rows.map(r => Object.fromEntries(compiled.fields.map(f => [f, r[f] ?? null])));
  }

  const sort = compiled.sort.length
    ? compiled.sort
    : compiled.grouped && compiled.groupBy.length ? compiled.groupBy.map(g => ({ field: g, direction: 'asc' })) : [];
  if (sort.length) {
    rows.sort((a, b) => {
      for (const s of sort) {
        const c = compare(a[s.field], b[s.field]);
        if (c !== 0) {
          const emptyInvolved = a[s.field] == null || b[s.field] == null || a[s.field] === '' || b[s.field] === '';
          return s.direction === 'desc' && !emptyInvolved ? -c : c;
        }
      }
      return 0;
    });
  }

  const total = rows.length;
  return {
    dataset: compiled.dataset,
    columns: compiled.columns,
    rows: rows.slice(0, compiled.limit),
    total_rows: total,
    truncated: total > compiled.limit,
    generated_at: new Date().toISOString()
  };
}

module.exports = {
  DATASETS,
  OPS_BY_TYPE,
  ALL_OPS,
  AGG_FNS,
  datasetCatalog,
  compileDefinition,
  runReport
};
