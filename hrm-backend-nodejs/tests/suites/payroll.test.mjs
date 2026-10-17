// Phase 2 — payroll & compliance (PY-1 … PY-11)
import { createRequire } from 'node:module';
import { run, section, check, get, post, put, del, upload, bootstrap, createUser, withDb } from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const statutory = require('../../services/payroll/statutory.js');
const { computeGratuity } = require('../../services/payroll/gratuity.js');

const pad = (n) => String(n).padStart(2, '0');
const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const daysIn = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DEFAULT_COMPONENTS = [
  { name: 'Basic Pay', amount: 50, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 1 },
  { name: 'House Rent Allowance', amount: 25, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 2 },
  { name: 'LTA Allowance', amount: 2.5, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 3 },
  { name: 'Other Allowance', amount: 22.5, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 4 }
];
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

await run(async () => {
  const admin = await bootstrap();
  const e1 = await createUser(admin, { name: 'Priya Payroll', joining_date: '2020-01-15' });
  const e2 = await createUser(admin, { name: 'Ravi Lowwage', joining_date: '2021-06-01' });
  const e3 = await createUser(admin, { name: 'Nina Nostructure', joining_date: '2021-06-01' });
  const e4 = await createUser(admin, { name: 'Xavier Exited', joining_date: '2019-06-01' });
  const mgr = await createUser(admin, { role: 'manager', name: 'Mona Manager', joining_date: '2018-01-01' });

  const meta = await get('/v2/payroll/meta', e1.token);
  const CUR = meta.d.current_month;
  const M = shiftMonth(CUR, -1); // month we run payroll for
  const FY = statutory.fyOf(M);
  const [MY, MM] = M.split('-').map(Number);

  // ================================================================
  section('PY-1 Statutory engine (pure functions)');
  const slabs = statutory.TAX_SLABS_FY2025_26;
  check('new regime: ₹12L taxable → nil tax (87A rebate)', statutory.computeTaxOnIncome(1200000, slabs.new).total === 0);
  check('new regime: ₹12.1L → marginal relief caps tax at ₹10,000 + cess', statutory.computeTaxOnIncome(1210000, slabs.new).total === 10400);
  check('new regime: ₹16L → ₹1,20,000 + 4% cess', statutory.computeTaxOnIncome(1600000, slabs.new).total === 124800);
  check('new regime: ₹30L → slab tax ₹4,80,000', statutory.computeTaxOnIncome(3000000, slabs.new).tax_on_income === 480000);
  check('old regime: ₹5L → nil (87A)', statutory.computeTaxOnIncome(500000, slabs.old).total === 0);
  check('old regime: ₹10L → ₹1,12,500 + cess', statutory.computeTaxOnIncome(1000000, slabs.old).total === 117000);
  check('surcharge 10% above ₹50L', statutory.computeTaxOnIncome(6000000, slabs.new).surcharge === 138000);
  check('HRA exemption = least of three (non-metro)', statutory.computeHraExemption({ hraReceived: 300000, basicDa: 600000, rentPaid: 240000, metro: false }) === 180000);
  check('HRA exemption metro uses 50%', statutory.computeHraExemption({ hraReceived: 400000, basicDa: 600000, rentPaid: 500000, metro: true }) === 300000);
  check('80C capped at ₹1.5L, 24(b) at ₹2L', (() => { const c = statutory.capDeductions({ '80C': 300000, '24B': 350000 }); return c.breakdown['80C'] === 150000 && c.breakdown['24B'] === 200000; })());
  check('80CCE: 80C + 80CCC + 80CCD(1) share one ₹1.5L limit; 80CCD(1B) ₹50k on top', (() => { const c = statutory.capDeductions({ '80C': 100000, '80CCC': 40000, '80CCD1': 30000, '80CCD1B': 60000 }); return c.breakdown['80C'] === 100000 && c.breakdown['80CCC'] === 40000 && c.breakdown['80CCD1'] === 10000 && c.breakdown['80CCD1B'] === 50000 && c.total === 200000; })());
  check('80D: ₹25k each, ₹50k for a senior citizen', (() => { const a = statutory.capDeductions({ '80D_self': 60000, '80D_parents': 60000 }); const b = statutory.capDeductions({ '80D_self': 60000, '80D_parents': 60000 }, { selfSenior: true, parentsSenior: true }); return a.breakdown['80D_self'] === 25000 && a.breakdown['80D_parents'] === 25000 && b.breakdown['80D_self'] === 50000 && b.breakdown['80D_parents'] === 50000; })());
  check('monthly TDS = (annual − deducted) / remaining', statutory.monthlyTds({ annualTax: 120000, tdsDeducted: 30000, remainingMonths: 9 }) === 10000);
  check('FY helpers', statutory.fyOf('2026-03') === '2025-26' && statutory.fyOf('2026-04') === '2026-27' && statutory.fyMonths('2025-26')[11] === '2026-03');
  check('amount in words (Indian system)', statutory.amountInWords(123456.5) === 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only');

  section('PY-1 Statutory calculators (API)');
  let r = await post('/v2/payroll/calculate/statutory', admin, { basic_da: 20000, gross: 30000, state: 'MH', month: 2 });
  check('PF on capped wage: EE 1800, EPS 1250, EPF 550', r.s === 200 && r.d.pf.employee === 1800 && r.d.pf.employer_eps === 1250 && r.d.pf.employer_epf === 550 && r.d.pf.edli_wage === 15000, r.d);
  check('ESI not applicable above ₹21,000', r.d?.esi?.applicable === false, r.d);
  check('Maharashtra PT is ₹300 in February', r.d?.pt === 300, r.d);
  r = await post('/v2/payroll/calculate/statutory', admin, { basic_da: 9000, gross: 18000, state: 'MH', month: 6 });
  check('ESI 0.75% / 3.25% under threshold', r.d?.esi?.applicable && r.d.esi.employee === 135 && r.d.esi.employer === 585, r.d);
  check('PF below ceiling = 12% of actual wage', r.d?.pf?.employee === 1080 && r.d.pf.employer_eps === 750, r.d);
  check('Maharashtra LWF in June (25 / 75), PT 200', r.d?.lwf?.employee === 25 && r.d.lwf.employer === 75 && r.d.pt === 200, r.d);
  r = await post('/v2/payroll/calculate/statutory', admin, { basic_da: 9000, gross: 20000, state: 'MH', month: 5, gender: 'female' });
  check('Maharashtra: women up to ₹25,000 exempt from PT', r.d?.pt === 0, r.d);
  const ptCases = [['KA', 30000, 200], ['KA', 20000, 0], ['WB', 30000, 150], ['TN', 30000, 208.33], ['TS', 18000, 150], ['GJ', 11000, 0], ['GJ', 15000, 200], ['AP', 25000, 200], ['DL', 50000, 0]];
  let ptOk = true;
  for (const [state, gross, expected] of ptCases) {
    const x = await post('/v2/payroll/calculate/statutory', admin, { basic_da: 0, gross, state, month: 7 });
    if (x.d?.pt !== expected) { ptOk = false; console.log('      PT mismatch', state, gross, x.d?.pt); }
  }
  check('PT slabs for KA, WB, TN, TS, GJ, AP; other states 0', ptOk);
  r = await post('/v2/payroll/calculate/statutory', admin, { basic_da: 20000, gross: 30000, state: 'MH', month: 7, age: 59 });
  check('no EPS after age 58 (all employer PF to EPF)', r.d?.pf?.employer_eps === 0 && r.d.pf.employer_epf === 1800, r.d);
  r = await post('/v2/payroll/calculate/statutory', admin, { state: 'MH', month: 7 });
  check('calculator validates input', r.s === 422, r);

  r = await post('/v2/payroll/calculate/tax', e1.token, { annual_gross: 1275000, financial_year: '2025-26' });
  check('tax calc: ₹12.75L gross → nil under new regime (std deduction 75k)', r.s === 200 && r.d.new.total === 0 && r.d.new.taxable_income === 1200000, r.d);
  r = await post('/v2/payroll/calculate/tax', e1.token, { annual_gross: 1000000, financial_year: '2025-26', deductions: { '80C': 200000, '80D_self': 30000 } });
  check('tax calc: old regime caps 80C and 80D (self)', r.d?.old?.deductions?.breakdown?.['80C'] === 150000 && r.d.old.deductions.breakdown['80D_self'] === 25000, r.d);
  check('tax calc picks the cheaper regime', ['new', 'old'].includes(r.d?.better) && (r.d.better === 'new' ? r.d.new.total <= r.d.old.total : r.d.old.total < r.d.new.total), r.d);

  section('PY-1 Payroll settings & tax slabs');
  r = await get('/v2/payroll/settings', e1.token);
  check('employee cannot read payroll settings', r.s === 403, r);
  r = await get('/v2/payroll/settings', mgr.token);
  check('manager cannot read payroll settings', r.s === 403, r);
  r = await get('/v2/payroll/settings', admin);
  check('admin gets defaults incl. FY 2025-26 slabs', r.s === 200 && r.d.pf_enabled === true && r.d.tax_slabs['2025-26']?.new?.standard_deduction === 75000, r.d);
  r = await put('/v2/payroll/settings', admin, { lop_basis: '27' });
  check('invalid LOP basis rejected', r.s === 422, r);
  r = await put('/v2/payroll/settings', e1.token, { pf_enabled: false });
  check('employee cannot change settings', r.s === 403, r);
  r = await put('/v2/payroll/settings', admin, { pf_restrict_to_ceiling: false });
  check('save setting', r.s === 200 && r.d.pf_restrict_to_ceiling === false, r.d);
  r = await post('/v2/payroll/calculate/statutory', admin, { basic_da: 20000, gross: 30000, state: 'MH', month: 7 });
  check('PF on full wage when ceiling restriction is off (EPS still on 15k)', r.d?.pf?.employee === 2400 && r.d.pf.employer_eps === 1250 && r.d.pf.employer_epf === 1150, r.d);
  await put('/v2/payroll/settings', admin, { pf_enabled: false });
  r = await post('/v2/payroll/calculate/statutory', admin, { basic_da: 20000, gross: 30000, state: 'MH', month: 7 });
  check('PF off → no PF', r.d?.pf?.applicable === false && r.d.pf.employee === 0, r.d);
  r = await put('/v2/payroll/settings', admin, { pf_enabled: true, pf_restrict_to_ceiling: true, default_pt_state: 'MH', lop_basis: 'calendar', company_name: 'Acme Test Pvt Ltd', employer_tan: 'MUMA12345B' });
  check('restore settings', r.s === 200 && r.d.pf_enabled && r.d.company_name === 'Acme Test Pvt Ltd', r.d);
  const fy2627 = JSON.parse(JSON.stringify(slabs));
  fy2627.new.standard_deduction = 80000;
  r = await put('/v2/payroll/settings/tax-slabs/2030-31', admin, fy2627);
  check('save slabs for another FY', r.s === 200 && r.d.tax_slabs['2030-31'].new.standard_deduction === 80000, r.d);
  r = await put('/v2/payroll/settings/tax-slabs/2030-32', admin, fy2627);
  check('invalid FY label rejected', r.s === 422, r);
  const badSlabs = JSON.parse(JSON.stringify(slabs));
  badSlabs.new.slabs[badSlabs.new.slabs.length - 1].upto = 9000000;
  r = await put('/v2/payroll/settings/tax-slabs/2031-32', admin, badSlabs);
  check('last slab must be open-ended', r.s === 422, r);
  r = await post('/v2/payroll/calculate/tax', admin, { annual_gross: 1000000, financial_year: '2030-31' });
  check('FY-specific slabs are used', r.d?.slabs_fy === '2030-31' && r.d.new.exemptions.standard_deduction === 80000, r.d);
  r = await del('/v2/payroll/settings/tax-slabs/2030-31', admin);
  check('delete FY slabs', r.s === 200 && !r.d.tax_slabs['2030-31'], r.d);

  // ================================================================
  section('PY-11 Salary revision history');
  r = await post(`/salary-structure/${e1.employee_id}`, admin, { basic_salary: 150000, components: DEFAULT_COMPONENTS, effective_from: 'Jan-2020' });
  check('legacy endpoint validates effective_from', r.s === 422, r);
  r = await post(`/salary-structure/${e1.employee_id}`, admin, { basic_salary: 150000, components: DEFAULT_COMPONENTS, effective_from: '2020-01', revision_reason: 'Joining CTC' });
  check('legacy save still works and records a revision', r.s === 200 && r.d.status === 'success' && r.d.structure.gross_salary === 150000 && !!r.d.revision_id, r.d);
  r = await get(`/salary-structure/${e1.employee_id}`, e1.token);
  check('legacy GET returns the saved structure', r.s === 200 && r.d.basic_salary === 150000, r.d);
  r = await post(`/salary-structure/${e2.employee_id}`, admin, { basic_salary: 18000, components: DEFAULT_COMPONENTS, effective_from: '2021-06' });
  check('second employee structure saved', r.s === 200, r);
  r = await post(`/salary-structure/${e4.employee_id}`, admin, { basic_salary: 50000, components: DEFAULT_COMPONENTS, effective_from: '2019-06' });
  await withDb(db => db.collection('employees').updateOne({ email: e4.email }, { $set: { employment_status: 'exited', exit_date: new Date('2024-01-31') } }));
  const NEXT = shiftMonth(CUR, 1);
  r = await post('/v2/payroll/revisions', admin, { employee_uid: e1.employee_id, effective_from: NEXT, reason: 'Annual appraisal', basic_salary: 160000, components: DEFAULT_COMPONENTS });
  check('admin revision with future effective month', r.s === 201 && r.d.revision.previous_gross === 150000 && r.d.revision.new_gross === 160000, r.d);
  r = await post('/v2/payroll/revisions', admin, { employee_uid: e1.employee_id, effective_from: '2026-13', reason: 'x', basic_salary: 1 });
  check('revision validates month', r.s === 422, r);
  r = await post('/v2/payroll/revisions', e1.token, { employee_uid: e1.employee_id, effective_from: NEXT, reason: 'self raise', basic_salary: 999999 });
  check('employee cannot revise salary', r.s === 403, r);
  r = await post('/v2/payroll/revisions', admin, { employee_uid: 'NOPE', effective_from: NEXT, reason: 'x y', basic_salary: 1000 });
  check('unknown employee → 404', r.s === 404, r);
  r = await get(`/v2/payroll/revisions?employee_uid=${e1.employee_id}`, admin);
  check('admin sees revision history (newest first)', r.s === 200 && r.d.length === 2 && r.d[0].effective_from === NEXT && r.d[0].reason === 'Annual appraisal', r.d);
  r = await get('/v2/payroll/my/revisions', e1.token);
  check('employee sees own history without reviser email', r.s === 200 && r.d.length === 2 && r.d.every(x => x.revised_by === undefined), r.d);
  r = await get('/v2/payroll/my/revisions', e2.token);
  check('history is per employee', r.d?.length === 1, r.d);
  r = await get('/v2/payroll/revisions', e1.token);
  check('employee cannot list all revisions', r.s === 403, r);

  // ================================================================
  section('PY-2 Loss of pay from attendance');
  const e1Doc = await withDb(db => db.collection('employees').findOne({ email: e1.email }));
  await withDb(async db => {
    await db.collection('attendance').insertOne({ employee_id: e1.employee_id, month: MM, year: MY, attendance: { 3: 'absent', 4: 'absent', 5: 'half-day', 6: 'present', 10: 'absent' } });
    await db.collection('leaves').insertMany([
      { id: 'lv-unpaid-1', employee_id: e1Doc.id, employee_email: e1.email, leave_type: 'Unpaid Leave', dates: [`${M}-10T00:00:00.000Z`, `${M}-11T00:00:00.000Z`], days_count: 2, is_half_day: false, status: 'approved' },
      { id: 'lv-paid-1', employee_id: e1Doc.id, employee_email: e1.email, leave_type: 'Casual Leave', dates: [`${M}-12T00:00:00.000Z`], days_count: 1, is_half_day: false, status: 'approved' },
      { id: 'lv-pending', employee_id: e1Doc.id, employee_email: e1.email, leave_type: 'Unpaid Leave', dates: [`${M}-13T00:00:00.000Z`], days_count: 1, is_half_day: false, status: 'pending' }
    ]);
  });
  r = await get(`/v2/payroll/lop/${e1.employee_id}?month=${M}`, admin);
  // 3, 4, 10 absent (10 also unpaid leave — counted once) + 0.5 half-day + 11 unpaid leave
  check('LOP = absents + half-days×0.5 + approved unpaid leave, no double count', r.s === 200 && r.d.lop_days === 4.5, r.d);
  check('paid / pending leave ignored', r.d?.breakdown?.unpaid_leave === 2 && r.d.days.every(d => d.date !== `${M}-12` && d.date !== `${M}-13`), r.d);
  check('LOP amount = gross / days × LOP days', near(r.d?.lop_amount, r2(150000 / daysIn(M) * 4.5)), r.d);
  check('closed month: unmarked working days reported, paid while auto-absent is off', r.d?.period === 'closed' && r.d.elapsed_days === daysIn(M) && r.d.unmarked_days > 0 && r.d.unmarked_is_lop === false && !r.d.unmarked_dates.some(d => [`${M}-03`, `${M}-06`, `${M}-11`, `${M}-12`, `${M}-13`].includes(d)), r.d);
  const unmarkedM = r.d?.unmarked_days || 0;
  await withDb(db => db.collection('time_settings').updateOne({ id: 'default' }, { $set: { auto_absent_enabled: true } }, { upsert: true }));
  r = await get(`/v2/payroll/lop/${e1.employee_id}?month=${M}`, admin);
  check('auto-absent on: unmarked past working days are loss of pay', r.d?.unmarked_is_lop === true && r.d.lop_days === Math.min(daysIn(M), 4.5 + unmarkedM) && r.d.breakdown.no_attendance === unmarkedM, r.d);
  r = await get(`/v2/payroll/lop/${e1.employee_id}?month=${CUR}`, admin);
  check('current month: only days before today are counted, future days never', r.d?.period === 'in_progress' && r.d.upcoming_days === daysIn(CUR) - r.d.elapsed_days && r.d.unmarked_dates.every(d => d < `${CUR}-${pad(r.d.elapsed_days + 1)}`) && r.d.lop_days <= r.d.elapsed_days, r.d);
  await withDb(db => db.collection('time_settings').updateOne({ id: 'default' }, { $set: { auto_absent_enabled: false } }));
  await put('/v2/payroll/settings', admin, { lop_basis: '26' });
  r = await get(`/v2/payroll/lop/${e1.employee_id}?month=${M}`, admin);
  check('fixed 26-day LOP basis', r.d?.basis_days === 26 && near(r.d.lop_amount, r2(150000 / 26 * 4.5)), r.d);
  await put('/v2/payroll/settings', admin, { lop_basis: 'calendar' });
  r = await get(`/v2/payroll/lop/${e1.employee_id}?month=bad`, admin);
  check('LOP preview validates month', r.s === 422, r);
  r = await get(`/v2/payroll/lop/${e1.employee_id}?month=${M}`, e1.token);
  check('employee cannot preview LOP', r.s === 403, r);
  const late = await createUser(admin, { name: 'Lata Latejoiner', joining_date: `${M}-21`, manager_email: mgr.email });
  await post(`/salary-structure/${late.employee_id}`, admin, { basic_salary: 31000, components: DEFAULT_COMPONENTS, effective_from: M });
  r = await get(`/v2/payroll/lop/${late.employee_id}?month=${M}`, admin);
  check('mid-month joiner: days before joining are unpaid', r.d?.lop_days === 20 && r.d.breakdown.not_employed === 20, r.d);

  // ================================================================
  section('PY-6 Employee statutory details');
  r = await put('/v2/payroll/my/statutory', e1.token, { pan: 'ABCDE12345' });
  check('invalid PAN rejected', r.s === 422, r);
  r = await put('/v2/payroll/my/statutory', e1.token, { ifsc: 'HDFC1234567' });
  check('invalid IFSC rejected', r.s === 422, r);
  r = await put('/v2/payroll/my/statutory', e1.token, { uan: '12345' });
  check('invalid UAN rejected', r.s === 422, r);
  r = await put('/v2/payroll/my/statutory', e1.token, { pf_opt_out: true });
  check('employee cannot set admin-only fields', r.s === 422, r);
  r = await put('/v2/payroll/my/statutory', e1.token, { pan: 'abcpe1234f', uan: '100200300400', bank_name: 'HDFC Bank', bank_account_number: '50100012345678', ifsc: 'hdfc0001234' });
  check('employee saves own PAN / UAN / bank (normalised to upper case)', r.s === 200 && r.d.pan === 'ABCPE1234F' && r.d.ifsc === 'HDFC0001234' && r.d.tax_regime === 'new', r.d);
  r = await get('/v2/payroll/my/statutory', e1.token);
  check('employee reads own details', r.s === 200 && r.d.uan === '100200300400', r.d);
  r = await put(`/v2/payroll/statutory/${e2.employee_id}`, e1.token, { pan: 'ABCDE1234F' });
  check('employee cannot edit others', r.s === 403, r);
  r = await put(`/v2/payroll/statutory/${e2.employee_id}`, admin, { pan: 'BBBBB2222B', uan: '100200300401', esic_number: '3100123456', pt_state: 'MH' });
  check('admin edits statutory details incl. ESIC', r.s === 200 && r.d.esic_number === '3100123456', r.d);
  r = await put(`/v2/payroll/statutory/${e2.employee_id}`, admin, { esic_number: '12' });
  check('admin input validated too', r.s === 422, r);
  r = await get('/v2/payroll/statutory', admin);
  check('admin lists statutory details (exited excluded)', r.s === 200 && r.d.some(x => x.employee_uid === e1.employee_id && x.pan === 'ABCPE1234F') && !r.d.some(x => x.employee_uid === e4.employee_id), r.d);
  r = await get('/v2/payroll/statutory', mgr.token);
  check('manager cannot list statutory details', r.s === 403, r);

  // ================================================================
  section('PY-5 Investment declarations');
  r = await get(`/v2/payroll/declarations/my?fy=${FY}`, e1.token);
  check('empty declaration with current regime', r.s === 200 && r.d.items.length === 0 && r.d.tax_regime === 'new' && r.d.window_open === true, r.d);
  const declBody = (items, regime = 'old') => ({ financial_year: FY, tax_regime: regime, metro_city: true, items });
  r = await put('/v2/payroll/declarations/my', e1.token, declBody([{ section: 'HRA', declared_amount: 240000, landlord_name: 'Mr Landlord' }]));
  check('rent above ₹1L needs landlord PAN', r.s === 422, r);
  r = await put('/v2/payroll/declarations/my', e1.token, declBody([{ section: 'HRA', declared_amount: 240000, landlord_name: 'Mr Landlord', landlord_pan: 'BAD' }]));
  check('landlord PAN format validated', r.s === 422, r);
  r = await put('/v2/payroll/declarations/my', e1.token, declBody([{ section: '80Z', declared_amount: 10 }]));
  check('unknown section rejected', r.s === 422, r);
  r = await put('/v2/payroll/declarations/my', e1.token, declBody([
    { section: '80C', label: 'PPF', declared_amount: 200000 },
    { section: 'HRA', declared_amount: 240000, landlord_name: 'Mr Landlord', landlord_pan: 'CCCCC3333C' },
    { section: '80D_self', declared_amount: 20000 }
  ]));
  check('declaration saved with items in "declared" state', r.s === 200 && r.d.items.length === 3 && r.d.items.every(i => i.status === 'declared') && r.d.summary.declared === 460000, r.d);
  const decl = r.d;
  const item80C = decl.items.find(i => i.section === '80C');
  const itemHra = decl.items.find(i => i.section === 'HRA');
  r = await get('/v2/payroll/my/statutory', e1.token);
  check('chosen regime stored on statutory record', r.d?.tax_regime === 'old', r.d);

  r = await upload(`/v2/payroll/declarations/my/items/${item80C.id}/proofs`, e1.token, [{ field: 'file', name: 'ppf.png', type: 'image/png', content: PNG }], { financial_year: FY });
  check('upload proof (image)', r.s === 201 && r.d.name === 'ppf.png', r);
  const proofId = r.d?.id;
  r = await upload(`/v2/payroll/declarations/my/items/${item80C.id}/proofs`, e1.token, [{ field: 'file', name: 'x.txt', type: 'text/plain', content: 'hello' }], { financial_year: FY });
  check('non PDF/image proof rejected', r.s === 400, r);
  r = await upload(`/v2/payroll/declarations/my/items/${item80C.id}/proofs`, e1.token, [{ field: 'file', name: 'big.pdf', type: 'application/pdf', content: Buffer.alloc(5 * 1024 * 1024 + 10) }], { financial_year: FY });
  check('proof over 5 MB rejected', r.s === 413, r);
  r = await upload('/v2/payroll/declarations/my/items/nope/proofs', e1.token, [{ field: 'file', name: 'a.pdf', type: 'application/pdf', content: '%PDF-1.4' }], { financial_year: FY });
  check('proof for unknown item → 404', r.s === 404, r);
  r = await get(`/v2/payroll/declarations/${decl.id}/items/${item80C.id}/proofs/${proofId}`, e1.token, { raw: true });
  check('owner downloads proof', r.s === 200 && r.buf.length === PNG.length, r.s);
  r = await get(`/v2/payroll/declarations/${decl.id}/items/${item80C.id}/proofs/${proofId}`, e2.token, { raw: true });
  check('other employee cannot download proof', r.s === 404, r.s);
  r = await get(`/v2/payroll/declarations/${decl.id}/items/${item80C.id}/proofs/${proofId}`, admin, { raw: true });
  check('admin downloads proof', r.s === 200, r.s);

  r = await get(`/v2/payroll/declarations?fy=${FY}&status=pending`, admin);
  check('admin lists pending declarations', r.s === 200 && r.d.some(d => d.id === decl.id && d.summary.pending_items === 3), r.d);
  r = await get(`/v2/payroll/declarations?fy=${FY}`, e1.token);
  check('employee cannot list declarations', r.s === 403, r);
  r = await post(`/v2/payroll/declarations/${decl.id}/items/${item80C.id}/verify`, e1.token, { action: 'approve' });
  check('employee cannot verify', r.s === 403, r);
  r = await post(`/v2/payroll/declarations/${decl.id}/items/${item80C.id}/verify`, admin, { action: 'approve', approved_amount: 250000 });
  check('cannot approve more than declared', r.s === 400, r);
  r = await post(`/v2/payroll/declarations/${decl.id}/items/${item80C.id}/verify`, admin, { action: 'approve', approved_amount: 180000 });
  check('approve with amount', r.s === 200 && r.d.items.find(i => i.id === item80C.id).status === 'approved' && r.d.items.find(i => i.id === item80C.id).approved_amount === 180000, r.d);
  r = await post(`/v2/payroll/declarations/${decl.id}/items/${itemHra.id}/verify`, admin, { action: 'reject' });
  check('reject needs a reason', r.s === 422, r);
  r = await post(`/v2/payroll/declarations/${decl.id}/items/${itemHra.id}/verify`, admin, { action: 'reject', reason: 'Rent receipts missing' });
  check('reject with reason', r.s === 200 && r.d.items.find(i => i.id === itemHra.id).status === 'rejected', r.d);
  r = await upload(`/v2/payroll/declarations/my/items/${itemHra.id}/proofs`, e1.token, [{ field: 'file', name: 'rent.pdf', type: 'application/pdf', content: '%PDF-1.4 rent' }], { financial_year: FY });
  r = await get(`/v2/payroll/declarations/my?fy=${FY}`, e1.token);
  check('new proof re-opens a rejected item', r.d?.items?.find(i => i.id === itemHra.id)?.status === 'declared', r.d);
  // Previously unverified items counted and 80C was not capped (UAT #10)
  check('counted for TDS: only approved amounts, 80C capped at ₹1.5L', r.d?.summary?.counted === 150000 && r.d.summary.by_section['80C'].claimed === 180000 && r.d.summary.by_section['80C'].counted === 150000 && r.d.summary.over_limit === 30000, r.d?.summary);
  await put('/v2/payroll/settings', admin, { use_declared_until_deadline: true });
  r = await get(`/v2/payroll/declarations/my?fy=${FY}`, e1.token);
  check('opt-in without a proof deadline: declared amounts still do not count', r.d?.summary?.counted === 150000, r.d?.summary);
  await put('/v2/payroll/settings', admin, { proof_deadline: '2099-12-31' });
  r = await get(`/v2/payroll/declarations/my?fy=${FY}`, e1.token);
  check('opt-in before the proof deadline: declared items count too (still capped)', r.d?.summary?.counted === 150000 + 240000 + 20000, r.d?.summary);
  r = await upload(`/v2/payroll/declarations/my/items/${item80C.id}/proofs`, e1.token, [{ field: 'file', name: 'p2.pdf', type: 'application/pdf', content: '%PDF' }], { financial_year: FY });
  check('verified item is locked for new proofs', r.s === 409, r);
  // Resubmitting keeps the approval for unchanged items
  const keep = r.s; void keep;
  r = await put('/v2/payroll/declarations/my', e1.token, declBody([
    { id: item80C.id, section: '80C', label: 'PPF', declared_amount: 200000 },
    { id: itemHra.id, section: 'HRA', declared_amount: 240000, landlord_name: 'Mr Landlord', landlord_pan: 'CCCCC3333C' },
    { section: '80D_self', declared_amount: 20000 }
  ]));
  check('resubmitting keeps approval of unchanged items and their proofs', r.d?.items?.find(i => i.id === item80C.id)?.status === 'approved' && r.d.items.find(i => i.id === itemHra.id).proofs.length === 1, r.d);
  await put('/v2/payroll/settings', admin, { proof_deadline: '2000-01-01' });
  r = await get(`/v2/payroll/declarations/my?fy=${FY}`, e1.token);
  check('after the proof deadline only approved amounts count (capped)', r.d?.summary?.counted === 150000, r.d?.summary);
  await put('/v2/payroll/settings', admin, { proof_deadline: null, use_declared_until_deadline: false, declaration_window_open: false });
  r = await put('/v2/payroll/declarations/my', e1.token, declBody([]));
  check('declaration window lock blocks changes', r.s === 409, r);
  await put('/v2/payroll/settings', admin, { declaration_window_open: true });
  // Rent is verified so the run below gets an HRA exemption (unverified amounts no longer count)
  r = await post(`/v2/payroll/declarations/${decl.id}/items/${itemHra.id}/verify`, admin, { action: 'approve' });
  check('approve re-submitted rent', r.s === 200 && r.d.summary.counted === 150000 + 240000, r.d?.summary);

  // ================================================================
  section('PY-7 Salary advances and loans');
  r = await post('/v2/payroll/loans/my', e1.token, { amount: 12000, reason: 'Medical', tenure_months: 0 });
  check('tenure validated', r.s === 422, r);
  r = await post('/v2/payroll/loans/my', e1.token, { amount: 12000, reason: 'Medical emergency', tenure_months: 6 });
  check('employee requests a loan (pending, EMI suggested)', r.s === 201 && r.d.status === 'pending' && r.d.emi === 2000, r.d);
  const loan1 = r.d;
  r = await post('/v2/payroll/loans/my', e1.token, { amount: 5000, reason: 'Another', tenure_months: 2 });
  check('only one pending request at a time', r.s === 409, r);
  r = await post(`/v2/payroll/loans/${loan1.id}/approve`, e1.token, { emi: 2500 });
  check('employee cannot approve', r.s === 403, r);
  r = await get(`/v2/payroll/loans/${loan1.id}`, e2.token);
  check('other employees cannot see the loan', r.s === 404, r);
  r = await post(`/v2/payroll/loans/${loan1.id}/disburse`, admin, { start_month: M });
  check('cannot disburse before approval', r.s === 409, r);
  r = await post(`/v2/payroll/loans/${loan1.id}/approve`, admin, { emi: 20000 });
  check('EMI above principal rejected', r.s === 400, r);
  r = await post(`/v2/payroll/loans/${loan1.id}/approve`, admin, { emi: 2500 });
  check('admin approves with edited EMI', r.s === 200 && r.d.status === 'approved' && r.d.emi === 2500 && r.d.tenure_months === 5, r.d);
  r = await post(`/v2/payroll/loans/${loan1.id}/disburse`, admin, { start_month: M });
  check('disbursed: outstanding = principal', r.s === 200 && r.d.status === 'disbursed' && r.d.outstanding === 12000 && r.d.start_month === M, r.d);
  r = await post('/v2/payroll/loans/my', e2.token, { type: 'advance', amount: 3000, reason: 'Festival advance', tenure_months: 1 });
  const loan2 = r.d;
  await post(`/v2/payroll/loans/${loan2.id}/approve`, admin, {});
  r = await post(`/v2/payroll/loans/${loan2.id}/disburse`, admin, { start_month: M });
  check('salary advance disbursed', r.d?.status === 'disbursed' && r.d.emi === 3000, r.d);
  r = await post('/v2/payroll/loans/my', mgr.token, { amount: 1000, reason: 'Test cancel', tenure_months: 1 });
  const loan3 = r.d;
  r = await del(`/v2/payroll/loans/my/${loan3.id}`, e1.token);
  check('cannot cancel someone else\'s request', r.s === 404, r);
  r = await del(`/v2/payroll/loans/my/${loan3.id}`, mgr.token);
  check('requester cancels own pending request', r.s === 200, r);
  r = await post('/v2/payroll/loans/my', mgr.token, { amount: 1000, reason: 'Will be rejected', tenure_months: 1 });
  r = await post(`/v2/payroll/loans/${r.d.id}/reject`, admin, {});
  check('reject needs a reason', r.s === 422, r);
  r = await get('/v2/payroll/loans?status=pending', admin);
  const pendingId = r.d?.[0]?.id;
  r = await post(`/v2/payroll/loans/${pendingId}/reject`, admin, { reason: 'Not eligible yet' });
  check('admin rejects', r.s === 200 && r.d.status === 'rejected', r.d);
  r = await get('/v2/payroll/loans', e1.token);
  check('employee cannot list all loans', r.s === 403, r);
  r = await get('/v2/payroll/loans/my', e1.token);
  check('employee lists own loans', r.s === 200 && r.d.length === 1 && r.d[0].id === loan1.id, r.d);

  // Full & final: lifecycle recovers outstanding loans and emits employee.exited; payroll closes them
  const leaver = await createUser(admin, { name: 'Leo Leaver', joining_date: '2022-01-01' });
  r = await post('/v2/payroll/loans/my', leaver.token, { amount: 6000, reason: 'Laptop purchase', tenure_months: 3 });
  const leaverLoan = r.d;
  await post(`/v2/payroll/loans/${leaverLoan.id}/approve`, admin, {});
  r = await post(`/v2/payroll/loans/${leaverLoan.id}/disburse`, admin, { start_month: NEXT });
  check('leaver loan disbursed', r.d?.status === 'disbursed' && r.d.outstanding === 6000, r.d);
  r = await post('/v2/payroll/loans/my', leaver.token, { amount: 2000, reason: 'Second request', tenure_months: 1 });
  const leaverPending = r.d;
  r = await post(`/v2/payroll/loans/settle-exit/${leaver.employee_id}`, leaver.token);
  check('settle-exit is admin only', r.s === 403, r);
  r = await post(`/v2/payroll/loans/settle-exit/${leaver.employee_id}`, mgr.token);
  check('manager cannot settle loans', r.s === 403, r);
  r = await post('/v2/payroll/loans/settle-exit/NOPE', admin);
  check('settle-exit unknown employee → 404', r.s === 404, r);
  r = await post(`/v2/payroll/loans/settle-exit/${leaver.employee_id}`, admin);
  check('settle-exit closes disbursed loans and cancels open requests', r.s === 200 && r.d.closed.length === 1 && r.d.closed[0].amount === 6000 && r.d.cancelled.includes(leaverPending.id), r.d);
  r = await get(`/v2/payroll/loans/${leaverLoan.id}`, admin);
  const settleRep = r.d?.repayments?.filter(x => x.type === 'settlement') || [];
  check('loan closed: outstanding 0, reason recovered_in_settlement, one settlement entry', r.d?.status === 'closed' && r.d.outstanding === 0 && r.d.closed_reason === 'recovered_in_settlement' && settleRep.length === 1 && settleRep[0].amount === 6000 && settleRep[0].ref === 'full_and_final', r.d);
  r = await post(`/v2/payroll/loans/settle-exit/${leaver.employee_id}`, admin);
  check('second settle-exit is a no-op', r.s === 200 && r.d.closed.length === 0 && r.d.cancelled.length === 0, r.d);
  r = await get(`/v2/payroll/loans/${leaverLoan.id}`, admin);
  check('no duplicate settlement entry', r.d?.repayments?.filter(x => x.type === 'settlement').length === 1 && r.d.recovered === 6000, r.d);
  r = await get(`/v2/payroll/loans/${loan1.id}`, admin);
  check("other employees' loans untouched", r.d?.status === 'disbursed' && r.d.outstanding === 12000, r.d);

  // Leave encashment owned by the leave module
  const e2Doc = await withDb(db => db.collection('employees').findOne({ email: e2.email }));
  await withDb(db => db.collection('leave_encashments').insertOne({ id: 'enc-1', employee_id: e2Doc.id, employee_email: e2.email, leave_type: 'earned_leave', days: 4, year: MY, amount: 4000, status: 'pending', payroll_run_id: null }));

  // ================================================================
  section('PY-3 Payroll run');
  r = await post('/v2/payroll/runs', e1.token, { month: M });
  check('employee cannot create a run', r.s === 403, r);
  r = await post('/v2/payroll/runs', admin, { month: '2026/01' });
  check('month format validated', r.s === 422, r);
  r = await post('/v2/payroll/runs', admin, { month: '2099-01' });
  check('far-future month rejected', r.s === 400, r);
  const PREV = shiftMonth(M, -1);
  // UAT #5: salary only on employees.monthly_salary, and an employee with an empty code
  const onlyMonthly = await createUser(admin, { name: 'Mohan Monthlyonly', joining_date: '2021-01-01' });
  const noCode = await createUser(admin, { name: 'Neha Nocode', joining_date: '2021-01-01' });
  await withDb(async db => {
    await db.collection('employees').updateOne({ email: onlyMonthly.email }, { $set: { monthly_salary: 40000 } });
    await db.collection('employees').updateOne({ email: noCode.email }, { $set: { employee_id: '', monthly_salary: 30000 } });
  });
  r = await post('/v2/payroll/runs', admin, { month: PREV });
  check('create a draft run', r.s === 201 && r.d.status === 'draft', r.d);
  const throwaway = r.d.id;
  const slipOnly = r.d.payslips?.find(p => p.employee_email === onlyMonthly.email);
  const slipNoCode = r.d.payslips?.find(p => p.employee_email === noCode.email);
  check('no salary structure: monthly_salary used with the default CTC split', slipOnly?.monthly_gross === 40000 && slipOnly.salary_source === 'monthly_salary' && slipOnly.earnings.find(e => e.name === 'Basic Pay')?.amount === 20000 && slipOnly.warnings.some(w => /monthly salary/i.test(w)), slipOnly);
  check('employee without an employee code still gets a payslip', !!slipNoCode && slipNoCode.monthly_gross === 30000 && !!slipNoCode.employee_uid && slipNoCode.employee_code === null, slipNoCode || r.d.skipped);
  r = await post(`/salary-structure/${encodeURIComponent(noCode.email)}`, admin, { basic_salary: 32000, components: DEFAULT_COMPONENTS, effective_from: PREV });
  check('legacy salary structure save resolves an employee without a code', r.s === 200 && r.d.structure.gross_salary === 32000, r.d);
  r = await get(`/salary-structure/${encodeURIComponent(noCode.email)}`, admin);
  check('legacy salary structure GET resolves an employee without a code', r.s === 200 && r.d?.basic_salary === 32000, r.d);
  // Keep them out of the main run (bank-file / compliance counts below)
  await withDb(db => db.collection('employees').updateMany({ email: { $in: [onlyMonthly.email, noCode.email] } }, { $set: { employment_status: 'exited' } }));
  r = await del(`/v2/payroll/runs/${throwaway}`, admin);
  check('draft run can be discarded', r.s === 200, r);
  r = await get(`/v2/payroll/runs/${throwaway}`, admin);
  check('discarded run is gone', r.s === 404, r);

  r = await post('/v2/payroll/runs', admin, { month: M });
  check('create run for the month', r.s === 201 && r.d.month === M && r.d.status === 'draft', r.d);
  const runId = r.d.id;
  let runData = r.d;
  const slip1 = () => runData.payslips.find(p => p.employee_uid === e1.employee_id);
  const slip2 = () => runData.payslips.find(p => p.employee_uid === e2.employee_id);
  check('payslips for active employees with a structure', !!slip1() && !!slip2() && runData.payslips.some(p => p.employee_uid === late.employee_id), runData.payslips?.map(p => p.employee_name));
  check('employee without structure is skipped with a reason', runData.skipped.some(s => s.employee_uid === e3.employee_id && /structure/i.test(s.reason)), runData.skipped);
  check('exited employee excluded', !runData.payslips.some(p => p.employee_uid === e4.employee_id) && !runData.skipped.some(s => s.employee_uid === e4.employee_id), runData.skipped);
  r = await post('/v2/payroll/runs', admin, { month: M });
  check('duplicate run for the month blocked', r.s === 409, r);

  let p1 = slip1();
  check('structure effective in the month is used (not the future revision)', p1.monthly_gross === 150000, p1.monthly_gross);
  check('earnings follow the structure', p1.earnings.find(e => e.name === 'Basic Pay')?.amount === 75000 && p1.earnings.find(e => e.name === 'House Rent Allowance')?.amount === 37500, p1.earnings);
  check('payslip shows LOP days and amount', p1.lop_days === 4.5 && near(p1.lop_amount, r2(150000 / daysIn(M) * 4.5)) && p1.deductions.some(d => d.type === 'lop'), p1);
  check('PF capped at ₹15,000 wage', p1.statutory.pf_employee === 1800 && p1.employer_contributions.eps === 1250 && p1.employer_contributions.epf === 550, p1.statutory);
  check('no ESI above threshold', p1.statutory.esi_applicable === false && p1.statutory.esi_employee === 0, p1.statutory);
  check('Maharashtra PT applied', p1.statutory.pt === (MM === 2 ? 300 : 200), p1.statutory);
  check('old regime TDS uses declarations (80C capped)', p1.tax.regime === 'old' && p1.tax.deductions.breakdown['80C'] === 150000 && p1.tax.exemptions.hra > 0, p1.tax);
  check('monthly TDS = (annual tax − deducted) / remaining months', p1.tax.annual_tax > 0 && p1.tax.monthly_tds === Math.max(0, Math.round((p1.tax.annual_tax - p1.tax.tds_deducted_before) / p1.tax.remaining_months)), p1.tax);
  check('loan EMI deducted in the draft', p1.loan_deductions.length === 1 && p1.loan_deductions[0].amount === 2500 && p1.deductions.some(d => d.type === 'loan' && d.amount === 2500), p1.deductions);
  check('net = gross − deductions', near(p1.net_pay, p1.gross_earnings - p1.total_deductions) && near(p1.total_deductions, p1.deductions.reduce((s, d) => s + d.amount, 0)), p1);
  let p2 = slip2();
  check('ESI 0.75% for low wage employee, employer 3.25%', p2.statutory.esi_applicable && p2.statutory.esi_employee === 135 && p2.employer_contributions.esi === 585, p2.statutory);
  check('pending leave encashment paid as an earning', p2.earnings.some(e => e.type === 'leave_encashment' && e.amount === 4000) && p2.encashment_ids.includes('enc-1'), p2.earnings);
  check('salary advance recovered', p2.deductions.some(d => d.name === 'Salary Advance Recovery' && d.amount === 3000), p2.deductions);
  section('Payroll Management summary (legacy page)');
  r = await get(`/payroll/monthly-summary/${M}`, admin);
  const sum1 = r.d?.employees?.find(x => x.employee_uid === e1.employee_id);
  check('summary uses the run: same net, LOP and statutory deductions as the payslip', r.s === 200 && r.d.source === 'run_draft' && sum1?.net_salary === p1.net_pay && sum1.unpaid_days === 4.5 && sum1.deductions.pf === 1800 && sum1.deductions.pt > 0 && sum1.total_deductions === p1.total_deductions, sum1 || r.d);
  r = await get(`/payroll/monthly-summary/${NEXT}`, admin);
  const sumNext = r.d?.employees?.find(x => x.employee_uid === e1.employee_id);
  check('no run yet: preview from the engine (statutory deductions, nothing saved)', r.s === 200 && r.d.source === 'preview' && sumNext?.deductions.pf === 1800 && sumNext.statutory_deductions > 0 && sumNext.period === 'future' && sumNext.unmarked_days === 0, sumNext || r.d);
  const previewRuns = await withDb(db => db.collection('payroll_runs').countDocuments({ month: NEXT }));
  check('preview does not create a run', previewRuns === 0, previewRuns);
  r = await get(`/payroll/monthly-summary/${CUR}`, admin);
  const sumCur = r.d?.employees?.find(x => x.employee_uid === e1.employee_id);
  check('current month: attendance counted only up to yesterday', r.s === 200 && sumCur?.period === 'in_progress' && sumCur.elapsed_days < daysIn(CUR) && sumCur.payable_days_to_date <= sumCur.elapsed_days, sumCur || r.d);
  r = await get('/payroll/monthly-summary/2026-13', admin);
  check('summary validates month', r.s === 422, r);

  const sumNet = r2(runData.payslips.reduce((s, p) => s + p.net_pay, 0));
  check('run totals = sum of payslips', near(runData.totals.net, sumNet) && runData.employee_count === runData.payslips.length && runData.totals.employer_cost > runData.totals.net, runData.totals);
  r = await get('/v2/payroll/runs', admin);
  check('run listed', r.s === 200 && r.d.some(x => x.id === runId), r.d);
  r = await get(`/v2/payroll/runs/${runId}`, e1.token);
  check('employee cannot open a run', r.s === 403, r);
  r = await get(`/v2/payroll/payslips/${p1.id}`, e1.token);
  check('employee cannot see a draft payslip', r.s === 404, r);
  r = await get('/v2/payroll/my/payslips', e1.token);
  check('My Payslips excludes drafts', r.s === 200 && r.d.length === 0, r.d);

  section('PY-8 One-off earnings and deductions');
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, admin, { employee_uid: e1.employee_id, type: 'perk', amount: 100 });
  check('invalid type rejected', r.s === 422, r);
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, admin, { employee_uid: e1.employee_id, type: 'bonus', amount: -5 });
  check('negative amount rejected', r.s === 422, r);
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, e1.token, { employee_uid: e1.employee_id, type: 'bonus', amount: 100000 });
  check('employee cannot add adjustments', r.s === 403, r);
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, admin, { employee_uid: 'NOPE', type: 'bonus', amount: 100 });
  check('unknown employee → 404', r.s === 404, r);
  const grossBefore = p1.gross_earnings;
  const tdsBefore = p1.tax.monthly_tds;
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, admin, { employee_uid: e1.employee_id, type: 'bonus', label: 'Diwali bonus', amount: 50000, taxable: true });
  check('bonus added and payslip recomputed', r.s === 201 && r.d.payslip.gross_earnings === r2(grossBefore + 50000) && r.d.payslip.earnings.some(e => e.name === 'Diwali bonus'), r.d?.payslip?.earnings);
  check('taxable bonus raises TDS', r.d?.payslip?.tax?.monthly_tds > tdsBefore, r.d?.payslip?.tax);
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, admin, { employee_uid: e1.employee_id, type: 'arrears', amount: 2000, taxable: false });
  check('non-taxable arrears excluded from taxable gross', r.s === 201 && r.d.payslip.taxable_gross === r2(r.d.payslip.gross_earnings - 2000 - r.d.payslip.lop_amount), r.d?.payslip);
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, admin, { employee_uid: e1.employee_id, type: 'other_deduction', label: 'Canteen', amount: 750 });
  check('one-off deduction added', r.s === 201 && r.d.payslip.deductions.some(d => d.name === 'Canteen' && d.amount === 750), r.d?.payslip?.deductions);
  const canteenId = r.d?.adjustment?.id;
  r = await del(`/v2/payroll/runs/${runId}/adjustments/${canteenId}`, admin);
  check('adjustment removed while draft', r.s === 200 && !r.d.payslip.deductions.some(d => d.name === 'Canteen'), r.d);
  r = await get(`/v2/payroll/runs/${runId}/adjustments`, admin);
  check('adjustments listed', r.s === 200 && r.d.length === 2, r.d);

  section('PY-3 Recompute, lock and pay');
  r = await post(`/v2/payroll/runs/${runId}/recompute`, admin);
  runData = r.d;
  p1 = slip1();
  check('recompute keeps adjustments', r.s === 200 && p1.earnings.some(e => e.name === 'Diwali bonus'), p1?.earnings);
  check('recompute never double-deducts EMI', p1.loan_deductions.length === 1 && p1.deductions.filter(d => d.type === 'loan').length === 1, p1.deductions);
  let loanNow = await get(`/v2/payroll/loans/${loan1.id}`, admin);
  check('draft runs do not touch loan balances', loanNow.d.outstanding === 12000 && loanNow.d.repayments.length === 0, loanNow.d);
  r = await post(`/v2/payroll/runs/${runId}/publish`, admin);
  check('cannot publish a draft', r.s === 409, r);
  r = await get(`/v2/payroll/runs/${runId}/ecr`, admin);
  check('statutory files need a locked run', r.s === 409, r);

  // Loan balance changes after computing → lock must refuse
  r = await post(`/v2/payroll/loans/${loan2.id}/prepay`, admin, { amount: 1000, note: 'Cash' });
  check('admin records a prepayment', r.s === 200 && r.d.outstanding === 2000, r.d);
  r = await post(`/v2/payroll/runs/${runId}/lock`, admin);
  check('lock refused when loan balances changed since compute', r.s === 409 && /recompute/i.test(r.d.detail), r.d);
  r = await post(`/v2/payroll/runs/${runId}/recompute`, admin);
  runData = r.d;
  check('recompute picks up the reduced advance balance', slip2().loan_deductions[0]?.amount === 2000, slip2()?.loan_deductions);
  r = await post(`/v2/payroll/runs/${runId}/lock`, e1.token);
  check('employee cannot lock', r.s === 403, r);
  r = await post(`/v2/payroll/runs/${runId}/pay`, admin, {});
  check('cannot pay before locking', r.s === 409, r);
  const netBeforeLock = slip1().net_pay;
  r = await post(`/v2/payroll/runs/${runId}/lock`, admin);
  runData = r.d;
  check('lock', r.s === 200 && r.d.status === 'locked' && r.d.payslips.every(p => p.status === 'locked'), r.d?.status);
  loanNow = await get(`/v2/payroll/loans/${loan1.id}`, admin);
  check('EMI applied to the loan on lock', loanNow.d.outstanding === 9500 && loanNow.d.repayments.length === 1 && loanNow.d.repayments[0].run_id === runId, loanNow.d);
  r = await get(`/v2/payroll/loans/${loan2.id}`, admin);
  check('advance fully recovered → closed', r.d?.status === 'closed' && r.d.outstanding === 0, r.d);
  const enc = await withDb(db => db.collection('leave_encashments').findOne({ id: 'enc-1' }));
  check('leave encashment marked paid with the run id', enc.status === 'paid' && enc.payroll_run_id === runId, enc);
  r = await post(`/v2/payroll/runs/${runId}/lock`, admin);
  check('second lock → 409', r.s === 409, r);
  loanNow = await get(`/v2/payroll/loans/${loan1.id}`, admin);
  check('EMI not applied twice', loanNow.d.outstanding === 9500, loanNow.d);
  r = await post(`/v2/payroll/runs/${runId}/recompute`, admin);
  check('locked run cannot be recomputed', r.s === 409, r);
  r = await post(`/v2/payroll/runs/${runId}/adjustments`, admin, { employee_uid: e1.employee_id, type: 'bonus', amount: 10 });
  check('locked run rejects adjustments', r.s === 409, r);
  r = await del(`/v2/payroll/runs/${runId}/adjustments/${runData.payslips[0].adjustment_ids?.[0] || 'x'}`, admin);
  check('locked run rejects adjustment removal', r.s === 409, r);
  r = await del(`/v2/payroll/runs/${runId}`, admin);
  check('locked run cannot be deleted', r.s === 409, r);
  await post('/v2/payroll/revisions', admin, { employee_uid: e1.employee_id, effective_from: M, reason: 'Back-dated correction', basic_salary: 200000, components: DEFAULT_COMPONENTS });
  r = await get(`/v2/payroll/payslips/${slip1().id}`, admin);
  check('locked payslip is immutable (back-dated revision does not change it)', r.d?.net_pay === netBeforeLock && r.d.monthly_gross === 150000, r.d?.net_pay);

  section('PY-4 Payslip PDFs and publishing');
  r = await get(`/v2/payroll/payslips/${slip1().id}/pdf`, admin, { raw: true });
  check('admin downloads payslip PDF', r.s === 200 && r.headers.get('content-type') === 'application/pdf' && r.buf.slice(0, 4).toString() === '%PDF', r.s);
  r = await get(`/v2/payroll/payslips/${slip1().id}/pdf`, e1.token, { raw: true });
  check('employee downloads own locked payslip', r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', r.s);
  r = await get(`/v2/payroll/payslips/${slip1().id}/pdf`, e2.token, { raw: true });
  check('employee cannot download someone else\'s payslip', r.s === 404, r.s);
  r = await get(`/v2/payroll/payslips/${slip1().id}`, mgr.token);
  check('manager cannot open a non-team payslip', r.s === 404, r);
  // Regression: a manager WITH a team (Lata reports to Mona) still gets nothing payroll-wise for anyone but themself
  const lateSlip = runData.payslips.find(p => p.employee_uid === late.employee_id);
  r = await get(`/v2/payroll/payslips/${lateSlip.id}`, mgr.token);
  check("manager with a team cannot open their own report's payslip", r.s === 404, r);
  r = await get(`/v2/payroll/payslips/${lateSlip.id}/pdf`, mgr.token, { raw: true });
  check("manager with a team cannot download a report's payslip PDF", r.s === 404, r.s);
  r = await get(`/v2/payroll/runs/${runId}`, mgr.token);
  check("manager with a team cannot open payroll runs", r.s === 403, r);
  r = await get(`/v2/payroll/loans/${loan1.id}`, mgr.token);
  check("manager with a team cannot read another employee's loan", r.s === 404, r);
  r = await get(`/v2/payroll/form16/${late.employee_id}?fy=${FY}`, mgr.token);
  check("manager with a team cannot read a report's Form 16", r.s === 403, r);
  r = await get('/v2/payroll/my/payslips', e1.token);
  check('My Payslips lists locked slip', r.s === 200 && r.d.length === 1 && r.d[0].month === M, r.d);
  r = await post(`/v2/payroll/runs/${runId}/publish`, e1.token);
  check('employee cannot publish', r.s === 403, r);
  r = await post(`/v2/payroll/runs/${runId}/publish`, admin);
  check('publish (email skipped without Mailjet)', r.s === 200 && r.d.email_configured === false && r.d.payslips === runData.payslips.length, r.d);
  await sleep(800);
  const notes = await withDb(db => db.collection('notifications').countDocuments({ user_email: e1.email, type: 'payslip_published' }));
  check('in-app notification created on publish', notes === 1, notes);
  r = await get('/v2/payroll/my/summary', e1.token);
  check('employee summary shows latest payslip and loans', r.s === 200 && r.d.latest_payslip?.month === M && r.d.loans.length === 1, r.d);

  section('PY-3 Mark paid');
  r = await post(`/v2/payroll/runs/${runId}/pay`, admin, { payment_reference: 'UTR123' });
  check('mark paid', r.s === 200 && r.d.status === 'paid' && r.d.payment_reference === 'UTR123' && r.d.payslips.every(p => p.status === 'paid'), r.d?.status);
  r = await post(`/v2/payroll/runs/${runId}/pay`, admin, {});
  check('cannot pay twice', r.s === 409, r);
  r = await get('/v2/payroll/dashboard', admin);
  check('admin dashboard summary', r.s === 200 && r.d.recent_runs.some(x => x.id === runId), r.d);
  r = await get('/v2/payroll/dashboard', e1.token);
  check('employee cannot see payroll dashboard', r.s === 403, r);

  // ================================================================
  section('PY-6 Statutory files and Form 16');
  r = await get(`/v2/payroll/runs/${runId}/ecr`, admin, { raw: true });
  const ecrText = r.buf?.toString() || '';
  const ecrLine = ecrText.split('\n').find(l => l.startsWith('100200300400'));
  const ecrFields = ecrLine?.split('#~#') || [];
  check('ECR file has one line per PF member with UAN', r.s === 200 && !!ecrLine && ecrFields.length === 11, ecrText);
  check('ECR values: EPF/EPS/EDLI wages 15000, EE 1800, EPS 1250, ER 550, NCP 5', ecrFields[3] === '15000' && ecrFields[4] === '15000' && ecrFields[5] === '15000' && ecrFields[6] === '1800' && ecrFields[7] === '1250' && ecrFields[8] === '550' && ecrFields[9] === '5', ecrFields);
  r = await get(`/v2/payroll/runs/${runId}/esi`, admin, { raw: true });
  const esiText = r.buf?.toString() || '';
  check('ESI CSV lists only covered employees', r.s === 200 && esiText.includes('3100123456') && !esiText.includes('Priya Payroll'), esiText);
  r = await get(`/v2/payroll/runs/${runId}/pt`, admin, { raw: true });
  check('PT summary CSV', r.s === 200 && r.buf.toString().includes('Professional Tax') && r.buf.toString().includes('Priya Payroll'), r.s);
  r = await get(`/v2/payroll/runs/${runId}/compliance`, admin);
  check('compliance report lists missing bank details', r.s === 200 && r.d.missing_bank.some(x => x.employee_uid === e2.employee_id) && !r.d.missing_bank.some(x => x.employee_uid === e1.employee_id), r.d);
  r = await get(`/v2/payroll/runs/${runId}/ecr`, e1.token);
  check('employee cannot download ECR', r.s === 403, r);
  r = await get(`/v2/payroll/form16?fy=${FY}`, admin);
  check('Form 16 list for the FY', r.s === 200 && r.d.some(x => x.employee_uid === e1.employee_id && x.months === 1), r.d);
  r = await get(`/v2/payroll/form16/${e1.employee_id}?fy=${FY}`, admin);
  check('Form 16 data: TDS deducted matches payslips', r.s === 200 && r.d.tds_deducted === slip1().tax.monthly_tds && r.d.regime === 'old' && r.d.gross_salary === slip1().taxable_gross, r.d);
  r = await get(`/v2/payroll/form16/${e1.employee_id}/pdf?fy=${FY}`, admin, { raw: true });
  check('Form 16 Part B PDF', r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', r.s);
  r = await get(`/v2/payroll/my/form16/pdf?fy=${FY}`, e1.token, { raw: true });
  check('employee downloads own Form 16', r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', r.s);
  r = await get(`/v2/payroll/form16/${e1.employee_id}?fy=${FY}`, e2.token);
  check('employee cannot read another Form 16', r.s === 403, r);
  r = await get('/v2/payroll/my/form16?fy=2001-02', e1.token);
  check('FY without locked payslips → 404', r.s === 404, r);
  r = await get('/v2/payroll/my/form16?fy=2001-05', e1.token);
  check('FY format validated', r.s === 422, r);

  section('PY-10 Bank transfer file');
  r = await get(`/v2/payroll/runs/${runId}/bank-file`, admin, { raw: true });
  const bank = r.buf?.toString() || '';
  check('standard bank CSV with beneficiary, account, IFSC, amount, narration', r.s === 200 && bank.startsWith('Beneficiary Name,Account Number,IFSC,Amount,Narration') && bank.includes(`50100012345678,HDFC0001234,${slip1().net_pay.toFixed(2)}`), bank);
  check('employees without bank details left out and counted', r.headers.get('x-missing-bank') === '2' && !bank.includes('Ravi Lowwage'), r.headers.get('x-missing-bank'));
  r = await get(`/v2/payroll/runs/${runId}/bank-file?format=hdfc`, admin, { raw: true });
  const hdfc = r.buf?.toString() || '';
  check('HDFC bulk upload variant (internal transfer for HDFC IFSC)', r.s === 200 && hdfc.startsWith('Transaction Type,') && hdfc.split('\r\n')[1]?.startsWith('I,'), hdfc.slice(0, 300));
  r = await get(`/v2/payroll/runs/${runId}/bank-file`, mgr.token);
  check('manager cannot download bank file', r.s === 403, r);
  r = await post('/v2/payroll/runs', admin, { month: CUR });
  const draftId = r.d?.id;
  r = await get(`/v2/payroll/runs/${draftId}/bank-file`, admin);
  check('bank file needs a locked run', r.s === 409, r);
  r = await get(`/v2/payroll/runs/${runId}/register`, admin, { raw: true });
  check('payroll register CSV export', r.s === 200 && r.buf.toString().startsWith('Employee Code,Name'), r.s);

  // ================================================================
  section('PY-9 Gratuity');
  let g = computeGratuity({ basicMonthly: 26000, joiningDate: '2015-01-01', exitDate: '2025-08-01' });
  check('10y 7m rounds up to 11 years: 15/26 × 26000 × 11', g.eligible && g.years === 11 && g.amount === 165000, g);
  g = computeGratuity({ basicMonthly: 26000, joiningDate: '2015-01-01', exitDate: '2020-05-31' });
  check('5y 4m → 5 years', g.eligible && g.years === 5 && g.amount === 75000, g);
  g = computeGratuity({ basicMonthly: 26000, joiningDate: '2020-01-01', exitDate: '2024-12-01' });
  check('under 5 years → not eligible', !g.eligible && g.amount === 0, g);
  g = computeGratuity({ basicMonthly: 500000, joiningDate: '1990-01-01', exitDate: '2025-01-01' });
  check('capped at ₹20,00,000', g.amount === 2000000 && g.capped, g);
  r = await post('/v2/payroll/gratuity/calculate', admin, { basic_monthly: 52000, joining_date: '2010-04-01', exit_date: '2025-03-31' });
  check('calculator endpoint', r.s === 200 && r.d.years === 15 && r.d.amount === 450000, r.d);
  r = await post('/v2/payroll/gratuity/calculate', admin, { employee_uid: e1.employee_id, exit_date: '2026-03-31' });
  check('employee-based: basic from structure, joining date from profile', r.s === 200 && r.d.basic_monthly === 100000 && r.d.eligible && r.d.years === 6, r.d);
  r = await post('/v2/payroll/gratuity/calculate', admin, { basic_monthly: 'x', joining_date: '2010-04-01' });
  check('calculator validates input', r.s === 422, r);
  r = await post('/v2/payroll/gratuity/calculate', e1.token, { basic_monthly: 1000, joining_date: '2010-04-01' });
  check('employee cannot use the gratuity calculator', r.s === 403, r);
});
