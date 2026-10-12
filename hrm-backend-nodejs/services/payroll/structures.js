/**
 * Salary structures and effective-dated revisions (PY-11).
 *
 * `salary_structures` keeps one current structure per employee (legacy shape,
 * read by the existing Salary Structure page). Every save also writes a
 * `salary_revisions` document with an effective month, so payroll runs can use
 * the structure that applied in the month being paid.
 */

const { generateUUID, employeeUid, localParts } = require('../../utils/helpers');
const { round2 } = require('./statutory');

// Deductions the statutory engine computes itself; structure lines with these names are ignored in runs
const STATUTORY_DEDUCTION_RE = /(^|[^a-z])(e?pf|provident|professional\s*tax|p\.?\s?t\.?|tds|income\s*tax|esi|esic|lwf|labour\s*welfare)([^a-z]|$)/i;
const BASIC_RE = /basic/i;
const DA_RE = /dearness|(^|[^a-z])da([^a-z]|$)/i;
const HRA_RE = /house\s*rent|(^|[^a-z])hra([^a-z]|$)/i;

const currentMonth = () => localParts(new Date()).date.slice(0, 7);

const componentAmount = (comp, ctc, totalEarnings) => {
  const amount = Number(comp.amount) || 0;
  if (comp.is_percentage) {
    if (comp.calculation_base === 'gross') return (totalEarnings * amount) / 100;
    if (comp.calculation_base === 'ctc' || comp.calculation_base === 'basic' || !comp.calculation_base) return (ctc * amount) / 100;
  }
  return Number(comp.calculated_amount ?? amount) || 0;
};

/** Legacy totals (same arithmetic as POST /api/salary-structure). Mutates calculated_amount. */
function withTotals(structure) {
  const ctc = Number(structure.basic_salary) || 0;
  const components = (structure.components || []).map(c => ({ ...c }));
  let totalEarnings = 0;
  for (const comp of components) {
    if (comp.type !== 'earning') continue;
    comp.calculated_amount = round2(componentAmount(comp, ctc, 0));
    totalEarnings += comp.calculated_amount;
  }
  let totalDeductions = 0;
  for (const comp of components) {
    if (comp.type === 'earning') continue;
    comp.calculated_amount = round2(componentAmount(comp, ctc, totalEarnings || ctc));
    totalDeductions += comp.calculated_amount;
  }
  return {
    basic_salary: ctc,
    components,
    gross_salary: round2(totalEarnings || ctc),
    total_deductions: round2(totalDeductions),
    net_salary: round2((totalEarnings || ctc) - totalDeductions)
  };
}

/**
 * Break a structure into monthly payroll lines.
 * Returns { earnings: [{ name, amount, kind }], customDeductions: [{ name, amount }], gross, basic, da, hra }.
 * Statutory deductions configured on the structure (PF, PT, TDS, ESI, LWF) are skipped —
 * the engine computes those.
 */
function monthlyComponents(structure) {
  const ctc = Number(structure?.basic_salary) || 0;
  const comps = structure?.components || [];
  const earnings = [];
  for (const comp of comps) {
    if (comp.type !== 'earning') continue;
    const amount = round2(componentAmount(comp, ctc, 0));
    if (amount <= 0) continue;
    const kind = BASIC_RE.test(comp.name) ? 'basic' : DA_RE.test(comp.name) ? 'da' : HRA_RE.test(comp.name) ? 'hra' : 'other';
    earnings.push({ name: comp.name, amount, kind });
  }
  if (!earnings.length && ctc > 0) earnings.push({ name: 'Basic', amount: round2(ctc), kind: 'basic' });

  const gross = round2(earnings.reduce((s, e) => s + e.amount, 0));
  const customDeductions = [];
  for (const comp of comps) {
    if (comp.type !== 'deduction' || STATUTORY_DEDUCTION_RE.test(comp.name || '')) continue;
    const amount = round2(componentAmount(comp, ctc, gross));
    if (amount > 0) customDeductions.push({ name: comp.name, amount });
  }

  const sumKind = (k) => round2(earnings.filter(e => e.kind === k).reduce((s, e) => s + e.amount, 0));
  let basic = sumKind('basic');
  // No component named Basic: treat the whole gross as basic (conservative for PF/HRA)
  if (!basic && !sumKind('da')) basic = gross;
  return { earnings, customDeductions, gross, basic, da: sumKind('da'), hra: sumKind('hra') };
}

