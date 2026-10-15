import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
import { format, startOfWeek, endOfWeek, addDays, subDays, subWeeks, parseISO } from 'date-fns';
import api from '@/lib/api';
import { Panel, Segmented } from '@/components/ds';

// Hex mirrors of the tailwind tokens (recharts needs raw colours)
const C = {
  present: '#12b76a', // success-solid
  late: '#f79009', // warning-solid
  absent: '#f04438', // danger-solid
  grid: '#e3e7ef', // line
  axis: '#cbd2de', // line-strong
  muted: '#94a0b4', // ink-muted
  secondary: '#475467', // ink-secondary
  surface: '#ffffff',
};

const SERIES = [
  { key: 'ontime', label: 'Present', color: C.present },
  { key: 'late', label: 'Late', color: C.late },
  { key: 'absent', label: 'Absent', color: C.absent },
];

const RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

const SUBTITLES = {
  week: 'Headcount by status, this week',
  month: 'Headcount by status, last 30 days',
  quarter: 'Average daily headcount by week, last 13 weeks',
};

const key = (d) => format(d, 'yyyy-MM-dd');

const windowFor = (range, today = new Date()) => {
  if (range === 'week') {
    return { from: key(startOfWeek(today, { weekStartsOn: 1 })), to: key(endOfWeek(today, { weekStartsOn: 1 })) };
  }
  if (range === 'month') return { from: key(subDays(today, 29)), to: key(today) };
  return { from: key(startOfWeek(subWeeks(today, 12), { weekStartsOn: 1 })), to: key(today) };
};

/** Split a day's headcount into on-time / late / absent. */
const splitDay = (entry, late = 0) => {
  if (!entry) return { ontime: 0, late: 0, absent: 0, attended: 0 };
  const attended = (entry.present || 0) + (entry.half_day || 0);
  const lateCount = Math.min(late, attended);
  return { ontime: attended - lateCount, late: lateCount, absent: entry.absent || 0, attended };
};

const buildRows = (range, data, win) => {
  const daily = data?.daily || [];
  const byDate = new Map(daily.map(d => [d.date, d]));
  const lateBy = new Map((data?.late_trend || []).map(d => [d.date, d.late_arrivals]));

  if (range === 'quarter') {
    const rows = [];
    for (let start = parseISO(win.from); key(start) <= win.to; start = addDays(start, 7)) {
      const days = Array.from({ length: 7 }, (_, i) => key(addDays(start, i))).filter(d => d <= win.to);
      const tracked = days
        .map(d => splitDay(byDate.get(d), lateBy.get(d) || 0))
        .filter(s => s.attended + s.absent > 0);
      const avg = (k) => (tracked.length ? Math.round(tracked.reduce((s, t) => s + t[k], 0) / tracked.length) : 0);
      rows.push({ date: key(start), label: format(start, 'd MMM'), ontime: avg('ontime'), late: avg('late'), absent: avg('absent'), attended: avg('attended') });
    }
    return rows;
  }

  const rows = [];
  for (let d = parseISO(win.from); key(d) <= win.to; d = addDays(d, 1)) {
    const k = key(d);
    const entry = byDate.get(k);
    rows.push({
      date: k,
      label: range === 'week' ? format(d, 'EEE') : format(d, 'd MMM'),
      holiday: entry?.holiday_name || null,
      ...splitDay(entry, lateBy.get(k) || 0),
    });
  }
  return rows;
};

