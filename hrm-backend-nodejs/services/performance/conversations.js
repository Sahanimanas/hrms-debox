/**
 * PF-3 1:1 meetings and continuous feedback.
 *
 * Collections:
 *  - one_on_ones        { id, manager_email, employee_email, scheduled_at (Date), duration_minutes, status, … }
 *                       (shape shared with the platform calendar feed — see docs/MODULES.md)
 *  - feedback           praise / constructive feedback between colleagues
 *  - feedback_requests  "please give me feedback on <topic>"
 *
 * Private notes on a 1:1 are only ever returned to their author.
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { emitEvent } = require('../events');
const {
  h, fail, now, generateUUID, DATE,
  findEmployee, isManagerOf, teamEmails, resolveManager, notify, isActiveEmployee
} = require('./common');

const router = express.Router();

const RECURRENCE = ['none', 'weekly', 'biweekly', 'monthly'];

// ============= SCHEMAS =============

const meetingCreate = Joi.object({
  employee_email: Joi.string().email().required(),
  scheduled_at: Joi.date().iso().required(),
  duration_minutes: Joi.number().integer().min(5).max(480).default(30),
  title: Joi.string().trim().max(200).allow('', null),
  recurrence: Joi.string().valid(...RECURRENCE).default('none'),
  meeting_link: Joi.string().trim().uri().max(500).allow('', null),
  agenda: Joi.array().items(Joi.string().trim().min(1).max(500)).max(30).default([])
});
const meetingUpdate = Joi.object({
  scheduled_at: Joi.date().iso(),
  duration_minutes: Joi.number().integer().min(5).max(480),
  title: Joi.string().trim().max(200).allow('', null),
  recurrence: Joi.string().valid(...RECURRENCE),
  meeting_link: Joi.string().trim().uri().max(500).allow('', null),
  status: Joi.string().valid('scheduled', 'cancelled')
}).min(1);
const agendaSchema = Joi.object({ text: Joi.string().trim().min(1).max(500).required() });
const agendaUpdate = Joi.object({ text: Joi.string().trim().min(1).max(500), discussed: Joi.boolean() }).min(1);
const notesSchema = Joi.object({
  shared_notes: Joi.string().max(20000).allow(''),
  private_notes: Joi.string().max(20000).allow('')
}).min(1);
const actionItemSchema = Joi.object({
  text: Joi.string().trim().min(1).max(500).required(),
  owner_email: Joi.string().email().required(),
  due_date: Joi.string().pattern(DATE).allow(null, '')
});
const actionItemUpdate = Joi.object({
  text: Joi.string().trim().min(1).max(500),
  owner_email: Joi.string().email(),
  due_date: Joi.string().pattern(DATE).allow(null, ''),
  done: Joi.boolean()
}).min(1);

const feedbackSchema = Joi.object({
  to_email: Joi.string().email().required(),
  type: Joi.string().valid('praise', 'constructive').required(),
  visibility: Joi.string().valid('private', 'manager_only').default('private'),
  message: Joi.string().trim().min(3).max(5000).required(),
  request_id: Joi.string().allow(null, '')
});
const feedbackRequestSchema = Joi.object({
  recipient_emails: Joi.array().items(Joi.string().email()).min(1).max(10).unique().required(),
  topic: Joi.string().trim().min(2).max(200).required(),
  message: Joi.string().trim().max(2000).allow('', null)
});

// ============= 1:1 HELPERS =============

const getMeeting = async (db, id) => {
  const m = await db.collection('one_on_ones').findOne({ id }, { projection: { _id: 0 } });
  if (!m) fail(404, '1:1 not found');
  return m;
};

const participantRole = (req, m) => {
  if (m.manager_email === req.user.email) return 'manager';
  if (m.employee_email === req.user.email) return 'employee';
  if (req.user.role === 'admin') return 'admin';
  return null;
};

/** Strip other people's private notes. */
const viewMeeting = (req, m) => {
  const mine = (m.private_notes || []).find(n => n.author_email === req.user.email);
  const { private_notes: _ignored, ...rest } = m;
  return {
    ...rest,
    private_notes: mine ? mine.text : '',
    private_notes_updated_at: mine ? mine.updated_at : null,
    viewer_role: participantRole(req, m)
  };
};

