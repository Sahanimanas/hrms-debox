/**
 * Scheduled reminders for the performance module (registered by cron/jobs/performance.js).
 * Each function takes the db handle and returns a small summary object.
 * Reminders are de-duplicated with markers stored on the documents.
 */

const { todayStr, addDays, daysBetween, notify, resolveManager } = require('./common');

/** PF-4: remind managers about due PIP check-ins and plans about to end. */
async function pipReminders(db) {
  const today = todayStr();
  const pips = await db.collection('pips').find({ status: 'active' }).toArray();
  let checkIns = 0;
  let ending = 0;
  for (const pip of pips) {
    if (pip.last_reminder_date === today) continue;
    let managerEmail = pip.manager_email;
    if (!managerEmail) {
      const emp = await db.collection('employees').findOne({ email: pip.employee_email });
      managerEmail = (await resolveManager(db, emp))?.email || null;
    }
    const target = managerEmail || (await db.collection('employees').findOne({ role: 'admin' }))?.email;
    if (!target) continue;
    let sent = false;
    if (pip.next_check_in_date && pip.next_check_in_date <= addDays(today, 1)) {
      notify(target, {
        type: 'pip_check_in_due',
        title: 'PIP check-in due',
        message: `A check-in on ${pip.employee_name}'s improvement plan is due ${pip.next_check_in_date <= today ? 'now' : 'tomorrow'}`,
        actionUrl: `/performance/pips?id=${pip.id}`,
        metadata: { pip_id: pip.id }
      });
      checkIns += 1;
      sent = true;
    }
    const left = daysBetween(today, pip.end_date);
    if (left <= 3) {
      notify(target, {
        type: 'pip_ending',
        title: left < 0 ? 'PIP outcome overdue' : 'PIP ending soon',
        message: left < 0
          ? `${pip.employee_name}'s improvement plan ended on ${pip.end_date}; record the outcome`
          : `${pip.employee_name}'s improvement plan ends on ${pip.end_date}; prepare the outcome`,
        actionUrl: `/performance/pips?id=${pip.id}`,
        metadata: { pip_id: pip.id }
      });
      ending += 1;
      sent = true;
    }
    if (sent) await db.collection('pips').updateOne({ id: pip.id }, { $set: { last_reminder_date: today } });
  }
  return { active: pips.length, check_in_reminders: checkIns, ending_reminders: ending };
}

/** PF-5: mandatory courses due within 7 days (and overdue ones), one reminder per stage. */
async function learningReminders(db) {
  const today = todayStr();
  const list = await db.collection('course_assignments').find({
    mandatory: true,
    status: { $ne: 'completed' },
    due_date: { $ne: null, $lte: addDays(today, 7) }
  }).toArray();
  const sent = { due_7d: 0, due_1d: 0, overdue: 0 };
  for (const a of list) {
    const left = daysBetween(today, a.due_date);
    const stage = left < 0 ? 'overdue' : left <= 1 ? 'due_1d' : 'due_7d';
    if ((a.reminder_stages || []).includes(stage)) continue;
    notify(a.employee_email, {
      type: stage === 'overdue' ? 'course_overdue' : 'course_due_soon',
      title: stage === 'overdue' ? 'Mandatory course overdue' : 'Mandatory course due soon',
      message: stage === 'overdue'
        ? `"${a.course_title}" was due on ${a.due_date}`
        : `"${a.course_title}" is due on ${a.due_date}`,
      actionUrl: '/performance/learning?tab=my',
      metadata: { assignment_id: a.id }
    });
    if (stage === 'overdue') {
      const emp = await db.collection('employees').findOne({ email: a.employee_email });
      const manager = await resolveManager(db, emp);
      if (manager) {
        notify(manager.email, {
          type: 'course_overdue_team',
          title: 'Team member has an overdue course',
          message: `${a.employee_name} has not completed mandatory course "${a.course_title}" (due ${a.due_date})`,
          actionUrl: '/performance/learning?tab=assignments',
          metadata: { assignment_id: a.id }
        });
      }
    }
    await db.collection('course_assignments').updateOne({ id: a.id }, { $addToSet: { reminder_stages: stage }, $set: { last_reminder_date: today } });
    sent[stage] += 1;
  }
  return sent;
}

/** PF-5: certification expiry alerts at 30 days, 7 days and on expiry. */
async function certificationExpiryAlerts(db) {
  const today = todayStr();
  const list = await db.collection('certifications').find({ expiry_date: { $ne: null, $lte: addDays(today, 30) } }).toArray();
  const sent = { d30: 0, d7: 0, expired: 0 };
  for (const c of list) {
    const left = daysBetween(today, c.expiry_date);
    const stage = left < 0 ? 'expired' : left <= 7 ? 'd7' : 'd30';
    if ((c.alerts_sent || []).includes(stage)) continue;
    notify(c.employee_email, {
      type: stage === 'expired' ? 'certification_expired' : 'certification_expiring',
      title: stage === 'expired' ? 'Certification expired' : 'Certification expiring soon',
      message: stage === 'expired' ? `${c.name} expired on ${c.expiry_date}` : `${c.name} expires on ${c.expiry_date}`,
      actionUrl: '/performance/certifications',
      metadata: { certification_id: c.id }
    });
    if (stage === 'expired') {
      const emp = await db.collection('employees').findOne({ email: c.employee_email });
      const manager = await resolveManager(db, emp);
      if (manager) {
        notify(manager.email, {
          type: 'certification_expired_team',
          title: 'Team certification expired',
          message: `${c.employee_name}'s ${c.name} certification expired on ${c.expiry_date}`,
          actionUrl: '/performance/certifications?tab=team',
          metadata: { certification_id: c.id }
        });
      }
    }
    await db.collection('certifications').updateOne({ id: c.id }, { $addToSet: { alerts_sent: stage } });
    sent[stage] += 1;
  }
  return sent;
}

/** PF-3: morning reminder for today's 1:1s. */
async function oneOnOneReminders(db) {
  const today = todayStr();
  const start = new Date(Date.now() - 3600000);
  const end = new Date(Date.now() + 24 * 3600000);
  const list = await db.collection('one_on_ones').find({ status: 'scheduled', scheduled_at: { $gte: start, $lte: end }, reminder_date: { $ne: today } }).toArray();
  for (const m of list) {
    for (const email of [m.manager_email, m.employee_email]) {
      notify(email, {
        type: 'one_on_one_reminder',
        title: 'Upcoming 1:1',
        message: `${m.title} at ${new Date(m.scheduled_at).toISOString()}. Add your talking points.`,
        actionUrl: `/performance/one-on-ones?id=${m.id}`,
        metadata: { one_on_one_id: m.id }
      });
    }
    await db.collection('one_on_ones').updateOne({ id: m.id }, { $set: { reminder_date: today } });
  }
  return { reminded: list.length };
}

module.exports = { pipReminders, learningReminders, certificationExpiryAlerts, oneOnOneReminders };
