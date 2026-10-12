import React, { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { API, fmtDate, fromNow } from '../../lib';
import { Avatar, Empty, Loading } from '../../components/Shared';

const PAGE = 50;

/** Full project activity feed, grouped by day, with "load more". */
export default function ActivityTab({ project, onOpen }) {
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);

  const load = useCallback((before) => api.get(`${API}/projects/${project.id}/activity`, { params: { limit: PAGE, ...(before ? { before } : {}) } })
    .then(r => {
      setItems(prev => (before ? [...(prev || []), ...r.data] : r.data));
      setMore(r.data.length === PAGE);
    })
    .catch(() => setItems(prev => prev || [])), [project.id]);

  useEffect(() => { load(); }, [load]);

  if (!items) return <Loading />;
  if (!items.length) return <Empty icon={Activity} title="No activity yet" />;

  const dayOf = (a) => fmtDate(a.at, 'EEEE, dd MMM yyyy');
  return (
    <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <ol className="space-y-3">
        {items.map((a, i) => {
          const day = dayOf(a);
          const header = i === 0 || day !== dayOf(items[i - 1]);
          return (
            <React.Fragment key={a.id}>
              {header && <li className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{day}</li>}
              <li className="flex items-start gap-2.5 text-sm">
                <Avatar name={a.actor_name} size="sm" />
                <p className="text-slate-600 min-w-0">
                  <span className="font-medium text-slate-900">{a.actor_name}</span> {a.action}{' '}
                  {a.task_key && (a.task_id ? <button type="button" onClick={() => onOpen(a.task_id)} className="font-medium text-slate-800 hover:underline">{a.task_key}</button> : <span className="font-medium">{a.task_key}</span>)}
                  {a.detail && <span className="text-slate-500"> — {a.detail}</span>}
                  <span className="text-[11px] text-slate-400"> · {fromNow(a.at)}</span>
                </p>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      {more && <Button variant="outline" size="sm" className="mt-4" onClick={() => load(items[items.length - 1].at)}>Load more</Button>}
    </div>
  );
}
