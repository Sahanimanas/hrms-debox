import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IdCard, Download, Search, Pencil, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, LoadingBlock, EmptyBlock, ErrorBlock, DataTable, StatCard } from '../components/PayrollUI';
import { API, errMsg } from '../lib';

const FIELDS = ['pan', 'uan', 'esic_number', 'bank_name', 'bank_account_number', 'ifsc', 'account_holder_name', 'tax_regime', 'pt_state', 'pf_opt_out'];
const mask = (acct) => (acct ? `••••${String(acct).slice(-4)}` : '—');

export default function StatutoryDetailsPage() {
  const [rows, setRows] = useState([]);
  const [states, setStates] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, meta] = await Promise.all([api.get(`${API}/statutory`), api.get(`${API}/meta`)]);
      setRows(list.data || []);
      setStates(meta.data.states || {});
    } catch (e) {
      setError(errMsg(e, 'Failed to load statutory details'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (row) => {
    setEditing(row);
    setForm(Object.fromEntries(FIELDS.map(k => [k, row[k] ?? (k === 'pf_opt_out' ? false : '')])));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, pt_state: form.pt_state === 'default' ? null : form.pt_state || null };
      const res = await api.put(`${API}/statutory/${encodeURIComponent(editing.employee_uid)}`, body);
      setRows(rs => rs.map(r => (r.employee_uid === editing.employee_uid ? res.data : r)));
      toast.success('Details saved');
      setEditing(null);
    } catch (e) {
      toast.error(errMsg(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const missing = (r) => ({ bank: !r.bank_account_number || !r.ifsc, pan: !r.pan, uan: !r.uan });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !`${r.employee_name} ${r.employee_code} ${r.employee_email}`.toLowerCase().includes(q)) return false;
      const m = missing(r);
      if (filter === 'missing_bank') return m.bank;
      if (filter === 'missing_pan') return m.pan;
      if (filter === 'missing_uan') return m.uan;
      return true;
    });
  }, [rows, search, filter]);

  const exportRows = () => exportCsv('statutory-details', filtered, [
    { key: 'employee_code', label: 'Employee code' }, { key: 'employee_name', label: 'Name' }, { key: 'employee_email', label: 'Email' },
    { key: 'pan', label: 'PAN' }, { key: 'uan', label: 'UAN' }, { key: 'esic_number', label: 'ESIC' },
    { key: 'bank_name', label: 'Bank' }, { key: 'bank_account_number', label: 'Account number' }, { key: 'ifsc', label: 'IFSC' },
    { key: 'tax_regime', label: 'Tax regime' }, { key: 'pt_state', label: 'PT state' }, { label: 'PF opt-out', value: r => (r.pf_opt_out ? 'Yes' : 'No') },
  ]);

  const counts = rows.reduce((c, r) => { const m = missing(r); return { bank: c.bank + m.bank, pan: c.pan + m.pan, uan: c.uan + m.uan }; }, { bank: 0, pan: 0, uan: 0 });

  return (
    <PageShell
      icon={IdCard}
      title="Statutory Details"
      subtitle="PAN, UAN, ESIC, bank accounts, tax regime and PT state per employee"
      actions={<Button variant="outline" onClick={exportRows} disabled={!filtered.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>}
    >
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatCard label="Missing bank" value={counts.bank} icon={AlertTriangle} tone={counts.bank ? 'amber' : 'emerald'} />
        <StatCard label="Missing PAN" value={counts.pan} icon={AlertTriangle} tone={counts.pan ? 'amber' : 'emerald'} />
        <StatCard label="Missing UAN" value={counts.uan} icon={AlertTriangle} tone={counts.uan ? 'amber' : 'emerald'} />
      </div>

      <SectionCard
        icon={IdCard}
        title={`Employees (${filtered.length})`}
        actions={(
          <>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="missing_bank">Missing bank</SelectItem>
                <SelectItem value="missing_pan">Missing PAN</SelectItem>
                <SelectItem value="missing_uan">Missing UAN</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="pl-8 h-9" />
            </div>
          </>
        )}
      >
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : filtered.length === 0 ? (
          <EmptyBlock icon={IdCard} title="No employees match" />
        ) : (
          <DataTable columns={[
            { label: 'Employee' }, { label: 'PAN', className: 'hidden sm:table-cell' }, { label: 'UAN', className: 'hidden md:table-cell' },
            { label: 'Bank', className: 'hidden lg:table-cell' }, { label: 'Regime' }, { label: 'PT', className: 'hidden md:table-cell' }, { label: '' },
          ]}>
            {filtered.map((r) => {
              const m = missing(r);
              return (
                <tr key={r.employee_uid} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.employee_name}</p>
                    <p className="text-xs text-slate-500">{r.employee_code} · {r.department || '—'}</p>
                  </td>
                  <td className={`px-4 py-3 hidden sm:table-cell font-mono text-xs ${m.pan ? 'text-amber-600' : ''}`}>{r.pan || 'missing'}</td>
                  <td className={`px-4 py-3 hidden md:table-cell font-mono text-xs ${m.uan ? 'text-amber-600' : ''}`}>{r.uan || 'missing'}</td>
                  <td className={`px-4 py-3 hidden lg:table-cell text-xs ${m.bank ? 'text-amber-600' : ''}`}>
                    {m.bank ? 'missing' : <>{r.bank_name || 'Bank'} {mask(r.bank_account_number)}<br /><span className="font-mono">{r.ifsc}</span></>}
                  </td>
                  <td className="px-4 py-3 capitalize">{r.tax_regime}</td>
                  <td className="px-4 py-3 hidden md:table-cell">{r.pt_state || 'Default'}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => open(r)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </SectionCard>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.employee_name}</DialogTitle>
            <DialogDescription>{editing?.employee_code} · {editing?.employee_email}</DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">PAN</Label><Input value={form.pan || ''} maxLength={10} placeholder="ABCDE1234F" onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1"><Label className="text-xs">UAN (12 digits)</Label><Input value={form.uan || ''} maxLength={12} inputMode="numeric" onChange={(e) => setForm({ ...form, uan: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="space-y-1"><Label className="text-xs">ESIC IP number</Label><Input value={form.esic_number || ''} maxLength={17} inputMode="numeric" onChange={(e) => setForm({ ...form, esic_number: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="space-y-1"><Label className="text-xs">Bank name</Label><Input value={form.bank_name || ''} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Account number</Label><Input value={form.bank_account_number || ''} maxLength={18} inputMode="numeric" onChange={(e) => setForm({ ...form, bank_account_number: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="space-y-1"><Label className="text-xs">IFSC</Label><Input value={form.ifsc || ''} maxLength={11} placeholder="HDFC0001234" onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Account holder name (if different)</Label><Input value={form.account_holder_name || ''} onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Tax regime</Label>
              <Select value={form.tax_regime || 'new'} onValueChange={(v) => setForm({ ...form, tax_regime: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="new">New regime</SelectItem><SelectItem value="old">Old regime</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">PT / LWF state</Label>
              <Select value={form.pt_state || 'default'} onValueChange={(v) => setForm({ ...form, pt_state: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Org default</SelectItem>
                  {Object.entries(states).map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2 pt-1">
              <span>PF opt-out <span className="block text-xs text-slate-500">Only for employees eligible to opt out (wage above ceiling at joining)</span></span>
              <Switch checked={!!form.pf_opt_out} onCheckedChange={(v) => setForm({ ...form, pf_opt_out: v })} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
