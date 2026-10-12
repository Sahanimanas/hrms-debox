import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Package, Pencil, UserPlus, Undo2, Wrench, FileText, Upload, Trash2, History, AlertTriangle, CheckCircle, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageHeader, Pill, Loading, ErrorState, Field, Empty } from '../components/Shared';
import AssetFormDialog from '../components/AssetFormDialog';
import { STATUS_MAP, ISSUE_STATUS, CONDITIONS, inr, fmtDate, isoDay, humanize, categoryLabel, errorText, getCurrentUser, RECEIPT_ACCEPT, RECEIPT_MAX_BYTES } from '../lib';

const ACTION_LABELS = {
  created: 'Added to register',
  updated: 'Details updated',
  assigned: 'Assigned',
  returned: 'Returned',
  acknowledged: 'Receipt acknowledged',
  issue_reported: 'Issue reported',
  status_changed: 'Status changed',
  invoice_uploaded: 'Invoice uploaded',
  invoice_removed: 'Invoice removed',
};

const describe = (h) => {
  const d = h.details || {};
  switch (h.action) {
    case 'assigned': return `To ${d.employee_name || d.employee_email}${d.condition ? ` · condition ${d.condition}` : ''}${d.notes ? ` · ${d.notes}` : ''}`;
    case 'returned': return `From ${d.employee_name || d.employee_email} · condition ${d.condition}${d.notes ? ` · ${d.notes}` : ''}`;
    case 'status_changed': return `${humanize(d.from)} → ${humanize(d.to)}${d.notes ? ` · ${d.notes}` : ''}`;
    case 'issue_reported': return `${humanize(d.severity)} · ${d.description}`;
    case 'updated': return d.fields?.length ? `Changed ${d.fields.map(humanize).join(', ')}` : '';
    case 'created': return d.source === 'csv_import' ? 'Imported from CSV' : '';
    case 'invoice_uploaded': return d.file || '';
    default: return '';
  }
};

