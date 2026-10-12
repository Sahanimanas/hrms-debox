/**
 * Email with attachments via Mailjet (payslip PDFs). Uses the same MAILJET_*
 * variables as services/emailService. Returns false without sending when
 * Mailjet is not configured.
 */

const Mailjet = require('node-mailjet');

const isMailConfigured = () =>
  !!(process.env.MAILJET_API_KEY && process.env.MAILJET_API_SECRET && process.env.MAILJET_FROM_EMAIL);

/**
 * attachments: [{ filename, contentType, content: Buffer }]
 */
async function sendMailWithAttachments({ to, subject, html, attachments = [] }) {
  if (!isMailConfigured() || !to) return false;
  try {
    const mailjet = Mailjet.apiConnect(process.env.MAILJET_API_KEY, process.env.MAILJET_API_SECRET);
    await mailjet.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: { Email: process.env.MAILJET_FROM_EMAIL, Name: process.env.MAILJET_FROM_NAME || 'Xeno-HR' },
        To: [{ Email: to }],
        Subject: subject,
        HTMLPart: html,
        Attachments: attachments.map(a => ({
          ContentType: a.contentType || 'application/pdf',
          Filename: a.filename,
          Base64Content: Buffer.from(a.content).toString('base64')
        }))
      }]
    });
    return true;
  } catch (error) {
    console.error(`[payroll] Failed to email ${to}:`, error.message);
    return false;
  }
}

module.exports = { sendMailWithAttachments, isMailConfigured };
