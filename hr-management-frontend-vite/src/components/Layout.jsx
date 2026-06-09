import React, { useState, useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Home, Users, FileText, CheckSquare, User, LogOut, Menu, X, Settings, Bell, Network, ClipboardList, Wallet, Gift, Building2, BarChart3, DollarSign, Calculator, Layout as LayoutIcon } from 'lucide-react';
import { clearAuth, getAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { ClipboardCheck } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';


const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const { user } = getAuth();

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const response = await api.get('/auth/me');
        setCurrentUser(response.data);
      } catch (error) {
        console.error('Failed to fetch user:', error);
      }
    };
    fetchCurrentUser();
  }, []);

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  // Helper function to get initials from name
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Helper function to generate a consistent color based on name
  const getAvatarColor = (name) => {
    const colors = [
      'bg-slate-900',
      'bg-emerald-500',
      'bg-purple-500',
      'bg-amber-500',
      'bg-rose-500',
      'bg-cyan-500',
      'bg-slate-800',
      'bg-pink-500',
      'bg-teal-500',
      'bg-orange-500',
    ];
    if (!name) return colors[0];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  const navigation = [
    { name: 'Dashboard', href: '/', icon: Home, roles: ['admin', 'manager', 'employee'] },
    { name: 'Employees', href: '/employees', icon: Users, roles: ['admin', 'manager'] },
    { name: 'Hierarchy', href: '/hierarchy', icon: Network, roles: ['admin', 'manager'] },
    { name: 'Attendance', href: '/attendance', icon: ClipboardCheck, roles: ['admin',] },
    { name: 'My Leaves', href: '/leaves', icon: FileText, roles: ['admin', 'manager', 'employee'] },
    { name: 'All Leaves', href: '/all-leaves', icon: ClipboardList, roles: ['admin'] },
    { name: 'Holidays', href: '/holidays', icon: ClipboardList, roles: ['admin', 'employee', 'manager'] },
    { name: 'Leave Balance', href: '/leave-balance', icon: Wallet, roles: ['admin', 'manager'] },
    { name: 'Comp-Off', href: '/comp-off', icon: Gift, roles: ['admin', 'manager'] },
    { name: 'mycompoff', href: '/mycompoff', icon: Gift, roles: ['employee', 'manager'] },
    { name: 'Compoff Approval', href: '/compoffapproval', icon: Gift, roles: ['manager'] },
    { name: 'Compoff Approval', href: '/admincompoff', icon: Gift, roles: ['admin'] },
    { name: 'Reimbursement', href: '/myreimbursements', icon: Gift, roles: ['employee', 'manager'] },
    { name: 'Reimbursement Approvals', href: '/adminreimbursements', icon: Gift, roles: ['admin',] },
    { name: 'Approvals', href: '/approvals', icon: CheckSquare, roles: ['admin', 'manager'] },
    { name: 'Leave Policy', href: '/leave-policy', icon: FileText, roles: ['admin'] },
    { name: 'Organizations', href: '/organizations', icon: Building2, roles: ['admin'] },
    { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin', 'manager'] },
    { name: 'Payroll', href: '/payroll', icon: DollarSign, roles: ['admin'] },
    { name: 'Salary Structure', href: '/salary-structure', icon: Calculator, roles: ['admin'] },
    { name: 'Salary Template', href: '/salary-template', icon: LayoutIcon, roles: ['admin'] },
    { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin'] },
    { name: 'Notifications', href: '/notifications', icon: Bell, roles: ['admin'] },
    { name: 'Leave Balance Management', href: '/admin/leave-management', icon: Bell, roles: ['admin'] },
    { name: 'Profile', href: '/profile', icon: User, roles: ['admin', 'manager', 'employee'] },
  ];

  const filteredNavigation = navigation.filter((item) =>
    item.roles.includes(user?.role)
  );

  const isActive = (href) => {
    if (href === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(href);
  };

  const displayName = currentUser?.full_name || user?.full_name;
  const profilePictureUrl = currentUser?.profile_picture_url;

  // Avatar component to avoid repetition
  const UserAvatar = ({ size = 'md' }) => {
    const sizeClasses = size === 'md' ? 'w-10 h-10' : 'w-8 h-8';
    const textSize = size === 'md' ? 'text-sm' : 'text-xs';

    return (
      <div className={`flex-shrink-0 ${sizeClasses} rounded-full overflow-hidden ring-2 ring-slate-100`}>
        {profilePictureUrl ? (
          <img
            src={profilePictureUrl}
            alt={displayName}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className={`w-full h-full ${getAvatarColor(displayName)} flex items-center justify-center text-white font-semibold ${textSize}`}
          style={{ display: profilePictureUrl ? 'none' : 'flex' }}
        >
          {getInitials(displayName)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-col md:w-64 bg-slate-900 border-r border-slate-800">
        <div className="flex items-center h-16 px-6 border-b border-slate-800">
          <img src="/logo_debox_tagline-w.png" alt="DeBox" className="h-10 w-auto" />
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {filteredNavigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                data-testid={`nav-${item.name.toLowerCase().replace(' ', '-')}`}
                className={`
                  flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all
                  ${active
                    ? 'bg-yellow-400 text-slate-900'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-yellow-400'
                  }
                `}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <Link
              to="/profile"
              className="flex items-center flex-1 p-2 -mx-2 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <UserAvatar size="md" />
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {displayName}
                </p>
                <p className="text-xs text-slate-400 truncate capitalize">{user?.role}</p>
              </div>
            </Link>
            <NotificationBell />
          </div>
          <Button
            onClick={handleLogout}
            data-testid="logout-btn"
            variant="ghost"
            className="w-full justify-start text-slate-300 hover:text-yellow-400 hover:bg-slate-800"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      {/* Mobile Sidebar with Animation */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-opacity duration-300 ease-in-out ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
      >
        {/* Overlay with fade animation */}
        <div
          className={`fixed inset-0 bg-slate-900/50 transition-opacity duration-300 ease-in-out ${sidebarOpen ? 'opacity-100' : 'opacity-0'
            }`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* Sidebar panel with slide animation */}
        <div
          className={`fixed inset-y-0 left-0 w-72 bg-slate-900 shadow-2xl transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between h-16 px-4 border-b border-slate-800">
            <img src="/logo_debox_tagline-w.png" alt="DeBox" className="h-9 w-auto" />
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 text-slate-400 hover:text-yellow-400 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile User Info at Top */}
          <div className="px-4 py-4 border-b border-slate-800">
            <Link
              to="/profile"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center p-2 -mx-2 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <UserAvatar size="md" />
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {displayName}
                </p>
                <p className="text-xs text-slate-400 truncate capitalize">{user?.role}</p>
              </div>
            </Link>
          </div>

          {/* Navigation with staggered animation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {filteredNavigation.map((item, index) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all
                    ${active
                      ? 'bg-yellow-400 text-slate-900'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-yellow-400'
                    }
                  `}
                  style={{
                    transitionDelay: sidebarOpen ? `${index * 20}ms` : '0ms',
                    opacity: sidebarOpen ? 1 : 0,
                    transform: sidebarOpen ? 'translateX(0)' : 'translateX(-10px)',
                    transition: 'opacity 200ms ease-out, transform 200ms ease-out, background-color 150ms',
                  }}
                >
                  <Icon className="w-5 h-5 mr-3 flex-shrink-0" />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Logout Button */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800 bg-slate-900">
            <Button
              onClick={handleLogout}
              variant="ghost"
              className="w-full justify-start text-slate-300 hover:text-yellow-400 hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-slate-200">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            data-testid="mobile-menu-btn"
          >
            <Menu className="w-5 h-5" />
          </button>
          <img src="/logo_debox_tagline-w.png" alt="DeBox" className="h-8 w-auto" />
          {/* Mobile header actions */}
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Link to="/profile" className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-slate-100">
                {profilePictureUrl ? (
                  <img
                    src={profilePictureUrl}
                    alt={displayName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className={`w-full h-full ${getAvatarColor(displayName)} flex items-center justify-center text-white font-semibold text-xs`}
                  style={{ display: profilePictureUrl ? 'none' : 'flex' }}
                >
                  {getInitials(displayName)}
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
