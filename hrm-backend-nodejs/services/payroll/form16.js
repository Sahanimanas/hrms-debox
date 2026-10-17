/**
 * Form 16 Part B figures for one employee and FY, from locked/paid payslips (PY-6).
 */

const { computeAnnualTax, computeHraExemption, round2, ageOn, fyStartYear, DEDUCTION_LABELS } = require('./statutory');
const { taxConfigFor } = require('./settings');
const { taxInputsFromDeclaration } = require('./declarations');
const { findEmployeeByUid } = require('../lifecycle/common');

async function buildForm16Data(db, uid, fy, settings) {
  const slips = await db.collection('payslips')
    .find({ employee_uid: uid, financial_year: fy, status: { $in: ['locked', 'paid'] } }, { projection: { _id: 0 } })
    .sort({ month: 1 })
    .toArray();
  if (!slips.length) return null;

  const total = (fn) => round2(slips.reduce((s, p) => s + (Number(fn(p)) || 0), 0));
  const gross = total(p => p.taxable_gross);
  const tds = total(p => p.tax?.monthly_tds);
  const pt = total(p => p.statutory?.pt);
  const pf = total(p => p.statutory?.pf_employee);
  const hra = total(p => p.earned?.hra);
  const basicDa = total(p => (p.earned?.basic || 0) + (p.earned?.da || 0));
  const last = slips[slips.length - 1];
  const regime = last.tax_regime === 'old' ? 'old' : 'new';
  const taxCfg = taxConfigFor(settings, fy);

  let hraExemption = 0;
  let deductions = {};
  let capOptions = {};
  if (regime === 'old') {
    const declaration = await db.collection('tax_declarations').findOne({ employee_uid: uid, financial_year: fy }, { projection: { _id: 0 } });
    const inputs = taxInputsFromDeclaration(declaration, settings);
    hraExemption = computeHraExemption({ hraReceived: hra, basicDa, rentPaid: inputs.rentPaid, metro: inputs.metro });
    deductions = { ...inputs.deductions, '80C': round2((inputs.deductions['80C'] || 0) + pf) };
    const employee = await findEmployeeByUid(db, uid);
    const age = ageOn(employee?.date_of_birth, new Date(Date.UTC(fyStartYear(fy) + 1, 2, 31)));
    capOptions = { ...inputs.capOptions, selfSenior: age != null && age >= 60 };
  }
  const tax = computeAnnualTax({ regime, config: taxCfg.config[regime], grossSalary: gross, hraExemption, professionalTax: pt, deductions, capOptions });
  const statutory = await db.collection('employee_statutory').findOne({ employee_uid: uid }, { projection: { _id: 0 } });

  return {
    employee_uid: uid,
    employee_name: last.employee_name,
    employee_email: last.employee_email,
    employee_code: last.employee_code,
    designation: last.designation,
    pan: statutory?.pan || last.pan || null,
    financial_year: fy,
    slabs_fy: taxCfg.fy,
    period_from: slips[0].month,
    period_to: last.month,
    regime,
    gross_salary: gross,
    employee_pf: pf,
    tax,
    tds_deducted: tds,
    months: slips.map(p => ({ month: p.month, taxable_gross: p.taxable_gross, tds: p.tax?.monthly_tds || 0 })),
    section_labels: DEDUCTION_LABELS
  };
}

module.exports = { buildForm16Data };
