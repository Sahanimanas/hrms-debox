// Layout pieces shared by the engagement pages (same look as MyAttendancePage).
import { Loader2, AlertCircle, Inbox, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { initials, avatarTone } from '../lib';

export function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">{children}</div>
    </div>
  );
}

export function PageHeader({ icon, title, subtitle, actions }) {
  const Icon = icon;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg shrink-0">
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            {title}
          </h1>
          {subtitle && <p className="text-xs sm:text-sm text-slate-600">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">{actions}</div>}
    </div>
  );
}

export function ExportButton({ onClick, disabled }) {
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled} className="gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto rounded-lg sm:rounded-xl">
      <Download className="w-4 h-4" />
      Export CSV
    </Button>
  );
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <AlertCircle className="w-8 h-8 text-rose-400" />
      <p className="text-sm text-slate-600">{message || 'Something went wrong'}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }) {
  const Icon = icon || Inbox;
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-4">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
        <Icon className="w-6 h-6 text-slate-400" />
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-500 max-w-sm">{hint}</p>}
      {action}
    </div>
  );
}

/** Renders loading / error / empty states, else children. */
export function StateSwitch({ loading, error, onRetry, empty, emptyProps, children }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) return <EmptyState {...emptyProps} />;
  return children;
}

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
  purple: 'bg-purple-50 text-purple-600',
  sky: 'bg-sky-50 text-sky-600',
};

export function StatCard({ label, value, icon, tone = 'slate' }) {
  const Icon = icon;
  return (
    <Card className="border-slate-100 shadow-sm">
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

export function Avatar({ name, seed, size = 'md' }) {
  const sizes = { sm: 'w-7 h-7 text-[10px]', md: 'w-9 h-9 text-xs', lg: 'w-12 h-12 text-sm' };
  return (
    <div className={`${sizes[size]} rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarTone(seed || name)}`}>
      {initials(name)}
    </div>
  );
}

/** Simple accessible progress bar (0–100). */
export function ProgressBar({ value = 0, className = 'h-2' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`w-full rounded-full bg-slate-100 overflow-hidden ${className}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${v}%` }} />
    </div>
  );
}
