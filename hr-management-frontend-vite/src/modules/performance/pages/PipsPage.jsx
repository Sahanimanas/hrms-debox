import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy, Plus, Trash2, ClipboardList, MessageSquare, Flag, CheckCircle2, Pencil, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PF, useApi, apiError, currentUser, isLead, fmtDate, todayStr, OBJECTIVE_STATUS, PIP_OUTCOME } from '../lib';
import { PageShell, SectionCard, DataState, Pill, ExportButton, PersonSelect, SimpleSelect, DataTable, LoadingState, ErrorState } from '../components/common';

const OBJ_OPTIONS = Object.entries(OBJECTIVE_STATUS).map(([value, s]) => ({ value, label: s.label }));

function PipForm({ pip, team, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    employee_email: pip?.employee_email || '',
    start_date: pip?.start_date || todayStr(),
    end_date: pip?.end_date || '',
    reason: pip?.reason || '',
    support: pip?.support || '',
    check_in_frequency_days: pip?.check_in_frequency_days || 7,
    objectives: pip?.objectives?.map(o => ({ ...o })) || [{ title: '', success_criteria: '' }],
  }));
  const [saving, setSaving] = useState(false);
  const setObj = (i, patch) => setForm(f => ({ ...f, objectives: f.objectives.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) }));
  const save = async () => {
    if (!pip && !form.employee_email) return toast.error('Choose the employee');
    if (!form.end_date || form.end_date <= form.start_date) return toast.error('End date must be after the start date');
    if (form.reason.trim().length < 5) return toast.error('Describe the reason for the plan');
    if (!form.objectives.length || form.objectives.some(o => o.title.trim().length < 2 || o.success_criteria.trim().length < 2)) {
      return toast.error('Every objective needs a title and measurable success criteria');
    }
    const body = {
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason.trim(),
      support: form.support,
      check_in_frequency_days: Number(form.check_in_frequency_days) || 7,
      objectives: form.objectives.map(o => ({ ...(o.id ? { id: o.id } : {}), title: o.title.trim(), success_criteria: o.success_criteria.trim() })),
    };
    setSaving(true);
    try {
      const r = pip ? await api.put(`${PF}/pips/${pip.id}`, body) : await api.post(`${PF}/pips`, { ...body, employee_email: form.employee_email });
      toast.success(pip ? 'PIP updated' : 'PIP created — the employee has been notified');
      onSaved(r.data);
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save PIP'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>{pip ? 'Edit improvement plan' : 'New performance improvement plan'}</DialogTitle></DialogHeader>
      <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
        {!pip && <div className="space-y-1.5"><Label>Employee</Label><PersonSelect people={team} value={form.employee_email} onChange={(v) => setForm({ ...form, employee_email: v })} /></div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label htmlFor="p-start">Start</Label><Input id="p-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="p-end">End</Label><Input id="p-end" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label htmlFor="p-freq">Check-in every (days)</Label><Input id="p-freq" type="number" min="1" max="60" value={form.check_in_frequency_days} onChange={(e) => setForm({ ...form, check_in_frequency_days: e.target.value })} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="p-reason">Reason</Label><Textarea id="p-reason" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Objectives</Label>
            <Button size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, objectives: [...f.objectives, { title: '', success_criteria: '' }] }))}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
          </div>
          {form.objectives.map((o, i) => (
            <div key={o.id || i} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="flex gap-2">
                <Input value={o.title} onChange={(e) => setObj(i, { title: e.target.value })} placeholder="Objective" />
                {form.objectives.length > 1 && <Button variant="ghost" size="icon" onClick={() => setForm(f => ({ ...f, objectives: f.objectives.filter((_, idx) => idx !== i) }))} aria-label="Remove objective"><Trash2 className="w-4 h-4 text-rose-500" /></Button>}
              </div>
              <Textarea rows={2} value={o.success_criteria} onChange={(e) => setObj(i, { success_criteria: e.target.value })} placeholder="Measurable success criteria" />
            </div>
          ))}
        </div>
        <div className="space-y-1.5"><Label htmlFor="p-support">Support provided</Label><Textarea id="p-support" rows={2} value={form.support} onChange={(e) => setForm({ ...form, support: e.target.value })} placeholder="Training, mentoring, tools…" /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </>
  );
}

