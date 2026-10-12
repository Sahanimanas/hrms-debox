/**
 * Report e-mail with a CSV attachment via Mailjet.
 * A no-op that returns false when MAILJET_API_KEY / MAILJET_API_SECRET /
 * MAILJET_FROM_EMAIL are not set (local dev, tests).
 */

const Mailjet = require('node-mailjet');

const isEmailConfigured = () =>
  !!(process.env.MAILJET_API_KEY && process.env.MAILJET_API_SECRET && process.env.MAILJET_FROM_EMAIL);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {{ to: string[], subject: string, html: string, attachment?: { filename: string, content: Buffer|string, contentType?: string } }} msg
 * @returns {Promise<boolean>} true when Mailjet accepted the message
 */
async function sendReportEmail({ to, subject, html, attachment }) {
  if (!isEmailConfigured()) return false;
  if (!Array.isArray(to) || !to.length) return false;

  const mailjet = Mailjet.apiConnect(process.env.MAILJET_API_KEY, process.env.MAILJET_API_SECRET);
  const message = {
    From: { Email: process.env.MAILJET_FROM_EMAIL, Name: process.env.MAILJET_FROM_NAME || 'Xeno-HR Reports' },
    To: to.map(Email => ({ Email })),
    Subject: subject,
    HTMLPart: html
  };
  if (attachment) {
    const buf = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(String(attachment.content), 'utf8');
    message.Attachments = [{
      ContentType: attachment.contentType || 'text/csv',
      Filename: attachment.filename,
      Base64Content: buf.toString('base64')
    }];
  }
  await mailjet.post('send', { version: 'v3.1' }).request({ Messages: [message] });
  return true;
}

const reportEmailHtml = ({ reportName, description, rowCount, truncated, generatedAt }) => `
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;max-width:560px">
    <h2 style="margin:0 0 8px">${escapeHtml(reportName)}</h2>
    ${description ? `<p style="margin:0 0 12px;color:#475569">${escapeHtml(description)}</p>` : ''}
    <p style="margin:0 0 4px">Your scheduled report is attached as a CSV file.</p>
    <p style="margin:0 0 4px;color:#475569">Rows: <strong>${rowCount}</strong>${truncated ? ' (limited by the report row limit)' : ''}</p>
    <p style="margin:0;color:#94a3b8;font-size:12px">Generated ${escapeHtml(generatedAt)}</p>
  </div>`;

module.exports = { isEmailConfigured, sendReportEmail, reportEmailHtml };
