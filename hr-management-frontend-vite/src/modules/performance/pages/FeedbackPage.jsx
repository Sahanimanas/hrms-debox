import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessagesSquare, Send, HandHeart, MessageCircleQuestion, ThumbsUp, Lightbulb, EyeOff, X, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PF, useApi, apiError, currentUser, isLead, fmtDate } from '../lib';
import { PageShell, SectionCard, DataState, Pill, ExportButton, PersonSelect, PeoplePicker, SimpleSelect } from '../components/common';

const TYPE_OPTIONS = [{ value: 'praise', label: 'Praise' }, { value: 'constructive', label: 'Constructive' }];
const VIS_OPTIONS = [
  { value: 'private', label: 'Private to them (and their manager)' },
  { value: 'manager_only', label: 'Only their manager' },
];

const feedbackCsv = (rows, name) => exportCsv(name, rows, [
  { label: 'Date', value: r => fmtDate(r.created_at) }, { key: 'from_name', label: 'From' }, { key: 'to_name', label: 'To' },
  { key: 'type', label: 'Type' }, { key: 'visibility', label: 'Visibility' }, { key: 'topic', label: 'Topic' }, { key: 'message', label: 'Message' },
]);

function GiveForm({ people, preset, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ to_email: preset?.to_email || '', type: 'praise', visibility: 'private', message: '' }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.to_email) return toast.error('Choose a colleague');
    if (form.message.trim().length < 3) return toast.error('Write a short message');
    setSaving(true);
    try {
      await api.post(`${PF}/feedback`, { ...form, message: form.message.trim(), ...(preset?.request_id ? { request_id: preset.request_id } : {}) });
      toast.success('Feedback sent');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to send feedback'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>{preset?.request_id ? `Feedback on "${preset.topic}"` : 'Give feedback'}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        {!preset?.request_id && (
          <div className="space-y-1.5">
            <Label>To</Label>
            <PersonSelect people={people} value={form.to_email} onChange={(v) => setForm({ ...form, to_email: v })} placeholder="Choose a colleague" />
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Type</Label><SimpleSelect value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={TYPE_OPTIONS} /></div>
          <div className="space-y-1.5"><Label>Visibility</Label><SimpleSelect value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} options={VIS_OPTIONS} /></div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fb-msg">Message</Label>
          <Textarea id="fb-msg" rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder={form.type === 'praise' ? 'What did they do well?' : 'Be specific and kind: situation, behaviour, impact'} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900"><Send className="w-4 h-4 mr-1" /> Send</Button>
      </DialogFooter>
    </>
  );
}

function RequestForm({ people, onClose, onSaved }) {
  const [selected, setSelected] = useState([]);
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!selected.length) return toast.error('Choose at least one colleague');
    if (topic.trim().length < 2) return toast.error('What would you like feedback on?');
    setSaving(true);
    try {
      await api.post(`${PF}/feedback/requests`, { recipient_emails: selected, topic: topic.trim(), message });
      toast.success('Feedback requested');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to request feedback'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>Request feedback</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="rq-topic">Topic</Label><Input id="rq-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. My presentation at the all-hands" /></div>
        <div className="space-y-1.5"><Label htmlFor="rq-msg">Message (optional)</Label><Textarea id="rq-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Ask</Label><PeoplePicker people={people} selected={selected} onChange={setSelected} max={10} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">Send request</Button>
      </DialogFooter>
    </>
  );
}

