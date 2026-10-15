import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, X, Check, FileText, PartyPopper, Cake, Award, CalendarDays } from 'lucide-react';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, IconTile, Panel, StatusBadge } from '@/components/ds';
import { toast } from 'sonner';
import api from '@/lib/api';

// ---------- helpers ----------

const toDate = (d) => (d instanceof Date ? d : typeof d === 'string' && d.length === 10 ? parseISO(d) : new Date(d));

/** "14 – 16 Oct", "13 Oct", "14 Oct +2" for a leave's individual dates. */
const leaveDatesLabel = (leave) => {
  const raw = leave?.dates?.length ? leave.dates : [leave?.start_date, leave?.end_date].filter(Boolean);
  const dates = raw.map(toDate).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  if (!dates.length) return '—';
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (dates.length === 1 || differenceInCalendarDays(last, first) === 0) return format(first, 'd MMM');
  const consecutive = differenceInCalendarDays(last, first) === dates.length - 1 || !leave?.dates?.length;
  if (consecutive) {
    return first.getMonth() === last.getMonth()
      ? `${format(first, 'd')} – ${format(last, 'd MMM')}`
      : `${format(first, 'd MMM')} – ${format(last, 'd MMM')}`;
  }
  return `${format(first, 'd MMM')} +${dates.length - 1}`;
};

const STATUS_LABELS = {
  pending: 'Pending',
  manager_approved: 'Mgr. approved',
  approved: 'Approved',
  rejected: 'Rejected',
};

const halfDayText = (leave) => (leave.is_half_day ? `Half day${leave.half_day_period ? ` (${String(leave.half_day_period).replace(/_/g, ' ')})` : ''}` : null);

const Empty = ({ icon, children }) => {
  const Icon = icon;
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-ink-secondary">
      {Icon && <Icon className="h-8 w-8 text-line-strong" />}
      <p>{children}</p>
    </div>
  );
};

// ---------- Pending approvals ----------

/**
 * Leave requests waiting on the viewer. Approve acts immediately; reject asks
 * for an optional reason. Both go through PUT /leaves/:id/action.
 */
