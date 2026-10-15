import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowLeftRight, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WORKSPACES, setWorkspace } from '@/lib/workspace';
import { useT } from '@/lib/i18n';

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/**
 * App switcher between Xeno HR and Xeno PM, shown in both sidebars.
 * variant="card" is the redesigned sidebar card (org avatar, name, workspace label).
 */
const WorkspaceSwitcher = ({ current, variant = 'compact', title }) => {
  const navigate = useNavigate();
  const t = useT();
  const [open, setOpen] = useState(false);

  const go = (key) => {
    setOpen(false);
    setWorkspace(key);
    if (key !== current) navigate(WORKSPACES[key].home);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === 'card' ? (
          <button
            type="button"
            data-testid="workspace-switcher"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md border border-navy-border bg-navy-hover text-left hover:border-navy-text/40 transition-colors"
          >
            <span className="w-8 h-8 rounded-full bg-teal-solid flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {initials(title || WORKSPACES[current].name)}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] leading-[18px] font-medium text-white truncate">{title || WORKSPACES[current].name}</span>
              <span className="block text-xs leading-4 font-medium text-navy-text truncate">{t(`${WORKSPACES[current].suffix} workspace`)}</span>
            </span>
            <ChevronsUpDown className="w-4 h-4 text-navy-text shrink-0" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="workspace-switcher"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-800 hover:text-yellow-400 transition-colors"
          >
            <ArrowLeftRight className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('Switch app')}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">{WORKSPACES[current].suffix}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        {Object.values(WORKSPACES).map((w) => {
          const Icon = w.icon;
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => go(w.key)}
              className="w-full flex items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-slate-100"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{w.name}</p>
                <p className="text-xs text-slate-500 truncate">{t(w.tagline)}</p>
              </div>
              {w.key === current && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

export default WorkspaceSwitcher;
