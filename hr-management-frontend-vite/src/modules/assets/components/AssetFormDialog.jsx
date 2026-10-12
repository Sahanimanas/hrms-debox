import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { CONDITIONS, humanize, isoDay, errorText } from '../lib';

const EMPTY = {
  asset_tag: '', name: '', category: '', brand: '', model: '', serial_number: '', purchase_date: '',
  cost: '', vendor: '', warranty_expiry: '', condition: 'good', location: '', notes: '', status: 'available',
};

const fromAsset = (a) => ({
  ...EMPTY,
  ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, a[k] ?? EMPTY[k]])),
  purchase_date: isoDay(a.purchase_date),
  warranty_expiry: isoDay(a.warranty_expiry),
  cost: a.cost ?? '',
});

/**
 * Create / edit an asset. Mount with a `key` that changes per asset so the form resets.
 */
export default function AssetFormDialog({ open, onOpenChange, asset, categories, onSaved }) {
  const editing = !!asset?.id;
  const [form, setForm] = useState(() => (asset ? fromAsset(asset) : EMPTY));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    if (!form.asset_tag.trim() || !form.name.trim() || !form.category) {
      toast.error('Asset tag, name and category are required');
      return;
    }
    const body = {
      asset_tag: form.asset_tag.trim(),
      name: form.name.trim(),
      category: form.category,
      brand: form.brand,
      model: form.model,
      serial_number: form.serial_number,
      purchase_date: form.purchase_date || null,
      cost: form.cost === '' ? null : Number(form.cost),
      vendor: form.vendor,
      warranty_expiry: form.warranty_expiry || null,
      condition: form.condition,
      location: form.location,
      notes: form.notes,
    };
    if (!editing) body.status = form.status;
    setSaving(true);
    try {
      const { data } = editing
        ? await api.put(`/v2/assets/items/${asset.id}`, body)
        : await api.post('/v2/assets/items', body);
      toast.success(editing ? 'Asset updated' : 'Asset added');
      onSaved?.(data);
      onOpenChange(false);
    } catch (error) {
      const errs = error.response?.data?.errors;
      toast.error(errs?.length ? errs.map(e => e.message.replace(/"/g, '')).join('; ') : errorText(error, 'Failed to save asset'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${asset.asset_tag}` : 'Add asset'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="af-tag">Asset tag *</Label>
            <Input id="af-tag" value={form.asset_tag} onChange={set('asset_tag')} placeholder="LAP-001" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-name">Name *</Label>
            <Input id="af-name" value={form.name} onChange={set('name')} placeholder="MacBook Pro 14" />
          </div>
          <div className="space-y-1.5">
            <Label>Category *</Label>
            <Select value={form.category} onValueChange={set('category')}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Condition</Label>
            <Select value={form.condition} onValueChange={set('condition')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITIONS.map(c => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-brand">Brand</Label>
            <Input id="af-brand" value={form.brand || ''} onChange={set('brand')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-model">Model</Label>
            <Input id="af-model" value={form.model || ''} onChange={set('model')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-serial">Serial number</Label>
            <Input id="af-serial" value={form.serial_number || ''} onChange={set('serial_number')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-location">Location</Label>
            <Input id="af-location" value={form.location || ''} onChange={set('location')} placeholder="Bengaluru HQ" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-pdate">Purchase date</Label>
            <Input id="af-pdate" type="date" value={form.purchase_date} onChange={set('purchase_date')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-cost">Cost (₹)</Label>
            <Input id="af-cost" type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-vendor">Vendor</Label>
            <Input id="af-vendor" value={form.vendor || ''} onChange={set('vendor')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-warranty">Warranty expiry</Label>
            <Input id="af-warranty" type="date" value={form.warranty_expiry} onChange={set('warranty_expiry')} />
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label>Initial status</Label>
              <Select value={form.status} onValueChange={set('status')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['available', 'in_repair', 'retired', 'lost'].map(s => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="af-notes">Notes</Label>
            <Textarea id="af-notes" rows={2} value={form.notes || ''} onChange={set('notes')} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add asset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
