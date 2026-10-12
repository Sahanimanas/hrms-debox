import React, { useMemo, useState } from 'react';
import { CheckSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { API, todayStr, addDays } from '../lib';
import { useLoad } from '../hooks';
import { PageHeader, Loading, ErrorState, Empty, PriorityIcon, StatusBadge, DueDate, ProjectDot, TypeIcon } from '../components/Shared';
import TaskDrawer from '../components/TaskDrawer';
import NewTaskDialog from '../components/NewTaskDialog';

// Asana-style buckets by due date
const bucketOf = (t, today) => {
  if (t.status_category === 'done') return 'done';
  if (!t.due_date) return 'later';
  if (t.due_date < today) return 'overdue';
  if (t.due_date === today) return 'today';
  if (t.due_date <= addDays(today, 7)) return 'week';
  return 'later';
};
const BUCKETS = [
  { key: 'overdue', label: 'Overdue', cls: 'text-red-600' },
  { key: 'today', label: 'Today', cls: 'text-amber-600' },
  { key: 'week', label: 'Next 7 days', cls: 'text-slate-800' },
  { key: 'later', label: 'Later / no date', cls: 'text-slate-500' },
  { key: 'done', label: 'Done', cls: 'text-emerald-600' },
];

/** Everything assigned to / created by / watched by me, across projects. */
export default function MyTasksPage() {
  const [scope, setScope] = useState('assigned');
  const [includeDone, setIncludeDone] = useState(false);
  const [openTask, setOpenTask] = useState(null);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useLoad(`${API}/my-tasks?scope=${scope}&include_done=${includeDone}`, 'Failed to load tasks');
  const projects = useLoad(`${API}/projects`).data;
  const today = todayStr();

  const groups = useMemo(() => BUCKETS.map(b => ({ ...b, tasks: (data || []).filter(t => bucketOf(t, today) === b.key) })).filter(g => g.tasks.length), [data, today]);

  return (
    <div className="p-3 sm:p-4 md:p-8 max-w-6xl mx-auto space-y-5">
      <PageHeader icon={CheckSquare} title="My Tasks" subtitle="Your work across every project, by due date">
        <Button className="gap-1.5 bg-slate-800 hover:bg-slate-900" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> New task</Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-4 justify-between">
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList className="bg-slate-100">
            <TabsTrigger value="assigned">Assigned to me</TabsTrigger>
            <TabsTrigger value="created">Created by me</TabsTrigger>
            <TabsTrigger value="watching">Watching</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Checkbox id="include-done" checked={includeDone} onCheckedChange={(v) => setIncludeDone(!!v)} />
          <Label htmlFor="include-done" className="text-sm text-slate-600">Show completed</Label>
        </div>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : groups.length === 0 ? (
        <Empty icon={CheckSquare} title="No tasks here" />
      ) : groups.map(g => (
        <section key={g.key}>
          <h2 className={`text-sm font-semibold mb-2 ${g.cls}`}>{g.label} <span className="text-slate-400 font-normal">{g.tasks.length}</span></h2>
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {g.tasks.map(t => (
              <button key={t.id} type="button" onClick={() => setOpenTask(t.id)} className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 text-left hover:bg-slate-50">
                <TypeIcon type={t.type} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm truncate ${t.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{t.title}</p>
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><ProjectDot color={t.project?.color} /> {t.key} · {t.project?.name}</p>
                </div>
                <PriorityIcon priority={t.priority} />
                <span className="hidden sm:inline"><StatusBadge label={t.status_label} color={t.status_color} /></span>
                <span className="w-20 text-right"><DueDate task={t} compact /></span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => reload({ quiet: true })} onOpenTask={setOpenTask} />
      <NewTaskDialog open={creating} onOpenChange={setCreating} projects={(projects || []).filter(p => ['admin', 'member'].includes(p.my_role))} onCreated={() => reload({ quiet: true })} />
    </div>
  );
}
