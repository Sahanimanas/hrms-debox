/**
 * PDF builders for the lifecycle module (pdfkit): letters and the full and
 * final settlement statement.
 */

const PDFDocument = require('pdfkit');

const toBuffer = (build) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });
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

// pdfkit's built-in Helvetica has no rupee glyph
const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (value) => {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// Footer line near the bottom edge without triggering an automatic page break
const footer = (doc, text) => {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(text, 56, doc.page.height - 40, { align: 'center', width: 483, lineBreak: false });
  doc.page.margins.bottom = bottom;
};

const header = (doc, company) => {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text(company.name || 'Company', { align: 'left' });
  if (company.address) doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(company.address);
  const y = doc.y + 6;
  doc.moveTo(56, y).lineTo(539, y).lineWidth(1).strokeColor('#e2e8f0').stroke();
  doc.moveDown(1.2);
  doc.fillColor('#0f172a');
};

/**
 * Letter PDF. `body` is plain text; blank lines separate paragraphs.
 */
const buildLetterPdf = ({ company, title, body, issueDate, reference }) => toBuffer((doc) => {
  header(doc, company);
  doc.font('Helvetica').fontSize(10).fillColor('#334155');
  if (reference) doc.text(`Ref: ${reference}`);
  doc.text(`Date: ${fmtDate(issueDate)}`);
  doc.moveDown(1.2);
  if (title) {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(title.toUpperCase(), { align: 'center', underline: true });
    doc.moveDown(1);
  }
  doc.font('Helvetica').fontSize(11).fillColor('#0f172a');
  const paragraphs = String(body || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const p of paragraphs) {
    doc.text(p.trim(), { align: 'justify', lineGap: 2 });
    doc.moveDown(0.8);
  }
  doc.moveDown(1.5);
  doc.font('Helvetica').fontSize(11).text('For ' + (company.name || 'the Company'));
  doc.moveDown(2.5);
  doc.text('Authorised Signatory');
  footer(doc, 'This is a system-generated document.');
});

/**
 * Full and final settlement statement.
 */
const buildSettlementPdf = ({ company, employee, separation, lines, totals, notes = [], generatedBy }) => toBuffer((doc) => {
  header(doc, company);
  doc.font('Helvetica-Bold').fontSize(14).text('Full and Final Settlement Statement', { align: 'center' });
  doc.moveDown(1);

  const rows = [
    ['Employee', `${employee.full_name} (${employee.employee_id || employee.employee_code || ''})`],
    ['Designation / Department', `${employee.designation || '—'} / ${employee.department || '—'}`],
    ['Date of joining', fmtDate(employee.joining_date)],
    ['Last working day', fmtDate(separation.last_working_day)],
    ['Separation type', separation.type === 'termination' ? 'Termination' : 'Resignation'],
    ['Reason', separation.reason || '—']
  ];
  doc.fontSize(10);
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor('#475569').text(k, 56, y, { width: 170 });
    doc.font('Helvetica').fillColor('#0f172a').text(v, 230, y, { width: 309 });
    doc.moveDown(0.3);
  }
  doc.moveDown(1);

  const table = (title, items) => {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(title, 56);
    doc.moveDown(0.3);
    if (!items.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#64748b').text('None', 56);
      doc.moveDown(0.6);
      return;
    }
    for (const l of items) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(l.label, 56, y, { width: 330 });
      const after = doc.y;
      doc.text(money(l.amount), 390, y, { width: 149, align: 'right' });
      if (l.detail) {
        doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(l.detail, 56, Math.max(after, doc.y), { width: 330 });
      }
      doc.y = Math.max(doc.y, after);
      doc.moveDown(0.3);
    }
    doc.moveDown(0.5);
  };

  table('Earnings', lines.filter(l => l.type === 'earning'));
  table('Deductions / recoveries', lines.filter(l => l.type === 'deduction'));

  const y = doc.y + 4;
  doc.moveTo(56, y).lineTo(539, y).strokeColor('#cbd5e1').stroke();
  doc.moveDown(0.8);
  const totalRow = (label, value, bold) => {
    const ty = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#0f172a').text(label, 56, ty, { width: 330 });
    doc.text(money(value), 390, ty, { width: 149, align: 'right' });
    doc.moveDown(0.3);
  };
  totalRow('Total earnings', totals.earnings);
  totalRow('Total deductions', totals.deductions);
  totalRow(totals.net >= 0 ? 'Net payable to employee' : 'Net recoverable from employee', Math.abs(totals.net), true);

  if (notes.length) {
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).text('Notes', 56);
    doc.font('Helvetica').fontSize(9).fillColor('#475569');
    notes.forEach(n => doc.text(`• ${n}`, 56));
  }

  doc.moveDown(3);
  doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
  const sy = doc.y;
  doc.text('Prepared by: ' + (generatedBy || 'HR'), 56, sy);
  doc.text('Employee signature', 390, sy, { width: 149, align: 'right' });
  footer(doc, `Generated on ${fmtDate(new Date())}. This is a system-generated statement.`);
});

module.exports = { buildLetterPdf, buildSettlementPdf, money, fmtDate };
