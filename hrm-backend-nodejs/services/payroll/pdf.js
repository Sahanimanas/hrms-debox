/**
 * PDF builders: salary slip (PY-4) and Form 16 Part B (PY-6).
 * The standard PDF fonts have no ₹ glyph, so amounts are printed as "Rs.".
 */

const PDFDocument = require('pdfkit');
const { amountInWords } = require('./statutory');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (month) => `${MONTHS[parseInt(month.slice(5, 7), 10) - 1]} ${month.slice(0, 4)}`;
const money = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateStr = (d) => {
  if (!d) return '-';
  const v = new Date(d);
  return isNaN(v) ? '-' : v.toISOString().slice(0, 10);
};

const COLORS = { dark: '#1e293b', muted: '#64748b', line: '#e2e8f0', band: '#f1f5f9', accent: '#0f172a' };

function toBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Producer: 'Xeno-HR', Creator: 'Xeno-HR' } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function header(doc, company, title, subtitle) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.rect(left, 40, width, 64).fill(COLORS.accent);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(company.name || 'Xeno-HR', left + 14, 52, { width: width - 28 });
  if (company.address) doc.font('Helvetica').fontSize(8.5).fillColor('#cbd5e1').text(company.address, left + 14, 74, { width: width - 28 });
  doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(13).text(title, left, 118, { width, align: 'center' });
  if (subtitle) doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.muted).text(subtitle, left, 135, { width, align: 'center' });
  doc.y = 156;
}

/** Two-column key/value grid. rows: [[label, value], …] */
function infoGrid(doc, rows) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const colW = width / 2;
  const rowH = 17;
  const top = doc.y;
  const lines = Math.ceil(rows.length / 2);
  doc.rect(left, top, width, lines * rowH + 8).fill(COLORS.band);
  rows.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = left + 10 + col * colW;
    const y = top + 6 + row * rowH;
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(label, x, y, { width: 95 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.dark).text(String(value ?? '-'), x + 98, y, { width: colW - 115, ellipsis: true, lineBreak: false });
  });
  doc.y = top + lines * rowH + 18;
}

/** Side-by-side earnings / deductions table. */
function twoColumnTable(doc, leftTitle, leftRows, rightTitle, rightRows, leftTotal, rightTotal) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const half = width / 2;
  const rowH = 18;
  let y = doc.y;

  const headerRow = (x, title) => {
    doc.rect(x, y, half - 4, rowH + 2).fill(COLORS.dark);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(title, x + 8, y + 6, { width: half - 100 });
    doc.text('Amount', x + half - 104, y + 6, { width: 90, align: 'right' });
  };
  headerRow(left, leftTitle);
  headerRow(left + half + 4, rightTitle);
  y += rowH + 2;

  const count = Math.max(leftRows.length, rightRows.length, 1);
  for (let i = 0; i < count; i++) {
    if (y > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; }
    [[left, leftRows[i]], [left + half + 4, rightRows[i]]].forEach(([x, row]) => {
      doc.moveTo(x, y + rowH).lineTo(x + half - 4, y + rowH).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      if (!row) return;
      doc.fillColor(COLORS.dark).font('Helvetica').fontSize(8.5).text(row[0], x + 8, y + 5, { width: half - 110, ellipsis: true, lineBreak: false });
      doc.text(num(row[1]), x + half - 104, y + 5, { width: 90, align: 'right' });
    });
    y += rowH;
  }
  [[left, leftTitle.startsWith('Earn') ? 'Gross Earnings' : 'Total', leftTotal], [left + half + 4, 'Total Deductions', rightTotal]].forEach(([x, label, total]) => {
    doc.rect(x, y, half - 4, rowH + 2).fill(COLORS.band);
    doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(9).text(label, x + 8, y + 6, { width: half - 110 });
    doc.text(num(total), x + half - 104, y + 6, { width: 90, align: 'right' });
  });
  doc.y = y + rowH + 14;
}

function footer(doc, text) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
    .text(text, left, doc.page.height - 60, { width, align: 'center', lineBreak: true });
}

