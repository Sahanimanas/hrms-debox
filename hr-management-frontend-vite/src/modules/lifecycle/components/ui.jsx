// Small presentational building blocks shared by the lifecycle pages.
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { initials, avatarColor } from '../lib';

export const PageShell = ({ children }) => (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
    <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">{children}</div>
  </div>
);

export const PageHeader = ({ icon, title, subtitle, children }) => {
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
      {children && <div className="flex flex-wrap gap-2 w-full sm:w-auto">{children}</div>}
    </div>
  );
};

export const SectionCard = ({ icon, title, actions, children, className = '' }) => {
  const Icon = icon;
  return (
    <Card className={`border-0 shadow-md ${className}`}>
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />}
            {title}
          </CardTitle>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
};

export const Loading = ({ label = 'Loading…' }) => (
  <div className="text-center py-12">
    <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3"></div>
    <p className="text-sm text-slate-500">{label}</p>
  </div>
);

export const Empty = ({ icon, title, hint }) => {
  const Icon = icon;
  return (
    <div className="text-center py-12 px-4 text-slate-500">
      {Icon && <Icon className="w-10 h-10 mx-auto mb-3 text-slate-300" />}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  );
};

export const ErrorState = ({ message, onRetry }) => (
  <div className="text-center py-10 px-4">
    <p className="text-sm text-red-600">{message || 'Failed to load'}</p>
    {onRetry && (
      <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-slate-700 underline">
        Try again
      </button>
    )}
  </div>
);

export const StatusPill = ({ map, status }) => {
  const s = map[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-600' };
  return <Badge className={`${s.cls} hover:opacity-90 text-[10px] sm:text-xs whitespace-nowrap`}>{s.label}</Badge>;
};

export const Avatar = ({ name, size = 'md' }) => {
  const cls = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-10 h-10 text-sm';
  return (
    <div className={`${cls} ${avatarColor(name)} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}>
      {initials(name)}
    </div>
  );
};

export const StatTile = ({ label, value, icon, tone = 'slate', onClick }) => {
  const Icon = icon;
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
    purple: 'bg-purple-50 text-purple-600',
    blue: 'bg-blue-50 text-blue-600',
  };
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Card className="border-slate-100 shadow-sm">
      <Wrapper type={onClick ? 'button' : undefined} onClick={onClick} className="w-full text-left">
        <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
            <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
          </div>
          <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
            <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </CardContent>
      </Wrapper>
    </Card>
  );
};

export const ProgressBar = ({ value, className = '' }) => (
  <div className={`h-2 w-full rounded-full bg-slate-100 overflow-hidden ${className}`}>
    <div
      className={`h-full rounded-full transition-all ${value >= 100 ? 'bg-emerald-500' : 'bg-slate-800'}`}
      style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }}
    />
  </div>
);

/** Native <select> styled like the inputs — simpler than Radix for long, dynamic lists. */
export const NativeSelect = ({ value, onChange, children, className = '', ...props }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    {...props}
  >
    {children}
  </select>
);
