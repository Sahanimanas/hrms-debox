/**
 * Engagement module scheduled jobs (run in APP_TIMEZONE).
 */
const { runCelebrationsJob } = require('../../services/engagement/celebrations');
const { runPolicyReminderJob } = require('../../services/engagement/policies');
const { publishDue } = require('../../services/engagement/announcements');

module.exports = [
  {
    name: 'celebrations',
    schedule: '0 9 * * *',
    description: "Notify today's birthdays and work anniversaries (and the company, if enabled)",
    run: (db) => runCelebrationsJob(db)
  },
  {
    name: 'policy-ack-reminders',
    schedule: '0 10 * * *',
    description: 'Remind employees who have not acknowledged a policy past its due date',
    run: (db) => runPolicyReminderJob(db)
  },
  {
    name: 'announcements-publish',
    schedule: '*/5 * * * *',
    description: 'Send notifications for scheduled announcements once they go live',
    run: (db) => publishDue(db)
  }
];
