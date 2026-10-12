// Time & attendance additions: timesheets (TA-10) and attendance devices (TA-9).
// The core attendance pages (My Attendance, Time Tracking, Shifts) are wired in App.jsx / Layout.jsx.
import React from 'react';
import { CalendarClock, Fingerprint } from 'lucide-react';
import TimesheetsPage from './pages/TimesheetsPage';
import DevicesPage from './pages/DevicesPage';

const timeModule = {
  routes: [
    { path: 'timesheets', element: <TimesheetsPage /> },
    { path: 'attendance-devices', element: <DevicesPage /> },
  ],
  publicRoutes: [],
  nav: [
    { name: 'Timesheets', href: '/timesheets', icon: CalendarClock, roles: ['admin', 'manager', 'employee'], section: 'Time & Attendance' },
    { name: 'Devices', href: '/attendance-devices', icon: Fingerprint, roles: ['admin'], section: 'Time & Attendance' },
  ],
  dashboardWidgets: [],
};

export default timeModule;
