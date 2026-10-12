import React, { useState, useSyncExternalStore } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { getInstallPrompt, onInstallPromptChange, promptInstall, isIos, isStandalone } from '@/lib/pwa';

const DISMISS_KEY = 'xenohr-install-dismissed-until';
const DISMISS_DAYS = 14;

const readDismissed = () => {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
};

const subscribe = (cb) => onInstallPromptChange(() => cb());

/**
 * "Install app" card (Chrome/Edge/Android via beforeinstallprompt) and an
 * add-to-home-screen hint on iOS Safari. Dismissal is remembered for 14 days.
 */
const InstallPrompt = () => {
  const t = useT();
  const promptEvent = useSyncExternalStore(subscribe, getInstallPrompt, () => null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [showIos] = useState(() => isIos() && !isStandalone());

  if (dismissed || isStandalone()) return null;
  if (!promptEvent && !showIos) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000));
    } catch { /* storage unavailable */ }
  };

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome !== 'accepted') dismiss();
  };

  return (
    <div
      role="dialog"
      aria-label={t('Install Xeno-HR')}
      className="fixed z-40 left-3 right-3 bottom-20 sm:left-auto sm:right-4 sm:w-80 rounded-xl bg-slate-900 text-white shadow-2xl border border-slate-700 p-4"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <button type="button" onClick={dismiss} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-white" aria-label={t('Close')}>
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-5">
        <img src="/android-chrome-192x192.png" alt="" className="w-10 h-10 rounded-lg shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t('Install Xeno-HR')}</p>
          {promptEvent ? (
            <p className="text-xs text-slate-300 mt-0.5">{t('Add Xeno-HR to your home screen for quick access.')}</p>
          ) : (
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
              Tap <Share className="inline w-3.5 h-3.5 -mt-0.5" aria-label="Share" /> in Safari, then
              {' '}<span className="font-medium text-white">Add to Home Screen</span>{' '}
              <PlusSquare className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" />.
            </p>
          )}
        </div>
      </div>
      {promptEvent && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={install} className="flex-1 bg-yellow-400 text-slate-900 hover:bg-yellow-300 gap-1.5">
            <Download className="w-4 h-4" /> {t('Install')}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss} className="text-slate-300 hover:text-white hover:bg-slate-800">
            {t('Not now')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default InstallPrompt;
