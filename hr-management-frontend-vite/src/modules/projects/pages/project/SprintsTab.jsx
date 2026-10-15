import React, { useState } from 'react';
import { Rocket, Play, CheckCircle2, Plus, Trash2, Pencil, ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { API, errorText, fmtDate, statusMeta, todayStr, addDays } from '../../lib';
import { Avatar, PriorityIcon, TypeIcon, StatusBadge } from '../../components/Shared';

function TaskRow({ task, project, onOpen, draggable, onDragStart }) {
  const s = statusMeta(project, task.status);
  return (
    <div draggable={draggable} onDragStart={onDragStart} onClick={() => onOpen(task.id)}
      className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 cursor-pointer text-sm border-b border-slate-100 last:border-0">
      <TypeIcon type={task.type} />
      <span className="text-xs text-slate-500 w-16 shrink-0">{task.key}</span>
      <span className={`flex-1 truncate ${task.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>{task.title}</span>
      <StatusBadge label={s.label} color={s.color} />
      <PriorityIcon priority={task.priority} />
      <span className="w-6 text-center text-[11px] font-semibold text-slate-600">{task.story_points ?? ''}</span>
      <Avatar name={task.assignee_name} size="xs" />
    </div>
  );
}

/**
 * Jira-style backlog: the active sprint, planned sprints and the backlog.
 * Drag tasks between lists to plan; start and complete sprints with carry-over.
 */
export default function SprintsTab({ project, tasks, sprints, editable, onOpen, onCreate, onChanged }) {
  const [over, setOver] = useState(null);
  const [dialog, setDialog] = useState(null); // { mode: 'create'|'edit'|'start'|'complete', sprint }
  const [form, setForm] = useState({});
  const [showCompleted, setShowCompleted] = useState(false);

  const active = sprints.find(s => s.status === 'active');
  const planned = sprints.filter(s => s.status === 'planned');
  const completed = sprints.filter(s => s.status === 'completed');
  const backlog = tasks.filter(t => !t.sprint_id && t.status_category !== 'done' && !t.parent_id);
  const inSprint = (id) => tasks.filter(t => t.sprint_id === id && !t.parent_id).sort((a, b) => a.position - b.position);

  const moveTo = async (taskId, sprintId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || (task.sprint_id || null) === sprintId) return;
    try {
      await api.put(`${API}/tasks/${taskId}`, { sprint_id: sprintId });
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Could not move task'));
    }
  };

  const dropZone = (sprintId) => ({
    onDragOver: (e) => { if (editable) { e.preventDefault(); setOver(sprintId ?? '__backlog'); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); },
    onDrop: (e) => { e.preventDefault(); setOver(null); moveTo(e.dataTransfer.getData('text/plain'), sprintId); },
  });

  const open = (mode, sprint) => {
    setDialog({ mode, sprint });
    if (mode === 'complete') setForm({ move_to: planned[0]?.id || 'backlog' });
    else if (mode === 'start') setForm({ name: sprint.name, goal: sprint.goal || '', start_date: sprint.start_date || todayStr(), end_date: sprint.end_date || addDays(sprint.start_date || todayStr(), 13) });
    else setForm({ name: sprint?.name || '', goal: sprint?.goal || '', start_date: sprint?.start_date || '', end_date: sprint?.end_date || '' });
  };

  const submit = async () => {
    const { mode, sprint } = dialog;
    try {
      if (mode === 'create') await api.post(`${API}/projects/${project.id}/sprints`, { ...form, name: form.name || undefined });
      if (mode === 'edit') await api.put(`${API}/sprints/${sprint.id}`, form);
      if (mode === 'start') await api.post(`${API}/sprints/${sprint.id}/start`, form);
      if (mode === 'complete') {
        const r = await api.post(`${API}/sprints/${sprint.id}/complete`, form);
        toast.success(`Sprint completed: ${r.data.stats.completed}/${r.data.stats.committed} ${r.data.stats.unit}`);
      } else toast.success('Saved');
      setDialog(null);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Failed'));
    }
  };

  const remove = async (sprint) => {
    try {
      await api.delete(`${API}/sprints/${sprint.id}`);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete sprint'));
    }
  };

  const renderSprint = (sprint) => {
    const list = inSprint(sprint.id);
    const points = list.reduce((s, t) => s + (t.story_points || 0), 0);
    const done = list.filter(t => t.status_category === 'done').length;
    const isActive = sprint.status === 'active';
    return (
      <div key={sprint.id} className={`rounded-xl border bg-white overflow-hidden ${isActive ? 'border-slate-900 shadow-md' : 'border-slate-200'} ${over === sprint.id ? 'ring-2 ring-slate-400' : ''}`} {...dropZone(sprint.id)}>
        <div className={`flex flex-wrap items-center gap-2 px-4 py-3 ${isActive ? 'bg-slate-900 text-white' : 'bg-slate-50'}`}>
          <Rocket className="w-4 h-4" />
          <span className="font-semibold">{sprint.name}</span>
          {isActive && <span className="text-[10px] font-semibold uppercase tracking-wider bg-yellow-400 text-slate-900 rounded px-1.5">Active</span>}
          <span className={`text-xs ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
            {sprint.start_date ? `${fmtDate(sprint.start_date, 'dd MMM')} → ${fmtDate(sprint.end_date, 'dd MMM')}` : 'Dates not set'} · {list.length} tasks · {points} pts
          </span>
          {editable && (
            <div className="ml-auto flex gap-1.5">
              {isActive && <Button size="sm" className="h-7 gap-1 bg-yellow-400 text-slate-900 hover:bg-yellow-300" onClick={() => open('complete', sprint)}><CheckCircle2 className="w-3.5 h-3.5" /> Complete sprint</Button>}
              {sprint.status === 'planned' && <Button size="sm" variant="outline" className="h-7 gap-1 bg-white" disabled={!!active} title={active ? 'Complete the active sprint first' : ''} onClick={() => open('start', sprint)}><Play className="w-3.5 h-3.5" /> Start</Button>}
              <Button size="sm" variant="ghost" className={`h-7 px-2 ${isActive ? 'text-white hover:bg-slate-800 hover:text-white' : ''}`} onClick={() => open('edit', sprint)}><Pencil className="w-3.5 h-3.5" /></Button>
              {sprint.status === 'planned' && <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:bg-red-50" onClick={() => remove(sprint)}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </div>
          )}
        </div>
        {sprint.goal && <p className="px-4 py-2 text-xs text-slate-600 border-b border-slate-100">🎯 {sprint.goal}</p>}
        {isActive && list.length > 0 && (
          <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-100"><Progress value={(done / list.length) * 100} className="h-1.5 flex-1" /><span className="text-xs text-slate-500">{done}/{list.length} done</span></div>
        )}
        {list.map(t => <TaskRow key={t.id} task={t} project={project} onOpen={onOpen} draggable={editable} onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} />)}
        {list.length === 0 && <p className="text-xs text-slate-400 text-center py-5">{editable ? 'Drag tasks from the backlog to plan this sprint' : 'No tasks'}</p>}
        {editable && <button type="button" onClick={() => onCreate({ sprint_id: sprint.id })} className="w-full text-left px-4 py-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900 border-t border-slate-100"><Plus className="w-3.5 h-3.5 inline mr-1" />Add task</button>}
      </div>
    );
  };

  const backlogPoints = backlog.reduce((s, t) => s + (t.story_points || 0), 0);

  return (
    <div className="space-y-4 max-w-5xl">
      {active && renderSprint(active)}
      {planned.map(renderSprint)}
      {editable && <Button variant="outline" className="gap-1.5 bg-white" onClick={() => open('create')}><Plus className="w-4 h-4" /> Create sprint</Button>}

      <div className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${over === '__backlog' ? 'ring-2 ring-slate-400' : ''}`} {...dropZone(null)}>
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-50">
          <Inbox className="w-4 h-4" /><span className="font-semibold">Backlog</span>
          <span className="text-xs text-slate-500">{backlog.length} tasks · {backlogPoints} pts</span>
          {editable && <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1" onClick={() => onCreate({})}><Plus className="w-3.5 h-3.5" /> Add</Button>}
        </div>
        {backlog.map(t => <TaskRow key={t.id} task={t} project={project} onOpen={onOpen} draggable={editable} onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} />)}
        {backlog.length === 0 && <p className="text-xs text-slate-400 text-center py-5">The backlog is empty</p>}
      </div>

      {completed.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowCompleted(v => !v)} className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
            {showCompleted ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Completed sprints ({completed.length})
          </button>
          {showCompleted && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {completed.map(s => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-medium text-slate-800">{s.name}</span>
                  <span className="text-xs text-slate-500">{fmtDate(s.start_date, 'dd MMM')} → {fmtDate(s.end_date, 'dd MMM')}</span>
                  {s.stats && <span className="ml-auto text-xs text-slate-600">{s.stats.completed}/{s.stats.committed} {s.stats.unit} · {s.stats.carried_over} carried over</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{{ create: 'Create sprint', edit: 'Edit sprint', start: `Start ${dialog?.sprint?.name}`, complete: `Complete ${dialog?.sprint?.name}` }[dialog?.mode]}</DialogTitle>
          </DialogHeader>
          {dialog?.mode === 'complete' ? (
            <div className="space-y-3">
              {(() => {
                const list = inSprint(dialog.sprint.id);
                const open = list.filter(t => t.status_category !== 'done').length;
                return <p className="text-sm text-slate-600">{list.length - open} of {list.length} tasks are done. {open > 0 ? `Move the ${open} open task(s) to:` : 'All tasks are done — nice work!'}</p>;
              })()}
              <Select value={form.move_to} onValueChange={(v) => setForm({ move_to: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="backlog">Backlog</SelectItem>
                  {planned.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-3">
              <div><Label>Name</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder={`${project.key} Sprint ${sprints.length + 1}`} /></div>
              <div><Label>Sprint goal</Label><Textarea className="mt-1" rows={2} value={form.goal || ''} onChange={(e) => setForm(f => ({ ...f, goal: e.target.value }))} placeholder="What should this sprint achieve?" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start</Label><Input type="date" className="mt-1" value={form.start_date || ''} onChange={(e) => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                <div><Label>End</Label><Input type="date" className="mt-1" value={form.end_date || ''} onChange={(e) => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={submit}>{{ create: 'Create', edit: 'Save', start: 'Start sprint', complete: 'Complete sprint' }[dialog?.mode]}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
