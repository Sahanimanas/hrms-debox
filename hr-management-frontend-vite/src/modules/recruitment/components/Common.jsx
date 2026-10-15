import React from 'react';
import { AlertTriangle, Inbox, RefreshCw, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { STAGE_LABELS, STAGE_STYLES, STATUS_STYLES, label } from '../lib';

/** Dark icon tile + title + subtitle, actions on the right (stacks on mobile). */
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

export const PageShell = ({ children, wide = false }) => (
  <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
    <div className={`${wide ? 'max-w-[1400px]' : 'max-w-6xl'} mx-auto space-y-5 sm:space-y-6`}>{children}</div>
  </div>
);

export const LoadingState = ({ text = 'Loading…' }) => (
  <div className="text-center py-12" role="status">
    <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3"></div>
    <p className="text-sm text-slate-500">{text}</p>
  </div>
);

export const EmptyState = ({ icon = Inbox, title, hint, children }) => {
  const Icon = icon;
  return (
    <div className="text-center py-12 px-4 text-slate-500">
      <Icon className="w-10 h-10 mx-auto mb-3 text-slate-300" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
};

export const ErrorState = ({ message = 'Could not load data', onRetry }) => (
  <div className="text-center py-12 px-4">
    <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-400" />
    <p className="text-sm text-slate-700">{message}</p>
    {onRetry && (
      <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={onRetry}>
        <RefreshCw className="w-3.5 h-3.5" /> Try again
      </Button>
    )}
  </div>
);

export const StageBadge = ({ stage, offerStatus }) => {
  const text = stage === 'offer' && offerStatus === 'accepted' ? 'Offer accepted' : STAGE_LABELS[stage] || stage;
  const cls = stage === 'offer' && offerStatus === 'accepted' ? 'bg-emerald-50 text-emerald-700' : STAGE_STYLES[stage];
  return <Badge className={`${cls || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 whitespace-nowrap`}>{text}</Badge>;
};

export const StatusBadge = ({ status, text }) => (
  <Badge className={`${STATUS_STYLES[status] || 'bg-slate-100 text-slate-700'} hover:opacity-90 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 capitalize whitespace-nowrap`}>
    {text || label({}, status)}
  </Badge>
);

export const StatCard = ({ label: title, value, icon, hint }) => {
  const Icon = icon;
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{title}</p>
          <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
          {hint && <p className="text-[11px] text-slate-500 truncate">{hint}</p>}
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

/** 1–5 star rating; read-only when onChange is omitted. */
export const StarRating = ({ value, onChange, size = 'w-4 h-4', label: ariaLabel = 'Rating' }) => (
  <div className="flex items-center gap-0.5" role={onChange ? 'radiogroup' : 'img'} aria-label={`${ariaLabel}: ${value || 'none'} of 5`}>
    {[1, 2, 3, 4, 5].map(n => {
      const filled = value && n <= value;
      const star = <Star className={`${size} ${filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />;
      return onChange ? (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className="p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          onClick={() => onChange(value === n ? null : n)}
        >
          {star}
        </button>
      ) : <span key={n}>{star}</span>;
    })}
  </div>
);

/** Plain table wrapper matching the app's list style. */
export const TableCard = ({ children }) => (
  <Card className="border-0 shadow-md overflow-hidden">
    <CardContent className="p-0">{children}</CardContent>
  </Card>
);