const loadMeeting = async (db, req, id, { participantOnly = false } = {}) => {
  const m = await getMeeting(db, id);
  const role = participantRole(req, m);
  if (!role || (participantOnly && role === 'admin')) fail(403, 'Not enough permissions');
  return { m, role };
};

const nextDate = (date, recurrence) => {
  const d = new Date(date);
  if (recurrence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === 'biweekly') d.setUTCDate(d.getUTCDate() + 14);
  else if (recurrence === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

const other = (m, email) => (m.manager_email === email ? m.employee_email : m.manager_email);

// ============= 1:1 ROUTES =============

/**
 * GET /one-on-ones?when=upcoming|past|all&scope=mine|all&employee_email
 */
router.get('/one-on-ones', h(async (req, res) => {
  const db = getDB();
  const filter = {};
  if (req.query.scope === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Not enough permissions');
  } else {
    filter.$or = [{ manager_email: req.user.email }, { employee_email: req.user.email }];
  }
  if (req.query.employee_email) filter.employee_email = req.query.employee_email;
  const when = req.query.when || 'all';
  if (when === 'upcoming') {
    filter.status = 'scheduled';
  } else if (when === 'past') {
    filter.status = { $in: ['completed', 'cancelled'] };
  }
  const list = await db.collection('one_on_ones').find(filter, { projection: { _id: 0 } })
    .sort({ scheduled_at: when === 'upcoming' ? 1 : -1 }).limit(500).toArray();
  res.json(list.map(m => viewMeeting(req, m)));
}));

router.post('/one-on-ones', requireRole(['manager', 'admin']), validate(meetingCreate), h(async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const employee = await findEmployee(db, data.employee_email);
  if (!employee || !isActiveEmployee(employee)) fail(404, 'Employee not found');
  if (!isManagerOf(req, employee)) fail(403, 'You can only schedule 1:1s with your team');
  const meeting = {
    id: generateUUID(),
    series_id: generateUUID(),
    manager_email: req.user.email,
    manager_name: req.user.full_name,
    employee_email: employee.email,
    employee_name: employee.full_name,
    title: data.title || `1:1 ${req.user.full_name} / ${employee.full_name}`,
    scheduled_at: data.scheduled_at,
    duration_minutes: data.duration_minutes,
    recurrence: data.recurrence,
    meeting_link: data.meeting_link || null,
    status: 'scheduled',
    agenda: data.agenda.map(text => ({
      id: generateUUID(), text, added_by: req.user.email, added_by_name: req.user.full_name, discussed: false, created_at: now()
    })),
    shared_notes: '',
    shared_notes_updated_by: null,
    shared_notes_updated_at: null,
    private_notes: [],
    action_items: [],
    previous_id: null,
    next_id: null,
    created_by: req.user.email,
    created_at: now(),
    updated_at: now()
  };
  await db.collection('one_on_ones').insertOne(meeting);
  notify(employee.email, {
    type: 'one_on_one_scheduled',
    title: '1:1 scheduled',
    message: `${req.user.full_name} scheduled a 1:1 with you on ${meeting.scheduled_at.toISOString()}`,
    actionUrl: `/performance/one-on-ones?id=${meeting.id}`,
    metadata: { one_on_one_id: meeting.id, scheduled_at: meeting.scheduled_at }
  });
  emitEvent('one_on_one.scheduled', { id: meeting.id, manager_email: meeting.manager_email, employee_email: meeting.employee_email, scheduled_at: meeting.scheduled_at });
  res.status(201).json(viewMeeting(req, meeting));
}));

router.get('/one-on-ones/:id', h(async (req, res) => {
  const { m } = await loadMeeting(getDB(), req, req.params.id);
  res.json(viewMeeting(req, m));
}));

router.put('/one-on-ones/:id', validate(meetingUpdate), h(async (req, res) => {
  const db = getDB();
  const { m, role } = await loadMeeting(db, req, req.params.id);
  if (role === 'employee') fail(403, 'Only the manager can change the meeting');
  if (m.status !== 'scheduled') fail(400, 'Only scheduled meetings can be changed');
  const updates = { ...req.validatedBody, updated_at: now() };
  if (updates.meeting_link === '') updates.meeting_link = null;
  await db.collection('one_on_ones').updateOne({ id: m.id }, { $set: updates });
  const fresh = await getMeeting(db, m.id);
  if (updates.scheduled_at || updates.status === 'cancelled') {
    notify(m.employee_email, {
      type: updates.status === 'cancelled' ? 'one_on_one_cancelled' : 'one_on_one_rescheduled',
      title: updates.status === 'cancelled' ? '1:1 cancelled' : '1:1 rescheduled',
      message: updates.status === 'cancelled'
        ? `${m.manager_name} cancelled your 1:1`
        : `${m.manager_name} moved your 1:1 to ${fresh.scheduled_at.toISOString()}`,
      actionUrl: `/performance/one-on-ones?id=${m.id}`,
      metadata: { one_on_one_id: m.id, scheduled_at: fresh.scheduled_at }
    });
  }
  res.json(viewMeeting(req, fresh));
}));

router.delete('/one-on-ones/:id', h(async (req, res) => {
  const db = getDB();
  const { m, role } = await loadMeeting(db, req, req.params.id);
  if (role === 'employee') fail(403, 'Only the manager can delete the meeting');
  if (m.status === 'completed') fail(400, 'Completed meetings cannot be deleted');
  await db.collection('one_on_ones').deleteOne({ id: m.id });
  if (m.previous_id) await db.collection('one_on_ones').updateOne({ id: m.previous_id }, { $set: { next_id: null } });
  res.json({ message: '1:1 deleted' });
}));

/**
 * POST /one-on-ones/:id/complete — mark done; recurring meetings get their next occurrence
 * (open action items carry over).
 */
router.post('/one-on-ones/:id/complete', h(async (req, res) => {
  const db = getDB();
  const { m, role } = await loadMeeting(db, req, req.params.id);
  if (role === 'employee') fail(403, 'Only the manager can complete the meeting');
  if (m.status !== 'scheduled') fail(400, 'Only scheduled meetings can be completed');

  let next = null;
  if (m.recurrence && m.recurrence !== 'none') {
    next = {
      ...m,
      id: generateUUID(),
      scheduled_at: nextDate(m.scheduled_at, m.recurrence),
      status: 'scheduled',
      agenda: [],
      shared_notes: '',
      shared_notes_updated_by: null,
      shared_notes_updated_at: null,
      private_notes: [],
      action_items: (m.action_items || []).filter(a => !a.done).map(a => ({ ...a, id: generateUUID(), carried_from: m.id })),
      previous_id: m.id,
      next_id: null,
      completed_at: null,
      created_at: now(),
      updated_at: now()
    };
    await db.collection('one_on_ones').insertOne(next);
    delete next._id;
    emitEvent('one_on_one.scheduled', { id: next.id, manager_email: next.manager_email, employee_email: next.employee_email, scheduled_at: next.scheduled_at });
  }
  await db.collection('one_on_ones').updateOne({ id: m.id }, {
    $set: { status: 'completed', completed_at: now(), next_id: next?.id || null, updated_at: now() }
  });
  notify(m.employee_email, {
    type: 'one_on_one_completed',
    title: '1:1 completed',
    message: next ? `Next 1:1 is on ${next.scheduled_at.toISOString()}` : `${m.manager_name} marked your 1:1 as completed`,
    actionUrl: `/performance/one-on-ones?id=${next?.id || m.id}`,
    metadata: { one_on_one_id: m.id, next_id: next?.id || null }
  });
  res.json({ meeting: viewMeeting(req, await getMeeting(db, m.id)), next: next ? viewMeeting(req, next) : null });
}));

router.post('/one-on-ones/:id/agenda', validate(agendaSchema), h(async (req, res) => {
  const db = getDB();
  const { m } = await loadMeeting(db, req, req.params.id, { participantOnly: true });
  if (m.status !== 'scheduled') fail(400, 'This meeting is closed');
  const item = { id: generateUUID(), text: req.validatedBody.text, added_by: req.user.email, added_by_name: req.user.full_name, discussed: false, created_at: now() };
  await db.collection('one_on_ones').updateOne({ id: m.id }, { $push: { agenda: item }, $set: { updated_at: now() } });
  notify(other(m, req.user.email), {
    type: 'one_on_one_agenda',
    title: '1:1 talking point added',
    message: `${req.user.full_name} added "${item.text}" to your 1:1 agenda`,
    actionUrl: `/performance/one-on-ones?id=${m.id}`,
    metadata: { one_on_one_id: m.id }
  });
  res.status(201).json(viewMeeting(req, await getMeeting(db, m.id)));
}));

router.patch('/one-on-ones/:id/agenda/:itemId', validate(agendaUpdate), h(async (req, res) => {
  const db = getDB();
  const { m } = await loadMeeting(db, req, req.params.id, { participantOnly: true });
  const item = (m.agenda || []).find(a => a.id === req.params.itemId);
  if (!item) fail(404, 'Agenda item not found');
  if (req.validatedBody.text !== undefined && item.added_by !== req.user.email) fail(403, 'You can only edit your own talking points');
  const set = { updated_at: now() };
  if (req.validatedBody.text !== undefined) set['agenda.$.text'] = req.validatedBody.text;
  if (req.validatedBody.discussed !== undefined) set['agenda.$.discussed'] = req.validatedBody.discussed;
  await db.collection('one_on_ones').updateOne({ id: m.id, 'agenda.id': item.id }, { $set: set });
  res.json(viewMeeting(req, await getMeeting(db, m.id)));
}));

router.delete('/one-on-ones/:id/agenda/:itemId', h(async (req, res) => {
  const db = getDB();
  const { m, role } = await loadMeeting(db, req, req.params.id, { participantOnly: true });
  const item = (m.agenda || []).find(a => a.id === req.params.itemId);
  if (!item) fail(404, 'Agenda item not found');
  if (item.added_by !== req.user.email && role !== 'manager') fail(403, 'You can only remove your own talking points');
  await db.collection('one_on_ones').updateOne({ id: m.id }, { $pull: { agenda: { id: item.id } }, $set: { updated_at: now() } });
  res.json(viewMeeting(req, await getMeeting(db, m.id)));
}));

router.put('/one-on-ones/:id/notes', validate(notesSchema), h(async (req, res) => {
  const db = getDB();
  const { m } = await loadMeeting(db, req, req.params.id, { participantOnly: true });
  const body = req.validatedBody;
  const set = { updated_at: now() };
  if (body.shared_notes !== undefined) {
    set.shared_notes = body.shared_notes;
    set.shared_notes_updated_by = req.user.full_name;
    set.shared_notes_updated_at = now();
  }
  if (body.private_notes !== undefined) {
    const notes = (m.private_notes || []).filter(n => n.author_email !== req.user.email);
    notes.push({ author_email: req.user.email, text: body.private_notes, updated_at: now() });
    set.private_notes = notes;
  }
  await db.collection('one_on_ones').updateOne({ id: m.id }, { $set: set });
  res.json(viewMeeting(req, await getMeeting(db, m.id)));
}));

const ownerName = (m, email) => (email === m.manager_email ? m.manager_name : email === m.employee_email ? m.employee_name : null);

router.post('/one-on-ones/:id/action-items', validate(actionItemSchema), h(async (req, res) => {
  const db = getDB();
  const { m } = await loadMeeting(db, req, req.params.id, { participantOnly: true });
  const body = req.validatedBody;
  const name = ownerName(m, body.owner_email);
  if (!name) fail(400, 'Action items must be owned by one of the participants');
  const item = {
    id: generateUUID(), text: body.text, owner_email: body.owner_email, owner_name: name,
    due_date: body.due_date || null, done: false, done_at: null, created_by: req.user.email, created_at: now()
  };
  await db.collection('one_on_ones').updateOne({ id: m.id }, { $push: { action_items: item }, $set: { updated_at: now() } });
  if (item.owner_email !== req.user.email) {
    notify(item.owner_email, {
      type: 'one_on_one_action_item',
      title: 'New action item',
      message: `${req.user.full_name} assigned you: ${item.text}${item.due_date ? ` (due ${item.due_date})` : ''}`,
      actionUrl: `/performance/one-on-ones?id=${m.id}`,
      metadata: { one_on_one_id: m.id }
    });
  }
  res.status(201).json(viewMeeting(req, await getMeeting(db, m.id)));
}));

router.patch('/one-on-ones/:id/action-items/:itemId', validate(actionItemUpdate), h(async (req, res) => {
  const db = getDB();
  const { m } = await loadMeeting(db, req, req.params.id, { participantOnly: true });
  const item = (m.action_items || []).find(a => a.id === req.params.itemId);
  if (!item) fail(404, 'Action item not found');
  const body = req.validatedBody;
  const set = { updated_at: now() };
  if (body.text !== undefined) set['action_items.$.text'] = body.text;
  if (body.due_date !== undefined) set['action_items.$.due_date'] = body.due_date || null;
  if (body.owner_email !== undefined) {
    const name = ownerName(m, body.owner_email);
    if (!name) fail(400, 'Action items must be owned by one of the participants');
    set['action_items.$.owner_email'] = body.owner_email;
    set['action_items.$.owner_name'] = name;
  }
  if (body.done !== undefined) {
    set['action_items.$.done'] = body.done;
    set['action_items.$.done_at'] = body.done ? now() : null;
  }
  await db.collection('one_on_ones').updateOne({ id: m.id, 'action_items.id': item.id }, { $set: set });
  res.json(viewMeeting(req, await getMeeting(db, m.id)));
}));

router.delete('/one-on-ones/:id/action-items/:itemId', h(async (req, res) => {
  const db = getDB();
  const { m } = await loadMeeting(db, req, req.params.id, { participantOnly: true });
  const item = (m.action_items || []).find(a => a.id === req.params.itemId);
  if (!item) fail(404, 'Action item not found');
  await db.collection('one_on_ones').updateOne({ id: m.id }, { $pull: { action_items: { id: item.id } }, $set: { updated_at: now() } });
  res.json(viewMeeting(req, await getMeeting(db, m.id)));
}));

// ============= FEEDBACK =============

/**
 * GET /feedback?box=received|given|team|all
 *  received: feedback to me that's visible to me (not "manager only")
 *  team:     feedback about people I manage (both visibilities)
 */
router.get('/feedback', h(async (req, res) => {
  const db = getDB();
  const box = req.query.box || 'received';
  let filter;
  if (box === 'received') filter = { to_email: req.user.email, visibility: 'private' };
  else if (box === 'given') filter = { from_email: req.user.email };
  else if (box === 'team') filter = { to_email: { $in: await teamEmails(db, req) } };
  else if (box === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Not enough permissions');
    filter = {};
  } else fail(400, 'Unknown box');
  if (req.query.type) filter.type = req.query.type;
  const list = await db.collection('feedback').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
  res.json(list);
}));

router.post('/feedback', validate(feedbackSchema), h(async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  if (data.to_email === req.user.email) fail(400, 'You cannot give feedback to yourself');
  const recipient = await findEmployee(db, data.to_email);
  if (!recipient || !isActiveEmployee(recipient)) fail(404, 'Colleague not found');

  let request = null;
  if (data.request_id) {
    request = await db.collection('feedback_requests').findOne({ id: data.request_id });
    if (!request || request.recipient_email !== req.user.email) fail(404, 'Feedback request not found');
    if (request.status !== 'pending') fail(400, 'This feedback request has already been answered');
    if (request.requester_email !== data.to_email) fail(400, 'Feedback for a request must go to the person who asked');
  }
  const manager = await resolveManager(db, recipient);
  const fb = {
    id: generateUUID(),
    from_email: req.user.email,
    from_name: req.user.full_name,
    to_email: recipient.email,
    to_name: recipient.full_name,
    to_department: recipient.department || null,
    manager_email: manager?.email || null,
    type: data.type,
    visibility: data.visibility,
    message: data.message,
    request_id: request?.id || null,
    topic: request?.topic || null,
    created_at: now()
  };
  await db.collection('feedback').insertOne(fb);
  delete fb._id;
  if (request) {
    await db.collection('feedback_requests').updateOne({ id: request.id }, { $set: { status: 'completed', feedback_id: fb.id, completed_at: now() } });
  }
  if (fb.visibility === 'private') {
    notify(fb.to_email, {
      type: fb.type === 'praise' ? 'feedback_praise_received' : 'feedback_received',
      title: fb.type === 'praise' ? `${req.user.full_name} sent you praise` : `${req.user.full_name} shared feedback`,
      message: fb.message.slice(0, 160),
      actionUrl: '/performance/feedback',
      metadata: { feedback_id: fb.id }
    });
  }
  if (fb.manager_email && fb.manager_email !== req.user.email) {
    notify(fb.manager_email, {
      type: 'feedback_team_member',
      title: `Feedback for ${fb.to_name}`,
      message: `${req.user.full_name} shared ${fb.type} feedback about ${fb.to_name}`,
      actionUrl: '/performance/feedback?box=team',
      metadata: { feedback_id: fb.id }
    });
  }
  emitEvent('feedback.given', { id: fb.id, type: fb.type, to_email: fb.to_email });
  res.status(201).json(fb);
}));

