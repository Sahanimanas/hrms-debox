import React, { useCallback, useEffect, useState } from 'react';
import { FileCheck2, Download, ChevronDown, ChevronUp, Paperclip, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, SectionCard, LoadingBlock, EmptyBlock, ErrorBlock, StatusPill } from '../components/PayrollUI';
import { API, errMsg, fmtINR, recentFys, fmtDate, ITEM_STATUS_STYLES, SECTION_LABELS, blobErrMsg, openProof } from '../lib';

export default function DeclarationsReviewPage() {
  const fys = recentFys(4);
  const [fy, setFy] = useState(fys[0]);
  const [status, setStatus] = useState('pending');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [action, setAction] = useState(null); // { declaration, item, type }
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${API}/declarations`, { params: { fy, status: status === 'pending' ? 'pending' : undefined } });
      setList(res.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load declarations'));
    } finally {
      setLoading(false);
    }
  }, [fy, status]);

  useEffect(() => { load(); }, [load]);

  const startAction = (declaration, item, type) => {
    setAction({ declaration, item, type });
    setAmount(String(item.declared_amount));
    setReason('');
  };

  const submit = async () => {
    const { declaration, item, type } = action;
    if (type === 'reject' && !reason.trim()) return toast.error('Give a reason');
    setSaving(true);
    try {
      const res = await api.post(`${API}/declarations/${declaration.id}/items/${item.id}/verify`, type === 'approve'
        ? { action: 'approve', approved_amount: Number(amount) }
        : { action: 'reject', reason: reason.trim() });
      setList(l => l.map(d => (d.id === declaration.id ? res.data : d)));
      toast.success(type === 'approve' ? 'Approved' : 'Rejected');
      setAction(null);
    } catch (e) {
      toast.error(errMsg(e, 'Could not update'));
    } finally {
      setSaving(false);
    }
  };

  const viewProof = async (declaration, item, proof) => {
    try {
      await openProof(declaration.id, item.id, proof);
    } catch (e) {
      toast.error(await blobErrMsg(e, 'Could not open the file'));
    }
  };

  const exportRows = () => exportCsv(`declarations-${fy}`, list.flatMap(d => d.items.map(i => ({ d, i }))), [
    { label: 'Employee', value: r => r.d.employee_name },
    { label: 'Email', value: r => r.d.employee_email },
    { label: 'Regime', value: r => r.d.tax_regime },
    { label: 'Section', value: r => r.i.section },
    { label: 'Item', value: r => r.i.label },
    { label: 'Declared', value: r => r.i.declared_amount },
    { label: 'Status', value: r => r.i.status },
    { label: 'Approved', value: r => r.i.approved_amount ?? '' },
    { label: 'Proofs', value: r => r.i.proofs?.length || 0 },
    { label: 'Landlord PAN', value: r => r.i.landlord_pan || '' },
    { label: 'Rejection reason', value: r => r.i.rejection_reason || '' },
  ]);

  return (
    <PageShell
      icon={FileCheck2}
      title="Declarations Review"
      subtitle="Verify employees' investment declarations and proofs (old-regime TDS)"
      actions={<Button variant="outline" onClick={exportRows} disabled={!list.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>}
    >
      <SectionCard
        icon={FileCheck2}
        title={`Declarations (${list.length})`}
        actions={(
          <>
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{fys.map(f => <SelectItem key={f} value={f}>FY {f}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Needs review</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      >
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : list.length === 0 ? (
          <EmptyBlock icon={FileCheck2} title={status === 'pending' ? 'Nothing waiting for review' : 'No declarations for this year'} />
        ) : (
          <div className="divide-y divide-slate-100">
            {list.map((d) => {
              const open = expanded === d.id;
              return (
                <div key={d.id}>
                  <button type="button" className="w-full text-left p-3 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50" onClick={() => setExpanded(open ? null : d.id)}>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{d.employee_name}</p>
                      <p className="text-xs text-slate-500">
                        {d.tax_regime === 'old' ? 'Old regime' : 'New regime'} · declared {fmtINR(d.summary.declared, 0)} · approved {fmtINR(d.summary.approved, 0)} · counted for TDS {fmtINR(d.summary.counted, 0)} · updated {fmtDate(d.updated_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {d.summary.pending_items > 0 && <StatusPill status="declared" styles={ITEM_STATUS_STYLES} label={`${d.summary.pending_items} to verify`} />}
                      {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>
                  {open && (
                    <div className="px-3 sm:px-4 pb-4 space-y-2">
                      {d.tax_regime === 'new' && <p className="text-xs text-amber-700">This employee chose the new regime — declarations don't affect their TDS.</p>}
                      {d.items.map((item) => (
                        <div key={item.id} className="rounded-lg border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-900">{item.label}</span>
                              <StatusPill status={item.status} styles={ITEM_STATUS_STYLES} />
                            </div>
                            <p className="text-xs text-slate-500">{SECTION_LABELS[item.section] || item.section}</p>
                            <p className="text-sm mt-0.5">
                              Declared {fmtINR(item.declared_amount, 0)}
                              {item.status === 'approved' && <> · approved <b>{fmtINR(item.approved_amount, 0)}</b></>}
                            </p>
                            {item.section === 'HRA' && <p className="text-xs text-slate-500">Landlord: {item.landlord_name || '—'} {item.landlord_pan ? `(${item.landlord_pan})` : ''} {d.metro_city ? '· metro' : '· non-metro'}</p>}
                            {item.rejection_reason && <p className="text-xs text-red-600">Rejected: {item.rejection_reason}</p>}
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {(item.proofs || []).length === 0 && <span className="text-xs text-slate-400">No proofs uploaded</span>}
                              {(item.proofs || []).map(p => (
                                <button key={p.id} type="button" onClick={() => viewProof(d, item, p)} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                                  <Paperclip className="w-3 h-3" />{p.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" variant="outline" className="h-8 gap-1 text-emerald-700" onClick={() => startAction(d, item, 'approve')}><Check className="w-3.5 h-3.5" /> Approve</Button>
                            <Button size="sm" variant="outline" className="h-8 gap-1 text-red-600" onClick={() => startAction(d, item, 'reject')}><X className="w-3.5 h-3.5" /> Reject</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action?.type === 'approve' ? 'Approve' : 'Reject'} — {action?.item.label}</DialogTitle>
            <DialogDescription>{action?.declaration.employee_name} declared {fmtINR(action?.item.declared_amount, 0)}</DialogDescription>
          </DialogHeader>
          {action?.type === 'approve' ? (
            <div className="space-y-1.5">
              <Label htmlFor="appr">Approved amount (₹)</Label>
              <Input id="appr" type="number" min="0" max={action.item.declared_amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-slate-500">Approve less than declared if the proofs cover only part of it.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rej">Reason</Label>
              <Input id="rej" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Receipt not legible" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className={action?.type === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}>
              {saving ? 'Saving…' : action?.type === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
