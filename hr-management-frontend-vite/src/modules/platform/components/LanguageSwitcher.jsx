import React from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * Compact language picker (native select: accessible and works well on mobile).
 * tone="dark" for the slate sidebar, "light" for white headers.
 */
const LanguageSwitcher = ({ tone = 'dark', className = '' }) => {
  const { language, languages, setLanguage, t } = useI18n();
  const dark = tone === 'dark';
  return (
    <label className={`flex items-center gap-2 text-xs ${dark ? 'text-slate-400' : 'text-slate-600'} ${className}`}>
      <Languages className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('Language')}</span>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        data-testid="language-switcher"
        className={`flex-1 min-w-0 rounded-md px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-yellow-400 ${dark
          ? 'bg-slate-800 text-slate-200 border border-slate-700'
          : 'bg-white text-slate-700 border border-slate-200'}`}
      >
        {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
};

export default LanguageSwitcher;
