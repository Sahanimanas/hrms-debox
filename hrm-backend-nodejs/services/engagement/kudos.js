/**
 * EN-6 Recognition / kudos.
 *
 * Collection `kudos`:
 *   { id, from: { id, email, full_name, department }, recipients: [{ id, email, full_name, department }],
 *     recipient_emails: [..], message, value, likes: [email], created_at }
 * Value tags come from engagement_settings.kudos_values (admin-configurable).
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { validate } = require('../../middleware/roleCheck');
const { generateUUID, localParts } = require('../../utils/helpers');
const { emitEvent } = require('../events');
const {
  handle, validateQuery, getViewer, ACTIVE_EMPLOYEE, notifyPeople, getSettings, monthRange
} = require('./common');

const router = express.Router();

const createSchema = Joi.object({
  recipient_ids: Joi.array().items(Joi.string().trim()).min(1).max(10).unique().required(),
  message: Joi.string().trim().min(3).max(1000).required(),
  value: Joi.string().trim().min(1).max(50).required()
});

const listQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  before: Joi.date().iso(),
  employee_id: Joi.string(),
  value: Joi.string().max(50)
});

const person = (p) => ({ id: p.id, full_name: p.full_name, department: p.department || null });

/** Public shape: no email addresses, like count + whether I liked it. */
const present = (k, viewerEmail) => ({
  id: k.id,
  from: person(k.from),
  recipients: k.recipients.map(person),
  message: k.message,
  value: k.value,
  like_count: (k.likes || []).length,
  liked_by_me: (k.likes || []).includes(viewerEmail),
  is_mine: k.from.email === viewerEmail,
  to_me: (k.recipient_emails || []).includes(viewerEmail),
  created_at: k.created_at
});

router.get('/values', handle('Kudos values', async (req, res) => {
  const settings = await getSettings(getDB());
  res.json(settings.kudos_values);
}));

/**
 * GET /kudos?limit=&before=&employee_id=&value= — company feed, newest first.
 */
router.get('/', validateQuery(listQuery), handle('Kudos feed', async (req, res) => {
  const db = getDB();
  const q = req.validatedQuery;
  const filter = {};
  if (q.before) filter.created_at = { $lt: q.before };
  if (q.value) filter.value = q.value;
  if (q.employee_id) filter.$or = [{ 'recipients.id': q.employee_id }, { 'from.id': q.employee_id }];
  const items = await db.collection('kudos').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(q.limit).toArray();
  res.json({
    kudos: items.map(k => present(k, req.user.email)),
    next_before: items.length === q.limit ? items[items.length - 1].created_at : null
  });
}));

/**
 * GET /kudos/leaderboard?month=YYYY-MM — most recognised colleagues this month.
 */
