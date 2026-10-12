import React, { useCallback, useEffect, useState } from 'react';
import { Send, Download, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import AnalyticsShell from '../components/AnalyticsShell';
import { useFilterOptions } from '../hooks';
import { fmtDateTime } from '../lib';

const STATUS_STYLES = {
  sent: 'bg-emerald-100 text-emerald-700',
  skipped: 'bg-amber-100 text-amber-700',
  failed: 'bg-rose-100 text-rose-700',
};

const DeliveryLogPage = () => {
  const options = useFilterOptions();
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/analytics/reports/deliveries', { params: { limit: 500, ...(status !== 'all' ? { status } : {}) } });
      setRows(r.data || []);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load the delivery log');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const exportList = () => exportCsv('report-deliveries', rows, [
    { label: 'When', value: r => r.created_at },
    { key: 'report_name', label: 'Report' },
    { key: 'trigger', label: 'Trigger' },
    { label: 'Triggered by', value: r => r.triggered_by?.email || 'scheduler' },
    { key: 'status', label: 'Status' },
    { key: 'row_count', label: 'Rows' },
    { label: 'Recipients', value: r => (r.recipients || []).join('; ') },
    { key: 'error', label: 'Error' },
  ]);

  return (
    <AnalyticsShell
      icon={Send}
      title="Delivery Log"
      subtitle="Every scheduled and manual report email, with row counts and errors"
      actions={
        <Button variant="outline" className="gap-2 h-9 text-xs sm:text-sm" onClick={exportList} disabled={!rows.length}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      }
    >
      {options.email_configured === false && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs sm:text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Email is not configured on the server (MAILJET_API_KEY, MAILJET_API_SECRET, MAILJET_FROM_EMAIL), so reports run but deliveries are logged as skipped.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button type="button" className="ml-auto underline" onClick={load}>Retry</button>
        </div>
      )}

      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base sm:text-lg">Deliveries</CardTitle>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-36 text-xs sm:text-sm" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              <Send className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              No deliveries yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">When</th>
                    <th className="text-left font-medium px-4 py-3">Report</th>
                    <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Trigger</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                    <th className="text-right font-medium px-4 py-3 hidden sm:table-cell">Rows</th>
                    <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Recipients</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDateTime(d.created_at)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{d.report_name}</p>
                        {d.error && <p className="text-[11px] text-slate-500 max-w-xs break-words">{d.error}</p>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell capitalize text-slate-600">
                        {d.trigger}{d.triggered_by?.email ? <span className="block text-[11px] normal-case text-slate-400">{d.triggered_by.email}</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`${STATUS_STYLES[d.status] || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs capitalize`}>{d.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">{d.row_count ?? '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-600 break-all">{(d.recipients || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </AnalyticsShell>
  );
};

export default DeliveryLogPage;
