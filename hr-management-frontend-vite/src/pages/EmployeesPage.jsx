import React, { useState, useEffect } from 'react';
import {
  Plus, User, Mail, Phone, Briefcase, Pencil, Search, Calendar, History, Download, KeyRound,
  List, LayoutGrid, SlidersHorizontal, Ellipsis, X, Eye, EyeOff, Wand2, Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, Segmented, StatusBadge } from '@/components/ds';
import PageHeader, { PageShell } from '@/modules/platform/components/PageHeader';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth, setAuth } from '@/lib/auth';
import { format } from 'date-fns';
import { exportCsv } from '@/lib/exportCsv';
import PhoneInput from '@/components/PhoneInput';
import { phoneError } from '@/lib/phone';
import PasswordRules from '@/components/PasswordRules';
import { passwordPolicyMessage, generatePassword } from '@/lib/password';
import { emailError, nameError, dateError, amountError, firstError } from '@/lib/validation';
import { apiErrorMessage } from '@/lib/apiError';
import EmployeeLifecycleDialog from '@/modules/lifecycle/components/EmployeeLifecycleDialog';
import {
  DirectoryPagination, FilterSelect, MenuItem, TableCheckbox,
} from './EmployeeDirectoryParts';

const EXPORT_COLUMNS = [
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'full_name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'role', label: 'Role' },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'manager_name', label: 'Manager' },
  { label: 'Joining date', value: (r) => (r.joining_date ? format(new Date(r.joining_date), 'yyyy-MM-dd') : '') },
  { label: 'Status', value: (r) => r.employment_status || 'active' },
  { label: 'Probation ends', value: (r) => (r.probation_end_date ? format(new Date(r.probation_end_date), 'yyyy-MM-dd') : '') },
  { label: 'Exit date', value: (r) => (r.exit_date ? format(new Date(r.exit_date), 'yyyy-MM-dd') : '') },
];

// Optional table columns (Figma "Columns" button). Organization and role are extra to the design, hidden by default.
const TABLE_COLUMNS = [
  { key: 'employee_id', label: 'ID', width: 'w-[96px]' },
  { key: 'department', label: 'Department', width: 'w-[136px]' },
  { key: 'designation', label: 'Designation', width: 'w-[166px]' },
  { key: 'manager', label: 'Manager', width: 'w-[156px]' },
  { key: 'organization', label: 'Organization', width: 'w-[150px]' },
  { key: 'role', label: 'Role', width: 'w-[104px]' },
  { key: 'status', label: 'Status', width: 'w-[120px]' },
  { key: 'joined', label: 'Joined', width: 'w-[112px]' },
];
const DEFAULT_HIDDEN_COLUMNS = ['organization', 'role'];

/** Employment status → pill label + tone (Figma: Active / Probation / On notice). */
const EMPLOYMENT_STATUS = {
  active: { label: 'Active', tone: 'success' },
  probation: { label: 'Probation', tone: 'warning' },
  notice: { label: 'On notice', tone: 'danger' },
  exited: { label: 'Exited', tone: 'neutral' },
};

const statusOf = (emp) => emp?.employment_status || 'active';

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' };

const fmtDate = (d, pattern = 'dd MMM yyyy') => {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : format(date, pattern);
};

