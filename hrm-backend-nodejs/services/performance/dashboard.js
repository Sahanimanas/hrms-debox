/**
 * Cross-cutting performance endpoints:
 *  - GET /pending-actions  dashboard widget ("Self review due", "2 goals awaiting your approval", …)
 *  - GET /people           colleague picker (minimal directory fields only)
 */

const express = require('express');
const { getDB } = require('../../config/database');
const { h, fail, todayStr, addDays, teamEmails, teamMembers, personView, isActiveEmployee } = require('./common');

const router = express.Router();

router.get('/people', h(async (req, res) => {
  const db = getDB();
  const scope = req.query.scope || 'all';
  let people;
  if (scope === 'team') people = await teamMembers(db, req);
  else if (scope === 'all') {
    people = (await db.collection('employees').find({}, { projection: { _id: 0 } }).sort({ full_name: 1 }).toArray()).filter(isActiveEmployee);
  } else fail(400, 'Unknown scope');
  const departments = [...new Set(people.map(p => p.department).filter(Boolean))].sort();
  const designations = [...new Set(people.map(p => p.designation).filter(Boolean))].sort();
  res.json({ people: people.map(personView), departments, designations });
}));

router.get('/pending-actions', h(async (req, res) => {
  const db = getDB();
  const me = req.user.email;
  const today = todayStr();
  const isLead = req.user.role === 'admin' || req.user.role === 'manager';
  const team = isLead || req.me ? await teamEmails(db, req) : [];
  const items = [];
  const add = (key, label, href, extra = {}) => items.push({ key, label, href, count: 1, tone: 'normal', ...extra });

  // ---- PF-1 goals
  const activeCycles = await db.collection('review_cycles').find({ status: 'active' }, { projection: { _id: 0 } }).toArray();
  if (req.me && req.user.role !== 'admin') {
    for (const c of activeCycles) {
      const goals = await db.collection('goals').find({ cycle_id: c.id, employee_email: me }, { projection: { approval_status: 1, weightage: 1 } }).toArray();
      const sentBack = goals.filter(g => g.approval_status === 'sent_back').length;
      const drafts = goals.filter(g => g.approval_status === 'draft').length;
      const deadlineOpen = !c.goal_deadline || c.goal_deadline >= today;
      if (sentBack) add(`goals-sent-back-${c.id}`, `${sentBack} goal${sentBack > 1 ? 's' : ''} sent back for changes`, '/performance/goals', { count: sentBack, tone: 'urgent' });
      else if (deadlineOpen && (!goals.length || drafts)) {
        add(`goals-set-${c.id}`, `Set and submit your goals for ${c.name}`, '/performance/goals', { due: c.goal_deadline || null });
      }
    }
  }
  if (team.length) {
    const awaiting = await db.collection('goals').countDocuments({ employee_email: { $in: team }, approval_status: 'submitted' });
    if (awaiting) add('goals-approval', `${awaiting} goal${awaiting > 1 ? 's' : ''} awaiting your approval`, '/performance/goals?tab=team', { count: awaiting, tone: 'urgent' });
  }

  // ---- PF-2 appraisals
  const configs = await db.collection('appraisal_configs').find({ phase: { $ne: 'setup' } }, { projection: { _id: 0 } }).toArray();
  for (const c of configs) {
    const mine = await db.collection('appraisals').findOne({ cycle_id: c.cycle_id, employee_email: me });
    if (c.phase === 'self_review' && mine && mine.self_status !== 'submitted') {
      add(`self-review-${c.cycle_id}`, `Self review due for ${c.cycle_name}`, '/performance/appraisals', { due: c.self_review_due || null, tone: 'urgent' });
    }
    if (c.phase === 'released' && mine && !mine.acknowledgement) {
      add(`appraisal-ack-${c.cycle_id}`, `Your ${c.cycle_name} appraisal results are ready`, '/performance/appraisals?tab=results', { tone: 'urgent' });
    }
    if (team.length && c.phase === 'manager_review') {
      const pending = await db.collection('appraisals').countDocuments({ cycle_id: c.cycle_id, employee_email: { $in: team }, manager_status: { $ne: 'submitted' } });
      if (pending) add(`manager-review-${c.cycle_id}`, `${pending} manager review${pending > 1 ? 's' : ''} pending`, '/performance/appraisals?tab=team', { count: pending, due: c.manager_review_due || null, tone: 'urgent' });
    }
    if (team.length && ['self_review', 'manager_review', 'peer_feedback'].includes(c.phase)) {
      const noms = await db.collection('peer_feedback').countDocuments({ cycle_id: c.cycle_id, reviewee_email: { $in: team }, status: 'nominated' });
      if (noms) add(`peer-noms-${c.cycle_id}`, `${noms} peer nomination${noms > 1 ? 's' : ''} to approve`, '/performance/appraisals?tab=team', { count: noms });
    }
    if (c.phase === 'peer_feedback') {
      const asks = await db.collection('peer_feedback').countDocuments({ cycle_id: c.cycle_id, peer_email: me, status: 'approved' });
      if (asks) add(`peer-feedback-${c.cycle_id}`, `${asks} peer feedback request${asks > 1 ? 's' : ''}`, '/performance/appraisals?tab=peer', { count: asks });
    }
    if (req.user.role === 'admin' && c.phase === 'calibration') {
      add(`calibration-${c.cycle_id}`, `Calibrate and release ${c.cycle_name}`, '/performance/appraisals?tab=admin');
    }
  }

  // ---- PF-3 1:1s and feedback
  const weekAhead = new Date(Date.now() + 7 * 86400000);
  const upcoming = await db.collection('one_on_ones').countDocuments({
    $or: [{ manager_email: me }, { employee_email: me }], status: 'scheduled', scheduled_at: { $gte: new Date(Date.now() - 3600000), $lte: weekAhead }
  });
  if (upcoming) add('one-on-ones', `${upcoming} 1:1${upcoming > 1 ? 's' : ''} in the next 7 days`, '/performance/one-on-ones', { count: upcoming });
  const openItems = await db.collection('one_on_ones').aggregate([
    // Open items carry over to the next occurrence, so only count the latest meeting of each series
    { $match: { $or: [{ manager_email: me }, { employee_email: me }], next_id: null, status: { $ne: 'cancelled' } } },
    { $unwind: '$action_items' },
    { $match: { 'action_items.owner_email': me, 'action_items.done': false } },
    { $count: 'n' }
  ]).toArray();
  const openCount = openItems[0]?.n || 0;
  if (openCount) add('action-items', `${openCount} open 1:1 action item${openCount > 1 ? 's' : ''}`, '/performance/one-on-ones', { count: openCount });
  const fbReq = await db.collection('feedback_requests').countDocuments({ recipient_email: me, status: 'pending' });
  if (fbReq) add('feedback-requests', `${fbReq} feedback request${fbReq > 1 ? 's' : ''} waiting for you`, '/performance/feedback?tab=requests', { count: fbReq });

  // ---- PF-4 PIPs
  const myPip = await db.collection('pips').findOne({ employee_email: me, status: 'active', acknowledgement: null });
  if (myPip) add('pip-ack', 'Review and acknowledge your improvement plan', `/performance/pips?id=${myPip.id}`, { tone: 'urgent' });
  if (team.length) {
    const due = await db.collection('pips').countDocuments({ employee_email: { $in: team }, status: 'active', next_check_in_date: { $lte: today } });
    if (due) add('pip-checkins', `${due} PIP check-in${due > 1 ? 's' : ''} due`, '/performance/pips', { count: due, tone: 'urgent' });
  }

  // ---- PF-5 learning, certifications, skills
  const overdue = await db.collection('course_assignments').countDocuments({ employee_email: me, status: { $ne: 'completed' }, due_date: { $ne: null, $lt: today } });
  if (overdue) add('courses-overdue', `${overdue} overdue course${overdue > 1 ? 's' : ''}`, '/performance/learning?tab=my', { count: overdue, tone: 'urgent' });
  const dueSoon = await db.collection('course_assignments').countDocuments({ employee_email: me, status: { $ne: 'completed' }, due_date: { $gte: today, $lte: addDays(today, 7) } });
  if (dueSoon) add('courses-due', `${dueSoon} course${dueSoon > 1 ? 's' : ''} due this week`, '/performance/learning?tab=my', { count: dueSoon });
  const certs = await db.collection('certifications').countDocuments({ employee_email: me, expiry_date: { $ne: null, $lte: addDays(today, 30) } });
  if (certs) add('certs-expiring', `${certs} certification${certs > 1 ? 's' : ''} expiring or expired`, '/performance/certifications', { count: certs });
  if (team.length) {
    const toValidate = await db.collection('employee_skills').distinct('employee_email', { employee_email: { $in: team }, status: 'pending_validation' });
    if (toValidate.length) add('skills-validate', `${toValidate.length} team member${toValidate.length > 1 ? 's' : ''} with skills to validate`, '/performance/skills?tab=team', { count: toValidate.length });
  }

  res.json({ items, total: items.reduce((s, i) => s + (i.count || 1), 0) });
}));

module.exports = { router };
