import React, { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { WifiOff, ShieldAlert } from 'lucide-react';
import { useT } from '@/lib/i18n';

const subscribeOnline = (cb) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Thin banner while the device is offline. */
export const OfflineBanner = () => {
  const t = useT();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-100 text-amber-900 text-xs sm:text-sm border-b border-amber-200">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>{t("You're offline. Showing saved data where available.")}</span>
    </div>
  );
};

/** Prompt admins to enrol in 2FA when the organisation requires it. */
export const TwoFactorBanner = ({ show }) => {
  const t = useT();
  if (!show) return null;
  return (
    <div role="alert" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs sm:text-sm">
      <span className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-yellow-400 shrink-0" />
        {t('Two-factor authentication is required for administrators.')}
      </span>
      <Link to="/security" className="px-3 py-1 rounded-full bg-yellow-400 text-slate-900 font-semibold hover:bg-yellow-300">
        {t('Set up now')}
      </Link>
    </div>
  );
};
