// Answer a survey (dialog). Responses can't be edited after submitting.
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { LoadingState, ErrorState } from './PageShell';
import { API, useApi, errorMessage, fmtDateTime } from '../lib';

const scale = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);

function ScaleInput({ min, max, value, onChange, lowLabel, highLabel, nps }) {
  const tone = (n) => {
    if (!nps) return 'border-slate-300';
    if (n <= 6) return 'border-rose-200';
    if (n <= 8) return 'border-amber-200';
    return 'border-emerald-200';
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {scale(min, max).map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? undefined : n)}
            aria-pressed={value === n}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg border text-sm font-medium transition-colors ${value === n ? 'bg-slate-800 text-white border-slate-800' : `bg-white text-slate-700 hover:bg-slate-50 ${tone(n)}`}`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-slate-400 max-w-md"><span>{lowLabel}</span><span>{highLabel}</span></div>
    </div>
  );
}

export default function SurveyForm({ surveyId, onClose, onSubmitted }) {
  const { data: survey, loading, error, reload } = useApi(surveyId ? `${API}/surveys/${surveyId}` : null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const setA = (id, v) => setAnswers(a => ({ ...a, [id]: v }));

  const submit = async () => {
    for (const q of survey.questions) {
      const v = answers[q.id];
      const empty = v === undefined || v === '' || (Array.isArray(v) && !v.length);
      if (q.required && empty) return toast.error(`Please answer: ${q.text}`);
    }
    const payload = survey.questions
      .filter(q => answers[q.id] !== undefined && answers[q.id] !== '' && !(Array.isArray(answers[q.id]) && !answers[q.id].length))
      .map(q => ({ question_id: q.id, value: answers[q.id] }));
    if (!payload.length) return toast.error('Answer at least one question');
    if (!window.confirm('Submit your response? You cannot change it afterwards.')) return;
    setSubmitting(true);
    try {
      await api.post(`${API}/surveys/${survey.id}/responses`, { answers: payload });
      toast.success('Thank you for your feedback!');
      onSubmitted();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not submit'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!surveyId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {survey && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 break-words">{survey.title}</DialogTitle>
              {survey.description && <DialogDescription className="whitespace-pre-line">{survey.description}</DialogDescription>}
            </DialogHeader>
            {survey.anonymous && (
              <p className="flex items-start gap-2 text-xs bg-emerald-50 text-emerald-800 rounded-md px-3 py-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                This survey is anonymous. Your answers are stored separately from your name and results are only shown in aggregate.
              </p>
            )}
            {survey.closes_at && <p className="text-xs text-slate-500">Closes {fmtDateTime(survey.closes_at)}</p>}
            {survey.responded ? (
              <p className="text-sm text-slate-600 py-6 text-center">You have already responded to this survey. Thank you!</p>
            ) : (
              <div className="space-y-5">
                {survey.questions.map((q, i) => (
                  <div key={q.id} className="space-y-2">
                    <p className="text-sm font-medium text-slate-900">
                      {i + 1}. {q.text}{q.required && <span className="text-rose-500"> *</span>}
                    </p>
                    {q.type === 'rating' && (
                      <ScaleInput min={1} max={5} value={answers[q.id]} onChange={v => setA(q.id, v)} lowLabel="Poor" highLabel="Excellent" />
                    )}
                    {q.type === 'nps' && (
                      <ScaleInput nps min={0} max={10} value={answers[q.id]} onChange={v => setA(q.id, v)} lowLabel="Not at all likely" highLabel="Extremely likely" />
                    )}
                    {q.type === 'single_choice' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map(o => (
                          <button key={o} type="button" onClick={() => setA(q.id, answers[q.id] === o ? undefined : o)}
                            className={`text-left text-sm px-3 py-2 rounded-lg border ${answers[q.id] === o ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                            {o}
                          </button>
                        ))}
                      </div>
                    )}
                    {q.type === 'multiple_choice' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map(o => {
                          const selected = (answers[q.id] || []).includes(o);
                          return (
                            <label key={o} className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border cursor-pointer ${selected ? 'border-slate-800 bg-slate-50' : 'border-slate-200'}`}>
                              <Checkbox checked={selected} onCheckedChange={(c) => {
                                const cur = answers[q.id] || [];
                                setA(q.id, c ? [...cur, o] : cur.filter(x => x !== o));
                              }} />
                              {o}
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {q.type === 'text' && (
                      <Textarea rows={3} maxLength={2000} value={answers[q.id] || ''} onChange={e => setA(q.id, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              {!survey.responded && (
                <Button className="bg-slate-800 hover:bg-slate-900" onClick={submit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit response'}</Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
