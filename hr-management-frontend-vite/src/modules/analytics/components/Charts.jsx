// Thin wrappers around recharts with the module's chart conventions:
// 2px lines, bars capped at 24px with 4px rounded data-ends, solid hairline
// grid, recessive axes, one y-axis, legend only for 2+ series, and a shared
// tooltip listing every series at the hovered point.

import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, PieChart, Pie, Cell, LabelList,
} from 'recharts';
import ChartTooltip from './ChartTooltip';
import { SERIES, OTHER, CHART, AXIS_TICK } from '../lib';

const legendStyle = { fontSize: 12, color: CHART.muted, paddingTop: 4 };
const identity = (v) => v;

/**
 * Line chart over a category axis.
 * series: [{ key, name, color? }]
 */
export const TrendLine = ({ data, xKey, series, height = 240, xFormatter = identity, yFormatter = identity, valueFormatter, yDomain }) => (
  <ResponsiveContainer width="100%" height={height}>
    <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke={CHART.grid} />
      <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.axis }} tickFormatter={xFormatter} minTickGap={16} />
      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={yFormatter} domain={yDomain} allowDecimals={false} />
      <Tooltip
        cursor={{ stroke: CHART.axis, strokeWidth: 1 }}
        content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={valueFormatter || yFormatter} />}
      />
      {series.length > 1 && <Legend iconType="plainline" wrapperStyle={legendStyle} />}
      {series.map((s, i) => (
        <Line
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.name}
          stroke={s.color || SERIES[i]}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
          connectNulls={false}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  </ResponsiveContainer>
);

/**
 * Vertical columns; several series render side by side (or stacked with stackId).
 */
export const Columns = ({ data, xKey, series, height = 240, stacked = false, xFormatter = identity, yFormatter = identity, valueFormatter }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
      <CartesianGrid vertical={false} stroke={CHART.grid} />
      <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.axis }} tickFormatter={xFormatter} minTickGap={8} />
      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={yFormatter} allowDecimals={false} />
      <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={valueFormatter || yFormatter} />} />
      {series.length > 1 && <Legend iconType="square" wrapperStyle={legendStyle} />}
      {series.map((s, i) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.name}
          fill={s.color || SERIES[i]}
          maxBarSize={24}
          stackId={stacked ? 'stack' : undefined}
          radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
          stroke={stacked ? '#fff' : undefined}
          strokeWidth={stacked ? 1 : 0}
          isAnimationActive={false}
        />
      ))}
    </BarChart>
  </ResponsiveContainer>
);

/**
 * Horizontal bars for ranked categories, value labelled at the bar tip.
 */
export const HBars = ({ data, yKey, valueKey, name, height, color = SERIES[0], valueFormatter = identity }) => {
  const h = height || Math.max(120, data.length * 34 + 24);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid horizontal={false} stroke={CHART.grid} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={valueFormatter} allowDecimals={false} />
        <YAxis type="category" dataKey={yKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.axis }} width={110} />
        <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} content={<ChartTooltip valueFormatter={valueFormatter} />} />
        <Bar dataKey={valueKey} name={name} fill={color} maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey={valueKey} position="right" formatter={valueFormatter} style={{ fill: CHART.text, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

/**
 * Donut for part-to-whole with at most 6 segments (the rest folded into "Other").
 * data: [{ key, count }]
 */
export const Donut = ({ data, nameKey = 'key', valueKey = 'count', height = 240, valueFormatter = identity }) => {
  // Colour is fixed by the entity's position in `data` (pass a stable order),
  // so filtering a segment out never repaints the others.
  const indexed = data.map((d, i) => ({ ...d, _slot: i })).filter(d => d[valueKey] > 0);
  const top = indexed.filter(d => d._slot < 5);
  const rest = indexed.filter(d => d._slot >= 5);
  const segments = rest.length
    ? [...top, { [nameKey]: 'Other', [valueKey]: rest.reduce((s, d) => s + d[valueKey], 0), _other: true }]
    : top;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={segments}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius="55%"
          outerRadius="80%"
          stroke="#fff"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {segments.map((s) => <Cell key={s[nameKey]} fill={s._other ? OTHER : SERIES[s._slot]} />)}
        </Pie>
        <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
        <Legend iconType="square" wrapperStyle={legendStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
};
