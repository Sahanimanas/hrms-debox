import React, { useEffect, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Field, NativeSelect, FilePicker } from './FormBits';
import { API, SOURCE_LABELS, STAGE_LABELS, errorMessage, parseResumeInto, resumeProblem } from '../lib';

const EMPTY = { job_id: '', name: '', email: '', phone: '', linkedin_url: '', source: 'manual', source_detail: '', tags: '', cover_letter: '' };

export default function AddCandidateDialog({ open, onClose, onSaved, jobs = [], jobId }) {
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [dupes, setDupes] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, job_id: jobId || '' });
      setFile(null);
      setDupes(null);
    }
  }, [open, jobId]);

  const set = (key) => (value) => setForm(f => ({ ...f, [key]: value }));
  const setInput = (key) => (e) => set(key)(e.target.value);

  const onFile = async (f) => {
    setFile(f);
    if (!f) return;
    const problem = resumeProblem(f);
    if (problem) return toast.error(problem);
    setParsing(true);
    try {
      const { parsed } = await parseResumeInto(f, setForm);
      if (parsed.found?.length) toast.success(`Prefilled ${parsed.found.map(k => k.replace('_url', '')).join(', ')} from the resume`);
    } catch {
      // parsing is best-effort; the upload itself happens on save
    } finally {
      setParsing(false);
    }
  };

  const checkDuplicate = async () => {
    const email = form.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setDupes(null);
    try {
      const res = await api.get(`${API}/candidates/check-duplicate`, { params: { email } });
      setDupes(res.data.duplicate ? res.data : null);
    } catch {
      setDupes(null);
    }
  };

  const save = async () => {
    if (!form.job_id) return toast.error('Choose a job');
    if (form.name.trim().length < 2) return toast.error('Enter the candidate name');
    if (!form.email.trim()) return toast.error('Enter an email');
    if (file) {
      const problem = resumeProblem(file);
      if (problem) return toast.error(problem);
    }
    const body = new FormData();
    Object.entries(form).forEach(([k, v]) => { if (String(v).trim()) body.append(k, String(v).trim()); });
    if (file) body.append('resume', file);
    setSaving(true);
    try {
      const res = await api.post(`${API}/candidates`, body);
      toast.success('Candidate added');
      if (res.data.duplicate_count) toast.message(`Note: this email also applied for ${res.data.duplicate_count} other job(s)`);
      onSaved?.(res.data.candidate);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not add the candidate'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add candidate</DialogTitle>
          <DialogDescription>Attach a PDF resume first — we'll try to fill in the contact details for you.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          {!jobId && (
            <Field id="ac-job" label="Job *" className="sm:col-span-2">
              <NativeSelect id="ac-job" value={form.job_id} onChange={set('job_id')} placeholder="Select a job"
                options={jobs.filter(j => j.status !== 'closed').map(j => ({ value: j.id, label: `${j.title} — ${j.department}` }))} />
            </Field>
          )}
          <Field id="ac-resume" label="Resume" className="sm:col-span-2" hint={parsing ? 'Reading resume…' : undefined}>
            <FilePicker id="ac-resume" file={file} onChange={onFile} />
          </Field>
          <Field id="ac-name" label="Full name *"><Input id="ac-name" value={form.name} onChange={setInput('name')} maxLength={100} /></Field>
          <Field id="ac-email" label="Email *"><Input id="ac-email" type="email" value={form.email} onChange={setInput('email')} onBlur={checkDuplicate} maxLength={254} /></Field>
          {dupes && (
            <div className="sm:col-span-2 rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <div>
                Possible duplicate — this email already applied:
                <ul className="list-disc pl-4 mt-1">
                  {dupes.matches.map(m => <li key={m.id}>{m.job_title} ({STAGE_LABELS[m.stage]})</li>)}
                  {dupes.other_jobs_count > 0 && <li>{dupes.other_jobs_count} other job(s) you don't manage</li>}
                </ul>
              </div>
            </div>
          )}
          <Field id="ac-phone" label="Phone"><Input id="ac-phone" value={form.phone} onChange={setInput('phone')} maxLength={20} /></Field>
          <Field id="ac-li" label="LinkedIn URL"><Input id="ac-li" value={form.linkedin_url} onChange={setInput('linkedin_url')} maxLength={300} placeholder="https://www.linkedin.com/in/…" /></Field>
          <Field id="ac-source" label="Source">
            <NativeSelect id="ac-source" value={form.source} onChange={set('source')}
              options={Object.entries(SOURCE_LABELS).filter(([k]) => k !== 'careers_page').map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field id="ac-sd" label="Source detail"><Input id="ac-sd" value={form.source_detail} onChange={setInput('source_detail')} maxLength={120} placeholder="e.g. Naukri, LinkedIn Jobs" /></Field>
          <Field id="ac-tags" label="Tags" hint="Comma separated" className="sm:col-span-2"><Input id="ac-tags" value={form.tags} onChange={setInput('tags')} placeholder="react, senior, immediate joiner" /></Field>
          <Field id="ac-cl" label="Summary / cover letter" className="sm:col-span-2"><Textarea id="ac-cl" rows={3} value={form.cover_letter} onChange={setInput('cover_letter')} maxLength={5000} /></Field>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || parsing} className="bg-slate-800 hover:bg-slate-900 gap-1">
            {parsing ? <><Sparkles className="w-4 h-4" /> Reading…</> : saving ? 'Saving…' : 'Add candidate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
