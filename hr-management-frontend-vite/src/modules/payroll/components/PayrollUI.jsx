// Layout building blocks shared by the payroll pages (same look as MyAttendancePage).
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PageShell({ icon, title, subtitle, actions, children }) {
  const Icon = icon;
  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
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
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionCard({ icon, title, actions, children, bodyClassName = 'p-0' }) {
  const Icon = icon;
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />}
            {title}
          </CardTitle>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  );
}

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
  purple: 'bg-purple-50 text-purple-600',
  blue: 'bg-blue-50 text-blue-600',
};

export function StatCard({ label, value, icon, tone = 'slate', hint }) {
  const Icon = icon;
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
          <p className="text-base sm:text-xl font-bold text-slate-900 mt-0.5 truncate">{value}</p>
          {hint && <p className="text-[10px] sm:text-xs text-slate-500 truncate">{hint}</p>}
        </div>
        {Icon && (
          <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone]}`}>
            <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LoadingBlock({ text = 'Loading…' }) {
  return (
    <div className="text-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3"></div>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

export function EmptyBlock({ icon, title, children }) {
  const Icon = icon;
  return (
    <div className="text-center py-12 px-4 text-slate-500">
      {Icon && <Icon className="w-10 h-10 mx-auto mb-3 text-slate-300" />}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {children && <div className="text-xs sm:text-sm mt-1">{children}</div>}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-sm text-red-600">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-slate-700 underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function StatusPill({ status, styles, label }) {
  return (
    <Badge className={`${styles?.[status] || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs capitalize`}>
      {label || status}
    </Badge>
  );
}

/** Responsive table wrapper with the module's header style. */
export function DataTable({ columns, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
          <tr>
            {columns.map((c) => (
              <th key={c.key || c.label} className={`font-medium px-4 py-3 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.className || ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
