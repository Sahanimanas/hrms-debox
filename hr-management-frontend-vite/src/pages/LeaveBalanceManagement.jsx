import React, { useState, useEffect } from 'react';
import {
  Users, User, Plus, Minus, RefreshCw, Settings, Calendar,
  Search, Filter, Clock, Mail, Briefcase, Edit2, PlayCircle, RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { format } from 'date-fns';

const LeaveBalanceManagement = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { user } = getAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [departments, setDepartments] = useState([]);

  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [initializeDialogOpen, setInitializeDialogOpen] = useState(false);
  const [monthlyDialogOpen, setMonthlyDialogOpen] = useState(false);

  // Form states
  const [individualAction, setIndividualAction] = useState({
    action_type: 'set',
    leave_type: 'casual_leave',
    days: 0,
    reason: ''
  });

  const [bulkAction, setBulkAction] = useState({
    action_type: 'set',
    leave_type: 'casual_leave',
    days: 0,
    reason: ''
  });

  const [initializeDate, setInitializeDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyDate, setMonthlyDate] = useState(new Date().toISOString().split('T')[0]);

  const leaveTypes = [
    { key: 'casual_leave', label: 'Casual Leave' },
    { key: 'sick_leave', label: 'Sick Leave' },
    { key: 'earned_leave', label: 'Earned Leave' },
    { key: 'comp_off', label: 'Comp Off' }
  ];

  useEffect(() => {
    fetchEmployees();
    loadDepartments();
  }, []);

  const loadDepartments = () => {
    const savedDepts = localStorage.getItem('departments');
    setDepartments(savedDepts ? JSON.parse(savedDepts) : [
      'Engineering', 'Human Resources', 'Sales', 'Marketing', 'Finance', 'Operations'
    ]);
  };

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/employees');
      setEmployees(response.data);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  // Initialize all employees
  const handleInitializeAll = async () => {
    setSubmitting(true);
    try {
      const response = await api.post('/admin/leave-credit/initialize-all', {
        as_of_date: initializeDate
      });
      toast.success(`Successfully initialized ${response.data.results?.length || 0} employees`);
      setInitializeDialogOpen(false);
      fetchEmployees();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to initialize');
    } finally {
      setSubmitting(false);
    }
  };

  // Run monthly credit
  const handleRunMonthlyCredit = async () => {
    setSubmitting(true);
    try {
      const response = await api.post('/admin/leave-credit/run-monthly', {
        simulate_date: monthlyDate
      });
      toast.success(`Monthly credit applied successfully`);
      setMonthlyDialogOpen(false);
      fetchEmployees();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to run monthly credit');
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk update
  const handleBulkUpdate = async () => {
    if (bulkAction.days < 0) {
      toast.error('Days cannot be negative');
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post('/admin/leave-credit/leave-balance/bulk-update', bulkAction);
      toast.success(`Successfully updated ${response.data.updated_count || 0} employees`);
      setBulkDialogOpen(false);
      fetchEmployees();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to bulk update');
    } finally {
      setSubmitting(false);
    }
  };

  // Individual update
  const handleIndividualUpdate = async (e) => {
    e.preventDefault();
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }
    if (individualAction.days < 0) {
      toast.error('Days cannot be negative');
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post(
        `/admin/leave-credit/leave-balance/update/${selectedEmployee.employee_id}`,
        individualAction
      );
      toast.success(`Successfully updated ${selectedEmployee.full_name}'s leave balance`);
      setEditDialogOpen(false);
      fetchEmployees();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update');
    } finally {
      setSubmitting(false);
    }
  };

  // Filter employees
  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = searchTerm === '' ||
      emp.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_id?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDepartment = filterDepartment === '' || filterDepartment === 'all' || emp.department === filterDepartment;
    const matchesRole = filterRole === '' || filterRole === 'all' || emp.role === filterRole;
    return matchesSearch && matchesDepartment && matchesRole;
  });

  // Helper functions
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getAvatarColor = (name) => {
    const colors = [
      'bg-slate-900', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500',
      'bg-rose-500', 'bg-cyan-500', 'bg-slate-800', 'bg-pink-500',
      'bg-teal-500', 'bg-orange-500',
    ];
    if (!name) return colors[0];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  const handleEditClick = (employee) => {
    setSelectedEmployee(employee);
    setIndividualAction({
      action_type: 'set',
      leave_type: 'casual_leave',
      days: employee.leave_balance?.casual_leave || 0,
      reason: ''
    });
    setEditDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Leave Balance Management
          </h1>
          <p className="text-lg text-slate-600">Initialize, adjust, and manage employee leave balances</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setInitializeDialogOpen(true)}
            className="rounded-full"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Initialize All
          </Button>
          <Button
            variant="outline"
            onClick={() => setMonthlyDialogOpen(true)}
            className="rounded-full"
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            Run Monthly Credit
          </Button>
          <Button
            onClick={() => setBulkDialogOpen(true)}
            className="bg-slate-800 hover:bg-slate-900 rounded-full"
          >
            <Users className="w-4 h-4 mr-2" />
            Bulk Update
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg border border-slate-200">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Search employees..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={filterDepartment} onValueChange={setFilterDepartment}>
            <SelectTrigger className="w-40">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map(dept => (
                <SelectItem key={dept} value={dept}>{dept}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="employee">Employee</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Employees Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEmployees.map((employee) => (
          <Card
            key={employee.id}
            className="border-slate-100 shadow-sm hover:shadow-md transition-all"
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4 mb-4">
                {/* Avatar */}
                <div className="w-14 h-14 rounded-full flex-shrink-0 overflow-hidden ring-2 ring-slate-100">
                  <div
                    className={`w-full h-full ${getAvatarColor(employee.full_name)} flex items-center justify-center text-white font-semibold text-lg`}
                  >
                    {getInitials(employee.full_name)}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900 text-lg truncate">{employee.full_name}</h3>
                    <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {employee.employee_id}
                    </span>
                  </div>
                  <Badge className="mt-1 capitalize">{employee.role}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditClick(employee)}
                  className="text-slate-500 hover:text-slate-700"
                >
                  <Edit2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-600 truncate">{employee.email}</span>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <Briefcase className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-600">
                    {employee.designation || 'Employee'} - {employee.department}
                  </span>
                </div>
              </div>

              {/* Leave Balances */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <p className="text-xs text-slate-500">Sick</p>
                    <p className="text-sm font-semibold text-slate-900">{employee.leave_balance?.sick_leave ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Casual</p>
                    <p className="text-sm font-semibold text-slate-900">{employee.leave_balance?.casual_leave ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Earned</p>
                    <p className="text-sm font-semibold text-slate-900">{employee.leave_balance?.earned_leave ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Comp</p>
                    <p className="text-sm font-semibold text-slate-900">{employee.leave_balance?.comp_off ?? 0}</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  <p className="text-xs text-slate-500">
                    Joined {employee.joining_date ? format(new Date(employee.joining_date), 'MMM dd, yyyy') : 'N/A'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredEmployees.length === 0 && (
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="py-12">
            <div className="text-center text-slate-500">
              <User className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <p className="text-lg mb-2">No employees found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Individual Employee Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update Leave Balance</DialogTitle>
          </DialogHeader>

          {selectedEmployee && (
            <form onSubmit={handleIndividualUpdate} className="space-y-4 mt-4">
              {/* Employee Info */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold ${getAvatarColor(selectedEmployee.full_name)}`}>
                  {getInitials(selectedEmployee.full_name)}
                </div>
                <div>
                  <p className="font-medium text-slate-900">{selectedEmployee.full_name}</p>
                  <p className="text-sm text-slate-500">{selectedEmployee.employee_id}</p>
                </div>
              </div>

              {/* Current Balances */}
              <div className="grid grid-cols-4 gap-2 p-3 bg-slate-50 rounded-lg">
                <div className="text-center">
                  <p className="text-xs text-slate-500">Sick</p>
                  <p className="font-semibold text-slate-900">{selectedEmployee.leave_balance?.sick_leave ?? 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500">Casual</p>
                  <p className="font-semibold text-slate-900">{selectedEmployee.leave_balance?.casual_leave ?? 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500">Earned</p>
                  <p className="font-semibold text-slate-900">{selectedEmployee.leave_balance?.earned_leave ?? 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500">Comp</p>
                  <p className="font-semibold text-slate-900">{selectedEmployee.leave_balance?.comp_off ?? 0}</p>
                </div>
              </div>

              {/* Action Type */}
              <div>
                <Label>Action *</Label>
                <Select
                  value={individualAction.action_type}
                  onValueChange={(value) => setIndividualAction({ ...individualAction, action_type: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="set">Set (replace current value)</SelectItem>
                    <SelectItem value="add">Add (increment)</SelectItem>
                    <SelectItem value="deduct">Deduct (decrement)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 mt-1">
                  {individualAction.action_type === 'set' && 'Replace the current balance with a new value'}
                  {individualAction.action_type === 'add' && 'Add days to the current balance'}
                  {individualAction.action_type === 'deduct' && 'Subtract days from the current balance'}
                </p>
              </div>

              {/* Leave Type */}
              <div>
                <Label>Leave Type *</Label>
                <Select
                  value={individualAction.leave_type}
                  onValueChange={(value) => {
                    setIndividualAction({
                      ...individualAction,
                      leave_type: value,
                      days: individualAction.action_type === 'set'
                        ? (selectedEmployee.leave_balance?.[value] || 0)
                        : individualAction.days
                    });
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {leaveTypes.map((lt) => (
                      <SelectItem key={lt.key} value={lt.key}>{lt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Days */}
              <div>
                <Label>Days *</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={individualAction.days}
                  onChange={(e) => setIndividualAction({ ...individualAction, days: parseFloat(e.target.value) || 0 })}
                  required
                  className="mt-1"
                />
              </div>

              {/* Reason */}
              <div>
                <Label>Reason</Label>
                <Input
                  value={individualAction.reason}
                  onChange={(e) => setIndividualAction({ ...individualAction, reason: e.target.value })}
                  placeholder="Enter reason for adjustment..."
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">Optional - for audit purposes</p>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditDialogOpen(false)}
                  className="flex-1"
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-slate-800 hover:bg-slate-900"
                  disabled={submitting}
                >
                  {submitting ? 'Updating...' : 'Update Balance'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Update Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Update All Employees</DialogTitle>
          </DialogHeader>

          <form onSubmit={(e) => { e.preventDefault(); handleBulkUpdate(); }} className="space-y-4 mt-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800">
                <strong>Warning:</strong> This will affect all {employees.length} employees.
              </p>
            </div>

            {/* Action Type */}
            <div>
              <Label>Action *</Label>
              <Select
                value={bulkAction.action_type}
                onValueChange={(value) => setBulkAction({ ...bulkAction, action_type: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="set">Set (replace current value)</SelectItem>
                  <SelectItem value="add">Add (increment)</SelectItem>
                  <SelectItem value="deduct">Deduct (decrement)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Leave Type */}
            <div>
              <Label>Leave Type *</Label>
              <Select
                value={bulkAction.leave_type}
                onValueChange={(value) => setBulkAction({ ...bulkAction, leave_type: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => (
                    <SelectItem key={lt.key} value={lt.key}>{lt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Days */}
            <div>
              <Label>Days *</Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={bulkAction.days}
                onChange={(e) => setBulkAction({ ...bulkAction, days: parseFloat(e.target.value) || 0 })}
                required
                className="mt-1"
              />
            </div>

            {/* Reason */}
            <div>
              <Label>Reason *</Label>
              <Input
                value={bulkAction.reason}
                onChange={(e) => setBulkAction({ ...bulkAction, reason: e.target.value })}
                placeholder="Enter reason for bulk adjustment..."
                required
                className="mt-1"
              />
            </div>

            {/* Preview */}
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-600">
                <strong>Preview:</strong>{' '}
                {bulkAction.action_type === 'set' && `Set all ${bulkAction.leave_type.replace('_', ' ')} to ${bulkAction.days} days`}
                {bulkAction.action_type === 'add' && `Add ${bulkAction.days} days to all ${bulkAction.leave_type.replace('_', ' ')}`}
                {bulkAction.action_type === 'deduct' && `Deduct ${bulkAction.days} days from all ${bulkAction.leave_type.replace('_', ' ')}`}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkDialogOpen(false)}
                className="flex-1"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-slate-800 hover:bg-slate-900"
                disabled={submitting}
              >
                {submitting ? 'Updating...' : 'Update All'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Initialize All Dialog */}
      <Dialog open={initializeDialogOpen} onOpenChange={setInitializeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Initialize All Employees</DialogTitle>
          </DialogHeader>

          <form onSubmit={(e) => { e.preventDefault(); handleInitializeAll(); }} className="space-y-4 mt-4">
            <p className="text-sm text-slate-600">
              Reset all employee leave balances to the starting values based on the selected date.
            </p>

            <div>
              <Label>As of Date *</Label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  type="date"
                  value={initializeDate}
                  onChange={(e) => setInitializeDate(e.target.value)}
                  required
                  className="pl-10"
                />
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-medium text-amber-800 mb-2">Will set balances to:</p>
              <ul className="text-sm text-amber-700 space-y-1">
                <li>• Casual Leave: <strong>6 days</strong></li>
                <li>• Sick Leave: <strong>0.5 days</strong></li>
                <li>• Earned Leave: <strong>0 days</strong></li>
              </ul>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setInitializeDialogOpen(false)}
                className="flex-1"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-slate-800 hover:bg-slate-900"
                disabled={submitting}
              >
                {submitting ? 'Initializing...' : 'Initialize All'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Monthly Credit Dialog */}
      <Dialog open={monthlyDialogOpen} onOpenChange={setMonthlyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run Monthly Credit</DialogTitle>
          </DialogHeader>

          <form onSubmit={(e) => { e.preventDefault(); handleRunMonthlyCredit(); }} className="space-y-4 mt-4">
            <p className="text-sm text-slate-600">
              Manually trigger the monthly leave credit (normally runs on 1st of each month).
            </p>

            <div>
              <Label>Credit Date *</Label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  type="date"
                  value={monthlyDate}
                  onChange={(e) => setMonthlyDate(e.target.value)}
                  required
                  className="pl-10"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Use a future date to simulate credits
              </p>
            </div>

            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm font-medium text-green-800 mb-2">Monthly credit adds:</p>
              <ul className="text-sm text-green-700 space-y-1">
                <li>• Sick Leave: <strong>+0.5 days</strong></li>
                <li>• Earned Leave: <strong>+1 day</strong></li>
              </ul>
              {/* <p className="text-xs text-green-600 mt-2"> */}
              {/*   * January resets all balances (CL=6, SL=0.5, EL=0) */}
              {/* </p> */}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMonthlyDialogOpen(false)}
                className="flex-1"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-slate-800 hover:bg-slate-900"
                disabled={submitting}
              >
                {submitting ? 'Running...' : 'Run Credit'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeaveBalanceManagement;