function buildPayslipPdf(payslip, company = {}) {
  return toBuffer((doc) => {
    header(doc, company, 'SALARY SLIP', `For the month of ${monthLabel(payslip.month)}`);

    infoGrid(doc, [
      ['Employee Name', payslip.employee_name],
      ['Employee Code', payslip.employee_code || payslip.employee_uid],
      ['Department', payslip.department || '-'],
      ['Designation', payslip.designation || '-'],
      ['Date of Joining', dateStr(payslip.joining_date)],
      ['PAN', payslip.pan || '-'],
      ['UAN', payslip.uan || '-'],
      ['ESIC No.', payslip.esic_number || '-'],
      ['Bank', payslip.bank_name ? `${payslip.bank_name}${payslip.bank_account_last4 ? ` (xx${payslip.bank_account_last4})` : ''}` : '-'],
      ['Tax Regime', payslip.tax_regime === 'old' ? 'Old regime' : 'New regime'],
      ['Days in Month', payslip.days_in_month],
      ['Paid Days', payslip.payable_days],
      ['LOP Days', payslip.lop_days],
      ['LOP Amount', money(payslip.lop_amount)]
    ]);

    twoColumnTable(
      doc,
      'Earnings', (payslip.earnings || []).map(e => [e.name, e.amount]),
      'Deductions', (payslip.deductions || []).map(d => [d.name, d.amount]),
      payslip.gross_earnings, payslip.total_deductions
    );

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    let y = doc.y;
    doc.rect(left, y, width, 46).fill(COLORS.accent);
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(9).text('NET PAY', left + 12, y + 8);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(money(payslip.net_pay), left + 12, y + 21);
    doc.fillColor('#e2e8f0').font('Helvetica').fontSize(8.5).text(amountInWords(payslip.net_pay), left + 200, y + 16, { width: width - 212, align: 'right' });
    doc.y = y + 60;

    const ec = payslip.employer_contributions || {};
    const contributions = [
      ['Provident Fund (EPF)', ec.epf], ['Pension (EPS)', ec.eps], ['EDLI', ec.edli],
      ['PF Admin Charges', ec.pf_admin], ['ESI (Employer)', ec.esi], ['LWF (Employer)', ec.lwf]
    ].filter(([, v]) => v > 0);
    if (contributions.length) {
      doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(10).text('Employer Contributions (not part of net pay)', left, doc.y);
      doc.moveDown(0.3);
      y = doc.y;
      contributions.forEach(([label, value], i) => {
        const x = left + (i % 3) * (width / 3);
        const yy = y + Math.floor(i / 3) * 16;
        doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(label, x, yy, { width: 100 });
        doc.font('Helvetica-Bold').fillColor(COLORS.dark).text(num(value), x + 100, yy, { width: width / 3 - 110 });
      });
      doc.y = y + Math.ceil(contributions.length / 3) * 16 + 10;
    }

    if (payslip.tax) {
      doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(10).text('Income Tax Projection', left, doc.y);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(
        `Projected annual taxable income ${money(payslip.tax.taxable_income)} · Annual tax ${money(payslip.tax.annual_tax)} · ` +
        `TDS deducted earlier this FY ${money(payslip.tax.tds_deducted_before)} · Remaining months ${payslip.tax.remaining_months}`,
        left, doc.y, { width }
      );
    }

    footer(doc, 'This is a computer-generated salary slip and does not require a signature.');
  });
}

/**
 * Form 16 Part B style statement. `data` comes from buildForm16Data() in the router.
 */
