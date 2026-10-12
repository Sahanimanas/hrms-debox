import React from 'react';
import { AlertCircle, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PRIORITIES, TASK_TYPES, fmtDate, isOverdue, initials, avatarColor } from '../lib';

export function PageHeader({ icon, title, subtitle, children }) {
  const Icon = icon;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="p-2 sm:p-2.5 bg-slate-800 rounded-xl shadow-lg shrink-0">
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate" style={{ fontFamily: 'Plus Jakarta Sans' }}>{title}</h1>
          {subtitle && <p className="text-xs sm:text-sm text-slate-600 truncate">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Avatar({ name, picture, size = 'sm', className = '' }) {
  const [broken, setBroken] = React.useState(false);
  const dims = { xs: 'w-5 h-5 text-[9px]', sm: 'w-6 h-6 text-[10px]', md: 'w-8 h-8 text-xs', lg: 'w-10 h-10 text-sm' }[size];
  if (!name) {
    return <div className={`${dims} rounded-full border border-dashed border-slate-300 shrink-0 ${className}`} title="Unassigned" />;
  }
  return (
    <div className={`${dims} rounded-full overflow-hidden shrink-0 ${className}`} title={name}>
      {picture && !broken
        ? <img src={picture} alt={name} className="w-full h-full object-cover" onError={() => setBroken(true)} />
        : <div className={`w-full h-full ${avatarColor(name)} text-white font-semibold flex items-center justify-center`}>{initials(name)}</div>}
    </div>
  );
}

export function PriorityIcon({ priority, showLabel = false, className = '' }) {
  const p = PRIORITIES[priority] || PRIORITIES.none;
  const Icon = p.icon;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={p.label}>
      <Icon className={`w-4 h-4 ${p.cls}`} />
      {showLabel && <span className="text-xs text-slate-700">{p.label}</span>}
    </span>
  );
}

export function TypeIcon({ type, showLabel = false }) {
  const t = TASK_TYPES[type] || TASK_TYPES.task;
  const Icon = t.icon;
  return (
    <span className="inline-flex items-center gap-1" title={t.label}>
      <Icon className={`w-4 h-4 ${t.cls}`} />
      {showLabel && <span className="text-xs text-slate-700">{t.label}</span>}
    </span>
  );
}

export function StatusBadge({ label, color }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap" style={{ backgroundColor: `${color || '#64748b'}1a`, color: color || '#475569' }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color || '#64748b' }} />
      {label}
    </span>
  );
}

export function LabelChips({ ids, labels, max = 3 }) {
  const list = (ids || []).map(id => (labels || []).find(l => l.id === id)).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.slice(0, max).map(l => (
        <span key={l.id} className="rounded px-1.5 py-px text-[10px] font-medium" style={{ backgroundColor: `${l.color}22`, color: l.color }}>{l.name}</span>
      ))}
      {list.length > max && <span className="text-[10px] text-slate-400">+{list.length - max}</span>}
    </span>
  );
}

export function DueDate({ task, compact = false }) {
  if (!task?.due_date) return null;
  const overdue = isOverdue(task);
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] whitespace-nowrap ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
      <CalendarDays className="w-3 h-3" />
      {fmtDate(task.due_date, compact ? 'dd MMM' : 'dd MMM yyyy')}
    </span>
  );
}

export function ProjectDot({ color, className = '' }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${className}`} style={{ backgroundColor: color || '#64748b' }} />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="text-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3" />
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
      {children && <div className="text-xs sm:text-sm mt-2">{children}</div>}
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
  slate: 'bg-slate-100 text-slate-600',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  sky: 'bg-sky-50 text-sky-600',
  purple: 'bg-purple-50 text-purple-600',
};

export function StatCard({ label, value, icon, tone = 'slate', hint }) {
  const Icon = icon;
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
          <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
          {hint && <p className="text-[11px] text-slate-400 truncate">{hint}</p>}
        </div>
        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone]}`}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Person dropdown backed by the PM people directory. '' = nobody. */
export function PersonSelect({ people, value, onChange, placeholder = 'Unassigned', allowNone = true, disabled, className = '', restrictTo }) {
  const list = restrictTo ? people.filter(p => restrictTo.includes(p.email)) : people;
  return (
    <Select value={value || '__none'} onValueChange={(v) => onChange(v === '__none' ? '' : v)} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {allowNone && <SelectItem value="__none">{placeholder}</SelectItem>}
        {value && !list.some(p => p.email === value) && <SelectItem value={value}>{value}</SelectItem>}
        {list.map(p => (
          <SelectItem key={p.email} value={p.email}>
            <span className="flex items-center gap-2"><Avatar name={p.name} picture={p.picture} size="xs" />{p.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
