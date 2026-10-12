import React, { useMemo, useState } from 'react';
import { Diamond, Ban } from 'lucide-react';
import { differenceInCalendarDays, format, startOfWeek } from 'date-fns';
import { Button } from '@/components/ui/button';
import { addDays, parseDay, todayStr, statusMeta, isOverdue } from '../../lib';
import { Avatar, TypeIcon } from '../Shared';

const ZOOMS = { day: 32, week: 14, month: 5 };
const ROW = 36;
const LEFT = 280;

/**
 * Gantt-style timeline: a bar per task from start date to due date (tasks with
 * only a due date get a bar sized by their estimate), milestones as diamonds,
 * epics / parents with their sub-tasks underneath.
 */
export default function TimelineView({ project, tasks, milestones = [], onOpen }) {
  const [zoom, setZoom] = useState('week');
  const today = todayStr();
  const dayW = ZOOMS[zoom];

  const rows = useMemo(() => {
    const dated = tasks.filter(t => t.start_date || t.due_date);
    const span = (t) => {
      const end = t.due_date || addDays(t.start_date, Math.max(0, Math.ceil((t.estimate_hours || 8) / 8) - 1));
      const start = t.start_date || addDays(end, -Math.max(0, Math.ceil((t.estimate_hours || 8) / 8) - 1));
      return { start, end };
    };
    const parents = dated.filter(t => !t.parent_id || !dated.some(p => p.id === t.parent_id));
    parents.sort((a, b) => span(a).start.localeCompare(span(b).start));
    const out = [];
    parents.forEach(p => {
      out.push({ task: p, ...span(p), depth: 0 });
      dated.filter(c => c.parent_id === p.id).sort((a, b) => span(a).start.localeCompare(span(b).start))
        .forEach(c => out.push({ task: c, ...span(c), depth: 1 }));
    });
    return out;
  }, [tasks]);

  const undated = tasks.filter(t => !t.start_date && !t.due_date).length;

  const range = useMemo(() => {
    const dates = [today, ...rows.flatMap(r => [r.start, r.end]), ...milestones.filter(m => m.due_date).map(m => m.due_date)];
    if (project.start_date) dates.push(project.start_date);
    if (project.due_date) dates.push(project.due_date);
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const start = format(startOfWeek(parseDay(addDays(min, -3)), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const end = addDays(max, 14);
    return { start, days: differenceInCalendarDays(parseDay(end), parseDay(start)) + 1 };
  }, [rows, milestones, today, project.start_date, project.due_date]);

  const x = (d) => differenceInCalendarDays(parseDay(d), parseDay(range.start)) * dayW;
  const width = range.days * dayW;

  // Header ticks: months always; weeks or days depending on zoom
  const ticks = useMemo(() => {
    const months = [];
    const minor = [];
    for (let i = 0; i < range.days; i++) {
      const d = addDays(range.start, i);
      const date = parseDay(d);
      if (i === 0 || date.getDate() === 1) months.push({ d, label: format(date, 'MMM yyyy') });
      if (zoom === 'day') minor.push({ d, label: format(date, 'd'), weekend: [0, 6].includes(date.getDay()) });
      else if (date.getDay() === 1 && zoom === 'week') minor.push({ d, label: format(date, 'dd MMM') });
    }
    return { months, minor };
  }, [range, zoom]);

  return (
    <div className="space-y-3" data-testid="timeline-view">
      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(ZOOMS).map(z => (
          <Button key={z} size="sm" variant={zoom === z ? 'default' : 'outline'} className={`h-8 capitalize ${zoom === z ? 'bg-slate-800' : 'bg-white'}`} onClick={() => setZoom(z)}>{z}</Button>
        ))}
        <span className="text-xs text-slate-500 ml-2">{rows.length} scheduled{undated ? ` · ${undated} without dates (set a start or due date to place them)` : ''}</span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-auto max-h-[calc(100vh-240px)]">
        <div className="relative" style={{ width: LEFT + width }}>
          {/* Header */}
          <div className="sticky top-0 z-20 flex bg-slate-50 border-b border-slate-200">
            <div className="sticky left-0 z-30 bg-slate-50 border-r border-slate-200 px-3 flex items-end pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ width: LEFT, minWidth: LEFT, height: 48 }}>Task</div>
            <div className="relative" style={{ width, height: 48 }}>
              {ticks.months.map(m => <span key={m.d} className="absolute top-1 text-[11px] font-semibold text-slate-700 pl-1 border-l border-slate-300" style={{ left: x(m.d) }}>{m.label}</span>)}
              {ticks.minor.map(m => <span key={m.d} className={`absolute bottom-1 text-[10px] pl-0.5 ${m.weekend ? 'text-slate-300' : 'text-slate-500'}`} style={{ left: x(m.d) }}>{m.label}</span>)}
            </div>
          </div>

          {/* Milestones row */}
          {milestones.some(m => m.due_date) && (
            <div className="flex border-b border-slate-100 bg-purple-50/30">
              <div className="sticky left-0 z-10 bg-white border-r border-slate-200 px-3 flex items-center text-xs font-medium text-purple-700" style={{ width: LEFT, minWidth: LEFT, height: ROW }}>Milestones</div>
              <div className="relative" style={{ width, height: ROW }}>
                {milestones.filter(m => m.due_date).map(m => (
                  <div key={m.id} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center gap-1 whitespace-nowrap" style={{ left: x(m.due_date) + dayW / 2 }} title={`${m.name} · ${m.due_date}`}>
                    <Diamond className={`w-4 h-4 ${m.status === 'done' ? 'fill-emerald-500 text-emerald-600' : 'fill-purple-500 text-purple-600'}`} />
                    <span className="text-[10px] font-medium text-purple-800">{m.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Task rows */}
          {rows.map(({ task: t, start, end, depth }) => {
            const s = statusMeta(project, t.status);
            const left = x(start);
            const w = Math.max(dayW, x(end) - left + dayW);
            const done = t.status_category === 'done';
            return (
              <div key={t.id} className="flex border-b border-slate-100 hover:bg-slate-50/70">
                <button type="button" onClick={() => onOpen(t.id)} className="sticky left-0 z-10 bg-white border-r border-slate-200 px-3 flex items-center gap-2 text-left hover:bg-slate-50" style={{ width: LEFT, minWidth: LEFT, height: ROW, paddingLeft: 12 + depth * 18 }}>
                  <TypeIcon type={t.type} />
                  <span className="text-[11px] text-slate-400 shrink-0">{t.key}</span>
                  <span className={`text-xs truncate ${done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{t.title}</span>
                  {t.blocked_by?.length > 0 && <Ban className="w-3 h-3 text-red-400 shrink-0" />}
                </button>
                <div className="relative" style={{ width, height: ROW }}>
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    className={`absolute top-1.5 h-6 rounded-md flex items-center gap-1 px-1.5 overflow-hidden shadow-sm hover:brightness-110 ${isOverdue(t) ? 'ring-2 ring-red-400' : ''}`}
                    style={{ left, width: w, backgroundColor: done ? '#cbd5e1' : s.color }}
                    title={`${t.key} ${t.title}\n${start} → ${end}`}
                  >
                    <Avatar name={t.assignee_name} size="xs" className="ring-1 ring-white/70" />
                    {w > 70 && <span className="text-[10px] font-medium text-white truncate">{t.title}</span>}
                  </button>
                </div>
              </div>
            );
          })}

          {rows.length === 0 && <p className="text-sm text-slate-500 text-center py-12">No scheduled tasks yet. Give tasks a start or due date to see them on the timeline.</p>}

          {/* Today line */}
          <div className="absolute top-0 bottom-0 w-px bg-red-500/70 z-[5] pointer-events-none" style={{ left: LEFT + x(today) + dayW / 2 }} />
        </div>
      </div>
    </div>
  );
}
