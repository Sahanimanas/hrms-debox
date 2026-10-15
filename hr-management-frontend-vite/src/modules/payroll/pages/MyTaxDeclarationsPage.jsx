import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Landmark, Plus, Trash2, Save, Upload, Paperclip, X, Lock, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, StatCard, LoadingBlock, ErrorBlock, EmptyBlock, StatusPill } from '../components/PayrollUI';
import { API, errMsg, fmtINR, recentFys, fmtDate, openProof, blobErrMsg, ITEM_STATUS_STYLES, SECTION_LABELS } from '../lib';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MAX_PROOF = 5 * 1024 * 1024;
let tempId = 0;
const newItem = (section = '80C') => ({ _key: `new-${++tempId}`, section, label: '', declared_amount: '', landlord_name: '', landlord_pan: '', rent_address: '', status: 'new', proofs: [] });

export default function MyTaxDeclarationsPage() {
  const fys = recentFys(2);
  const [fy, setFy] = useState(fys[0]);
  const [decl, setDecl] = useState(null);
  const [regime, setRegime] = useState('new');
  const [metro, setMetro] = useState(false);
  const [items, setItems] = useState([]);
  const [compare, setCompare] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');
  const fileRef = useRef(null);
  const uploadTarget = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${API}/declarations/my`, { params: { fy } });
      setDecl(res.data);
      setRegime(res.data.tax_regime || 'new');
      setMetro(!!res.data.metro_city);
      setItems((res.data.items || []).map(i => ({ ...i, _key: i.id })));
    } catch (e) {
      setError(errMsg(e, 'Failed to load your declaration'));
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => { load(); }, [load]);

  // Regime comparison from the latest payslip's monthly gross and current declarations
  const runCompare = useCallback(async () => {
    try {
      const slips = await api.get(`${API}/my/payslips`);
      const latest = slips.data?.[0];
      if (!latest) { setCompare(null); return; }
      const deductions = {};
      let rent = 0;
      for (const i of items) {
        const amt = Number(i.status === 'approved' ? i.approved_amount : i.declared_amount) || 0;
        if (i.status === 'rejected' || !amt) continue;
        if (i.section === 'HRA') rent += amt; else deductions[i.section] = (deductions[i.section] || 0) + amt;
      }
      deductions['80C'] = (deductions['80C'] || 0) + (latest.statutory?.pf_employee || 0) * 12;
      const hra = (latest.earnings || []).filter(e => /house rent|hra/i.test(e.name)).reduce((s, e) => s + e.amount, 0);
      const basic = (latest.earnings || []).filter(e => /basic|dearness/i.test(e.name)).reduce((s, e) => s + e.amount, 0);
      const res = await api.post(`${API}/calculate/tax`, {
        financial_year: fy,
        annual_gross: latest.monthly_gross * 12,
        basic_da_annual: basic * 12,
        hra_received_annual: hra * 12,
        rent_paid_annual: rent,
        metro,
        professional_tax: (latest.statutory?.pt || 0) * 12,
        deductions,
      });
      setCompare(res.data);
    } catch {
      setCompare(null);
    }
  }, [items, metro, fy]);

  useEffect(() => { if (!loading) runCompare(); }, [loading, runCompare]);

  const setItem = (key, patch) => setItems(list => list.map(i => (i._key === key ? { ...i, ...patch } : i)));
  const removeItem = (key) => setItems(list => list.filter(i => i._key !== key));

  const save = async () => {
    for (const i of items) {
      if (!(Number(i.declared_amount) >= 0) || i.declared_amount === '') return toast.error('Enter an amount for every item');
      if (i.section === 'HRA') {
        if (!i.landlord_name) return toast.error('Enter the landlord name for rent');
        if (Number(i.declared_amount) > (decl?.landlord_pan_threshold || 100000) && !PAN_RE.test(i.landlord_pan || '')) return toast.error('Landlord PAN is required when annual rent exceeds ₹1,00,000');
      }
    }
    setSaving(true);
    try {
      const res = await api.put(`${API}/declarations/my`, {
        financial_year: fy,
        tax_regime: regime,
        metro_city: metro,
        items: items.map(i => ({
          ...(i.id ? { id: i.id } : {}),
          section: i.section,
          label: i.label || null,
          declared_amount: Number(i.declared_amount),
          landlord_name: i.section === 'HRA' ? i.landlord_name || null : null,
          landlord_pan: i.section === 'HRA' ? (i.landlord_pan || '').toUpperCase() || null : null,
          rent_address: i.section === 'HRA' ? i.rent_address || null : null,
        })),
      });
      setDecl(d => ({ ...d, ...res.data }));
      setItems((res.data.items || []).map(i => ({ ...i, _key: i.id })));
      toast.success('Declaration saved');
    } catch (e) {
      toast.error(errMsg(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const pickFile = (item) => {
    uploadTarget.current = item;
    fileRef.current?.click();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const item = uploadTarget.current;
    if (!file || !item) return;
    if (file.size > MAX_PROOF) return toast.error('File is larger than 5 MB');
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast.error('Upload a PDF or image');
    const body = new FormData();
    body.append('file', file);
    body.append('financial_year', fy);
    setUploading(item.id);
    try {
      const res = await api.post(`${API}/declarations/my/items/${item.id}/proofs`, body);
      setItem(item._key, { proofs: [...(item.proofs || []), res.data], status: item.status === 'rejected' ? 'declared' : item.status, rejection_reason: null });
      toast.success('Proof uploaded');
    } catch (err) {
      toast.error(errMsg(err, 'Upload failed'));
    } finally {
      setUploading('');
    }
  };

  const deleteProof = async (item, proof) => {
    try {
      await api.delete(`${API}/declarations/my/items/${item.id}/proofs/${proof.id}`, { params: { fy } });
      setItem(item._key, { proofs: item.proofs.filter(p => p.id !== proof.id) });
    } catch (e) {
      toast.error(errMsg(e, 'Could not remove'));
    }
  };

  const viewProof = async (item, proof) => {
    try {
      await openProof(decl.id, item.id, proof);
    } catch (e) {
      toast.error(await blobErrMsg(e, 'Could not open the file'));
    }
  };

  const exportRows = () => exportCsv(`tax-declaration-${fy}`, items, [
    { key: 'section', label: 'Section' }, { key: 'label', label: 'Item' }, { key: 'declared_amount', label: 'Declared' },
    { key: 'status', label: 'Status' }, { key: 'approved_amount', label: 'Approved' }, { label: 'Proofs', value: i => i.proofs?.length || 0 },
  ]);

  if (loading) return <PageShell icon={Landmark} title="My Tax Declarations"><LoadingBlock /></PageShell>;
  if (error) return <PageShell icon={Landmark} title="My Tax Declarations"><ErrorBlock message={error} onRetry={load} /></PageShell>;

  const locked = decl?.window_open === false;
  const summary = decl?.summary || {};

  return (
    <PageShell
      icon={Landmark}
      title="My Tax Declarations"
      subtitle="Choose your tax regime and declare investments for TDS"
      actions={(
        <>
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="h-9 sm:h-10 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{fys.map(f => <SelectItem key={f} value={f}>FY {f}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={exportRows} disabled={!items.length} className="gap-2 h-9 sm:h-10">Export CSV</Button>
          <Button onClick={save} disabled={saving || locked} className="gap-2 h-9 sm:h-10"><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}</Button>
        </>
      )}
    >
      {locked && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" /> The declaration window is closed. You can still upload proofs for existing items.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <StatCard label="Declared" value={fmtINR(summary.declared, 0)} tone="slate" />
        <StatCard label="Approved" value={fmtINR(summary.approved, 0)} tone="emerald" />
        <StatCard label="Counted for TDS" value={fmtINR(summary.counted, 0)} tone="blue" hint={decl?.proof_deadline ? `Proofs due ${fmtDate(decl.proof_deadline)}` : null} />
        <StatCard label="Awaiting verification" value={summary.pending_items ?? 0} tone="amber" />
      </div>

      <SectionCard icon={Scale} title="Tax regime" bodyClassName="p-4 sm:p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            ['new', 'New regime', 'Lower rates, ₹75,000 standard deduction, no investment deductions.'],
            ['old', 'Old regime', 'Higher rates but 80C, 80D, HRA, home-loan interest etc. reduce tax.'],
          ].map(([value, title, text]) => (
            <button
              key={value}
              type="button"
              disabled={locked}
              onClick={() => setRegime(value)}
              className={`text-left rounded-xl border-2 p-3 transition ${regime === value ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:border-slate-300'} disabled:opacity-60`}
            >
              <p className="font-semibold text-slate-900">{title}</p>
              <p className="text-xs text-slate-600">{text}</p>
              {compare && <p className="text-sm mt-1">Estimated annual tax: <b>{fmtINR(compare[value].total, 0)}</b>{compare.better === value && <span className="ml-1 text-emerald-700 text-xs">(lower)</span>}</p>}
            </button>
          ))}
        </div>
        {compare ? (
          <p className="text-xs text-slate-500">Estimate from your latest monthly salary × 12 using FY {compare.slabs_fy} slabs. Actual TDS is recalculated every payroll.</p>
        ) : (
          <p className="text-xs text-slate-500">A comparison appears once you have a processed payslip.</p>
        )}
        {regime === 'new' && items.length > 0 && <p className="text-xs text-amber-700">Declarations below are kept but don't reduce TDS under the new regime.</p>}
      </SectionCard>

      <SectionCard
        icon={Landmark}
        title="Investments & deductions"
        actions={!locked && <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setItems(l => [...l, newItem()])}><Plus className="w-3.5 h-3.5" /> Add item</Button>}
        bodyClassName="p-3 sm:p-5 space-y-3"
      >
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>I live in a metro city (Delhi, Mumbai, Kolkata, Chennai) <span className="block text-xs text-slate-500">HRA exemption uses 50% of basic in metros, 40% elsewhere</span></span>
          <Switch checked={metro} disabled={locked} onCheckedChange={setMetro} />
        </label>

        {items.length === 0 ? (
          <EmptyBlock icon={Landmark} title="Nothing declared yet">Add PPF/ELSS/insurance (80C), health insurance (80D), rent (HRA), home-loan interest and more.</EmptyBlock>
        ) : items.map((item) => {
          const editable = !locked && item.status !== 'approved';
          return (
            <div key={item._key} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {item.status !== 'new' && <StatusPill status={item.status} styles={ITEM_STATUS_STYLES} label={item.status === 'declared' ? 'Awaiting verification' : item.status} />}
                  {item.status === 'approved' && <span className="text-xs text-emerald-700">Approved {fmtINR(item.approved_amount, 0)}</span>}
                </div>
                {!locked && item.status !== 'approved' && (
                  <Button variant="ghost" size="sm" className="h-7 text-red-600" onClick={() => removeItem(item._key)} aria-label="Remove item"><Trash2 className="w-3.5 h-3.5" /></Button>
                )}
              </div>
              {item.rejection_reason && <p className="text-xs text-red-600">Rejected: {item.rejection_reason} — upload a new proof or correct the amount.</p>}
              <div className="grid sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Section</Label>
                  <Select value={item.section} disabled={!editable} onValueChange={(v) => setItem(item._key, { section: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(SECTION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{item.section === 'HRA' ? 'Description' : 'Investment / policy'}</Label>
                  <Input value={item.label || ''} disabled={!editable} maxLength={120} placeholder={item.section === '80C' ? 'e.g. PPF' : ''} onChange={(e) => setItem(item._key, { label: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{item.section === 'HRA' ? 'Annual rent paid (₹)' : 'Annual amount (₹)'}</Label>
                  <Input type="number" min="0" value={item.declared_amount} disabled={!editable} onChange={(e) => setItem(item._key, { declared_amount: e.target.value })} />
                </div>
              </div>
              {item.section === 'HRA' && (
                <div className="grid sm:grid-cols-3 gap-2">
                  <div className="space-y-1"><Label className="text-xs">Landlord name</Label><Input value={item.landlord_name || ''} disabled={!editable} onChange={(e) => setItem(item._key, { landlord_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Landlord PAN {Number(item.declared_amount) > 100000 ? '(required)' : '(optional)'}</Label><Input value={item.landlord_pan || ''} maxLength={10} disabled={!editable} onChange={(e) => setItem(item._key, { landlord_pan: e.target.value.toUpperCase() })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Rented address</Label><Input value={item.rent_address || ''} disabled={!editable} onChange={(e) => setItem(item._key, { rent_address: e.target.value })} /></div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {(item.proofs || []).map(p => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs">
                    <button type="button" className="inline-flex items-center gap-1 text-blue-700 hover:underline" onClick={() => viewProof(item, p)}><Paperclip className="w-3 h-3" />{p.name}</button>
                    {item.status !== 'approved' && <button type="button" onClick={() => deleteProof(item, p)} aria-label="Remove proof"><X className="w-3 h-3 text-slate-500" /></button>}
                  </span>
                ))}
                {item.id ? (
                  item.status !== 'approved' && (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={uploading === item.id} onClick={() => pickFile(item)}>
                      <Upload className="w-3.5 h-3.5" /> {uploading === item.id ? 'Uploading…' : 'Upload proof'}
                    </Button>
                  )
                ) : <span className="text-xs text-slate-400">Save to upload proofs</span>}
              </div>
            </div>
          );
        })}
        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
        <p className="text-xs text-slate-500">80C is capped at ₹1.5 lakh (your PF counts towards it), 80D self ₹25,000, parents ₹50,000, 80CCD(1B) ₹50,000, home-loan interest ₹2 lakh. Proofs: PDF or image up to 5 MB.</p>
      </SectionCard>
    </PageShell>
  );
}
