import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Plus, Download, ChevronRight, Users, Wallet, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { StatusBadge, StatCard } from '@/components/ds';
import PageHeader, { PageShell, LoadingBlock, ErrorBlock } from '@/modules/platform/components/PageHeader';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, fmtINR, monthLabel, currentMonth, shiftMonth, errMsg, fmtDate } from '../lib';

const TH = 'px-4 py-2.5 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-ink-muted whitespace-nowrap';
const TD = 'px-4 py-3.5 text-sm leading-5 whitespace-nowrap';

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
    <PageShell>
      <PageHeader title="Payroll runs" subtitle="Monthly payroll: draft → review → lock → paid">
        <Button variant="outline" onClick={exportRuns} disabled={!runs.length}>
          <Download /> Export CSV
        </Button>
        <Button onClick={() => setShowCreate(true)}>
          <Plus /> New payroll run
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-4">
        <StatCard
          label="Latest run"
          value={latest ? monthLabel(latest.month) : '—'}
          icon={Banknote}
          tone="accent"
          note={latest ? undefined : 'No runs yet'}
          delta={latest ? <span className="capitalize">{latest.status}</span> : undefined}
          deltaTone={latest?.status === 'paid' ? 'success' : latest?.status === 'locked' ? 'info' : 'warning'}
        />
        <StatCard label="Employees" value={latest?.employee_count ?? '—'} icon={Users} tone="info" />
        <StatCard label="Net pay" value={latest ? fmtINR(latest.totals?.net, 0) : '—'} icon={Wallet} tone="success" />
        <StatCard label="Employer cost" value={latest ? fmtINR(latest.totals?.employer_cost, 0) : '—'} icon={Building2} tone="violet" />
      </div>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <div className="px-6 py-5">
          <h2 className="font-display text-base font-semibold leading-6 text-ink">All runs</h2>
          <p className="text-[13px] leading-[18px] text-ink-secondary">Open a run to review payslips, lock and pay</p>
        </div>
        {loading ? <div className="border-t border-line"><LoadingBlock /></div> : error ? <div className="border-t border-line"><ErrorBlock message={error} onRetry={load} /></div> : runs.length === 0 ? (
          <div className="border-t border-line px-6 py-12 text-center">
            <Banknote className="mx-auto mb-3 h-9 w-9 text-ink-muted" />
            <p className="text-sm font-medium text-ink">No payroll runs yet</p>
            <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">
              Create a run for a month to compute payslips for every active employee with a salary structure.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-y border-line bg-canvas">
                <tr>
                  <th className={cn(TH, 'pl-6 text-left')}>Month</th>
                  <th className={cn(TH, 'text-left')}>Status</th>
                  <th className={cn(TH, 'hidden text-right sm:table-cell')}>Employees</th>
                  <th className={cn(TH, 'hidden text-right md:table-cell')}>Gross</th>
                  <th className={cn(TH, 'text-right')}>Net pay</th>
                  <th className={cn(TH, 'hidden text-left lg:table-cell')}>Updated</th>
                  <th className={cn(TH, 'pr-6')}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-canvas" onClick={() => navigate(`/payroll/runs/${run.id}`)}>
                    <td className={cn(TD, 'pl-6 font-semibold text-ink')}>{monthLabel(run.month, true)}</td>
                    <td className={TD}><StatusBadge status={run.status} /></td>
                    <td className={cn(TD, 'hidden text-right text-ink-secondary sm:table-cell')}>{run.employee_count}</td>
                    <td className={cn(TD, 'hidden text-right text-ink-secondary md:table-cell')}>{fmtINR(run.totals?.gross, 0)}</td>
                    <td className={cn(TD, 'text-right font-semibold text-ink')}>{fmtINR(run.totals?.net, 0)}</td>
                    <td className={cn(TD, 'hidden text-ink-secondary lg:table-cell')}>{fmtDate(run.paid_at || run.locked_at || run.computed_at)}</td>
                    <td className={cn(TD, 'pr-6 text-right')}><ChevronRight className="inline h-4 w-4 text-ink-muted" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
            <Button onClick={create} disabled={creating}>
              {creating ? 'Computing…' : 'Create draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
