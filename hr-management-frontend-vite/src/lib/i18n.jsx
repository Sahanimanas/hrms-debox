/* eslint-disable react-refresh/only-export-components */
// UI translations (PL-8).
//
//   import { useT } from '@/lib/i18n';
//   const t = useT();
//   <h1>{t('Leave Approvals')}</h1>            // English text is the key
//   t('Hello {name}', { name })                // {placeholders} are interpolated
//
// The language is stored in localStorage and, for signed-in users, saved to
// the backend (PUT /v2/platform/preferences/me) so it follows them across devices.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { DICTIONARIES, LANGUAGES } from '@/lib/i18n-dictionaries';

const STORAGE_KEY = 'xenohr-language';

const readStored = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && DICTIONARIES[v]) return v;
  } catch { /* storage unavailable */ }
  return 'en';
};

const interpolate = (text, vars) =>
  vars ? String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : text;

const translate = (lang, key, vars) => interpolate(DICTIONARIES[lang]?.[key] ?? key, vars);

const I18nContext = createContext({
  language: 'en',
  languages: LANGUAGES,
  setLanguage: () => {},
  t: (key, vars) => interpolate(key, vars),
});

export function I18nProvider({ children }) {
  const [language, setLang] = useState(readStored);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  /** Change language; `sync: false` skips saving to the server (e.g. when applying the server value). */
  const setLanguage = useCallback((code, { sync = true } = {}) => {
    if (!DICTIONARIES[code]) return;
    setLang(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch { /* storage unavailable */ }
    if (sync && localStorage.getItem('token')) {
      api.put('/v2/platform/preferences/me', { language: code }).catch(() => {});
    }
  }, []);

  const t = useCallback((key, vars) => translate(language, key, vars), [language]);
  const value = useMemo(() => ({ language, languages: LANGUAGES, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Returns t(englishText, vars?) for the current language. */
export function useT() {
  return useContext(I18nContext).t;
}

/** Full context: { language, languages, setLanguage, t }. */
export function useI18n() {
  return useContext(I18nContext);
}