router.get('/leaderboard', validateQuery(Joi.object({
  month: Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/),
  limit: Joi.number().integer().min(1).max(50).default(10)
})), handle('Kudos leaderboard', async (req, res) => {
  const db = getDB();
  const today = localParts(new Date());
  const month = req.validatedQuery.month || `${today.year}-${String(today.month).padStart(2, '0')}`;
  const { start, end } = monthRange(month);
  const match = { created_at: { $gte: start, $lt: end } };
  const limit = req.validatedQuery.limit;

  const received = await db.collection('kudos').aggregate([
    { $match: match },
    { $unwind: '$recipients' },
    { $group: { _id: '$recipients.id', full_name: { $last: '$recipients.full_name' }, department: { $last: '$recipients.department' }, count: { $sum: 1 }, values: { $push: '$value' } } },
    { $sort: { count: -1, full_name: 1 } },
    { $limit: limit }
  ]).toArray();
  const given = await db.collection('kudos').aggregate([
    { $match: match },
    { $group: { _id: '$from.id', full_name: { $last: '$from.full_name' }, department: { $last: '$from.department' }, count: { $sum: 1 } } },
    { $sort: { count: -1, full_name: 1 } },
    { $limit: limit }
  ]).toArray();
  const byValue = await db.collection('kudos').aggregate([
    { $match: match },
    { $group: { _id: '$value', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  const total = await db.collection('kudos').countDocuments(match);

  const topValue = (values) => {
    const counts = {};
    values.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  let rank = 0;
  let prev = null;
  res.json({
    month,
    total_kudos: total,
    top_received: received.map((r, i) => {
      if (r.count !== prev) { rank = i + 1; prev = r.count; }
      return { rank, employee: { id: r._id, full_name: r.full_name, department: r.department || null }, count: r.count, top_value: topValue(r.values) };
    }),
    top_given: given.map(r => ({ employee: { id: r._id, full_name: r.full_name, department: r.department || null }, count: r.count })),
    by_value: byValue.map(v => ({ value: v._id, count: v.count }))
  });
}));

/**
 * POST /kudos { recipient_ids, message, value }
 */
router.post('/', validate(createSchema), handle('Send kudos', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const data = req.validatedBody;
  const settings = await getSettings(db);
  const value = settings.kudos_values.find(v => v.toLowerCase() === data.value.toLowerCase());
  if (!value) return res.status(400).json({ detail: `Pick one of: ${settings.kudos_values.join(', ')}` });

  const recipients = await db.collection('employees')
    .find({ id: { $in: data.recipient_ids }, ...ACTIVE_EMPLOYEE }, { projection: { _id: 0, id: 1, email: 1, full_name: 1, department: 1 } })
    .toArray();
  if (recipients.some(r => r.email === viewer.email) || (viewer.employee && data.recipient_ids.includes(viewer.employee.id))) {
    return res.status(400).json({ detail: "You can't send kudos to yourself" });
  }
  if (recipients.length !== data.recipient_ids.length) return res.status(400).json({ detail: 'One or more colleagues were not found' });

  const kudos = {
    id: generateUUID(),
    from: { id: viewer.employee?.id || viewer.id, email: viewer.email, full_name: viewer.name, department: viewer.department },
    recipients,
    recipient_emails: recipients.map(r => r.email),
    message: data.message,
    value,
    likes: [],
    created_at: new Date()
  };
  await db.collection('kudos').insertOne(kudos);
  notifyPeople(recipients, {
    type: 'kudos_received',
    title: `${viewer.name} gave you kudos for ${value} 🎉`,
    message: data.message.slice(0, 160),
    actionUrl: '/engagement/kudos',
    metadata: { kudos_id: kudos.id, value }
  }).catch(() => {});
  emitEvent('kudos.sent', { id: kudos.id, from: viewer.name, to: recipients.map(r => r.full_name), value });
  res.status(201).json(present(kudos, viewer.email));
}));

/**
 * POST /kudos/:id/like, DELETE /kudos/:id/like
 */
router.post('/:id/like', handle('Like kudos', async (req, res) => {
  const db = getDB();
  const updated = await db.collection('kudos').findOneAndUpdate(
    { id: req.params.id },
    { $addToSet: { likes: req.user.email } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  if (!updated) return res.status(404).json({ detail: 'Kudos not found' });
  res.json(present(updated, req.user.email));
}));

router.delete('/:id/like', handle('Unlike kudos', async (req, res) => {
  const db = getDB();
  const updated = await db.collection('kudos').findOneAndUpdate(
    { id: req.params.id },
    { $pull: { likes: req.user.email } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  if (!updated) return res.status(404).json({ detail: 'Kudos not found' });
  res.json(present(updated, req.user.email));
}));

/**
 * DELETE /kudos/:id — the sender or an admin.
 */
router.delete('/:id', handle('Delete kudos', async (req, res) => {
  const db = getDB();
  const k = await db.collection('kudos').findOne({ id: req.params.id });
  if (!k) return res.status(404).json({ detail: 'Kudos not found' });
  if (req.user.role !== 'admin' && k.from.email !== req.user.email) {
    return res.status(403).json({ detail: 'Only the sender or an admin can delete kudos' });
  }
  await db.collection('kudos').deleteOne({ id: k.id });
  res.json({ message: 'Kudos deleted' });
}));

module.exports = { router };
