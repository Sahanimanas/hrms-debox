import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarClock, Plus, CheckCircle2, Trash2, Lock, ListChecks, MessageSquare, Video, Repeat, XCircle, CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PF, useApi, apiError, currentUser, isLead, fmtDate, fmtDateTime, toLocalInput, fromLocalInput } from '../lib';
import { PageShell, SectionCard, DataState, EmptyState, Pill, ExportButton, PersonSelect, SimpleSelect } from '../components/common';

const RECURRENCE = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];
const STATUS_TONE = { scheduled: 'blue', completed: 'emerald', cancelled: 'slate' };

function MeetingForm({ meeting, team, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    employee_email: meeting?.employee_email || '',
    title: meeting?.title || '',
    scheduled_at: toLocalInput(meeting?.scheduled_at),
    duration_minutes: meeting?.duration_minutes || 30,
    recurrence: meeting?.recurrence || 'none',
    meeting_link: meeting?.meeting_link || '',
    agenda: '',
  }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!meeting && !form.employee_email) return toast.error('Choose a team member');
    if (!form.scheduled_at) return toast.error('Pick a date and time');
    const body = {
      title: form.title,
      scheduled_at: fromLocalInput(form.scheduled_at),
      duration_minutes: Number(form.duration_minutes) || 30,
      recurrence: form.recurrence,
      meeting_link: form.meeting_link || null,
    };
    setSaving(true);
    try {
      let saved;
      if (meeting) saved = (await api.put(`${PF}/one-on-ones/${meeting.id}`, body)).data;
      else {
        saved = (await api.post(`${PF}/one-on-ones`, {
          ...body,
          employee_email: form.employee_email,
          agenda: form.agenda.split('\n').map(s => s.trim()).filter(Boolean),
        })).data;
      }
      toast.success(meeting ? '1:1 updated' : '1:1 scheduled');
      onSaved(saved);
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save 1:1'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>{meeting ? 'Reschedule 1:1' : 'Schedule a 1:1'}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        {!meeting && (
          <div className="space-y-1.5">
            <Label>With</Label>
            <PersonSelect people={team} value={form.employee_email} onChange={(v) => setForm({ ...form, employee_email: v })} placeholder="Choose a team member" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="m-title">Title</Label>
          <Input id="m-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Weekly 1:1" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label htmlFor="m-when">When</Label>
            <Input id="m-when" type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-dur">Minutes</Label>
            <Input id="m-dur" type="number" min="5" max="480" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Repeats</Label>
            <SimpleSelect value={form.recurrence} onChange={(v) => setForm({ ...form, recurrence: v })} options={RECURRENCE} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-link">Meeting link</Label>
          <Input id="m-link" value={form.meeting_link} onChange={(e) => setForm({ ...form, meeting_link: e.target.value })} placeholder="https://meet.example.com/…" />
        </div>
        {!meeting && (
          <div className="space-y-1.5">
            <Label htmlFor="m-agenda">Agenda (one item per line)</Label>
            <Textarea id="m-agenda" rows={3} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </>
  );
}

function NotesEditor({ meeting, field, label, hint, icon, onSaved, disabled }) {
  const Icon = icon;
  const [text, setText] = useState(meeting[field] || '');
  const [saving, setSaving] = useState(false);
  const dirty = text !== (meeting[field] || '');
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put(`${PF}/one-on-ones/${meeting.id}/notes`, { [field]: text });
      toast.success('Notes saved');
      onSaved(r.data);
    } catch (error) {
      toast.error(apiError(error, 'Failed to save notes'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}</Label>
        {dirty && !disabled && <Button size="sm" onClick={save} disabled={saving} className="h-7 bg-slate-800 hover:bg-slate-900">Save</Button>}
      </div>
      <Textarea rows={4} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function MeetingDetail({ id, onChanged }) {
  const detail = useApi(`${PF}/one-on-ones/${id}`);
  const [override, setOverride] = useState(null);
  const m = override && override.id === id && (!detail.data || new Date(override.updated_at) >= new Date(detail.data.updated_at)) ? override : detail.data;
  const [agendaText, setAgendaText] = useState('');
  const [item, setItem] = useState({ text: '', owner_email: '', due_date: '' });
  const [editing, setEditing] = useState(false);
  const me = currentUser();

  const apply = (data) => { setOverride(data); onChanged(); };
  const call = async (fn, success) => {
    try {
      const r = await fn();
      if (success) toast.success(success);
      return r;
    } catch (error) {
      toast.error(apiError(error, 'Something went wrong'));
      return null;
    }
  };

  if (!m) return <DataState state={detail} />;
  const participant = m.viewer_role === 'manager' || m.viewer_role === 'employee';
  const managerSide = m.viewer_role === 'manager' || m.viewer_role === 'admin';
  const open = m.status === 'scheduled';
  const owners = [{ value: m.manager_email, label: m.manager_name }, { value: m.employee_email, label: m.employee_name }];

  const addAgenda = async () => {
    if (!agendaText.trim()) return;
    const r = await call(() => api.post(`${PF}/one-on-ones/${m.id}/agenda`, { text: agendaText.trim() }));
    if (r) { setAgendaText(''); apply(r.data); }
  };
  const addItem = async () => {
    if (!item.text.trim() || !item.owner_email) return toast.error('Describe the action and pick an owner');
    const r = await call(() => api.post(`${PF}/one-on-ones/${m.id}/action-items`, { ...item, due_date: item.due_date || null }));
    if (r) { setItem({ text: '', owner_email: '', due_date: '' }); apply(r.data); }
  };
  const complete = async () => {
    const r = await call(() => api.post(`${PF}/one-on-ones/${m.id}/complete`), 'Marked as completed');
    if (r) { apply(r.data.meeting); if (r.data.next) toast.info(`Next 1:1 scheduled for ${fmtDateTime(r.data.next.scheduled_at)}`); }
  };
  const cancel = async () => {
    if (!window.confirm('Cancel this 1:1?')) return;
    const r = await call(() => api.put(`${PF}/one-on-ones/${m.id}`, { status: 'cancelled' }), '1:1 cancelled');
    if (r) apply(r.data);
  };
  const remove = async () => {
    if (!window.confirm('Delete this 1:1?')) return;
    const r = await call(() => api.delete(`${PF}/one-on-ones/${m.id}`), '1:1 deleted');
    if (r) onChanged(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">{m.title}</p>
          <p className="text-sm text-slate-600">{fmtDateTime(m.scheduled_at)} · {m.duration_minutes} min</p>
          <p className="text-xs text-slate-500">{m.manager_name} &amp; {m.employee_name}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Pill tone={STATUS_TONE[m.status]}>{m.status}</Pill>
            {m.recurrence !== 'none' && <Pill tone="purple"><Repeat className="w-3 h-3 mr-1 inline" />{RECURRENCE.find(r => r.value === m.recurrence)?.label}</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {m.meeting_link && <a href={m.meeting_link} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Video className="w-3.5 h-3.5 mr-1" /> Join</Button></a>}
          {managerSide && open && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><CalendarDays className="w-3.5 h-3.5 mr-1" /> Reschedule</Button>}
          {managerSide && open && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={complete}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Complete</Button>}
          {managerSide && open && <Button size="sm" variant="ghost" onClick={cancel}><XCircle className="w-3.5 h-3.5 mr-1" /> Cancel</Button>}
          {managerSide && m.status !== 'completed' && <Button size="sm" variant="ghost" className="text-rose-600" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Agenda</h4>
        {(m.agenda || []).length === 0 && <p className="text-xs text-slate-500">No talking points yet.</p>}
        {(m.agenda || []).map(a => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <Checkbox checked={a.discussed} disabled={!participant} onCheckedChange={async (v) => {
              const r = await call(() => api.patch(`${PF}/one-on-ones/${m.id}/agenda/${a.id}`, { discussed: !!v }));
              if (r) apply(r.data);
            }} aria-label="Discussed" />
            <span className={`flex-1 ${a.discussed ? 'line-through text-slate-400' : 'text-slate-800'}`}>{a.text}</span>
            <span className="text-[11px] text-slate-400 hidden sm:inline">{a.added_by_name}</span>
            {participant && (a.added_by === me.email || m.viewer_role === 'manager') && (
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove" onClick={async () => {
                const r = await call(() => api.delete(`${PF}/one-on-ones/${m.id}/agenda/${a.id}`));
                if (r) apply(r.data);
              }}><Trash2 className="w-3.5 h-3.5 text-slate-400" /></Button>
            )}
          </div>
        ))}
        {participant && open && (
          <div className="flex gap-2">
            <Input value={agendaText} onChange={(e) => setAgendaText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAgenda()} placeholder="Add a talking point" />
            <Button variant="outline" onClick={addAgenda}><Plus className="w-4 h-4" /></Button>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <NotesEditor key={`shared-${m.id}-${m.shared_notes_updated_at || ''}`} meeting={m} field="shared_notes" label="Shared notes" icon={MessageSquare} disabled={!participant}
          hint={m.shared_notes_updated_by ? `Last edited by ${m.shared_notes_updated_by}` : 'Visible to both of you'} onSaved={apply} />
        {participant && (
          <NotesEditor key={`private-${m.id}`} meeting={m} field="private_notes" label="Private notes" icon={Lock} hint="Only you can see these" onSaved={apply} />
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Action items</h4>
        {(m.action_items || []).length === 0 && <p className="text-xs text-slate-500">No action items.</p>}
        {(m.action_items || []).map(a => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <Checkbox checked={a.done} disabled={!participant} onCheckedChange={async (v) => {
              const r = await call(() => api.patch(`${PF}/one-on-ones/${m.id}/action-items/${a.id}`, { done: !!v }));
              if (r) apply(r.data);
            }} aria-label="Done" />
            <span className={`flex-1 min-w-[10rem] ${a.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{a.text}</span>
            <span className="text-xs text-slate-500">{a.owner_name}{a.due_date ? ` · due ${fmtDate(a.due_date)}` : ''}</span>
            {a.carried_from && <Pill tone="amber">Carried over</Pill>}
            {participant && (
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove" onClick={async () => {
                const r = await call(() => api.delete(`${PF}/one-on-ones/${m.id}/action-items/${a.id}`));
                if (r) apply(r.data);
              }}><Trash2 className="w-3.5 h-3.5 text-slate-400" /></Button>
            )}
          </div>
        ))}
        {participant && (
          <div className="grid sm:grid-cols-[1fr_10rem_9rem_auto] gap-2">
            <Input value={item.text} onChange={(e) => setItem({ ...item, text: e.target.value })} placeholder="New action item" />
            <SimpleSelect value={item.owner_email} onChange={(v) => setItem({ ...item, owner_email: v })} options={owners} placeholder="Owner" />
            <Input type="date" value={item.due_date} onChange={(e) => setItem({ ...item, due_date: e.target.value })} aria-label="Due date" />
            <Button variant="outline" onClick={addItem}><Plus className="w-4 h-4" /></Button>
          </div>
        )}
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-lg">
          {editing && <MeetingForm meeting={m} team={[]} onClose={() => setEditing(false)} onSaved={apply} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const OneOnOnesPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const [params, setParams] = useSearchParams();
  const [when, setWhen] = useState('upcoming');
  const [scopeAll, setScopeAll] = useState(false);
  const list = useApi(`${PF}/one-on-ones`, { when, ...(scopeAll ? { scope: 'all' } : {}) });
  const team = useApi(lead ? `${PF}/people` : null, { scope: 'team' });
  const [creating, setCreating] = useState(false);
  const rows = list.data || [];
  const selectedId = params.get('id') || rows[0]?.id || null;
  const select = (id) => setParams(p => { if (id) p.set('id', id); else p.delete('id'); return p; }, { replace: true });

  return (
    <PageShell
      icon={CalendarClock}
      title="1:1 Meetings"
      subtitle="Shared agendas, notes and action items with your manager or reports"
      actions={(
        <>
          <ExportButton disabled={!rows.length} onClick={() => exportCsv('one-on-ones', rows, [
            { key: 'title', label: 'Title' }, { label: 'When', value: r => fmtDateTime(r.scheduled_at) }, { key: 'duration_minutes', label: 'Minutes' },
            { key: 'manager_name', label: 'Manager' }, { key: 'employee_name', label: 'Employee' }, { key: 'status', label: 'Status' },
            { key: 'recurrence', label: 'Repeats' }, { label: 'Open action items', value: r => (r.action_items || []).filter(a => !a.done).length },
          ])} />
          {lead && <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" /> Schedule 1:1</Button>}
        </>
      )}
    >
      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={when} onValueChange={setWhen}>
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="past">Past</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            {user.role === 'admin' && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <Checkbox checked={scopeAll} onCheckedChange={(v) => setScopeAll(!!v)} /> Everyone&apos;s
              </label>
            )}
          </div>
          <SectionCard>
            <DataState state={list} empty={!rows.length} emptyText={when === 'upcoming' ? 'No upcoming 1:1s' : 'No 1:1s'} emptyIcon={CalendarClock}>
              <div className="divide-y divide-slate-100">
                {rows.map(m => (
                  <button key={m.id} type="button" onClick={() => select(m.id)}
                    className={`w-full text-left p-3 sm:p-4 hover:bg-slate-50 ${m.id === selectedId ? 'bg-slate-50 border-l-4 border-slate-800' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900 truncate">{m.viewer_role === 'employee' ? m.manager_name : m.viewer_role === 'manager' ? m.employee_name : `${m.manager_name} / ${m.employee_name}`}</p>
                      <Pill tone={STATUS_TONE[m.status]}>{m.status}</Pill>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{fmtDateTime(m.scheduled_at)}</p>
                    {(m.action_items || []).some(a => !a.done) && (
                      <p className="text-[11px] text-amber-700 mt-0.5">{m.action_items.filter(a => !a.done).length} open action item(s)</p>
                    )}
                  </button>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
        <div className="lg:col-span-3">
          <SectionCard bodyClassName="p-3 sm:p-5">
            {selectedId
              ? <MeetingDetail key={selectedId} id={selectedId} onChanged={(removed) => { list.reload(); if (removed === true) select(null); }} />
              : <EmptyState icon={CalendarClock} text={lead ? 'Schedule a 1:1 with someone on your team' : 'Your manager will schedule 1:1s with you'} />}
          </SectionCard>
        </div>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-lg">
          {creating && <MeetingForm team={team.data?.people || []} onClose={() => setCreating(false)} onSaved={(m) => { list.reload(); select(m.id); }} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default OneOnOnesPage;
