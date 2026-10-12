/**
 * EN-2 Birthdays and work anniversaries.
 *
 * Reads employees.date_of_birth (lifecycle) and employees.joining_date.
 * Feb 29 dates are celebrated on Feb 28 in non-leap years.
 *
 * Collections:
 *   celebration_wishes        { id, celebration_key, type, year, celebrant_id, celebrant_email,
 *                               from_email, from_name, message, created_at }
 *   celebration_notifications { key: '<date>:<type>:<employee id>' | '<date>:company', sent_at }
 *
 * Non-admins never see a birth year or age.
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../config/database');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const {
  handle, validateQuery, getViewer, ACTIVE_EMPLOYEE, audienceMembers, notifyPeople,
  todayLocal, addDays, daysBetween, calendarParts, pad, getSettings
} = require('./common');
const { occurrenceIn } = require('./dates');

const router = express.Router();

const WISH_WINDOW_PAST_DAYS = 7;
const WISH_WINDOW_FUTURE_DAYS = 7;

/**
 * Celebrations for active employees between `from` and `to` (inclusive, YYYY-MM-DD).
 * Returns raw entries with the employee record attached.
 */
const findCelebrations = async (db, from, to) => {
  const employees = await db.collection('employees')
    .find(
      { ...ACTIVE_EMPLOYEE, $or: [{ date_of_birth: { $ne: null } }, { joining_date: { $ne: null } }] },
      { projection: { _id: 0, id: 1, employee_id: 1, email: 1, full_name: 1, department: 1, designation: 1, date_of_birth: 1, joining_date: 1 } }
    )
    .toArray();

  const inactive = new Set(
    (await db.collection('users').find({ is_active: false }, { projection: { email: 1 } }).toArray()).map(u => u.email)
  );

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const entries = [];

  for (const e of employees) {
    if (inactive.has(e.email)) continue;
    const sources = [
      ['birthday', calendarParts(e.date_of_birth)],
      ['anniversary', calendarParts(e.joining_date)]
    ];
    for (const [type, parts] of sources) {
      if (!parts) continue;
      for (let y = fromYear; y <= toYear; y++) {
        const date = occurrenceIn(y, parts.month, parts.day);
        if (date < from || date > to) continue;
        const years = y - parts.year;
        if (years <= 0) continue; // not born / not joined yet, or joining day itself
        entries.push({ type, date, years, employee: e, origin: parts });
      }
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || (a.employee.full_name || '').localeCompare(b.employee.full_name || ''));
  return entries;
};

const celebrationKey = (type, employeeId, year) => `${type}:${employeeId}:${year}`;

/** Shape a celebration for the viewer (hides birth year / age from non-admins). */
const present = (entry, today, viewer, wishInfo) => {
  const e = entry.employee;
  const year = Number(entry.date.slice(0, 4));
  const key = celebrationKey(entry.type, e.id, year);
  const out = {
    key,
    type: entry.type,
    date: entry.date,
    days_away: daysBetween(today, entry.date),
    is_today: entry.date === today,
    employee: { id: e.id, full_name: e.full_name, department: e.department || null, designation: e.designation || null },
    is_me: e.email === viewer.email,
    wish_count: wishInfo.counts[key] || 0,
    i_wished: wishInfo.mine.has(key)
  };
  if (entry.type === 'anniversary') out.years = entry.years;
  if (viewer.isAdmin && entry.type === 'birthday') {
    out.date_of_birth = `${entry.origin.year}-${pad(entry.origin.month)}-${pad(entry.origin.day)}`;
    out.age = entry.years;
  }
  return out;
};

const wishInfoFor = async (db, keys, viewerEmail) => {
  if (!keys.length) return { counts: {}, mine: new Set() };
  const wishes = await db.collection('celebration_wishes')
    .find({ celebration_key: { $in: keys } }, { projection: { celebration_key: 1, from_email: 1 } })
    .toArray();
  const counts = {};
  const mine = new Set();
  for (const w of wishes) {
    counts[w.celebration_key] = (counts[w.celebration_key] || 0) + 1;
    if (w.from_email === viewerEmail) mine.add(w.celebration_key);
  }
  return { counts, mine };
};

// ============= ROUTES =============

/**
 * GET /celebrations?days=7
 * Birthdays and work anniversaries today and in the next `days` days.
 */
router.get('/', validateQuery(Joi.object({
  days: Joi.number().integer().min(0).max(31).default(7),
  type: Joi.string().valid('birthday', 'anniversary')
})), handle('Celebrations', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const today = todayLocal();
  const to = addDays(today, req.validatedQuery.days);
  let entries = await findCelebrations(db, today, to);
  if (req.validatedQuery.type) entries = entries.filter(e => e.type === req.validatedQuery.type);
  const keys = entries.map(e => celebrationKey(e.type, e.employee.id, Number(e.date.slice(0, 4))));
  const info = await wishInfoFor(db, keys, viewer.email);
  const celebrations = entries.map(e => present(e, today, viewer, info));
  res.json({
    today,
    to,
    celebrations,
    today_count: celebrations.filter(c => c.is_today).length
  });
}));

