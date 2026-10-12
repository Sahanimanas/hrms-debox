import React, { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Download, FileText, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, LoadingBlock, EmptyBlock, ErrorBlock, DataTable, StatusPill } from '../components/PayrollUI';
import { API, errMsg, fmtINR, monthLabel, recentFys, downloadFile, blobErrMsg, RUN_STATUS_STYLES } from '../lib';

const RUN_FILES = [
  { path: 'ecr', label: 'PF ECR 2.0', ext: 'txt', icon: FileText },
  { path: 'esi', label: 'ESI contributions', ext: 'csv', icon: FileText },
  { path: 'pt', label: 'Professional tax', ext: 'csv', icon: FileText },
  { path: 'bank-file', label: 'Bank transfer', ext: 'csv', icon: Landmark },
  { path: 'bank-file', label: 'HDFC bulk upload', ext: 'csv', icon: Landmark, params: { format: 'hdfc' } },
  { path: 'register', label: 'Payroll register', ext: 'csv', icon: FileSpreadsheet },
];

export default function StatutoryReportsPage() {
  const fys = recentFys(4);
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState('');
  const [fy, setFy] = useState(fys[0]);
  const [form16, setForm16] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loading16, setLoading16] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await api.get(`${API}/runs`);
      const locked = (res.data || []).filter(r => r.status !== 'draft');
      setRuns(locked);
      setRunId(id => id || locked[0]?.id || '');
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load payroll runs'));
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const loadForm16 = useCallback(async () => {
    setLoading16(true);
    setError(null);
    try {
      const res = await api.get(`${API}/form16`, { params: { fy } });
      setForm16(res.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load Form 16 data'));
    } finally {
      setLoading16(false);
    }
  }, [fy]);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => { loadForm16(); }, [loadForm16]);

  const run = runs.find(r => r.id === runId);

  const download = async (key, path, filename, params) => {
    setBusy(key);
    try {
      const res = await downloadFile(path, filename, params);
      const missing = res.headers?.['x-missing-bank'] || res.headers?.['x-missing-uan'] || res.headers?.['x-missing-esic'];
      if (missing && missing !== '0') toast.warning(`${missing} employee(s) have missing details — check Statutory Details`);
    } catch (e) {
      toast.error(await blobErrMsg(e));
    } finally {
      setBusy('');
    }
  };

  const exportForm16List = () => exportCsv(`form16-${fy}`, form16, [
    { key: 'employee_code', label: 'Employee code' }, { key: 'employee_name', label: 'Name' }, { key: 'employee_email', label: 'Email' },
    { key: 'months', label: 'Months' }, { key: 'gross', label: 'Taxable salary' }, { key: 'tds', label: 'TDS deducted' }, { key: 'regime', label: 'Regime' },
  ]);

  return (
    <PageShell icon={FileSpreadsheet} title="Statutory Reports" subtitle="PF ECR, ESI, PT, bank transfer files and Form 16 Part B">
      <SectionCard
        icon={FileText}
        title="Monthly files"
        actions={(
          <Select value={runId} onValueChange={setRunId} disabled={!runs.length}>
            <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Select payroll month" /></SelectTrigger>
            <SelectContent>{runs.map(r => <SelectItem key={r.id} value={r.id}>{monthLabel(r.month, true)}</SelectItem>)}</SelectContent>
          </Select>
        )}
        bodyClassName="p-4 sm:p-5"
      >
        {loadingRuns ? <LoadingBlock /> : !runs.length ? (
          <EmptyBlock icon={FileText} title="No locked payroll runs yet">Statutory and bank files are generated from locked payroll.</EmptyBlock>
        ) : (
          <div className="space-y-3">
            {run && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <StatusPill status={run.status} styles={RUN_STATUS_STYLES} />
                <span>{run.employee_count} employees · net {fmtINR(run.totals?.net, 0)} · PF (EE) {fmtINR(run.totals?.pf_employee, 0)} · ESI (EE) {fmtINR(run.totals?.esi_employee, 0)} · PT {fmtINR(run.totals?.pt, 0)} · TDS {fmtINR(run.totals?.tds, 0)}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {RUN_FILES.map((f) => {
                const Icon = f.icon;
                const key = `${f.path}-${f.label}`;
                return (
                  <Button
                    key={key}
                    variant="outline"
                    disabled={!run || !!busy}
                    onClick={() => download(key, `${API}/runs/${runId}/${f.path}`, `${f.label.replace(/\s+/g, '-')}-${run?.month}.${f.ext}`, f.params)}
                    className="justify-start gap-2 h-11"
                  >
                    <Icon className="w-4 h-4 text-slate-500" />
                    {busy === key ? 'Preparing…' : f.label}
                    <Download className="w-3.5 h-3.5 ml-auto text-slate-400" />
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={FileText}
        title="Form 16 Part B"
        actions={(
          <>
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{fys.map(f => <SelectItem key={f} value={f}>FY {f}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!form16.length} onClick={exportForm16List}><Download className="w-3.5 h-3.5" /> Export CSV</Button>
          </>
        )}
      >
        {loading16 ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={loadForm16} /> : form16.length === 0 ? (
          <EmptyBlock icon={FileText} title={`No locked payslips in FY ${fy}`} />
        ) : (
          <DataTable columns={[
            { label: 'Employee' }, { label: 'Months', className: 'hidden sm:table-cell' }, { label: 'Taxable salary', align: 'right', className: 'hidden md:table-cell' },
            { label: 'TDS', align: 'right' }, { label: '' },
          ]}>
            {form16.map((r) => (
              <tr key={r.employee_uid} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{r.employee_name}</p>
                  <p className="text-xs text-slate-500">{r.employee_code} · {r.regime === 'old' ? 'Old' : 'New'} regime</p>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">{r.months}</td>
                <td className="px-4 py-3 text-right hidden md:table-cell whitespace-nowrap">{fmtINR(r.gross, 0)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{fmtINR(r.tds, 0)}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm" variant="ghost" className="h-7 gap-1" disabled={!!busy}
                    onClick={() => download(`f16-${r.employee_uid}`, `${API}/form16/${encodeURIComponent(r.employee_uid)}/pdf`, `Form16-${r.employee_code}-${fy}.pdf`, { fy })}
                  >
                    <Download className="w-3.5 h-3.5" /> PDF
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </PageShell>
  );
}
