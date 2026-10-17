import React, { useState } from 'react';
import { Gauge, ChevronLeft, ChevronRight, ChevronDown, Plane, PartyPopper, Info } from 'lucide-react';
import { format, startOfWeek } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { API, addDays, parseDay, todayStr, fmtDate } from '../lib';
import { useLoad } from '../hooks';
import { PageHeader, Loading, ErrorState, Empty, Avatar, PriorityIcon, ProjectDot } from '../components/Shared';
import TaskDrawer from '../components/TaskDrawer';

const ALL = '__all';
const SPANS = { 7: '1 week', 14: '2 weeks', 28: '4 weeks' };

const utilTone = (u) => (u > 100 ? 'bg-red-500' : u >= 80 ? 'bg-amber-500' : 'bg-emerald-500');

/** Day cell: non-working, holiday or leave first; otherwise shaded by hours due. */
function DayCell({ day }) {
  let cls = 'bg-white';
  let title = `${fmtDate(day.date, 'EEE dd MMM')}`;
  if (day.leave) {
    cls = day.leave.status === 'approved' ? 'bg-purple-400' : 'bg-purple-200';
    title += ` · ${day.leave.status === 'approved' ? 'On leave' : 'Leave requested'}${day.leave.type ? ` (${day.leave.type})` : ''}`;
  } else if (day.holiday) {
    cls = 'bg-amber-300';
    title += ` · ${day.holiday}`;
  } else if (day.off && !day.tasks_due) {
    cls = 'bg-slate-100';
    title += ' · Weekly off';
  } else if (day.hours_due > 8) cls = 'bg-sky-700';
  else if (day.hours_due > 4) cls = 'bg-sky-500';
  else if (day.tasks_due > 0) cls = 'bg-sky-200';
  if (day.tasks_due) title += `${day.off ? ' · Weekly off' : ''} · ${day.tasks_due} task(s) due, ${day.hours_due}h estimated`;
  return (
    <div className={`h-7 rounded-sm border border-slate-100 flex items-center justify-center text-[10px] font-semibold ${cls} ${day.hours_due > 4 && !day.leave && !day.holiday ? 'text-white' : 'text-slate-700'}`} title={title}>
      {day.tasks_due > 0 ? day.tasks_due : ''}
    </div>
  );
}

/**
 * Team workload: planned hours of open tasks vs real capacity — working days
 * from the HR shift, minus holidays and approved leave (8h/day).
 */
