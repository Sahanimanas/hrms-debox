// Organization preferences (currency, locale, date format) for the signed-in
// user's organization (PL-8). Fetched once per session and shared.
//
//   const { prefs, loading } = useOrgPreferences();
//   formatMoney(amount, prefs);
//   format(date, prefs.date_format)   // date-fns pattern, e.g. 'dd/MM/yyyy'
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '@/lib/money';

export const DEFAULT_ORG_PREFERENCES = { currency: DEFAULT_CURRENCY, locale: DEFAULT_LOCALE, date_format: 'dd/MM/yyyy' };

let cached = null;
let pending = null;

/** Promise of the current org preferences (cached; falls back to defaults on error). */
export function loadOrgPreferences({ refresh = false } = {}) {
  if (cached && !refresh) return Promise.resolve(cached);
  if (!pending || refresh) {
    pending = api.get('/v2/platform/org-preferences')
      .then((r) => {
        cached = { ...DEFAULT_ORG_PREFERENCES, ...r.data };
        return cached;
      })
      .catch(() => DEFAULT_ORG_PREFERENCES)
      .finally(() => { pending = null; });
  }
  return pending;
}

/** Forget cached preferences (after an admin edits them, or on logout). */
export function clearOrgPreferences() {
  cached = null;
}

export function useOrgPreferences() {
  const [prefs, setPrefs] = useState(cached || DEFAULT_ORG_PREFERENCES);
  const [loading, setLoading] = useState(!cached);
  useEffect(() => {
    let alive = true;
    loadOrgPreferences().then((p) => {
      if (alive) {
        setPrefs(p);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, []);
  return { prefs, loading };
}
