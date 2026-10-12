/**
 * Scheduled jobs for the leave module (registered by cron/index.js).
 *
 * leave-year-end — 1 January, 00:15 company time: closes the previous leave
 * year (carry forward / encash / lapse per policy) and applies the January
 * opening with the carried days. Idempotent: employees already closed / reset
 * are skipped, so it is safe alongside the legacy 'monthly-leave-credit' job
 * (which only runs when ENABLE_LEAVE_CREDIT_CRON=true) and the admin buttons.
 */

const { runYearEnd, currentYear } = require('../../services/leave/yearEnd');

module.exports = [
  {
    name: 'leave-year-end',
    schedule: '15 0 1 1 *',
    description: 'Close the previous leave year (carry forward, encashment, lapse) and apply the January opening',
    run: (db) => runYearEnd(db, currentYear() - 1, { by: 'cron' })
  }
];