router.get('/feedback/requests', h(async (req, res) => {
  const db = getDB();
  const box = req.query.box || 'incoming';
  let filter;
  if (box === 'incoming') filter = { recipient_email: req.user.email };
  else if (box === 'outgoing') filter = { requester_email: req.user.email };
  else fail(400, 'Unknown box');
  if (req.query.status) filter.status = req.query.status;
  const list = await db.collection('feedback_requests').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
  res.json(list);
}));

router.post('/feedback/requests', validate(feedbackRequestSchema), h(async (req, res) => {
  const db = getDB();
  const { recipient_emails, topic, message } = req.validatedBody;
  if (recipient_emails.includes(req.user.email)) fail(400, 'You cannot ask yourself for feedback');
  const docs = [];
  for (const email of recipient_emails) {
    const r = await findEmployee(db, email);
    if (!r || !isActiveEmployee(r)) fail(404, `${email} is not an active employee`);
    docs.push({
      id: generateUUID(),
      requester_email: req.user.email,
      requester_name: req.user.full_name,
      recipient_email: r.email,
      recipient_name: r.full_name,
      topic,
      message: message || '',
      status: 'pending',
      feedback_id: null,
      created_at: now()
    });
  }
  await db.collection('feedback_requests').insertMany(docs);
  docs.forEach(d => {
    delete d._id;
    notify(d.recipient_email, {
      type: 'feedback_requested',
      title: 'Feedback requested',
      message: `${req.user.full_name} asked for your feedback on "${topic}"`,
      actionUrl: '/performance/feedback?tab=requests',
      metadata: { request_id: d.id }
    });
  });
  res.status(201).json(docs);
}));

router.post('/feedback/requests/:id/decline', h(async (req, res) => {
  const db = getDB();
  const r = await db.collection('feedback_requests').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!r || r.recipient_email !== req.user.email) fail(404, 'Feedback request not found');
  if (r.status !== 'pending') fail(400, 'This request has already been answered');
  await db.collection('feedback_requests').updateOne({ id: r.id }, { $set: { status: 'declined', completed_at: now() } });
  res.json({ ...r, status: 'declined' });
}));

router.delete('/feedback/requests/:id', h(async (req, res) => {
  const db = getDB();
  const r = await db.collection('feedback_requests').findOne({ id: req.params.id });
  if (!r || r.requester_email !== req.user.email) fail(404, 'Feedback request not found');
  if (r.status !== 'pending') fail(400, 'Only pending requests can be withdrawn');
  await db.collection('feedback_requests').deleteOne({ id: r.id });
  res.json({ message: 'Request withdrawn' });
}));

module.exports = { router };
