import React, { useState, useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Home, Users, FileText, CheckSquare, User, LogOut, Menu, X, Settings, Bell, Network, ClipboardList, Wallet, Gift, Building2, BarChart3, DollarSign, Calculator, Layout as LayoutIcon, Clock, Clock3, Timer, CalendarDays, Receipt, ClipboardCheck, Sparkles } from 'lucide-react';
import { clearAuth, getAuth, hasPermission } from '@/lib/auth';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clearOrgPreferences } from '@/lib/orgPreferences';
import NotificationBell from '@/components/NotificationBell';
import BrandLogo from '@/components/BrandLogo';
import SidebarNav from '@/components/SidebarNav';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import Topbar from '@/components/Topbar';
import { Avatar } from '@/components/ds';
import { moduleNav } from '@/modules/registry';
import InstallPrompt from '@/modules/platform/components/InstallPrompt';
import LanguageSwitcher from '@/modules/platform/components/LanguageSwitcher';
import AssistantWidget from '@/modules/platform/components/AssistantWidget';
import { OfflineBanner, TwoFactorBanner } from '@/modules/platform/components/ShellBanners';
import ErrorBoundary from '@/components/ErrorBoundary';

// Built-in pages. Modules add theirs through src/modules/registry.js.
// Visibility: an item shows when the user's role is in `roles`, OR — when the
// item declares a `permission` — the user holds that permission (PL-5).
const CORE_NAV = [
  { name: 'Dashboard', href: '/', icon: Home, roles: ['admin', 'manager', 'employee'], section: 'Overview' },
  { name: 'Profile', href: '/profile', icon: User, roles: ['admin', 'manager', 'employee'], section: 'Overview' },

  { name: 'My Attendance', href: '/my-attendance', icon: Clock, roles: ['admin', 'manager', 'employee'], section: 'Time & Attendance' },
  { name: 'Attendance', href: '/attendance', icon: ClipboardCheck, roles: ['admin'], section: 'Time & Attendance' },
  { name: 'Time Tracking', href: '/time-tracking', icon: Timer, roles: ['admin', 'manager'], section: 'Time & Attendance' },
  { name: 'Shifts', href: '/shifts', icon: Clock3, roles: ['admin'], section: 'Time & Attendance' },

  { name: 'My Leaves', href: '/leaves', icon: FileText, roles: ['admin', 'manager', 'employee'], section: 'Leave' },
  { name: 'Leave Approvals', href: '/approvals', icon: CheckSquare, roles: ['admin', 'manager'], section: 'Leave' },
  { name: 'All Leaves', href: '/all-leaves', icon: ClipboardList, roles: ['admin'], section: 'Leave' },
  { name: 'Holidays', href: '/holidays', icon: CalendarDays, roles: ['admin', 'employee', 'manager'], section: 'Leave' },
  { name: 'Leave Balance', href: '/leave-balance', icon: Wallet, roles: ['admin', 'manager'], section: 'Leave' },
  { name: 'Balance Management', href: '/admin/leave-management', icon: Wallet, roles: ['admin'], section: 'Leave' },
  { name: 'Leave Policy', href: '/leave-policy', icon: FileText, roles: ['admin'], section: 'Leave' },
  { name: 'My Comp-Off', href: '/mycompoff', icon: Gift, roles: ['employee', 'manager'], section: 'Leave' },
  { name: 'Comp-Off', href: '/comp-off', icon: Gift, roles: ['admin', 'manager'], section: 'Leave' },
  { name: 'Comp-Off Approvals', href: '/compoffapproval', icon: Gift, roles: ['manager'], section: 'Leave' },
  { name: 'Comp-Off Approvals', href: '/admincompoff', icon: Gift, roles: ['admin'], section: 'Leave' },

  { name: 'Payroll', href: '/payroll', icon: DollarSign, roles: ['admin'], section: 'Payroll' },
  { name: 'Salary Structure', href: '/salary-structure', icon: Calculator, roles: ['admin'], section: 'Payroll' },
  { name: 'Salary Template', href: '/salary-template', icon: LayoutIcon, roles: ['admin'], section: 'Payroll' },

  { name: 'Employees', href: '/employees', icon: Users, roles: ['admin', 'manager'], section: 'People' },
  { name: 'Hierarchy', href: '/hierarchy', icon: Network, roles: ['admin', 'manager'], section: 'People' },
  { name: 'Organizations', href: '/organizations', icon: Building2, roles: ['admin'], section: 'People' },

  { name: 'My Reimbursements', href: '/myreimbursements', icon: Receipt, roles: ['employee', 'manager'], section: 'Assets & Expenses' },
  { name: 'Reimbursement Approvals', href: '/adminreimbursements', icon: Receipt, roles: ['admin'], section: 'Assets & Expenses' },

  { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin', 'manager'], section: 'Insights' },

  { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin'], section: 'Administration' },
  { name: 'Notifications', href: '/notifications', icon: Bell, roles: ['admin'], section: 'Administration' },
];

/** Visible when the role matches, or the item's `permission` is held (admins hold all). */
const isNavItemVisible =(item, user, permissions) =>
  (Array.isArray(item.roles) && item.roles.includes(user?.role)) ||
  (!!item.permission && hasPermission(user, permissions, item.permission));

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, setLanguage } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [lastPath, setLastPath] = useState(location.pathname);
  const { user: storedUser } = getAuth();

  // Close the mobile sidebar whenever the route changes (adjust state during render)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setSidebarOpen(false);
  }

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  useEffect(() => {
    let alive = true;
    api.get('/auth/me')
      .then((response) => {
        if (!alive) return;
        const me = response.data;
        setCurrentUser(me);
        // Keep the cached role in sync (custom role assignment can change it)
        const { user } = getAuth();
        if (user && me?.role && user.role !== me.role) {
          localStorage.setItem('user', JSON.stringify({ ...user, role: me.role }));
        }
        if (me?.language && me.language !== language) setLanguage(me.language, { sync: false });
      })
      .catch((error) => console.error('Failed to fetch user:', error));
    return () => { alive = false; };
    // Run once per mount; language is only applied from the server on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide the "Ask Xeno AI" card and floating assistant button until AI is set up
  // (same check the AI Assistant page uses). Re-checked after leaving AI settings.
  const [aiConfigured, setAiConfigured] = useState(false);
  const onAiSettings = location.pathname === '/ai-settings';
  useEffect(() => {
    if (onAiSettings) return undefined;
    let alive = true;
    api.get('/v2/platform/assistant/status')
      .then((response) => { if (alive) setAiConfigured(!!response.data?.configured); })
      .catch(() => { if (alive) setAiConfigured(false); });
    return () => { alive = false; };
  }, [onAiSettings]);

  const handleLogout = () => {
    clearAuth();
    clearOrgPreferences();
    navigate('/login');
  };

  const user = currentUser ? { ...storedUser, role: currentUser.role || storedUser?.role } : storedUser;
  const permissions = currentUser?.permissions || [];
  const filteredNavigation = [...CORE_NAV, ...moduleNav].filter(item => isNavItemVisible(item, user, permissions));

  // Exact match or a sub-path, so /attendance doesn't also light up /attendance-requests
  const isActive = (href) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname === href || location.pathname.startsWith(`${href}/`);
  };

  const displayName = currentUser?.full_name || user?.full_name;
  const profilePictureUrl = currentUser?.profile_picture_url;
  const roleLabel = currentUser?.custom_role_name || user?.role;
  const email = currentUser?.email || user?.email;
  const orgName = currentUser?.organization_name || currentUser?.organization?.name;
  const sidebarProps = {
    items: filteredNavigation, isActive, orgName, displayName, profilePictureUrl, roleLabel, onLogout: handleLogout, aiConfigured,
  };

  return (
    <div className="flex h-screen bg-canvas">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-[264px] shrink-0 bg-navy">
        <SidebarBody {...sidebarProps} />
      </aside>

      {/* Mobile Sidebar with Animation */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-opacity duration-300 ease-in-out ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <div
          className={`fixed inset-0 bg-navy/50 transition-opacity duration-300 ease-in-out ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setSidebarOpen(false)}
        />
        <aside
          className={`fixed inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col bg-navy shadow-2xl transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <SidebarBody {...sidebarProps} onNavigate={() => setSidebarOpen(false)} onClose={() => setSidebarOpen(false)} />
        </aside>
      </div>

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between h-14 px-4 bg-surface border-b border-line shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-ink-secondary hover:text-ink hover:bg-subtle rounded-md transition-colors"
            data-testid="mobile-menu-btn"
            aria-label="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <BrandLogo size="sm" tone="dark" />
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link to="/profile" className="flex-shrink-0">
              <Avatar name={displayName} src={profilePictureUrl} size="sm" className="bg-brand text-brand-on" />
            </Link>
          </div>
        </div>

        <Topbar
          navItems={filteredNavigation}
          name={displayName}
          email={email}
          pictureUrl={profilePictureUrl}
          onLogout={handleLogout}
        />

        <OfflineBanner />
        <TwoFactorBanner show={!!currentUser?.two_factor_setup_required && location.pathname !== '/security'} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {/* A crashing page shows an error card here instead of blanking the app */}
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <InstallPrompt />
      {aiConfigured && location.pathname !== '/assistant' && <AssistantWidget isAdmin={user?.role === 'admin'} />}
    </div>
  );
};

/** Sidebar contents (Figma "App/Sidebar"), shared by the desktop rail and the mobile drawer. */
const SidebarBody = ({ items, isActive, orgName, displayName, profilePictureUrl, roleLabel, onLogout, onNavigate, onClose, aiConfigured }) => {
  const { t } = useI18n();
  const hasAssistant = aiConfigured && items.some(i => i.href === '/assistant');
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-5 px-4 py-5">
      <div className="flex items-center gap-2.5 px-2">
        <BrandLogo size="md" className="flex-1" />
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 text-navy-text hover:text-white hover:bg-navy-hover rounded-md transition-colors"
            aria-label={t('Close')}
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        )}
      </div>

      <WorkspaceSwitcher current="hr" variant="card" title={orgName} />

      <nav className="flex-1 min-h-0 -mx-1 px-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#1c2740_transparent]">
        <SidebarNav items={items} isActive={isActive} onNavigate={onNavigate} compact />
      </nav>

      {hasAssistant && (
        <Link
          to="/assistant"
          onClick={onNavigate}
          className="block rounded-lg border border-navy-border bg-gradient-to-r from-brand/[0.18] to-[#7a59f7]/[0.18] p-4 hover:border-navy-text/40 transition-colors"
        >
          <span className="flex items-center gap-2 text-[13px] leading-[18px] font-medium text-white">
            <Sparkles className="w-4 h-4 text-brand" /> {t('Ask Xeno AI')}
          </span>
          <span className="mt-2.5 block text-xs leading-4 font-medium text-navy-text">
            “{t('How many casual leaves do I have left?')}”
          </span>
        </Link>
      )}

      {onClose && <LanguageSwitcher tone="dark" className="px-2" />}

      <div className="flex items-center gap-2.5 border-t border-navy-border pt-4 px-2">
        <Link to="/profile" onClick={onNavigate} className="flex flex-1 min-w-0 items-center gap-2.5 rounded-md hover:opacity-90">
          <Avatar name={displayName} src={profilePictureUrl} size="sm" className="bg-brand text-brand-on" />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] leading-[18px] font-medium text-white truncate">{displayName}</span>
            <span className="block text-xs leading-4 font-medium text-navy-text truncate capitalize">{roleLabel}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={onLogout}
          className="p-1.5 rounded-md text-navy-text hover:text-white hover:bg-navy-hover transition-colors"
          aria-label={t('Logout')}
          title={t('Logout')}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default Layout;
