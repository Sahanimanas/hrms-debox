/**
 * Feature module registry.
 *
 * Each module (src/modules/<name>/index.jsx) default-exports:
 *   routes:           [{ path: 'payroll-runs', element: <Page /> }]            // inside the app shell, login required
 *   publicRoutes:     [{ path: '/careers', element: <Page /> }]                // no login, no app shell
 *   nav:              [{ name, href, icon, roles: ['admin', …], section }]     // sidebar entries
 *   dashboardWidgets: [{ key, component: Widget, roles: ['admin', …], order }] // cards on the dashboard
 *
 * `section` must be one of NAV_SECTIONS below.
 */

import time from './time';
import payroll from './payroll';
import lifecycle from './lifecycle';
import leave from './leave';
import engagement from './engagement';
import performance from './performance';
import recruitment from './recruitment';
import assets from './assets';
import analytics from './analytics';
import platform from './platform';
import projects from './projects';

export const NAV_SECTIONS = [
  'Overview',
  'Time & Attendance',
  'Leave',
  'Payroll',
  'People',
  'Engagement',
  'Performance',
  'Recruitment',
  'Assets & Expenses',
  'Insights',
  'Administration',
];

const modules = { time, payroll, lifecycle, leave, engagement, performance, recruitment, assets, analytics, platform, projects };

const collect = (key) => Object.values(modules).flatMap(m => m?.[key] || []);

export const moduleRoutes = collect('routes');
export const modulePublicRoutes = collect('publicRoutes');
export const moduleNav = collect('nav');
export const moduleDashboardWidgets = collect('dashboardWidgets').sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
