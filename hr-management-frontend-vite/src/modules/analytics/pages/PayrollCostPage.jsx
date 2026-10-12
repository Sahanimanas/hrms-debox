import React, { useCallback, useEffect, useState } from 'react';
import { IndianRupee, Wallet, Users, TrendingUp, Building2, AlertCircle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import AnalyticsShell from '../components/AnalyticsShell';
import FilterBar from '../components/FilterBar';
import ChartCard from '../components/ChartCard';
import KpiTile from '../components/KpiTile';
import { TrendLine, HBars } from '../components/Charts';
import { useFilterOptions } from '../hooks';
import { monthPresetRange, monthLabel, fmtPct, fmtInr, fmtInrCompact, fmtNum, cleanParams, downloadServerCsv } from '../lib';

const SOURCE_LABEL = { payslips: 'Payslips', estimated: 'Estimated', mixed: 'Payslips + estimates' };

const signedPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmtPct(v)}`);

const PayrollCostPage = () => {
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
      const r = await api.get('/v2/analytics/payroll-cost', { params: JSON.parse(paramKey) });
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load payroll cost');
    } finally {
      setLoading(false);
    }
  }, [paramKey]);

  useEffect(() => { load(); }, [load]);

  const serverCsv = (table) => () => downloadServerCsv('/v2/analytics/export', { section: 'payroll-cost', table, ...params }, `payroll-cost-${table}.csv`);

  const s = data?.summary;
  const months = data?.months || [];
  const hasCost = months.some(m => m.employer_cost > 0);
  const mom = s?.latest_mom_change_pct;

  return (
    <AnalyticsShell icon={IndianRupee} title="Payroll Cost" subtitle="Gross, net and employer cost by month and department">
      <FilterBar mode="month" value={filters} onChange={setFilters} options={options} />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button type="button" className="ml-auto underline" onClick={load}>Retry</button>
        </div>
      )}

      {data && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm text-slate-600">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
          <span>
            Source: <span className="font-medium text-slate-800">{SOURCE_LABEL[data.source] || data.source}</span>. {data.source_note}
            {data.data_quality.employees_without_salary > 0 && ` ${data.data_quality.employees_without_salary} employee(s) have no salary on file and are not included in estimates.`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <KpiTile loading={loading} icon={Wallet} label="Employer cost (range)" value={s ? fmtInrCompact(s.total_employer_cost) : null} note={s ? `avg ${fmtInrCompact(s.avg_monthly_cost)} / month` : null} />
        <KpiTile loading={loading} icon={IndianRupee} label="Net paid (range)" value={s ? fmtInrCompact(s.total_net) : null} note={s ? `gross ${fmtInrCompact(s.total_gross)}` : null} />
        <KpiTile loading={loading} icon={Users} label="Avg cost per head" value={s ? fmtInrCompact(s.avg_cost_per_head) : null} />
        <KpiTile
          loading={loading}
          icon={TrendingUp}
          label={s?.latest_month ? `${monthLabel(s.latest_month)} vs prior` : 'Latest month'}
          value={s ? fmtInrCompact(s.latest_employer_cost) : null}
          note={mom != null ? `${signedPct(mom)} month over month` : null}
          noteTone={mom == null ? 'muted' : mom > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Monthly payroll cost"
          subtitle="Employer cost = earned gross (after loss of pay) + employer PF/ESI"
          className="lg:col-span-2"
          loading={loading}
          rows={hasCost ? months : []}
          emptyText="No payslips or salary data for this range"
          filename="payroll-cost-by-month"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'source', label: 'Source', format: (v) => <Badge variant="outline" className="text-[10px]">{SOURCE_LABEL[v] || v}</Badge> },
            { key: 'headcount', label: 'Heads', numeric: true },
            { key: 'gross', label: 'Earned gross', numeric: true, format: fmtInr },
            { key: 'lop', label: 'LOP', numeric: true, format: (v) => (v ? fmtInr(v) : '—') },
            { key: 'net', label: 'Net', numeric: true, format: fmtInr },
            { key: 'employer_cost', label: 'Employer cost', numeric: true, format: fmtInr },
            { key: 'mom_change_pct', label: 'MoM', numeric: true, format: signedPct },
          ]}
          onServerCsv={serverCsv('months')}
        >
          <TrendLine
            data={months}
            xKey="month"
            xFormatter={monthLabel}
            yFormatter={fmtInrCompact}
            valueFormatter={fmtInr}
            series={[
              { key: 'employer_cost', name: 'Employer cost' },
              { key: 'gross', name: 'Earned gross' },
              { key: 'net', name: 'Net' },
            ]}
            height={280}
          />
        </ChartCard>

        <ChartCard
          title="Cost per head"
          subtitle="Employer cost ÷ employees paid that month"
          loading={loading}
          rows={hasCost ? months : []}
          emptyText="No payslips or salary data for this range"
          filename="cost-per-head"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'headcount', label: 'Heads', numeric: true },
            { key: 'cost_per_head', label: 'Cost per head', numeric: true, format: fmtInr },
          ]}
        >
          <TrendLine data={months} xKey="month" xFormatter={monthLabel} yFormatter={fmtInrCompact} valueFormatter={fmtInr} series={[{ key: 'cost_per_head', name: 'Cost per head' }]} />
        </ChartCard>

        <ChartCard
          title="Cost by department"
          subtitle="Employer cost over the selected range"
          loading={loading}
          rows={data?.by_department || []}
          emptyText="No payslips or salary data for this range"
          filename="payroll-cost-by-department"
          columns={[
            { key: 'department', label: 'Department' },
            { key: 'avg_headcount', label: 'Avg heads', numeric: true, format: (v) => fmtNum(v, 2) },
            { key: 'employer_cost', label: 'Employer cost', numeric: true, format: fmtInr },
            { key: 'share_pct', label: 'Share', numeric: true, format: (v) => fmtPct(v) },
          ]}
          onServerCsv={serverCsv('by_department')}
        >
          <HBars data={data?.by_department || []} yKey="department" valueKey="employer_cost" name="Employer cost" valueFormatter={fmtInrCompact} />
        </ChartCard>
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5" /> Cancelled payslips are ignored. Months after the current month are not shown.
      </p>
    </AnalyticsShell>
  );
};

export default PayrollCostPage;
