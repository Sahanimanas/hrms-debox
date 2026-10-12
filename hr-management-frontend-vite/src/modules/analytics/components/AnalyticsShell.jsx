import React from 'react';
import { NavLink } from 'react-router-dom';
import { Users, CalendarCheck, IndianRupee, FileSpreadsheet, Send } from 'lucide-react';
import { getAuth } from '@/lib/auth';

const ANALYTICS_TABS = [
  { to: '/analytics/people', label: 'People', icon: Users, roles: ['admin', 'manager'] },
  { to: '/analytics/attendance', label: 'Attendance & Leave', icon: CalendarCheck, roles: ['admin', 'manager'] },
  { to: '/analytics/payroll-cost', label: 'Payroll Cost', icon: IndianRupee, roles: ['admin'] },
  { to: '/analytics/reports', label: 'Reports', icon: FileSpreadsheet, roles: ['admin', 'manager'] },
  { to: '/analytics/deliveries', label: 'Delivery Log', icon: Send, roles: ['admin'] },
];

/**
 * Page frame for every analytics screen: icon tile + title, actions on the
 * right, and the hub's tab strip (scrolls sideways on phones).
 */
const AnalyticsShell = ({ icon, title, subtitle, actions, children }) => {
  const Icon = icon;
  const { user } = getAuth();
  const tabs = ANALYTICS_TABS.filter(t => t.roles.includes(user?.role));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg shrink-0">
              <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                {title}
              </h1>
              {subtitle && <p className="text-xs sm:text-sm text-slate-600">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>

        <nav className="-mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto" aria-label="Analytics sections">
          <div className="inline-flex gap-1 rounded-xl bg-white border border-slate-200 p-1 shadow-sm">
            {tabs.map((t) => {
              const TabIcon = t.icon;
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
                      isActive ? 'bg-slate-800 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <TabIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {t.label}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {children}
      </div>
    </div>
  );
};

export default AnalyticsShell;
