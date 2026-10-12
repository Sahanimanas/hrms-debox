import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Percent, UserX, AlarmClock, Clock, TrendingUp, Palmtree, Wallet, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import AnalyticsShell from '../components/AnalyticsShell';
import FilterBar from '../components/FilterBar';
import ChartCard from '../components/ChartCard';
import KpiTile from '../components/KpiTile';
import { TrendLine, Columns, HBars } from '../components/Charts';
import { useFilterOptions } from '../hooks';
import { dayPresetRange, dayLabel, monthLabel, fmtPct, fmtNum, fmtInr, cleanParams, downloadServerCsv, SERIES, OTHER } from '../lib';

// Stable colour per leave type (colour follows the type, never its rank)
const KNOWN_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Paid Leave', 'Comp Off', 'Unpaid Leave'];
const leaveSeries = (types) => {
  const ordered = [...KNOWN_TYPES.filter(t => types.includes(t)), ...types.filter(t => !KNOWN_TYPES.includes(t)).sort()];
  return ordered.map(t => {
    const known = KNOWN_TYPES.indexOf(t);
    const idx = known >= 0 ? known : KNOWN_TYPES.length + ordered.filter(x => !KNOWN_TYPES.includes(x)).indexOf(t);
    return { key: t, name: t, color: idx < SERIES.length ? SERIES[idx] : OTHER };
  });
};

