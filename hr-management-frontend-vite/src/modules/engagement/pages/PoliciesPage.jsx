import { useState } from 'react';
import { FileCheck2, Plus, FileText, Download, CheckCircle2, AlertTriangle, Clock, BellRing, Pencil, Trash2, Upload, History, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import Markdown from '../components/Markdown';
import AudiencePicker from '../components/AudiencePicker';
import { PageShell, PageHeader, StateSwitch, ExportButton, ProgressBar, StatCard, LoadingState, ErrorState } from '../components/PageShell';
import { API, PRIMARY_BTN, useApi, currentRole, errorMessage, fmtDate, fmtDateTime, fileUrl, audienceLabel } from '../lib';

const statusBadge = (p) => {
  if (!p.my_ack?.required) return <Badge variant="outline" className="text-[10px] text-slate-500">For information</Badge>;
  if (p.my_ack.acknowledged) return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px] gap-1"><CheckCircle2 className="w-3 h-3" />Acknowledged</Badge>;
  if (p.overdue) return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 text-[10px] gap-1"><AlertTriangle className="w-3 h-3" />Overdue</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
};

function PolicyViewer({ policyId, onClose, onAcknowledged }) {
  const { data: p, loading, error, reload } = useApi(policyId ? `${API}/policies/${policyId}` : null);
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);

  const acknowledge = async () => {
    setSaving(true);
    try {
      await api.post(`${API}/policies/${p.id}/acknowledge`, { version: p.version });
      toast.success('Thanks — your acknowledgement is recorded');
      onAcknowledged();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not record acknowledgement'));
      if (err?.response?.status === 409) reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!policyId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {p && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 break-words">{p.title}</DialogTitle>
              <DialogDescription>
                Version {p.version} · Published {fmtDate(p.published_at)}{p.category ? ` · ${p.category}` : ''}
                {p.due_date && ` · Acknowledge by ${fmtDate(p.due_date)}`}
              </DialogDescription>
            </DialogHeader>
            {p.change_note && <p className="text-xs bg-sky-50 text-sky-800 rounded-md px-3 py-2">What changed: {p.change_note}</p>}
            {p.file_url && (
              <a href={fileUrl(p.file_url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
                <FileText className="w-5 h-5 text-rose-500 shrink-0" />
                <span className="truncate flex-1">{p.file_name || 'Policy document.pdf'}</span>
                <Download className="w-4 h-4 text-slate-500" />
              </a>
            )}
            {p.body && <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-4"><Markdown text={p.body} /></div>}
            {p.my_ack?.required && (
              p.my_ack.acknowledged ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-md px-3 py-2">
                  <CheckCircle2 className="w-4 h-4" />You acknowledged version {p.version} on {fmtDateTime(p.my_ack.acknowledged_at)}
                </p>
              ) : (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox checked={agree} onCheckedChange={v => setAgree(!!v)} className="mt-0.5" />
                    I have read and understood this policy (version {p.version}) and agree to follow it.
                  </label>
                  <Button className="bg-slate-800 hover:bg-slate-900 w-full sm:w-auto" disabled={!agree || saving} onClick={acknowledge}>
                    {saving ? 'Saving…' : 'I have read and agree'}
                  </Button>
                </div>
              )
            )}
            {p.history?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><History className="w-3.5 h-3.5" />Previous versions</p>
                <ul className="text-xs text-slate-600 space-y-1">
                  {[...p.history].reverse().map(h => (
                    <li key={h.version}>
                      v{h.version} · {fmtDate(h.published_at)}{h.change_note ? ` · ${h.change_note}` : ''}
                      {h.file_url && <> · <a className="text-sky-700 underline" href={fileUrl(h.file_url)} target="_blank" rel="noopener noreferrer">PDF</a></>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TrackingDialog({ policy, onClose, canRemind }) {
  const { data, loading, error, reload } = useApi(policy ? `${API}/policies/${policy.id}/acknowledgements` : null);
  const [reminding, setReminding] = useState(false);

  const remind = async () => {
    setReminding(true);
    try {
      const res = await api.post(`${API}/policies/${policy.id}/remind`);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not send reminders'));
    } finally {
      setReminding(false);
    }
  };

  const download = () => exportCsv(`policy-acknowledgements`, [
    ...(data?.acknowledged || []).map(r => ({ ...r, state: 'Acknowledged' })),
    ...(data?.pending || []).map(r => ({ ...r, state: 'Pending' })),
  ], [
    { key: 'full_name', label: 'Name' },
    { key: 'employee_code', label: 'Employee ID' },
    { key: 'email', label: 'Email' },
    { key: 'department', label: 'Department' },
    { key: 'state', label: 'Status' },
    { label: 'Version', value: r => r.version || '' },
    { label: 'Acknowledged at', value: r => (r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : '') },
  ]);

  return (
    <Dialog open={!!policy} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 break-words">Acknowledgements</DialogTitle>
          <DialogDescription className="break-words">{policy?.title} · v{policy?.version}{data?.scope === 'team' ? ' · your team' : ''}</DialogDescription>
        </DialogHeader>
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">{data.acknowledged_count} of {data.total} acknowledged</span>
                <span className="font-semibold">{data.percent}%</span>
              </div>
              <ProgressBar value={data.percent} />
              {data.policy.overdue && data.pending_count > 0 && <p className="text-xs text-rose-600 mt-1">Past due date ({fmtDate(data.policy.due_date)})</p>}
            </div>
            <Tabs defaultValue="pending">
              <TabsList className="w-full">
                <TabsTrigger value="pending" className="flex-1">Pending ({data.pending_count})</TabsTrigger>
                <TabsTrigger value="done" className="flex-1">Acknowledged ({data.acknowledged_count})</TabsTrigger>
              </TabsList>
              <TabsContent value="pending">
                <ul className="divide-y divide-slate-100 text-sm max-h-72 overflow-y-auto">
                  {data.pending.map(r => (
                    <li key={r.email} className="py-2 flex justify-between gap-2">
                      <span className="truncate">{r.full_name}</span>
                      <span className="text-xs text-slate-500 shrink-0">{r.department || '—'}</span>
                    </li>
                  ))}
                  {!data.pending.length && <li className="py-6 text-center text-xs text-slate-500">Everyone has acknowledged 🎉</li>}
                </ul>
              </TabsContent>
              <TabsContent value="done">
                <ul className="divide-y divide-slate-100 text-sm max-h-72 overflow-y-auto">
                  {data.acknowledged.map(r => (
                    <li key={r.email} className="py-2 flex justify-between gap-2">
                      <span className="truncate">{r.full_name}<span className="block text-[11px] text-slate-500">{r.department || '—'}</span></span>
                      <span className="text-xs text-slate-500 shrink-0">{fmtDateTime(r.acknowledged_at)}</span>
                    </li>
                  ))}
                  {!data.acknowledged.length && <li className="py-6 text-center text-xs text-slate-500">No acknowledgements yet</li>}
                </ul>
              </TabsContent>
            </Tabs>
          </div>
        )}
        <DialogFooter className="gap-2">
          <ExportButton onClick={download} disabled={!data} />
          {canRemind && (
            <Button variant="outline" className="gap-2" onClick={remind} disabled={reminding || !data?.pending_count}>
              <BellRing className="w-4 h-4" />{reminding ? 'Sending…' : 'Remind pending'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY = { title: '', category: '', body: '', requires_ack: true, due_date: '', audience: { type: 'everyone', departments: [] }, file: null, change_note: '' };

/** mode: 'create' | 'edit' | 'version' */
function PolicyEditor({ mode, policy, onClose, onSaved }) {
  const [form, setForm] = useState(policy ? {
    ...EMPTY,
    title: policy.title,
    category: policy.category || '',
    body: policy.body || '',
    requires_ack: policy.requires_ack,
    due_date: policy.due_date ? String(policy.due_date).slice(0, 10) : '',
    audience: policy.audience || EMPTY.audience,
  } : EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (mode !== 'version' && !form.title.trim()) return toast.error('Title is required');
    if (mode === 'create' && !form.body.trim() && !form.file) return toast.error('Add the policy text or upload a PDF');
    if (form.audience.type === 'departments' && !form.audience.departments.length) return toast.error('Pick at least one department');
    setSaving(true);
    try {
      if (mode === 'edit') {
        await api.put(`${API}/policies/${policy.id}`, {
          title: form.title.trim(),
          category: form.category.trim() || null,
          requires_ack: form.requires_ack,
          due_date: form.due_date || null,
          audience: form.audience,
        });
        toast.success('Policy updated');
      } else {
        const fd = new FormData();
        if (mode === 'create') {
          fd.append('title', form.title.trim());
          fd.append('category', form.category.trim());
          fd.append('requires_ack', String(form.requires_ack));
          fd.append('audience', JSON.stringify(form.audience));
        } else {
          fd.append('change_note', form.change_note.trim());
          fd.append('keep_file', String(!form.file && !!policy?.file_url && !form.drop_file));
        }
        fd.append('body', form.body.trim());
        fd.append('due_date', form.due_date || '');
        if (form.file) fd.append('file', form.file);
        const url = mode === 'create' ? `${API}/policies` : `${API}/policies/${policy.id}/versions`;
        await api.post(url, fd);
        toast.success(mode === 'create' ? 'Policy published' : 'New version published — everyone must acknowledge again');
      }
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the policy'));
    } finally {
      setSaving(false);
    }
  };

  const titles = { create: 'Publish a policy', edit: 'Edit policy details', version: 'Publish a new version' };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titles[mode]}</DialogTitle>
          {mode === 'version' && <DialogDescription>Publishing v{(policy?.version || 0) + 1} resets acknowledgements.</DialogDescription>}
          {mode === 'edit' && <DialogDescription>To change the text or document, publish a new version.</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          {mode !== 'version' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pol-title">Title</Label>
                <Input id="pol-title" value={form.title} maxLength={200} onChange={e => set('title', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pol-cat">Category</Label>
                <Input id="pol-cat" value={form.category} maxLength={80} placeholder="e.g. HR, IT" onChange={e => set('category', e.target.value)} />
              </div>
            </div>
          )}
          {mode !== 'edit' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pol-body">Policy text</Label>
                <Textarea id="pol-body" rows={8} value={form.body} onChange={e => set('body', e.target.value)} placeholder="Supports **bold**, *italics*, links and - bullet lists" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pol-file">PDF document (optional, max 10 MB)</Label>
                <Input id="pol-file" type="file" accept="application/pdf,.pdf" onChange={e => set('file', e.target.files?.[0] || null)} />
                {mode === 'version' && policy?.file_url && !form.file && (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <Checkbox checked={!!form.drop_file} onCheckedChange={v => set('drop_file', !!v)} />
                    Remove the current PDF ({policy.file_name})
                  </label>
                )}
              </div>
            </>
          )}
          {mode === 'version' && (
            <div className="space-y-1.5">
              <Label htmlFor="pol-note">What changed?</Label>
              <Input id="pol-note" value={form.change_note} maxLength={500} onChange={e => set('change_note', e.target.value)} />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pol-due">Acknowledge by (optional)</Label>
              <Input id="pol-due" type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </div>
            {mode !== 'version' && (
              <label className="flex items-center gap-3 text-sm sm:pt-6">
                <Switch checked={form.requires_ack} onCheckedChange={v => set('requires_ack', v)} />
                Requires acknowledgement
              </label>
            )}
          </div>
          {mode !== 'version' && <AudiencePicker value={form.audience} onChange={v => set('audience', v)} />}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-slate-800 hover:bg-slate-900 gap-2" onClick={save} disabled={saving}>
            {mode !== 'edit' && <Upload className="w-4 h-4" />}
            {saving ? 'Saving…' : mode === 'edit' ? 'Save' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MyPolicies({ onOpen, onTrack, role }) {
  const { data, loading, error, reload } = useApi(`${API}/policies`, { initial: [] });
  const list = data || [];
  const pending = list.filter(p => p.my_ack?.pending);

  const download = () => exportCsv('my-policies', list, [
    { key: 'title', label: 'Policy' },
    { key: 'category', label: 'Category' },
    { key: 'version', label: 'Version' },
    { label: 'Published', value: r => r.published_at },
    { label: 'Due', value: r => (r.due_date ? String(r.due_date).slice(0, 10) : '') },
    { label: 'Status', value: r => (!r.my_ack?.required ? 'Information' : r.my_ack.acknowledged ? 'Acknowledged' : r.overdue ? 'Overdue' : 'Pending') },
    { label: 'Acknowledged at', value: r => r.my_ack?.acknowledged_at || '' },
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
        <StatCard label="Policies" value={loading ? '—' : list.length} icon={FileText} tone="slate" />
        <StatCard label="To acknowledge" value={loading ? '—' : pending.length} icon={Clock} tone="amber" />
        <StatCard label="Overdue" value={loading ? '—' : pending.filter(p => p.overdue).length} icon={AlertTriangle} tone="rose" />
      </div>
      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2"><FileCheck2 className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />Company policies</CardTitle>
          <ExportButton onClick={download} disabled={!list.length} />
        </CardHeader>
        <CardContent className="p-0">
          <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
            emptyProps={{ icon: FileCheck2, title: 'No policies published yet' }}>
            <ul className="divide-y divide-slate-100">
              {[...pending, ...list.filter(p => !p.my_ack?.pending)].map(p => (
                <li key={p.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-slate-50">
                  <button className="flex items-start gap-3 text-left min-w-0 flex-1" onClick={() => onOpen(p.id)}>
                    <FileText className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="font-medium text-sm text-slate-900 block break-words">{p.title}</span>
                      <span className="text-xs text-slate-500">
                        v{p.version} · {fmtDate(p.published_at)}{p.category ? ` · ${p.category}` : ''}
                        {p.my_ack?.pending && p.due_date && ` · due ${fmtDate(p.due_date)}`}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 pl-8 sm:pl-0">
                    {statusBadge(p)}
                    {role === 'manager' && p.requires_ack && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onTrack(p)}><Users className="w-3.5 h-3.5" />Team</Button>
                    )}
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpen(p.id)}>{p.my_ack?.pending ? 'Read & acknowledge' : 'View'}</Button>
                  </div>
                </li>
              ))}
            </ul>
          </StateSwitch>
        </CardContent>
      </Card>
    </div>
  );
}

function ManagePolicies({ onOpen, onTrack, editor, setEditor, version }) {
  const { data, loading, error, reload } = useApi(`${API}/policies`, { initial: [], params: { v: version } });
  const list = data || [];

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.title}" and all its acknowledgements?`)) return;
    try {
      await api.delete(`${API}/policies/${p.id}`);
      toast.success('Policy deleted');
      reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete'));
    }
  };

  const download = () => exportCsv('policies', list, [
    { key: 'title', label: 'Policy' },
    { key: 'category', label: 'Category' },
    { key: 'version', label: 'Version' },
    { label: 'Audience', value: r => audienceLabel(r.audience) },
    { label: 'Requires acknowledgement', value: r => (r.requires_ack ? 'Yes' : 'No') },
    { label: 'Due', value: r => (r.due_date ? String(r.due_date).slice(0, 10) : '') },
    { label: 'Acknowledged', value: r => r.stats?.acknowledged ?? '' },
    { label: 'Required', value: r => r.stats?.total ?? '' },
    { label: 'Percent', value: r => r.stats?.percent ?? '' },
  ]);

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base sm:text-lg">All policies</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <ExportButton onClick={download} disabled={!list.length} />
            <Button className={PRIMARY_BTN} onClick={() => setEditor({ mode: 'create' })}><Plus className="w-4 h-4" />Publish policy</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
          emptyProps={{ icon: FileCheck2, title: 'No policies yet', hint: 'Publish your first policy and track who has acknowledged it.' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Policy</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Audience</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Due</th>
                  <th className="text-left font-medium px-4 py-3">Acknowledged</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 min-w-[160px]">
                      <button className="font-medium text-slate-900 text-left hover:underline break-words" onClick={() => onOpen(p.id)}>{p.title}</button>
                      <p className="text-[11px] text-slate-500">v{p.version} · {fmtDate(p.published_at)}{p.file_url ? ' · PDF' : ''}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-600">{audienceLabel(p.audience)}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs whitespace-nowrap">
                      {p.due_date ? <span className={p.overdue ? 'text-rose-600' : 'text-slate-600'}>{fmtDate(p.due_date)}</span> : '—'}
                    </td>
                    <td className="px-4 py-3 min-w-[120px]">
                      {p.requires_ack ? (
                        <button className="w-full text-left" onClick={() => onTrack(p)}>
                          <div className="flex justify-between text-[11px] text-slate-600 mb-1"><span>{p.stats?.acknowledged}/{p.stats?.total}</span><span>{p.stats?.percent}%</span></div>
                          <ProgressBar value={p.stats?.percent || 0} className="h-1.5" />
                        </button>
                      ) : <span className="text-xs text-slate-400">Info only</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="New version" onClick={async () => {
                          try {
                            const full = await api.get(`${API}/policies/${p.id}`);
                            setEditor({ mode: 'version', policy: full.data });
                          } catch (err) { toast.error(errorMessage(err)); }
                        }}><Upload className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit details" onClick={() => setEditor({ mode: 'edit', policy: p })}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" title="Delete" onClick={() => remove(p)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateSwitch>
      </CardContent>
      {editor && <PolicyEditor key={`${editor.mode}-${editor.policy?.id || 'new'}`} {...editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); reload(); }} />}
    </Card>
  );
}

export default function PoliciesPage() {
  const role = currentRole();
  const admin = role === 'admin';
  const [viewing, setViewing] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [editor, setEditor] = useState(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion(v => v + 1);

  return (
    <PageShell>
      <PageHeader icon={FileCheck2} title="Policies" subtitle="Read company policies and confirm you agree" />
      {admin ? (
        <Tabs defaultValue="manage">
          <TabsList>
            <TabsTrigger value="manage">Manage</TabsTrigger>
            <TabsTrigger value="mine">My policies</TabsTrigger>
          </TabsList>
          <TabsContent value="manage" className="mt-4">
            <ManagePolicies onOpen={setViewing} onTrack={setTracking} editor={editor} setEditor={setEditor} version={version} />
          </TabsContent>
          <TabsContent value="mine" className="mt-4">
            <MyPolicies key={version} onOpen={setViewing} onTrack={setTracking} role={role} />
          </TabsContent>
        </Tabs>
      ) : (
        <MyPolicies key={version} onOpen={setViewing} onTrack={setTracking} role={role} />
      )}
      {viewing && <PolicyViewer key={viewing} policyId={viewing} onClose={() => setViewing(null)} onAcknowledged={() => { setViewing(null); refresh(); }} />}
      {tracking && <TrackingDialog key={tracking.id} policy={tracking} canRemind={admin} onClose={() => setTracking(null)} />}
    </PageShell>
  );
}