export const PendingApprovalsPanel = ({ leaves, loading, onActed, className }) => {
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [comments, setComments] = useState('');

  const act = async (leave, action, note) => {
    setBusyId(leave.id);
    try {
      await api.put(`/leaves/${leave.id}/action`, { action, comments: note || undefined });
      toast.success(`Leave ${action === 'approve' ? 'approved' : 'rejected'} for ${leave.employee_name}`);
      setRejecting(null);
      setComments('');
      onActed?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to process leave');
    } finally {
      setBusyId(null);
    }
  };

  const shown = (leaves || []).slice(0, 5);
  const count = leaves?.length || 0;

  return (
    <Panel
      title="Pending approvals"
      subtitle={loading ? 'Loading…' : `${count} request${count === 1 ? '' : 's'} waiting`}
      actions={(
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to="/approvals"><ArrowRight /> View all</Link>
        </Button>
      )}
      className={className}
      bodyClassName="-mt-2"
    >
      {loading && !leaves ? (
        <div className="space-y-3 pt-2">
          {[0, 1, 2].map(i => <div key={i} className="h-12 animate-pulse rounded-md bg-subtle" />)}
        </div>
      ) : !shown.length ? (
        <Empty icon={Check}>You&apos;re all caught up.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((leave) => (
            <li key={leave.id} data-testid={`dashboard-approval-${leave.id}`} className="flex items-center gap-3 py-3">
              <Avatar name={leave.employee_name} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-5 text-ink">{leave.employee_name}</p>
                <p className="truncate text-xs font-medium leading-4 text-ink-secondary">
                  {leave.leave_type} · {leave.is_half_day ? 'Half day' : leaveDatesLabel(leave)}
                </p>
              </div>
              {leave.can_act === false ? (
                <span className="max-w-[7.5rem] truncate text-xs text-ink-muted" title={`Waiting for ${leave.current_step_name || 'another approver'}`}>
                  Waiting for {leave.current_step_name || 'another approver'}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid={`dashboard-reject-${leave.id}`}
                    aria-label={`Reject leave for ${leave.employee_name}`}
                    disabled={busyId === leave.id}
                    onClick={() => { setComments(''); setRejecting(leave); }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger-bg text-danger-fg transition-colors hover:bg-danger-solid hover:text-white disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    data-testid={`dashboard-approve-${leave.id}`}
                    aria-label={`Approve leave for ${leave.employee_name}`}
                    disabled={busyId === leave.id}
                    onClick={() => act(leave, 'approve')}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-success-bg text-success-fg transition-colors hover:bg-success-solid hover:text-white disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">Reject leave request</DialogTitle>
          </DialogHeader>
          {rejecting && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md bg-subtle p-3">
                <Avatar name={rejecting.employee_name} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{rejecting.employee_name}</p>
                  <p className="truncate text-xs text-ink-secondary">{rejecting.leave_type} · {leaveDatesLabel(rejecting)}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dashboard-reject-comments" className="text-ink">Reason (optional)</Label>
                <Textarea
                  id="dashboard-reject-comments"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Let them know why…"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              data-testid="dashboard-confirm-reject"
              disabled={!rejecting || busyId === rejecting?.id}
              onClick={() => act(rejecting, 'reject', comments)}
              className="bg-danger-solid text-white hover:bg-danger-fg"
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
};

// ---------- Recent leave requests ----------

export const RecentLeavesPanel = ({ leaves, subtitle, viewAllHref, className }) => (
  <Panel
    title="Recent leave requests"
    subtitle={subtitle}
    actions={viewAllHref && (
      <Button asChild variant="outline" size="sm">
        <Link to={viewAllHref}>View all</Link>
      </Button>
    )}
    className={className}
  >
    {leaves?.length ? (
      <Table className="min-w-[620px]">
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead className="w-[140px]">Type</TableHead>
            <TableHead className="w-[120px]">Dates</TableHead>
            <TableHead className="w-[56px]">Days</TableHead>
            <TableHead className="w-[136px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leaves.map((leave) => (
            <TableRow key={leave.id} data-testid={`recent-leave-${leave.id}`}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={leave.employee_name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-5 text-ink">{leave.employee_name}</p>
                    {leave.department && <p className="truncate text-xs font-medium leading-4 text-ink-muted">{leave.department}</p>}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <p className="text-sm leading-5">{leave.leave_type}</p>
                {halfDayText(leave) && <p className="text-xs capitalize leading-4 text-ink-muted">{halfDayText(leave)}</p>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">{leaveDatesLabel(leave)}</TableCell>
              <TableCell className="text-sm tabular-nums">{leave.days_count}</TableCell>
              <TableCell>
                <StatusBadge status={leave.status} label={STATUS_LABELS[leave.status] || undefined} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : (
      <Empty icon={FileText}>No recent leaves found</Empty>
    )}
  </Panel>
);

// ---------- Who's out today ----------

const SCOPE_TEXT = { admin: 'across the company', manager: 'in your team', department: 'in your department' };

export const WhosOutPanel = ({ data, className }) => {
  const out = data?.out || [];
  const people = [];
  const seen = new Set();
  for (const e of out) {
    const id = e.employee_email || e.employee_id || e.employee_name;
    if (seen.has(id)) continue;
    seen.add(id);
    people.push(e);
  }
  const shown = people.slice(0, 6);
  const closed = data?.holiday && data.holiday.type !== 'optional' && data.holiday.type !== 'restricted';
  const scope = SCOPE_TEXT[data?.scope] || SCOPE_TEXT.department;

  return (
    <Panel
      title="Who’s out today"
      subtitle={!data ? 'Loading…' : closed ? `Holiday — ${data.holiday.name}` : `${people.length} ${people.length === 1 ? 'person' : 'people'} ${scope}`}
      actions={(
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to="/team-calendar"><ArrowRight /> Calendar</Link>
        </Button>
      )}
      className={className}
      bodyClassName="-mt-1"
    >
      <div data-testid="whos-out-widget">
        {!data ? (
          <div className="h-10 w-48 animate-pulse rounded-full bg-subtle" />
        ) : closed ? (
          <p className="flex items-center gap-2 rounded-md bg-brand-subtle px-3 py-2.5 text-sm text-brand-text">
            <PartyPopper className="h-4 w-4" /> Office closed for {data.holiday.name}
          </p>
        ) : !people.length ? (
          <p className="rounded-md bg-subtle px-3 py-2.5 text-sm text-ink-secondary">Everyone&apos;s in today.</p>
        ) : (
          <div className="flex items-center">
            {shown.map((e) => (
              <span key={e.leave_id} title={`${e.employee_name} · ${e.leave_type || e.category}${e.is_half_day ? ' (half day)' : ''}`} className="-mr-2">
                <Avatar name={e.employee_name} size="lg" ring />
              </span>
            ))}
            {people.length > shown.length && (
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-surface bg-subtle text-xs font-semibold text-ink-secondary">
                +{people.length - shown.length}
              </span>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
};

// ---------- Coming up ----------

const whenText = (days) => (days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`);

/** Upcoming holidays (GET /holidays) plus birthdays & anniversaries (GET /v2/engagement/celebrations). */
export const ComingUpPanel = ({ className }) => {
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const todayKey = format(now, 'yyyy-MM-dd');
    const years = [now.getFullYear()];
    if (now.getMonth() >= 10) years.push(now.getFullYear() + 1);

    Promise.allSettled([
      ...years.map(y => api.get(`/holidays?year=${y}`)),
      api.get('/v2/engagement/celebrations', { params: { days: 31 } }),
    ]).then((results) => {
      if (!alive) return;
      if (results.every(r => r.status === 'rejected')) { setFailed(true); return; }
      const holidayResults = results.slice(0, years.length);
      const celebrationResult = results[results.length - 1];

      const holidays = holidayResults
        .filter(r => r.status === 'fulfilled' && Array.isArray(r.value.data))
        .flatMap(r => r.value.data)
        .map(h => ({ ...h, day: String(h.date || '').slice(0, 10) }))
        .filter(h => h.day >= todayKey)
        .map(h => {
          const date = parseISO(h.day);
          const optional = h.type === 'optional' || h.type === 'restricted';
          return {
            key: `holiday-${h.id || h.day}-${h.name}`,
            date: h.day,
            days: differenceInCalendarDays(date, parseISO(todayKey)),
            icon: PartyPopper,
            tone: 'accent',
            title: h.name,
            meta: `${optional ? 'Optional holiday' : 'Public holiday'} · ${format(date, 'EEE, d MMM')}`,
          };
        });

      const celebrations = (celebrationResult.status === 'fulfilled' ? celebrationResult.value.data?.celebrations || [] : [])
        .map(c => {
          const date = parseISO(c.date);
          const name = c.is_me ? 'Your' : `${c.employee?.full_name}’s`;
          const birthday = c.type === 'birthday';
          return {
            key: `celebration-${c.key}`,
            date: c.date,
            days: c.days_away ?? differenceInCalendarDays(date, parseISO(todayKey)),
            icon: birthday ? Cake : Award,
            tone: birthday ? 'danger' : 'violet',
            title: birthday ? `${name} birthday` : `${c.is_me ? 'You' : c.employee?.full_name} · ${c.years} year${c.years === 1 ? '' : 's'}`,
            meta: birthday
              ? `${c.employee?.department ? `${c.employee.department} · ` : ''}${format(date, 'EEE, d MMM')}`
              : `Work anniversary · ${format(date, 'EEE, d MMM')}`,
          };
        });

      setEvents([...holidays, ...celebrations].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5));
    });
    return () => { alive = false; };
  }, []);

  if (failed) return null;

  return (
    <Panel
      title="Coming up"
      subtitle="Holidays, birthdays & anniversaries"
      actions={(
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to="/holidays"><CalendarDays /> Holidays</Link>
        </Button>
      )}
      className={className}
      bodyClassName="-mt-2"
    >
      {!events ? (
        <div className="space-y-3 pt-2">
          {[0, 1, 2].map(i => <div key={i} className="h-10 animate-pulse rounded-md bg-subtle" />)}
        </div>
      ) : !events.length ? (
        <Empty icon={CalendarDays}>Nothing coming up in the next few weeks.</Empty>
      ) : (
        <ul>
          {events.map(ev => (
            <li key={ev.key} className="flex items-center gap-3 py-2.5">
              <IconTile icon={ev.icon} tone={ev.tone} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-5 text-ink">{ev.title}</p>
                <p className="truncate text-xs font-medium leading-4 text-ink-secondary">{ev.meta}</p>
              </div>
              <span className={`shrink-0 text-xs font-medium leading-4 ${ev.days <= 0 ? 'text-brand-text' : 'text-ink-muted'}`}>{whenText(ev.days)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

// ---------- My leave balance (admins / managers; employees see it as stat cards) ----------

export const LeaveBalancePanel = ({ balance, className }) => (
  <Panel
    title="My leave balance"
    actions={(
      <Button asChild variant="ghost" size="sm" className="gap-1.5">
        <Link to="/leaves"><ArrowRight /> Apply</Link>
      </Button>
    )}
    className={className}
    bodyClassName="-mt-1"
  >
    <div data-testid="leave-balance-card" className="grid grid-cols-3 gap-4">
      {[['Casual', balance.casual_leave], ['Sick', balance.sick_leave], ['Earned', balance.earned_leave]].map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <p className="text-xs font-medium leading-4 text-ink-muted">{label}</p>
          <p className="font-display text-xl font-bold leading-7 text-ink tabular-nums">{value ?? 0}</p>
        </div>
      ))}
    </div>
  </Panel>
);
