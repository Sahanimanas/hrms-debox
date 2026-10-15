import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock, CircleCheck, Download, ChevronLeft, ChevronRight, Timer, Plane, ClipboardPen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import RequestStatusBadge from '@/components/RequestStatusBadge';
import { StatCard, StatusBadge, Segmented } from '@/components/ds';
import PageHeader, { PageShell } from '@/modules/platform/components/PageHeader';
import { toDateKey } from '@/modules/leave/lib';
import { fmtTime, fmtMinutes, fmtShiftTime, getPosition, REQUEST_TYPE_LABELS, WORK_MODE_LABELS, DEFAULT_TIMEZONE } from '@/lib/time';
import { CalendarLegend, MonthCalendar, DayPanel, ShiftPanel } from './MyAttendanceParts';
import { buildWeeks, describeDay, dateOfKey, keyOf, shortLeaveType } from './myAttendanceUtils';

const STATUS_TONES = { present: 'success', 'half-day': 'warning', absent: 'danger' };

const EMPTY_FORM = { type: 'missed_punch', date: '', clock_in: '', clock_out: '', reason: '' };

const Spinner = ({ label = 'Loading…' }) => (
  <div className="py-12 text-center">
    <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-line border-t-ink" />
    <p className="text-sm text-ink-secondary">{label}</p>
  </div>
);

