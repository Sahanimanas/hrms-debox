/**
 * AN-3 Payroll cost analytics.
 *
 * A month with payslips uses them. Payslip gross_earnings is the full-rate
 * gross and loss of pay is a deduction line (lop_amount, also inside
 * total_deductions), so earned gross = gross_earnings − lop_amount and
 * deductions exclude LOP. Employer cost = earned gross + employer PF/ESI.
 * A month without payslips is estimated from each employee on the roster that
 * month: salary structure (gross / net) first, else employees.monthly_salary.
 * Every month says which source it used.
 */

const { round, num, monthRange, monthStart, monthEnd, employedDuring } = require('./common');

const EXCLUDED_SLIP_STATUSES = ['cancelled', 'void', 'voided'];

const contributionTotal = (c) => {
  if (!c || typeof c !== 'object') return 0;
  return Object.values(c).reduce((s, v) => s + num(v), 0);
};

/**
 * @param allEmployees every employee (normalised) — used to attribute payslips to departments
 * @param opts { from, to: 'YYYY-MM', department? }
 */
async function computePayrollCost(db, allEmployees, { from, to, department = null }) {
  const months = monthRange(from, to);
  const byUid = new Map(allEmployees.map(e => [e.uid, e]));
  const inDept = (d) => !department || d === department;

  const [payslips, structures] = await Promise.all([
    db.collection('payslips').find(
      { month: { $in: months }, status: { $nin: EXCLUDED_SLIP_STATUSES } },
      { projection: { _id: 0, month: 1, employee_uid: 1, employee_name: 1, department: 1, gross_earnings: 1, total_deductions: 1, lop_amount: 1, net_pay: 1, employer_contributions: 1 } }
    ).toArray(),
    db.collection('salary_structures').find({}, { projection: { _id: 0, employee_id: 1, gross_salary: 1, net_salary: 1, total_deductions: 1, basic_salary: 1 } }).toArray()
  ]);
  const structureById = new Map(structures.map(s => [s.employee_id, s]));
  const slipsByMonth = new Map();
  for (const s of payslips) {
    if (!slipsByMonth.has(s.month)) slipsByMonth.set(s.month, []);
    slipsByMonth.get(s.month).push(s);
  }

  const deptTotals = new Map();
  const addDept = (dept, month, gross, net, employerCost, uid) => {
    const d = deptTotals.get(dept) || { department: dept, gross: 0, net: 0, employer_cost: 0, months: new Map() };
    d.gross += gross;
    d.net += net;
    d.employer_cost += employerCost;
    if (!d.months.has(month)) d.months.set(month, new Set());
    d.months.get(month).add(uid);
    deptTotals.set(dept, d);
  };

  let withoutSalary = 0;
  const basis = { payslips: 0, salary_structures: 0, monthly_salary: 0 };

  const rows = months.map((month) => {
    const slips = (slipsByMonth.get(month) || []).filter(s => inDept(s.department || byUid.get(s.employee_uid)?.department || 'Unassigned'));
    let gross = 0, deductions = 0, net = 0, contributions = 0, lopTotal = 0;
    const heads = new Set();
    let source;
    const monthBasis = { salary_structures: 0, monthly_salary: 0 };

    if (slips.length) {
      source = 'payslips';
      for (const s of slips) {
        const lop = num(s.lop_amount);
        const g = num(s.gross_earnings) - lop;
        const n = num(s.net_pay);
        const c = contributionTotal(s.employer_contributions);
        gross += g;
        deductions += num(s.total_deductions) - lop;
        lopTotal += lop;
        net += n;
        contributions += c;
        heads.add(s.employee_uid);
        addDept(s.department || byUid.get(s.employee_uid)?.department || 'Unassigned', month, g, n, g + c, s.employee_uid);
      }
      basis.payslips += slips.length;
    } else {
      source = 'estimated';
      let missing = 0;
      for (const e of allEmployees) {
        if (!inDept(e.department) || !employedDuring(e, monthStart(month), monthEnd(month))) continue;
        const st = e.employee_id ? structureById.get(e.employee_id) : null;
        let g, n;
        if (st && (num(st.gross_salary) > 0 || num(st.basic_salary) > 0)) {
          g = num(st.gross_salary) || num(st.basic_salary);
          n = st.net_salary != null ? num(st.net_salary) : g - num(st.total_deductions);
          monthBasis.salary_structures += 1;
        } else if (e.monthly_salary > 0) {
          g = e.monthly_salary;
          n = e.monthly_salary;
          monthBasis.monthly_salary += 1;
        } else {
          missing += 1;
          continue;
        }
        gross += g;
        net += n;
        deductions += g - n;
        heads.add(e.uid);
        addDept(e.department, month, g, n, g, e.uid);
      }
      withoutSalary = missing;
      basis.salary_structures += monthBasis.salary_structures;
      basis.monthly_salary += monthBasis.monthly_salary;
    }

    const employerCost = gross + contributions;
    return {
      month,
      source,
      ...(source === 'estimated' ? { basis: monthBasis } : {}),
      headcount: heads.size,
      gross: round(gross),
      deductions: round(deductions),
      lop: round(lopTotal),
      net: round(net),
      employer_contributions: round(contributions),
      employer_cost: round(employerCost),
      cost_per_head: heads.size ? round(employerCost / heads.size) : 0
    };
  });

  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.mom_change = prev ? round(r.employer_cost - prev.employer_cost) : null;
    r.mom_change_pct = prev && prev.employer_cost ? round((r.employer_cost - prev.employer_cost) / prev.employer_cost * 100) : null;
  });

  const totalCost = rows.reduce((s, r) => s + r.employer_cost, 0);
  const byDepartment = [...deptTotals.values()].map(d => {
    const monthHeads = [...d.months.values()].map(s => s.size);
    return {
      department: d.department,
      gross: round(d.gross),
      net: round(d.net),
      employer_cost: round(d.employer_cost),
      avg_headcount: round(monthHeads.reduce((s, n) => s + n, 0) / rows.length, 2),
      share_pct: totalCost ? round(d.employer_cost / totalCost * 100, 1) : 0
    };
  }).sort((a, b) => b.employer_cost - a.employer_cost || a.department.localeCompare(b.department));

  const sources = new Set(rows.map(r => r.source));
  const source = sources.size > 1 ? 'mixed' : (rows[0]?.source || 'estimated');
  const costed = rows.filter(r => r.headcount > 0);
  const last = rows[rows.length - 1];

  return {
    range: { from, to, months: months.length },
    department,
    source,
    source_note: source === 'payslips'
      ? 'All months use generated payslips.'
      : `Months without payslips are estimated from salary structures, falling back to employees' monthly salary (no employer contributions).`,
    summary: {
      total_gross: round(rows.reduce((s, r) => s + r.gross, 0)),
      total_net: round(rows.reduce((s, r) => s + r.net, 0)),
      total_employer_cost: round(totalCost),
      avg_monthly_cost: rows.length ? round(totalCost / rows.length) : 0,
      avg_cost_per_head: costed.length ? round(costed.reduce((s, r) => s + r.cost_per_head, 0) / costed.length) : 0,
      latest_month: last?.month || null,
      latest_employer_cost: last?.employer_cost ?? 0,
      latest_mom_change_pct: last?.mom_change_pct ?? null
    },
    months: rows,
    by_department: byDepartment,
    data_quality: {
      payslips_used: basis.payslips,
      estimated_from_salary_structures: basis.salary_structures,
      estimated_from_monthly_salary: basis.monthly_salary,
      employees_without_salary: withoutSalary
    }
  };
}

module.exports = { computePayrollCost };
