import React, { useEffect, useState } from 'react';
import { Receipt, Upload, X, Image, FileText, Pencil, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';
import PolicyCheckPanel from './PolicyCheckPanel';
import ReceiptScanButton from './ReceiptScanButton';
import usePolicyCheck from '../usePolicyCheck';
import { RECEIPT_ACCEPT, RECEIPT_MAX_BYTES, errorText } from '../lib';

const NO_TRIP = 'none';

const initialForm = (claim) => ({
  title: claim?.title || '',
  category: claim?.category || '',
  amount: claim?.amount != null ? String(claim.amount) : '',
  description: claim?.description || '',
  expense_date: claim?.expense_date ? format(new Date(claim.expense_date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
  trip_id: claim?.trip_id || NO_TRIP,
});

/**
 * Apply for / edit a reimbursement claim with receipt upload (image or PDF ≤ 10 MB),
 * receipt scanning, trip linking and a live expense-policy check.
 * Mount with a `key` per claim so the form resets.
 */
export default function ClaimDialog({ open, onOpenChange, claim, categories, trips, onSaved }) {
  const editing = !!claim?.id;
  const [form, setForm] = useState(() => initialForm(claim));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverCheck, setServerCheck] = useState(null);

  const hasReceipt = !!file || (!!claim?.bill_url && !removeExisting);
  const { check, loading: checking } = usePolicyCheck({
    category: form.category,
    amount: form.amount,
    expenseDate: form.expense_date,
    hasReceipt,
    reimbursementId: claim?.id,
    enabled: open,
  });
  const shownCheck = check || serverCheck;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const set = (k) => (e) => {
    setServerCheck(null);
    setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > RECEIPT_MAX_BYTES) {
      toast.error('Receipt must be 10 MB or smaller');
      return;
    }
    if (!RECEIPT_ACCEPT.split(',').includes(f.type)) {
      toast.error('Only images (JPG, PNG, GIF, WEBP) or PDF receipts are allowed');
      return;
    }
    setFile(f);
    setRemoveExisting(false);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };

  const clearFile = () => {
    setFile(null);
    setPreview(null);
  };

  const applyScan = (data) => {
    setServerCheck(null);
    setForm(f => ({
      ...f,
      amount: data.amount != null ? String(data.amount) : f.amount,
      expense_date: data.date || f.expense_date,
      category: data.suggested_category && categories.includes(data.suggested_category) ? data.suggested_category : f.category,
      title: f.title.trim() ? f.title : (data.vendor ? `${data.vendor}${data.suggested_category ? ` – ${data.suggested_category}` : ''}` : f.title),
    }));
  };

  const submit = async () => {
    if (!form.title.trim()) return toast.error('Please enter a title');
    if (!form.category) return toast.error('Please select a category');
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Please enter a valid amount');
    if (shownCheck?.status === 'blocked') return toast.error('This claim is outside the expense policy');

    setSaving(true);
    try {
      const data = new FormData();
      data.append('title', form.title.trim());
      data.append('category', form.category);
      data.append('amount', form.amount);
      data.append('description', form.description);
      data.append('expense_date', form.expense_date);
      if (form.trip_id !== NO_TRIP || (editing && claim.trip_id)) data.append('trip_id', form.trip_id === NO_TRIP ? '' : form.trip_id);
      if (removeExisting) data.append('remove_bill', 'true');
      if (file) data.append('bill_image', file);

      const res = editing
        ? await api.put(`/reimbursements/${claim.id}`, data, { headers: { 'Content-Type': 'multipart/form-data' } })
        : await api.post('/reimbursements/apply', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data?.reimbursement?.policy_flagged) {
        toast.warning(editing ? 'Saved — flagged for review against the expense policy' : 'Submitted — flagged for review against the expense policy');
      } else {
        toast.success(editing ? 'Reimbursement updated successfully' : 'Reimbursement request submitted successfully');
      }
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      if (error.response?.data?.policy_check) setServerCheck(error.response.data.policy_check);
      toast.error(errorText(error, editing ? 'Failed to update reimbursement' : 'Failed to submit request'));
    } finally {
      setSaving(false);
    }
  };

  const tripOptions = trips.some(t => t.id === claim?.trip_id) || !claim?.trip_id
    ? trips
    : [...trips, { id: claim.trip_id, label: claim.trip_label || 'Linked trip' }];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            {editing ? <Pencil className="w-4 h-4 sm:w-5 sm:h-5" /> : <Receipt className="w-4 h-4 sm:w-5 sm:h-5" />}
            {editing ? 'Edit Reimbursement' : 'Apply for Reimbursement'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
          {/* Receipt first so it can be scanned into the form */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-slate-700 font-medium text-xs sm:text-sm">Bill / Receipt{shownCheck?.receipt_required ? ' *' : ''}</Label>
              <ReceiptScanButton file={file} onResult={applyScan} />
            </div>
            <div className="mt-1 sm:mt-1.5 space-y-2">
              {file ? (
                <div className="relative flex items-center gap-2 p-2 sm:p-3 bg-slate-50 rounded-lg border border-slate-200">
                  {preview
                    ? <img src={preview} alt="Receipt preview" className="w-16 h-16 object-cover rounded border border-slate-200" />
                    : <FileText className="w-8 h-8 text-slate-500" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm text-slate-700 truncate">{file.name}</p>
                    <p className="text-[10px] text-emerald-600">{(file.size / 1024 / 1024).toFixed(2)} MB · ready to upload</p>
                  </div>
                  <button type="button" onClick={clearFile} className="p-1 bg-red-500 text-white rounded-full hover:bg-red-600" aria-label="Remove file"><X className="w-3 h-3" /></button>
                </div>
              ) : claim?.bill_url && !removeExisting ? (
                <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <Image className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-700">Current bill attached</p>
                    <a href={claim.bill_url} target="_blank" rel="noopener noreferrer" className="text-[10px] sm:text-xs text-amber-600 hover:text-amber-700">View current bill</a>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveExisting(true)} className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 w-7 p-0" aria-label="Remove current bill">
                    <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </Button>
                </div>
              ) : null}
              {!file && (
                <label className="flex flex-col items-center justify-center w-full h-20 sm:h-24 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                  <Upload className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 mb-1" />
                  <span className="text-xs sm:text-sm text-slate-500">{claim?.bill_url && !removeExisting ? 'Upload a new bill to replace' : 'Click to upload bill / receipt'}</span>
                  <span className="text-[10px] sm:text-xs text-slate-400 mt-0.5">Image or PDF up to 10MB</span>
                  <input type="file" accept={RECEIPT_ACCEPT} onChange={pickFile} className="hidden" />
                </label>
              )}
              {removeExisting && <p className="text-[10px] sm:text-xs text-amber-600">Current bill will be removed on save</p>}
            </div>
          </div>

          <div>
            <Label className="text-slate-700 font-medium text-xs sm:text-sm">Title *</Label>
            <Input placeholder="e.g., Client meeting travel expense" value={form.title} onChange={set('title')} className="mt-1 sm:mt-1.5 text-sm h-9 sm:h-10" />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <div>
              <Label className="text-slate-700 font-medium text-xs sm:text-sm">Category *</Label>
              <Select value={form.category} onValueChange={set('category')}>
                <SelectTrigger className="mt-1 sm:mt-1.5 text-xs sm:text-sm h-9 sm:h-10"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {[...new Set([...categories, ...(form.category ? [form.category] : [])])].map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs sm:text-sm">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-700 font-medium text-xs sm:text-sm">Amount (₹) *</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={set('amount')} className="mt-1 sm:mt-1.5 text-sm h-9 sm:h-10" />
            </div>
          </div>

          <div>
            <Label className="text-slate-700 font-medium text-xs sm:text-sm">Expense Date *</Label>
            <Input type="date" value={form.expense_date} onChange={set('expense_date')} className="mt-1 sm:mt-1.5 text-sm h-9 sm:h-10" />
          </div>

          {tripOptions.length > 0 && (
            <div>
              <Label className="text-slate-700 font-medium text-xs sm:text-sm flex items-center gap-1"><Plane className="w-3.5 h-3.5" /> Business trip</Label>
              <Select value={form.trip_id} onValueChange={set('trip_id')}>
                <SelectTrigger className="mt-1 sm:mt-1.5 text-xs sm:text-sm h-9 sm:h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TRIP} className="text-xs sm:text-sm">Not linked to a trip</SelectItem>
                  {tripOptions.map(t => <SelectItem key={t.id} value={t.id} className="text-xs sm:text-sm">{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-slate-700 font-medium text-xs sm:text-sm">Description</Label>
            <Textarea placeholder="Provide details about the expense..." value={form.description} onChange={set('description')} className="mt-1 sm:mt-1.5 text-xs sm:text-sm" rows={3} />
          </div>

          <PolicyCheckPanel check={shownCheck} loading={checking && !shownCheck} />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="text-xs sm:text-sm h-8 sm:h-10">Cancel</Button>
          <Button onClick={submit} disabled={saving || shownCheck?.status === 'blocked'} className="bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-8 sm:h-10">
            {saving ? (
              <>
                <div className="animate-spin w-3 h-3 sm:w-4 sm:h-4 border-2 border-white border-t-transparent rounded-full mr-1.5 sm:mr-2"></div>
                {editing ? 'Saving...' : 'Submitting...'}
              </>
            ) : editing ? 'Save Changes' : 'Submit Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