const structureKeys = (employee) =>
  [employee.employee_id, employee.employee_code, employee.id, employeeUid(employee)].filter(Boolean);

/**
 * Save a structure: replaces the current one (legacy behaviour), records a revision
 * and updates employees.monthly_salary.
 */
async function saveStructure(db, employee, body, { effectiveFrom, reason, user } = {}) {
  const uid = employeeUid(employee);
  const keys = structureKeys(employee);
  const previous = await db.collection('salary_structures').findOne({ employee_id: { $in: keys } }, { projection: { _id: 0 } });

  const now = new Date();
  const totals = withTotals({ basic_salary: body.basic_salary || 0, components: body.components || [] });
  const salaryData = {
    employee_id: employee.employee_id || uid,
    ...totals,
    effective_from: effectiveFrom || currentMonth(),
    updated_at: now.toISOString()
  };

  await db.collection('salary_structures').deleteMany({ employee_id: { $in: keys } });
  await db.collection('salary_structures').insertOne(salaryData);
  delete salaryData._id;

  await db.collection('employees').updateOne(
    { email: employee.email },
    { $set: { monthly_salary: salaryData.net_salary } }
  );

  const snapshot = (s) => s && {
    basic_salary: s.basic_salary || 0,
    components: s.components || [],
    gross_salary: s.gross_salary ?? null,
    net_salary: s.net_salary ?? null
  };
  const revision = {
    id: generateUUID(),
    employee_uid: uid,
    employee_email: employee.email,
    employee_name: employee.full_name,
    effective_from: salaryData.effective_from,
    previous: snapshot(previous),
    structure: snapshot(salaryData),
    previous_gross: previous ? (previous.gross_salary ?? withTotals(previous).gross_salary) : null,
    new_gross: salaryData.gross_salary,
    reason: reason || (previous ? 'Salary structure updated' : 'Initial salary structure'),
    revised_by: user?.email || null,
    revised_by_name: user?.full_name || null,
    created_at: now
  };
  await db.collection('salary_revisions').insertOne(revision);
  delete revision._id;

  return { structure: salaryData, revision };
}

/**
 * Structure that applies to an employee in a month.
 * Returns { structure, revision_id, effective_from } or null.
 */
async function effectiveStructure(db, employee, month) {
  const uid = employeeUid(employee);
  const revisions = await db.collection('salary_revisions')
    .find({ employee_uid: uid }, { projection: { _id: 0 } })
    .sort({ effective_from: -1, created_at: -1 })
    .toArray();

  if (revisions.length) {
    const applicable = revisions.find(r => r.effective_from <= month);
    if (applicable) return { structure: applicable.structure, revision_id: applicable.id, effective_from: applicable.effective_from };
    // Every revision starts later: use what was in place before the earliest one
    const earliest = revisions[revisions.length - 1];
    if (earliest.previous) return { structure: earliest.previous, revision_id: null, effective_from: null };
    return null;
  }

  const legacy = await db.collection('salary_structures').findOne(
    { employee_id: { $in: structureKeys(employee) } },
    { projection: { _id: 0 } }
  );
  return legacy ? { structure: legacy, revision_id: null, effective_from: legacy.effective_from || null } : null;
}

module.exports = {
  withTotals,
  monthlyComponents,
  saveStructure,
  effectiveStructure,
  structureKeys,
  currentMonth,
  STATUTORY_DEDUCTION_RE
};
