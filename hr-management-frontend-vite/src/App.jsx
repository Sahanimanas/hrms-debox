import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import '@/App.css';
import { isAuthenticated } from '@/lib/auth';
import api from '@/lib/api';

// Pages
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
import SetupPage from '@/pages/SetupPage';
import Layout from '@/components/Layout';
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


const ProtectedRoute = ({ children }) => {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function App() {
  const [setupCompleted, setSetupCompleted] = useState(null); // null = checking, true/false = result
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    try {
      const response = await api.get('/setup/status');
      setSetupCompleted(response.data.setup_completed);
    } catch (error) {
      console.error('Failed to check setup status:', error);
      setSetupCompleted(false);
    } finally {
      setChecking(false);
    }
  };

  const handleSetupComplete = () => {
    alert('Setup completed! Please restart the backend server (PM2) for changes to take effect.\n\nRun: pm2 restart hrms-backend');
    setSetupCompleted(true);
    // Reload the page after a delay
    setTimeout(() => {
      window.location.reload();
    }, 3000);
  };

  // Show loading while checking setup status
  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show setup page if setup is not completed
  if (!setupCompleted) {
    return (
      <>
        <SetupPage onSetupComplete={handleSetupComplete} />
        <Toaster position="top-right" />
      </>
    );
  }

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
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


          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </div>
  );
}

export default App;
