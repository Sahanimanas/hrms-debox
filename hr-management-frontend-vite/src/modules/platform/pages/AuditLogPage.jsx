import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText, Download, Filter, ChevronLeft, ChevronRight, X, Eye, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import PageHeader, { PageShell, LoadingBlock, EmptyBlock, ErrorBlock } from '../components/PageHeader';
import { errorMessage, fmtDateTime, downloadFile, blobErrorMessage } from '../lib';

const EMPTY_FILTERS = { actor: '', action: '', method: '', status: '', kind: '', outcome: '', from: '', to: '' };
const METHOD_TONES = {
  POST: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PUT: 'bg-blue-50 text-blue-700 border-blue-200',
  PATCH: 'bg-blue-50 text-blue-700 border-blue-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
};

const statusTone = (s) => (s >= 500 ? 'text-red-700' : s >= 400 ? 'text-amber-700' : 'text-emerald-700');

const cleanParams = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null));

const describe = (e) => {
  if (e.kind === 'auth') {
    const label = e.action.replace(/^auth\./, '').replace(/[._]/g, ' ');
    return `${label}${e.reason ? ` — ${e.reason.replace(/_/g, ' ')}` : ''}`;
  }
  return e.action?.replace(/^(POST|PUT|PATCH|DELETE) /, '') || e.path;
};

