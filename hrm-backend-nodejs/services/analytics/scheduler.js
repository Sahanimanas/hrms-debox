/**
 * Scheduled report delivery (AN-5).
 *
 * Saved reports carry an optional schedule
 *   { enabled, frequency: 'daily'|'weekly'|'monthly', time: 'HH:mm',
 *     day_of_week (0=Sun, weekly), day_of_month (1–28, monthly), recipients: [] }
 * plus `next_run_at`. The 'scheduled-reports' cron job calls runDueReports(),
 * which claims each due report (moving next_run_at forward atomically so two
 * servers never send twice), runs it, e-mails the CSV and logs the delivery.
 */

const { generateUUID, localParts, zonedTimeToDate } = require('../../utils/helpers');
const { addDays, weekdayOf, toCsv } = require('./common');
const { runReport } = require('./reports');
const { sendReportEmail, isEmailConfigured, reportEmailHtml } = require('./mailer');

const REPORTS = 'analytics_reports';
const DELIVERIES = 'analytics_report_deliveries';

/** Next run strictly after `after`, in the company timezone. */
function computeNextRun(schedule, after = new Date()) {
  if (!schedule || !schedule.frequency || !schedule.time) return null;
  const start = localParts(after).date;
  for (let i = 0; i <= 400; i++) {
    const day = addDays(start, i);
    if (schedule.frequency === 'weekly' && weekdayOf(day) !== Number(schedule.day_of_week)) continue;
    if (schedule.frequency === 'monthly' && Number(day.slice(8, 10)) !== Number(schedule.day_of_month)) continue;
    const at = zonedTimeToDate(day, schedule.time);
    if (at > after) return at;
  }
  return null;
}

const SYSTEM_ADMIN = { role: 'admin', email: 'system@scheduler', full_name: 'Scheduler' };

/**
 * Run a saved report and e-mail its CSV. Always records a delivery entry.
 * @returns the delivery document
 */
async function deliverReport(db, report, { trigger = 'manual', recipients, actor } = {}) {
  const to = (recipients && recipients.length ? recipients : report.schedule?.recipients) || [];
  const delivery = {
    id: generateUUID(),
    report_id: report.id,
    report_name: report.name,
    trigger,
    triggered_by: actor ? { email: actor.email, name: actor.full_name || null } : null,
    recipients: to,
    status: 'pending',
    row_count: null,
    error: null,
    created_at: new Date()
  };

  try {
    // Scheduled reports are owned by admins and run with admin visibility
    const result = await runReport(db, report.definition, SYSTEM_ADMIN);
    delivery.row_count = result.rows.length;
    delivery.total_rows = result.total_rows;
    if (!to.length) {
      delivery.status = 'failed';
      delivery.error = 'No recipients configured';
    } else if (!isEmailConfigured()) {
      delivery.status = 'skipped';
      delivery.error = 'E-mail is not configured (MAILJET_API_KEY, MAILJET_API_SECRET, MAILJET_FROM_EMAIL)';
    } else {
      const csv = toCsv(result.rows, result.columns);
      const stamp = localParts(new Date()).date;
      const sent = await sendReportEmail({
        to,
        subject: `${report.name} — ${stamp}`,
        html: reportEmailHtml({
          reportName: report.name,
          description: report.description,
          rowCount: result.rows.length,
          truncated: result.truncated,
          generatedAt: new Date().toISOString()
        }),
        attachment: { filename: `${report.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${stamp}.csv`, content: csv }
      });
      delivery.status = sent ? 'sent' : 'failed';
      if (!sent) delivery.error = 'Mail provider did not accept the message';
    }
  } catch (error) {
    delivery.status = 'failed';
    delivery.error = String(error.message || error).slice(0, 500);
  }

  await db.collection(DELIVERIES).insertOne({ ...delivery });
  await db.collection(REPORTS).updateOne(
    { id: report.id },
    { $set: { last_delivery_at: delivery.created_at, last_delivery_status: delivery.status } }
  );
  return delivery;
}

/** Cron entry point. */
async function runDueReports(db, now = new Date()) {
  const due = await db.collection(REPORTS)
    .find({ 'schedule.enabled': true, 'schedule.next_run_at': { $lte: now } }, { projection: { _id: 0 } })
    .limit(200)
    .toArray();

  const summary = { due: due.length, sent: 0, skipped: 0, failed: 0, reports: [] };
  for (const report of due) {
    const next = computeNextRun(report.schedule, now);
    // Claim: only the instance that moves next_run_at forward delivers
    const claim = await db.collection(REPORTS).updateOne(
      { id: report.id, 'schedule.next_run_at': report.schedule.next_run_at },
      { $set: { 'schedule.next_run_at': next, 'schedule.last_run_at': now } }
    );
    if (!claim.modifiedCount) continue;
    const delivery = await deliverReport(db, report, { trigger: 'schedule' });
    summary[delivery.status === 'sent' ? 'sent' : delivery.status === 'skipped' ? 'skipped' : 'failed'] += 1;
    summary.reports.push({ id: report.id, name: report.name, status: delivery.status, row_count: delivery.row_count, next_run_at: next });
  }
  return summary;
}

module.exports = { computeNextRun, deliverReport, runDueReports, REPORTS, DELIVERIES };
