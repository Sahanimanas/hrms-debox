import React from 'react';
import { CheckCircle2, AlertTriangle, Timer, Gauge, UserX, Clock } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { API, PRIORITIES, PRIORITY_ORDER, TASK_TYPES, fmtDate } from '../../lib';
import { useLoad } from '../../hooks';
import { Loading, ErrorState, StatCard, Avatar } from '../../components/Shared';

// Validated categorical slots 1 & 2 (dataviz reference palette, light mode)
const SERIES_1 = '#2a78d6';
const SERIES_2 = '#eb6834';
const MUTED = '#94a3b8';
const AXIS = { fontSize: 11, fill: '#64748b' };
const GRID = '#eef2f7';

function ChartCard({ title, subtitle, children }) {
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-4 pb-1">
        <CardTitle className="text-base" style={{ fontFamily: 'Plus Jakarta Sans' }}>{title}</CardTitle>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </CardHeader>
      <CardContent className="p-4 pt-2">{children}</CardContent>
    </Card>
  );
}

/** Project analytics: health, workflow distribution, flow, burndown, velocity and people. */
export default function ReportsTab({ project }) {
  const { data, loading, error, reload } = useLoad(`${API}/projects/${project.id}/reports`, 'Failed to load reports');
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const { totals, by_status: byStatus, by_priority: byPriority, by_type: byType, by_assignee: byAssignee, flow, burndown, velocity } = data;
  const priorityData = PRIORITY_ORDER.map(p => ({ name: PRIORITIES[p].label, value: byPriority[p] || 0 }));
  const flowData = flow.map(f => ({ ...f, label: fmtDate(f.week, 'dd MMM') }));
  const budgetPct = totals.budget_hours ? Math.round((totals.logged_hours / totals.budget_hours) * 100) : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="Completion" value={`${totals.completion}%`} icon={CheckCircle2} tone="emerald" hint={`${totals.done}/${totals.tasks} tasks`} />
        <StatCard label="Open" value={totals.open} icon={Clock} tone="sky" />
        <StatCard label="Overdue" value={totals.overdue} icon={AlertTriangle} tone={totals.overdue ? 'red' : 'slate'} />
        <StatCard label="Unassigned" value={totals.unassigned} icon={UserX} tone="amber" />
        <StatCard label="Logged" value={`${totals.logged_hours}h`} icon={Timer} tone="purple" hint={`${totals.billable_hours}h billable · est. ${totals.estimate_hours}h`} />
        <StatCard label="Avg cycle time" value={totals.avg_cycle_days != null ? `${totals.avg_cycle_days}d` : '—'} icon={Gauge} tone="slate" hint="In progress → done" />
      </div>

      {budgetPct != null && (
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-medium text-slate-800">Budget</span>
              <span className={budgetPct > 100 ? 'text-red-600 font-semibold' : 'text-slate-600'}>{totals.logged_hours}h of {totals.budget_hours}h ({budgetPct}%)</span>
            </div>
            <Progress value={Math.min(100, budgetPct)} className="h-2" />
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Tasks by status" subtitle="Current distribution across the workflow">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatus} layout="vertical" margin={{ left: 10, right: 24 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={96} tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [v, 'Tasks']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16} label={{ position: 'right', fontSize: 11, fill: '#334155' }}>
                  {byStatus.map(s => <Cell key={s.key} fill={s.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Created vs completed" subtitle="Tasks per week, last 12 weeks">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={flowData} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={28} />
                <Tooltip />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="created" name="Created" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="completed" name="Completed" stroke={SERIES_2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {burndown && (
          <ChartCard title={`Burndown · ${burndown.sprint.name}`} subtitle={`Remaining ${burndown.unit} vs the ideal line (${burndown.total} committed)`}>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={burndown.series.map(p => ({ ...p, label: fmtDate(p.date, 'dd MMM') }))} margin={{ right: 12 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={28} />
                  <Tooltip />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                  <Line type="linear" dataKey="ideal" name="Ideal" stroke={MUTED} strokeDasharray="5 4" strokeWidth={2} dot={false} />
                  <Line type="stepAfter" dataKey="remaining" name="Remaining" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        {velocity.length > 0 && (
          <ChartCard title="Velocity" subtitle="Committed vs completed per sprint">
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={velocity} barGap={2}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="sprint" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={28} />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="committed" name="Committed" fill={SERIES_1} radius={[4, 4, 0, 0]} barSize={18} />
                  <Bar dataKey="completed" name="Completed" fill={SERIES_2} radius={[4, 4, 0, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        <ChartCard title="By priority">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={28} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [v, 'Tasks']} />
                <Bar dataKey="value" fill={SERIES_1} radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-600">
            {Object.entries(byType).map(([k, v]) => <span key={k}>{TASK_TYPES[k]?.label || k}: <b className="text-slate-900">{v}</b></span>)}
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Team" subtitle="Open work, overdue items and time logged per person">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2 font-semibold">Person</th>
                <th className="py-2 px-2 font-semibold text-right">Open</th>
                <th className="py-2 px-2 font-semibold text-right">Done</th>
                <th className="py-2 px-2 font-semibold text-right">Overdue</th>
                <th className="py-2 px-2 font-semibold text-right">Open estimate</th>
                <th className="py-2 pl-2 font-semibold text-right">Logged</th>
              </tr>
            </thead>
            <tbody>
              {byAssignee.map(a => (
                <tr key={a.email || 'none'} className="border-b border-slate-100">
                  <td className="py-2 pr-2"><span className="flex items-center gap-2"><Avatar name={a.email ? a.name : null} size="sm" />{a.name}</span></td>
                  <td className="py-2 px-2 text-right">{a.open}</td>
                  <td className="py-2 px-2 text-right">{a.done}</td>
                  <td className={`py-2 px-2 text-right ${a.overdue ? 'text-red-600 font-medium' : ''}`}>{a.overdue}</td>
                  <td className="py-2 px-2 text-right">{a.estimate_hours}h</td>
                  <td className="py-2 pl-2 text-right">{a.logged_hours}h</td>
                </tr>
              ))}
              {byAssignee.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">No tasks yet</td></tr>}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
