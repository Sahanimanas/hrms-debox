import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, MapPin, Clock, Briefcase, CheckCircle2, Upload, Wallet, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import api from '@/lib/api';
import PhoneInput from '@/components/PhoneInput';
import { phoneError } from '@/lib/phone';
import CareersLayout from '../components/CareersLayout';
import Markdown from '../components/Markdown';
import { LoadingState, EmptyState, ErrorState } from '../components/Common';
import {
  API, EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS, RESUME_ACCEPT, errorMessage, experienceText, fmtDate, fmtLakhs, label, resumeProblem,
} from '../lib';

const EMPTY = { name: '', email: '', phone: '', linkedin_url: '', cover_letter: '', website: '' };

export default function CareerJobPage() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true, job: null, company: null, notFound: false, error: false });
  const [form, setForm] = useState(EMPTY);
  const [resume, setResume] = useState(null);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: false }));
    try {
      const res = await api.get(`${API}/public/jobs/${encodeURIComponent(slug)}`);
      setState({ loading: false, job: res.data.job, company: res.data.company_name, notFound: false, error: false });
    } catch (error) {
      setState({ loading: false, job: null, company: null, notFound: error.response?.status === 404, error: error.response?.status !== 404 });
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (state.job) document.title = `${state.job.title} — ${state.company || 'Careers'}`;
  }, [state.job, state.company]);

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const validateForm = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = 'Please enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) next.email = 'Enter a valid email address';
    const phoneProblem = phoneError(form.phone, { required: true });
    if (phoneProblem) next.phone = phoneProblem;
    if (form.linkedin_url.trim() && !/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(form.linkedin_url.trim())) next.linkedin_url = 'Enter a LinkedIn profile URL';
    const rp = resumeProblem(resume);
    if (rp) next.resume = rp;
    if (!consent) next.consent = 'Please accept the privacy notice';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => body.append(k, v.trim()));
      body.append('consent', 'true');
      body.append('resume', resume);
      const res = await api.post(`${API}/public/jobs/${encodeURIComponent(slug)}/apply`, body);
      setDone(res.data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setSubmitError(error.response?.status === 429
        ? 'Too many applications from your network. Please wait a few minutes and try again.'
        : errorMessage(error, 'Could not submit your application. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const { job } = state;

  return (
    <CareersLayout companyName={state.company}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Link to="/careers" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" /> All positions
        </Link>

        {state.loading ? (
          <LoadingState />
        ) : state.notFound ? (
          <div className="mt-6 bg-white rounded-xl border border-slate-200">
            <EmptyState icon={Briefcase} title="This position doesn't exist or is no longer listed" hint="Browse our other open roles.">
              <Button asChild variant="outline"><Link to="/careers">View open positions</Link></Button>
            </EmptyState>
          </div>
        ) : state.error ? (
          <ErrorState message="We couldn't load this position." onRetry={load} />
        ) : (
          <div className="mt-4 grid lg:grid-cols-[1fr_380px] gap-6 items-start">
            <article className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 md:p-8 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans' }}>{job.title}</h1>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-600">
                <span className="flex items-center gap-1.5"><Building2 className="w-4 h-4" />{job.department}</span>
                <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{job.location}</span>
                {experienceText(job.experience_min, job.experience_max) && (
                  <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />{experienceText(job.experience_min, job.experience_max)} experience</span>
                )}
                {job.salary && (
                  <span className="flex items-center gap-1.5"><Wallet className="w-4 h-4" />{fmtLakhs(job.salary.min)}–{fmtLakhs(job.salary.max)} per year</span>
                )}
                {job.closing_date && <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" />Apply by {fmtDate(job.closing_date)}</span>}
              </div>
              <div className="mt-3 flex gap-2">
                <Badge variant="outline">{label(EMPLOYMENT_TYPE_LABELS, job.employment_type)}</Badge>
                <Badge variant="outline">{label(WORK_MODE_LABELS, job.work_mode)}</Badge>
              </div>
              <hr className="my-6 border-slate-100" />
              <Markdown text={job.description} />
              {job.requirements && (
                <section className="mt-6">
                  <h2 className="text-base font-bold text-slate-900 mb-2">What we're looking for</h2>
                  <Markdown text={job.requirements} />
                </section>
              )}
              {job.benefits && (
                <section className="mt-6">
                  <h2 className="text-base font-bold text-slate-900 mb-2">What we offer</h2>
                  <Markdown text={job.benefits} />
                </section>
              )}
            </article>

            <aside className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-6" aria-labelledby="apply-heading">
              {done ? (
                <div className="text-center py-6" role="status">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                  <h2 className="mt-3 text-lg font-bold text-slate-900">Application received</h2>
                  <p className="mt-1 text-sm text-slate-600">Thanks for applying for {job.title}. We'll be in touch by email.</p>
                  <p className="mt-3 text-xs text-slate-500">Reference: <span className="font-mono font-semibold">{done.reference}</span></p>
                  <Button asChild variant="outline" className="mt-5"><Link to="/careers">See other roles</Link></Button>
                </div>
              ) : !job.accepting_applications ? (
                <div className="text-center py-6">
                  <Briefcase className="w-10 h-10 text-slate-300 mx-auto" />
                  <h2 className="mt-3 font-semibold text-slate-900">Applications closed</h2>
                  <p className="mt-1 text-sm text-slate-600">This position is no longer accepting applications.</p>
                  <Button asChild variant="outline" className="mt-4"><Link to="/careers">See open roles</Link></Button>
                </div>
              ) : (
                <form onSubmit={submit} noValidate className="space-y-4">
                  <h2 id="apply-heading" className="text-lg font-bold text-slate-900">Apply for this role</h2>
                  <Field id="name" label="Full name" error={errors.name}>
                    <Input id="name" value={form.name} onChange={set('name')} maxLength={100} autoComplete="name" required />
                  </Field>
                  <Field id="email" label="Email" error={errors.email}>
                    <Input id="email" type="email" value={form.email} onChange={set('email')} maxLength={254} autoComplete="email" required />
                  </Field>
                  <Field id="phone" label="Phone" error={errors.phone}>
                    <PhoneInput id="phone" value={form.phone} onChange={(phone) => setForm(f => ({ ...f, phone }))} required showError={!!errors.phone} hideErrorText />
                  </Field>
                  <Field id="linkedin" label="LinkedIn profile (optional)" error={errors.linkedin_url}>
                    <Input id="linkedin" type="url" value={form.linkedin_url} onChange={set('linkedin_url')} maxLength={300} placeholder="https://www.linkedin.com/in/…" />
                  </Field>
                  <Field id="resume" label="Resume (PDF, DOC or DOCX, max 5 MB)" error={errors.resume}>
                    <label htmlFor="resume" className="flex items-center gap-2 h-10 px-3 rounded-md border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer hover:border-slate-500 focus-within:ring-2 focus-within:ring-slate-300">
                      <Upload className="w-4 h-4 shrink-0" />
                      <span className="truncate">{resume ? resume.name : 'Choose a file'}</span>
                      <input id="resume" type="file" accept={RESUME_ACCEPT} className="sr-only" onChange={(e) => setResume(e.target.files?.[0] || null)} />
                    </label>
                  </Field>
                  <Field id="cover" label="Cover letter (optional)">
                    <Textarea id="cover" value={form.cover_letter} onChange={set('cover_letter')} rows={4} maxLength={5000} />
                    <p className="text-[11px] text-slate-400 text-right mt-1">{form.cover_letter.length}/5000</p>
                  </Field>
                  {/* Honeypot — hidden from people, bots tend to fill it */}
                  <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                    <label htmlFor="website">Website</label>
                    <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
                  </div>
                  <div>
                    <div className="flex items-start gap-2">
                      <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(!!v)} className="mt-0.5" />
                      <Label htmlFor="consent" className="text-xs font-normal text-slate-600 leading-relaxed">
                        I agree that {state.company || 'the company'} may store and process my details and resume to evaluate my application.
                      </Label>
                    </div>
                    {errors.consent && <p className="text-xs text-red-600 mt-1">{errors.consent}</p>}
                  </div>
                  {submitError && <p className="text-sm text-red-600 bg-red-50 rounded-md p-2" role="alert">{submitError}</p>}
                  <Button type="submit" disabled={submitting} className="w-full bg-slate-900 hover:bg-slate-800 h-11">
                    {submitting ? 'Submitting…' : 'Submit application'}
                  </Button>
                </form>
              )}
            </aside>
          </div>
        )}
      </div>
    </CareersLayout>
  );
}

function Field({ id, label: text, error, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">{text}</Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
