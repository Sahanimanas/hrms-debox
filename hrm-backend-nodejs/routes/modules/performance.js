/**
 * performance module — mounted at /api/v2/performance  (Phase 6 — Performance & growth)
 *
 *  PF-1 Goals / OKRs / KRAs        /cycles, /goals                         services/performance/goals.js
 *  PF-2 Appraisal cycles           /appraisal-configs, /appraisals, /peer-feedback   services/performance/appraisals.js
 *  PF-3 1:1s and feedback          /one-on-ones, /feedback                 services/performance/conversations.js
 *  PF-4 Improvement plans          /pips                                   services/performance/pips.js
 *  PF-5 Learning and skills        /courses, /learning, /certifications, /skills   services/performance/learning.js
 *  Dashboard / pickers             /pending-actions, /people               services/performance/dashboard.js
 *
 * Scheduled reminders: cron/jobs/performance.js
 */
const express = require('express');
const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { loadMe, ensureIndexes } = require('../../services/performance/common');

const router = express.Router();

router.get('/health', (req, res) => res.json({ module: 'performance', status: 'ok' }));

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Performance index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
}, loadMe);

router.use(require('../../services/performance/dashboard').router);
router.use(require('../../services/performance/goals').router);
router.use(require('../../services/performance/appraisals').router);
router.use(require('../../services/performance/conversations').router);
router.use(require('../../services/performance/pips').router);
router.use(require('../../services/performance/learning').router);

module.exports = router;
