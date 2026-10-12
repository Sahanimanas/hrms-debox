// analytics module: pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.

import React from 'react';
import { Navigate } from 'react-router-dom';
import { Users, CalendarCheck, IndianRupee, FileSpreadsheet } from 'lucide-react';
import PeopleAnalyticsPage from './pages/PeopleAnalyticsPage';
import AttendanceAnalyticsPage from './pages/AttendanceAnalyticsPage';
import PayrollCostPage from './pages/PayrollCostPage';
import SavedReportsPage from './pages/SavedReportsPage';
import ReportBuilderPage from './pages/ReportBuilderPage';
import DeliveryLogPage from './pages/DeliveryLogPage';
import AnalyticsWidget from './components/AnalyticsWidget';

const analyticsModule = {
  routes: [
    { path: 'analytics', element: <Navigate to="/analytics/people" replace /> },
    { path: 'analytics/people', element: <PeopleAnalyticsPage /> },
    { path: 'analytics/attendance', element: <AttendanceAnalyticsPage /> },
    { path: 'analytics/payroll-cost', element: <PayrollCostPage /> },
    { path: 'analytics/reports', element: <SavedReportsPage /> },
    { path: 'analytics/reports/new', element: <ReportBuilderPage /> },
    { path: 'analytics/reports/:id/edit', element: <ReportBuilderPage /> },
    { path: 'analytics/deliveries', element: <DeliveryLogPage /> },
  ],
  publicRoutes: [],
  nav: [
    { name: 'People Analytics', href: '/analytics/people', icon: Users, roles: ['admin', 'manager'], section: 'Insights' },
    { name: 'Attendance & Leave Trends', href: '/analytics/attendance', icon: CalendarCheck, roles: ['admin', 'manager'], section: 'Insights' },
    { name: 'Payroll Cost', href: '/analytics/payroll-cost', icon: IndianRupee, roles: ['admin'], section: 'Insights' },
    { name: 'Custom Reports', href: '/analytics/reports', icon: FileSpreadsheet, roles: ['admin', 'manager'], section: 'Insights' },
  ],
  dashboardWidgets: [
    { key: 'analytics-summary', component: AnalyticsWidget, roles: ['admin'], order: 20 },
  ],
};

export default analyticsModule;
