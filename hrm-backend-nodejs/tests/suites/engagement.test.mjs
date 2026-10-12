// Phase 5 — Engagement & communication (EN-1 … EN-6)
import { createRequire } from 'node:module';
import { run, section, check, get, post, put, patch, del, http, upload, bootstrap, createUser, withDb, BACKEND_DIR } from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const dates = require(`${BACKEND_DIR}/services/engagement/dates.js`);

const E = '/v2/engagement';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

/** Wait for a notification (they are created in the background). */
async function waitForNotification(email, type, match = () => true, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await withDb(db => db.collection('notifications').find({ user_email: email, type }).toArray());
    const hit = found.find(match);
    if (hit) return hit;
    await sleep(150);
  }
  return null;
}
const countNotifications = (email, type, match = {}) =>
  withDb(db => db.collection('notifications').countDocuments({ user_email: email, type, ...match }));

const idOf = (email) => withDb(db => db.collection('employees').findOne({ email }).then(e => e?.id));

await run(async () => {
  const admin = await bootstrap();
  const mgr = await createUser(admin, { role: 'manager', name: 'Maya Manager', department: 'Engineering' });
  const emp1 = await createUser(admin, { role: 'employee', name: 'Eli Engineer', department: 'Engineering', manager_email: mgr.email });
  const emp2 = await createUser(admin, { role: 'employee', name: 'Sam Sales', department: 'Sales' });
  const emp3 = await createUser(admin, { role: 'employee', name: 'Erin Engineer', department: 'Engineering', manager_email: mgr.email });
  for (const u of [mgr, emp1, emp2, emp3]) u.id = await idOf(u.email);

  let r;

  // ======================================================================
  section('EN-1 Announcements');
  r = await post(`${E}/announcements`, emp1.token, { title: 'Hi', body: 'x' });
  check('employee cannot create an announcement', r.s === 403, r);
  r = await post(`${E}/announcements`, admin, { body: 'No title' });
  check('missing title rejected', r.s === 422, r);
  r = await post(`${E}/announcements`, admin, { title: 'T', body: 'B', audience: { type: 'departments', departments: [] } });
  check('department audience needs at least one department', r.s === 422, r);
  r = await post(`${E}/announcements`, admin, { title: 'T', body: 'B', publish_at: inHours(5), expires_at: inHours(2) });
  check('expiry before publish time rejected', r.s === 400, r);

  r = await post(`${E}/announcements`, admin, { title: 'Office closed Friday', body: 'The office is **closed** on Friday.\n- Work from home\n- See [policy](https://example.com)', pinned: true });
  check('create pinned company-wide announcement', r.s === 201 && r.d.status === 'live' && r.d.pinned === true, r);
  const annPinned = r.d?.id;
  r = await post(`${E}/announcements`, admin, { title: 'Sales kickoff', body: 'Sales team kickoff at 10am', audience: { type: 'departments', departments: ['Sales'] } });
  check('create department-only announcement', r.s === 201 && r.d.audience.departments[0] === 'Sales', r);
  const annSales = r.d?.id;
  r = await post(`${E}/announcements`, admin, { title: 'Quarterly results', body: 'Coming soon', publish_at: inHours(2) });
  check('scheduled announcement is not live yet', r.s === 201 && r.d.status === 'scheduled', r);
  const annScheduled = r.d?.id;
  r = await post(`${E}/announcements`, admin, { title: 'Cafeteria menu', body: '<script>alert(1)</script> *new* menu' });
  check('create normal announcement', r.s === 201, r);
  const annNormal = r.d?.id;

  r = await get(`${E}/announcements/feed`, emp1.token);
  const feed1 = r.d?.announcements || [];
  check('feed returns live announcements for my audience', r.s === 200 && feed1.some(a => a.id === annPinned) && feed1.some(a => a.id === annNormal), r.d);
  check('feed hides other departments and scheduled posts', !feed1.some(a => a.id === annSales) && !feed1.some(a => a.id === annScheduled), feed1.map(a => a.title));
  check('pinned announcements come first', feed1[0]?.id === annPinned, feed1.map(a => a.title));
  check('body is returned verbatim (rendered safely client-side)', feed1.find(a => a.id === annNormal)?.body.startsWith('<script>'), feed1);
  check('feed counts unread', r.d?.unread === feed1.length, r.d);
  r = await get(`${E}/announcements/feed`, emp2.token);
  check('department member sees the department announcement', r.d?.announcements?.some(a => a.id === annSales), r.d);

  check('audience is notified on publish', !!(await waitForNotification(emp1.email, 'announcement_published', n => n.metadata?.announcement_id === annPinned)));
  check('people outside the audience are not notified', (await countNotifications(emp1.email, 'announcement_published', { 'metadata.announcement_id': annSales })) === 0);

  r = await post(`${E}/announcements/${annPinned}/read`, emp1.token);
  check('mark as read', r.s === 200, r);
  await post(`${E}/announcements/${annPinned}/read`, emp1.token);
  r = await get(`${E}/announcements/feed`, emp1.token);
  check('feed shows read state', r.d?.announcements?.find(a => a.id === annPinned)?.is_read === true, r.d);
  r = await post(`${E}/announcements/${annSales}/read`, emp1.token);
  check('cannot read an announcement outside my audience', r.s === 404, r);
  r = await post(`${E}/announcements/${annScheduled}/read`, emp1.token);
  check('cannot read a scheduled announcement', r.s === 404, r);

  r = await get(`${E}/announcements`, emp1.token);
  check('employee cannot list all announcements', r.s === 403, r);
  r = await get(`${E}/announcements`, admin);
  const pinnedRow = r.d?.find?.(a => a.id === annPinned);
  check('admin list has read counts (repeat reads counted once)', pinnedRow?.read_count === 1 && pinnedRow.audience_size >= 5, pinnedRow);
  check('admin list shows scheduled status', r.d?.find?.(a => a.id === annScheduled)?.status === 'scheduled', r.d);
  r = await get(`${E}/announcements/${annPinned}/reads`, admin);
  check('read report lists readers and unread', r.s === 200 && r.d.reads.some(x => x.user_email === emp1.email) && r.d.unread.some(x => x.user_email === emp3.email), r.d);
  r = await get(`${E}/announcements/${annPinned}/reads`, mgr.token);
  check('manager cannot see read report', r.s === 403, r);

  // Scheduled announcement goes live → job publishes and notifies
  await withDb(db => db.collection('announcements').updateOne({ id: annScheduled }, { $set: { published_at: new Date(Date.now() - 60000) } }));
  r = await post('/v2/jobs/announcements-publish/run', admin);
  check('publish job notifies newly-live announcements', r.s === 200 && r.d.result?.notified === 1, r);
  check('scheduled announcement notifies when it goes live', !!(await waitForNotification(emp3.email, 'announcement_published', n => n.metadata?.announcement_id === annScheduled)));
  r = await post('/v2/jobs/announcements-publish/run', admin);
  check('publish job does not notify twice', r.d?.result?.notified === 0, r);
  r = await get(`${E}/announcements/feed`, emp1.token);
  check('now-live announcement appears in the feed', r.d?.announcements?.some(a => a.id === annScheduled), r.d);

  // Expiry
  await withDb(db => db.collection('announcements').updateOne({ id: annNormal }, { $set: { expires_at: new Date(Date.now() - 1000) } }));
  r = await get(`${E}/announcements/feed`, emp1.token);
  check('expired announcements drop out of the feed', !r.d?.announcements?.some(a => a.id === annNormal), r.d);
  r = await get(`${E}/announcements?status=expired`, admin);
  check('admin can filter expired', r.d?.length === 1 && r.d[0].id === annNormal, r.d);

  r = await put(`${E}/announcements/${annPinned}`, admin, { title: 'Office closed Friday (updated)', pinned: false });
  check('edit announcement', r.s === 200 && r.d.title.includes('updated') && r.d.pinned === false, r);
  r = await put(`${E}/announcements/${annPinned}`, admin, { publish_at: inHours(3) });
  check('cannot reschedule an already-published announcement', r.s === 400, r);
  r = await put(`${E}/announcements/${annPinned}`, emp1.token, { title: 'x' });
  check('employee cannot edit', r.s === 403, r);
  r = await del(`${E}/announcements/${annSales}`, admin);
  check('delete announcement', r.s === 200, r);
  r = await get(`${E}/announcements/feed`, emp2.token);
  check('deleted announcement is gone', !r.d?.announcements?.some(a => a.id === annSales), r.d);
  r = await del(`${E}/announcements/${annSales}`, admin);
  check('delete unknown announcement → 404', r.s === 404, r);

  // ======================================================================
  section('EN-2 Birthdays and work anniversaries');
  check('Feb 29 is celebrated on Feb 28 in non-leap years', dates.occurrenceIn(2025, 2, 29) === '2025-02-28' && dates.occurrenceIn(2100, 2, 29) === '2100-02-28');
  check('Feb 29 stays Feb 29 in leap years', dates.occurrenceIn(2028, 2, 29) === '2028-02-29' && dates.occurrenceIn(2000, 2, 29) === '2000-02-29');
  check('UTC-midnight dates keep their calendar day', JSON.stringify(dates.calendarParts(new Date('1990-03-15T00:00:00Z'))) === JSON.stringify({ year: 1990, month: 3, day: 15 }));

  r = await get(`${E}/celebrations`, emp2.token);
  check('celebrations endpoint works', r.s === 200 && typeof r.d.today === 'string', r);
  const today = r.d.today;
  const [ty, tm, td] = today.split('-').map(Number);
  const in3 = addDays(today, 3);
  const [, m3, d3] = in3.split('-').map(Number);
  const exited = await createUser(admin, { role: 'employee', name: 'Xavier Exited', department: 'Sales' });
  await withDb(async db => {
    await db.collection('employees').updateOne({ email: emp1.email }, { $set: { date_of_birth: new Date(Date.UTC(1990, tm - 1, td)) } });
    await db.collection('employees').updateOne({ email: emp2.email }, { $set: { date_of_birth: new Date(Date.UTC(1992, m3 - 1, d3)) } });
    await db.collection('employees').updateOne({ email: emp3.email }, { $set: { joining_date: new Date(Date.UTC(ty - 2, tm - 1, td)) } });
    await db.collection('employees').updateOne({ email: exited.email }, { $set: { date_of_birth: new Date(Date.UTC(1985, tm - 1, td)), employment_status: 'exited' } });
  });

  r = await get(`${E}/celebrations`, emp2.token);
  const cel = r.d?.celebrations || [];
  const bday1 = cel.find(c => c.type === 'birthday' && c.employee.id === emp1.id);
  check("today's birthday listed", bday1?.is_today === true && bday1.date === today && bday1.days_away === 0, cel);
  check('upcoming birthday (in 3 days) listed', cel.some(c => c.type === 'birthday' && c.employee.id === emp2.id && c.days_away === 3), cel);
  check('work anniversary listed with years of service', cel.some(c => c.type === 'anniversary' && c.employee.id === emp3.id && c.years === 2 && c.is_today), cel);
  check('people who joined today are not an anniversary', !cel.some(c => c.type === 'anniversary' && c.employee.id === emp1.id), cel);
  check('exited employees are not celebrated', !cel.some(c => c.employee.full_name === 'Xavier Exited'), cel);
  check('non-admins never see birth year or age', !JSON.stringify(cel).includes('1990') && !JSON.stringify(cel).includes('1992') && bday1 && !('age' in bday1) && !('date_of_birth' in bday1), bday1);
  check('no email addresses exposed', !JSON.stringify(cel).includes('@'), cel);
  r = await get(`${E}/celebrations`, admin);
  const adminBday = r.d?.celebrations?.find(c => c.type === 'birthday' && c.employee.id === emp1.id);
  check('admins see date of birth and age', adminBday?.date_of_birth?.startsWith('1990-') && adminBday.age === ty - 1990, adminBday);
  r = await get(`${E}/celebrations?days=0`, emp2.token);
  check('days=0 returns only today', r.d?.celebrations?.every(c => c.is_today) && r.d.celebrations.length >= 2, r.d);
  r = await get(`${E}/celebrations?days=400`, emp2.token);
  check('days out of range rejected', r.s === 422, r);
  r = await get(`${E}/celebrations?type=anniversary`, emp2.token);
  check('filter by type', r.d?.celebrations?.length && r.d.celebrations.every(c => c.type === 'anniversary'), r.d);

  r = await post(`${E}/celebrations/wishes`, emp2.token, { employee_id: emp1.id, type: 'birthday', message: 'Happy birthday Eli! 🎂' });
  check('colleague posts a birthday wish', r.s === 201 && r.d.message.includes('Happy') && !('celebrant_email' in r.d), r);
  r = await post(`${E}/celebrations/wishes`, emp2.token, { employee_id: emp1.id, type: 'birthday', message: 'Again!' });
  check('only one wish per person per celebration', r.s === 409, r);
  r = await post(`${E}/celebrations/wishes`, emp1.token, { employee_id: emp1.id, type: 'birthday', message: 'Me!' });
  check('cannot wish yourself', r.s === 400, r);
  r = await post(`${E}/celebrations/wishes`, emp1.token, { employee_id: emp3.id, type: 'birthday', message: 'Hi' });
  check('cannot wish when there is no celebration', r.s === 400, r);
  r = await post(`${E}/celebrations/wishes`, emp1.token, { employee_id: emp3.id, type: 'anniversary', message: '' });
  check('empty wish rejected', r.s === 422, r);
  r = await post(`${E}/celebrations/wishes`, emp1.token, { employee_id: emp3.id, type: 'anniversary', message: 'Congrats on 2 years!' });
  check('anniversary wish', r.s === 201, r);
  r = await post(`${E}/celebrations/wishes`, emp1.token, { employee_id: emp2.id, type: 'birthday', message: 'Early happy birthday!' });
  check('can wish an upcoming birthday', r.s === 201, r);
  check('celebrant is notified of a wish', !!(await waitForNotification(emp1.email, 'celebration_wish')));

  r = await get(`${E}/celebrations`, emp2.token);
  const after = r.d?.celebrations?.find(c => c.type === 'birthday' && c.employee.id === emp1.id);
  check('wish count and my-wish flag', after?.wish_count === 1 && after.i_wished === true, after);
  r = await get(`${E}/celebrations/wishes/mine`, emp1.token);
  check('celebrant sees wishes they received', r.s === 200 && r.d.total === 1 && r.d.celebrations[0].wishes[0].from_name === 'Sam Sales', r.d);
  check('received wishes hide sender emails', !JSON.stringify(r.d).includes('@'), r.d);
  r = await get(`${E}/celebrations/${encodeURIComponent(after.key)}/wishes`, emp3.token);
  check("others cannot read someone's wishes", r.s === 403, r);
  r = await get(`${E}/celebrations/${encodeURIComponent(after.key)}/wishes`, emp1.token);
  check('celebrant can read wishes for the celebration', r.s === 200 && r.d.length === 1, r);

  r = await post('/v2/jobs/celebrations/run', emp1.token);
  check('employees cannot run the celebrations job', r.s === 403, r);
  r = await post('/v2/jobs/celebrations/run', admin);
  check('daily job notifies today\'s celebrants', r.s === 200 && r.d.result?.celebrants_notified >= 2 && r.d.result.company_notified === 0, r);
  check('birthday notification sent', !!(await waitForNotification(emp1.email, 'birthday')));
  check('anniversary notification sent', !!(await waitForNotification(emp3.email, 'work_anniversary')));
  check('exited employee not notified', (await countNotifications(exited.email, 'birthday')) === 0);
  r = await post('/v2/jobs/celebrations/run', admin);
  check('job is idempotent within a day', r.d?.result?.celebrants_notified === 0, r);

  r = await put(`${E}/settings`, emp1.token, { celebrations_company_wide: true });
  check('employee cannot change settings', r.s === 403, r);
  r = await put(`${E}/settings`, admin, { celebrations_company_wide: true });
  check('admin enables company-wide celebration notices', r.s === 200 && r.d.celebrations_company_wide === true, r);
  r = await post('/v2/jobs/celebrations/run', admin);
  check('company-wide notice sent to everyone else', r.d?.result?.company_notified >= 2, r);
  check('colleague receives the company-wide notice', !!(await waitForNotification(emp2.email, 'celebrations_today')));
  check('celebrant is not sent the company-wide notice', (await countNotifications(emp1.email, 'celebrations_today')) === 0);

  // ======================================================================
  section('EN-3 Policy acknowledgement');
  const tomorrow = addDays(today, 1);
  r = await post(`${E}/policies`, emp1.token, { title: 'X', body: 'Y' });
  check('employee cannot publish a policy', r.s === 403, r);
  r = await post(`${E}/policies`, admin, { body: 'No title' });
  check('missing title rejected', r.s === 422, r);
  r = await post(`${E}/policies`, admin, { title: 'Empty' });
  check('policy needs text or a PDF', r.s === 400, r);
  r = await post(`${E}/policies`, admin, { title: 'Code of Conduct', category: 'HR', body: 'Be **kind**.', requires_ack: true, due_date: tomorrow });
  check('publish policy (v1)', r.s === 201 && r.d.version === 1 && r.d.requires_ack === true && !('file_key' in r.d), r);
  const polId = r.d?.id;
  check('audience is notified about the new policy', !!(await waitForNotification(emp3.email, 'policy_published', n => n.metadata?.policy_id === polId)));

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  r = await upload(`${E}/policies`, admin, [{ field: 'file', name: 'it-policy.pdf', type: 'application/pdf', content: pdf }], { title: 'IT Security Policy', requires_ack: 'true', audience: JSON.stringify({ type: 'departments', departments: ['Sales'] }) });
  check('publish policy with an uploaded PDF', r.s === 201 && /\.pdf$/.test(r.d.file_url || '') && r.d.file_name === 'it-policy.pdf', r);
  const polSales = r.d?.id;
  r = await upload(`${E}/policies`, admin, [{ field: 'file', name: 'evil.exe', type: 'application/octet-stream', content: 'MZ' }], { title: 'Bad' });
  check('non-PDF upload rejected', r.s === 400, r);
  r = await post(`${E}/policies`, admin, { title: 'Holiday calendar', body: 'FYI only', requires_ack: false });
  const polInfo = r.d?.id;
  check('publish info-only policy', r.s === 201 && r.d.requires_ack === false, r);

  r = await get(`${E}/policies`, emp1.token);
  const myPol = r.d?.find?.(p => p.id === polId);
  check('employee sees pending acknowledgement', myPol?.my_ack?.pending === true && myPol.my_ack.required === true, myPol);
  check('employee does not see other departments\' policies', !r.d?.some?.(p => p.id === polSales), r.d);
  check('employee list has no admin stats', myPol && !('stats' in myPol), myPol);
  r = await get(`${E}/policies?pending=true`, emp1.token);
  check('pending filter', r.d?.length === 1 && r.d[0].id === polId, r.d);
  r = await get(`${E}/policies/${polSales}`, emp1.token);
  check('cannot open a policy outside my audience', r.s === 404, r);
  r = await post(`${E}/policies/${polSales}/acknowledge`, emp1.token);
  check('cannot acknowledge a policy outside my audience', r.s === 404, r);
  r = await post(`${E}/policies/${polInfo}/acknowledge`, emp1.token);
  check('info-only policy cannot be acknowledged', r.s === 400, r);
  r = await get(`${E}/policies/${polId}`, emp1.token);
  check('employee reads the policy body', r.s === 200 && r.d.body === 'Be **kind**.' && !('history' in r.d), r);

  r = await post(`${E}/policies/${polId}/acknowledge`, emp1.token, { version: 1 });
  check('"I have read and agree" stores version + timestamp', r.s === 201 && r.d.version === 1 && !!r.d.acknowledged_at, r);
  r = await post(`${E}/policies/${polId}/acknowledge`, emp1.token, { version: 1 });
  check('acknowledging twice is harmless', r.s === 200, r);
  r = await get(`${E}/policies`, emp1.token);
  check('list shows acknowledged', r.d?.find?.(p => p.id === polId)?.my_ack?.acknowledged === true, r.d);

  r = await get(`${E}/policies/${polId}/acknowledgements`, admin);
  check('admin sees acknowledgement % and pending list', r.s === 200 && r.d.acknowledged_count === 1 && r.d.pending.some(p => p.email === emp3.email) && r.d.percent > 0 && r.d.percent < 100, r.d);
  r = await get(`${E}/policies`, admin);
  check('admin list includes stats', r.d?.find?.(p => p.id === polId)?.stats?.acknowledged === 1, r.d);
  r = await get(`${E}/policies/${polId}/acknowledgements`, mgr.token);
  check('manager sees only their team', r.s === 200 && r.d.scope === 'team' && r.d.total === 2 && !r.d.pending.some(p => p.email === emp2.email), r.d);
  r = await get(`${E}/policies/${polId}/acknowledgements`, emp1.token);
  check('employee cannot see acknowledgement tracking', r.s === 403, r);

  r = await put(`${E}/policies/${polId}`, admin, { body: 'Changed text' });
  check('changing the text requires a new version', r.s === 400, r);
  r = await put(`${E}/policies/${polId}`, admin, { title: 'Code of Conduct 2026' });
  check('edit policy details', r.s === 200 && r.d.title === 'Code of Conduct 2026' && r.d.version === 1, r);

  r = await post(`${E}/policies/${polId}/remind`, emp1.token);
  check('employee cannot send reminders', r.s === 403, r);
  r = await post(`${E}/policies/${polId}/remind`, admin);
  check('remind notifies only pending people', r.s === 200 && r.d.reminded >= 3, r);
  check('pending employee gets a reminder', !!(await waitForNotification(emp3.email, 'policy_ack_reminder')));
  check('acknowledged employee gets no reminder', (await countNotifications(emp1.email, 'policy_ack_reminder')) === 0);

  r = await post(`${E}/policies/${polId}/versions`, admin, { body: 'Be **kind** and honest.', change_note: 'Added honesty' });
  check('publish new version', r.s === 201 && r.d.version === 2 && r.d.history.length === 1 && r.d.history[0].version === 1, r);
  r = await get(`${E}/policies/${polId}`, emp1.token);
  check('new version resets acknowledgement', r.d?.my_ack?.acknowledged === false && r.d.version === 2, r.d);
  r = await post(`${E}/policies/${polId}/acknowledge`, emp1.token, { version: 1 });
  check('acknowledging an old version is refused', r.s === 409, r);
  r = await post(`${E}/policies/${polId}/acknowledge`, emp1.token, { version: 2 });
  check('acknowledge the new version', r.s === 201 && r.d.version === 2, r);

  // Overdue reminder job
  await withDb(db => db.collection('policy_documents').updateOne({ id: polId }, { $set: { due_date: new Date(Date.parse(`${addDays(today, -2)}T00:00:00Z`)) } }));
  const before = await countNotifications(emp3.email, 'policy_ack_reminder');
  r = await post('/v2/jobs/policy-ack-reminders/run', admin);
  check('daily job reminds people past the due date', r.s === 200 && r.d.result?.overdue_policies === 1 && r.d.result.reminded >= 1, r);
  await sleep(300);
  check('overdue employee reminded again', (await countNotifications(emp3.email, 'policy_ack_reminder')) > before);
  r = await get(`${E}/policies`, emp3.token);
  check('policy shows as overdue', r.d?.find?.(p => p.id === polId)?.overdue === true, r.d);

  r = await del(`${E}/policies/${polInfo}`, emp1.token);
  check('employee cannot delete a policy', r.s === 403, r);
  r = await del(`${E}/policies/${polSales}`, admin);
  check('delete policy', r.s === 200, r);
  r = await get(`${E}/policies/${polSales}`, admin);
  check('deleted policy is gone', r.s === 404, r);

  // ======================================================================
  section('EN-4 Surveys and eNPS');
  const questions = [
    { id: 'q_rate', type: 'rating', text: 'How happy are you at work?', required: true },
    { id: 'q_nps', type: 'nps', text: 'How likely are you to recommend us as an employer?', required: true },
    { id: 'q_single', type: 'single_choice', text: 'Preferred work mode', options: ['Office', 'Hybrid', 'Remote'], required: true },
    { id: 'q_multi', type: 'multiple_choice', text: 'Which perks matter?', options: ['Food', 'Gym', 'Learning'] },
    { id: 'q_text', type: 'text', text: 'Anything else?' }
  ];
  r = await post(`${E}/surveys`, emp1.token, { title: 'X', questions });
  check('employee cannot create a survey', r.s === 403, r);
  r = await post(`${E}/surveys`, admin, { title: 'Bad', questions: [{ type: 'single_choice', text: 'Pick', options: ['Only one'] }] });
  check('choice question needs 2+ options', r.s === 422, r);
  r = await post(`${E}/surveys`, admin, { title: 'Bad', questions: [{ type: 'slider', text: 'x' }] });
  check('unknown question type rejected', r.s === 422, r);
  r = await post(`${E}/surveys`, admin, { title: 'Bad', questions: [] });
  check('survey needs questions', r.s === 422, r);
  r = await post(`${E}/surveys`, admin, { title: 'Bad', questions, opens_at: inHours(10), closes_at: inHours(5) });
  check('close date before open date rejected', r.s === 400, r);

  r = await post(`${E}/surveys`, admin, { title: 'Pulse Q4', anonymous: true, questions, publish: true, closes_at: inHours(72) });
  check('create and publish anonymous survey', r.s === 201 && r.d.state === 'open' && r.d.anonymous === true && !('participation_salt' in r.d), r);
  const sv = r.d?.id;
  check('audience notified about the survey', !!(await waitForNotification(emp1.email, 'survey_published', n => n.metadata?.survey_id === sv)));
  r = await post(`${E}/surveys`, admin, { title: 'Named feedback', anonymous: false, questions: questions.slice(0, 3) });
  check('create draft survey', r.s === 201 && r.d.state === 'draft', r);
  const svNamed = r.d?.id;
  r = await get(`${E}/surveys/${svNamed}`, emp1.token);
  check('employees cannot see drafts', r.s === 404, r);
  r = await post(`${E}/surveys/${svNamed}/responses`, emp1.token, { answers: [] });
  check('cannot respond to a draft', r.s === 404, r);

  r = await get(`${E}/surveys`, emp1.token);
  check('employee sees open surveys only', r.s === 200 && r.d.length === 1 && r.d[0].id === sv && r.d[0].responded === false, r.d);
  r = await get(`${E}/surveys/${sv}`, emp1.token);
  check('employee loads the survey', r.s === 200 && r.d.questions.length === 5, r);

  const answers = (rate, nps, single, multi, text) => ({
    answers: [
      { question_id: 'q_rate', value: rate },
      { question_id: 'q_nps', value: nps },
      { question_id: 'q_single', value: single },
      ...(multi ? [{ question_id: 'q_multi', value: multi }] : []),
      ...(text ? [{ question_id: 'q_text', value: text }] : [])
    ]
  });
  r = await post(`${E}/surveys/${sv}/responses`, emp1.token, { answers: [{ question_id: 'q_rate', value: 4 }] });
  check('missing required answers rejected', r.s === 400, r);
  r = await post(`${E}/surveys/${sv}/responses`, emp1.token, answers(6, 9, 'Office'));
  check('rating outside 1–5 rejected', r.s === 400, r);
  r = await post(`${E}/surveys/${sv}/responses`, emp1.token, answers(4, 11, 'Office'));
  check('nps outside 0–10 rejected', r.s === 400, r);
  r = await post(`${E}/surveys/${sv}/responses`, emp1.token, answers(4, 9, 'Moon'));
  check('unknown option rejected', r.s === 400, r);
  r = await post(`${E}/surveys/${sv}/responses`, emp1.token, { answers: [...answers(4, 9, 'Office').answers, { question_id: 'nope', value: 1 }] });
  check('unknown question rejected', r.s === 400, r);

  r = await post(`${E}/surveys/${sv}/responses`, emp1.token, answers(4, 9, 'Hybrid', ['Food', 'Learning'], 'More team lunches'));
  check('submit response', r.s === 201, r);
  r = await post(`${E}/surveys/${sv}/responses`, emp1.token, answers(1, 0, 'Office'));
  check('cannot respond twice (no edits after submit)', r.s === 409, r);
  r = await get(`${E}/surveys/${sv}`, emp1.token);
  check('survey shows as responded', r.d?.responded === true, r.d);

  const stored = await withDb(async db => ({
    responses: await db.collection('survey_responses').find({ survey_id: sv }).toArray(),
    markers: await db.collection('survey_participation').find({ survey_id: sv }).toArray()
  }));
  const storedText = JSON.stringify(stored);
  check('anonymous answers store no identity', stored.responses.length === 1 && !('respondent' in stored.responses[0]) && !storedText.includes(emp1.email) && !storedText.includes(emp1.id) && !storedText.includes('Eli'), stored);
  check('anonymous answers have no timestamp or ObjectId', !('submitted_at' in stored.responses[0]) && typeof stored.responses[0]._id === 'string' && typeof stored.markers[0]._id === 'string', stored);
  check('participation marker is a salted hash', /^[0-9a-f]{64}$/.test(stored.markers[0]?.participant || ''), stored.markers);

  r = await get(`${E}/surveys/${sv}/results`, admin);
  check('results hidden below the anonymity threshold', r.s === 200 && r.d.insufficient_responses === true && r.d.questions.every(q => q.hidden) && r.d.enps === null && r.d.response_count === 1, r.d);
  r = await http('GET', `${E}/surveys/${sv}/export`, admin, undefined, { raw: true });
  check('export blocked below the anonymity threshold', r.s === 400, r.s);

  r = await post(`${E}/surveys/${sv}/responses`, emp2.token, answers(5, 10, 'Remote', ['Gym'], 'Great place'));
  check('second response', r.s === 201, r);
  r = await post(`${E}/surveys/${sv}/responses`, emp3.token, answers(3, 5, 'Hybrid', null, null));
  check('third response (optional questions skipped)', r.s === 201, r);

  r = await get(`${E}/surveys/${sv}/results`, emp1.token);
  check('employees cannot see results', r.s === 403, r);
  r = await get(`${E}/surveys/${sv}/results`, mgr.token);
  check('managers cannot see results', r.s === 403, r);
  r = await get(`${E}/surveys/${sv}/results`, admin);
  const res = r.d;
  const qRate = res?.questions?.find(q => q.id === 'q_rate');
  const qNps = res?.questions?.find(q => q.id === 'q_nps');
  const qSingle = res?.questions?.find(q => q.id === 'q_single');
  const qMulti = res?.questions?.find(q => q.id === 'q_multi');
  const qText = res?.questions?.find(q => q.id === 'q_text');
  check('results available at 3 responses', r.s === 200 && res.insufficient_responses === false && res.response_count === 3, res);
  check('rating average and distribution', qRate?.average === 4 && qRate.distribution[5] === 1 && qRate.distribution[3] === 1, qRate);
  check('eNPS = %promoters − %detractors', res?.enps?.score === 33 && res.enps.promoters === 2 && res.enps.detractors === 1 && qNps?.distribution[10] === 1, res?.enps);
  check('choice counts', qSingle?.options.find(o => o.option === 'Hybrid')?.count === 2 && qMulti?.options.find(o => o.option === 'Gym')?.count === 1 && qMulti.answered === 2, { qSingle, qMulti });
  check('text answers listed', qText?.responses?.length === 2 && qText.responses.includes('Great place'), qText);
  check('response rate computed', res?.audience_size >= 5 && res.response_rate > 0 && res.response_rate <= 100, res);
  check('department breakdown hides groups under 3', res?.by_department?.length === 0 && res.hidden_departments === 2, res?.by_department);

  r = await http('GET', `${E}/surveys/${sv}/export`, admin, undefined, { raw: true });
  const csv = r.buf?.toString('utf8') || '';
  check('CSV export of anonymous responses', r.s === 200 && (r.headers.get('content-type') || '').includes('text/csv') && csv.trim().split('\r\n').length === 4, csv);
  check('anonymous CSV has no identities', !csv.includes('@') && !csv.includes('Respondent'), csv);
  r = await http('GET', `${E}/surveys/${sv}/export`, emp1.token, undefined, { raw: true });
  check('employees cannot export', r.s === 403, r.s);

  r = await put(`${E}/surveys/${sv}`, admin, { questions: questions.slice(0, 2) });
  check('questions locked after responses', r.s === 400, r);
  r = await put(`${E}/surveys/${sv}`, admin, { title: 'Pulse Q4 (extended)' });
  check('title can still change', r.s === 200 && r.d.title === 'Pulse Q4 (extended)', r);
  r = await post(`${E}/surveys/${sv}/close`, admin);
  check('close survey', r.s === 200 && r.d.state === 'closed', r);
  r = await post(`${E}/surveys/${sv}/responses`, mgr.token, answers(4, 8, 'Office'));
  check('cannot respond to a closed survey', r.s === 400, r);

  // Named (non-anonymous) survey
  r = await post(`${E}/surveys/${svNamed}/publish`, admin);
  check('publish draft', r.s === 200 && r.d.state === 'open', r);
  r = await post(`${E}/surveys/${svNamed}/responses`, emp1.token, answers(2, 3, 'Remote'));
  check('respond to named survey', r.s === 201, r);
  r = await get(`${E}/surveys/${svNamed}/results`, admin);
  check('named survey shows results from the first response', r.d?.insufficient_responses === false && r.d.enps?.score === -100, r.d);
  r = await http('GET', `${E}/surveys/${svNamed}/export`, admin, undefined, { raw: true });
  check('named survey export includes respondent', r.s === 200 && r.buf.toString('utf8').includes(emp1.email), r.s);

  // Scheduled + department surveys
  r = await post(`${E}/surveys`, admin, { title: 'Later', questions: questions.slice(0, 1), publish: true, opens_at: inHours(24) });
  const svLater = r.d?.id;
  check('scheduled survey', r.s === 201 && r.d.state === 'scheduled', r);
  r = await post(`${E}/surveys/${svLater}/responses`, emp1.token, { answers: [{ question_id: 'q_rate', value: 3 }] });
  check('cannot respond before it opens', r.s === 400, r);
  r = await post(`${E}/surveys`, admin, { title: 'Sales only', questions: questions.slice(0, 1), publish: true, audience: { type: 'departments', departments: ['Sales'] } });
  const svSales = r.d?.id;
  r = await post(`${E}/surveys/${svSales}/responses`, emp1.token, { answers: [{ question_id: 'q_rate', value: 3 }] });
  check('cannot respond to a survey outside my audience', r.s === 404, r);
  r = await post(`${E}/surveys/${svSales}/responses`, emp2.token, { answers: [{ question_id: 'q_rate', value: 3 }] });
  check('audience member can respond', r.s === 201, r);
  r = await del(`${E}/surveys/${svSales}`, admin);
  const leftovers = await withDb(db => db.collection('survey_participation').countDocuments({ survey_id: svSales }));
  check('delete survey removes responses', r.s === 200 && leftovers === 0, r);

  // ======================================================================
  section('EN-5 Polls, suggestions, grievances');
  // Polls
  r = await post(`${E}/polls`, emp1.token, { question: 'Lunch?', options: ['Pizza', 'Salad'] });
  check('employee cannot create a poll', r.s === 403, r);
  r = await post(`${E}/polls`, mgr.token, { question: 'Lunch?', options: ['Pizza'] });
  check('poll needs 2+ options', r.s === 422, r);
  r = await post(`${E}/polls`, mgr.token, { question: 'Lunch?', options: ['Pizza', 'pizza'] });
  check('duplicate options rejected', r.s === 422, r);
  r = await post(`${E}/polls`, mgr.token, { question: 'Team lunch on Friday?', options: ['Pizza', 'Salad', 'Biryani'], closes_at: inHours(48) });
  check('manager creates a poll', r.s === 201 && r.d.options.length === 3 && r.d.can_manage === true, r);
  const poll = r.d;
  r = await get(`${E}/polls/${poll.id}`, emp1.token);
  check('results hidden until I vote', r.s === 200 && r.d.results_visible === false && !('votes' in r.d.options[0]), r.d);
  r = await post(`${E}/polls/${poll.id}/vote`, emp1.token, { option_ids: [poll.options[0].id, poll.options[1].id] });
  check('single-select poll rejects two choices', r.s === 400, r);
  r = await post(`${E}/polls/${poll.id}/vote`, emp1.token, { option_ids: ['bogus'] });
  check('unknown option rejected', r.s === 400, r);
  r = await post(`${E}/polls/${poll.id}/vote`, emp1.token, { option_ids: [poll.options[2].id] });
  check('vote and see results', r.s === 201 && r.d.results_visible && r.d.total_votes === 1 && r.d.options[2].votes === 1 && r.d.my_vote[0] === poll.options[2].id, r.d);
  r = await post(`${E}/polls/${poll.id}/vote`, emp1.token, { option_ids: [poll.options[0].id] });
  check('cannot vote twice', r.s === 409, r);
  r = await post(`${E}/polls/${poll.id}/close`, emp2.token);
  check('others cannot close the poll', r.s === 403, r);
  r = await post(`${E}/polls/${poll.id}/close`, mgr.token);
  check('creator closes the poll', r.s === 200 && r.d.state === 'closed', r);
  r = await get(`${E}/polls/${poll.id}`, emp2.token);
  check('results visible to everyone after close', r.d?.results_visible === true && r.d.options[2].votes === 1, r.d);
  r = await post(`${E}/polls/${poll.id}/vote`, emp2.token, { option_ids: [poll.options[0].id] });
  check('cannot vote on a closed poll', r.s === 400, r);
  r = await post(`${E}/polls`, admin, { question: 'Which topics for the offsite?', options: ['AI', 'Culture', 'Roadmap'], multi_select: true });
  const multi = r.d;
  r = await post(`${E}/polls/${multi.id}/vote`, emp3.token, { option_ids: [multi.options[0].id, multi.options[2].id] });
  check('multi-select vote', r.s === 201 && r.d.options[0].votes === 1 && r.d.options[2].votes === 1 && r.d.total_votes === 1, r.d);
  r = await get(`${E}/polls?state=open`, emp1.token);
  check('list open polls', r.s === 200 && r.d.some(p => p.id === multi.id) && !r.d.some(p => p.id === poll.id), r.d);
  r = await del(`${E}/polls/${multi.id}`, emp3.token);
  check('employees cannot delete polls', r.s === 403, r);
  r = await del(`${E}/polls/${multi.id}`, admin);
  check('admin deletes poll', r.s === 200, r);

  // Suggestions
  r = await post(`${E}/suggestions`, emp1.token, { title: 'Hi', description: 'x' });
  check('suggestion title too short rejected', r.s === 422, r);
  r = await post(`${E}/suggestions`, emp1.token, { title: 'Standing desks', description: 'Please add standing desks on floor 2', category: 'workplace' });
  check('submit named suggestion', r.s === 201 && r.d.status === 'new' && r.d.submitter_name === 'Eli Engineer', r);
  const sug = r.d?.id;
  r = await post(`${E}/suggestions`, emp1.token, { title: 'Pay transparency', description: 'Publish salary bands', category: 'benefits', anonymous: true });
  check('submit anonymous suggestion', r.s === 201 && r.d.submitter_name === null, r);
  const sugAnon = r.d?.id;
  const anonDoc = await withDb(db => db.collection('suggestions').findOne({ id: sugAnon }));
  check('anonymous suggestion stores no identity', anonDoc && anonDoc.submitter_email === null && !JSON.stringify(anonDoc).includes(emp1.email), anonDoc);
  r = await get(`${E}/suggestions/mine`, emp1.token);
  check('submitter sees own named suggestions only', r.s === 200 && r.d.length === 1 && r.d[0].id === sug, r.d);
  r = await get(`${E}/suggestions`, emp1.token);
  check('employees cannot list all suggestions', r.s === 403, r);
  r = await get(`${E}/suggestions`, admin);
  check('admin lists suggestions with counts', r.s === 200 && r.d.suggestions.length === 2 && r.d.counts.new === 2, r.d);
  r = await patch(`${E}/suggestions/${sug}`, admin, { status: 'done' });
  check('invalid status rejected', r.s === 422, r);
  r = await patch(`${E}/suggestions/${sug}`, emp1.token, { status: 'implemented' });
  check('employee cannot update status', r.s === 403, r);
  r = await patch(`${E}/suggestions/${sug}`, admin, { status: 'under_review', admin_response: 'Checking with facilities' });
  check('admin reviews and responds', r.s === 200 && r.d.status === 'under_review' && r.d.admin_response === 'Checking with facilities', r);
  r = await get(`${E}/suggestions/mine`, emp1.token);
  check('submitter sees status and response', r.d?.[0]?.status === 'under_review' && r.d[0].admin_response === 'Checking with facilities', r.d);
  check('submitter is notified', !!(await waitForNotification(emp1.email, 'suggestion_updated')));

  // Grievances
  r = await post(`${E}/grievances`, emp1.token, { category: 'gossip', subject: 'Test', description: 'Long enough description' });
  check('invalid grievance category rejected', r.s === 422, r);
  r = await post(`${E}/grievances`, emp1.token, { category: 'harassment', subject: 'Issue', description: 'short' });
  check('grievance description too short rejected', r.s === 422, r);
  r = await post(`${E}/grievances`, emp3.token, { category: 'harassment', subject: 'Inappropriate remarks', description: 'Repeated inappropriate remarks in team meetings.', anonymous: true });
  check('file anonymous grievance with tracking code', r.s === 201 && /^GRV-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.d.tracking_code) && r.d.status === 'open', r);
  const grvAnon = r.d;
  const grvDoc = await withDb(db => db.collection('grievances').findOne({ id: grvAnon.id }));
  check('anonymous grievance stores no identity', grvDoc.reporter_email === null && grvDoc.reporter_name === null && !JSON.stringify(grvDoc).includes(emp3.email) && !JSON.stringify(grvDoc).includes('Erin'), grvDoc);
  check('admins notified without identity', !!(await waitForNotification('admin@example.com', 'grievance_submitted', n => n.metadata?.grievance_id === grvAnon.id && !JSON.stringify(n).includes('Erin'))));
  r = await post(`${E}/grievances/track`, null, { tracking_code: grvAnon.tracking_code.toLowerCase() });
  check('status check by tracking code without logging in', r.s === 200 && r.d.status === 'open' && r.d.subject === 'Inappropriate remarks', r);
  check('tracking view hides notes, description and identity', r.d && !('notes' in r.d) && !('description' in r.d) && !('reporter_email' in r.d), r.d);
  r = await post(`${E}/grievances/track`, null, { tracking_code: 'GRV-AAAA-BBBB-CCCC' });
  check('unknown tracking code → 404', r.s === 404, r);
  r = await post(`${E}/grievances`, emp2.token, { category: 'compensation', subject: 'Overtime unpaid', description: 'Overtime from last month was not paid.' });
  check('file named grievance', r.s === 201, r);
  const grvNamed = r.d;
  r = await get(`${E}/grievances/mine`, emp2.token);
  check('reporter sees their named grievance', r.d?.length === 1 && r.d[0].id === grvNamed.id && !('notes' in r.d[0]), r.d);
  r = await get(`${E}/grievances/mine`, emp3.token);
  check('anonymous grievances are not linked to the reporter', r.s === 200 && r.d.length === 0, r.d);
  r = await get(`${E}/grievances`, emp1.token);
  check('employees cannot list grievances', r.s === 403, r);
  r = await get(`${E}/grievances`, mgr.token);
  check('managers cannot list grievances', r.s === 403, r);
  r = await get(`${E}/grievances/${grvNamed.id}`, emp2.token);
  check('reporter cannot open the admin view', r.s === 403, r);
  r = await get(`${E}/grievances`, admin);
  check('admin lists grievances (notes excluded)', r.s === 200 && r.d.grievances.length === 2 && r.d.counts.open === 2 && r.d.grievances.every(g => !('notes' in g)), r.d);
  r = await patch(`${E}/grievances/${grvAnon.id}`, admin, { status: 'resolved' });
  check('workflow: open cannot jump to resolved', r.s === 400, r);
  r = await patch(`${E}/grievances/${grvAnon.id}`, admin, { status: 'investigating', response: 'We are looking into this confidentially.' });
  check('move to investigating with a response', r.s === 200 && r.d.status === 'investigating' && r.d.history.length === 2, r);
  r = await post(`${E}/grievances/${grvAnon.id}/notes`, admin, { text: 'Spoke to witness A (confidential).' });
  check('add confidential note', r.s === 201, r);
  r = await post(`${E}/grievances/${grvAnon.id}/notes`, mgr.token, { text: 'x' });
  check('managers cannot add notes', r.s === 403, r);
  r = await get(`${E}/grievances/${grvAnon.id}`, admin);
  check('admin sees notes', r.d?.notes?.length === 1 && r.d.allowed_transitions.includes('resolved'), r.d);
  r = await post(`${E}/grievances/track`, null, { tracking_code: grvAnon.tracking_code });
  check('reporter sees status + response but not notes', r.d?.status === 'investigating' && r.d.response.includes('confidentially') && !JSON.stringify(r.d).includes('witness'), r.d);
  r = await patch(`${E}/grievances/${grvNamed.id}`, admin, { status: 'investigating' });
  check('named grievance updated', r.s === 200, r);
  check('named reporter notified of status change', !!(await waitForNotification(emp2.email, 'grievance_updated')));

  // ======================================================================
  section('EN-6 Recognition / kudos');
  r = await get(`${E}/kudos/values`, emp1.token);
  check('default value tags', r.s === 200 && ['Teamwork', 'Ownership', 'Customer First', 'Innovation', 'Integrity'].every(v => r.d.includes(v)), r.d);
  r = await put(`${E}/settings`, emp1.token, { kudos_values: ['X'] });
  check('employee cannot change value tags', r.s === 403, r);
  r = await put(`${E}/settings`, admin, { kudos_values: ['Teamwork', 'Teamwork'] });
  check('duplicate value tags rejected', r.s === 422, r);
  r = await put(`${E}/settings`, admin, { kudos_values: ['Teamwork', 'Ownership', 'Customer First', 'Innovation', 'Integrity', 'Learning'] });
  check('admin adds a value tag', r.s === 200 && r.d.kudos_values.includes('Learning'), r);

  r = await get(`${E}/directory`, emp1.token);
  check('directory lists colleagues without emails', r.s === 200 && r.d.some(p => p.id === emp2.id) && !JSON.stringify(r.d).includes('@'), r.d);

  r = await post(`${E}/kudos`, emp1.token, { recipient_ids: [emp1.id], message: 'Great job me', value: 'Teamwork' });
  check("can't send kudos to yourself", r.s === 400, r);
  r = await post(`${E}/kudos`, emp1.token, { recipient_ids: [emp2.id, emp1.id], message: 'Great job us', value: 'Teamwork' });
  check("can't include yourself among recipients", r.s === 400, r);
  r = await post(`${E}/kudos`, emp1.token, { recipient_ids: [emp2.id], message: 'Thanks!', value: 'Bravery' });
  check('unknown value tag rejected', r.s === 400, r);
  r = await post(`${E}/kudos`, emp1.token, { recipient_ids: [], message: 'Thanks!', value: 'Teamwork' });
  check('needs at least one recipient', r.s === 422, r);
  r = await post(`${E}/kudos`, emp1.token, { recipient_ids: ['nobody'], message: 'Thanks!', value: 'Teamwork' });
  check('unknown recipient rejected', r.s === 400, r);
  r = await post(`${E}/kudos`, emp1.token, { recipient_ids: [emp2.id, emp3.id], message: 'Thanks for closing the release together!', value: 'teamwork' });
  check('send kudos to two colleagues', r.s === 201 && r.d.recipients.length === 2 && r.d.value === 'Teamwork', r);
  const k1 = r.d?.id;
  r = await post(`${E}/kudos`, mgr.token, { recipient_ids: [emp2.id], message: 'Customer escalation handled brilliantly', value: 'Customer First' });
  check('second kudos', r.s === 201, r);
  const k2 = r.d?.id;
  r = await post(`${E}/kudos`, emp2.token, { recipient_ids: [emp1.id], message: 'Always learning new things', value: 'Learning' });
  check('kudos with admin-added value', r.s === 201, r);
  check('recipients notified', !!(await waitForNotification(emp3.email, 'kudos_received', n => n.metadata?.kudos_id === k1)));

  r = await get(`${E}/kudos`, emp3.token);
  check('company feed newest first', r.s === 200 && r.d.kudos.length === 3 && r.d.kudos[2].id === k1, r.d);
  check('feed exposes no email addresses', !JSON.stringify(r.d).includes('@'), r.d);
  r = await post(`${E}/kudos/${k1}/like`, emp3.token);
  check('like kudos', r.s === 200 && r.d.like_count === 1 && r.d.liked_by_me === true, r);
  r = await post(`${E}/kudos/${k1}/like`, emp3.token);
  check('liking twice counts once', r.d?.like_count === 1, r.d);
  await post(`${E}/kudos/${k1}/like`, mgr.token);
  r = await del(`${E}/kudos/${k1}/like`, emp3.token);
  check('unlike', r.s === 200 && r.d.like_count === 1 && r.d.liked_by_me === false, r);
  r = await post(`${E}/kudos/bogus/like`, emp3.token);
  check('like unknown kudos → 404', r.s === 404, r);
  r = await get(`${E}/kudos?employee_id=${emp2.id}`, emp1.token);
  check('filter feed by colleague', r.d?.kudos?.length === 3, r.d);

  r = await get(`${E}/kudos/leaderboard`, emp1.token);
  const top = r.d?.top_received?.[0];
  check('monthly leaderboard ranks most recognised', r.s === 200 && top?.employee.id === emp2.id && top.count === 2 && top.rank === 1 && r.d.total_kudos === 3, r.d);
  check('leaderboard shows top givers and values', r.d?.top_given?.length === 3 && r.d.by_value.some(v => v.value === 'Teamwork'), r.d);
  r = await get(`${E}/kudos/leaderboard?month=2020-01`, emp1.token);
  check('past month is empty', r.s === 200 && r.d.total_kudos === 0 && r.d.top_received.length === 0, r.d);
  r = await get(`${E}/kudos/leaderboard?month=2026-13`, emp1.token);
  check('invalid month rejected', r.s === 422, r);

  r = await del(`${E}/kudos/${k2}`, emp3.token);
  check('only the sender (or admin) can delete kudos', r.s === 403, r);
  r = await del(`${E}/kudos/${k2}`, mgr.token);
  check('sender deletes kudos', r.s === 200, r);

  // ======================================================================
  section('EN Shared endpoints');
  r = await get(`${E}/summary`, emp3.token);
  check('summary counts', r.s === 200 && typeof r.d.unread_announcements === 'number' && r.d.pending_policies >= 0 && 'open_surveys' in r.d && 'open_polls' in r.d, r.d);
  r = await get(`${E}/departments`, emp1.token);
  check('departments list', r.s === 200 && r.d.includes('Engineering') && r.d.includes('Sales'), r.d);
  r = await get(`${E}/announcements/feed`);
  check('login required', r.s === 401, r);
});
