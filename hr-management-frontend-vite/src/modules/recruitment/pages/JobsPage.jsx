import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Plus, Download, Search, Pencil, Globe, Lock, Link2, Trash2, KanbanSquare, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, LoadingState, EmptyState, ErrorState, StatusBadge, TableCard } from '../components/Common';
import JobFormDialog from '../components/JobFormDialog';
import RecruitmentAnalytics from '../components/RecruitmentAnalytics';
import { API, EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS, currentUser, errorMessage, fmtDate, label } from '../lib';

const STATUS_FILTERS = ['all', 'open', 'draft', 'closed'];

export default function JobsPage() {
  const user = currentUser();
  const isAdmin = user.role === 'admin';
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState({ open: false, job: null });
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`${API}/jobs`);
      setJobs(res.data || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsError(false);
    try {
      const res = await api.get(`${API}/analytics`);
      setAnalytics(res.data);
    } catch {
      setAnalyticsError(true);
    }
  }, []);

  useEffect(() => { load(); loadAnalytics(); }, [load, loadAnalytics]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter(j => (status === 'all' || j.status === status)
      && (!q || [j.title, j.department, j.location].some(v => String(v || '').toLowerCase().includes(q))));
  }, [jobs, status, query]);

  const setJobStatus = async (job, next) => {
    try {
      await api.post(`${API}/jobs/${job.id}/status`, { status: next });
      toast.success(next === 'open' ? 'Job published to the careers page' : next === 'closed' ? 'Job closed' : 'Job moved to draft');
      load();
      loadAnalytics();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not update the job'));
    }
  };

  const remove = async (job) => {
    if (!window.confirm(`Delete "${job.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`${API}/jobs/${job.id}`);
      toast.success('Job deleted');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const copyLink = async (job) => {
    const url = `${window.location.origin}/careers/${job.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Careers link copied');
    } catch {
      toast.message(url);
    }
  };

  const doExport = () => exportCsv('jobs', visible, [
    { key: 'title', label: 'Title' },
    { key: 'department', label: 'Department' },
    { key: 'location', label: 'Location' },
    { label: 'Type', value: j => label(EMPLOYMENT_TYPE_LABELS, j.employment_type) },
    { label: 'Workplace', value: j => label(WORK_MODE_LABELS, j.work_mode) },
    { key: 'status', label: 'Status' },
    { key: 'headcount', label: 'Headcount' },
    { key: 'hires_count', label: 'Hired' },
    { label: 'Candidates', value: j => j.counts?.total || 0 },
    { label: 'Active candidates', value: j => j.counts?.active || 0 },
    { key: 'hiring_manager_name', label: 'Hiring manager' },
    { label: 'Published', value: j => (j.published_at ? fmtDate(j.published_at, 'yyyy-MM-dd') : '') },
    { key: 'closing_date', label: 'Closing date' },
    { label: 'Careers URL', value: j => `${window.location.origin}/careers/${j.slug}` },
  ]);

  return (
    <PageShell>
      <PageHeader icon={Briefcase} title="Jobs" subtitle="Job postings, pipelines and hiring analytics">
        <Button asChild variant="outline" className="gap-2 h-9 sm:h-10 flex-1 sm:flex-none">
          <a href="/careers" target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /> Careers page</a>
        </Button>
        {isAdmin && (
          <Button onClick={() => setDialog({ open: true, job: null })} className="gap-2 h-9 sm:h-10 flex-1 sm:flex-none">
            <Plus className="w-4 h-4" /> New job
          </Button>
        )}
      </PageHeader>

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Postings</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
            <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter by status">
              {STATUS_FILTERS.map(s => (
                <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm capitalize border whitespace-nowrap ${status === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                  {s} ({s === 'all' ? jobs.length : jobs.filter(j => j.status === s).length})
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1 sm:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs" className="pl-8 h-9" aria-label="Search jobs" />
              </div>
              <Button variant="outline" onClick={doExport} disabled={!visible.length} className="gap-2 h-9"><Download className="w-4 h-4" /><span className="hidden sm:inline">Export CSV</span></Button>
            </div>
          </div>

          <TableCard>
            {loading ? <LoadingState /> : error ? <ErrorState onRetry={load} /> : visible.length === 0 ? (
              <EmptyState icon={Briefcase} title={jobs.length ? 'No jobs match the filter' : 'No job postings yet'}
                hint={isAdmin ? 'Create a job, or approve a requisition to generate one.' : 'Jobs appear here once a requisition you raised is approved.'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Job</th>
                      <th className="text-left font-medium px-4 py-3">Candidates</th>
                      <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Hiring manager</th>
                      <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map(j => (
                      <tr key={j.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link to={`/recruitment/jobs/${j.id}`} className="font-medium text-slate-900 hover:underline">{j.title}</Link>
                          <p className="text-xs text-slate-500">{j.department} · {j.location} · {label(WORK_MODE_LABELS, j.work_mode)}</p>
                          <div className="sm:hidden mt-1"><StatusBadge status={j.status} /></div>
                          {j.closing_date && <p className="text-[11px] text-slate-500">Closes {fmtDate(j.closing_date)}</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-semibold text-slate-900">{j.counts?.active || 0} <span className="font-normal text-slate-500 text-xs">active</span></p>
                          <p className="text-xs text-slate-500">{j.counts?.total || 0} total · {j.hires_count || 0}/{j.headcount} hired</p>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-slate-600">{j.hiring_manager_name || '—'}</td>
                        <td className="px-4 py-3 hidden sm:table-cell"><StatusBadge status={j.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end flex-wrap gap-1">
                            <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                              <Link to={`/recruitment/jobs/${j.id}`}><KanbanSquare className="w-3.5 h-3.5" /> Pipeline</Link>
                            </Button>
                            {j.status !== 'open' && (
                              <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setJobStatus(j, 'open')}>
                                <Globe className="w-3.5 h-3.5" /> {j.status === 'closed' ? 'Reopen' : 'Publish'}
                              </Button>
                            )}
                            {j.status === 'open' && (
                              <>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => copyLink(j)} aria-label="Copy careers link"><Link2 className="w-4 h-4" /></Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setJobStatus(j, 'closed')} aria-label="Close job"><Lock className="w-4 h-4" /></Button>
                              </>
                            )}
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDialog({ open: true, job: j })} aria-label="Edit job"><Pencil className="w-4 h-4" /></Button>
                            {isAdmin && !j.counts?.total && (
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => remove(j)} aria-label="Delete job"><Trash2 className="w-4 h-4" /></Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TableCard>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {analyticsError ? <ErrorState onRetry={loadAnalytics} /> : !analytics ? <LoadingState /> : <RecruitmentAnalytics data={analytics} />}
        </TabsContent>
      </Tabs>

      <JobFormDialog open={dialog.open} job={dialog.job} onClose={() => setDialog({ open: false, job: null })} onSaved={() => { load(); loadAnalytics(); }} />
    </PageShell>
  );
}
