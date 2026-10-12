import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, FileDown, Pencil, Download, Video, MapPin, PhoneCall, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, LoadingState, EmptyState, ErrorState, StatusBadge } from '../components/Common';
import { ScorecardDialog, InterviewScorecards } from '../components/Scorecards';
import { API, INTERVIEW_MODE_LABELS, downloadFile, errorMessage, fmtDateTime, isStaff } from '../lib';

const MODE_ICONS = { video: Video, onsite: MapPin, phone: PhoneCall };

export default function MyInterviewsPage() {
  const staff = isStaff();
  const [scope, setScope] = useState('mine');
  const [tab, setTab] = useState('upcoming');
  const [list, setList] = useState(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [scoring, setScoring] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/interviews`, { params: { scope } })
      .then(res => { if (alive) { setList(res.data || []); setLoadedAt(Date.now()); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, 'Could not load interviews')); });
    return () => { alive = false; };
  }, [scope, reloadKey]);

  const reload = () => setReloadKey(k => k + 1);

  const groups = useMemo(() => {
    const now = loadedAt;
    const all = list || [];
    return {
      upcoming: all.filter(i => i.status === 'scheduled' && new Date(i.scheduled_at).getTime() + i.duration_minutes * 60000 >= now),
      feedback: all.filter(i => i.is_interviewer && !i.my_scorecard_submitted && ['scheduled', 'completed'].includes(i.status) && new Date(i.scheduled_at).getTime() < now),
      past: all.filter(i => i.status !== 'scheduled' || new Date(i.scheduled_at).getTime() + i.duration_minutes * 60000 < now).reverse(),
    };
  }, [list, loadedAt]);

  const visible = groups[tab] || [];

  const ics = async (iv) => {
    try { await downloadFile(`${API}/interviews/${iv.id}/ics`, 'interview.ics'); } catch (e) { toast.error(e.message); }
  };

  const doExport = () => exportCsv('interviews', visible, [
    { key: 'candidate_name', label: 'Candidate' },
    { key: 'job_title', label: 'Job' },
    { key: 'round_name', label: 'Round' },
    { label: 'When', value: i => fmtDateTime(i.scheduled_at) },
    { key: 'duration_minutes', label: 'Minutes' },
    { label: 'Mode', value: i => INTERVIEW_MODE_LABELS[i.mode] },
    { key: 'meeting_link', label: 'Link' },
    { key: 'location', label: 'Location' },
    { label: 'Panel', value: i => (i.interviewers || []).map(p => p.name).join('; ') },
    { key: 'status', label: 'Status' },
    { label: 'My scorecard', value: i => (i.is_interviewer ? (i.my_scorecard_submitted ? 'Submitted' : 'Pending') : '') },
  ]);

  const TABS = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'feedback', label: 'Needs my scorecard' },
    { key: 'past', label: 'Past' },
  ];

  return (
    <PageShell>
      <PageHeader icon={CalendarClock} title={scope === 'all' ? 'Interviews' : 'My Interviews'} subtitle="Your interview schedule, calendar invites and scorecards">
        {staff && (
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="Whose interviews">
            {[['mine', 'Assigned to me'], ['all', 'All my jobs']].map(([key, text]) => (
              <button key={key} role="tab" aria-selected={scope === key} onClick={() => { setScope(key); setList(null); }}
                className={`px-3 py-1.5 text-xs sm:text-sm rounded-md ${scope === key ? 'bg-slate-800 text-white' : 'text-slate-600'}`}>{text}</button>
            ))}
          </div>
        )}
        <Button variant="outline" onClick={doExport} disabled={!visible.length} className="gap-2 h-9"><Download className="w-4 h-4" /> Export CSV</Button>
      </PageHeader>

      <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter interviews">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs sm:text-sm whitespace-nowrap border ${tab === t.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
            {t.label} ({groups[t.key]?.length || 0})
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error} onRetry={reload} /> : !list ? <LoadingState /> : visible.length === 0 ? (
        <Card className="border-0 shadow-md">
          <EmptyState icon={tab === 'feedback' ? CheckCircle2 : CalendarClock}
            title={tab === 'feedback' ? 'All caught up — no scorecards pending' : tab === 'upcoming' ? 'No upcoming interviews' : 'No past interviews'}
            hint={scope === 'mine' ? 'Interviews you are added to as an interviewer appear here.' : undefined} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map(iv => {
            const Icon = MODE_ICONS[iv.mode] || CalendarClock;
            const open = expanded === iv.id;
            return (
              <li key={iv.id}>
                <Card className="border-0 shadow-md">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/recruitment/candidates/${iv.candidate_id}`} className="font-semibold text-slate-900 hover:underline">{iv.candidate_name}</Link>
                          <StatusBadge status={iv.status} text={iv.status.replace('_', ' ')} />
                          {iv.is_interviewer && (iv.my_scorecard_submitted
                            ? <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 text-[10px]">Scorecard submitted</Badge>
                            : iv.status !== 'cancelled' && <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 text-[10px]">Scorecard pending</Badge>)}
                        </div>
                        <p className="text-sm text-slate-600">{iv.round_name} · {iv.job_title}</p>
                        <p className="text-sm text-slate-700 flex items-center gap-1.5 mt-1"><Icon className="w-4 h-4 text-slate-400" />{fmtDateTime(iv.scheduled_at)} · {iv.duration_minutes} min</p>
                        {iv.meeting_link && iv.status === 'scheduled' && <a href={iv.meeting_link} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-700 hover:underline break-all">{iv.meeting_link}</a>}
                        {iv.location && <p className="text-xs text-slate-500">{iv.location}</p>}
                        {iv.notes && <p className="text-xs text-slate-500 mt-1 italic">{iv.notes}</p>}
                        <p className="text-xs text-slate-500 mt-1">Panel: {(iv.interviewers || []).map(p => p.name).join(', ')}</p>
                      </div>
                      <div className="flex flex-wrap gap-1 sm:justify-end">
                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => ics(iv)}><FileDown className="w-3.5 h-3.5" /> Add to calendar</Button>
                        {iv.is_interviewer && iv.status !== 'cancelled' && (
                          <Button size="sm" className="h-8 gap-1 bg-slate-800 hover:bg-slate-900" onClick={() => setScoring(iv)}>
                            <Pencil className="w-3.5 h-3.5" /> {iv.my_scorecard_submitted ? 'Edit scorecard' : 'Submit scorecard'}
                          </Button>
                        )}
                        {(iv.scorecards_submitted > 0) && (
                          <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setExpanded(open ? null : iv.id)} aria-expanded={open}>
                            Feedback ({iv.scorecards_submitted}) {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                      </div>
                    </div>
                    {open && <InterviewScorecards interviewId={iv.id} refreshKey={reloadKey} />}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ScorecardDialog interview={scoring} onClose={() => setScoring(null)} onSaved={reload} />
    </PageShell>
  );
}
