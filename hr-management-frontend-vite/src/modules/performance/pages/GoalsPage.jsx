import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Plus, Send, Pencil, Trash2, TrendingUp, CheckCircle2, Undo2, Building2, CalendarRange, History, Link2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import {
  PF, useApi, apiError, currentUser, isLead, fmtDate, defaultCycleId,
  GOAL_STATUS, APPROVAL_STATUS, CYCLE_STATUS,
} from '../lib';
import {
  PageShell, SectionCard, DataState, EmptyState, Pill, ExportButton, StatTile, ProgressBar,
  PersonSelect, SimpleSelect, DataTable,
} from '../components/common';
import CycleSelect from '../components/CycleSelect';

const TYPE_OPTIONS = ['OKR', 'KRA', 'KPI'].map(t => ({ value: t, label: t }));
const STATUS_OPTIONS = Object.entries(GOAL_STATUS).map(([value, s]) => ({ value, label: s.label }));
const NO_PARENT = '__none__';

const goalCsv = (rows, name) => exportCsv(name, rows, [
  { key: 'employee_name', label: 'Owner' },
  { key: 'cycle_name', label: 'Cycle' },
  { key: 'title', label: 'Goal' },
  { key: 'type', label: 'Type' },
  { key: 'weightage', label: 'Weightage %' },
  { key: 'progress', label: 'Progress %' },
  { label: 'Status', value: r => GOAL_STATUS[r.status]?.label },
  { label: 'Approval', value: r => APPROVAL_STATUS[r.approval_status]?.label },
  { key: 'parent_goal_title', label: 'Aligned to' },
  { label: 'Key results', value: r => (r.key_results || []).map(k => `${k.title}: ${k.current_value}/${k.target_value}${k.unit ? ` ${k.unit}` : ''}`).join('; ') },
]);

// ---------------------------------------------------------------- dialogs

