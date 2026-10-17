import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Banknote, ArrowLeft, RefreshCw, Lock, CheckCircle2, Send, Trash2, Download, Plus, AlertTriangle,
  Users, Wallet, Receipt, Landmark, FileText, Search, Check, Hourglass, TrendingUp, TrendingDown, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge, Avatar, StatCard, Panel, Segmented } from '@/components/ds';
import PageHeader, { PageShell, LoadingBlock, ErrorBlock } from '@/modules/platform/components/PageHeader';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import PayslipDialog from '../components/PayslipDialog';
import { API, fmtINR, monthLabel, shiftMonth, errMsg, fmtDate, downloadFile, blobErrMsg, ONE_OFF_LABELS } from '../lib';
import { employeeLabel } from '@/lib/employeeLabel';

const EMPTY_ADJ = { employee_uid: '', type: 'bonus', label: '', amount: '', taxable: true, note: '' };
const REGISTER_PAGE = 10;

/** ₹1.24 Cr / ₹18.6 L style amounts for the summary cards. */
const fmtCompact = (value, withThousands = false) => {
  const n = Number(value) || 0;
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (withThousands && a >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return fmtINR(n, 0);
};

const shortMonth = (month) => monthLabel(month).split(' ')[0];

const periodLabel = (month) => {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return '';
  return `01 – ${new Date(y, m, 0).getDate()} ${shortMonth(month)}`;
};

const pctChange = (current, previous) => {
  const prev = Number(previous);
  if (!prev) return null;
  return ((Number(current) || 0) - prev) / prev * 100;
};

const TH = 'px-4 py-2.5 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-ink-muted whitespace-nowrap';
const TD = 'px-4 py-3.5 text-sm leading-5 whitespace-nowrap';

/* ------------------------------------------------------------------ */
/* Run progress stepper                                                */
/* ------------------------------------------------------------------ */

function StepIndicator({ index, state }) {
  if (state === 'done') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-solid text-white">
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-4 border-brand-subtle bg-brand text-sm font-semibold text-brand-on">
        {index}
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-sm font-semibold text-ink-muted">
      {index}
    </span>
  );
}

