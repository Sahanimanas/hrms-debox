import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ArrowUpDown, Trash2, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import api from '@/lib/api';
import { API, PRIORITIES, PRIORITY_ORDER, errorText, statusMeta, hours, remember } from '../../lib';
import { Avatar, PriorityIcon, TypeIcon, StatusBadge, LabelChips, DueDate, PersonSelect } from '../Shared';

const GROUPS = { status: 'Status', assignee: 'Assignee', priority: 'Priority', none: 'No grouping' };
const SORTS = {
  manual: (a, b) => a.position - b.position,
  key: (a, b) => a.number - b.number,
  title: (a, b) => a.title.localeCompare(b.title),
  due: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'),
  priority: (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
  updated: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
};

function SortHead({ k, sort, setSort, children }) {
  return (
    <button type="button" onClick={() => setSort(sort === k ? 'manual' : k)} className={`flex items-center gap-1 hover:text-slate-900 ${sort === k ? 'text-slate-900' : ''}`}>
      {children}<ArrowUpDown className="w-3 h-3" />
    </button>
  );
}

/** Spreadsheet-style task list with grouping, sorting and bulk edits. */
export default function ListView({ project, tasks, people, onOpen, onCreate, editable, onChanged }) {
  const [groupBy, setGroupBy] = useState(() => remember.get('list-group', 'status'));
  const [sort, setSort] = useState('manual');
  const [collapsed, setCollapsed] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const changeGroup = (g) => { setGroupBy(g); remember.set('list-group', g); };

  const groups = useMemo(() => {
    const sorted = [...tasks].sort(SORTS[sort]);
    if (groupBy === 'status') return project.statuses.map(s => ({ key: s.key, title: <StatusBadge label={s.label} color={s.color} />, tasks: sorted.filter(t => t.status === s.key), defaults: { status: s.key } }));
    if (groupBy === 'priority') return PRIORITY_ORDER.map(p => ({ key: p, title: <PriorityIcon priority={p} showLabel />, tasks: sorted.filter(t => t.priority === p) })).filter(g => g.tasks.length);
    if (groupBy === 'assignee') {
      const map = new Map();
      sorted.forEach(t => {
        const k = t.assignee_email || '';
        if (!map.has(k)) map.set(k, { key: k || '__none', title: <span className="flex items-center gap-2 text-sm font-medium"><Avatar name={t.assignee_name} size="xs" />{t.assignee_name || 'Unassigned'}</span>, tasks: [], defaults: { assignee_email: k } });
        map.get(k).tasks.push(t);
      });
      return [...map.values()];
    }
    return [{ key: 'all', title: null, tasks: sorted }];
  }, [tasks, groupBy, sort, project.statuses]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (g, on) => setSelected(s => { const n = new Set(s); g.tasks.forEach(t => (on ? n.add(t.id) : n.delete(t.id))); return n; });

  const bulk = async (body) => {
    try {
      const r = await api.post(`${API}/projects/${project.id}/tasks/bulk`, { task_ids: [...selected], ...body });
      (r.data.warnings || []).forEach(w => toast.warning(w));
      toast.success(body.action === 'delete' ? `${r.data.deleted} task(s) deleted` : `${r.data.updated} task(s) updated`);
      setSelected(new Set());
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err, 'Bulk update failed'));
    }
  };

  return (
    <div className="space-y-3" data-testid="list-view">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupBy} onValueChange={changeGroup}>
          <SelectTrigger className="w-44 h-9 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(GROUPS).map(([k, v]) => <SelectItem key={k} value={k}>Group: {v}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-slate-500">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
      </div>

      {selected.size > 0 && editable && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 text-white px-3 py-2 shadow-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select value="" onValueChange={(v) => bulk({ changes: { status: v } })}>
            <SelectTrigger className="h-8 w-36 bg-slate-800 border-slate-700 text-white"><SelectValue placeholder="Set status" /></SelectTrigger>
            <SelectContent>{project.statuses.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value="" onValueChange={(v) => bulk({ changes: { priority: v } })}>
            <SelectTrigger className="h-8 w-36 bg-slate-800 border-slate-700 text-white"><SelectValue placeholder="Set priority" /></SelectTrigger>
            <SelectContent>{PRIORITY_ORDER.map(p => <SelectItem key={p} value={p}>{PRIORITIES[p].label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="w-44">
            <PersonSelect people={people} value="" placeholder="Assign to…" onChange={(v) => bulk({ changes: { assignee_email: v || null } })} className="h-8 bg-slate-800 border-slate-700 text-white" />
          </div>
          <Button size="sm" variant="ghost" className="h-8 text-red-300 hover:text-red-200 hover:bg-slate-800 gap-1" onClick={() => setConfirmDelete(true)}><Trash2 className="w-4 h-4" /> Delete</Button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[32px_88px_1fr_130px_150px_90px_100px_70px] gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span />
            <SortHead k="key" sort={sort} setSort={setSort}>Key</SortHead>
            <SortHead k="title" sort={sort} setSort={setSort}>Title</SortHead>
            <span>Status</span>
            <span>Assignee</span>
            <SortHead k="priority" sort={sort} setSort={setSort}>Priority</SortHead>
            <SortHead k="due" sort={sort} setSort={setSort}>Due</SortHead>
            <span className="text-right">Est.</span>
          </div>
          {groups.map(g => {
            const isCollapsed = collapsed.has(g.key);
            const allOn = g.tasks.length > 0 && g.tasks.every(t => selected.has(t.id));
            return (
              <div key={g.key}>
                {g.title && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50/60 border-b border-slate-100">
                    {editable && <Checkbox checked={allOn} onCheckedChange={(v) => toggleGroup(g, !!v)} />}
                    <button type="button" onClick={() => setCollapsed(c => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })} className="flex items-center gap-2">
                      {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      {g.title}
                      <span className="text-xs text-slate-400">{g.tasks.length}</span>
                    </button>
                    {editable && g.defaults && (
                      <button type="button" onClick={() => onCreate(g.defaults)} className="ml-auto text-slate-400 hover:text-slate-900" title="Add task"><Plus className="w-4 h-4" /></button>
                    )}
                  </div>
                )}
                {!isCollapsed && g.tasks.map(t => {
                  const s = statusMeta(project, t.status);
                  return (
                    <div key={t.id} className={`grid grid-cols-[32px_88px_1fr_130px_150px_90px_100px_70px] gap-2 items-center px-3 py-2 border-b border-slate-100 hover:bg-slate-50 text-sm ${selected.has(t.id) ? 'bg-sky-50/60' : ''}`}>
                      {editable ? <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} /> : <span />}
                      <span className="flex items-center gap-1.5 text-xs text-slate-500"><TypeIcon type={t.type} />{t.key}</span>
                      <button type="button" onClick={() => onOpen(t.id)} className="text-left min-w-0 flex items-center gap-2">
                        <span className={`truncate hover:underline ${t.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{t.title}</span>
                        {t.subtask_total > 0 && <span className="text-[10px] text-slate-400 shrink-0">{t.subtask_done}/{t.subtask_total}</span>}
                        <LabelChips ids={t.label_ids} labels={project.labels} max={2} />
                      </button>
                      <StatusBadge label={s.label} color={s.color} />
                      <span className="flex items-center gap-1.5 min-w-0"><Avatar name={t.assignee_name} size="xs" /><span className="truncate text-xs text-slate-700">{t.assignee_name || '—'}</span></span>
                      <PriorityIcon priority={t.priority} showLabel />
                      <DueDate task={t} compact />
                      <span className="text-right text-xs text-slate-500">{t.estimate_hours != null ? `${t.estimate_hours}h` : ''}{t.logged_minutes ? <span className="block text-[10px] text-slate-400">{hours(t.logged_minutes)} logged</span> : null}</span>
                    </div>
                  );
                })}
                {!isCollapsed && g.tasks.length === 0 && <p className="px-12 py-2 text-xs text-slate-400 border-b border-slate-100">No tasks</p>}
              </div>
            );
          })}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} task(s)?</AlertDialogTitle>
            <AlertDialogDescription>Sub-tasks, comments and time entries of these tasks are deleted too. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulk({ action: 'delete' })} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
