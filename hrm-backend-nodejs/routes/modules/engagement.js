/**
 * engagement module — mounted at /api/v2/engagement
 *
 *   /announcements   EN-1  company news with audience, pin, schedule, expiry, read tracking
 *   /celebrations    EN-2  birthdays + work anniversaries, wishes
 *   /policies        EN-3  policy documents with versioned acknowledgements
 *   /surveys         EN-4  surveys (anonymous option) + eNPS results
 *   /polls           EN-5  quick polls
 *   /suggestions     EN-5  suggestion box
 *   /grievances      EN-5  grievances with tracking codes (POST /grievances/track is public)
 *   /kudos           EN-6  recognition feed + leaderboard
 *   /settings, /directory, /departments, /summary   shared helpers
 *
 * Business logic lives in services/engagement/*.
 */
const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const {
  handle, getViewer, ACTIVE_EMPLOYEE, publicPerson, getSettings, SETTINGS_KEY, audienceFilter, inAudience
} = require('../../services/engagement/common');
const announcements = require('../../services/engagement/announcements');
const celebrations = require('../../services/engagement/celebrations');
const policies = require('../../services/engagement/policies');
const surveys = require('../../services/engagement/surveys');
const polls = require('../../services/engagement/polls');
const suggestions = require('../../services/engagement/suggestions');
const grievances = require('../../services/engagement/grievances');
const kudos = require('../../services/engagement/kudos');

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('announcements').createIndex({ id: 1 }, { unique: true }),
    db.collection('announcements').createIndex({ published_at: -1 }),
    db.collection('announcement_reads').createIndex({ announcement_id: 1, user_email: 1 }, { unique: true }),
    db.collection('celebration_wishes').createIndex({ celebration_key: 1, from_email: 1 }, { unique: true }),
    db.collection('celebration_wishes').createIndex({ celebrant_email: 1, created_at: -1 }),
    db.collection('celebration_notifications').createIndex({ key: 1 }, { unique: true }),
    db.collection('policy_documents').createIndex({ id: 1 }, { unique: true }),
    db.collection('policy_acknowledgements').createIndex({ policy_id: 1, version: 1, user_email: 1 }, { unique: true }),
    db.collection('policy_acknowledgements').createIndex({ user_email: 1 }),
    db.collection('surveys').createIndex({ id: 1 }, { unique: true }),
    db.collection('survey_responses').createIndex({ survey_id: 1 }),
    db.collection('survey_participation').createIndex({ survey_id: 1, participant: 1 }, { unique: true }),
    db.collection('polls').createIndex({ id: 1 }, { unique: true }),
    db.collection('poll_votes').createIndex({ poll_id: 1, user_email: 1 }, { unique: true }),
    db.collection('suggestions').createIndex({ id: 1 }, { unique: true }),
    db.collection('suggestions').createIndex({ submitter_email: 1 }),
    db.collection('grievances').createIndex({ id: 1 }, { unique: true }),
    db.collection('grievances').createIndex({ tracking_code: 1 }, { unique: true }),
    db.collection('kudos').createIndex({ id: 1 }, { unique: true }),
    db.collection('kudos').createIndex({ created_at: -1 }),
    db.collection('engagement_settings').createIndex({ key: 1 }, { unique: true })
  ]);
  indexesReady = true;
};

