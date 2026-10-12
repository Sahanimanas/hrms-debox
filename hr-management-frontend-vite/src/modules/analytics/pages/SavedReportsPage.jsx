import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Plus, Play, Download, Pencil, Trash2, Send, Users, CalendarClock, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import AnalyticsShell from '../components/AnalyticsShell';
import ResultTable from '../components/ResultTable';
import { scheduleSummary, fmtDateTime, downloadServerCsv, errorText } from '../lib';

const STATUS_STYLES = {
  sent: 'bg-emerald-100 text-emerald-700',
  skipped: 'bg-amber-100 text-amber-700',
  failed: 'bg-rose-100 text-rose-700',
};

const SavedReportsPage = () => {
  const navigate = useNavigate();
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';
  const [reports, setReports] = useState([]);
  const [datasets, setDatasets] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [run, setRun] = useState(null); // { report, result }
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, d] = await Promise.all([api.get('/v2/analytics/reports'), api.get('/v2/analytics/reports/datasets')]);
      setReports(r.data || []);
      setDatasets(Object.fromEntries(d.data.datasets.map(x => [x.key, x.label])));
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runReport = async (report) => {
    setBusy(`run-${report.id}`);
    try {
      const r = await api.get(`/v2/analytics/reports/${report.id}/run`);
      setRun({ report, result: r.data });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Report failed');
    } finally {
      setBusy(null);
    }
  };

  const download = async (report) => {
    setBusy(`csv-${report.id}`);
    try {
      await downloadServerCsv(`/v2/analytics/reports/${report.id}/run`, { format: 'csv' }, `${report.name}.csv`);
    } catch (e) {
      toast.error(await errorText(e, 'Export failed'));
    } finally {
      setBusy(null);
    }
  };

  const sendNow = async (report) => {
    setBusy(`send-${report.id}`);
    try {
      const r = await api.post(`/v2/analytics/reports/${report.id}/send`, {});
      const d = r.data;
      if (d.status === 'sent') toast.success(`Sent ${d.row_count} row(s) to ${d.recipients.length} recipient(s)`);
      else if (d.status === 'skipped') toast.warning(`Report ran (${d.row_count} rows) but email is not configured on the server`);
      else toast.error(d.error || 'Delivery failed');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Delivery failed');
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    const report = toDelete;
    setToDelete(null);
    try {
      await api.delete(`/v2/analytics/reports/${report.id}`);
      toast.success('Report deleted');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to delete');
    }
  };

  const exportList = () => exportCsv('saved-reports', reports, [
    { key: 'name', label: 'Name' },
    { label: 'Dataset', value: r => datasets[r.definition?.dataset] || r.definition?.dataset },
    { label: 'Schedule', value: r => scheduleSummary(r.schedule) },
    { label: 'Active', value: r => (r.schedule ? (r.schedule.enabled ? 'Yes' : 'Paused') : '') },
    { label: 'Recipients', value: r => (r.schedule?.recipients || []).join('; ') },
    { label: 'Next run', value: r => r.schedule?.next_run_at || '' },
    { label: 'Last delivery', value: r => r.last_delivery_status || '' },
    { label: 'Shared with managers', value: r => (r.shared_with_managers ? 'Yes' : 'No') },
  ]);

  return (
    <AnalyticsShell
      icon={FileSpreadsheet}
      title="Reports"
      subtitle={isAdmin ? 'Saved custom reports, schedules and one-click exports' : 'Reports shared with managers — data is limited to your team'}
      actions={
        <>
          <Button variant="outline" className="gap-2 h-9 text-xs sm:text-sm" onClick={exportList} disabled={!reports.length}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          {isAdmin && (
            <Button className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 text-xs sm:text-sm" onClick={() => navigate('/analytics/reports/new')}>
              <Plus className="w-4 h-4" /> New report
            </Button>
          )}
        </>
      }
    >
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button type="button" className="ml-auto underline" onClick={load}>Retry</button>
        </div>
      )}

      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <CalendarClock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Saved reports
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading…</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm px-4">
              <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              {isAdmin ? <>No saved reports yet. Use <span className="font-medium">New report</span> to build one.</> : 'No reports have been shared with managers yet.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reports.map((r) => (
                <div key={r.id} className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900 text-sm">{r.name}</p>
                      <Badge variant="outline" className="text-[10px]">{datasets[r.definition?.dataset] || r.definition?.dataset}</Badge>
                      {isAdmin && r.shared_with_managers && (
                        <Badge variant="outline" className="text-[10px] gap-1"><Users className="w-3 h-3" /> Shared</Badge>
                      )}
                      {isAdmin && r.last_delivery_status && (
                        <Badge className={`${STATUS_STYLES[r.last_delivery_status] || ''} hover:opacity-90 text-[10px] capitalize`}>Last: {r.last_delivery_status}</Badge>
                      )}
                    </div>
                    {r.description && <p className="text-xs text-slate-500 mt-0.5 break-words">{r.description}</p>}
                    {isAdmin && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        {scheduleSummary(r.schedule)}
                        {r.schedule && !r.schedule.enabled && ' (paused)'}
                        {r.schedule?.enabled && r.schedule.next_run_at && <> · next {fmtDateTime(r.schedule.next_run_at)}</>}
                        {r.schedule?.recipients?.length > 0 && <> · {r.schedule.recipients.length} recipient(s)</>}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => runReport(r)} disabled={busy === `run-${r.id}`}>
                      {busy === `run-${r.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => download(r)} disabled={busy === `csv-${r.id}`}>
                      <Download className="w-3.5 h-3.5" /> CSV
                    </Button>
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => sendNow(r)} disabled={busy === `send-${r.id}` || !r.schedule?.recipients?.length} title={r.schedule?.recipients?.length ? 'Email now to the recipients' : 'Add recipients in the schedule first'}>
                          {busy === `send-${r.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send now
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1 h-8" onClick={() => navigate(`/analytics/reports/${r.id}/edit`)}>
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1 h-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setToDelete(r)}>
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!run} onOpenChange={(o) => !o && setRun(null)}>
        <DialogContent className="max-w-5xl w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto p-3 sm:p-6">
          <DialogHeader>
            <DialogTitle>{run?.report?.name}</DialogTitle>
          </DialogHeader>
          {run && <ResultTable result={run.result} title="Results" filename={run.report.name} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{toDelete?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">The report and its schedule are removed. Past deliveries stay in the delivery log.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnalyticsShell>
  );
};

export default SavedReportsPage;
