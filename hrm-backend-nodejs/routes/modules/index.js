/**
 * Feature modules.
 *
 * Each module lives in its own router file in this folder and is mounted at
 * /api/v2/<name>. A module that fails to load is logged and skipped so one
 * broken module never takes the whole API down.
 *
 * Scheduled jobs for a module live in cron/jobs/<name>.js (see cron/index.js).
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/roleCheck');
const { getDB } = require('../../config/database');

const MODULES = [
  'payroll',      // Phase 2 — payroll runs, statutory, loans, declarations, Form 16
  'lifecycle',    // Phase 3 — onboarding, offboarding, documents, letters, job history
  'leave',        // Phase 4 — advanced leave (who's out, delegation, year-end)
  'engagement',   // Phase 5 — announcements, birthdays, surveys, polls, kudos
  'performance',  // Phase 6 — goals, appraisals, 1:1s, PIPs, learning
  'recruitment',  // Phase 7 — jobs, candidates, interviews, offers
  'assets',       // Phase 8 — assets, expense policy, travel
  'analytics',    // Phase 9 — people / attendance / payroll analytics, reports
  'platform',     // Phase 10 — audit, 2FA, SSO, roles, integrations, API, AI
  'projects'      // Xeno PM — projects, tasks, sprints, milestones, docs, workload
];

const loaded = [];

function mountModules(app) {
  for (const name of MODULES) {
    try {
      const router = require(`./${name}`);
      app.use(`/api/v2/${name}`, router);
      loaded.push(name);
    } catch (error) {
      console.error(`\x1b[31m[MODULES] Failed to load module "${name}":\x1b[0m`, error.message);
    }
  }
  console.log(`[MODULES] Loaded: ${loaded.join(', ') || 'none'}`);

  // Admin: list and manually run scheduled jobs (useful for testing)
  const jobsRouter = express.Router();
  jobsRouter.use(authenticate, requireRole(['admin']));
  jobsRouter.get('/', (req, res) => {
    const { listJobs } = require('../../cron');
    res.json(listJobs());
  });
  jobsRouter.post('/:name/run', async (req, res) => {
    try {
      const { runJob } = require('../../cron');
      const result = await runJob(req.params.name, getDB());
      res.json({ status: 'ok', result: result ?? null });
    } catch (error) {
      res.status(error.status || 500).json({ detail: error.message });
    }
  });
  app.use('/api/v2/jobs', jobsRouter);
}

module.exports = { mountModules, MODULES, loaded };