const wishSchema = Joi.object({
  employee_id: Joi.string().trim().required(),
  type: Joi.string().valid('birthday', 'anniversary').required(),
  message: Joi.string().trim().min(1).max(500).required()
});

/**
 * POST /celebrations/wishes { employee_id, type, message }
 * Post a wish to a colleague's birthday / anniversary (within a week either side).
 */
router.post('/wishes', validate(wishSchema), handle('Post wish', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const { employee_id, type, message } = req.validatedBody;
  const celebrant = await db.collection('employees').findOne({ id: employee_id, ...ACTIVE_EMPLOYEE });
  if (!celebrant) return res.status(404).json({ detail: 'Colleague not found' });
  if (celebrant.email === viewer.email) return res.status(400).json({ detail: 'You cannot wish yourself' });

  const today = todayLocal();
  const entries = await findCelebrations(db, addDays(today, -WISH_WINDOW_PAST_DAYS), addDays(today, WISH_WINDOW_FUTURE_DAYS));
  const entry = entries
    .filter(e => e.employee.id === celebrant.id && e.type === type)
    .sort((a, b) => Math.abs(daysBetween(today, a.date)) - Math.abs(daysBetween(today, b.date)))[0];
  if (!entry) return res.status(400).json({ detail: `There is no ${type} to celebrate for this colleague right now` });

  const year = Number(entry.date.slice(0, 4));
  const key = celebrationKey(type, celebrant.id, year);
  const wish = {
    id: generateUUID(),
    celebration_key: key,
    type,
    year,
    celebration_date: entry.date,
    celebrant_id: celebrant.id,
    celebrant_email: celebrant.email,
    from_email: viewer.email,
    from_name: viewer.name,
    from_department: viewer.department,
    message,
    created_at: new Date()
  };
  try {
    await db.collection('celebration_wishes').insertOne(wish);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ detail: 'You have already sent a wish for this celebration' });
    throw error;
  }
  notifyPeople([{ id: celebrant.id, email: celebrant.email }], {
    type: 'celebration_wish',
    title: type === 'birthday' ? `${viewer.name} wished you a happy birthday` : `${viewer.name} congratulated you on your work anniversary`,
    message: message.slice(0, 160),
    actionUrl: '/engagement/celebrations',
    metadata: { celebration_key: key, wish_id: wish.id }
  }).catch(() => {});
  delete wish._id;
  const { celebrant_email: _omit, ...publicWish } = wish;
  res.status(201).json(publicWish);
}));

/**
 * GET /celebrations/wishes/mine — wishes I received, newest celebration first.
 */
router.get('/wishes/mine', handle('My wishes', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const wishes = await db.collection('celebration_wishes')
    .find({ celebrant_email: viewer.email }, { projection: { _id: 0, celebrant_email: 0, from_email: 0 } })
    .sort({ created_at: -1 })
    .limit(500)
    .toArray();
  const groups = new Map();
  for (const w of wishes) {
    if (!groups.has(w.celebration_key)) {
      groups.set(w.celebration_key, { key: w.celebration_key, type: w.type, year: w.year, date: w.celebration_date, wishes: [] });
    }
    groups.get(w.celebration_key).wishes.push(w);
  }
  res.json({ total: wishes.length, celebrations: [...groups.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))) });
}));

