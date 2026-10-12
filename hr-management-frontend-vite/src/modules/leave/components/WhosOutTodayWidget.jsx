import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, ChevronRight, PartyPopper } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { categoryStyle } from '../lib';

const initials = (name) => {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
};

/** Dashboard card: who is on approved leave today (LV-5). */
const WhosOutTodayWidget = () => {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/v2/leave/whos-out-today')
      .then((response) => { if (alive) setData(response.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return null;

  const out = data?.out || [];
  const shown = out.slice(0, 8);

  return (
    <Card data-testid="whos-out-widget" className="border-slate-100 shadow-sm">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="p-2 bg-slate-800 rounded-lg shrink-0">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 text-sm sm:text-base">Who&apos;s out today</h3>
              <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                {data ? (data.scope === 'admin' ? 'Across the company' : data.scope === 'manager' ? 'Your team' : 'Your department') : 'Loading…'}
              </p>
            </div>
          </div>
          <Link to="/team-calendar" className="text-xs sm:text-sm text-slate-600 hover:text-slate-900 flex items-center gap-0.5 shrink-0">
            Calendar <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {!data ? (
          <div className="h-10 rounded-lg bg-slate-50 animate-pulse" />
        ) : data.holiday && data.holiday.type !== 'optional' && data.holiday.type !== 'restricted' ? (
          <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-3">
            <PartyPopper className="w-4 h-4" /> Holiday today — {data.holiday.name}
          </div>
        ) : out.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3">Everyone&apos;s in today.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {shown.map((e) => {
              const style = categoryStyle(e.category);
              return (
                <div key={e.leave_id} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-3 py-1">
                  <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center justify-center">
                    {initials(e.employee_name)}
                  </span>
                  <span className="text-xs sm:text-sm text-slate-800 max-w-[9rem] truncate">{e.employee_name}</span>
                  <Badge className={`${style.chip} hover:opacity-90 text-[10px] px-1.5 py-0`}>
                    {e.leave_type || e.category}{e.is_half_day ? ' · ½' : ''}
                  </Badge>
                </div>
              );
            })}
            {out.length > shown.length && (
              <span className="text-xs text-slate-500 self-center">+{out.length - shown.length} more</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WhosOutTodayWidget;
