import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, CalendarClock, ArrowRight, Video, MapPin, PhoneCall, ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';
import { API, fmtDate, isStaff } from '../lib';

const MODE_ICONS = { video: Video, onsite: MapPin, phone: PhoneCall };

/**
 * Dashboard card: hiring numbers for admins / managers, plus the viewer's
 * upcoming interviews and pending scorecards. Renders nothing for employees
 * with no interviews.
 */
export default function RecruitmentWidget() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/summary`).then(r => { if (alive) setData(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const staff = isStaff() && data.open_jobs !== undefined;
  const upcoming = data.my_upcoming_interviews || [];
  if (!staff && !upcoming.length && !data.pending_scorecards) return null;

  const tiles = staff ? [
    { label: 'Open jobs', value: data.open_jobs, href: '/recruitment/jobs' },
    { label: 'New applicants (7d)', value: data.new_applications_7d, href: '/recruitment/candidates' },
    { label: 'Interviews this week', value: data.interviews_this_week, href: '/recruitment/interviews' },
    { label: 'Offers pending', value: data.offers_awaiting_response, href: '/recruitment/offers' },
  ] : [];

  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 sm:pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base sm:text-lg font-semibold text-slate-900 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          <Briefcase className="w-5 h-5 text-slate-600" /> Recruitment
        </CardTitle>
        <Link to={staff ? '/recruitment/jobs' : '/recruitment/interviews'} className="text-xs sm:text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1">
          Open <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-6 pt-0 sm:pt-0 md:pt-0 space-y-4">
        {staff && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {tiles.map(t => (
              <Link key={t.label} to={t.href} className="rounded-lg bg-slate-50 hover:bg-slate-100 p-3">
                <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">{t.label}</p>
                <p className="text-xl font-bold text-slate-900">{t.value ?? 0}</p>
              </Link>
            ))}
          </div>
        )}
        {staff && data.pending_requisitions > 0 && (
          <Link to="/recruitment/requisitions" className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 rounded-md px-3 py-2 hover:bg-amber-100">
            <ClipboardList className="w-4 h-4" /> {data.pending_requisitions} requisition{data.pending_requisitions > 1 ? 's' : ''} awaiting approval
          </Link>
        )}
        {data.pending_scorecards > 0 && (
          <Link to="/recruitment/interviews" className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 rounded-md px-3 py-2 hover:bg-amber-100">
            <CalendarClock className="w-4 h-4" /> {data.pending_scorecards} scorecard{data.pending_scorecards > 1 ? 's' : ''} waiting for your feedback
          </Link>
        )}
        {upcoming.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Your upcoming interviews</p>
            <ul className="divide-y divide-slate-100">
              {upcoming.map(i => {
                const Icon = MODE_ICONS[i.mode] || CalendarClock;
                return (
                  <li key={i.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{i.candidate_name} <span className="font-normal text-slate-500">· {i.round_name}</span></p>
                      <p className="text-xs text-slate-500 truncate">{i.job_title}</p>
                    </div>
                    <span className="text-xs text-slate-600 flex items-center gap-1 whitespace-nowrap"><Icon className="w-3.5 h-3.5" />{fmtDate(i.scheduled_at, 'dd MMM, h:mm a')}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
