import React from 'react';
import { Link } from 'react-router-dom';
import { Target, ChevronRight, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PF, useApi, fmtDate } from '../lib';

/** Dashboard card listing pending performance actions ("Self review due", "2 goals awaiting your approval"). */
export default function PendingActionsWidget() {
  const state = useApi(`${PF}/pending-actions`);
  const items = state.data?.items || [];
  if (state.error || (!state.loading && !items.length) || (state.loading && !state.data)) return null;
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 sm:pb-2 md:pb-2">
        <CardTitle className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          <Target className="w-5 h-5 text-slate-600" /> Performance to-dos
          <span className="ml-1 text-xs font-medium bg-slate-800 text-white rounded-full px-2 py-0.5">{items.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-6 pt-0 sm:pt-0 md:pt-0">
        <ul className="divide-y divide-slate-100">
          {items.map(i => (
            <li key={i.key}>
              <Link to={i.href} className="flex items-center gap-3 py-2.5 hover:bg-slate-50 rounded-md px-1 -mx-1">
                {i.tone === 'urgent'
                  ? <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  : <span className="w-4 h-4 shrink-0 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /></span>}
                <span className="text-sm text-slate-800 flex-1">{i.label}</span>
                {i.due && <span className="text-xs text-slate-500 whitespace-nowrap hidden sm:inline">due {fmtDate(i.due)}</span>}
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
