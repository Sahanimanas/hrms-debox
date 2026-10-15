import React, { useCallback, useEffect, useState } from 'react';
import { ReceiptText, Download, Wallet, CalendarDays, Landmark, Pencil, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, StatCard, LoadingBlock, EmptyBlock, ErrorBlock, StatusPill, DataTable } from '../components/PayrollUI';
import PayslipDialog from '../components/PayslipDialog';
import { API, errMsg, fmtINR, monthLabel, recentFys, downloadFile, blobErrMsg, RUN_STATUS_STYLES } from '../lib';

const EDIT_KEYS = ['pan', 'uan', 'bank_name', 'bank_account_number', 'ifsc', 'account_holder_name'];
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export default function MyPayslipsPage() {
  const fys = recentFys(4);
  const [payslips, setPayslips] = useState([]);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');
  const [fy, setFy] = useState(fys[0]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [slips, st] = await Promise.all([
        api.get(`${API}/my/payslips`),
        api.get(`${API}/my/statutory`).catch(() => ({ data: null })),
      ]);
      setPayslips(slips.data || []);
      setDetails(st.data);
    } catch (e) {
      setError(errMsg(e, 'Failed to load payslips'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const download = async (p) => {
    setBusy(p.id);
    try {
      await downloadFile(`${API}/payslips/${p.id}/pdf`, `payslip-${p.month}.pdf`);
    } catch (e) {
      toast.error(await blobErrMsg(e));
    } finally {
      setBusy('');
    }
  };

  const downloadForm16 = async () => {
    setBusy('form16');
    try {
      await downloadFile(`${API}/my/form16/pdf`, `Form16-${fy}.pdf`, { fy });
    } catch (e) {
      toast.error(await blobErrMsg(e, 'Form 16 is not available'));
    } finally {
      setBusy('');
    }
  };

  const openEdit = () => {
    setForm(Object.fromEntries(EDIT_KEYS.map(k => [k, details?.[k] || ''])));
    setEditing(true);
  };

  const saveDetails = async () => {
    if (form.pan && !PAN_RE.test(form.pan)) return toast.error('PAN must look like ABCDE1234F');
    if (form.ifsc && !IFSC_RE.test(form.ifsc)) return toast.error('IFSC must look like HDFC0001234');
    if (form.uan && !/^\d{12}$/.test(form.uan)) return toast.error('UAN must be 12 digits');
    setBusy('details');
    try {
      const res = await api.put(`${API}/my/statutory`, form);
      setDetails(res.data);
      setEditing(false);
      toast.success('Details updated');
    } catch (e) {
      toast.error(errMsg(e, 'Could not save'));
    } finally {
      setBusy('');
    }
  };

  const latest = payslips[0];
  const ytd = payslips.filter(p => p.financial_year === fys[0]);
  const exportRows = () => exportCsv('my-payslips', payslips, [
    { label: 'Month', value: p => p.month }, { key: 'payable_days', label: 'Paid days' }, { key: 'lop_days', label: 'LOP days' },
    { key: 'gross_earnings', label: 'Gross' }, { key: 'total_deductions', label: 'Deductions' }, { key: 'net_pay', label: 'Net pay' },
    { label: 'TDS', value: p => p.tax?.monthly_tds }, { label: 'PF', value: p => p.statutory?.pf_employee },
  ]);

  return (
    <PageShell
      icon={ReceiptText}
      title="My Payslips"
      subtitle="Monthly salary slips, Form 16 and your bank & statutory details"
      actions={<Button variant="outline" onClick={exportRows} disabled={!payslips.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <StatCard label="Latest net pay" value={latest ? fmtINR(latest.net_pay, 0) : '—'} hint={latest ? monthLabel(latest.month) : null} icon={Wallet} tone="emerald" />
        <StatCard label="Latest gross" value={latest ? fmtINR(latest.gross_earnings, 0) : '—'} icon={ReceiptText} tone="slate" />
        <StatCard label={`Net pay FY ${fys[0]}`} value={fmtINR(ytd.reduce((s, p) => s + p.net_pay, 0), 0)} icon={CalendarDays} tone="blue" />
        <StatCard label={`TDS FY ${fys[0]}`} value={fmtINR(ytd.reduce((s, p) => s + (p.tax?.monthly_tds || 0), 0), 0)} icon={FileText} tone="purple" />
      </div>

      <SectionCard icon={ReceiptText} title="Payslips">
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : payslips.length === 0 ? (
          <EmptyBlock icon={ReceiptText} title="No payslips yet">Payslips appear here once payroll for a month is locked.</EmptyBlock>
        ) : (
          <DataTable columns={[
            { label: 'Month' }, { label: 'Paid days', className: 'hidden sm:table-cell' }, { label: 'Gross', align: 'right', className: 'hidden md:table-cell' },
            { label: 'Deductions', align: 'right', className: 'hidden md:table-cell' }, { label: 'Net pay', align: 'right' }, { label: '' },
          ]}>
            {payslips.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 cursor-pointer" onClick={() => setSelected(p)}>
                  <p className="font-medium text-slate-900">{monthLabel(p.month, true)}</p>
                  <StatusPill status={p.status} styles={RUN_STATUS_STYLES} label={p.status === 'paid' ? 'Paid' : 'Processed'} />
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">{p.payable_days}{p.lop_days > 0 && <span className="text-rose-600 text-xs"> (LOP {p.lop_days})</span>}</td>
                <td className="px-4 py-3 text-right hidden md:table-cell whitespace-nowrap">{fmtINR(p.gross_earnings, 0)}</td>
                <td className="px-4 py-3 text-right hidden md:table-cell whitespace-nowrap text-rose-700">{fmtINR(p.total_deductions, 0)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">{fmtINR(p.net_pay, 0)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(p)}>View</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={busy === p.id} onClick={() => download(p)}>
                    <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">PDF</span>
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
        <SectionCard
          icon={Landmark}
          title="Bank & statutory details"
          actions={details && <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={openEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>}
          bodyClassName="p-4 sm:p-5"
        >
          {!details ? <p className="text-sm text-slate-500">No employee profile is linked to your account.</p> : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-slate-500">PAN</dt><dd className="font-mono">{details.pan || <span className="text-amber-600 font-sans">Not added</span>}</dd>
              <dt className="text-slate-500">UAN</dt><dd className="font-mono">{details.uan || '—'}</dd>
              <dt className="text-slate-500">Bank</dt><dd>{details.bank_name || '—'}</dd>
              <dt className="text-slate-500">Account</dt><dd className="font-mono">{details.bank_account_number ? `••••${details.bank_account_number.slice(-4)}` : <span className="text-amber-600 font-sans">Not added</span>}</dd>
              <dt className="text-slate-500">IFSC</dt><dd className="font-mono">{details.ifsc || '—'}</dd>
              <dt className="text-slate-500">Tax regime</dt><dd className="capitalize">{details.tax_regime} <span className="text-xs text-slate-500">(change in My Tax Declarations)</span></dd>
            </dl>
          )}
        </SectionCard>

        <SectionCard icon={FileText} title="Form 16 (Part B)" bodyClassName="p-4 sm:p-5 space-y-3">
          <p className="text-sm text-slate-600">Statement of salary paid and tax deducted, generated from your processed payslips.</p>
          <div className="flex flex-wrap gap-2">
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{fys.map(f => <SelectItem key={f} value={f}>FY {f}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={downloadForm16} disabled={busy === 'form16'} className="gap-2 h-9">
              <Download className="w-4 h-4" /> {busy === 'form16' ? 'Preparing…' : 'Download'}
            </Button>
          </div>
        </SectionCard>
      </div>

      <PayslipDialog payslip={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} onDownload={() => download(selected)} downloading={busy === selected?.id} />

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bank & statutory details</DialogTitle>
            <DialogDescription>Used for salary transfers, PF and income-tax filings. Double-check before saving.</DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">PAN</Label><Input value={form.pan || ''} maxLength={10} placeholder="ABCDE1234F" onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1"><Label className="text-xs">UAN (12 digits)</Label><Input value={form.uan || ''} maxLength={12} inputMode="numeric" onChange={(e) => setForm({ ...form, uan: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Bank name</Label><Input value={form.bank_name || ''} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Account number</Label><Input value={form.bank_account_number || ''} maxLength={18} inputMode="numeric" onChange={(e) => setForm({ ...form, bank_account_number: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="space-y-1"><Label className="text-xs">IFSC</Label><Input value={form.ifsc || ''} maxLength={11} placeholder="HDFC0001234" onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Account holder name (if different)</Label><Input value={form.account_holder_name || ''} onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={saveDetails} disabled={busy === 'details'}>{busy === 'details' ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
