import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, format, addMonths, isSameMonth } from 'date-fns';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { API, errorText, todayStr, statusMeta } from '../../lib';

/**
 * Month calendar of tasks by due date. Drag a task to another day to
 * reschedule; "+" on a day creates a task due that day. Holidays from HR are shaded.
 */
export default function CalendarView({ project, tasks, setTasks, onOpen, onCreate, editable, holidays = {} }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dragId, setDragId] = useState(null);
  const [overDay, setOverDay] = useState(null);

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  }), [month]);

  const byDay = useMemo(() => {
    const map = {};
    tasks.forEach(t => { if (t.due_date) (map[t.due_date] = map[t.due_date] || []).push(t); });
    return map;
  }, [tasks]);
  const undated = tasks.filter(t => !t.due_date && t.status_category !== 'done');
  const today = todayStr();

  const reschedule = async (taskId, day) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.due_date === day) return;
    if (task.start_date && task.start_date > day) {
      toast.error('Due date cannot be before the start date');
      return;
    }
    const prev = tasks;
    setTasks(ts => ts.map(t => (t.id === taskId ? { ...t, due_date: day } : t)));
    try {
      const r = await api.put(`${API}/tasks/${taskId}`, { due_date: day });
      (r.data.warnings || []).forEach(w => toast.warning(w));
    } catch (err) {
      setTasks(prev);
      toast.error(errorText(err, 'Could not reschedule'));
    }
  };

  const chip = (t) => {
    const s = statusMeta(project, t.status);
    return (
      <button
        key={t.id}
        type="button"
        draggable={editable}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDragId(t.id); }}
        onDragEnd={() => { setDragId(null); setOverDay(null); }}
        onClick={() => onOpen(t.id)}
        className={`w-full text-left truncate rounded px-1.5 py-0.5 text-[11px] border-l-2 bg-white hover:bg-slate-50 shadow-sm ${t.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-800'} ${dragId === t.id ? 'opacity-40' : ''}`}
        style={{ borderLeftColor: s.color }}
        title={`${t.key} ${t.title}`}
      >
        <span className="text-slate-400 mr-1">{t.key}</span>{t.title}
      </button>
    );
  };

  return (
    <div className="space-y-3" data-testid="calendar-view">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 px-2 bg-white" onClick={() => setMonth(m => addMonths(m, -1))}><ChevronLeft className="w-4 h-4" /></Button>
        <Button variant="outline" size="sm" className="h-8 bg-white" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
        <Button variant="outline" size="sm" className="h-8 px-2 bg-white" onClick={() => setMonth(m => addMonths(m, 1))}><ChevronRight className="w-4 h-4" /></Button>
        <h2 className="text-lg font-semibold text-slate-900 ml-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>{format(month, 'MMMM yyyy')}</h2>
        {undated.length > 0 && <span className="ml-auto text-xs text-slate-500">{undated.length} open task(s) without a due date</span>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map(d => {
              const key = format(d, 'yyyy-MM-dd');
              const list = byDay[key] || [];
              const inMonth = isSameMonth(d, month);
              const weekend = [0, 6].includes(d.getDay());
              return (
                <div
                  key={key}
                  className={`group min-h-[110px] border-b border-r border-slate-100 p-1.5 space-y-1 ${!inMonth ? 'bg-slate-50/70' : weekend || holidays[key] ? 'bg-slate-50/40' : ''} ${overDay === key ? 'ring-2 ring-inset ring-slate-400' : ''}`}
                  onDragOver={(e) => { if (editable) { e.preventDefault(); setOverDay(key); } }}
                  onDrop={(e) => { e.preventDefault(); setOverDay(null); reschedule(dragId || e.dataTransfer.getData('text/plain'), key); }}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${key === today ? 'bg-yellow-400 text-slate-900 font-bold rounded-full w-6 h-6 flex items-center justify-center' : inMonth ? 'text-slate-700' : 'text-slate-400'}`}>{format(d, 'd')}</span>
                    {editable && (
                      <button type="button" onClick={() => onCreate({ due_date: key })} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-900"><Plus className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                  {holidays[key] && <p className="text-[10px] text-amber-700 truncate">🎉 {holidays[key]}</p>}
                  {list.slice(0, 4).map(chip)}
                  {list.length > 4 && <p className="text-[10px] text-slate-500 px-1">+{list.length - 4} more</p>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
