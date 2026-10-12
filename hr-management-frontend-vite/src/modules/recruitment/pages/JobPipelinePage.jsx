import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KanbanSquare, ArrowLeft, UserPlus, Pencil, Globe, Lock, Star, CalendarClock, FileText, Download, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, LoadingState, ErrorState, StatusBadge, EmptyState } from '../components/Common';
import { StageReasonDialog, StageSelect } from '../components/StageControls';
import AddCandidateDialog from '../components/AddCandidateDialog';
import JobFormDialog from '../components/JobFormDialog';
import { API, STAGE_ACCENT, SOURCE_LABELS, STAGE_LABELS, errorMessage, fmtAgo, fmtDate, label } from '../lib';

export default function JobPipelinePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [pending, setPending] = useState(null);
  const [showClosed, setShowClosed] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/jobs/${id}/pipeline`)
      .then(res => { if (alive) { setData(res.data); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, 'Could not load the pipeline')); });
    return () => { alive = false; };
  }, [id, reloadKey]);

  const move = async (candidate, stage) => {
    if (!candidate || stage === candidate.stage) return;
    if (candidate.stage === 'hired') return toast.error('Hired candidates cannot be moved');
    if (stage === 'hired') return toast.error('Use "Convert to employee" on an accepted offer to hire');
    if (stage === 'rejected' || stage === 'withdrawn') return setPending({ candidate, stage });
    // Optimistic update
    setData(d => ({
      ...d,
      stages: d.stages.map(s => ({
        ...s,
        candidates: s.key === stage
          ? [{ ...candidate, stage }, ...s.candidates.filter(c => c.id !== candidate.id)]
          : s.candidates.filter(c => c.id !== candidate.id),
      })),
    }));
    try {
      await api.post(`${API}/candidates/${candidate.id}/stage`, { stage });
      toast.success(`${candidate.name} → ${STAGE_LABELS[stage]}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not move the candidate'));
    }
    load();
  };

  const setJobStatus = async (status) => {
    try {
      await api.post(`${API}/jobs/${id}/status`, { status });
      toast.success(status === 'open' ? 'Job published' : 'Job closed');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const onDrop = (stage) => (e) => {
    e.preventDefault();
    setOver(null);
    const candidateId = e.dataTransfer.getData('text/plain');
    const candidate = data.stages.flatMap(s => s.candidates).find(c => c.id === candidateId);
    setDragging(null);
    move(candidate, stage);
  };

  if (error) return <PageShell><ErrorState message={error} onRetry={load} /></PageShell>;
  if (!data) return <PageShell><LoadingState /></PageShell>;

  const { job } = data;
  const columns = data.stages.filter(s => showClosed || !['rejected', 'withdrawn'].includes(s.key));
  const allCandidates = data.stages.flatMap(s => s.candidates);

  const doExport = () => exportCsv(`pipeline-${job.slug}`, allCandidates, [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { label: 'Stage', value: c => STAGE_LABELS[c.stage] },
    { label: 'Source', value: c => label(SOURCE_LABELS, c.source) },
    { key: 'rating', label: 'Rating' },
    { label: 'Tags', value: c => (c.tags || []).join('; ') },
    { label: 'Applied', value: c => fmtDate(c.created_at, 'yyyy-MM-dd') },
  ]);

  return (
    <PageShell wide>
      <Link to="/recruitment/jobs" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4" /> Jobs</Link>
      <PageHeader icon={KanbanSquare} title={job.title} subtitle={`${job.department} · ${job.location} · ${job.hires_count || 0}/${job.headcount} hired`}>
        <StatusBadge status={job.status} />
        <Button variant="outline" onClick={doExport} disabled={!allCandidates.length} className="gap-1 h-9"><Download className="w-4 h-4" /> CSV</Button>
        <Button variant="outline" onClick={() => setEditOpen(true)} className="gap-1 h-9"><Pencil className="w-4 h-4" /> Edit</Button>
        {job.status === 'open'
          ? <Button variant="outline" onClick={() => setJobStatus('closed')} className="gap-1 h-9"><Lock className="w-4 h-4" /> Close</Button>
          : <Button onClick={() => setJobStatus('open')} className="gap-1 h-9 bg-emerald-600 hover:bg-emerald-700"><Globe className="w-4 h-4" /> Publish</Button>}
        {job.status !== 'closed' && (
          <Button onClick={() => setAddOpen(true)} className="gap-1 h-9 bg-slate-800 hover:bg-slate-900"><UserPlus className="w-4 h-4" /> Add candidate</Button>
        )}
      </PageHeader>

      <div className="flex items-center justify-between text-xs sm:text-sm text-slate-600">
        <span>{data.total} candidate{data.total === 1 ? '' : 's'} · drag cards between columns or use the stage menu</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="rounded" />
          Show rejected / withdrawn
        </label>
      </div>

      {data.total === 0 ? (
        <div className="bg-white rounded-xl shadow-md">
          <EmptyState icon={Users} title="No candidates yet" hint={job.status === 'open' ? 'Share the careers link or add candidates manually.' : 'Publish the job to start receiving applications.'} />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 snap-x" aria-label="Candidate pipeline">
          {columns.map(col => (
            <section
              key={col.key}
              aria-label={`${col.label} (${col.candidates.length})`}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.key); } }}
              onDragLeave={() => setOver(o => (o === col.key ? null : o))}
              onDrop={onDrop(col.key)}
              className={`snap-start shrink-0 w-[78vw] sm:w-64 lg:w-72 rounded-xl bg-slate-100/80 border-t-4 ${STAGE_ACCENT[col.key]} ${over === col.key ? 'ring-2 ring-slate-400 bg-slate-200/70' : ''} transition`}
            >
              <header className="flex items-center justify-between px-3 py-2.5">
                <h2 className="text-sm font-semibold text-slate-800">{col.label}</h2>
                <span className="text-xs font-medium text-slate-500 bg-white rounded-full px-2 py-0.5">{col.candidates.length}</span>
              </header>
              <ul className="px-2 pb-3 space-y-2 min-h-[80px]">
                {col.candidates.map(c => (
                  <li
                    key={c.id}
                    draggable={c.stage !== 'hired'}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDragging(c.id); }}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={`bg-white rounded-lg border border-slate-200 p-3 shadow-sm ${c.stage !== 'hired' ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === c.id ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/recruitment/candidates/${c.id}`} className="font-medium text-sm text-slate-900 hover:underline break-words">{c.name}</Link>
                      {c.rating ? <span className="flex items-center gap-0.5 text-xs text-amber-600 shrink-0"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{c.rating}</span> : null}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">{c.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5">{label(SOURCE_LABELS, c.source)}</Badge>
                      {c.offer_status && <Badge className="text-[10px] py-0 px-1.5 bg-amber-50 text-amber-800 hover:bg-amber-50">Offer {c.offer_status}</Badge>}
                      {c.has_resume && <FileText className="w-3.5 h-3.5 text-slate-400" aria-label="Has resume" />}
                      {(c.tags || []).slice(0, 2).map(t => <Badge key={t} variant="secondary" className="text-[10px] py-0 px-1.5">{t}</Badge>)}
                    </div>
                    {c.next_interview_at && (
                      <p className="mt-1.5 text-[11px] text-indigo-700 flex items-center gap-1"><CalendarClock className="w-3 h-3" />{fmtDate(c.next_interview_at, 'dd MMM, h:mm a')}</p>
                    )}
                    {c.referred_by_name && <p className="text-[11px] text-slate-500 mt-1">Referred by {c.referred_by_name}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">{fmtAgo(c.stage_changed_at)}</span>
                      <StageSelect candidate={c} onMove={move} className="w-28" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <StageReasonDialog pending={pending} onClose={() => setPending(null)} onDone={load} />
      <AddCandidateDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} jobId={job.id} />
      <JobFormDialog open={editOpen} job={job} onClose={() => setEditOpen(false)} onSaved={load} />
    </PageShell>
  );
}
