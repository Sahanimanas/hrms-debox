import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserCog, Download, Check, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, fmtDate, REQUEST_STATUS, humanize } from '../lib';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, StatusPill, NativeSelect, Avatar } from '../components/ui';

const show = (v) => (v == null || v === ''
  ? <span className="text-slate-400 italic">empty</span>
  : /^[a-z_]+$/.test(String(v)) ? humanize(String(v)) : String(v));

const ProfileRequestsPage = () => {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/profile-requests`, { params: status === 'all' ? {} : { status } });
      setList(r.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load requests'));
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const approve = async (req) => {
    setBusy(req.id);
    try {
      await api.post(`${API}/profile-requests/${req.id}/approve`, {});
      toast.success('Changes applied');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to approve'));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (reason.trim().length < 3) return toast.error('Please give a reason');
    setBusy(rejecting.id);
    try {
      await api.post(`${API}/profile-requests/${rejecting.id}/reject`, { reason: reason.trim() });
      toast.success('Request rejected');
      setRejecting(null);
      setReason('');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to reject'));
    } finally {
      setBusy(null);
    }
  };

  const pending = useMemo(() => list.filter(r => r.status === 'pending').length, [list]);

  const doExport = () => exportCsv('profile-change-requests', list.flatMap(r => r.changes.map(c => ({ ...r, change: c }))), [
    { key: 'employee_name', label: 'Employee' },
    { key: 'employee_uid', label: 'Employee ID' },
    { label: 'Field', value: r => r.change.label },
    { label: 'From', value: r => r.change.from ?? '' },
    { label: 'To', value: r => r.change.to ?? '' },
    { key: 'status', label: 'Status' },
    { label: 'Requested', value: r => r.created_at?.slice(0, 10) },
    { key: 'reviewed_by_name', label: 'Reviewed by' },
    { key: 'rejection_reason', label: 'Rejection reason' },
  ]);

  return (
    <PageShell>
      <PageHeader icon={UserCog} title="Profile Change Requests" subtitle="Approve employees' updates to their personal details" />
      <SectionCard
        icon={UserCog}
        title={<span className="flex items-center gap-2">Requests {status === 'pending' && pending > 0 && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{pending} pending</Badge>}</span>}
        actions={(
          <>
            <NativeSelect value={status} onChange={setStatus} className="w-36 h-8">
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </NativeSelect>
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={doExport} disabled={!list.length}><Download className="w-3.5 h-3.5" />Export CSV</Button>
          </>
        )}
      >
        {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : list.length === 0 ? (
          <Empty icon={UserCog} title={status === 'pending' ? 'No pending requests' : 'No requests'} />
        ) : (
          <div className="divide-y divide-slate-100">
            {list.map(req => (
              <div key={req.id} className="p-3 sm:p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={req.employee_name} size="sm" />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{req.employee_name}</p>
                      <p className="text-xs text-slate-500">{req.employee_uid} · {req.department || '—'} · {fmtDate(req.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill map={REQUEST_STATUS} status={req.status} />
                    {req.status === 'pending' && (
                      <>
                        <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={busy === req.id} onClick={() => approve(req)}><Check className="w-3.5 h-3.5" />Approve</Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1 text-red-600 hover:bg-red-50" onClick={() => { setRejecting(req); setReason(''); }}><X className="w-3.5 h-3.5" />Reject</Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {req.changes.map(c => (
                    <div key={c.field} className="px-3 py-2 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 text-sm">
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{c.label}</span>
                      <span className="flex flex-wrap items-center gap-2 break-words">
                        <span className="text-slate-500 line-through decoration-slate-300">{show(c.from)}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-900">{show(c.to)}</span>
                      </span>
                    </div>
                  ))}
                </div>
                {req.reason && <p className="text-xs text-slate-600">Reason: {req.reason}</p>}
                {req.status === 'rejected' && <p className="text-xs text-red-600">Rejected by {req.reviewed_by_name}: {req.rejection_reason}</p>}
                {req.status === 'approved' && <p className="text-xs text-emerald-700">Approved by {req.reviewed_by_name} on {fmtDate(req.reviewed_at)}</p>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Reject request</DialogTitle></DialogHeader>
          <Textarea rows={3} placeholder="Reason (shown to the employee)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button onClick={reject} disabled={!!busy} className="bg-red-600 hover:bg-red-700">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default ProfileRequestsPage;
