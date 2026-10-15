import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Field } from './FormBits';
import { StarRating, LoadingState } from './Common';
import { API, DEFAULT_CRITERIA, RECOMMENDATION_LABELS, RECOMMENDATION_STYLES, errorMessage, fmtDate } from '../lib';

/** Submit (or update) the current user's scorecard for an interview. */
export function ScorecardDialog({ interview, onClose, onSaved }) {
  const criteria = interview?.scorecard_criteria?.length ? interview.scorecard_criteria : DEFAULT_CRITERIA;
  const [ratings, setRatings] = useState({});
  const [strengths, setStrengths] = useState('');
  const [concerns, setConcerns] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!interview) return;
    setRatings({});
    setStrengths('');
    setConcerns('');
    setRecommendation('');
    // Prefill an existing scorecard so it can be edited
    api.get(`${API}/interviews/${interview.id}`).then(r => {
      const mine = r.data?.my_scorecard;
      if (!mine) return;
      setRatings(Object.fromEntries((mine.ratings || []).map(x => [x.criterion, x.rating])));
      setStrengths(mine.strengths || '');
      setConcerns(mine.concerns || '');
      setRecommendation(mine.recommendation || '');
    }).catch(() => {});
  }, [interview]);

  const save = async () => {
    const missing = criteria.filter(c => !ratings[c]);
    if (missing.length) return toast.error(`Rate: ${missing.join(', ')}`);
    if (!recommendation) return toast.error('Choose a recommendation');
    setSaving(true);
    try {
      await api.post(`${API}/interviews/${interview.id}/scorecard`, {
        ratings: criteria.map(c => ({ criterion: c, rating: ratings[c] })),
        strengths: strengths.trim(),
        concerns: concerns.trim(),
        recommendation,
      });
      toast.success('Scorecard submitted');
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not submit the scorecard'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!interview} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scorecard</DialogTitle>
          <DialogDescription>{interview?.candidate_name} · {interview?.round_name}. Rate independently — other interviewers' feedback unlocks after you submit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {criteria.map(c => (
            <div key={c} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
              <span className="text-sm text-slate-800">{c}</span>
              <StarRating value={ratings[c]} onChange={(v) => setRatings(r => ({ ...r, [c]: v }))} size="w-5 h-5" label={c} />
            </div>
          ))}
          <Field id="sc-str" label="Strengths"><Textarea id="sc-str" rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} maxLength={3000} /></Field>
          <Field id="sc-con" label="Concerns"><Textarea id="sc-con" rows={3} value={concerns} onChange={(e) => setConcerns(e.target.value)} maxLength={3000} /></Field>
          <fieldset>
            <legend className="text-xs sm:text-sm font-medium mb-1.5">Recommendation *</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(RECOMMENDATION_LABELS).map(([key, text]) => (
                <label key={key} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${recommendation === key ? 'border-slate-800 bg-slate-50 font-medium' : 'border-slate-200'}`}>
                  <input type="radio" name="recommendation" value={key} checked={recommendation === key} onChange={() => setRecommendation(key)} />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Submitting…' : 'Submit scorecard'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const RecommendationBadge = ({ value }) => (
  <Badge className={`${RECOMMENDATION_STYLES[value] || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs`}>{RECOMMENDATION_LABELS[value] || value}</Badge>
);

/** A list of submitted scorecards. */
export function ScorecardList({ cards }) {
  if (!cards?.length) return <p className="text-sm text-slate-500 py-2">No scorecards submitted yet.</p>;
  return (
    <ul className="space-y-3">
      {cards.map(card => (
        <li key={card.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-slate-900">{card.interviewer_name}</p>
              <p className="text-[11px] text-slate-500">{card.round_name} · {fmtDate(card.submitted_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">{card.overall_rating}/5</span>
              <RecommendationBadge value={card.recommendation} />
            </div>
          </div>
          <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1">
            {(card.ratings || []).map(r => (
              <div key={r.criterion} className="flex items-center justify-between text-xs text-slate-600">
                <span>{r.criterion}</span><StarRating value={r.rating} size="w-3 h-3" label={r.criterion} />
              </div>
            ))}
          </div>
          {card.strengths && <p className="mt-2 text-xs text-slate-700"><span className="font-medium text-emerald-700">Strengths:</span> {card.strengths}</p>}
          {card.concerns && <p className="mt-1 text-xs text-slate-700"><span className="font-medium text-red-700">Concerns:</span> {card.concerns}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Fetches an interview's scorecards, honouring the "hidden until you submit" rule. */
export function InterviewScorecards({ interviewId, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/interviews/${interviewId}/scorecards`)
      .then(r => { if (alive) { setData(r.data); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, 'Could not load scorecards')); });
    return () => { alive = false; };
  }, [interviewId, refreshKey]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <LoadingState />;
  if (data.hidden) {
    return (
      <p className="text-xs text-slate-500 flex items-center gap-1.5 py-2">
        <Lock className="w-3.5 h-3.5" /> {data.submitted_count} scorecard(s) submitted — yours first, then you'll see theirs.
      </p>
    );
  }
  return <ScorecardList cards={data.scorecards} />;
}
