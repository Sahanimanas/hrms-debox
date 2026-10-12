/**
 * Recruitment scheduled jobs (registered by cron/index.js, company timezone).
 */
const { expireOffers, closeExpiredJobs } = require('../../services/recruitment/maintenance');

module.exports = [
  {
    name: 'offer-expiry',
    schedule: '15 0 * * *',
    description: 'Mark sent job offers past their expiry date as expired',
    run: (db) => expireOffers(db)
  },
  {
    name: 'job-posting-auto-close',
    schedule: '20 0 * * *',
    description: 'Close open job postings whose closing date has passed',
    run: (db) => closeExpiredJobs(db)
  }
];
