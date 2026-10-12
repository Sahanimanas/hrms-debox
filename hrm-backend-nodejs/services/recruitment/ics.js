/**
 * iCalendar (.ics, RFC 5545) invite for an interview.
 */

const escapeText = (value) => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

const icsDate = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Fold content lines longer than 75 octets (continuation lines start with a space). */
const fold = (line) => {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  let currentLen = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length ? 74 : 75; // continuation lines carry a leading space
    if (currentLen + len > limit) {
      parts.push(current);
      current = '';
      currentLen = 0;
    }
    current += ch;
    currentLen += len;
  }
  if (current) parts.push(current);
  return parts.join('\r\n ');
};

const MODE_LABELS = { onsite: 'On-site', video: 'Video call', phone: 'Phone' };

/**
 * @param {object} interview  document from the `interviews` collection
 * @param {{ organizerEmail?: string, organizerName?: string, companyName?: string }} opts
 */
function buildIcs(interview, opts = {}) {
  const start = new Date(interview.scheduled_at);
  const end = new Date(start.getTime() + (interview.duration_minutes || 60) * 60000);
  const cancelled = interview.status === 'cancelled';
  const summary = `${interview.round_name || 'Interview'}: ${interview.candidate_name} (${interview.job_title})`;
  const location = interview.mode === 'video'
    ? (interview.meeting_link || 'Video call')
    : interview.mode === 'phone' ? 'Phone call' : (interview.location || 'Office');

  const description = [
    `Candidate: ${interview.candidate_name}`,
    `Role: ${interview.job_title}`,
    `Round: ${interview.round_name || 'Interview'}`,
    `Mode: ${MODE_LABELS[interview.mode] || interview.mode}`,
    interview.meeting_link ? `Join: ${interview.meeting_link}` : null,
    interview.location && interview.mode !== 'video' ? `Location: ${interview.location}` : null,
    interview.notes ? `Notes: ${interview.notes}` : null,
    'Please submit your scorecard in Xeno-HR after the interview.'
  ].filter(Boolean).join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Xeno-HR//Recruitment//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:interview-${interview.id}@xeno-hr`,
    `SEQUENCE:${interview.sequence || 0}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(location)}`,
    ...(interview.meeting_link ? [`URL:${interview.meeting_link}`] : []),
    ...(opts.organizerEmail
      ? [`ORGANIZER;CN=${escapeText(opts.organizerName || opts.companyName || 'Recruiting')}:mailto:${opts.organizerEmail}`]
      : []),
    ...(interview.interviewers || (interview.interviewer_emails || []).map(email => ({ email })))
      .map(p => `ATTENDEE;CN=${escapeText(p.name || p.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${p.email}`),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Interview reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs };
