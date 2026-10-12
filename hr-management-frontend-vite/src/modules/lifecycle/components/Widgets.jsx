// Dashboard widgets for the lifecycle module.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, UserCog, LogOut, Hourglass, FolderLock, ClipboardCheck, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { API } from '../lib';
import { ProgressBar } from './ui';

/** New joiner's checklist progress, or onboarding tasks assigned to me. Renders nothing otherwise. */
export const MyOnboardingWidget = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`${API}/onboarding/my`).then(r => { if (alive) setData(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return null;
  const c = data.checklist;
  const openAssigned = (data.assigned_tasks || []).filter(t => !t.done).length;
  if ((!c || c.status !== 'in_progress') && !openAssigned) return null;

  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Rocket className="w-5 h-5" /></div>
          {c && c.status === 'in_progress' ? (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">Your onboarding · {c.progress}%</p>
              <ProgressBar value={c.progress} className="mt-1.5" />
              <p className="text-xs text-slate-500 mt-1">{c.total_tasks - c.done_tasks} task(s) left</p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Onboarding tasks for new joiners</p>
              <p className="text-xs text-slate-500">{openAssigned} open task(s) assigned to you</p>
            </div>
          )}
        </div>
        <Link to={c && c.status === 'in_progress' ? '/my-onboarding' : '/my-onboarding?tab=assigned'} className="text-sm font-medium text-slate-800 inline-flex items-center gap-1 hover:underline">
          Open <ChevronRight className="w-4 h-4" />
        </Link>
      </CardContent>
    </Card>
  );
};

/** Admin / manager: lifecycle items that need attention. */
export const PeoplePulseWidget = () => {
  const { user } = getAuth();
  const [s, setS] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`${API}/summary`).then(r => { if (alive) setS(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!s) return null;
  const isAdmin = user?.role === 'admin';
  const items = [
    isAdmin && { label: 'Profile change requests', value: s.pending_profile_requests, href: '/profile-requests', icon: UserCog, tone: 'text-blue-600 bg-blue-50' },
    { label: 'Pending resignations', value: s.pending_resignations, href: '/offboarding', icon: LogOut, tone: 'text-amber-600 bg-amber-50' },
    { label: 'Probation ending ≤ 30 days', value: s.probation_due, href: '/probation', icon: Hourglass, tone: 'text-purple-600 bg-purple-50' },
    { label: 'Onboarding in progress', value: s.onboarding_in_progress, href: '/onboarding', icon: ClipboardCheck, tone: 'text-emerald-600 bg-emerald-50' },
    isAdmin && { label: 'Documents expiring', value: s.documents_expiring, href: '/documents?tab=expiring', icon: FolderLock, tone: 'text-rose-600 bg-rose-50' },
  ].filter(Boolean);
  if (items.every(i => !i.value) && !s.on_notice) return null;

  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 px-1">People — needs attention</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {items.map(i => {
            const Icon = i.icon;
            return (
              <Link key={i.label} to={i.href} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2 sm:p-3 hover:bg-slate-50 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${i.tone}`}><Icon className="w-4 h-4" /></div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900 leading-none">{i.value}</p>
                  <p className="text-[11px] text-slate-500 truncate">{i.label}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
