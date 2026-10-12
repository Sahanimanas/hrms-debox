import React from 'react';
import { ArrowRight } from 'lucide-react';
import { WORKSPACES } from '@/lib/workspace';
import { useT } from '@/lib/i18n';

/**
 * First step of the sign-in screen: pick Xeno HR or Xeno Project Management.
 * Both use the same account — the choice decides where you land after login.
 */
const WorkspaceChooser = ({ onChoose, lastUsed }) => {
  const t = useT();
  return (
    <div className="space-y-4" data-testid="workspace-chooser">
      <div>
        <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>{t('Choose your workspace')}</h2>
        <p className="text-sm text-slate-500 mt-1">{t('One account for both apps. You can switch at any time after signing in.')}</p>
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
              className="group w-full text-left rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-5 hover:border-slate-900 hover:shadow-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center shrink-0 group-hover:bg-yellow-400 transition-colors">
                  <Icon className="w-6 h-6 text-yellow-400 group-hover:text-slate-900 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-slate-900 text-base sm:text-lg" style={{ fontFamily: 'Plus Jakarta Sans' }}>{w.name}</p>
                    {lastUsed === w.key && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-yellow-100 text-yellow-800 rounded-full px-2 py-0.5">{t('Last used')}</span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mt-0.5">{t(w.tagline)}</p>
                  <p className="text-sm text-slate-600 mt-1.5">{t(w.description)}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-900 group-hover:translate-x-0.5 transition-all shrink-0 mt-3" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WorkspaceChooser;