function CheckInForm({ pip, onClose, onSaved }) {
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState('');
  const [statuses, setStatuses] = useState(() => Object.fromEntries(pip.objectives.map(o => [o.id, o.status])));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (note.trim().length < 2) return toast.error('Add a note');
    setSaving(true);
    try {
      const r = await api.post(`${PF}/pips/${pip.id}/check-ins`, {
        date, note: note.trim(),
        objective_updates: pip.objectives.filter(o => statuses[o.id] !== o.status).map(o => ({ objective_id: o.id, status: statuses[o.id] })),
      });
      toast.success('Check-in recorded');
      onSaved(r.data);
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to record check-in'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>PIP check-in</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="ci-date">Date</Label><Input id="ci-date" type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {pip.objectives.map(o => (
          <div key={o.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm flex-1">{o.title}</span>
            <SimpleSelect className="sm:w-40" value={statuses[o.id]} onChange={(v) => setStatuses(s => ({ ...s, [o.id]: v }))} options={OBJ_OPTIONS} />
          </div>
        ))}
        <div className="space-y-1.5"><Label htmlFor="ci-note">Notes</Label><Textarea id="ci-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>Save check-in</Button>
      </DialogFooter>
    </>
  );
}

function OutcomeForm({ pip, onClose, onSaved }) {
  const [outcome, setOutcome] = useState('successful');
  const [notes, setNotes] = useState('');
  const [extended, setExtended] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (outcome === 'extended' && (!extended || extended <= pip.end_date)) return toast.error('Pick a new end date after the current one');
    if (outcome !== 'extended' && !window.confirm('Closing the PIP is final. Continue?')) return;
    setSaving(true);
    try {
      const r = await api.post(`${PF}/pips/${pip.id}/outcome`, { outcome, notes, ...(outcome === 'extended' ? { extended_end_date: extended } : {}) });
      toast.success('Outcome recorded');
      onSaved(r.data);
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to record outcome'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>Record outcome</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label>Outcome</Label><SimpleSelect value={outcome} onChange={setOutcome} options={Object.entries(PIP_OUTCOME).map(([value, s]) => ({ value, label: s.label }))} /></div>
        {outcome === 'extended' && <div className="space-y-1.5"><Label htmlFor="o-ext">New end date</Label><Input id="o-ext" type="date" min={pip.end_date} value={extended} onChange={(e) => setExtended(e.target.value)} /></div>}
        <div className="space-y-1.5"><Label htmlFor="o-notes">Notes</Label><Textarea id="o-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>Save</Button>
      </DialogFooter>
    </>
  );
}

