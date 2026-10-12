/**
 * Scheduled jobs for the assets module.
 */

const { runWarrantyAlerts } = require('../../services/assets/warranty');

module.exports = [
  {
    name: 'asset-warranty-alerts',
    schedule: '0 9 * * *',
    description: 'Notify admins about asset warranties expiring in the next 30 days',
    run: (db) => runWarrantyAlerts(db)
  }
];
