import { useState } from 'react';
import { Vote, Plus, X, Lock, CheckCircle2, Trash2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import AudiencePicker from '../components/AudiencePicker';
import { PageShell, PageHeader, StateSwitch, ExportButton } from '../components/PageShell';
import { API, PRIMARY_BTN, useApi, currentRole, errorMessage, fmtDateTime, timeAgo, fromLocalInput, audienceLabel } from '../lib';

function PollCard({ poll, onChange }) {
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const open = poll.state === 'open';
  const canVote = open && !poll.my_vote;

  const toggle = (id) => setSelected(s => (poll.multi_select ? (s.includes(id) ? s.filter(x => x !== id) : [...s, id]) : [id]));

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const res = await fn();
      if (ok) toast.success(ok);
      onChange(res?.data);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-md">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 break-words">{poll.question}</h3>
            <p className="text-[11px] text-slate-500">
              {poll.created_by_name} · {timeAgo(poll.created_at)}
              {poll.multi_select && ' · pick any'}
              {poll.audience?.type === 'departments' && ` · ${audienceLabel(poll.audience)}`}
            </p>
          </div>
          {open
            ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px] shrink-0">Open</Badge>
            : <Badge variant="outline" className="text-[10px] gap-1 shrink-0"><Lock className="w-3 h-3" />Closed</Badge>}
        </div>

        <div className="space-y-2">
          {poll.options.map(o => {
            const mine = poll.my_vote?.includes(o.id);
            if (canVote) {
              const isSel = selected.includes(o.id);
              return (
                <label key={o.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${isSel ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  {poll.multi_select
                    ? <Checkbox checked={isSel} onCheckedChange={() => toggle(o.id)} />
                    : <input type="radio" name={`poll-${poll.id}`} checked={isSel} onChange={() => toggle(o.id)} className="accent-slate-800" />}
                  <span className="break-words">{o.text}</span>
                </label>
              );
            }
            return (
              <div key={o.id} className="text-sm">
                <div className="flex justify-between gap-2 mb-1">
                  <span className={`break-words ${mine ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                    {o.text}{mine && <CheckCircle2 className="inline w-3.5 h-3.5 ml-1 text-emerald-600" />}
                  </span>
                  {poll.results_visible && <span className="text-slate-500 shrink-0">{o.votes} · {o.percent}%</span>}
                </div>
                {poll.results_visible && (
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${mine ? 'bg-emerald-600' : 'bg-slate-700'}`} style={{ width: `${o.percent}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500 flex items-center gap-1">
            {poll.total_votes} vote{poll.total_votes === 1 ? '' : 's'}
            {poll.closes_at && open && <><Clock className="w-3 h-3 ml-1" />closes {fmtDateTime(poll.closes_at)}</>}
            {!poll.results_visible && ' · vote to see results'}
          </p>
          <div className="flex gap-2">
            {canVote && (
              <Button size="sm" className="bg-slate-800 hover:bg-slate-900 h-8" disabled={!selected.length || busy}
                onClick={() => run(() => api.post(`${API}/polls/${poll.id}/vote`, { option_ids: selected }), 'Vote recorded')}>
                Vote
              </Button>
            )}
            {poll.can_manage && open && (
              <Button size="sm" variant="outline" className="h-8" disabled={busy}
                onClick={() => window.confirm('Close this poll? Results become visible to everyone.') && run(() => api.post(`${API}/polls/${poll.id}/close`), 'Poll closed')}>
                Close
              </Button>
            )}
            {poll.can_manage && (
              <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" aria-label="Delete poll" disabled={busy}
                onClick={() => window.confirm('Delete this poll and its votes?') && run(async () => { await api.delete(`${API}/polls/${poll.id}`); return { data: { id: poll.id, deleted: true } }; }, 'Poll deleted')}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreatePollDialog({ onClose, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [closesAt, setClosesAt] = useState('');
  const [notify, setNotify] = useState(true);
  const [audience, setAudience] = useState({ type: 'everyone', departments: [] });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const opts = options.map(o => o.trim()).filter(Boolean);
    if (!question.trim()) return toast.error('Write a question');
    if (opts.length < 2) return toast.error('Add at least two options');
    if (new Set(opts.map(o => o.toLowerCase())).size !== opts.length) return toast.error('Options must be different');
    if (audience.type === 'departments' && !audience.departments.length) return toast.error('Pick at least one department');
    setSaving(true);
    try {
      await api.post(`${API}/polls`, { question: question.trim(), options: opts, multi_select: multi, closes_at: fromLocalInput(closesAt), audience, notify });
      toast.success('Poll created');
      onCreated();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create poll'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New poll</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="poll-q">Question</Label>
            <Input id="poll-q" value={question} maxLength={300} onChange={e => setQuestion(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Options</Label>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input value={o} maxLength={150} placeholder={`Option ${i + 1}`} onChange={e => setOptions(options.map((x, xi) => (xi === i ? e.target.value : x)))} />
                {options.length > 2 && <Button variant="ghost" size="icon" aria-label="Remove option" onClick={() => setOptions(options.filter((_, xi) => xi !== i))}><X className="w-4 h-4" /></Button>}
              </div>
            ))}
            {options.length < 10 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOptions([...options, ''])}><Plus className="w-3.5 h-3.5 mr-1" />Add option</Button>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="poll-close">Closes (optional)</Label>
            <Input id="poll-close" type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
          </div>
          <label className="flex items-center gap-3 text-sm"><Switch checked={multi} onCheckedChange={setMulti} />Allow multiple choices</label>
          <label className="flex items-center gap-3 text-sm"><Switch checked={notify} onCheckedChange={setNotify} />Notify the audience</label>
          <AudiencePicker value={audience} onChange={setAudience} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-slate-800 hover:bg-slate-900" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create poll'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PollsPage() {
  const canCreate = ['admin', 'manager'].includes(currentRole());
  const [filter, setFilter] = useState('open');
  const { data, loading, error, reload, setData } = useApi(`${API}/polls`, { initial: [], params: filter === 'all' ? {} : { state: filter } });
  const [creating, setCreating] = useState(false);
  const list = data || [];

  const update = (next) => {
    if (!next) return reload();
    if (next.deleted) return setData(d => d.filter(p => p.id !== next.id));
    if (filter === 'open' && next.state === 'closed') return setData(d => d.filter(p => p.id !== next.id));
    setData(d => d.map(p => (p.id === next.id ? next : p)));
  };

  const download = () => exportCsv('polls', list.flatMap(p => (p.results_visible ? p.options : [{ text: '(hidden until you vote)' }]).map(o => ({
    question: p.question, state: p.state, option: o.text, votes: o.votes ?? '', percent: o.percent ?? '', total: p.total_votes, created: p.created_at,
  }))), [
    { key: 'question', label: 'Question' },
    { key: 'state', label: 'State' },
    { key: 'option', label: 'Option' },
    { key: 'votes', label: 'Votes' },
    { key: 'percent', label: 'Percent' },
    { key: 'total', label: 'Total voters' },
    { key: 'created', label: 'Created' },
  ]);

  return (
    <PageShell>
      <PageHeader
        icon={Vote}
        title="Polls"
        subtitle="Quick questions, instant answers"
        actions={(
          <>
            <ExportButton onClick={download} disabled={!list.length} />
            {canCreate && <Button className={PRIMARY_BTN} onClick={() => setCreating(true)}><Plus className="w-4 h-4" />New poll</Button>}
          </>
        )}
      />
      <div className="flex gap-1.5">
        {['open', 'closed', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs border capitalize ${filter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {f}
          </button>
        ))}
      </div>
      <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
        emptyProps={{ icon: Vote, title: filter === 'open' ? 'No open polls' : 'No polls', hint: canCreate ? 'Ask your team a quick question.' : undefined }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {list.map(p => <PollCard key={p.id} poll={p} onChange={update} />)}
        </div>
      </StateSwitch>
      {creating && <CreatePollDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </PageShell>
  );
}