const AuditLogPage = () => {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/platform/audit-logs', { params: { ...cleanParams(applied), page, limit: 25 } });
      setData(r.data);
    } catch (e) {
      setError(errorMessage(e, 'Could not load the audit log'));
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/v2/platform/audit-logs/summary').then(r => setSummary(r.data)).catch(() => {});
  }, []);

  const apply = (e) => {
    e?.preventDefault();
    if (filters.from && filters.to && filters.from > filters.to) {
      toast.error("'From' must be on or before 'To'");
      return;
    }
    setPage(1);
    setApplied(filters);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile('/v2/platform/audit-logs/export', cleanParams(applied), 'audit-log.csv');
    } catch (e) {
      toast.error(await blobErrorMessage(e, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const activeCount = Object.values(applied).filter(Boolean).length;
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const selectCls = 'mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm';

  return (
    <PageShell>
      <PageHeader icon={ScrollText} title="Audit Log" subtitle="Who changed what, when — every change and sign-in event">
        <Button variant="outline" className="gap-2 flex-1 sm:flex-none" onClick={() => setShowFilters(s => !s)}>
          <Filter className="w-4 h-4" /> Filters{activeCount ? ` (${activeCount})` : ''}
        </Button>
        <Button onClick={exportCsv} disabled={exporting || data.total === 0} className="gap-2 flex-1 sm:flex-none">
          <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </PageHeader>

      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {[
            { label: 'Changes (24h)', value: summary.changes },
            { label: 'Failed sign-ins (24h)', value: summary.failed_logins, warn: summary.failed_logins > 0 },
            { label: 'Access denied (24h)', value: summary.permission_denied, warn: summary.permission_denied > 0 },
          ].map(c => (
            <Card key={c.label} className="border-slate-100 shadow-sm">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider">{c.label}</p>
                <p className={`text-lg sm:text-2xl font-bold mt-0.5 ${c.warn ? 'text-amber-600' : 'text-slate-900'}`}>{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showFilters && (
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={apply} className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label htmlFor="f-actor" className="text-xs">Actor email contains</Label>
                <Input id="f-actor" value={filters.actor} onChange={set('actor')} className="mt-1" placeholder="name@company.com" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="f-action" className="text-xs">Action / path contains</Label>
                <Input id="f-action" value={filters.action} onChange={set('action')} className="mt-1" placeholder="e.g. payroll, login, roles" />
              </div>
              <div>
                <Label htmlFor="f-kind" className="text-xs">Type</Label>
                <select id="f-kind" value={filters.kind} onChange={set('kind')} className={selectCls}>
                  <option value="">All</option>
                  <option value="request">Changes</option>
                  <option value="auth">Sign-in & security</option>
                </select>
              </div>
              <div>
                <Label htmlFor="f-method" className="text-xs">Method</Label>
                <select id="f-method" value={filters.method} onChange={set('method')} className={selectCls}>
                  <option value="">All</option>
                  {['POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="f-status" className="text-xs">Status</Label>
                <select id="f-status" value={filters.status} onChange={set('status')} className={selectCls}>
                  <option value="">All</option>
                  <option value="2xx">2xx success</option>
                  <option value="4xx">4xx rejected</option>
                  <option value="403">403 forbidden</option>
                  <option value="5xx">5xx error</option>
                </select>
              </div>
              <div>
                <Label htmlFor="f-outcome" className="text-xs">Outcome</Label>
                <select id="f-outcome" value={filters.outcome} onChange={set('outcome')} className={selectCls}>
                  <option value="">All</option>
                  <option value="success">Success</option>
                  <option value="failure">Failure</option>
                </select>
              </div>
              <div>
                <Label htmlFor="f-from" className="text-xs">From</Label>
                <Input id="f-from" type="date" value={filters.from} onChange={set('from')} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="f-to" className="text-xs">To</Label>
                <Input id="f-to" type="date" value={filters.to} onChange={set('to')} className="mt-1" />
              </div>
              <div className="col-span-2 flex items-end gap-2">
                <Button type="submit" className="flex-1">Apply</Button>
                <Button type="button" variant="outline" onClick={reset} className="gap-1"><X className="w-4 h-4" /> Clear</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <ScrollText className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
            Events
            <span className="text-sm font-normal text-slate-500">({data.total})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : data.items.length === 0 ? (
            <EmptyBlock icon={ScrollText} title={activeCount ? 'No events match these filters' : 'No events recorded yet'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">When</th>
                    <th className="text-left font-medium px-4 py-3">Actor</th>
                    <th className="text-left font-medium px-4 py-3">Action</th>
                    <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Result</th>
                    <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">IP</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map(e => (
                    <tr key={e.id} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">{fmtDateTime(e.at)}</td>
                      <td className="px-4 py-3">
                        <p className="text-slate-900 truncate max-w-[180px]">{e.anonymous ? <span className="italic text-slate-400">anonymous</span> : e.actor_email || '—'}</p>
                        {e.actor_role && <p className="text-[11px] text-slate-500 capitalize">{e.actor_role}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {e.kind === 'auth'
                            ? <Badge variant="outline" className="text-[10px] gap-1 border-purple-200 text-purple-700"><ShieldAlert className="w-3 h-3" />auth</Badge>
                            : <Badge variant="outline" className={`text-[10px] ${METHOD_TONES[e.method] || ''}`}>{e.method}</Badge>}
                          <span className="text-slate-800 break-all">{describe(e)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell whitespace-nowrap">
                        {e.kind === 'auth'
                          ? <span className={e.outcome === 'failure' ? 'text-red-700' : 'text-emerald-700'}>{e.outcome || 'success'}</span>
                          : <span className={statusTone(e.status)}>{e.status}{e.duration_ms != null ? <span className="text-slate-400 text-xs"> · {Math.round(e.duration_ms)} ms</span> : null}</span>}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">{e.ip || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="View details" onClick={() => setDetail(e)}><Eye className="w-4 h-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Page {data.page} of {data.pages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Event details</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-[110px,1fr] gap-x-3 gap-y-1.5">
                {[
                  ['Time', fmtDateTime(detail.at)],
                  ['Actor', detail.anonymous ? 'anonymous (not recorded)' : detail.actor_email || '—'],
                  ['Role', detail.actor_role || '—'],
                  ['Action', detail.action],
                  ['Path', detail.path || '—'],
                  ['Status', detail.status ?? detail.outcome ?? '—'],
                  ['Reason', detail.reason || '—'],
                  ['IP', detail.ip || '—'],
                  ['User agent', detail.user_agent || '—'],
                ].map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-slate-900 break-all">{String(v)}</dd>
                  </React.Fragment>
                ))}
              </dl>
              {(detail.body || detail.details || detail.query || detail.files) && (
                <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify({ body: detail.body, query: detail.query, files: detail.files, details: detail.details }, null, 2)}
                </pre>
              )}
              <p className="text-xs text-slate-500">Passwords, codes, tokens and keys are redacted before they are stored.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default AuditLogPage;
