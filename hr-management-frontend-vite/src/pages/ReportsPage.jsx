import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Download, Calendar, Filter, BarChart3, Users, CalendarCheck, IndianRupee, FileSpreadsheet, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import { format } from 'date-fns';
import { employeeLabel } from '@/lib/employeeLabel';

const STATUS_STYLES = {
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  pending: 'bg-orange-100 text-orange-700',
  manager_approved: 'bg-blue-100 text-blue-700',
};
const STATUS_LABELS = { approved: 'Approved', rejected: 'Rejected', pending: 'Pending', manager_approved: 'Manager approved', cancelled: 'Cancelled' };

const LEAVE_COLUMNS = [
  { key: 'employee_name', label: 'Employee Name' },
  { key: 'employee_code', label: 'Employee ID' },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'leave_type', label: 'Leave Type' },
  { key: 'start_date', label: 'Start Date' },
  { key: 'end_date', label: 'End Date' },
  { key: 'days_count', label: 'Days Count' },
  { key: 'reason', label: 'Reason' },
  { label: 'Status', value: (r) => STATUS_LABELS[r.status] || r.status },
  { key: 'applied_on', label: 'Applied Date' },
];

const fmtDay = (d) => (d ? format(new Date(`${d}T00:00:00`), 'dd MMM') : '—');

const ANALYTICS_LINKS = [
  { to: '/analytics/people', title: 'People analytics', text: 'Headcount, joiners & leavers, attrition, splits', icon: Users, roles: ['admin', 'manager'] },
  { to: '/analytics/attendance', title: 'Attendance & leave', text: 'Attendance %, late marks, absenteeism, leave usage', icon: CalendarCheck, roles: ['admin', 'manager'] },
  { to: '/analytics/payroll-cost', title: 'Payroll cost', text: 'Monthly cost, cost per head, by department', icon: IndianRupee, roles: ['admin'] },
  { to: '/analytics/reports', title: 'Custom reports', text: 'Build, save and schedule reports by email', icon: FileSpreadsheet, roles: ['admin', 'manager'] },
];