const EmployeesPage = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { user } = getAuth();
  const [departments, setDepartments] = useState([]);
  const [managers, setManagers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterOrganization, setFilterOrganization] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [lifecycleUid, setLifecycleUid] = useState(null);
  const [resetTargets, setResetTargets] = useState(null);
  const [sendingReset, setSendingReset] = useState(false);
  const [statusTab, setStatusTab] = useState('all');
  const [view, setView] = useState('list');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [actionMenuId, setActionMenuId] = useState(null);
  const [hiddenColumns, setHiddenColumns] = useState(() => new Set(DEFAULT_HIDDEN_COLUMNS));

  const [employeeForm, setEmployeeForm] = useState({
    email: '',
    password: '',
    full_name: '',
    department: '',
    phone: '',
    organization_id: 'none',
    manager_email: '',
    joining_date: new Date().toISOString().split('T')[0], // Default to today
    date_of_birth: '',
    gender: '',
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

  const addErrors = {
    full_name: nameError(employeeForm.full_name, { label: 'Full name' }),
    email: emailError(employeeForm.email),
    phone: phoneError(employeeForm.phone, { required: true }),
    joining_date: dateError(employeeForm.joining_date, { required: true, label: 'Joining date' }),
    department: employeeForm.department ? null : 'Please select a department',
    date_of_birth: dateError(employeeForm.date_of_birth, { label: 'Date of birth', notFuture: true, minAgeYears: 14 }),
    password: passwordPolicyMessage(employeeForm.password),
  };

  const editErrors = selectedEmployee ? {
    full_name: nameError(selectedEmployee.full_name, { label: 'Full name' }),
    email: emailError(selectedEmployee.email),
    joining_date: dateError(selectedEmployee.joining_date, { required: true, label: 'Joining date' }),
    designation: String(selectedEmployee.designation ?? '').trim() ? null : 'Designation is required',
    phone: phoneError(selectedEmployee.phone, { required: true }),
    monthly_salary: amountError(selectedEmployee.monthly_salary, { label: 'Monthly salary' }),
  } : {};

  // Shown under a field once the form has been submitted
  const fieldError = (errors, key) => (submitAttempted && errors[key]
    ? <p className="text-xs text-danger-fg mt-1" role="alert">{errors[key]}</p>
    : null);
  const invalidCls = (errors, key) => (submitAttempted && errors[key] ? 'border-danger-solid' : '');

  const handleGeneratePassword = () => {
    setEmployeeForm({ ...employeeForm, password: generatePassword() });
    setShowPassword(true);
  };

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(employeeForm.password);
      toast.success('Password copied');
    } catch {
      toast.error('Could not copy — select the password and copy it manually');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = firstError(addErrors);
    if (problem) {
      setSubmitAttempted(true);
      toast.error(problem);
      return;
    }
    setSubmitting(true);

    try {
      await api.post('/employees', {
        ...employeeForm,
        email: employeeForm.email.trim(),
        full_name: employeeForm.full_name.trim(),
        role: 'employee', // Default role
        designation: 'Employee', // Default designation
        organization_id: (employeeForm.organization_id && employeeForm.organization_id !== 'none') ? employeeForm.organization_id : null,
        manager_email: employeeForm.manager_email === 'none' ? '' : employeeForm.manager_email,
        joining_date: employeeForm.joining_date ? new Date(employeeForm.joining_date).toISOString() : new Date().toISOString(),
        date_of_birth: employeeForm.date_of_birth || null,
        gender: employeeForm.gender || null,
      });
      toast.success('Employee added successfully!');
      setDialogOpen(false);
      setSubmitAttempted(false);
      setShowPassword(false);
      setEmployeeForm({
        email: '',
        password: '',
        full_name: '',
        department: '',
        phone: '',
        organization_id: 'none',
        manager_email: '',
        joining_date: new Date().toISOString().split('T')[0],
        date_of_birth: '',
        gender: '',
      });
      fetchEmployees();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to add employee'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (employee) => {
    setSelectedEmployee({
      ...employee,
      original_email: employee.email,
      joining_date: employee.joining_date
        ? new Date(employee.joining_date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]
    });
    setSubmitAttempted(false);
    setEditDialogOpen(true);
  };

  const handleUpdateEmployee = async (e) => {
    e.preventDefault();
    const problem = firstError(editErrors);
    if (problem) {
      setSubmitAttempted(true);
      toast.error(problem);
      return;
    }
    setSubmitting(true);

    try {
      const originalEmail = selectedEmployee.original_email;
      const originalEmployee = employees.find(emp => emp.email === originalEmail);
      const newEmail = selectedEmployee.email.trim();

      // Email first: it is the login id, so a clash (409) stops the save early.
      // Email is unique; employee_id can be missing or duplicated in legacy data
      if (newEmail !== originalEmail) {
        const { data } = await api.put(`/employees/${encodeURIComponent(originalEmail)}/email`, { email: newEmail });
        // Changing your own email: keep this session signed in with a token for the new address
        if (data.access_token) setAuth(data.access_token, { ...user, email: newEmail });
      }

      const employeeRef = encodeURIComponent(newEmail);
      await api.put(`/employees/${employeeRef}`, {
        // undefined drops the key: the API rejects null/empty for these
        full_name: selectedEmployee.full_name?.trim() || undefined,
        department: selectedEmployee.department || undefined,
        designation: selectedEmployee.designation?.trim() || undefined,
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
        await api.put(`/employees/${employeeRef}/role`, {
          role: selectedEmployee.role
        });
      }

      toast.success('Employee updated successfully!');
      setEditDialogOpen(false);
      setSelectedEmployee(null);
      fetchEmployees();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update employee'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendPasswordReset = async () => {
    setSendingReset(true);
    try {
      const response = await api.post('/password-reset/admin/send', {
        employee_ids: resetTargets.map(emp => emp.email)
      });
      const { sent = [], failed = [], skipped = [] } = response.data;
      if (sent.length) {
        toast.success(
          sent.length === 1
            ? `Password reset email sent to ${sent[0].email}`
            : `Password reset emails sent to ${sent.length} employees`
        );
      }
      if (failed.length) {
        toast.error(`Could not send to ${failed.map(f => f.email).join(', ')}. Check the mail configuration.`);
      }
      if (skipped.length) {
        toast.warning(`Skipped ${skipped.length} employee(s) (exited or missing email)`);
      }
      setResetTargets(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send password reset emails');
    } finally {
      setSendingReset(false);
    }
  };

  // Filter and search employees (everything except the status tab)
  const term = searchTerm.trim().toLowerCase();
  const baseFiltered = employees.filter(emp => {
    const matchesSearch = term === '' ||
      (emp.full_name || '').toLowerCase().includes(term) ||
      (emp.email || '').toLowerCase().includes(term) ||
      (emp.employee_id || '').toString().toLowerCase().includes(term) ||
      (emp.designation || '').toLowerCase().includes(term);

    const matchesDepartment = filterDepartment === '' || filterDepartment === 'all' || emp.department === filterDepartment;
    const matchesRole = filterRole === '' || filterRole === 'all' || emp.role === filterRole;
    const matchesOrganization = filterOrganization === '' || filterOrganization === 'all' || emp.organization_id === filterOrganization;

    return matchesSearch && matchesDepartment && matchesRole && matchesOrganization;
  });

  const filteredEmployees = statusTab === 'all'
    ? baseFiltered
    : baseFiltered.filter(emp => statusOf(emp) === statusTab);

  // Status tab counts (Figma: All · 248 / Active · 236 / …)
  const statusCounts = baseFiltered.reduce((acc, emp) => {
    const s = statusOf(emp);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const statusTabs = [
    { value: 'all', label: `All · ${baseFiltered.length}` },
    ...['active', 'probation', 'notice', 'exited']
      .filter(s => s !== 'exited' || statusCounts.exited || statusTab === 'exited')
      .map(s => ({ value: s, label: `${EMPLOYMENT_STATUS[s].label} · ${statusCounts[s] || 0}` })),
  ];

  // Pagination
  const pageSize = view === 'grid' ? 12 : 10;
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageEmployees = filteredEmployees.slice(pageStart, pageStart + pageSize);

  // Row selection (bulk actions)
  const selectedEmployees = employees.filter(emp => selectedIds.has(emp.email));
  const pageSelectedCount = pageEmployees.filter(emp => selectedIds.has(emp.email)).length;
  const headerChecked = pageEmployees.length > 0 && pageSelectedCount === pageEmployees.length
    ? true
    : pageSelectedCount > 0 ? 'indeterminate' : false;

  const toggleRow = (id, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const togglePage = (checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      pageEmployees.forEach(emp => (checked ? next.add(emp.email) : next.delete(emp.email)));
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const withPageReset = (setter) => (value) => { setter(value); setPage(1); };

  const isColumnVisible = (key) => !hiddenColumns.has(key);
  const visibleColumns = TABLE_COLUMNS.filter(c => isColumnVisible(c.key));
  const toggleColumn = (key, visible) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (visible) next.delete(key); else next.add(key);
      return next;
    });
  };

  const departmentCount = new Set(employees.map(e => e.department).filter(Boolean)).size;
  // Saved departments plus any already on employee records, so filters/edit show every value
  const departmentOptions = [...new Set([...departments, ...employees.map(e => e.department)].filter(Boolean))];
  const orgCount = organizations.length;
  const subtitle = `${employees.length} ${employees.length === 1 ? 'person' : 'people'} across ${departmentCount} department${departmentCount === 1 ? '' : 's'}`
    + (orgCount > 1 ? ` and ${orgCount} organizations` : '');

  const isAdmin = user?.role === 'admin';
  const exportRows = (rows) => exportCsv('employees', rows, EXPORT_COLUMNS);

  const renderCell = (key, employee) => {
    switch (key) {
      case 'employee_id':
        return <span className="text-[13px] leading-[18px] text-ink-secondary">{employee.employee_id || '—'}</span>;
      case 'department':
        return <span className="text-sm text-ink-secondary">{employee.department || '—'}</span>;
      case 'designation':
        return <span className="text-sm text-ink">{employee.designation || '—'}</span>;
      case 'manager':
        return employee.manager_name ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={employee.manager_name} className="h-6 w-6 text-[11px] tracking-[0.06em]" />
            <span className="truncate text-[13px] leading-[18px] text-ink-secondary">{employee.manager_name}</span>
          </span>
        ) : <span className="text-[13px] text-ink-muted">—</span>;
      case 'organization':
        return <span className="text-[13px] leading-[18px] text-ink-secondary">{employee.organization_name || '—'}</span>;
      case 'role':
        return <span className="text-[13px] leading-[18px] text-ink-secondary">{ROLE_LABELS[employee.role] || employee.role || '—'}</span>;
      case 'status': {
        const s = EMPLOYMENT_STATUS[statusOf(employee)];
        return s
          ? <StatusBadge label={s.label} tone={s.tone} />
          : <StatusBadge status={employee.employment_status} />;
      }
      case 'joined':
        return <span className="whitespace-nowrap text-[13px] leading-[18px] text-ink-secondary">{fmtDate(employee.joining_date)}</span>;
      default:
        return null;
    }
  };

  const runRowAction = (fn) => () => { setActionMenuId(null); fn(); };

  const renderRowActions = (employee) => (
    <Popover
      open={actionMenuId === employee.email}
      onOpenChange={(o) => setActionMenuId(o ? employee.email : null)}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${employee.full_name}`}>
          <Ellipsis className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" role="menu" className="w-60 border-line bg-surface p-1">
        <MenuItem icon={History} onClick={runRowAction(() => setLifecycleUid(employee.id))}>
          Lifecycle &amp; job history
        </MenuItem>
        {isAdmin && (
          <MenuItem icon={Pencil} onClick={runRowAction(() => handleEdit(employee))}>
            Edit employee
          </MenuItem>
        )}
        {isAdmin && employee.employment_status !== 'exited' && (
          <MenuItem icon={KeyRound} onClick={runRowAction(() => setResetTargets([employee]))}>
            Send password reset email
          </MenuItem>
        )}
      </PopoverContent>
    </Popover>
  );

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-24">
          <div className="text-sm text-ink-muted">Loading...</div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Header */}
      <PageHeader
        title={isAdmin ? 'All Employees' : 'Team Members'}
        subtitle={subtitle}
      >
        <Button
          variant="outline"
          disabled={!filteredEmployees.length}
          onClick={() => exportRows(filteredEmployees)}
        >
          <Download className="!size-[18px]" />
          Export
        </Button>
        {isAdmin && (
          <Button
            variant="outline"
            disabled={!filteredEmployees.some(emp => emp.employment_status !== 'exited')}
            onClick={() => setResetTargets(filteredEmployees.filter(emp => emp.employment_status !== 'exited'))}
          >
            <KeyRound className="!size-[18px]" />
            Send Reset Emails
          </Button>
        )}
        {isAdmin && (
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (open) { setSubmitAttempted(false); setShowPassword(false); }
            }}
          >
            <DialogTrigger asChild>
              <Button data-testid="add-employee-btn" variant="dark">
                <Plus className="!size-[18px]" />
                Add employee
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Employee</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} noValidate className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="emp-name">Full Name *</Label>
                  <Input
                    id="emp-name"
                    data-testid="emp-name-input"
                    placeholder="John Doe"
                    value={employeeForm.full_name}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, full_name: e.target.value })}
                    required
                    maxLength={100}
                    aria-invalid={submitAttempted && !!addErrors.full_name}
                    className={`mt-1 ${invalidCls(addErrors, 'full_name')}`}
                  />
                  {fieldError(addErrors, 'full_name')}
                </div>
                <div>
                  <Label htmlFor="emp-email">Email *</Label>
                  <Input
                    id="emp-email"
                    data-testid="emp-email-input"
                    type="email"
                    autoComplete="off"
                    placeholder="john.doe@company.com"
                    value={employeeForm.email}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                    required
                    maxLength={254}
                    aria-invalid={submitAttempted && !!addErrors.email}
                    className={`mt-1 ${invalidCls(addErrors, 'email')}`}
                  />
                  {fieldError(addErrors, 'email')}
                  <p className="text-xs text-ink-muted mt-1">The employee signs in with this email</p>
                </div>
                <div>
                  <Label htmlFor="emp-phone">Phone Number *</Label>
                  <PhoneInput
                    id="emp-phone"
                    data-testid="emp-phone-input"
                    value={employeeForm.phone}
                    onChange={(phone) => setEmployeeForm({ ...employeeForm, phone })}
                    required
                    showError={submitAttempted}
                    className="mt-1"
                  />
                </div>

                {/* Joining Date Field */}
                <div>
                  <Label htmlFor="emp-joining-date">Joining Date *</Label>
                  <div className="relative mt-1">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted w-4 h-4 pointer-events-none" />
                    <Input
                      id="emp-joining-date"
                      data-testid="emp-joining-date-input"
                      type="date"
                      value={employeeForm.joining_date}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, joining_date: e.target.value })}
                      required
                      min="1900-01-01"
                      max="2099-12-31"
                      className={`pl-10 ${invalidCls(addErrors, 'joining_date')}`}
                    />
                  </div>
                  {fieldError(addErrors, 'joining_date')}
                  <p className="text-xs text-ink-muted mt-1">
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
                    <p className="text-xs text-warning-fg mt-1">Go to Organizations to add organizations</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="emp-department">Department *</Label>
                  <Select
                    value={employeeForm.department}
                    onValueChange={(value) => setEmployeeForm({ ...employeeForm, department: value })}
                  >
                    <SelectTrigger data-testid="emp-department-select" className={`mt-1 ${invalidCls(addErrors, 'department')}`}>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map(dept => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldError(addErrors, 'department')}
                  {departments.length === 0 && (
                    <p className="text-xs text-warning-fg mt-1">Go to Settings to add departments</p>
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
                  <p className="text-xs text-ink-muted mt-1">Manager will approve leave requests</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="emp-dob">Date of birth</Label>
                    <Input
                      id="emp-dob"
                      type="date"
                      min="1900-01-01"
                      max={new Date().toISOString().split('T')[0]}
                      value={employeeForm.date_of_birth}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, date_of_birth: e.target.value })}
                      className={`mt-1 ${invalidCls(addErrors, 'date_of_birth')}`}
                    />
                  </div>
                  <div>
                    <Label htmlFor="emp-gender">Gender</Label>
                    <select
                      id="emp-gender"
                      value={employeeForm.gender}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, gender: e.target.value })}
                      className="mt-1 flex h-10 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <option value="">—</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="non_binary">Non-binary</option>
                      <option value="other">Other</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </div>
                </div>
                {fieldError(addErrors, 'date_of_birth')}
                <p className="text-xs text-ink-muted -mt-1">A probation period and an onboarding checklist start automatically.</p>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="emp-password">Temporary Password *</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleGeneratePassword}
                      className="h-7 gap-1 px-2 text-xs"
                      data-testid="emp-generate-password-btn"
                    >
                      <Wand2 className="h-3.5 w-3.5" /> Generate
                    </Button>
                  </div>
                  <div className="relative mt-1">
                    <Input
                      id="emp-password"
                      data-testid="emp-password-input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Employee will use this to login"
                      value={employeeForm.password}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })}
                      required
                      aria-describedby="emp-password-rules"
                      aria-invalid={submitAttempted && !!addErrors.password}
                      className={`pr-20 font-mono ${invalidCls(addErrors, 'password')}`}
                    />
                    <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setShowPassword(v => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleCopyPassword}
                        disabled={!employeeForm.password}
                        aria-label="Copy password"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <PasswordRules id="emp-password-rules" password={employeeForm.password} showErrors={submitAttempted} className="mt-2" />
                  <p className="text-xs text-ink-muted mt-2">Share it with the employee securely. They can change it after first login.</p>
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
                    className="flex-1"
                    disabled={submitting}
                  >
                    {submitting ? 'Adding...' : 'Add Employee'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {/* Edit Employee Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>

          {selectedEmployee && (
            <form onSubmit={handleUpdateEmployee} noValidate className="space-y-4 mt-4">

              {/* Full Name */}
              <div>
                <Label htmlFor="edit-emp-name">Full Name *</Label>
                <Input
                  id="edit-emp-name"
                  value={selectedEmployee.full_name || ''}
                  onChange={(e) =>
                    setSelectedEmployee({ ...selectedEmployee, full_name: e.target.value })
                  }
                  required
                  maxLength={100}
                  aria-invalid={submitAttempted && !!editErrors.full_name}
                  className={`mt-1 ${invalidCls(editErrors, 'full_name')}`}
                />
                {fieldError(editErrors, 'full_name')}
              </div>

              {/* Email (login id) */}
              <div>
                <Label htmlFor="edit-emp-email">Email *</Label>
                <Input
                  id="edit-emp-email"
                  data-testid="edit-emp-email-input"
                  type="email"
                  autoComplete="off"
                  value={selectedEmployee.email || ''}
                  onChange={(e) =>
                    setSelectedEmployee({ ...selectedEmployee, email: e.target.value })
                  }
                  disabled={user?.role !== 'admin'}
                  required
                  maxLength={254}
                  aria-invalid={submitAttempted && !!editErrors.email}
                  className={`mt-1 ${invalidCls(editErrors, 'email')}`}
                />
                {fieldError(editErrors, 'email')}
                {selectedEmployee.email?.trim() !== selectedEmployee.original_email && (
                  <p className="text-xs text-warning-fg mt-1">
                    This is their sign-in email. After saving they must sign in with the new address;
                    their leave, attendance and other records move with it.
                  </p>
                )}
              </div>

              {/* Joining Date */}
              <div>
                <Label>Joining Date *</Label>
                <div className="relative mt-1">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted w-4 h-4 pointer-events-none" />
                  <Input
                    type="date"
                    value={selectedEmployee.joining_date || ''}
                    onChange={(e) =>
                      setSelectedEmployee({ ...selectedEmployee, joining_date: e.target.value })
                    }
                    required
                    min="1900-01-01"
                    max="2099-12-31"
                    className={`pl-10 ${invalidCls(editErrors, 'joining_date')}`}
                  />
                </div>
                {fieldError(editErrors, 'joining_date')}
                <p className="text-xs text-ink-muted mt-1">
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
                    {departmentOptions.map(dept => (
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
                  value={selectedEmployee.designation || ''}
                  onChange={(e) =>
                    setSelectedEmployee({ ...selectedEmployee, designation: e.target.value })
                  }
                  required
                  maxLength={100}
                  className={`mt-1 ${invalidCls(editErrors, 'designation')}`}
                />
                {fieldError(editErrors, 'designation')}
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

                <p className="text-xs text-warning-fg mt-1">
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

                  <p className="text-xs text-ink-muted mt-1">
                    Manager will approve leave requests
                  </p>
                </div>
              )}

              {/* Phone */}
              <div>
                <Label htmlFor="edit-emp-phone">Phone Number *</Label>
                <PhoneInput
                  id="edit-emp-phone"
                  value={selectedEmployee.phone || ''}
                  onChange={(phone) => setSelectedEmployee({ ...selectedEmployee, phone })}
                  required
                  showError={submitAttempted}
                  className="mt-1"
                />
              </div>

              {/* Salary */}
              <div>
                <Label>Monthly Salary (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={selectedEmployee.monthly_salary ?? ''}
                  onChange={(e) =>
                    setSelectedEmployee({
                      ...selectedEmployee,
                      monthly_salary: e.target.value
                        ? Number(e.target.value)
                        : null
                    })
                  }
                  className={`mt-1 ${invalidCls(editErrors, 'monthly_salary')}`}
                />
                {fieldError(editErrors, 'monthly_salary')}
                <p className="text-xs text-ink-muted mt-1">
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
                  className="flex-1"
                  disabled={submitting}
                >
                  {submitting ? 'Updating...' : 'Update Employee'}
                </Button>
              </div>

            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Filters row: status tabs + view toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto">
          <Segmented options={statusTabs} value={statusTab} onChange={withPageReset(setStatusTab)} />
        </div>
        <div className="flex-1" />
        <div role="tablist" aria-label="View" className="inline-flex shrink-0 gap-0.5 rounded-md bg-subtle p-[3px]">
          {[
            { value: 'list', icon: List, label: 'List view' },
            { value: 'grid', icon: LayoutGrid, label: 'Grid view' },
          ].map(({ value, icon, label }) => {
            const ViewIcon = icon;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                aria-label={label}
                title={label}
                onClick={() => { setView(value); setPage(1); }}
                className={cn(
                  'inline-flex h-7 w-8 items-center justify-center rounded-sm transition-colors',
                  view === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
                )}
              >
                <ViewIcon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Employee table card */}
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        {/* Toolbar: search + filter chips + columns */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
            <Input
              placeholder="Search by name, email or employee ID"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              className="h-11 pl-10 shadow-none"
            />
          </div>
          <FilterSelect
            label="Department"
            value={filterDepartment}
            onValueChange={withPageReset(setFilterDepartment)}
            options={departmentOptions.map(dept => ({ value: dept, label: dept }))}
          />
          {organizations.length > 0 && (
            <FilterSelect
              label="Organization"
              value={filterOrganization}
              onValueChange={withPageReset(setFilterOrganization)}
              options={organizations.map(org => ({ value: org.id, label: org.name }))}
            />
          )}
          <FilterSelect
            label="Role"
            value={filterRole}
            onValueChange={withPageReset(setFilterRole)}
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'manager', label: 'Manager' },
              { value: 'employee', label: 'Employee' },
            ]}
          />
          <div className="hidden flex-1 sm:block" />
          {view === 'list' && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <SlidersHorizontal />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 border-line bg-surface p-2">
                <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Show columns</p>
                {TABLE_COLUMNS.map(col => (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-ink-secondary hover:bg-subtle hover:text-ink"
                  >
                    <TableCheckbox
                      checked={isColumnVisible(col.key)}
                      onCheckedChange={(v) => toggleColumn(col.key, v === true)}
                    />
                    {col.label}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Bulk actions */}
        {view === 'list' && selectedEmployees.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-brand-subtle px-5 py-2.5">
            <TableCheckbox checked onCheckedChange={clearSelection} aria-label="Clear selection" />
            <p className="flex-1 text-[13px] font-medium leading-[18px] text-ink">
              {selectedEmployees.length} selected
            </p>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={!selectedEmployees.some(emp => emp.employment_status !== 'exited')}
                onClick={() => setResetTargets(selectedEmployees.filter(emp => emp.employment_status !== 'exited'))}
              >
                <Mail />
                Send reset email
              </Button>
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => exportRows(selectedEmployees)}>
              <Download />
              Export
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={clearSelection}>
              <X />
              Clear
            </Button>
          </div>
        )}

        {filteredEmployees.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <User className="mx-auto mb-4 h-12 w-12 text-line-strong" />
            <p className="mb-1 text-base font-semibold text-ink">
              {employees.length === 0 ? 'No employees found' : 'No employees match your search criteria'}
            </p>
            {employees.length === 0 && isAdmin && (
              <p className="text-sm text-ink-secondary">Click &quot;Add employee&quot; to create your first employee</p>
            )}
            {employees.length > 0 && (
              <p className="text-sm text-ink-secondary">Try adjusting your search or filters</p>
            )}
          </div>
        ) : view === 'list' ? (
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[54px] [&>[role=checkbox]]:translate-y-0 rounded-none border-b border-line bg-canvas py-2.5 pl-5 pr-2 h-auto first:rounded-none">
                  <TableCheckbox
                    checked={headerChecked}
                    onCheckedChange={(v) => togglePage(v === true)}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <TableHead className="h-auto rounded-none border-b border-line bg-canvas px-2 py-2.5">Employee</TableHead>
                {visibleColumns.map(col => (
                  <TableHead key={col.key} className={cn('h-auto rounded-none border-b border-line bg-canvas px-2 py-2.5', col.width)}>
                    {col.label}
                  </TableHead>
                ))}
                <TableHead className="h-auto w-[52px] rounded-none border-b border-line bg-canvas py-2.5 pl-2 pr-5 last:rounded-none">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageEmployees.map((employee) => {
                const selected = selectedIds.has(employee.email);
                return (
                  <TableRow
                    key={employee.email}
                    data-testid={`employee-card-${employee.id}`}
                    data-state={selected ? 'selected' : undefined}
                    className="data-[state=selected]:bg-brand-subtle"
                  >
                    <TableCell className="py-3.5 pl-5 pr-2 [&>[role=checkbox]]:translate-y-0">
                      <TableCheckbox
                        checked={selected}
                        onCheckedChange={(v) => toggleRow(employee.email, v === true)}
                        aria-label={`Select ${employee.full_name}`}
                      />
                    </TableCell>
                    <TableCell className="px-2 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={employee.full_name} src={employee.profile_picture_url} size="lg" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-5 text-ink">{employee.full_name}</p>
                          <p className="truncate text-xs font-medium leading-4 text-ink-muted">{employee.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    {visibleColumns.map(col => (
                      <TableCell key={col.key} className="px-2 py-3.5">
                        {renderCell(col.key, employee)}
                      </TableCell>
                    ))}
                    <TableCell className="py-3.5 pl-2 pr-5 text-right">
                      {renderRowActions(employee)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {pageEmployees.map((employee) => {
              const s = EMPLOYMENT_STATUS[statusOf(employee)];
              return (
                <Card
                  key={employee.email}
                  data-testid={`employee-card-${employee.id}`}
                  className="transition-shadow hover:shadow-sm"
                >
                  <CardContent className="p-5">
                    <div className="mb-4 flex items-start gap-3">
                      <Avatar name={employee.full_name} src={employee.profile_picture_url} size="xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-base font-semibold leading-6 text-ink">{employee.full_name}</p>
                        <p className="text-xs font-medium leading-4 text-ink-muted">{employee.employee_id}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusBadge label={ROLE_LABELS[employee.role] || employee.role} tone="neutral" dot={false} />
                          {s && <StatusBadge label={s.label} tone={s.tone} />}
                        </div>
                      </div>
                      {renderRowActions(employee)}
                    </div>

                    <div className="space-y-2.5 text-[13px] leading-[18px] text-ink-secondary">
                      <div className="flex items-center gap-2.5">
                        <Mail className="h-4 w-4 shrink-0 text-ink-muted" />
                        <span className="truncate">{employee.email}</span>
                      </div>
                      {employee.phone && (
                        <div className="flex items-center gap-2.5">
                          <Phone className="h-4 w-4 shrink-0 text-ink-muted" />
                          <span>{employee.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2.5">
                        <Briefcase className="h-4 w-4 shrink-0 text-ink-muted" />
                        <span className="truncate">{employee.designation} · {employee.department}</span>
                      </div>
                      {employee.organization_name && (
                        <StatusBadge label={employee.organization_name} tone="info" dot={false} />
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-md bg-canvas p-3">
                      {[
                        ['Sick', employee.leave_balance?.sick_leave],
                        ['Casual', employee.leave_balance?.casual_leave],
                        ['Earned', employee.leave_balance?.earned_leave],
                      ].map(([label, val]) => (
                        <div key={label}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{label}</p>
                          <p className="font-display text-sm font-semibold text-ink tabular-nums">{val ?? 0}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted">
                      {employee.manager_name ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={employee.manager_name} className="h-6 w-6 text-[11px]" />
                          <span className="truncate text-ink-secondary">Reports to {employee.manager_name}</span>
                        </span>
                      ) : <span />}
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Joined {fmtDate(employee.joining_date, 'MMM dd, yyyy')}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {filteredEmployees.length > 0 && (
          <DirectoryPagination
            page={currentPage}
            totalPages={totalPages}
            from={pageStart + 1}
            to={pageStart + pageEmployees.length}
            total={filteredEmployees.length}
            onChange={setPage}
          />
        )}
      </div>

      <EmployeeLifecycleDialog
        uid={lifecycleUid}
        open={!!lifecycleUid}
        onOpenChange={(o) => { if (!o) setLifecycleUid(null); }}
        isAdmin={user?.role === 'admin'}
      />

      {/* Admin-triggered password reset */}
      <Dialog open={!!resetTargets} onOpenChange={(o) => { if (!o && !sendingReset) setResetTargets(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Password Reset Email</DialogTitle>
          </DialogHeader>
          {resetTargets && (
            <div className="space-y-4">
              <p className="text-sm text-ink-secondary">
                {resetTargets.length === 1 ? (
                  <>A link to set a new password will be emailed to <strong>{resetTargets[0].full_name}</strong> ({resetTargets[0].email}).</>
                ) : (
                  <>A link to set a new password will be emailed to <strong>{resetTargets.length} employees</strong>.</>
                )}
                {' '}The link is single-use and expires in 24 hours. Their current password keeps working until they set a new one.
              </p>
              {resetTargets.length > 1 && (
                <ul className="text-sm text-ink-secondary max-h-40 overflow-y-auto border border-line rounded-md p-2 space-y-1">
                  {resetTargets.map(emp => (
                    <li key={emp.email} className="truncate">{emp.full_name} <span className="text-ink-muted">· {emp.email}</span></li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setResetTargets(null)} disabled={sendingReset}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSendPasswordReset}
                  disabled={sendingReset}
                >
                  {sendingReset ? 'Sending...' : resetTargets.length === 1 ? 'Send Email' : `Send ${resetTargets.length} Emails`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default EmployeesPage;
