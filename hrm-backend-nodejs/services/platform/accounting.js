/**
 * Accounting export of payroll (PL-6): builds one summarised journal for a
 * month from `payslips` and renders it as
 *   - a Tally (TallyPrime / ERP 9) XML import file with a Journal voucher
 *   - a Zoho Books manual-journal import CSV
 *
 * Journal (amounts rounded to 2 decimals):
 *   Dr  Salaries & Wages            gross earnings (per earning component)
 *   Dr  Employer PF / ESI expense   employer contributions
 *     Cr  <deduction> Payable       employee deductions (PF, ESI, TDS, PT, …)
 *     Cr  PF / ESI Payable          employer contributions
 *     Cr  Salary Payable            net pay
 */

const LEDGERS = {
  salary: 'Salaries & Wages',
  employerPfExpense: 'Employer PF Contribution',
  employerEsiExpense: 'Employer ESI Contribution',
  pfPayable: 'PF Payable',
  esiPayable: 'ESI Payable',
  salaryPayable: 'Salary Payable'
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Map a deduction component name to a liability ledger. */
function deductionLedger(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(pf|epf|provident)\b/.test(n)) return LEDGERS.pfPayable;
  if (/\besi\b|esic/.test(n)) return LEDGERS.esiPayable;
  if (/tds|income tax/.test(n)) return 'TDS Payable';
  if (/professional tax|\bpt\b/.test(n)) return 'Professional Tax Payable';
  if (/lwf|labour welfare/.test(n)) return 'LWF Payable';
  if (/loan|advance|emi/.test(n)) return 'Employee Loans & Advances';
  return `${String(name || 'Other deductions').trim()} Payable`.slice(0, 80);
}

/**
 * Summarise payslips into journal lines. Returns null when there are no payslips.
 * { month, employees, lines: [{ ledger, debit, credit }], totals: { debit, credit, gross, deductions, net } }
 */
async function buildJournal(db, month) {
  const payslips = await db.collection('payslips')
    .find({ month, status: { $nin: ['draft', 'cancelled', 'void'] } }, { projection: { _id: 0 } })
    .toArray();
  if (!payslips.length) return null;

  const debit = new Map();
  const credit = new Map();
  const add = (map, ledger, amount) => {
    const a = round2(amount);
    if (a) map.set(ledger, round2((map.get(ledger) || 0) + a));
  };
  let gross = 0;
  let deductions = 0;
  let net = 0;

  for (const p of payslips) {
    const earnings = Array.isArray(p.earnings) && p.earnings.length ? p.earnings : [{ name: 'Salary', amount: p.gross_earnings }];
    const earnTotal = earnings.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    // Book earnings to one salary ledger; keep the gross consistent with payslip totals
    add(debit, LEDGERS.salary, p.gross_earnings != null ? p.gross_earnings : earnTotal);
    gross += Number(p.gross_earnings ?? earnTotal) || 0;

    const deds = Array.isArray(p.deductions) ? p.deductions : [];
    let dedTotal = 0;
    for (const d of deds) {
      add(credit, deductionLedger(d.name), d.amount);
      dedTotal += Number(d.amount) || 0;
    }
    const declared = Number(p.total_deductions);
    if (Number.isFinite(declared) && round2(declared - dedTotal) > 0) add(credit, 'Other Deductions Payable', declared - dedTotal);
    deductions += Number.isFinite(declared) ? declared : dedTotal;

    const pf = Number(p.employer_contributions?.pf) || 0;
    const esi = Number(p.employer_contributions?.esi) || 0;
    add(debit, LEDGERS.employerPfExpense, pf);
    add(credit, LEDGERS.pfPayable, pf);
    add(debit, LEDGERS.employerEsiExpense, esi);
    add(credit, LEDGERS.esiPayable, esi);

    add(credit, LEDGERS.salaryPayable, p.net_pay);
    net += Number(p.net_pay) || 0;
  }

  // Balance any rounding / data gap against Salary Payable so the voucher always balances
  const sum = (m) => round2([...m.values()].reduce((s, v) => s + v, 0));
  const diff = round2(sum(debit) - sum(credit));
  if (diff !== 0) add(credit, LEDGERS.salaryPayable, diff);

  const lines = [
    ...[...debit.entries()].map(([ledger, amount]) => ({ ledger, debit: amount, credit: 0 })),
    ...[...credit.entries()].filter(([, amount]) => amount !== 0).map(([ledger, amount]) => ({ ledger, debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0 }))
  ];
  return {
    month,
    employees: payslips.length,
    lines,
    totals: {
      debit: round2(lines.reduce((s, l) => s + l.debit, 0)),
      credit: round2(lines.reduce((s, l) => s + l.credit, 0)),
      gross: round2(gross),
      deductions: round2(deductions),
      net: round2(net)
    }
  };
}

