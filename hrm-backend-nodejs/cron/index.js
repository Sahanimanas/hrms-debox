/**
 * Scheduled jobs.
 *
 * Each feature module can export jobs from cron/jobs/<module>.js:
 *   module.exports = [{ name: 'unique-name', schedule: '0 2 * * *', description, run: async (db) => result }]
 *
 * Jobs run in the company timezone (APP_TIMEZONE). Set CRON_ENABLED=false to
 * disable all of them (e.g. on a second server instance).
 *
 * The legacy monthly leave credit only runs when ENABLE_LEAVE_CREDIT_CRON=true,
 * because until now it was triggered manually from the admin screen and running
 * both would credit leave twice.
 */

const cron = require('node-cron');
const { APP_TIMEZONE } = require('../utils/helpers');
const { MODULES } = require('../routes/modules');

const registry = new Map();

function loadJobs() {
  registry.clear();

  const { creditMonthlyLeaves } = require('./monthlyLeaveCredit');
  registry.set('monthly-leave-credit', {
    name: 'monthly-leave-credit',
    schedule: '1 0 1 * *',
    description: 'Credit monthly leave (January reset)',
    enabled: process.env.ENABLE_LEAVE_CREDIT_CRON === 'true',
    run: (db) => creditMonthlyLeaves(db)
  });

  for (const name of ['timeTracking', ...MODULES]) {
    let jobs = [];
    try {
      jobs = require(`./jobs/${name}`);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes(`jobs/${name}`)) {
        console.error(`[CRON] Failed to load jobs for "${name}":`, error.message);
      }
      continue;
    }
    for (const job of jobs || []) {
      registry.set(job.name, { enabled: true, ...job, module: name });
    }
  }
  return registry;
}

function startCron(db) {
  loadJobs();
  if (process.env.CRON_ENABLED === 'false') {
    console.log('[CRON] Disabled (CRON_ENABLED=false)');
    return;
  }
  for (const job of registry.values()) {
    if (!job.enabled) continue;
    cron.schedule(job.schedule, async () => {
      console.log(`[CRON] Running ${job.name}`);
      try {
        await job.run(db);
      } catch (error) {
        console.error(`[CRON] ${job.name} failed:`, error);
      }
    }, { timezone: APP_TIMEZONE });
  }
  const active = [...registry.values()].filter(j => j.enabled).map(j => j.name);
  console.log(`[CRON] Scheduled ${active.length} job(s): ${active.join(', ')}`);
}

function listJobs() {
  if (!registry.size) loadJobs();
  return [...registry.values()].map(({ name, schedule, description, enabled, module }) => ({
    name, schedule, description: description || null, enabled, module: module || 'core'
  }));
}

async function runJob(name, db) {
  if (!registry.size) loadJobs();
  const job = registry.get(name);
  if (!job) {
    const error = new Error(`Unknown job "${name}"`);
    error.status = 404;
    throw error;
  }
  return job.run(db);
}

module.exports = { startCron, listJobs, runJob };
