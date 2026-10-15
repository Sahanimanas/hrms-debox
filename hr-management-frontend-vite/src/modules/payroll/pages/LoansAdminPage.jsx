import React, { useCallback, useEffect, useState } from 'react';
import { HandCoins, Download, Check, X, Banknote, Pencil, CircleDollarSign, Lock, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, LoadingBlock, EmptyBlock, ErrorBlock, StatusPill, DataTable, StatCard } from '../components/PayrollUI';
import { API, errMsg, fmtINR, fmtDate, monthLabel, currentMonth, LOAN_STATUS_STYLES } from '../lib';

const ACTION_TITLES = {
  approve: 'Approve request',
  reject: 'Reject request',
  disburse: 'Mark as disbursed',
  edit: 'Edit EMI / start month',
  prepay: 'Record prepayment',
  close: 'Close loan',
};

export default function LoansAdminPage() {
  const [loans, setLoans] = useState([]);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null); // { type, loan }
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${API}/loans`, { params: status === 'all' ? {} : { status } });
      setLoans(res.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load loans'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const start = (type, loan) => {
    setAction({ type, loan });
    setForm({
      emi: loan.emi ?? '',
      principal: loan.principal ?? '',
      start_month: loan.start_month || currentMonth(),
      reason: '',
      amount: '',
      note: '',
      reference: '',
    });
  };

  const submit = async () => {
    const { type, loan } = action;
    const base = `${API}/loans/${loan.id}`;
    let call;
    if (type === 'approve') call = api.post(`${base}/approve`, { principal: Number(form.principal), emi: Number(form.emi), start_month: form.start_month || undefined, note: form.note || null });
    else if (type === 'reject') {
      if (!form.reason.trim()) return toast.error('Give a reason');
      call = api.post(`${base}/reject`, { reason: form.reason.trim() });
    } else if (type === 'disburse') call = api.post(`${base}/disburse`, { start_month: form.start_month, reference: form.reference || null });
    else if (type === 'edit') call = api.put(base, { emi: Number(form.emi), start_month: form.start_month, note: form.note || null });
    else if (type === 'prepay') {
      if (!(Number(form.amount) > 0)) return toast.error('Enter an amount');
      call = api.post(`${base}/prepay`, { amount: Number(form.amount), note: form.note || null });
    } else call = api.post(`${base}/close`, { note: form.note || null });

    setSaving(true);
    try {
      await call;
      toast.success('Saved');
      setAction(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const exportRows = () => exportCsv('loans', loans, [
    { key: 'employee_name', label: 'Employee' }, { key: 'employee_email', label: 'Email' }, { key: 'type', label: 'Type' },
    { key: 'principal', label: 'Principal' }, { key: 'emi', label: 'EMI' }, { key: 'outstanding', label: 'Outstanding' },
    { key: 'recovered', label: 'Recovered' }, { key: 'status', label: 'Status' }, { key: 'start_month', label: 'First EMI month' },
    { key: 'reason', label: 'Reason' }, { label: 'Requested on', value: l => l.created_at },
  ]);

  const totals = loans.reduce((t, l) => ({
    outstanding: t.outstanding + (l.status === 'disbursed' ? l.outstanding : 0),
    pending: t.pending + (l.status === 'pending' ? 1 : 0),
    active: t.active + (l.status === 'disbursed' ? 1 : 0),
  }), { outstanding: 0, pending: 0, active: 0 });

  const t = action?.type;

  return (
    <PageShell
      icon={HandCoins}
      title="Loans & Advances"
      subtitle="Approve requests, disburse, and track EMI recovery through payroll"
      actions={<Button variant="outline" onClick={exportRows} disabled={!loans.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>}
    >
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatCard label="Pending requests" value={totals.pending} icon={Clock} tone="amber" />
        <StatCard label="Active loans" value={totals.active} icon={HandCoins} tone="purple" />
        <StatCard label="Outstanding" value={fmtINR(totals.outstanding, 0)} icon={CircleDollarSign} tone="rose" />
      </div>

      <SectionCard
        icon={HandCoins}
        title={`Requests & loans (${loans.length})`}
        actions={(
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['all', 'pending', 'approved', 'disbursed', 'closed', 'rejected', 'cancelled'].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      >
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : loans.length === 0 ? (
          <EmptyBlock icon={HandCoins} title="No loans or advances" />
        ) : (
          <DataTable columns={[
            { label: 'Employee' }, { label: 'Amount', align: 'right' }, { label: 'EMI', align: 'right', className: 'hidden sm:table-cell' },
            { label: 'Outstanding', align: 'right', className: 'hidden md:table-cell' }, { label: 'Status' }, { label: '' },
          ]}>
            {loans.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50 align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{l.employee_name}</p>
                  <p className="text-xs text-slate-500 capitalize">{l.type === 'advance' ? 'Salary advance' : 'Loan'} · {l.tenure_months} mo · {fmtDate(l.created_at)}</p>
                  <p className="text-xs text-slate-500 break-words max-w-xs">{l.reason}</p>
                  {l.rejection_reason && <p className="text-xs text-red-600">{l.rejection_reason}</p>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtINR(l.principal, 0)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap hidden sm:table-cell">
                  {fmtINR(l.emi, 0)}
                  {l.start_month && <p className="text-[11px] text-slate-500">from {monthLabel(l.start_month)}</p>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap hidden md:table-cell">{['disbursed', 'closed'].includes(l.status) ? fmtINR(l.outstanding, 0) : '—'}</td>
                <td className="px-4 py-3"><StatusPill status={l.status} styles={LOAN_STATUS_STYLES} /></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {l.status === 'pending' && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-emerald-700 gap-1" onClick={() => start('approve', l)}><Check className="w-3.5 h-3.5" />Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 text-red-600 gap-1" onClick={() => start('reject', l)}><X className="w-3.5 h-3.5" />Reject</Button>
                      </>
                    )}
                    {l.status === 'approved' && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => start('disburse', l)}><Banknote className="w-3.5 h-3.5" />Disburse</Button>}
                    {['approved', 'disbursed'].includes(l.status) && <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => start('edit', l)}><Pencil className="w-3.5 h-3.5" />Edit</Button>}
                    {l.status === 'disbursed' && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => start('prepay', l)}>Prepay</Button>
                        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => start('close', l)}><Lock className="w-3.5 h-3.5" />Close</Button>
                      </>
                    )}
                    {(l.repayments || []).length > 0 && <Button size="sm" variant="ghost" className="h-7" onClick={() => setHistory(l)}>History</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ACTION_TITLES[t]}</DialogTitle>
            <DialogDescription>
              {action?.loan.employee_name} · {fmtINR(action?.loan.principal, 0)}{action?.loan.status === 'disbursed' ? ` · outstanding ${fmtINR(action?.loan.outstanding, 0)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {t === 'approve' && (
              <div className="space-y-1"><Label className="text-xs">Approved principal (₹)</Label><Input type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></div>
            )}
            {['approve', 'edit'].includes(t) && (
              <div className="space-y-1"><Label className="text-xs">Monthly EMI (₹)</Label><Input type="number" value={form.emi} onChange={(e) => setForm({ ...form, emi: e.target.value })} /></div>
            )}
            {['approve', 'disburse', 'edit'].includes(t) && (
              <div className="space-y-1">
                <Label className="text-xs">First EMI month (payroll)</Label>
                <Input type="month" value={form.start_month} onChange={(e) => setForm({ ...form, start_month: e.target.value })} />
              </div>
            )}
            {t === 'disburse' && (
              <div className="space-y-1"><Label className="text-xs">Transfer reference (optional)</Label><Input value={form.reference} maxLength={100} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            )}
            {t === 'reject' && (
              <div className="space-y-1"><Label className="text-xs">Reason</Label><Input value={form.reason} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            )}
            {t === 'prepay' && (
              <div className="space-y-1"><Label className="text-xs">Amount received (₹)</Label><Input type="number" max={action?.loan.outstanding} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            )}
            {t === 'close' && <p className="text-sm text-slate-600">Records a final payment of {fmtINR(action?.loan.outstanding)} and closes the loan. No further EMIs are deducted.</p>}
            {['approve', 'edit', 'prepay', 'close'].includes(t) && (
              <div className="space-y-1"><Label className="text-xs">Note (optional)</Label><Input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            )}
            {['prepay', 'edit', 'close'].includes(t) && <p className="text-xs text-slate-500">If a draft payroll already includes this EMI, recompute it before locking.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className={t === 'reject' ? 'bg-red-600 hover:bg-red-700' : ''}>{saving ? 'Saving…' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Repayments — {history?.employee_name}</DialogTitle>
            <DialogDescription>Recovered {fmtINR(history?.recovered)} of {fmtINR(history?.principal)}</DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-slate-100 text-sm max-h-80 overflow-y-auto">
            {(history?.repayments || []).map(r => (
              <div key={r.id} className="flex justify-between py-2">
                <span>{monthLabel(r.month)} · <span className="capitalize text-slate-500">{r.type === 'emi' ? 'Payroll EMI' : r.type}</span></span>
                <span className="font-medium">{fmtINR(r.amount)}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
