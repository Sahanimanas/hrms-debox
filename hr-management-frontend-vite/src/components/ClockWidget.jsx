import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Clock, LogIn, LogOut, MapPin, AlertTriangle, CalendarOff, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { fmtTime, fmtMinutes, fmtShiftTime, getPosition, DEFAULT_TIMEZONE } from '@/lib/time';

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
    const timer = setInterval(() => setNow(new Date()), 30000);
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

  return (
    <Card data-testid="clock-widget" className="border-slate-100 shadow-sm">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
            <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${clockedIn ? 'bg-emerald-50' : 'bg-amber-50'}`}>
              <Clock className={`w-5 h-5 sm:w-6 sm:h-6 ${clockedIn ? 'text-emerald-600' : 'text-amber-600'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-slate-500 uppercase tracking-wider">
                {clockedIn ? 'You are clocked in' : finishedToday ? 'Done for today' : 'Not clocked in'}
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
                {fmtTime(now, tz)}
              </p>
              <p className="text-xs sm:text-sm text-slate-500 truncate">
                {shift.name} shift · {fmtShiftTime(shift.start_time)} – {fmtShiftTime(shift.end_time)}
              </p>
            </div>
          </div>

          {log && (
            <div className="grid grid-cols-3 gap-3 sm:gap-6 text-center md:text-left">
              <div>
                <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">In</p>
                <p className="text-sm sm:text-base font-semibold text-slate-900">{fmtTime(log.clock_in, tz)}</p>
                {log.is_late && (
                  <Badge className="mt-1 bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] px-1.5 py-0">
                    Late {fmtMinutes(log.late_minutes)}
                  </Badge>
                )}
              </div>
              <div>
                <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Out</p>
                <p className="text-sm sm:text-base font-semibold text-slate-900">{fmtTime(log.clock_out, tz)}</p>
              </div>
              <div>
                <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Worked</p>
                <p className="text-sm sm:text-base font-semibold text-slate-900">{fmtMinutes(liveWorked)}</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 md:w-44">
            {clockedIn ? (
              <Button
                data-testid="clock-out-btn"
                onClick={() => punch('clock-out')}
                disabled={punching}
                className="bg-slate-800 hover:bg-slate-900 h-11 gap-2"
              >
                <LogOut className="w-4 h-4" />
                {punching ? 'Clocking out…' : 'Clock Out'}
              </Button>
            ) : (
              <Button
                data-testid="clock-in-btn"
                onClick={() => punch('clock-in')}
                disabled={punching || finishedToday}
                className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 h-11 gap-2"
              >
                <LogIn className="w-4 h-4" />
                {punching ? 'Clocking in…' : 'Clock In'}
              </Button>
            )}
            <Link
              to="/my-attendance"
              className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center justify-center gap-0.5"
            >
              My attendance <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {(today.holiday || today.is_weekly_off || log?.clock_in_location) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
            {today.holiday && (
              <span className="inline-flex items-center gap-1 text-purple-600">
                <CalendarOff className="w-3.5 h-3.5" /> Holiday: {today.holiday.name}
              </span>
            )}
            {!today.holiday && today.is_weekly_off && (
              <span className="inline-flex items-center gap-1 text-purple-600">
                <CalendarOff className="w-3.5 h-3.5" /> Weekly off
              </span>
            )}
            {log?.clock_in_location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> Location recorded
              </span>
            )}
            {finishedToday && log.early_exit_minutes > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" /> Left {fmtMinutes(log.early_exit_minutes)} early
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ClockWidget;
