import React from 'react';
import { format } from 'date-fns';
import { LogIn, LogOut, Timer, TriangleAlert, ClipboardPen, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ds';
import { cn } from '@/lib/utils';
import { fmtTime, fmtMinutes, fmtShiftTime, WORK_MODE_LABELS } from '@/lib/time';
import { dateOfKey } from './myAttendanceUtils';

// Pieces of the "Attendance · My attendance" screen (Figma "Calendar & today").

const WEEKDAYS_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Cell look per tone: background, caption colour and whether the day number is muted. */
const CELL_TONES = {
  success: { bg: 'bg-success-bg', fg: 'text-success-fg', dot: 'bg-success-solid' },
  warning: { bg: 'bg-warning-bg', fg: 'text-warning-fg', dot: 'bg-warning-solid' },
  danger: { bg: 'bg-danger-bg', fg: 'text-danger-fg', dot: 'bg-danger-solid' },
  violet: { bg: 'bg-violet-bg', fg: 'text-violet-fg', dot: 'bg-violet-fg' },
  holiday: { bg: 'bg-brand-subtle', fg: 'text-brand-text', dot: 'bg-brand' },
  off: { bg: 'bg-subtle', fg: 'text-ink-muted', dot: 'bg-ink-muted', muted: true },
  plain: { bg: 'border border-line', fg: 'text-ink-secondary', dot: '', muted: true },
};

const LEGEND = [
  { label: 'Present', cls: 'bg-success-bg border-success-fg' },
  { label: 'Late / half day', cls: 'bg-warning-bg border-warning-fg' },
  { label: 'Leave', cls: 'bg-violet-bg border-violet-fg' },
  { label: 'Holiday', cls: 'bg-brand-subtle border-brand-text' },
  { label: 'Absent', cls: 'bg-danger-bg border-danger-fg' },
];

export const CalendarLegend = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
    {LEGEND.map(({ label, cls }) => (
      <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium leading-4 text-ink-secondary">
        <span className={cn('h-3 w-3 shrink-0 rounded-[4px] border', cls)} />
        {label}
      </span>
    ))}
  </div>
);

/** Month grid. `describe(cell)` returns { tone, caption } for days in the month. */
export const MonthCalendar = ({ weeks, todayKey, selectedKey, describe, onSelect }) => (
  <div className="flex flex-col gap-1.5 sm:gap-2">
    <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-ink-muted">
      {WEEKDAYS_MON_FIRST.map((d) => <span key={d} className="truncate">{d}</span>)}
    </div>
    {weeks.map((week) => (
      <div key={week[0].key} className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {week.map((cell) => {
          const dayNumber = cell.date.getDate();
          if (!cell.inMonth) {
            return (
              <div key={cell.key} aria-hidden="true" className="flex h-14 sm:h-[72px] min-w-0 flex-col rounded-md border border-line px-1.5 py-1.5 sm:px-2.5 sm:py-2">
                <span className="text-[13px] font-medium leading-[18px] text-ink-muted">{dayNumber}</span>
              </div>
            );
          }
          const isToday = cell.key === todayKey;
          const isSelected = cell.key === selectedKey;
          const { tone, caption } = describe(cell);
          const t = CELL_TONES[tone] || CELL_TONES.plain;
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onSelect(cell.key)}
              aria-pressed={isSelected}
              aria-label={`${format(cell.date, 'EEEE, d MMMM')}${caption ? ` – ${caption}` : ''}`}
              className={cn(
                'group flex h-14 sm:h-[72px] min-w-0 flex-col justify-between rounded-md px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-left transition-shadow',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                isToday ? 'border-2 border-brand bg-surface' : t.bg,
                isSelected && !isToday && 'ring-2 ring-ink/80 ring-offset-1',
                !isSelected && 'hover:shadow-sm',
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-1">
                <span
                  className={cn(
                    'flex-1 min-w-0',
                    isToday ? 'text-sm font-semibold leading-5 text-ink' : 'text-[13px] font-medium leading-[18px]',
                    !isToday && (t.muted ? 'text-ink-muted' : 'text-ink'),
                  )}
                >
                  {dayNumber}
                </span>
                {isToday && (
                  <span className="hidden sm:inline rounded-full bg-brand px-1.5 py-px text-xs font-semibold leading-4 text-brand-on">Today</span>
                )}
              </span>
              {caption && (
                <>
                  <span className={cn('hidden sm:block w-full truncate text-xs font-medium leading-4', isToday && tone === 'plain' ? 'text-ink-secondary' : t.fg)}>
                    {caption}
                  </span>
                  {t.dot && <span className={cn('sm:hidden h-1.5 w-1.5 rounded-full', t.dot)} />}
                </>
              )}
            </button>
          );
        })}
      </div>
    ))}
  </div>
);

