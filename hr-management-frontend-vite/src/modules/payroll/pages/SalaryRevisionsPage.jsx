import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Plus, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import ChangeBadge from '../components/ChangeBadge';
import { PageShell, SectionCard, LoadingBlock, EmptyBlock, ErrorBlock, DataTable } from '../components/PayrollUI';
import { API, errMsg, fmtINR, fmtDate, monthLabel, currentMonth } from '../lib';

const DEFAULT_COMPONENTS = [
  { name: 'Basic Pay', amount: 50, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 1 },
  { name: 'House Rent Allowance', amount: 25, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 2 },
  { name: 'LTA Allowance', amount: 2.5, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 3 },
  { name: 'Other Allowance', amount: 22.5, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 4 },
];

export default function SalaryRevisionsPage() {
  const [revisions, setRevisions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ employee_uid: '', effective_from: currentMonth(), reason: '', basic_salary: '' });
  const [components, setComponents] = useState(DEFAULT_COMPONENTS);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rev, emps] = await Promise.all([
        api.get(`${API}/revisions`, { params: filter === 'all' ? {} : { employee_uid: filter } }),
        api.get(`${API}/employees`),
      ]);
      setRevisions(rev.data || []);
      setEmployees(emps.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load salary revisions'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const pickEmployee = async (uid) => {
    setForm(f => ({ ...f, employee_uid: uid }));
    try {
      const res = await api.get(`/salary-structure/${encodeURIComponent(uid)}`);
      if (res.data?.components?.length) {
        setComponents(res.data.components);
        setForm(f => ({ ...f, basic_salary: res.data.basic_salary || '' }));
      } else {
        setComponents(DEFAULT_COMPONENTS);
      }
    } catch {
      setComponents(DEFAULT_COMPONENTS);
    }
  };

  const save = async () => {
    if (!form.employee_uid) return toast.error('Pick an employee');
    if (!(Number(form.basic_salary) > 0)) return toast.error('Enter the new monthly CTC');
    if (form.reason.trim().length < 2) return toast.error('Give a reason');
    setSaving(true);
    try {
      const res = await api.post(`${API}/revisions`, {
        employee_uid: form.employee_uid,
        effective_from: form.effective_from,
        reason: form.reason.trim(),
        basic_salary: Number(form.basic_salary),
        components,
      });
      toast.success('Salary revised');
      if (res.data.note) toast.info(res.data.note, { duration: 8000 });
      setShow(false);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not save revision'));
    } finally {
      setSaving(false);
    }
  };

  const nameByUid = useMemo(() => Object.fromEntries(employees.map(e => [e.uid, e.name])), [employees]);

  const exportRows = () => exportCsv('salary-revisions', revisions, [
    { key: 'employee_name', label: 'Employee' }, { key: 'employee_uid', label: 'Employee code' },
    { key: 'effective_from', label: 'Effective from' }, { key: 'previous_gross', label: 'Previous gross' },
    { key: 'new_gross', label: 'New gross' }, { key: 'reason', label: 'Reason' },
    { label: 'Revised by', value: r => r.revised_by_name || r.revised_by }, { label: 'Recorded at', value: r => r.created_at },
  ]);

  return (
    <PageShell
      icon={History}
      title="Salary Revisions"
      subtitle="Effective-dated salary changes — payroll uses the structure in force for each month"
      actions={(
        <>
          <Button variant="outline" onClick={exportRows} disabled={!revisions.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>
          <Button onClick={() => { setForm({ employee_uid: '', effective_from: currentMonth(), reason: '', basic_salary: '' }); setComponents(DEFAULT_COMPONENTS); setShow(true); }} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 sm:h-10"><Plus className="w-4 h-4" /> Revise salary</Button>
        </>
      )}
    >
      <SectionCard
        icon={History}
        title={`History (${revisions.length})`}
        actions={(
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {employees.map(e => <SelectItem key={e.uid} value={e.uid}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      >
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : revisions.length === 0 ? (
          <EmptyBlock icon={History} title="No revisions recorded">Saving a salary structure (here or on the Salary Structure page) records a revision.</EmptyBlock>
        ) : (
          <DataTable columns={[
            { label: 'Employee' }, { label: 'Effective' }, { label: 'Previous', align: 'right', className: 'hidden sm:table-cell' },
            { label: 'New gross', align: 'right' }, { label: 'Change', className: 'hidden md:table-cell' }, { label: 'Reason', className: 'hidden lg:table-cell' },
          ]}>
            {revisions.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{r.employee_name || nameByUid[r.employee_uid]}</p>
                  <p className="text-xs text-slate-500">by {r.revised_by_name || r.revised_by || 'system'} · {fmtDate(r.created_at)}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{monthLabel(r.effective_from)}</td>
                <td className="px-4 py-3 text-right hidden sm:table-cell whitespace-nowrap text-slate-500">{r.previous_gross != null ? fmtINR(r.previous_gross, 0) : '—'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">{fmtINR(r.new_gross, 0)}</td>
                <td className="px-4 py-3 hidden md:table-cell"><ChangeBadge previous={r.previous_gross} next={r.new_gross} /></td>
                <td className="px-4 py-3 hidden lg:table-cell text-slate-600 max-w-xs break-words">{r.reason}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revise salary</DialogTitle>
            <DialogDescription>The employee's current component split is kept; only the monthly CTC changes. Edit components on the Salary Structure page if needed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Employee</Label>
              <Select value={form.employee_uid} onValueChange={pickEmployee}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.uid} value={e.uid}>{e.name} ({e.employee_code})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">New monthly CTC (₹)</Label><Input type="number" min="0" value={form.basic_salary} onChange={(e) => setForm({ ...form, basic_salary: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Effective from</Label><Input type="month" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Reason</Label><Input value={form.reason} maxLength={300} placeholder="e.g. Annual appraisal 2026" onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            <p className="text-xs text-slate-500">Components: {components.filter(c => c.type === 'earning').map(c => `${c.name}${c.is_percentage ? ` ${c.amount}%` : ''}`).join(', ')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShow(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Save revision'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
