// Job history timeline (EL-6). `uid` = employee code; omit to show the current user's own history.
import React, { useCallback, useEffect, useState } from 'react';
import { History, Plus, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, fmtDate, fmtMoney, JOB_TYPE_LABELS, todayYmd } from '../lib';
import { Loading, Empty, NativeSelect } from './ui';

const DOT = {
  joined: 'bg-emerald-500', promotion: 'bg-purple-500', increment: 'bg-emerald-500', transfer: 'bg-blue-500',
  confirmation: 'bg-emerald-600', probation_extension: 'bg-amber-500', separation: 'bg-orange-500', exit: 'bg-slate-500',
};

const fmtVal = (c, v) => {
  if (v == null || v === '') return '—';
  if (c.field === 'monthly_salary') return fmtMoney(v);
  return String(v);
};

const JobHistoryTimeline = ({ uid = null, canAdd = false, compact = false }) => {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get(uid ? `${API}/job-history/${encodeURIComponent(uid)}` : `${API}/job-history/my`);
      setEntries(r.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load job history'));
    }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.effective_date) return toast.error('Effective date is required');
    setSaving(true);
    try {
      const changes = form.label.trim() ? [{ label: form.label.trim(), from: form.from || null, to: form.to || null }] : [];
      await api.post(`${API}/job-history`, { employee_uid: uid, type: form.type, title: form.title || null, effective_date: form.effective_date, notes: form.notes || null, changes });
      toast.success('Entry added');
      setForm(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to add entry'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry) => {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await api.delete(`${API}/job-history/${entry.id}`);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to delete'));
    }
  };

  const doExport = () => exportCsv('job-history', entries, [
    { key: 'employee_name', label: 'Employee' },
    { key: 'effective_date', label: 'Effective date' },
    { label: 'Type', value: r => JOB_TYPE_LABELS[r.type] || r.type },
    { key: 'title', label: 'Title' },
    { label: 'Changes', value: r => (r.changes || []).map(c => `${c.label}: ${c.from_display ?? c.from ?? '—'} → ${c.to_display ?? c.to ?? '—'}`).join('; ') },
    { key: 'notes', label: 'Notes' },
    { key: 'source', label: 'Source' },
  ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><History className="w-4 h-4" />Job history</h3>
        <div className="flex gap-2">
          {entries?.length > 0 && <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={doExport}><Download className="w-3.5 h-3.5" />CSV</Button>}
          {canAdd && uid && <Button size="sm" className="h-8 gap-1.5" onClick={() => setForm({ type: 'promotion', title: '', effective_date: todayYmd(), notes: '', label: '', from: '', to: '' })}><Plus className="w-3.5 h-3.5" />Add entry</Button>}
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : !entries ? <Loading /> : entries.length === 0 ? (
        <Empty icon={History} title="No history yet" />
      ) : (
        <ol className={`relative border-l-2 border-slate-200 ml-2 space-y-4 ${compact ? 'max-h-96 overflow-y-auto pr-1' : ''}`}>
          {entries.map(e => (
            <li key={e.id} className="ml-4">
              <span className={`absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full ring-4 ring-white ${DOT[e.type] || 'bg-slate-400'}`} />
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="text-sm font-medium text-slate-900">{e.title || JOB_TYPE_LABELS[e.type]}</p>
                <p className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(e.effective_date)}</p>
              </div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{JOB_TYPE_LABELS[e.type] || e.type}{e.source === 'manual' ? ' · manual' : ''}</p>
              {(e.changes || []).filter(c => c.from != null || c.to != null).map((c, i) => (
                <p key={i} className="text-xs text-slate-600 break-words">
                  {c.label}: <span className="text-slate-400">{c.from_display ?? fmtVal(c, c.from)}</span> → <span className="font-medium text-slate-800">{c.to_display ?? fmtVal(c, c.to)}</span>
                </p>
              ))}
              {e.notes && <p className="text-xs text-slate-500 mt-0.5 break-words">{e.notes}</p>}
              <div className="flex items-center gap-2">
                {e.created_by_name && <p className="text-[11px] text-slate-400">by {e.created_by_name}</p>}
                {canAdd && e.source === 'manual' && (
                  <button type="button" className="text-[11px] text-red-500 hover:underline inline-flex items-center gap-0.5" onClick={() => remove(e)}><Trash2 className="w-3 h-3" />delete</button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          {form && (
            <>
              <DialogHeader><DialogTitle>Add job history entry</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <NativeSelect value={form.type} onChange={(v) => setForm({ ...form, type: v })}>
                      {['promotion', 'transfer', 'increment', 'other'].map(t => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jh-date">Effective date</Label>
                    <Input id="jh-date" type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="jh-title">Title <span className="text-slate-400 font-normal">(optional)</span></Label>
                  <Input id="jh-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Promoted to Team Lead" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input placeholder="What changed" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  <Input placeholder="From" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                  <Input placeholder="To" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="jh-notes">Notes</Label>
                  <Textarea id="jh-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <p className="text-[11px] text-slate-500">This records history only. Use Edit employee to change the current designation, department or salary — those changes are logged automatically.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add entry'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default JobHistoryTimeline;
