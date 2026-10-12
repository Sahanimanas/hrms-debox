/**
 * lifecycle module — mounted at /api/v2/lifecycle (Phase 3: employee lifecycle)
 *
 *  EL-1 onboarding checklists        /onboarding/...
 *  EL-2 offboarding + F&F settlement /offboarding/...
 *  EL-3 exit interviews              /exit-interview/...
 *  EL-4 document vault               /documents/...
 *  EL-5 letter templates             /letters/...
 *  EL-6 job history                  /job-history/...
 *  EL-7 probation & confirmation     /probation/...
 *  EL-8 profile change requests      /profile-requests/...
 *  EL-9 org chart                    /org-chart
 *
 * Route handlers live in services/lifecycle/http/*.js; business logic in
 * services/lifecycle/*.js.
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { getSettings, SETTINGS_KEY, serverError, todayStr, addDaysStr, teamQuery, findMyEmployee } = require('../../services/lifecycle/common');

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('lifecycle_settings').createIndex({ key: 1 }, { unique: true }),
    db.collection('onboarding_templates').createIndex({ id: 1 }, { unique: true }),
    db.collection('onboarding_checklists').createIndex({ id: 1 }, { unique: true }),
    db.collection('onboarding_checklists').createIndex({ employee_uid: 1, status: 1 }),
    db.collection('onboarding_checklists').createIndex({ 'tasks.assignee_email': 1 }),
    db.collection('separations').createIndex({ id: 1 }, { unique: true }),
    db.collection('separations').createIndex({ employee_uid: 1, status: 1 }),
    db.collection('exit_interviews').createIndex({ id: 1 }, { unique: true }),
    db.collection('exit_interviews').createIndex({ separation_id: 1 }, { unique: true }),
    db.collection('employee_documents').createIndex({ id: 1 }, { unique: true }),
    db.collection('employee_documents').createIndex({ employee_uid: 1 }),
    db.collection('employee_documents').createIndex({ expiry_date: 1 }),
    db.collection('letter_templates').createIndex({ id: 1 }, { unique: true }),
    db.collection('job_history').createIndex({ employee_uid: 1, effective_date: -1 }),
    db.collection('profile_change_requests').createIndex({ id: 1 }, { unique: true }),
    db.collection('profile_change_requests').createIndex({ employee_uid: 1, status: 1 })
  ]);
  indexesReady = true;
};

router.get('/health', (req, res) => res.json({ module: 'lifecycle', status: 'ok' }));

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    serverError(res, 'index setup', error);
  }
});

// ============= SETTINGS =============

const settingsSchema = Joi.object({
  notice_period_days: Joi.number().integer().min(0).max(365),
  probation_months: Joi.number().integer().min(0).max(24),
  company_name: Joi.string().trim().max(200).allow(''),
  company_address: Joi.string().trim().max(500).allow(''),
  hr_email: Joi.string().email().allow(null, ''),
  it_email: Joi.string().email().allow(null, ''),
  basic_percent_of_gross: Joi.number().min(1).max(100),
  earned_leave_key: Joi.string().trim().max(50)
}).min(1);

/** GET /settings — lifecycle settings (everyone: notice period is shown on the resignation form). */
router.get('/settings', async (req, res) => {
  try {
    const s = await getSettings(getDB());
    delete s.letters_seeded;
    if (req.user.role !== 'admin') {
      return res.json({ notice_period_days: s.notice_period_days, probation_months: s.probation_months, company_name: s.company_name });
    }
    res.json(s);
  } catch (error) {
    serverError(res, 'get settings', error);
  }
});

router.put('/settings', requireRole(['admin']), validate(settingsSchema), async (req, res) => {
  try {
    const db = getDB();
    const body = { ...req.validatedBody };
    for (const k of ['hr_email', 'it_email']) if (body[k] === '') body[k] = null;
    await db.collection('lifecycle_settings').updateOne(
      { key: SETTINGS_KEY },
      { $set: { ...body, updated_at: new Date(), updated_by: req.user.email }, $setOnInsert: { key: SETTINGS_KEY, created_at: new Date() } },
      { upsert: true }
    );
    const s = await getSettings(db);
    delete s.letters_seeded;
    res.json(s);
  } catch (error) {
    serverError(res, 'update settings', error);
  }
});

// ============= DASHBOARD SUMMARY =============

/** GET /summary — counts for the admin / manager dashboard widget. */
router.get('/summary', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const isAdmin = req.user.role === 'admin';
    let scope = {};
    let emailScope = {};
    if (!isAdmin) {
      const me = await findMyEmployee(db, req.user.email);
      if (!me) return res.json({ pending_profile_requests: 0, pending_resignations: 0, on_notice: 0, probation_due: 0, onboarding_in_progress: 0, documents_expiring: 0 });
      const team = await db.collection('employees').find(teamQuery(me), { projection: { email: 1 } }).toArray();
      const emails = team.map(t => t.email);
      scope = { email: { $in: emails } };
      emailScope = { employee_email: { $in: emails } };
    }
    const in30 = addDaysStr(todayStr(), 30);
    const [pendingProfile, pendingSeparations, onNotice, probationDue, onboarding, docsExpiring] = await Promise.all([
      isAdmin ? db.collection('profile_change_requests').countDocuments({ status: 'pending' }) : 0,
      db.collection('separations').countDocuments({ status: 'pending', ...emailScope }),
      db.collection('separations').countDocuments({ status: 'approved', ...emailScope }),
      db.collection('employees').countDocuments({ employment_status: 'probation', probation_end_date: { $lte: new Date(`${in30}T23:59:59Z`) }, ...scope }),
      db.collection('onboarding_checklists').countDocuments({ status: 'in_progress', ...emailScope }),
      isAdmin ? db.collection('employee_documents').countDocuments({ expiry_date: { $ne: null, $lte: in30 } }) : 0
    ]);
    res.json({
      pending_profile_requests: pendingProfile,
      pending_resignations: pendingSeparations,
      on_notice: onNotice,
      probation_due: probationDue,
      onboarding_in_progress: onboarding,
      documents_expiring: docsExpiring
    });
  } catch (error) {
    serverError(res, 'summary', error);
  }
});

// ============= FEATURE ROUTES =============

require('../../services/lifecycle/http/onboarding')(router);
require('../../services/lifecycle/http/offboarding')(router);
require('../../services/lifecycle/http/exitInterviews')(router);
require('../../services/lifecycle/http/documents')(router);
require('../../services/lifecycle/http/letters')(router);
require('../../services/lifecycle/http/jobHistory')(router);
require('../../services/lifecycle/http/probation')(router);
require('../../services/lifecycle/http/profileRequests')(router);
require('../../services/lifecycle/http/orgChart')(router);

// Multer and other thrown errors
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ detail: 'File is too large (maximum 10 MB)' });
  if (err && err.name === 'MulterError') return res.status(400).json({ detail: err.message });
  serverError(res, 'unhandled', err);
});

module.exports = router;
