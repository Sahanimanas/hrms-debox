import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, CheckCircle, XCircle, MapPin, Users, LogIn, AlertTriangle, CalendarOff, UserX, Timer, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import { fmtTime, fmtMinutes, fmtShiftTime, REQUEST_TYPE_LABELS, WORK_MODE_LABELS, DEFAULT_TIMEZONE } from '@/lib/time';
import RequestStatusBadge from '@/components/RequestStatusBadge';

const GRID_STYLES = {
  present: 'bg-emerald-100 text-emerald-700',
  'half-day': 'bg-amber-100 text-amber-700',
  absent: 'bg-red-100 text-red-700',
  leave: 'bg-blue-100 text-blue-700',
};

const RequestsTab = () => {
  const { user } = getAuth();
  const [status, setStatus] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null); // { request, action }
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/time/requests', { params: { status } });
      setRequests(response.data || []);
    } catch {
      toast.error('Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const submitAction = async () => {
    setSubmitting(true);
    try {
      await api.post(`/time/requests/${acting.request.id}/action`, { action: acting.action, comments });
      toast.success(acting.action === 'approve' ? 'Request approved' : 'Request rejected');
      setActing(null);
      setComments('');
      fetchRequests();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="gap-1.5"
          disabled={!requests.length}
          onClick={() => exportCsv(`attendance-requests-${status}`, requests, [
            { key: 'employee_name', label: 'Employee' },
            { key: 'department', label: 'Department' },
            { label: 'Type', value: (r) => REQUEST_TYPE_LABELS[r.type] },
            { key: 'date', label: 'Date' },
            { key: 'clock_in', label: 'Clock in' },
            { key: 'clock_out', label: 'Clock out' },
            { key: 'reason', label: 'Reason' },
            { key: 'status', label: 'Status' },
            { key: 'actioned_by_name', label: 'Actioned by' },
            { key: 'action_comments', label: 'Comments' },
          ])}
        >
          <Download className="w-4 h-4" /> Export
        </Button>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12 text-sm text-slate-500">Loading…</div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">No {status === 'all' ? '' : status} requests</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {requests.map((r) => (
                <div key={r.id} className="p-3 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{r.employee_name}</p>
                      <Badge variant="outline" className="text-[10px] sm:text-xs">{REQUEST_TYPE_LABELS[r.type]}</Badge>
                      <RequestStatusBadge status={r.status} />
                    </div>
                    <p className="text-sm text-slate-700 mt-1">
                      {format(new Date(`${r.date}T00:00:00`), 'EEE, dd MMM yyyy')}
                      {(r.clock_in || r.clock_out) && (
                        <> · {r.clock_in ? fmtShiftTime(r.clock_in) : '—'} – {r.clock_out ? fmtShiftTime(r.clock_out) : '—'}</>
                      )}
                    </p>
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5 break-words">{r.reason}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {r.department || 'No department'} · requested {format(new Date(r.created_at), 'dd MMM, h:mm a')}
                      {r.actioned_by_name && <> · {r.status} by {r.actioned_by_name}</>}
                    </p>
                  </div>
                  {r.status === 'pending' && r.user_email === user?.email && (
                    <p className="text-xs text-slate-500 shrink-0">Your own request: another approver must act on it</p>
                  )}
                  {r.status === 'pending' && r.user_email !== user?.email && (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 gap-1" onClick={() => setActing({ request: r, action: 'reject' })}>
                        <XCircle className="w-4 h-4" /> Reject
                      </Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={() => setActing({ request: r, action: 'approve' })}>
                        <CheckCircle className="w-4 h-4" /> Approve
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!acting} onOpenChange={(open) => { if (!open) { setActing(null); setComments(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{acting?.action === 'approve' ? 'Approve' : 'Reject'} request</DialogTitle>
          </DialogHeader>
          {acting && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                {REQUEST_TYPE_LABELS[acting.request.type]} for <b>{acting.request.employee_name}</b> on{' '}
                {format(new Date(`${acting.request.date}T00:00:00`), 'dd MMM yyyy')}.
                {acting.action === 'approve' && ' Their attendance for that day will be updated.'}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="action-comments">Comment (optional)</Label>
                <Textarea id="action-comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)}>Cancel</Button>
            <Button
              onClick={submitAction}
              disabled={submitting}
              className={acting?.action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {submitting ? 'Saving…' : acting?.action === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const DailyReportTab = () => {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [report, setReport] = useState(null);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/time/shifts').then(r => r.data?.timezone && setTimezone(r.data.timezone)).catch(() => {});
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/time/daily-report', { params: { date } });
      setReport(response.data);
    } catch {
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const s = report?.summary || {};
  const cards = [
    { label: 'Employees', value: s.total, icon: Users, cls: 'bg-slate-100 text-slate-600' },
    { label: 'Clocked in', value: s.clocked_in, icon: LogIn, cls: 'bg-emerald-50 text-emerald-600' },
    { label: 'Still working', value: s.still_working, icon: Timer, cls: 'bg-cyan-50 text-cyan-600' },
    { label: 'Late', value: s.late, icon: AlertTriangle, cls: 'bg-amber-50 text-amber-600' },
    { label: 'On leave', value: s.on_leave, icon: CalendarOff, cls: 'bg-blue-50 text-blue-600' },
    { label: 'Not clocked in', value: s.not_clocked_in, icon: UserX, cls: 'bg-rose-50 text-rose-600' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {report?.holiday ? (
          <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 w-fit">Holiday: {report.holiday.name}</Badge>
        ) : <span />}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={!report?.rows?.length}
            onClick={() => exportCsv(`daily-attendance-${date}`, report.rows, [
              { key: 'employee_id', label: 'Employee ID' },
              { key: 'full_name', label: 'Name' },
              { key: 'department', label: 'Department' },
              { key: 'shift_name', label: 'Shift' },
              { label: 'Clock in', value: (r) => (r.log ? fmtTime(r.log.clock_in, timezone) : '') },
              { label: 'Clock out', value: (r) => (r.log?.clock_out ? fmtTime(r.log.clock_out, timezone) : '') },
              { label: 'Worked (h)', value: (r) => (r.log?.worked_minutes != null ? (r.log.worked_minutes / 60).toFixed(2) : '') },
              { label: 'Late (min)', value: (r) => r.log?.late_minutes ?? '' },
              { label: 'Status', value: (r) => r.log?.status || r.grid_status || '' },
            ])}
          >
            <Download className="w-4 h-4" /> Export
          </Button>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="sm:w-48" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {cards.map(({ label, value, icon, cls }) => {
          const Icon = icon;
          return (
          <Card key={label} className="border-slate-100 shadow-sm">
            <CardContent className="p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-900">{loading ? '—' : value ?? 0}</p>
              </div>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
                <Icon className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Employee</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Shift</th>
                  <th className="text-left font-medium px-4 py-3">In</th>
                  <th className="text-left font-medium px-4 py-3">Out</th>
                  <th className="text-left font-medium px-4 py-3">Worked</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loading && report?.rows.map((row) => {
                  const log = row.log;
                  const loc = log?.clock_in_location;
                  const status = log?.status || row.grid_status;
                  return (
                    <tr key={row.employee_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{row.full_name}</p>
                        <p className="text-xs text-slate-500">{row.department || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 hidden md:table-cell">{row.shift_name}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {log ? (
                          <>
                            <span className="inline-flex items-center gap-1">
                              {fmtTime(log.clock_in, timezone)}
                              {loc && (
                                <a
                                  href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-slate-400 hover:text-slate-700"
                                  title={`Clock-in location (±${loc.accuracy ?? '?'} m)`}
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </span>
                            {log.is_late && <p className="text-[11px] text-amber-600">Late {fmtMinutes(log.late_minutes)}</p>}
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {log ? (log.clock_out ? fmtTime(log.clock_out, timezone) : <span className="text-emerald-600">Working</span>) : '—'}
                        {log?.early_exit_minutes > 0 && <p className="text-[11px] text-amber-600">Early {fmtMinutes(log.early_exit_minutes)}</p>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {log?.clock_out ? fmtMinutes(log.worked_minutes) : '—'}
                        {log?.overtime_minutes > 0 && <p className="text-[11px] text-purple-600">+{fmtMinutes(log.overtime_minutes)} OT</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {status ? (
                            <Badge className={`${GRID_STYLES[status] || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs capitalize`}>{status}</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">No record</span>
                          )}
                          {log?.work_mode && log.work_mode !== 'office' && (
                            <Badge variant="outline" className="text-[10px]">{WORK_MODE_LABELS[log.work_mode]}</Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {loading && <div className="text-center py-12 text-sm text-slate-500">Loading…</div>}
            {!loading && report?.rows.length === 0 && <div className="text-center py-12 text-sm text-slate-500">No employees</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const AttendanceRequestsPage = () => (
  <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
    <div className="w-full space-y-5 sm:space-y-6">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
          <ClipboardCheck className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Time Tracking
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">Approve attendance requests and see who's in today</p>
        </div>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="daily">Daily Report</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-4"><RequestsTab /></TabsContent>
        <TabsContent value="daily" className="mt-4"><DailyReportTab /></TabsContent>
      </Tabs>
    </div>
  </div>
);

export default AttendanceRequestsPage;
