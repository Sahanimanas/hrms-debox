import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarClock, Download, PlayCircle, RefreshCw, ArrowRightCircle, Wallet, Ban, CheckCircle2, Search, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { errorText } from '../lib';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const YearEndPage = () => {
  const thisYear = new Date().getFullYear();
  const defaultYear = new Date().getMonth() === 11 ? thisYear : thisYear - 1;
  const [year, setYear] = useState(defaultYear);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [runs, setRuns] = useState([]);
  const [encashments, setEncashments] = useState([]);
  const [confirm, setConfirm] = useState({ open: false, force: false, message: '' });
  const [running, setRunning] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/v2/leave/year-end/preview', { params: { year } });
      setPreview(response.data);
    } catch (err) {
      setError(errorText(err, 'Failed to load the year-end preview'));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  const loadHistory = useCallback(async () => {
    try {
      const [runsRes, encRes] = await Promise.all([
        api.get('/v2/leave/year-end/runs'),
        api.get('/v2/leave/encashments', { params: { year } }),
      ]);
      setRuns(runsRes.data || []);
      setEncashments(encRes.data || []);
    } catch (err) {
      console.error('Failed to load year-end history:', err);
    }
  }, [year]);

  useEffect(() => { loadPreview(); }, [loadPreview]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (preview?.employees || []).filter((e) => !q || `${e.employee_name} ${e.employee_email} ${e.department || ''}`.toLowerCase().includes(q));
  }, [preview, search]);

  const canRun = year === thisYear - 1;

  const runYearEnd = async (force) => {
    setRunning(true);
    try {
      const response = await api.post('/v2/leave/year-end/run', { year, force });
      const r = response.data;
      toast.success(`Closed ${r.closed} employee(s), ${r.encashments_created} encashment(s); ${r.opening_applied} balance(s) opened for ${r.opening_year}`);
      setConfirm({ open: false, force: false, message: '' });
      loadPreview();
      loadHistory();
    } catch (err) {
      if (err.response?.status === 409 && err.response.data?.requires_force) {
        setConfirm({ open: true, force: true, message: err.response.data.detail });
      } else {
        toast.error(errorText(err, 'Year-end run failed'));
        setConfirm({ open: false, force: false, message: '' });
      }
    } finally {
      setRunning(false);
    }
  };

  const exportPreview = () => {
    const flat = [];
    rows.forEach((e) => e.rows.forEach((r) => flat.push({ ...r, employee_name: e.employee_name, employee_email: e.employee_email, department: e.department, processed: e.processed })));
    if (!flat.length) return toast.info('Nothing to export');
    exportCsv(`leave-year-end-${year}`, flat, [
      { key: 'employee_name', label: 'Employee' },
      { key: 'employee_email', label: 'Email' },
      { key: 'department', label: 'Department' },
      { key: 'leave_type', label: 'Leave type' },
      { key: 'closing', label: 'Closing balance' },
      { key: 'carry', label: 'Carry forward' },
      { key: 'encash', label: 'Encash (days)' },
      { key: 'amount', label: 'Encash amount (INR)' },
      { key: 'lapse', label: 'Lapse' },
      { label: 'Status', value: (r) => (r.processed ? 'Processed' : 'Pending') },
    ]);
  };

  const exportEncashments = () => {
    if (!encashments.length) return toast.info('No encashments to export');
    exportCsv(`leave-encashments-${year}`, encashments, [
      { key: 'employee_name', label: 'Employee' },
      { key: 'employee_email', label: 'Email' },
      { key: 'department', label: 'Department' },
      { key: 'leave_type', label: 'Leave type' },
      { key: 'days', label: 'Days' },
      { key: 'per_day_amount', label: 'Per day (INR)' },
      { key: 'amount', label: 'Amount (INR)' },
      { key: 'status', label: 'Status' },
      { key: 'payroll_run_id', label: 'Payroll run' },
    ]);
  };

  const totals = preview?.totals || { carry: 0, encash: 0, lapse: 0, amount: 0 };
  const cards = [
    { label: 'Carried forward', value: `${totals.carry} d`, icon: ArrowRightCircle, tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Encashed', value: `${totals.encash} d`, icon: Wallet, tone: 'bg-sky-50 text-sky-600' },
    { label: 'Encash amount', value: inr(totals.amount), icon: Wallet, tone: 'bg-purple-50 text-purple-600' },
    { label: 'Lapsing', value: `${totals.lapse} d`, icon: Ban, tone: 'bg-rose-50 text-rose-600' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
              <CalendarClock className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Leave Year-End
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">Carry forward, encash and lapse balances per the leave policy</p>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-full sm:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              onClick={() => setConfirm({ open: true, force: false, message: '' })}
              disabled={!canRun || loading || running || !preview?.pending_count}
              className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 whitespace-nowrap"
              title={!canRun ? `Only ${thisYear - 1} can be closed` : undefined}
            >
              <PlayCircle className="w-4 h-4" /> Run year-end
            </Button>
          </div>
        </div>

        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-3 sm:p-4 text-xs sm:text-sm text-amber-900 space-y-1">
            <p>
              Closing <strong>{year}</strong> carries each balance forward up to the type&apos;s cap, encashes the excess for encashable types
              (days × basic ÷ 26, paid by payroll) and lapses the rest. It then opens <strong>{year + 1}</strong> with the January credit plus the carried days.
            </p>
            <p className="text-amber-800">
              Runs automatically on 1 January (job <code>leave-year-end</code>). Running it is safe to repeat — employees already processed are skipped.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          {cards.map(({ label, value, icon, tone }) => {
            const Icon = icon;
            return (
              <Card key={label} className="border-slate-100 shadow-sm">
                <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">{loading ? '—' : value}</p>
                  </div>
                  <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Tabs defaultValue="preview" className="space-y-4">
          <TabsList className="grid w-full sm:w-auto grid-cols-3 sm:inline-grid">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="encashments">Encashments</TabsTrigger>
            <TabsTrigger value="runs">Run history</TabsTrigger>
          </TabsList>

          <TabsContent value="preview">
            <Card className="border-0 shadow-md">
              <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2 flex-wrap">
                    Employees
                    {preview && <Badge variant="outline">{preview.pending_count} pending</Badge>}
                    {preview?.processed_count > 0 && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{preview.processed_count} processed</Badge>}
                  </CardTitle>
                  <div className="flex gap-2">
                    <div className="relative flex-1 sm:w-56">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="pl-8 h-9 text-sm" />
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={exportPreview} disabled={!rows.length}>
                      <Download className="w-3.5 h-3.5" /> Export
                    </Button>
                  </div>
                </div>
                {preview?.policy?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {preview.policy.map((p) => (
                      <Badge key={p.leave_type} variant="outline" className="text-[10px] sm:text-xs font-normal">
                        {p.leave_type}: {p.carry_forward_allowed ? `carry ${p.max_carry_forward_days || '∞'}` : 'no carry'}
                        {p.encashment_allowed ? `, encash${p.max_encashment_days ? ` ≤${p.max_encashment_days}` : ''}` : ''}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {error ? (
                  <div className="text-center py-10 space-y-3">
                    <p className="text-sm text-red-600">{error}</p>
                    <Button variant="outline" size="sm" onClick={loadPreview} className="gap-2"><RefreshCw className="w-4 h-4" /> Retry</Button>
                  </div>
                ) : loading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3" />
                    <p className="text-sm text-slate-500">Calculating…</p>
                  </div>
                ) : rows.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-sm">No employees to process for {year}.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="text-left font-medium px-4 py-3">Employee</th>
                          <th className="text-left font-medium px-4 py-3">Leave type</th>
                          <th className="text-right font-medium px-3 py-3">Closing</th>
                          <th className="text-right font-medium px-3 py-3">Carry</th>
                          <th className="text-right font-medium px-3 py-3">Encash</th>
                          <th className="text-right font-medium px-3 py-3 hidden sm:table-cell">Amount</th>
                          <th className="text-right font-medium px-4 py-3">Lapse</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((e) => e.rows.map((r, idx) => (
                          <tr key={`${e.employee_uid}-${r.key}`} className={idx === 0 ? 'border-t-2 border-slate-100' : ''}>
                            {idx === 0 && (
                              <td className="px-4 py-2 align-top" rowSpan={e.rows.length}>
                                <p className="font-medium text-slate-900">{e.employee_name}</p>
                                <p className="text-xs text-slate-500">{e.department || '—'}</p>
                                {e.processed ? (
                                  <Badge className="mt-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px] gap-1"><CheckCircle2 className="w-3 h-3" /> Processed</Badge>
                                ) : e.totals.encash > 0 && e.basic_source === 'none' ? (
                                  <Badge className="mt-1 bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">No salary data</Badge>
                                ) : null}
                              </td>
                            )}
                            <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{r.leave_type}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.closing}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${r.carry ? 'text-emerald-700 font-medium' : 'text-slate-400'}`}>{r.carry}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${r.encash ? 'text-sky-700 font-medium' : 'text-slate-400'}`}>{r.encash}</td>
                            <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{r.amount ? inr(r.amount) : '—'}</td>
                            <td className={`px-4 py-2 text-right tabular-nums ${r.lapse ? 'text-rose-600' : 'text-slate-400'}`}>{r.lapse}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="encashments">
            <Card className="border-0 shadow-md">
              <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base sm:text-lg">Encashments for {year}</CardTitle>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={exportEncashments} disabled={!encashments.length}>
                  <Download className="w-3.5 h-3.5" /> Export
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {encashments.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">No encashments recorded for {year}.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="text-left font-medium px-4 py-3">Employee</th>
                          <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Leave type</th>
                          <th className="text-right font-medium px-4 py-3">Days</th>
                          <th className="text-right font-medium px-4 py-3">Amount</th>
                          <th className="text-left font-medium px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {encashments.map((e) => (
                          <tr key={e.id}>
                            <td className="px-4 py-3"><p className="font-medium text-slate-900">{e.employee_name}</p><p className="text-xs text-slate-500">{e.department || ''}</p></td>
                            <td className="px-4 py-3 hidden sm:table-cell">{e.leave_type}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{e.days}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{inr(e.amount)}</td>
                            <td className="px-4 py-3">
                              <Badge className={e.status === 'paid' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-100 text-amber-700 hover:bg-amber-100'}>
                                {e.status === 'paid' ? 'Paid' : 'Pending payroll'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runs">
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                {runs.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">No year-end runs yet.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {runs.map((r) => (
                      <div key={r.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900 text-sm">Year {r.year} · {r.started_at ? format(new Date(r.started_at), 'dd MMM yyyy, HH:mm') : ''}</p>
                          <p className="text-xs text-slate-500">
                            by {r.run_by}
                            {r.result && ` · closed ${r.result.closed}, encashments ${r.result.encashments_created}, opened ${r.result.opening_applied}`}
                            {r.error && ` · ${r.error}`}
                          </p>
                        </div>
                        <Badge className={r.status === 'completed' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : r.status === 'failed' ? 'bg-red-100 text-red-700 hover:bg-red-100' : 'bg-amber-100 text-amber-700 hover:bg-amber-100'}>
                          {r.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={confirm.open} onOpenChange={(open) => !running && setConfirm({ open, force: false, message: '' })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirm.force && <AlertTriangle className="w-5 h-5 text-amber-600" />}
              Close leave year {year}?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-600">
            {confirm.force ? (
              <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{confirm.message}</p>
            ) : (
              <>
                <p>
                  {preview?.pending_count} employee(s) will be processed: {totals.carry} day(s) carried forward, {totals.encash} day(s) encashed ({inr(totals.amount)}) and {totals.lapse} day(s) lapsed.
                </p>
                <p>Balances are then reset for {year + 1} with the carried days added. This can&apos;t be undone.</p>
              </>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm({ open: false, force: false, message: '' })} disabled={running}>Cancel</Button>
            <Button onClick={() => runYearEnd(confirm.force)} disabled={running} className={confirm.force ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-800 hover:bg-slate-900'}>
              {running ? 'Running…' : confirm.force ? 'Run anyway' : 'Run year-end'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default YearEndPage;