const AttendanceAnalyticsPage = () => {
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';
  const options = useFilterOptions();
  const [filters, setFilters] = useState({ preset: '30d', ...dayPresetRange('30d'), department: 'all', organization_id: 'all' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const params = cleanParams({ from: filters.from, to: filters.to, department: filters.department, organization_id: filters.organization_id });
  const paramKey = JSON.stringify(params);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/analytics/attendance', { params: JSON.parse(paramKey) });
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load attendance analytics');
    } finally {
      setLoading(false);
    }
  }, [paramKey]);

  useEffect(() => { load(); }, [load]);

  const serverCsv = (table) => () => downloadServerCsv('/v2/analytics/export', { section: 'attendance', table, ...params }, `attendance-${table}.csv`);

  const s = data?.summary;
  const daily = data?.daily || [];
  const tracked = daily.filter(d => d.attendance_pct != null);
  const types = data?.leave_usage?.types || [];
  const series = leaveSeries(types);
  const liability = data?.leave_liability;

  return (
    <AnalyticsShell icon={CalendarCheck} title="Attendance & Leave Trends" subtitle={user?.role === 'manager' ? 'Attendance, punctuality and leave for your team' : 'Attendance, punctuality, hours and leave across the company'}>
      <FilterBar mode="day" value={filters} onChange={setFilters} options={options} showOrganization={isAdmin} />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button type="button" className="ml-auto underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <KpiTile loading={loading} icon={Percent} label="Attendance" value={s ? fmtPct(s.attendance_pct) : null} note={s ? `${s.tracked_days} tracked day(s)` : null} />
        <KpiTile loading={loading} icon={UserX} label="Absenteeism" value={s ? fmtPct(s.absenteeism_pct) : null} note={s ? `${s.absent_days} absent · ${s.half_days} half` : null} />
        <KpiTile loading={loading} icon={AlarmClock} label="Late arrivals" value={s?.late_arrivals} />
        <KpiTile loading={loading} icon={Clock} label="Avg hours / day" value={s?.avg_worked_hours != null ? `${fmtNum(s.avg_worked_hours, 2)} h` : '—'} note={s ? `${s.punch_logs} punch day(s)` : null} />
        <KpiTile loading={loading} icon={TrendingUp} label="Overtime" value={s ? `${fmtNum(s.total_overtime_hours)} h` : null} note={s ? `${s.overtime_days} day(s)` : null} />
        <KpiTile loading={loading} icon={Palmtree} label="Leave taken" value={s ? `${fmtNum(s.leave_days_taken)} d` : null} note="approved" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Daily attendance %"
          subtitle="(present + ½ half-day) ÷ marked working entries; leave and unmarked days excluded"
          loading={loading}
          rows={tracked.length ? daily : []}
          emptyText="No attendance marked in this range"
          filename="daily-attendance"
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'active_headcount', label: 'Headcount', numeric: true },
            { key: 'present', label: 'Present', numeric: true },
            { key: 'half_day', label: 'Half', numeric: true },
            { key: 'absent', label: 'Absent', numeric: true },
            { key: 'on_leave', label: 'Leave', numeric: true },
            { key: 'attendance_pct', label: 'Attendance %', numeric: true, format: (v) => fmtPct(v) },
          ]}
          onServerCsv={serverCsv('daily_trend')}
        >
          <TrendLine data={daily} xKey="date" xFormatter={dayLabel} yFormatter={(v) => `${v}%`} valueFormatter={(v) => fmtPct(v)} yDomain={[0, 100]} series={[{ key: 'attendance_pct', name: 'Attendance' }]} />
        </ChartCard>

        <ChartCard
          title="Late arrivals"
          subtitle="Punches after the shift start + grace"
          loading={loading}
          rows={s?.late_arrivals ? data.late_trend : []}
          emptyText="No late arrivals in this range"
          filename="late-arrivals"
          columns={[{ key: 'date', label: 'Date' }, { key: 'late_arrivals', label: 'Late arrivals', numeric: true }]}
          onServerCsv={serverCsv('late_trend')}
        >
          <Columns data={data?.late_trend || []} xKey="date" xFormatter={dayLabel} series={[{ key: 'late_arrivals', name: 'Late arrivals', color: SERIES[1] }]} />
        </ChartCard>

        <ChartCard
          title="Absenteeism by department"
          subtitle="(absent + ½ half-day) ÷ marked days including leave"
          loading={loading}
          rows={(data?.absenteeism_by_department || []).filter(d => d.marked_days > 0)}
          emptyText="No attendance marked in this range"
          filename="absenteeism-by-department"
          columns={[
            { key: 'department', label: 'Department' },
            { key: 'employees', label: 'People', numeric: true },
            { key: 'absence_days', label: 'Absence days', numeric: true },
            { key: 'marked_days', label: 'Marked days', numeric: true },
            { key: 'attendance_pct', label: 'Attendance %', numeric: true, format: (v) => fmtPct(v) },
            { key: 'absenteeism_pct', label: 'Absenteeism %', numeric: true, format: (v) => fmtPct(v) },
          ]}
          onServerCsv={serverCsv('absenteeism_by_department')}
        >
          <HBars data={(data?.absenteeism_by_department || []).filter(d => d.marked_days > 0)} yKey="department" valueKey="absenteeism_pct" name="Absenteeism" color={SERIES[1]} valueFormatter={(v) => `${v}%`} />
        </ChartCard>

        <ChartCard
          title="Leave usage by type"
          subtitle="Approved leave days per month"
          loading={loading}
          rows={s?.leave_days_taken ? data.leave_usage.months : []}
          emptyText="No approved leave in this range"
          filename="leave-usage-by-month"
          columns={[{ key: 'month', label: 'Month' }, ...types.map(t => ({ key: t, label: t, numeric: true })), { key: 'total', label: 'Total', numeric: true }]}
          onServerCsv={serverCsv('leave_usage')}
        >
          <Columns data={data?.leave_usage?.months || []} xKey="month" xFormatter={monthLabel} stacked series={series} valueFormatter={(v) => `${fmtNum(v)} d`} />
        </ChartCard>

        <ChartCard
          title="Top late arrivers"
          loading={loading}
          rows={data?.top_late_arrivers || []}
          emptyText="No late arrivals in this range"
          filename="top-late-arrivers"
          columns={[
            { key: 'full_name', label: 'Employee' },
            { key: 'department', label: 'Department' },
            { key: 'late_count', label: 'Late days', numeric: true },
            { key: 'avg_late_minutes', label: 'Avg minutes late', numeric: true },
          ]}
          onServerCsv={serverCsv('top_late_arrivers')}
        />

        <ChartCard
          title="Top leave takers"
          loading={loading}
          rows={data?.top_leave_takers || []}
          emptyText="No approved leave in this range"
          filename="top-leave-takers"
          columns={[
            { key: 'full_name', label: 'Employee' },
            { key: 'department', label: 'Department' },
            { key: 'days', label: 'Days', numeric: true, format: (v) => fmtNum(v) },
          ]}
          onServerCsv={serverCsv('top_leave_takers')}
        />

        <ChartCard
          title="Hours and overtime by department"
          subtitle="From clock-in / clock-out punches"
          loading={loading}
          rows={data?.hours_by_department || []}
          emptyText="No completed punches in this range"
          filename="hours-by-department"
          columns={[
            { key: 'department', label: 'Department' },
            { key: 'logs', label: 'Punch days', numeric: true },
            { key: 'avg_worked_hours', label: 'Avg hours', numeric: true, format: (v) => fmtNum(v, 2) },
            { key: 'total_overtime_hours', label: 'Overtime h', numeric: true, format: (v) => fmtNum(v, 2) },
          ]}
          onServerCsv={serverCsv('hours_by_department')}
        >
          <HBars data={data?.hours_by_department || []} yKey="department" valueKey="avg_worked_hours" name="Avg hours / day" valueFormatter={(v) => `${v}h`} />
        </ChartCard>

        <ChartCard
          title="Leave liability"
          subtitle={liability ? `${fmtNum(liability.total_days)} outstanding days across ${liability.employees} employees${liability.encashable_value != null ? ` · encashable ≈ ${fmtInr(liability.encashable_value)}` : ''}` : 'Outstanding leave balances (excludes unpaid leave)'}
          loading={loading}
          rows={liability?.by_type || []}
          emptyText="No outstanding balances"
          filename="leave-liability-by-type"
          columns={[
            { key: 'leave_type', label: 'Leave type' },
            { key: 'days', label: 'Days', numeric: true, format: (v) => fmtNum(v) },
            ...(isAdmin ? [{ key: 'encashable', label: 'Encashable', format: (v) => (v ? 'Yes' : 'No') }] : []),
          ]}
          onServerCsv={serverCsv('leave_liability')}
        >
          <HBars data={liability?.by_type || []} yKey="leave_type" valueKey="days" name="Days" valueFormatter={(v) => fmtNum(v)} />
        </ChartCard>
      </div>

      {isAdmin && liability?.value_basis && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> {liability.value_basis}.</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="text-xs sm:text-sm text-slate-600 underline hover:text-slate-900"
          onClick={() => serverCsv('punch_logs')().catch(() => toast.error('Export failed'))}
        >
          Download all punch logs for this range (CSV)
        </button>
      </div>
    </AnalyticsShell>
  );
};

export default AttendanceAnalyticsPage;
