/**
 * Warranty expiry alerts (AS-1): notify admins about assets whose warranty
 * expires within the next N days. Each asset is alerted once per expiry date.
 */

const { createNotification } = require('../notificationService');
const { adminRecipients, toDateOnly, todayStr } = require('./common');

const WINDOW_DAYS = 30;

async function runWarrantyAlerts(db, { windowDays = WINDOW_DAYS } = {}) {
  const today = toDateOnly(todayStr());
  const until = new Date(today.getTime() + windowDays * 86400000);

  const assets = await db.collection('assets').find(
    {
      warranty_expiry: { $gte: today, $lte: until },
      status: { $nin: ['retired', 'lost'] }
    },
    { projection: { _id: 0 } }
  ).sort({ warranty_expiry: 1 }).toArray();

  const due = assets.filter(a => a.warranty_alert_for !== a.warranty_expiry.toISOString().slice(0, 10));
  if (!due.length) return { checked: assets.length, alerted: 0, admins: 0, assets: [] };

  const admins = await adminRecipients(db);
  const lines = due.map(a => `${a.asset_tag} (${a.name}) — ${a.warranty_expiry.toISOString().slice(0, 10)}`);
  const title = due.length === 1 ? 'Asset warranty expiring soon' : `${due.length} asset warranties expiring soon`;
  const message = `Warranty expires within ${windowDays} days: ${lines.slice(0, 10).join('; ')}${lines.length > 10 ? `; and ${lines.length - 10} more` : ''}`;

  for (const admin of admins) {
    await createNotification({
      userId: admin.id,
      userEmail: admin.email,
      type: 'asset_warranty_expiring',
      title,
      message,
      actionUrl: '/assets?warranty=expiring',
      metadata: { asset_ids: due.map(a => a.id) }
    });
  }

  await Promise.all(due.map(a => db.collection('assets').updateOne(
    { id: a.id },
    { $set: { warranty_alert_for: a.warranty_expiry.toISOString().slice(0, 10), warranty_alerted_at: new Date() } }
  )));

  return { checked: assets.length, alerted: due.length, admins: admins.length, assets: due.map(a => a.asset_tag) };
}

module.exports = { runWarrantyAlerts, WINDOW_DAYS };
