import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, AlertTriangle, Download, CheckCircle, XCircle, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageHeader, Pill, Loading, Empty, ErrorState } from '../components/Shared';
import { REQUEST_STATUS, ISSUE_STATUS, CONDITIONS, fmtDate, isoDay, humanize, categoryLabel, errorText } from '../lib';

const REQUEST_FILTERS = ['open', 'pending', 'approved', 'fulfilled', 'rejected', 'cancelled', 'all'];
const ISSUE_FILTERS = ['active', 'open', 'in_repair', 'resolved', 'closed', 'all'];

export default function AssetRequestsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'issues' ? 'issues' : 'requests';
  const [requests, setRequests] = useState([]);
  const [issues, setIssues] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reqFilter, setReqFilter] = useState('open');
  const [issueFilter, setIssueFilter] = useState('active');
  const [action, setAction] = useState(null); // { type: 'approve'|'reject'|'fulfil', request }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, i, c] = await Promise.all([
        api.get('/v2/assets/requests', { params: { scope: 'all' } }),
        api.get('/v2/assets/issues'),
        api.get('/v2/assets/categories'),
      ]);
      setRequests(r.data);
      setIssues(i.data);
      setCategories(c.data);
    } catch (err) {
      setError(errorText(err, 'Failed to load requests'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shownRequests = useMemo(() => requests.filter(r =>
    reqFilter === 'all' ? true : reqFilter === 'open' ? ['pending', 'approved'].includes(r.status) : r.status === reqFilter), [requests, reqFilter]);
  const shownIssues = useMemo(() => issues.filter(i =>
    issueFilter === 'all' ? true : issueFilter === 'active' ? ['open', 'in_repair'].includes(i.status) : i.status === issueFilter), [issues, issueFilter]);

  const updateIssue = async (id, status) => {
    try {
      await api.put(`/v2/assets/issues/${id}`, { status });
      toast.success(`Issue marked ${humanize(status).toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to update issue'));
    }
  };

  const doExport = () => {
    if (tab === 'requests') {
      exportCsv('asset-requests', shownRequests, [
        { key: 'employee_name', label: 'Employee' }, { key: 'employee_email', label: 'Email' }, { key: 'department', label: 'Department' },
        { label: 'Category', value: r => categoryLabel(categories, r.category) }, { key: 'justification', label: 'Justification' },
        { label: 'Needed by', value: r => isoDay(r.needed_by) }, { key: 'status', label: 'Status' },
        { key: 'fulfilled_asset_tag', label: 'Issued asset' }, { key: 'admin_comments', label: 'Comments' }, { label: 'Requested on', value: r => isoDay(r.created_at) },
      ]);
    } else {
      exportCsv('asset-issues', shownIssues, [
        { key: 'asset_tag', label: 'Asset tag' }, { key: 'asset_name', label: 'Asset' }, { key: 'reported_by_name', label: 'Reported by' },
        { key: 'severity', label: 'Severity' }, { key: 'description', label: 'Description' }, { key: 'status', label: 'Status' },
        { key: 'resolution_notes', label: 'Resolution' }, { label: 'Reported on', value: r => isoDay(r.created_at) },
      ]);
    }
  };

  const openReq = requests.filter(r => ['pending', 'approved'].includes(r.status)).length;
  const activeIssues = issues.filter(i => ['open', 'in_repair'].includes(i.status)).length;

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="w-full space-y-5 sm:space-y-6">
        <PageHeader icon={ClipboardList} title="Asset Requests" subtitle="Approve and fulfil requests, and handle reported issues">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={doExport}><Download className="w-4 h-4" /> Export CSV</Button>
        </PageHeader>

        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <Tabs value={tab} onValueChange={(v) => setParams(v === 'issues' ? { tab: 'issues' } : {}, { replace: true })}>
                <TabsList className="bg-slate-100">
                  <TabsTrigger value="requests" className="gap-1.5"><ClipboardList className="w-4 h-4" /> Requests {openReq > 0 && <span className="text-[10px] bg-amber-500 text-white rounded-full px-1.5">{openReq}</span>}</TabsTrigger>
                  <TabsTrigger value="issues" className="gap-1.5"><AlertTriangle className="w-4 h-4" /> Issues {activeIssues > 0 && <span className="text-[10px] bg-amber-500 text-white rounded-full px-1.5">{activeIssues}</span>}</TabsTrigger>
                </TabsList>
              </Tabs>
              {tab === 'requests' ? (
                <Select value={reqFilter} onValueChange={setReqFilter}>
                  <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{REQUEST_FILTERS.map(f => <SelectItem key={f} value={f}>{humanize(f)}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Select value={issueFilter} onValueChange={setIssueFilter}>
                  <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{ISSUE_FILTERS.map(f => <SelectItem key={f} value={f}>{f === 'active' ? 'Open & in repair' : humanize(f)}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : tab === 'requests' ? (
              shownRequests.length === 0 ? <Empty icon={ClipboardList} title="No requests here" /> : (
                <div className="divide-y divide-slate-100">
                  {shownRequests.map(r => (
                    <div key={r.id} className="p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900 text-sm">{r.employee_name}</p>
                          <span className="text-xs text-slate-500">{r.department}</span>
                          <Pill map={REQUEST_STATUS} value={r.status} />
                        </div>
                        <p className="text-sm text-slate-800 mt-0.5"><span className="font-medium">{categoryLabel(categories, r.category)}</span> — {r.justification}</p>
                        <p className="text-[11px] text-slate-400">Requested {fmtDate(r.created_at)}{r.needed_by ? ` · needed by ${fmtDate(r.needed_by)}` : ''}{r.fulfilled_asset_tag ? ` · issued ${r.fulfilled_asset_tag}` : ''}</p>
                        {r.admin_comments && <p className="text-xs text-slate-500 italic">“{r.admin_comments}”</p>}
                      </div>
                      {['pending', 'approved'].includes(r.status) && (
                        <div className="flex flex-wrap gap-2 shrink-0">
                          {r.status === 'pending' && <Button size="sm" variant="outline" className="gap-1" onClick={() => setAction({ type: 'approve', request: r })}><CheckCircle className="w-3.5 h-3.5" /> Approve</Button>}
                          <Button size="sm" className="gap-1" onClick={() => setAction({ type: 'fulfil', request: r })}><PackageCheck className="w-3.5 h-3.5" /> Fulfil</Button>
                          <Button size="sm" variant="ghost" className="gap-1 text-red-600 hover:bg-red-50" onClick={() => setAction({ type: 'reject', request: r })}><XCircle className="w-3.5 h-3.5" /> Reject</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              shownIssues.length === 0 ? <Empty icon={AlertTriangle} title="No issues here" /> : (
                <div className="divide-y divide-slate-100">
                  {shownIssues.map(i => (
                    <div key={i.id} className="p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/assets/${i.asset_id}`} className="font-semibold text-slate-900 text-sm hover:underline">{i.asset_tag} · {i.asset_name}</Link>
                          <Pill map={ISSUE_STATUS} value={i.status} />
                          <span className={`text-[11px] font-medium ${i.severity === 'high' ? 'text-red-600' : i.severity === 'medium' ? 'text-amber-600' : 'text-slate-500'}`}>{humanize(i.severity)}</span>
                        </div>
                        <p className="text-sm text-slate-800 mt-0.5 break-words">{i.description}</p>
                        <p className="text-[11px] text-slate-400">{i.reported_by_name} · {fmtDate(i.created_at)}</p>
                        {i.resolution_notes && <p className="text-xs text-slate-500 italic">{i.resolution_notes}</p>}
                      </div>
                      {['open', 'in_repair'].includes(i.status) && (
                        <div className="flex flex-wrap gap-2 shrink-0">
                          {i.status === 'open' && <Button size="sm" variant="outline" onClick={() => updateIssue(i.id, 'in_repair')}>Send to repair</Button>}
                          <Button size="sm" variant="outline" onClick={() => updateIssue(i.id, 'resolved')}>Resolve</Button>
                          {i.status === 'open' && <Button size="sm" variant="ghost" onClick={() => updateIssue(i.id, 'closed')}>Close</Button>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {action?.type === 'fulfil' && <FulfilDialog request={action.request} categories={categories} onClose={() => setAction(null)} onDone={load} />}
      {(action?.type === 'approve' || action?.type === 'reject') && <DecisionDialog action={action} categories={categories} onClose={() => setAction(null)} onDone={load} />}
    </div>
  );
}

function DecisionDialog({ action, categories, onClose, onDone }) {
  const { type, request } = action;
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (type === 'reject' && comments.trim().length < 3) return toast.error('Give a reason for rejecting');
    setSaving(true);
    try {
      await api.post(`/v2/assets/requests/${request.id}/${type}`, { comments: comments.trim() });
      toast.success(type === 'approve' ? 'Request approved' : 'Request rejected');
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Action failed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{type === 'approve' ? 'Approve' : 'Reject'} {request.employee_name}’s {categoryLabel(categories, request.category).toLowerCase()} request</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dec-comments">Comments {type === 'reject' ? '*' : '(optional)'}</Label>
          <Textarea id="dec-comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className={type === 'reject' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}>
            {saving ? 'Saving…' : type === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FulfilDialog({ request, categories, onClose, onDone }) {
  const [assets, setAssets] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({ asset_id: '', expected_return_date: '', condition: 'good', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/v2/assets/items', { params: { status: 'available' } })
      .then(r => setAssets(r.data))
      .catch(() => { setAssets([]); toast.error('Failed to load available assets'); });
  }, []);

  const options = (assets || []).filter(a => showAll || a.category === request.category);

  const submit = async () => {
    if (!form.asset_id) return toast.error('Choose an asset to hand over');
    setSaving(true);
    try {
      await api.post(`/v2/assets/requests/${request.id}/fulfil`, { ...form, expected_return_date: form.expected_return_date || null });
      toast.success('Request fulfilled and asset assigned');
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to fulfil request'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Fulfil {request.employee_name}’s request</DialogTitle></DialogHeader>
        {assets === null ? <Loading label="Loading available assets…" /> : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Available {showAll ? 'assets' : categoryLabel(categories, request.category).toLowerCase()}</Label>
                <button type="button" className="text-xs text-sky-700 hover:underline" onClick={() => setShowAll(s => !s)}>{showAll ? 'Only this category' : 'Show all categories'}</button>
              </div>
              {options.length === 0 ? (
                <p className="text-sm text-amber-700">No available assets{showAll ? '' : ' in this category'}. Add one to the register first.</p>
              ) : (
                <Select value={form.asset_id} onValueChange={(v) => setForm({ ...form, asset_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                  <SelectContent>{options.map(a => <SelectItem key={a.id} value={a.id}>{a.asset_tag} · {a.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ff-return">Expected return</Label>
                <Input id="ff-return" type="date" min={isoDay(new Date())} value={form.expected_return_date} onChange={(e) => setForm({ ...form, expected_return_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONDITIONS.map(c => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Handover notes (optional)" />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.asset_id}>{saving ? 'Assigning…' : 'Assign & fulfil'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