const MyAttendancePage = () => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState({ logs: [], summary: null });
  const [requests, setRequests] = useState([]);
  const [today, setToday] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('calendar');
  const [selectedKey, setSelectedKey] = useState(null);
  const [punching, setPunching] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/time/my-logs', { params: { month, year } });
      setData(response.data);
    } catch {
      toast.error('Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  const fetchRequests = useCallback(async () => {
    try {
      const response = await api.get('/time/requests/my');
      setRequests(response.data || []);
    } catch (error) {
      console.error('Failed to load requests:', error);
    }
  }, []);

  const fetchToday = useCallback(async () => {
    try {
      const response = await api.get('/time/today');
      setToday(response.data);
      if (response.data?.timezone) setTimezone(response.data.timezone);
    } catch (error) {
      console.error('Failed to fetch clock status:', error);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => {
    fetchRequests();
    fetchToday();
    api.get('/leaves/my-leaves').then(r => setLeaves(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    const timer = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [fetchRequests, fetchToday]);
  useEffect(() => {
    api.get(`/holidays?year=${year}&month=${month}`)
      .then(r => setHolidays(Array.isArray(r.data) ? r.data : []))
      .catch(() => setHolidays([]));
  }, [month, year]);

  const shiftMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setMonth(d.getMonth() + 1);
    setYear(d.getFullYear());
    setSelectedKey(null);
  };

  const openRequest = (preset = {}) => {
    setForm({ ...EMPTY_FORM, ...preset });
    setShowDialog(true);
  };

  const submitRequest = async () => {
    if (!form.date) return toast.error('Pick a date');
    if (form.type === 'missed_punch' && !form.clock_in && !form.clock_out) {
      return toast.error('Enter the clock-in and/or clock-out time to correct');
    }
    if (!form.reason.trim()) return toast.error('Please give a reason');

    setSubmitting(true);
    try {
      await api.post('/time/requests', {
        type: form.type,
        date: form.date,
        clock_in: form.clock_in || null,
        clock_out: form.clock_out || null,
        reason: form.reason.trim(),
      });
      toast.success('Request submitted');
      setShowDialog(false);
      fetchRequests();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (id) => {
    try {
      await api.delete(`/time/requests/${id}`);
      toast.success('Request withdrawn');
      fetchRequests();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to withdraw');
    }
  };

  const punch = async (kind) => {
    setPunching(true);
    try {
      const location = await getPosition();
      await api.post(`/time/${kind}`, location);
      toast.success(kind === 'clock-in' ? 'Clocked in' : 'Clocked out');
      fetchToday();
      fetchLogs();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Something went wrong');
    } finally {
      setPunching(false);
    }
  };

  const exportLogs = () => exportCsv(`my-attendance-${year}-${String(month).padStart(2, '0')}`, data.logs, [
    { key: 'date', label: 'Date' },
    { label: 'Clock in', value: (l) => fmtTime(l.clock_in, timezone) },
    { label: 'Clock out', value: (l) => (l.clock_out ? fmtTime(l.clock_out, timezone) : '') },
    { label: 'Worked (h)', value: (l) => ((l.worked_minutes || 0) / 60).toFixed(2) },
    { key: 'late_minutes', label: 'Late (min)' },
    { key: 'overtime_minutes', label: 'Overtime (min)' },
    { key: 'status', label: 'Status' },
    { key: 'work_mode', label: 'Mode' },
    { key: 'source', label: 'Source' },
  ]);

  const summary = data.summary;
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayKey = today?.date || todayStr;
  const shift = today?.has_profile ? today.shift : null;
  const weeklyOffs = useMemo(() => shift?.weekly_offs || [], [shift]);
  const activeKey = selectedKey || todayKey;

  // ---- Lookups for the calendar ----
  const logByDate = useMemo(() => Object.fromEntries(data.logs.map(l => [l.date, l])), [data.logs]);
  const holidayByDate = useMemo(() => {
    const map = {};
    holidays.forEach((h) => {
      // Optional / restricted holidays don't close the office
      if (['optional', 'restricted'].includes(h.type)) return;
      const key = /^\d{4}-\d{2}-\d{2}/.test(String(h.date)) ? String(h.date).slice(0, 10) : toDateKey(h.date);
      if (key) map[key] = h;
    });
    return map;
  }, [holidays]);
  const leaveByDate = useMemo(() => {
    const map = {};
    leaves.forEach((leave) => {
      if (['rejected', 'cancelled', 'withdrawn'].includes(leave.status)) return;
      (leave.dates || []).forEach((d) => {
        const key = toDateKey(d);
        if (key) map[key] = leave;
      });
    });
    return map;
  }, [leaves]);
  // Absences are only inferred from the first punch of the month onwards, so
  // days before someone joined (or before punching began) aren't marked absent.
  const firstLogKey = useMemo(() => data.logs.reduce((min, l) => (!min || l.date < min ? l.date : min), null), [data.logs]);

  const dayInfoFor = useCallback((key) => {
    const log = key === todayKey && today?.log?.date === key ? today.log : logByDate[key];
    return describeDay({
      log,
      leave: leaveByDate[key],
      holiday: holidayByDate[key],
      isWeeklyOff: log ? log.is_weekly_off : weeklyOffs.includes(dateOfKey(key).getDay()),
      isToday: key === todayKey,
      isPast: key < todayKey,
      absentEligible: !!firstLogKey && key >= firstLogKey,
    });
  }, [todayKey, today, logByDate, leaveByDate, holidayByDate, weeklyOffs, firstLogKey]);

  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);

  // ---- Summary cards ----
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const workingDays = useMemo(() => {
    const days = new Date(year, month, 0).getDate();
    let count = 0;
    for (let d = 1; d <= days; d += 1) {
      const key = keyOf(new Date(year, month - 1, d));
      if (key > todayKey) break;
      if (!weeklyOffs.includes(new Date(year, month - 1, d).getDay()) && !holidayByDate[key]) count += 1;
    }
    return count;
  }, [year, month, todayKey, weeklyOffs, holidayByDate]);

  const completedLogs = data.logs.filter(l => l.clock_out);
  const avgWorked = completedLogs.length
    ? completedLogs.reduce((s, l) => s + (l.worked_minutes || 0), 0) / completedLogs.length
    : null;

  const monthLeave = useMemo(() => {
    let days = 0;
    let latest = null;
    leaves.forEach((leave) => {
      if (leave.status !== 'approved') return;
      (leave.dates || []).forEach((d) => {
        const key = toDateKey(d);
        if (!key.startsWith(monthPrefix)) return;
        days += leave.is_half_day ? 0.5 : 1;
        if (!latest || key > latest.key) latest = { key, type: leave.leave_type };
      });
    });
    return { days, latest };
  }, [leaves, monthPrefix]);

  const summaryCards = [
    {
      label: 'Present days',
      value: summary ? summary.days_present : '—',
      icon: CircleCheck,
      tone: 'success',
      delta: `of ${workingDays} working day${workingDays === 1 ? '' : 's'}`,
      note: summary?.half_days ? `+ ${summary.half_days} half day${summary.half_days === 1 ? '' : 's'}` : null,
    },
    {
      label: 'Late arrivals',
      value: summary ? summary.late_days : '—',
      icon: Clock,
      tone: 'warning',
      delta: shift?.grace_minutes != null ? `grace ${shift.grace_minutes} min` : null,
    },
    {
      label: 'Avg. work hours',
      value: avgWorked != null ? fmtMinutes(avgWorked) : '—',
      icon: Timer,
      tone: 'info',
      delta: shift?.full_day_minutes ? `target ${fmtMinutes(shift.full_day_minutes)}` : null,
      note: summary?.total_overtime_minutes ? `+${fmtMinutes(summary.total_overtime_minutes)} OT` : null,
    },
    {
      label: 'Leaves taken',
      value: monthLeave.days,
      icon: Plane,
      tone: 'violet',
      delta: monthLeave.latest
        ? `${shortLeaveType(monthLeave.latest.type).toLowerCase()} · ${format(dateOfKey(monthLeave.latest.key), 'dd MMM')}`
        : 'none this month',
    },
  ];

  // ---- Selected-day panel ----
  const isTodaySelected = activeKey === todayKey;
  const panelLog = isTodaySelected ? (today?.log || logByDate[activeKey]) : logByDate[activeKey];
  const clockedIn = !!today?.clocked_in;
  const finishedToday = !!(today?.log?.clock_out && today.log.date === today.date);
  const liveMinutes = clockedIn && today?.log ? (tick - new Date(today.log.clock_in)) / 60000 : null;

  return (
    <PageShell>
      <PageHeader
        title="My attendance"
        subtitle={shift
          ? `${shift.name} shift · ${fmtShiftTime(shift.start_time)} – ${fmtShiftTime(shift.end_time)}`
          : 'Your punches, hours and attendance requests'}
      >
        <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[104px] text-center text-sm font-semibold leading-5 text-ink tabular-nums">
            {format(new Date(year, month - 1, 1), 'MMMM yyyy')}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" onClick={() => openRequest()}>
          <ClipboardPen className="h-[18px] w-[18px]" />
          Regularise
        </Button>
        <Button variant="outline" disabled={!data.logs.length} onClick={exportLogs}>
          <Download className="h-[18px] w-[18px]" />
          Download
        </Button>
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        {summaryCards.map(({ label, value, icon, tone, delta, note }) => (
          <StatCard key={label} label={label} value={value} icon={icon} tone={tone} delta={delta} deltaTone="neutral" note={note} />
        ))}
      </div>

      {/* Calendar & today */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-6 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 className="font-display text-base font-semibold leading-6 text-ink truncate">
                  {format(new Date(year, month - 1, 1), 'MMMM yyyy')}
                </h2>
                <p className="text-[13px] leading-[18px] text-ink-secondary truncate">
                  {view === 'calendar' ? 'Tap a day to see punches or raise a correction' : 'Every punch recorded this month'}
                </p>
              </div>
              <Segmented
                options={[{ value: 'calendar', label: 'Calendar' }, { value: 'list', label: 'List' }]}
                value={view}
                onChange={setView}
              />
            </div>

            {view === 'calendar' ? (
              <>
                <CalendarLegend />
                {loading ? <Spinner /> : (
                  <MonthCalendar
                    weeks={weeks}
                    todayKey={todayKey}
                    selectedKey={activeKey}
                    describe={(cell) => dayInfoFor(cell.key)}
                    onSelect={setSelectedKey}
                  />
                )}
              </>
            ) : loading ? <Spinner /> : data.logs.length === 0 ? (
              <div className="py-12 text-center text-ink-secondary">
                <Clock className="mx-auto mb-3 h-10 w-10 text-ink-muted" />
                <p className="text-sm">No punches this month</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead>Worked</TableHead>
                    <TableHead className="hidden sm:table-cell">Shift</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        <p className="font-medium text-ink">{format(new Date(`${log.date}T00:00:00`), 'EEE, dd MMM')}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {log.work_mode && log.work_mode !== 'office' && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{WORK_MODE_LABELS[log.work_mode]}</Badge>
                          )}
                          {log.source === 'regularization' && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">Corrected</Badge>
                          )}
                          {log.source?.includes('device') && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">Device</Badge>
                          )}
                          {log.missed_clock_out && (
                            <Badge variant="outline" className="border-danger-bg px-1.5 py-0 text-[10px] text-danger-fg">Missed clock-out</Badge>
                          )}
                          {(log.is_holiday || log.is_weekly_off) && (
                            <Badge variant="outline" className="border-violet-bg px-1.5 py-0 text-[10px] text-violet-fg">
                              {log.is_holiday ? 'Holiday' : 'Weekly off'}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtTime(log.clock_in, timezone)}
                        {log.is_late && <p className="text-[11px] text-warning-fg">Late {fmtMinutes(log.late_minutes)}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.clock_out ? fmtTime(log.clock_out, timezone) : <span className="text-success-fg">Working</span>}
                        {log.early_exit_minutes > 0 && <p className="text-[11px] text-warning-fg">Early {fmtMinutes(log.early_exit_minutes)}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.clock_out ? fmtMinutes(log.worked_minutes) : '—'}
                        {log.overtime_minutes > 0 && <p className="text-[11px] text-violet-fg">+{fmtMinutes(log.overtime_minutes)} OT</p>}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">
                        {log.shift?.name} <span className="text-xs text-ink-muted">({fmtShiftTime(log.shift?.start_time)}–{fmtShiftTime(log.shift?.end_time)})</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={STATUS_TONES[log.status] || 'neutral'} status={log.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openRequest({ date: log.date })}>
                          Fix
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/* Requests */}
          <section className="flex min-w-0 flex-col rounded-lg border border-line bg-surface shadow-xs">
            <div className="flex items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h2 className="font-display text-base font-semibold leading-6 text-ink">My requests</h2>
                {pendingCount > 0 && <StatusBadge tone="warning" label={`${pendingCount} pending`} />}
              </div>
              <Button variant="ghost" size="sm" onClick={() => openRequest()}>New request</Button>
            </div>
            {requests.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-secondary">
                No requests yet. Use <span className="font-medium text-ink">Regularise</span> to fix a missed punch or ask for WFH / on-duty.
              </div>
            ) : (
              <div className="divide-y divide-line">
                {requests.map((r) => (
                  <div key={r.id} className="flex flex-col justify-between gap-2 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{REQUEST_TYPE_LABELS[r.type]}</p>
                        <RequestStatusBadge status={r.status} />
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink-secondary">
                        {format(new Date(`${r.date}T00:00:00`), 'EEE, dd MMM yyyy')}
                        {(r.clock_in || r.clock_out) && (
                          <> · {r.clock_in ? fmtShiftTime(r.clock_in) : '—'} – {r.clock_out ? fmtShiftTime(r.clock_out) : '—'}</>
                        )}
                      </p>
                      <p className="mt-0.5 break-words text-xs text-ink-muted">{r.reason}</p>
                      {r.action_comments && (
                        <p className="mt-0.5 text-xs italic text-ink-muted">“{r.action_comments}” — {r.actioned_by_name}</p>
                      )}
                    </div>
                    {r.status === 'pending' && (
                      <Button variant="ghost" size="sm" className="gap-1 self-start text-danger-fg hover:bg-danger-bg hover:text-danger-fg sm:self-auto" onClick={() => withdraw(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" /> Withdraw
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-6">
          <DayPanel
            dateKey={activeKey}
            isToday={isTodaySelected}
            isFuture={activeKey > todayKey}
            log={panelLog}
            dayInfo={dayInfoFor(activeKey)}
            shift={shift}
            timezone={timezone}
            hasProfile={!!today?.has_profile}
            clockedIn={clockedIn}
            finishedToday={finishedToday}
            liveMinutes={liveMinutes}
            punching={punching}
            onPunch={punch}
            onCorrect={openRequest}
            onBackToToday={() => setSelectedKey(null)}
          />
          <ShiftPanel shift={shift} />
        </div>
      </div>

      {/* Request dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">New attendance request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="missed_punch">Attendance correction (missed / wrong punch)</SelectItem>
                  <SelectItem value="wfh">Work from home</SelectItem>
                  <SelectItem value="on_duty">On duty (client visit, travel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-date">Date</Label>
              <Input
                id="req-date"
                type="date"
                value={form.date}
                max={form.type === 'missed_punch' ? todayStr : undefined}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="req-in">Clock in{form.type !== 'missed_punch' && <span className="font-normal text-ink-muted"> (optional)</span>}</Label>
                <Input id="req-in" type="time" value={form.clock_in} onChange={(e) => setForm({ ...form, clock_in: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="req-out">Clock out{form.type !== 'missed_punch' && <span className="font-normal text-ink-muted"> (optional)</span>}</Label>
                <Input id="req-out" type="time" value={form.clock_out} onChange={(e) => setForm({ ...form, clock_out: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-ink-secondary">
              {form.type === 'missed_punch'
                ? 'Fill in only the time that needs fixing; the other punch is kept.'
                : 'Leave the times blank to use your shift hours.'}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="req-reason">Reason</Label>
              <Textarea id="req-reason" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Forgot to clock out" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={submitRequest} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default MyAttendancePage;
