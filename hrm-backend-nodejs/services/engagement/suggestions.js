/**
 * EN-5b Suggestion box.
 *
 * Collection `suggestions`:
 *   { id, title, description, category, anonymous, submitter_email|null, submitter_name|null, submitter_department|null,
 *     status: 'new'|'under_review'|'implemented'|'declined', admin_response, responded_by_name, responded_at,
 *     created_at, updated_at }
 *
 * Anonymous suggestions store no submitter details, so nobody (including the
 * submitter) can trace them back.
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { handle, validateQuery, getViewer, adminRecipients, notifyPeople } = require('./common');

const router = express.Router();
const admin = requireRole(['admin']);

const STATUSES = ['new', 'under_review', 'implemented', 'declined'];
const STATUS_LABELS = { new: 'New', under_review: 'Under review', implemented: 'Implemented', declined: 'Declined' };
const CATEGORIES = ['workplace', 'process', 'culture', 'benefits', 'technology', 'other'];

const createSchema = Joi.object({
  title: Joi.string().trim().min(3).max(200).required(),
  description: Joi.string().trim().min(1).max(5000).required(),
  category: Joi.string().valid(...CATEGORIES).default('other'),
  anonymous: Joi.boolean().default(false)
});

const updateSchema = Joi.object({
  status: Joi.string().valid(...STATUSES),
  admin_response: Joi.string().trim().max(5000).allow('')
}).min(1);

const MINE_PROJECTION = { _id: 0, submitter_email: 0 };

router.get('/meta', (req, res) => res.json({ statuses: STATUSES, categories: CATEGORIES }));

/**
 * POST /suggestions
 */
router.post('/', validate(createSchema), handle('Create suggestion', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const data = req.validatedBody;
  const now = new Date();
  const suggestion = {
    id: generateUUID(),
    title: data.title,
    description: data.description,
    category: data.category,
    anonymous: data.anonymous,
    submitter_email: data.anonymous ? null : viewer.email,
    submitter_name: data.anonymous ? null : viewer.name,
    submitter_department: data.anonymous ? null : viewer.department,
    status: 'new',
    admin_response: null,
    responded_by_name: null,
    responded_at: null,
    created_at: now,
    updated_at: now
  };
  await db.collection('suggestions').insertOne(suggestion);
  adminRecipients(db)
    .then(admins => notifyPeople(admins, {
      type: 'suggestion_submitted',
      title: 'New suggestion',
      message: `${data.anonymous ? 'Anonymous' : viewer.name}: ${data.title}`,
      actionUrl: '/engagement/suggestions',
      metadata: { suggestion_id: suggestion.id }
    }, { exclude: [viewer.email] }))
    .catch(err => console.error('[engagement] suggestion notify:', err.message));
  const { _id: _i, submitter_email: _e, ...out } = suggestion;
  res.status(201).json(out);
}));

/**
 * GET /suggestions/mine — my (non-anonymous) suggestions and their status.
 */
router.get('/mine', handle('My suggestions', async (req, res) => {
  const db = getDB();
  const items = await db.collection('suggestions')
    .find({ submitter_email: req.user.email, anonymous: false }, { projection: MINE_PROJECTION })
    .sort({ created_at: -1 })
    .toArray();
  res.json(items);
}));

/**
 * GET /suggestions (admin) ?status=&category=
 */
router.get('/', admin, validateQuery(Joi.object({
  status: Joi.string().valid(...STATUSES),
  category: Joi.string().valid(...CATEGORIES)
})), handle('List suggestions', async (req, res) => {
  const db = getDB();
  const filter = {};
  if (req.validatedQuery.status) filter.status = req.validatedQuery.status;
  if (req.validatedQuery.category) filter.category = req.validatedQuery.category;
  const items = await db.collection('suggestions').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  (await db.collection('suggestions').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray())
    .forEach(c => { counts[c._id] = c.n; });
  res.json({ suggestions: items, counts });
}));

/**
 * PATCH /suggestions/:id (admin) { status?, admin_response? }
 */
router.patch('/:id', admin, validate(updateSchema), handle('Update suggestion', async (req, res) => {
  const db = getDB();
  const s = await db.collection('suggestions').findOne({ id: req.params.id });
  if (!s) return res.status(404).json({ detail: 'Suggestion not found' });
  const data = req.validatedBody;
  const now = new Date();
  const updates = { updated_at: now };
  if (data.status) updates.status = data.status;
  if (data.admin_response !== undefined) {
    updates.admin_response = data.admin_response || null;
    updates.responded_by_name = req.user.full_name;
    updates.responded_at = now;
  }
  await db.collection('suggestions').updateOne({ id: s.id }, { $set: updates });
  const updated = await db.collection('suggestions').findOne({ id: s.id }, { projection: { _id: 0 } });
  if (s.submitter_email && (updated.status !== s.status || updated.admin_response !== s.admin_response)) {
    const submitter = await db.collection('users').findOne({ email: s.submitter_email }, { projection: { id: 1, email: 1 } });
    notifyPeople([{ id: submitter?.id, email: s.submitter_email }], {
      type: 'suggestion_updated',
      title: `Your suggestion is ${STATUS_LABELS[updated.status].toLowerCase()}`,
      message: updated.admin_response ? `"${s.title}": ${updated.admin_response.slice(0, 140)}` : `"${s.title}"`,
      actionUrl: '/engagement/suggestions',
      metadata: { suggestion_id: s.id, status: updated.status }
    }).catch(() => {});
  }
  res.json(updated);
}));

router.delete('/:id', admin, handle('Delete suggestion', async (req, res) => {
  const db = getDB();
  const { deletedCount } = await db.collection('suggestions').deleteOne({ id: req.params.id });
  if (!deletedCount) return res.status(404).json({ detail: 'Suggestion not found' });
  res.json({ message: 'Suggestion deleted' });
}));

module.exports = { router, STATUSES, CATEGORIES };
