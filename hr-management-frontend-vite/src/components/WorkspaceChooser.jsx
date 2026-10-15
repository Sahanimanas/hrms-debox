import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { WORKSPACES } from '@/lib/workspace';
import { useT } from '@/lib/i18n';
import { StatusBadge } from '@/components/ds';
import { cn } from '@/lib/utils';

// Short subtitles for the compact two-up chooser on the sign-in form
const SHORT_TAGLINES = { hr: 'People & payroll', pm: 'Projects & tasks' };

/**
 * Pick Xeno HR or Xeno Project Management. Both use the same account — the
 * choice decides where you land after login.
 *
 * Default: the first step of the sign-in screen (full cards with descriptions).
 * `compact`: the two side-by-side tiles shown above the sign-in form, with
 * `value` marking the selected workspace.
 */
const WorkspaceChooser = ({ onChoose, lastUsed, compact = false, value }) => {
  const t = useT();

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('Workspace')} data-testid="workspace-chooser-compact">
        {Object.values(WORKSPACES).map((w) => {
          const selected = value === w.key;
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => onChoose(w.key)}
              aria-pressed={selected}
              data-testid={`workspace-option-${w.key}`}
              className={cn(
                'flex min-w-0 items-center gap-2.5 rounded-md text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                selected
                  ? 'border-2 border-brand bg-brand-subtle p-[11px]'
                  : 'border border-line bg-surface p-3 hover:border-line-strong hover:bg-canvas',
              )}
            >
              <span className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm font-display text-sm font-extrabold',
                selected ? 'bg-brand text-brand-on' : 'bg-subtle text-ink-muted',
              )}>
                X
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold leading-5 text-ink">Xeno-{w.suffix}</span>
                <span className="truncate text-xs font-medium leading-4 text-ink-muted">{t(SHORT_TAGLINES[w.key] || w.tagline)}</span>
              </span>
              {selected && (
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand text-brand-on">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="workspace-chooser">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-[28px] font-bold leading-9 tracking-[-0.02em] text-ink">{t('Choose your workspace')}</h2>
        <p className="text-[15px] leading-6 text-ink-secondary">{t('One account for both apps. You can switch at any time after signing in.')}</p>
      </div>
      <div className="grid gap-3">
        {Object.values(WORKSPACES).map((w) => {
          const Icon = w.icon;
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => onChoose(w.key)}
              data-testid={`workspace-${w.key}`}
              className="group w-full rounded-lg border border-line bg-surface p-4 text-left shadow-xs transition-colors hover:border-brand hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:p-5"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-navy text-brand transition-colors group-hover:bg-brand group-hover:text-brand-on">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-base font-bold leading-6 text-ink">{w.name}</p>
                    {lastUsed === w.key && <StatusBadge tone="accent" dot={false} label={t('Last used')} />}
                  </div>
                  <p className="mt-0.5 text-xs font-medium leading-4 text-ink-muted">{t(w.tagline)}</p>
                  <p className="mt-1.5 text-[13px] leading-[18px] text-ink-secondary">{t(w.description)}</p>
                </div>
                <ArrowRight className="mt-2.5 h-5 w-5 shrink-0 text-ink-muted transition-all group-hover:translate-x-0.5 group-hover:text-ink" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WorkspaceChooser;
