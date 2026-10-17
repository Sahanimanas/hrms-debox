import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import '@/App.css';
import { isAuthenticated } from '@/lib/auth';

// Pages
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import EmployeesPage from '@/pages/EmployeesPage';
// import LeavesPage from '@/pages/LeavesPage';
import LeavesPage from '@/pages/NewLeavesPage';
import ApprovalsPage from '@/pages/ApprovalsPage';
import ProfilePage from '@/pages/ProfilePage';
import LeavePolicyPage from '@/pages/LeavePolicyPage';
import SettingsPage from '@/pages/SettingsPage';
import NotificationSettingsPage from '@/pages/NotificationSettingsPage';
import HierarchyPage from '@/pages/HierarchyPage';
import AllLeavesPage from '@/pages/AllLeavesPage';
import LeaveBalancePage from '@/pages/LeaveBalancePage';
import CompOffPage from '@/pages/CompOffPage';
import OrganizationsPage from '@/pages/OrganizationsPage';
import ReportsPage from '@/pages/ReportsPage';
import PayrollPage from '@/pages/PayrollPage';
import SalaryStructurePage from '@/pages/SalaryStructurePage';
import SalaryTemplatePage from '@/pages/SalaryTemplatePage';
import Layout from '@/components/Layout';
import ErrorBoundary from '@/components/ErrorBoundary';
import HolidaysPage from '@/pages/HolidaysPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AttendancePage from './pages/AttendancePage';
import MyReimbursementsPage from './pages/MyReimbursementPage';
import AdminReimbursementsPage from './pages/AdminReimbursementPage';
import MyCompOffPage from './pages/MyCompoffPage';
import CompOffApprovalsPage from './pages/CompoffApprovalPage';
import AdminCompOffPage from './pages/AdminCompoffPage';
import LeaveBalanceManagement from './pages/LeaveBalanceManagement';
import MyAttendancePage from './pages/MyAttendancePage';
import ShiftsPage from './pages/ShiftsPage';
import AttendanceRequestsPage from './pages/AttendanceRequestsPage';
import { moduleRoutes, modulePublicRoutes } from './modules/registry';
import PmLayout from './modules/projects/components/PmLayout';
import { pmRoutes } from './modules/projects/routes';

// Root of "/":
//  - logged in        -> the app shell (Layout) with the dashboard + nested pages
//  - guest at "/"      -> the marketing landing page
//  - guest elsewhere   -> redirected to login
const RootGate = () => {
  const { pathname } = useLocation();
  if (isAuthenticated()) {
    return <Layout />;
  }
  return pathname === '/' ? <LandingPage /> : <Navigate to="/login" replace />;
};

// Xeno PM (/pm/*) has its own shell; guests sign in with the PM workspace preselected
const PmGate = () => (isAuthenticated() ? <PmLayout /> : <Navigate to="/login?app=pm" replace />);

function App() {
  return (
    <div className="App">
      {/* Last resort: pages inside the app shell have their own boundary (Layout) */}
      <ErrorBoundary fullScreen>
      <BrowserRouter>
        <Routes>
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {modulePublicRoutes.map(r => <Route key={r.path} path={r.path} element={r.element} />)}

          <Route path="/pm" element={<PmGate />}>
            {pmRoutes.map(r => (r.index
              ? <Route key="index" index element={r.element} />
              : <Route key={r.path} path={r.path} element={r.element} />))}
          </Route>

          <Route path="/" element={<RootGate />}>
            <Route index element={<DashboardPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="leaves" element={<LeavesPage />} />
            <Route path="all-leaves" element={<AllLeavesPage />} />
            <Route path="leave-balance" element={<LeaveBalancePage />} />
            <Route path="comp-off" element={<CompOffPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="leave-policy" element={<LeavePolicyPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="notifications" element={<NotificationSettingsPage />} />
            <Route path="organizations" element={<OrganizationsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="payroll" element={<PayrollPage />} />
            <Route path="salary-structure" element={<SalaryStructurePage />} />
            <Route path="salary-template" element={<SalaryTemplatePage />} />
            <Route path="hierarchy" element={<HierarchyPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="holidays" element={<HolidaysPage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/myreimbursements" element={<MyReimbursementsPage />} />
            <Route path="/adminreimbursements" element={<AdminReimbursementsPage />} />
            <Route path="/mycompoff" element={<MyCompOffPage />} />
            <Route path="/compoffapproval" element={<CompOffApprovalsPage />} />
            <Route path="/admincompoff" element={<AdminCompOffPage />} />
            <Route path="/admin/leave-management" element={<LeaveBalanceManagement />} />
            <Route path="my-attendance" element={<MyAttendancePage />} />
            <Route path="shifts" element={<ShiftsPage />} />
            <Route path="time-tracking" element={<AttendanceRequestsPage />} />
            {moduleRoutes.map(r => <Route key={r.path} path={r.path} element={r.element} />)}
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ErrorBoundary>
      <Toaster position="top-right" />
    </div>
  );
}

export default App;