function PipDetail({ id, onChanged }) {
  const detail = useApi(`${PF}/pips/${id}`);
  const [override, setOverride] = useState(null);
  const pip = override && (!detail.data || new Date(override.updated_at) >= new Date(detail.data.updated_at)) ? override : detail.data;
  const [dialog, setDialog] = useState(null);
  const [comment, setComment] = useState('');
  const [ackComment, setAckComment] = useState('');
  const apply = (data) => { setOverride(data); onChanged(); };
  if (detail.loading && !pip) return <LoadingState />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!pip) return null;
  const managerSide = pip.viewer_role !== 'employee';
  const active = pip.status === 'active';

  const post = async (path, body, success) => {
    try {
      const r = await api.post(`${PF}/pips/${pip.id}/${path}`, body);
      toast.success(success);
      apply(r.data);
      return true;
    } catch (error) {
      toast.error(apiError(error, 'Something went wrong'));
      return false;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">{pip.employee_name}</p>
          <p className="text-sm text-slate-600">{fmtDate(pip.start_date)} – {fmtDate(pip.end_date)}{pip.extensions?.length ? ` (extended from ${fmtDate(pip.original_end_date)})` : ''}</p>
          <p className="text-xs text-slate-500">Manager: {pip.manager_name || '—'} · check-ins every {pip.check_in_frequency_days} days</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Pill tone={active ? 'amber' : 'slate'}>{active ? 'Active' : 'Closed'}</Pill>
            {pip.outcome && <Pill map={PIP_OUTCOME} value={pip.outcome} />}
            {active && pip.days_remaining != null && <Pill tone="blue">{pip.days_remaining >= 0 ? `${pip.days_remaining} days left` : 'Past end date'}</Pill>}
            {pip.check_in_due && <Pill tone="rose">Check-in due</Pill>}
            {!pip.acknowledgement && <Pill tone="amber">Not acknowledged</Pill>}
          </div>
        </div>
        {managerSide && active && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog('checkin')}><CalendarCheck className="w-3.5 h-3.5 mr-1" /> Check-in</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('edit')}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
            <Button size="sm" onClick={() => setDialog('outcome')}><Flag className="w-3.5 h-3.5 mr-1" /> Outcome</Button>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-slate-800">Reason</h4>
        <p className="text-sm text-slate-700 whitespace-pre-line">{pip.reason}</p>
      </div>
      {pip.support && <div className="space-y-1"><h4 className="text-sm font-semibold text-slate-800">Support provided</h4><p className="text-sm text-slate-700 whitespace-pre-line">{pip.support}</p></div>}
      {pip.outcome_notes && <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="font-medium">Outcome notes:</span> {pip.outcome_notes}</div>}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-800">Objectives ({pip.objectives_met}/{pip.objectives.length} met)</h4>
        {pip.objectives.map(o => (
          <div key={o.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900 text-sm">{o.title}</p>
              <Pill map={OBJECTIVE_STATUS} value={o.status} />
            </div>
            <p className="text-xs text-slate-600 mt-1">Success: {o.success_criteria}</p>
          </div>
        ))}
      </div>

      {pip.viewer_role === 'employee' && !pip.acknowledgement && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-sm font-medium text-amber-900">Please read the plan and acknowledge it</p>
          <Textarea rows={2} className="bg-white" value={ackComment} onChange={(e) => setAckComment(e.target.value)} placeholder="Optional comment" />
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => post('acknowledge', { comment: ackComment }, 'Acknowledged')}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Acknowledge</Button>
        </div>
      )}
      {pip.acknowledgement && (
        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">Acknowledged by the employee on {fmtDate(pip.acknowledgement.at)}{pip.acknowledgement.comment ? `: "${pip.acknowledgement.comment}"` : ''}</p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> Check-ins</h4>
        {pip.check_ins.length === 0 && <p className="text-xs text-slate-500">No check-ins yet. Next due {fmtDate(pip.next_check_in_date)}.</p>}
        <ol className="border-l-2 border-slate-200 ml-1 space-y-3">
          {[...pip.check_ins].reverse().map(c => (
            <li key={c.id} className="pl-3 text-sm">
              <p className="text-xs text-slate-500">{fmtDate(c.date)} · {c.by_name}</p>
              <p className="text-slate-700 whitespace-pre-line">{c.note}</p>
              {c.objective_updates?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.objective_updates.map(u => <Pill key={u.objective_id} map={OBJECTIVE_STATUS} value={u.status}>{u.title}: {OBJECTIVE_STATUS[u.status]?.label}</Pill>)}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><MessageSquare className="w-4 h-4" /> Comments</h4>
        {pip.comments.map(c => (
          <div key={c.id} className={`rounded-lg p-3 text-sm ${c.role === 'employee' ? 'bg-blue-50' : 'bg-slate-50'}`}>
            <p className="text-xs text-slate-500">{c.by_name} · {fmtDate(c.at)}</p>
            <p className="text-slate-700 whitespace-pre-line">{c.text}</p>
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" />
          <Button variant="outline" onClick={async () => { if (comment.trim() && await post('comments', { text: comment.trim() }, 'Comment added')) setComment(''); }}>Post</Button>
        </div>
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          {dialog === 'checkin' && <CheckInForm pip={pip} onClose={() => setDialog(null)} onSaved={apply} />}
          {dialog === 'outcome' && <OutcomeForm pip={pip} onClose={() => setDialog(null)} onSaved={apply} />}
          {dialog === 'edit' && <PipForm pip={pip} team={[]} onClose={() => setDialog(null)} onSaved={apply} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PipsPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState(user.role === 'admin' ? 'all' : lead ? 'team' : 'my');
  const list = useApi(`${PF}/pips`, { scope });
  const team = useApi(lead ? `${PF}/people` : null, { scope: 'team' });
  const [creating, setCreating] = useState(false);
  const openId = params.get('id');
  const setOpen = (id) => setParams(p => { if (id) p.set('id', id); else p.delete('id'); return p; }, { replace: true });
  const rows = list.data || [];

  return (
    <PageShell
      icon={LifeBuoy}
      title="Improvement Plans"
      subtitle="Structured plans with clear objectives, support and check-ins"
      actions={(
        <>
          <ExportButton disabled={!rows.length} onClick={() => exportCsv('pips', rows, [
            { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'manager_name', label: 'Manager' },
            { key: 'start_date', label: 'Start' }, { key: 'end_date', label: 'End' }, { key: 'status', label: 'Status' }, { key: 'outcome', label: 'Outcome' },
            { label: 'Objectives met', value: r => `${r.objectives_met}/${r.objectives.length}` }, { label: 'Check-ins', value: r => r.check_ins.length },
            { label: 'Acknowledged', value: r => (r.acknowledgement ? 'yes' : 'no') },
          ])} />
          {lead && <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" /> New PIP</Button>}
        </>
      )}
    >
      {lead && (
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList>
            <TabsTrigger value="team">My team</TabsTrigger>
            {user.role === 'admin' && <TabsTrigger value="all">All</TabsTrigger>}
            <TabsTrigger value="my">Mine</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <SectionCard icon={LifeBuoy} title={scope === 'my' ? 'Your plans' : 'Plans'}>
        <DataState state={list} empty={!rows.length} emptyText={scope === 'my' ? 'You have no improvement plans' : 'No improvement plans'} emptyIcon={LifeBuoy}>
          <DataTable
            rows={rows}
            onRowClick={(r) => setOpen(r.id)}
            columns={[
              { key: 'employee_name', label: 'Employee', render: r => <div><p className="font-medium text-slate-900">{r.employee_name}</p><p className="text-xs text-slate-500">{r.designation}</p></div> },
              { key: 'period', label: 'Period', hideOnMobile: true, render: r => <span className="whitespace-nowrap">{fmtDate(r.start_date)} – {fmtDate(r.end_date)}</span> },
              { key: 'objectives', label: 'Met', hideOnMobile: true, render: r => `${r.objectives_met}/${r.objectives.length}` },
              { key: 'status', label: 'Status', render: r => (
                <div className="flex flex-wrap gap-1">
                  {r.outcome ? <Pill map={PIP_OUTCOME} value={r.outcome} /> : <Pill tone="amber">Active</Pill>}
                  {r.check_in_due && <Pill tone="rose">Check-in due</Pill>}
                </div>
              ) },
            ]}
          />
        </DataState>
      </SectionCard>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Performance improvement plan</DialogTitle></DialogHeader>
          {openId && <PipDetail key={openId} id={openId} onChanged={list.reload} />}
        </DialogContent>
      </Dialog>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-xl">
          {creating && <PipForm team={team.data?.people || []} onClose={() => setCreating(false)} onSaved={(p) => { list.reload(); setOpen(p.id); }} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default PipsPage;
