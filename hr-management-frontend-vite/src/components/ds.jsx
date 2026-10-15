import React, { useState } from 'react';
import { cn } from '@/lib/utils';

// Small building blocks from the "Xeno HR — Modern UI Redesign" Figma file.
// Colours come from the named palette in tailwind.config.js.

const TONES = {
  success: { bg: 'bg-success-bg', fg: 'text-success-fg', dot: 'bg-success-solid' },
  warning: { bg: 'bg-warning-bg', fg: 'text-warning-fg', dot: 'bg-warning-solid' },
  danger: { bg: 'bg-danger-bg', fg: 'text-danger-fg', dot: 'bg-danger-solid' },
  info: { bg: 'bg-info-bg', fg: 'text-info-fg', dot: 'bg-info-solid' },
  violet: { bg: 'bg-violet-bg', fg: 'text-violet-fg', dot: 'bg-violet-fg' },
  teal: { bg: 'bg-teal-bg', fg: 'text-teal-fg', dot: 'bg-teal-solid' },
  accent: { bg: 'bg-brand-subtle', fg: 'text-brand-text', dot: 'bg-brand' },
  neutral: { bg: 'bg-subtle', fg: 'text-ink-secondary', dot: 'bg-ink-muted' },
};

/** Common request/record statuses → badge tone. */
const STATUS_TONES = {
  approved: 'success', active: 'success', present: 'success', paid: 'success', completed: 'success', cleared: 'success', hired: 'success',
  pending: 'warning', late: 'warning', draft: 'warning', in_review: 'warning', submitted: 'warning', half_day: 'warning', probation: 'warning',
  rejected: 'danger', absent: 'danger', cancelled: 'danger', inactive: 'danger', terminated: 'danger', failed: 'danger',
  manager_approved: 'info', locked: 'info', processing: 'info', on_leave: 'violet', notice: 'violet', holiday: 'violet', weekly_off: 'neutral',
};

const toneFor = (status) => STATUS_TONES[String(status || '').toLowerCase().replace(/[\s-]+/g, '_')] || 'neutral';

const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Pill with a status dot. Pass `tone` explicitly or let it be derived from `status`. */
export const StatusBadge = ({ status, label, tone, dot = true, className }) => {
  const t = TONES[tone || toneFor(status)] || TONES.neutral;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold leading-4 whitespace-nowrap', t.bg, t.fg, className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', t.dot)} />}
      {label ?? titleCase(status)}
    </span>
  );
};

const AVATAR_TONES = ['violet', 'teal', 'info', 'warning', 'success', 'danger'];

const initialsOf = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const toneForName = (name = '') =>
  AVATAR_TONES[name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_TONES.length];

const AVATAR_SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-14 w-14 text-lg',
};

/** Initials on a tinted circle (or the photo when there is one). */
export const Avatar = ({ name, src, size = 'sm', tone, ring = false, className }) => {
  const [broken, setBroken] = useState(false);
  const t = TONES[tone || toneForName(name)] || TONES.violet;
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold uppercase', AVATAR_SIZES[size] || AVATAR_SIZES.sm, t.bg, t.fg, ring && 'border-2 border-surface', className)}>
      {src && !broken
        ? <img src={src} alt={name || ''} className="h-full w-full object-cover" onError={() => setBroken(true)} />
        : initialsOf(name)}
    </span>
  );
};

/** Square tinted tile holding an icon (stat cards, event lists). */
export const IconTile = ({ icon, tone = 'accent', size = 'md', className }) => {
  const Icon = icon;
  const t = TONES[tone] || TONES.accent;
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-md', size === 'lg' ? 'h-10 w-10' : 'h-9 w-9', t.bg, t.fg, className)}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
};

/** KPI card: label + icon tile, big number, optional delta pill and note. */
export const StatCard = ({ label, value, icon, tone = 'accent', delta, deltaTone = 'success', deltaIcon, note, className }) => {
  const DeltaIcon = deltaIcon;
  const d = TONES[deltaTone] || TONES.neutral;
  return (
    <div className={cn('flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-xs', className)}>
      <div className="flex items-center gap-3">
        <p className="flex-1 min-w-0 truncate text-[13px] font-medium leading-[18px] text-ink-secondary">{label}</p>
        {icon && <IconTile icon={icon} tone={tone} />}
      </div>
      <p className="font-display text-[30px] font-bold leading-9 tracking-[-0.02em] text-ink tabular-nums">{value}</p>
      {(delta != null || note) && (
        <div className="flex min-w-0 items-center gap-1.5">
          {delta != null && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold leading-4', d.bg, d.fg)}>
              {DeltaIcon && <DeltaIcon className="h-3 w-3" />}
              {delta}
            </span>
          )}
          {note && <span className="truncate text-xs font-medium leading-4 text-ink-muted">{note}</span>}
        </div>
      )}
    </div>
  );
};

/** White card used for page panels, with an optional title row. */
export const Panel = ({ title, subtitle, actions, children, className, bodyClassName }) => (
  <section className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface p-6 shadow-xs', className)}>
    {(title || actions) && (
      <div className="mb-5 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {title && <h2 className="font-display text-base font-semibold leading-6 text-ink truncate">{title}</h2>}
          {subtitle && <p className="text-[13px] leading-[18px] text-ink-secondary truncate">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    )}
    <div className={cn('min-w-0', bodyClassName)}>{children}</div>
  </section>
);

/** Segmented control (Week / Month / Quarter). */
export const Segmented = ({ options, value, onChange, className }) => (
  <div role="tablist" className={cn('inline-flex shrink-0 gap-0.5 rounded-md bg-subtle p-[3px]', className)}>
    {options.map((o) => {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      const active = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange?.(opt.value)}
          className={cn('rounded-sm px-3 py-1.5 text-[13px] leading-[18px] transition-colors',
            active ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-secondary hover:text-ink')}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);
