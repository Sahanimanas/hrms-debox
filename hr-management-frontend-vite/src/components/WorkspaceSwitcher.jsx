import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowLeftRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WORKSPACES, setWorkspace } from '@/lib/workspace';
import { useT } from '@/lib/i18n';

/** App switcher between Xeno HR and Xeno PM, shown in both sidebars. */
const WorkspaceSwitcher = ({ current }) => {
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
        <button
          type="button"
          data-testid="workspace-switcher"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-800 hover:text-yellow-400 transition-colors"
        >
          <ArrowLeftRight className="w-4 h-4 shrink-0" />
          <span className="truncate">{t('Switch app')}</span>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">{WORKSPACES[current].suffix}</span>
        </button>
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
