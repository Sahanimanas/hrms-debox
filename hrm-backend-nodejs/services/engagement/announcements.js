/**
 * EN-1 Announcements.
 *
 * Collection `announcements` (shared contract):
 *   { id, title, body, pinned, published_at, expires_at, audience: { type, departments },
 *     created_by, created_by_name, notified_at, created_at, updated_at }
 * Collection `announcement_reads`: { announcement_id, user_email, user_name, department, read_at }
 *
 * Body is plain text with simple markdown (bold, italics, links, bullets); the
 * frontend renders it without HTML injection.
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { emitEvent } = require('../events');
const {
  handle, validateQuery, getViewer, audienceSchema, audienceObject, normalizeAudience, inAudience,
  audienceFilter, audienceMembers, notifyPeople
} = require('./common');

const router = express.Router();
const admin = requireRole(['admin']);

const createSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  body: Joi.string().trim().min(1).max(20000).required(),
  audience: audienceSchema,
  pinned: Joi.boolean().default(false),
  publish_at: Joi.date().iso().allow(null).default(null),
  expires_at: Joi.date().iso().allow(null).default(null)
});

const updateSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200),
  body: Joi.string().trim().min(1).max(20000),
  audience: audienceObject,
  pinned: Joi.boolean(),
  publish_at: Joi.date().iso().allow(null),
  expires_at: Joi.date().iso().allow(null)
}).min(1);

const statusOf = (a, now = new Date()) => {
  if (a.published_at > now) return 'scheduled';
  if (a.expires_at && a.expires_at <= now) return 'expired';
  return 'live';
};

const liveFilter = (now = new Date()) => ({
  published_at: { $lte: now },
  $or: [{ expires_at: null }, { expires_at: { $gt: now } }]
});

const PROJECTION = { _id: 0 };

/**
 * Send the publish notification for an announcement once it is live. Claims
 * the announcement atomically so it is only ever notified once.
 */
const notifyIfDue = async (db, id) => {
  const now = new Date();
  const claimed = await db.collection('announcements').findOneAndUpdate(
    { id, notified_at: null, published_at: { $lte: now }, $or: [{ expires_at: null }, { expires_at: { $gt: now } }] },
    { $set: { notified_at: now } },
    { returnDocument: 'after', projection: PROJECTION }
  );
  if (!claimed) return 0;
  const members = await audienceMembers(db, claimed.audience);
  emitEvent('announcement.published', { id: claimed.id, title: claimed.title, audience: claimed.audience });
  return notifyPeople(members, {
    type: 'announcement_published',
    title: claimed.pinned ? `📌 ${claimed.title}` : `New announcement: ${claimed.title}`,
    message: claimed.body.replace(/[*_[\]()#>`]/g, '').slice(0, 160),
    actionUrl: '/engagement/announcements',
    metadata: { announcement_id: claimed.id }
  }, { exclude: [claimed.created_by] });
};

/** Notify every announcement whose scheduled time has arrived (cron + lazy). */
const publishDue = async (db) => {
  const now = new Date();
  const due = await db.collection('announcements')
    .find({ notified_at: null, ...liveFilter(now) }, { projection: { id: 1 } })
    .toArray();
  let notified = 0;
  for (const a of due) {
    const n = await notifyIfDue(db, a.id);
    notified += n ? 1 : 0;
  }
  return { announcements: due.length, notified };
};

// ============= FEED (everyone) =============

/**
 * GET /announcements/feed?limit=
 * Live announcements for the viewer's audience, pinned first, newest first.
 */
router.get('/feed', validateQuery(Joi.object({ limit: Joi.number().integer().min(1).max(100).default(30) })), handle('Announcement feed', async (req, res) => {
  const db = getDB();
  publishDue(db).catch(err => console.error('[engagement] publishDue:', err.message));
  const viewer = await getViewer(db, req.user);
  const now = new Date();
  const items = await db.collection('announcements')
    .find({ $and: [liveFilter(now), audienceFilter(viewer)] }, { projection: { ...PROJECTION, notified_at: 0 } })
    .sort({ pinned: -1, published_at: -1 })
    .limit(req.validatedQuery.limit)
    .toArray();
  const reads = await db.collection('announcement_reads')
    .find({ user_email: viewer.email, announcement_id: { $in: items.map(a => a.id) } }, { projection: { announcement_id: 1 } })
    .toArray();
  const readSet = new Set(reads.map(r => r.announcement_id));
  const announcements = items.map(a => ({ ...a, is_read: readSet.has(a.id) }));
  res.json({ announcements, unread: announcements.filter(a => !a.is_read).length });
}));

/**
 * POST /announcements/:id/read — mark as read by the current user.
 */
router.post('/:id/read', handle('Mark announcement read', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const a = await db.collection('announcements').findOne({ id: req.params.id });
  if (!a || statusOf(a) !== 'live' || !inAudience(a.audience, viewer)) {
    return res.status(404).json({ detail: 'Announcement not found' });
  }
  await db.collection('announcement_reads').updateOne(
    { announcement_id: a.id, user_email: viewer.email },
    { $setOnInsert: { announcement_id: a.id, user_email: viewer.email, user_name: viewer.name, department: viewer.department, read_at: new Date() } },
    { upsert: true }
  );
  res.json({ message: 'Marked as read' });
}));

// ============= ADMIN =============

/**
 * GET /announcements — every announcement with status and read counts (admin).
 */
router.get('/', admin, validateQuery(Joi.object({ status: Joi.string().valid('live', 'scheduled', 'expired') })), handle('List announcements', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const items = await db.collection('announcements').find({}, { projection: PROJECTION }).sort({ pinned: -1, published_at: -1 }).toArray();
  const counts = await db.collection('announcement_reads').aggregate([
    { $group: { _id: '$announcement_id', count: { $sum: 1 } } }
  ]).toArray();
  const countMap = Object.fromEntries(counts.map(c => [c._id, c.count]));

  const audienceSizes = new Map();
  const result = [];
  for (const a of items) {
    const status = statusOf(a, now);
    if (req.validatedQuery.status && req.validatedQuery.status !== status) continue;
    const key = JSON.stringify(normalizeAudience(a.audience));
    if (!audienceSizes.has(key)) audienceSizes.set(key, (await audienceMembers(db, a.audience)).length);
    result.push({ ...a, status, read_count: countMap[a.id] || 0, audience_size: audienceSizes.get(key) });
  }
  res.json(result);
}));

