/**
 * Analytics scheduled jobs.
 *
 * scheduled-reports: every 15 minutes, run saved reports whose schedule is due,
 * e-mail the CSV to the recipients and record each delivery.
 */

const { runDueReports } = require('../../services/analytics/scheduler');

module.exports = [
  {
    name: 'scheduled-reports',
    schedule: '*/15 * * * *',
    description: 'Run due scheduled reports and e-mail them as CSV attachments',
    run: (db) => runDueReports(db)
  }
];
