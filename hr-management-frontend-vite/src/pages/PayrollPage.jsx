import React, { useState, useEffect } from 'react';
import { DollarSign, Send, Download, Calendar, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';
import Papa from 'papaparse';

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// Where the summary numbers come from (the month's payroll run, or a preview of one)
const SOURCE_LABELS = {
  preview: 'Preview — no payroll run yet',
  run_draft: 'From the draft payroll run',
  run_locked: 'From the locked payroll run',
  run_paid: 'From the paid payroll run',
};

const PayrollPage = () => {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [monthlySummary, setMonthlySummary] = useState(null);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/employees');
      const list = (Array.isArray(response.data) ? response.data : []).filter(emp => emp.monthly_salary);
      // Unique key per employee: the code when it is unique, else the email (the API resolves either)
      const codeCount = {};
      list.forEach(e => { if (e.employee_id) codeCount[e.employee_id] = (codeCount[e.employee_id] || 0) + 1; });
      setEmployees(list
        .map(e => ({ ...e, id: e.employee_id && codeCount[e.employee_id] === 1 ? e.employee_id : (e.email || e.id || e.employee_id) }))
        .filter(e => e.id));
    } catch (error) {
      toast.error('Failed to load employees');
    }
  };

  const handleSendSalarySlip = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }

    setSending(true);
    try {
      const response = await api.post('/payroll/send-salary-slip', {
        employee_id: selectedEmployee,
        month: selectedMonth
      });

      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send salary slip');
    } finally {
      setSending(false);
    }
  };

  const fetchMonthlySummary = async () => {
    if (!/^\d{4}-\d{2}$/.test(selectedMonth || '')) return;
    setLoading(true);
    try {
      const response = await api.get(`/payroll/monthly-summary/${selectedMonth}`);
      setMonthlySummary(response.data);
    } catch (error) {
      toast.error('Failed to fetch payroll summary');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (!monthlySummary || !monthlySummary.employees.length) {
      toast.error('No data to export');
      return;
    }

    const csvData = monthlySummary.employees.map(emp => ({
      'Employee ID': emp.employee_code || '',
      'Employee Name': emp.employee_name,
      'Department': emp.department,
      'Designation': emp.designation,
      'Monthly Gross': emp.base_salary,
      'Total Days in Month': emp.total_days_in_month,
      'Payable Days': emp.payable_days,
      'Days Without Attendance': emp.unmarked_days ?? '',
      'Leave Days': emp.leave_days,
      'Unpaid (LOP) Days': emp.unpaid_days,
      'LOP Deduction': (emp.unpaid_deduction || 0).toFixed(2),
      'PF': (emp.deductions?.pf || 0).toFixed(2),
      'ESI': (emp.deductions?.esi || 0).toFixed(2),
      'Professional Tax': (emp.deductions?.pt || 0).toFixed(2),
      'LWF': (emp.deductions?.lwf || 0).toFixed(2),
      'TDS': (emp.deductions?.tds || 0).toFixed(2),
      'Loan / Other': ((emp.deductions?.loan || 0) + (emp.deductions?.other || 0)).toFixed(2),
      'Total Deductions': (emp.total_deductions || 0).toFixed(2),
      'Net Salary': (emp.net_salary || 0).toFixed(2)
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `payroll_${selectedMonth}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('Report exported successfully!');
  };

  useEffect(() => {
    fetchMonthlySummary();
  }, [selectedMonth]);

  const periodLabel = /^\d{4}-\d{2}$/.test(selectedMonth || '') ? format(new Date(`${selectedMonth}-01T12:00:00`), 'MMM yyyy') : '—';

  return (
    <div className="min-h-screen bg-canvas p-4 md:p-8">
      <div className="w-full">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Payroll Management
          </h1>
          <p className="text-slate-600">Send salary slips and manage monthly payroll</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Send Salary Slip */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                Send Salary Slip
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="employee-select">Select Employee *</Label>
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map(emp => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.full_name} - {emp.employee_id || 'No code'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="month-select">Month *</Label>
                <Input
                  id="month-select"
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="mt-1"
                />
              </div>

              <Button
                onClick={handleSendSalarySlip}
                disabled={sending || !selectedEmployee}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                <Send className="w-4 h-4 mr-2" />
                {sending ? 'Sending...' : 'Send Salary Slip'}
              </Button>

              <p className="text-xs text-slate-500 mt-2">
                Salary slip will be sent via email with leave details and deductions
              </p>
            </CardContent>
          </Card>

          {/* Monthly Summary Stats */}
          <Card className="lg:col-span-2 border-slate-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Monthly Payroll Summary
                </CardTitle>
                {monthlySummary?.source && (
                  <p className="text-xs text-slate-500 mt-1">{SOURCE_LABELS[monthlySummary.source] || monthlySummary.source} · same calculation as Payroll Runs</p>
                )}
              </div>
              <Button
                onClick={exportToCSV}
                variant="outline"
                size="sm"
                disabled={!monthlySummary || loading}
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-slate-500">Loading...</div>
              ) : monthlySummary ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    <div className="bg-amber-50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-5 h-5 text-amber-600" />
                        <span className="text-sm text-amber-600">Employees</span>
                      </div>
                      <div className="text-2xl font-bold text-amber-900">
                        {monthlySummary.total_employees}
                      </div>
                    </div>

                    <div className="bg-red-50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-5 h-5 text-red-600 rotate-180" />
                        <span className="text-sm text-red-600">Deductions</span>
                      </div>
                      <div className="text-2xl font-bold text-red-900">
                        {inr(monthlySummary.total_deductions)}
                      </div>
                    </div>

                    <div className="bg-emerald-50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                        <span className="text-sm text-emerald-600">Net Payroll</span>
                      </div>
                      <div className="text-2xl font-bold text-emerald-900">
                        {inr(monthlySummary.total_payroll)}
                      </div>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-5 h-5 text-purple-600" />
                        <span className="text-sm text-purple-600">Period</span>
                      </div>
                      <div className="text-lg font-bold text-purple-900">
                        {periodLabel}
                      </div>
                    </div>
                  </div>

                  {(monthlySummary.skipped || []).length > 0 && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {monthlySummary.skipped.length} employee{monthlySummary.skipped.length === 1 ? '' : 's'} not included</p>
                      <p className="text-xs mt-1">{monthlySummary.skipped.slice(0, 6).map(s => `${s.employee_name || s.employee_uid}: ${s.reason}`).join(' · ')}{monthlySummary.skipped.length > 6 ? ' …' : ''}</p>
                    </div>
                  )}

                  {/* Employee List */}
                  <div className="space-y-3 max-h-[32rem] overflow-y-auto">
                    {monthlySummary.employees.map((emp, i) => {
                      const d = emp.deductions || {};
                      const inProgress = emp.period === 'in_progress';
                      return (
                        <div key={`${emp.employee_uid || emp.employee_id}-${i}`} className="border border-slate-200 rounded-lg p-4 bg-white hover:shadow-sm transition-shadow">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <h4 className="font-semibold text-slate-900">{emp.employee_name}</h4>
                              <p className="text-sm text-slate-600">{[emp.employee_code, emp.department, emp.designation].filter(Boolean).join(' • ')}</p>
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-bold text-emerald-600">
                                {inr(emp.net_salary)}
                              </div>
                              <div className="text-xs text-slate-500">{inProgress ? 'Net salary (projected)' : 'Net salary'}</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                            <div>
                              <div className="text-slate-500 text-xs">Gross</div>
                              <div className="font-medium">{inr(emp.base_salary)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-xs">{inProgress ? 'Payable days so far' : 'Payable days'}</div>
                              <div className="font-medium text-amber-600">
                                {inProgress && emp.payable_days_to_date != null
                                  ? `${emp.payable_days_to_date} of ${emp.elapsed_days}`
                                  : `${emp.payable_days} / ${emp.total_days_in_month}`}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-xs">Unpaid (LOP) days</div>
                              <div className="font-medium text-orange-600">{emp.unpaid_days}</div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-xs">No attendance</div>
                              <div className={`font-medium ${emp.unmarked_days ? 'text-red-600' : 'text-slate-700'}`}>
                                {emp.unmarked_days == null ? '—' : `${emp.unmarked_days} day${emp.unmarked_days === 1 ? '' : 's'}`}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 text-xs">Total deductions</div>
                              <div className="font-medium text-red-600">{emp.total_deductions > 0 ? `-${inr(emp.total_deductions)}` : '₹0'}</div>
                            </div>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                            {[['LOP', d.lop], ['PF', d.pf], ['ESI', d.esi], ['PT', d.pt], ['LWF', d.lwf], ['TDS', d.tds], ['Loan', d.loan], ['Other', d.other]]
                              .filter(([, v]) => v > 0)
                              .map(([k, v]) => <span key={k}>{k} {inr(v)}</span>)}
                            {inProgress && <span>Month in progress: attendance counted to yesterday, {emp.total_days_in_month - (emp.elapsed_days || 0)} day(s) to go</span>}
                            {emp.unmarked_days > 0 && (
                              <span className="text-red-600">
                                {emp.unmarked_is_lop ? 'Working days without attendance counted as unpaid (auto-absent is on)' : 'Working days without attendance are paid unless marked absent — review attendance'}
                              </span>
                            )}
                            {emp.salary_source === 'monthly_salary' && <span className="text-amber-700">No salary structure — using monthly salary</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-slate-500">
                  <DollarSign className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                  <p>No payroll data available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PayrollPage;
