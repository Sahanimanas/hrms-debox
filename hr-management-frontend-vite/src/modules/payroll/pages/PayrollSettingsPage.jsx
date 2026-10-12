import React, { useCallback, useEffect, useState } from 'react';
import { Settings2, Save, Plus, Trash2, Percent, Building2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';
import { PageShell, SectionCard, LoadingBlock, ErrorBlock } from '../components/PayrollUI';
import { API, errMsg, fyOf, currentMonth, fmtNum } from '../lib';

const FORM_KEYS = [
  'company_name', 'company_address', 'employer_pan', 'employer_tan', 'pf_establishment_code',
  'pf_enabled', 'pf_restrict_to_ceiling', 'pf_ceiling', 'esi_enabled', 'esi_threshold', 'lwf_enabled',
  'default_pt_state', 'lop_basis', 'pay_day', 'auto_draft_enabled',
  'declaration_window_open', 'proof_deadline', 'use_declared_until_deadline',
];

const nextFy = (fy) => {
  const start = parseInt(fy.slice(0, 4), 10) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span>
        <span className="text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <Switch checked={!!checked} onCheckedChange={onChange} />
    </label>
  );
}

function RegimeEditor({ title, value, onChange }) {
  const setField = (k, v) => onChange({ ...value, [k]: v });
  const setSlab = (i, k, v) => onChange({ ...value, slabs: value.slabs.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const addSlab = () => {
    const slabs = [...value.slabs];
    const last = slabs.pop();
    const prevUpto = slabs.length ? slabs[slabs.length - 1].upto : 0;
    slabs.push({ upto: (prevUpto || 0) + 400000, rate: last?.rate ?? 0 }, last || { upto: null, rate: 30 });
    onChange({ ...value, slabs });
  };
  const removeSlab = (i) => onChange({ ...value, slabs: value.slabs.filter((_, j) => j !== i) });
  const num = (v) => (v === '' ? '' : Number(v));

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr><th className="text-left px-3 py-2 font-medium">Income from</th><th className="text-left px-3 py-2 font-medium">Up to (₹)</th><th className="text-left px-3 py-2 font-medium">Rate %</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {value.slabs.map((s, i) => {
              const last = i === value.slabs.length - 1;
              const from = i === 0 ? 0 : value.slabs[i - 1].upto;
              return (
                <tr key={i}>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">₹{fmtNum(from)}</td>
                  <td className="px-3 py-2">
                    {last ? <span className="text-slate-500">and above</span> : (
                      <Input type="number" className="h-8 w-32" value={s.upto ?? ''} onChange={(e) => setSlab(i, 'upto', num(e.target.value))} />
                    )}
                  </td>
                  <td className="px-3 py-2"><Input type="number" className="h-8 w-20" value={s.rate} onChange={(e) => setSlab(i, 'rate', num(e.target.value))} /></td>
                  <td className="px-2 py-2 text-right">
                    {!last && value.slabs.length > 2 && (
                      <Button variant="ghost" size="sm" className="h-7 text-red-600" onClick={() => removeSlab(i)} aria-label="Remove slab"><Trash2 className="w-3.5 h-3.5" /></Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" onClick={addSlab} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add slab</Button>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="space-y-1"><Label className="text-xs">Standard deduction (₹)</Label><Input type="number" value={value.standard_deduction} onChange={(e) => setField('standard_deduction', num(e.target.value))} /></div>
        <div className="space-y-1"><Label className="text-xs">87A rebate — income up to (₹)</Label><Input type="number" value={value.rebate_limit} onChange={(e) => setField('rebate_limit', num(e.target.value))} /></div>
        <div className="space-y-1"><Label className="text-xs">87A rebate — max (₹)</Label><Input type="number" value={value.rebate_max} onChange={(e) => setField('rebate_max', num(e.target.value))} /></div>
        <div className="space-y-1"><Label className="text-xs">Cess %</Label><Input type="number" value={value.cess_rate} onChange={(e) => setField('cess_rate', num(e.target.value))} /></div>
        <label className="flex items-center gap-2 text-sm col-span-2 pt-5">
          <Switch checked={!!value.marginal_relief} onCheckedChange={(v) => setField('marginal_relief', v)} />
          Marginal relief above the rebate limit
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Surcharge: {(value.surcharge || []).map(s => `${s.rate}% above ₹${fmtNum(s.above)}`).join(', ') || 'none'}
      </p>
    </div>
  );
}

export default function PayrollSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [states, setStates] = useState({});
  const [ptStates, setPtStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fy, setFy] = useState('');
  const [slabDraft, setSlabDraft] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, meta] = await Promise.all([api.get(`${API}/settings`), api.get(`${API}/meta`)]);
      setSettings(s.data);
      setForm(Object.fromEntries(FORM_KEYS.map(k => [k, s.data[k] ?? ''])));
      setStates(meta.data.states || {});
      setPtStates(meta.data.pt_states || []);
      const years = Object.keys(s.data.tax_slabs || {}).sort();
      const pick = years.includes(fyOf(currentMonth())) ? fyOf(currentMonth()) : years[years.length - 1];
      setFy(pick);
      setSlabDraft(JSON.parse(JSON.stringify(s.data.tax_slabs[pick])));
    } catch (e) {
      setError(errMsg(e, 'Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form };
      ['pf_ceiling', 'esi_threshold', 'pay_day'].forEach(k => { body[k] = Number(body[k]); });
      body.proof_deadline = body.proof_deadline || null;
      const res = await api.put(`${API}/settings`, body);
      setSettings(res.data);
      toast.success('Payroll settings saved');
    } catch (e) {
      toast.error(errMsg(e, 'Could not save settings'));
    } finally {
      setSaving(false);
    }
  };

  const pickFy = (value) => {
    setFy(value);
    setSlabDraft(JSON.parse(JSON.stringify(settings.tax_slabs[value])));
  };

  const addFy = () => {
    const years = Object.keys(settings.tax_slabs).sort();
    const latest = years[years.length - 1];
    const fresh = nextFy(latest);
    setSettings(s => ({ ...s, tax_slabs: { ...s.tax_slabs, [fresh]: JSON.parse(JSON.stringify(s.tax_slabs[latest])) } }));
    setFy(fresh);
    setSlabDraft(JSON.parse(JSON.stringify(settings.tax_slabs[latest])));
    toast.info(`FY ${fresh} copied from FY ${latest} — edit and save`);
  };

  const saveSlabs = async () => {
    setSaving(true);
    try {
      const res = await api.put(`${API}/settings/tax-slabs/${fy}`, slabDraft);
      setSettings(res.data);
      toast.success(`Tax slabs for FY ${fy} saved`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not save tax slabs'));
    } finally {
      setSaving(false);
    }
  };

  const deleteFy = async () => {
    try {
      const res = await api.delete(`${API}/settings/tax-slabs/${fy}`);
      setSettings(res.data);
      const years = Object.keys(res.data.tax_slabs).sort();
      pickFyFrom(res.data, years[years.length - 1]);
      toast.success(`FY ${fy} slabs removed`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not remove'));
    }
  };
  const pickFyFrom = (s, value) => {
    setFy(value);
    setSlabDraft(JSON.parse(JSON.stringify(s.tax_slabs[value])));
  };

  if (loading) return <PageShell icon={Settings2} title="Payroll Settings"><LoadingBlock /></PageShell>;
  if (error) return <PageShell icon={Settings2} title="Payroll Settings"><ErrorBlock message={error} onRetry={load} /></PageShell>;

  const years = Object.keys(settings.tax_slabs || {}).sort();
  const currentFy = fyOf(currentMonth());

  return (
    <PageShell
      icon={Settings2}
      title="Payroll Settings"
      subtitle="Statutory configuration, LOP rules, declarations and income-tax slabs"
      actions={<Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9 sm:h-10"><Save className="w-4 h-4" /> Save settings</Button>}
    >
      <Tabs defaultValue="statutory">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="statutory">Statutory</TabsTrigger>
          <TabsTrigger value="company">Company & pay</TabsTrigger>
          <TabsTrigger value="declarations">Declarations</TabsTrigger>
          <TabsTrigger value="tax">Tax slabs</TabsTrigger>
        </TabsList>

        <TabsContent value="statutory" className="space-y-4 mt-4">
          <SectionCard icon={Percent} title="Provident Fund, ESI, PT & LWF" bodyClassName="p-4 sm:p-5 space-y-2">
            <ToggleRow label="Provident Fund" hint="Employee 12% of Basic + DA; employer 12% split into EPS 8.33% and EPF 3.67%" checked={form.pf_enabled} onChange={(v) => set('pf_enabled', v)} />
            <ToggleRow label="Restrict PF wage to the ceiling" hint="Contributions on wages capped at the ceiling. EPS is always on the capped wage." checked={form.pf_restrict_to_ceiling} onChange={(v) => set('pf_restrict_to_ceiling', v)} />
            <div className="grid sm:grid-cols-2 gap-3 pb-2">
              <div className="space-y-1"><Label className="text-xs">PF wage ceiling (₹/month)</Label><Input type="number" value={form.pf_ceiling} onChange={(e) => set('pf_ceiling', e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">ESI gross threshold (₹/month)</Label><Input type="number" value={form.esi_threshold} onChange={(e) => set('esi_threshold', e.target.value)} /></div>
            </div>
            <ToggleRow label="ESI" hint="Employee 0.75%, employer 3.25% when monthly gross is within the threshold" checked={form.esi_enabled} onChange={(v) => set('esi_enabled', v)} />
            <ToggleRow label="Labour Welfare Fund" hint="Deducted in the state's contribution months (e.g. Maharashtra June & December)" checked={form.lwf_enabled} onChange={(v) => set('lwf_enabled', v)} />
            <div className="space-y-1 pt-2 max-w-sm">
              <Label className="text-xs">Default Professional Tax state</Label>
              <Select value={form.default_pt_state || ''} onValueChange={(v) => set('default_pt_state', v)}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(states).map(([code, name]) => (
                    <SelectItem key={code} value={code}>{name}{ptStates.includes(code) ? '' : ' (no PT)'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">Per-employee overrides are on the Statutory Details page.</p>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="company" className="space-y-4 mt-4">
          <SectionCard icon={Building2} title="Company details (payslips, Form 16)" bodyClassName="p-4 sm:p-5 grid sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Company name (blank = organization name or "Xeno-HR")</Label><Input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Address</Label><Input value={form.company_address} onChange={(e) => set('company_address', e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Employer PAN</Label><Input value={form.employer_pan} onChange={(e) => set('employer_pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" /></div>
            <div className="space-y-1"><Label className="text-xs">TAN</Label><Input value={form.employer_tan} onChange={(e) => set('employer_tan', e.target.value.toUpperCase())} placeholder="MUMA12345B" /></div>
            <div className="space-y-1"><Label className="text-xs">PF establishment code</Label><Input value={form.pf_establishment_code} onChange={(e) => set('pf_establishment_code', e.target.value)} /></div>
          </SectionCard>
          <SectionCard icon={FileText} title="Pay cycle & loss of pay" bodyClassName="p-4 sm:p-5 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">LOP basis (days used to value one day's pay)</Label>
                <Select value={form.lop_basis} onValueChange={(v) => set('lop_basis', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="calendar">Calendar days in the month</SelectItem>
                    <SelectItem value="30">Fixed 30 days</SelectItem>
                    <SelectItem value="26">Fixed 26 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Pay day (day of month)</Label><Input type="number" min="1" max="31" value={form.pay_day} onChange={(e) => set('pay_day', e.target.value)} /></div>
            </div>
            <ToggleRow label="Auto-create draft payroll" hint="A scheduled job creates the draft run 5 days before pay day" checked={form.auto_draft_enabled} onChange={(v) => set('auto_draft_enabled', v)} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="declarations" className="space-y-4 mt-4">
          <SectionCard icon={FileText} title="Investment declarations" bodyClassName="p-4 sm:p-5 space-y-2">
            <ToggleRow label="Declaration window open" hint="When closed, employees can't change declarations or their tax regime" checked={form.declaration_window_open} onChange={(v) => set('declaration_window_open', v)} />
            <ToggleRow label="Use declared amounts until the proof deadline" hint="After the deadline only verified (approved) amounts reduce TDS" checked={form.use_declared_until_deadline} onChange={(v) => set('use_declared_until_deadline', v)} />
            <div className="space-y-1 max-w-xs pt-2">
              <Label className="text-xs">Proof submission deadline</Label>
              <Input type="date" value={form.proof_deadline || ''} onChange={(e) => set('proof_deadline', e.target.value)} />
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="tax" className="space-y-4 mt-4">
          <SectionCard
            icon={Percent}
            title="Income-tax slabs"
            actions={(
              <>
                <Select value={fy} onValueChange={pickFy}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{years.map(y => <SelectItem key={y} value={y}>FY {y}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={addFy} className="gap-1.5 h-8"><Plus className="w-3.5 h-3.5" /> Next FY</Button>
              </>
            )}
            bodyClassName="p-4 sm:p-5 space-y-6"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge className="bg-slate-800 hover:bg-slate-800">FY {fy}</Badge>
              <span className="text-slate-600">AY {parseInt(fy.slice(0, 4), 10) + 1}-{String((parseInt(fy.slice(0, 4), 10) + 2) % 100).padStart(2, '0')}</span>
              {!years.includes(currentFy) && (
                <span className="text-amber-700 text-xs">No slabs saved for the current FY {currentFy} — payroll uses the latest earlier FY.</span>
              )}
            </div>
            {slabDraft && (
              <div className="grid lg:grid-cols-2 gap-8">
                <RegimeEditor title="New regime (115BAC — default)" value={slabDraft.new} onChange={(v) => setSlabDraft(d => ({ ...d, new: v }))} />
                <RegimeEditor title="Old regime" value={slabDraft.old} onChange={(v) => setSlabDraft(d => ({ ...d, old: v }))} />
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-end">
              {years.length > 1 && settings.tax_slabs[fy] && (
                <Button variant="ghost" onClick={deleteFy} className="text-red-600 hover:bg-red-50 gap-1.5"><Trash2 className="w-4 h-4" /> Remove FY {fy}</Button>
              )}
              <Button onClick={saveSlabs} disabled={saving} className="bg-slate-800 hover:bg-slate-900 gap-2"><Save className="w-4 h-4" /> Save FY {fy} slabs</Button>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
