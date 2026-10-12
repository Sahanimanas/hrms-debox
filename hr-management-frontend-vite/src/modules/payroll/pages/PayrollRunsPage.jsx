import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Plus, Download, ChevronRight, Users, Wallet, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, StatCard, LoadingBlock, EmptyBlock, ErrorBlock, StatusPill, DataTable } from '../components/PayrollUI';
import { API, fmtINR, monthLabel, currentMonth, shiftMonth, errMsg, fmtDate, RUN_STATUS_STYLES } from '../lib';

export default function PayrollRunsPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [month, setMonth] = useState(shiftMonth(currentMonth(), -1));
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${API}/runs`);
      setRuns(res.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load payroll runs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return toast.error('Pick a month');
    setCreating(true);
    try {
      const res = await api.post(`${API}/runs`, { month });
      toast.success(`Draft payroll for ${monthLabel(month)} computed for ${res.data.employee_count} employee(s)`);
      setShowCreate(false);
      navigate(`/payroll/runs/${res.data.id}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not create the run'));
    } finally {
      setCreating(false);
    }
  };

  const latest = runs[0];
  const exportRuns = () => exportCsv('payroll-runs', runs, [
    { label: 'Month', value: (r) => r.month },
    { key: 'status', label: 'Status' },
    { key: 'employee_count', label: 'Employees' },
    { label: 'Gross', value: (r) => r.totals?.gross },
    { label: 'Deductions', value: (r) => r.totals?.deductions },
    { label: 'Net pay', value: (r) => r.totals?.net },
    { label: 'Employer cost', value: (r) => r.totals?.employer_cost },
    { label: 'Locked at', value: (r) => r.locked_at || '' },
    { label: 'Paid at', value: (r) => r.paid_at || '' },
  ]);

  return (
    <PageShell
      icon={Banknote}
      title="Payroll Runs"
      subtitle="Monthly payroll: draft → review → lock → paid"
      actions={(
        <>
          <Button variant="outline" onClick={exportRuns} disabled={!runs.length} className="gap-2 h-9 sm:h-10 text-xs sm:text-sm">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button onClick={() => setShowCreate(true)} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 sm:h-10 text-xs sm:text-sm">
            <Plus className="w-4 h-4" /> New payroll run
          </Button>
        </>
      )}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <StatCard label="Latest run" value={latest ? monthLabel(latest.month) : '—'} hint={latest?.status} icon={Banknote} tone="slate" />
        <StatCard label="Employees" value={latest?.employee_count ?? '—'} icon={Users} tone="blue" />
        <StatCard label="Net pay" value={latest ? fmtINR(latest.totals?.net, 0) : '—'} icon={Wallet} tone="emerald" />
        <StatCard label="Employer cost" value={latest ? fmtINR(latest.totals?.employer_cost, 0) : '—'} icon={Building2} tone="purple" />
      </div>

      <SectionCard icon={Banknote} title="All runs">
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : runs.length === 0 ? (
          <EmptyBlock icon={Banknote} title="No payroll runs yet">
            Create a run for a month to compute payslips for every active employee with a salary structure.
          </EmptyBlock>
        ) : (
          <DataTable columns={[
            { label: 'Month' }, { label: 'Status' }, { label: 'Employees', className: 'hidden sm:table-cell' },
            { label: 'Gross', align: 'right', className: 'hidden md:table-cell' }, { label: 'Net pay', align: 'right' },
            { label: 'Updated', className: 'hidden lg:table-cell' }, { label: '' },
          ]}>
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/payroll/runs/${run.id}`)}>
                <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{monthLabel(run.month, true)}</td>
                <td className="px-4 py-3"><StatusPill status={run.status} styles={RUN_STATUS_STYLES} /></td>
                <td className="px-4 py-3 hidden sm:table-cell">{run.employee_count}</td>
                <td className="px-4 py-3 text-right hidden md:table-cell whitespace-nowrap">{fmtINR(run.totals?.gross, 0)}</td>
                <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{fmtINR(run.totals?.net, 0)}</td>
                <td className="px-4 py-3 text-slate-500 hidden lg:table-cell whitespace-nowrap">{fmtDate(run.paid_at || run.locked_at || run.computed_at)}</td>
                <td className="px-4 py-3 text-right"><ChevronRight className="w-4 h-4 text-slate-400 inline" /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New payroll run</DialogTitle>
            <DialogDescription>
              Payslips are computed from salary structures, attendance (LOP), loans, leave encashments and investment declarations. You can review and recompute before locking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="run-month">Month</Label>
            <Input id="run-month" type="month" value={month} max={shiftMonth(currentMonth(), 1)} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating} className="bg-slate-800 hover:bg-slate-900">
              {creating ? 'Computing…' : 'Create draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
