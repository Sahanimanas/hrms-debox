import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, UserRound, Mail, Phone, Linkedin, FileText, Download, Upload, CalendarPlus, CalendarClock, Handshake,
  MessageSquarePlus, Trash2, Video, MapPin, PhoneCall, Pencil, XCircle, Send, FileDown, UserCheck, ExternalLink, Tag, History, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import api from '@/lib/api';
import { PageShell, LoadingState, ErrorState, StageBadge, StatusBadge, StarRating, EmptyState } from '../components/Common';
import { StageReasonDialog, StageSelect } from '../components/StageControls';
import InterviewDialog from '../components/InterviewDialog';
import { OfferDialog, RespondDialog, ConvertDialog } from '../components/OfferDialogs';
import { InterviewScorecards, RecommendationBadge, ScorecardDialog } from '../components/Scorecards';
import {
  API, INTERVIEW_MODE_LABELS, RECOMMENDATION_LABELS, SOURCE_LABELS, STAGE_LABELS, currentUser, downloadFile, errorMessage,
  fmtAgo, fmtDate, fmtDateTime, fmtInr, label, resumeProblem,
} from '../lib';

const MODE_ICONS = { video: Video, onsite: MapPin, phone: PhoneCall };

export default function CandidateProfilePage() {
  const { id } = useParams();
  const user = currentUser();
  const isAdmin = user.role === 'admin';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingStage, setPendingStage] = useState(null);
  const [interviewDialog, setInterviewDialog] = useState({ open: false, interview: null });
  const [offerDialog, setOfferDialog] = useState({ open: false, offer: null });
  const [respondOffer, setRespondOffer] = useState(null);
  const [convertOffer, setConvertOffer] = useState(null);
  const [scoreInterview, setScoreInterview] = useState(null);
  const [note, setNote] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [myInterviews, setMyInterviews] = useState([]);

  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/candidates/${id}`)
      .then(res => { if (alive) { setData(res.data); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, 'Could not load the candidate')); });
    // Interviews the current user sits on for this candidate (for the scorecard buttons)
    api.get(`${API}/interviews`, { params: { scope: 'mine', candidate_id: id } })
      .then(res => { if (alive) setMyInterviews(res.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, reloadKey]);

  const timeline = useMemo(() => {
    const c = data?.candidate;
    if (!c || data.access !== 'full') return [];
    const items = [
      ...(c.stage_history || []).map((h, i) => ({ kind: 'stage', key: `s${i}`, at: h.at, ...h })),
      ...(c.notes || []).map(n => ({ kind: 'note', key: n.id, ...n })),
    ];
    return items.sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [data]);

  if (error) return <PageShell><ErrorState message={error} onRetry={reload} /></PageShell>;
  if (!data) return <PageShell><LoadingState /></PageShell>;

  const c = data.candidate;
  const full = data.access === 'full';

  const download = async (url, name) => {
    try { await downloadFile(url, name); } catch (e) { toast.error(e.message); }
  };

  const move = async (candidate, stage) => {
    if (stage === candidate.stage) return;
    if (stage === 'rejected' || stage === 'withdrawn') return setPendingStage({ candidate, stage });
    try {
      await api.post(`${API}/candidates/${candidate.id}/stage`, { stage });
      toast.success(`Moved to ${STAGE_LABELS[stage]}`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const update = async (patch, success) => {
    try {
      await api.put(`${API}/candidates/${c.id}`, patch);
      if (success) toast.success(success);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if ((c.tags || []).includes(t)) return setTagInput('');
    update({ tags: [...(c.tags || []), t] });
    setTagInput('');
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`${API}/candidates/${c.id}/notes`, { text: note.trim() });
      setNote('');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await api.delete(`${API}/candidates/${c.id}/notes/${noteId}`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const replaceResume = async (file) => {
    if (!file) return;
    const problem = resumeProblem(file);
    if (problem) return toast.error(problem);
    const body = new FormData();
    body.append('resume', file);
    try {
      await api.post(`${API}/candidates/${c.id}/resume`, body);
      toast.success('Resume updated');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const cancelInterview = async (iv) => {
    const reason = window.prompt(`Cancel "${iv.round_name}"? Optional reason:`, '');
    if (reason === null) return;
    try {
      await api.post(`${API}/interviews/${iv.id}/cancel`, { reason });
      toast.success('Interview cancelled — interviewers notified');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const markInterview = async (iv, status) => {
    try {
      await api.post(`${API}/interviews/${iv.id}/status`, { status });
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const offerAction = async (offer, action) => {
    try {
      if (action === 'send') await api.post(`${API}/offers/${offer.id}/send`);
      if (action === 'approve') await api.post(`${API}/offers/${offer.id}/approve`);
      if (action === 'discard') {
        if (!window.confirm('Discard this draft offer?')) return;
        await api.delete(`${API}/offers/${offer.id}`);
      }
      toast.success(action === 'send' ? 'Offer marked as sent' : action === 'approve' ? 'Offer approved' : 'Draft discarded');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const summary = data.scorecard_summary;
  const myOpenInterviews = myInterviews.filter(i => i.status !== 'cancelled');

  return (
    <PageShell>
      <Link to={full ? '/recruitment/candidates' : '/recruitment/interviews'} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" /> {full ? 'Candidates' : 'My interviews'}
      </Link>

      {/* Header */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-slate-800 text-white flex items-center justify-center text-lg font-bold shrink-0" aria-hidden="true">
                {c.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 break-words" style={{ fontFamily: 'Plus Jakarta Sans' }}>{c.name}</h1>
                <p className="text-sm text-slate-600">
                  {full ? <Link to={`/recruitment/jobs/${c.job_id}`} className="hover:underline">{c.job_title}</Link> : c.job_title}
                  {' · '}applied {fmtAgo(c.created_at)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StageBadge stage={c.stage} offerStatus={c.offer_status} />
                  {full && <Badge variant="outline" className="text-[11px]">{label(SOURCE_LABELS, c.source)}{c.source_detail ? ` · ${c.source_detail}` : ''}</Badge>}
                  {full && c.employee_code && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[11px]">Employee {c.employee_code}</Badge>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {full && c.stage !== 'hired' && <StageSelect candidate={c} onMove={move} className="w-36 h-9" id="profile-stage" />}
              {full && !['hired', 'rejected', 'withdrawn'].includes(c.stage) && (
                <Button variant="outline" className="gap-1 h-9" onClick={() => setInterviewDialog({ open: true, interview: null })}><CalendarPlus className="w-4 h-4" /> Interview</Button>
              )}
              {full && isAdmin && !['hired', 'rejected', 'withdrawn'].includes(c.stage) && !(data.offers || []).some(o => ['draft', 'sent', 'accepted'].includes(o.status)) && (
                <Button className="gap-1 h-9" onClick={() => setOfferDialog({ open: true, offer: null })}><Handshake className="w-4 h-4" /> Make offer</Button>
              )}
              {myOpenInterviews.map(iv => (
                <Button key={iv.id} className="gap-1 h-9" onClick={() => setScoreInterview(iv)}>
                  <Pencil className="w-4 h-4" /> {iv.my_scorecard_submitted ? 'Edit' : 'Submit'} scorecard{myOpenInterviews.length > 1 ? ` (${iv.round_name})` : ''}
                </Button>
              ))}
            </div>
          </div>
          {c.stage === 'rejected' && full && c.rejection_reason && (
            <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">Rejected: {c.rejection_reason}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 sm:gap-6 items-start">
        {/* Side panel */}
        <div className="space-y-4">
          <Card className="border-0 shadow-md">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Contact</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2 text-sm">
              <a href={`mailto:${c.email}`} className="flex items-center gap-2 text-slate-700 hover:text-slate-900 break-all"><Mail className="w-4 h-4 shrink-0 text-slate-400" />{c.email}</a>
              {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-slate-700 hover:text-slate-900"><Phone className="w-4 h-4 shrink-0 text-slate-400" />{c.phone}</a>}
              {c.linkedin_url && (
                <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-slate-700 hover:text-slate-900 break-all">
                  <Linkedin className="w-4 h-4 shrink-0 text-slate-400" />LinkedIn profile <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <div className="pt-2 border-t border-slate-100">
                {c.resume ? (
                  <Button variant="outline" size="sm" className="w-full gap-1 justify-start" onClick={() => download(`${API}/candidates/${c.id}/resume`, c.resume.file_name)}>
                    <Download className="w-4 h-4" /> <span className="truncate">{c.resume.file_name}</span>
                  </Button>
                ) : <p className="text-xs text-slate-500 flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> No resume on file</p>}
                {full && (
                  <label className="mt-2 flex items-center gap-1 text-xs text-slate-600 cursor-pointer hover:text-slate-900">
                    <Upload className="w-3.5 h-3.5" /> {c.resume ? 'Replace resume' : 'Upload resume'}
                    <input type="file" accept=".pdf,.doc,.docx" className="sr-only" onChange={(e) => replaceResume(e.target.files?.[0])} />
                  </label>
                )}
                {full && c.resume_parsed?.found?.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">Auto-detected from resume: {c.resume_parsed.found.map(f => f.replace('_url', '')).join(', ')}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {full && (
            <Card className="border-0 shadow-md">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Assessment</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Your rating</span>
                  <StarRating value={c.rating} onChange={(v) => update({ rating: v })} />
                </div>
                {summary?.count > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Interview avg</span>
                    <span className="font-semibold">{summary.average_rating}/5 · {RECOMMENDATION_LABELS[summary.verdict]}</span>
                  </div>
                )}
                <div>
                  <p className="text-slate-600 mb-1.5 flex items-center gap-1"><Tag className="w-3.5 h-3.5" /> Tags</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {(c.tags || []).map(t => (
                      <Badge key={t} variant="secondary" className="gap-1 text-[11px]">
                        {t}
                        <button type="button" onClick={() => update({ tags: c.tags.filter(x => x !== t) })} aria-label={`Remove tag ${t}`} className="hover:text-red-600">×</button>
                      </Badge>
                    ))}
                    {!(c.tags || []).length && <span className="text-xs text-slate-400">No tags</span>}
                  </div>
                  <div className="flex gap-1">
                    <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="Add tag" className="h-8 text-xs" maxLength={30} aria-label="New tag" />
                    <Button size="sm" variant="outline" className="h-8" onClick={addTag}>Add</Button>
                  </div>
                </div>
                {c.referred_by_name && (
                  <div className="text-xs text-slate-600 border-t border-slate-100 pt-2">
                    Referred by <span className="font-medium">{c.referred_by_name}</span>{c.referral_relationship ? ` (${c.referral_relationship})` : ''}
                    {c.referral_note && <p className="mt-1 italic">“{c.referral_note}”</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {full && data.other_applications?.length > 0 && (
            <Card className="border-0 shadow-md">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Other applications</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {data.other_applications.map(o => (
                  <Link key={o.id} to={`/recruitment/candidates/${o.id}`} className="flex items-center justify-between gap-2 text-sm hover:bg-slate-50 rounded p-1">
                    <span className="truncate">{o.job_title}</span><StageBadge stage={o.stage} />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Main */}
        <div className="min-w-0">
          {!full ? (
            <Card className="border-0 shadow-md">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Cover letter</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 text-sm text-slate-700 whitespace-pre-line">{c.cover_letter || <span className="text-slate-400">None provided</span>}</CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="timeline">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="interviews">Interviews ({data.interviews.length})</TabsTrigger>
                <TabsTrigger value="scorecards">Scorecards ({summary?.count || 0})</TabsTrigger>
                <TabsTrigger value="offers">Offers ({data.offers.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="mt-4 space-y-4">
                <Card className="border-0 shadow-md">
                  <CardContent className="p-4 space-y-2">
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={3000} placeholder="Add a private note for the hiring team…" aria-label="New note" />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={addNote} disabled={!note.trim()} className="gap-1"><MessageSquarePlus className="w-4 h-4" /> Add note</Button>
                    </div>
                  </CardContent>
                </Card>
                {c.cover_letter && (
                  <Card className="border-0 shadow-md">
                    <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Cover letter</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0 text-sm text-slate-700 whitespace-pre-line">{c.cover_letter}</CardContent>
                  </Card>
                )}
                <ol className="relative border-l border-slate-200 ml-2 space-y-4">
                  {timeline.map(item => (
                    <li key={item.key} className="ml-4">
                      <span className={`absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border-2 border-white ${item.kind === 'note' ? 'bg-sky-500' : 'bg-slate-400'}`} aria-hidden="true" />
                      {item.kind === 'note' ? (
                        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-3">
                          <div className="flex justify-between gap-2">
                            <p className="text-xs text-slate-500"><span className="font-medium text-slate-700">{item.by_name}</span> · {fmtDateTime(item.at)}</p>
                            {(item.by_email === user.email || isAdmin) && (
                              <button type="button" onClick={() => deleteNote(item.id)} className="text-slate-400 hover:text-red-600" aria-label="Delete note"><Trash2 className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                          <p className="text-sm text-slate-800 mt-1 whitespace-pre-line">{item.text}</p>
                        </div>
                      ) : (
                        <div className="text-sm">
                          <p className="text-slate-700 flex items-center gap-1.5"><History className="w-3.5 h-3.5 text-slate-400" />
                            {item.from ? <>Moved to <StageBadge stage={item.stage} /></> : <>Applied</>}
                            {item.reason && <span className="text-slate-500">— {item.reason}</span>}
                          </p>
                          <p className="text-[11px] text-slate-500">{item.by_name || 'System'} · {fmtDateTime(item.at)}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </TabsContent>

              <TabsContent value="interviews" className="mt-4 space-y-3">
                {data.interviews.length === 0 ? (
                  <Card className="border-0 shadow-md"><EmptyState icon={CalendarClock} title="No interviews scheduled" /></Card>
                ) : data.interviews.map(iv => {
                  const Icon = MODE_ICONS[iv.mode] || CalendarClock;
                  return (
                    <Card key={iv.id} className="border-0 shadow-md">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-slate-900">{iv.round_name} <StatusBadge status={iv.status} text={iv.status.replace('_', ' ')} /></p>
                            <p className="text-sm text-slate-600 flex items-center gap-1.5 mt-0.5"><Icon className="w-4 h-4" />{fmtDateTime(iv.scheduled_at)} · {iv.duration_minutes} min · {INTERVIEW_MODE_LABELS[iv.mode]}</p>
                            {iv.meeting_link && <a href={iv.meeting_link} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-700 hover:underline break-all">{iv.meeting_link}</a>}
                            {iv.location && <p className="text-xs text-slate-500">{iv.location}</p>}
                            <p className="text-xs text-slate-500 mt-1">Panel: {(iv.interviewers || []).map(p => p.name).join(', ')}</p>
                            {iv.cancel_reason && <p className="text-xs text-red-600">Cancelled: {iv.cancel_reason}</p>}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => download(`${API}/interviews/${iv.id}/ics`, 'interview.ics')}><FileDown className="w-3.5 h-3.5" /> .ics</Button>
                            {iv.status === 'scheduled' && (
                              <>
                                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setInterviewDialog({ open: true, interview: iv })}><Pencil className="w-3.5 h-3.5" /> Reschedule</Button>
                                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => markInterview(iv, 'no_show')}>No-show</Button>
                                <Button size="sm" variant="outline" className="h-8 gap-1 text-red-600" onClick={() => cancelInterview(iv)}><XCircle className="w-3.5 h-3.5" /> Cancel</Button>
                              </>
                            )}
                          </div>
                        </div>
                        {iv.status !== 'cancelled' && <InterviewScorecards interviewId={iv.id} refreshKey={reloadKey} />}
                      </CardContent>
                    </Card>
                  );
                })}
              </TabsContent>

              <TabsContent value="scorecards" className="mt-4">
                <Card className="border-0 shadow-md">
                  <CardContent className="p-4 space-y-4">
                    {!summary?.count ? <EmptyState title="No scorecards yet" hint="Interviewers submit scorecards after each round." /> : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                          <div className="rounded-lg bg-slate-50 p-3"><p className="text-2xl font-bold">{summary.average_rating}</p><p className="text-[11px] text-slate-500">Avg rating / 5</p></div>
                          <div className="rounded-lg bg-slate-50 p-3"><p className="text-2xl font-bold">{summary.count}</p><p className="text-[11px] text-slate-500">Scorecards</p></div>
                          <div className="rounded-lg bg-slate-50 p-3 col-span-2 flex flex-col items-center justify-center gap-1">
                            <RecommendationBadge value={summary.verdict} />
                            <p className="text-[11px] text-slate-500">{Object.entries(summary.recommendations).filter(([, n]) => n).map(([k, n]) => `${n} ${RECOMMENDATION_LABELS[k].toLowerCase()}`).join(' · ')}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium mb-2">By criterion</p>
                          <ul className="space-y-2">
                            {summary.criteria.map(cr => (
                              <li key={cr.criterion} className="flex items-center gap-3 text-sm">
                                <span className="w-36 sm:w-48 truncate text-slate-700">{cr.criterion}</span>
                                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${cr.criterion}: ${cr.average} of 5`}>
                                  <div className="h-full bg-slate-700 rounded-full" style={{ width: `${(cr.average / 5) * 100}%` }} />
                                </div>
                                <span className="w-10 text-right tabular-nums text-slate-600">{cr.average}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="offers" className="mt-4 space-y-3">
                {data.offers.length === 0 ? (
                  <Card className="border-0 shadow-md"><EmptyState icon={Handshake} title="No offers yet" hint={isAdmin ? 'Use "Make offer" once the candidate clears the interviews.' : 'Admins create offers.'} /></Card>
                ) : data.offers.map(o => (
                  <Card key={o.id} className="border-0 shadow-md">
                    <CardContent className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">
                          {o.designation} · {o.department} <StatusBadge status={o.status} />
                          {o.requires_approval && o.status === 'draft' && <StatusBadge status="pending" text="Needs approval" />}
                        </p>
                        {o.out_of_band && (
                          <p className="text-xs text-amber-700 mt-0.5">
                            Outside the salary band
                            {o.band_approved_by_name ? ` · approved by ${o.band_approved_by_name}` : ' · an admin must approve it before it is sent'}
                          </p>
                        )}
                        <p className="text-sm text-slate-600 mt-0.5">{fmtInr(o.ctc)} per year · joining {fmtDate(o.joining_date)} · valid until {fmtDate(o.expiry_date)}</p>
                        {o.employee_code && <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> Converted to employee {o.employee_code}</p>}
                        {o.response_note && <p className="text-xs text-slate-500 mt-1">Note: {o.response_note}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => download(`${API}/offers/${o.id}/pdf`, 'offer-letter.pdf')}><FileDown className="w-3.5 h-3.5" /> Letter</Button>
                        {isAdmin && o.status === 'draft' && (
                          <>
                            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setOfferDialog({ open: true, offer: o })}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                            {o.requires_approval
                              ? <Button size="sm" className="h-8 gap-1" onClick={() => offerAction(o, 'approve')}><CheckCircle2 className="w-3.5 h-3.5" /> Approve CTC</Button>
                              : <Button size="sm" className="h-8 gap-1" onClick={() => offerAction(o, 'send')}><Send className="w-3.5 h-3.5" /> Mark sent</Button>}
                            <Button size="sm" variant="ghost" className="h-8 text-red-600" onClick={() => offerAction(o, 'discard')} aria-label="Discard draft"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                        {isAdmin && o.status === 'sent' && <Button size="sm" className="h-8" onClick={() => setRespondOffer(o)}>Record response</Button>}
                        {isAdmin && o.status === 'accepted' && !o.employee_id && (
                          <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setConvertOffer(o)}><UserCheck className="w-3.5 h-3.5" /> Convert to employee</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>

      <StageReasonDialog pending={pendingStage} onClose={() => setPendingStage(null)} onDone={reload} />
      <InterviewDialog open={interviewDialog.open} candidate={c} interview={interviewDialog.interview} onClose={() => setInterviewDialog({ open: false, interview: null })} onSaved={reload} />
      <OfferDialog open={offerDialog.open} candidate={c} job={data.job} offer={offerDialog.offer} onClose={() => setOfferDialog({ open: false, offer: null })} onSaved={reload} />
      <RespondDialog offer={respondOffer} onClose={() => setRespondOffer(null)} onSaved={reload} />
      <ConvertDialog offer={convertOffer} candidateEmail={c.email} onClose={() => setConvertOffer(null)} onDone={reload} />
      <ScorecardDialog interview={scoreInterview} onClose={() => setScoreInterview(null)} onSaved={reload} />
    </PageShell>
  );
}
