import React, { useState } from 'react';
import { Diamond, Plus, Pencil, Trash2, CheckCircle2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import api from '@/lib/api';
import { API, errorText, fmtDate, todayStr, statusMeta } from '../../lib';
import { Empty, StatusBadge, Avatar } from '../../components/Shared';

/** Milestones with progress from their linked tasks. */
export default function MilestonesTab({ project, milestones, tasks, editable, onOpen, onChanged }) {
  const [editing, setEditing] = useState(null); // milestone or {} for new
  const [expanded, setExpanded] = useState(new Set());
  const today = todayStr();

  const save = async () => {
    try {
      const body = { name: editing.name, description: editing.description, due_date: editing.due_date || null };
      if (editing.id) await api.put(`${API}/milestones/${editing.id}`, body);
      else await api.post(`${API}/projects/${project.id}/milestones`, body);
      setEditing(null);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Failed to save milestone'));
    }
  };

  const setStatus = async (m, status) => {
    try {
      await api.put(`${API}/milestones/${m.id}`, { status });
      if (status === 'done') toast.success(`🎉 ${m.name} reached`);
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (m) => {
    try {
      await api.delete(`${API}/milestones/${m.id}`);
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const toggle = (id) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4 max-w-4xl">
      {editable && <Button className="gap-1.5" onClick={() => setEditing({ name: '', description: '', due_date: '' })}><Plus className="w-4 h-4" /> New milestone</Button>}
      {milestones.length === 0 ? <Empty icon={Diamond} title="No milestones yet">Milestones mark key dates — releases, launches, deliverables. Link tasks to them to track progress.</Empty> : (
        <div className="space-y-3">
          {milestones.map(m => {
            const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
            const late = m.status !== 'done' && m.due_date && m.due_date < today;
            const linked = tasks.filter(t => t.milestone_id === m.id);
            return (
              <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <Diamond className={`w-5 h-5 mt-0.5 ${m.status === 'done' ? 'fill-emerald-500 text-emerald-600' : late ? 'fill-red-400 text-red-500' : 'fill-purple-500 text-purple-600'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold ${m.status === 'done' ? 'text-slate-500' : 'text-slate-900'}`}>{m.name}</p>
                    <p className={`text-xs ${late ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {m.due_date ? `Due ${fmtDate(m.due_date)}` : 'No due date'}{late ? ' · overdue' : ''}{m.status === 'done' ? ` · reached ${fmtDate(m.completed_at)}` : ''}
                    </p>
                    {m.description && <p className="text-sm text-slate-600 mt-1">{m.description}</p>}
                  </div>
                  {editable && (
                    <div className="flex gap-1">
                      {m.status === 'done'
                        ? <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setStatus(m, 'open')}><RotateCcw className="w-3.5 h-3.5" /> Reopen</Button>
                        : <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setStatus(m, 'done')}><CheckCircle2 className="w-3.5 h-3.5" /> Mark reached</Button>}
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing({ ...m, due_date: m.due_date || '' })}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-red-600 hover:bg-red-50" onClick={() => remove(m)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Progress value={pct} className="h-2 flex-1" />
                  <span className="text-xs text-slate-600 w-28 text-right">{m.done}/{m.total} tasks · {pct}%</span>
                </div>
                {linked.length > 0 && (
                  <>
                    <button type="button" onClick={() => toggle(m.id)} className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
                      {expanded.has(m.id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Tasks
                    </button>
                    {expanded.has(m.id) && (
                      <div className="mt-1 rounded-lg border border-slate-100 divide-y divide-slate-100">
                        {linked.map(t => {
                          const s = statusMeta(project, t.status);
                          return (
                            <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                              <span className="text-xs text-slate-500 w-16">{t.key}</span>
                              <span className={`flex-1 truncate ${t.status_category === 'done' ? 'line-through text-slate-400' : ''}`}>{t.title}</span>
                              <StatusBadge label={s.label} color={s.color} />
                              <Avatar name={t.assignee_name} size="xs" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit milestone' : 'New milestone'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Name</Label><Input className="mt-1" autoFocus value={editing.name} onChange={(e) => setEditing(m => ({ ...m, name: e.target.value }))} placeholder="Public beta" /></div>
              <div><Label>Due date</Label><Input type="date" className="mt-1" value={editing.due_date} onChange={(e) => setEditing(m => ({ ...m, due_date: e.target.value }))} /></div>
              <div><Label>Description</Label><Textarea className="mt-1" rows={3} value={editing.description} onChange={(e) => setEditing(m => ({ ...m, description: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={!editing?.name?.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