export default function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = getCurrentUser();
  const isAdmin = user?.role === 'admin';
  const [asset, setAsset] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'edit' | 'assign' | 'return' | 'status' | 'issue' | 'delete'

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, c] = await Promise.all([api.get(`/v2/assets/items/${id}`), api.get('/v2/assets/categories')]);
      setAsset(a.data);
      setCategories(c.data);
    } catch (err) {
      setError(errorText(err, 'Failed to load asset'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const acknowledge = async () => {
    try {
      await api.post(`/v2/assets/items/${id}/acknowledge`);
      toast.success('Receipt acknowledged');
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to acknowledge'));
    }
  };

  const uploadInvoice = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > RECEIPT_MAX_BYTES) return toast.error('Invoice must be 10 MB or smaller');
    const form = new FormData();
    form.append('invoice', file);
    try {
      await api.post(`/v2/assets/items/${id}/invoice`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Invoice uploaded');
      load();
    } catch (err) {
      toast.error(errorText(err, 'Upload failed'));
    }
  };

  const removeInvoice = async () => {
    try {
      await api.delete(`/v2/assets/items/${id}/invoice`);
      toast.success('Invoice removed');
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to remove invoice'));
    }
  };

  const updateIssue = async (issueId, status) => {
    try {
      await api.put(`/v2/assets/issues/${issueId}`, { status });
      toast.success(`Issue marked ${humanize(status).toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to update issue'));
    }
  };

  const backHref = isAdmin ? '/assets' : '/my-assets';

  if (loading && !asset) return <div className="p-8"><Loading label="Loading asset…" /></div>;
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <Link to={backHref} className="text-sm text-slate-600 inline-flex items-center gap-1 mb-4"><ArrowLeft className="w-4 h-4" /> Back</Link>
          <Card className="border-0 shadow-md"><ErrorState message={error} onRetry={load} /></Card>
        </div>
      </div>
    );
  }

  const current = asset.assignments?.find(a => a.status === 'active');
  const mine = asset.assigned_to_email === user?.email;
  const openIssues = (asset.issues || []).filter(i => ['open', 'in_repair'].includes(i.status));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <Link to={backHref} className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> {isAdmin ? 'Asset register' : 'My assets'}</Link>
        <PageHeader icon={Package} title={`${asset.asset_tag} · ${asset.name}`} subtitle={`${categoryLabel(categories, asset.category)}${asset.brand ? ` · ${asset.brand}` : ''}${asset.model ? ` ${asset.model}` : ''}`}>
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog('edit')}><Pencil className="w-4 h-4" /> Edit</Button>
              {asset.status === 'available' && <Button size="sm" className="gap-1.5 bg-slate-800 hover:bg-slate-900" onClick={() => setDialog('assign')}><UserPlus className="w-4 h-4" /> Assign</Button>}
              {asset.assigned_to_email && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog('return')}><Undo2 className="w-4 h-4" /> Record return</Button>}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog('status')}><Wrench className="w-4 h-4" /> Status</Button>
            </>
          )}
          {mine && !asset.acknowledged_at && <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={acknowledge}><CheckCircle className="w-4 h-4" /> Acknowledge receipt</Button>}
          {(mine || isAdmin) && asset.assigned_to_email && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog('issue')}><AlertTriangle className="w-4 h-4" /> Report issue</Button>}
        </PageHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card className="border-0 shadow-md lg:col-span-2">
            <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-row items-center justify-between">
              <CardTitle className="text-base sm:text-lg">Details</CardTitle>
              <Pill map={STATUS_MAP} value={asset.status} />
            </CardHeader>
            <CardContent className="p-3 sm:p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="Serial number">{asset.serial_number}</Field>
              <Field label="Condition">{humanize(asset.condition)}</Field>
              <Field label="Location">{asset.location}</Field>
              <Field label="Purchase date">{fmtDate(asset.purchase_date)}</Field>
              <Field label="Warranty expiry">{fmtDate(asset.warranty_expiry)}</Field>
              {isAdmin && <Field label="Cost">{inr(asset.cost)}</Field>}
              {isAdmin && <Field label="Vendor">{asset.vendor}</Field>}
              {isAdmin && (
                <Field label="Invoice">
                  {asset.invoice_url ? (
                    <span className="flex items-center gap-2">
                      <a href={asset.invoice_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> View</a>
                      <button type="button" onClick={removeInvoice} className="text-red-600 text-xs hover:underline">Remove</button>
                    </span>
                  ) : (
                    <label className="text-sky-700 hover:underline cursor-pointer inline-flex items-center gap-1">
                      <Upload className="w-3.5 h-3.5" /> Upload
                      <input type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={uploadInvoice} />
                    </label>
                  )}
                </Field>
              )}
              {isAdmin && asset.notes && <div className="col-span-2 md:col-span-3"><Field label="Notes">{asset.notes}</Field></div>}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardHeader className="border-b border-slate-100 p-3 sm:p-5"><CardTitle className="text-base sm:text-lg">Current holder</CardTitle></CardHeader>
            <CardContent className="p-3 sm:p-5 space-y-3">
              {asset.assigned_to_email ? (
                <>
                  <Field label="Employee">{asset.assigned_to_name}<p className="text-xs text-slate-500">{asset.assigned_to_email}</p></Field>
                  <Field label="Since">{fmtDate(asset.assigned_at)}</Field>
                  <Field label="Expected return">{fmtDate(asset.expected_return_date)}</Field>
                  <Field label="Acknowledged">{asset.acknowledged_at ? fmtDate(asset.acknowledged_at, 'dd MMM yyyy, HH:mm') : <span className="text-amber-600">Not yet</span>}</Field>
                  {current?.handover_notes && <Field label="Handover notes">{current.handover_notes}</Field>}
                </>
              ) : <p className="text-sm text-slate-500">Not assigned to anyone.</p>}
            </CardContent>
          </Card>
        </div>

        {(asset.issues?.length > 0) && (
          <Card className="border-0 shadow-md">
            <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-slate-600" /> Issues {openIssues.length > 0 && <span className="text-xs text-amber-600 font-normal">{openIssues.length} open</span>}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-100">
              {asset.issues.map(i => (
                <div key={i.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill map={ISSUE_STATUS} value={i.status} />
                      <span className="text-xs text-slate-500">{humanize(i.severity)} · {i.reported_by_name} · {fmtDate(i.created_at)}</span>
                    </div>
                    <p className="text-sm text-slate-800 mt-1 break-words">{i.description}</p>
                    {i.resolution_notes && <p className="text-xs text-slate-500 italic mt-0.5">{i.resolution_notes}</p>}
                  </div>
                  {isAdmin && ['open', 'in_repair'].includes(i.status) && (
                    <div className="flex gap-2 shrink-0">
                      {i.status === 'open' && <Button size="sm" variant="outline" onClick={() => updateIssue(i.id, 'in_repair')}>Send to repair</Button>}
                      <Button size="sm" variant="outline" onClick={() => updateIssue(i.id, 'resolved')}>Resolve</Button>
                      {i.status === 'open' && <Button size="sm" variant="ghost" onClick={() => updateIssue(i.id, 'closed')}>Close</Button>}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-row items-center justify-between">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2"><UserPlus className="w-4 h-4 text-slate-600" /> Assignment history</CardTitle>
            {asset.assignments?.length > 0 && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => exportCsv(`asset-${asset.asset_tag}-assignments`, asset.assignments, [
                { key: 'employee_name', label: 'Employee' }, { key: 'employee_email', label: 'Email' },
                { label: 'Assigned', value: r => isoDay(r.assigned_at) }, { label: 'Expected return', value: r => isoDay(r.expected_return_date) },
                { key: 'condition_at_handover', label: 'Condition at handover' }, { label: 'Acknowledged', value: r => isoDay(r.acknowledged_at) },
                { label: 'Returned', value: r => isoDay(r.returned_at) }, { key: 'return_condition', label: 'Return condition' },
                { key: 'return_notes', label: 'Return notes' }, { key: 'status', label: 'Status' },
              ])}><Download className="w-3.5 h-3.5" /> CSV</Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {!asset.assignments?.length ? <Empty title="Never assigned" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Employee</th>
                      <th className="text-left font-medium px-4 py-3">Assigned</th>
                      <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Handover</th>
                      <th className="text-left font-medium px-4 py-3">Returned</th>
                      <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Return notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {asset.assignments.map(a => (
                      <tr key={a.id}>
                        <td className="px-4 py-3"><p className="text-slate-900">{a.employee_name}</p><p className="text-xs text-slate-500">{a.department || a.employee_email}</p></td>
                        <td className="px-4 py-3 whitespace-nowrap">{fmtDate(a.assigned_at)}{a.acknowledged_at && <p className="text-[11px] text-emerald-600">Acknowledged</p>}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">{humanize(a.condition_at_handover)}{a.handover_notes && <p className="text-xs text-slate-500">{a.handover_notes}</p>}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {a.status === 'active' ? <span className="text-sky-700">With employee</span> : a.status === 'lost' ? <span className="text-red-600">Lost</span> : <>{fmtDate(a.returned_at)}<p className="text-[11px] text-slate-500">{humanize(a.return_condition)}</p></>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-slate-600">{a.return_notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="border-0 shadow-md">
            <CardHeader className="border-b border-slate-100 p-3 sm:p-5"><CardTitle className="text-base sm:text-lg flex items-center gap-2"><History className="w-4 h-4 text-slate-600" /> Activity</CardTitle></CardHeader>
            <CardContent className="p-3 sm:p-5">
              {!asset.history?.length ? <p className="text-sm text-slate-500">No activity yet.</p> : (
                <ol className="relative border-l border-slate-200 ml-2 space-y-4">
                  {asset.history.map(h => (
                    <li key={h.id} className="ml-4">
                      <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-slate-300 border-2 border-white"></span>
                      <p className="text-sm font-medium text-slate-900">{ACTION_LABELS[h.action] || humanize(h.action)}</p>
                      {describe(h) && <p className="text-xs text-slate-600 break-words">{describe(h)}</p>}
                      <p className="text-[11px] text-slate-400">{fmtDate(h.at, 'dd MMM yyyy, HH:mm')} · {h.actor_name}</p>
                    </li>
                  ))}
                </ol>
              )}
              {!asset.assigned_to_email && (
                <div className="mt-6 pt-4 border-t border-slate-100">
                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1" onClick={() => setDialog('delete')}><Trash2 className="w-4 h-4" /> Delete asset</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {dialog === 'edit' && <AssetFormDialog open onOpenChange={() => setDialog(null)} asset={asset} categories={categories} onSaved={load} />}
      {dialog === 'assign' && <AssignDialog asset={asset} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === 'return' && <ReturnDialog asset={asset} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === 'status' && <StatusDialog asset={asset} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === 'issue' && <IssueDialog asset={asset} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === 'delete' && (
        <ConfirmDelete asset={asset} onClose={() => setDialog(null)} onDeleted={() => navigate('/assets')} />
      )}
    </div>
  );
}

export function AssignDialog({ asset, onClose, onDone, requestId, defaultEmployee }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee: defaultEmployee || '', expected_return_date: '', condition: asset?.condition || 'good', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (defaultEmployee) return;
    api.get('/employees').then(r => setEmployees((r.data || []).filter(e => e.employment_status !== 'exited'))).catch(() => toast.error('Failed to load employees'));
  }, [defaultEmployee]);

  const submit = async () => {
    if (!form.employee) return toast.error('Choose an employee');
    setSaving(true);
    try {
      const body = { expected_return_date: form.expected_return_date || null, condition: form.condition, notes: form.notes };
      if (requestId) await api.post(`/v2/assets/requests/${requestId}/fulfil`, { ...body, asset_id: asset.id });
      else await api.post(`/v2/assets/items/${asset.id}/assign`, { ...body, employee: form.employee });
      toast.success('Asset assigned');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to assign'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign {asset.asset_tag}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!defaultEmployee && (
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={form.employee} onValueChange={(v) => setForm({ ...form, employee: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map(e => <SelectItem key={e.email} value={e.email}>{e.full_name} · {e.department || e.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-return">Expected return</Label>
              <Input id="as-return" type="date" min={isoDay(new Date())} value={form.expected_return_date} onChange={(e) => setForm({ ...form, expected_return_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Condition at handover</Label>
              <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONDITIONS.map(c => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-notes">Handover notes</Label>
            <Textarea id="as-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. With charger and sleeve" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Assigning…' : 'Assign'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({ asset, onClose, onDone }) {
  const [form, setForm] = useState({ condition: asset.condition || 'good', notes: '' });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await api.post(`/v2/assets/items/${asset.id}/return`, form);
      toast.success('Return recorded');
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to record return'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Return {asset.asset_tag} from {asset.assigned_to_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Condition on return</Label>
            <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONDITIONS.map(c => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-notes">Notes</Label>
            <Textarea id="rt-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Scratch on lid" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Record return'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ asset, onClose, onDone }) {
  const options = [
    { value: 'in_repair', label: 'Send to repair', ok: ['available', 'assigned'].includes(asset.status) },
    { value: 'available', label: asset.assigned_to_email ? 'Back from repair (to assignee)' : 'Back in service (available)', ok: ['in_repair', 'retired', 'lost'].includes(asset.status) },
    { value: 'retired', label: 'Retire', ok: !asset.assigned_to_email && asset.status !== 'retired' },
    { value: 'lost', label: 'Mark lost', ok: asset.status !== 'lost' },
  ].filter(o => o.ok);
  const [status, setStatus] = useState(options[0]?.value || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await api.post(`/v2/assets/items/${asset.id}/status`, { status, notes });
      toast.success('Status updated');
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to update status'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Change status of {asset.asset_tag}</DialogTitle></DialogHeader>
        {options.length === 0 ? <p className="text-sm text-slate-600">No status changes are available right now.</p> : (
          <div className="space-y-3">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            {status === 'lost' && asset.assigned_to_email && <p className="text-xs text-amber-700">This closes {asset.assigned_to_name}’s assignment.</p>}
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !status} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Update'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IssueDialog({ asset, onClose, onDone }) {
  const [form, setForm] = useState({ description: '', severity: 'medium' });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (form.description.trim().length < 5) return toast.error('Describe the problem (at least 5 characters)');
    setSaving(true);
    try {
      await api.post(`/v2/assets/items/${asset.id}/issues`, { description: form.description.trim(), severity: form.severity });
      toast.success('Issue reported — the admin team has been notified');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to report issue'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Report an issue with {asset.asset_tag}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Severity</Label>
            <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low — minor, still usable</SelectItem>
                <SelectItem value="medium">Medium — affects my work</SelectItem>
                <SelectItem value="high">High — unusable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="is-desc">What’s wrong?</Label>
            <Textarea id="is-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Battery drains in under an hour" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Sending…' : 'Report issue'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDelete({ asset, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/v2/assets/items/${asset.id}`);
      toast.success('Asset deleted');
      onDeleted();
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-red-600">Delete {asset.asset_tag}?</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">This permanently removes the asset. Assets that were ever assigned can’t be deleted — retire them instead.</p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={remove} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white">{busy ? 'Deleting…' : 'Delete'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
