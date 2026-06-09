import React, { useState, useEffect } from 'react';
import { DollarSign, Send, Download, Calendar, Users, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';
import Papa from 'papaparse';

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
      setEmployees(response.data.filter(emp => emp.monthly_salary));
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
      'Employee ID': emp.employee_id,
      'Employee Name': emp.employee_name,
      'Department': emp.department,
      'Designation': emp.designation,
      'Base Salary': emp.base_salary,
      'Total Days in Month': emp.total_days_in_month,
      'Payable Days': emp.payable_days,
      'Leave Days': emp.leave_days,
      'Unpaid Days': emp.unpaid_days,
      'Unpaid Deduction': emp.unpaid_deduction.toFixed(2),
      'Net Salary': emp.net_salary.toFixed(2)
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
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
                        {emp.full_name} - {emp.employee_id}
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
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Monthly Payroll Summary
              </CardTitle>
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
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-amber-50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-5 h-5 text-amber-600" />
                        <span className="text-sm text-amber-600">Employees</span>
                      </div>
                      <div className="text-2xl font-bold text-amber-900">
                        {monthlySummary.total_employees}
                      </div>
                    </div>
                    
                    <div className="bg-emerald-50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                        <span className="text-sm text-emerald-600">Total Payroll</span>
                      </div>
                      <div className="text-2xl font-bold text-emerald-900">
                        ₹{monthlySummary.total_payroll.toLocaleString()}
                      </div>
                    </div>
                    
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-5 h-5 text-purple-600" />
                        <span className="text-sm text-purple-600">Period</span>
                      </div>
                      <div className="text-lg font-bold text-purple-900">
                        {format(new Date(selectedMonth), 'MMM yyyy')}
                      </div>
                    </div>
                  </div>

                  {/* Employee List */}
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {monthlySummary.employees.map(emp => (
                      <div key={emp.employee_id} className="border border-slate-200 rounded-lg p-4 bg-white hover:shadow-sm transition-shadow">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-semibold text-slate-900">{emp.employee_name}</h4>
                            <p className="text-sm text-slate-600">{emp.department} • {emp.designation}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-emerald-600">
                              ₹{emp.net_salary.toLocaleString()}
                            </div>
                            <div className="text-xs text-slate-500">Net Salary</div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-slate-500 text-xs">Base</div>
                            <div className="font-medium">₹{emp.base_salary.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">Payable Days</div>
                            <div className="font-medium text-amber-600">{emp.payable_days}</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">Unpaid Days</div>
                            <div className="font-medium text-orange-600">{emp.unpaid_days}</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">Deduction</div>
                            <div className="font-medium text-red-600">
                              {emp.unpaid_deduction > 0 ? `-₹${emp.unpaid_deduction.toFixed(0)}` : '₹0'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
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
