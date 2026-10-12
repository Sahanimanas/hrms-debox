import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Field, NativeSelect } from './FormBits';
import { API, INTERVIEW_MODE_LABELS, errorMessage, fmtDateTime, toLocalInput, toOptions } from '../lib';

const ROUNDS = ['Phone screen', 'Technical round', 'System design', 'Hiring manager round', 'HR round', 'Culture fit'];
const EMPTY = { round_name: 'Technical round', scheduled_at: '', duration_minutes: 60, mode: 'video', meeting_link: '', location: '', notes: '' };

/** Multi-select of employees (search + chips). */
function PeoplePicker({ people, selected, onChange }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter(p => !selected.includes(p.email)
      && (!s || [p.full_name, p.email, p.department].some(v => String(v || '').toLowerCase().includes(s)))).slice(0, 8);
  }, [people, selected, q]);
  const byEmail = Object.fromEntries(people.map(p => [p.email, p]));

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(email => (
            <span key={email} className="inline-flex items-center gap-1 bg-slate-100 rounded-full pl-2.5 pr-1 py-0.5 text-xs text-slate-700">
              {byEmail[email]?.full_name || email}
              <button type="button" onClick={() => onChange(selected.filter(e => e !== email))} className="p-0.5 rounded-full hover:bg-slate-200" aria-label={`Remove ${byEmail[email]?.full_name || email}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employees to add" aria-label="Search interviewers" />
      {q && (
        <ul className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-48 overflow-y-auto">
          {matches.length === 0 ? <li className="px-3 py-2 text-xs text-slate-500">No matches</li> : matches.map(p => (
            <li key={p.email}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm" onClick={() => { onChange([...selected, p.email]); setQ(''); }}>
                <span className="font-medium text-slate-900">{p.full_name}</span>
                <span className="text-xs text-slate-500"> · {p.designation || p.role} · {p.department}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Schedule (candidate given) or reschedule (interview given). */
export default function InterviewDialog({ open, candidate, interview, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [interviewers, setInterviewers] = useState([]);
  const [people, setPeople] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (interview) {
      setForm({
        round_name: interview.round_name,
        scheduled_at: toLocalInput(interview.scheduled_at),
        duration_minutes: interview.duration_minutes,
        mode: interview.mode,
        meeting_link: interview.meeting_link || '',
        location: interview.location || '',
        notes: interview.notes || '',
      });
      setInterviewers(interview.interviewer_emails || []);
    } else {
      setForm(EMPTY);
      setInterviewers([]);
    }
    api.get(`${API}/people`).then(r => setPeople(r.data || [])).catch(() => {});
  }, [open, interview]);

  const set = (key) => (value) => setForm(f => ({ ...f, [key]: value }));
  const setInput = (key) => (e) => set(key)(e.target.value);

  const save = async () => {
    if (form.round_name.trim().length < 2) return toast.error('Name the round');
    if (!form.scheduled_at) return toast.error('Pick a date and time');
    if (!interviewers.length) return toast.error('Add at least one interviewer');
    if (form.mode === 'video' && !/^https?:\/\//.test(form.meeting_link.trim())) return toast.error('Add the video meeting link');
    const body = {
      round_name: form.round_name.trim(),
      scheduled_at: new Date(form.scheduled_at).toISOString(),
      duration_minutes: Number(form.duration_minutes),
      mode: form.mode,
      meeting_link: form.meeting_link.trim() || null,
      location: form.location.trim() || null,
      notes: form.notes.trim(),
      interviewer_emails: interviewers,
    };
    setSaving(true);
    try {
      const res = interview
        ? await api.put(`${API}/interviews/${interview.id}`, body)
        : await api.post(`${API}/candidates/${candidate.id}/interviews`, body);
      toast.success(interview ? 'Interview updated — interviewers notified' : 'Interview scheduled — interviewers notified');
      const conflicts = res.data?.conflicts || [];
      if (conflicts.length) {
        toast.warning(`Heads-up: overlaps with ${conflicts.map(c => `${c.round_name} (${c.candidate_name}) at ${fmtDateTime(c.scheduled_at)}`).join('; ')}`, { duration: 8000 });
      }
      onSaved?.(res.data?.interview);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the interview'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{interview ? 'Reschedule interview' : 'Schedule interview'}</DialogTitle>
          <DialogDescription>{interview ? interview.candidate_name : candidate?.name} — interviewers get a notification and can download a calendar invite.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field id="iv-round" label="Round *" className="sm:col-span-2">
            <Input id="iv-round" list="iv-rounds" value={form.round_name} onChange={setInput('round_name')} maxLength={80} />
            <datalist id="iv-rounds">{ROUNDS.map(r => <option key={r} value={r} />)}</datalist>
          </Field>
          <Field id="iv-when" label="Date & time *"><Input id="iv-when" type="datetime-local" value={form.scheduled_at} onChange={setInput('scheduled_at')} /></Field>
          <Field id="iv-dur" label="Duration">
            <NativeSelect id="iv-dur" value={String(form.duration_minutes)} onChange={set('duration_minutes')}
              options={[15, 30, 45, 60, 90, 120, 180].map(m => ({ value: String(m), label: m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}` }))} />
          </Field>
          <Field id="iv-mode" label="Mode"><NativeSelect id="iv-mode" value={form.mode} onChange={set('mode')} options={toOptions(INTERVIEW_MODE_LABELS)} /></Field>
          {form.mode === 'video' ? (
            <Field id="iv-link" label="Meeting link *"><Input id="iv-link" type="url" value={form.meeting_link} onChange={setInput('meeting_link')} placeholder="https://meet.google.com/…" maxLength={500} /></Field>
          ) : (
            <Field id="iv-loc" label={form.mode === 'phone' ? 'Phone / dial-in (optional)' : 'Location'}><Input id="iv-loc" value={form.location} onChange={setInput('location')} maxLength={200} /></Field>
          )}
          <Field id="iv-people" label="Interviewers *" className="sm:col-span-2">
            <PeoplePicker people={people} selected={interviewers} onChange={setInterviewers} />
          </Field>
          <Field id="iv-notes" label="Notes for interviewers" className="sm:col-span-2"><Textarea id="iv-notes" rows={2} value={form.notes} onChange={setInput('notes')} maxLength={2000} /></Field>
        </div>
        {interview && (
          <p className="text-xs text-slate-500 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Interviewers who are removed or rescheduled are notified automatically.</p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : interview ? 'Save changes' : 'Schedule'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
