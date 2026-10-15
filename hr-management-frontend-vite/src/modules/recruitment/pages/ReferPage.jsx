import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserPlus, Building2, MapPin, CheckCircle2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import api from '@/lib/api';
import PhoneInput from '@/components/PhoneInput';
import { phoneError } from '@/lib/phone';
import { PageShell, PageHeader, LoadingState, EmptyState, ErrorState } from '../components/Common';
import { Field, NativeSelect, FilePicker } from '../components/FormBits';
import { API, EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS, errorMessage, label, parseResumeInto, resumeProblem } from '../lib';

const EMPTY = { name: '', email: '', phone: '', linkedin_url: '', relationship: '', note: '' };

export default function ReferPage() {
  const [params] = useSearchParams();
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [jobId, setJobId] = useState(params.get('job') || '');
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/jobs/open`)
      .then(res => { if (alive) { setJobs(res.data || []); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, 'Could not load open roles')); });
    return () => { alive = false; };
  }, [reloadKey]);

  const job = useMemo(() => (jobs || []).find(j => j.id === jobId), [jobs, jobId]);
  const setInput = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const onFile = async (f) => {
    setFile(f);
    if (!f || resumeProblem(f)) return f && toast.error(resumeProblem(f));
    try {
      const { filled } = await parseResumeInto(f, setForm);
      if (filled) toast.success('Filled in contact details from the resume');
    } catch {
      // best effort
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!jobId) return toast.error('Choose a role');
    if (form.name.trim().length < 2 || !form.email.trim()) return toast.error("Enter your referral's name and email");
    const phoneProblem = phoneError(form.phone);
    if (phoneProblem) return toast.error(phoneProblem);
    const problem = resumeProblem(file);
    if (problem) return toast.error(problem);
    const body = new FormData();
    body.append('job_id', jobId);
    Object.entries(form).forEach(([k, v]) => { if (v.trim()) body.append(k, v.trim()); });
    body.append('resume', file);
    setSaving(true);
    try {
      const res = await api.post(`${API}/referrals`, body);
      setDone(res.data);
      setForm(EMPTY);
      setFile(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not submit the referral'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <PageHeader icon={UserPlus} title="Refer a Candidate" subtitle="Know someone great? Refer them for an open role.">
        <Button asChild variant="outline" className="h-9"><Link to="/recruitment/my-referrals">My referrals</Link></Button>
      </PageHeader>

      {error ? <ErrorState message={error} onRetry={() => setReloadKey(k => k + 1)} /> : !jobs ? <LoadingState /> : jobs.length === 0 ? (
        <Card className="border-0 shadow-md"><EmptyState title="No open roles right now" hint="Check back when new positions are published." /></Card>
      ) : done ? (
        <Card className="border-0 shadow-md">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h2 className="mt-3 text-lg font-bold text-slate-900">Thanks for the referral!</h2>
            <p className="text-sm text-slate-600 mt-1">{done.name} has been referred for {done.job_title}. You can follow their progress in My Referrals.</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="outline" onClick={() => setDone(null)}>Refer someone else</Button>
              <Button asChild><Link to="/recruitment/my-referrals">My referrals</Link></Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[1fr_340px] gap-4 sm:gap-6 items-start">
          <Card className="border-0 shadow-md">
            <CardContent className="p-4 sm:p-6">
              <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3" noValidate>
                <Field id="rf-job" label="Role *" className="sm:col-span-2">
                  <NativeSelect id="rf-job" value={jobId} onChange={setJobId} placeholder="Select an open role"
                    options={jobs.map(j => ({ value: j.id, label: `${j.title} — ${j.department}, ${j.location}` }))} />
                </Field>
                <Field id="rf-resume" label="Resume *" className="sm:col-span-2" hint="PDF resumes let us prefill the contact details.">
                  <FilePicker id="rf-resume" file={file} onChange={onFile} />
                </Field>
                <Field id="rf-name" label="Their full name *"><Input id="rf-name" value={form.name} onChange={setInput('name')} maxLength={100} /></Field>
                <Field id="rf-email" label="Their email *"><Input id="rf-email" type="email" value={form.email} onChange={setInput('email')} maxLength={254} /></Field>
                <Field id="rf-phone" label="Phone"><PhoneInput id="rf-phone" value={form.phone} onChange={(phone) => setForm(f => ({ ...f, phone }))} /></Field>
                <Field id="rf-li" label="LinkedIn URL"><Input id="rf-li" value={form.linkedin_url} onChange={setInput('linkedin_url')} maxLength={300} placeholder="https://www.linkedin.com/in/…" /></Field>
                <Field id="rf-rel" label="How do you know them?" className="sm:col-span-2"><Input id="rf-rel" value={form.relationship} onChange={setInput('relationship')} maxLength={100} placeholder="e.g. Former colleague at Acme" /></Field>
                <Field id="rf-note" label="Why are they a good fit?" className="sm:col-span-2"><Textarea id="rf-note" rows={3} value={form.note} onChange={setInput('note')} maxLength={2000} /></Field>
                <div className="sm:col-span-2 flex justify-end">
                  <Button type="submit" disabled={saving} className="w-full sm:w-auto">{saving ? 'Submitting…' : 'Submit referral'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">{job ? 'About the role' : 'Open roles'}</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {job ? (
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-slate-900">{job.title}</p>
                  <p className="flex items-center gap-1.5 text-slate-600"><Building2 className="w-4 h-4" />{job.department}</p>
                  <p className="flex items-center gap-1.5 text-slate-600"><MapPin className="w-4 h-4" />{job.location} · {label(WORK_MODE_LABELS, job.work_mode)}</p>
                  <p className="text-slate-600">{label(EMPLOYMENT_TYPE_LABELS, job.employment_type)}</p>
                  {job.summary && <p className="text-xs text-slate-500">{job.summary}…</p>}
                  <a href={`/careers/${job.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline">Full job description <ExternalLink className="w-3 h-3" /></a>
                </div>
              ) : (
                <ul className="space-y-2">
                  {jobs.slice(0, 8).map(j => (
                    <li key={j.id}>
                      <button type="button" onClick={() => setJobId(j.id)} className="text-left w-full rounded-md p-2 hover:bg-slate-50">
                        <p className="text-sm font-medium text-slate-900">{j.title}</p>
                        <p className="text-xs text-slate-500">{j.department} · {j.location}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
