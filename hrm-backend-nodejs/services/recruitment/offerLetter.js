/**
 * Offer letter PDF (pdfkit). Generated on demand from the offer document so it
 * always reflects the current terms.
 */

const PDFDocument = require('pdfkit');

const EMPLOYMENT_LABELS = {
  full_time: 'full-time',
  part_time: 'part-time',
  contract: 'contract',
  internship: 'internship',
  temporary: 'temporary'
};

const formatInr = (amount) =>
  `INR ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(amount) || 0)}`;

const longDate = (value) => {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * @param {{ offer: object, job?: object, companyName: string, issuedOn?: string }} params
 * @returns {Promise<Buffer>}
 */
function buildOfferLetterPdf({ offer, job, companyName, issuedOn }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `Offer letter - ${offer.candidate_name}`, Author: companyName, Subject: `Offer of employment: ${offer.designation}` }
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // Letterhead
    doc.rect(0, 0, doc.page.width, 8).fill('#facc15');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(20).text(companyName, left, 40);
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text('Human Resources', left, doc.y + 2);
    doc.moveTo(left, doc.y + 10).lineTo(left + width, doc.y + 10).lineWidth(0.5).strokeColor('#cbd5e1').stroke();

    doc.moveDown(2);
    doc.fillColor('#0f172a').font('Helvetica').fontSize(10);
    doc.text(`Date: ${longDate(issuedOn || offer.sent_at || offer.created_at)}`, { align: 'right' });
    doc.text(`Ref: OFR-${String(offer.id).slice(0, 8).toUpperCase()}`, { align: 'right' });

    doc.moveDown(1);
    doc.font('Helvetica-Bold').text(offer.candidate_name);
    doc.font('Helvetica').text(offer.candidate_email);

    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(13).text(`Offer of Employment — ${offer.designation}`);
    doc.moveDown(0.8);

    const firstName = String(offer.candidate_name || '').split(/\s+/)[0] || 'Candidate';
    const typeLabel = EMPLOYMENT_LABELS[job?.employment_type] || 'full-time';
    doc.font('Helvetica').fontSize(10.5).fillColor('#1e293b');
    const para = (text) => { doc.text(text, { align: 'justify', lineGap: 2 }); doc.moveDown(0.7); };

    para(`Dear ${firstName},`);
    para(`We are delighted to offer you the ${typeLabel} position of ${offer.designation} in the ${offer.department} department at ${companyName}. This letter sets out the principal terms of our offer.`);

    // Terms table
    const rows = [
      ['Designation', offer.designation],
      ['Department', offer.department],
      ['Work location', job?.location || '—'],
      ['Annual cost to company (CTC)', formatInr(offer.ctc)],
      ['Approximate monthly gross', formatInr(Math.round((offer.ctc / 12) * 100) / 100)],
      ['Date of joining', longDate(offer.joining_date)],
      ['Offer valid until', longDate(offer.expiry_date)]
    ];
    const tableTop = doc.y + 4;
    const labelWidth = 200;
    let y = tableTop;
    rows.forEach(([label, value], i) => {
      const rowHeight = 22;
      if (i % 2 === 0) doc.rect(left, y, width, rowHeight).fill('#f8fafc');
      doc.fillColor('#475569').font('Helvetica').fontSize(10).text(label, left + 10, y + 6, { width: labelWidth - 20 });
      doc.fillColor('#0f172a').font('Helvetica-Bold').text(String(value), left + labelWidth, y + 6, { width: width - labelWidth - 10 });
      y += rowHeight;
    });
    doc.rect(left, tableTop, width, y - tableTop).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    doc.x = left;
    doc.y = y + 16;

    doc.fillColor('#1e293b').font('Helvetica').fontSize(10.5);
    para('Your compensation is subject to applicable statutory deductions (PF, professional tax, income tax and others as applicable). A detailed salary break-up and appointment letter will be shared on joining.');
    para('This offer is contingent on satisfactory verification of your documents, references and background, and on your acceptance of the company\'s policies and code of conduct.');

    if (offer.notes) {
      doc.font('Helvetica-Bold').text('Additional terms');
      doc.moveDown(0.3);
      doc.font('Helvetica');
      para(offer.notes);
    }

    para(`Please confirm your acceptance by ${longDate(offer.expiry_date)}. After this date the offer will lapse unless extended in writing.`);
    para(`We look forward to welcoming you to ${companyName}.`);

    doc.moveDown(1.5);
    doc.text('Sincerely,');
    doc.moveDown(2);
    doc.font('Helvetica-Bold').text(offer.signatory_name || 'Human Resources');
    doc.font('Helvetica').fillColor('#64748b').text(`For ${companyName}`);

    doc.moveDown(3);
    doc.fillColor('#0f172a').font('Helvetica-Bold').text('Acceptance');
    doc.font('Helvetica').fillColor('#1e293b')
      .text(`I, ${offer.candidate_name}, accept the offer on the terms set out above.`);
    doc.moveDown(2);
    doc.text('Signature: ______________________________          Date: ________________');

    doc.end();
  });
}

module.exports = { buildOfferLetterPdf, formatInr, longDate };
