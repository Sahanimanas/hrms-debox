/**
 * Lifecycle module scheduled jobs (EL-4 document expiry, EL-7 probation reminders).
 */

const { todayStr, addDaysStr, toDateStr, diffDays, admins, notify } = require('../../services/lifecycle/common');

/**
 * Notify owners + admins about documents expiring within 30 days or expired.
 * Each document is alerted once per stage (due within 30 days, within 7 days,
 * expired), so the daily run doesn't repeat itself.
 */
const documentExpiryAlerts = async (db) => {
  const today = todayStr();
  const horizon = addDaysStr(today, 30);
  const docs = await db.collection('employee_documents').find({ expiry_date: { $ne: null, $lte: horizon } }).toArray();
  const stageOf = (d) => (d.expiry_date < today ? 'expired' : d.expiry_date <= addDaysStr(today, 7) ? 'due_7' : 'due_30');
  const rank = { due_30: 1, due_7: 2, expired: 3 };
  const alerted = [];
  for (const doc of docs) {
    const stage = stageOf(doc);
    if (doc.expiry_alert_stage && rank[doc.expiry_alert_stage] >= rank[stage]) continue;
    const days = diffDays(today, doc.expiry_date);
    const when = stage === 'expired' ? `expired on ${doc.expiry_date}` : `expires in ${days} day${days === 1 ? '' : 's'} (${doc.expiry_date})`;
    await notify(db, doc.employee_email, {
      type: 'document_expiring',
      title: stage === 'expired' ? 'Document expired' : 'Document expiring soon',
      message: `Your document "${doc.title}" ${when}. Please upload a renewed copy.`,
      actionUrl: '/my-documents',
      metadata: { document_id: doc.id }
    });
    await db.collection('employee_documents').updateOne({ id: doc.id }, { $set: { expiry_alert_stage: stage, expiry_alerted_at: new Date() } });
    alerted.push({ id: doc.id, employee_name: doc.employee_name, title: doc.title, stage, expiry_date: doc.expiry_date });
  }
  if (alerted.length) {
    const expired = alerted.filter(a => a.stage === 'expired').length;
    const list = await admins(db);
    for (const a of list) {
      await notify(db, a.email, {
        type: 'documents_expiring_digest',
        title: 'Employee documents need renewal',
        message: `${alerted.length} document(s) are expiring soon${expired ? `, ${expired} already expired` : ''}: ${alerted.slice(0, 5).map(x => `${x.employee_name} — ${x.title}`).join('; ')}${alerted.length > 5 ? '…' : ''}`,
        actionUrl: '/documents?tab=expiring',
        metadata: { count: alerted.length }
      });
    }
  }
  return { checked: docs.length, alerted: alerted.length };
};

/**
 * Remind the manager and admins 7 days before and on the probation end date.
 * Remembered per end date in `probation_reminders_sent` so extensions re-arm it.
 */
const probationReminders = async (db) => {
  const today = todayStr();
  const horizon = addDaysStr(today, 7);
  const people = await db.collection('employees').find({
    employment_status: 'probation',
    probation_end_date: { $ne: null, $lte: new Date(`${horizon}T23:59:59Z`) }
  }).toArray();
  const adminList = await admins(db);
  let sent = 0;
  for (const e of people) {
    const end = toDateStr(e.probation_end_date);
    if (!end) continue;
    const already = new Set(e.probation_reminders_sent || []);
    const stage = end <= today ? `${end}:0` : `${end}:7`;
    if (already.has(stage)) continue;
    const daysLeft = diffDays(today, end);
    const message = daysLeft > 0
      ? `${e.full_name}'s probation ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${end}). Please confirm or extend.`
      : daysLeft === 0
        ? `${e.full_name}'s probation ends today (${end}). Please confirm or extend.`
        : `${e.full_name}'s probation ended on ${end} and is awaiting confirmation.`;
    const recipients = new Set(adminList.map(a => a.email));
    if (e.manager_email) recipients.add(e.manager_email);
    recipients.delete(e.email);
    for (const email of recipients) {
      await notify(db, email, {
        type: 'probation_reminder',
        title: daysLeft > 0 ? 'Probation ending soon' : 'Probation review due',
        message,
        actionUrl: '/probation',
        metadata: { employee_uid: e.employee_id || e.id, probation_end_date: end }
      });
    }
    // Sending the "on the day" reminder also covers the 7-day one
    const marks = stage.endsWith(':0') ? [`${end}:7`, `${end}:0`] : [stage];
    await db.collection('employees').updateOne({ _id: e._id }, { $addToSet: { probation_reminders_sent: { $each: marks } } });
    sent += 1;
  }
  return { checked: people.length, reminded: sent };
};

module.exports = [
  {
    name: 'document-expiry-alerts',
    schedule: '0 8 * * *',
    description: 'Notify employees and admins about documents expiring within 30 days or expired',
    run: documentExpiryAlerts
  },
  {
    name: 'probation-reminders',
    schedule: '30 9 * * *',
    description: 'Remind managers and admins 7 days before and on the probation end date',
    run: probationReminders
  }
];
