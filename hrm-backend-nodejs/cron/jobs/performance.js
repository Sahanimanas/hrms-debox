/**
 * Performance module scheduled jobs (PF-3, PF-4, PF-5).
 */

const {
  pipReminders,
  learningReminders,
  certificationExpiryAlerts,
  oneOnOneReminders
} = require('../../services/performance/reminders');

module.exports = [
  {
    name: 'performance-pip-reminders',
    schedule: '0 9 * * *',
    description: 'Remind managers about due PIP check-ins and PIPs ending within 3 days',
    run: (db) => pipReminders(db)
  },
  {
    name: 'performance-learning-reminders',
    schedule: '15 9 * * *',
    description: 'Remind employees about mandatory courses due in 7 days / overdue',
    run: (db) => learningReminders(db)
  },
  {
    name: 'performance-certification-expiry',
    schedule: '30 9 * * *',
    description: 'Alert employees about certifications expiring in 30 / 7 days or expired',
    run: (db) => certificationExpiryAlerts(db)
  },
  {
    name: 'performance-one-on-one-reminders',
    schedule: '0 8 * * *',
    description: "Remind both participants of 1:1s in the next 24 hours",
    run: (db) => oneOnOneReminders(db)
  }
];
