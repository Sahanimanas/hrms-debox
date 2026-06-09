import React, { useState, useEffect } from 'react';
import { DollarSign, Plus, Trash2, Save, Send, Calendar, Info, ChevronDown, ChevronUp, Calculator, User, Users, Wallet, TreePalm, ClipboardList, TrendingDown, Clock, CheckCircle2, XCircle, AlertCircle, AlertTriangle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';

const LEAVE_TYPE_CONFIG = {
  earned_leave: { label: 'Earned Leave', color: 'emerald', bg: 'from-emerald-50 to-green-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  sick_leave: { label: 'Sick Leave', color: 'red', bg: 'from-red-50 to-rose-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  casual_leave: { label: 'Casual Leave', color: 'blue', bg: 'from-amber-50 to-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  paid_leave: { label: 'Paid Leave', color: 'green', bg: 'from-green-50 to-emerald-50', border: 'border-green-200', text: 'text-green-700', badge: 'bg-green-100 text-green-700' },
  unpaid_leave: { label: 'Unpaid Leave', color: 'amber', bg: 'from-amber-50 to-orange-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  comp_off: { label: 'Comp Off', color: 'purple', bg: 'from-purple-50 to-violet-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
};

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  manager_approved: { label: 'Manager Approved', icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  approved: { label: 'Approved', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Rejected', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700 border-red-200' },
};

/**
 * Helper: normalize leave type string to snake_case key
 */
function normalizeLeaveTypeKey(leaveType) {
  if (!leaveType) return '';
  return leaveType.toLowerCase().replace(/\s+/g, '_');
}

const SalaryStructurePage = () => {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedEmployeeData, setSelectedEmployeeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [salaryTemplate, setSalaryTemplate] = useState(null);

  // Leave balance state
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [leaveBalanceLoading, setLeaveBalanceLoading] = useState(false);

  // Leave summary state
  const [leaveSummary, setLeaveSummary] = useState({ usageByType: {}, applications: [] });
  const [leaveSummaryLoading, setLeaveSummaryLoading] = useState(false);
  const [showAllApplications, setShowAllApplications] = useState(false);

  // Unpaid leave states
  const [unpaidLeaves, setUnpaidLeaves] = useState([]);
  const [unpaidFullDays, setUnpaidFullDays] = useState(0);
  const [unpaidHalfDays, setUnpaidHalfDays] = useState(0);
  const [deductUnpaidLeaves, setDeductUnpaidLeaves] = useState(true);
  const [showLeaveDetails, setShowLeaveDetails] = useState(false);

  // Deduction rates are now auto-calculated from Basic Pay

  // Dirty state tracking - true when structure modified since last save/load
  const [isDirty, setIsDirty] = useState(false);

  // Bulk send modal states
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkEmployeeData, setBulkEmployeeData] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSendingIds, setBulkSendingIds] = useState(new Set());
  const [bulkSentIds, setBulkSentIds] = useState(new Set());
  const [sendingAll, setSendingAll] = useState(false);

  const [salaryStructure, setSalaryStructure] = useState({
    basic_salary: 0,
    components: []
  });


  // Default CTC earning components
  const getDefaultCTCComponents = () => [
    { name: 'Basic Pay', amount: 50, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 1 },
    { name: 'House Rent Allowance', amount: 25, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 2 },
    { name: 'LTA Allowance', amount: 2.5, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 3 },
    { name: 'Other Allowance', amount: 22.5, is_percentage: true, calculation_base: 'ctc', type: 'earning', order: 4 }
  ];

  // Handle CTC change - auto-fill components as user types
  const handleCTCChange = (value) => {
    const ctcAmount = parseFloat(value) || 0;
    setIsDirty(true);

    if (ctcAmount > 0) {
      // Keep existing earnings if they exist, otherwise use defaults
      const existingEarnings = salaryStructure.components.filter(c => c.type === 'earning');
      const earningComponents = existingEarnings.length > 0 ? existingEarnings : getDefaultCTCComponents();
      const existingDeductions = salaryStructure.components.filter(c => c.type === 'deduction');

      setSalaryStructure({
        basic_salary: ctcAmount,
        components: [...earningComponents, ...existingDeductions]
      });
    } else {
      setSalaryStructure({ ...salaryStructure, basic_salary: ctcAmount });
    }
  };

  useEffect(() => {
    fetchEmployees();
    fetchSalaryTemplate();
  }, []);

  useEffect(() => {
    if (selectedEmployee && selectedMonth) {
      fetchUnpaidLeaves();
      fetchLeaveSummary();
    }
  }, [selectedEmployee, selectedMonth]);

  const fetchSalaryTemplate = async () => {
    try {
      const response = await api.get('/salary-template');
      setSalaryTemplate(response.data);
    } catch (error) {
      console.error('Failed to load salary template:', error);
    }
  };

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/employees');
      setEmployees(response.data);
    } catch (error) {
      toast.error('Failed to load employees');
    }
  };

  const fetchLeaveBalance = async (employeeData) => {
    // First check if the employee data already has leave_balance
    if (employeeData?.leave_balance && Object.keys(employeeData.leave_balance).length > 0) {
      setLeaveBalance(employeeData.leave_balance);
      return;
    }

    // Otherwise try to fetch from the employee profile API
    setLeaveBalanceLoading(true);
    try {
      const response = await api.get(`/employees/${employeeData.id || employeeData.employee_id}`);
      if (response.data?.leave_balance) {
        setLeaveBalance(response.data.leave_balance);
      } else {
        setLeaveBalance(null);
      }
    } catch (error) {
      console.error('Failed to fetch leave balance:', error);
      setLeaveBalance(null);
    } finally {
      setLeaveBalanceLoading(false);
    }
  };

  const fetchLeaveSummary = async () => {
    if (!selectedEmployee || !selectedMonth) return;

    setLeaveSummaryLoading(true);
    try {
      const response = await api.get('/leaves/all');
      const employeeData = employees.find(e => e.id === selectedEmployee);
      const employeeEmail = employeeData?.email;

      if (!employeeEmail) {
        setLeaveSummary({ usageByType: {}, applications: [] });
        return;
      }

      const allLeaves = response.data || [];

      // Filter leaves for this employee
      const employeeLeaves = allLeaves.filter(leave => leave.employee_email === employeeEmail);

      // Get leaves that have dates in the selected month (for usage stats - only approved/manager_approved)
      const [year, month] = selectedMonth.split('-');
      const usageByType = {};
      let totalDaysTaken = 0;

      employeeLeaves.forEach(leave => {
        if (leave.status === 'rejected') return;

        const daysInMonth = (leave.dates || []).filter(dateStr => {
          const date = new Date(dateStr);
          return date.getFullYear() === parseInt(year) && date.getMonth() + 1 === parseInt(month);
        }).length;

        if (daysInMonth === 0) return;

        const typeKey = normalizeLeaveTypeKey(leave.leave_type);
        const effectiveDays = leave.is_half_day ? daysInMonth * 0.5 : daysInMonth;

        if (!usageByType[typeKey]) {
          usageByType[typeKey] = { total: 0, approved: 0, pending: 0 };
        }

        usageByType[typeKey].total += effectiveDays;

        if (leave.status === 'approved' || leave.status === 'manager_approved') {
          usageByType[typeKey].approved += effectiveDays;
          totalDaysTaken += effectiveDays;
        } else if (leave.status === 'pending') {
          usageByType[typeKey].pending += effectiveDays;
        }
      });

      // Get recent applications (all statuses, sorted by created_at)
      const applications = employeeLeaves
        .filter(leave => {
          // Include leaves that have any date in the selected month OR were created in the selected month
          const hasDateInMonth = (leave.dates || []).some(dateStr => {
            const date = new Date(dateStr);
            return date.getFullYear() === parseInt(year) && date.getMonth() + 1 === parseInt(month);
          });
          return hasDateInMonth;
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setLeaveSummary({ usageByType, applications, totalDaysTaken });
    } catch (error) {
      console.error('Failed to fetch leave summary:', error);
      setLeaveSummary({ usageByType: {}, applications: [] });
    } finally {
      setLeaveSummaryLoading(false);
    }
  };

  const fetchUnpaidLeaves = async () => {
    try {
      const [year, month] = selectedMonth.split('-');
      const response = await api.get('/leaves/all');

      const employeeData = employees.find(e => e.id === selectedEmployee);
      const employeeEmail = employeeData?.email;

      const unpaidLeavesForMonth = (response.data || []).filter(leave => {
        if (leave.employee_email !== employeeEmail) return false;
        if (leave.leave_type !== 'Unpaid Leave') return false;
        if (leave.status === 'rejected') return false;

        return leave.dates?.some(dateStr => {
          const date = new Date(dateStr);
          return date.getFullYear() === parseInt(year) &&
            date.getMonth() + 1 === parseInt(month);
        });
      });

      let fullDays = 0;
      let halfDays = 0;

      unpaidLeavesForMonth.forEach(leave => {
        const daysInMonth = leave.dates?.filter(dateStr => {
          const date = new Date(dateStr);
          return date.getFullYear() === parseInt(year) &&
            date.getMonth() + 1 === parseInt(month);
        }).length || 0;

        if (leave.is_half_day) {
          halfDays += daysInMonth;
        } else {
          fullDays += daysInMonth;
        }
      });

      setUnpaidLeaves(unpaidLeavesForMonth);
      setUnpaidFullDays(fullDays);
      setUnpaidHalfDays(halfDays);
    } catch (error) {
      console.error('Failed to fetch unpaid leaves:', error);
      setUnpaidLeaves([]);
      setUnpaidFullDays(0);
      setUnpaidHalfDays(0);
    }
  };

  const handleEmployeeChange = async (empId) => {
    setSelectedEmployee(empId);
    const empData = employees.find(e => e.id === empId);
    setSelectedEmployeeData(empData);
    setLoading(true);
    setShowAllApplications(false);
    setIsDirty(false);

    // Fetch leave balance for the selected employee
    fetchLeaveBalance(empData);

    try {
      const response = await api.get(`/salary-structure/${empId}`);
      if (response.data) {
        const components = response.data.components || [];
        const earningComponents = components.filter(c => c.type === 'earning');
        const deductionComponents = components.filter(c => c.type === 'deduction');
        const basicSalary = response.data.basic_salary || 0;

        // If no earning components saved, use default CTC percentage components
        const earnings = earningComponents.length > 0 ? earningComponents : getDefaultCTCComponents();

        setSalaryStructure({
          basic_salary: basicSalary,
          components: [...earnings, ...deductionComponents]
        });
      } else {
        initializeFromTemplate(empData);
      }
    } catch (error) {
      console.error(error);
      initializeFromTemplate(empData);
    } finally {
      setLoading(false);
    }
  };

  const initializeFromTemplate = (employee) => {
    const basicSalary = employee?.monthly_salary || 0;

    // Always use the default CTC percentage components for earnings
    const earningComponents = getDefaultCTCComponents();

    // Use template deductions if available
    let deductionComponents = [];
    if (salaryTemplate?.deductions) {
      deductionComponents = salaryTemplate.deductions.map(deduction => ({
        name: deduction.name,
        amount: 0,
        type: 'deduction',
        is_percentage: false,
        calculation_base: 'basic'
      }));
    }

    setSalaryStructure({
      basic_salary: basicSalary,
      components: [...earningComponents, ...deductionComponents]
    });
  };

  const addComponent = (type) => {
    setIsDirty(true);
    setSalaryStructure({
      ...salaryStructure,
      components: [
        ...salaryStructure.components,
        {
          name: '',
          amount: 0,
          type: type,
          is_percentage: false,
          calculation_base: 'basic'
        }
      ]
    });
  };

  const updateComponent = (index, field, value) => {
    setIsDirty(true);
    const updated = [...salaryStructure.components];
    updated[index][field] = value;
    setSalaryStructure({ ...salaryStructure, components: updated });
  };

  const removeComponent = (index) => {
    setIsDirty(true);
    const updated = salaryStructure.components.filter((_, i) => i !== index);
    setSalaryStructure({ ...salaryStructure, components: updated });
  };

  const getDaysInMonth = () => {
    const [year, month] = selectedMonth.split('-');
    return new Date(parseInt(year), parseInt(month), 0).getDate();
  };

  const calculateUnpaidDeduction = () => {
    if (!deductUnpaidLeaves) return 0;

    // Get Basic Pay from components (50% of CTC)
    const basicPayComponent = salaryStructure.components.find(c => c.name === 'Basic Pay' && c.type === 'earning');
    const ctc = parseFloat(salaryStructure.basic_salary) || 0;
    const basicPay = basicPayComponent && basicPayComponent.is_percentage
      ? (ctc * parseFloat(basicPayComponent.amount)) / 100
      : ctc * 0.5; // Default to 50% if not found

    const daysInMonth = getDaysInMonth();
    const perDayDeduction = basicPay / daysInMonth;

    const fullDayDeduction = unpaidFullDays * perDayDeduction;
    const halfDayDeduction = unpaidHalfDays * (perDayDeduction / 2);

    return Math.round(fullDayDeduction + halfDayDeduction);
  };

  const getTotalUnpaidDays = () => {
    return unpaidFullDays + (unpaidHalfDays * 0.5);
  };

  const calculateTotals = () => {
    const ctc = parseFloat(salaryStructure.basic_salary) || 0;
    let totalEarnings = 0;
    let totalDeductions = 0;

    salaryStructure.components.forEach(comp => {
      const amount = parseFloat(comp.amount) || 0;
      let calcAmount = amount;

      if (comp.is_percentage) {
        if (comp.calculation_base === 'ctc') {
          // Calculate as percentage of CTC
          calcAmount = (ctc * amount) / 100;
        } else if (comp.calculation_base === 'basic') {
          // Legacy: calculate as percentage of basic
          calcAmount = (ctc * amount) / 100;
        }
      }

      if (comp.type === 'earning') {
        totalEarnings += calcAmount;
      } else {
        totalDeductions += calcAmount;
      }
    });

    const grossSalary = totalEarnings || ctc;
    const unpaidDeduction = calculateUnpaidDeduction();
    const finalDeductions = totalDeductions + unpaidDeduction;

    return {
      basic: ctc,
      grossSalary,
      totalDeductions,
      unpaidDeduction,
      finalDeductions,
      netSalary: grossSalary - finalDeductions
    };
  };

  const handleSave = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }

    if (salaryStructure.basic_salary <= 0) {
      toast.error('CTC must be greater than 0');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/salary-structure/${selectedEmployee}`, salaryStructure);
      toast.success('Salary structure saved successfully');
      setIsDirty(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSendSlip = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }

    setSending(true);
    try {
      const totals = calculateTotals();

      // Calculate per-day deduction rates based on Basic Pay
      const basicPayComponent = salaryStructure.components.find(c => c.name === 'Basic Pay' && c.type === 'earning');
      const ctc = parseFloat(salaryStructure.basic_salary) || 0;
      const basicPay = basicPayComponent && basicPayComponent.is_percentage
        ? (ctc * parseFloat(basicPayComponent.amount)) / 100
        : ctc * 0.5;
      const daysInMonth = getDaysInMonth();
      const perDayDeduction = basicPay / daysInMonth;
      const perHalfDayDeduction = perDayDeduction / 2;

      await api.post('/payroll/send-detailed-salary-slip', {
        employee_id: selectedEmployee,
        month: selectedMonth,
        unpaid_full_days: deductUnpaidLeaves ? unpaidFullDays : 0,
        unpaid_half_days: deductUnpaidLeaves ? unpaidHalfDays : 0,
        per_full_day_deduction: deductUnpaidLeaves ? Math.round(perDayDeduction) : 0,
        per_half_day_deduction: deductUnpaidLeaves ? Math.round(perHalfDayDeduction) : 0,
        unpaid_leave_deduction: deductUnpaidLeaves ? totals.unpaidDeduction : 0
      });
      toast.success('Salary slip sent successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send salary slip');
    } finally {
      setSending(false);
    }
  };

  // Bulk send modal functions
  const openBulkModal = async () => {
    setShowBulkModal(true);
    setBulkLoading(true);
    setBulkSentIds(new Set());
    setBulkSendingIds(new Set());

    try {
      const results = await Promise.all(
        employees.map(async (emp) => {
          try {
            const res = await api.get(`/salary-structure/${emp.employee_id || emp.id}`);
            const structure = res.data;
            const hasSavedStructure = structure && structure.components && structure.components.length > 0 && structure.basic_salary > 0;

            let grossSalary = 0;
            let totalDeductions = 0;
            const ctc = structure?.basic_salary || 0;

            if (hasSavedStructure) {
              structure.components.forEach(comp => {
                const amount = parseFloat(comp.amount) || 0;
                let calcAmount = amount;
                if (comp.is_percentage) {
                  calcAmount = (ctc * amount) / 100;
                }
                if (comp.type === 'earning') grossSalary += calcAmount;
                else totalDeductions += calcAmount;
              });
            }

            return {
              employee: emp,
              structure,
              hasSavedStructure,
              ctc,
              grossSalary: grossSalary || ctc,
              totalDeductions,
              netSalary: (grossSalary || ctc) - totalDeductions
            };
          } catch {
            return {
              employee: emp,
              structure: null,
              hasSavedStructure: false,
              ctc: 0,
              grossSalary: 0,
              totalDeductions: 0,
              netSalary: 0
            };
          }
        })
      );

      setBulkEmployeeData(results);
    } catch (error) {
      toast.error('Failed to load employee salary data');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkSendSingle = async (empData) => {
    const empId = empData.employee.employee_id || empData.employee.id;
    setBulkSendingIds(prev => new Set([...prev, empId]));

    try {
      await api.post('/payroll/send-detailed-salary-slip', {
        employee_id: empId,
        month: selectedMonth,
        unpaid_full_days: 0,
        unpaid_half_days: 0,
        per_full_day_deduction: 0,
        per_half_day_deduction: 0,
        unpaid_leave_deduction: 0
      });
      setBulkSentIds(prev => new Set([...prev, empId]));
      toast.success(`Salary slip sent to ${empData.employee.full_name}`);
    } catch (error) {
      toast.error(`Failed to send to ${empData.employee.full_name}`);
    } finally {
      setBulkSendingIds(prev => {
        const next = new Set(prev);
        next.delete(empId);
        return next;
      });
    }
  };

  const handleBulkSendAll = async () => {
    const eligibleEmployees = bulkEmployeeData.filter(d => {
      const empId = d.employee.employee_id || d.employee.id;
      return d.hasSavedStructure && !bulkSentIds.has(empId);
    });

    if (eligibleEmployees.length === 0) {
      toast.error('No eligible employees to send to');
      return;
    }

    setSendingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const empData of eligibleEmployees) {
      const empId = empData.employee.employee_id || empData.employee.id;
      setBulkSendingIds(prev => new Set([...prev, empId]));

      try {
        await api.post('/payroll/send-detailed-salary-slip', {
          employee_id: empId,
          month: selectedMonth,
          unpaid_full_days: 0,
          unpaid_half_days: 0,
          per_full_day_deduction: 0,
          per_half_day_deduction: 0,
          unpaid_leave_deduction: 0
        });
        setBulkSentIds(prev => new Set([...prev, empId]));
        successCount++;
      } catch {
        failCount++;
      } finally {
        setBulkSendingIds(prev => {
          const next = new Set(prev);
          next.delete(empId);
          return next;
        });
      }
    }

    setSendingAll(false);
    if (successCount > 0) toast.success(`Sent salary slips to ${successCount} employee${successCount !== 1 ? 's' : ''}`);
    if (failCount > 0) toast.error(`Failed to send to ${failCount} employee${failCount !== 1 ? 's' : ''}`);
  };

  // Helper to get formatted leave balance entries (excluding zero-balance and unpaid)
  const getLeaveBalanceEntries = () => {
    if (!leaveBalance) return [];

    return Object.entries(leaveBalance)
      .map(([key, value]) => ({
        key,
        value: parseFloat(value) || 0,
        config: LEAVE_TYPE_CONFIG[key] || {
          label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          bg: 'from-slate-50 to-gray-50',
          border: 'border-slate-200',
          text: 'text-slate-700',
          badge: 'bg-slate-100 text-slate-700'
        }
      }))
      .sort((a, b) => b.value - a.value);
  };

  const getTotalLeaveBalance = () => {
    if (!leaveBalance) return 0;
    return Object.entries(leaveBalance)
      .filter(([key]) => key !== 'unpaid_leave')
      .reduce((sum, [, val]) => sum + (parseFloat(val) || 0), 0);
  };

  // Helper to get usage summary entries
  const getUsageEntries = () => {
    return Object.entries(leaveSummary.usageByType)
      .map(([key, data]) => ({
        key,
        ...data,
        config: LEAVE_TYPE_CONFIG[key] || {
          label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          bg: 'from-slate-50 to-gray-50',
          border: 'border-slate-200',
          text: 'text-slate-700',
          badge: 'bg-slate-100 text-slate-700'
        }
      }))
      .sort((a, b) => b.total - a.total);
  };

  const totals = calculateTotals();
  const hasEarningComponents = salaryStructure.components.some(c => c.type === 'earning');
  const earningsMismatch = hasEarningComponents && totals.basic > 0 && Math.round(totals.grossSalary) !== Math.round(totals.basic);
  const mismatchAmount = Math.round(totals.grossSalary) - Math.round(totals.basic);

  const monthName = selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMMM yyyy') : '';
  const visibleApplications = showAllApplications
    ? leaveSummary.applications
    : leaveSummary.applications.slice(0, 3);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-slate-800 rounded-xl shadow-lg">
              <Calculator className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Salary Structure
              </h1>
              <p className="text-slate-600">Configure detailed salary components for employees</p>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mb-6 bg-gradient-to-r from-amber-50 to-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
          <div className="flex gap-3 items-start">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Info className="w-5 h-5 text-amber-600" />
            </div>
            <div className="text-sm text-amber-900">
              <p className="font-semibold mb-1">About CTC & Salary Structure</p>
              <p>
                Enter the employee's monthly <strong>CTC (Cost to Company)</strong> and salary components will <strong>auto-fill automatically</strong> with the breakdown (Basic Pay 50%, HRA 25%, LTA 2.5%, Other 22.5%). You can edit these after auto-fill. Unpaid leave deductions are automatically calculated based on <strong>Basic Pay ÷ Days in Month</strong>.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Configuration Panel */}
          <Card className="lg:col-span-2 border-0 shadow-md bg-white">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-200 rounded-lg">
                  <User className="w-5 h-5 text-slate-700" />
                </div>
                <CardTitle className="text-xl">Configure CTC & Deductions</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {/* Employee & Month Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-700 font-medium mb-1.5 block">Select Employee *</Label>
                  <Select value={selectedEmployee} onValueChange={handleEmployeeChange}>
                    <SelectTrigger className="h-11 bg-slate-50 border-slate-200 hover:border-slate-300 transition-colors">
                      <SelectValue placeholder="Choose employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map(emp => (
                        <SelectItem key={emp.id} value={emp.id}>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-xs font-medium text-white">
                              {emp.full_name?.charAt(0)}
                            </div>
                            <span>{emp.full_name}</span>
                            <span className="text-slate-400 text-sm">({emp.employee_id || emp.id.slice(0, 8)})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-700 font-medium mb-1.5 block">Salary Month</Label>
                  <Input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="h-11 bg-slate-50 border-slate-200 hover:border-slate-300 transition-colors"
                  />
                </div>
              </div>

              {selectedEmployee && !loading && (
                <>
                  {/* CTC Card */}
                  <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl p-5 shadow-lg">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 bg-white/20 rounded-lg">
                        <Wallet className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <Label className="text-lg font-semibold text-white">CTC</Label>
                        <p className="text-xs text-white/60">Cost to Company (Monthly) - Components auto-fill below</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-bold text-white/60">₹</span>
                      <Input
                        type="number"
                        value={salaryStructure.basic_salary}
                        onChange={(e) => handleCTCChange(e.target.value)}
                        onWheel={(e) => e.target.blur()}
                        className="text-2xl font-bold h-14 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/40 focus:ring-white/20"
                        placeholder="Enter monthly CTC"
                      />
                    </div>
                  </div>

                  {/* Unpaid Leave Deduction Section */}
                  <div className={`rounded-xl border-2 transition-all duration-300 overflow-hidden ${deductUnpaidLeaves && (unpaidFullDays > 0 || unpaidHalfDays > 0) ? 'border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl transition-colors ${deductUnpaidLeaves && (unpaidFullDays > 0 || unpaidHalfDays > 0) ? 'bg-amber-200' : 'bg-slate-200'}`}>
                            <Calendar className={`w-5 h-5 ${deductUnpaidLeaves && (unpaidFullDays > 0 || unpaidHalfDays > 0) ? 'text-amber-700' : 'text-slate-600'}`} />
                          </div>
                          <div>
                            <h3 className="font-semibold text-slate-800 text-lg">Unpaid Leave Deduction</h3>
                            <p className="text-sm text-slate-600">
                              {(unpaidFullDays > 0 || unpaidHalfDays > 0)
                                ? <span className="font-medium text-amber-700">
                                  {unpaidFullDays > 0 && `${unpaidFullDays} full day${unpaidFullDays !== 1 ? 's' : ''}`}
                                  {unpaidFullDays > 0 && unpaidHalfDays > 0 && ', '}
                                  {unpaidHalfDays > 0 && `${unpaidHalfDays} half day${unpaidHalfDays !== 1 ? 's' : ''}`}
                                  {' in '}{monthName}
                                </span>
                                : <span className="text-slate-500">No unpaid leaves in {monthName}</span>
                              }
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {(unpaidFullDays > 0 || unpaidHalfDays > 0) && (
                            <Badge className={`text-sm px-3 py-1 ${deductUnpaidLeaves ? 'bg-amber-600 hover:bg-amber-600' : 'bg-slate-400 hover:bg-slate-400'}`}>
                              {deductUnpaidLeaves ? `- ₹${totals.unpaidDeduction.toLocaleString()}` : 'Not Applied'}
                            </Badge>
                          )}
                          <div className="flex items-center gap-2">
                            <Label className="text-sm text-slate-600">Apply</Label>
                            <Switch
                              checked={deductUnpaidLeaves}
                              onCheckedChange={setDeductUnpaidLeaves}
                              disabled={unpaidFullDays === 0 && unpaidHalfDays === 0}
                              className="data-[state=checked]:bg-amber-600"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Auto-Calculated Deduction Info */}
                      {deductUnpaidLeaves && (unpaidFullDays > 0 || unpaidHalfDays > 0) && (() => {
                        const basicPayComponent = salaryStructure.components.find(c => c.name === 'Basic Pay' && c.type === 'earning');
                        const ctc = parseFloat(salaryStructure.basic_salary) || 0;
                        const basicPay = basicPayComponent && basicPayComponent.is_percentage
                          ? (ctc * parseFloat(basicPayComponent.amount)) / 100
                          : ctc * 0.5;
                        const daysInMonth = getDaysInMonth();
                        const perDayDeduction = basicPay / daysInMonth;
                        const perHalfDayRate = perDayDeduction / 2;

                        return (
                          <div className="mt-5 pt-5 border-t border-amber-200 space-y-4">
                            {/* Calculation Info */}
                            <div className="p-4 bg-white rounded-xl border border-amber-200 shadow-sm">
                              <div className="text-xs text-amber-700 font-semibold mb-3 uppercase tracking-wide">Deduction Calculation</div>
                              <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                  <span className="text-slate-600">Basic Pay (50% of CTC):</span>
                                  <span className="font-semibold text-slate-800">₹{Math.round(basicPay).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-slate-600">Days in {monthName}:</span>
                                  <span className="font-semibold text-slate-800">{daysInMonth} days</span>
                                </div>
                                <div className="flex justify-between text-sm pt-2 border-t border-amber-100">
                                  <span className="text-slate-600">Per Day Rate:</span>
                                  <span className="font-semibold text-amber-700">₹{Math.round(perDayDeduction).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-slate-600">Per Half Day Rate:</span>
                                  <span className="font-semibold text-amber-700">₹{Math.round(perHalfDayRate).toLocaleString()}</span>
                                </div>
                              </div>
                            </div>

                            {/* Deduction Breakdown */}
                            <div className="p-4 bg-white rounded-xl border border-amber-200 shadow-sm">
                              <div className="text-xs text-amber-700 font-semibold mb-3 uppercase tracking-wide">Deduction Breakdown</div>
                              <div className="space-y-2">
                                {unpaidFullDays > 0 && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Full Days ({unpaidFullDays} × ₹{Math.round(perDayDeduction).toLocaleString()}):</span>
                                    <span className="font-semibold text-slate-800">
                                      ₹{Math.round(unpaidFullDays * perDayDeduction).toLocaleString()}
                                    </span>
                                  </div>
                                )}
                                {unpaidHalfDays > 0 && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Half Days ({unpaidHalfDays} × ₹{Math.round(perHalfDayRate).toLocaleString()}):</span>
                                    <span className="font-semibold text-slate-800">
                                      ₹{Math.round(unpaidHalfDays * perHalfDayRate).toLocaleString()}
                                    </span>
                                  </div>
                                )}
                                <div className="flex justify-between pt-3 mt-2 border-t border-amber-100">
                                  <span className="font-semibold text-amber-800">Total Deduction:</span>
                                  <span className="font-bold text-lg text-amber-700">₹{totals.unpaidDeduction.toLocaleString()}</span>
                                </div>
                              </div>
                            </div>

                            {/* Show Leave Details Toggle */}
                            <button
                              type="button"
                              onClick={() => setShowLeaveDetails(!showLeaveDetails)}
                              className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-800 transition-colors font-medium"
                            >
                              {showLeaveDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              {showLeaveDetails ? 'Hide' : 'View'} Leave Details
                            </button>

                            {/* Leave Details */}
                            {showLeaveDetails && unpaidLeaves.length > 0 && (
                              <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                                {unpaidLeaves.map((leave, idx) => (
                                  <div key={idx} className="p-4 bg-white rounded-xl border border-amber-100 shadow-sm">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-medium text-slate-700">
                                        {leave.dates?.length} day{leave.dates?.length !== 1 ? 's' : ''}
                                        {leave.is_half_day && <span className="text-amber-600 ml-1">(Half Day)</span>}
                                      </span>
                                      <Badge variant="outline" className="capitalize text-xs">
                                        {leave.status?.replace('_', ' ')}
                                      </Badge>
                                    </div>
                                    <p className="text-slate-500 text-sm mb-2">{leave.reason}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {leave.dates?.map((date, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium">
                                          {format(new Date(date), 'MMM dd')}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Salary Components Section */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-8 bg-emerald-500 rounded-full"></div>
                        <div>
                          <h3 className="text-xl font-bold text-slate-800">Salary Components</h3>
                          <p className="text-xs text-slate-500">Breakdown of CTC (auto-filled, editable)</p>
                        </div>
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-medium">
                          {salaryStructure.components.filter(c => c.type === 'earning').length} items
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {salaryStructure.components.filter(c => c.type === 'earning').map((comp, idx) => {
                        const actualIdx = salaryStructure.components.indexOf(comp);
                        const ctc = parseFloat(salaryStructure.basic_salary) || 0;
                        const calcAmount = comp.is_percentage
                          ? Math.round((ctc * (parseFloat(comp.amount) || 0)) / 100)
                          : parseFloat(comp.amount) || 0;

                        return (
                          <div key={actualIdx} className="border border-emerald-200 rounded-xl p-4 bg-gradient-to-r from-emerald-50/50 to-green-50/50">
                            <div className="grid grid-cols-12 gap-3 items-center">
                              <div className="col-span-12 md:col-span-5">
                                <Input
                                  placeholder="Component name"
                                  value={comp.name}
                                  onChange={(e) => updateComponent(actualIdx, 'name', e.target.value)}
                                  className="bg-white border-emerald-200 focus:border-emerald-400 focus:ring-emerald-200"
                                  readOnly={['Basic Pay', 'House Rent Allowance', 'LTA Allowance', 'Other Allowance'].includes(comp.name)}
                                />
                              </div>
                              <div className="col-span-6 md:col-span-3">
                                <div className="relative">
                                  <Input
                                    type="number"
                                    placeholder="Amount"
                                    value={comp.amount}
                                    onChange={(e) => updateComponent(actualIdx, 'amount', parseFloat(e.target.value) || 0)}
                                    onWheel={(e) => e.target.blur()}
                                    className="bg-white border-emerald-200 focus:border-emerald-400 focus:ring-emerald-200 pr-8"
                                  />
                                  {comp.is_percentage && (
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 font-bold">%</span>
                                  )}
                                </div>
                              </div>
                              <div className="col-span-6 md:col-span-2">
                                <Select
                                  value={comp.is_percentage ? 'percentage' : 'fixed'}
                                  onValueChange={(val) => {
                                    updateComponent(actualIdx, 'is_percentage', val === 'percentage');
                                    if (val === 'percentage') {
                                      updateComponent(actualIdx, 'calculation_base', 'ctc');
                                    }
                                  }}
                                >
                                  <SelectTrigger className="bg-white border-emerald-200">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="fixed">Fixed ₹</SelectItem>
                                    <SelectItem value="percentage">% of CTC</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="col-span-12 md:col-span-2 text-right">
                                <span className="text-base font-bold text-emerald-700">
                                  = ₹{calcAmount.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {salaryStructure.components.filter(c => c.type === 'earning').length === 0 && (
                        <div className="text-center py-10 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                          <Calculator className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="font-medium">No salary components</p>
                          <p className="text-sm">Enter CTC above to auto-fill components</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Deductions Section */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-8 bg-red-500 rounded-full"></div>
                        <h3 className="text-xl font-bold text-slate-800">Deductions</h3>
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 font-medium">
                          {salaryStructure.components.filter(c => c.type === 'deduction').length} items
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => addComponent('deduction')}
                        variant="destructive"
                        className="rounded-full shadow-md"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Deduction
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {salaryStructure.components.filter(c => c.type === 'deduction').map((comp, idx) => {
                        const actualIdx = salaryStructure.components.indexOf(comp);
                        const calcAmount = comp.is_percentage
                          ? Math.round((totals.basic * (parseFloat(comp.amount) || 0)) / 100)
                          : parseFloat(comp.amount) || 0;

                        return (
                          <div key={actualIdx} className="border border-red-200 rounded-xl p-4 bg-gradient-to-r from-red-50/50 to-rose-50/50 hover:shadow-md transition-all duration-200">
                            <div className="grid grid-cols-12 gap-3 items-center">
                              <div className="col-span-12 md:col-span-4">
                                <Input
                                  placeholder="Component name"
                                  value={comp.name}
                                  onChange={(e) => updateComponent(actualIdx, 'name', e.target.value)}
                                  className="bg-white border-red-200 focus:border-red-400 focus:ring-red-200"
                                />
                              </div>
                              <div className="col-span-5 md:col-span-3">
                                <div className="relative">
                                  <Input
                                    type="number"
                                    placeholder="Amount"
                                    value={comp.amount}
                                    onChange={(e) => updateComponent(actualIdx, 'amount', parseFloat(e.target.value) || 0)}
                                    onWheel={(e) => e.target.blur()}
                                    className="bg-white border-red-200 focus:border-red-400 focus:ring-red-200 pr-8"
                                  />
                                  {comp.is_percentage && (
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-600 font-bold">%</span>
                                  )}
                                </div>
                              </div>
                              <div className="col-span-4 md:col-span-2">
                                <Select
                                  value={comp.is_percentage ? 'percentage' : 'fixed'}
                                  onValueChange={(val) => updateComponent(actualIdx, 'is_percentage', val === 'percentage')}
                                >
                                  <SelectTrigger className="bg-white border-red-200">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="fixed">Fixed ₹</SelectItem>
                                    <SelectItem value="percentage">% Basic</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="col-span-2 md:col-span-2 text-right">
                                <span className="text-base font-bold text-red-600">
                                  -₹{calcAmount.toLocaleString()}
                                </span>
                              </div>
                              <div className="col-span-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => removeComponent(actualIdx)}
                                  className="text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {salaryStructure.components.filter(c => c.type === 'deduction').length === 0 && (
                        <div className="text-center py-10 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                          <Plus className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="font-medium">No deductions added</p>
                          <p className="text-sm">Click "Add Deduction" to create one</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Earnings Mismatch Error */}
                  {earningsMismatch && (
                    <div className="flex items-start gap-3 p-4 bg-red-50 border-2 border-red-300 rounded-xl animate-in slide-in-from-top-2 duration-200">
                      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-red-800">
                          Salary components don't add up to CTC
                        </p>
                        <p className="text-sm text-red-700 mt-1">
                          {mismatchAmount > 0
                            ? <>Total earnings <strong>₹{Math.round(totals.grossSalary).toLocaleString()}</strong> exceed CTC <strong>₹{totals.basic.toLocaleString()}</strong> by <strong>₹{mismatchAmount.toLocaleString()}</strong>.</>
                            : <>Total earnings <strong>₹{Math.round(totals.grossSalary).toLocaleString()}</strong> are <strong>₹{Math.abs(mismatchAmount).toLocaleString()}</strong> less than CTC <strong>₹{totals.basic.toLocaleString()}</strong>.</>
                          }
                        </p>
                        <p className="text-xs text-red-600 mt-2">
                          Adjust the component amounts or percentages so they add up to the CTC.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Save Button */}
                  <Button
                    onClick={handleSave}
                    disabled={saving || earningsMismatch}
                    className={`w-full h-12 text-lg font-semibold rounded-xl shadow-lg transition-all duration-200 hover:shadow-xl ${earningsMismatch ? 'bg-red-300 hover:bg-red-300 cursor-not-allowed' : 'bg-slate-800 hover:bg-slate-900'}`}
                  >
                    <Save className="w-5 h-5 mr-2" />
                    {saving ? 'Saving...' : earningsMismatch ? 'Fix Components to Save' : 'Save Salary Structure'}
                  </Button>
                </>
              )}

              {loading && (
                <div className="text-center py-16 text-slate-500">
                  <div className="animate-spin w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-4"></div>
                  <p className="font-medium">Loading salary structure...</p>
                </div>
              )}

              {!selectedEmployee && !loading && (
                <div className="text-center py-16 text-slate-400">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <User className="w-10 h-10 text-slate-300" />
                  </div>
                  <p className="font-medium text-lg text-slate-500">No Employee Selected</p>
                  <p className="text-sm">Select an employee to configure their salary structure</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary Panel */}
          <div className="space-y-6">
            {/* Salary Summary Card */}
            <Card className="border-0 shadow-md  top-4 overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-800 to-slate-900 text-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <DollarSign className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-white">Salary Summary</CardTitle>
                    {selectedEmployee && (
                      <p className="text-sm text-slate-300 mt-0.5">{monthName}</p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                {selectedEmployee ? (
                  <>
                    {/* Employee Info */}
                    {selectedEmployeeData && (
                      <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white text-lg font-bold shadow-md">
                          {selectedEmployeeData.full_name?.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{selectedEmployeeData.full_name}</p>
                          <p className="text-xs text-slate-500">{selectedEmployeeData.department || 'No Department'}</p>
                        </div>
                      </div>
                    )}

                    {/* Salary Breakdown */}
                    <div className="space-y-3">
                      <div className="flex justify-between py-3 px-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl border border-slate-200">
                        <span className="text-slate-600 font-medium">CTC (Monthly)</span>
                        <span className="font-bold text-slate-800">₹{totals.basic.toLocaleString()}</span>
                      </div>

                      <div className={`flex justify-between py-3 px-4 rounded-xl border ${earningsMismatch ? 'bg-red-50 border-red-300' : 'bg-emerald-50 border-emerald-100'}`}>
                        <div>
                          <span className={`font-medium ${earningsMismatch ? 'text-red-700' : 'text-emerald-700'}`}>Gross Salary</span>
                          {earningsMismatch && (
                            <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {mismatchAmount > 0 ? `₹${mismatchAmount.toLocaleString()} over CTC` : `₹${Math.abs(mismatchAmount).toLocaleString()} under CTC`}
                            </p>
                          )}
                        </div>
                        <span className={`font-bold ${earningsMismatch ? 'text-red-700' : 'text-emerald-700'}`}>₹{Math.round(totals.grossSalary).toLocaleString()}</span>
                      </div>

                      <div className="flex justify-between py-3 px-4 bg-red-50 rounded-xl border border-red-100">
                        <span className="text-red-700 font-medium">Regular Deductions</span>
                        <span className="font-bold text-red-700">- ₹{totals.totalDeductions.toLocaleString()}</span>
                      </div>

                      {deductUnpaidLeaves && (unpaidFullDays > 0 || unpaidHalfDays > 0) && (
                        <div className="flex justify-between py-3 px-4 bg-amber-50 rounded-xl border border-amber-200">
                          <div>
                            <span className="text-amber-700 font-medium">Unpaid Leave</span>
                            <span className="text-xs text-amber-600 ml-1.5 bg-amber-100 px-2 py-0.5 rounded-full">
                              {getTotalUnpaidDays()} days
                            </span>
                          </div>
                          <span className="font-bold text-amber-700">- ₹{totals.unpaidDeduction.toLocaleString()}</span>
                        </div>
                      )}

                      <div className="flex justify-between py-5 px-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl shadow-lg">
                        <span className="font-bold text-lg">Net Salary</span>
                        <span className="font-bold text-2xl">₹{totals.netSalary.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Send Slip Section */}
                    <div className="pt-4 border-t border-slate-100 space-y-4">
                      <div className={`p-5 rounded-xl border ${isDirty ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-300' : 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200'}`}>
                        <h4 className={`font-semibold mb-3 flex items-center gap-2 ${isDirty ? 'text-amber-800' : 'text-emerald-800'}`}>
                          <Send className="w-4 h-4" />
                          Send Salary Slip
                        </h4>

                        {isDirty && (
                          <div className="flex items-center gap-2 p-3 mb-3 bg-amber-100 border border-amber-300 rounded-lg">
                            <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0" />
                            <p className="text-sm font-medium text-amber-800">
                              Save the salary structure first before sending the slip.
                            </p>
                          </div>
                        )}

                        <Button
                          onClick={handleSendSlip}
                          disabled={sending || !selectedEmployee || isDirty}
                          className={`w-full h-11 font-semibold shadow-md ${isDirty ? 'bg-slate-400 hover:bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                        >
                          {sending ? (
                            <>
                              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                              Sending...
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4 mr-2" />
                              Send to Employee
                            </>
                          )}
                        </Button>
                        <p className={`text-xs mt-2 text-center ${isDirty ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {isDirty ? 'Please save changes before sending' : 'Salary slip will be sent via email'}
                        </p>
                      </div>

                      {/* Send to All Employees */}
                      <div className="p-5 bg-gradient-to-r from-amber-50 to-amber-50 rounded-xl border border-amber-200">
                        <h4 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          Bulk Salary Slips
                        </h4>
                        <p className="text-xs text-amber-600 mb-3">Send salary slips to all employees for {monthName}</p>
                        <Button
                          onClick={openBulkModal}
                          className="w-full bg-slate-900 hover:bg-slate-800 h-11 font-semibold shadow-md"
                        >
                          <Users className="w-4 h-4 mr-2" />
                          Send to All Employees
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-slate-400">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <User className="w-8 h-8 text-slate-300" />
                    </div>
                    <p className="font-medium">No Employee Selected</p>
                    <p className="text-sm mt-1">Select an employee to view summary</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Leave Balance Card */}
            {selectedEmployee && (
              <Card className="border-0 shadow-md overflow-hidden">
                <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-teal-600 to-cyan-700 text-white py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white/20 rounded-lg">
                        <TreePalm className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-white text-base">Leave Balance</CardTitle>
                        <p className="text-xs text-teal-100 mt-0.5">
                          {selectedEmployeeData?.full_name}
                        </p>
                      </div>
                    </div>
                    {leaveBalance && (
                      <div className="text-right">
                        <p className="text-2xl font-bold text-white">{getTotalLeaveBalance().toFixed(1)}</p>
                        <p className="text-xs text-teal-100">Total Days</p>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  {leaveBalanceLoading ? (
                    <div className="text-center py-8 text-slate-500">
                      <div className="animate-spin w-8 h-8 border-3 border-slate-200 border-t-teal-600 rounded-full mx-auto mb-3"></div>
                      <p className="text-sm font-medium">Loading leave balance...</p>
                    </div>
                  ) : leaveBalance ? (
                    <div className="space-y-2.5">
                      {getLeaveBalanceEntries().map(({ key, value, config }) => (
                        <div
                          key={key}
                          className={`flex items-center justify-between py-3 px-4 rounded-xl bg-gradient-to-r ${config.bg} border ${config.border} transition-all duration-200 hover:shadow-sm`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${config.text === 'text-emerald-700' ? 'bg-emerald-500' :
                              config.text === 'text-red-700' ? 'bg-red-500' :
                                config.text === 'text-amber-700' ? 'bg-slate-900' :
                                  config.text === 'text-green-700' ? 'bg-green-500' :
                                    config.text === 'text-amber-700' ? 'bg-amber-500' :
                                      config.text === 'text-purple-700' ? 'bg-purple-500' :
                                        'bg-slate-500'
                              }`}></div>
                            <span className="text-sm font-medium text-slate-700">{config.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-lg font-bold ${config.text}`}>
                              {value % 1 === 0 ? value : value.toFixed(1)}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">days</span>
                          </div>
                        </div>
                      ))}

                      {getLeaveBalanceEntries().length === 0 && (
                        <div className="text-center py-6 text-slate-400">
                          <p className="text-sm">No leave balance data available</p>
                        </div>
                      )}

                      {/* Summary footer */}
                      {getLeaveBalanceEntries().filter(e => e.key !== 'unpaid_leave').length > 0 && (
                        <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-200 px-1">
                          <span className="text-sm font-semibold text-slate-600">Available (excl. Unpaid)</span>
                          <span className="text-lg font-bold text-teal-700">
                            {getTotalLeaveBalance().toFixed(1)} days
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-400">
                      <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <TreePalm className="w-7 h-7 text-slate-300" />
                      </div>
                      <p className="text-sm font-medium">No leave balance found</p>
                      <p className="text-xs mt-1">Apply leave policy to this employee first</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Leaves Summary Card - NEW */}
            {selectedEmployee && (
              <Card className="border-0 shadow-md overflow-hidden">
                <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-violet-600 to-purple-700 text-white py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white/20 rounded-lg">
                        <ClipboardList className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-white text-base">Leaves Summary</CardTitle>
                        <p className="text-xs text-violet-100 mt-0.5">{monthName}</p>
                      </div>
                    </div>
                    {leaveSummary.totalDaysTaken > 0 && (
                      <div className="text-right">
                        <p className="text-2xl font-bold text-white">{leaveSummary.totalDaysTaken}</p>
                        <p className="text-xs text-violet-100">Days Taken</p>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  {leaveSummaryLoading ? (
                    <div className="text-center py-8 text-slate-500">
                      <div className="animate-spin w-8 h-8 border-3 border-slate-200 border-t-violet-600 rounded-full mx-auto mb-3"></div>
                      <p className="text-sm font-medium">Loading leaves summary...</p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* Usage by Type */}
                      {getUsageEntries().length > 0 ? (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <TrendingDown className="w-4 h-4 text-violet-600" />
                            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Usage by Type</h4>
                          </div>
                          <div className="space-y-2">
                            {getUsageEntries().map(({ key, total, approved, pending, config }) => (
                              <div
                                key={key}
                                className={`py-3 px-4 rounded-xl bg-gradient-to-r ${config.bg} border ${config.border} transition-all duration-200 hover:shadow-sm`}
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-sm font-medium text-slate-700">{config.label}</span>
                                  <span className={`text-base font-bold ${config.text}`}>
                                    {total % 1 === 0 ? total : total.toFixed(1)} days
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {approved > 0 && (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                      <CheckCircle2 className="w-3 h-3" />
                                      {approved % 1 === 0 ? approved : approved.toFixed(1)} approved
                                    </span>
                                  )}
                                  {pending > 0 && (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                      <Clock className="w-3 h-3" />
                                      {pending % 1 === 0 ? pending : pending.toFixed(1)} pending
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-4 text-slate-400">
                          <p className="text-sm">No leaves taken in {monthName}</p>
                        </div>
                      )}

                      {/* Divider */}
                      {leaveSummary.applications.length > 0 && (
                        <div className="border-t border-slate-200"></div>
                      )}

                      {/* Recent Applications */}
                      {leaveSummary.applications.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-violet-600" />
                              <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Applications</h4>
                            </div>
                            <Badge variant="outline" className="text-xs bg-violet-50 text-violet-700 border-violet-200">
                              {leaveSummary.applications.length} total
                            </Badge>
                          </div>
                          <div className="space-y-2.5">
                            {visibleApplications.map((leave, idx) => {
                              const typeKey = normalizeLeaveTypeKey(leave.leave_type);
                              const typeConfig = LEAVE_TYPE_CONFIG[typeKey] || {
                                label: leave.leave_type,
                                badge: 'bg-slate-100 text-slate-700'
                              };
                              const statusConf = STATUS_CONFIG[leave.status] || STATUS_CONFIG.pending;
                              const StatusIcon = statusConf.icon;

                              return (
                                <div
                                  key={leave.id || idx}
                                  className={`p-3.5 rounded-xl border ${statusConf.border} ${statusConf.bg} transition-all duration-200 hover:shadow-sm`}
                                >
                                  <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeConfig.badge}`}>
                                        {typeConfig.label}
                                      </span>
                                      {leave.is_half_day && (
                                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
                                          Half Day
                                        </span>
                                      )}
                                    </div>
                                    <div className={`flex items-center gap-1 text-xs font-medium ${statusConf.color}`}>
                                      <StatusIcon className="w-3.5 h-3.5" />
                                      {statusConf.label}
                                    </div>
                                  </div>

                                  {/* Dates */}
                                  <div className="flex flex-wrap gap-1 mb-2">
                                    {(leave.dates || []).slice(0, 5).map((date, i) => (
                                      <span key={i} className="px-2 py-0.5 bg-white/80 text-slate-600 rounded-md text-xs font-medium border border-slate-200">
                                        {format(new Date(date), 'MMM dd')}
                                      </span>
                                    ))}
                                    {(leave.dates || []).length > 5 && (
                                      <span className="px-2 py-0.5 bg-white/80 text-slate-500 rounded-md text-xs font-medium border border-slate-200">
                                        +{leave.dates.length - 5} more
                                      </span>
                                    )}
                                  </div>

                                  {/* Days count & reason */}
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs text-slate-500 truncate max-w-[70%]" title={leave.reason}>
                                      {leave.reason || 'No reason provided'}
                                    </p>
                                    <span className="text-xs font-semibold text-slate-600">
                                      {leave.days_count || leave.dates?.length || 0} day{(leave.days_count || leave.dates?.length || 0) !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Show more/less toggle */}
                          {leaveSummary.applications.length > 3 && (
                            <button
                              type="button"
                              onClick={() => setShowAllApplications(!showAllApplications)}
                              className="flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-700 transition-colors font-medium mt-3 mx-auto"
                            >
                              {showAllApplications ? (
                                <>
                                  <ChevronUp className="w-4 h-4" />
                                  Show less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-4 h-4" />
                                  Show all {leaveSummary.applications.length} applications
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Empty state for no applications */}
                      {leaveSummary.applications.length === 0 && getUsageEntries().length === 0 && (
                        <div className="text-center py-8 text-slate-400">
                          <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <ClipboardList className="w-7 h-7 text-slate-300" />
                          </div>
                          <p className="text-sm font-medium">No leave applications</p>
                          <p className="text-xs mt-1">No leaves found for {monthName}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Quick Stats */}
            {selectedEmployee && (
              <Card className="border-0 shadow-md">
                <CardContent className="p-5">
                  <h4 className="text-sm font-semibold text-slate-500 mb-4 uppercase tracking-wide">Quick Stats</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl text-center border border-emerald-100">
                      <p className="text-2xl font-bold text-emerald-700">
                        {salaryStructure.components.filter(c => c.type === 'earning').length}
                      </p>
                      <p className="text-xs text-emerald-600 font-medium">Components</p>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-red-50 to-rose-50 rounded-xl text-center border border-red-100">
                      <p className="text-2xl font-bold text-red-700">
                        {salaryStructure.components.filter(c => c.type === 'deduction').length}
                      </p>
                      <p className="text-xs text-red-600 font-medium">Deductions</p>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl text-center border border-amber-100">
                      <p className="text-2xl font-bold text-amber-700">
                        {unpaidFullDays}
                      </p>
                      <p className="text-xs text-amber-600 font-medium">Full Days</p>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-amber-50 to-amber-50 rounded-xl text-center border border-amber-100">
                      <p className="text-2xl font-bold text-amber-700">
                        {unpaidHalfDays}
                      </p>
                      <p className="text-xs text-amber-600 font-medium">Half Days</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Bulk Send Modal */}
        <Dialog open={showBulkModal} onOpenChange={setShowBulkModal}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-xl">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Mail className="w-5 h-5 text-amber-700" />
                </div>
                Send Salary Slips - {monthName}
              </DialogTitle>
              <DialogDescription>
                Review and send salary slips to employees. Employees without a saved salary structure cannot receive slips.
              </DialogDescription>
            </DialogHeader>

            {bulkLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="animate-spin w-10 h-10 border-4 border-slate-200 border-t-amber-500 rounded-full mb-4"></div>
                <p className="text-slate-500 font-medium">Loading employee salary data...</p>
              </div>
            ) : (
              <>
                {/* Send All Button */}
                <div className="flex items-center justify-between py-3 px-4 bg-gradient-to-r from-amber-50 to-amber-50 rounded-xl border border-amber-200">
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      {bulkEmployeeData.filter(d => d.hasSavedStructure).length} of {bulkEmployeeData.length} employees ready
                    </p>
                    <p className="text-xs text-amber-600">
                      {bulkSentIds.size > 0 && `${bulkSentIds.size} already sent`}
                    </p>
                  </div>
                  <Button
                    onClick={handleBulkSendAll}
                    disabled={sendingAll || bulkEmployeeData.filter(d => d.hasSavedStructure && !bulkSentIds.has(d.employee.employee_id || d.employee.id)).length === 0}
                    className="bg-slate-900 hover:bg-slate-800 font-semibold shadow-md"
                  >
                    {sendingAll ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send to All
                      </>
                    )}
                  </Button>
                </div>

                {/* Employee List */}
                <div className="overflow-y-auto flex-1 space-y-2 pr-1 -mr-1">
                  {bulkEmployeeData.map((empData) => {
                    const empId = empData.employee.employee_id || empData.employee.id;
                    const isSending = bulkSendingIds.has(empId);
                    const isSent = bulkSentIds.has(empId);
                    const isDisabled = !empData.hasSavedStructure || isSending || sendingAll;

                    return (
                      <div
                        key={empId}
                        className={`p-4 rounded-xl border transition-all duration-200 ${
                          isSent
                            ? 'bg-emerald-50 border-emerald-200'
                            : !empData.hasSavedStructure
                              ? 'bg-slate-50 border-slate-200 opacity-60'
                              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          {/* Employee Info */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                              isSent
                                ? 'bg-emerald-500'
                                : !empData.hasSavedStructure
                                  ? 'bg-slate-400'
                                  : 'bg-gradient-to-br from-slate-700 to-slate-900'
                            }`}>
                              {isSent ? <CheckCircle2 className="w-5 h-5" /> : empData.employee.full_name?.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 text-sm truncate">{empData.employee.full_name}</p>
                              <p className="text-xs text-slate-500 truncate">
                                {empData.employee.department || 'No Dept'}
                                {empData.employee.employee_id && ` · ${empData.employee.employee_id}`}
                              </p>
                            </div>
                          </div>

                          {/* Salary Preview */}
                          <div className="hidden sm:flex items-center gap-4 text-right flex-shrink-0">
                            {empData.hasSavedStructure ? (
                              <>
                                <div>
                                  <p className="text-xs text-slate-500">CTC</p>
                                  <p className="text-sm font-bold text-slate-700">₹{empData.ctc.toLocaleString()}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-500">Net</p>
                                  <p className="text-sm font-bold text-emerald-700">₹{Math.round(empData.netSalary).toLocaleString()}</p>
                                </div>
                              </>
                            ) : (
                              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Not Configured
                              </Badge>
                            )}
                          </div>

                          {/* Send Button */}
                          <div className="flex-shrink-0">
                            {isSent ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                                Sent
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleBulkSendSingle(empData)}
                                disabled={isDisabled}
                                className={`font-medium ${
                                  !empData.hasSavedStructure
                                    ? 'bg-slate-300 hover:bg-slate-300 cursor-not-allowed text-slate-500'
                                    : 'bg-slate-900 hover:bg-slate-800'
                                }`}
                                title={!empData.hasSavedStructure ? 'Salary structure not saved' : ''}
                              >
                                {isSending ? (
                                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                                ) : (
                                  <>
                                    <Send className="w-3.5 h-3.5 mr-1" />
                                    Send
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Mobile salary info */}
                        {empData.hasSavedStructure && (
                          <div className="flex sm:hidden items-center gap-4 mt-2 pt-2 border-t border-slate-100">
                            <span className="text-xs text-slate-500">CTC: <strong className="text-slate-700">₹{empData.ctc.toLocaleString()}</strong></span>
                            <span className="text-xs text-slate-500">Net: <strong className="text-emerald-700">₹{Math.round(empData.netSalary).toLocaleString()}</strong></span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {bulkEmployeeData.length === 0 && !bulkLoading && (
                    <div className="text-center py-12 text-slate-400">
                      <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p className="font-medium">No employees found</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default SalaryStructurePage;
