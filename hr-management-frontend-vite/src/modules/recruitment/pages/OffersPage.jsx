import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake, Download, FileDown, Send, UserCheck, Search, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, LoadingState, EmptyState, ErrorState, StatusBadge, TableCard, StatCard } from '../components/Common';
import { RespondDialog, ConvertDialog } from '../components/OfferDialogs';
import { API, currentUser, downloadFile, errorMessage, fmtDate, fmtInr } from '../lib';

const STATUSES = ['all', 'draft', 'sent', 'accepted', 'declined', 'expired'];

export default function OffersPage() {
  const isAdmin = currentUser().role === 'admin';
  const [offers, setOffers] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [respondOffer, setRespondOffer] = useState(null);
  const [convertOffer, setConvertOffer] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/offers`)
      .then(res => { if (alive) { setOffers(res.data || []); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, 'Could not load offers')); });
    return () => { alive = false; };
  }, [reloadKey]);
  const reload = () => setReloadKey(k => k + 1);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (offers || []).filter(o => (status === 'all' || o.status === status)
      && (!q || [o.candidate_name, o.candidate_email, o.designation, o.job_title].some(v => String(v || '').toLowerCase().includes(q))));
  }, [offers, status, query]);

  const stats = useMemo(() => {
    const all = offers || [];
    const count = (s) => all.filter(o => o.status === s).length;
    const decided = count('accepted') + count('declined') + count('expired');
    return { pending: count('sent'), accepted: count('accepted'), drafts: count('draft'), rate: decided ? Math.round((count('accepted') / decided) * 100) : null };
  }, [offers]);

  const approve = async (o) => {
    try {
      await api.post(`${API}/offers/${o.id}/approve`);
      toast.success('Offer approved');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const send = async (o) => {
    try {
      await api.post(`${API}/offers/${o.id}/send`);
      toast.success('Offer marked as sent');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const pdf = async (o) => {
    try { await downloadFile(`${API}/offers/${o.id}/pdf`, 'offer-letter.pdf'); } catch (e) { toast.error(e.message); }
  };

  const doExport = () => exportCsv('offers', visible, [
    { key: 'candidate_name', label: 'Candidate' },
    { key: 'candidate_email', label: 'Email' },
    { key: 'job_title', label: 'Job' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { key: 'ctc', label: 'CTC (INR)' },
    { key: 'joining_date', label: 'Joining date' },
    { key: 'expiry_date', label: 'Valid until' },
    { key: 'status', label: 'Status' },
    { label: 'Sent', value: o => (o.sent_at ? fmtDate(o.sent_at, 'yyyy-MM-dd') : '') },
    { key: 'employee_code', label: 'Employee ID' },
  ]);

  return (
    <PageShell>
      <PageHeader icon={Handshake} title="Offers" subtitle={isAdmin ? 'Offer letters, responses and conversion to employees' : 'Offers for the roles you are hiring for (read-only)'}>
        <Button variant="outline" onClick={doExport} disabled={!visible.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>
      </PageHeader>

      {offers && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <StatCard label="Awaiting response" value={stats.pending} />
          <StatCard label="Accepted" value={stats.accepted} />
          <StatCard label="Drafts" value={stats.drafts} />
          <StatCard label="Acceptance rate" value={stats.rate == null ? '—' : `${stats.rate}%`} />
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
        <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter by status">
          {STATUSES.map(s => (
            <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs sm:text-sm capitalize whitespace-nowrap border ${status === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search offers" className="pl-8 h-9 bg-white" aria-label="Search offers" />
        </div>
      </div>

      <TableCard>
        {error ? <ErrorState message={error} onRetry={reload} /> : !offers ? <LoadingState /> : visible.length === 0 ? (
          <EmptyState icon={Handshake} title="No offers" hint="Offers are created from a candidate's profile." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Candidate</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">CTC</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Dates</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(o => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/recruitment/candidates/${o.candidate_id}`} className="font-medium text-slate-900 hover:underline">{o.candidate_name}</Link>
                      <p className="text-xs text-slate-500">{o.designation} · {o.department}</p>
                      <p className="text-xs text-slate-500 md:hidden">{fmtInr(o.ctc)}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap">{fmtInr(o.ctc)}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs text-slate-600 whitespace-nowrap">
                      <p>Joins {fmtDate(o.joining_date)}</p>
                      <p>Valid until {fmtDate(o.expiry_date)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={o.status} />
                      {o.requires_approval && o.status === 'draft' && <p className="text-[11px] text-amber-700 mt-1">Outside salary band · needs approval</p>}
                      {o.employee_code && <p className="text-[11px] text-emerald-700 mt-1">{o.employee_code}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => pdf(o)} aria-label="Download offer letter"><FileDown className="w-4 h-4" /></Button>
                        {isAdmin && o.status === 'draft' && o.requires_approval && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => approve(o)}><CheckCircle2 className="w-3.5 h-3.5" /> Approve</Button>}
                        {isAdmin && o.status === 'draft' && !o.requires_approval && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => send(o)}><Send className="w-3.5 h-3.5" /> Sent</Button>}
                        {isAdmin && o.status === 'sent' && <Button size="sm" variant="outline" className="h-8" onClick={() => setRespondOffer(o)}>Response</Button>}
                        {isAdmin && o.status === 'accepted' && !o.employee_id && (
                          <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setConvertOffer(o)}><UserCheck className="w-3.5 h-3.5" /> Convert</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      <RespondDialog offer={respondOffer} onClose={() => setRespondOffer(null)} onSaved={reload} />
      <ConvertDialog offer={convertOffer} onClose={() => setConvertOffer(null)} onDone={reload} />
    </PageShell>
  );
}
