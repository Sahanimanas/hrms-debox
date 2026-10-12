import React, { useCallback, useEffect, useState } from 'react';
import { History, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import ChangeBadge from '../components/ChangeBadge';
import { PageShell, SectionCard, LoadingBlock, EmptyBlock, ErrorBlock } from '../components/PayrollUI';
import { API, errMsg, fmtINR, monthLabel, fmtDate } from '../lib';

const earnings = (structure) => (structure?.components || []).filter(c => c.type === 'earning');
const compAmount = (c, ctc) => (c.is_percentage ? (ctc * c.amount) / 100 : c.calculated_amount ?? c.amount);

export default function MySalaryHistoryPage() {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${API}/my/revisions`);
      setRevisions(res.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load salary history'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const exportRows = () => exportCsv('my-salary-history', revisions, [
    { key: 'effective_from', label: 'Effective from' }, { key: 'previous_gross', label: 'Previous monthly gross' },
    { key: 'new_gross', label: 'New monthly gross' }, { key: 'reason', label: 'Reason' },
  ]);

  return (
    <PageShell
      icon={History}
      title="My Salary History"
      subtitle="Your salary revisions and the structure in force from each date"
      actions={<Button variant="outline" onClick={exportRows} disabled={!revisions.length} className="gap-2 h-9 sm:h-10"><Download className="w-4 h-4" /> Export CSV</Button>}
    >
      <SectionCard icon={History} title="Revisions" bodyClassName="p-0">
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : revisions.length === 0 ? (
          <EmptyBlock icon={History} title="No salary history yet" />
        ) : (
          <ol className="divide-y divide-slate-100">
            {revisions.map((r) => {
              const ctc = r.structure?.basic_salary || 0;
              return (
                <li key={r.id} className="p-3 sm:p-5 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <p className="font-semibold text-slate-900">From {monthLabel(r.effective_from, true)}</p>
                      <p className="text-xs text-slate-500">{r.reason} · recorded {fmtDate(r.created_at)}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-lg font-bold text-slate-900">{fmtINR(r.new_gross, 0)}<span className="text-xs font-normal text-slate-500"> / month</span></p>
                      <div className="flex sm:justify-end items-center gap-2 text-xs text-slate-500">
                        {r.previous_gross != null && <span>was {fmtINR(r.previous_gross, 0)}</span>}
                        <ChangeBadge previous={r.previous_gross} next={r.new_gross} />
                      </div>
                    </div>
                  </div>
                  {earnings(r.structure).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {earnings(r.structure).map((c) => (
                        <span key={c.name} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {c.name}: {fmtINR(compAmount(c, ctc), 0)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </SectionCard>
    </PageShell>
  );
}
