import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, Download, Check, X, Pencil, Ban, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, LoadingState, EmptyState, ErrorState, StatusBadge, TableCard } from '../components/Common';
import { Field, NativeSelect } from '../components/FormBits';
import { API, EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS, currentUser, errorMessage, experienceText, fmtDate, fmtInr, label, toOptions } from '../lib';

const EMPTY = {
  title: '', department: '', headcount: 1, employment_type: 'full_time', location: '', work_mode: 'onsite',
  experience_min: '', experience_max: '', budget_min: '', budget_max: '', justification: '', target_start_date: '', hiring_manager_email: '',
};
const STATUS_TABS = ['all', 'pending', 'approved', 'rejected', 'filled', 'cancelled'];

export default function RequisitionsPage() {
  const user = currentUser();
  const isAdmin = user.role === 'admin';
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('all');
  const [editing, setEditing] = useState(null); // null | 'new' | requisition
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState(null); // { req, type: 'approve'|'reject' }
  const [note, setNote] = useState('');
  const [managers, setManagers] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`${API}/requisitions`);
      setList(res.data || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    api.get(`${API}/people`, { params: { role: 'manager' } }).then(r => setManagers(r.data || [])).catch(() => {});
  }, [isAdmin]);

  const visible = useMemo(() => (tab === 'all' ? list : list.filter(r => r.status === tab)), [list, tab]);
  const counts = useMemo(() => Object.fromEntries(STATUS_TABS.map(s => [s, s === 'all' ? list.length : list.filter(r => r.status === s).length])), [list]);

  const openNew = () => { setForm(EMPTY); setEditing('new'); };
  const openEdit = (r) => {
    setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, r[k] ?? ''])) });
    setEditing(r);
  };
  const set = (key) => (value) => setForm(f => ({ ...f, [key]: value }));
  const setInput = (key) => (e) => set(key)(e.target.value);

  const save = async () => {
    const required = ['title', 'department', 'location', 'justification', 'experience_min', 'experience_max', 'budget_min', 'budget_max'];
    const missing = required.filter(k => String(form[k]).trim() === '');
    if (missing.length) return toast.error('Please fill in all required fields');
    if (Number(form.experience_min) > Number(form.experience_max)) return toast.error('Minimum experience cannot exceed maximum');
    if (Number(form.budget_min) > Number(form.budget_max)) return toast.error('Minimum budget cannot exceed maximum');
    if (form.justification.trim().length < 10) return toast.error('Justification should be at least 10 characters');

    const body = {
      title: form.title.trim(),
      department: form.department.trim(),
      headcount: Number(form.headcount) || 1,
      employment_type: form.employment_type,
      location: form.location.trim(),
      work_mode: form.work_mode,
      experience_min: Number(form.experience_min),
      experience_max: Number(form.experience_max),
      budget_min: Number(form.budget_min),
      budget_max: Number(form.budget_max),
      justification: form.justification.trim(),
      target_start_date: form.target_start_date || null,
      ...(isAdmin ? { hiring_manager_email: form.hiring_manager_email || null } : {}),
    };
    setSaving(true);
    try {
      if (editing === 'new') await api.post(`${API}/requisitions`, body);
      else await api.put(`${API}/requisitions/${editing.id}`, body);
      toast.success(editing === 'new' ? 'Requisition submitted for approval' : 'Requisition updated');
      setEditing(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the requisition'));
    } finally {
      setSaving(false);
    }
  };

  const decide = async () => {
    if (decision.type === 'reject' && note.trim().length < 3) return toast.error('Please give a reason');
    setSaving(true);
    try {
      const res = await api.post(`${API}/requisitions/${decision.req.id}/${decision.type}`, { note: note.trim() });
      toast.success(decision.type === 'approve' ? 'Approved — a draft job posting was created' : 'Requisition rejected');
      if (decision.type === 'approve' && res.data?.job?.id) toast.message('Open Jobs to complete and publish the posting');
      setDecision(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (r) => {
    if (!window.confirm(`Cancel the requisition for ${r.title}?`)) return;
    try {
      await api.post(`${API}/requisitions/${r.id}/cancel`);
      toast.success('Requisition cancelled');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doExport = () => exportCsv('requisitions', visible, [
    { key: 'title', label: 'Title' },
    { key: 'department', label: 'Department' },
    { key: 'headcount', label: 'Headcount' },
    { label: 'Type', value: r => label(EMPLOYMENT_TYPE_LABELS, r.employment_type) },
    { key: 'location', label: 'Location' },
    { label: 'Workplace', value: r => label(WORK_MODE_LABELS, r.work_mode) },
    { key: 'experience_min', label: 'Min experience (yrs)' },
    { key: 'experience_max', label: 'Max experience (yrs)' },
    { key: 'budget_min', label: 'Budget min (INR)' },
    { key: 'budget_max', label: 'Budget max (INR)' },
    { key: 'status', label: 'Status' },
    { key: 'requested_by_name', label: 'Requested by' },
    { key: 'hiring_manager_name', label: 'Hiring manager' },
    { label: 'Requested on', value: r => fmtDate(r.created_at, 'yyyy-MM-dd') },
    { key: 'decision_note', label: 'Decision note' },
    { key: 'justification', label: 'Justification' },
  ]);

  return (
    <PageShell>
      <PageHeader icon={ClipboardList} title="Job Requisitions" subtitle={isAdmin ? 'Approve new headcount before roles are posted' : 'Request new headcount for your team'}>
        <Button variant="outline" onClick={doExport} disabled={!visible.length} className="gap-2 h-9 sm:h-10 flex-1 sm:flex-none">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
        <Button onClick={openNew} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 sm:h-10 flex-1 sm:flex-none">
          <Plus className="w-4 h-4" /> New requisition
        </Button>
      </PageHeader>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filter by status">
        {STATUS_TABS.map(s => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={`px-3 py-1.5 rounded-full text-xs sm:text-sm whitespace-nowrap border transition ${tab === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
          >
            <span className="capitalize">{s}</span> <span className="opacity-70">({counts[s]})</span>
          </button>
        ))}
      </div>

      <TableCard>
        {loading ? <LoadingState /> : error ? <ErrorState onRetry={load} /> : visible.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No requisitions" hint="Raise a requisition to request a new role." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Role</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Experience / budget</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Requested</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{r.title} <span className="text-slate-500 font-normal">× {r.headcount}</span></p>
                      <p className="text-xs text-slate-500">{r.department} · {r.location} · {label(EMPLOYMENT_TYPE_LABELS, r.employment_type)}</p>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 max-w-md">{r.justification}</p>
                      {r.decision_note && <p className="text-xs mt-1 text-slate-600"><span className="font-medium">Note:</span> {r.decision_note}</p>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap text-slate-600">
                      <p>{experienceText(r.experience_min, r.experience_max) || '—'}</p>
                      <p className="text-xs">{fmtInr(r.budget_min)} – {fmtInr(r.budget_max)}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell whitespace-nowrap text-slate-600">
                      <p>{r.requested_by_name}</p>
                      <p className="text-xs">{fmtDate(r.created_at)}</p>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {isAdmin && r.status === 'pending' && (
                          <>
                            <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setNote(''); setDecision({ req: r, type: 'approve' }); }}>
                              <Check className="w-3.5 h-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 gap-1 text-red-600" onClick={() => { setNote(''); setDecision({ req: r, type: 'reject' }); }}>
                              <X className="w-3.5 h-3.5" /> Reject
                            </Button>
                          </>
                        )}
                        {r.status === 'pending' && (isAdmin || r.requested_by_email === user.email) && (
                          <>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)} aria-label="Edit"><Pencil className="w-4 h-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => cancel(r)} aria-label="Cancel requisition"><Ban className="w-4 h-4" /></Button>
                          </>
                        )}
                        {r.job_id && (
                          <Button asChild size="sm" variant="ghost" className="h-8 gap-1">
                            <Link to={`/recruitment/jobs/${r.job_id}`}><ExternalLink className="w-3.5 h-3.5" /> Job</Link>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New job requisition' : 'Edit requisition'}</DialogTitle>
            <DialogDescription>Admins review requisitions; approved ones become draft job postings.</DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field id="rq-title" label="Job title *"><Input id="rq-title" value={form.title} onChange={setInput('title')} maxLength={120} /></Field>
            <Field id="rq-dept" label="Department *"><Input id="rq-dept" value={form.department} onChange={setInput('department')} maxLength={80} /></Field>
            <Field id="rq-hc" label="Headcount *"><Input id="rq-hc" type="number" min={1} max={500} value={form.headcount} onChange={setInput('headcount')} /></Field>
            <Field id="rq-type" label="Employment type *"><NativeSelect id="rq-type" value={form.employment_type} onChange={set('employment_type')} options={toOptions(EMPLOYMENT_TYPE_LABELS)} /></Field>
            <Field id="rq-loc" label="Location *"><Input id="rq-loc" value={form.location} onChange={setInput('location')} maxLength={120} /></Field>
            <Field id="rq-mode" label="Workplace"><NativeSelect id="rq-mode" value={form.work_mode} onChange={set('work_mode')} options={toOptions(WORK_MODE_LABELS)} /></Field>
            <Field id="rq-exmin" label="Experience min (years) *"><Input id="rq-exmin" type="number" min={0} max={60} value={form.experience_min} onChange={setInput('experience_min')} /></Field>
            <Field id="rq-exmax" label="Experience max (years) *"><Input id="rq-exmax" type="number" min={0} max={60} value={form.experience_max} onChange={setInput('experience_max')} /></Field>
            <Field id="rq-bmin" label="Budget / CTC min (₹ per year) *"><Input id="rq-bmin" type="number" min={0} value={form.budget_min} onChange={setInput('budget_min')} /></Field>
            <Field id="rq-bmax" label="Budget / CTC max (₹ per year) *"><Input id="rq-bmax" type="number" min={0} value={form.budget_max} onChange={setInput('budget_max')} /></Field>
            <Field id="rq-start" label="Target start date"><Input id="rq-start" type="date" value={form.target_start_date || ''} onChange={setInput('target_start_date')} /></Field>
            {isAdmin && (
              <Field id="rq-hm" label="Hiring manager">
                <NativeSelect id="rq-hm" value={form.hiring_manager_email || ''} onChange={set('hiring_manager_email')} placeholder="— None —"
                  options={managers.map(m => ({ value: m.email, label: `${m.full_name} (${m.department || m.role})` }))} />
              </Field>
            )}
            <Field id="rq-just" label="Justification *" className="sm:col-span-2">
              <Textarea id="rq-just" rows={3} value={form.justification} onChange={setInput('justification')} maxLength={3000} placeholder="Why is this role needed now?" />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : editing === 'new' ? 'Submit for approval' : 'Save changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.type === 'approve' ? 'Approve requisition' : 'Reject requisition'}</DialogTitle>
            <DialogDescription>{decision?.req.title} × {decision?.req.headcount} · {decision?.req.department}</DialogDescription>
          </DialogHeader>
          <Field id="rq-note" label={decision?.type === 'approve' ? 'Note (optional)' : 'Reason *'}>
            <Textarea id="rq-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
          {decision?.type === 'approve' && <p className="text-xs text-slate-500">A draft job posting will be created for the hiring manager to complete and publish.</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button onClick={decide} disabled={saving} className={decision?.type === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}>
              {saving ? 'Saving…' : decision?.type === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
