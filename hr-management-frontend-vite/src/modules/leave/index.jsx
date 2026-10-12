// leave module: pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
import React from 'react';
import { CalendarRange, CalendarClock, GitBranch } from 'lucide-react';
import TeamCalendarPage from './pages/TeamCalendarPage';
import YearEndPage from './pages/YearEndPage';
import ApprovalSettingsPage from './pages/ApprovalSettingsPage';
import WhosOutTodayWidget from './components/WhosOutTodayWidget';

const leaveModule = {
  routes: [
    { path: 'team-calendar', element: <TeamCalendarPage /> },
    { path: 'leave-year-end', element: <YearEndPage /> },
    { path: 'leave-approvals-setup', element: <ApprovalSettingsPage /> },
  ],
  publicRoutes: [],
  nav: [
    { name: 'Team Calendar', href: '/team-calendar', icon: CalendarRange, roles: ['admin', 'manager', 'employee'], section: 'Leave' },
    { name: 'Approvals & Delegation', href: '/leave-approvals-setup', icon: GitBranch, roles: ['admin', 'manager'], section: 'Leave' },
    { name: 'Leave Year-End', href: '/leave-year-end', icon: CalendarClock, roles: ['admin'], section: 'Leave' },
  ],
  dashboardWidgets: [
    { key: 'leave-whos-out-today', component: WhosOutTodayWidget, roles: ['admin', 'manager', 'employee'], order: 30 },
  ],
};

export default leaveModule;