function buildForm16Pdf(data, company = {}) {
  return toBuffer((doc) => {
    const fyStart = parseInt(data.financial_year.slice(0, 4), 10);
    header(doc, company, 'FORM NO. 16 — PART B', `Details of salary paid and tax deducted · FY ${data.financial_year} (AY ${fyStart + 1}-${String((fyStart + 2) % 100).padStart(2, '0')})`);

    infoGrid(doc, [
      ['Employer', company.name || 'Xeno-HR'],
      ['Employer TAN', company.tan || '-'],
      ['Employer PAN', company.pan || '-'],
      ['Employee', data.employee_name],
      ['Employee PAN', data.pan || 'PANNOTAVBL'],
      ['Employee Code', data.employee_code || data.employee_uid],
      ['Designation', data.designation || '-'],
      ['Period', `${data.period_from} to ${data.period_to}`],
      ['Tax Regime', data.regime === 'old' ? 'Old regime' : 'New regime (115BAC)'],
      ['Months Paid', data.months.length]
    ]);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const t = data.tax;
    const rows = [
      ['1', 'Gross salary — salary as per section 17(1)', data.gross_salary, true],
      ['2', 'Less: allowances exempt under section 10', null, true],
      ['', '    House rent allowance — 10(13A)', t.exemptions.hra],
      ['3', 'Total amount of salary received from current employer (1 − 2)', data.gross_salary - t.exemptions.hra, true],
      ['4', 'Less: deductions under section 16', null, true],
      ['', '    Standard deduction — 16(ia)', t.exemptions.standard_deduction],
      ['', '    Tax on employment — 16(iii)', t.exemptions.professional_tax],
      ['5', 'Income chargeable under the head "Salaries"', data.gross_salary - t.exemptions.hra - t.exemptions.standard_deduction - t.exemptions.professional_tax, true],
      ['6', 'Deductions under Chapter VI-A', null, true],
      ...Object.entries(t.deductions.breakdown || {}).map(([section, amount]) => ['', `    ${data.section_labels?.[section] || section}`, amount]),
      ['7', 'Aggregate of deductions under Chapter VI-A', t.deductions.total, true],
      ['8', 'Total taxable income', t.taxable_income, true],
      ['9', 'Tax on total income', t.tax_on_income],
      ['10', 'Rebate under section 87A', t.rebate],
      ['11', 'Surcharge', t.surcharge],
      ['12', 'Health and education cess', t.cess],
      ['13', 'Tax payable', t.total, true],
      ['14', 'Tax deducted at source (TDS)', data.tds_deducted, true],
      ['15', data.tds_deducted >= t.total ? 'Excess tax deducted (refundable)' : 'Balance tax payable', Math.abs(t.total - data.tds_deducted), true]
    ];

    let y = doc.y;
    doc.rect(left, y, width, 18).fill(COLORS.dark);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5).text('#', left + 6, y + 5).text('Particulars', left + 30, y + 5).text('Amount (Rs.)', left + width - 130, y + 5, { width: 120, align: 'right' });
    y += 18;
    for (const [no, label, amount, bold] of rows) {
      if (y > doc.page.height - 90) { doc.addPage(); y = doc.page.margins.top; }
      doc.moveTo(left, y + 16).lineTo(left + width, y + 16).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      doc.fillColor(COLORS.dark).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(no, left + 6, y + 4, { width: 20 })
        .text(label, left + 30, y + 4, { width: width - 170 });
      if (amount != null) doc.text(num(amount), left + width - 130, y + 4, { width: 120, align: 'right' });
      y += 16;
    }
    doc.y = y + 14;

    if (y > doc.page.height - 200) { doc.addPage(); doc.y = doc.page.margins.top; }
    doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(10).text('Monthly salary and TDS', left, doc.y);
    y = doc.y + 6;
    doc.rect(left, y, width, 16).fill(COLORS.band);
    doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(8)
      .text('Month', left + 6, y + 4).text('Taxable salary', left + 160, y + 4, { width: 120, align: 'right' }).text('TDS', left + 300, y + 4, { width: 120, align: 'right' });
    y += 16;
    for (const m of data.months) {
      if (y > doc.page.height - 80) { doc.addPage(); y = doc.page.margins.top; }
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.dark)
        .text(monthLabel(m.month), left + 6, y + 3)
        .text(num(m.taxable_gross), left + 160, y + 3, { width: 120, align: 'right' })
        .text(num(m.tds), left + 300, y + 3, { width: 120, align: 'right' });
      y += 14;
    }
    doc.y = y + 10;
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(
      `Tax payable in words: ${amountInWords(t.total)}. Generated from locked payroll records; verify against TRACES Part A before issuing.`,
      left, doc.y, { width }
    );
    footer(doc, 'Computer-generated statement of salary and tax deducted (Form 16 Part B format).');
  });
}

module.exports = { buildPayslipPdf, buildForm16Pdf, monthLabel, money };
