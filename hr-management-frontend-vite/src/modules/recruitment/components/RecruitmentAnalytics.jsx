import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
import { Users, Timer, Handshake, Briefcase, Table2, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatCard } from './Common';
import { AXIS_TICK, CHART, SOURCE_LABELS, fmtDate, label } from '../lib';

const ChartTip = ({ active, payload, label: name, suffix = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-slate-900">{name}</p>
      <p className="text-slate-600">{payload[0].value}{suffix}</p>
    </div>
  );
};

/** Single-series vertical columns (one hue, no legend — the card title names the series). */
const Columns = ({ data, xKey, yKey, height = 220, xFormatter, suffix }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
      <CartesianGrid vertical={false} stroke={CHART.grid} />
      <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.axis }} tickFormatter={xFormatter} interval={0} minTickGap={4} />
      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
      <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} content={<ChartTip suffix={suffix} />} labelFormatter={xFormatter} />
      <Bar dataKey={yKey} fill={CHART.bar} maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        <LabelList dataKey={yKey} position="top" style={{ fontSize: 11, fill: CHART.muted }} formatter={(v) => (v ? v : '')} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

/** Horizontal bars for category shares (source breakdown). */
const HBars = ({ rows, total }) => (
  <ul className="space-y-3">
    {rows.map(r => {
      const pct = total ? Math.round((r.count / total) * 100) : 0;
      return (
        <li key={r.key}>
          <div className="flex justify-between text-xs sm:text-sm mb-1">
            <span className="text-slate-700">{r.label}</span>
            <span className="text-slate-500 tabular-nums">{r.count} · {pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${r.label}: ${r.count} (${pct}%)`}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART.bar }} />
          </div>
        </li>
      );
    })}
  </ul>
);

export default function RecruitmentAnalytics({ data }) {
  const [asTable, setAsTable] = useState(false);
  if (!data) return null;
  const tth = data.time_to_hire;
  const stageData = data.by_stage.map(s => ({ ...s, name: s.label }));
  const sources = data.by_source.map(s => ({ key: s.source, label: label(SOURCE_LABELS, s.source), count: s.count })).sort((a, b) => b.count - a.count);
  const weeks = data.applications_by_week.map(w => ({ ...w, name: fmtDate(w.week_start, 'dd MMM') }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <StatCard label="Open jobs" value={data.jobs.open} hint={`${data.jobs.draft} draft · ${data.jobs.closed} closed`} icon={Briefcase} />
        <StatCard label="Active candidates" value={data.candidates.active} hint={`${data.candidates.total} total`} icon={Users} />
        <StatCard label="Avg time to hire" value={tth.average_days == null ? '—' : `${Math.round(tth.average_days)}d`} hint={tth.hires ? `Median ${Math.round(tth.median_days)}d · ${tth.hires} hire${tth.hires > 1 ? 's' : ''}` : 'No hires yet'} icon={Timer} />
        <StatCard label="Offer acceptance" value={data.offers.acceptance_rate == null ? '—' : `${Math.round(data.offers.acceptance_rate)}%`} hint={`${data.offers.accepted} accepted · ${data.offers.declined} declined`} icon={Handshake} />
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => setAsTable(v => !v)}>
          {asTable ? <BarChart3 className="w-4 h-4" /> : <Table2 className="w-4 h-4" />}
          {asTable ? 'Show charts' : 'Show as table'}
        </Button>
      </div>

      {asTable ? (
        <Card className="border-0 shadow-md">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr><th className="text-left font-medium px-4 py-2">Metric</th><th className="text-right font-medium px-4 py-2">Count</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stageData.map(s => <tr key={s.stage}><td className="px-4 py-2">Stage · {s.label}</td><td className="px-4 py-2 text-right tabular-nums">{s.count}</td></tr>)}
                {sources.map(s => <tr key={s.key}><td className="px-4 py-2">Source · {s.label}</td><td className="px-4 py-2 text-right tabular-nums">{s.count}</td></tr>)}
                {weeks.map(w => <tr key={w.week_start}><td className="px-4 py-2">Applications · week of {w.name}</td><td className="px-4 py-2 text-right tabular-nums">{w.applications}</td></tr>)}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="border-0 shadow-md lg:col-span-2">
            <CardHeader className="p-3 sm:p-5 pb-0 sm:pb-0"><CardTitle className="text-sm sm:text-base">Candidates per stage</CardTitle></CardHeader>
            <CardContent className="p-3 sm:p-5"><Columns data={stageData} xKey="name" yKey="count" /></CardContent>
          </Card>
          <Card className="border-0 shadow-md">
            <CardHeader className="p-3 sm:p-5 pb-0 sm:pb-0"><CardTitle className="text-sm sm:text-base">Source of candidates</CardTitle></CardHeader>
            <CardContent className="p-3 sm:p-5"><HBars rows={sources} total={data.candidates.total} /></CardContent>
          </Card>
          <Card className="border-0 shadow-md lg:col-span-3">
            <CardHeader className="p-3 sm:p-5 pb-0 sm:pb-0"><CardTitle className="text-sm sm:text-base">Applications per week</CardTitle></CardHeader>
            <CardContent className="p-3 sm:p-5"><Columns data={weeks} xKey="name" yKey="applications" height={200} /></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
