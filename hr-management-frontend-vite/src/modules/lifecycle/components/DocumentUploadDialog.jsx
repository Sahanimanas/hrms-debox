// Upload a document into an employee's vault (EL-4).
import React, { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { API, errMsg } from '../lib';
import { NativeSelect } from './ui';
import { employeeLabel } from '@/lib/employeeLabel';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';
const MAX = 10 * 1024 * 1024;

const DocumentUploadDialog = ({ open, onOpenChange, onUploaded, employees = null, defaultEmployeeUid = '' }) => {
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ type: 'id_proof', title: '', expiry_date: '', employee_uid: defaultEmployeeUid });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    api.get(`${API}/documents/types`).then(r => setTypes(r.data || [])).catch(() => {});
  }, [open]);

  const reset = () => {
    setForm({ type: 'id_proof', title: '', expiry_date: '', employee_uid: defaultEmployeeUid });
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX) {
      toast.error('File is larger than 10 MB');
      e.target.value = '';
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!file) return toast.error('Choose a file');
    if (employees && !form.employee_uid) return toast.error('Choose an employee');
    setSaving(true);
    try {
      const data = new FormData();
      data.append('file', file);
      data.append('type', form.type);
      if (form.title.trim()) data.append('title', form.title.trim());
      if (form.expiry_date) data.append('expiry_date', form.expiry_date);
      if (form.employee_uid) data.append('employee_uid', form.employee_uid);
      await api.post(`${API}/documents`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Document uploaded');
      reset();
      onOpenChange(false);
      onUploaded?.();
    } catch (e) {
      toast.error(errMsg(e, 'Upload failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Upload document</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {employees && (
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <NativeSelect value={form.employee_uid} onChange={(v) => setForm({ ...form, employee_uid: v })}>
                <option value="">Select employee…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{employeeLabel(e.full_name, e.employee_id)}</option>)}
              </NativeSelect>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <NativeSelect value={form.type} onChange={(v) => setForm({ ...form, type: v })}>
                {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-exp">Expiry date <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Input id="doc-exp" type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Title <span className="text-slate-400 font-normal">(optional)</span></Label>
            <Input id="doc-title" placeholder="e.g. Passport" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full border-2 border-dashed border-slate-200 rounded-lg p-5 text-center hover:border-slate-400 transition-colors"
          >
            <Upload className="w-6 h-6 mx-auto text-slate-400 mb-1" />
            <p className="text-sm text-slate-700 break-all">{file ? file.name : 'Choose a file'}</p>
            <p className="text-[11px] text-slate-500">PDF, JPG, PNG, WebP, DOC or DOCX · up to 10 MB</p>
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={pick} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DocumentUploadDialog;
