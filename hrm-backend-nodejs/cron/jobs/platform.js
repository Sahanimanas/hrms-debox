/**
 * Platform module scheduled jobs.
 */

const { retryStuckDeliveries } = require('../../services/platform/delivery');

const retentionDays = () => {
  const n = parseInt(process.env.AUDIT_RETENTION_DAYS || '365', 10);
  return Number.isFinite(n) && n >= 1 ? n : 365;
};

module.exports = [
  {
    name: 'audit-retention',
    schedule: '30 2 * * *',
    description: 'Delete audit log entries older than AUDIT_RETENTION_DAYS (default 365)',
    run: async (db) => {
      const days = retentionDays();
      const cutoff = new Date(Date.now() - days * 86400000);
      const r = await db.collection('audit_logs').deleteMany({ at: { $lt: cutoff } });
      // Webhook / integration delivery logs are kept for 30 days
      const d = await db.collection('webhook_deliveries').deleteMany({
        created_at: { $lt: new Date(Date.now() - 30 * 86400000) },
        status: { $in: ['success', 'failed'] }
      });
      return { retention_days: days, cutoff, deleted: r.deletedCount, deliveries_deleted: d.deletedCount };
    }
  },
  {
    name: 'webhook-retry',
    schedule: '*/5 * * * *',
    description: 'Resume webhook / Slack / Teams deliveries whose retry was interrupted',
    run: (db) => retryStuckDeliveries(db)
  }
];
