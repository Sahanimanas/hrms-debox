import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, CheckSquare, FolderKanban, Gauge, Search, LogOut, Menu, X, Star, CalendarClock, Plane, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { clearAuth, getAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { clearOrgPreferences } from '@/lib/orgPreferences';
import { setWorkspace } from '@/lib/workspace';
import BrandLogo from '@/components/BrandLogo';
import NotificationBell from '@/components/NotificationBell';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import LanguageSwitcher from '@/modules/platform/components/LanguageSwitcher';
import { OfflineBanner } from '@/modules/platform/components/ShellBanners';
import { API, PROJECTS_CHANGED } from '../lib';
import { Avatar, ProjectDot } from './Shared';
import SearchDialog from './SearchDialog';

const NAV = [
  { name: 'Home', href: '/pm', icon: LayoutDashboard, exact: true },
  { name: 'My Tasks', href: '/pm/my-tasks', icon: CheckSquare },
  { name: 'Projects', href: '/pm/projects', icon: FolderKanban },
  { name: 'Workload', href: '/pm/workload', icon: Gauge },
];

// Shortcuts into Xeno HR for the things project work depends on
const HR_LINKS = [
  { name: 'Timesheets', href: '/timesheets', icon: CalendarClock },
  { name: 'My Leaves', href: '/leaves', icon: Plane },
  { name: 'Holidays', href: '/holidays', icon: CalendarDays },
];

function NavLinks({ isActive, projects, onNavigate, t }) {
  const starred = projects.filter(p => p.favorite);
  const recent = projects.filter(p => !p.favorite).slice(0, 6);
  const linkCls = (active) => `flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${active ? 'bg-yellow-400 text-slate-900' : 'text-slate-300 hover:bg-slate-800 hover:text-yellow-400'}`;
  const projectLink = (p) => (
    <Link key={p.id} to={`/pm/projects/${p.id}`} onClick={onNavigate} className={linkCls(isActive(`/pm/projects/${p.id}`))}>
      <ProjectDot color={p.color} className="mr-3" />
      <span className="truncate">{p.name}</span>
      <span className="ml-auto text-[10px] text-slate-500">{p.key}</span>
    </Link>
  );
  return (
    <div className="space-y-5">
      <div className="space-y-0.5">
        {NAV.map(item => {
          const Icon = item.icon;
          return (
            <Link key={item.href} to={item.href} onClick={onNavigate} data-testid={`pm-nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`} className={linkCls(isActive(item.href, item.exact))}>
              <Icon className="w-[18px] h-[18px] mr-3 shrink-0" /><span className="truncate">{t(item.name)}</span>
            </Link>
          );
        })}
      </div>
      {starred.length > 0 && (
        <div>
          <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1"><Star className="w-3 h-3" /> {t('Starred')}</p>
          <div className="space-y-0.5">{starred.map(projectLink)}</div>
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('Projects')}</p>
          <div className="space-y-0.5">{recent.map(projectLink)}</div>
        </div>
      )}
      <div>
        <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('From Xeno HR')}</p>
        <div className="space-y-0.5">
          {HR_LINKS.map(item => {
            const Icon = item.icon;
            return (
              <Link key={item.href} to={item.href} onClick={() => { setWorkspace('hr'); onNavigate?.(); }} className={linkCls(false)}>
                <Icon className="w-[18px] h-[18px] mr-3 shrink-0" /><span className="truncate">{t(item.name)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** App shell for Xeno PM (/pm/*): its own sidebar, shared account, notifications and app switcher. */
export default function PmLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [me, setMe] = useState(null);
  const [lastPath, setLastPath] = useState(location.pathname);
  const { user } = getAuth();

  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setSidebarOpen(false);
  }

  const loadProjects = useCallback(() => {
    api.get(`${API}/projects`).then(r => setProjects(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setWorkspace('pm');
    loadProjects();
    api.get('/auth/me').then(r => setMe(r.data)).catch(() => {});
    window.addEventListener(PROJECTS_CHANGED, loadProjects);
    return () => window.removeEventListener(PROJECTS_CHANGED, loadProjects);
  }, [loadProjects]);

  // Ctrl/Cmd + K opens search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const isActive = (href, exact) => (exact ? location.pathname === href : location.pathname === href || location.pathname.startsWith(`${href}/`));

  const logout = () => {
    clearAuth();
    clearOrgPreferences();
    navigate('/login?app=pm');
  };

  const name = me?.full_name || user?.full_name;
  const picture = me?.profile_picture_url;

  const searchButton = (
    <button type="button" onClick={() => setSearchOpen(true)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 text-sm">
      <Search className="w-4 h-4" /> <span>{t('Search')}</span>
      <kbd className="ml-auto text-[10px] border border-slate-600 rounded px-1">Ctrl K</kbd>
    </button>
  );

  const footer = (
    <>
      <WorkspaceSwitcher current="pm" />
      <LanguageSwitcher tone="dark" />
      <Button onClick={logout} variant="ghost" className="w-full justify-start text-slate-300 hover:text-yellow-400 hover:bg-slate-800" data-testid="pm-logout-btn">
        <LogOut className="w-4 h-4 mr-2" />{t('Logout')}
      </Button>
    </>
  );

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:flex-col md:w-64 bg-slate-900 border-r border-slate-800">
        <div className="flex items-center h-16 px-6 border-b border-slate-800"><BrandLogo size="md" product="pm" /></div>
        <div className="px-3 pt-4">{searchButton}</div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <NavLinks isActive={isActive} projects={projects} t={t} />
        </nav>
        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <Link to="/profile" onClick={() => setWorkspace('hr')} className="flex items-center flex-1 min-w-0 p-2 -mx-2 rounded-lg hover:bg-slate-800">
              <Avatar name={name} picture={picture} size="lg" />
              <div className="ml-3 min-w-0">
                <p className="text-sm font-medium text-white truncate">{name}</p>
                <p className="text-xs text-slate-400 truncate capitalize">{me?.custom_role_name || user?.role}</p>
              </div>
            </Link>
            <NotificationBell />
          </div>
          {footer}
        </div>
      </div>

      {/* Mobile sidebar */}
      <div className={`fixed inset-0 z-40 md:hidden transition-opacity duration-300 ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="fixed inset-0 bg-slate-900/50" onClick={() => setSidebarOpen(false)} />
        <div className={`fixed inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col bg-slate-900 shadow-2xl transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between h-16 px-4 border-b border-slate-800 shrink-0">
            <BrandLogo size="md" product="pm" />
            <button type="button" onClick={() => setSidebarOpen(false)} className="p-2 text-slate-400 hover:text-yellow-400 rounded-lg" aria-label={t('Close')}><X className="w-5 h-5" /></button>
          </div>
          <div className="px-3 pt-4">{searchButton}</div>
          <nav className="flex-1 px-3 py-4 overflow-y-auto">
            <NavLinks isActive={isActive} projects={projects} t={t} onNavigate={() => setSidebarOpen(false)} />
          </nav>
          <div className="p-4 border-t border-slate-800 space-y-3 shrink-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>{footer}</div>
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-slate-200 shrink-0">
          <button type="button" onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-lg" aria-label="Menu"><Menu className="w-5 h-5" /></button>
          <BrandLogo size="sm" tone="dark" product="pm" />
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setSearchOpen(true)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg" aria-label={t('Search')}><Search className="w-5 h-5" /></button>
            <NotificationBell />
          </div>
        </div>
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
