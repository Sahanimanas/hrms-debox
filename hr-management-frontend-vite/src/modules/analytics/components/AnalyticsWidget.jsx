import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ArrowRight } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';
import ChartTooltip from './ChartTooltip';
import { SERIES, fmtPct, monthLabel } from '../lib';

const Stat = ({ label, value, note, children }) => (
  <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 min-w-0">
    <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
    <p className="text-lg sm:text-2xl font-semibold text-slate-900 mt-0.5">{value ?? '—'}</p>
    {note && <p className="text-[11px] text-slate-500 truncate">{note}</p>}
    {children}
  </div>
);

/** Admin dashboard: headcount, attrition, today's attendance and open positions. */
const AnalyticsWidget = () => {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/v2/analytics/summary')
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;
  const t = data?.today;

  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 sm:pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base sm:text-lg md:text-xl font-semibold text-slate-900 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            <BarChart3 className="w-5 h-5 text-slate-600" /> Workforce at a glance
          </CardTitle>
          <Link to="/analytics/people" className="text-xs sm:text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1">
            Analytics <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-6 pt-0 sm:pt-0 md:pt-0">
        <div className={`grid grid-cols-2 ${data?.open_positions != null ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-2 sm:gap-3 ${data ? '' : 'opacity-50'}`}>
          <Stat label="Headcount" value={data?.headcount} note={data ? `${data.joiners_this_month} joined this month` : null}>
            {data?.trend?.length > 1 && (
              <div className="h-8 mt-1" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <Tooltip content={<ChartTooltip labelFormatter={monthLabel} />} />
                    <Line type="monotone" dataKey="headcount" name="Headcount" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Stat>
          <Stat label="Attrition (12 mo)" value={data ? fmtPct(data.attrition_12m_pct) : null} note={data ? `${data.leavers_last_12_months} leaver(s)` : null} />
          <Stat
            label="Attendance today"
            value={t ? (t.attendance_pct == null ? '—' : fmtPct(t.attendance_pct)) : null}
            note={t ? (t.attendance_pct == null ? 'Nothing marked yet' : `${t.present} present · ${t.absent} absent · ${t.on_leave} on leave`) : null}
          />
          {data?.open_positions != null && <Stat label="Open positions" value={data.open_positions} />}
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalyticsWidget;
