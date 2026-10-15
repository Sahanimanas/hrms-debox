// Admin form for lifecycle settings (notice period, probation length, company details, task owners).
import React, { useCallback, useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import api from '@/lib/api';
import { API, errMsg } from '../lib';
import { SectionCard, Loading } from './ui';

const LifecycleSettingsCard = () => {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`${API}/settings`);
      setForm({ ...r.data, hr_email: r.data.hr_email || '', it_email: r.data.it_email || '' });
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load settings'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put(`${API}/settings`, {
        notice_period_days: Number(form.notice_period_days),
        probation_months: Number(form.probation_months),
        company_name: form.company_name || '',
        company_address: form.company_address || '',
        hr_email: form.hr_email || null,
        it_email: form.it_email || null,
        basic_percent_of_gross: Number(form.basic_percent_of_gross),
      });
      setForm({ ...r.data, hr_email: r.data.hr_email || '', it_email: r.data.it_email || '' });
      toast.success('Settings saved');
    } catch (e) {
      toast.error(errMsg(e, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <SectionCard icon={Settings2} title="Lifecycle settings">
      {!form ? <Loading /> : (
        <div className="p-3 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ls-notice">Notice period (days)</Label>
              <Input id="ls-notice" type="number" min={0} max={365} value={form.notice_period_days} onChange={set('notice_period_days')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-prob">Probation (months)</Label>
              <Input id="ls-prob" type="number" min={0} max={24} value={form.probation_months} onChange={set('probation_months')} />
              <p className="text-[11px] text-slate-500">0 = new joiners are confirmed immediately</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-basic">Basic as % of gross</Label>
              <Input id="ls-basic" type="number" min={1} max={100} value={form.basic_percent_of_gross} onChange={set('basic_percent_of_gross')} />
              <p className="text-[11px] text-slate-500">Used for settlement when no salary structure exists</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ls-company">Company name (letters & PDFs)</Label>
              <Input id="ls-company" value={form.company_name} onChange={set('company_name')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-address">Company address</Label>
              <Textarea id="ls-address" rows={1} value={form.company_address} onChange={set('company_address')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-hr">HR task owner (email)</Label>
              <Input id="ls-hr" type="email" placeholder="Defaults to an admin" value={form.hr_email} onChange={set('hr_email')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-it">IT task owner (email)</Label>
              <Input id="ls-it" type="email" placeholder="Defaults to the HR owner" value={form.it_email} onChange={set('it_email')} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
};

export default LifecycleSettingsCard;
