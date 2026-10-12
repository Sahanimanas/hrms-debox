import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Dark icon tile + title + subtitle, with optional actions on the right. */
export function PageHeader({ icon, title, subtitle, children }) {
  const Icon = icon;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg shrink-0">
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 truncate" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            {title}
          </h1>
          {subtitle && <p className="text-xs sm:text-sm text-slate-600">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Pill({ map, value }) {
  const entry = map[value] || { label: value, cls: 'bg-slate-100 text-slate-700' };
  return (
    <Badge className={`${entry.cls} hover:opacity-90 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 whitespace-nowrap`}>
      {entry.label}
    </Badge>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="text-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3"></div>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

export function Empty({ icon, title, children }) {
  const Icon = icon;
  return (
    <div className="text-center py-12 px-4 text-slate-500">
      {Icon && <Icon className="w-10 h-10 mx-auto mb-3 text-slate-300" />}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {children && <div className="text-xs sm:text-sm mt-1">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="text-center py-12 px-4">
      <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-300" />
      <p className="text-sm text-slate-600">{message || 'Something went wrong'}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
  sky: 'bg-sky-50 text-sky-600',
  purple: 'bg-purple-50 text-purple-600',
};

export function StatCard({ label, value, icon, tone = 'slate', onClick, active }) {
  const Icon = icon;
  return (
    <Card
      className={`border-slate-100 shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${active ? 'ring-2 ring-slate-800' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
          <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
        </div>
        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone]}`}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Label/value row used in detail views. */
export function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
      <div className="text-sm text-slate-900 mt-0.5 break-words">{children ?? '—'}</div>
    </div>
  );
}