/**
 * GET /announcements/:id — one announcement (admin, or viewer in its live audience).
 */
router.get('/:id', handle('Get announcement', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const a = await db.collection('announcements').findOne({ id: req.params.id }, { projection: PROJECTION });
  if (!a) return res.status(404).json({ detail: 'Announcement not found' });
  const status = statusOf(a);
  if (!viewer.isAdmin && (status !== 'live' || !inAudience(a.audience, viewer))) {
    return res.status(404).json({ detail: 'Announcement not found' });
  }
  if (!viewer.isAdmin) delete a.notified_at;
  res.json({ ...a, status });
}));

/**
 * GET /announcements/:id/reads — who has read it (admin).
 */
router.get('/:id/reads', admin, handle('Announcement reads', async (req, res) => {
  const db = getDB();
  const a = await db.collection('announcements').findOne({ id: req.params.id }, { projection: PROJECTION });
  if (!a) return res.status(404).json({ detail: 'Announcement not found' });
  const reads = await db.collection('announcement_reads')
    .find({ announcement_id: a.id }, { projection: { _id: 0, announcement_id: 0 } })
    .sort({ read_at: -1 })
    .toArray();
  const members = await audienceMembers(db, a.audience);
  const readEmails = new Set(reads.map(r => r.user_email));
  const unread = members.filter(m => !readEmails.has(m.email)).map(m => ({ user_email: m.email, user_name: m.full_name, department: m.department || null }));
  res.json({
    announcement_id: a.id,
    title: a.title,
    audience_size: members.length,
    read_count: reads.length,
    read_percent: members.length ? Math.round((members.filter(m => readEmails.has(m.email)).length / members.length) * 100) : 0,
    reads,
    unread
  });
}));

/**
 * POST /announcements (admin)
 */
router.post('/', admin, validate(createSchema), handle('Create announcement', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const now = new Date();
  const publishedAt = data.publish_at && data.publish_at > now ? data.publish_at : now;
  if (data.expires_at && data.expires_at <= publishedAt) {
    return res.status(400).json({ detail: 'Expiry must be after the publish time' });
  }
  const announcement = {
    id: generateUUID(),
    title: data.title,
    body: data.body,
    pinned: data.pinned,
    audience: normalizeAudience(data.audience),
    published_at: publishedAt,
    expires_at: data.expires_at || null,
    created_by: req.user.email,
    created_by_name: req.user.full_name,
    notified_at: null,
    created_at: now,
    updated_at: now
  };
  await db.collection('announcements').insertOne(announcement);
  notifyIfDue(db, announcement.id).catch(err => console.error('[engagement] notify:', err.message));
  delete announcement._id;
  res.status(201).json({ ...announcement, status: statusOf(announcement) });
}));

/**
 * PUT /announcements/:id (admin)
 */
router.put('/:id', admin, validate(updateSchema), handle('Update announcement', async (req, res) => {
  const db = getDB();
  const a = await db.collection('announcements').findOne({ id: req.params.id });
  if (!a) return res.status(404).json({ detail: 'Announcement not found' });
  const data = req.validatedBody;
  const now = new Date();
  const updates = { updated_at: now };
  for (const f of ['title', 'body', 'pinned']) if (data[f] !== undefined) updates[f] = data[f];
  if (data.audience !== undefined) updates.audience = normalizeAudience(data.audience);
  if (data.publish_at !== undefined) {
    if (a.notified_at && data.publish_at && data.publish_at > now) {
      return res.status(400).json({ detail: 'This announcement is already published; it cannot be rescheduled' });
    }
    if (!a.notified_at) updates.published_at = data.publish_at && data.publish_at > now ? data.publish_at : now;
  }
  if (data.expires_at !== undefined) updates.expires_at = data.expires_at || null;
  const publishedAt = updates.published_at || a.published_at;
  const expiresAt = updates.expires_at !== undefined ? updates.expires_at : a.expires_at;
  if (expiresAt && expiresAt <= publishedAt) {
    return res.status(400).json({ detail: 'Expiry must be after the publish time' });
  }
  await db.collection('announcements').updateOne({ id: a.id }, { $set: updates });
  notifyIfDue(db, a.id).catch(err => console.error('[engagement] notify:', err.message));
  const updated = await db.collection('announcements').findOne({ id: a.id }, { projection: PROJECTION });
  res.json({ ...updated, status: statusOf(updated) });
}));

/**
 * DELETE /announcements/:id (admin)
 */
router.delete('/:id', admin, handle('Delete announcement', async (req, res) => {
  const db = getDB();
  const { deletedCount } = await db.collection('announcements').deleteOne({ id: req.params.id });
  if (!deletedCount) return res.status(404).json({ detail: 'Announcement not found' });
  await db.collection('announcement_reads').deleteMany({ announcement_id: req.params.id });
  res.json({ message: 'Announcement deleted' });
}));

module.exports = { router, publishDue, statusOf };
