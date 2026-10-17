/**
 * Payroll run engine (PY-3, with PY-2 LOP, PY-7 loans, PY-8 one-offs, leave encashment).
 *
 * draft  → payslips are computed (and can be recomputed) for every active employee
 *          with a salary structure effective in the month
 * locked → payslips frozen; loan EMIs and leave encashments are applied
 * paid   → payout done
 */

const { generateUUID, employeeUid, getDaysInMonth } = require('../../utils/helpers');
const { emitEvent } = require('../events');
const {
  round2, fyOf, fyMonths,
  computePF, computeESI, computePT, computeLWF, computeAnnualTax, computeHraExemption, monthlyTds, ageOn
} = require('./statutory');
const { getSettings, taxConfigFor } = require('./settings');
const { effectiveStructure, monthlyComponents } = require('./structures');
const { computeLop, lopAmount } = require('./lop');
const { taxInputsFromDeclaration } = require('./declarations');

class PayrollError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

const ONE_OFF_TYPES = {
  bonus: 'Bonus',
  arrears: 'Arrears',
  incentive: 'Incentive',
  other_earning: 'Other Earning',
  other_deduction: 'Other Deduction'
};

// One-off earnings that count as ESI wages (bonus does not)
const ESI_ONE_OFFS = ['arrears', 'incentive', 'other_earning'];

const ACTIVE_EMPLOYEES = { employment_status: { $ne: 'exited' } };

const sum = (arr, fn = (x) => x) => round2(arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0));

const monthEndDate = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, getDaysInMonth(y, m)));
};

/** Totals already paid out earlier in the FY (locked/paid payslips only). */
async function priorFyTotals(db, uid, month) {
  const months = fyMonths(fyOf(month)).filter(m => m < month);
  const slips = await db.collection('payslips').find(
    { employee_uid: uid, month: { $in: months }, status: { $in: ['locked', 'paid'] } },
    { projection: { _id: 0, taxable_gross: 1, statutory: 1, tax: 1, earned: 1 } }
  ).toArray();
  return {
    months: slips.length,
    taxable_gross: sum(slips, s => s.taxable_gross),
    tds: sum(slips, s => s.tax?.monthly_tds),
    pt: sum(slips, s => s.statutory?.pt),
    pf_employee: sum(slips, s => s.statutory?.pf_employee),
    hra: sum(slips, s => s.earned?.hra),
    basic_da: sum(slips, s => (s.earned?.basic || 0) + (s.earned?.da || 0))
  };
}

/** FY months after `month` the employee is expected to be paid for (stops at a known exit). */
function futureMonths(month, employee) {
  let list = fyMonths(fyOf(month)).filter(m => m > month);
  if (employee.exit_date) {
    const exit = new Date(employee.exit_date);
    if (!isNaN(exit)) {
      const exitMonth = exit.toISOString().slice(0, 7);
      list = list.filter(m => m <= exitMonth);
    }
  }
  return list;
}

/**
 * Compute one employee's payslip for a run. Returns { payslip } or { skip: reason }.
 */
