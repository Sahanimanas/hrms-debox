import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function ChangeBadge({ previous, next }) {
  if (previous == null) return <span className="text-xs text-slate-500">Initial</span>;
  const diff = (next || 0) - previous;
  const pct = previous ? (diff / previous) * 100 : 0;
  const up = diff >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-emerald-700' : 'text-rose-700'}`}>
      <Icon className="w-3.5 h-3.5" />{up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}
