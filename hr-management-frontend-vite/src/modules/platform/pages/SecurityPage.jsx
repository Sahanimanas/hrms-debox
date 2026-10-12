import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, KeyRound, Copy, Download, RefreshCw, Smartphone, Lock, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import PageHeader, { PageShell, LoadingBlock, ErrorBlock } from '../components/PageHeader';
import { errorMessage, fmtDate, copyWithToast } from '../lib';

const downloadCodes = (codes) => {
  const blob = new Blob([`Xeno-HR backup codes\nGenerated ${new Date().toISOString()}\nEach code works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'xeno-hr-backup-codes.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const BackupCodesDialog = ({ codes, onClose }) => (
  <Dialog open={!!codes} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Save your backup codes</DialogTitle>
        <DialogDescription>
          Each code can be used once if you lose access to your authenticator app. They won't be shown again.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono text-sm" data-testid="backup-codes">
        {(codes || []).map(c => <span key={c} className="text-center py-1">{c}</span>)}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" className="gap-1.5" onClick={() => copyWithToast(codes.join('\n'), 'Backup codes copied')}>
          <Copy className="w-4 h-4" /> Copy
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={() => downloadCodes(codes)}>
          <Download className="w-4 h-4" /> Download
        </Button>
        <Button className="bg-slate-800 hover:bg-slate-900" onClick={onClose}>I've saved them</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

const TwoFactorCard = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enrolment, setEnrolment] = useState(null); // { qr_code, secret, otpauth_url }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);
  const [dialog, setDialog] = useState(null); // 'disable' | 'regenerate'
  const [form, setForm] = useState({ password: '', code: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/platform/2fa/status');
      setStatus(r.data);
    } catch (e) {
      setError(errorMessage(e, 'Could not load two-factor status'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const r = await api.post('/v2/platform/2fa/setup');
      setEnrolment(r.data);
      setCode('');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not start setup'));
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/v2/platform/2fa/enable', { code });
      setEnrolment(null);
      setCodes(r.data.backup_codes);
      toast.success('Two-factor authentication is on');
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'That code did not work'));
    } finally {
      setBusy(false);
    }
  };

  const submitDialog = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (dialog === 'disable') {
        await api.post('/v2/platform/2fa/disable', form);
        toast.success('Two-factor authentication turned off');
      } else {
        const r = await api.post('/v2/platform/2fa/backup-codes', { code: form.code });
        setCodes(r.data.backup_codes);
      }
      setDialog(null);
      setForm({ password: '', code: '' });
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Request failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg flex flex-wrap items-center gap-2">
          <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
          Two-factor authentication
          {status && (status.enabled
            ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">On</Badge>
            : <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">Off</Badge>)}
          {status?.required && !status.enabled && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Required for admins</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : status.enabled ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-8 h-8 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm text-slate-800">Your account asks for a code from your authenticator app when you sign in.</p>
                <p className="text-xs text-slate-500 mt-1">
                  Enabled {fmtDate(status.enabled_at)} · {status.backup_codes_remaining} backup code{status.backup_codes_remaining === 1 ? '' : 's'} left
                </p>
                {status.backup_codes_remaining <= 2 && (
                  <p className="text-xs text-amber-700 mt-1">You're running low on backup codes — generate new ones.</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => setDialog('regenerate')}>
                <RefreshCw className="w-4 h-4" /> New backup codes
              </Button>
              <Button variant="outline" className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDialog('disable')}>
                <ShieldOff className="w-4 h-4" /> Turn off
              </Button>
            </div>
          </div>
        ) : enrolment ? (
          <form onSubmit={enable} className="grid md:grid-cols-[auto,1fr] gap-5 items-start">
            <img src={enrolment.qr_code} alt="QR code for your authenticator app" className="w-48 h-48 mx-auto border border-slate-200 rounded-lg bg-white p-1" />
            <div className="space-y-3">
              <ol className="text-sm text-slate-700 list-decimal pl-5 space-y-1">
                <li>Open Google Authenticator, Microsoft Authenticator, 1Password or a similar app.</li>
                <li>Scan the QR code (or enter the key below).</li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <div>
                <Label className="text-xs text-slate-500">Setup key</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 min-w-0 break-all text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5">{enrolment.secret}</code>
                  <Button type="button" size="icon" variant="ghost" aria-label="Copy key" onClick={() => copyWithToast(enrolment.secret, 'Setup key copied')}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label htmlFor="totp-code">Code from the app</Label>
                <Input id="totp-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="mt-1 w-40 tracking-[0.3em]" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || code.length !== 6} className="bg-slate-800 hover:bg-slate-900">{busy ? 'Checking…' : 'Turn on'}</Button>
                <Button type="button" variant="ghost" onClick={() => setEnrolment(null)}>Cancel</Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              Add a second step to sign-in: after your password, enter a code from an authenticator app on your phone.
            </p>
            <Button onClick={startSetup} disabled={busy} className="bg-slate-800 hover:bg-slate-900 gap-1.5 shrink-0">
              <ShieldCheck className="w-4 h-4" /> Set up
            </Button>
          </div>
        )}
      </CardContent>

      <BackupCodesDialog codes={codes} onClose={() => setCodes(null)} />

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) { setDialog(null); setForm({ password: '', code: '' }); } }}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submitDialog}>
            <DialogHeader>
              <DialogTitle>{dialog === 'disable' ? 'Turn off two-factor authentication' : 'Generate new backup codes'}</DialogTitle>
              <DialogDescription>
                {dialog === 'disable'
                  ? 'Confirm with your password and a code from your app (or a backup code).'
                  : 'Your old backup codes will stop working. Enter a current code from your app.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              {dialog === 'disable' && (
                <div>
                  <Label htmlFor="disable-password">Password</Label>
                  <Input id="disable-password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1" />
                </div>
              )}
              <div>
                <Label htmlFor="dialog-code">Code</Label>
                <Input id="dialog-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} autoComplete="one-time-code" maxLength={32} className="mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || !form.code || (dialog === 'disable' && !form.password)} className={dialog === 'disable' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'}>
                {busy ? 'Working…' : dialog === 'disable' ? 'Turn off' : 'Generate'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

const AdminSecurityCard = () => {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [domains, setDomains] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get('/v2/platform/security/settings');
      setSettings(r.data);
      setDomains((r.data.sso_allowed_domains || []).join(', '));
    } catch (e) {
      setError(errorMessage(e, 'Could not load security settings'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setSaving(true);
    try {
      const r = await api.put('/v2/platform/security/settings', patch);
      setSettings(s => ({ ...s, ...r.data }));
      setDomains((r.data.sso_allowed_domains || []).join(', '));
      toast.success('Security settings saved');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save settings'));
    } finally {
      setSaving(false);
    }
  };

  const parsedDomains = domains.split(/[\s,]+/).map(d => d.trim().toLowerCase()).filter(Boolean);

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
          Organization security
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {error ? <ErrorBlock message={error} onRetry={load} /> : !settings ? <LoadingBlock /> : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Require two-factor authentication for admins</p>
                <p className="text-xs text-slate-500">Admins without 2FA are asked to set it up right after signing in.</p>
              </div>
              <Switch checked={!!settings.require_admin_2fa} disabled={saving} onCheckedChange={(v) => save({ require_admin_2fa: v })} aria-label="Require 2FA for admins" />
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-slate-500" />
                <p className="text-sm font-medium text-slate-900">Single sign-on</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className={settings.sso_providers?.google ? 'border-emerald-300 text-emerald-700' : 'text-slate-500'}>
                  Google: {settings.sso_providers?.google ? 'configured' : 'not configured'}
                </Badge>
                <Badge variant="outline" className={settings.sso_providers?.microsoft ? 'border-emerald-300 text-emerald-700' : 'text-slate-500'}>
                  Microsoft: {settings.sso_providers?.microsoft ? `configured (${settings.sso_providers.microsoft_tenant})` : 'not configured'}
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                Providers are enabled by the server administrator (GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID). Existing users sign in with the same email address.
              </p>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-900">Create accounts automatically</p>
                  <p className="text-xs text-slate-500">New people from the domains below get an employee account on their first SSO sign-in.</p>
                </div>
                <Switch
                  checked={!!settings.sso_auto_provision}
                  disabled={saving}
                  onCheckedChange={(v) => save(v ? { sso_auto_provision: true, sso_allowed_domains: parsedDomains } : { sso_auto_provision: false })}
                  aria-label="Auto-provision SSO users"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, example.in" aria-label="Allowed domains" />
                <Button variant="outline" disabled={saving} onClick={() => save({ sso_allowed_domains: parsedDomains })}>Save domains</Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const SecurityPage = () => {
  const { user } = getAuth();
  return (
    <PageShell>
      <PageHeader icon={KeyRound} title="Security" subtitle="Protect your account with two-factor authentication" />
      <TwoFactorCard />
      {user?.role === 'admin' && <AdminSecurityCard />}
    </PageShell>
  );
};

export default SecurityPage;
