import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Laptop, Plus, CheckCircle, AlertTriangle, ClipboardList, History, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageHeader, Pill, Loading, Empty, ErrorState } from '../components/Shared';
import { IssueDialog } from './AssetDetailPage';
import { STATUS_MAP, REQUEST_STATUS, ISSUE_STATUS, fmtDate, isoDay, humanize, categoryLabel, errorText } from '../lib';

export default function MyAssetsPage() {
  const [data, setData] = useState({ assets: [], past_assignments: [] });
  const [requests, setRequests] = useState([]);
  const [issues, setIssues] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [issueAsset, setIssueAsset] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, reqs, iss, cats] = await Promise.all([
        api.get('/v2/assets/my-assets'),
        api.get('/v2/assets/requests', { params: { scope: 'mine' } }),
        api.get('/v2/assets/issues'),
        api.get('/v2/assets/categories'),
      ]);
      setData(mine.data);
      setRequests(reqs.data);
      setIssues(iss.data);
      setCategories(cats.data);
    } catch (err) {
      setError(errorText(err, 'Failed to load your assets'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const acknowledge = async (asset) => {
    try {
      await api.post(`/v2/assets/items/${asset.id}/acknowledge`);
      toast.success(`Receipt of ${asset.asset_tag} acknowledged`);
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to acknowledge'));
    }
  };

  const cancelRequest = async (id) => {
    try {
      await api.delete(`/v2/assets/requests/${id}`);
      toast.success('Request cancelled');
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to cancel'));
    }
  };

  const doExport = () => exportCsv('my-assets', data.assets, [
    { key: 'asset_tag', label: 'Asset tag' },
    { key: 'name', label: 'Name' },
    { label: 'Category', value: r => categoryLabel(categories, r.category) },
    { key: 'serial_number', label: 'Serial number' },
    { label: 'Status', value: r => STATUS_MAP[r.status]?.label || r.status },
    { label: 'Assigned on', value: r => isoDay(r.assigned_at) },
    { label: 'Expected return', value: r => isoDay(r.expected_return_date) },
    { label: 'Acknowledged', value: r => isoDay(r.acknowledged_at) },
  ]);

  const pendingAck = data.assets.filter(a => !a.acknowledged_at).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <PageHeader icon={Laptop} title="My Assets" subtitle="Company equipment issued to you, requests and issues">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={doExport} disabled={!data.assets.length}><Download className="w-4 h-4" /> Export CSV</Button>
          <Button size="sm" className="gap-1.5 bg-slate-800 hover:bg-slate-900" onClick={() => setRequestOpen(true)}><Plus className="w-4 h-4" /> Request an asset</Button>
        </PageHeader>

        {loading ? <Loading label="Loading your assets…" /> : error ? <Card className="border-0 shadow-md"><ErrorState message={error} onRetry={load} /></Card> : (
          <>
            {pendingAck > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {pendingAck} asset(s) waiting for you to acknowledge receipt.
              </div>
            )}

            <Card className="border-0 shadow-md">
              <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2"><Laptop className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> With you now</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.assets.length === 0 ? (
                  <Empty icon={Laptop} title="No assets are assigned to you">Need something? Use “Request an asset”.</Empty>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {data.assets.map(a => (
                      <div key={a.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={`/assets/${a.id}`} className="font-semibold text-slate-900 hover:underline">{a.name}</Link>
                            <Pill map={STATUS_MAP} value={a.status} />
                            {a.acknowledged_at
                              ? <span className="text-[11px] text-emerald-600 flex items-center gap-0.5"><CheckCircle className="w-3 h-3" /> Acknowledged</span>
                              : <span className="text-[11px] text-amber-600">Awaiting your acknowledgement</span>}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {a.asset_tag} · {categoryLabel(categories, a.category)}{a.serial_number ? ` · S/N ${a.serial_number}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            Since {fmtDate(a.assigned_at)}{a.expected_return_date ? ` · return by ${fmtDate(a.expected_return_date)}` : ''}
                            {a.assignment?.condition_at_handover ? ` · handed over ${a.assignment.condition_at_handover}` : ''}
                          </p>
                          {a.assignment?.handover_notes && <p className="text-xs text-slate-500 italic">{a.assignment.handover_notes}</p>}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {!a.acknowledged_at && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={() => acknowledge(a)}><CheckCircle className="w-3.5 h-3.5" /> Acknowledge</Button>}
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => setIssueAsset(a)}><AlertTriangle className="w-3.5 h-3.5" /> Report issue</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card className="border-0 shadow-md">
                <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2"><ClipboardList className="w-4 h-4 text-slate-600" /> My requests</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {requests.length === 0 ? <Empty title="No asset requests" /> : (
                    <div className="divide-y divide-slate-100">
                      {requests.map(r => (
                        <div key={r.id} className="p-3 sm:p-4 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-sm text-slate-900">{categoryLabel(categories, r.category)}</p>
                              <Pill map={REQUEST_STATUS} value={r.status} />
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5 break-words">{r.justification}</p>
                            <p className="text-[11px] text-slate-400">{fmtDate(r.created_at)}{r.needed_by ? ` · needed by ${fmtDate(r.needed_by)}` : ''}{r.fulfilled_asset_tag ? ` · issued ${r.fulfilled_asset_tag}` : ''}</p>
                            {r.admin_comments && <p className="text-xs text-slate-500 italic">“{r.admin_comments}”</p>}
                          </div>
                          {r.status === 'pending' && (
                            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 h-7 px-2" onClick={() => cancelRequest(r.id)} aria-label="Cancel request"><Trash2 className="w-3.5 h-3.5" /></Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-md">
                <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-slate-600" /> My issue reports</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {issues.length === 0 ? <Empty title="No issues reported" /> : (
                    <div className="divide-y divide-slate-100">
                      {issues.map(i => (
                        <div key={i.id} className="p-3 sm:p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-sm text-slate-900">{i.asset_tag} · {i.asset_name}</p>
                            <Pill map={ISSUE_STATUS} value={i.status} />
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 break-words">{i.description}</p>
                          <p className="text-[11px] text-slate-400">{humanize(i.severity)} · {fmtDate(i.created_at)}</p>
                          {i.resolution_notes && <p className="text-xs text-slate-500 italic">{i.resolution_notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {data.past_assignments.length > 0 && (
              <Card className="border-0 shadow-md">
                <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2"><History className="w-4 h-4 text-slate-600" /> Previously issued</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Asset</th>
                        <th className="text-left font-medium px-4 py-3">Issued</th>
                        <th className="text-left font-medium px-4 py-3">Returned</th>
                        <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Condition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.past_assignments.map(p => (
                        <tr key={p.id}>
                          <td className="px-4 py-3"><p className="text-slate-900">{p.asset_name}</p><p className="text-xs text-slate-500">{p.asset_tag}</p></td>
                          <td className="px-4 py-3 whitespace-nowrap">{fmtDate(p.assigned_at)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{p.status === 'lost' ? <span className="text-red-600">Lost</span> : fmtDate(p.returned_at)}</td>
                          <td className="px-4 py-3 hidden sm:table-cell">{humanize(p.return_condition) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {requestOpen && <RequestDialog categories={categories} onClose={() => setRequestOpen(false)} onDone={load} />}
      {issueAsset && <IssueDialog asset={issueAsset} onClose={() => setIssueAsset(null)} onDone={load} />}
    </div>
  );
}

function RequestDialog({ categories, onClose, onDone }) {
  const [form, setForm] = useState({ category: '', justification: '', needed_by: '' });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.category) return toast.error('Choose what you need');
    if (form.justification.trim().length < 10) return toast.error('Please explain why (at least 10 characters)');
    setSaving(true);
    try {
      await api.post('/v2/assets/requests', { category: form.category, justification: form.justification.trim(), needed_by: form.needed_by || null });
      toast.success('Request submitted');
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to submit request'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Request an asset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>What do you need?</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>{categories.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-why">Justification</Label>
            <Textarea id="rq-why" rows={3} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="e.g. Joining the on-call rotation from next month" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-by">Needed by <span className="text-slate-400 font-normal">(optional)</span></Label>
            <Input id="rq-by" type="date" min={isoDay(new Date())} value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Submitting…' : 'Submit request'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
