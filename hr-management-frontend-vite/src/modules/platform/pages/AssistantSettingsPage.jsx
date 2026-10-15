import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, KeyRound, ExternalLink, PlugZap, CheckCircle2, AlertTriangle, Loader2, Server } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Panel, StatusBadge } from '@/components/ds';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiError';
import PageHeader, { PageShell, LoadingBlock, ErrorBlock } from '../components/PageHeader';

const API = '/v2/platform/assistant/settings';

const EFFORT_NOTES = {
  low: 'Quickest, cheapest answers',
  medium: 'Balanced (recommended)',
  high: 'More careful answers',
  xhigh: 'Very thorough, slower',
  max: 'Most thorough, slowest and most expensive',
};

const EnvNote = ({ name }) => (
  <p className="flex items-center gap-1.5 text-xs text-ink-muted">
    <Server className="h-3.5 w-3.5 shrink-0" />
    Set by the server environment variable <code className="rounded-sm bg-subtle px-1 py-px text-[11px] text-ink-secondary">{name}</code>, which overrides this page.
  </p>
);

/** Admin page: connect the AI assistant to Anthropic (API key, model, effort, on/off). */
const AssistantSettingsPage = () => {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ enabled: true, model: '', effort: '' });
  const [newKey, setNewKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const apply = (s) => {
    setSettings(s);
    setForm({ enabled: s.enabled, model: s.model, effort: s.effort });
  };

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await api.get(API);
      apply(r.data);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Could not load the AI assistant settings'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async ({ clearKey = false } = {}) => {
    setKeyError('');
    setTestResult(null);
    const body = { ...form };
    if (settings.env.model) delete body.model;
    if (settings.env.effort) delete body.effort;
    if (newKey.trim()) body.api_key = newKey.trim();
    if (clearKey) body.clear_key = true;
    setSaving(true);
    try {
      const r = await api.put(API, body);
      apply(r.data);
      setNewKey('');
      toast.success(body.api_key ? 'API key verified and saved' : clearKey ? 'API key removed' : 'Settings saved');
    } catch (error) {
      const message = apiErrorMessage(error, 'Could not save the settings');
      if (error.response?.data?.errors?.some((e) => e.field === 'api_key')) setKeyError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post(`${API}/test`);
      setTestResult({ ok: true, message: r.data.detail });
    } catch (error) {
      setTestResult({ ok: false, message: apiErrorMessage(error, 'The connection test failed') });
    } finally {
      setTesting(false);
    }
  };

  if (loadError) return <PageShell><ErrorBlock message={loadError} onRetry={load} /></PageShell>;
  if (!settings) return <PageShell><LoadingBlock label="Loading AI assistant settings…" /></PageShell>;

  const dirty = form.enabled !== settings.enabled || form.model !== settings.model || form.effort !== settings.effort || !!newKey.trim();
  const statusBadge = settings.configured
    ? <StatusBadge tone="success" label="Connected" />
    : !settings.enabled
      ? <StatusBadge tone="neutral" label="Turned off" />
      : <StatusBadge tone="warning" label="Not set up" />;

  return (
    <PageShell>
      <PageHeader
        icon={Bot}
        title="AI Assistant settings"
        subtitle="Connect the HR assistant to Anthropic's Claude API and choose how it answers"
      >
        <Button asChild variant="outline">
          <Link to="/assistant"><Bot /> Open assistant</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6 min-w-0">
          {/* Status + on/off */}
          <Panel
            title="Status"
            subtitle={settings.updated_at ? `Last changed ${new Date(settings.updated_at).toLocaleString()}${settings.updated_by ? ` by ${settings.updated_by}` : ''}` : 'Not configured yet'}
            actions={statusBadge}
          >
            <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-canvas px-4 py-3">
              <div className="min-w-0">
                <Label htmlFor="ai-enabled" className="text-sm font-semibold text-ink">Assistant available to employees</Label>
                <p className="text-[13px] text-ink-secondary">When off, the assistant page and chat bubble tell people it isn't available.</p>
              </div>
              <Switch
                id="ai-enabled"
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
                className="data-[state=checked]:bg-brand"
              />
            </div>
          </Panel>

          {/* API key */}
          <Panel title="Anthropic API key" subtitle="Stored encrypted on the server. It is never shown again after saving.">
            <div className="space-y-4">
              {settings.has_key && (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-canvas px-4 py-3">
                  <KeyRound className="h-[18px] w-[18px] text-ink-secondary" />
                  <code className="text-sm font-medium text-ink">{settings.key_hint}</code>
                  <StatusBadge tone={settings.key_source === 'env' ? 'info' : 'success'} label={settings.key_source === 'env' ? 'From server environment' : 'Saved'} />
                  {settings.key_source === 'settings' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
                      disabled={saving}
                      onClick={() => save({ clearKey: true })}
                    >
                      Remove key
                    </Button>
                  )}
                </div>
              )}

              {settings.env.api_key ? (
                <EnvNote name="ANTHROPIC_API_KEY" />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="ai-key">{settings.has_key ? 'Replace with a new key' : 'API key'}</Label>
                  <Input
                    id="ai-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-ant-api03-…"
                    value={newKey}
                    onChange={(e) => { setNewKey(e.target.value); setKeyError(''); }}
                    aria-invalid={!!keyError}
                    className={cn('font-mono', keyError && 'border-danger-solid')}
                  />
                  {keyError
                    ? <p className="text-xs text-danger-fg">{keyError}</p>
                    : <p className="text-xs text-ink-muted">The key is checked with Anthropic before it's saved.</p>}
                </div>
              )}
            </div>
          </Panel>

          {/* Model + effort */}
          <Panel title="Model and answer depth" subtitle="Applies to every conversation from the next message on.">
            <div className="space-y-5">
              <fieldset className="space-y-2" disabled={settings.env.model}>
                <legend className="mb-2 text-sm font-medium text-ink">Model</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {settings.models.map((m) => (
                    <label
                      key={m.id}
                      className={cn(
                        'flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors',
                        form.model === m.id ? 'border-brand bg-brand-subtle' : 'border-line hover:bg-canvas',
                        settings.env.model && 'cursor-not-allowed opacity-60'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="ai-model"
                          value={m.id}
                          checked={form.model === m.id}
                          onChange={() => setForm((f) => ({ ...f, model: m.id }))}
                          className="accent-[#0b1220]"
                        />
                        <span className="text-sm font-semibold text-ink">{m.label}</span>
                      </span>
                      <span className="pl-5 text-xs text-ink-secondary">{m.note}</span>
                    </label>
                  ))}
                </div>
                {settings.env.model && <EnvNote name="ANTHROPIC_MODEL" />}
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="ai-effort">Answer depth (effort)</Label>
                <select
                  id="ai-effort"
                  value={form.effort}
                  disabled={settings.env.effort}
                  onChange={(e) => setForm((f) => ({ ...f, effort: e.target.value }))}
                  className="flex h-10 w-full max-w-sm rounded-md border border-line bg-surface px-3 text-sm text-ink shadow-xs outline-none focus:ring-2 focus:ring-ring/60 disabled:opacity-60"
                >
                  {settings.efforts.map((e) => (
                    <option key={e} value={e}>{`${e} — ${EFFORT_NOTES[e] || ''}`}</option>
                  ))}
                </select>
                {settings.env.effort
                  ? <EnvNote name="ANTHROPIC_EFFORT" />
                  : <p className="text-xs text-ink-muted">Higher effort gives more thorough answers but takes longer and uses more tokens.</p>}
              </div>
            </div>
          </Panel>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => save()} disabled={saving || !dirty}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? (newKey.trim() ? 'Checking key…' : 'Saving…') : 'Save changes'}
            </Button>
            <Button variant="outline" onClick={test} disabled={testing || !settings.has_key}>
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              Test connection
            </Button>
            {testResult && (
              <p className={cn('flex items-center gap-1.5 text-sm', testResult.ok ? 'text-success-fg' : 'text-danger-fg')}>
                {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {testResult.message}
              </p>
            )}
          </div>
        </div>

        {/* How-to */}
        <Panel title="How to get an API key" className="h-fit">
          <ol className="list-decimal space-y-2 pl-4 text-[13px] leading-5 text-ink-secondary">
            <li>Sign in to the Anthropic Console (create an account and add billing if needed).</li>
            <li>Open <span className="font-medium text-ink">Settings → API keys</span> and choose <span className="font-medium text-ink">Create key</span>.</li>
            <li>Copy the key (it starts with <code className="rounded-sm bg-subtle px-1 text-[11px]">sk-ant-</code>) and paste it here, then save.</li>
          </ol>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
              Open Anthropic Console <ExternalLink />
            </a>
          </Button>
          <div className="mt-5 border-t border-line pt-4 text-xs leading-5 text-ink-muted">
            Usage is billed to your Anthropic account. The assistant only reads each person's own records (plus company-wide counts for admins) and can't change anything.
          </div>
        </Panel>
      </div>
    </PageShell>
  );
};

export default AssistantSettingsPage;
