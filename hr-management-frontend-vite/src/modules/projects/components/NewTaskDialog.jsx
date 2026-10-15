import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { API, PRIORITIES, PRIORITY_ORDER, TASK_TYPES, errorText } from '../lib';
import { usePeople } from '../hooks';
import { PersonSelect, StatusBadge } from './Shared';

const NONE = '__none';
const blankForm = (defaults) => ({
  title: '', description: '', type: 'task', priority: 'medium', assignee_email: '', status: '',
  start_date: '', due_date: '', estimate_hours: '', story_points: '', sprint_id: '', milestone_id: '', label_ids: [],
  ...defaults,
});

/**
 * Create a task in `project`. `defaults` pre-fills fields (e.g. status from a
 * board column, due date from a calendar day, sprint from the backlog).
 * `projects` (optional) lets the user pick the project (My Tasks / Home).
 */
export default function NewTaskDialog({ open, onOpenChange, project, projects, defaults, onCreated }) {
  const people = usePeople();
  const [projectId, setProjectId] = useState(project?.id || '');
  const [current, setCurrent] = useState(project || null);
  const [form, setForm] = useState(blankForm(defaults));
  const [extras, setExtras] = useState({ sprints: [], milestones: [] });
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(blankForm(defaults));
    setProjectId(project?.id || projects?.[0]?.id || '');
    setMore(false);
    // `defaults` is a fresh object each render of the parent; reset only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    let alive = true;
    const base = project?.id === projectId && project.statuses ? Promise.resolve({ data: project }) : api.get(`${API}/projects/${projectId}`);
    Promise.all([base, api.get(`${API}/projects/${projectId}/sprints`), api.get(`${API}/projects/${projectId}/milestones`)])
      .then(([p, s, m]) => {
        if (!alive) return;
        setCurrent(p.data);
        setExtras({ sprints: s.data.filter(x => x.status !== 'completed'), milestones: m.data.filter(x => x.status === 'open') });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, projectId, project]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const members = current ? [current.lead_email, ...(current.members || []).filter(m => m.role !== 'viewer').map(m => m.email)] : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !projectId) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        description: form.description,
        type: form.type,
        priority: form.priority,
        assignee_email: form.assignee_email || null,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        estimate_hours: form.estimate_hours === '' ? null : Number(form.estimate_hours),
        story_points: form.story_points === '' ? null : Number(form.story_points),
        sprint_id: form.sprint_id || null,
        milestone_id: form.milestone_id || null,
        label_ids: form.label_ids,
        ...(form.parent_id ? { parent_id: form.parent_id } : {}),
        ...(form.status ? { status: form.status } : {}),
      };
      const r = await api.post(`${API}/projects/${projectId}/tasks`, body);
      toast.success(`${r.data.key} created`);
      (r.data.warnings || []).forEach(w => toast.warning(w, { duration: 7000 }));
      onCreated?.(r.data);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, 'Failed to create task'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New task{current ? ` in ${current.key}` : ''}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {projects && (
            <div>
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a project" /></SelectTrigger>
                <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.key} · {p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" data-testid="new-task-title" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="What needs to be done?" className="mt-1" required maxLength={250} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(TASK_TYPES).filter(([k]) => k !== 'subtask').map(([k, T]) => { const I = T.icon; return <SelectItem key={k} value={k}><span className="flex items-center gap-2"><I className={`w-4 h-4 ${T.cls}`} />{T.label}</span></SelectItem>; })}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set('priority', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITY_ORDER.map(p => { const P = PRIORITIES[p]; const I = P.icon; return <SelectItem key={p} value={p}><span className="flex items-center gap-2"><I className={`w-4 h-4 ${P.cls}`} />{P.label}</span></SelectItem>; })}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assignee</Label>
              <PersonSelect people={people} value={form.assignee_email} onChange={(v) => set('assignee_email', v)} restrictTo={current?.my_role === 'admin' ? null : members} className="mt-1" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status || NONE} onValueChange={(v) => set('status', v === NONE ? '' : v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Default</SelectItem>
                  {(current?.statuses || []).map(s => <SelectItem key={s.key} value={s.key}><StatusBadge label={s.label} color={s.color} /></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due date</Label>
              <Input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Estimate (hours)</Label>
              <Input type="number" min="0" step="0.5" value={form.estimate_hours} onChange={(e) => set('estimate_hours', e.target.value)} className="mt-1" />
            </div>
          </div>

          {!more ? (
            <button type="button" onClick={() => setMore(true)} className="text-xs font-medium text-slate-500 hover:text-slate-900">+ More fields (description, start date, points, sprint, milestone, labels)</button>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Description</Label>
                <Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} className="mt-1" placeholder="Details, acceptance criteria, links…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start date</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Story points</Label>
                  <Input type="number" min="0" value={form.story_points} onChange={(e) => set('story_points', e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Sprint</Label>
                  <Select value={form.sprint_id || NONE} onValueChange={(v) => set('sprint_id', v === NONE ? '' : v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Backlog</SelectItem>
                      {extras.sprints.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Milestone</Label>
                  <Select value={form.milestone_id || NONE} onValueChange={(v) => set('milestone_id', v === NONE ? '' : v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {extras.milestones.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(current?.labels || []).length > 0 && (
                <div>
                  <Label>Labels</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {current.labels.map(l => {
                      const on = form.label_ids.includes(l.id);
                      return (
                        <button key={l.id} type="button" onClick={() => set('label_ids', on ? form.label_ids.filter(x => x !== l.id) : [...form.label_ids, l.id])}
                          className={`rounded px-2 py-0.5 text-xs font-medium border ${on ? '' : 'opacity-50 hover:opacity-100'}`}
                          style={{ backgroundColor: on ? `${l.color}22` : 'transparent', color: l.color, borderColor: `${l.color}55` }}>
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.title.trim() || !projectId} data-testid="new-task-submit">
              {saving ? 'Creating…' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
