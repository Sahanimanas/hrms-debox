import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Banknote, ArrowLeft, RefreshCw, Lock, CheckCircle2, Send, Trash2, Download, Plus, AlertTriangle,
  Users, Wallet, Receipt, Building2, Landmark, FileText, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, StatCard, LoadingBlock, EmptyBlock, ErrorBlock, StatusPill, DataTable } from '../components/PayrollUI';
import PayslipDialog from '../components/PayslipDialog';
import { API, fmtINR, monthLabel, errMsg, fmtDate, downloadFile, blobErrMsg, RUN_STATUS_STYLES, ONE_OFF_LABELS } from '../lib';

const EMPTY_ADJ = { employee_uid: '', type: 'bonus', label: '', amount: '', taxable: true, note: '' };

export default function PayrollRunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'lock' | 'delete'
  const [showPay, setShowPay] = useState(false);
  const [payRef, setPayRef] = useState('');
  const [showAdj, setShowAdj] = useState(false);
  const [adj, setAdj] = useState(EMPTY_ADJ);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runRes, adjRes, compRes] = await Promise.all([
        api.get(`${API}/runs/${id}`),
        api.get(`${API}/runs/${id}/adjustments`),
        api.get(`${API}/runs/${id}/compliance`),
      ]);
      setRun(runRes.data);
      setAdjustments(adjRes.data || []);
      setCompliance(compRes.data);
    } catch (e) {
      setError(errMsg(e, 'Failed to load payroll run'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const act = async (key, fn, success) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const recompute = () => act('recompute', () => api.post(`${API}/runs/${id}/recompute`), 'Payroll recomputed');
  const lock = () => act('lock', () => api.post(`${API}/runs/${id}/lock`), 'Payroll locked — payslips are now final').then(() => setConfirm(null));
  const markPaid = () => act('pay', () => api.post(`${API}/runs/${id}/pay`, { payment_reference: payRef || null }), 'Marked as paid').then(() => setShowPay(false));
  const publish = () => act('publish', async () => {
    const res = await api.post(`${API}/runs/${id}/publish`);
    toast.info(res.data.email_configured ? `Emailing ${res.data.payslips} payslip(s)…` : 'Employees notified in-app (email is not configured)');
  }, 'Payslips published');
  const remove = async () => {
    setBusy('delete');
    try {
      await api.delete(`${API}/runs/${id}`);
      toast.success('Draft discarded');
      navigate('/payroll/runs');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const download = async (path, filename, params) => {
    setBusy(path);
    try {
      const res = await downloadFile(`${API}/runs/${id}/${path}`, filename, params);
      const missing = res.headers?.['x-missing-bank'] || res.headers?.['x-missing-uan'];
      if (missing && missing !== '0') toast.warning(`${missing} employee(s) left out — details missing`);
    } catch (e) {
      toast.error(await blobErrMsg(e));
    } finally {
      setBusy('');
    }
  };

  const downloadSlip = async (payslip) => {
    setBusy(`pdf-${payslip.id}`);
    try {
      await downloadFile(`${API}/payslips/${payslip.id}/pdf`, `payslip-${payslip.month}.pdf`);
    } catch (e) {
      toast.error(await blobErrMsg(e));
    } finally {
      setBusy('');
    }
  };

  const saveAdjustment = async () => {
    if (!adj.employee_uid) return toast.error('Pick an employee');
    if (!(Number(adj.amount) > 0)) return toast.error('Enter an amount');
    await act('adj', () => api.post(`${API}/runs/${id}/adjustments`, {
      employee_uid: adj.employee_uid,
      type: adj.type,
      label: adj.label || null,
      amount: Number(adj.amount),
      taxable: adj.type === 'other_deduction' ? false : adj.taxable,
      note: adj.note || null,
    }), 'Adjustment added and payslip recomputed');
    setShowAdj(false);
    setAdj(EMPTY_ADJ);
  };

  const deleteAdjustment = (adjId) => act(`adj-${adjId}`, () => api.delete(`${API}/runs/${id}/adjustments/${adjId}`), 'Adjustment removed');

  const payslips = useMemo(() => {
    const list = run?.payslips || [];
    const q = search.trim().toLowerCase();
    return q ? list.filter(p => `${p.employee_name} ${p.employee_code} ${p.department}`.toLowerCase().includes(q)) : list;
  }, [run, search]);

  if (loading && !run) return <PageShell icon={Banknote} title="Payroll run"><LoadingBlock /></PageShell>;
  if (error && !run) return <PageShell icon={Banknote} title="Payroll run"><ErrorBlock message={error} onRetry={load} /></PageShell>;
  if (!run) return null;

  const isDraft = run.status === 'draft';
  const t = run.totals || {};

  const exportSlips = () => exportCsv(`payroll-${run.month}`, run.payslips, [
    { key: 'employee_code', label: 'Employee code' },
    { key: 'employee_name', label: 'Name' },
    { key: 'department', label: 'Department' },
    { key: 'payable_days', label: 'Paid days' },
    { key: 'lop_days', label: 'LOP days' },
    { key: 'gross_earnings', label: 'Gross' },
    { key: 'lop_amount', label: 'LOP amount' },
    { label: 'PF (EE)', value: (p) => p.statutory?.pf_employee },
    { label: 'ESI (EE)', value: (p) => p.statutory?.esi_employee },
    { label: 'PT', value: (p) => p.statutory?.pt },
    { label: 'TDS', value: (p) => p.tax?.monthly_tds },
    { key: 'total_deductions', label: 'Total deductions' },
    { key: 'net_pay', label: 'Net pay' },
    { label: 'PF (ER)', value: (p) => p.employer_contributions?.pf },
    { label: 'ESI (ER)', value: (p) => p.employer_contributions?.esi },
    { label: 'Warnings', value: (p) => (p.warnings || []).join('; ') },
  ]);

  const missingCount = (compliance?.missing_bank?.length || 0) + (compliance?.missing_uan?.length || 0) + (compliance?.missing_esic?.length || 0);

  return (
    <PageShell
      icon={Banknote}
      title={`Payroll — ${monthLabel(run.month, true)}`}
      subtitle={`FY ${run.financial_year} · ${run.employee_count} employee(s) · created by ${run.created_by_name || run.created_by}`}
      actions={(
        <>
          <Button variant="outline" onClick={() => navigate('/payroll/runs')} className="gap-2 h-9 text-xs sm:text-sm"><ArrowLeft className="w-4 h-4" /> Runs</Button>
          {isDraft && (
            <>
              <Button variant="outline" onClick={recompute} disabled={!!busy} className="gap-2 h-9 text-xs sm:text-sm">
                <RefreshCw className={`w-4 h-4 ${busy === 'recompute' ? 'animate-spin' : ''}`} /> Recompute
              </Button>
              <Button onClick={() => setConfirm('lock')} disabled={!!busy || !run.payslips.length} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 text-xs sm:text-sm">
                <Lock className="w-4 h-4" /> Lock
              </Button>
              <Button variant="ghost" onClick={() => setConfirm('delete')} disabled={!!busy} className="text-red-600 hover:bg-red-50 gap-2 h-9 text-xs sm:text-sm">
                <Trash2 className="w-4 h-4" /> Discard
              </Button>
            </>
          )}
          {run.status === 'locked' && (
            <Button onClick={() => setShowPay(true)} disabled={!!busy} className="bg-emerald-600 hover:bg-emerald-700 gap-2 h-9 text-xs sm:text-sm">
              <CheckCircle2 className="w-4 h-4" /> Mark paid
            </Button>
          )}
          {!isDraft && (
            <Button variant="outline" onClick={publish} disabled={!!busy} className="gap-2 h-9 text-xs sm:text-sm">
              <Send className="w-4 h-4" /> {run.published_at ? 'Re-publish' : 'Publish payslips'}
            </Button>
          )}
        </>
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-600">
        <StatusPill status={run.status} styles={RUN_STATUS_STYLES} />
        {run.locked_at && <span>Locked {fmtDate(run.locked_at)}</span>}
        {run.paid_at && <span>· Paid {fmtDate(run.paid_at)}{run.payment_reference ? ` (ref ${run.payment_reference})` : ''}</span>}
        {run.published_at && <span>· Published {fmtDate(run.published_at)}</span>}
        {isDraft && <span className="text-amber-700">Draft — review, add one-offs, recompute, then lock. Locked payslips can't be edited.</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <StatCard label="Gross" value={fmtINR(t.gross, 0)} icon={Wallet} tone="slate" hint={`LOP ${fmtINR(t.lop, 0)}`} />
        <StatCard label="Deductions" value={fmtINR(t.deductions, 0)} icon={Receipt} tone="rose" hint={`TDS ${fmtINR(t.tds, 0)}`} />
        <StatCard label="Net pay" value={fmtINR(t.net, 0)} icon={Banknote} tone="emerald" hint={`Loans ${fmtINR(t.loan_recovery, 0)}`} />
        <StatCard label="Employer cost" value={fmtINR(t.employer_cost, 0)} icon={Building2} tone="purple" hint={`PF ${fmtINR(t.pf_employer, 0)} · ESI ${fmtINR(t.esi_employer, 0)}`} />
      </div>

      {/* Downloads */}
      <SectionCard icon={Download} title="Downloads" bodyClassName="p-3 sm:p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportSlips} className="gap-1.5"><Download className="w-3.5 h-3.5" /> Payslips CSV</Button>
          <Button variant="outline" size="sm" onClick={() => download('register', `payroll-register-${run.month}.csv`)} disabled={!!busy} className="gap-1.5"><FileText className="w-3.5 h-3.5" /> Register</Button>
          <Button variant="outline" size="sm" onClick={() => download('bank-file', `bank-transfer-${run.month}.csv`)} disabled={isDraft || !!busy} className="gap-1.5"><Landmark className="w-3.5 h-3.5" /> Bank file</Button>
          <Button variant="outline" size="sm" onClick={() => download('bank-file', `HDFC-bulk-${run.month}.csv`, { format: 'hdfc' })} disabled={isDraft || !!busy} className="gap-1.5"><Landmark className="w-3.5 h-3.5" /> HDFC bulk</Button>
          <Button variant="outline" size="sm" onClick={() => download('ecr', `ECR-${run.month}.txt`)} disabled={isDraft || !!busy} className="gap-1.5"><FileText className="w-3.5 h-3.5" /> PF ECR</Button>
          <Button variant="outline" size="sm" onClick={() => download('esi', `ESI-${run.month}.csv`)} disabled={isDraft || !!busy} className="gap-1.5"><FileText className="w-3.5 h-3.5" /> ESI</Button>
          <Button variant="outline" size="sm" onClick={() => download('pt', `PT-${run.month}.csv`)} disabled={isDraft || !!busy} className="gap-1.5"><FileText className="w-3.5 h-3.5" /> PT</Button>
        </div>
        {isDraft && <p className="text-xs text-slate-500 mt-2">Bank and statutory files are available once the run is locked.</p>}
      </SectionCard>

      {(missingCount > 0 || run.skipped?.length > 0) && (
        <SectionCard icon={AlertTriangle} title="Needs attention" bodyClassName="p-3 sm:p-4 space-y-3 text-sm">
          {compliance?.missing_bank?.length > 0 && (
            <div>
              <p className="font-medium text-slate-800">Missing bank details ({compliance.missing_bank.length}) — left out of the bank file</p>
              <p className="text-xs text-slate-600">{compliance.missing_bank.map(x => x.employee_name).join(', ')}</p>
            </div>
          )}
          {compliance?.missing_uan?.length > 0 && (
            <div>
              <p className="font-medium text-slate-800">Missing UAN ({compliance.missing_uan.length}) — left out of the ECR</p>
              <p className="text-xs text-slate-600">{compliance.missing_uan.map(x => x.employee_name).join(', ')}</p>
            </div>
          )}
          {compliance?.missing_esic?.length > 0 && (
            <div>
              <p className="font-medium text-slate-800">Missing ESIC number ({compliance.missing_esic.length})</p>
              <p className="text-xs text-slate-600">{compliance.missing_esic.map(x => x.employee_name).join(', ')}</p>
            </div>
          )}
          {run.skipped?.length > 0 && (
            <div>
              <p className="font-medium text-slate-800">Not included ({run.skipped.length})</p>
              <ul className="text-xs text-slate-600 space-y-0.5">
                {run.skipped.map(s => <li key={s.employee_uid}>{s.employee_name}: {s.reason}</li>)}
              </ul>
            </div>
          )}
          <Button variant="link" className="px-0 h-auto text-xs" onClick={() => navigate('/payroll/statutory')}>Edit statutory & bank details →</Button>
        </SectionCard>
      )}

      {/* Payslips */}
      <SectionCard
        icon={Users}
        title={`Payslips (${run.payslips.length})`}
        actions={(
          <div className="relative w-full sm:w-56">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" className="pl-8 h-9" />
          </div>
        )}
      >
        {payslips.length === 0 ? (
          <EmptyBlock icon={Users} title={run.payslips.length ? 'No matches' : 'No payslips'}>
            {!run.payslips.length && 'Add salary structures for employees, then recompute.'}
          </EmptyBlock>
        ) : (
          <DataTable columns={[
            { label: 'Employee' }, { label: 'Days', className: 'hidden md:table-cell' },
            { label: 'Gross', align: 'right', className: 'hidden sm:table-cell' }, { label: 'Deductions', align: 'right', className: 'hidden lg:table-cell' },
            { label: 'Net pay', align: 'right' }, { label: '' },
          ]}>
            {payslips.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 cursor-pointer" onClick={() => setSelected(p)}>
                  <p className="font-medium text-slate-900 flex items-center gap-1.5">
                    {p.employee_name}
                    {p.warnings?.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" title={p.warnings.join('\n')} />}
                  </p>
                  <p className="text-xs text-slate-500">{p.employee_code} · {p.department || '—'}</p>
                </td>
                <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap text-slate-600">
                  {p.payable_days}/{p.basis_days}{p.lop_days > 0 && <span className="text-rose-600"> · LOP {p.lop_days}</span>}
                </td>
                <td className="px-4 py-3 text-right hidden sm:table-cell whitespace-nowrap">{fmtINR(p.gross_earnings, 0)}</td>
                <td className="px-4 py-3 text-right hidden lg:table-cell whitespace-nowrap text-rose-700">{fmtINR(p.total_deductions, 0)}</td>
                <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtINR(p.net_pay, 0)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {isDraft && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAdj({ ...EMPTY_ADJ, employee_uid: p.employee_uid }); setShowAdj(true); }}>
                      <Plus className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1">One-off</span>
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(p)}>View</Button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {/* Adjustments */}
      <SectionCard
        icon={Receipt}
        title="One-off earnings & deductions"
        actions={isDraft && (
          <Button size="sm" onClick={() => { setAdj(EMPTY_ADJ); setShowAdj(true); }} className="bg-slate-800 hover:bg-slate-900 gap-1.5 h-8">
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        )}
      >
        {adjustments.length === 0 ? (
          <EmptyBlock icon={Receipt} title="No one-offs in this run">
            {isDraft ? 'Add bonuses, arrears, incentives or one-time deductions while the run is a draft.' : null}
          </EmptyBlock>
        ) : (
          <DataTable columns={[{ label: 'Employee' }, { label: 'Type' }, { label: 'Amount', align: 'right' }, { label: 'Taxable', className: 'hidden sm:table-cell' }, { label: '' }]}>
            {adjustments.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3">{a.employee_name}</td>
                <td className="px-4 py-3">
                  <p>{a.label}</p>
                  <p className="text-xs text-slate-500">{ONE_OFF_LABELS[a.type]}{a.note ? ` · ${a.note}` : ''}</p>
                </td>
                <td className={`px-4 py-3 text-right whitespace-nowrap ${a.type === 'other_deduction' ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {a.type === 'other_deduction' ? '−' : '+'}{fmtINR(a.amount)}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">{a.type === 'other_deduction' ? '—' : a.taxable ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-right">
                  {isDraft && (
                    <Button variant="ghost" size="sm" className="h-7 text-red-600 hover:bg-red-50" disabled={busy === `adj-${a.id}`} onClick={() => deleteAdjustment(a.id)} aria-label="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <PayslipDialog
        payslip={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        onDownload={() => downloadSlip(selected)}
        downloading={busy === `pdf-${selected?.id}`}
      />

      {/* Adjustment dialog */}
      <Dialog open={showAdj} onOpenChange={setShowAdj}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add one-off</DialogTitle>
            <DialogDescription>The employee's payslip is recomputed immediately (taxable amounts change TDS).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={adj.employee_uid} onValueChange={(v) => setAdj({ ...adj, employee_uid: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {run.payslips.map(p => <SelectItem key={p.employee_uid} value={p.employee_uid}>{p.employee_name} ({p.employee_code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={adj.type} onValueChange={(v) => setAdj({ ...adj, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ONE_OFF_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-amount">Amount (₹)</Label>
                <Input id="adj-amount" type="number" min="0" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-label">Label on payslip <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Input id="adj-label" value={adj.label} maxLength={80} placeholder={ONE_OFF_LABELS[adj.type]} onChange={(e) => setAdj({ ...adj, label: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-note">Note <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Input id="adj-note" value={adj.note} maxLength={300} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
            </div>
            {adj.type !== 'other_deduction' && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Taxable (included in TDS)</span>
                <Switch checked={adj.taxable} onCheckedChange={(v) => setAdj({ ...adj, taxable: v })} />
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdj(false)}>Cancel</Button>
            <Button onClick={saveAdjustment} disabled={busy === 'adj'} className="bg-slate-800 hover:bg-slate-900">{busy === 'adj' ? 'Saving…' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm lock / delete */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm === 'lock' ? 'Lock this payroll?' : 'Discard this draft?'}</DialogTitle>
            <DialogDescription>
              {confirm === 'lock'
                ? 'Payslips become final and visible to employees. Loan EMIs are recovered and leave encashments marked paid. This cannot be undone.'
                : 'All draft payslips and one-off adjustments for this month will be deleted.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm === 'lock'
              ? <Button onClick={lock} disabled={busy === 'lock'} className="bg-slate-800 hover:bg-slate-900">{busy === 'lock' ? 'Locking…' : 'Lock payroll'}</Button>
              : <Button onClick={remove} disabled={busy === 'delete'} className="bg-red-600 hover:bg-red-700">Discard</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark paid */}
      <Dialog open={showPay} onOpenChange={setShowPay}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark payroll as paid</DialogTitle>
            <DialogDescription>Net pay {fmtINR(t.net)} for {run.employee_count} employee(s).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Payment reference <span className="text-slate-400 font-normal">(optional)</span></Label>
            <Input id="pay-ref" value={payRef} maxLength={100} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank batch / UTR" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPay(false)}>Cancel</Button>
            <Button onClick={markPaid} disabled={busy === 'pay'} className="bg-emerald-600 hover:bg-emerald-700">{busy === 'pay' ? 'Saving…' : 'Mark paid'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