function RunProgress({ steps }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface px-6 py-5 shadow-xs lg:flex-row lg:items-center">
      {steps.map((s, i) => (
        <React.Fragment key={s.title}>
          {i > 0 && (
            <div className={cn('hidden h-0.5 min-w-6 flex-1 rounded-[1px] lg:block', steps[i - 1].state === 'done' ? 'bg-success-solid' : 'bg-line')} />
          )}
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <StepIndicator index={i + 1} state={s.state} />
            <div className="min-w-0">
              <p className={cn('text-sm font-semibold leading-5', s.state === 'upcoming' ? 'text-ink-secondary' : 'text-ink')}>{s.title}</p>
              {s.note && (
                <p className={cn('text-xs font-medium leading-4', s.noteTone === 'warning' ? 'text-warning-fg' : 'text-ink-muted')}>{s.note}</p>
              )}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card shells                                                         */
/* ------------------------------------------------------------------ */

/** Card with a padded title row and a full-bleed body (tables). */
function TableCard({ title, subtitle, actions, children, footer, className }) {
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xs', className)}>
      <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold leading-6 text-ink">{title}</h2>
          {subtitle && <p className="text-[13px] leading-[18px] text-ink-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
      {footer && (
        <div className="flex items-center gap-2 border-t border-line bg-canvas px-6 py-3.5">{footer}</div>
      )}
    </section>
  );
}

function EmptyState({ icon, title, children }) {
  const Icon = icon;
  return (
    <div className="border-t border-line px-6 py-12 text-center">
      {Icon && <Icon className="mx-auto mb-3 h-9 w-9 text-ink-muted" />}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">{children}</p>}
    </div>
  );
}

function ComplianceRow({ ok, title, note }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', ok ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg')}>
        {ok ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Hourglass className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1 font-medium">
        <p className="text-sm leading-5 text-ink">{title}</p>
        <p className="text-xs leading-4 text-ink-muted">{note}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PayrollRunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [prevRun, setPrevRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('all'); // 'all' | 'ready' | 'review'
  const [showAll, setShowAll] = useState(false);
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

  // Previous month's run (same list the Payroll Runs page loads) — only used for the "vs last month" deltas.
  const runMonth = run?.month;
  useEffect(() => {
    if (!runMonth) return undefined;
    let alive = true;
    const prevMonth = shiftMonth(runMonth, -1);
    api.get(`${API}/runs`)
      .then((res) => { if (alive) setPrevRun((res.data || []).find(r => r.month === prevMonth) || null); })
      .catch(() => { if (alive) setPrevRun(null); });
    return () => { alive = false; };
  }, [runMonth]);

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

  const adjByEmployee = useMemo(() => {
    const map = {};
    adjustments.forEach((a) => { map[a.employee_uid] = [...(map[a.employee_uid] || []), a]; });
    return map;
  }, [adjustments]);

  const allSlips = useMemo(() => run?.payslips || [], [run]);
  const reviewCount = useMemo(() => allSlips.filter(p => p.warnings?.length > 0).length, [allSlips]);

  const payslips = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? allSlips.filter(p => `${p.employee_name} ${p.employee_code} ${p.department}`.toLowerCase().includes(q)) : allSlips;
    if (view === 'review') list = list.filter(p => p.warnings?.length > 0);
    if (view === 'ready') list = list.filter(p => !p.warnings?.length);
    // Exceptions first, otherwise keep the server order.
    return [...list].sort((a, b) => (b.warnings?.length > 0) - (a.warnings?.length > 0));
  }, [allSlips, search, view]);

  const breakdown = useMemo(() => {
    const totals = new Map();
    allSlips.forEach(p => (p.earnings || []).forEach((e) => {
      totals.set(e.name, (totals.get(e.name) || 0) + (Number(e.amount) || 0));
    }));
    const rows = [...totals.entries()].map(([name, amount]) => ({ name, amount })).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
    const sumAll = rows.reduce((s, r) => s + r.amount, 0);
    const top = rows.slice(0, 5);
    const rest = rows.slice(5).reduce((s, r) => s + r.amount, 0);
    if (rest > 0) top.push({ name: 'Other earnings', amount: rest });
    return top.map(r => ({ ...r, pct: sumAll ? (r.amount / sumAll) * 100 : 0 }));
  }, [allSlips]);

  if (loading && !run) {
    return <PageShell><PageHeader title="Payroll run" /><LoadingBlock /></PageShell>;
  }
  if (error && !run) {
    return <PageShell><PageHeader title="Payroll run" /><ErrorBlock message={error} onRetry={load} /></PageShell>;
  }
  if (!run) return null;

  const isDraft = run.status === 'draft';
  const t = run.totals || {};
  const count = run.employee_count || allSlips.length;

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

  // ---- Run progress (computed → review & lock → disburse → payslips) ----
  const attentionNote = reviewCount > 0 ? `${reviewCount} need attention` : 'Ready to lock';
  const steps = [
    {
      title: 'Draft computed',
      state: 'done',
      note: `${adjustments.length} one-off${adjustments.length === 1 ? '' : 's'} · ${fmtDate(run.computed_at || run.created_at)}`,
    },
    isDraft
      ? { title: 'Review & lock', state: 'current', note: attentionNote, noteTone: reviewCount > 0 ? 'warning' : undefined }
      : { title: 'Review & lock', state: 'done', note: `Locked ${fmtDate(run.locked_at)}` },
    run.status === 'paid'
      ? { title: 'Disburse', state: 'done', note: `Paid ${fmtDate(run.paid_at)}${run.payment_reference ? ` · ref ${run.payment_reference}` : ''}` }
      : { title: 'Disburse', state: run.status === 'locked' ? 'current' : 'upcoming', note: run.status === 'locked' ? 'Awaiting payment' : 'After lock' },
    run.published_at
      ? { title: 'Payslips published', state: 'done', note: `Published ${fmtDate(run.published_at)}` }
      : { title: 'Payslips published', state: isDraft ? 'upcoming' : 'current', note: isDraft ? 'After lock' : 'Not yet published' },
  ];

  // ---- Summary cards ----
  const prevTotals = prevRun?.totals || null;
  const grossDelta = pctChange(t.gross, prevTotals?.gross);
  const netDelta = pctChange(t.net, prevTotals?.net);
  const deltaProps = (pct) => (pct == null ? {} : {
    delta: `${Math.abs(pct).toFixed(1)}%`,
    deltaIcon: pct >= 0 ? TrendingUp : TrendingDown,
    deltaTone: pct >= 0 ? 'success' : 'warning',
  });
  const deductionShare = t.gross ? Math.round((t.deductions / t.gross) * 100) : 0;
  const warningKinds = [...new Set(allSlips.flatMap(p => (p.warnings || []).map((w) => {
    if (/bank/i.test(w)) return 'bank';
    if (/PAN/.test(w)) return 'PAN';
    if (/UAN/.test(w)) return 'UAN';
    if (/tax slab/i.test(w)) return 'tax slabs';
    return 'other';
  })))];

  const rowStatus = (p) => {
    if (p.warnings?.length) return { label: 'Needs review', tone: 'warning' };
    const a = adjByEmployee[p.employee_uid];
    if (a?.length) return { label: ONE_OFF_LABELS[a[0].type] || 'One-off', tone: a[0].type === 'other_deduction' ? 'danger' : 'info' };
    if (p.lop_days > 0) return { label: 'Prorated', tone: 'violet' };
    if (run.status === 'paid') return { label: 'Paid', tone: 'success' };
    if (run.status === 'locked') return { label: 'Locked', tone: 'info' };
    return { label: 'Ready', tone: 'success' };
  };

  const visibleSlips = showAll ? payslips : payslips.slice(0, REGISTER_PAGE);

  return (
    <PageShell>
      <PageHeader
        title={`Payroll · ${monthLabel(run.month, true)}`}
        subtitle={`Pay period ${periodLabel(run.month)} · FY ${run.financial_year} · ${count} employee${count === 1 ? '' : 's'} · created by ${run.created_by_name || run.created_by}`}
      >
        <Button variant="outline" onClick={() => navigate('/payroll/runs')}><ArrowLeft /> Runs</Button>
        {isDraft && (
          <>
            <Button variant="ghost" onClick={() => setConfirm('delete')} disabled={!!busy} className="text-danger-fg hover:bg-danger-bg hover:text-danger-fg">
              <Trash2 /> Discard
            </Button>
            <Button variant="outline" onClick={recompute} disabled={!!busy}>
              <RefreshCw className={busy === 'recompute' ? 'animate-spin' : ''} /> Recompute
            </Button>
            <Button onClick={() => setConfirm('lock')} disabled={!!busy || !run.payslips.length}>
              <Lock /> Approve &amp; lock
            </Button>
          </>
        )}
        {!isDraft && (
          <Button variant="outline" onClick={publish} disabled={!!busy}>
            <Send /> {run.published_at ? 'Re-publish' : 'Publish payslips'}
          </Button>
        )}
        {run.status === 'locked' && (
          <Button onClick={() => setShowPay(true)} disabled={!!busy}>
            <CheckCircle2 /> Mark paid
          </Button>
        )}
      </PageHeader>

      <RunProgress steps={steps} />

      {/* Totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-4">
        <StatCard
          label="Gross payroll"
          value={fmtCompact(t.gross)}
          icon={Banknote}
          tone="accent"
          {...deltaProps(grossDelta)}
          note={prevTotals ? `vs ${shortMonth(prevRun.month)} · ${fmtCompact(prevTotals.gross)}` : `LOP ${fmtCompact(t.lop, true)}`}
        />
        <StatCard
          label="Deductions"
          value={fmtCompact(t.deductions)}
          icon={Receipt}
          tone="info"
          delta="PF · ESI · PT · TDS"
          deltaTone="neutral"
          note={`${deductionShare}% of gross`}
        />
        <StatCard
          label="Net pay"
          value={fmtCompact(t.net)}
          icon={Wallet}
          tone="success"
          {...deltaProps(netDelta)}
          note={count ? `avg ${fmtCompact((t.net || 0) / count, true)} / employee` : undefined}
        />
        <StatCard
          label="Needs review"
          value={reviewCount}
          icon={Hourglass}
          tone="warning"
          delta={run.skipped?.length ? `${run.skipped.length} not included` : reviewCount ? 'needs review' : 'all clear'}
          deltaTone="neutral"
          note={warningKinds.length ? warningKinds.slice(0, 3).join(' / ') : undefined}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-6">
          <TableCard
            title={`Pay register (${run.payslips.length})`}
            subtitle={isDraft ? 'Review exceptions before approving' : 'Payslips are final'}
            actions={(
              <>
                <div className="relative w-full sm:w-52">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" className="h-9 pl-9" />
                </div>
                <Segmented
                  options={[{ value: 'all', label: 'All' }, { value: 'ready', label: 'Ready' }, { value: 'review', label: `Needs review${reviewCount ? ` (${reviewCount})` : ''}` }]}
                  value={view}
                  onChange={(v) => { setView(v); setShowAll(false); }}
                />
              </>
            )}
            footer={payslips.length > 0 && (
              <>
                <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink-secondary">
                  Showing {visibleSlips.length} of {payslips.length}{reviewCount > 0 && view === 'all' ? ' · exceptions first' : ''}
                </p>
                {payslips.length > REGISTER_PAGE && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAll(v => !v)}>
                    <ArrowRight className={cn('transition-transform', showAll && '-rotate-90')} /> {showAll ? 'Show fewer' : 'View all'}
                  </Button>
                )}
              </>
            )}
          >
            {payslips.length === 0 ? (
              <EmptyState icon={Users} title={run.payslips.length ? 'No matches' : 'No payslips'}>
                {!run.payslips.length && 'Add salary structures for employees, then recompute.'}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-y border-line bg-canvas">
                    <tr>
                      <th className={cn(TH, 'pl-6 text-left')}>Employee</th>
                      <th className={cn(TH, 'hidden text-right md:table-cell')}>Paid days</th>
                      <th className={cn(TH, 'hidden text-right sm:table-cell')}>Gross</th>
                      <th className={cn(TH, 'hidden text-right lg:table-cell')}>Deductions</th>
                      <th className={cn(TH, 'text-right')}>Net pay</th>
                      <th className={cn(TH, 'text-left')}>Status</th>
                      <th className={cn(TH, 'pr-6')}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSlips.map((p) => {
                      const st = rowStatus(p);
                      return (
                        <tr key={p.id} className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-canvas" onClick={() => setSelected(p)}>
                          <td className={cn(TD, 'pl-6')}>
                            <div className="flex min-w-[180px] items-center gap-3">
                              <Avatar name={p.employee_name} size="lg" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold leading-5 text-ink">{p.employee_name}</p>
                                <p className="truncate text-xs font-medium leading-4 text-ink-muted">
                                  {[p.employee_code, p.designation || p.department].filter(Boolean).join(' · ') || '—'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className={cn(TD, 'hidden text-right text-ink-secondary md:table-cell')}>
                            {p.payable_days}
                            {p.lop_days > 0 && <span className="block text-xs leading-4 text-danger-fg">LOP {p.lop_days}</span>}
                          </td>
                          <td className={cn(TD, 'hidden text-right text-ink-secondary sm:table-cell')}>{fmtINR(p.gross_earnings, 0)}</td>
                          <td className={cn(TD, 'hidden text-right text-ink-secondary lg:table-cell')}>{fmtINR(p.total_deductions, 0)}</td>
                          <td className={cn(TD, 'text-right font-semibold text-ink')}>{fmtINR(p.net_pay, 0)}</td>
                          <td className={TD} title={p.warnings?.length ? p.warnings.join('\n') : undefined}>
                            <StatusBadge label={st.label} tone={st.tone} />
                          </td>
                          <td className={cn(TD, 'pr-6 text-right')} onClick={(e) => e.stopPropagation()}>
                            {isDraft && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => { setAdj({ ...EMPTY_ADJ, employee_uid: p.employee_uid }); setShowAdj(true); }}
                              >
                                <Plus /><span className="hidden sm:inline">One-off</span>
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelected(p)}>View</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TableCard>

          {(missingCount > 0 || run.skipped?.length > 0) && (
            <Panel
              title="Needs attention"
              subtitle="Fix these before generating bank and statutory files"
              actions={(
                <Button variant="ghost" size="sm" onClick={() => navigate('/payroll/statutory')}>
                  Edit details <ArrowRight />
                </Button>
              )}
              bodyClassName="space-y-3"
            >
              {[
                compliance?.missing_bank?.length > 0 && { key: 'bank', title: `Missing bank details (${compliance.missing_bank.length}) — left out of the bank file`, names: compliance.missing_bank },
                compliance?.missing_uan?.length > 0 && { key: 'uan', title: `Missing UAN (${compliance.missing_uan.length}) — left out of the ECR`, names: compliance.missing_uan },
                compliance?.missing_esic?.length > 0 && { key: 'esic', title: `Missing ESIC number (${compliance.missing_esic.length})`, names: compliance.missing_esic },
              ].filter(Boolean).map(item => (
                <div key={item.key} className="flex gap-3 rounded-md border border-line bg-canvas p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-5 text-ink">{item.title}</p>
                    <p className="text-xs leading-4 text-ink-secondary">{item.names.map(x => x.employee_name).join(', ')}</p>
                  </div>
                </div>
              ))}
              {run.skipped?.length > 0 && (
                <div className="flex gap-3 rounded-md border border-line bg-canvas p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-5 text-ink">Not included ({run.skipped.length})</p>
                    <ul className="space-y-0.5 text-xs leading-4 text-ink-secondary">
                      {run.skipped.map(s => <li key={s.employee_uid}>{s.employee_name}: {s.reason}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </Panel>
          )}

          <TableCard
            title="One-off earnings & deductions"
            subtitle="Bonuses, arrears, incentives and one-time deductions"
            actions={isDraft && (
              <Button size="sm" onClick={() => { setAdj(EMPTY_ADJ); setShowAdj(true); }}>
                <Plus /> Add one-off
              </Button>
            )}
          >
            {adjustments.length === 0 ? (
              <EmptyState icon={Receipt} title="No one-offs in this run">
                {isDraft ? 'Add bonuses, arrears, incentives or one-time deductions while the run is a draft.' : null}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-y border-line bg-canvas">
                    <tr>
                      <th className={cn(TH, 'pl-6 text-left')}>Employee</th>
                      <th className={cn(TH, 'text-left')}>Type</th>
                      <th className={cn(TH, 'text-right')}>Amount</th>
                      <th className={cn(TH, 'hidden text-left sm:table-cell')}>Taxable</th>
                      <th className={cn(TH, 'pr-6')}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.map((a) => (
                      <tr key={a.id} className="border-b border-line last:border-0">
                        <td className={cn(TD, 'pl-6 font-medium text-ink')}>{a.employee_name}</td>
                        <td className={cn(TD, 'whitespace-normal')}>
                          <p className="text-ink">{a.label}</p>
                          <p className="text-xs leading-4 text-ink-muted">{ONE_OFF_LABELS[a.type]}{a.note ? ` · ${a.note}` : ''}</p>
                        </td>
                        <td className={cn(TD, 'text-right font-semibold', a.type === 'other_deduction' ? 'text-danger-fg' : 'text-success-fg')}>
                          {a.type === 'other_deduction' ? '−' : '+'}{fmtINR(a.amount)}
                        </td>
                        <td className={cn(TD, 'hidden text-ink-secondary sm:table-cell')}>{a.type === 'other_deduction' ? '—' : a.taxable ? 'Yes' : 'No'}</td>
                        <td className={cn(TD, 'pr-6 text-right')}>
                          {isDraft && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
                              disabled={busy === `adj-${a.id}`}
                              onClick={() => deleteAdjustment(a.id)}
                              aria-label="Remove"
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TableCard>
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Cost breakdown" subtitle="Share of gross payroll" bodyClassName="space-y-4">
            {breakdown.length === 0 ? (
              <p className="text-[13px] text-ink-secondary">No earnings computed yet.</p>
            ) : breakdown.map(row => (
              <div key={row.name} className="space-y-1.5">
                <div className="flex items-start gap-2 text-[13px] leading-[18px]">
                  <p className="min-w-0 flex-1 truncate text-ink-secondary">{row.name}</p>
                  <p className="whitespace-nowrap font-medium text-ink">{fmtCompact(row.amount, true)}</p>
                  <p className="w-9 whitespace-nowrap text-right text-ink-muted">{Math.round(row.pct)}%</p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-navy" style={{ width: `${Math.min(100, row.pct)}%` }} />
                </div>
              </div>
            ))}
            <div className="space-y-2 border-t border-line pt-4 text-[13px] leading-[18px]">
              <div className="flex items-center gap-2">
                <p className="flex-1 font-medium text-ink">Employer cost</p>
                <p className="font-semibold text-ink">{fmtINR(t.employer_cost, 0)}</p>
              </div>
              <div className="flex items-center gap-2 text-ink-secondary">
                <p className="flex-1">Employer PF · ESI</p>
                <p>{fmtINR(t.pf_employer, 0)} · {fmtINR(t.esi_employer, 0)}</p>
              </div>
              <div className="flex items-center gap-2 text-ink-secondary">
                <p className="flex-1">Loss of pay</p>
                <p>{fmtINR(t.lop, 0)}</p>
              </div>
              <div className="flex items-center gap-2 text-ink-secondary">
                <p className="flex-1">Loan recovery</p>
                <p>{fmtINR(t.loan_recovery, 0)}</p>
              </div>
            </div>
          </Panel>

          <Panel title="Statutory compliance" subtitle={`Auto-calculated for ${monthLabel(run.month, true).split(' ')[0]}`} bodyClassName="-mt-1">
            <ComplianceRow
              ok={!compliance?.missing_uan?.length}
              title="Provident Fund (EPF)"
              note={`${fmtCompact((t.pf_employee || 0) + (t.pf_employer || 0), true)} · ${compliance?.missing_uan?.length ? `${compliance.missing_uan.length} missing UAN` : `${compliance?.pf_members ?? 0} members${isDraft ? '' : ' · ECR ready'}`}`}
            />
            <ComplianceRow
              ok={!compliance?.missing_esic?.length}
              title="ESI"
              note={`${fmtCompact((t.esi_employee || 0) + (t.esi_employer || 0), true)} · ${compliance?.missing_esic?.length ? `${compliance.missing_esic.length} missing ESIC no.` : `${compliance?.esi_members ?? 0} eligible`}`}
            />
            <ComplianceRow ok title="Professional Tax" note={fmtINR(t.pt, 0)} />
            <ComplianceRow
              ok={!compliance?.missing_pan?.length}
              title="TDS (Sec 192)"
              note={`${fmtCompact(t.tds, true)}${compliance?.missing_pan?.length ? ` · ${compliance.missing_pan.length} PAN missing` : ''}`}
            />
            <ComplianceRow
              ok={!compliance?.missing_bank?.length}
              title="Bank transfer"
              note={compliance?.missing_bank?.length ? `${compliance.missing_bank.length} missing bank details` : `${fmtCompact(t.net, true)} to ${count} account${count === 1 ? '' : 's'}`}
            />
          </Panel>

          <Panel title="Files & exports" subtitle={isDraft ? 'Bank and statutory files unlock once the run is locked' : 'Bank transfer and statutory returns'}>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="justify-start" onClick={exportSlips}><Download /> Payslips CSV</Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={() => download('register', `payroll-register-${run.month}.csv`)} disabled={!!busy}><FileText /> Register</Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={() => download('bank-file', `bank-transfer-${run.month}.csv`)} disabled={isDraft || !!busy}><Landmark /> Bank file</Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={() => download('bank-file', `HDFC-bulk-${run.month}.csv`, { format: 'hdfc' })} disabled={isDraft || !!busy}><Landmark /> HDFC bulk</Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={() => download('ecr', `ECR-${run.month}.txt`)} disabled={isDraft || !!busy}><FileText /> PF ECR</Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={() => download('esi', `ESI-${run.month}.csv`)} disabled={isDraft || !!busy}><FileText /> ESI</Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={() => download('pt', `PT-${run.month}.csv`)} disabled={isDraft || !!busy}><FileText /> PT</Button>
            </div>
          </Panel>
        </div>
      </div>

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
                  {run.payslips.map(p => <SelectItem key={p.employee_uid} value={p.employee_uid}>{employeeLabel(p.employee_name, p.employee_code)}</SelectItem>)}
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
              <Label htmlFor="adj-label">Label on payslip <span className="font-normal text-ink-muted">(optional)</span></Label>
              <Input id="adj-label" value={adj.label} maxLength={80} placeholder={ONE_OFF_LABELS[adj.type]} onChange={(e) => setAdj({ ...adj, label: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-note">Note <span className="font-normal text-ink-muted">(optional)</span></Label>
              <Input id="adj-note" value={adj.note} maxLength={300} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
            </div>
            {adj.type !== 'other_deduction' && (
              <label className="flex items-center justify-between gap-3 text-sm text-ink">
                <span>Taxable (included in TDS)</span>
                <Switch checked={adj.taxable} onCheckedChange={(v) => setAdj({ ...adj, taxable: v })} />
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdj(false)}>Cancel</Button>
            <Button onClick={saveAdjustment} disabled={busy === 'adj'}>{busy === 'adj' ? 'Saving…' : 'Add'}</Button>
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
              ? <Button onClick={lock} disabled={busy === 'lock'}><Lock /> {busy === 'lock' ? 'Locking…' : 'Lock payroll'}</Button>
              : <Button onClick={remove} disabled={busy === 'delete'} className="bg-danger-solid text-white hover:bg-danger-fg">Discard</Button>}
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
            <Label htmlFor="pay-ref">Payment reference <span className="font-normal text-ink-muted">(optional)</span></Label>
            <Input id="pay-ref" value={payRef} maxLength={100} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank batch / UTR" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPay(false)}>Cancel</Button>
            <Button onClick={markPaid} disabled={busy === 'pay'}><CheckCircle2 /> {busy === 'pay' ? 'Saving…' : 'Mark paid'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