const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const lastDayOfMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Tally XML import (Import Data → Vouchers) with one Journal voucher. */
function toTallyXml(journal, { company = '' } = {}) {
  const date = lastDayOfMonth(journal.month).replace(/-/g, '');
  const narration = `Salary for ${journal.month} (${journal.employees} employees) — exported from Xeno-HR`;
  // Tally: debit lines are ISDEEMEDPOSITIVE=Yes with negative AMOUNT; credits positive.
  const entries = journal.lines.map(l => {
    const isDebit = l.debit > 0;
    const amount = isDebit ? -l.debit : l.credit;
    return [
      '          <ALLLEDGERENTRIES.LIST>',
      `            <LEDGERNAME>${xml(l.ledger)}</LEDGERNAME>`,
      `            <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
      `            <AMOUNT>${amount.toFixed(2)}</AMOUNT>`,
      '          </ALLLEDGERENTRIES.LIST>'
    ].join('\n');
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '  <HEADER>',
    '    <TALLYREQUEST>Import Data</TALLYREQUEST>',
    '  </HEADER>',
    '  <BODY>',
    '    <IMPORTDATA>',
    '      <REQUESTDESC>',
    '        <REPORTNAME>Vouchers</REPORTNAME>',
    company ? `        <STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : null,
    '      </REQUESTDESC>',
    '      <REQUESTDATA>',
    '        <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `        <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `          <DATE>${date}</DATE>`,
    `          <EFFECTIVEDATE>${date}</EFFECTIVEDATE>`,
    '          <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>',
    `          <VOUCHERNUMBER>PAY-${journal.month}</VOUCHERNUMBER>`,
    `          <NARRATION>${xml(narration)}</NARRATION>`,
    entries,
    '        </VOUCHER>',
    '        </TALLYMESSAGE>',
    '      </REQUESTDATA>',
    '    </IMPORTDATA>',
    '  </BODY>',
    '</ENVELOPE>',
    ''
  ].filter(l => l !== null).join('\n');
}

/** Zoho Books manual journal import CSV. */
function toZohoCsv(journal, { currency = 'INR' } = {}) {
  const { toCsv } = require('./common');
  const date = lastDayOfMonth(journal.month);
  const rows = journal.lines.map(l => ({
    date,
    ref: `PAY-${journal.month}`,
    notes: `Salary for ${journal.month} (${journal.employees} employees)`,
    type: 'both',
    currency,
    account: l.ledger,
    description: `Payroll ${journal.month}`,
    debit: l.debit ? l.debit.toFixed(2) : '',
    credit: l.credit ? l.credit.toFixed(2) : ''
  }));
  return toCsv(rows, [
    { label: 'Journal Date', key: 'date' },
    { label: 'Reference Number', key: 'ref' },
    { label: 'Notes', key: 'notes' },
    { label: 'Journal Type', key: 'type' },
    { label: 'Currency', key: 'currency' },
    { label: 'Account', key: 'account' },
    { label: 'Description', key: 'description' },
    { label: 'Debit', key: 'debit' },
    { label: 'Credit', key: 'credit' }
  ]) + '\r\n';
}

module.exports = { buildJournal, toTallyXml, toZohoCsv, deductionLedger, LEDGERS };
