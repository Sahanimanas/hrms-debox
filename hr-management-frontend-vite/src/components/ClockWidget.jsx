import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, LogOut, MapPin, AlertTriangle, CalendarOff, CalendarCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api from '@/lib/api';
import { fmtTime, fmtMinutes, getPosition, DEFAULT_TIMEZONE } from '@/lib/time';

// Faint yellow streak on the left of the navy band (Figma "Clock hero" radial fill)
const HERO_GLOW = {
  backgroundImage: 'radial-gradient(1150px 50px at -115px 62%, rgba(250,204,20,0.22), rgba(250,204,20,0))',
};

const pad = (n) => String(n).padStart(2, '0');

/** Seconds -> "HH:MM:SS". */
const fmtElapsed = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

/** Wall-clock "HH:MM:SS" in the company timezone. */
const fmtClock = (date, timeZone) =>
  date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone });

const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

const fromMinutes = (mins) => {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** Four evenly spaced labels across the shift (handles shifts that cross midnight). */
const shiftTimeline = (shift) => {
  const start = toMinutes(shift?.start_time);
  let end = toMinutes(shift?.end_time);
  if (start == null || end == null) return [];
  if (end <= start) end += 1440;
  const span = end - start;
  return [0, 1 / 3, 2 / 3, 1].map(f => fromMinutes(start + span * f));
};

const shiftLength = (shift) => {
  const start = toMinutes(shift?.start_time);
  let end = toMinutes(shift?.end_time);
  if (start == null || end == null) return null;
  if (end <= start) end += 1440;
  return end - start;
};

const ClockWidget = ({ onPunch }) => {
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [now, setNow] = useState(new Date());

  const fetchToday = useCallback(async () => {
    try {
      const response = await api.get('/time/today');
      setToday(response.data);
    } catch (error) {
      console.error('Failed to fetch clock status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchToday();
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [fetchToday]);

  const punch = async (kind) => {
    setPunching(true);
    try {
      const location = await getPosition();
      await api.post(`/time/${kind}`, location);
      toast.success(kind === 'clock-in' ? 'Clocked in' : 'Clocked out');
      fetchToday();
      onPunch?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Something went wrong');
    } finally {
      setPunching(false);
    }
  };

  // Admin accounts without an employee profile have nothing to clock
  if (loading || !today?.has_profile) return null;

  const tz = today.timezone || DEFAULT_TIMEZONE;
  const { log, shift, clocked_in: clockedIn } = today;
  const finishedToday = log?.clock_out && log.date === today.date;
  const liveWorked = clockedIn && log ? (now - new Date(log.clock_in)) / 60000 : log?.worked_minutes;
  const target = shift?.full_day_minutes || shiftLength(shift) || 480;
  const progress = Math.min(100, Math.max(0, ((liveWorked || 0) / target) * 100));
  const timeline = shiftTimeline(shift);

  const bigTime = clockedIn && log
    ? fmtElapsed((now - new Date(log.clock_in)) / 1000)
    : fmtClock(now, tz);

  const meta = [];
  if (clockedIn && log) {
    meta.push(`Clocked in at ${fmtTime(log.clock_in, tz)}`);
    meta.push(log.is_late ? `Late ${fmtMinutes(log.late_minutes)}` : 'On time');
  } else if (finishedToday) {
    meta.push(`Done for today · ${fmtTime(log.clock_in, tz)} – ${fmtTime(log.clock_out, tz)}`);
    if (log.is_late) meta.push(`Late ${fmtMinutes(log.late_minutes)}`);
  } else {
    meta.push('Not clocked in yet');
  }
  if (log?.clock_in_location) meta.push('Location recorded');

  return (
    <section
      data-testid="clock-widget"
      className="relative overflow-hidden rounded-hero bg-navy px-5 py-6 sm:px-8 sm:py-7"
    >
      <span aria-hidden className="pointer-events-none absolute inset-0" style={HERO_GLOW} />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-8">
        {/* Left: shift, live clock, meta */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="truncate text-[11px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-brand">
            Today&apos;s shift · {shift?.name} {shift?.start_time} – {shift?.end_time}
          </p>
          <p className="font-display text-[36px] font-bold leading-[44px] tracking-[-0.02em] text-white tabular-nums sm:text-[44px] sm:leading-[52px]">
            {bigTime}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-[18px] text-navy-text">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{meta.join(' · ')}</span>
            {today.holiday && (
              <span className="inline-flex items-center gap-1 text-brand">
                · <CalendarOff className="h-3.5 w-3.5" /> Holiday: {today.holiday.name}
              </span>
            )}
            {!today.holiday && today.is_weekly_off && (
              <span className="inline-flex items-center gap-1 text-brand">
                · <CalendarOff className="h-3.5 w-3.5" /> Weekly off
              </span>
            )}
            {finishedToday && log.early_exit_minutes > 0 && (
              <span className="inline-flex items-center gap-1 text-warning-solid">
                · <AlertTriangle className="h-3.5 w-3.5" /> Left {fmtMinutes(log.early_exit_minutes)} early
              </span>
            )}
          </div>
        </div>

        {/* Middle: worked vs target */}
        <div className="flex w-full flex-col gap-2.5 lg:w-[300px] xl:w-[360px] shrink-0">
          <div className="flex items-start text-[13px] leading-[18px]">
            <p className="flex-1 min-w-0 font-medium text-white">Worked {fmtMinutes(liveWorked || 0)}</p>
            <p className="shrink-0 text-navy-text">Target {fmtMinutes(target)}</p>
          </div>
          <div
            className="relative h-2 w-full overflow-hidden rounded-full bg-navy-hover"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label="Worked time against shift target"
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          {timeline.length > 0 && (
            <div className="flex items-start text-xs font-medium leading-4 text-navy-text">
              {timeline.map((label, i) => (
                <p key={i} className={`flex-1 min-w-0 ${i === 0 ? 'text-left' : i === timeline.length - 1 ? 'text-right' : 'text-center'}`}>
                  {label}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            to="/my-attendance"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-navy-border bg-navy-hover px-4 text-sm font-semibold text-white transition-colors hover:border-navy-text/40"
          >
            <CalendarCheck className="h-[18px] w-[18px]" />
            My attendance
          </Link>
          {clockedIn ? (
            <Button
              data-testid="clock-out-btn"
              onClick={() => punch('clock-out')}
              disabled={punching}
              className="[&_svg]:size-[18px]"
            >
              <LogOut />
              {punching ? 'Clocking out…' : 'Clock out'}
            </Button>
          ) : (
            <Button
              data-testid="clock-in-btn"
              onClick={() => punch('clock-in')}
              disabled={punching || finishedToday}
              className="[&_svg]:size-[18px]"
            >
              <LogIn />
              {punching ? 'Clocking in…' : 'Clock in'}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
};

export default ClockWidget;
