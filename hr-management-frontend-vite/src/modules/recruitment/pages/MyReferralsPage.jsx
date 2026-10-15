import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users2, UserPlus, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, LoadingState, EmptyState, ErrorState, TableCard, StatCard } from '../components/Common';
import { API, errorMessage, fmtAgo, fmtDate } from '../lib';

const STATUS_STYLE = {
  'In review': 'bg-slate-100 text-slate-700',
  Interviewing: 'bg-indigo-100 text-indigo-700',
  'Offer stage': 'bg-amber-100 text-amber-800',
  Hired: 'bg-emerald-100 text-emerald-700',
  'Not selected': 'bg-zinc-200 text-zinc-600',
  Withdrawn: 'bg-zinc-200 text-zinc-600',
};

export default function MyReferralsPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/referrals/my`)
      .then(res => { if (alive) { setList(res.data || []); setError(null); } })
      .catch(e => { if (alive) setError(errorMessage(e, 'Could not load your referrals')); });
    return () => { alive = false; };
  }, [reloadKey]);

  const doExport = () => exportCsv('my-referrals', list || [], [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'job_title', label: 'Role' },
    { key: 'status', label: 'Status' },
    { label: 'Referred on', value: r => fmtDate(r.created_at, 'yyyy-MM-dd') },
  ]);

  const count = (s) => (list || []).filter(r => r.status === s).length;

  return (
    <PageShell>
      <PageHeader icon={Users2} title="My Referrals" subtitle="Track the people you have referred">
        <Button variant="outline" onClick={doExport} disabled={!list?.length} className="gap-2 h-9"><Download className="w-4 h-4" /> Export CSV</Button>
        <Button asChild className="gap-2 h-9"><Link to="/recruitment/refer"><UserPlus className="w-4 h-4" /> Refer someone</Link></Button>
      </PageHeader>

      {list && list.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          <StatCard label="Referred" value={list.length} />
          <StatCard label="In progress" value={list.filter(r => !r.is_closed).length} />
          <StatCard label="Interviewing" value={count('Interviewing')} />
          <StatCard label="Hired" value={count('Hired')} />
        </div>
      )}

      <TableCard>
        {error ? <ErrorState message={error} onRetry={() => setReloadKey(k => k + 1)} /> : !list ? <LoadingState /> : list.length === 0 ? (
          <EmptyState icon={Users2} title="You haven't referred anyone yet" hint="Great people know great people.">
            <Button asChild><Link to="/recruitment/refer">Refer a candidate</Link></Button>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Person</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Role</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Referred</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{r.name}</p>
                      <p className="text-xs text-slate-500 truncate max-w-[220px]">{r.email}</p>
                      <p className="text-xs text-slate-500 sm:hidden">{r.job_title}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-slate-700">{r.job_title}</td>
                    <td className="px-4 py-3">
                      <Badge className={`${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs`}>{r.status}</Badge>
                      <p className="text-[11px] text-slate-400 mt-0.5">updated {fmtAgo(r.updated_at)}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-600 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
    </PageShell>
  );
}
