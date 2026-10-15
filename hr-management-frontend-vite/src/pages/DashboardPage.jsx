import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, ClipboardCheck, SquareCheck, Plane, Download, Plus, Palmtree, Thermometer, Briefcase } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ds';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import ClockWidget from '@/components/ClockWidget';
import PageHeader, { PageShell } from '@/modules/platform/components/PageHeader';
import { moduleDashboardWidgets } from '@/modules/registry';
import AttendanceOverview from './dashboard/AttendanceOverview';
import {
  PendingApprovalsPanel, RecentLeavesPanel, WhosOutPanel, ComingUpPanel, LeaveBalancePanel,
} from './dashboard/DashboardPanels';

// These module widgets are rendered natively by the dashboard sections below
const NATIVE_WIDGETS = new Set(['leave-whos-out-today', 'celebrations']);

const greeting = (d = new Date()) => {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const DashboardPage = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(null);
  const [whosOut, setWhosOut] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [joiners, setJoiners] = useState(null);
  const { user } = getAuth();
  const role = user?.role;
  const isAdmin = role === 'admin';
  const isApprover = role === 'admin' || role === 'manager';

  const fetchStats = useCallback(async () => {
    try {
      const response = await api.get('/dashboard/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const response = await api.get('/leaves/pending');
      setPending(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch pending leaves:', error);
      setPending([]);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    api.get('/v2/leave/whos-out-today')
      .then(r => setWhosOut(r.data))
      .catch(() => setWhosOut(false));
  }, [fetchStats]);

  useEffect(() => {
    if (!isApprover) return;
    fetchPending();
    if (isAdmin) {
      api.get('/v2/analytics/summary')
        .then(r => setJoiners(r.data?.joiners_this_month ?? null))
        .catch(() => setJoiners(null));
    }
  }, [isApprover, isAdmin, fetchPending]);

  const handleApprovalActed = () => {
    fetchPending();
    fetchStats();
  };

  const handleAttendance = useCallback((data, range) => setAttendance({ data, range }), []);

  const exportAttendance = () => {
    const daily = attendance?.data?.daily || [];
    const late = new Map((attendance?.data?.late_trend || []).map(d => [d.date, d.late_arrivals]));
    exportCsv(`attendance-overview-${attendance?.range || 'week'}`, daily, [
      { key: 'date', label: 'Date' },
      { key: 'active_headcount', label: 'Headcount' },
      { key: 'present', label: 'Present' },
      { key: 'half_day', label: 'Half day' },
      { label: 'Late arrivals', value: (r) => late.get(r.date) || 0 },
      { key: 'absent', label: 'Absent' },
      { key: 'on_leave', label: 'On leave' },
      { key: 'unmarked', label: 'Unmarked' },
      { key: 'attendance_pct', label: 'Attendance %' },
      { key: 'holiday_name', label: 'Holiday' },
    ]);
  };

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-24 text-sm text-ink-muted">Loading...</div>
      </PageShell>
    );
  }

  // ----- Derived numbers -----
  const firstName = (user?.full_name || '').trim().split(/\s+/)[0];
  const daily = attendance?.data?.daily || [];
  const todayRow = daily[daily.length - 1] || null;
  const presentToday = todayRow ? (todayRow.present || 0) + (todayRow.half_day || 0) : null;

  const outPeople = whosOut ? new Set((whosOut.out || []).map(e => e.employee_email || e.employee_id || e.employee_name)).size : null;
  const outScope = whosOut?.scope === 'admin' ? 'across the company' : whosOut?.scope === 'manager' ? 'in your team' : 'in your department';

  const actionable = (pending || []).filter(l => l.can_act !== false);
  const oldest = (pending || []).reduce((min, l) => {
    const t = l.created_at ? new Date(l.created_at) : null;
    return t && !Number.isNaN(t.getTime()) && (!min || t < min) ? t : min;
  }, null);
  const oldestDays = oldest ? differenceInCalendarDays(new Date(), oldest) : null;
  const oldestText = oldestDays == null ? null : oldestDays <= 0 ? 'oldest today' : `oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'}`;

  const balance = stats?.my_leave_balance;
  const recentSubtitle = isAdmin ? 'Across all departments' : role === 'manager' ? 'From your team' : 'Your latest requests';
  const widgets = moduleDashboardWidgets
    .filter(w => !w.roles || w.roles.includes(role))
    .filter(w => !NATIVE_WIDGETS.has(w.key));

  return (
    <PageShell>
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        subtitle={`${format(new Date(), 'EEEE, d MMMM yyyy')} · Here’s what’s happening today.`}
      >
        {isApprover && (
          <Button variant="outline" onClick={exportAttendance} disabled={!daily.length} className="[&_svg]:size-[18px]">
            <Download /> Export
          </Button>
        )}
        {balance && (
          <Button asChild className="[&_svg]:size-[18px]">
            <Link to="/leaves"><Plus /> Apply leave</Link>
          </Button>
        )}
      </PageHeader>

      <ClockWidget />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4">
        {isApprover ? (
          <>
            <div data-testid="total-employees-card" className="flex min-w-0">
              <StatCard
                className="flex-1"
                label={isAdmin ? 'Total employees' : 'Team members'}
                value={stats?.total_employees || 0}
                icon={Users}
                tone="accent"
                note={isAdmin && joiners != null ? `${joiners} joined this month` : isAdmin ? 'Active headcount' : 'Reporting to you'}
              />
            </div>
            <StatCard
              label="Present today"
              value={presentToday ?? '—'}
              icon={ClipboardCheck}
              tone="success"
              delta={todayRow?.attendance_pct != null ? `${todayRow.attendance_pct}%` : undefined}
              note={todayRow ? (todayRow.holiday_name ? todayRow.holiday_name : `of ${todayRow.active_headcount} active`) : 'Waiting for attendance data'}
            />
            <div data-testid="pending-leaves-card" className="flex min-w-0">
              <StatCard
                className="flex-1"
                label="Pending approvals"
                value={stats?.pending_leaves || 0}
                icon={SquareCheck}
                tone="warning"
                delta={isAdmin
                  ? <span data-testid="approved-leaves-card">{stats?.approved_leaves_this_month || 0} approved this month</span>
                  : `${actionable.length} need you`}
                deltaTone={isAdmin ? 'success' : 'neutral'}
                note={oldestText || undefined}
              />
            </div>
            <StatCard
              label="On leave today"
              value={outPeople ?? '—'}
              icon={Plane}
              tone="violet"
              note={whosOut?.holiday ? `Holiday — ${whosOut.holiday.name}` : whosOut ? outScope : undefined}
            />
          </>
        ) : (
          <>
            {balance && (
              <div data-testid="leave-balance-card" className="contents">
                <StatCard label="Casual leave" value={balance.casual_leave ?? 0} icon={Palmtree} tone="accent" note="days available" />
                <StatCard label="Sick leave" value={balance.sick_leave ?? 0} icon={Thermometer} tone="danger" note="days available" />
                <StatCard label="Earned leave" value={balance.earned_leave ?? 0} icon={Briefcase} tone="info" note="days available" />
              </div>
            )}
            {whosOut && (
              <StatCard label="Out today" value={outPeople ?? 0} icon={Plane} tone="violet" note={whosOut.holiday ? `Holiday — ${whosOut.holiday.name}` : outScope} />
            )}
          </>
        )}
      </div>

      {/* Attendance & approvals */}
      {isApprover && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <AttendanceOverview onData={handleAttendance} />
          <PendingApprovalsPanel leaves={pending} loading={pending == null} onActed={handleApprovalActed} />
        </div>
      )}

      {/* Leaves & upcoming */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <RecentLeavesPanel
          leaves={stats?.recent_leaves || []}
          subtitle={recentSubtitle}
          viewAllHref={isAdmin ? '/all-leaves' : role === 'manager' ? '/approvals' : '/leaves'}
          className="xl:self-stretch"
        />
        <div className="flex min-w-0 flex-col gap-6">
          {whosOut !== false && <WhosOutPanel data={whosOut} />}
          <ComingUpPanel />
          {isApprover && balance && <LeaveBalancePanel balance={balance} />}
        </div>
      </div>

      {/* Module widgets (announcements, payslips, …) */}
      {widgets.map((w) => { const Widget = w.component; return <Widget key={w.key} />; })}
    </PageShell>
  );
};

export default DashboardPage;
