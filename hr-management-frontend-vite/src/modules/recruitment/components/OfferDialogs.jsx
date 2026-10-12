import React, { useEffect, useState } from 'react';
import { Copy, KeyRound, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Field, NativeSelect } from './FormBits';
import { API, errorMessage, fmtInr, todayIso } from '../lib';

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Create (candidate given) or edit a draft offer. */
export function OfferDialog({ open, candidate, job, offer, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(offer ? {
      designation: offer.designation, department: offer.department, ctc: offer.ctc,
      joining_date: offer.joining_date, expiry_date: offer.expiry_date, notes: offer.notes || '',
    } : {
      designation: job?.title || candidate?.job_title || '', department: job?.department || candidate?.department || '',
      ctc: '', joining_date: addDays(30), expiry_date: addDays(7), notes: '',
    });
  }, [open, offer, job, candidate]);

  const setInput = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    if (!form.designation?.trim() || !form.department?.trim()) return toast.error('Designation and department are required');
    if (!(Number(form.ctc) > 0)) return toast.error('Enter the annual CTC');
    if (!form.joining_date || !form.expiry_date) return toast.error('Pick the joining and expiry dates');
    if (form.expiry_date < todayIso()) return toast.error('Expiry date cannot be in the past');
    const body = { ...form, designation: form.designation.trim(), department: form.department.trim(), ctc: Number(form.ctc), notes: (form.notes || '').trim() };
    setSaving(true);
    try {
      const res = offer ? await api.put(`${API}/offers/${offer.id}`, body) : await api.post(`${API}/candidates/${candidate.id}/offers`, body);
      toast.success(offer ? 'Offer updated' : 'Draft offer created');
      onSaved?.(res.data);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the offer'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{offer ? 'Edit offer' : 'Create offer'}</DialogTitle>
          <DialogDescription>{offer?.candidate_name || candidate?.name} · saved as a draft until you send it.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field id="of-des" label="Designation *"><Input id="of-des" value={form.designation || ''} onChange={setInput('designation')} maxLength={100} /></Field>
          <Field id="of-dep" label="Department *"><Input id="of-dep" value={form.department || ''} onChange={setInput('department')} maxLength={80} /></Field>
          <Field id="of-ctc" label="Annual CTC (₹) *" hint={Number(form.ctc) > 0 ? `${fmtInr(form.ctc)} · ~${fmtInr(Math.round(form.ctc / 12))}/month` : undefined} className="sm:col-span-2">
            <Input id="of-ctc" type="number" min={1} value={form.ctc ?? ''} onChange={setInput('ctc')} />
          </Field>
          <Field id="of-join" label="Joining date *"><Input id="of-join" type="date" min={todayIso()} value={form.joining_date || ''} onChange={setInput('joining_date')} /></Field>
          <Field id="of-exp" label="Offer valid until *"><Input id="of-exp" type="date" min={todayIso()} value={form.expiry_date || ''} onChange={setInput('expiry_date')} /></Field>
          <Field id="of-notes" label="Additional terms / notes" className="sm:col-span-2" hint="Printed on the offer letter.">
            <Textarea id="of-notes" rows={3} value={form.notes || ''} onChange={setInput('notes')} maxLength={3000} />
          </Field>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : offer ? 'Save' : 'Create draft'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Record the candidate's answer to a sent offer. */
export function RespondDialog({ offer, onClose, onSaved }) {
  const [response, setResponse] = useState('accepted');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (offer) { setResponse('accepted'); setNote(''); } }, [offer]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`${API}/offers/${offer.id}/respond`, { response, note: note.trim() });
      toast.success(response === 'accepted' ? 'Offer accepted' : 'Offer marked as declined');
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!offer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record candidate response</DialogTitle>
          <DialogDescription>{offer?.candidate_name} · {offer?.designation}</DialogDescription>
        </DialogHeader>
        <Field id="rs-resp" label="Response">
          <NativeSelect id="rs-resp" value={response} onChange={setResponse} options={[{ value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }]} />
        </Field>
        <Field id="rs-note" label="Note"><Textarea id="rs-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={response === 'declined' ? 'e.g. accepted a counter offer' : ''} /></Field>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One-click conversion of an accepted offer into an employee; shows the temp password once. */
export function ConvertDialog({ offer, candidateEmail, onClose, onDone }) {
  const [form, setForm] = useState({ email: '', role: 'employee' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (offer) {
      setForm({ email: candidateEmail || offer.candidate_email, role: 'employee' });
      setResult(null);
    }
  }, [offer, candidateEmail]);

  const convert = async () => {
    setSaving(true);
    try {
      const body = { role: form.role };
      if (form.email.trim() && form.email.trim() !== offer.candidate_email) body.email = form.email.trim();
      const res = await api.post(`${API}/offers/${offer.id}/convert`, body);
      setResult(res.data);
      onDone?.(res.data);
    } catch (e) {
      toast.error(errorMessage(e, 'Conversion failed'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${result.employee.email}\nTemporary password: ${result.temporary_password}`);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed — select the text manually');
    }
  };

  return (
    <Dialog open={!!offer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Employee created</DialogTitle>
              <DialogDescription>{result.employee.full_name} · {result.employee.employee_id} · {result.employee.designation}</DialogDescription>
            </DialogHeader>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
              <p className="text-xs text-amber-800 flex items-center gap-1 font-medium"><KeyRound className="w-3.5 h-3.5" /> Shown only once — share it securely.</p>
              <div className="text-sm font-mono break-all select-all text-slate-900">
                <p>{result.employee.email}</p>
                <p>{result.temporary_password}</p>
              </div>
              <Button size="sm" variant="outline" onClick={copy} className="gap-1 h-8"><Copy className="w-3.5 h-3.5" /> Copy credentials</Button>
            </div>
            {result.job_closed && <p className="text-xs text-slate-600">Headcount filled — the job posting was closed automatically.</p>}
            <DialogFooter><Button onClick={onClose} className="bg-slate-800 hover:bg-slate-900">Done</Button></DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Convert to employee</DialogTitle>
              <DialogDescription>
                Creates {offer?.candidate_name}'s employee record ({offer?.designation}, {offer?.department}, joining {offer?.joining_date}) with the standard onboarding defaults and marks the candidate hired.
              </DialogDescription>
            </DialogHeader>
            <Field id="cv-email" label="Login email" hint="Use a company email if you issue one; defaults to the candidate's email.">
              <Input id="cv-email" type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field id="cv-role" label="Role">
              <NativeSelect id="cv-role" value={form.role} onChange={(role) => setForm(f => ({ ...f, role }))} options={[{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }]} />
            </Field>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={convert} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">{saving ? 'Creating…' : 'Create employee'}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
