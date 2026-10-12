import React, { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, UserMinus, TrendingDown, Hourglass, Cake, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import AnalyticsShell from '../components/AnalyticsShell';
import FilterBar from '../components/FilterBar';
import ChartCard from '../components/ChartCard';
import KpiTile from '../components/KpiTile';
import { TrendLine, Columns, HBars, Donut } from '../components/Charts';
import { useFilterOptions } from '../hooks';
import { monthPresetRange, monthLabel, fmtPct, fmtNum, cleanParams, downloadServerCsv, SERIES } from '../lib';

const splitColumns = (label) => [
  { key: 'key', label },
  { key: 'count', label: 'Employees', numeric: true },
  { key: 'pct', label: '% of total', numeric: true, format: (v) => fmtPct(v) },
];

const PeopleAnalyticsPage = () => {
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';
  const options = useFilterOptions();
  const [filters, setFilters] = useState({ preset: '12m', ...monthPresetRange('12m'), department: 'all', organization_id: 'all' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const params = cleanParams({ from: filters.from, to: filters.to, department: filters.department, organization_id: filters.organization_id });
  const paramKey = JSON.stringify(params);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/analytics/people', { params: JSON.parse(paramKey) });
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load people analytics');
    } finally {
      setLoading(false);
    }
  }, [paramKey]);

  useEffect(() => { load(); }, [load]);

  const serverCsv = (table) => () => downloadServerCsv('/v2/analytics/export', { section: 'people', table, ...params }, `people-${table}.csv`);

  const s = data?.summary;
  const trend = data?.trend || [];
  const gender = [...(data?.splits?.gender || [])].sort((a, b) => a.key.localeCompare(b.key));

  return (
    <AnalyticsShell icon={Users} title="People Analytics" subtitle={user?.role === 'manager' ? 'Headcount, movement and composition of your team' : 'Headcount, joiners and leavers, attrition and workforce composition'}>
      <FilterBar mode="month" value={filters} onChange={setFilters} options={options} showOrganization={isAdmin} />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button type="button" className="ml-auto underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <KpiTile loading={loading} icon={Users} label="Headcount" value={s?.headcount} note={data ? `as of ${data.range.as_of}` : null} />
        <KpiTile loading={loading} icon={UserPlus} label="Joiners" value={s?.joiners} note={s ? `net ${s.net_change >= 0 ? '+' : ''}${s.net_change}` : null} />
        <KpiTile loading={loading} icon={UserMinus} label="Leavers" value={s?.leavers} />
        <KpiTile loading={loading} icon={TrendingDown} label="Attrition (annualised)" value={s ? fmtPct(s.attrition_annualised_pct) : null} note={s ? `${fmtPct(s.attrition_pct)} over ${data.range.months} mo · avg HC ${fmtNum(s.avg_headcount)}` : null} />
        <KpiTile loading={loading} icon={Hourglass} label="Avg tenure" value={s?.avg_tenure_years != null ? `${fmtNum(s.avg_tenure_years)} yrs` : '—'} />
        <KpiTile loading={loading} icon={Cake} label="Avg age" value={s?.avg_age != null ? fmtNum(s.avg_age) : '—'} note={data ? `DOB on file: ${fmtPct(data.data_quality.dob_coverage_pct, 0)}` : null} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Headcount trend"
          subtitle="Employees on the rolls at each month end"
          loading={loading}
          rows={trend}
          filename="headcount-trend"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'opening', label: 'Opening', numeric: true },
            { key: 'headcount', label: 'Closing', numeric: true },
            { key: 'joiners', label: 'Joiners', numeric: true },
            { key: 'leavers', label: 'Leavers', numeric: true },
            { key: 'attrition_pct', label: 'Attrition %', numeric: true, format: (v) => fmtPct(v, 2) },
          ]}
          onServerCsv={serverCsv('headcount_trend')}
        >
          <TrendLine data={trend} xKey="month" xFormatter={monthLabel} series={[{ key: 'headcount', name: 'Headcount' }]} />
        </ChartCard>

        <ChartCard
          title="Joiners and leavers"
          subtitle="Per month"
          loading={loading}
          rows={trend}
          filename="joiners-leavers"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'joiners', label: 'Joiners', numeric: true },
            { key: 'leavers', label: 'Leavers', numeric: true },
          ]}
        >
          <Columns data={trend} xKey="month" xFormatter={monthLabel} series={[{ key: 'joiners', name: 'Joiners' }, { key: 'leavers', name: 'Leavers' }]} />
        </ChartCard>

        <ChartCard
          title="Monthly attrition"
          subtitle="Leavers ÷ average of opening and closing headcount"
          loading={loading}
          rows={trend}
          filename="monthly-attrition"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'leavers', label: 'Leavers', numeric: true },
            { key: 'avg_headcount', label: 'Avg headcount', numeric: true },
            { key: 'attrition_pct', label: 'Attrition %', numeric: true, format: (v) => fmtPct(v, 2) },
          ]}
        >
          <TrendLine data={trend} xKey="month" xFormatter={monthLabel} yFormatter={(v) => `${v}%`} valueFormatter={(v) => fmtPct(v, 2)} series={[{ key: 'attrition_pct', name: 'Attrition', color: SERIES[1] }]} />
        </ChartCard>

        <ChartCard title="By department" subtitle="Current headcount" loading={loading} rows={data?.splits?.department || []} columns={splitColumns('Department')} filename="headcount-by-department" onServerCsv={serverCsv('department_split')}>
          <HBars data={data?.splits?.department || []} yKey="key" valueKey="count" name="Employees" />
        </ChartCard>

        <ChartCard title="By gender" loading={loading} rows={gender} columns={splitColumns('Gender')} filename="headcount-by-gender" onServerCsv={serverCsv('gender_split')}>
          <Donut data={gender} valueFormatter={(v) => `${v} employees`} />
        </ChartCard>

        <ChartCard title="By employment status" loading={loading} rows={data?.splits?.employment_status || []} columns={splitColumns('Status')} filename="headcount-by-status" onServerCsv={serverCsv('status_split')}>
          <HBars data={data?.splits?.employment_status || []} yKey="key" valueKey="count" name="Employees" />
        </ChartCard>

        <ChartCard title="Tenure bands" subtitle="Time since joining" loading={loading} rows={data?.tenure_bands || []} columns={splitColumns('Tenure')} filename="tenure-bands" onServerCsv={serverCsv('tenure_bands')}>
          <Columns data={data?.tenure_bands || []} xKey="key" series={[{ key: 'count', name: 'Employees' }]} />
        </ChartCard>

        <ChartCard
          title="Age bands"
          subtitle={data ? `Employees with a date of birth on file (${fmtPct(data.data_quality.dob_coverage_pct, 0)})` : undefined}
          loading={loading}
          rows={(data?.age_bands || []).some(b => b.count) ? data.age_bands : []}
          emptyText="No dates of birth recorded yet"
          columns={splitColumns('Age band')}
          filename="age-bands"
          onServerCsv={serverCsv('age_bands')}
        >
          <Columns data={data?.age_bands || []} xKey="key" series={[{ key: 'count', name: 'Employees' }]} />
        </ChartCard>

        <ChartCard title="By designation" loading={loading} rows={data?.splits?.designation || []} columns={splitColumns('Designation')} filename="headcount-by-designation" onServerCsv={serverCsv('designation_split')} />

        {isAdmin && (
          <ChartCard title="By organization" loading={loading} rows={data?.splits?.organization || []} columns={splitColumns('Organization')} filename="headcount-by-organization" onServerCsv={serverCsv('organization_split')} />
        )}

        <ChartCard
          title="Manager span of control"
          subtitle={data ? `${data.span_of_control.managers} managers · avg ${fmtNum(data.span_of_control.avg_direct_reports, 2)} direct reports · max ${data.span_of_control.max_direct_reports}` : undefined}
          loading={loading}
          rows={data?.span_of_control?.rows || []}
          emptyText="No reporting lines (manager emails) recorded"
          filename="span-of-control"
          columns={[
            { key: 'manager_name', label: 'Manager' },
            { key: 'department', label: 'Department' },
            { key: 'direct_reports', label: 'Direct reports', numeric: true },
          ]}
          onServerCsv={serverCsv('span_of_control')}
        />
      </div>

      <ChartCard
        title="Workforce roster"
        subtitle={data ? `${data.roster.length} employees on the rolls as of ${data.range.as_of}` : undefined}
        loading={loading}
        rows={data?.roster || []}
        filename="workforce-roster"
        columns={[
          { key: 'employee_id', label: 'ID' },
          { key: 'full_name', label: 'Name' },
          { key: 'department', label: 'Department' },
          { key: 'designation', label: 'Designation' },
          { key: 'employment_status', label: 'Status' },
          { key: 'joining_date', label: 'Joined' },
          { key: 'tenure_band', label: 'Tenure' },
          ...(isAdmin ? [{ key: 'age_band', label: 'Age band' }] : []),
        ]}
        onServerCsv={() => {
          toast.message('Preparing CSV…');
          return serverCsv('roster')();
        }}
      />

      {data && (data.data_quality.missing_joining_date > 0 || data.data_quality.exited_without_exit_date > 0) && (
        <p className="text-xs text-slate-500">
          Data notes: {data.data_quality.missing_joining_date} record(s) without a joining date are counted from the start;
          {' '}{data.data_quality.exited_without_exit_date} exited record(s) without an exit date are left out of the trend.
        </p>
      )}
    </AnalyticsShell>
  );
};

export default PeopleAnalyticsPage;
