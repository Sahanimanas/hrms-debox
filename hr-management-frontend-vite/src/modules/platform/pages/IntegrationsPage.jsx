import React, { useCallback, useEffect, useState } from 'react';
import { Plug, CalendarSync, MessageSquare, Calculator, Copy, RefreshCw, Trash2, Plus, Send, Download, Pencil, History, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format, subMonths } from 'date-fns';
import api from '@/lib/api';
import { getAuth, hasPermission } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import { formatMoney } from '@/lib/money';
import { useOrgPreferences } from '@/lib/orgPreferences';
import PageHeader, { PageShell, LoadingBlock, EmptyBlock, ErrorBlock } from '../components/PageHeader';
import { errorMessage, fmtDateTime, copyWithToast, downloadFile, blobErrorMessage, STATUS_TONES } from '../lib';

// ============= CALENDAR =============

const CalendarTab = () => {
  const [feed, setFeed] = useState(null);
  const [newUrl, setNewUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/platform/calendar/feed');
      setFeed(r.data);
    } catch (e) {
      setError(errorMessage(e, 'Could not load your calendar feed'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post('/v2/platform/calendar/feed');
      setNewUrl(r.data);
      setFeed({ active: true, created_at: r.data.created_at, token_prefix: r.data.token_prefix });
      toast.success(feed?.active ? 'New feed link created — the old one stopped working' : 'Calendar feed created');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not create the feed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete('/v2/platform/calendar/feed');
      setFeed({ active: false });
      setNewUrl(null);
      toast.success('Calendar feed turned off');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not turn off the feed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <CalendarSync className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Calendar sync
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <p className="text-sm text-slate-700">
          Subscribe from Google Calendar or Outlook to see your approved leave, company holidays, interviews you're on and your 1:1s. The link is private — anyone with it can see these events.
        </p>
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : (
          <>
            {newUrl ? (
              <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-medium text-emerald-800">Your private feed URL (copy it now — it won't be shown again)</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 break-all text-xs bg-white border border-emerald-200 rounded px-2 py-1.5" data-testid="calendar-feed-url">{newUrl.url}</code>
                  <Button size="icon" variant="ghost" aria-label="Copy feed URL" onClick={() => copyWithToast(newUrl.url, 'Feed URL copied')}><Copy className="w-4 h-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={newUrl.webcal_url} className="text-xs font-medium text-slate-800 underline">Open in calendar app</a>
                  <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(newUrl.webcal_url)}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-slate-800 underline">Add to Google Calendar</a>
                </div>
              </div>
            ) : feed?.active ? (
              <div className="text-sm text-slate-700">
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 mr-2">Active</Badge>
                Created {fmtDateTime(feed.created_at)}{feed.last_accessed_at ? ` · last synced ${fmtDateTime(feed.last_accessed_at)}` : ' · not synced yet'}
                <p className="text-xs text-slate-500 mt-1">Lost the link? Generate a new one — the old link stops working.</p>
              </div>
            ) : (
              <EmptyBlock icon={CalendarSync} title="No calendar feed yet" />
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={create} disabled={busy} className="bg-slate-800 hover:bg-slate-900 gap-1.5">
                {feed?.active ? <><RefreshCw className="w-4 h-4" /> New link</> : <><Link2 className="w-4 h-4" /> Create feed link</>}
              </Button>
              {feed?.active && (
                <Button variant="outline" onClick={remove} disabled={busy} className="gap-1.5 text-red-600 hover:text-red-700">
                  <Trash2 className="w-4 h-4" /> Turn off
                </Button>
              )}
            </div>
            <div className="text-xs text-slate-500 space-y-1 border-t border-slate-100 pt-3">
              <p><span className="font-medium text-slate-700">Google Calendar:</span> Other calendars → + → From URL → paste the link.</p>
              <p><span className="font-medium text-slate-700">Outlook:</span> Add calendar → Subscribe from web → paste the link.</p>
              <p>Calendar apps refresh subscribed calendars every few hours.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

// ============= SLACK / TEAMS =============

const EMPTY_TARGET = { type: 'slack', name: '', url: '', events: [], enabled: true };

const ChatTab = () => {
  const [targets, setTargets] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // { target|null }
  const [form, setForm] = useState(EMPTY_TARGET);
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState(null); // { target, rows }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, e] = await Promise.all([api.get('/v2/platform/integrations/targets'), api.get('/v2/platform/events')]);
      setTargets(t.data);
      setCatalog(e.data.events);
    } catch (err) {
      setError(errorMessage(err, 'Could not load integrations'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openDialog = (target) => {
    setForm(target ? { type: target.type, name: target.name, url: '', events: target.events, enabled: target.enabled } : EMPTY_TARGET);
    setDialog({ target });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (dialog.target) {
        const body = { name: form.name, events: form.events, enabled: form.enabled };
        if (form.url) body.url = form.url;
        await api.put(`/v2/platform/integrations/targets/${dialog.target.id}`, body);
      } else {
        await api.post('/v2/platform/integrations/targets', form);
      }
      toast.success('Integration saved');
      setDialog(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the integration'));
    } finally {
      setSaving(false);
    }
  };

  const test = async (t) => {
    const id = toast.loading('Sending test message…');
    try {
      const r = await api.post(`/v2/platform/integrations/targets/${t.id}/test`);
      if (r.data.status === 'success') toast.success('Test message delivered', { id });
      else toast.error(`Delivery failed: ${r.data.error || r.data.response_status}`, { id });
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Test failed'), { id });
    }
  };

  const toggle = async (t, enabled) => {
    try {
      await api.put(`/v2/platform/integrations/targets/${t.id}`, { enabled });
      setTargets(list => list.map(x => (x.id === t.id ? { ...x, enabled } : x)));
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update'));
    }
  };

  const remove = async (t) => {
    try {
      await api.delete(`/v2/platform/integrations/targets/${t.id}`);
      toast.success('Integration removed');
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove'));
    }
  };

  const openLog = async (t) => {
    try {
      const r = await api.get(`/v2/platform/integrations/targets/${t.id}/deliveries`);
      setLog({ target: t, rows: r.data });
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load deliveries'));
    }
  };

  const toggleEvent = (name, on) => setForm(f => ({ ...f, events: on ? [...new Set([...f.events, name])] : f.events.filter(x => x !== name) }));

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Slack & Microsoft Teams
          </CardTitle>
          <Button size="sm" onClick={() => openDialog(null)} className="bg-slate-800 hover:bg-slate-900 gap-1.5"><Plus className="w-4 h-4" /> Add</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : targets.length === 0 ? (
          <EmptyBlock icon={MessageSquare} title="No channels connected">
            Post HR events (approved leave, new hires, exits, payroll locked…) to a Slack or Teams channel using an incoming-webhook URL.
          </EmptyBlock>
        ) : (
          <div className="divide-y divide-slate-100">
            {targets.map(t => (
              <div key={t.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">{t.type}</Badge>
                    <p className="font-medium text-slate-900">{t.name}</p>
                    {t.last_delivery_status && <Badge className={`${STATUS_TONES[t.last_delivery_status] || ''} hover:opacity-90 text-[10px]`}>{t.last_delivery_status}</Badge>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 break-all">{t.url_hint}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t.events.includes('*') ? 'All events' : t.events.join(', ')}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch checked={t.enabled} onCheckedChange={(v) => toggle(t, v)} aria-label="Enabled" />
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => test(t)}><Send className="w-3.5 h-3.5" /> Test</Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Delivery log" onClick={() => openLog(t)}><History className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit" onClick={() => openDialog(t)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" aria-label="Delete" onClick={() => remove(t)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>{dialog?.target ? 'Edit channel' : 'Connect a channel'}</DialogTitle>
              <DialogDescription>
                In Slack: Apps → Incoming Webhooks. In Teams: channel → Workflows / Connectors → Incoming Webhook. Paste the URL here.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {!dialog?.target && (
                <div className="flex gap-2">
                  {['slack', 'teams'].map(tp => (
                    <button key={tp} type="button" onClick={() => setForm({ ...form, type: tp })}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm ${form.type === tp ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>
                      {tp === 'slack' ? 'Slack' : 'Microsoft Teams'}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <Label htmlFor="t-name">Name</Label>
                <Input id="t-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="#hr-updates" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="t-url">Webhook URL{dialog?.target && <span className="text-slate-400 font-normal"> (leave blank to keep the current one)</span>}</Label>
                <Input id="t-url" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={form.type === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://….webhook.office.com/…'} className="mt-1" />
              </div>
              <div>
                <Label>Events</Label>
                <label className="flex items-center gap-2 text-sm mt-1">
                  <Checkbox checked={form.events.includes('*')} onCheckedChange={(v) => toggleEvent('*', !!v)} /> All events
                </label>
                {!form.events.includes('*') && (
                  <div className="grid sm:grid-cols-2 gap-1.5 mt-2">
                    {catalog.map(ev => (
                      <label key={ev.name} className="flex items-center gap-2 text-sm text-slate-700">
                        <Checkbox checked={form.events.includes(ev.name)} onCheckedChange={(v) => toggleEvent(ev.name, !!v)} /> {ev.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.name || (!dialog?.target && !form.url) || form.events.length === 0} className="bg-slate-800 hover:bg-slate-900">{saving ? 'Saving…' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!log} onOpenChange={(o) => !o && setLog(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Deliveries — {log?.target?.name}</DialogTitle></DialogHeader>
          {log?.rows?.length ? (
            <div className="divide-y divide-slate-100 text-sm">
              {log.rows.map(d => (
                <div key={d.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-slate-900">{d.event}</p>
                    <p className="text-xs text-slate-500">{fmtDateTime(d.created_at)} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'}{d.error ? ` · ${d.error}` : ''}</p>
                  </div>
                  <Badge className={`${STATUS_TONES[d.status] || ''} hover:opacity-90`}>{d.status}</Badge>
                </div>
              ))}
            </div>
          ) : <EmptyBlock icon={History} title="No deliveries yet" />}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

// ============= ACCOUNTING =============

const AccountingTab = () => {
  const { prefs } = useOrgPreferences();
  const [month, setMonth] = useState(format(subMonths(new Date(), 1), 'yyyy-MM'));
  const [journal, setJournal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [company, setCompany] = useState('');

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/platform/accounting/summary', { params: { month } });
      setJournal(r.data);
    } catch (e) {
      setError(errorMessage(e, 'Could not build the journal'));
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const download = async (kind) => {
    try {
      await downloadFile(`/v2/platform/accounting/${kind}`, { month, ...(company ? { company } : {}) }, `${kind}-payroll-${month}.${kind === 'tally' ? 'xml' : 'csv'}`);
    } catch (e) {
      toast.error(await blobErrorMessage(e, 'Export failed'));
    }
  };

  const money = (n) => formatMoney(n, prefs);
  const empty = journal && journal.employees === 0;

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <Calculator className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Accounting export
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <p className="text-sm text-slate-700">Export a month's payroll as a summarised salary journal for Tally or Zoho Books. Draft payslips are excluded.</p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div>
            <Label htmlFor="acc-month">Month</Label>
            <Input id="acc-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 w-44" />
          </div>
          <div className="flex-1">
            <Label htmlFor="acc-company">Tally company name <span className="text-slate-400 font-normal">(optional)</span></Label>
            <Input id="acc-company" value={company} maxLength={120} onChange={(e) => setCompany(e.target.value)} className="mt-1" placeholder="As it appears in Tally" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => download('tally')} disabled={!journal || empty} className="bg-slate-800 hover:bg-slate-900 gap-1.5"><Download className="w-4 h-4" /> Tally XML</Button>
          <Button onClick={() => download('zoho')} disabled={!journal || empty} variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Zoho Books CSV</Button>
          {journal?.lines?.length > 0 && (
            <Button variant="ghost" className="gap-1.5" onClick={() => exportCsv(`journal-${month}`, journal.lines, [
              { key: 'ledger', label: 'Ledger' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' },
            ])}><Download className="w-4 h-4" /> Export CSV</Button>
          )}
        </div>
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : empty ? (
          <EmptyBlock icon={Calculator} title={`No finalised payslips for ${month}`}>Run and lock payroll for this month first.</EmptyBlock>
        ) : journal?.lines?.length ? (
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Ledger</th>
                  <th className="text-right font-medium px-4 py-2">Debit</th>
                  <th className="text-right font-medium px-4 py-2">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {journal.lines.map(l => (
                  <tr key={l.ledger}>
                    <td className="px-4 py-2 text-slate-800">{l.ledger}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.debit ? money(l.debit) : ''}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.credit ? money(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-2">Total · {journal.employees} employees</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(journal.totals.debit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(journal.totals.credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

// ============= PAGE =============

const IntegrationsPage = () => {
  const { user } = getAuth();
  const [permissions, setPermissions] = useState(null);

  useEffect(() => {
    api.get('/v2/platform/permissions').then(r => setPermissions(r.data.mine)).catch(() => setPermissions([]));
  }, []);

  const canChat = hasPermission(user, permissions, 'integrations.manage');
  const canAccounting = hasPermission(user, permissions, 'payroll.view');

  return (
    <PageShell>
      <PageHeader icon={Plug} title="Integrations" subtitle="Calendar sync, chat notifications and accounting exports" />
      {permissions === null ? <LoadingBlock /> : (
        <Tabs defaultValue="calendar">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            {canChat && <TabsTrigger value="chat">Slack & Teams</TabsTrigger>}
            {canAccounting && <TabsTrigger value="accounting">Accounting</TabsTrigger>}
          </TabsList>
          <TabsContent value="calendar" className="mt-4"><CalendarTab /></TabsContent>
          {canChat && <TabsContent value="chat" className="mt-4"><ChatTab /></TabsContent>}
          {canAccounting && <TabsContent value="accounting" className="mt-4"><AccountingTab /></TabsContent>}
        </Tabs>
      )}
    </PageShell>
  );
};

export default IntegrationsPage;
