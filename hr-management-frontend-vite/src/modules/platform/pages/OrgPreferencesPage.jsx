import React, { useCallback, useEffect, useState } from 'react';
import { Coins, Save, Download, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { formatMoney } from '@/lib/money';
import { clearOrgPreferences } from '@/lib/orgPreferences';
import { useI18n } from '@/lib/i18n';
import PageHeader, { PageShell, LoadingBlock, EmptyBlock, ErrorBlock } from '../components/PageHeader';
import { errorMessage } from '../lib';

const SAMPLE_AMOUNT = 1234567.5;
const SAMPLE_DATE = new Date(2026, 0, 31);

const safeFormatDate = (pattern) => {
  try {
    return format(SAMPLE_DATE, pattern);
  } catch {
    return '—';
  }
};

const OrgPreferencesPage = () => {
  const { language, languages, setLanguage } = useI18n();
  const [data, setData] = useState({ organizations: [], options: null });
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/platform/org-preferences/all');
      setData(r.data);
      setDrafts(Object.fromEntries(r.data.organizations.map(o => [o.organization_id, { currency: o.currency, locale: o.locale, date_format: o.date_format }])));
    } catch (e) {
      setError(errorMessage(e, 'Could not load preferences'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = (orgId, key, value) => setDrafts(d => ({ ...d, [orgId]: { ...d[orgId], [key]: value } }));

  const save = async (orgId) => {
    setSaving(orgId);
    try {
      await api.put(`/v2/platform/org-preferences/${encodeURIComponent(orgId)}`, drafts[orgId]);
      clearOrgPreferences();
      toast.success('Preferences saved');
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save'));
    } finally {
      setSaving(null);
    }
  };

  const opts = data.options;
  const selectCls = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm';

  return (
    <PageShell>
      <PageHeader icon={Coins} title="Organization Preferences" subtitle="Currency, number and date formats per organization">
        <Button variant="outline" className="gap-2" disabled={!data.organizations.length} onClick={() => exportCsv('organization-preferences', data.organizations, [
          { key: 'name', label: 'Organization' }, { key: 'currency', label: 'Currency' }, { key: 'locale', label: 'Locale' },
          { key: 'date_format', label: 'Date format' }, { label: 'Inherited', value: r => (r.inherited ? 'Yes' : 'No') },
        ])}><Download className="w-4 h-4" /> Export CSV</Button>
      </PageHeader>

      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2"><Coins className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Currency & formats</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : data.organizations.length === 0 ? (
            <EmptyBlock icon={Coins} title="No organizations" />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.organizations.map(o => {
                const d = drafts[o.organization_id] || o;
                const dirty = d.currency !== o.currency || d.locale !== o.locale || d.date_format !== o.date_format;
                return (
                  <div key={o.organization_id} className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-[1.2fr,1fr,1fr,1fr,auto] gap-3 md:items-center">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{o.name}</p>
                      <p className="text-xs text-slate-500">
                        {formatMoney(SAMPLE_AMOUNT, d)} · {safeFormatDate(d.date_format)}
                        {o.inherited && o.organization_id !== 'default' && <Badge variant="outline" className="ml-2 text-[10px]">uses default</Badge>}
                      </p>
                    </div>
                    <label className="text-xs text-slate-500">Currency
                      <select value={d.currency} onChange={(e) => update(o.organization_id, 'currency', e.target.value)} className={selectCls}>
                        {opts?.currencies.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-slate-500">Number locale
                      <select value={d.locale} onChange={(e) => update(o.organization_id, 'locale', e.target.value)} className={selectCls}>
                        {opts?.locales.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-slate-500">Date format
                      <select value={d.date_format} onChange={(e) => update(o.organization_id, 'date_format', e.target.value)} className={selectCls}>
                        {opts?.date_formats.map(c => <option key={c} value={c}>{c} ({safeFormatDate(c)})</option>)}
                      </select>
                    </label>
                    <Button size="sm" disabled={!dirty || saving === o.organization_id} onClick={() => save(o.organization_id)} className="bg-slate-800 hover:bg-slate-900 gap-1.5 md:self-end">
                      <Save className="w-4 h-4" /> Save
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2"><Languages className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Language</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 space-y-3">
          <p className="text-sm text-slate-700">Each person picks their own language from the sidebar; it's saved to their account. Your language:</p>
          <div className="flex gap-2">
            {languages.map(l => (
              <button key={l.code} type="button" onClick={() => setLanguage(l.code)}
                className={`px-4 py-2 rounded-lg border text-sm ${language === l.code ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700 hover:border-slate-400'}`}>
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">Amounts are stored as entered; changing the currency changes how they are displayed, it does not convert them.</p>
        </CardContent>
      </Card>
    </PageShell>
  );
};

export default OrgPreferencesPage;
