import React, { useState, useEffect, useCallback } from 'react';
import { GitBranch, Plus, Trash2, ArrowUp, ArrowDown, Save, UserCheck, Download, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import { fmtKey, errorText } from '../lib';
import ApprovalChain from '../components/ApprovalChain';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EMPTY_DELEGATION = { delegate_email: '', delegator_email: '', start_date: todayStr(), end_date: '', reason: '' };
const TYPE_LABELS = { manager: 'Reporting manager', admin: 'Any HR / admin', user: 'Specific person' };

const delegationState = (d) => {
  if (d.status === 'cancelled') return { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600' };
  if (d.is_current) return { label: 'Active now', cls: 'bg-emerald-100 text-emerald-700' };
  if (d.is_upcoming) return { label: 'Upcoming', cls: 'bg-sky-100 text-sky-700' };
  return { label: 'Ended', cls: 'bg-slate-100 text-slate-600' };
};

const ApprovalSettingsPage = () => {
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';

  // Delegation
  const [approvers, setApprovers] = useState([]);
  const [delegations, setDelegations] = useState([]);
  const [loadingDelegations, setLoadingDelegations] = useState(true);
  const [form, setForm] = useState(EMPTY_DELEGATION);
  const [saving, setSaving] = useState(false);

  // Chain (admin)
  const [settings, setSettings] = useState(null);
  const [chainError, setChainError] = useState(null);
  const [savingChain, setSavingChain] = useState(false);

  const loadDelegations = useCallback(async () => {
    setLoadingDelegations(true);
    try {
      const [dRes, aRes] = await Promise.all([api.get('/v2/leave/delegations'), api.get('/v2/leave/approvers')]);
      setDelegations(dRes.data || []);
      setApprovers(aRes.data || []);
    } catch (err) {
      toast.error(errorText(err, 'Failed to load delegations'));
    } finally {
      setLoadingDelegations(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setChainError(null);
    try {
      const response = await api.get('/v2/leave/approval-settings');
      setSettings(response.data);
    } catch (err) {
      setChainError(errorText(err, 'Failed to load the approval chain'));
    }
  }, []);

  useEffect(() => { loadDelegations(); }, [loadDelegations]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const createDelegation = async () => {
    if (!form.delegate_email) return toast.error('Choose who will approve for you');
    if (!form.start_date || !form.end_date) return toast.error('Pick the start and end dates');
    if (form.end_date < form.start_date) return toast.error('End date must be after the start date');
    setSaving(true);
    try {
      const body = { delegate_email: form.delegate_email, start_date: form.start_date, end_date: form.end_date, reason: form.reason.trim() || null };
      if (isAdmin && form.delegator_email) body.delegator_email = form.delegator_email;
      await api.post('/v2/leave/delegations', body);
      toast.success('Delegation saved');
      setForm(EMPTY_DELEGATION);
      loadDelegations();
    } catch (err) {
      toast.error(errorText(err, 'Failed to save the delegation'));
    } finally {
      setSaving(false);
    }
  };

  const cancelDelegation = async (id) => {
    if (!window.confirm('Cancel this delegation?')) return;
    try {
      await api.delete(`/v2/leave/delegations/${id}`);
      toast.success('Delegation cancelled');
      loadDelegations();
    } catch (err) {
      toast.error(errorText(err, 'Failed to cancel'));
    }
  };

  const updateStep = (idx, patch) => setSettings((s) => ({ ...s, steps: s.steps.map((st, i) => (i === idx ? { ...st, ...patch } : st)) }));
  const moveStep = (idx, delta) => setSettings((s) => {
    const steps = [...s.steps];
    const [item] = steps.splice(idx, 1);
    steps.splice(idx + delta, 0, item);
    return { ...s, steps };
  });
  const removeStep = (idx) => setSettings((s) => ({ ...s, steps: s.steps.filter((_, i) => i !== idx) }));
  const addStep = () => setSettings((s) => ({ ...s, steps: [...s.steps, { name: 'Extra approval', approver_type: 'admin', approver_email: null, min_days: 5 }] }));

  const saveChain = async () => {
    for (const s of settings.steps) {
      if (!s.name?.trim()) return toast.error('Every level needs a name');
      if (s.approver_type === 'user' && !s.approver_email) return toast.error(`Choose the approver for "${s.name}"`);
    }
    if (!settings.steps.some((s) => !Number(s.min_days))) return toast.error('At least one level must apply to every leave (minimum days 0)');
    setSavingChain(true);
    try {
      const body = {
        steps: settings.steps.map((s) => ({
          name: s.name.trim(),
          approver_type: s.approver_type,
          ...(s.approver_type === 'user' ? { approver_email: s.approver_email } : {}),
          min_days: Number(s.min_days) || 0,
        })),
        admin_override: !!settings.admin_override,
      };
      const response = await api.put('/v2/leave/approval-settings', body);
      setSettings(response.data);
      toast.success('Approval chain saved');
    } catch (err) {
      toast.error(errorText(err, 'Failed to save the approval chain'));
    } finally {
      setSavingChain(false);
    }
  };

  const delegateOptions = approvers.filter((a) => a.email !== (form.delegator_email || user?.email));
  const previewChain = (settings?.steps || []).map((s, i) => ({
    level: i + 1,
    name: `${s.name}${Number(s.min_days) > 0 ? ` (> ${s.min_days}d)` : ''}`,
    approver_type: s.approver_type,
    approver_email: s.approver_email,
    approver_name: approvers.find((a) => a.email === s.approver_email)?.full_name || s.approver_email,
    status: 'pending',
  }));

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
            <GitBranch className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              Approvals &amp; Delegation
            </h1>
            <p className="text-xs sm:text-sm text-slate-600">
              {isAdmin ? 'Configure the leave approval chain and hand approvals over while you are away' : 'Hand your leave approvals to someone while you are away'}
            </p>
          </div>
        </div>

        <Tabs defaultValue="delegation" className="space-y-4">
          <TabsList className={`grid w-full sm:w-auto sm:inline-grid ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <TabsTrigger value="delegation">Delegation</TabsTrigger>
            {isAdmin && <TabsTrigger value="chain">Approval chain</TabsTrigger>}
          </TabsList>

          {/* ------------------------------------------------ Delegation */}
          <TabsContent value="delegation" className="space-y-4">
            <Card className="border-0 shadow-md">
              <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2"><UserCheck className="w-5 h-5 text-slate-600" /> New delegation</CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {isAdmin && (
                    <div className="space-y-1.5">
                      <Label>Approver who is away</Label>
                      <Select value={form.delegator_email || 'me'} onValueChange={(v) => setForm({ ...form, delegator_email: v === 'me' ? '' : v, delegate_email: '' })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="me">Me</SelectItem>
                          {approvers.filter((a) => a.email !== user?.email).map((a) => (
                            <SelectItem key={a.email} value={a.email}>{a.full_name} ({a.role})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Delegate to</Label>
                    <Select value={form.delegate_email} onValueChange={(v) => setForm({ ...form, delegate_email: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose a manager or admin" /></SelectTrigger>
                      <SelectContent>
                        {delegateOptions.length === 0 && <SelectItem value="none" disabled>No other managers or admins</SelectItem>}
                        {delegateOptions.map((a) => (
                          <SelectItem key={a.email} value={a.email}>{a.full_name} · {a.role}{a.department ? ` · ${a.department}` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="del-start">From</Label>
                      <Input id="del-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="del-end">To</Label>
                      <Input id="del-end" type="date" min={form.start_date || undefined} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="del-reason">Note <span className="text-slate-400 font-normal">(optional)</span></Label>
                    <Textarea id="del-reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. On leave, travelling" />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  During these dates the delegate sees your pending leave approvals and can approve or reject them; each action records that it was done on your behalf. You can still act yourself.
                </p>
                <Button onClick={createDelegation} disabled={saving} className="gap-2 w-full sm:w-auto">
                  <Plus className="w-4 h-4" /> {saving ? 'Saving…' : 'Delegate approvals'}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md">
              <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base sm:text-lg">{isAdmin ? 'All delegations' : 'Your delegations'}</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!delegations.length}
                  onClick={() => exportCsv('leave-delegations', delegations, [
                    { key: 'delegator_name', label: 'Approver' },
                    { key: 'delegator_email', label: 'Approver email' },
                    { key: 'delegate_name', label: 'Delegate' },
                    { key: 'delegate_email', label: 'Delegate email' },
                    { key: 'start_date', label: 'From' },
                    { key: 'end_date', label: 'To' },
                    { label: 'State', value: (d) => delegationState(d).label },
                    { key: 'reason', label: 'Note' },
                  ])}
                >
                  <Download className="w-3.5 h-3.5" /> Export
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {loadingDelegations ? (
                  <div className="text-center py-10"><div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto" /></div>
                ) : delegations.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">No delegations yet.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {delegations.map((d) => {
                      const st = delegationState(d);
                      const given = d.delegator_email === user?.email;
                      const received = d.delegate_email === user?.email;
                      return (
                        <div key={d.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-900 text-sm">{d.delegator_name} → {d.delegate_name}</p>
                              <Badge className={`${st.cls} hover:opacity-90 text-[10px]`}>{st.label}</Badge>
                              {received && <Badge variant="outline" className="text-[10px]">For you</Badge>}
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5">{fmtKey(d.start_date, 'dd MMM yyyy')} – {fmtKey(d.end_date, 'dd MMM yyyy')}</p>
                            {d.reason && <p className="text-xs text-slate-500 mt-0.5">{d.reason}</p>}
                          </div>
                          {d.status === 'active' && !d.is_expired && (given || isAdmin) && (
                            <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1 self-start sm:self-auto" onClick={() => cancelDelegation(d.id)}>
                              <XCircle className="w-3.5 h-3.5" /> Cancel
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------ Chain (admin) */}
          {isAdmin && (
            <TabsContent value="chain" className="space-y-4">
              {chainError ? (
                <Card><CardContent className="p-6 text-center space-y-3">
                  <p className="text-sm text-red-600">{chainError}</p>
                  <Button variant="outline" size="sm" onClick={loadSettings} className="gap-2"><RefreshCw className="w-4 h-4" /> Retry</Button>
                </CardContent></Card>
              ) : !settings ? (
                <div className="text-center py-10"><div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto" /></div>
              ) : (
                <Card className="border-0 shadow-md">
                  <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                    <CardTitle className="text-base sm:text-lg">Approval levels</CardTitle>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                      Leave moves through these levels in order. A level with “minimum days” only applies to leave longer than that.
                      Changes apply to leave applied from now on.
                    </p>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-5 space-y-3">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Preview</p>
                      <ApprovalChain chain={previewChain} compact />
                    </div>

                    {settings.steps.map((step, idx) => (
                      <div key={idx} className="rounded-lg border border-slate-200 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge className="bg-slate-800 hover:bg-slate-800">Level {idx + 1}</Badge>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0} onClick={() => moveStep(idx, -1)} aria-label="Move up"><ArrowUp className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === settings.steps.length - 1} onClick={() => moveStep(idx, 1)} aria-label="Move down"><ArrowDown className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" disabled={settings.steps.length === 1} onClick={() => removeStep(idx)} aria-label="Remove level"><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input value={step.name} maxLength={60} onChange={(e) => updateStep(idx, { name: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Approver</Label>
                            <Select value={step.approver_type} onValueChange={(v) => updateStep(idx, { approver_type: v, approver_email: v === 'user' ? step.approver_email : null })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Person</Label>
                            <Select value={step.approver_email || ''} onValueChange={(v) => updateStep(idx, { approver_email: v })} disabled={step.approver_type !== 'user'}>
                              <SelectTrigger><SelectValue placeholder={step.approver_type === 'user' ? 'Choose' : '—'} /></SelectTrigger>
                              <SelectContent>
                                {approvers.map((a) => <SelectItem key={a.email} value={a.email}>{a.full_name} ({a.role})</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Only when leave is longer than (days)</Label>
                            <Input type="number" min="0" step="0.5" value={step.min_days ?? 0} onChange={(e) => updateStep(idx, { min_days: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    ))}

                    {settings.steps.length < 5 && (
                      <Button variant="outline" onClick={addStep} className="w-full gap-2"><Plus className="w-4 h-4" /> Add level</Button>
                    )}

                    <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <div>
                        <Label className="font-medium">Admin approval is final</Label>
                        <p className="text-xs text-slate-500 mt-0.5">
                          When on, an admin approving at any level completes the remaining levels (the original behaviour). When off, admins approve only HR/admin levels, one level at a time.
                        </p>
                      </div>
                      <Switch checked={!!settings.admin_override} onCheckedChange={(v) => setSettings({ ...settings, admin_override: v })} />
                    </div>

                    <Button onClick={saveChain} disabled={savingChain} className="gap-2 w-full sm:w-auto">
                      <Save className="w-4 h-4" /> {savingChain ? 'Saving…' : 'Save approval chain'}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default ApprovalSettingsPage;
