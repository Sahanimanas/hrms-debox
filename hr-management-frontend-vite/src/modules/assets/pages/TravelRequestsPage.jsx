import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plane, Plus, Download, CheckCircle, XCircle, Banknote, Receipt, Ban, ArrowRight, FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageHeader, Pill, Loading, Empty, ErrorState, Field } from '../components/Shared';
import { TRAVEL_STATUS, TRAVEL_MODES, TIER_LABELS, inr, fmtDate, isoDay, errorText, getCurrentUser, humanize } from '../lib';

const modeLabel = (m) => TRAVEL_MODES.find(x => x.value === m)?.label || m;

export default function TravelRequestsPage() {
  const user = getCurrentUser();
  const role = user?.role;
  const [params, setParams] = useSearchParams();
  const tabs = [
    { value: 'mine', label: 'My trips' },
    ...(role === 'manager' || role === 'admin' ? [{ value: 'approvals', label: 'Approvals' }] : []),
    ...(role === 'manager' ? [{ value: 'team', label: 'Team' }] : []),
    ...(role === 'admin' ? [{ value: 'all', label: 'All trips' }] : []),
  ];
  const tab = tabs.some(t => t.value === params.get('tab')) ? params.get('tab') : 'mine';
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/v2/assets/travel', { params: { scope: tab } });
      setTrips(data);
    } catch (err) {
      setError(errorText(err, 'Failed to load travel requests'));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (statusFilter === 'all' ? trips : trips.filter(t => t.status === statusFilter)), [trips, statusFilter]);

  const doExport = () => exportCsv(`travel-${tab}`, shown, [
    { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'purpose', label: 'Purpose' },
    { key: 'from_city', label: 'From' }, { key: 'to_city', label: 'To' },
    { label: 'Start', value: r => isoDay(r.start_date) }, { label: 'End', value: r => isoDay(r.end_date) }, { key: 'days', label: 'Days' },
    { label: 'Mode', value: r => modeLabel(r.travel_mode) }, { label: 'Accommodation', value: r => (r.accommodation_needed ? 'yes' : 'no') },
    { key: 'estimated_cost', label: 'Estimated cost' }, { key: 'advance_requested', label: 'Advance requested' },
    { key: 'advance_status', label: 'Advance status' }, { label: 'Per-diem', value: r => r.per_diem?.amount },
    { label: 'Status', value: r => TRAVEL_STATUS[r.status]?.label || r.status },
  ]);

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="w-full space-y-5 sm:space-y-6">
        <PageHeader icon={Plane} title="Travel" subtitle="Travel requests, approvals, advances and trip expenses">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={doExport} disabled={!shown.length}><Download className="w-4 h-4" /> Export CSV</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> New travel request</Button>
        </PageHeader>

        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {tabs.length > 1 ? (
                <Tabs value={tab} onValueChange={(v) => setParams(v === 'mine' ? {} : { tab: v }, { replace: true })}>
                  <TabsList className="bg-slate-100">{tabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
                </Tabs>
              ) : <p className="font-semibold text-slate-900">My trips</p>}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(TRAVEL_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : shown.length === 0 ? (
              <Empty icon={Plane} title={tab === 'approvals' ? 'Nothing waiting for your approval' : 'No travel requests'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Trip</th>
                      {tab !== 'mine' && <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Employee</th>}
                      <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Dates</th>
                      <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">Estimate</th>
                      <th className="text-left font-medium px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(t.id)}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900 flex items-center gap-1">{t.from_city} <ArrowRight className="w-3 h-3" /> {t.to_city}</p>
                          <p className="text-xs text-slate-500 truncate max-w-[240px]">{t.purpose}</p>
                          <p className="text-[11px] text-slate-400 md:hidden">{fmtDate(t.start_date, 'dd MMM')} – {fmtDate(t.end_date, 'dd MMM yyyy')}</p>
                        </td>
                        {tab !== 'mine' && <td className="px-4 py-3 hidden sm:table-cell"><p>{t.employee_name}</p><p className="text-xs text-slate-500">{t.department}</p></td>}
                        <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap">{fmtDate(t.start_date, 'dd MMM')} – {fmtDate(t.end_date, 'dd MMM yyyy')}<p className="text-[11px] text-slate-500">{t.days} day(s) · {modeLabel(t.travel_mode)}</p></td>
                        <td className="px-4 py-3 hidden lg:table-cell">{inr(t.estimated_cost)}{t.advance_requested > 0 && <p className="text-[11px] text-slate-500">Advance {inr(t.advance_requested)} · {humanize(t.advance_status)}</p>}</td>
                        <td className="px-4 py-3"><Pill map={TRAVEL_STATUS} value={t.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {newOpen && <NewTripDialog onClose={() => setNewOpen(false)} onCreated={() => { setParams({}, { replace: true }); load(); }} />}
      {openId && <TripDialog id={openId} user={user} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

const EMPTY_TRIP = { purpose: '', from_city: '', to_city: '', start_date: '', end_date: '', travel_mode: 'flight', accommodation_needed: false, estimated_cost: '', advance_requested: '', notes: '' };

function NewTripDialog({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_TRIP);
  const [perDiem, setPerDiem] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  useEffect(() => {
    if (!form.to_city.trim() || !form.start_date || !form.end_date || form.end_date < form.start_date) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get('/v2/assets/per-diem/calculate', { params: { city: form.to_city.trim(), start_date: form.start_date, end_date: form.end_date } })
        .then(r => { if (!cancelled) setPerDiem(r.data); })
        .catch(() => { if (!cancelled) setPerDiem(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.to_city, form.start_date, form.end_date]);

  const previewValid = perDiem && form.to_city.trim() && form.start_date && form.end_date && form.end_date >= form.start_date
    && perDiem.city?.toLowerCase() === form.to_city.trim().toLowerCase();

  const submit = async () => {
    if (form.purpose.trim().length < 5) return toast.error('Describe the purpose of the trip');
    if (!form.from_city.trim() || !form.to_city.trim()) return toast.error('Enter the from and to cities');
    if (!form.start_date || !form.end_date) return toast.error('Pick the travel dates');
    if (form.end_date < form.start_date) return toast.error('End date cannot be before start date');
    if (form.estimated_cost === '') return toast.error('Enter an estimated cost');
    setSaving(true);
    try {
      await api.post('/v2/assets/travel', {
        ...form,
        purpose: form.purpose.trim(),
        from_city: form.from_city.trim(),
        to_city: form.to_city.trim(),
        estimated_cost: Number(form.estimated_cost),
        advance_requested: form.advance_requested === '' ? 0 : Number(form.advance_requested),
      });
      toast.success('Travel request submitted');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to submit travel request'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Plane className="w-5 h-5" /> New travel request</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tr-purpose">Purpose</Label>
            <Textarea id="tr-purpose" rows={2} value={form.purpose} onChange={set('purpose')} placeholder="e.g. Customer workshop at Acme Mumbai" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="tr-from">From</Label><Input id="tr-from" value={form.from_city} onChange={set('from_city')} placeholder="Bengaluru" /></div>
            <div className="space-y-1.5"><Label htmlFor="tr-to">To</Label><Input id="tr-to" value={form.to_city} onChange={set('to_city')} placeholder="Mumbai" /></div>
            <div className="space-y-1.5"><Label htmlFor="tr-start">Start date</Label><Input id="tr-start" type="date" value={form.start_date} onChange={set('start_date')} /></div>
            <div className="space-y-1.5"><Label htmlFor="tr-end">End date</Label><Input id="tr-end" type="date" min={form.start_date || undefined} value={form.end_date} onChange={set('end_date')} /></div>
            <div className="space-y-1.5">
              <Label>Travel mode</Label>
              <Select value={form.travel_mode} onValueChange={set('travel_mode')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TRAVEL_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm mt-6"><Switch checked={form.accommodation_needed} onCheckedChange={set('accommodation_needed')} /> Accommodation needed</label>
            <div className="space-y-1.5"><Label htmlFor="tr-est">Estimated cost (₹)</Label><Input id="tr-est" type="number" min="0" value={form.estimated_cost} onChange={set('estimated_cost')} /></div>
            <div className="space-y-1.5"><Label htmlFor="tr-adv">Advance needed (₹)</Label><Input id="tr-adv" type="number" min="0" value={form.advance_requested} onChange={set('advance_requested')} placeholder="0" /></div>
          </div>
          {previewValid && (
            <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-800">
              Per-diem: {TIER_LABELS[perDiem.tier]} city · {inr(perDiem.rate)}/day × {perDiem.days} day(s) = <span className="font-semibold">{inr(perDiem.amount)}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="tr-notes">Notes <span className="text-slate-400 font-normal">(optional)</span></Label>
            <Textarea id="tr-notes" rows={2} value={form.notes} onChange={set('notes')} />
          </div>
          <p className="text-[11px] text-slate-500">Your manager approves first, then an admin gives final approval.</p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TripDialog({ id, user, onClose, onChanged }) {
  const [trip, setTrip] = useState(null);
  const [error, setError] = useState(null);
  const [comments, setComments] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get(`/v2/assets/travel/${id}`);
      setTrip(data);
    } catch (err) {
      setError(errorText(err, 'Failed to load trip'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (path, body, success) => {
    setBusy(true);
    try {
      await api.post(`/v2/assets/travel/${id}/${path}`, body);
      toast.success(success);
      setComments('');
      await load();
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = user?.role === 'admin';
  const mine = trip?.employee_email === user?.email;
  const s = trip?.summary;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {error ? <ErrorState message={error} onRetry={load} /> : !trip ? <Loading /> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {trip.from_city} <ArrowRight className="w-4 h-4" /> {trip.to_city} <Pill map={TRAVEL_STATUS} value={trip.status} />
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-slate-700">{trip.purpose}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Employee">{trip.employee_name}</Field>
                <Field label="Dates">{fmtDate(trip.start_date, 'dd MMM')} – {fmtDate(trip.end_date, 'dd MMM yyyy')} ({trip.days}d)</Field>
                <Field label="Mode">{modeLabel(trip.travel_mode)}{trip.accommodation_needed ? ' + stay' : ''}</Field>
                <Field label="Manager">{trip.manager_name || '—'}</Field>
              </div>
              {trip.notes && <p className="text-xs text-slate-500 italic">{trip.notes}</p>}

              {s && (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Expenses</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <Field label="Estimated">{inr(s.estimated_cost)}</Field>
                    <Field label="Claimed">{inr(s.total_claimed)} <span className="text-xs text-slate-500">({s.claim_count})</span></Field>
                    <Field label={`Per-diem (${TIER_LABELS[trip.per_diem?.tier] || ''})`}>{inr(s.per_diem_amount)}</Field>
                    <Field label="Total entitlement"><span className={s.over_estimate ? 'text-amber-700 font-medium' : ''}>{inr(s.total_entitlement)}</span>{s.over_estimate && <p className="text-[11px] text-amber-600">{inr(s.variance_vs_estimate)} over estimate</p>}</Field>
                    <Field label="Advance paid">{inr(s.advance_disbursed)}{trip.advance_requested > 0 && trip.advance_status !== 'disbursed' && <p className="text-[11px] text-slate-500">{inr(trip.advance_requested)} requested</p>}</Field>
                    <Field label="To settle">
                      <span className={s.balance < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>{inr(Math.abs(s.balance))}</span>
                      <p className="text-[11px] text-slate-500">{s.settlement_direction === 'payable_to_employee' ? 'payable to employee' : s.settlement_direction === 'recoverable_from_employee' ? 'to be returned by employee' : 'nothing due'}</p>
                    </Field>
                  </div>
                  {s.claims.length > 0 && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
                      {s.claims.map(c => (
                        <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="truncate">{c.title} <span className="text-xs text-slate-500">· {c.category}</span></span>
                          <span className="whitespace-nowrap">{inr(c.amount)} <span className={`text-[11px] ${c.status === 'rejected' ? 'text-red-600' : 'text-slate-500'}`}>{c.status}</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {mine && trip.status === 'approved' && (
                    <Link to="/myreimbursements" className="text-xs text-sky-700 hover:underline inline-flex items-center gap-1"><Receipt className="w-3.5 h-3.5" /> Add an expense claim for this trip</Link>
                  )}
                </div>
              )}

              {trip.approvals?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Approvals</p>
                  {trip.approvals.map((a, i) => (
                    <p key={i} className="text-xs text-slate-700">
                      {a.action === 'approved' ? <CheckCircle className="w-3.5 h-3.5 inline text-emerald-600 mr-1" /> : <XCircle className="w-3.5 h-3.5 inline text-red-600 mr-1" />}
                      {humanize(a.stage)} · {a.by_name} · {fmtDate(a.at, 'dd MMM, HH:mm')}{a.comments ? ` — “${a.comments}”` : ''}
                    </p>
                  ))}
                </div>
              )}
              {trip.advance_status === 'disbursed' && (
                <p className="text-xs text-slate-600"><Banknote className="w-3.5 h-3.5 inline mr-1" /> Advance {inr(trip.advance_disbursed_amount)} paid {fmtDate(trip.advance_disbursed_at)}{trip.advance_reference ? ` · ref ${trip.advance_reference}` : ''}</p>
              )}
              {trip.settlement && <p className="text-xs text-purple-700"><FileCheck className="w-3.5 h-3.5 inline mr-1" /> Settled {fmtDate(trip.settled_at)} · balance {inr(Math.abs(trip.settlement.balance))}{trip.settlement.comments ? ` — ${trip.settlement.comments}` : ''}</p>}

              {(trip.can_act || (isAdmin && trip.status === 'approved')) && (
                <div className="space-y-1.5">
                  <Label htmlFor="trip-comments">Comments</Label>
                  <Textarea id="trip-comments" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} placeholder={trip.can_act ? 'Required when rejecting' : 'Optional'} />
                </div>
              )}
              {isAdmin && trip.status === 'approved' && trip.advance_requested > 0 && trip.advance_status !== 'disbursed' && (
                <div className="space-y-1.5">
                  <Label htmlFor="trip-ref">Payment reference</Label>
                  <Input id="trip-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. NEFT UTR" />
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
              {mine && ['pending_manager', 'pending_admin', 'approved'].includes(trip.status) && trip.advance_status !== 'disbursed' && (
                <Button variant="ghost" className="text-red-600 hover:bg-red-50 gap-1" disabled={busy} onClick={() => act('cancel', {}, 'Travel request cancelled')}><Ban className="w-4 h-4" /> Cancel trip</Button>
              )}
              {trip.can_act && (
                <>
                  <Button variant="outline" className="gap-1 text-red-600" disabled={busy} onClick={() => (comments.trim().length < 3 ? toast.error('Add a reason for rejecting') : act('reject', { comments: comments.trim() }, 'Travel request rejected'))}><XCircle className="w-4 h-4" /> Reject</Button>
                  <Button className="gap-1" disabled={busy} onClick={() => act('approve', { comments: comments.trim() }, trip.status === 'pending_manager' ? 'Approved — sent to admin' : 'Travel approved')}><CheckCircle className="w-4 h-4" /> Approve</Button>
                </>
              )}
              {isAdmin && !trip.can_act && trip.status === 'pending_manager' && (
                <Button variant="outline" className="gap-1 text-red-600" disabled={busy} onClick={() => (comments.trim().length < 3 ? toast.error('Add a reason for rejecting') : act('reject', { comments: comments.trim() }, 'Travel request rejected'))}><XCircle className="w-4 h-4" /> Reject</Button>
              )}
              {isAdmin && trip.status === 'approved' && trip.advance_requested > 0 && trip.advance_status !== 'disbursed' && (
                <Button variant="outline" className="gap-1" disabled={busy} onClick={() => act('advance', { reference: reference.trim() || null }, 'Advance marked as paid')}><Banknote className="w-4 h-4" /> Mark advance paid</Button>
              )}
              {isAdmin && trip.status === 'approved' && (
                <Button className="gap-1 bg-purple-600 hover:bg-purple-700" disabled={busy} onClick={() => act('settle', { comments: comments.trim() }, 'Trip settled')}><FileCheck className="w-4 h-4" /> Settle trip</Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