async function computePayslip(db, run, settings, employee) {
  const month = run.month;
  const mon = parseInt(month.slice(5, 7), 10);
  const fy = fyOf(month);
  const uid = employeeUid(employee);

  // Salary revision → salary structure → employees.monthly_salary (see effectiveStructure)
  const eff = await effectiveStructure(db, employee, month);
  if (!eff) return { skip: 'No salary structure or monthly salary for this month' };
  const comps = monthlyComponents(eff.structure);
  if (comps.gross <= 0) return { skip: 'Salary structure has no earnings' };

  // ---- Loss of pay ----
  const lop = await computeLop(db, employee, month, settings);
  const lopAmt = lopAmount(comps.gross, lop);
  const factor = (comps.gross - lopAmt) / comps.gross;
  const earned = {
    basic: round2(comps.basic * factor),
    da: round2(comps.da * factor),
    hra: round2(comps.hra * factor),
    gross: round2(comps.gross - lopAmt)
  };

  const statutoryDoc = await db.collection('employee_statutory').findOne({ employee_uid: uid }, { projection: { _id: 0 } });
  const ptState = statutoryDoc?.pt_state || settings.default_pt_state || null;
  const regime = statutoryDoc?.tax_regime === 'old' ? 'old' : 'new';

  // ---- One-offs and leave encashment ----
  const adjustments = await db.collection('payroll_adjustments')
    .find({ run_id: run.id, employee_uid: uid }, { projection: { _id: 0 } })
    .sort({ created_at: 1 })
    .toArray();
  const oneOffEarnings = adjustments.filter(a => a.type !== 'other_deduction');
  const oneOffDeductions = adjustments.filter(a => a.type === 'other_deduction');

  const encashments = await db.collection('leave_encashments').find({
    status: 'pending',
    $or: [{ employee_id: employee.id }, { employee_email: employee.email }]
  }, { projection: { _id: 0 } }).toArray();
  const encashTotal = sum(encashments, e => e.amount);

  const oneOffTotal = sum(oneOffEarnings, a => a.amount);
  const taxableOneOffs = sum(oneOffEarnings.filter(a => a.taxable !== false), a => a.amount);
  const taxableGross = round2(earned.gross + taxableOneOffs + encashTotal);

  // ---- Statutory ----
  const age = ageOn(employee.date_of_birth, monthEndDate(month));
  const pf = computePF({ basicDa: earned.basic + earned.da, settings, age, optOut: !!statutoryDoc?.pf_opt_out });
  const esiWage = earned.gross + sum(oneOffEarnings.filter(a => ESI_ONE_OFFS.includes(a.type)), a => a.amount);
  const esi = computeESI({ monthlyGross: comps.gross, esiWage, settings });
  const ptGross = round2(earned.gross + oneOffTotal);
  const pt = computePT({ state: ptState, gross: ptGross, month: mon, gender: employee.gender });
  const lwf = computeLWF({ state: ptState, month: mon, gross: ptGross, settings });

  // ---- TDS (annual projection) ----
  const prior = await priorFyTotals(db, uid, month);
  const future = futureMonths(month, employee);
  const n = future.length;
  const fullPf = computePF({ basicDa: comps.basic + comps.da, settings, age, optOut: !!statutoryDoc?.pf_opt_out });
  const futurePt = future.reduce((s, m) => s + computePT({ state: ptState, gross: comps.gross, month: parseInt(m.slice(5), 10), gender: employee.gender }), 0);

  const projectedGross = round2(prior.taxable_gross + taxableGross + comps.gross * n);
  const projectedPt = round2(prior.pt + pt + futurePt);
  const projectedPf = round2(prior.pf_employee + pf.employee + fullPf.employee * n);

  const taxCfg = taxConfigFor(settings, fy);
  let hraExemption = 0;
  let deductions = {};
  let declarationId = null;
  let capOptions = {};
  if (regime === 'old') {
    const declaration = await db.collection('tax_declarations').findOne({ employee_uid: uid, financial_year: fy }, { projection: { _id: 0 } });
    declarationId = declaration?.id || null;
    const inputs = taxInputsFromDeclaration(declaration, settings);
    const annualHra = prior.hra + earned.hra + comps.hra * n;
    const annualBasicDa = prior.basic_da + earned.basic + earned.da + (comps.basic + comps.da) * n;
    hraExemption = computeHraExemption({ hraReceived: annualHra, basicDa: annualBasicDa, rentPaid: inputs.rentPaid, metro: inputs.metro });
    deductions = { ...inputs.deductions, '80C': round2((inputs.deductions['80C'] || 0) + projectedPf) };
    capOptions = { ...inputs.capOptions, selfSenior: age != null && age >= 60 };
  }
  const annual = computeAnnualTax({
    regime,
    config: taxCfg.config[regime],
    grossSalary: projectedGross,
    hraExemption,
    professionalTax: projectedPt,
    deductions,
    capOptions
  });
  const tds = monthlyTds({ annualTax: annual.total, tdsDeducted: prior.tds, remainingMonths: n + 1 });

  // ---- Loans / advances ----
  const loans = await db.collection('loans').find({
    employee_uid: uid,
    status: 'disbursed',
    outstanding: { $gt: 0 },
    start_month: { $lte: month }
  }, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray();
  const loanLines = loans.map(l => ({
    loan_id: l.id,
    name: l.type === 'advance' ? 'Salary Advance Recovery' : 'Loan EMI',
    amount: round2(Math.min(l.emi, l.outstanding))
  }));

  // ---- Assemble ----
  const earnings = [
    ...comps.earnings.map(e => ({ name: e.name, amount: e.amount, type: 'regular' })),
    ...oneOffEarnings.map(a => ({ name: a.label || ONE_OFF_TYPES[a.type], amount: round2(a.amount), type: a.type, taxable: a.taxable !== false, adjustment_id: a.id })),
    ...(encashTotal > 0 ? [{ name: 'Leave Encashment', amount: encashTotal, type: 'leave_encashment', taxable: true }] : [])
  ];

  const warnings = [];
  const deductionsList = [];
  const add = (name, amount, extra = {}) => { if (amount > 0) deductionsList.push({ name, amount: round2(amount), ...extra }); };
  add(`Loss of Pay (${lop.lop_days} day${lop.lop_days === 1 ? '' : 's'})`, lopAmt, { type: 'lop' });
  add('Provident Fund (Employee)', pf.employee, { type: 'pf' });
  add('ESI (Employee)', esi.employee, { type: 'esi' });
  add('Professional Tax', pt, { type: 'pt' });
  add('Labour Welfare Fund', lwf.employee, { type: 'lwf' });
  add('Income Tax (TDS)', tds, { type: 'tds' });
  for (const d of comps.customDeductions) add(d.name, d.amount, { type: 'structure' });
  for (const a of oneOffDeductions) add(a.label || ONE_OFF_TYPES[a.type], a.amount, { type: 'other_deduction', adjustment_id: a.id });

  const grossEarnings = sum(earnings, e => e.amount);
  let otherDeductions = sum(deductionsList, d => d.amount);

  // Recover loans only from what's left so net pay never goes negative
  let available = Math.max(0, grossEarnings - otherDeductions);
  const loanDeductions = [];
  for (const line of loanLines) {
    const amount = round2(Math.min(line.amount, available));
    if (amount < line.amount) warnings.push(`${line.name} reduced to ₹${amount} (insufficient net pay)`);
    if (amount > 0) {
      loanDeductions.push({ loan_id: line.loan_id, amount });
      deductionsList.push({ name: line.name, amount, type: 'loan', loan_id: line.loan_id });
      available = round2(available - amount);
    }
  }
  const totalDeductions = sum(deductionsList, d => d.amount);
  const netPay = round2(grossEarnings - totalDeductions);
  if (netPay < 0) warnings.push('Net pay is negative — review deductions');
  if (!statutoryDoc?.pan) warnings.push('PAN missing');
  if (!statutoryDoc?.bank_account_number || !statutoryDoc?.ifsc) warnings.push('Bank details missing');
  if (pf.applicable && !statutoryDoc?.uan) warnings.push('UAN missing');
  if (taxCfg.fallback) warnings.push(`Tax slabs for FY ${fy} not configured — using FY ${taxCfg.fy}`);
  if (eff.source === 'monthly_salary') warnings.push('No salary structure — monthly salary split with the default CTC components');
  if (lop.unmarked_days && !lop.unmarked_is_lop) warnings.push(`${lop.unmarked_days} working day${lop.unmarked_days === 1 ? '' : 's'} without attendance (paid; review attendance)`);

  const now = new Date();
  const payslip = {
    id: generateUUID(),
    run_id: run.id,
    month,
    financial_year: fy,
    employee_uid: uid,
    employee_id: employee.id || null,
    employee_code: employee.employee_id || employee.employee_code || null,
    employee_email: employee.email,
    employee_name: employee.full_name,
    department: employee.department || null,
    designation: employee.designation || null,
    joining_date: employee.joining_date || null,
    pan: statutoryDoc?.pan || null,
    uan: statutoryDoc?.uan || null,
    esic_number: statutoryDoc?.esic_number || null,
    bank_name: statutoryDoc?.bank_name || null,
    bank_account_last4: statutoryDoc?.bank_account_number ? String(statutoryDoc.bank_account_number).slice(-4) : null,
    pt_state: ptState,
    tax_regime: regime,
    structure_revision_id: eff.revision_id,
    salary_source: eff.source || null,
    monthly_gross: comps.gross,
    days_in_month: lop.days_in_month,
    basis_days: lop.basis_days,
    payable_days: lop.payable_days,
    lop_days: lop.lop_days,
    lop_amount: lopAmt,
    lop_breakdown: lop.breakdown,
    unmarked_days: lop.unmarked_days,
    attendance_period: lop.period,
    elapsed_days: lop.elapsed_days,
    payable_days_to_date: lop.payable_days_to_date,
    lop_dates: lop.days,
    earned,
    gross_earnings: grossEarnings,
    taxable_gross: taxableGross,
    total_deductions: totalDeductions,
    net_pay: netPay,
    earnings,
    deductions: deductionsList,
    employer_contributions: {
      pf: pf.employer_total,
      eps: pf.employer_eps,
      epf: pf.employer_epf,
      edli: pf.edli,
      pf_admin: pf.admin,
      esi: esi.employer,
      lwf: lwf.employer
    },
    statutory: {
      pf_wage: pf.pf_wage,
      eps_wage: pf.eps_wage,
      edli_wage: pf.edli_wage,
      pf_employee: pf.employee,
      esi_applicable: esi.applicable,
      esi_wage: esi.wage,
      esi_employee: esi.employee,
      pt,
      lwf_employee: lwf.employee
    },
    tax: {
      regime,
      slabs_fy: taxCfg.fy,
      declaration_id: declarationId,
      projected_annual_gross: projectedGross,
      exemptions: annual.exemptions,
      deductions: annual.deductions,
      taxable_income: annual.taxable_income,
      tax_on_income: annual.tax_on_income,
      rebate: annual.rebate,
      surcharge: annual.surcharge,
      cess: annual.cess,
      annual_tax: annual.total,
      tds_deducted_before: prior.tds,
      remaining_months: n + 1,
      monthly_tds: tds
    },
    loan_deductions: loanDeductions,
    encashment_ids: encashments.map(e => e.id),
    adjustment_ids: adjustments.map(a => a.id),
    warnings,
    status: run.status,
    created_at: now,
    updated_at: now
  };
  return { payslip };
}

function runTotals(payslips) {
  const s = (fn) => sum(payslips, fn);
  const employerCost = s(p => p.gross_earnings - p.lop_amount
    + p.employer_contributions.pf + p.employer_contributions.edli + p.employer_contributions.pf_admin
    + p.employer_contributions.esi + p.employer_contributions.lwf);
  return {
    gross: s(p => p.gross_earnings),
    deductions: s(p => p.total_deductions),
    net: s(p => p.net_pay),
    employer_cost: employerCost,
    lop: s(p => p.lop_amount),
    tds: s(p => p.tax.monthly_tds),
    pf_employee: s(p => p.statutory.pf_employee),
    pf_employer: s(p => p.employer_contributions.pf),
    esi_employee: s(p => p.statutory.esi_employee),
    esi_employer: s(p => p.employer_contributions.esi),
    pt: s(p => p.statutory.pt),
    lwf_employee: s(p => p.statutory.lwf_employee),
    lwf_employer: s(p => p.employer_contributions.lwf),
    loan_recovery: s(p => (p.loan_deductions || []).reduce((t, l) => t + l.amount, 0))
  };
}

async function refreshTotals(db, runId) {
  const payslips = await db.collection('payslips').find({ run_id: runId }, { projection: { _id: 0 } }).toArray();
  const totals = runTotals(payslips);
  await db.collection('payroll_runs').updateOne(
    { id: runId },
    { $set: { totals, employee_count: payslips.length, updated_at: new Date() } }
  );
  return totals;
}

async function getRun(db, runId) {
  const run = await db.collection('payroll_runs').findOne({ id: runId }, { projection: { _id: 0 } });
  if (!run) throw new PayrollError(404, 'Payroll run not found');
  return run;
}

const requireDraft = (run) => {
  if (run.status !== 'draft') throw new PayrollError(409, `Payroll run is ${run.status} and can no longer be changed`);
};

/** Payslips for every active employee (nothing is saved). Returns { payslips, skipped }. */
async function computeAll(db, run, settings) {
  // _id kept: seeded salary structures are keyed by it
  const employees = await db.collection('employees').find(ACTIVE_EMPLOYEES).toArray();
  const payslips = [];
  const skipped = [];
  for (const employee of employees) {
    try {
      const result = await computePayslip(db, run, settings, employee);
      if (result.skip) skipped.push({ employee_uid: employeeUid(employee), employee_name: employee.full_name, reason: result.skip });
      else payslips.push(result.payslip);
    } catch (error) {
      console.error(`[payroll] compute failed for ${employee.email}:`, error);
      skipped.push({ employee_uid: employeeUid(employee), employee_name: employee.full_name, reason: 'Calculation error' });
    }
  }
  return { payslips, skipped };
}

/** (Re)compute every payslip of a draft run. */
async function computeRun(db, run) {
  requireDraft(run);
  const settings = await getSettings(db);
  const { payslips, skipped } = await computeAll(db, run, settings);

  // Guard against a concurrent lock between reading and writing
  const fresh = await getRun(db, run.id);
  requireDraft(fresh);
  await db.collection('payslips').deleteMany({ run_id: run.id });
  if (payslips.length) await db.collection('payslips').insertMany(payslips.map(p => ({ ...p })));

  const totals = runTotals(payslips);
  await db.collection('payroll_runs').updateOne(
    { id: run.id },
    {
      $set: {
        totals,
        employee_count: payslips.length,
        skipped,
        settings_snapshot: { lop_basis: settings.lop_basis, pf_enabled: settings.pf_enabled, esi_enabled: settings.esi_enabled, pf_restrict_to_ceiling: settings.pf_restrict_to_ceiling },
        computed_at: new Date(),
        updated_at: new Date()
      }
    }
  );
  return getRun(db, run.id);
}

/**
 * What a run for `month` would compute, without saving anything (Payroll Management
 * summary when no run exists yet). Returns { payslips, skipped }.
 */
async function previewMonth(db, month) {
  const settings = await getSettings(db);
  return computeAll(db, { id: `preview:${month}`, month, status: 'preview' }, settings);
}

/** Recompute one employee's payslip in a draft run (after an adjustment change). */
async function recomputeEmployee(db, run, uid) {
  requireDraft(run);
  const settings = await getSettings(db);
  // _id kept: seeded salary structures are keyed by it
  const employees = await db.collection('employees').find(ACTIVE_EMPLOYEES).toArray();
  const employee = employees.find(e => employeeUid(e) === uid);
  if (!employee) throw new PayrollError(404, 'Employee not found or not active');
  const result = await computePayslip(db, run, settings, employee);
  await db.collection('payslips').deleteMany({ run_id: run.id, employee_uid: uid });
  if (result.payslip) await db.collection('payslips').insertOne({ ...result.payslip });
  await refreshTotals(db, run.id);
  return result.payslip || null;
}

async function createRun(db, month, user) {
  const existing = await db.collection('payroll_runs').findOne({ month });
  if (existing) throw new PayrollError(409, `A payroll run for ${month} already exists`);
  const now = new Date();
  const run = {
    id: generateUUID(),
    month,
    financial_year: fyOf(month),
    status: 'draft',
    totals: { gross: 0, deductions: 0, net: 0, employer_cost: 0 },
    employee_count: 0,
    skipped: [],
    created_by: user?.email || 'system',
    created_by_name: user?.full_name || 'System',
    created_at: now,
    updated_at: now
  };
  try {
    await db.collection('payroll_runs').insertOne({ ...run });
  } catch (error) {
    if (error.code === 11000) throw new PayrollError(409, `A payroll run for ${month} already exists`);
    throw error;
  }
  return computeRun(db, run);
}

async function lockRun(db, runId, user) {
  const run = await getRun(db, runId);
  requireDraft(run);
  const payslips = await db.collection('payslips').find({ run_id: runId }, { projection: { _id: 0 } }).toArray();
  if (!payslips.length) throw new PayrollError(400, 'This run has no payslips to lock');

  // Make sure loans and encashments still match what was computed
  for (const p of payslips) {
    for (const l of p.loan_deductions || []) {
      const loan = await db.collection('loans').findOne({ id: l.loan_id });
      if (!loan || loan.status !== 'disbursed' || loan.outstanding + 0.001 < l.amount) {
        throw new PayrollError(409, `Loan balances changed since this run was computed (${p.employee_name}). Recompute the run before locking.`);
      }
    }
    if ((p.encashment_ids || []).length) {
      const stillPending = await db.collection('leave_encashments').countDocuments({ id: { $in: p.encashment_ids }, status: 'pending' });
      if (stillPending !== p.encashment_ids.length) {
        throw new PayrollError(409, `Leave encashments changed since this run was computed (${p.employee_name}). Recompute the run before locking.`);
      }
    }
  }

  const now = new Date();
  const flipped = await db.collection('payroll_runs').findOneAndUpdate(
    { id: runId, status: 'draft' },
    { $set: { status: 'locked', locked_at: now, locked_by: user?.email || 'system', updated_at: now } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  const lockedRun = flipped?.value !== undefined ? flipped.value : flipped;
  if (!lockedRun) throw new PayrollError(409, 'Payroll run is no longer a draft');

  await db.collection('payslips').updateMany({ run_id: runId }, { $set: { status: 'locked', locked_at: now, updated_at: now } });

  // Apply loan EMIs once per run (the repayments.run_id guard makes this idempotent)
  for (const p of payslips) {
    for (const l of p.loan_deductions || []) {
      const res = await db.collection('loans').updateOne(
        { id: l.loan_id, 'repayments.run_id': { $ne: runId } },
        {
          $inc: { outstanding: -l.amount, recovered: l.amount },
          $push: { repayments: { id: generateUUID(), type: 'emi', month: run.month, run_id: runId, amount: l.amount, at: now } },
          $set: { updated_at: now }
        }
      );
      if (res.modifiedCount) {
        await db.collection('loans').updateOne(
          { id: l.loan_id, outstanding: { $lte: 0.001 } },
          { $set: { status: 'closed', outstanding: 0, closed_at: now } }
        );
      }
    }
    if ((p.encashment_ids || []).length) {
      await db.collection('leave_encashments').updateMany(
        { id: { $in: p.encashment_ids }, status: 'pending' },
        { $set: { status: 'paid', payroll_run_id: runId, paid_month: run.month, paid_at: now } }
      );
    }
  }

  emitEvent('payroll.run.locked', { run_id: runId, month: run.month, employee_count: payslips.length, totals: lockedRun.totals });
  return lockedRun;
}

async function markPaid(db, runId, user, { payment_reference = null, paid_on = null } = {}) {
  const run = await getRun(db, runId);
  if (run.status === 'draft') throw new PayrollError(409, 'Lock the payroll run before marking it paid');
  if (run.status === 'paid') throw new PayrollError(409, 'Payroll run is already marked paid');
  const now = new Date();
  await db.collection('payroll_runs').updateOne(
    { id: runId, status: 'locked' },
    { $set: { status: 'paid', paid_at: paid_on ? new Date(paid_on) : now, paid_by: user?.email || null, payment_reference, updated_at: now } }
  );
  await db.collection('payslips').updateMany({ run_id: runId }, { $set: { status: 'paid', paid_at: now, updated_at: now } });
  const updated = await getRun(db, runId);
  emitEvent('payroll.run.paid', { run_id: runId, month: run.month, employee_count: updated.employee_count, totals: updated.totals, payment_reference });
  return updated;
}

async function deleteRun(db, runId) {
  const run = await getRun(db, runId);
  requireDraft(run);
  await db.collection('payslips').deleteMany({ run_id: runId });
  await db.collection('payroll_adjustments').deleteMany({ run_id: runId });
  await db.collection('payroll_runs').deleteOne({ id: runId, status: 'draft' });
}

module.exports = {
  PayrollError,
  ONE_OFF_TYPES,
  computePayslip,
  computeRun,
  previewMonth,
  recomputeEmployee,
  createRun,
  lockRun,
  markPaid,
  deleteRun,
  getRun,
  requireDraft,
  refreshTotals,
  runTotals,
  priorFyTotals
};
