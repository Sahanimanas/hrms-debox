import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Stat tile: label · value · optional note (e.g. a delta vs a named period).
 */
const KpiTile = ({ label, value, note, noteTone = 'muted', icon, loading = false }) => {
  const Icon = icon;
  const tone = { muted: 'text-slate-500', good: 'text-emerald-700', bad: 'text-rose-700' }[noteTone] || 'text-slate-500';
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className={`p-3 sm:p-4 flex items-start justify-between gap-2 transition-opacity ${loading ? 'opacity-50' : ''}`}>
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
          <p className="text-lg sm:text-2xl font-semibold text-slate-900 mt-0.5 truncate">{value ?? '—'}</p>
          {note && <p className={`text-[11px] sm:text-xs mt-0.5 ${tone}`}>{note}</p>}
        </div>
        {Icon && (
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 bg-slate-100 text-slate-600">
            <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default KpiTile;
