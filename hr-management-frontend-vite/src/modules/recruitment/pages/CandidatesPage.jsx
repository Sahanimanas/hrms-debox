import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, UserPlus, Download, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, LoadingState, EmptyState, ErrorState, StageBadge, TableCard } from '../components/Common';
import { NativeSelect } from '../components/FormBits';
import AddCandidateDialog from '../components/AddCandidateDialog';
import { API, SOURCE_LABELS, STAGE_LABELS, STAGES, fmtDate, label, toOptions } from '../lib';

const PAGE_SIZE = 50;

export default function CandidatesPage() {
  const [jobs, setJobs] = useState([]);
  const [filters, setFilters] = useState({ q: '', job_id: '', stage: '', source: '', min_rating: '' });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ candidates: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.get(`${API}/jobs`).then(r => setJobs(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const params = useCallback((extra = {}) => {
    const p = { ...extra };
    if (debouncedQ) p.q = debouncedQ;
    ['job_id', 'stage', 'source', 'min_rating'].forEach(k => { if (filters[k]) p[k] = filters[k]; });
    return p;
  }, [debouncedQ, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`${API}/candidates`, { params: params({ page, limit: PAGE_SIZE }) });
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [params, page]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key) => (value) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); };

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await api.get(`${API}/candidates`, { params: params({ page: 1, limit: 500 }) });
      exportCsv('candidates', res.data.candidates, [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'job_title', label: 'Job' },
        { label: 'Stage', value: c => STAGE_LABELS[c.stage] },
        { key: 'offer_status', label: 'Offer status' },
        { label: 'Source', value: c => label(SOURCE_LABELS, c.source) },
        { key: 'referred_by_name', label: 'Referred by' },
        { key: 'rating', label: 'Rating' },
        { label: 'Tags', value: c => (c.tags || []).join('; ') },
        { label: 'Applied', value: c => fmtDate(c.created_at, 'yyyy-MM-dd') },
      ]);
      if (res.data.total > 500) toast.message('Exported the first 500 matching candidates');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <PageShell>
      <PageHeader icon={Users} title="Candidates" subtitle="Search applicants across all your jobs">
        <Button variant="outline" onClick={doExport} disabled={!data.total || exporting} className="gap-2 h-9 sm:h-10 flex-1 sm:flex-none">
          <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
        <Button onClick={() => setAddOpen(true)} disabled={!jobs.length} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 sm:h-10 flex-1 sm:flex-none">
          <UserPlus className="w-4 h-4" /> Add candidate
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="relative col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={filters.q} onChange={(e) => setFilter('q')(e.target.value)} placeholder="Name, email, phone or tag" className="pl-8 h-9 bg-white" aria-label="Search candidates" maxLength={100} />
        </div>
        <NativeSelect aria-label="Job" value={filters.job_id} onChange={setFilter('job_id')} placeholder="All jobs" className="bg-white" options={jobs.map(j => ({ value: j.id, label: j.title }))} />
        <NativeSelect aria-label="Stage" value={filters.stage} onChange={setFilter('stage')} placeholder="All stages" className="bg-white" options={STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] }))} />
        <NativeSelect aria-label="Source" value={filters.source} onChange={setFilter('source')} placeholder="All sources" className="bg-white" options={toOptions(SOURCE_LABELS)} />
        <NativeSelect aria-label="Minimum rating" value={filters.min_rating} onChange={setFilter('min_rating')} placeholder="Any rating" className="bg-white" options={[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n}+ stars` }))} />
      </div>

      <TableCard>
        {loading ? <LoadingState /> : error ? <ErrorState onRetry={load} /> : data.candidates.length === 0 ? (
          <EmptyState icon={Users} title="No candidates found" hint="Try different filters, or add a candidate manually." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Candidate</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Job</th>
                  <th className="text-left font-medium px-4 py-3">Stage</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Source</th>
                  <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.candidates.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/recruitment/candidates/${c.id}`} className="font-medium text-slate-900 hover:underline">{c.name}</Link>
                      <p className="text-xs text-slate-500 truncate max-w-[220px]">{c.email}</p>
                      <p className="text-xs text-slate-500 md:hidden truncate">{c.job_title}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.rating ? <span className="flex items-center gap-0.5 text-[11px] text-amber-600"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{c.rating}</span> : null}
                        {(c.tags || []).slice(0, 3).map(t => <Badge key={t} variant="secondary" className="text-[10px] py-0 px-1.5">{t}</Badge>)}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-700">{c.job_title}</td>
                    <td className="px-4 py-3"><StageBadge stage={c.stage} offerStatus={c.offer_status} /></td>
                    <td className="px-4 py-3 hidden sm:table-cell text-slate-600">
                      {label(SOURCE_LABELS, c.source)}
                      {c.referred_by_name && <p className="text-[11px] text-slate-500">by {c.referred_by_name}</p>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-600 whitespace-nowrap">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{data.total} candidates</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></Button>
            <span>Page {page} of {pages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      <AddCandidateDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} jobs={jobs} />
    </PageShell>
  );
}
