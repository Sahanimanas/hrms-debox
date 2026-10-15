import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Download, Star, Users, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { categoryStyle, CATEGORY_STYLES, fmtKey, errorText } from '../lib';

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PersonChip = ({ entry, small = false }) => {
  const style = categoryStyle(entry.category);
  return (
    <div className={`flex items-center gap-1 min-w-0 ${entry.status === 'pending' ? 'opacity-60' : ''}`} title={`${entry.employee_name} — ${entry.leave_type || entry.category}${entry.status === 'pending' ? ' (pending)' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
      <span className={`${small ? 'text-[10px]' : 'text-xs'} text-slate-700 truncate`}>
        {entry.employee_name}{entry.is_half_day ? ' ½' : ''}
      </span>
    </div>
  );
};

const TeamCalendarPage = () => {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [includePending, setIncludePending] = useState(false);
  const [department, setDepartment] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  const monthStr = `${cursor.year}-${pad(cursor.month)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { month: monthStr, include_pending: includePending ? 'true' : 'false' };
      if (department !== 'all') params.department = department;
      const response = await api.get('/v2/leave/team-calendar', { params });
      setData(response.data);
    } catch (err) {
      setError(errorText(err, 'Failed to load the team calendar'));
    } finally {
      setLoading(false);
    }
  }, [monthStr, includePending, department]);

  useEffect(() => { load(); }, [load]);

  const shiftMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
    setSelectedDay(null);
  };
  const goToday = () => {
    setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 });
    setSelectedDay(format(now, 'yyyy-MM-dd'));
  };

  const byDay = useMemo(() => {
    const map = {};
    (data?.entries || []).forEach((e) => e.dates.forEach((d) => { (map[d] = map[d] || []).push(e); }));
    return map;
  }, [data]);

  const holidayMap = useMemo(() => Object.fromEntries((data?.holidays || []).map((h) => [h.date, h])), [data]);

  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate();
  const firstWeekday = new Date(cursor.year, cursor.month - 1, 1).getDay();
  const todayKey = format(now, 'yyyy-MM-dd');
  const dayKeys = Array.from({ length: daysInMonth }, (_, i) => `${monthStr}-${pad(i + 1)}`);
  const busyDays = dayKeys.filter((k) => byDay[k]?.length || holidayMap[k]);
  const isDetailed = data && data.scope !== 'employee';
  const peopleOut = new Set((data?.entries || []).map((e) => e.employee_email || e.employee_name)).size;

  const handleExport = () => {
    const rows = (data?.entries || []).map((e) => ({ ...e, from: e.dates[0], to: e.dates[e.dates.length - 1], days: e.dates.length }));
    if (!rows.length) return toast.info('Nothing to export for this month');
    exportCsv(`team-calendar-${monthStr}`, rows, [
      { key: 'employee_name', label: 'Employee' },
      ...(isDetailed ? [{ key: 'department', label: 'Department' }, { key: 'leave_type', label: 'Leave type' }] : []),
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'from', label: 'From' },
      { key: 'to', label: 'To' },
      { label: 'Dates', value: (r) => r.dates.join(' ') },
      { label: 'Half day', value: (r) => (r.is_half_day ? r.half_day_period || 'yes' : '') },
    ]);
  };

  const selectedEntries = selectedDay ? byDay[selectedDay] || [] : [];

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
              <CalendarRange className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Team Calendar
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">
                {data?.scope === 'admin' ? "Who's out across the company" : data?.scope === 'manager' ? "Who's out in your team" : `Who's out in ${data?.department || 'your department'}`}
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={handleExport} className="gap-2 text-xs sm:text-sm h-9 w-full sm:w-auto" disabled={loading || !data?.entries?.length}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>

        {/* Controls */}
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="p-3 sm:p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <h2 className="text-base sm:text-lg font-semibold text-slate-900 min-w-[9rem] text-center">
                {format(new Date(cursor.year, cursor.month - 1, 1), 'MMMM yyyy')}
              </h2>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)} aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={goToday}>Today</Button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {data?.scope === 'admin' && (
                <Select value={department} onValueChange={(v) => { setDepartment(v); setSelectedDay(null); }}>
                  <SelectTrigger className="h-9 w-full sm:w-48 text-sm"><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {(data.departments || []).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2">
                <Switch id="include-pending" checked={includePending} onCheckedChange={setIncludePending} />
                <Label htmlFor="include-pending" className="text-sm text-slate-700 cursor-pointer">Include pending</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary + legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {peopleOut} {peopleOut === 1 ? 'person' : 'people'} out this month</span>
          {Object.entries(CATEGORY_STYLES).map(([name, style]) => (
            <span key={name} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${style.dot}`} />{name}</span>
          ))}
          <span className="flex items-center gap-1.5"><Star className="w-3 h-3 text-rose-500 fill-rose-500" />Holiday</span>
          {includePending && <span className="flex items-center gap-1.5 opacity-60"><span className="w-2 h-2 rounded-full bg-slate-500" />Faded = pending</span>}
        </div>

        {error ? (
          <Card className="border-red-100 bg-red-50">
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-sm text-red-700">{error}</p>
              <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" /> Retry</Button>
            </CardContent>
          </Card>
        ) : loading && !data ? (
          <Card className="border-0 shadow-md">
            <CardContent className="py-16 text-center">
              <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading calendar…</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Month grid (tablet / desktop) */}
            <Card className={`border-0 shadow-md hidden md:block ${loading ? 'opacity-60' : ''}`}>
              <CardContent className="p-3">
                <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className="bg-slate-50 text-center text-xs font-medium text-slate-500 py-2">{d}</div>
                  ))}
                  {Array.from({ length: firstWeekday }).map((_, i) => <div key={`pad-${i}`} className="bg-slate-50/60 min-h-[6.5rem]" />)}
                  {dayKeys.map((key, i) => {
                    const entries = byDay[key] || [];
                    const holiday = holidayMap[key];
                    const weekend = [0, 6].includes((firstWeekday + i) % 7);
                    const selected = selectedDay === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setSelectedDay(selected ? null : key)}
                        className={`text-left p-1.5 min-h-[6.5rem] flex flex-col gap-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400
                          ${selected ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : weekend ? 'bg-slate-50 hover:bg-slate-100' : 'bg-white hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-semibold ${key === todayKey ? 'bg-slate-800 text-white rounded-full w-6 h-6 flex items-center justify-center' : 'text-slate-700'}`}>
                            {i + 1}
                          </span>
                          {entries.length > 0 && <span className="text-[10px] text-slate-500">{entries.length} out</span>}
                        </div>
                        {holiday && (
                          <div className={`text-[10px] truncate rounded px-1 ${holiday.type === 'public' ? 'bg-rose-100 text-rose-700' : 'bg-orange-50 text-orange-700'}`} title={holiday.name}>
                            {holiday.name}
                          </div>
                        )}
                        {entries.slice(0, 3).map((e) => <PersonChip key={e.leave_id} entry={e} small />)}
                        {entries.length > 3 && <span className="text-[10px] text-slate-500">+{entries.length - 3} more</span>}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Selected day detail */}
            {selectedDay && (
              <Card className="border-0 shadow-md hidden md:block">
                <CardHeader className="border-b border-slate-100 p-4">
                  <CardTitle className="text-base">{fmtKey(selectedDay, 'EEEE, dd MMMM yyyy')}</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  {holidayMap[selectedDay] && (
                    <p className="text-sm text-rose-700 mb-2">Holiday: {holidayMap[selectedDay].name} ({holidayMap[selectedDay].type})</p>
                  )}
                  {selectedEntries.length === 0 ? (
                    <p className="text-sm text-slate-500">Nobody is out.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {selectedEntries.map((e) => (
                        <div key={e.leave_id} className="rounded-lg border border-slate-200 p-2.5">
                          <p className="text-sm font-medium text-slate-900">{e.employee_name}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge className={`${categoryStyle(e.category).chip} hover:opacity-90 text-[10px]`}>{e.leave_type || e.category}</Badge>
                            {e.status === 'pending' && <Badge variant="outline" className="text-[10px]">Pending</Badge>}
                            {e.is_half_day && <Badge variant="outline" className="text-[10px] capitalize">Half day · {e.half_day_period}</Badge>}
                            {e.department && <span className="text-[11px] text-slate-500">{e.department}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Agenda (mobile) */}
            <Card className="border-0 shadow-md md:hidden">
              <CardHeader className="border-b border-slate-100 p-3">
                <CardTitle className="text-base">This month</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {busyDays.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">
                    <CalendarRange className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    Nobody is out this month.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {busyDays.map((key) => (
                      <div key={key} className="p-3">
                        <p className={`text-xs font-semibold mb-1.5 ${key === todayKey ? 'text-amber-700' : 'text-slate-500'}`}>
                          {fmtKey(key, 'EEE, dd MMM')}{key === todayKey ? ' · Today' : ''}
                        </p>
                        {holidayMap[key] && <p className="text-xs text-rose-700 mb-1">★ {holidayMap[key].name}</p>}
                        <div className="space-y-1">
                          {(byDay[key] || []).map((e) => (
                            <div key={e.leave_id} className="flex items-center justify-between gap-2">
                              <PersonChip entry={e} />
                              <span className="text-[10px] text-slate-500 shrink-0">{e.leave_type || e.category}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* List of leave this month */}
            <Card className="border-0 shadow-md">
              <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                <CardTitle className="text-base sm:text-lg">Leave this month</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {(data?.entries || []).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">No {includePending ? '' : 'approved '}leave in {format(new Date(cursor.year, cursor.month - 1, 1), 'MMMM')}.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="text-left font-medium px-4 py-3">Employee</th>
                          <th className="text-left font-medium px-4 py-3">Dates</th>
                          <th className="text-left font-medium px-4 py-3">{isDetailed ? 'Type' : 'Category'}</th>
                          {isDetailed && <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Department</th>}
                          <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.entries.map((e) => (
                          <tr key={e.leave_id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{e.employee_name}</td>
                            <td className="px-4 py-3 text-slate-600">
                              {e.dates.length === 1 ? fmtKey(e.dates[0], 'dd MMM') : `${fmtKey(e.dates[0], 'dd MMM')} – ${fmtKey(e.dates[e.dates.length - 1], 'dd MMM')}`}
                              <span className="text-xs text-slate-400"> · {e.is_half_day ? `${e.dates.length * 0.5}d` : `${e.dates.length}d`}</span>
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={`${categoryStyle(e.category).chip} hover:opacity-90 text-[10px] sm:text-xs`}>{e.leave_type || e.category}</Badge>
                            </td>
                            {isDetailed && <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{e.department || '—'}</td>}
                            <td className="px-4 py-3 hidden sm:table-cell capitalize text-slate-600">{e.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default TeamCalendarPage;
