// Admin survey builder (create / edit) in a dialog.
import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import AudiencePicker from './AudiencePicker';
import { API, QUESTION_TYPE_LABELS, errorMessage, toLocalInput, fromLocalInput } from '../lib';

let seq = 0;
const tempId = () => `new_${Date.now().toString(36)}_${seq++}`;

const blankQuestion = (type = 'rating') => ({
  id: tempId(),
  type,
  text: '',
  required: true,
  options: ['', ''],
});

const ENPS_TEMPLATE = [
  { id: tempId(), type: 'nps', text: 'How likely are you to recommend this company as a place to work?', required: true, options: [] },
  { id: tempId(), type: 'text', text: 'What is the main reason for your score?', required: false, options: [] },
];

export default function SurveyBuilder({ survey, onClose, onSaved }) {
  const editing = !!survey?.id;
  const locked = (survey?.response_count || 0) > 0;
  const [form, setForm] = useState(() => ({
    title: survey?.title || '',
    description: survey?.description || '',
    anonymous: survey?.anonymous ?? true,
    audience: survey?.audience || { type: 'everyone', departments: [] },
    opens_at: toLocalInput(survey?.opens_at),
    closes_at: toLocalInput(survey?.closes_at),
    questions: survey?.questions?.map(q => ({ ...q, options: q.options || ['', ''] })) || [blankQuestion('rating')],
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setQ = (i, patch) => setForm(f => ({ ...f, questions: f.questions.map((q, qi) => (qi === i ? { ...q, ...patch } : q)) }));
  const move = (i, d) => setForm(f => {
    const qs = [...f.questions];
    const j = i + d;
    if (j < 0 || j >= qs.length) return f;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    return { ...f, questions: qs };
  });
  const removeQ = (i) => setForm(f => ({ ...f, questions: f.questions.filter((_, qi) => qi !== i) }));

  const save = async (publish) => {
    if (!form.title.trim()) return toast.error('Give the survey a title');
    if (!form.questions.length) return toast.error('Add at least one question');
    for (const [i, q] of form.questions.entries()) {
      if (!q.text.trim()) return toast.error(`Question ${i + 1} needs text`);
      if (q.type.endsWith('_choice')) {
        const opts = q.options.map(o => o.trim()).filter(Boolean);
        if (opts.length < 2) return toast.error(`Question ${i + 1} needs at least 2 options`);
        if (new Set(opts).size !== opts.length) return toast.error(`Question ${i + 1} has duplicate options`);
      }
    }
    if (form.audience.type === 'departments' && !form.audience.departments.length) return toast.error('Pick at least one department');

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      opens_at: fromLocalInput(form.opens_at),
      closes_at: fromLocalInput(form.closes_at),
    };
    if (!locked) {
      payload.anonymous = form.anonymous;
      payload.audience = form.audience;
      payload.questions = form.questions.map(q => ({
        ...(q.id && !String(q.id).startsWith('new_') ? { id: q.id } : {}),
        type: q.type,
        text: q.text.trim(),
        required: !!q.required,
        ...(q.type.endsWith('_choice') ? { options: q.options.map(o => o.trim()).filter(Boolean) } : {}),
      }));
    }

    setSaving(true);
    try {
      if (editing) {
        await api.put(`${API}/surveys/${survey.id}`, payload);
        if (publish) await api.post(`${API}/surveys/${survey.id}/publish`);
      } else {
        await api.post(`${API}/surveys`, { ...payload, publish });
      }
      toast.success(publish ? 'Survey published' : 'Survey saved');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the survey'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit survey' : 'New survey'}</DialogTitle>
          {locked && <DialogDescription>Responses have been received, so questions, audience and anonymity are locked.</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sv-title">Title</Label>
            <Input id="sv-title" value={form.title} maxLength={200} onChange={e => set('title', e.target.value)} placeholder="e.g. Q4 pulse survey" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sv-desc">Description</Label>
            <Textarea id="sv-desc" rows={2} value={form.description} maxLength={2000} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sv-open">Opens (optional)</Label>
              <Input id="sv-open" type="datetime-local" value={form.opens_at} onChange={e => set('opens_at', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sv-close">Closes (optional)</Label>
              <Input id="sv-close" type="datetime-local" value={form.closes_at} onChange={e => set('closes_at', e.target.value)} />
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={form.anonymous} disabled={locked} onCheckedChange={v => set('anonymous', v)} className="mt-0.5" />
            <span>
              Anonymous
              <span className="block text-xs text-slate-500">Answers are stored without any link to the respondent. Results appear once 3+ people respond.</span>
            </span>
          </label>
          <AudiencePicker value={form.audience} onChange={v => set('audience', v)} disabled={locked} />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label>Questions ({form.questions.length})</Label>
              {!locked && !form.questions.some(q => q.type === 'nps') && (
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set('questions', [...ENPS_TEMPLATE.map(q => ({ ...q, id: tempId() })), ...form.questions])}>
                  + Add eNPS question
                </Button>
              )}
            </div>
            {form.questions.map((q, i) => (
              <div key={q.id} className="rounded-xl border border-slate-200 p-3 space-y-3 bg-white">
                <div className="flex flex-col sm:flex-row gap-2">
                  <span className="text-xs font-semibold text-slate-400 sm:pt-2.5 w-6">Q{i + 1}</span>
                  <Input value={q.text} disabled={locked} maxLength={500} placeholder="Question text" onChange={e => setQ(i, { text: e.target.value })} className="flex-1" />
                  <Select value={q.type} disabled={locked} onValueChange={v => setQ(i, { type: v })}>
                    <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(QUESTION_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {q.type.endsWith('_choice') && (
                  <div className="space-y-2 sm:pl-8">
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex gap-2">
                        <Input value={o} disabled={locked} maxLength={200} placeholder={`Option ${oi + 1}`} onChange={e => setQ(i, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)) })} className="h-8 text-sm" />
                        {!locked && q.options.length > 2 && (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove option" onClick={() => setQ(i, { options: q.options.filter((_, xi) => xi !== oi) })}><X className="w-4 h-4" /></Button>
                        )}
                      </div>
                    ))}
                    {!locked && q.options.length < 20 && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQ(i, { options: [...q.options, ''] })}><Plus className="w-3.5 h-3.5 mr-1" />Add option</Button>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between sm:pl-8">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <Switch checked={!!q.required} disabled={locked} onCheckedChange={v => setQ(i, { required: v })} />
                    Required
                  </label>
                  {!locked && (
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === form.questions.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-rose-600" aria-label="Delete question" onClick={() => removeQ(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!locked && form.questions.length < 50 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(QUESTION_TYPE_LABELS).map(([v, l]) => (
                  <Button key={v} type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => set('questions', [...form.questions, blankQuestion(v)])}>
                    <Plus className="w-3.5 h-3.5 mr-1" />{l}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {(!editing || survey.status === 'draft') && (
            <Button variant="outline" onClick={() => save(false)} disabled={saving}>Save draft</Button>
          )}
          <Button onClick={() => save(!editing || survey.status === 'draft')} disabled={saving}>
            {saving ? 'Saving…' : editing && survey.status !== 'draft' ? 'Save changes' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