function FeedbackList({ state, mode }) {
  const rows = state.data || [];
  return (
    <DataState state={state} empty={!rows.length} emptyText="No feedback yet" emptyIcon={MessagesSquare}>
      <div className="divide-y divide-slate-100">
        {rows.map(f => {
          const Icon = f.type === 'praise' ? ThumbsUp : Lightbulb;
          return (
            <div key={f.id} className="p-3 sm:p-4 flex gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${f.type === 'praise' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-medium text-slate-900">
                    {mode === 'received' ? f.from_name : mode === 'given' ? `To ${f.to_name}` : `${f.from_name} → ${f.to_name}`}
                  </p>
                  <Pill tone={f.type === 'praise' ? 'emerald' : 'amber'}>{f.type}</Pill>
                  {f.visibility === 'manager_only' && <Pill tone="purple"><EyeOff className="w-3 h-3 mr-1 inline" />Manager only</Pill>}
                  <span className="text-xs text-slate-400">{fmtDate(f.created_at)}</span>
                </div>
                {f.topic && <p className="text-xs text-slate-500 mt-0.5">Re: {f.topic}</p>}
                <p className="text-sm text-slate-700 mt-1 whitespace-pre-line">{f.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </DataState>
  );
}

const REQ_TONE = { pending: 'amber', completed: 'emerald', declined: 'slate' };

const FeedbackPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (params.get('box') === 'team' ? 'team' : 'received');
  const setTab = (t) => setParams(p => { p.set('tab', t); p.delete('box'); return p; }, { replace: true });

  const received = useApi(`${PF}/feedback`, { box: 'received' });
  const given = useApi(`${PF}/feedback`, { box: 'given' });
  const teamFb = useApi(lead ? `${PF}/feedback` : null, { box: 'team' });
  const incoming = useApi(`${PF}/feedback/requests`, { box: 'incoming' });
  const outgoing = useApi(`${PF}/feedback/requests`, { box: 'outgoing' });
  const people = useApi(`${PF}/people`, { scope: 'all' });
  const colleagues = (people.data?.people || []).filter(p => p.email !== user.email);
  const [dialog, setDialog] = useState(null);
  const reload = () => { received.reload(); given.reload(); teamFb.reload(); incoming.reload(); outgoing.reload(); };
  const pendingIn = (incoming.data || []).filter(r => r.status === 'pending').length;

  const decline = async (r) => {
    try {
      await api.post(`${PF}/feedback/requests/${r.id}/decline`);
      toast.success('Request declined');
      incoming.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to decline'));
    }
  };
  const withdraw = async (r) => {
    try {
      await api.delete(`${PF}/feedback/requests/${r.id}`);
      toast.success('Request withdrawn');
      outgoing.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to withdraw'));
    }
  };

  const current = { received, given, team: teamFb }[tab];

  return (
    <PageShell
      icon={MessagesSquare}
      title="Feedback"
      subtitle="Praise and constructive feedback, any time"
      actions={(
        <>
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'request' })}><MessageCircleQuestion className="w-4 h-4 mr-1" /> Request</Button>
          <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={() => setDialog({ kind: 'give' })}><HandHeart className="w-4 h-4 mr-1" /> Give feedback</Button>
        </>
      )}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="given">Given</TabsTrigger>
          {lead && <TabsTrigger value="team">My team</TabsTrigger>}
          <TabsTrigger value="requests">Requests{pendingIn ? ` (${pendingIn})` : ''}</TabsTrigger>
        </TabsList>

        {['received', 'given', 'team'].filter(t => t !== 'team' || lead).map(t => (
          <TabsContent key={t} value={t}>
            <SectionCard
              icon={MessagesSquare}
              title={{ received: 'Feedback for you', given: 'Feedback you gave', team: 'Feedback about your team' }[t]}
              actions={<ExportButton disabled={!current?.data?.length} onClick={() => feedbackCsv(current?.data || [], `feedback-${t}`)} />}
            >
              <FeedbackList state={{ received, given, team: teamFb }[t]} mode={t} />
            </SectionCard>
          </TabsContent>
        ))}

        <TabsContent value="requests" className="space-y-4">
          <SectionCard icon={Inbox} title="Asked of you">
            <DataState state={incoming} empty={!incoming.data?.length} emptyText="No one has asked you for feedback" emptyIcon={Inbox}>
              <div className="divide-y divide-slate-100">
                {(incoming.data || []).map(r => (
                  <div key={r.id} className="p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{r.requester_name}: {r.topic}</p>
                      {r.message && <p className="text-xs text-slate-500">{r.message}</p>}
                      <p className="text-[11px] text-slate-400">{fmtDate(r.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={REQ_TONE[r.status]}>{r.status}</Pill>
                      {r.status === 'pending' && (
                        <>
                          <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={() => setDialog({ kind: 'give', preset: { to_email: r.requester_email, request_id: r.id, topic: r.topic } })}>Respond</Button>
                          <Button size="sm" variant="ghost" onClick={() => decline(r)}>Decline</Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </DataState>
          </SectionCard>
          <SectionCard
            icon={MessageCircleQuestion}
            title="Your requests"
            actions={<ExportButton disabled={!outgoing.data?.length} onClick={() => exportCsv('feedback-requests', outgoing.data || [], [
              { label: 'Date', value: r => fmtDate(r.created_at) }, { key: 'recipient_name', label: 'Asked' }, { key: 'topic', label: 'Topic' }, { key: 'status', label: 'Status' },
            ])} />}
          >
            <DataState state={outgoing} empty={!outgoing.data?.length} emptyText="You haven't requested feedback yet" emptyIcon={MessageCircleQuestion}>
              <div className="divide-y divide-slate-100">
                {(outgoing.data || []).map(r => (
                  <div key={r.id} className="p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{r.recipient_name}</p>
                      <p className="text-xs text-slate-500">{r.topic} · {fmtDate(r.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={REQ_TONE[r.status]}>{r.status}</Pill>
                      {r.status === 'pending' && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => withdraw(r)} aria-label="Withdraw"><X className="w-4 h-4" /></Button>}
                    </div>
                  </div>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          {dialog?.kind === 'give' && <GiveForm people={colleagues} preset={dialog.preset} onClose={() => setDialog(null)} onSaved={reload} />}
          {dialog?.kind === 'request' && <RequestForm people={colleagues} onClose={() => setDialog(null)} onSaved={reload} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default FeedbackPage;
