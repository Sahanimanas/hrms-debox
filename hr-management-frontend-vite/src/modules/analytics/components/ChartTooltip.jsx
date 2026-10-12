import React from 'react';

/**
 * Recharts tooltip: one readout listing every series at the hovered point.
 * Values lead (strong), series names follow; each row keyed by a short line
 * in the series colour.
 */
const ChartTooltip = ({ active, payload, label, labelFormatter, valueFormatter }) => {
  if (!active || !payload?.length) return null;
  const title = labelFormatter ? labelFormatter(label, payload) : label;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs min-w-[8rem]">
      {title != null && title !== '' && <p className="text-slate-500 mb-1">{title}</p>}
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: p.color || p.payload?.fill }} />
            <span className="font-semibold text-slate-900 tabular-nums">
              {valueFormatter ? valueFormatter(p.value, p.dataKey, p.payload) : p.value}
            </span>
            <span className="text-slate-500">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChartTooltip;