function GoalForm({ cycleId, goal, mode, team, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    employee_email: goal?.employee_email || '',
    title: goal?.title || '',
    description: goal?.description || '',
    type: goal?.type || 'OKR',
    weightage: goal?.weightage ?? (mode === 'company' ? 0 : ''),
    due_date: goal?.due_date || '',
    parent_goal_id: goal?.parent_goal_id || NO_PARENT,
    key_results: (goal?.key_results || []).map(k => ({ ...k })),
  }));
  const [saving, setSaving] = useState(false);
  const owner = mode === 'assign' ? form.employee_email : goal?.employee_email;
  const parents = useApi(mode === 'company' ? null : `${PF}/goals/parent-options`, { cycle_id: cycleId, ...(owner ? { employee_email: owner } : {}) });
  const parentOptions = [{ value: NO_PARENT, label: 'Not aligned' }, ...(parents.data || [])
    .filter(p => p.id !== goal?.id)
    .map(p => ({ value: p.id, label: `${p.is_company_goal ? 'Company' : p.employee_name}: ${p.title}` }))];

  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  const setKr = (i, patch) => set({ key_results: form.key_results.map((k, idx) => (idx === i ? { ...k, ...patch } : k)) });

  const save = async () => {
    if (!form.title.trim()) return toast.error('Give the goal a title');
    if (mode === 'assign' && !goal && !form.employee_email) return toast.error('Choose a team member');
    for (const k of form.key_results) {
      if (!k.title?.trim() || k.target_value === '' || k.target_value == null) return toast.error('Each key result needs a title and a target');
    }
    const body = {
      title: form.title.trim(),
      description: form.description,
      type: form.type,
      due_date: form.due_date || null,
      key_results: form.key_results.map(k => ({
        ...(k.id ? { id: k.id } : {}),
        title: k.title.trim(),
        start_value: Number(k.start_value) || 0,
        target_value: Number(k.target_value),
        ...(k.current_value !== '' && k.current_value != null ? { current_value: Number(k.current_value) } : {}),
        unit: k.unit || '',
      })),
    };
    if (mode !== 'company') {
      body.weightage = Number(form.weightage) || 0;
      body.parent_goal_id = form.parent_goal_id === NO_PARENT ? null : form.parent_goal_id;
    }
    setSaving(true);
    try {
      if (goal) await api.put(`${PF}/goals/${goal.id}`, body);
      else {
        await api.post(`${PF}/goals`, {
          ...body,
          cycle_id: cycleId,
          ...(mode === 'assign' ? { employee_email: form.employee_email } : {}),
          ...(mode === 'company' ? { is_company_goal: true } : {}),
        });
      }
      toast.success(goal ? 'Goal updated' : mode === 'assign' ? 'Goal assigned' : 'Goal added');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save goal'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{goal ? 'Edit goal' : mode === 'assign' ? 'Assign a goal' : mode === 'company' ? 'New company goal' : 'New goal'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {mode === 'assign' && !goal && (
          <div className="space-y-1.5">
            <Label>Team member</Label>
            <PersonSelect people={team} value={form.employee_email} onChange={(v) => set({ employee_email: v, parent_goal_id: NO_PARENT })} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="g-title">Title</Label>
          <Input id="g-title" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Improve checkout conversion" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-desc">Description</Label>
          <Textarea id="g-desc" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <SimpleSelect value={form.type} onChange={(v) => set({ type: v })} options={TYPE_OPTIONS} />
          </div>
          {mode !== 'company' && (
            <div className="space-y-1.5">
              <Label htmlFor="g-weight">Weightage %</Label>
              <Input id="g-weight" type="number" min="0" max="100" value={form.weightage} onChange={(e) => set({ weightage: e.target.value })} />
            </div>
          )}
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label htmlFor="g-due">Due date</Label>
            <Input id="g-due" type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
          </div>
        </div>
        {mode !== 'company' && (
          <div className="space-y-1.5">
            <Label>Aligned to (cascading)</Label>
            <SimpleSelect value={form.parent_goal_id} onChange={(v) => set({ parent_goal_id: v })} options={parentOptions} />
            <p className="text-xs text-slate-500">Link to a company goal or one of the manager&apos;s goals.</p>
          </div>
        )}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Key results</Label>
            <Button type="button" variant="outline" size="sm" onClick={() => set({ key_results: [...form.key_results, { title: '', start_value: 0, target_value: '', current_value: '', unit: '' }] })}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
          {form.key_results.length === 0 && <p className="text-xs text-slate-500">No key results: progress will be updated manually in check-ins.</p>}
          {form.key_results.map((k, i) => (
            <div key={k.id || i} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="flex gap-2">
                <Input value={k.title} onChange={(e) => setKr(i, { title: e.target.value })} placeholder="Key result" />
                <Button type="button" variant="ghost" size="icon" onClick={() => set({ key_results: form.key_results.filter((_, idx) => idx !== i) })} aria-label="Remove key result">
                  <Trash2 className="w-4 h-4 text-rose-500" />
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Input type="number" value={k.start_value} onChange={(e) => setKr(i, { start_value: e.target.value })} placeholder="Start" aria-label="Start value" />
                <Input type="number" value={k.target_value} onChange={(e) => setKr(i, { target_value: e.target.value })} placeholder="Target" aria-label="Target value" />
                <Input type="number" value={k.current_value ?? ''} onChange={(e) => setKr(i, { current_value: e.target.value })} placeholder="Current" aria-label="Current value" />
                <Input value={k.unit || ''} onChange={(e) => setKr(i, { unit: e.target.value })} placeholder="Unit (%, ₹, ms)" aria-label="Unit" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </>
  );
}

function CheckInForm({ goal, onClose, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries((goal.key_results || []).map(k => [k.id, k.current_value])));
  const [progress, setProgress] = useState(goal.progress ?? 0);
  const [status, setStatus] = useState(goal.status);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const hasKrs = goal.key_results?.length > 0;

  const save = async () => {
    const body = { status, note };
    if (hasKrs) {
      body.key_results = goal.key_results
        .filter(k => values[k.id] !== '' && Number(values[k.id]) !== Number(k.current_value))
        .map(k => ({ id: k.id, current_value: Number(values[k.id]) }));
    } else {
      body.progress = Number(progress);
    }
    setSaving(true);
    try {
      await api.post(`${PF}/goals/${goal.id}/check-ins`, body);
      toast.success('Progress recorded');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to record progress'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader><DialogTitle>Check-in: {goal.title}</DialogTitle></DialogHeader>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {hasKrs ? goal.key_results.map(k => (
          <div key={k.id} className="space-y-1.5">
            <Label>{k.title} <span className="text-slate-400 font-normal">(start {k.start_value}, target {k.target_value}{k.unit ? ` ${k.unit}` : ''})</span></Label>
            <Input type="number" value={values[k.id] ?? ''} onChange={(e) => setValues(v => ({ ...v, [k.id]: e.target.value }))} />
          </div>
        )) : (
          <div className="space-y-1.5">
            <Label htmlFor="ci-progress">Progress %</Label>
            <Input id="ci-progress" type="number" min="0" max="100" value={progress} onChange={(e) => setProgress(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Status</Label>
          <SimpleSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ci-note">Note</Label>
          <Textarea id="ci-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What moved since last time? Any blockers?" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Record check-in'}</Button>
      </DialogFooter>
    </>
  );
}

function SendBackForm({ target, onClose, onSaved }) {
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!comments.trim()) return toast.error('Explain what should change');
    setSaving(true);
    try {
      if (target.goal) await api.post(`${PF}/goals/${target.goal.id}/review`, { action: 'send_back', comments });
      else await api.post(`${PF}/goals/review`, { cycle_id: target.cycle_id, employee_email: target.employee_email, action: 'send_back', comments });
      toast.success('Sent back for changes');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to send back'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>Send back {target.goal ? `"${target.goal.title}"` : `${target.name}'s goals`}</DialogTitle></DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="sb-comments">Comments</Label>
        <Textarea id="sb-comments" rows={4} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="What needs to change?" />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">Send back</Button>
      </DialogFooter>
    </>
  );
}

function CycleForm({ cycle, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: cycle?.name || '',
    description: cycle?.description || '',
    period_start: cycle?.period_start || '',
    period_end: cycle?.period_end || '',
    goal_deadline: cycle?.goal_deadline || '',
    status: cycle?.status || 'draft',
  }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.name.trim() || !form.period_start || !form.period_end) return toast.error('Name and period are required');
    setSaving(true);
    try {
      const body = { ...form, goal_deadline: form.goal_deadline || null };
      if (cycle) await api.put(`${PF}/cycles/${cycle.id}`, body);
      else await api.post(`${PF}/cycles`, body);
      toast.success('Review cycle saved');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save cycle'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>{cycle ? 'Edit review cycle' : 'New review cycle'}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-name">Name</Label>
          <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. FY 2026 H2" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-desc">Description</Label>
          <Textarea id="c-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="c-start">Period start</Label>
            <Input id="c-start" type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-end">Period end</Label>
            <Input id="c-end" type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-deadline">Goal-setting deadline</Label>
            <Input id="c-deadline" type="date" value={form.goal_deadline} onChange={(e) => setForm({ ...form, goal_deadline: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <SimpleSelect value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={Object.entries(CYCLE_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------- goal card

function GoalCard({ goal, canEdit, canCheckIn, canReview, showOwner, onEdit, onDelete, onCheckIn, onApprove, onSendBack }) {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="p-3 sm:p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Pill tone="purple">{goal.type}</Pill>
            {!goal.is_company_goal && <Pill tone="blue">{goal.weightage}%</Pill>}
            <Pill map={GOAL_STATUS} value={goal.status} />
            {!goal.is_company_goal && <Pill map={APPROVAL_STATUS} value={goal.approval_status} />}
          </div>
          <p className="font-semibold text-slate-900">{goal.title}</p>
          {showOwner && <p className="text-xs text-slate-500">{goal.employee_name}</p>}
          {goal.description && <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{goal.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
            {goal.parent_goal_title && <span className="flex items-center gap-1"><Link2 className="w-3 h-3" /> {goal.parent_goal_title}</span>}
            {goal.due_date && <span>Due {fmtDate(goal.due_date)}</span>}
            {goal.assigned_by && <span>Assigned by {goal.assigned_by.name}</span>}
          </div>
        </div>
        <div className="sm:w-44 shrink-0"><ProgressBar value={goal.progress} /></div>
      </div>

      {goal.approval_status === 'sent_back' && goal.approval_comments && (
        <div className="text-sm rounded-lg bg-rose-50 text-rose-800 px-3 py-2"><strong>Manager:</strong> {goal.approval_comments}</div>
      )}

      {goal.key_results?.length > 0 && (
        <div className="space-y-1.5">
          {goal.key_results.map(k => (
            <div key={k.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm">
              <span className="text-slate-700 flex-1 min-w-0 truncate">{k.title}</span>
              <span className="text-xs text-slate-500 tabular-nums">{k.current_value} / {k.target_value}{k.unit ? ` ${k.unit}` : ''}</span>
              <div className="sm:w-40"><ProgressBar value={k.progress} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canCheckIn && <Button size="sm" variant="outline" onClick={onCheckIn}><TrendingUp className="w-3.5 h-3.5 mr-1" /> Check-in</Button>}
        {canReview && goal.approval_status === 'submitted' && (
          <>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={onApprove}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve</Button>
            <Button size="sm" variant="outline" onClick={onSendBack}><Undo2 className="w-3.5 h-3.5 mr-1" /> Send back</Button>
          </>
        )}
        {canEdit && <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>}
        {canEdit && <Button size="sm" variant="ghost" className="text-rose-600" onClick={onDelete}><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete</Button>}
        {goal.check_ins?.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowHistory(s => !s)}>
            <History className="w-3.5 h-3.5 mr-1" /> {showHistory ? 'Hide' : 'History'} ({goal.check_ins.length})
          </Button>
        )}
      </div>

      {showHistory && (
        <ol className="border-l-2 border-slate-200 ml-1 space-y-2">
          {[...goal.check_ins].reverse().map(c => (
            <li key={c.id} className="pl-3 text-sm">
              <p className="text-xs text-slate-500">{fmtDate(c.at)} · {c.by_name}</p>
              <p className="text-slate-700">
                {c.previous_progress != null && <span className="tabular-nums">{Math.round(c.previous_progress)}% → </span>}
                <span className="font-medium tabular-nums">{Math.round(c.progress)}%</span> · {GOAL_STATUS[c.status]?.label}
              </p>
              {c.note && <p className="text-slate-600">{c.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page

const GoalsPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'my';
  const setTab = (t) => setParams(p => { p.set('tab', t); return p; }, { replace: true });

  const cycles = useApi(`${PF}/cycles`);
  const [picked, setPicked] = useState('');
  const cycleId = picked || defaultCycleId(cycles.data);
  const cycle = cycles.data?.find(c => c.id === cycleId);

  const myGoals = useApi(cycleId ? `${PF}/goals` : null, { scope: 'my', cycle_id: cycleId });
  const teamGoals = useApi(cycleId && lead ? `${PF}/goals` : null, { scope: 'team', cycle_id: cycleId });
  const companyGoals = useApi(cycleId ? `${PF}/goals` : null, { scope: 'company', cycle_id: cycleId });
  const team = useApi(lead ? `${PF}/people` : null, { scope: 'team' });

  const [dialog, setDialog] = useState(null); // { kind, ... }
  const close = () => setDialog(null);
  const reloadAll = () => { myGoals.reload(); teamGoals.reload(); companyGoals.reload(); cycles.reload(); };

  const mine = useMemo(() => myGoals.data || [], [myGoals.data]);
  const totalWeight = mine.reduce((s, g) => s + (Number(g.weightage) || 0), 0);
  const drafts = mine.filter(g => ['draft', 'sent_back'].includes(g.approval_status));
  const avgProgress = mine.length ? Math.round(mine.reduce((s, g) => s + (g.progress || 0) * (g.weightage || 0), 0) / (totalWeight || 1)) : 0;
  const cycleOpen = cycle && cycle.status === 'active';
  const cycleEditable = cycle && cycle.status !== 'closed';

  const teamGroups = useMemo(() => {
    const groups = {};
    for (const g of teamGoals.data || []) {
      groups[g.employee_email] = groups[g.employee_email] || { email: g.employee_email, name: g.employee_name, goals: [] };
      groups[g.employee_email].goals.push(g);
    }
    return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
  }, [teamGoals.data]);

  const submitGoals = async () => {
    try {
      const r = await api.post(`${PF}/goals/submit`, { cycle_id: cycleId });
      toast.success(`${r.data.submitted} goal(s) submitted for approval`);
      reloadAll();
    } catch (error) {
      toast.error(apiError(error, 'Failed to submit goals'));
    }
  };

  const deleteGoal = async (goal) => {
    if (!window.confirm(`Delete "${goal.title}"?`)) return;
    try {
      await api.delete(`${PF}/goals/${goal.id}`);
      toast.success('Goal deleted');
      reloadAll();
    } catch (error) {
      toast.error(apiError(error, 'Failed to delete goal'));
    }
  };

  const approve = async (goal, group) => {
    try {
      if (goal) await api.post(`${PF}/goals/${goal.id}/review`, { action: 'approve' });
      else await api.post(`${PF}/goals/review`, { cycle_id: cycleId, employee_email: group.email, action: 'approve' });
      toast.success('Approved');
      reloadAll();
    } catch (error) {
      toast.error(apiError(error, 'Failed to approve'));
    }
  };

  const deleteCycle = async (c) => {
    if (!window.confirm(`Delete review cycle "${c.name}"?`)) return;
    try {
      await api.delete(`${PF}/cycles/${c.id}`);
      toast.success('Cycle deleted');
      setPicked('');
      cycles.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to delete cycle'));
    }
  };

  const noCycles = !cycles.loading && !cycles.error && !(cycles.data || []).length;

  return (
    <PageShell
      icon={Target}
      title="Goals & OKRs"
      subtitle={cycle ? `${cycle.name} · ${fmtDate(cycle.period_start)} – ${fmtDate(cycle.period_end)}${cycle.goal_deadline ? ` · goals due ${fmtDate(cycle.goal_deadline)}` : ''}` : 'Set goals, track key results and align with the company'}
      actions={<CycleSelect cycles={cycles.data || []} value={cycleId} onChange={setPicked} />}
    >
      {cycles.error && <SectionCard><DataState state={cycles} /></SectionCard>}
      {noCycles && tab !== 'cycles' && (
        <SectionCard>
          <EmptyState icon={CalendarRange} text={isAdmin ? 'No review cycles yet. Create one to start goal setting.' : 'No active review cycle yet. Your admin will open one soon.'}>
            {isAdmin && <Button size="sm" onClick={() => setTab('cycles')}>Manage cycles</Button>}
          </EmptyState>
        </SectionCard>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
          <TabsTrigger value="my">My goals</TabsTrigger>
          {lead && <TabsTrigger value="team">Team goals</TabsTrigger>}
          <TabsTrigger value="company">Company goals</TabsTrigger>
          {isAdmin && <TabsTrigger value="cycles">Review cycles</TabsTrigger>}
        </TabsList>

        <TabsContent value="my" className="space-y-4">
          {cycleId && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
                <StatTile label="Goals" value={mine.length} icon={Target} />
                <StatTile label="Total weightage" value={`${totalWeight}%`} icon={CheckCircle2} tone={totalWeight === 100 ? 'emerald' : 'amber'} />
                <StatTile label="Weighted progress" value={`${avgProgress}%`} icon={TrendingUp} tone="blue" />
                <StatTile label="Awaiting approval" value={mine.filter(g => g.approval_status === 'submitted').length} icon={Send} tone="purple" />
              </div>
              <SectionCard
                icon={Target}
                title="My goals"
                actions={(
                  <>
                    <ExportButton onClick={() => goalCsv(mine, 'my-goals')} disabled={!mine.length} />
                    {cycleOpen && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'goal', mode: 'self' })}><Plus className="w-4 h-4 mr-1" /> Add goal</Button>}
                    {cycleOpen && drafts.length > 0 && (
                      <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={submitGoals} disabled={totalWeight !== 100} title={totalWeight !== 100 ? 'Weightages must total 100%' : undefined}>
                        <Send className="w-4 h-4 mr-1" /> Submit ({drafts.length})
                      </Button>
                    )}
                  </>
                )}
              >
                {drafts.length > 0 && totalWeight !== 100 && (
                  <p className="text-xs text-amber-700 bg-amber-50 px-4 py-2">Weightages total {totalWeight}% — adjust them to exactly 100% before submitting.</p>
                )}
                <DataState state={myGoals} empty={!mine.length} emptyText="No goals in this cycle yet" emptyIcon={Target}>
                  <div className="divide-y divide-slate-100">
                    {mine.map(g => (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        canEdit={cycleEditable && ['draft', 'sent_back'].includes(g.approval_status)}
                        canCheckIn={cycleOpen && g.approval_status === 'approved'}
                        onEdit={() => setDialog({ kind: 'goal', mode: 'self', goal: g })}
                        onDelete={() => deleteGoal(g)}
                        onCheckIn={() => setDialog({ kind: 'checkin', goal: g })}
                      />
                    ))}
                  </div>
                </DataState>
              </SectionCard>
            </>
          )}
        </TabsContent>

        {lead && (
          <TabsContent value="team" className="space-y-4">
            <SectionCard
              icon={Users}
              title="Team goals"
              actions={(
                <>
                  <ExportButton onClick={() => goalCsv(teamGoals.data || [], 'team-goals')} disabled={!teamGoals.data?.length} />
                  {cycleOpen && <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={() => setDialog({ kind: 'goal', mode: 'assign' })}><Plus className="w-4 h-4 mr-1" /> Assign goal</Button>}
                </>
              )}
            >
              <DataState state={teamGoals} empty={!teamGroups.length} emptyText="Your team has no goals in this cycle yet" emptyIcon={Users}>
                <div className="divide-y divide-slate-200">
                  {teamGroups.map(group => {
                    const weight = group.goals.reduce((s, g) => s + (Number(g.weightage) || 0), 0);
                    const pending = group.goals.filter(g => g.approval_status === 'submitted').length;
                    return (
                      <div key={group.email}>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-3 bg-slate-50">
                          <div>
                            <p className="font-semibold text-slate-900">{group.name}</p>
                            <p className="text-xs text-slate-500">{group.goals.length} goal(s) · {weight}% weightage</p>
                          </div>
                          {pending > 0 && (
                            <div className="flex gap-2">
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approve(null, group)}>Approve all ({pending})</Button>
                              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'sendback', target: { cycle_id: cycleId, employee_email: group.email, name: group.name } })}>Send back</Button>
                            </div>
                          )}
                        </div>
                        <div className="divide-y divide-slate-100">
                          {group.goals.map(g => (
                            <GoalCard
                              key={g.id}
                              goal={g}
                              canEdit={cycleEditable}
                              canCheckIn={cycleOpen && g.approval_status === 'approved'}
                              canReview
                              onEdit={() => setDialog({ kind: 'goal', mode: 'assign', goal: g })}
                              onDelete={() => deleteGoal(g)}
                              onCheckIn={() => setDialog({ kind: 'checkin', goal: g })}
                              onApprove={() => approve(g)}
                              onSendBack={() => setDialog({ kind: 'sendback', target: { goal: g } })}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </DataState>
            </SectionCard>
          </TabsContent>
        )}

        <TabsContent value="company" className="space-y-4">
          <SectionCard
            icon={Building2}
            title="Company goals"
            actions={(
              <>
                <ExportButton onClick={() => goalCsv(companyGoals.data || [], 'company-goals')} disabled={!companyGoals.data?.length} />
                {isAdmin && cycleEditable && <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={() => setDialog({ kind: 'goal', mode: 'company' })}><Plus className="w-4 h-4 mr-1" /> New company goal</Button>}
              </>
            )}
          >
            <DataState state={companyGoals} empty={!companyGoals.data?.length} emptyText="No company goals for this cycle" emptyIcon={Building2}>
              <div className="divide-y divide-slate-100">
                {(companyGoals.data || []).map(g => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    canEdit={isAdmin && cycleEditable}
                    canCheckIn={isAdmin && cycleOpen}
                    onEdit={() => setDialog({ kind: 'goal', mode: 'company', goal: g })}
                    onDelete={() => deleteGoal(g)}
                    onCheckIn={() => setDialog({ kind: 'checkin', goal: g })}
                  />
                ))}
              </div>
            </DataState>
          </SectionCard>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="cycles" className="space-y-4">
            <SectionCard
              icon={CalendarRange}
              title="Review cycles"
              actions={(
                <>
                  <ExportButton onClick={() => exportCsv('review-cycles', cycles.data || [], [
                    { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'period_start', label: 'Start' },
                    { key: 'period_end', label: 'End' }, { key: 'goal_deadline', label: 'Goal deadline' },
                    { key: 'goal_count', label: 'Goals' }, { key: 'employee_count', label: 'Employees with goals' },
                  ])} disabled={!cycles.data?.length} />
                  <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={() => setDialog({ kind: 'cycle' })}><Plus className="w-4 h-4 mr-1" /> New cycle</Button>
                </>
              )}
            >
              <DataState state={cycles} empty={!cycles.data?.length} emptyText="No review cycles yet" emptyIcon={CalendarRange}>
                <DataTable
                  rows={cycles.data || []}
                  columns={[
                    { key: 'name', label: 'Cycle', render: c => <span className="font-medium text-slate-900">{c.name}</span> },
                    { key: 'period', label: 'Period', render: c => <span className="whitespace-nowrap">{fmtDate(c.period_start)} – {fmtDate(c.period_end)}</span> },
                    { key: 'goal_deadline', label: 'Goal deadline', hideOnMobile: true, render: c => fmtDate(c.goal_deadline) },
                    { key: 'goal_count', label: 'Goals', hideOnMobile: true, render: c => `${c.goal_count} (${c.employee_count} people)` },
                    { key: 'status', label: 'Status', render: c => <Pill map={CYCLE_STATUS} value={c.status} /> },
                    {
                      key: 'actions', label: '', className: 'text-right', render: c => (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'cycle', cycle: c })}><Pencil className="w-3.5 h-3.5" /></Button>
                          {!c.goal_count && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => deleteCycle(c)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                        </div>
                      ),
                    },
                  ]}
                />
              </DataState>
            </SectionCard>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-xl">
          {dialog?.kind === 'goal' && (
            <GoalForm key={dialog.goal?.id || 'new'} cycleId={cycleId} goal={dialog.goal} mode={dialog.mode} team={team.data?.people || []} onClose={close} onSaved={reloadAll} />
          )}
          {dialog?.kind === 'checkin' && <CheckInForm goal={dialog.goal} onClose={close} onSaved={reloadAll} />}
          {dialog?.kind === 'sendback' && <SendBackForm target={dialog.target} onClose={close} onSaved={reloadAll} />}
          {dialog?.kind === 'cycle' && <CycleForm cycle={dialog.cycle} onClose={close} onSaved={reloadAll} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default GoalsPage;
