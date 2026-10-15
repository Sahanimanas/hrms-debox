import { useState } from 'react';
import { ShieldAlert, Send, Copy, EyeOff, StickyNote, Lock, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import GrievanceTracker, { GrievanceStatus } from '../components/GrievanceTracker';
import { PageShell, PageHeader, StateSwitch, ExportButton, LoadingState, ErrorState } from '../components/PageShell';
import { API, GRIEVANCE_STATUS_STYLES, useApi, isAdmin, errorMessage, fmtDateTime, timeAgo, titleCase } from '../lib';

const CATEGORIES = ['harassment', 'discrimination', 'workplace_safety', 'compensation', 'workload', 'manager_conduct', 'policy_violation', 'other'];
const STATUSES = ['open', 'investigating', 'resolved', 'closed'];
const ACTION_LABELS = { investigating: 'Start investigation', resolved: 'Mark resolved', closed: 'Close', open: 'Reopen' };

const StatusBadge = ({ status }) => (
  <Badge variant="outline" className={`${GRIEVANCE_STATUS_STYLES[status]} border-0 text-[10px]`}>{titleCase(status)}</Badge>
);

function FileGrievance({ onFiled }) {
  const [form, setForm] = useState({ category: '', subject: '', description: '', anonymous: true });
  const [saving, setSaving] = useState(false);
  const [filed, setFiled] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.category) return toast.error('Pick a category');
    if (form.subject.trim().length < 3) return toast.error('Add a short subject');
    if (form.description.trim().length < 10) return toast.error('Describe what happened (at least 10 characters)');
    setSaving(true);
    try {
      const res = await api.post(`${API}/grievances`, { ...form, subject: form.subject.trim(), description: form.description.trim() });
      setFiled(res.data);
      setForm({ category: '', subject: '', description: '', anonymous: true });
      onFiled();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not file the grievance'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(filed.tracking_code);
      toast.success('Tracking code copied');
    } catch {
      toast.error('Copy failed — please write the code down');
    }
  };

  if (filed) {
    return (
      <Card className="border-0 shadow-md">
        <CardContent className="p-4 sm:p-6 space-y-4 text-center">
          <ShieldAlert className="w-10 h-10 mx-auto text-emerald-600" />
          <div>
            <p className="font-semibold text-slate-900">Your grievance has been filed</p>
            <p className="text-sm text-slate-600">Save this tracking code{filed.anonymous ? ' — it is the only way to follow an anonymous grievance' : ''}.</p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <code className="font-mono text-base sm:text-lg bg-slate-100 rounded-lg px-4 py-2 select-all break-all">{filed.tracking_code}</code>
            <Button variant="outline" size="sm" className="gap-1" onClick={copy}><Copy className="w-4 h-4" />Copy</Button>
          </div>
          <p className="text-xs text-slate-500">Check status any time at <a className="text-sky-700 underline" href="/grievance-status" target="_blank" rel="noopener noreferrer">/grievance-status</a> — no login needed.</p>
          <Button variant="ghost" onClick={() => setFiled(null)}>File another</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg">Raise a grievance</CardTitle>
        <p className="text-xs text-slate-500">Only HR administrators can see grievances. Managers cannot.</p>
      </CardHeader>
      <CardContent className="p-3 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={v => set('category', v)}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gr-subject">Subject</Label>
            <Input id="gr-subject" value={form.subject} maxLength={200} onChange={e => set('subject', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gr-desc">What happened?</Label>
          <Textarea id="gr-desc" rows={6} maxLength={10000} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Include dates, places and anyone involved, as far as you are comfortable." />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={form.anonymous} onCheckedChange={v => set('anonymous', v)} className="mt-0.5" />
            <span>File anonymously<span className="block text-xs text-slate-500">Your identity is not stored. Use the tracking code to follow up.</span></span>
          </label>
          <Button className="gap-2 w-full sm:w-auto" onClick={submit} disabled={saving}><Send className="w-4 h-4" />{saving ? 'Filing…' : 'File grievance'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MyGrievances({ version }) {
  const { data, loading, error, reload } = useApi(`${API}/grievances/mine`, { initial: [], params: { v: version } });
  const list = data || [];
  const download = () => exportCsv('my-grievances', list, [
    { key: 'tracking_code', label: 'Tracking code' }, { key: 'category', label: 'Category' }, { key: 'subject', label: 'Subject' },
    { key: 'status', label: 'Status' }, { key: 'response', label: 'Response' }, { label: 'Filed', value: r => r.created_at },
  ]);
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base sm:text-lg">My grievances</CardTitle>
        <ExportButton onClick={download} disabled={!list.length} />
      </CardHeader>
      <CardContent className="p-3 sm:p-5">
        <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
          emptyProps={{ icon: ShieldAlert, title: 'No named grievances', hint: 'Anonymous grievances are not linked to you — track them with their code.' }}>
          <div className="space-y-3">{list.map(g => <GrievanceStatus key={g.id} g={g} />)}</div>
        </StateSwitch>
      </CardContent>
    </Card>
  );
}

function CaseDialog({ id, onClose, onChanged }) {
  const { data: g, loading, error, reload, setData } = useApi(`${API}/grievances/${id}`);
  const [response, setResponse] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const patch = async (body, ok) => {
    setBusy(true);
    try {
      const res = await api.patch(`${API}/grievances/${id}`, body);
      setData(d => ({ ...res.data, notes: d?.notes || res.data.notes }));
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const res = await api.post(`${API}/grievances/${id}/notes`, { text: note.trim() });
      setData(d => ({ ...d, notes: [...(d.notes || []), res.data] }));
      setNote('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const responseValue = response ?? g?.response ?? '';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {g && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="pr-6 break-words">{g.subject}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{g.tracking_code}</span> <StatusBadge status={g.status} /> {titleCase(g.category)} · {fmtDateTime(g.created_at)}
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-slate-600 flex items-center gap-1">
              {g.anonymous ? <><EyeOff className="w-3.5 h-3.5" />Anonymous reporter</> : <>Reported by <strong>{g.reporter_name}</strong>{g.reporter_department ? ` (${g.reporter_department})` : ''} · {g.reporter_email}</>}
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-line break-words bg-slate-50 rounded-lg p-3">{g.description}</p>

            <div className="flex flex-wrap gap-2">
              {g.allowed_transitions.map(s => (
                <Button key={s} size="sm" variant={s === 'resolved' ? 'default' : 'outline'} className={s === 'resolved' ? 'bg-emerald-700 hover:bg-emerald-800' : ''} disabled={busy}
                  onClick={() => patch({ status: s }, `Status: ${titleCase(s)}`)}>
                  {g.status === 'closed' || (g.status === 'resolved' && s === 'investigating') ? 'Reopen' : ACTION_LABELS[s]}
                </Button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gr-resp">Response to the reporter</Label>
              <Textarea id="gr-resp" rows={3} maxLength={5000} value={responseValue} onChange={e => setResponse(e.target.value)} />
              <Button size="sm" variant="outline" disabled={busy || responseValue === (g.response || '')} onClick={() => patch({ response: responseValue.trim() }, 'Response saved')}>Save response</Button>
            </div>

            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />Confidential notes (admins only)</p>
              {g.notes?.length ? (
                <ul className="space-y-2">
                  {g.notes.map(n => (
                    <li key={n.id} className="text-sm bg-white rounded-lg p-2 border border-amber-100">
                      <p className="whitespace-pre-line break-words">{n.text}</p>
                      <p className="text-[11px] text-slate-500 mt-1">{n.author_name} · {timeAgo(n.created_at)}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-slate-500">No notes yet</p>}
              <div className="flex flex-col sm:flex-row gap-2">
                <Textarea rows={2} value={note} maxLength={5000} onChange={e => setNote(e.target.value)} placeholder="Add an investigation note" className="bg-white" />
                <Button size="sm" className="gap-1 sm:self-end" disabled={busy || !note.trim()} onClick={addNote}><StickyNote className="w-4 h-4" />Add</Button>
              </div>
            </div>

            {g.history?.length > 0 && (
              <ol className="text-[11px] text-slate-500 space-y-0.5">
                {g.history.map((h, i) => <li key={i}>{titleCase(h.status)} · {fmtDateTime(h.at)}{h.by_name ? ` · ${h.by_name}` : ''}</li>)}
              </ol>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Cases() {
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const params = { ...(status !== 'all' ? { status } : {}), ...(category !== 'all' ? { category } : {}) };
  const { data, loading, error, reload } = useApi(`${API}/grievances`, { params });
  const [openId, setOpenId] = useState(null);
  const list = data?.grievances || [];

  const download = () => exportCsv('grievances', list, [
    { key: 'tracking_code', label: 'Tracking code' }, { key: 'category', label: 'Category' }, { key: 'subject', label: 'Subject' },
    { key: 'status', label: 'Status' }, { label: 'Reporter', value: r => (r.anonymous ? 'Anonymous' : r.reporter_name) },
    { key: 'reporter_department', label: 'Department' }, { label: 'Filed', value: r => r.created_at }, { label: 'Updated', value: r => r.updated_at },
  ]);

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {['all', ...STATUSES].map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-3 py-1 rounded-full text-xs border ${status === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {titleCase(s)}{s !== 'all' && data?.counts?.[s] ? ` (${data.counts[s]})` : ''}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 sm:h-10 sm:w-48 text-xs sm:text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}
              </SelectContent>
            </Select>
            <ExportButton onClick={download} disabled={!list.length} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length} emptyProps={{ icon: ShieldAlert, title: 'No grievances' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Case</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Reporter</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(g.id)}>
                    <td className="px-4 py-3 min-w-[160px]">
                      <p className="font-medium text-slate-900 break-words">{g.subject}</p>
                      <p className="text-[11px] text-slate-500">{titleCase(g.category)} · <span className="font-mono">{g.tracking_code}</span></p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-600">{g.anonymous ? <span className="flex items-center gap-1"><EyeOff className="w-3.5 h-3.5" />Anonymous</span> : g.reporter_name}</td>
                    <td className="px-4 py-3"><StatusBadge status={g.status} /></td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs text-slate-500 whitespace-nowrap">{timeAgo(g.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateSwitch>
      </CardContent>
      {openId && <CaseDialog key={openId} id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </Card>
  );
}

export default function GrievancesPage() {
  const admin = isAdmin();
  const [version, setVersion] = useState(0);
  return (
    <PageShell>
      <PageHeader icon={ShieldAlert} title="Grievances" subtitle="Raise a concern safely — anonymously if you prefer"
        actions={<a href="/grievance-status" target="_blank" rel="noopener noreferrer" className="text-xs sm:text-sm text-sky-700 hover:underline flex items-center gap-1 justify-center">Public status page<ExternalLink className="w-3.5 h-3.5" /></a>} />
      <Tabs defaultValue={admin ? 'cases' : 'file'}>
        <TabsList className="flex-wrap h-auto">
          {admin && <TabsTrigger value="cases">Cases</TabsTrigger>}
          <TabsTrigger value="file">File</TabsTrigger>
          <TabsTrigger value="track">Track by code</TabsTrigger>
          <TabsTrigger value="mine">My grievances</TabsTrigger>
        </TabsList>
        {admin && <TabsContent value="cases" className="mt-4"><Cases /></TabsContent>}
        <TabsContent value="file" className="mt-4"><FileGrievance onFiled={() => setVersion(v => v + 1)} /></TabsContent>
        <TabsContent value="track" className="mt-4">
          <Card className="border-0 shadow-md"><CardContent className="p-3 sm:p-5"><GrievanceTracker /></CardContent></Card>
        </TabsContent>
        <TabsContent value="mine" className="mt-4"><MyGrievances version={version} /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
