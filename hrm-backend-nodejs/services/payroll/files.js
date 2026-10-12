/**
 * Statutory and bank files built from a run's payslips (PY-6, PY-10).
 */

const { roundRupee, round2 } = require('./statutory');
const { monthLabel } = require('./pdf');

const cell = (value) => {
  if (value == null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (header, rows) => [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';

const earnedGross = (p) => round2((p.gross_earnings || 0) - (p.lop_amount || 0));

/**
 * EPFO ECR 2.0 text file (one line per member, fields separated by #~#):
 * UAN, Name, Gross wages, EPF wages, EPS wages, EDLI wages, EE share, EPS contribution, ER share, NCP days, Refund
 */
function buildEcr(payslips, statutoryByUid) {
  const lines = [];
  const missing = [];
  for (const p of payslips) {
    if (!p.statutory?.pf_employee) continue;
    const uan = statutoryByUid[p.employee_uid]?.uan || p.uan;
    if (!uan) { missing.push({ employee_uid: p.employee_uid, employee_name: p.employee_name }); continue; }
    const ercShare = (p.employer_contributions?.pf || 0) - (p.employer_contributions?.eps || 0);
    lines.push([
      uan,
      String(p.employee_name || '').toUpperCase().replace(/#~#/g, ' '),
      roundRupee(earnedGross(p)),
      roundRupee(p.statutory.pf_wage),
      roundRupee(p.statutory.eps_wage),
      roundRupee(p.statutory.edli_wage),
      roundRupee(p.statutory.pf_employee),
      roundRupee(p.employer_contributions?.eps),
      roundRupee(ercShare),
      Math.round(p.lop_days || 0),
      0
    ].join('#~#'));
  }
  return { text: lines.join('\n') + (lines.length ? '\n' : ''), included: lines.length, missing };
}

/** ESIC monthly contribution upload data. */
function buildEsiCsv(payslips, statutoryByUid) {
  const rows = [];
  const missing = [];
  for (const p of payslips) {
    if (!p.statutory?.esi_applicable) continue;
    const ip = statutoryByUid[p.employee_uid]?.esic_number || p.esic_number || '';
    if (!ip) missing.push({ employee_uid: p.employee_uid, employee_name: p.employee_name });
    rows.push([
      ip, p.employee_name, Math.max(0, Math.round((p.payable_days || 0) * 100) / 100), roundRupee(p.statutory.esi_wage),
      round2(p.statutory.esi_employee), round2(p.employer_contributions?.esi),
      p.lop_days >= p.basis_days ? 1 : 0, ''
    ]);
  }
  const csv = toCsv(
    ['IP Number', 'IP Name', 'No of Days for which wages paid', 'Total Monthly Wages', 'Employee Contribution', 'Employer Contribution', 'Reason Code for Zero working days', 'Last Working Day'],
    rows
  );
  return { csv, included: rows.length, missing };
}

/** Professional tax summary per employee with state totals. */
function buildPtCsv(payslips) {
  const rows = [];
  const byState = {};
  for (const p of payslips) {
    const pt = p.statutory?.pt || 0;
    rows.push([p.employee_code || p.employee_uid, p.employee_name, p.pt_state || '', round2(earnedGross(p)), round2(pt)]);
    const key = p.pt_state || 'NA';
    byState[key] = byState[key] || { employees: 0, amount: 0 };
    if (pt > 0) byState[key].employees += 1;
    byState[key].amount = round2(byState[key].amount + pt);
  }
  rows.push([]);
  for (const [state, s] of Object.entries(byState)) rows.push(['TOTAL', `State ${state}`, state, `${s.employees} employee(s) liable`, s.amount]);
  return { csv: toCsv(['Employee Code', 'Name', 'State', 'Gross Salary', 'Professional Tax'], rows), states: byState };
}

/**
 * Salary payout file. format: 'standard' | 'hdfc'
 * Employees without bank details are left out and returned in `missing`.
 */
function buildBankFile(payslips, statutoryByUid, { month, format = 'standard', paymentDate = new Date() } = {}) {
  const narration = `Salary ${monthLabel(month)}`;
  const rows = [];
  const missing = [];
  let total = 0;
  for (const p of payslips) {
    if (!(p.net_pay > 0)) continue;
    const st = statutoryByUid[p.employee_uid] || {};
    if (!st.bank_account_number || !st.ifsc) {
      missing.push({ employee_uid: p.employee_uid, employee_name: p.employee_name, employee_email: p.employee_email, net_pay: p.net_pay });
      continue;
    }
    total = round2(total + p.net_pay);
    if (format === 'hdfc') {
      const d = new Date(paymentDate);
      const dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      const type = String(st.ifsc).toUpperCase().startsWith('HDFC') ? 'I' : p.net_pay >= 200000 ? 'R' : 'N';
      rows.push([
        type, (p.employee_code || p.employee_uid).slice(0, 13), st.bank_account_number, p.net_pay.toFixed(2),
        (st.account_holder_name || p.employee_name || '').slice(0, 40), '', '', '', '', '', '', '',
        `SAL${month.replace('-', '')}`, (p.employee_code || '').slice(0, 20), narration.slice(0, 30), '', '', '', '', '', '',
        '', dd, '', String(st.ifsc).toUpperCase(), st.bank_name || '', '', p.employee_email || ''
      ]);
    } else {
      rows.push([st.account_holder_name || p.employee_name, st.bank_account_number, String(st.ifsc).toUpperCase(), p.net_pay.toFixed(2), narration, p.employee_code || '', p.employee_email || '']);
    }
  }
  const header = format === 'hdfc'
    ? ['Transaction Type', 'Beneficiary Code', 'Beneficiary Account Number', 'Instrument Amount', 'Beneficiary Name', 'Drawee Location', 'Print Location',
      'Bene Address 1', 'Bene Address 2', 'Bene Address 3', 'Bene Address 4', 'Bene Address 5', 'Instruction Reference Number', 'Customer Reference Number',
      'Payment details 1', 'Payment details 2', 'Payment details 3', 'Payment details 4', 'Payment details 5', 'Payment details 6', 'Payment details 7',
      'Cheque Number', 'Chq / Trn Date', 'MICR Number', 'IFC Code', 'Bene Bank Name', 'Bene Bank Branch Name', 'Beneficiary email id']
    : ['Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Narration', 'Employee Code', 'Email'];
  return { csv: toCsv(header, rows), included: rows.length, total, missing };
}

module.exports = { buildEcr, buildEsiCsv, buildPtCsv, buildBankFile, toCsv };
