import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, MapPin, Search, Building2, Clock, ArrowRight, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import CareersLayout from '../components/CareersLayout';
import { LoadingState, EmptyState, ErrorState } from '../components/Common';
import { API, EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS, experienceText, fmtAgo, fmtDate, label } from '../lib';

const FILTERS = [
  { key: 'department', label: 'Department', facet: 'departments' },
  { key: 'location', label: 'Location', facet: 'locations' },
  { key: 'employment_type', label: 'Job type', facet: 'employment_types', labels: EMPLOYMENT_TYPE_LABELS },
  { key: 'work_mode', label: 'Workplace', facet: 'work_modes', labels: WORK_MODE_LABELS },
];

export default function CareersPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({});

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => { setError(false); setReloadKey(k => k + 1); };

  useEffect(() => {
    let alive = true;
    api.get(`${API}/public/jobs`)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [reloadKey]);
  useEffect(() => {
    document.title = data?.company_name ? `Careers at ${data.company_name}` : 'Careers';
  }, [data?.company_name]);

  // Filter client-side: the open-jobs list is small and this keeps typing instant
  const jobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.jobs || []).filter(j =>
      FILTERS.every(f => !filters[f.key] || j[f.key] === filters[f.key])
      && (!q || [j.title, j.department, j.location, j.summary].some(v => String(v || '').toLowerCase().includes(q))));
  }, [data, query, filters]);

  const activeFilters = Object.values(filters).filter(Boolean).length + (query ? 1 : 0);
  const company = data?.company_name || 'us';

  return (
    <CareersLayout companyName={data?.company_name}>
      <section className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <p className="text-yellow-400 text-xs sm:text-sm font-semibold uppercase tracking-wider">Careers</p>
          <h1 className="mt-2 text-2xl sm:text-4xl font-extrabold tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Build what's next with {company}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-300 max-w-2xl">
            Explore open roles and apply in a few minutes — no account needed.
          </p>
          <div className="mt-6 relative max-w-xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, team or location"
              aria-label="Search jobs"
              className="pl-9 h-11 bg-white text-slate-900 border-0"
              maxLength={100}
            />
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            {FILTERS.map(f => (
              <label key={f.key} className="block">
                <span className="sr-only">{f.label}</span>
                <select
                  value={filters[f.key] || ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                  <option value="">All {f.label.toLowerCase()}s</option>
                  {(data.facets?.[f.facet] || []).map(v => (
                    <option key={v} value={v}>{f.labels ? label(f.labels, v) : v}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        {data && (
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>{jobs.length} open {jobs.length === 1 ? 'position' : 'positions'}</span>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => { setFilters({}); setQuery(''); }}>
                <X className="w-3.5 h-3.5" /> Clear filters
              </Button>
            )}
          </div>
        )}

        {error ? (
          <ErrorState message="We couldn't load open positions right now." onRetry={load} />
        ) : !data ? (
          <LoadingState text="Loading open positions…" />
        ) : jobs.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200">
            <EmptyState
              icon={Briefcase}
              title={data.jobs.length ? 'No positions match your search' : 'No open positions right now'}
              hint={data.jobs.length ? 'Try a different keyword or clear the filters.' : 'Check back soon — we are always growing.'}
            />
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map(job => (
              <li key={job.id}>
                <Link
                  to={`/careers/${job.slug}`}
                  className="group block bg-white rounded-xl border border-slate-200 p-4 sm:p-5 hover:border-slate-400 hover:shadow-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base sm:text-lg font-semibold text-slate-900 group-hover:underline underline-offset-2">{job.title}</h2>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm text-slate-600">
                        <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{job.department}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{job.location}</span>
                        {experienceText(job.experience_min, job.experience_max) && (
                          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{experienceText(job.experience_min, job.experience_max)}</span>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-slate-900 shrink-0 mt-1" aria-hidden="true" />
                  </div>
                  {job.summary && <p className="mt-3 text-sm text-slate-600 line-clamp-2">{job.summary}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">{label(EMPLOYMENT_TYPE_LABELS, job.employment_type)}</Badge>
                    <Badge variant="outline" className="text-[11px]">{label(WORK_MODE_LABELS, job.work_mode)}</Badge>
                    <span className="text-[11px] text-slate-500 ml-auto">
                      Posted {fmtAgo(job.published_at)}{job.closing_date ? ` · Apply by ${fmtDate(job.closing_date)}` : ''}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CareersLayout>
  );
}
