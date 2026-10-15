// Exit interview questionnaire for the employee serving notice (EL-3).
import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Star, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import api from '@/lib/api';
import { API, errMsg, fmtDate } from '../lib';
import { SectionCard, Loading } from './ui';

export const RatingInput = ({ value, onChange, disabled }) => (
  <div className="flex gap-1" role="radiogroup">
    {[1, 2, 3, 4, 5].map(n => (
      <button
        key={n}
        type="button"
        role="radio"
        aria-checked={value === n}
        aria-label={`${n} out of 5`}
        disabled={disabled}
        onClick={() => onChange(n)}
        className="p-0.5"
      >
        <Star className={`w-6 h-6 sm:w-7 sm:h-7 ${value >= n ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'}`} />
      </button>
    ))}
  </div>
);

const ExitInterviewForm = ({ onSubmitted }) => {
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`${API}/exit-interview/my`);
      setData(r.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load exit interview'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (id, patch) => setAnswers(a => ({ ...a, [id]: { ...(a[id] || {}), ...patch } }));

  const submit = async () => {
    const missing = data.questions.filter(q => q.required && !(answers[q.id]?.rating || answers[q.id]?.choice || answers[q.id]?.text?.trim()));
    if (missing.length) return toast.error(`Please answer: ${missing[0].text}`);
    setSaving(true);
    try {
      await api.post(`${API}/exit-interview/my`, {
        answers: data.questions.filter(q => answers[q.id]).map(q => ({ question_id: q.id, ...answers[q.id] })),
      });
      toast.success('Thank you for your feedback');
      await load();
      onSubmitted?.();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to submit'));
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <SectionCard icon={MessageSquareText} title="Exit interview"><Loading /></SectionCard>;
  if (data.response) {
    return (
      <SectionCard icon={MessageSquareText} title="Exit interview">
        <div className="p-4 sm:p-5 flex items-center gap-3 text-sm text-slate-700">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          Submitted on {fmtDate(data.response.submitted_at)}. Thank you for your honest feedback.
        </div>
      </SectionCard>
    );
  }
  if (!data.eligible) return null;

  return (
    <SectionCard icon={MessageSquareText} title="Exit interview">
      <div className="p-3 sm:p-5 space-y-5">
        <p className="text-xs sm:text-sm text-slate-600">Your answers are seen only by HR and help us improve. Questions marked * are required.</p>
        {data.questions.map((q, i) => (
          <div key={q.id} className="space-y-2">
            <p className="text-sm font-medium text-slate-900">{i + 1}. {q.text}{q.required && <span className="text-red-500"> *</span>}</p>
            {q.type === 'rating' && <RatingInput value={answers[q.id]?.rating || 0} onChange={(n) => set(q.id, { rating: n })} />}
            {q.type === 'choice' && (
              <div className="flex flex-wrap gap-2">
                {q.options.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => set(q.id, { choice: opt })}
                    className={`px-3 py-1.5 rounded-full border text-xs sm:text-sm transition-colors ${answers[q.id]?.choice === opt ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            {q.type === 'text' && (
              <Textarea rows={3} value={answers[q.id]?.text || ''} onChange={(e) => set(q.id, { text: e.target.value })} />
            )}
          </div>
        ))}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={saving} className="w-full sm:w-auto">{saving ? 'Submitting…' : 'Submit exit interview'}</Button>
        </div>
      </div>
    </SectionCard>
  );
};

export default ExitInterviewForm;
