import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ChevronDown, User, LogOut, Languages } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import NotificationBell from '@/components/NotificationBell';
import { Avatar } from '@/components/ds';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const fmtDuration = (minutes) => {
  const m = Math.max(0, Math.floor(minutes || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}h ${String(m % 60).padStart(2, '0')}m`;
};

/** "Clocked in · 04h 12m" pill, refreshed every 30 seconds. Hidden for accounts without an employee profile. */
const ClockStatus = () => {
  const { t } = useI18n();
  const [today, setToday] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    api.get('/time/today').then((r) => { if (alive) setToday(r.data); }).catch(() => {});
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!today?.has_profile) return null;
  const { log, clocked_in: clockedIn } = today;
  const finished = log?.clock_out && log.date === today.date;

  let cls = 'bg-warning-bg text-warning-fg';
  let dot = 'bg-warning-solid';
  let label = t('Not clocked in');
  if (clockedIn && log) {
    cls = 'bg-success-bg text-success-fg';
    dot = 'bg-success-solid';
    label = `${t('Clocked in')} · ${fmtDuration((now - new Date(log.clock_in)) / 60000)}`;
  } else if (finished) {
    cls = 'bg-subtle text-ink-secondary';
    dot = 'bg-ink-muted';
    label = `${t('Done for today')} · ${fmtDuration(log.worked_minutes)}`;
  }

  return (
    <Link to="/my-attendance" className={`hidden lg:inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold leading-4 whitespace-nowrap ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </Link>
  );
};

/** ⌘K search over the pages the user can open. */
const NavSearch = ({ items }) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => t(i.name).toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || (i.section || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, query, t]);

  const go = (item) => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    navigate(item.href);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); go(results[cursor]); }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="relative w-full max-w-[380px]">
      <label className="flex h-10 items-center gap-2.5 rounded-md bg-subtle px-3 focus-within:ring-2 focus-within:ring-ring/60">
        <Search className="h-[18px] w-[18px] shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={t('Search people, leaves, payslips…')}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted outline-none"
          data-testid="topbar-search"
        />
        <kbd className="hidden sm:inline-block rounded-sm border border-line bg-surface px-1.5 py-px text-xs font-semibold leading-4 text-ink-secondary">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </label>
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-sm">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-muted">{t('No matches')}</p>
          ) : results.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); go(item); }}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm ${i === cursor ? 'bg-subtle text-ink' : 'text-ink-secondary'}`}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" />}
                <span className="flex-1 truncate font-medium">{t(item.name)}</span>
                <span className="text-xs text-ink-muted">{t(item.section || 'Overview')}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const AccountMenu = ({ name, email, pictureUrl, onLogout }) => {
  const { t, language, languages, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2 text-left hover:bg-subtle" data-testid="account-menu">
          <Avatar name={name} src={pictureUrl} size="md" tone="accent" className="bg-brand text-brand-on" />
          <span className="hidden xl:flex flex-col min-w-0">
            <span className="text-sm font-semibold leading-5 text-ink truncate max-w-[160px]">{name}</span>
            {email && <span className="text-xs font-medium leading-4 text-ink-muted truncate max-w-[160px]">{email}</span>}
          </span>
          <ChevronDown className="h-4 w-4 text-ink-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-ink hover:bg-subtle">
          <User className="h-4 w-4 text-ink-secondary" /> {t('Profile')}
        </Link>
        <label className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-ink">
          <Languages className="h-4 w-4 text-ink-secondary" />
          <span className="sr-only">{t('Language')}</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            data-testid="language-switcher"
            className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-ring/60"
          >
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <div className="my-1 h-px bg-line" />
        <button type="button" onClick={onLogout} data-testid="logout-btn" className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-danger-fg hover:bg-danger-bg">
          <LogOut className="h-4 w-4" /> {t('Logout')}
        </button>
      </PopoverContent>
    </Popover>
  );
};

/** Global top bar (Figma "App/Topbar"): search, clock status, notifications, account. */
const Topbar = ({ navItems, name, email, pictureUrl, onLogout }) => (
  <header className="hidden md:flex h-[72px] shrink-0 items-center gap-3 border-b border-line bg-surface px-6 lg:px-8">
    <NavSearch items={navItems} />
    <div className="flex-1" />
    <ClockStatus />
    <NotificationBell />
    <div className="h-7 w-px bg-line" />
    <AccountMenu name={name} email={email} pictureUrl={pictureUrl} onLogout={onLogout} />
  </header>
);

export default Topbar;
