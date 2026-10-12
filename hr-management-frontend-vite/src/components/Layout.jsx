import React, { useState, useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Home, Users, FileText, CheckSquare, User, LogOut, Menu, X, Settings, Bell, Network, ClipboardList, Wallet, Gift, Building2, BarChart3, DollarSign, Calculator, Layout as LayoutIcon, Clock, Clock3, Timer, CalendarDays, Receipt, ClipboardCheck } from 'lucide-react';
import { clearAuth, getAuth, hasPermission } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clearOrgPreferences } from '@/lib/orgPreferences';
import NotificationBell from '@/components/NotificationBell';
import BrandLogo from '@/components/BrandLogo';
import SidebarNav from '@/components/SidebarNav';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import { moduleNav } from '@/modules/registry';
import InstallPrompt from '@/modules/platform/components/InstallPrompt';
import LanguageSwitcher from '@/modules/platform/components/LanguageSwitcher';
import AssistantWidget from '@/modules/platform/components/AssistantWidget';
import { OfflineBanner, TwoFactorBanner } from '@/modules/platform/components/ShellBanners';

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

const AVATAR_COLORS = [
  'bg-slate-900', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-slate-800', 'bg-pink-500', 'bg-teal-500', 'bg-orange-500',
];

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const getAvatarColor = (name) => {
  if (!name) return AVATAR_COLORS[0];
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
};

const UserAvatar = ({ name, pictureUrl, size = 'md' }) => {
  const [broken, setBroken] = useState(false);
  const sizeClasses = size === 'md' ? 'w-10 h-10' : 'w-8 h-8';
  const textSize = size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <div className={`flex-shrink-0 ${sizeClasses} rounded-full overflow-hidden ring-2 ring-slate-100`}>
      {pictureUrl && !broken ? (
        <img src={pictureUrl} alt={name} className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <div className={`w-full h-full ${getAvatarColor(name)} flex items-center justify-center text-white font-semibold ${textSize}`}>
          {getInitials(name)}
        </div>
      )}
    </div>
  );
};

/** Visible when the role matches, or the item's `permission` is held (admins hold all). */
const isNavItemVisible =(item, user, permissions) =>
  (Array.isArray(item.roles) && item.roles.includes(user?.role)) ||
  (!!item.permission && hasPermission(user, permissions, item.permission));

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language, setLanguage } = useI18n();
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

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-col md:w-64 bg-slate-900 border-r border-slate-800">
        <div className="flex items-center h-16 px-6 border-b border-slate-800">
          <BrandLogo size="md" />
        </div>

        <nav className="flex-1 px-3 py-5 overflow-y-auto">
          <SidebarNav items={filteredNavigation} isActive={isActive} compact />
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <Link to="/profile" className="flex items-center flex-1 min-w-0 p-2 -mx-2 rounded-lg hover:bg-slate-800 transition-colors">
              <UserAvatar name={displayName} pictureUrl={profilePictureUrl} size="md" />
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                <p className="text-xs text-slate-400 truncate capitalize">{roleLabel}</p>
              </div>
            </Link>
            <NotificationBell />
          </div>
          <WorkspaceSwitcher current="hr" />
          <LanguageSwitcher tone="dark" />
          <Button
            onClick={handleLogout}
            data-testid="logout-btn"
            variant="ghost"
            className="w-full justify-start text-slate-300 hover:text-yellow-400 hover:bg-slate-800"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {t('Logout')}
          </Button>
        </div>
      </div>

      {/* Mobile Sidebar with Animation */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-opacity duration-300 ease-in-out ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <div
          className={`fixed inset-0 bg-slate-900/50 transition-opacity duration-300 ease-in-out ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setSidebarOpen(false)}
        />

        <div
          className={`fixed inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col bg-slate-900 shadow-2xl transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="flex items-center justify-between h-16 px-4 border-b border-slate-800 shrink-0">
            <BrandLogo size="md" />
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 text-slate-400 hover:text-yellow-400 hover:bg-slate-800 rounded-lg transition-colors"
              aria-label={t('Close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-4 py-4 border-b border-slate-800 shrink-0">
            <Link
              to="/profile"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center p-2 -mx-2 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <UserAvatar name={displayName} pictureUrl={profilePictureUrl} size="md" />
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                <p className="text-xs text-slate-400 truncate capitalize">{roleLabel}</p>
              </div>
            </Link>
          </div>

          <nav className="flex-1 px-3 py-4 overflow-y-auto">
            <SidebarNav items={filteredNavigation} isActive={isActive} onNavigate={() => setSidebarOpen(false)} />
          </nav>

          <div className="p-4 border-t border-slate-800 bg-slate-900 space-y-3 shrink-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            <WorkspaceSwitcher current="hr" />
            <LanguageSwitcher tone="dark" />
            <Button
              onClick={handleLogout}
              variant="ghost"
              className="w-full justify-start text-slate-300 hover:text-yellow-400 hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4 mr-2" />
              {t('Logout')}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-slate-200 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            data-testid="mobile-menu-btn"
            aria-label="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <BrandLogo size="sm" tone="dark" />
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Link to="/profile" className="flex-shrink-0">
              <UserAvatar name={displayName} pictureUrl={profilePictureUrl} size="sm" />
            </Link>
          </div>
        </div>

        <OfflineBanner />
        <TwoFactorBanner show={!!currentUser?.two_factor_setup_required && location.pathname !== '/security'} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <InstallPrompt />
      {location.pathname !== '/assistant' && <AssistantWidget isAdmin={user?.role === 'admin'} />}
    </div>
  );
};

export default Layout;
