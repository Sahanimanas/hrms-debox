import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Clock, CheckCircle, CalendarDays, Download, ChevronLeft, ChevronRight, Timer, AlertTriangle, TrendingUp, FileClock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import ClockWidget from '@/components/ClockWidget';
import RequestStatusBadge from '@/components/RequestStatusBadge';
import { fmtTime, fmtMinutes, fmtShiftTime, REQUEST_TYPE_LABELS, WORK_MODE_LABELS, DEFAULT_TIMEZONE } from '@/lib/time';

const STATUS_STYLES = {
  present: 'bg-emerald-100 text-emerald-700',
  'half-day': 'bg-amber-100 text-amber-700',
  absent: 'bg-red-100 text-red-700',
};

const EMPTY_FORM = { type: 'missed_punch', date: '', clock_in: '', clock_out: '', reason: '' };

const MyAttendancePage = () => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState({ logs: [], summary: null });
  const [requests, setRequests] = useState([]);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => {
    fetchRequests();
    api.get('/time/today').then(r => r.data?.timezone && setTimezone(r.data.timezone)).catch(() => {});
  }, [fetchRequests]);

  const shiftMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setMonth(d.getMonth() + 1);
    setYear(d.getFullYear());
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

  const summary = data.summary;
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const summaryCards = [
    { label: 'Days present', value: summary ? summary.days_present : '—', icon: CheckCircle, tone: 'emerald' },
    { label: 'Half days', value: summary ? summary.half_days : '—', icon: Timer, tone: 'amber' },
    { label: 'Late arrivals', value: summary ? summary.late_days : '—', icon: AlertTriangle, tone: 'rose' },
    { label: 'Hours worked', value: summary ? fmtMinutes(summary.total_worked_minutes) : '—', icon: Clock, tone: 'slate' },
    { label: 'Overtime', value: summary ? fmtMinutes(summary.total_overtime_minutes) : '—', icon: TrendingUp, tone: 'purple' },
  ];
  const toneClasses = {
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
              <CalendarDays className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                My Attendance
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">Your punches, hours and attendance requests</p>
            </div>
          </div>
          <Button
            onClick={() => openRequest()}
            className="bg-slate-800 hover:bg-slate-900 rounded-lg sm:rounded-xl shadow-md gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            New Request
          </Button>
        </div>

        <ClockWidget onPunch={fetchLogs} />

        {/* Month navigator + summary */}
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">
            {format(new Date(year, month - 1, 1), 'MMMM yyyy')}
          </h2>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
          {summaryCards.map(({ label, value, icon, tone }) => {
            const Icon = icon;
            return (
            <Card key={label} className="border-slate-100 shadow-sm">
              <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
                  <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
                </div>
                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>

        {/* Punch log */}
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                Punch Log
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!data.logs.length}
                onClick={() => exportCsv(`my-attendance-${year}-${String(month).padStart(2, '0')}`, data.logs, [
                  { key: 'date', label: 'Date' },
                  { label: 'Clock in', value: (l) => fmtTime(l.clock_in, timezone) },
                  { label: 'Clock out', value: (l) => (l.clock_out ? fmtTime(l.clock_out, timezone) : '') },
                  { label: 'Worked (h)', value: (l) => ((l.worked_minutes || 0) / 60).toFixed(2) },
                  { key: 'late_minutes', label: 'Late (min)' },
                  { key: 'overtime_minutes', label: 'Overtime (min)' },
                  { key: 'status', label: 'Status' },
                  { key: 'work_mode', label: 'Mode' },
                  { key: 'source', label: 'Source' },
                ])}
              >
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3"></div>
                <p className="text-sm text-slate-500">Loading…</p>
              </div>
            ) : data.logs.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Clock className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">No punches this month</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Date</th>
                      <th className="text-left font-medium px-4 py-3">In</th>
                      <th className="text-left font-medium px-4 py-3">Out</th>
                      <th className="text-left font-medium px-4 py-3">Worked</th>
                      <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Shift</th>
                      <th className="text-left font-medium px-4 py-3">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-medium text-slate-900">{format(new Date(`${log.date}T00:00:00`), 'EEE, dd MMM')}</p>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {log.work_mode && log.work_mode !== 'office' && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5">{WORK_MODE_LABELS[log.work_mode]}</Badge>
                            )}
                            {log.source === 'regularization' && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5">Corrected</Badge>
                            )}
                            {log.source?.includes('device') && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5">Device</Badge>
                            )}
                            {log.missed_clock_out && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-red-600 border-red-200">Missed clock-out</Badge>
                            )}
                            {(log.is_holiday || log.is_weekly_off) && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-purple-600 border-purple-200">
                                {log.is_holiday ? 'Holiday' : 'Weekly off'}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {fmtTime(log.clock_in, timezone)}
                          {log.is_late && <p className="text-[11px] text-amber-600">Late {fmtMinutes(log.late_minutes)}</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {log.clock_out ? fmtTime(log.clock_out, timezone) : <span className="text-emerald-600">Working</span>}
                          {log.early_exit_minutes > 0 && <p className="text-[11px] text-amber-600">Early {fmtMinutes(log.early_exit_minutes)}</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {log.clock_out ? fmtMinutes(log.worked_minutes) : '—'}
                          {log.overtime_minutes > 0 && <p className="text-[11px] text-purple-600">+{fmtMinutes(log.overtime_minutes)} OT</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-500 hidden sm:table-cell">
                          {log.shift?.name} <span className="text-xs">({fmtShiftTime(log.shift?.start_time)}–{fmtShiftTime(log.shift?.end_time)})</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`${STATUS_STYLES[log.status] || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs capitalize`}>
                            {log.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => openRequest({ date: log.date })}
                          >
                            Fix
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Requests */}
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <FileClock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
              My Requests
              {pendingCount > 0 && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{pendingCount} pending</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {requests.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm">
                No requests yet. Use <span className="font-medium">New Request</span> to fix a missed punch or ask for WFH / on-duty.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {requests.map((r) => (
                  <div key={r.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900 text-sm">{REQUEST_TYPE_LABELS[r.type]}</p>
                        <RequestStatusBadge status={r.status} />
                      </div>
                      <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                        {format(new Date(`${r.date}T00:00:00`), 'EEE, dd MMM yyyy')}
                        {(r.clock_in || r.clock_out) && (
                          <> · {r.clock_in ? fmtShiftTime(r.clock_in) : '—'} – {r.clock_out ? fmtShiftTime(r.clock_out) : '—'}</>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 break-words">{r.reason}</p>
                      {r.action_comments && (
                        <p className="text-xs text-slate-500 mt-0.5 italic">“{r.action_comments}” — {r.actioned_by_name}</p>
                      )}
                    </div>
                    {r.status === 'pending' && (
                      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 self-start sm:self-auto gap-1" onClick={() => withdraw(r.id)}>
                        <Trash2 className="w-3.5 h-3.5" /> Withdraw
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Request dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New attendance request</DialogTitle>
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
                <Label htmlFor="req-in">Clock in{form.type !== 'missed_punch' && <span className="text-slate-400 font-normal"> (optional)</span>}</Label>
                <Input id="req-in" type="time" value={form.clock_in} onChange={(e) => setForm({ ...form, clock_in: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="req-out">Clock out{form.type !== 'missed_punch' && <span className="text-slate-400 font-normal"> (optional)</span>}</Label>
                <Input id="req-out" type="time" value={form.clock_out} onChange={(e) => setForm({ ...form, clock_out: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-slate-500">
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
            <Button onClick={submitRequest} disabled={submitting} className="bg-slate-800 hover:bg-slate-900">
              {submitting ? 'Submitting…' : 'Submit request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyAttendancePage;
