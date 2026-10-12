import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Award, ClipboardCheck, Users, MessageSquareQuote, Settings2, ChevronRight, Check, X, UserPlus, Scale,
  Star, Plus, Trash2, ShieldCheck, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import {
  PF, useApi, apiError, currentUser, isLead, fmtDate, defaultCycleId, PHASES, PHASE_LABELS, REVIEW_STATUS,
} from '../lib';
import {
  PageShell, SectionCard, DataState, EmptyState, Pill, ExportButton, StatTile, ProgressBar, PeoplePicker,
  RatingSelect, DataTable, LoadingState, ErrorState,
} from '../components/common';
import CycleSelect from '../components/CycleSelect';

// ---------------------------------------------------------------- building blocks

function PhaseStepper({ phase, peerEnabled }) {
  const steps = PHASES.filter(p => p !== 'peer_feedback' || peerEnabled);
  const current = steps.indexOf(phase);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((p, i) => (
        <React.Fragment key={p}>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs whitespace-nowrap ${i < current ? 'bg-emerald-100 text-emerald-700' : i === current ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {i < current ? <Check className="w-3 h-3" /> : <span className="tabular-nums">{i + 1}</span>}
            {PHASE_LABELS[p]}
          </div>
          {i < steps.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
        </React.Fragment>
      ))}
    </div>
  );
}

const ratingLabel = (scale, v) => scale?.find(s => s.value === Math.round(v))?.label;

function RatingBadge({ value, scale }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-slate-800">
      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" /> {Number(value).toFixed(value % 1 ? 2 : 0)}
      {ratingLabel(scale, value) && <span className="text-xs text-slate-500 font-normal">· {ratingLabel(scale, value)}</span>}
    </span>
  );
}