/** Stacked segment: 2px surface gap between fills, rounded top on the topmost segment. */
const Segment = ({ x, y, width, height, fill, payload, dataKey }) => {
  if (!height || height <= 0) return null;
  const order = SERIES.map(s => s.key);
  const nonZero = order.filter(k => (payload?.[k] || 0) > 0);
  const isTop = nonZero[nonZero.length - 1] === dataKey;
  const isBottom = nonZero[0] === dataKey;
  const h = !isBottom && height > 2 ? height - 2 : height;
  if (!isTop) return <rect x={x} y={y} width={width} height={h} fill={fill} />;
  const r = Math.min(4, width / 2, h);
  return (
    <path
      fill={fill}
      d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`}
    />
  );
};

const ChartTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-ink">
        {row.label}{row.holiday ? ` · ${row.holiday}` : ''}
      </p>
      {SERIES.map(s => (
        <p key={s.key} className="flex items-center gap-2 text-ink-secondary">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
          <span className="flex-1">{s.label}</span>
          <span className="font-semibold text-ink tabular-nums">{row[s.key]}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-line pt-1 text-ink-muted">In office: <span className="font-semibold text-ink">{row.attended}</span></p>
    </div>
  );
};

const Metric = ({ label, value }) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <p className="truncate text-xs font-medium leading-4 text-ink-muted">{label}</p>
    <p className="font-display text-base font-semibold leading-6 text-ink tabular-nums">{value}</p>
  </div>
);

/**
 * "Attendance overview" panel (admin / manager). Loads /v2/analytics/attendance
 * for the selected range and reports the payload up through `onData`.
 */
const AttendanceOverview = ({ onData, className }) => {
  const [range, setRange] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const win = useMemo(() => windowFor(range), [range]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.get('/v2/analytics/attendance', { params: win })
      .then((r) => {
        if (!alive) return;
        setData(r.data);
        onData?.(r.data, range);
      })
      .catch((e) => { if (alive) setError(e.response?.data?.detail || 'Could not load attendance'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  const rows = useMemo(() => buildRows(range, data, win), [range, data, win]);
  const s = data?.summary;
  const fmt = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

  return (
    <Panel
      title="Attendance overview"
      subtitle={SUBTITLES[range]}
      actions={<Segmented options={RANGES} value={range} onChange={setRange} />}
      className={className}
      bodyClassName="flex flex-1 flex-col gap-5"
    >
      <div className="flex flex-wrap items-center gap-4">
        {SERIES.map(sr => (
          <span key={sr.key} className="inline-flex items-center gap-1.5 text-xs font-medium leading-4 text-ink-secondary">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: sr.color }} />
            {sr.label}
          </span>
        ))}
      </div>

      <div className="h-[232px] w-full">
        {error ? (
          <div className="flex h-full items-center justify-center rounded-md bg-subtle text-sm text-ink-secondary">{error}</div>
        ) : loading && !data ? (
          <div className="h-full animate-pulse rounded-md bg-subtle" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 20, right: 4, bottom: 0, left: -8 }} barCategoryGap={range === 'week' ? '45%' : '25%'}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: C.axis }}
                tick={{ fontSize: 12, fill: C.muted, fontWeight: 500 }}
                interval={range === 'month' ? 4 : range === 'quarter' ? 1 : 0}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: C.muted, fontWeight: 500 }} width={40} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: '#eef1f6', opacity: 0.6 }} />
              {SERIES.map((sr, i) => (
                <Bar
                  key={sr.key}
                  dataKey={sr.key}
                  name={sr.label}
                  stackId="status"
                  fill={sr.color}
                  maxBarSize={28}
                  isAnimationActive={false}
                  shape={(p) => <Segment {...p} dataKey={sr.key} />}
                >
                  {range === 'week' && i === SERIES.length - 1 && (
                    <LabelList
                      dataKey="attended"
                      position="top"
                      offset={6}
                      formatter={(v) => (v ? v : '')}
                      style={{ fontSize: 12, fontWeight: 600, fill: C.secondary }}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
        <Metric label="Avg. attendance" value={fmt(s?.attendance_pct, '%')} />
        <Metric label="Avg. hours / day" value={s?.avg_worked_hours != null ? `${s.avg_worked_hours}h` : '—'} />
        <Metric label="Late arrivals" value={fmt(s?.late_arrivals)} />
        <Metric label="Overtime" value={s ? `${s.total_overtime_hours ?? 0}h` : '—'} />
      </div>
    </Panel>
  );
};

export default AttendanceOverview;
