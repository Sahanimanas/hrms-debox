import React, { useState, useEffect } from 'react';
import { Plus, User, Mail, Phone, Briefcase, Edit2, Search, Filter, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { format } from 'date-fns';

const EmployeesPage = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { user } = getAuth();
  const [departments, setDepartments] = useState([]);
  const [managers, setManagers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterOrganization, setFilterOrganization] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [organizations, setOrganizations] = useState([]);

  const [employeeForm, setEmployeeForm] = useState({
    email: '',
    password: '',
    full_name: '',
    department: '',
    phone: '',
    organization_id: 'none',
    manager_email: '',
    joining_date: new Date().toISOString().split('T')[0], // Default to today
  });

  useEffect(() => {
    fetchEmployees();
    loadDepartments();
    fetchOrganizations();
  }, []);

  const fetchOrganizations = async () => {
    try {
      const response = await api.get('/organizations');
      setOrganizations(response.data);
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
    }
  };

  const loadDepartments = () => {
    const savedDepts = localStorage.getItem('departments');
    setDepartments(savedDepts ? JSON.parse(savedDepts) : [
      'Engineering',
      'Human Resources',
      'Sales',
      'Marketing',
      'Finance',
      'Operations'
    ]);
  };

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/employees');
      setEmployees(response.data);
      // Filter managers for dropdown
      const managerList = response.data.filter(emp =>
        emp.role === 'manager' || emp.role === 'admin'
      );
      setManagers(managerList);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await api.post('/employees', {
        ...employeeForm,
        role: 'employee', // Default role
        designation: 'Employee', // Default designation
        organization_id: (employeeForm.organization_id && employeeForm.organization_id !== 'none') ? employeeForm.organization_id : null,
        manager_email: employeeForm.manager_email === 'none' ? '' : employeeForm.manager_email,
        joining_date: employeeForm.joining_date ? new Date(employeeForm.joining_date).toISOString() : new Date().toISOString(),
      });
      toast.success('Employee added successfully!');
      setDialogOpen(false);
      setEmployeeForm({
        email: '',
        password: '',
        full_name: '',
        department: '',
        phone: '',
        organization_id: 'none',
        manager_email: '',
        joining_date: new Date().toISOString().split('T')[0],
      });
      fetchEmployees();
    } catch (error) {
      let errorMessage = 'Failed to add employee';
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (Array.isArray(detail)) {
          errorMessage = detail.map(err =>
            typeof err === 'object' && err.msg ? err.msg : String(err)
          ).join('; ');
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        }
      }
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (employee) => {
    setSelectedEmployee({
      ...employee,
      joining_date: employee.joining_date
        ? new Date(employee.joining_date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]
    });
    setEditDialogOpen(true);
  };

  const handleUpdateEmployee = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const originalEmployee = employees.find(emp => emp.id === selectedEmployee.id);

      // First update the employee profile
      await api.put(`/employees/${selectedEmployee.id}`, {
        full_name: selectedEmployee.full_name,
        department: selectedEmployee.department,
        designation: selectedEmployee.designation,
        phone: selectedEmployee.phone,
        monthly_salary: selectedEmployee.monthly_salary || null,
        organization_id:
          selectedEmployee.organization_id && selectedEmployee.organization_id !== 'none'
            ? selectedEmployee.organization_id
            : null,
        manager_email:
          selectedEmployee.manager_email === 'none'
            ? null
            : selectedEmployee.manager_email,
        joining_date: selectedEmployee.joining_date
          ? new Date(selectedEmployee.joining_date).toISOString()
          : null,
      });


      // If role changed, update it separately
      if (originalEmployee.role !== selectedEmployee.role) {
        await api.put(`/employees/${selectedEmployee.id}/role`, {
          role: selectedEmployee.role
        });
      }

      toast.success('Employee updated successfully!');
      setEditDialogOpen(false);
      setSelectedEmployee(null);
      fetchEmployees();
    } catch (error) {
      let errorMessage = 'Failed to update employee';
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (Array.isArray(detail)) {
          errorMessage = detail.map(err =>
            typeof err === 'object' && err.msg ? err.msg : String(err)
          ).join('; ');
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        }
      }
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Filter and search employees
  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = searchTerm === '' ||
      emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.designation.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesDepartment = filterDepartment === '' || filterDepartment === 'all' || emp.department === filterDepartment;
    const matchesRole = filterRole === '' || filterRole === 'all' || emp.role === filterRole;
    const matchesOrganization = filterOrganization === '' || filterOrganization === 'all' || emp.organization_id === filterOrganization;

    return matchesSearch && matchesDepartment && matchesRole && matchesOrganization;
  });

  // Helper function to get initials from name
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Helper function to generate a consistent color based on name
  const getAvatarColor = (name) => {
    const colors = [
      'bg-slate-900',
      'bg-emerald-500',
      'bg-purple-500',
      'bg-amber-500',
      'bg-rose-500',
      'bg-cyan-500',
      'bg-slate-800',
      'bg-pink-500',
      'bg-teal-500',
      'bg-orange-500',
    ];
    if (!name) return colors[0];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
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
            {user?.role === 'admin' ? 'All Employees' : 'Team Members'}
          </h1>
          <p className="text-lg text-slate-600">Manage employee information</p>
        </div>
        {user?.role === 'admin' && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="add-employee-btn" className="bg-slate-800 hover:bg-slate-900 rounded-full">
                <Plus className="w-4 h-4 mr-2" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Employee</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="emp-name">Full Name *</Label>
                  <Input
                    id="emp-name"
                    data-testid="emp-name-input"
                    placeholder="John Doe"
                    value={employeeForm.full_name}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, full_name: e.target.value })}
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="emp-email">Email *</Label>
                  <Input
                    id="emp-email"
                    data-testid="emp-email-input"
                    type="email"
                    placeholder="john.doe@company.com"
                    value={employeeForm.email}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="emp-phone">Phone Number *</Label>
                  <Input
                    id="emp-phone"
                    data-testid="emp-phone-input"
                    type="tel"
                    placeholder="+1234567890"
                    value={employeeForm.phone}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })}
                    required
                    className="mt-1"
                  />
                </div>

                {/* Joining Date Field */}
                <div>
                  <Label htmlFor="emp-joining-date">Joining Date *</Label>
                  <div className="relative mt-1">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <Input
                      id="emp-joining-date"
                      data-testid="emp-joining-date-input"
                      type="date"
                      value={employeeForm.joining_date}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, joining_date: e.target.value })}
                      required
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Used to calculate monthly leave credits (Earned Leave, Sick Leave)
                  </p>
                </div>

                <div>
                  <Label htmlFor="emp-organization">Organization</Label>
                  <Select
                    value={employeeForm.organization_id}
                    onValueChange={(value) => setEmployeeForm({ ...employeeForm, organization_id: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select organization (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {organizations.map(org => (
                        <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {organizations.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">Go to Organizations to add organizations</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="emp-department">Department *</Label>
                  <Select
                    value={employeeForm.department}
                    onValueChange={(value) => setEmployeeForm({ ...employeeForm, department: value })}
                  >
                    <SelectTrigger data-testid="emp-department-select" className="mt-1">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map(dept => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {departments.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">Go to Settings to add departments</p>
                  )}
                </div>

                {/* Manager Selection */}
                <div>
                  <Label htmlFor="emp-manager">Manager</Label>
                  <Select
                    value={employeeForm.manager_email || 'none'}
                    onValueChange={(value) => setEmployeeForm({ ...employeeForm, manager_email: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select manager (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {managers.map(mgr => (
                        <SelectItem key={mgr.email} value={mgr.email}>
                          {mgr.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-1">Manager will approve leave requests</p>
                </div>

                <div>
                  <Label htmlFor="emp-password">Temporary Password *</Label>
                  <Input
                    id="emp-password"
                    data-testid="emp-password-input"
                    type="password"
                    placeholder="Employee will use this to login"
                    value={employeeForm.password}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })}
                    required
                    className="mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">Employee can change this after first login</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                    className="flex-1"
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    data-testid="submit-employee-btn"
                    className="flex-1 bg-slate-800 hover:bg-slate-900"
                    disabled={submitting}
                  >
                    {submitting ? 'Adding...' : 'Add Employee'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Edit Employee Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>

          {selectedEmployee && (
            <form onSubmit={handleUpdateEmployee} className="space-y-4 mt-4">

              {/* Full Name */}
              <div>
                <Label>Full Name *</Label>
                <Input
                  value={selectedEmployee.full_name}
                  onChange={(e) =>
                    setSelectedEmployee({ ...selectedEmployee, full_name: e.target.value })
                  }
                  required
                  className="mt-1"
                />
              </div>

              {/* Joining Date */}
              <div>
                <Label>Joining Date *</Label>
                <div className="relative mt-1">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <Input
                    type="date"
                    value={selectedEmployee.joining_date || ''}
                    onChange={(e) =>
                      setSelectedEmployee({ ...selectedEmployee, joining_date: e.target.value })
                    }
                    required
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Changing this will affect monthly leave credit calculations
                </p>
              </div>

              {/* Organization */}
              <div>
                <Label>Organization</Label>
                <Select
                  value={selectedEmployee.organization_id || 'none'}
                  onValueChange={(value) =>
                    setSelectedEmployee({
                      ...selectedEmployee,
                      organization_id: value === 'none' ? null : value
                    })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select organization (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {organizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Department */}
              <div>
                <Label>Department *</Label>
                <Select
                  value={selectedEmployee.department}
                  onValueChange={(value) =>
                    setSelectedEmployee({ ...selectedEmployee, department: value })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map(dept => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Designation */}
              <div>
                <Label>Designation *</Label>
                <Input
                  value={selectedEmployee.designation}
                  onChange={(e) =>
                    setSelectedEmployee({ ...selectedEmployee, designation: e.target.value })
                  }
                  required
                  className="mt-1"
                />
              </div>

              {/* Role */}
              <div>
                <Label>Role *</Label>
                <Select
                  value={selectedEmployee.role}
                  onValueChange={(value) =>
                    setSelectedEmployee({
                      ...selectedEmployee,
                      role: value,
                      // Clear manager if role changes
                      manager_email: value !== 'employee' ? null : selectedEmployee.manager_email
                    })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>

                <p className="text-xs text-amber-600 mt-1">
                  {selectedEmployee.role === 'manager' && 'Managers can approve leave requests'}
                  {selectedEmployee.role === 'admin' && 'Admins have full system access'}
                  {selectedEmployee.role === 'employee' && 'Regular employee access'}
                </p>
              </div>

              {/* MANAGER SELECT (ONLY FOR EMPLOYEES) */}
              {selectedEmployee.role === 'employee' && (
                <div>
                  <Label>Manager</Label>
                  <Select
                    value={selectedEmployee.manager_email || 'none'}
                    onValueChange={(value) =>
                      setSelectedEmployee({
                        ...selectedEmployee,
                        manager_email: value === 'none' ? null : value
                      })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select manager (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {managers.map(mgr => (
                        <SelectItem key={mgr.email} value={mgr.email}>
                          {mgr.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <p className="text-xs text-slate-500 mt-1">
                    Manager will approve leave requests
                  </p>
                </div>
              )}

              {/* Phone */}
              <div>
                <Label>Phone Number *</Label>
                <Input
                  type="tel"
                  value={selectedEmployee.phone}
                  onChange={(e) =>
                    setSelectedEmployee({ ...selectedEmployee, phone: e.target.value })
                  }
                  required
                  className="mt-1"
                />
              </div>

              {/* Salary */}
              <div>
                <Label>Monthly Salary (₹)</Label>
                <Input
                  type="number"
                  value={selectedEmployee.monthly_salary || ''}
                  onChange={(e) =>
                    setSelectedEmployee({
                      ...selectedEmployee,
                      monthly_salary: e.target.value
                        ? Number(e.target.value)
                        : null
                    })
                  }
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Required for salary slip generation
                </p>
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
                  {submitting ? 'Updating...' : 'Update Employee'}
                </Button>
              </div>

            </form>
          )}
        </DialogContent>
      </Dialog>


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
          <Select value={filterOrganization} onValueChange={setFilterOrganization}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Organization" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Organizations</SelectItem>
              {organizations.map(org => (
                <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Employees Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEmployees.map((employee) => (
          <Card
            key={employee.id}
            data-testid={`employee-card-${employee.id}`}
            className="border-slate-100 shadow-sm hover:shadow-md transition-all"
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4 mb-4">
                {/* Profile Picture / Avatar */}
                <div className="w-14 h-14 rounded-full flex-shrink-0 overflow-hidden ring-2 ring-slate-100">
                  {employee.profile_picture_url ? (
                    <img
                      src={employee.profile_picture_url}
                      alt={employee.full_name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // Fallback to initials if image fails to load
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className={`w-full h-full ${getAvatarColor(employee.full_name)} flex items-center justify-center text-white font-semibold text-lg`}
                    style={{ display: employee.profile_picture_url ? 'none' : 'flex' }}
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
                {user?.role === 'admin' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(employee)}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-600 truncate">{employee.email}</span>
                </div>

                {employee.phone && (
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="text-slate-600">{employee.phone}</span>
                  </div>
                )}

                <div className="flex items-center gap-3 text-sm">
                  <Briefcase className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-600">
                    {employee.designation} - {employee.department}
                  </span>
                </div>

                {employee.organization_name && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <Badge variant="outline" className="text-xs">
                      {employee.organization_name}
                    </Badge>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="grid grid-cols-3 gap-2">
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
                </div>
              </div>

              {employee.manager_name && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-500 mb-1">Reports to</p>
                  <p className="text-sm font-medium text-slate-700">{employee.manager_name}</p>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  <p className="text-xs text-slate-500">
                    Joined {format(new Date(employee.joining_date), 'MMM dd, yyyy')}
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
              <p className="text-lg mb-2">
                {employees.length === 0 ? 'No employees found' : 'No employees match your search criteria'}
              </p>
              {employees.length === 0 && user?.role === 'admin' && (
                <p className="text-sm">Click &quot;Add Employee&quot; to create your first employee</p>
              )}
              {employees.length > 0 && (
                <p className="text-sm">Try adjusting your search or filters</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EmployeesPage;