/** Editable self / manager review. */
function ReviewEditor({ appraisal, kind, onSaved }) {
  const existing = (kind === 'self' ? appraisal.self_review : appraisal.manager_review) || {};
  const { goals = [], config } = appraisal;
  const comps = config.competencies || [];
  const [goalRatings, setGoalRatings] = useState(() => Object.fromEntries((existing.goal_ratings || []).map(r => [r.goal_id, r])));
  const [compRatings, setCompRatings] = useState(() => Object.fromEntries((existing.competency_ratings || []).map(r => [r.competency_id, r])));
  const [overall, setOverall] = useState(existing.overall_comment || '');
  const [strengths, setStrengths] = useState(existing.strengths || '');
  const [improvements, setImprovements] = useState(existing.improvements || '');
  const [saving, setSaving] = useState(false);
  const selfReview = appraisal.self_review;

  const save = async (submit) => {
    if (submit && !window.confirm('Submit the review? You will not be able to change it afterwards.')) return;
    const body = {
      goal_ratings: Object.values(goalRatings).filter(r => r.rating).map(r => ({ goal_id: r.goal_id, rating: r.rating, comment: r.comment || '' })),
      competency_ratings: Object.values(compRatings).filter(r => r.rating).map(r => ({ competency_id: r.competency_id, rating: r.rating, comment: r.comment || '' })),
      overall_comment: overall,
      submit,
      ...(kind === 'manager' ? { strengths, improvements } : {}),
    };
    setSaving(true);
    try {
      await api.put(`${PF}/appraisals/${appraisal.id}/${kind === 'self' ? 'self-review' : 'manager-review'}`, body);
      toast.success(submit ? 'Review submitted' : 'Draft saved');
      onSaved();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save review'));
    } finally {
      setSaving(false);
    }
  };

  const selfFor = (list, idKey, id) => selfReview?.[list]?.find(r => r[idKey] === id);

  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Goals</h4>
        {goals.length === 0 && <p className="text-xs text-slate-500">No approved goals in this cycle.</p>}
        <div className="space-y-3">
          {goals.map(g => {
            const s = kind === 'manager' ? selfFor('goal_ratings', 'goal_id', g.id) : null;
            return (
              <div key={g.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{g.title} <span className="text-xs text-slate-500 font-normal">· {g.weightage}%</span></p>
                  <div className="w-40"><ProgressBar value={g.progress} /></div>
                </div>
                {s && <p className="text-xs text-slate-600">Self: <RatingBadge value={s.rating} scale={config.rating_scale} />{s.comment ? ` — ${s.comment}` : ''}</p>}
                <div className="flex flex-col sm:flex-row gap-2">
                  <RatingSelect scale={config.rating_scale} value={goalRatings[g.id]?.rating} onChange={(v) => setGoalRatings(r => ({ ...r, [g.id]: { ...r[g.id], goal_id: g.id, rating: v } }))} />
                  <Input value={goalRatings[g.id]?.comment || ''} onChange={(e) => setGoalRatings(r => ({ ...r, [g.id]: { ...r[g.id], goal_id: g.id, comment: e.target.value } }))} placeholder="Comment" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {comps.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Competencies</h4>
          <div className="space-y-3">
            {comps.map(c => {
              const s = kind === 'manager' ? selfFor('competency_ratings', 'competency_id', c.id) : null;
              return (
                <div key={c.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="font-medium text-slate-900">{c.name}</p>
                  {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
                  {s && <p className="text-xs text-slate-600">Self: <RatingBadge value={s.rating} scale={config.rating_scale} />{s.comment ? ` — ${s.comment}` : ''}</p>}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <RatingSelect scale={config.rating_scale} value={compRatings[c.id]?.rating} onChange={(v) => setCompRatings(r => ({ ...r, [c.id]: { ...r[c.id], competency_id: c.id, rating: v } }))} />
                    <Input value={compRatings[c.id]?.comment || ''} onChange={(e) => setCompRatings(r => ({ ...r, [c.id]: { ...r[c.id], competency_id: c.id, comment: e.target.value } }))} placeholder="Comment" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {kind === 'manager' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Strengths</Label><Textarea rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Areas to improve</Label><Textarea rows={3} value={improvements} onChange={(e) => setImprovements(e.target.value)} /></div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Overall comments</Label>
        <Textarea rows={4} value={overall} onChange={(e) => setOverall(e.target.value)} placeholder={kind === 'self' ? 'Summarise your achievements and learnings' : 'Overall assessment'} />
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" onClick={() => save(false)} disabled={saving}>Save draft</Button>
        <Button className="bg-slate-800 hover:bg-slate-900" onClick={() => save(true)} disabled={saving}>Submit review</Button>
      </div>
    </div>
  );
}

function ReviewView({ title, review, appraisal, showExtras }) {
  const { goals = [], config } = appraisal;
  if (!review) return null;
  const goalTitle = (id) => goals.find(g => g.id === id)?.title || 'Goal';
  const compName = (id) => config.competencies?.find(c => c.id === id)?.name || 'Competency';
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-800">{title}{review.reviewer_name ? ` · ${review.reviewer_name}` : ''}</h4>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {(review.goal_ratings || []).map(r => (
          <div key={r.goal_id} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><span className="text-slate-700">{goalTitle(r.goal_id)}</span><RatingBadge value={r.rating} scale={config.rating_scale} /></div>
            {r.comment && <p className="text-xs text-slate-500 mt-0.5">{r.comment}</p>}
          </div>
        ))}
        {(review.competency_ratings || []).map(r => (
          <div key={r.competency_id} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><span className="text-slate-700">{compName(r.competency_id)}</span><RatingBadge value={r.rating} scale={config.rating_scale} /></div>
            {r.comment && <p className="text-xs text-slate-500 mt-0.5">{r.comment}</p>}
          </div>
        ))}
      </div>
      {showExtras && review.strengths && <p className="text-sm"><span className="font-medium">Strengths:</span> {review.strengths}</p>}
      {showExtras && review.improvements && <p className="text-sm"><span className="font-medium">Areas to improve:</span> {review.improvements}</p>}
      {review.overall_comment && <p className="text-sm text-slate-700 whitespace-pre-line bg-slate-50 rounded-lg p-3">{review.overall_comment}</p>}
    </div>
  );
}

function PeerSection({ appraisal, onChanged }) {
  const people = useApi(`${PF}/people`, { scope: 'all' });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const { permissions, viewer_role: role, config } = appraisal;
  const noms = appraisal.peer_nominations || [];
  const active = noms.filter(n => n.status !== 'rejected').length + (appraisal.other_peer_count || 0);
  const remaining = Math.max(0, (config.max_peers || 5) - active);
  const candidates = (people.data?.people || []).filter(p => p.email !== appraisal.employee_email && !noms.some(n => n.peer_email === p.email && n.status !== 'rejected'));

  const nominate = async () => {
    if (!selected.length) return toast.error('Choose at least one colleague');
    try {
      await api.post(`${PF}/appraisals/${appraisal.id}/peers`, { peer_emails: selected });
      toast.success(role === 'self' ? 'Nominations sent to your manager' : 'Peers added');
      setOpen(false);
      setSelected([]);
      onChanged();
    } catch (error) {
      toast.error(apiError(error, 'Failed to nominate'));
    }
  };
  const decide = async (n, action) => {
    try {
      await api.post(`${PF}/peer-feedback/${n.id}/decision`, { action });
      onChanged();
    } catch (error) {
      toast.error(apiError(error, 'Failed to update nomination'));
    }
  };
  const remove = async (n) => {
    try {
      await api.delete(`${PF}/peer-feedback/${n.id}`);
      onChanged();
    } catch (error) {
      toast.error(apiError(error, 'Failed to remove'));
    }
  };

  if (!config.peer_feedback_enabled) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800">360° peers</h4>
        {permissions.can_nominate && remaining > 0 && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><UserPlus className="w-3.5 h-3.5 mr-1" /> {role === 'self' ? 'Nominate' : 'Add peer'}</Button>
        )}
      </div>
      {noms.length === 0 && !appraisal.other_peer_count && <p className="text-xs text-slate-500">No peers nominated yet.</p>}
      <div className="space-y-1.5">
        {noms.map(n => (
          <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span>{n.peer_name}</span>
            <div className="flex items-center gap-1.5">
              <Pill tone={n.status === 'approved' || n.status === 'submitted' ? 'emerald' : n.status === 'rejected' ? 'rose' : 'amber'}>
                {n.status === 'nominated' ? 'Awaiting approval' : n.status}
              </Pill>
              {permissions.can_decide_peers && n.status === 'nominated' && (
                <>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => decide(n, 'approve')} aria-label="Approve"><Check className="w-4 h-4 text-emerald-600" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => decide(n, 'reject')} aria-label="Reject"><X className="w-4 h-4 text-rose-600" /></Button>
                </>
              )}
              {((role === 'self' && n.status === 'nominated') || (role !== 'self' && permissions.can_decide_peers && n.status !== 'submitted')) && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(n)} aria-label="Remove"><Trash2 className="w-3.5 h-3.5 text-slate-400" /></Button>
              )}
            </div>
          </div>
        ))}
        {appraisal.other_peer_count > 0 && <p className="text-xs text-slate-500">+ {appraisal.other_peer_count} peer(s) added by your manager</p>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{role === 'self' ? 'Nominate peers' : 'Add peers'}</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">Peer feedback is anonymous to the employee. {role === 'self' ? 'Your manager approves nominations.' : ''}</p>
          <PeoplePicker people={candidates} selected={selected} onChange={setSelected} max={remaining} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-slate-800 hover:bg-slate-900" onClick={nominate}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PeerFeedbackView({ appraisal }) {
  const fb = appraisal.peer_feedback || [];
  const comps = appraisal.config.competencies || [];
  if (appraisal.peer_feedback_withheld) {
    return (
      <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
        360° peer feedback was withheld to protect anonymity: fewer than {appraisal.config.min_peer_responses} peers responded.
      </p>
    );
  }
  if (!fb.length) return null;
  const avg = (id) => {
    const vals = fb.flatMap(f => f.ratings.filter(r => r.competency_id === id).map(r => r.rating));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-800">360° peer feedback ({fb.length})</h4>
      <div className="grid sm:grid-cols-2 gap-2">
        {comps.map(c => (
          <div key={c.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>{c.name}</span><RatingBadge value={avg(c.id) != null ? Math.round(avg(c.id) * 100) / 100 : null} scale={appraisal.config.rating_scale} /></div>
        ))}
      </div>
      {fb.map((f, i) => (
        <div key={f.id || i} className="rounded-lg border border-slate-200 p-3 text-sm space-y-1">
          {f.peer_name && <p className="text-xs text-slate-500">{f.peer_name}</p>}
          {f.strengths && <p><span className="font-medium">Strengths:</span> {f.strengths}</p>}
          {f.improvements && <p><span className="font-medium">Improve:</span> {f.improvements}</p>}
        </div>
      ))}
    </div>
  );
}

function AcknowledgeForm({ appraisal, onSaved }) {
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const ack = async (agrees) => {
    if (!agrees && !comment.trim()) return toast.error('Tell us why you disagree');
    setSaving(true);
    try {
      await api.post(`${PF}/appraisals/${appraisal.id}/acknowledge`, { agrees, comment });
      toast.success('Thanks — your acknowledgement was recorded');
      onSaved();
    } catch (error) {
      toast.error(apiError(error, 'Failed to acknowledge'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-medium text-amber-900">Please acknowledge your appraisal</p>
      <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment (required if you disagree)" className="bg-white" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => ack(true)} disabled={saving}><ThumbsUp className="w-3.5 h-3.5 mr-1" /> Acknowledge</Button>
        <Button size="sm" variant="outline" onClick={() => ack(false)} disabled={saving}><ThumbsDown className="w-3.5 h-3.5 mr-1" /> I disagree</Button>
      </div>
    </div>
  );
}

function CalibrateForm({ appraisal, onDone }) {
  const [rating, setRating] = useState(appraisal.final_rating ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!rating || !reason.trim()) return toast.error('Enter a rating and a reason');
    setSaving(true);
    try {
      await api.post(`${PF}/appraisals/${appraisal.id}/calibrate`, { rating: Number(rating), reason });
      toast.success('Rating calibrated');
      onDone();
    } catch (error) {
      toast.error(apiError(error, 'Failed to calibrate'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Scale className="w-4 h-4" /> Calibrate final rating</h4>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input type="number" min="1" max="5" step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} className="sm:w-28" aria-label="Final rating" />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the adjustment" />
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">Save</Button>
      </div>
    </div>
  );
}

/** Full appraisal view; adapts to the viewer (self / manager / admin) and phase. */
function AppraisalDetail({ id, onChanged }) {
  const detail = useApi(`${PF}/appraisals/${id}`);
  const a = detail.data;
  const refresh = () => { detail.reload(); onChanged?.(); };
  if (detail.loading && !a) return <LoadingState />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!a) return null;
  const p = a.permissions;
  const released = a.phase === 'released';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">{a.employee_name}</p>
          <p className="text-xs text-slate-500">{[a.designation, a.department].filter(Boolean).join(' · ')}{a.manager_name ? ` · Manager: ${a.manager_name}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill map={REVIEW_STATUS} value={a.self_status}>Self: {REVIEW_STATUS[a.self_status]?.label}</Pill>
          {a.viewer_role !== 'self' || released ? <Pill map={REVIEW_STATUS} value={a.manager_status}>Manager: {REVIEW_STATUS[a.manager_status]?.label}</Pill> : null}
        </div>
      </div>
      <PhaseStepper phase={a.phase} peerEnabled={a.config.peer_feedback_enabled} />
      {a.config.self_review_due && a.phase === 'self_review' && <p className="text-xs text-slate-500">Self reviews due {fmtDate(a.config.self_review_due)}</p>}
      {a.config.manager_review_due && a.phase === 'manager_review' && <p className="text-xs text-slate-500">Manager reviews due {fmtDate(a.config.manager_review_due)}</p>}

      {(a.final_rating != null) && (
        <div className="rounded-xl bg-slate-900 text-white p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-300">{released ? 'Final rating' : a.viewer_role === 'admin' ? 'Current final rating' : 'Manager rating'}</p>
            <p className="text-3xl font-bold">{Number(a.final_rating).toFixed(2)}</p>
            <p className="text-sm text-slate-300">{a.final_label}</p>
          </div>
          {a.calibration && (
            <p className="text-xs text-slate-300 max-w-sm">Calibrated from {a.calibration.original_rating} by {a.calibration.by_name}: {a.calibration.reason}</p>
          )}
          {a.calibrated && <p className="text-xs text-slate-300">Adjusted during calibration</p>}
        </div>
      )}

      {a.acknowledgement && (
        <div className={`rounded-lg p-3 text-sm ${a.acknowledgement.agrees ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {a.acknowledgement.agrees ? 'Acknowledged' : 'Disagreed'} on {fmtDate(a.acknowledgement.at)}{a.acknowledgement.comment ? `: ${a.acknowledgement.comment}` : ''}
        </div>
      )}
      {p.can_acknowledge && <AcknowledgeForm appraisal={a} onSaved={refresh} />}
      {p.can_calibrate && <CalibrateForm appraisal={a} onDone={refresh} />}

      {p.can_self_review ? (
        <SectionCard title="Your self review" icon={ClipboardCheck} bodyClassName="p-3 sm:p-5">
          <ReviewEditor key={`self-${a.self_status}`} appraisal={a} kind="self" onSaved={refresh} />
        </SectionCard>
      ) : a.self_review ? (
        <ReviewView title="Self review" review={a.self_review} appraisal={a} />
      ) : a.viewer_role !== 'self' && <p className="text-sm text-slate-500">The self review hasn&apos;t been submitted yet.</p>}

      {p.can_manager_review ? (
        <SectionCard title="Manager review" icon={ShieldCheck} bodyClassName="p-3 sm:p-5">
          <ReviewEditor key={`mgr-${a.manager_status}`} appraisal={a} kind="manager" onSaved={refresh} />
        </SectionCard>
      ) : a.manager_review && <ReviewView title="Manager review" review={a.manager_review} appraisal={a} showExtras />}

      {a.viewer_role === 'self' && !released && a.phase !== 'self_review' && (
        <p className="text-xs text-slate-500">Manager ratings and peer feedback are shared once the appraisal is released.</p>
      )}

      <PeerFeedbackView appraisal={a} />
      <PeerSection appraisal={a} onChanged={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------- peer inbox

function PeerFeedbackForm({ item, onClose, onSaved }) {
  const [ratings, setRatings] = useState(() => Object.fromEntries((item.ratings || []).map(r => [r.competency_id, r])));
  const [strengths, setStrengths] = useState(item.strengths || '');
  const [improvements, setImprovements] = useState(item.improvements || '');
  const [saving, setSaving] = useState(false);
  const readOnly = !item.can_submit;
  const save = async (submit) => {
    setSaving(true);
    try {
      await api.put(`${PF}/peer-feedback/${item.id}`, {
        ratings: Object.values(ratings).filter(r => r.rating).map(r => ({ competency_id: r.competency_id, rating: r.rating, comment: r.comment || '' })),
        strengths, improvements, submit,
      });
      toast.success(submit ? 'Feedback submitted' : 'Draft saved');
      onSaved();
      if (submit) onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save feedback'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>Feedback for {item.reviewee_name}</DialogTitle></DialogHeader>
      <p className="text-xs text-slate-500">Your feedback is anonymous to {item.reviewee_name}; their manager can see who wrote it.</p>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {item.competencies.map(c => (
          <div key={c.id} className="space-y-1.5">
            <Label>{c.name}</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <RatingSelect scale={item.rating_scale} disabled={readOnly} value={ratings[c.id]?.rating} onChange={(v) => setRatings(r => ({ ...r, [c.id]: { ...r[c.id], competency_id: c.id, rating: v } }))} />
              <Input disabled={readOnly} value={ratings[c.id]?.comment || ''} onChange={(e) => setRatings(r => ({ ...r, [c.id]: { ...r[c.id], competency_id: c.id, comment: e.target.value } }))} placeholder="Comment" />
            </div>
          </div>
        ))}
        <div className="space-y-1.5"><Label>Strengths</Label><Textarea disabled={readOnly} rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>What could they do better?</Label><Textarea disabled={readOnly} rows={3} value={improvements} onChange={(e) => setImprovements(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        {!readOnly && <Button variant="outline" onClick={() => save(false)} disabled={saving}>Save draft</Button>}
        {!readOnly && <Button className="bg-slate-800 hover:bg-slate-900" onClick={() => save(true)} disabled={saving}>Submit</Button>}
      </DialogFooter>
    </>
  );
}

function PeerInbox() {
  const inbox = useApi(`${PF}/peer-feedback/inbox`);
  const [open, setOpen] = useState(null);
  const items = inbox.data || [];
  return (
    <SectionCard icon={MessageSquareQuote} title="Peer feedback requests">
      <DataState state={inbox} empty={!items.length} emptyText="Nobody has asked for your feedback yet" emptyIcon={MessageSquareQuote}>
        <div className="divide-y divide-slate-100">
          {items.map(i => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4">
              <div>
                <p className="font-medium text-slate-900">{i.reviewee_name}</p>
                <p className="text-xs text-slate-500">{i.cycle_name} · {i.phase_label}</p>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={i.status === 'submitted' ? 'emerald' : i.can_submit ? 'amber' : 'slate'}>
                  {i.status === 'submitted' ? 'Submitted' : i.can_submit ? 'Due' : 'Opens in 360° phase'}
                </Pill>
                <Button size="sm" variant="outline" onClick={() => setOpen(i)}>{i.can_submit ? 'Give feedback' : 'View'}</Button>
              </div>
            </div>
          ))}
        </div>
      </DataState>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-xl">
          {open && <PeerFeedbackForm item={open} onClose={() => setOpen(null)} onSaved={inbox.reload} />}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- admin

function ConfigForm({ config, onSaved }) {
  const locked = config.configured && config.phase !== 'setup';
  const [form, setForm] = useState(() => ({
    rating_scale: config.rating_scale.map(s => ({ ...s })),
    competencies: (config.competencies || []).map(c => ({ ...c })),
    competency_weight: config.competency_weight ?? 30,
    peer_feedback_enabled: !!config.peer_feedback_enabled,
    max_peers: config.max_peers || 5,
    min_peer_responses: config.min_peer_responses || 2,
    self_review_due: config.self_review_due || '',
    manager_review_due: config.manager_review_due || '',
  }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const body = {
      rating_scale: form.rating_scale.map(s => ({ value: s.value, label: s.label.trim() || String(s.value) })),
      self_review_due: form.self_review_due || null,
      manager_review_due: form.manager_review_due || null,
      max_peers: Number(form.max_peers) || 5,
      min_peer_responses: Number(form.min_peer_responses) || 2,
    };
    if (!locked) {
      if (form.competencies.some(c => !c.name.trim())) return toast.error('Every competency needs a name');
      body.competencies = form.competencies.map(c => ({ ...(c.id ? { id: c.id } : {}), name: c.name.trim(), description: c.description || '' }));
      body.competency_weight = Number(form.competency_weight) || 0;
      body.peer_feedback_enabled = form.peer_feedback_enabled;
    }
    setSaving(true);
    try {
      await api.put(`${PF}/appraisal-configs/${config.cycle_id}`, body);
      toast.success('Appraisal settings saved');
      onSaved();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      {locked && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">The appraisal has started: competencies, weights and 360° settings are locked.</p>}
      <div>
        <Label>Rating scale</Label>
        <div className="grid sm:grid-cols-5 gap-2 mt-1.5">
          {form.rating_scale.map((s, i) => (
            <div key={s.value} className="flex items-center gap-1.5">
              <span className="text-sm font-semibold w-4">{s.value}</span>
              <Input value={s.label} onChange={(e) => setForm(f => ({ ...f, rating_scale: f.rating_scale.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)) }))} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label>Competencies</Label>
          {!locked && <Button size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, competencies: [...f.competencies, { name: '', description: '' }] }))}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>}
        </div>
        <div className="space-y-2 mt-1.5">
          {form.competencies.length === 0 && <p className="text-xs text-slate-500">No competencies: the score is based on goals only.</p>}
          {form.competencies.map((c, i) => (
            <div key={c.id || i} className="flex flex-col sm:flex-row gap-2">
              <Input disabled={locked} value={c.name} placeholder="Name" onChange={(e) => setForm(f => ({ ...f, competencies: f.competencies.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)) }))} />
              <Input disabled={locked} value={c.description || ''} placeholder="Description" onChange={(e) => setForm(f => ({ ...f, competencies: f.competencies.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)) }))} />
              {!locked && <Button variant="ghost" size="icon" onClick={() => setForm(f => ({ ...f, competencies: f.competencies.filter((_, idx) => idx !== i) }))} aria-label="Remove competency"><Trash2 className="w-4 h-4 text-rose-500" /></Button>}
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cw">Competency weight %</Label>
          <Input id="cw" type="number" min="0" max="100" disabled={locked} value={form.competency_weight} onChange={(e) => setForm(f => ({ ...f, competency_weight: e.target.value }))} />
          <p className="text-[11px] text-slate-500">Goals: {100 - (Number(form.competency_weight) || 0)}%</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mp">Max peers</Label>
          <Input id="mp" type="number" min="1" max="10" value={form.max_peers} onChange={(e) => setForm(f => ({ ...f, max_peers: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mpr">Min. peer responses</Label>
          <Input id="mpr" type="number" min="1" max="10" value={form.min_peer_responses} onChange={(e) => setForm(f => ({ ...f, min_peer_responses: e.target.value }))} />
          <p className="text-[11px] text-slate-500">Fewer responses are withheld from the employee</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="srd">Self review due</Label>
          <Input id="srd" type="date" value={form.self_review_due} onChange={(e) => setForm(f => ({ ...f, self_review_due: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mrd">Manager review due</Label>
          <Input id="mrd" type="date" value={form.manager_review_due} onChange={(e) => setForm(f => ({ ...f, manager_review_due: e.target.value }))} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={form.peer_feedback_enabled} disabled={locked} onCheckedChange={(v) => setForm(f => ({ ...f, peer_feedback_enabled: v }))} />
        Enable 360° peer feedback
      </label>
      <div className="flex justify-end"><Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Save settings'}</Button></div>
    </div>
  );
}

function AdminPanel({ cycleId, onOpen }) {
  const config = useApi(`${PF}/appraisal-configs/${cycleId}`);
  const stats = useApi(config.data?.configured && config.data.phase !== 'setup' ? `${PF}/appraisals/stats` : null, { cycle_id: cycleId });
  const all = useApi(config.data?.configured && config.data.phase !== 'setup' ? `${PF}/appraisals` : null, { scope: 'all', cycle_id: cycleId });
  const [busy, setBusy] = useState(false);
  const c = config.data;
  const reload = () => { config.reload(); stats.reload(); all.reload(); };

  const advance = async (force = false) => {
    if (!c?.next_phase) return;
    if (!force && !window.confirm(`Move to "${PHASE_LABELS[c.next_phase]}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await api.post(`${PF}/appraisal-configs/${cycleId}/advance`, { force });
      toast.success(`Moved to ${r.data.phase_label}`);
      reload();
    } catch (error) {
      const msg = apiError(error, 'Failed to advance');
      if (!force && /force/i.test(msg)) {
        if (window.confirm(`${msg.replace(/ Pass force to continue anyway\./, '')} Continue anyway?`)) {
          setBusy(false);
          return advance(true);
        }
      } else toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (config.loading && !c) return <LoadingState />;
  if (config.error) return <ErrorState message={config.error} onRetry={config.reload} />;
  if (!c) return null;
  const rows = all.data || [];

  return (
    <div className="space-y-4">
      <SectionCard icon={Award} title="Phase" bodyClassName="p-3 sm:p-5 space-y-3">
        <PhaseStepper phase={c.phase} peerEnabled={c.peer_feedback_enabled} />
        {c.next_phase && c.configured && (
          <Button onClick={() => advance(false)} disabled={busy} className="bg-slate-800 hover:bg-slate-900">
            {c.phase === 'setup' ? 'Start self reviews' : c.next_phase === 'released' ? 'Release results' : `Move to ${PHASE_LABELS[c.next_phase]}`}
          </Button>
        )}
        {!c.configured && <p className="text-sm text-slate-500">Save the settings below to configure this cycle&apos;s appraisal.</p>}
      </SectionCard>

      {stats.data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <StatTile label="Self reviews" value={`${stats.data.self_submitted}/${stats.data.total}`} icon={ClipboardCheck} tone="blue" />
          <StatTile label="Manager reviews" value={`${stats.data.manager_submitted}/${stats.data.total}`} icon={ShieldCheck} tone="purple" />
          <StatTile label="Calibrated" value={stats.data.calibrated} icon={Scale} tone="amber" />
          <StatTile label="Acknowledged" value={`${stats.data.acknowledged}${stats.data.disagreed ? ` (${stats.data.disagreed} disagree)` : ''}`} icon={ThumbsUp} tone="emerald" />
        </div>
      )}

      {stats.data && stats.data.distribution.some(d => d.count) && (
        <SectionCard icon={Scale} title="Rating distribution" bodyClassName="p-3 sm:p-5">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.data.distribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="value" tickFormatter={(v) => `${v}`} />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(v) => [v, 'Employees']} labelFormatter={(v) => `${v} — ${stats.data.distribution.find(d => d.value === v)?.label}`} />
                <Bar dataKey="count" fill="#334155" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}

      {c.phase !== 'setup' && (
        <SectionCard
          icon={Users}
          title="All appraisals"
          actions={<ExportButton disabled={!rows.length} onClick={() => exportCsv('appraisals', rows, [
            { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'manager_name', label: 'Manager' },
            { key: 'self_status', label: 'Self review' }, { key: 'manager_status', label: 'Manager review' },
            { key: 'self_score', label: 'Self score' }, { key: 'manager_score', label: 'Manager score' }, { key: 'final_rating', label: 'Final rating' },
            { label: 'Calibrated', value: r => (r.calibration ? 'yes' : 'no') }, { label: 'Calibration reason', value: r => r.calibration?.reason },
            { label: 'Acknowledged', value: r => (r.acknowledgement ? (r.acknowledgement.agrees ? 'agrees' : 'disagrees') : '') },
          ])} />}
        >
          <DataState state={all} empty={!rows.length} emptyText="No appraisals">
            <DataTable
              rows={rows}
              onRowClick={(r) => onOpen(r.id)}
              columns={[
                { key: 'employee_name', label: 'Employee', render: r => <div><p className="font-medium text-slate-900">{r.employee_name}</p><p className="text-xs text-slate-500">{r.department}</p></div> },
                { key: 'self', label: 'Self', hideOnMobile: true, render: r => <Pill map={REVIEW_STATUS} value={r.self_status} /> },
                { key: 'mgr', label: 'Manager', render: r => <Pill map={REVIEW_STATUS} value={r.manager_status} /> },
                { key: 'score', label: 'Final', render: r => <RatingBadge value={r.final_rating} scale={c.rating_scale} /> },
                { key: 'cal', label: '', hideOnMobile: true, render: r => (r.calibration ? <Pill tone="amber">Calibrated</Pill> : null) },
              ]}
            />
          </DataState>
        </SectionCard>
      )}

      <SectionCard icon={Settings2} title="Settings" bodyClassName="p-3 sm:p-5">
        <ConfigForm key={`${c.phase}-${c.updated_at || ''}`} config={c} onSaved={reload} />
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------- page

const AppraisalsPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = tabParam === 'results' ? 'my' : (tabParam || (isAdmin ? 'admin' : 'my'));
  const setTab = (t) => setParams(p => { p.set('tab', t); return p; }, { replace: true });

  const cycles = useApi(`${PF}/cycles`);
  const [picked, setPicked] = useState('');
  const cycleId = picked || defaultCycleId(cycles.data);
  const mine = useApi(cycleId ? `${PF}/appraisals` : null, { scope: 'my', cycle_id: cycleId });
  const team = useApi(cycleId && lead ? `${PF}/appraisals` : null, { scope: 'team', cycle_id: cycleId });
  const [openId, setOpenId] = useState(null);
  const myAppraisal = mine.data?.[0];
  const teamRows = useMemo(() => team.data || [], [team.data]);

  return (
    <PageShell
      icon={Award}
      title="Appraisals"
      subtitle="Self review, manager review, 360° feedback and results"
      actions={<CycleSelect cycles={cycles.data || []} value={cycleId} onChange={setPicked} />}
    >
      {!cycles.loading && !cycles.error && !(cycles.data || []).length && (
        <SectionCard><EmptyState icon={Award} text="No review cycles yet." /></SectionCard>
      )}
      {cycleId && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
            <TabsTrigger value="my">My appraisal</TabsTrigger>
            {lead && <TabsTrigger value="team">Team reviews</TabsTrigger>}
            <TabsTrigger value="peer">Peer feedback</TabsTrigger>
            {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
          </TabsList>

          <TabsContent value="my">
            <SectionCard bodyClassName="p-3 sm:p-5">
              <DataState state={mine} empty={!myAppraisal} emptyText="Appraisals haven't started for you in this cycle yet" emptyIcon={Award}>
                {myAppraisal && <AppraisalDetail key={myAppraisal.id} id={myAppraisal.id} onChanged={mine.reload} />}
              </DataState>
            </SectionCard>
          </TabsContent>

          {lead && (
            <TabsContent value="team">
              <SectionCard
                icon={Users}
                title="Team reviews"
                actions={<ExportButton disabled={!teamRows.length} onClick={() => exportCsv('team-appraisals', teamRows, [
                  { key: 'employee_name', label: 'Employee' }, { key: 'designation', label: 'Designation' },
                  { key: 'self_status', label: 'Self review' }, { key: 'manager_status', label: 'Manager review' },
                  { key: 'manager_score', label: 'Manager score' }, { key: 'final_rating', label: 'Final rating' },
                ])} />}
              >
                <DataState state={team} empty={!teamRows.length} emptyText="No team appraisals in this cycle" emptyIcon={Users}>
                  <DataTable
                    rows={teamRows}
                    onRowClick={(r) => setOpenId(r.id)}
                    columns={[
                      { key: 'employee_name', label: 'Employee', render: r => <div><p className="font-medium text-slate-900">{r.employee_name}</p><p className="text-xs text-slate-500">{r.designation}</p></div> },
                      { key: 'phase', label: 'Phase', hideOnMobile: true, render: r => r.phase_label },
                      { key: 'self', label: 'Self', render: r => <Pill map={REVIEW_STATUS} value={r.self_status} /> },
                      { key: 'mgr', label: 'Your review', render: r => <Pill map={REVIEW_STATUS} value={r.manager_status} /> },
                      { key: 'score', label: 'Rating', hideOnMobile: true, render: r => (r.final_rating != null ? Number(r.final_rating).toFixed(2) : '—') },
                      { key: 'open', label: '', render: () => <ChevronRight className="w-4 h-4 text-slate-400" /> },
                    ]}
                  />
                </DataState>
              </SectionCard>
            </TabsContent>
          )}

          <TabsContent value="peer"><PeerInbox /></TabsContent>

          {isAdmin && (
            <TabsContent value="admin"><AdminPanel key={cycleId} cycleId={cycleId} onOpen={setOpenId} /></TabsContent>
          )}
        </Tabs>
      )}

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Appraisal</DialogTitle></DialogHeader>
          {openId && <AppraisalDetail id={openId} onChanged={team.reload} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default AppraisalsPage;