/**
 * GET /celebrations/wishes/sent — wishes I sent.
 */
router.get('/wishes/sent', handle('Sent wishes', async (req, res) => {
  const db = getDB();
  const wishes = await db.collection('celebration_wishes')
    .find({ from_email: req.user.email }, { projection: { _id: 0, celebrant_email: 0, from_email: 0 } })
    .sort({ created_at: -1 })
    .limit(200)
    .toArray();
  res.json(wishes);
}));

/**
 * GET /celebrations/:key/wishes — wishes for one celebration (celebrant or admin).
 */
router.get('/:key/wishes', handle('Celebration wishes', async (req, res) => {
  const db = getDB();
  const viewer = await getViewer(db, req.user);
  const [, employeeId] = String(req.params.key).split(':');
  const celebrant = employeeId ? await db.collection('employees').findOne({ id: employeeId }) : null;
  if (!celebrant) return res.status(404).json({ detail: 'Celebration not found' });
  if (!viewer.isAdmin && celebrant.email !== viewer.email) {
    return res.status(403).json({ detail: 'Only the person being celebrated can read these wishes' });
  }
  const wishes = await db.collection('celebration_wishes')
    .find({ celebration_key: req.params.key }, { projection: { _id: 0, celebrant_email: 0, from_email: 0 } })
    .sort({ created_at: 1 })
    .toArray();
  res.json(wishes);
}));

// ============= DAILY JOB =============

/**
 * Notify today's celebrants and (optionally) the whole company.
 * Idempotent per day: re-running the same day sends nothing new.
 */
const runCelebrationsJob = async (db, { today = todayLocal() } = {}) => {
  const entries = (await findCelebrations(db, today, today));
  const settings = await getSettings(db);
  const log = db.collection('celebration_notifications');
  let celebrantsNotified = 0;

  for (const entry of entries) {
    const e = entry.employee;
    const key = `${today}:${entry.type}:${e.id}`;
    const { upsertedCount } = await log.updateOne({ key }, { $setOnInsert: { key, sent_at: new Date() } }, { upsert: true });
    if (!upsertedCount) continue;
    const isBirthday = entry.type === 'birthday';
    await notifyPeople([{ id: e.id, email: e.email }], {
      type: isBirthday ? 'birthday' : 'work_anniversary',
      title: isBirthday ? `Happy birthday, ${(e.full_name || '').split(' ')[0]}! 🎂` : `Happy ${entry.years}-year work anniversary! 🎉`,
      message: isBirthday
        ? 'Wishing you a wonderful birthday from everyone at the company.'
        : `Thank you for ${entry.years} year${entry.years === 1 ? '' : 's'} with us.`,
      actionUrl: '/engagement/celebrations',
      metadata: { type: entry.type, date: today }
    });
    celebrantsNotified += 1;
  }

  let companyNotified = 0;
  if (settings.celebrations_company_wide && entries.length) {
    const key = `${today}:company`;
    const { upsertedCount } = await log.updateOne({ key }, { $setOnInsert: { key, sent_at: new Date() } }, { upsert: true });
    if (upsertedCount) {
      const names = (list) => list.map(x => x.employee.full_name).join(', ');
      const birthdays = entries.filter(x => x.type === 'birthday');
      const anniversaries = entries.filter(x => x.type === 'anniversary');
      const parts = [];
      if (birthdays.length) parts.push(`Birthdays: ${names(birthdays)}`);
      if (anniversaries.length) parts.push(`Work anniversaries: ${names(anniversaries)}`);
      const members = await audienceMembers(db, { type: 'everyone' });
      const celebrantEmails = entries.map(x => x.employee.email);
      companyNotified = await notifyPeople(members, {
        type: 'celebrations_today',
        title: 'Celebrations today 🎉',
        message: `${parts.join(' · ')}. Send them your wishes!`,
        actionUrl: '/engagement/celebrations',
        metadata: { date: today }
      }, { exclude: celebrantEmails });
    }
  }

  return { date: today, celebrations: entries.length, celebrants_notified: celebrantsNotified, company_notified: companyNotified };
};

module.exports = { router, runCelebrationsJob, findCelebrations, occurrenceIn };
