// Personal details + profile change requests (EL-8), shown on the Profile page.
import React, { useCallback, useEffect, useState } from 'react';
import { IdCard, PencilLine, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import PhoneInput from '@/components/PhoneInput';
import { phoneError } from '@/lib/phone';
import { API, errMsg, fmtDate, humanize, REQUEST_STATUS, todayYmd } from '../lib';
import { SectionCard, Loading, StatusPill, NativeSelect } from './ui';

const display = (field, value) => {
  if (value == null || value === '') return '—';
  if (field.type === 'date') return fmtDate(value);
  if (field.type === 'select' && field.key !== 'blood_group') return humanize(value);
  return value;
};

const PersonalDetailsCard = () => {
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState(null);
  const [requests, setRequests] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, v, r] = await Promise.all([
        api.get(`${API}/profile-requests/fields`),
        api.get(`${API}/personal/my`),
        api.get(`${API}/profile-requests/my`),
      ]);
      setFields(f.data || []);
      setValues(v.data || {});
      setRequests(r.data || []);
    } catch {
      setUnavailable(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pending = requests.find(r => r.status === 'pending');

  const openForm = () => {
    setForm(Object.fromEntries(fields.map(f => [f.key, values?.[f.key] ?? ''])));
    setReason('');
    setOpen(true);
  };

  const submit = async () => {
    const changes = {};
    for (const f of fields) {
      const next = (form[f.key] ?? '').toString().trim();
      const prev = (values?.[f.key] ?? '').toString();
      if (next && next !== prev) changes[f.key] = next;
    }
    if (!Object.keys(changes).length) return toast.error('Change at least one field');
    const badPhone = fields.find(f => f.type === 'phone' && changes[f.key] && phoneError(changes[f.key]));
    if (badPhone) return toast.error(`${badPhone.label}: ${phoneError(changes[badPhone.key])}`);
    setSaving(true);
    try {
      await api.post(`${API}/profile-requests`, { changes, reason: reason.trim() || null });
      toast.success('Change request sent to HR');
      setOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to submit'));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id) => {
    try {
      await api.delete(`${API}/profile-requests/${id}`);
      toast.success('Request cancelled');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to cancel'));
    }
  };

  if (unavailable) return null;

  return (
    <SectionCard
      icon={IdCard}
      title="Personal details"
      actions={values && !pending && (
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={openForm}><PencilLine className="w-3.5 h-3.5" />Request change</Button>
      )}
    >
      {!values ? <Loading /> : (
        <div className="p-3 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {fields.map(f => (
              <div key={f.key} className={f.key === 'address' ? 'sm:col-span-2' : ''}>
                <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider">{f.label}</p>
                <p className="text-sm text-slate-900 break-words whitespace-pre-wrap">{display(f, values[f.key])}</p>
              </div>
            ))}
          </div>
          {pending && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>Change request pending HR approval: {pending.changes.map(c => c.label).join(', ')}</span>
              <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:bg-red-50 gap-1 self-start" onClick={() => cancel(pending.id)}><Trash2 className="w-3 h-3" />Cancel</Button>
            </div>
          )}
          {requests.filter(r => r.status !== 'pending').slice(0, 3).map(r => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <StatusPill map={REQUEST_STATUS} status={r.status} />
              <span>{r.changes.map(c => c.label).join(', ')} · {fmtDate(r.created_at)}</span>
              {r.rejection_reason && <span className="text-red-600">— {r.rejection_reason}</span>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Request a change to your details</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500 -mt-2">HR reviews the request before your profile is updated. Only changed fields are sent.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map(f => (
              <div key={f.key} className={`space-y-1.5 ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
                <Label htmlFor={`pf-${f.key}`} className="flex items-center gap-1.5">
                  {f.label}
                  {(form[f.key] ?? '') !== (values?.[f.key] ?? '') && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[9px] px-1 py-0">changed</Badge>}
                </Label>
                {f.type === 'select' ? (
                  <NativeSelect id={`pf-${f.key}`} value={form[f.key] ?? ''} onChange={(v) => setForm({ ...form, [f.key]: v })}>
                    <option value="">—</option>
                    {f.options.map(o => <option key={o} value={o}>{f.key === 'blood_group' ? o : humanize(o)}</option>)}
                  </NativeSelect>
                ) : f.type === 'phone' ? (
                  <PhoneInput id={`pf-${f.key}`} value={form[f.key] ?? ''} onChange={(v) => setForm({ ...form, [f.key]: v })} />
                ) : f.type === 'textarea' ? (
                  <Textarea id={`pf-${f.key}`} rows={2} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                ) : (
                  <Input
                    id={`pf-${f.key}`}
                    type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                    max={f.type === 'date' ? todayYmd() : undefined}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pf-reason">Reason <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Input id="pf-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moved to a new address" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Sending…' : 'Send for approval'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
};

export default PersonalDetailsCard;
