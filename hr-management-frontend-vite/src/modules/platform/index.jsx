// platform module (Phase 10 — platform & security): pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
//
// Nav items may declare `permission` (PL-5): the Layout shows the item when the
// user's role is in `roles` OR they hold that permission (admins hold all).
import React from 'react';
import { ScrollText, KeyRound, ShieldHalf, Plug, KeySquare, Coins, Bot } from 'lucide-react';
import AuditLogPage from './pages/AuditLogPage';
import SecurityPage from './pages/SecurityPage';
import RolesPage from './pages/RolesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import ApiWebhooksPage from './pages/ApiWebhooksPage';
import OrgPreferencesPage from './pages/OrgPreferencesPage';
import AssistantPage from './pages/AssistantPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
import SecurityWidget from './components/SecurityWidget';

const ALL = ['admin', 'manager', 'employee'];

const platformModule = {
  routes: [
    { path: 'audit-log', element: <AuditLogPage /> },
    { path: 'security', element: <SecurityPage /> },
    { path: 'roles', element: <RolesPage /> },
    { path: 'integrations', element: <IntegrationsPage /> },
    { path: 'api-webhooks', element: <ApiWebhooksPage /> },
    { path: 'org-preferences', element: <OrgPreferencesPage /> },
    { path: 'assistant', element: <AssistantPage /> },
  ],
  publicRoutes: [
    { path: '/sso/microsoft/callback', element: <SsoCallbackPage /> },
  ],
  nav: [
    { name: 'AI Assistant', href: '/assistant', icon: Bot, roles: ALL, section: 'Administration' },
    { name: 'Security', href: '/security', icon: KeyRound, roles: ALL, section: 'Administration' },
    { name: 'Integrations', href: '/integrations', icon: Plug, roles: ALL, section: 'Administration' },
    { name: 'Audit Log', href: '/audit-log', icon: ScrollText, roles: ['admin'], permission: 'audit.view', section: 'Administration' },
    { name: 'Roles & Permissions', href: '/roles', icon: ShieldHalf, roles: ['admin'], section: 'Administration' },
    { name: 'API & Webhooks', href: '/api-webhooks', icon: KeySquare, roles: ['admin'], section: 'Administration' },
    { name: 'Organization Preferences', href: '/org-preferences', icon: Coins, roles: ['admin'], section: 'Administration' },
  ],
  dashboardWidgets: [
    { key: 'platform-security', component: SecurityWidget, roles: ALL, order: 90 },
  ],
};

export default platformModule;
