/**
 * Calendar sync (PL-6): a per-user secret ICS feed that Google Calendar /
 * Outlook can subscribe to.
 *
 * `calendar_feeds` { user_email, token_hash (sha256), token_prefix, created_at, last_accessed_at }
 * The token itself is only shown when it is created / regenerated.
 *
 * Feed contents: the user's approved leaves, company holidays, interviews
 * where they are an interviewer (`interviews`) and their 1:1s (`one_on_ones`).
 */

const { APP_TIMEZONE } = require('../../utils/helpers');

const PRODID = '-//Xeno-HR//Calendar Feed//EN';
const MAX_EVENTS = 2000;

// ============= ICS PRIMITIVES =============

const escapeText = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + len > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const utcStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateValue = (ymd) => ymd.replace(/-/g, '');
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Normalise a date-ish value to 'YYYY-MM-DD' (company-local for Dates). */
function toYmd(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Group sorted 'YYYY-MM-DD' strings into consecutive ranges. */
function dateRanges(dates) {
  const sorted = [...new Set(dates.filter(Boolean))].sort();
  const ranges = [];
  for (const d of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && addDays(last.end, 1) === d) last.end = d;
    else ranges.push({ start: d, end: d });
  }
  return ranges;
}

function allDayEvent({ uid, start, end, summary, description, categories }) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART;VALUE=DATE:${dateValue(start)}`,
    `DTEND;VALUE=DATE:${dateValue(addDays(end, 1))}`,
    `SUMMARY:${escapeText(summary)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    categories ? `CATEGORIES:${escapeText(categories)}` : null,
    'TRANSP:TRANSPARENT',
    'END:VEVENT'
  ].filter(Boolean);
}

function timedEvent({ uid, start, minutes, summary, description, location, url, status }) {
  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + (minutes || 30) * 60000);
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(startDate)}`,
    `DTEND:${utcStamp(endDate)}`,
    `SUMMARY:${escapeText(summary)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    location ? `LOCATION:${escapeText(location)}` : null,
    url && /^https?:\/\//i.test(url) ? `URL:${escapeText(url)}` : null,
    status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT'
  ].filter(Boolean);
}

const collectionExists = async (db, name) => (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;

const leaveLabel = (type) => String(type || 'Leave').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/**
 * Build the ICS document for a user. `employee` may be null (admin without profile).
 */
async function buildFeed(db, email, employee) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Xeno-HR',
    `X-WR-TIMEZONE:${APP_TIMEZONE}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H'
  ];
  let count = 0;
  const push = (ev) => {
    if (count >= MAX_EVENTS) return;
    lines.push(...ev);
    count += 1;
  };
  const since = new Date(Date.now() - 400 * 86400000);

  // Approved leaves (own only)
  const leaveFilter = { status: 'approved', $or: [{ employee_email: email }] };
  if (employee?.id) leaveFilter.$or.push({ employee_id: employee.id });
  const leaves = await db.collection('leaves').find(leaveFilter, { projection: { _id: 0, id: 1, leave_type: 1, dates: 1, start_date: 1, end_date: 1, is_half_day: 1 } }).limit(500).toArray();
  for (const leave of leaves) {
    let dates = Array.isArray(leave.dates) ? leave.dates.map(toYmd) : [];
    if (!dates.length && leave.start_date) {
      const s = toYmd(leave.start_date);
      const e = toYmd(leave.end_date || leave.start_date);
      for (let d = s; d && d <= e && dates.length < 400; d = addDays(d, 1)) dates.push(d);
    }
    dateRanges(dates).forEach((r, i) => {
      if (r.end < toYmd(since)) return;
      push(allDayEvent({
        uid: `leave-${leave.id}-${i}@xeno-hr`,
        start: r.start,
        end: r.end,
        summary: `${leaveLabel(leave.leave_type)}${leave.is_half_day ? ' (half day)' : ''}`,
        description: 'Approved leave',
        categories: 'Leave'
      }));
    });
  }

  // Company holidays
  const holidays = await db.collection('holidays').find({}, { projection: { _id: 0, id: 1, name: 1, date: 1, type: 1, description: 1 } }).limit(1000).toArray();
  for (const h of holidays) {
    const d = toYmd(h.date);
    if (!d || d < toYmd(since)) continue;
    push(allDayEvent({
      uid: `holiday-${h.id || d}@xeno-hr`,
      start: d,
      end: d,
      summary: h.name || 'Holiday',
      description: h.description || (h.type ? `${h.type} holiday` : 'Company holiday'),
      categories: 'Holiday'
    }));
  }

  // Interviews (recruitment module) where the user is an interviewer
  if (await collectionExists(db, 'interviews')) {
    const interviews = await db.collection('interviews')
      .find({ interviewer_emails: email, scheduled_at: { $gte: since } }, { projection: { _id: 0 } })
      .limit(500).toArray();
    for (const iv of interviews) {
      if (!iv.scheduled_at) continue;
      push(timedEvent({
        uid: `interview-${iv.id}@xeno-hr`,
        start: iv.scheduled_at,
        minutes: iv.duration_minutes || 60,
        summary: `Interview: ${iv.candidate_name || 'Candidate'}${iv.job_title ? ` (${iv.job_title})` : ''}`,
        description: [iv.mode ? `Mode: ${iv.mode}` : null, iv.meeting_link ? `Join: ${iv.meeting_link}` : null].filter(Boolean).join('\n'),
        url: iv.meeting_link,
        status: iv.status
      }));
    }
  }

  // 1:1s (performance module)
  if (await collectionExists(db, 'one_on_ones')) {
    const meetings = await db.collection('one_on_ones')
      .find({ $or: [{ manager_email: email }, { employee_email: email }], scheduled_at: { $gte: since } }, { projection: { _id: 0 } })
      .limit(500).toArray();
    const names = new Map();
    const others = [...new Set(meetings.map(m => (m.manager_email === email ? m.employee_email : m.manager_email)).filter(Boolean))];
    if (others.length) {
      const emps = await db.collection('employees').find({ email: { $in: others } }, { projection: { _id: 0, email: 1, full_name: 1 } }).toArray();
      emps.forEach(e => names.set(e.email, e.full_name));
    }
    for (const m of meetings) {
      if (!m.scheduled_at) continue;
      const other = m.manager_email === email ? m.employee_email : m.manager_email;
      push(timedEvent({
        uid: `one-on-one-${m.id}@xeno-hr`,
        start: m.scheduled_at,
        minutes: m.duration_minutes || 30,
        summary: `1:1 with ${names.get(other) || other || 'colleague'}`,
        status: m.status
      }));
    }
  }

  lines.push('END:VCALENDAR');
  return { ics: lines.map(fold).join('\r\n') + '\r\n', events: count };
}

module.exports = { buildFeed, escapeText, fold, dateRanges, toYmd };
