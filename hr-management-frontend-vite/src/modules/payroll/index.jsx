// payroll module: pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
import React from 'react';
import {
  Banknote, Settings2, IdCard, FileCheck2, HandCoins, Calculator, FileSpreadsheet, History, ReceiptText, Landmark,
} from 'lucide-react';
import PayrollRunsPage from './pages/PayrollRunsPage';
import PayrollRunDetailPage from './pages/PayrollRunDetailPage';
import PayrollSettingsPage from './pages/PayrollSettingsPage';
import StatutoryDetailsPage from './pages/StatutoryDetailsPage';
import DeclarationsReviewPage from './pages/DeclarationsReviewPage';
import LoansAdminPage from './pages/LoansAdminPage';
import GratuityPage from './pages/GratuityPage';
import StatutoryReportsPage from './pages/StatutoryReportsPage';
import SalaryRevisionsPage from './pages/SalaryRevisionsPage';
import MyPayslipsPage from './pages/MyPayslipsPage';
import MyTaxDeclarationsPage from './pages/MyTaxDeclarationsPage';
import MyLoansPage from './pages/MyLoansPage';
import MySalaryHistoryPage from './pages/MySalaryHistoryPage';
import { LatestPayslipWidget, PayrollAdminWidget } from './components/PayrollWidgets';

const ALL = ['admin', 'manager', 'employee'];
const ADMIN = ['admin'];

const payrollModule = {
  routes: [
    { path: 'payroll/runs', element: <PayrollRunsPage /> },
    { path: 'payroll/runs/:id', element: <PayrollRunDetailPage /> },
    { path: 'payroll/settings', element: <PayrollSettingsPage /> },
    { path: 'payroll/statutory', element: <StatutoryDetailsPage /> },
    { path: 'payroll/declarations', element: <DeclarationsReviewPage /> },
    { path: 'payroll/loans', element: <LoansAdminPage /> },
    { path: 'payroll/gratuity', element: <GratuityPage /> },
    { path: 'payroll/reports', element: <StatutoryReportsPage /> },
    { path: 'payroll/revisions', element: <SalaryRevisionsPage /> },
    { path: 'my-payslips', element: <MyPayslipsPage /> },
    { path: 'my-tax', element: <MyTaxDeclarationsPage /> },
    { path: 'my-loans', element: <MyLoansPage /> },
    { path: 'my-salary', element: <MySalaryHistoryPage /> },
  ],
  publicRoutes: [],
  nav: [
    { name: 'My Payslips', href: '/my-payslips', icon: ReceiptText, roles: ALL, section: 'Payroll' },
    { name: 'My Tax Declarations', href: '/my-tax', icon: Landmark, roles: ALL, section: 'Payroll' },
    { name: 'My Loans', href: '/my-loans', icon: HandCoins, roles: ALL, section: 'Payroll' },
    { name: 'My Salary History', href: '/my-salary', icon: History, roles: ALL, section: 'Payroll' },
    { name: 'Payroll Runs', href: '/payroll/runs', icon: Banknote, roles: ADMIN, section: 'Payroll' },
    { name: 'Statutory Details', href: '/payroll/statutory', icon: IdCard, roles: ADMIN, section: 'Payroll' },
    { name: 'Declarations Review', href: '/payroll/declarations', icon: FileCheck2, roles: ADMIN, section: 'Payroll' },
    { name: 'Loans & Advances', href: '/payroll/loans', icon: HandCoins, roles: ADMIN, section: 'Payroll' },
    { name: 'Salary Revisions', href: '/payroll/revisions', icon: History, roles: ADMIN, section: 'Payroll' },
    { name: 'Statutory Reports', href: '/payroll/reports', icon: FileSpreadsheet, roles: ADMIN, section: 'Payroll' },
    { name: 'Gratuity Calculator', href: '/payroll/gratuity', icon: Calculator, roles: ADMIN, section: 'Payroll' },
    { name: 'Payroll Settings', href: '/payroll/settings', icon: Settings2, roles: ADMIN, section: 'Payroll' },
  ],
  dashboardWidgets: [
    { key: 'payroll-admin', component: PayrollAdminWidget, roles: ADMIN, order: 30 },
    { key: 'payroll-latest-payslip', component: LatestPayslipWidget, roles: ALL, order: 31 },
  ],
};

export default payrollModule;
