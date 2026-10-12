// assets module: pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
import React from 'react';
import { Package, Laptop, ClipboardList, Plane, ShieldCheck } from 'lucide-react';
import AssetsRegisterPage from './pages/AssetsRegisterPage';
import AssetDetailPage from './pages/AssetDetailPage';
import MyAssetsPage from './pages/MyAssetsPage';
import AssetRequestsPage from './pages/AssetRequestsPage';
import ExpensePolicyPage from './pages/ExpensePolicyPage';
import TravelRequestsPage from './pages/TravelRequestsPage';
import { AssetsAdminWidget, MyAssetsWidget } from './components/AssetsWidgets';

const SECTION = 'Assets & Expenses';
const ALL_ROLES = ['admin', 'manager', 'employee'];

const assetsModule = {
  routes: [
    { path: 'assets', element: <AssetsRegisterPage /> },
    { path: 'assets/:id', element: <AssetDetailPage /> },
    { path: 'my-assets', element: <MyAssetsPage /> },
    { path: 'asset-requests', element: <AssetRequestsPage /> },
    { path: 'travel', element: <TravelRequestsPage /> },
    { path: 'expense-policy', element: <ExpensePolicyPage /> },
  ],
  publicRoutes: [],
  nav: [
    { name: 'My Assets', href: '/my-assets', icon: Laptop, roles: ALL_ROLES, section: SECTION },
    { name: 'Asset Register', href: '/assets', icon: Package, roles: ['admin'], section: SECTION },
    { name: 'Asset Requests', href: '/asset-requests', icon: ClipboardList, roles: ['admin'], section: SECTION },
    { name: 'Travel', href: '/travel', icon: Plane, roles: ALL_ROLES, section: SECTION },
    { name: 'Expense Policy', href: '/expense-policy', icon: ShieldCheck, roles: ['admin'], section: SECTION },
  ],
  dashboardWidgets: [
    { key: 'assets-admin', component: AssetsAdminWidget, roles: ['admin'], order: 80 },
    { key: 'assets-mine', component: MyAssetsWidget, roles: ['employee', 'manager'], order: 20 },
  ],
};

export default assetsModule;
