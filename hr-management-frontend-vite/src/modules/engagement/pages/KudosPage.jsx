import { useState } from 'react';
import { Award, Plus, Heart, Trophy, Trash2, Search, X, Settings2, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, StateSwitch, ExportButton, Avatar } from '../components/PageShell';
import { API, PRIMARY_BTN, useApi, isAdmin, errorMessage, timeAgo, valueTone } from '../lib';

function KudosCard({ k, onUpdate, onDelete, admin }) {
  const [busy, setBusy] = useState(false);
  const like = async () => {
    setBusy(true);
    try {
      const res = k.liked_by_me ? await api.delete(`${API}/kudos/${k.id}/like`) : await api.post(`${API}/kudos/${k.id}/like`);
      onUpdate(res.data);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className={`border-0 shadow-md ${k.to_me ? 'ring-1 ring-amber-200' : ''}`}>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Avatar name={k.from.full_name} seed={k.from.id} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-700 break-words">
              <span className="font-semibold text-slate-900">{k.from.full_name}</span> recognised{' '}
              {k.recipients.map((r, i) => (
                <span key={r.id}>
                  <span className="font-semibold text-slate-900">{r.full_name}</span>
                  {i < k.recipients.length - 2 ? ', ' : i === k.recipients.length - 2 ? ' and ' : ''}
                </span>
              ))}
            </p>
            <p className="text-[11px] text-slate-500">{timeAgo(k.created_at)}</p>
          </div>
          <Badge variant="outline" className={`${valueTone(k.value)} text-[10px] shrink-0`}>{k.value}</Badge>
        </div>
        <p className="text-sm text-slate-800 whitespace-pre-line break-words pl-12">{k.message}</p>
        <div className="flex items-center justify-between pl-12">
          <button onClick={like} disabled={busy} aria-pressed={k.liked_by_me}
            className={`flex items-center gap-1 text-xs rounded-full px-2 py-1 transition-colors ${k.liked_by_me ? 'text-rose-600 bg-rose-50' : 'text-slate-500 hover:bg-slate-100'}`}>
            <Heart className={`w-4 h-4 ${k.liked_by_me ? 'fill-rose-500' : ''}`} />{k.like_count}
          </button>
          {(k.is_mine || admin) && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-rose-600" aria-label="Delete kudos" onClick={() => onDelete(k)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GiveKudosDialog({ onClose, onSent }) {
  const { data: people } = useApi(`${API}/directory`, { initial: [] });
  const { data: values } = useApi(`${API}/kudos/values`, { initial: [] });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const candidates = (people || [])
    .filter(p => !p.is_me && !picked.some(x => x.id === p.id))
    .filter(p => !query || `${p.full_name} ${p.department || ''}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  const send = async () => {
    if (!picked.length) return toast.error('Pick at least one colleague');
    if (!value) return toast.error('Pick a value');
    if (message.trim().length < 3) return toast.error('Say a few words about what they did');
    setSending(true);
    try {
      await api.post(`${API}/kudos`, { recipient_ids: picked.map(p => p.id), value, message: message.trim() });
      toast.success('Kudos sent 🎉');
      onSent();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not send kudos'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Give kudos</DialogTitle>
          <DialogDescription>Recognise colleagues for great work. Everyone will see it on the feed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Who? <span className="text-slate-400 font-normal">(up to 10)</span></Label>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {picked.map(p => (
                  <span key={p.id} className="flex items-center gap-1 text-xs bg-slate-800 text-white rounded-full pl-2.5 pr-1 py-1">
                    {p.full_name}
                    <button onClick={() => setPicked(picked.filter(x => x.id !== p.id))} aria-label={`Remove ${p.full_name}`} className="rounded-full hover:bg-slate-700 p-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            {picked.length < 10 && (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search colleagues" className="pl-8" />
                </div>
                <ul className="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {candidates.map(p => (
                    <li key={p.id}>
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setPicked([...picked, p]); setQuery(''); }}>
                        <Avatar name={p.full_name} seed={p.id} size="sm" />
                        <span className="text-sm truncate">{p.full_name}<span className="block text-[11px] text-slate-500">{[p.designation, p.department].filter(Boolean).join(' · ')}</span></span>
                      </button>
                    </li>
                  ))}
                  {!candidates.length && <li className="px-3 py-3 text-xs text-slate-500">No matches</li>}
                </ul>
              </>
            )}
          </div>
          <div className="space-y-2">
            <Label>Value</Label>
            <div className="flex flex-wrap gap-1.5">
              {(values || []).map(v => (
                <button key={v} type="button" onClick={() => setValue(v)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${value === v ? 'ring-2 ring-slate-800 ring-offset-1' : ''} ${valueTone(v)}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kudos-msg">Message</Label>
            <Textarea id="kudos-msg" rows={4} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} placeholder="What did they do that made a difference?" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Send kudos'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValuesDialog({ onClose }) {
  const { data, loading } = useApi(`${API}/settings`);
  const [draft, setDraft] = useState(null);
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const values = draft ?? data?.kudos_values ?? [];

  const add = () => {
    const v = newValue.trim();
    if (!v) return;
    if (values.some(x => x.toLowerCase() === v.toLowerCase())) return toast.error('Already in the list');
    setDraft([...values, v]);
    setNewValue('');
  };
  const save = async () => {
    if (!values.length) return toast.error('Keep at least one value');
    setSaving(true);
    try {
      await api.put(`${API}/settings`, { kudos_values: values });
      toast.success('Values updated');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Company values</DialogTitle>
          <DialogDescription>Tags people choose from when giving kudos.</DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {values.map(v => (
                <span key={v} className={`flex items-center gap-1 text-xs rounded-full border pl-2.5 pr-1 py-1 ${valueTone(v)}`}>
                  {v}
                  <button onClick={() => setDraft(values.filter(x => x !== v))} aria-label={`Remove ${v}`} className="rounded-full hover:bg-black/10 p-0.5"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newValue} maxLength={50} placeholder="New value" onChange={e => setNewValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
              <Button variant="outline" onClick={add}>Add</Button>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Leaderboard() {
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const { data, loading, error, reload } = useApi(`${API}/kudos/leaderboard`, { params: { month } });
  const shift = (d) => {
    const [y, m] = month.split('-').map(Number);
    setMonth(format(new Date(y, m - 1 + d, 1), 'yyyy-MM'));
  };
  const isCurrent = month === format(new Date(), 'yyyy-MM');
  const medal = ['🥇', '🥈', '🥉'];
  const download = () => exportCsv(`kudos-leaderboard-${month}`, data?.top_received || [], [
    { key: 'rank', label: 'Rank' },
    { label: 'Name', value: r => r.employee.full_name },
    { label: 'Department', value: r => r.employee.department },
    { key: 'count', label: 'Kudos received' },
    { key: 'top_value', label: 'Top value' },
  ]);

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-4 space-y-2">
        <CardTitle className="text-base flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-500" />Leaderboard</CardTitle>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-medium">{format(new Date(`${month}-01T00:00:00`), 'MMMM yyyy')}</span>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shift(1)} disabled={isCurrent} aria-label="Next month"><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <StateSwitch loading={loading} error={error} onRetry={reload} empty={!data?.top_received?.length}
          emptyProps={{ icon: Trophy, title: 'No kudos this month yet' }}>
          <div className="space-y-4">
            <ol className="space-y-2">
              {data?.top_received?.map(r => (
                <li key={r.employee.id} className="flex items-center gap-2">
                  <span className="w-6 text-center text-sm">{medal[r.rank - 1] || r.rank}</span>
                  <Avatar name={r.employee.full_name} seed={r.employee.id} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm text-slate-900 truncate block">{r.employee.full_name}</span>
                    {r.top_value && <span className="text-[11px] text-slate-500">mostly {r.top_value}</span>}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{r.count}</span>
                </li>
              ))}
            </ol>
            {data?.by_value?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                {data.by_value.map(v => <Badge key={v.value} variant="outline" className={`${valueTone(v.value)} text-[10px]`}>{v.value} · {v.count}</Badge>)}
              </div>
            )}
            <ExportButton onClick={download} disabled={!data?.top_received?.length} />
          </div>
        </StateSwitch>
      </CardContent>
    </Card>
  );
}

export default function KudosPage() {
  const admin = isAdmin();
  const { data, loading, error, reload, setData } = useApi(`${API}/kudos`, { params: { limit: 20 } });
  const [giving, setGiving] = useState(false);
  const [editingValues, setEditingValues] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [boardKey, setBoardKey] = useState(0);
  const list = data?.kudos || [];

  const update = (k) => setData(d => ({ ...d, kudos: d.kudos.map(x => (x.id === k.id ? k : x)) }));
  const remove = async (k) => {
    if (!window.confirm('Delete these kudos?')) return;
    try {
      await api.delete(`${API}/kudos/${k.id}`);
      setData(d => ({ ...d, kudos: d.kudos.filter(x => x.id !== k.id) }));
      setBoardKey(b => b + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api.get(`${API}/kudos`, { params: { limit: 20, before: data.next_before } });
      setData(d => ({ kudos: [...d.kudos, ...res.data.kudos], next_before: res.data.next_before }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };
  const download = () => exportCsv('kudos', list, [
    { label: 'From', value: r => r.from.full_name },
    { label: 'To', value: r => r.recipients.map(x => x.full_name).join('; ') },
    { key: 'value', label: 'Value' },
    { key: 'message', label: 'Message' },
    { key: 'like_count', label: 'Likes' },
    { label: 'Date', value: r => r.created_at },
  ]);

  return (
    <PageShell>
      <PageHeader
        icon={Award}
        title="Kudos"
        subtitle="Celebrate great work by your colleagues"
        actions={(
          <>
            {admin && <Button variant="outline" className="gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto rounded-lg sm:rounded-xl" onClick={() => setEditingValues(true)}><Settings2 className="w-4 h-4" />Values</Button>}
            <ExportButton onClick={download} disabled={!list.length} />
            <Button className={PRIMARY_BTN} onClick={() => setGiving(true)}><Plus className="w-4 h-4" />Give kudos</Button>
          </>
        )}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
            emptyProps={{ icon: Award, title: 'No kudos yet', hint: 'Be the first to recognise a colleague!' }}>
            {list.map(k => <KudosCard key={k.id} k={k} admin={admin} onUpdate={update} onDelete={remove} />)}
            {data?.next_before && (
              <Button variant="outline" className="w-full" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</Button>
            )}
          </StateSwitch>
        </div>
        <div className="lg:sticky lg:top-4">
          <Leaderboard key={boardKey} />
        </div>
      </div>
      {giving && <GiveKudosDialog onClose={() => setGiving(false)} onSent={() => { setGiving(false); reload(); setBoardKey(b => b + 1); }} />}
      {editingValues && <ValuesDialog onClose={() => setEditingValues(false)} />}
    </PageShell>
  );
}