const indexes = async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('[engagement] index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

router.get('/health', (req, res) => res.json({ module: 'engagement', status: 'ok' }));

// ============= PUBLIC (no login) =============
router.use(indexes, grievances.publicRouter);

// ============= EVERYTHING ELSE NEEDS A LOGIN =============
router.use(authenticate);

/**
 * GET /settings — engagement settings (kudos values, company-wide celebration notices).
 */
router.get('/settings', handle('Get settings', async (req, res) => {
  res.json(await getSettings(getDB()));
}));

const settingsSchema = Joi.object({
  celebrations_company_wide: Joi.boolean(),
  kudos_values: Joi.array().items(Joi.string().trim().min(1).max(50)).min(1).max(20)
    .unique((a, b) => a.toLowerCase() === b.toLowerCase())
}).min(1);

router.put('/settings', requireRole(['admin']), validate(settingsSchema), handle('Update settings', async (req, res) => {
  const db = getDB();
  await db.collection('engagement_settings').updateOne(
    { key: SETTINGS_KEY },
    { $set: { ...req.validatedBody, updated_at: new Date(), updated_by: req.user.email }, $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true }
  );
  res.json(await getSettings(db));
}));

/**
 * GET /directory — colleagues for pickers (kudos). No emails, DOBs or salaries.
 */
router.get('/directory', handle('Directory', async (req, res) => {
  const db = getDB();
  const employees = await db.collection('employees')
    .find(ACTIVE_EMPLOYEE, { projection: { _id: 0, id: 1, full_name: 1, department: 1, designation: 1, email: 1 } })
    .sort({ full_name: 1 })
    .toArray();
  res.json(employees.filter(e => e.id).map(e => ({ ...publicPerson(e), is_me: e.email === req.user.email })));
}));

/**
 * GET /departments — departments for audience pickers.
 */
router.get('/departments', handle('Departments', async (req, res) => {
  const db = getDB();
  const departments = (await db.collection('employees').distinct('department', ACTIVE_EMPLOYEE))
    .filter(d => typeof d === 'string' && d.trim())
    .sort((a, b) => a.localeCompare(b));
  res.json(departments);
}));

/**
 * GET /summary — counts for the dashboard: unread announcements, pending
 * policy acknowledgements, open surveys and polls I haven't answered.
 */
router.get('/summary', handle('Engagement summary', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const now = new Date();

  const live = await db.collection('announcements')
    .find({
      $and: [
        { published_at: { $lte: now } },
        { $or: [{ expires_at: null }, { expires_at: { $gt: now } }] },
        audienceFilter(viewer)
      ]
    }, { projection: { id: 1 } })
    .toArray();
  const readCount = await db.collection('announcement_reads').countDocuments({ user_email: viewer.email, announcement_id: { $in: live.map(a => a.id) } });

  let pendingPolicies = 0;
  if (viewer.employee) {
    const reqPolicies = await db.collection('policy_documents').find({ $and: [{ requires_ack: true }, audienceFilter(viewer)] }, { projection: { id: 1, version: 1 } }).toArray();
    for (const p of reqPolicies) {
      const ack = await db.collection('policy_acknowledgements').findOne({ policy_id: p.id, version: p.version, user_email: viewer.email }, { projection: { _id: 1 } });
      if (!ack) pendingPolicies += 1;
    }
  }

  const surveyList = await db.collection('surveys').find({ $and: [{ status: 'published' }, audienceFilter(viewer)] }).toArray();
  let openSurveys = 0;
  for (const s of surveyList) {
    if (surveys.stateOf(s, now) !== 'open') continue;
    const marker = await db.collection('survey_participation').findOne({ survey_id: s.id, participant: surveys.participantHash(s, viewer.email) });
    if (!marker) openSurveys += 1;
  }

  const openPolls = await db.collection('polls').find({
    $and: [{ status: 'open' }, { $or: [{ closes_at: null }, { closes_at: { $gt: now } }] }, audienceFilter(viewer)]
  }, { projection: { id: 1, audience: 1 } }).toArray();
  const voted = await db.collection('poll_votes').countDocuments({ user_email: viewer.email, poll_id: { $in: openPolls.filter(p => inAudience(p.audience, viewer)).map(p => p.id) } });

  res.json({
    unread_announcements: live.length - readCount,
    pending_policies: pendingPolicies,
    open_surveys: openSurveys,
    open_polls: openPolls.length - voted
  });
}));

router.use('/announcements', indexes, announcements.router);
router.use('/celebrations', indexes, celebrations.router);
router.use('/policies', indexes, policies.router);
router.use('/surveys', indexes, surveys.router);
router.use('/polls', indexes, polls.router);
router.use('/suggestions', indexes, suggestions.router);
router.use('/grievances', indexes, grievances.router);
router.use('/kudos', indexes, kudos.router);

module.exports = router;