const EVENT_TONES = {
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-subtle text-ink-secondary',
};

/** Timeline row: round icon on a rail, title + time, muted detail line. */
const TimelineEvent = ({ icon, tone, title, time, detail, last }) => {
  const Icon = icon;
  return (
    <div className="flex w-full items-start gap-3">
      <div className="flex shrink-0 flex-col items-center">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-full', EVENT_TONES[tone] || EVENT_TONES.neutral)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {!last && <span className="h-7 w-0.5 bg-line" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        <div className="flex items-start gap-2">
          <p className="flex-1 min-w-0 text-sm font-semibold leading-5 text-ink">{title}</p>
          <p className="shrink-0 text-[13px] font-medium leading-[18px] text-ink-secondary tabular-nums">{time}</p>
        </div>
        {detail && <p className="text-xs font-medium leading-4 text-ink-muted break-words">{detail}</p>}
      </div>
    </div>
  );
};

const joinParts = (...parts) => parts.filter(Boolean).join(' · ');

const punchEvents = ({ log, timezone, live, liveMinutes, shift }) => {
  const events = [];
  events.push({
    key: 'in',
    icon: LogIn,
    tone: 'success',
    title: 'Clock in',
    time: fmtTime(log.clock_in, timezone),
    detail: joinParts(
      log.is_late && `Late by ${fmtMinutes(log.late_minutes)}`,
      log.work_mode && log.work_mode !== 'office' && WORK_MODE_LABELS[log.work_mode],
      log.source === 'regularization' && 'Corrected',
      log.source?.includes('device') && 'Device',
      log.clock_in_location && 'Location recorded',
      log.clock_in_note,
    ) || (shift?.start_time ? `Shift starts ${fmtShiftTime(shift.start_time)}` : null),
  });

  if (log.clock_out) {
    events.push({
      key: 'out',
      icon: LogOut,
      tone: 'neutral',
      title: 'Clock out',
      time: fmtTime(log.clock_out, timezone),
      detail: joinParts(
        log.early_exit_minutes > 0 && `Left ${fmtMinutes(log.early_exit_minutes)} early`,
        log.clock_out_location && 'Location recorded',
        log.clock_out_note,
      ),
    });
    events.push({
      key: 'worked',
      icon: Timer,
      tone: 'info',
      title: 'Worked',
      time: fmtMinutes(log.worked_minutes),
      detail: log.overtime_minutes > 0
        ? `+${fmtMinutes(log.overtime_minutes)} overtime`
        : (shift?.full_day_minutes ? `Target ${fmtMinutes(shift.full_day_minutes)}` : null),
    });
  } else if (live) {
    events.push({ key: 'now', icon: Timer, tone: 'info', title: 'Working now', time: '—', detail: `${fmtMinutes(liveMinutes)} so far` });
  } else {
    events.push({ key: 'missed', icon: TriangleAlert, tone: 'danger', title: 'Missed clock-out', time: '—', detail: 'Raise a correction to record your clock-out' });
  }
  return events;
};

/**
 * Side panel for the selected day. For today it shows live punches and the
 * clock in / out button; for other days the punches and a correction action.
 */
