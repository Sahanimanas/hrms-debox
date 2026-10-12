/**
 * EN-5a Quick polls.
 *
 * Collections:
 *   polls       { id, question, options: [{ id, text }], multi_select, closes_at, audience, status: 'open'|'closed',
 *                 created_by, created_by_name, created_at, updated_at, closed_at }
 *   poll_votes  { poll_id, user_email, option_ids, created_at }   (unique per poll + user)
 *
 * Results are visible after voting, after the poll closes, or to its creator / admins.
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const {
  handle, validateQuery, getViewer, audienceSchema, normalizeAudience, inAudience,
  audienceFilter, audienceMembers, notifyPeople
} = require('./common');

const router = express.Router();

const createSchema = Joi.object({
  question: Joi.string().trim().min(1).max(300).required(),
  options: Joi.array().items(Joi.string().trim().min(1).max(150)).min(2).max(10).unique((a, b) => a.toLowerCase() === b.toLowerCase()).required(),
  multi_select: Joi.boolean().default(false),
  closes_at: Joi.date().iso().allow(null).default(null),
  audience: audienceSchema,
  notify: Joi.boolean().default(false)
});

const voteSchema = Joi.object({
  option_ids: Joi.array().items(Joi.string()).min(1).max(10).unique().required()
});

const isClosed = (p, now = new Date()) => p.status === 'closed' || (!!p.closes_at && p.closes_at <= now);

const canManage = (poll, viewer) => viewer.isAdmin || poll.created_by === viewer.email;

const tally = async (db, poll) => {
  const votes = await db.collection('poll_votes').find({ poll_id: poll.id }, { projection: { option_ids: 1 } }).toArray();
  const counts = Object.fromEntries(poll.options.map(o => [o.id, 0]));
  votes.forEach(v => v.option_ids.forEach(id => { if (id in counts) counts[id] += 1; }));
  return {
    total_votes: votes.length,
    options: poll.options.map(o => ({
      ...o,
      votes: counts[o.id],
      percent: votes.length ? Math.round((counts[o.id] / votes.length) * 1000) / 10 : 0
    }))
  };
};

const present = async (db, poll, viewer) => {
  const { _id: _i, ...p } = poll;
  const myVote = await db.collection('poll_votes').findOne({ poll_id: poll.id, user_email: viewer.email });
  const closed = isClosed(poll);
  const showResults = closed || !!myVote || canManage(poll, viewer);
  const out = {
    ...p,
    state: closed ? 'closed' : 'open',
    my_vote: myVote ? myVote.option_ids : null,
    can_manage: canManage(poll, viewer),
    results_visible: showResults
  };
  if (showResults) Object.assign(out, await tally(db, poll));
  else out.total_votes = await db.collection('poll_votes').countDocuments({ poll_id: poll.id });
  return out;
};

/**
 * GET /polls?state=open|closed
 */
router.get('/', validateQuery(Joi.object({ state: Joi.string().valid('open', 'closed') })), handle('List polls', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const filter = viewer.isAdmin ? {} : { $or: [audienceFilter(viewer), { created_by: viewer.email }] };
  const polls = await db.collection('polls').find(filter).sort({ created_at: -1 }).limit(200).toArray();
  const out = [];
  for (const p of polls) {
    const state = isClosed(p) ? 'closed' : 'open';
    if (req.validatedQuery.state && state !== req.validatedQuery.state) continue;
    out.push(await present(db, p, viewer));
  }
  // Open polls first, then newest
  out.sort((a, b) => (a.state === b.state ? 0 : a.state === 'open' ? -1 : 1));
  res.json(out);
}));

router.get('/:id', handle('Get poll', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const poll = await db.collection('polls').findOne({ id: req.params.id });
  if (!poll || !(inAudience(poll.audience, viewer, { adminSeesAll: true }) || poll.created_by === viewer.email)) {
    return res.status(404).json({ detail: 'Poll not found' });
  }
  res.json(await present(db, poll, viewer));
}));

/**
 * POST /polls (admin, manager)
 */
router.post('/', requireRole(['admin', 'manager']), validate(createSchema), handle('Create poll', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  if (data.closes_at && data.closes_at <= new Date()) return res.status(400).json({ detail: 'The close date must be in the future' });
  const now = new Date();
  const poll = {
    id: generateUUID(),
    question: data.question,
    options: data.options.map(text => ({ id: generateUUID(), text })),
    multi_select: data.multi_select,
    closes_at: data.closes_at,
    audience: normalizeAudience(data.audience),
    status: 'open',
    created_by: req.user.email,
    created_by_name: req.user.full_name,
    created_at: now,
    updated_at: now,
    closed_at: null
  };
  await db.collection('polls').insertOne(poll);
  if (data.notify) {
    audienceMembers(db, poll.audience)
      .then(members => notifyPeople(members, {
        type: 'poll_published',
        title: 'New poll',
        message: poll.question,
        actionUrl: '/engagement/polls',
        metadata: { poll_id: poll.id }
      }, { exclude: [poll.created_by] }))
      .catch(err => console.error('[engagement] poll notify:', err.message));
  }
  const viewer = await getViewer(db, req.user);
  res.status(201).json(await present(db, poll, viewer));
}));

/**
 * POST /polls/:id/vote { option_ids } — one vote per person, can't be changed.
 */
router.post('/:id/vote', validate(voteSchema), handle('Vote', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const poll = await db.collection('polls').findOne({ id: req.params.id });
  if (!poll || !inAudience(poll.audience, viewer)) return res.status(404).json({ detail: 'Poll not found' });
  if (isClosed(poll)) return res.status(400).json({ detail: 'This poll is closed' });
  const { option_ids } = req.validatedBody;
  const valid = new Set(poll.options.map(o => o.id));
  if (option_ids.some(id => !valid.has(id))) return res.status(400).json({ detail: 'Unknown option' });
  if (!poll.multi_select && option_ids.length > 1) return res.status(400).json({ detail: 'This poll allows only one choice' });
  try {
    await db.collection('poll_votes').insertOne({ poll_id: poll.id, user_email: viewer.email, option_ids, created_at: new Date() });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ detail: 'You have already voted in this poll' });
    throw error;
  }
  res.status(201).json(await present(db, poll, viewer));
}));

router.post('/:id/close', handle('Close poll', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const poll = await db.collection('polls').findOne({ id: req.params.id });
  if (!poll) return res.status(404).json({ detail: 'Poll not found' });
  if (!canManage(poll, viewer)) return res.status(403).json({ detail: 'Only the poll creator or an admin can close it' });
  if (isClosed(poll)) return res.status(400).json({ detail: 'Poll is already closed' });
  const now = new Date();
  await db.collection('polls').updateOne({ id: poll.id }, { $set: { status: 'closed', closed_at: now, updated_at: now } });
  res.json(await present(db, await db.collection('polls').findOne({ id: poll.id }), viewer));
}));

router.delete('/:id', handle('Delete poll', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const poll = await db.collection('polls').findOne({ id: req.params.id });
  if (!poll) return res.status(404).json({ detail: 'Poll not found' });
  if (!canManage(poll, viewer)) return res.status(403).json({ detail: 'Only the poll creator or an admin can delete it' });
  await db.collection('polls').deleteOne({ id: poll.id });
  await db.collection('poll_votes').deleteMany({ poll_id: poll.id });
  res.json({ message: 'Poll deleted' });
}));

module.exports = { router };
