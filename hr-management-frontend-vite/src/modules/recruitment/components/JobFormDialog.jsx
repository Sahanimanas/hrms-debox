import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Field, NativeSelect } from './FormBits';
import { API, DEFAULT_CRITERIA, EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS, currentUser, errorMessage, toOptions } from '../lib';

const EMPTY = {
  title: '', department: '', location: '', employment_type: 'full_time', work_mode: 'onsite',
  experience_min: '', experience_max: '', salary_min: '', salary_max: '', show_salary: false, headcount: 1,
  closing_date: '', hiring_manager_email: '', description: '', requirements: '', benefits: '',
  criteria: DEFAULT_CRITERIA.join('\n'), slug: '',
};

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

/** Create (admin) or edit (admin / hiring manager) a job posting. */
export default function JobFormDialog({ open, job, onClose, onSaved }) {
  const user = currentUser();
  const isAdmin = user.role === 'admin';
  const [form, setForm] = useState(EMPTY);
  const [managers, setManagers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(job ? {
      ...EMPTY,
      ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, job[k] ?? EMPTY[k]])),
      criteria: (job.scorecard_criteria || DEFAULT_CRITERIA).join('\n'),
      hiring_manager_email: job.hiring_manager_email || '',
      closing_date: job.closing_date || '',
    } : EMPTY);
  }, [open, job]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    api.get(`${API}/people`, { params: { role: 'manager' } }).then(r => setManagers(r.data || [])).catch(() => {});
  }, [open, isAdmin]);

  const set = (key) => (value) => setForm(f => ({ ...f, [key]: value }));
  const setInput = (key) => (e) => set(key)(e.target.value);

  const save = async () => {
    if (!form.title.trim() || !form.department.trim() || !form.location.trim()) return toast.error('Title, department and location are required');
    const criteria = [...new Set(form.criteria.split(/[\n,]/).map(s => s.trim()).filter(Boolean))];
    if (!criteria.length) return toast.error('Add at least one scorecard criterion');
    if (criteria.length > 12) return toast.error('Use at most 12 scorecard criteria');
    const body = {
      title: form.title.trim(),
      department: form.department.trim(),
      location: form.location.trim(),
      employment_type: form.employment_type,
      work_mode: form.work_mode,
      experience_min: numOrNull(form.experience_min),
      experience_max: numOrNull(form.experience_max),
      salary_min: numOrNull(form.salary_min),
      salary_max: numOrNull(form.salary_max),
      show_salary: !!form.show_salary,
      headcount: Number(form.headcount) || 1,
      closing_date: form.closing_date || null,
      description: form.description.trim(),
      requirements: form.requirements.trim(),
      benefits: form.benefits.trim(),
      scorecard_criteria: criteria,
      ...(isAdmin ? { hiring_manager_email: form.hiring_manager_email || null } : {}),
      ...(job && form.slug && form.slug !== job.slug ? { slug: form.slug.trim().toLowerCase() } : {}),
    };
    setSaving(true);
    try {
      const res = job ? await api.put(`${API}/jobs/${job.id}`, body) : await api.post(`${API}/jobs`, body);
      toast.success(job ? 'Job updated' : 'Job created as a draft');
      onSaved?.(res.data);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the job'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{job ? 'Edit job posting' : 'New job posting'}</DialogTitle>
          <DialogDescription>Description supports simple formatting: # headings, - bullet points, **bold** and [links](https://…).</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field id="jb-title" label="Job title *"><Input id="jb-title" value={form.title} onChange={setInput('title')} maxLength={120} /></Field>
          <Field id="jb-dept" label="Department *"><Input id="jb-dept" value={form.department} onChange={setInput('department')} maxLength={80} /></Field>
          <Field id="jb-loc" label="Location *"><Input id="jb-loc" value={form.location} onChange={setInput('location')} maxLength={120} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="jb-type" label="Type"><NativeSelect id="jb-type" value={form.employment_type} onChange={set('employment_type')} options={toOptions(EMPLOYMENT_TYPE_LABELS)} /></Field>
            <Field id="jb-mode" label="Workplace"><NativeSelect id="jb-mode" value={form.work_mode} onChange={set('work_mode')} options={toOptions(WORK_MODE_LABELS)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="jb-exmin" label="Experience min (yrs)"><Input id="jb-exmin" type="number" min={0} max={60} value={form.experience_min ?? ''} onChange={setInput('experience_min')} /></Field>
            <Field id="jb-exmax" label="Experience max (yrs)"><Input id="jb-exmax" type="number" min={0} max={60} value={form.experience_max ?? ''} onChange={setInput('experience_max')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="jb-smin" label="CTC min (₹/yr)"><Input id="jb-smin" type="number" min={0} value={form.salary_min ?? ''} onChange={setInput('salary_min')} /></Field>
            <Field id="jb-smax" label="CTC max (₹/yr)"><Input id="jb-smax" type="number" min={0} value={form.salary_max ?? ''} onChange={setInput('salary_max')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="jb-hc" label="Headcount"><Input id="jb-hc" type="number" min={1} max={500} value={form.headcount} onChange={setInput('headcount')} /></Field>
            <Field id="jb-close" label="Closing date"><Input id="jb-close" type="date" value={form.closing_date || ''} onChange={setInput('closing_date')} /></Field>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch id="jb-show" checked={!!form.show_salary} onCheckedChange={set('show_salary')} />
            <Label htmlFor="jb-show" className="text-sm font-normal">Show salary range on the careers page</Label>
          </div>
          {isAdmin && (
            <Field id="jb-hm" label="Hiring manager">
              <NativeSelect id="jb-hm" value={form.hiring_manager_email} onChange={set('hiring_manager_email')} placeholder="— None —"
                options={managers.map(m => ({ value: m.email, label: `${m.full_name} (${m.department || m.role})` }))} />
            </Field>
          )}
          {job && (
            <Field id="jb-slug" label="URL slug" hint={`/careers/${form.slug || '…'}`}>
              <Input id="jb-slug" value={form.slug} onChange={setInput('slug')} maxLength={80} />
            </Field>
          )}
          <Field id="jb-desc" label="Description" className="sm:col-span-2" hint="At least 30 characters before you can publish.">
            <Textarea id="jb-desc" rows={7} value={form.description} onChange={setInput('description')} maxLength={20000} placeholder={'## About the role\nWhat the person will do…\n- Responsibility one\n- Responsibility two'} />
          </Field>
          <Field id="jb-req" label="Requirements" className="sm:col-span-2">
            <Textarea id="jb-req" rows={4} value={form.requirements} onChange={setInput('requirements')} maxLength={10000} placeholder={'- 3+ years of …\n- Experience with …'} />
          </Field>
          <Field id="jb-ben" label="Benefits" className="sm:col-span-2">
            <Textarea id="jb-ben" rows={3} value={form.benefits} onChange={setInput('benefits')} maxLength={5000} />
          </Field>
          <Field id="jb-crit" label="Scorecard criteria (one per line)" className="sm:col-span-2" hint="Interviewers rate each criterion from 1 to 5.">
            <Textarea id="jb-crit" rows={4} value={form.criteria} onChange={setInput('criteria')} maxLength={900} />
          </Field>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : job ? 'Save changes' : 'Create draft'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