export default function WorkloadPage() {
  const [from, setFrom] = useState(() => format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [span, setSpan] = useState(14);
  const [projectId, setProjectId] = useState(ALL);
  const [expanded, setExpanded] = useState(null);
  const [openTask, setOpenTask] = useState(null);
  const to = addDays(from, span - 1);
  const projects = useLoad(`${API}/projects`).data || [];
  const { data, loading, error, reload } = useLoad(`${API}/workload?from=${from}&to=${to}${projectId !== ALL ? `&project_id=${projectId}` : ''}`, 'Failed to load workload');
  const today = todayStr();
  const dates = Array.from({ length: span }, (_, i) => addDays(from, i));

  return (
    <div className="p-3 sm:p-4 md:p-8 w-full space-y-5">
      <PageHeader icon={Gauge} title="Workload" subtitle="Who has capacity — combines task estimates with HR shifts, holidays and leave" />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-9 px-2 bg-white" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft className="w-4 h-4" /></Button>
        <Button variant="outline" size="sm" className="h-9 bg-white" onClick={() => setFrom(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'))}>This week</Button>
        <Button variant="outline" size="sm" className="h-9 px-2 bg-white" onClick={() => setFrom(addDays(from, 7))}><ChevronRight className="w-4 h-4" /></Button>
        <span className="text-sm font-medium text-slate-700 mx-2">{fmtDate(from, 'dd MMM')} – {fmtDate(to, 'dd MMM yyyy')}</span>
        <Select value={String(span)} onValueChange={(v) => setSpan(Number(v))}>
          <SelectTrigger className="w-32 h-9 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(SPANS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-52 h-9 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All my projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.key} · {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-200" /> Tasks due</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-500" /> &gt;4h due</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-700" /> &gt;8h due</span>
        <span className="flex items-center gap-1"><Plane className="w-3 h-3" /><span className="w-3 h-3 rounded-sm bg-purple-400" /> On leave</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-purple-200" /> Leave requested</span>
        <span className="flex items-center gap-1"><PartyPopper className="w-3 h-3" /><span className="w-3 h-3 rounded-sm bg-amber-300" /> Holiday</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-100 border border-slate-200" /> Weekly off</span>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data.people.length ? (
        <Empty icon={Gauge} title="No one to show">Workload covers members of projects you belong to.</Empty>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <div style={{ minWidth: 420 + span * 30 }}>
            <div className="grid items-end gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ gridTemplateColumns: `220px 180px repeat(${span}, minmax(24px, 1fr))` }}>
              <span>Person</span>
              <span>Planned / capacity</span>
              {dates.map(d => (
                <span key={d} className={`text-center normal-case font-medium ${d === today ? 'text-slate-900' : ''}`}>
                  <span className="block text-[9px]">{format(parseDay(d), 'EEEEE')}</span>{format(parseDay(d), 'd')}
                </span>
              ))}
            </div>
            {data.people.map(p => (
              <div key={p.email} className="border-b border-slate-100">
                <div className="grid items-center gap-2 px-3 py-2 hover:bg-slate-50/70 cursor-pointer" style={{ gridTemplateColumns: `220px 180px repeat(${span}, minmax(24px, 1fr))` }} onClick={() => setExpanded(expanded === p.email ? null : p.email)}>
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${expanded === p.email ? '' : '-rotate-90'}`} />
                    <Avatar name={p.name} picture={p.picture} size="md" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{p.open_tasks} open{p.overdue ? <span className="text-red-600"> · {p.overdue} overdue</span> : ''}{p.leave_days ? ` · ${p.leave_days}d leave` : ''}</p>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="text-slate-600">{p.planned_hours}h / {p.capacity_hours}h</span>
                      <span className={`font-semibold ${p.utilization > 100 ? 'text-red-600' : p.utilization >= 80 ? 'text-amber-600' : 'text-emerald-600'}`}>{p.utilization > 998 ? '∞' : `${p.utilization}%`}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${utilTone(p.utilization)}`} style={{ width: `${Math.min(100, p.utilization)}%` }} /></div>
                  </div>
                  {p.days.map(d => <DayCell key={d.date} day={d} />)}
                </div>
                {expanded === p.email && (
                  <div className="px-3 pb-3 pl-12">
                    {p.tasks.length === 0 ? <p className="text-xs text-slate-400">No open tasks.</p> : (
                      <div className="rounded-lg border border-slate-100 divide-y divide-slate-100 bg-white">
                        {p.tasks.map(t => (
                          <button key={t.id} type="button" onClick={() => setOpenTask(t.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                            <PriorityIcon priority={t.priority} />
                            <ProjectDot color={t.project?.color} />
                            <span className="text-xs text-slate-500 w-16 shrink-0">{t.key}</span>
                            <span className="flex-1 truncate text-slate-800">{t.title}</span>
                            <span className="text-xs text-slate-500">{t.estimate_hours != null ? `${t.estimate_hours}h` : '—'}</span>
                            <span className={`text-xs w-16 text-right ${t.due_date && t.due_date < today ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{t.due_date ? fmtDate(t.due_date, 'dd MMM') : 'No date'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-500 flex items-start gap-1"><Info className="w-3 h-3 mt-0.5 shrink-0" /> Planned = estimates of open tasks due by the end of the range (including overdue). Capacity = working days in the range from each person's HR shift, minus holidays and approved leave, at {data?.hours_per_day || 8}h/day.</p>

      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => reload({ quiet: true })} onOpenTask={setOpenTask} />
    </div>
  );
}
