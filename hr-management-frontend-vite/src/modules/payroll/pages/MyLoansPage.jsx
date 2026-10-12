import React, { useCallback, useEffect, useState } from 'react';
import { HandCoins, Plus, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, LoadingBlock, EmptyBlock, ErrorBlock, StatusPill } from '../components/PayrollUI';
import { API, errMsg, fmtINR, fmtDate, monthLabel, LOAN_STATUS_STYLES } from '../lib';

const EMPTY = { type: 'loan', amount: '', tenure_months: '6', reason: '' };

export default function MyLoansPage() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${API}/loans/my`);
      setLoans(res.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load your loans'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!(Number(form.amount) > 0)) return toast.error('Enter an amount');
    if (form.reason.trim().length < 3) return toast.error('Tell us what it is for');
    setSaving(true);
    try {
      await api.post(`${API}/loans/my`, { type: form.type, amount: Number(form.amount), tenure_months: Number(form.tenure_months), reason: form.reason.trim() });
      toast.success('Request submitted');
      setShow(false);
      setForm(EMPTY);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not submit'));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id) => {
    try {
      await api.delete(`${API}/loans/my/${id}`);
      toast.success('Request cancelled');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not cancel'));
    }
  };

  const exportRows = () => exportCsv('my-loans', loans, [
    { key: 'type', label: 'Type' }, { key: 'principal', label: 'Amount' }, { key: 'emi', label: 'EMI' },
    { key: 'outstanding', label: 'Outstanding' }, { key: 'status', label: 'Status' }, { key: 'reason', label: 'Reason' },
    { label: 'Requested', value: l => l.created_at },
  ]);

  const suggestedEmi = Number(form.amount) > 0 && Number(form.tenure_months) > 0 ? Math.ceil(Number(form.amount) / Number(form.tenure_months)) : null;

  return (
    <PageShell
      icon={HandCoins}
      title="My Loans & Advances"
      subtitle="Request a salary advance or loan; EMIs are recovered through payroll"
      actions={(
        <>
          <Button variant="outline" onClick={exportRows} disabled={!loans.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>
          <Button onClick={() => setShow(true)} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 sm:h-10"><Plus className="w-4 h-4" /> New request</Button>
        </>
      )}
    >
      <SectionCard icon={HandCoins} title="Your requests" bodyClassName="p-0">
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : loans.length === 0 ? (
          <EmptyBlock icon={HandCoins} title="No loans or advances">Use New request to ask for a salary advance or loan.</EmptyBlock>
        ) : (
          <div className="divide-y divide-slate-100">
            {loans.map((l) => {
              const repaid = l.principal ? Math.min(100, ((l.recovered || 0) / l.principal) * 100) : 0;
              return (
                <div key={l.id} className="p-3 sm:p-4 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{l.type === 'advance' ? 'Salary advance' : 'Loan'} · {fmtINR(l.principal, 0)}</p>
                        <StatusPill status={l.status} styles={LOAN_STATUS_STYLES} />
                      </div>
                      <p className="text-xs text-slate-500">Requested {fmtDate(l.created_at)} · {l.reason}</p>
                      {l.rejection_reason && <p className="text-xs text-red-600">Rejected: {l.rejection_reason}</p>}
                    </div>
                    {l.status === 'pending' && (
                      <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 gap-1 self-start" onClick={() => cancel(l.id)}><Trash2 className="w-3.5 h-3.5" /> Cancel</Button>
                    )}
                  </div>
                  {['approved', 'disbursed', 'closed'].includes(l.status) && (
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div><p className="text-[10px] uppercase text-slate-500">EMI</p><p className="font-semibold">{fmtINR(l.emi, 0)}</p></div>
                      <div><p className="text-[10px] uppercase text-slate-500">First EMI</p><p className="font-semibold">{l.start_month ? monthLabel(l.start_month) : '—'}</p></div>
                      <div><p className="text-[10px] uppercase text-slate-500">Outstanding</p><p className="font-semibold">{l.status === 'approved' ? '—' : fmtINR(l.outstanding, 0)}</p></div>
                    </div>
                  )}
                  {['disbursed', 'closed'].includes(l.status) && (
                    <div className="space-y-1">
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${repaid}%` }} /></div>
                      <p className="text-xs text-slate-500">Repaid {fmtINR(l.recovered || 0, 0)} of {fmtINR(l.principal, 0)}{(l.repayments || []).length ? ` · last ${monthLabel(l.repayments[l.repayments.length - 1].month)}` : ''}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a loan or advance</DialogTitle>
            <DialogDescription>HR reviews the request and may adjust the EMI. Approved amounts are recovered from your salary.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="loan">Loan</SelectItem><SelectItem value="advance">Salary advance</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Amount (₹)</Label><Input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Repay over (months)</Label>
              <Input type="number" min="1" max="60" value={form.tenure_months} onChange={(e) => setForm({ ...form, tenure_months: e.target.value })} />
              {suggestedEmi && <p className="text-xs text-slate-500">About {fmtINR(suggestedEmi, 0)} per month</p>}
            </div>
            <div className="space-y-1"><Label className="text-xs">Reason</Label><Textarea rows={3} value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShow(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Submitting…' : 'Submit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