const ReportsPage = () => {
  const { user } = getAuth();
  const role = user?.role;
  const [employees, setEmployees] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [report, setReport] = useState({ rows: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    month: format(new Date(), 'yyyy-MM'),
    employee_email: 'all',
    department: 'all',
    organization_id: 'all',
    leave_status: 'all',
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/employees'), api.get('/organizations').catch(() => ({ data: [] })), api.get('/v2/analytics/filters').catch(() => null)])
      .then(([empRes, orgRes, filterRes]) => {
        if (cancelled) return;
        setEmployees(empRes.data || []);
        setOrganizations(orgRes.data || []);
        setDepartments(filterRes?.data?.departments || [...new Set((empRes.data || []).map(e => e.department).filter(Boolean))].sort());
      })
      .catch(() => toast.error('Failed to load filter options'));
    return () => { cancelled = true; };
  }, []);

  const params = {
    month: filters.month,
    ...(filters.employee_email !== 'all' ? { employee_email: filters.employee_email } : {}),
    ...(filters.department !== 'all' ? { department: filters.department } : {}),
    ...(filters.organization_id !== 'all' ? { organization_id: filters.organization_id } : {}),
    ...(filters.leave_status !== 'all' ? { status: filters.leave_status } : {}),
  };
  const paramKey = JSON.stringify(params);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/v2/analytics/leave-report', { params: JSON.parse(paramKey) });
      setReport(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load the leave report');
    } finally {
      setLoading(false);
    }
  }, [paramKey]);

  useEffect(() => { if (filters.month) fetchReport(); }, [fetchReport, filters.month]);

  const exportToCSV = () => {
    if (!report.rows.length) return toast.error('No data to export');
    exportCsv(`leave_report_${filters.month}.csv`, report.rows, LEAVE_COLUMNS);
    toast.success('Report exported');
  };

  const rows = report.rows;
  const s = report.summary;

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="w-full space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
            <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              Reports
            </h1>
            <p className="text-xs sm:text-sm text-slate-600">Analytics dashboards, custom reports and the monthly leave report</p>
          </div>
        </div>

        {/* Analytics hub links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          {ANALYTICS_LINKS.filter(l => l.roles.includes(role)).map((l) => {
            const Icon = l.icon;
            return (
              <Link key={l.to} to={l.to} className="group rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
                <div className="flex items-center justify-between">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center"><Icon className="w-4 h-4" /></div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors" />
                </div>
                <p className="mt-2 font-medium text-slate-900 text-sm">{l.title}</p>
                <p className="text-xs text-slate-500">{l.text}</p>
              </Link>
            );
          })}
        </div>

        <h2 className="text-base sm:text-lg font-semibold text-slate-900 flex items-center gap-2 pt-1">
          <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Leave report
          {role === 'manager' && <span className="text-xs font-normal text-slate-500">(your team)</span>}
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Filters Card */}
          <Card className="lg:col-span-1 border-slate-100 shadow-sm h-fit">
            <CardHeader className="p-3 sm:p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="w-4 h-4" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-3 sm:p-5 pt-0 sm:pt-0">
              <div>
                <Label htmlFor="month-select">Month *</Label>
                <Input
                  id="month-select"
                  type="month"
                  value={filters.month}
                  onChange={(e) => e.target.value && setFilters({ ...filters, month: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Employee</Label>
                <Select value={filters.employee_email} onValueChange={(value) => setFilters({ ...filters, employee_email: value })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="All Employees" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    {employees.filter(emp => emp.email).map(emp => (
                      <SelectItem key={emp.email} value={emp.email}>
                        {employeeLabel(emp.full_name, emp.employee_id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Department</Label>
                <Select value={filters.department} onValueChange={(value) => setFilters({ ...filters, department: value })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="All Departments" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(dept => <SelectItem key={dept} value={dept}>{dept}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {role === 'admin' && (
                <div>
                  <Label>Organization</Label>
                  <Select value={filters.organization_id} onValueChange={(value) => setFilters({ ...filters, organization_id: value })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="All Organizations" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Organizations</SelectItem>
                      {organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label>Leave Status</Label>
                <Select value={filters.leave_status} onValueChange={(value) => setFilters({ ...filters, leave_status: value })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="All Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="manager_approved">Manager Approved</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={exportToCSV} disabled={loading || !rows.length} className="w-full">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </CardContent>
          </Card>

          {/* Preview Card */}
          <Card className="lg:col-span-2 border-slate-100 shadow-sm">
            <CardHeader className="p-3 sm:p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="w-4 h-4" />
                Report Preview
              </CardTitle>
            </CardHeader>
            <CardContent className={`p-3 sm:p-5 pt-0 sm:pt-0 transition-opacity ${loading ? 'opacity-50' : ''}`}>
              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                  <button type="button" className="ml-auto underline" onClick={fetchReport}>Retry</button>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-6">
                <div className="bg-slate-50 p-3 sm:p-4 rounded-lg">
                  <div className="text-xl sm:text-2xl font-bold text-slate-900">{s?.total ?? 0}</div>
                  <div className="text-xs sm:text-sm text-slate-600">Total Leaves</div>
                </div>
                <div className="bg-green-50 p-3 sm:p-4 rounded-lg">
                  <div className="text-xl sm:text-2xl font-bold text-green-700">{s?.approved ?? 0}</div>
                  <div className="text-xs sm:text-sm text-green-600">Approved ({s?.days ?? 0} days)</div>
                </div>
                <div className="bg-orange-50 p-3 sm:p-4 rounded-lg">
                  <div className="text-xl sm:text-2xl font-bold text-orange-700">{s?.pending ?? 0}</div>
                  <div className="text-xs sm:text-sm text-orange-600">Pending</div>
                </div>
                <div className="bg-red-50 p-3 sm:p-4 rounded-lg">
                  <div className="text-xl sm:text-2xl font-bold text-red-700">{s?.rejected ?? 0}</div>
                  <div className="text-xs sm:text-sm text-red-600">Rejected</div>
                </div>
              </div>

              <div className="space-y-3 max-h-[32rem] overflow-y-auto">
                {loading && !rows.length ? (
                  <div className="text-center py-12 text-slate-500 text-sm">Loading…</div>
                ) : rows.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                    <p>No leaves found for the selected filters</p>
                  </div>
                ) : (
                  rows.map(leave => (
                    <div key={leave.id} className="border border-slate-200 rounded-lg p-3 sm:p-4 bg-white">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <div className="min-w-0">
                          <h4 className="font-semibold text-slate-900 truncate">{leave.employee_name}</h4>
                          <p className="text-xs sm:text-sm text-slate-600">{leave.department} · {leave.employee_code}</p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium shrink-0 ${STATUS_STYLES[leave.status] || 'bg-slate-100 text-slate-700'}`}>
                          {STATUS_LABELS[leave.status] || leave.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs sm:text-sm text-slate-600">
                        <span>{leave.leave_type}</span>
                        <span>•</span>
                        <span>{fmtDay(leave.start_date)}{leave.end_date !== leave.start_date ? ` – ${fmtDay(leave.end_date)}` : ''}</span>
                        <span>•</span>
                        <span>{leave.days_count} day{leave.days_count === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
