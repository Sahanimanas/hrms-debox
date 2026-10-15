import { format } from 'date-fns';
import { fmtMinutes } from '@/lib/time';

// Date helpers for the My attendance calendar.

export const keyOf = (d) => format(d, 'yyyy-MM-dd');
export const dateOfKey = (key) => new Date(`${key}T00:00:00`);

/** "Casual Leave" -> "Casual" */
export const shortLeaveType = (type) => String(type || 'Leave').replace(/\s+leave$/i, '') || 'Leave';

/**
 * What a calendar day shows, from the punch log first, then leave, holiday,
 * weekly off and finally an inferred absence for past working days.
 */
export const describeDay = ({ log, leave, holiday, isWeeklyOff, isToday, isPast, absentEligible }) => {
  if (log) {
    const worked = fmtMinutes(log.worked_minutes);
    if (!log.clock_out) {
      return isToday ? { tone: 'plain', caption: 'Working…' } : { tone: 'danger', caption: 'Missed clock-out' };
    }
    if (log.status === 'absent') return { tone: 'danger', caption: 'Absent' };
    if (log.status === 'half-day') return { tone: 'warning', caption: `Half day · ${worked}` };
    if (log.is_late) return { tone: 'warning', caption: `Late · ${worked}` };
    return { tone: 'success', caption: worked };
  }
  if (leave) {
    const label = shortLeaveType(leave.leave_type);
    return { tone: 'violet', caption: leave.status === 'approved' ? label : `${label} · ${leave.status}` };
  }
  if (holiday) return { tone: 'holiday', caption: holiday.name };
  if (isWeeklyOff) return { tone: 'off', caption: 'Weekly off' };
  if (isPast && absentEligible) return { tone: 'danger', caption: 'Absent' };
  return { tone: 'plain', caption: '' };
};

/** Weeks of the month (Monday first), padded with the neighbouring months' days. */
export const buildWeeks = (year, month) => {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: total }, (_, i) => {
    const d = new Date(year, month - 1, i - lead + 1);
    return { date: d, key: keyOf(d), inMonth: d.getMonth() === month - 1 };
  });
  return Array.from({ length: total / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
};
