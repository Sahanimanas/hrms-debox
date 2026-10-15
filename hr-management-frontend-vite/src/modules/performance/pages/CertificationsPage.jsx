import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BadgeCheck, Plus, Pencil, Trash2, Upload, ExternalLink, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PF, useApi, apiError, currentUser, isLead, fmtDate, CERT_STATUS } from '../lib';
import { PageShell, SectionCard, DataState, Pill, ExportButton, DataTable, SimpleSelect } from '../components/common';

function CertForm({ cert, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: cert?.name || '', issuer: cert?.issuer || '', issued_date: cert?.issued_date || '', expiry_date: cert?.expiry_date || '',
    credential_id: cert?.credential_id || '', credential_url: cert?.credential_url || '',
  }));
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (form.name.trim().length < 2) return toast.error('Certification name is required');
    if (form.issued_date && form.expiry_date && form.expiry_date < form.issued_date) return toast.error('Expiry must be after the issue date');
    const body = { ...form, name: form.name.trim(), issued_date: form.issued_date || null, expiry_date: form.expiry_date || null, credential_url: form.credential_url.trim() || null };
    setSaving(true);
    try {
      const saved = cert ? (await api.put(`${PF}/certifications/${cert.id}`, body)).data : (await api.post(`${PF}/certifications`, body)).data;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`${PF}/certifications/${saved.id}/file`, fd);
      }
      toast.success('Certification saved');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save certification'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>{cert ? 'Edit certification' : 'Add certification'}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="ce-name">Name</Label><Input id="ce-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. AWS Solutions Architect" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label htmlFor="ce-issuer">Issuer</Label><Input id="ce-issuer" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} /></div>
          <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label htmlFor="ce-id">Credential ID</Label><Input id="ce-id" value={form.credential_id} onChange={(e) => setForm({ ...form, credential_id: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="ce-issued">Issued</Label><Input id="ce-issued" type="date" value={form.issued_date} onChange={(e) => setForm({ ...form, issued_date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="ce-exp">Expires</Label><Input id="ce-exp" type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="ce-url">Credential URL</Label><Input id="ce-url" value={form.credential_url} onChange={(e) => setForm({ ...form, credential_url: e.target.value })} placeholder="https://" /></div>
        <div className="space-y-1.5">
          <Label htmlFor="ce-file">Certificate file (PDF or image, max 5 MB)</Label>
          <Input id="ce-file" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {cert?.file && !file && <p className="text-xs text-slate-500">Current: {cert.file.name}</p>}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </>
  );
}

const CertificationsPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const scope = params.get('tab') || 'my';
  const setScope = (t) => setParams(p => { p.set('tab', t); return p; }, { replace: true });
  const [status, setStatus] = useState('any');
  const list = useApi(`${PF}/certifications`, { scope, ...(status !== 'any' ? { status } : {}) });
  const [dialog, setDialog] = useState(null);
  const fileRef = useRef(null);
  const [uploadFor, setUploadFor] = useState(null);
  const rows = list.data || [];

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    try {
      await api.delete(`${PF}/certifications/${c.id}`);
      toast.success('Certification deleted');
      list.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to delete'));
    }
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadFor) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`${PF}/certifications/${uploadFor.id}/file`, fd);
      toast.success('File uploaded');
      list.reload();
    } catch (error) {
      toast.error(apiError(error, 'Upload failed'));
    } finally {
      setUploadFor(null);
    }
  };
  const canEdit = (c) => c.employee_email === user.email || isAdmin;

  return (
    <PageShell
      icon={BadgeCheck}
      title="Certifications"
      subtitle="Professional certifications with expiry tracking"
      actions={(
        <>
          <ExportButton disabled={!rows.length} onClick={() => exportCsv('certifications', rows, [
            { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'name', label: 'Certification' },
            { key: 'issuer', label: 'Issuer' }, { key: 'issued_date', label: 'Issued' }, { key: 'expiry_date', label: 'Expires' },
            { key: 'status', label: 'Status' }, { key: 'credential_id', label: 'Credential ID' }, { key: 'credential_url', label: 'Credential URL' },
          ])} />
          <Button size="sm" onClick={() => setDialog({})}><Plus className="w-4 h-4 mr-1" /> Add certification</Button>
        </>
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {lead ? (
          <Tabs value={scope} onValueChange={setScope}>
            <TabsList>
              <TabsTrigger value="my">Mine</TabsTrigger>
              <TabsTrigger value="team">My team</TabsTrigger>
              {isAdmin && <TabsTrigger value="all">Everyone</TabsTrigger>}
            </TabsList>
          </Tabs>
        ) : <span />}
        <SimpleSelect className="w-40 bg-white" value={status} onChange={setStatus} options={[{ value: 'any', label: 'Any status' }, ...Object.entries(CERT_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
      </div>
      <SectionCard icon={BadgeCheck} title={scope === 'my' ? 'My certifications' : scope === 'team' ? 'Team certifications' : 'All certifications'}>
        <input ref={fileRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
        <DataState state={list} empty={!rows.length} emptyText="No certifications recorded" emptyIcon={BadgeCheck}>
          <DataTable
            rows={rows}
            columns={[
              ...(scope !== 'my' ? [{ key: 'employee_name', label: 'Employee', render: c => <span className="font-medium">{c.employee_name}</span> }] : []),
              { key: 'name', label: 'Certification', render: c => <div><p className="font-medium text-slate-900">{c.name}</p><p className="text-xs text-slate-500">{c.issuer}{c.credential_id ? ` · ${c.credential_id}` : ''}</p></div> },
              { key: 'issued', label: 'Issued', hideOnMobile: true, render: c => fmtDate(c.issued_date) },
              { key: 'expiry', label: 'Expires', render: c => (c.expiry_date ? fmtDate(c.expiry_date) : 'No expiry') },
              { key: 'status', label: 'Status', render: c => <Pill map={CERT_STATUS} value={c.status} /> },
              { key: 'links', label: '', hideOnMobile: true, render: c => (
                <div className="flex gap-2">
                  {c.credential_url && <a href={c.credential_url} target="_blank" rel="noreferrer" title="Verify"><ExternalLink className="w-4 h-4 text-blue-600" /></a>}
                  {c.file && <a href={c.file.url} target="_blank" rel="noreferrer" title={c.file.name}><FileText className="w-4 h-4 text-blue-600" /></a>}
                </div>
              ) },
              { key: 'actions', label: '', className: 'text-right', render: c => canEdit(c) && (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setUploadFor(c); fileRef.current?.click(); }} title="Upload file"><Upload className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ cert: c })}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ) },
            ]}
          />
        </DataState>
      </SectionCard>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          {dialog && <CertForm cert={dialog.cert} onClose={() => setDialog(null)} onSaved={list.reload} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default CertificationsPage;