export const DayPanel = ({
  dateKey, isToday, isFuture, log, dayInfo, shift, timezone, hasProfile,
  clockedIn, finishedToday, liveMinutes, punching, onPunch, onCorrect, onBackToToday,
}) => {
  const date = dateOfKey(dateKey);
  const live = isToday && clockedIn;

  let badge = null;
  if (log) {
    if (!log.clock_out && !live) badge = <StatusBadge tone="danger" label="Missed clock-out" />;
    else if (log.status === 'half-day') badge = <StatusBadge tone="warning" label="Half day" />;
    else if (log.is_late) badge = <StatusBadge tone="warning" label={`Late ${fmtMinutes(log.late_minutes)}`} />;
    else badge = <StatusBadge tone="success" label="On time" />;
  } else if (dayInfo.tone === 'violet') badge = <StatusBadge tone="violet" label="On leave" />;
  else if (dayInfo.tone === 'holiday') badge = <StatusBadge tone="accent" label="Holiday" />;
  else if (dayInfo.tone === 'off') badge = <StatusBadge tone="neutral" label="Weekly off" />;
  else if (dayInfo.tone === 'danger') badge = <StatusBadge tone="danger" label="Absent" />;
  else if (isToday && hasProfile) badge = <StatusBadge tone="warning" label="Not clocked in" />;

  const subtitle = isToday
    ? (shift ? `${shift.name} shift · ${fmtShiftTime(shift.start_time)} – ${fmtShiftTime(shift.end_time)}` : 'Your punches for today')
    : log?.shift?.name
      ? `${log.shift.name} shift · ${fmtShiftTime(log.shift.start_time)} – ${fmtShiftTime(log.shift.end_time)}`
      : dayInfo.caption || (isFuture ? 'Upcoming day' : 'No punches recorded');

  const events = log ? punchEvents({ log, timezone, live, liveMinutes, shift: log.shift || shift }) : [];

  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-line bg-surface p-5 sm:p-6 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-display text-base font-semibold leading-6 text-ink truncate">
            {isToday ? `Today · ${format(date, 'EEE, dd MMM')}` : format(date, 'EEEE, dd MMM')}
          </h2>
          <p className="text-[13px] leading-[18px] text-ink-secondary truncate">{subtitle}</p>
        </div>
        {badge}
      </div>

      {events.length > 0 ? (
        <div className="flex w-full flex-col">
          {events.map((e, i) => <TimelineEvent key={e.key} {...e} last={i === events.length - 1} />)}
        </div>
      ) : (
        <p className="rounded-md bg-canvas px-4 py-5 text-center text-[13px] leading-[18px] text-ink-secondary">
          {isToday
            ? (hasProfile ? "You haven't clocked in yet today." : 'No employee profile is linked to your account.')
            : isFuture ? 'Nothing recorded yet for this day.' : 'No punches were recorded on this day.'}
        </p>
      )}

      {isToday && hasProfile && (
        clockedIn ? (
          <Button data-testid="clock-out-btn" variant="dark" className="w-full" onClick={() => onPunch('clock-out')} disabled={punching}>
            <LogOut className="h-[18px] w-[18px]" />
            {punching ? 'Clocking out…' : 'Clock out'}
          </Button>
        ) : (
          <Button data-testid="clock-in-btn" className="w-full" onClick={() => onPunch('clock-in')} disabled={punching || finishedToday}>
            <LogIn className="h-[18px] w-[18px]" />
            {punching ? 'Clocking in…' : finishedToday ? 'Done for today' : 'Clock in'}
          </Button>
        )
      )}

      {!isToday && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {isFuture ? (
            <Button variant="outline" className="flex-1" onClick={() => onCorrect({ date: dateKey, type: 'wfh' })}>
              <CalendarPlus className="h-[18px] w-[18px]" /> Request WFH / on duty
            </Button>
          ) : (
            <Button variant="outline" className="flex-1" onClick={() => onCorrect({ date: dateKey })}>
              <ClipboardPen className="h-[18px] w-[18px]" /> Raise correction
            </Button>
          )}
          <Button variant="ghost" onClick={onBackToToday}>Back to today</Button>
        </div>
      )}
    </section>
  );
};

const InfoRow = ({ label, value }) => (
  <div className="flex items-start gap-2 py-1.5 text-[13px] leading-[18px]">
    <span className="flex-1 min-w-0 text-ink-muted">{label}</span>
    <span className="font-medium text-ink text-right">{value}</span>
  </div>
);

/** "Your shift" card built from the shift returned by /time/today. */
export const ShiftPanel = ({ shift }) => {
  if (!shift) return null;
  const offs = (shift.weekly_offs || [])
    .slice()
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => WEEKDAY_NAMES[d])
    .filter(Boolean);
  return (
    <section className="flex w-full flex-col gap-3 rounded-lg border border-line bg-surface p-5 sm:p-6 shadow-xs">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-base font-semibold leading-6 text-ink">Your shift</h2>
        <p className="text-[13px] leading-[18px] text-ink-secondary">Used to work out late marks and full days</p>
      </div>
      <div className="flex flex-col">
        <InfoRow label="Shift" value={shift.name} />
        <InfoRow label="Timings" value={`${fmtShiftTime(shift.start_time)} – ${fmtShiftTime(shift.end_time)}`} />
        {shift.grace_minutes != null && <InfoRow label="Grace period" value={`${shift.grace_minutes} minutes`} />}
        <InfoRow label="Weekly off" value={offs.length ? offs.join(', ') : 'None'} />
        {shift.full_day_minutes != null && (
          <InfoRow
            label="Policy"
            value={`Min ${fmtMinutes(shift.full_day_minutes)} for full day${shift.half_day_minutes != null ? `, ${fmtMinutes(shift.half_day_minutes)} for half` : ''}`}
          />
        )}
      </div>
    </section>
  );
};
