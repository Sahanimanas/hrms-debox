import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Download, Search, UserX, Check, X, Calculator, Plus, Trash2, FileDown, ListChecks, Ban, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, fmtDate, fmtMoney, todayYmd, SEPARATION_STATUS, OWNER_LABELS, humanize, downloadFile } from '../lib';
import { useEmployees } from '../hooks';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, StatusPill, StatTile, NativeSelect, Avatar, ProgressBar } from '../components/ui';
import ChecklistTasks from '../components/ChecklistTasks';
import LifecycleSettingsCard from '../components/LifecycleSettingsCard';

const CATEGORIES = ['knowledge_transfer', 'access', 'assets', 'finance', 'other'];
const OWNERS = ['hr', 'manager', 'employee', 'it'];

const SettlementPanel = ({ sep, onChange }) => {
  const [line, setLine] = useState({ label: '', type: 'earning', amount: '', detail: '' });
  const [busy, setBusy] = useState(false);
  const settlement = sep.settlement;
  const editable = sep.status === 'approved';

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await onChange();
    } catch (e) {
      toast.error(errMsg(e, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const compute = () => run(() => api.post(`${API}/offboarding/${sep.id}/settlement/compute`, {}), 'Settlement calculated');
  const addLine = () => {
    if (!line.label.trim() || !(Number(line.amount) > 0)) return toast.error('Enter a label and a positive amount');
    return run(async () => {
      await api.post(`${API}/offboarding/${sep.id}/settlement/lines`, { ...line, amount: Number(line.amount) });
      setLine({ label: '', type: 'earning', amount: '', detail: '' });
    }, 'Line added');
  };
  const removeLine = (id) => run(() => api.delete(`${API}/offboarding/${sep.id}/settlement/lines/${id}`));
  const finalize = async () => {
    if (!window.confirm('Finalize the settlement? This generates the statement PDF, marks the employee as exited and deactivates their login.')) return;
    setBusy(true);
    try {
      await api.post(`${API}/offboarding/${sep.id}/finalize`, {});
      toast.success('Settlement finalized — employee exited');
      await onChange();
    } catch (e) {
      const blockers = e.response?.data?.blockers;
      if (blockers?.length && window.confirm(`${blockers.join('\n')}\n\nFinalize anyway?`)) {
        try {
          await api.post(`${API}/offboarding/${sep.id}/finalize`, { force: true });
          toast.success('Settlement finalized — employee exited');
          await onChange();
        } catch (e2) {
          toast.error(errMsg(e2, 'Failed to finalize'));
        }
      } else if (!blockers?.length) {
        toast.error(errMsg(e, 'Failed to finalize'));
      }
    } finally {
      setBusy(false);
    }
  };

  const lines = settlement?.lines || [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Calculator className="w-4 h-4" />Full &amp; final settlement</h3>
        <div className="flex flex-wrap gap-2">
          {editable && <Button size="sm" variant="outline" disabled={busy} onClick={compute}>{settlement ? 'Recalculate' : 'Calculate'}</Button>}
          {settlement?.status === 'finalized' && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFile(`${API}/offboarding/${sep.id}/settlement/pdf`, `settlement-${sep.employee_uid}.pdf`).catch(() => toast.error('Download failed'))}>
              <FileDown className="w-3.5 h-3.5" />PDF
            </Button>
          )}
        </div>
      </div>
      {!settlement ? (
        <p className="text-xs text-slate-500">Not calculated yet. Calculation includes final-month salary, earned-leave encashment, gratuity, loan recovery and notice shortfall.</p>
      ) : (
        <>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {lines.map(l => (
                  <tr key={l.id}>
                    <td className="px-3 py-2">
                      <p className="text-slate-900">{l.label} {!l.auto && <Badge variant="outline" className="text-[10px] py-0 ml-1">Manual</Badge>}</p>
                      {l.detail && <p className="text-[11px] text-slate-500">{l.detail}</p>}
                    </td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${l.type === 'deduction' ? 'text-red-600' : 'text-emerald-700'}`}>
                      {l.type === 'deduction' ? '−' : '+'}{fmtMoney(l.amount)}
                    </td>
                    <td className="px-2 py-2 w-8">
                      {editable && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Remove line" disabled={busy} onClick={() => removeLine(l.id)}><Trash2 className="w-3.5 h-3.5 text-slate-400" /></Button>}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td className="px-3 py-3 text-xs text-slate-500" colSpan={3}>No lines</td></tr>}
              </tbody>
              <tfoot className="bg-slate-50 text-sm">
                <tr><td className="px-3 py-1.5 text-slate-600">Earnings</td><td className="px-3 py-1.5 text-right">{fmtMoney(settlement.totals?.earnings)}</td><td /></tr>
                <tr><td className="px-3 py-1.5 text-slate-600">Deductions</td><td className="px-3 py-1.5 text-right">{fmtMoney(settlement.totals?.deductions)}</td><td /></tr>
                <tr className="font-semibold"><td className="px-3 py-2">{settlement.totals?.net >= 0 ? 'Net payable' : 'Net recoverable'}</td><td className="px-3 py-2 text-right">{fmtMoney(Math.abs(settlement.totals?.net || 0))}</td><td /></tr>
              </tfoot>
            </table>
          </div>
          {settlement.notes?.length > 0 && <ul className="text-[11px] text-slate-500 list-disc pl-4">{settlement.notes.map(n => <li key={n}>{n}</li>)}</ul>}
        </>
      )}
      {editable && settlement && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Input className="col-span-2" placeholder="Manual line (e.g. Bonus)" value={line.label} onChange={(e) => setLine({ ...line, label: e.target.value })} />
          <NativeSelect value={line.type} onChange={(v) => setLine({ ...line, type: v })}>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
          </NativeSelect>
          <Input type="number" min={0} placeholder="Amount" value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} />
          <Button size="sm" variant="outline" className="h-9 gap-1" disabled={busy} onClick={addLine}><Plus className="w-3.5 h-3.5" />Add</Button>
        </div>
      )}
      {editable && (
        <div className="flex justify-end">
          <Button disabled={busy} onClick={finalize} className="gap-2"><Lock className="w-4 h-4" />Finalize &amp; exit employee</Button>
        </div>
      )}
    </div>
  );
};

const OffboardingPage = () => {
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState(null); // { kind: 'approve'|'reject', lwd, comments, waive }
  const [termOpen, setTermOpen] = useState(false);
  const [term, setTerm] = useState({ employee_uid: '', reason: '', last_working_day: todayYmd(), notes: '', waive_notice_recovery: true });
  const [template, setTemplate] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const employees = useEmployees(isAdmin);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/offboarding`);
      setList(r.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load offboarding'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadTemplate = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await api.get(`${API}/offboarding/template`);
      setTemplate(r.data.tasks);
    } catch { /* shown when the tab is opened */ }
  }, [isAdmin]);
  useEffect(() => { loadTemplate(); }, [loadTemplate]);

  const openDetail = useCallback(async (id) => {
    try {
      const r = await api.get(`${API}/offboarding/${id}`);
      setDetail(r.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to open'));
    }
  }, []);

  const refreshDetail = async () => {
    await openDetail(detail.id);
    load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(s => {
      if (status === 'active' && !['pending', 'approved'].includes(s.status)) return false;
      if (status !== 'active' && status !== 'all' && s.status !== status) return false;
      return !q || s.employee_name?.toLowerCase().includes(q) || s.department?.toLowerCase().includes(q);
    });
  }, [list, status, search]);

  const counts = useMemo(() => ({
    pending: list.filter(s => s.status === 'pending').length,
    notice: list.filter(s => s.status === 'approved').length,
    completed: list.filter(s => s.status === 'completed').length,
  }), [list]);

  const submitAction = async () => {
    setBusy(true);
    try {
      if (action.kind === 'approve') {
        await api.post(`${API}/offboarding/${detail.id}/approve`, {
          last_working_day: action.lwd || null,
          comments: action.comments || null,
          ...(isAdmin ? { waive_notice_recovery: action.waive } : {}),
        });
        toast.success('Approved — exit checklist created');
      } else {
        if ((action.comments || '').trim().length < 3) { setBusy(false); return toast.error('Please give a reason'); }
        await api.post(`${API}/offboarding/${detail.id}/reject`, { comments: action.comments });
        toast.success('Resignation rejected');
      }
      setAction(null);
      await refreshDetail();
    } catch (e) {
      toast.error(errMsg(e, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const cancelSeparation = async () => {
    if (!window.confirm('Cancel this separation and retain the employee?')) return;
    try {
      await api.post(`${API}/offboarding/${detail.id}/cancel`, {});
      toast.success('Separation cancelled');
      await refreshDetail();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to cancel'));
    }
  };

  const updateItem = async (item, body) => {
    try {
      await api.patch(`${API}/offboarding/${detail.id}/checklist/${item.id}`, body);
      await refreshDetail();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to update'));
    }
  };

  const addItem = async () => {
    if (!newItem.title.trim()) return toast.error('Title required');
    try {
      await api.post(`${API}/offboarding/${detail.id}/checklist`, newItem);
      setNewItem(null);
      await refreshDetail();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to add item'));
    }
  };

  const terminate = async () => {
    if (!term.employee_uid || term.reason.trim().length < 3 || !term.last_working_day) return toast.error('Employee, reason and last working day are required');
    setBusy(true);
    try {
      const r = await api.post(`${API}/offboarding/terminate`, { ...term, notes: term.notes || null });
      toast.success('Termination recorded');
      setTermOpen(false);
      setTerm({ employee_uid: '', reason: '', last_working_day: todayYmd(), notes: '', waive_notice_recovery: true });
      await load();
      openDetail(r.data.id);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to terminate'));
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (template.some(t => !t.title.trim())) return toast.error('Every item needs a title');
    try {
      const r = await api.put(`${API}/offboarding/template`, { tasks: template });
      setTemplate(r.data.tasks);
      toast.success('Exit checklist template saved');
    } catch (e) {
      toast.error(errMsg(e, 'Failed to save'));
    }
  };
  const setTpl = (i, k, v) => setTemplate(template.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));

  const doExport = () => exportCsv('offboarding', filtered, [
    { key: 'employee_name', label: 'Employee' },
    { key: 'department', label: 'Department' },
    { key: 'type', label: 'Type' },
    { key: 'status', label: 'Status' },
    { key: 'submitted_on', label: 'Submitted' },
    { label: 'Last working day', value: r => r.last_working_day || r.requested_last_day },
    { key: 'reason', label: 'Reason' },
    { label: 'Checklist', value: r => `${r.checklist_done}/${r.checklist_total}` },
    { label: 'Net settlement', value: r => r.settlement?.totals?.net ?? '' },
  ]);

  const canAct = detail && (detail.access === 'admin' || detail.access === 'manager');

  const pipeline = (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile label="Pending" value={counts.pending} icon={LogOut} tone="amber" onClick={() => setStatus('pending')} />
        <StatTile label="Serving notice" value={counts.notice} icon={ListChecks} tone="blue" onClick={() => setStatus('approved')} />
        <StatTile label="Exited" value={counts.completed} icon={UserX} tone="slate" onClick={() => setStatus('completed')} />
      </div>
      <SectionCard
        icon={LogOut}
        title="Separations"
        actions={<Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={doExport} disabled={!filtered.length}><Download className="w-3.5 h-3.5" />Export CSV</Button>}
      >
        <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search employee or department" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <NativeSelect value={status} onChange={setStatus} className="sm:w-44">
            <option value="active">Open (pending + notice)</option>
            <option value="pending">Pending</option>
            <option value="approved">Serving notice</option>
            <option value="completed">Exited</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </NativeSelect>
        </div>
        {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : filtered.length === 0 ? (
          <Empty icon={LogOut} title="No separations" hint="Resignations submitted by employees appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Employee</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Type</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Last day</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Checklist</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(s.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={s.employee_name} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{s.employee_name}</p>
                          <p className="text-xs text-slate-500 truncate">{s.designation || '—'} · {s.department || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize hidden md:table-cell">{s.type}</td>
                    <td className="px-4 py-3 whitespace-nowrap hidden sm:table-cell">{fmtDate(s.last_working_day || s.requested_last_day)}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{s.checklist_total ? `${s.checklist_done}/${s.checklist_total}` : '—'}</td>
                    <td className="px-4 py-3"><StatusPill map={SEPARATION_STATUS} status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const templateTab = (
    <SectionCard icon={ListChecks} title="Exit checklist template" actions={template && <Button size="sm" className="h-8" onClick={saveTemplate}>Save</Button>}>
      {!template ? <Loading /> : (
        <div className="p-3 sm:p-5 space-y-2">
          <p className="text-xs text-slate-500">Copied to every approved separation. Assigned assets are added automatically as “Return asset” items.</p>
          {template.map((t, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-2 space-y-2">
              <div className="flex gap-2">
                <Input value={t.title} placeholder="Item title" onChange={(e) => setTpl(i, 'title', e.target.value)} />
                <Button variant="ghost" size="icon" className="shrink-0 text-red-600" aria-label="Remove item" disabled={template.length === 1} onClick={() => setTemplate(template.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4" /></Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect value={t.category} onChange={(v) => setTpl(i, 'category', v)}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{humanize(c)}</option>)}
                </NativeSelect>
                <NativeSelect value={t.owner} onChange={(v) => setTpl(i, 'owner', v)}>
                  {OWNERS.map(o => <option key={o} value={o}>Owner: {OWNER_LABELS[o]}</option>)}
                </NativeSelect>
              </div>
            </div>
          ))}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTemplate([...template, { title: '', category: 'other', owner: 'hr' }])}><Plus className="w-3.5 h-3.5" />Add item</Button>
        </div>
      )}
    </SectionCard>
  );

  const checklist = detail?.checklist || [];
  const doneCount = checklist.filter(i => i.done).length;

  return (
    <PageShell>
      <PageHeader icon={LogOut} title="Offboarding" subtitle={isAdmin ? 'Resignations, exit checklists and full & final settlement' : "Your team's resignations and exit tasks"}>
        {isAdmin && <Button variant="outline" className="gap-2 w-full sm:w-auto text-red-600 hover:bg-red-50" onClick={() => setTermOpen(true)}><UserX className="w-4 h-4" />Initiate termination</Button>}
      </PageHeader>

      {isAdmin ? (
        <Tabs defaultValue="pipeline">
          <TabsList>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="template">Exit checklist</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="pipeline">{pipeline}</TabsContent>
          <TabsContent value="template">{templateTab}</TabsContent>
          <TabsContent value="settings"><LifecycleSettingsCard /></TabsContent>
        </Tabs>
      ) : pipeline}

      {/* Detail */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) { setDetail(null); setAction(null); setNewItem(null); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">{detail.employee_name} <StatusPill map={SEPARATION_STATUS} status={detail.status} /></DialogTitle>
                <p className="text-xs text-slate-500">{detail.designation || '—'} · {detail.department || '—'} · {detail.employee_uid}</p>
              </DialogHeader>
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-xs text-slate-500">Type</p><p className="font-medium capitalize">{detail.type}</p></div>
                  <div><p className="text-xs text-slate-500">Submitted</p><p className="font-medium">{fmtDate(detail.submitted_on)}</p></div>
                  <div><p className="text-xs text-slate-500">Requested last day</p><p className="font-medium">{fmtDate(detail.requested_last_day)}</p></div>
                  <div><p className="text-xs text-slate-500">Approved last day</p><p className="font-medium">{fmtDate(detail.last_working_day)}</p></div>
                  <div className="col-span-2 sm:col-span-4"><p className="text-xs text-slate-500">Reason</p><p className="break-words">{detail.reason}</p>{detail.notes && <p className="text-xs text-slate-500 mt-1 break-words">Note: {detail.notes}</p>}</div>
                  {detail.type === 'resignation' && detail.shortfall_days > 0 && (
                    <div className="col-span-2 sm:col-span-4 text-xs text-amber-700 bg-amber-50 rounded p-2">Requested date is {detail.shortfall_days} day(s) short of the {detail.notice_period_days}-day notice period.</div>
                  )}
                  {detail.action_comments && <div className="col-span-2 sm:col-span-4 text-xs italic text-slate-600">“{detail.action_comments}” — {detail.actioned_by_name}</div>}
                </div>

                {detail.status === 'pending' && canAct && (
                  action ? (
                    <div className="border border-slate-200 rounded-lg p-3 space-y-3">
                      {action.kind === 'approve' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Last working day</Label>
                            <Input type="date" value={action.lwd} onChange={(e) => setAction({ ...action, lwd: e.target.value })} />
                          </div>
                          {isAdmin && detail.type === 'resignation' && (
                            <div className="flex items-center gap-2 sm:pt-6">
                              <Switch id="waive" checked={!!action.waive} onCheckedChange={(v) => setAction({ ...action, waive: v })} />
                              <Label htmlFor="waive">Waive notice-shortfall recovery</Label>
                            </div>
                          )}
                        </div>
                      )}
                      <Textarea rows={2} placeholder={action.kind === 'approve' ? 'Comments (optional)' : 'Reason for rejection'} value={action.comments} onChange={(e) => setAction({ ...action, comments: e.target.value })} />
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => setAction(null)}>Back</Button>
                        <Button size="sm" disabled={busy} onClick={submitAction} className={action.kind === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}>
                          {action.kind === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={() => setAction({ kind: 'approve', lwd: detail.requested_last_day, comments: '', waive: false })}><Check className="w-4 h-4" />Approve</Button>
                      <Button variant="outline" className="text-red-600 hover:bg-red-50 gap-1.5" onClick={() => setAction({ kind: 'reject', comments: '' })}><X className="w-4 h-4" />Reject</Button>
                    </div>
                  )
                )}

                {checklist.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><ListChecks className="w-4 h-4" />Exit checklist</h3>
                      <span className="text-xs text-slate-500">{doneCount}/{checklist.length}</span>
                    </div>
                    <ProgressBar value={(doneCount / checklist.length) * 100} />
                    <div className="border border-slate-200 rounded-lg">
                      <ChecklistTasks
                        tasks={checklist}
                        showCategory
                        showDue={false}
                        canEdit={(i) => detail.status === 'approved' && (canAct || i.assignee_email === user?.email)}
                        onUpdate={updateItem}
                      />
                    </div>
                    {isAdmin && detail.status === 'approved' && (newItem ? (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <Input className="sm:col-span-2" placeholder="Item title" value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} />
                        <NativeSelect value={newItem.owner} onChange={(v) => setNewItem({ ...newItem, owner: v })}>
                          {OWNERS.map(o => <option key={o} value={o}>{OWNER_LABELS[o]}</option>)}
                        </NativeSelect>
                        <div className="flex gap-1">
                          <Button size="sm" className="h-9 flex-1" onClick={addItem}>Add</Button>
                          <Button size="sm" variant="outline" className="h-9" onClick={() => setNewItem(null)}>×</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNewItem({ title: '', owner: 'hr', category: 'other' })}><Plus className="w-3.5 h-3.5" />Add item</Button>
                    ))}
                    {detail.assigned_assets?.length > 0 && (
                      <p className="text-xs text-slate-500">Assigned assets: {detail.assigned_assets.map(a => `${a.name} (${a.asset_tag})`).join(', ')}</p>
                    )}
                  </div>
                )}

                {isAdmin && ['approved', 'completed'].includes(detail.status) && (
                  <SettlementPanel sep={detail} onChange={refreshDetail} />
                )}

                {isAdmin && detail.status === 'approved' && (
                  <div className="pt-2 border-t border-slate-100 flex justify-end">
                    <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 gap-1.5" onClick={cancelSeparation}><Ban className="w-3.5 h-3.5" />Cancel separation (retain employee)</Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Termination */}
      <Dialog open={termOpen} onOpenChange={setTermOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Initiate termination</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <NativeSelect value={term.employee_uid} onChange={(v) => setTerm({ ...term, employee_uid: v })}>
                <option value="">Select employee…</option>
                {employees.filter(e => !['exited', 'notice'].includes(e.employment_status) && e.email !== user?.email).map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.id})</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea rows={3} value={term.reason} onChange={(e) => setTerm({ ...term, reason: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Last working day</Label>
              <Input type="date" value={term.last_working_day} onChange={(e) => setTerm({ ...term, last_working_day: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="tw" checked={term.waive_notice_recovery} onCheckedChange={(v) => setTerm({ ...term, waive_notice_recovery: v })} />
              <Label htmlFor="tw">No notice-period recovery</Label>
            </div>
            <p className="text-xs text-slate-500">The separation is approved immediately; the employee moves to notice and an exit checklist is created.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTermOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={terminate} className="bg-red-600 hover:bg-red-700">{busy ? 'Saving…' : 'Terminate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default OffboardingPage;
