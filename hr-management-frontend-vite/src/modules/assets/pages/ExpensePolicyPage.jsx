import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, Plus, Pencil, Trash2, Download, MapPin, Save, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageHeader, Loading, Empty, ErrorState } from '../components/Shared';
import { EXPENSE_CATEGORIES, TIER_LABELS, inr, errorText } from '../lib';

const ROLES = ['employee', 'manager', 'admin'];

export default function ExpensePolicyPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'per-diem' ? 'per-diem' : 'policies';
  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="w-full space-y-5 sm:space-y-6">
        <PageHeader icon={ShieldCheck} title="Expense Policy" subtitle="Category limits for reimbursements and per-diem rates for travel" />
        <Tabs value={tab} onValueChange={(v) => setParams(v === 'per-diem' ? { tab: 'per-diem' } : {}, { replace: true })}>
          <TabsList className="bg-white shadow-sm">
            <TabsTrigger value="policies" className="gap-1.5"><ShieldCheck className="w-4 h-4" /> Category limits</TabsTrigger>
            <TabsTrigger value="per-diem" className="gap-1.5"><MapPin className="w-4 h-4" /> Per-diem rates</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === 'policies' ? <PoliciesTab /> : <PerDiemTab />}
      </div>
    </div>
  );
}

function PoliciesTab() {
  const [policies, setPolicies] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // policy or {} for new

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/v2/assets/expense-policies');
      setPolicies(data);
    } catch (err) {
      setError(errorText(err, 'Failed to load policies'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/employees').then(r => {
      const set = new Set((r.data || []).map(e => e.department).filter(Boolean));
      setDepartments([...set].sort());
    }).catch(() => {});
  }, []);

  const remove = async (p) => {
    if (!window.confirm(`Delete the ${p.category} policy?`)) return;
    try {
      await api.delete(`/v2/assets/expense-policies/${p.id}`);
      toast.success('Policy deleted');
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete'));
    }
  };

  const toggle = async (p) => {
    try {
      await api.put(`/v2/assets/expense-policies/${p.id}`, { active: !p.active });
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to update'));
    }
  };

  const doExport = () => exportCsv('expense-policies', policies, [
    { key: 'category', label: 'Category' },
    { key: 'max_per_claim', label: 'Max per claim' },
    { key: 'monthly_cap', label: 'Monthly cap' },
    { key: 'receipt_required_above', label: 'Receipt required above' },
    { label: 'Allowed roles', value: r => (r.allowed_roles || []).join('; ') },
    { label: 'Allowed departments', value: r => (r.allowed_departments || []).join('; ') },
    { key: 'enforcement', label: 'Enforcement' },
    { label: 'Active', value: r => (r.active ? 'yes' : 'no') },
    { key: 'description', label: 'Description' },
  ]);

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base sm:text-lg">Category limits</CardTitle>
          <p className="text-xs text-slate-500 mt-0.5">Hard limits block the claim; soft limits let it through but flag it for the approver.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={doExport} disabled={!policies.length}><Download className="w-4 h-4" /> Export CSV</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setEditing({})}><Plus className="w-4 h-4" /> Add policy</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : policies.length === 0 ? (
          <Empty icon={ShieldCheck} title="No expense policies yet">Claims in categories without a policy are not checked.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Category</th>
                  <th className="text-left font-medium px-4 py-3">Limits</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Who can claim</th>
                  <th className="text-left font-medium px-4 py-3">Type</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Active</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {policies.map(p => (
                  <tr key={p.id} className={p.active ? '' : 'opacity-60'}>
                    <td className="px-4 py-3"><p className="font-medium text-slate-900">{p.category}</p>{p.description && <p className="text-xs text-slate-500 max-w-[220px] truncate">{p.description}</p>}</td>
                    <td className="px-4 py-3 text-xs text-slate-700 space-y-0.5">
                      <p>Per claim: {inr(p.max_per_claim)}</p>
                      <p>Monthly: {inr(p.monthly_cap)}</p>
                      <p>Receipt: {p.receipt_required_above == null ? 'optional' : p.receipt_required_above > 0 ? `above ${inr(p.receipt_required_above)}` : 'always'}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-600">
                      <p>{p.allowed_roles?.length ? p.allowed_roles.join(', ') : 'All roles'}</p>
                      <p>{p.allowed_departments?.length ? p.allowed_departments.join(', ') : 'All departments'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={p.enforcement === 'hard' ? 'bg-red-100 text-red-700 hover:bg-red-100' : 'bg-amber-100 text-amber-700 hover:bg-amber-100'}>{p.enforcement === 'hard' ? 'Hard' : 'Soft'}</Badge>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell"><Switch checked={!!p.active} onCheckedChange={() => toggle(p)} aria-label="Active" /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditing(p)} aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => remove(p)} aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {editing && <PolicyDialog policy={editing} departments={departments} usedCategories={policies.map(p => p.category)} onClose={() => setEditing(null)} onSaved={load} />}
    </Card>
  );
}

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

function PolicyDialog({ policy, departments, usedCategories, onClose, onSaved }) {
  const isNew = !policy.id;
  const [form, setForm] = useState({
    category: policy.category || '',
    max_per_claim: policy.max_per_claim ?? '',
    monthly_cap: policy.monthly_cap ?? '',
    receipt_required_above: policy.receipt_required_above ?? '',
    allowed_roles: policy.allowed_roles || [],
    allowed_departments: policy.allowed_departments || [],
    enforcement: policy.enforcement || 'soft',
    active: policy.active ?? true,
    description: policy.description || '',
  });
  const [saving, setSaving] = useState(false);
  const toggleIn = (key, value) => setForm(f => ({ ...f, [key]: f[key].includes(value) ? f[key].filter(x => x !== value) : [...f[key], value] }));
  const freeCategories = EXPENSE_CATEGORIES.filter(c => !usedCategories.some(u => u.toLowerCase() === c.toLowerCase()) || c === policy.category);

  const save = async () => {
    if (!form.category.trim()) return toast.error('Choose a category');
    const body = {
      ...form,
      category: form.category.trim(),
      max_per_claim: numOrNull(form.max_per_claim),
      monthly_cap: numOrNull(form.monthly_cap),
      receipt_required_above: numOrNull(form.receipt_required_above),
    };
    setSaving(true);
    try {
      if (isNew) await api.post('/v2/assets/expense-policies', body);
      else await api.put(`/v2/assets/expense-policies/${policy.id}`, body);
      toast.success('Policy saved');
      onSaved();
      onClose();
    } catch (err) {
      const errs = err.response?.data?.errors;
      toast.error(errs?.length ? errs.map(e => e.message.replace(/"/g, '')).join('; ') : errorText(err, 'Failed to save policy'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? 'Add expense policy' : `Edit ${policy.category} policy`}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pol-cat">Category</Label>
            <Input id="pol-cat" list="pol-cat-list" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Food & Meals" />
            <datalist id="pol-cat-list">{freeCategories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pol-max">Max per claim (₹)</Label>
              <Input id="pol-max" type="number" min="0" value={form.max_per_claim} onChange={(e) => setForm({ ...form, max_per_claim: e.target.value })} placeholder="No limit" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pol-month">Monthly cap (₹)</Label>
              <Input id="pol-month" type="number" min="0" value={form.monthly_cap} onChange={(e) => setForm({ ...form, monthly_cap: e.target.value })} placeholder="No cap" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pol-rcpt">Receipt above (₹)</Label>
              <Input id="pol-rcpt" type="number" min="0" value={form.receipt_required_above} onChange={(e) => setForm({ ...form, receipt_required_above: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 -mt-2">Leave blank for no limit. Receipt “0” means a receipt is always required.</p>
          <div className="space-y-1.5">
            <Label>Who can claim <span className="text-slate-400 font-normal">(none ticked = everyone)</span></Label>
            <div className="flex flex-wrap gap-3">
              {ROLES.map(r => (
                <label key={r} className="flex items-center gap-1.5 text-sm capitalize"><Checkbox checked={form.allowed_roles.includes(r)} onCheckedChange={() => toggleIn('allowed_roles', r)} /> {r}</label>
              ))}
            </div>
            {departments.length > 0 && (
              <div className="flex flex-wrap gap-3 pt-1">
                {departments.map(d => (
                  <label key={d} className="flex items-center gap-1.5 text-sm"><Checkbox checked={form.allowed_departments.includes(d)} onCheckedChange={() => toggleIn('allowed_departments', d)} /> {d}</label>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>When a claim breaks the policy</Label>
              <Select value={form.enforcement} onValueChange={(v) => setForm({ ...form, enforcement: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="soft">Soft — warn and flag</SelectItem>
                  <SelectItem value="hard">Hard — block</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm mt-6"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /> Active</label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-desc">Description</Label>
            <Textarea id="pol-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Shown to employees" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save policy'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PerDiemTab() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newCity, setNewCity] = useState({ city: '', tier: 'tier_1' });
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get('/v2/assets/per-diem');
      setConfig(data);
    } catch (err) {
      setError(errorText(err, 'Failed to load per-diem rates'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <Card className="border-0 shadow-md"><ErrorState message={error} onRetry={load} /></Card>;
  if (!config) return <Loading />;

  const setRate = (tier, value) => setConfig(c => ({ ...c, rates: { ...c.rates, [tier]: value } }));
  const setCityTier = (city, tier) => setConfig(c => ({ ...c, cities: c.cities.map(x => (x.city === city ? { ...x, tier } : x)) }));
  const removeCity = (city) => setConfig(c => ({ ...c, cities: c.cities.filter(x => x.city !== city) }));
  const addCity = () => {
    const name = newCity.city.trim();
    if (name.length < 2) return toast.error('Enter a city name');
    if (config.cities.some(c => c.city.toLowerCase() === name.toLowerCase())) return toast.error(`${name} is already listed`);
    setConfig(c => ({ ...c, cities: [...c.cities, { city: name, tier: newCity.tier }].sort((a, b) => a.city.localeCompare(b.city)) }));
    setNewCity({ city: '', tier: newCity.tier });
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/v2/assets/per-diem', {
        rates: Object.fromEntries(Object.entries(config.rates).map(([k, v]) => [k, Number(v) || 0])),
        default_tier: config.default_tier,
        cities: config.cities,
      });
      setConfig(data);
      toast.success('Per-diem rates saved');
    } catch (err) {
      toast.error(errorText(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const shown = config.cities.filter(c => c.city.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-5">
      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2"><Wallet className="w-4 h-4 text-slate-600" /> Daily rates by city tier</CardTitle>
          <p className="text-xs text-slate-500">Per-diem for a trip = destination tier rate × trip days (start and end inclusive).</p>
        </CardHeader>
        <CardContent className="p-3 sm:p-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
          {Object.keys(TIER_LABELS).map(t => (
            <div key={t} className="space-y-1.5">
              <Label htmlFor={`rate-${t}`}>{TIER_LABELS[t]} (₹/day)</Label>
              <Input id={`rate-${t}`} type="number" min="0" value={config.rates[t] ?? ''} onChange={(e) => setRate(t, e.target.value)} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label>Unlisted cities use</Label>
            <Select value={config.default_tier} onValueChange={(v) => setConfig({ ...config, default_tier: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(TIER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2"><MapPin className="w-4 h-4 text-slate-600" /> Cities ({config.cities.length})</CardTitle>
          <div className="flex gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter cities" className="sm:w-48" />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv('per-diem-cities', config.cities, [
              { key: 'city', label: 'City' }, { label: 'Tier', value: r => TIER_LABELS[r.tier] }, { label: 'Daily rate', value: r => config.rates[r.tier] },
            ])}><Download className="w-4 h-4" /> CSV</Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={newCity.city} onChange={(e) => setNewCity({ ...newCity, city: e.target.value })} placeholder="Add a city" onKeyDown={(e) => e.key === 'Enter' && addCity()} />
            <Select value={newCity.tier} onValueChange={(v) => setNewCity({ ...newCity, tier: v })}>
              <SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(TIER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={addCity} className="gap-1"><Plus className="w-4 h-4" /> Add</Button>
          </div>
          {shown.length === 0 ? <Empty title="No cities listed" /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {shown.map(c => (
                <div key={c.city} className="flex items-center gap-2 border border-slate-100 rounded-lg px-3 py-1.5">
                  <span className="flex-1 text-sm truncate">{c.city}</span>
                  <Select value={c.tier} onValueChange={(v) => setCityTier(c.city, v)}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TIER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeCity(c.city)} aria-label={`Remove ${c.city}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {config.updated_at && <p className="text-xs text-slate-500">Last saved {new Date(config.updated_at).toLocaleString()}{config.updated_by ? ` by ${config.updated_by}` : ''}</p>}
        <Button onClick={save} disabled={saving} className="gap-1.5"><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save rates'}</Button>
      </div>
    </div>
  );
}
