import React from 'react';
import { AlertCircle, Banknote, Check, Clock, Eye, EyeOff, SquareCheckBig, X } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import { Avatar, StatusBadge } from '@/components/ds';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Split sign-in layout from the "Xeno HR — Modern UI Redesign" Figma file (Login, 15:991):
// a 640px navy brand panel on the left and the auth form centred on the white right side.

const FEATURES = [
  { icon: Clock, label: 'Geo-tagged clock-in with shift rules' },
  { icon: SquareCheckBig, label: 'Multi-level approvals in one inbox' },
  { icon: Banknote, label: 'Statutory-ready payroll in minutes' },
];

/** Decorative sample of an approval card. Illustrative art only, not real data. */
const PreviewCard = () => {
  const t = useT();
  return (
    <div
      aria-hidden="true"
      className="flex w-full flex-col gap-3.5 rounded-hero border border-navy-border bg-navy-hover p-5 shadow-[0_4px_8px_-2px_rgba(15,23,41,0.04),0_16px_32px_-4px_rgba(15,23,41,0.12)] select-none"
    >
      <div className="flex items-center gap-2.5">
        <Avatar name="Priya Nair" tone="teal" size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm font-semibold leading-5 text-white">{t('Priya Nair requested comp-off')}</p>
          <p className="truncate text-xs font-medium leading-4 text-navy-text">{t('Sat, 18 Oct · Release weekend support')}</p>
        </div>
        <StatusBadge tone="warning" label={t('Pending')} />
      </div>
      <div className="flex gap-2">
        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium leading-[18px] text-brand-on">
          <Check className="h-4 w-4" /> {t('Approve')}
        </span>
        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-navy-border px-3 py-1.5 text-[13px] font-medium leading-[18px] text-white">
          <X className="h-4 w-4" /> {t('Decline')}
        </span>
      </div>
    </div>
  );
};

/** Navy marketing panel shown beside every auth screen on large viewports. */
export const AuthBrandPanel = ({ product = 'hr' }) => {
  const t = useT();
  return (
    <aside className="relative hidden h-screen w-[640px] shrink-0 flex-col justify-between gap-8 overflow-hidden bg-navy px-14 py-12 lg:sticky lg:top-0 lg:flex">
      {/* Soft yellow glow behind the preview card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[16%] top-[32%] h-[92%] w-[84%] bg-[radial-gradient(closest-side,rgba(250,204,20,0.2),rgba(250,204,20,0))]"
      />

      <BrandLogo size="md" tone="light" product={product} className="relative" />

      <div className="relative flex w-full flex-col gap-5">
        <h1 className="font-display text-[44px] font-bold leading-[52px] tracking-[-0.02em] text-white">
          {t('People ops that')} <span className="text-brand">{t('run themselves')}</span>.
        </h1>
        <p className="text-[15px] leading-6 text-navy-text">
          {t('Attendance, leave, payroll and performance — one calm workspace for every employee, manager and admin.')}
        </p>
        <ul className="flex flex-col gap-3 pt-2">
          {FEATURES.map(({ icon, label }) => (
            <li key={label} className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-navy-border bg-navy-hover text-brand">
                {React.createElement(icon, { className: 'h-4 w-4' })}
              </span>
              <span className="text-sm font-medium leading-5 text-white">{t(label)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative [@media(max-height:760px)]:hidden">
        <PreviewCard />
      </div>

      <div className="relative flex w-full items-center gap-2 text-xs font-medium leading-4 text-navy-text">
        <p className="min-w-0 flex-1">© {new Date().getFullYear()} Xeno · {t('Built in Bengaluru')}</p>
        <p className="shrink-0">{t('Privacy')} · {t('Terms')}</p>
      </div>
    </aside>
  );
};

/**
 * Full-screen auth layout: brand panel (lg and up) + centred 400px column.
 * `topBar` renders above the form (e.g. back link, language picker).
 */
export const AuthLayout = ({ product = 'hr', topBar, children }) => (
  <div className="flex min-h-screen bg-surface">
    <AuthBrandPanel product={product} />
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
      <div className="flex w-full max-w-[400px] flex-col gap-5">
        <BrandLogo size="md" tone="dark" product={product} className="lg:hidden" />
        {topBar}
        {children}
      </div>
    </main>
  </div>
);

/** Heading + sub-copy block used at the top of each auth form. */
export const AuthTitle = ({ title, subtitle }) => (
  <div className="flex flex-col gap-1.5">
    <h2 className="font-display text-[28px] font-bold leading-9 tracking-[-0.02em] text-ink">{title}</h2>
    {subtitle && <p className="text-[15px] leading-6 text-ink-secondary">{subtitle}</p>}
  </div>
);

/** Inline field error. */
export const AuthFieldError = ({ message }) => {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-danger-fg">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
};

/**
 * Labelled auth input (Figma "Input": 13px label, 44px field, leading icon).
 * `trailing` sits inside the right edge (e.g. a show-password toggle).
 */
export const AuthField = ({ id, label, icon, error, hint, trailing, className, ...inputProps }) => {
  const Icon = icon;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px] leading-[18px] text-ink-secondary">{label}</Label>
      <div className="relative">
        {Icon && <Icon aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />}
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-11 rounded-md px-3.5',
            Icon && 'pl-10',
            trailing && 'pr-10',
            error && 'border-danger-solid focus-visible:border-danger-solid focus-visible:ring-danger-solid/30',
            className,
          )}
          {...inputProps}
        />
        {trailing && <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center">{trailing}</div>}
      </div>
      {hint && !error && <p className="text-xs leading-4 text-ink-muted">{hint}</p>}
      <AuthFieldError message={error} />
    </div>
  );
};

/** Eye toggle for password fields. */
export const PasswordToggle = ({ shown, onToggle }) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? t('Hide password') : t('Show password')}
      className="rounded-sm text-ink-muted transition-colors hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
};

/** Tinted banner for errors and notices above a form. */
export const AuthAlert = ({ tone = 'danger', children }) => (
  <div
    role={tone === 'danger' ? 'alert' : 'status'}
    className={cn(
      'flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] font-medium leading-[18px]',
      tone === 'danger' ? 'border-danger-solid/30 bg-danger-bg text-danger-fg' : 'border-warning-solid/30 bg-warning-bg text-warning-fg',
    )}
  >
    <AlertCircle className="mt-px h-4 w-4 shrink-0" />
    <span className="min-w-0">{children}</span>
  </div>
);

/** Centred icon + title + copy, used for result states (link sent, expired, done). */
export const AuthStatus = ({ icon, tone = 'success', title, children }) => {
  const Icon = icon;
  const tones = {
    success: 'bg-success-bg text-success-fg',
    warning: 'bg-warning-bg text-warning-fg',
    danger: 'bg-danger-bg text-danger-fg',
    accent: 'bg-brand-subtle text-brand-text',
  };
  return (
    <div className="flex flex-col gap-4">
      <span className={cn('flex h-12 w-12 items-center justify-center rounded-lg', tones[tone] || tones.success)}>
        <Icon className="h-6 w-6" />
      </span>
      <AuthTitle title={title} subtitle={children} />
    </div>
  );
};

export default AuthLayout;
