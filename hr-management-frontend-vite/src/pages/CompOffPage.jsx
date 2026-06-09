import React, { useState, useEffect } from 'react';
import { Gift, Calendar, Search, Clock, CheckCircle, XCircle, AlertCircle, AlertTriangle, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { format, parseISO, differenceInDays } from 'date-fns';

const CompOffPage = () => {
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [compOffRecords, setCompOffRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedEmployeeRecords, setSelectedEmployeeRecords] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { user } = getAuth();

  const [compOffForm, setCompOffForm] = useState({
    days: '',
    work_date: '',
    reason: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    filterEmployees();
  }, [employees, searchTerm]);

  const fetchData = async () => {
    try {
      // Fetch employees (team members for manager)
      const empResponse = await api.get('/employees');
      let emps = empResponse.data;

      // If manager, filter only their team
      if (user?.role === 'manager') {
        const myProfile = await api.get('/auth/me');
        emps = emps.filter(emp => emp.manager_email === myProfile.data.email);
      }

      setEmployees(emps);

      // Fetch comp-off records for details (work dates, expiry, etc.)
      const compOffResponse = await api.get('/comp-off/records');
      setCompOffRecords(compOffResponse.data || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const filterEmployees = () => {
    if (!searchTerm) {
      setFilteredEmployees(employees);
      return;
    }

    const filtered = employees.filter(emp =>
      emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredEmployees(filtered);
  };

  const handleGrantCompOff = (employee) => {
    setSelectedEmployee(employee);
    setCompOffForm({
      days: '',
      work_date: '',
      reason: '',
    });
    setGrantDialogOpen(true);
  };

  const handleViewDetails = (employee) => {
    setSelectedEmployee(employee);
    const records = getEmployeeRecords(employee.email);
    setSelectedEmployeeRecords(records);
    setDetailsDialogOpen(true);
  };

  const handleSubmitCompOff = async () => {
    if (!compOffForm.days || !compOffForm.work_date || !compOffForm.reason) {
      toast.error('Please fill all fields');
      return;
    }

    const parsedDays = parseFloat(compOffForm.days);
    if (isNaN(parsedDays) || parsedDays <= 0 || parsedDays > 5) {
      toast.error('Days must be between 0.5 and 5');
      return;
    }

    try {
      await api.post('/comp-off/grant', {
        user_id: selectedEmployee.id,
        days: parsedDays,
        work_date: compOffForm.work_date,
        reason: compOffForm.reason,
      });

      toast.success(`Granted ${parsedDays} comp-off day(s) to ${selectedEmployee.full_name}`);
      setGrantDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to grant comp-off');
    }
  };

  // ============================================
  // KEY FIX: Get balance from employee.leave_balance.comp_off
  // ============================================
  const getEmployeeCompOff = (employee) => {
    // Primary source of truth: employee's leave_balance.comp_off
    const available = employee.leave_balance?.comp_off ?? 0;

    // Get records for this employee to calculate total granted and used
    const records = compOffRecords.filter(
      r => r.employee_email === employee.email && r.status === 'approved'
    );

    const total = records.reduce((sum, r) => sum + (r.days || 0), 0);
    const used = total - available; // Used = Total granted - Available balance

    return {
      total,
      used: Math.max(0, used), // Prevent negative used
      available,
      count: records.length
    };
  };

  // Get approved records for work dates display
  const getApprovedRecords = (employeeEmail) => {
    return compOffRecords.filter(
      r => r.employee_email === employeeEmail && r.status === 'approved'
    );
  };

  // Get pending/rejected records
  const getPendingRejectedRecords = (employeeEmail) => {
    return compOffRecords.filter(
      r => r.employee_email === employeeEmail && r.status !== 'approved'
    );
  };

  // Get all records for a specific employee
  const getEmployeeRecords = (employeeEmail) => {
    return compOffRecords.filter(r => r.employee_email === employeeEmail);
  };

  const getDaysUntilExpiry = (expiryDateStr) => {
    if (!expiryDateStr) return null;
    try {
      const expiryDate = parseISO(expiryDateStr);
      const today = new Date();
      return differenceInDays(expiryDate, today);
    } catch {
      return null;
    }
  };

  const getExpiryStatus = (daysLeft) => {
    if (daysLeft === null) return { color: 'slate', text: 'No expiry', badge: 'bg-slate-100 text-slate-600' };
    if (daysLeft <= 0) return { color: 'red', text: 'Expired', badge: 'bg-red-100 text-red-700' };
    if (daysLeft <= 7) return { color: 'red', text: `${daysLeft}d left`, badge: 'bg-red-100 text-red-700' };
    if (daysLeft <= 30) return { color: 'amber', text: `${daysLeft}d left`, badge: 'bg-amber-100 text-amber-700' };
    return { color: 'emerald', text: `${daysLeft}d left`, badge: 'bg-emerald-100 text-emerald-700' };
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'approved':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <CheckCircle className="w-3 h-3 mr-1" />
            Approved
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <XCircle className="w-3 h-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateStr) => {
    try {
      return format(parseISO(dateStr), 'MMM dd, yyyy');
    } catch {
      try {
        return format(new Date(dateStr), 'MMM dd, yyyy');
      } catch {
        return dateStr;
      }
    }
  };

  const formatShortDate = (dateStr) => {
    try {
      return format(parseISO(dateStr), 'MMM dd');
    } catch {
      try {
        return format(new Date(dateStr), 'MMM dd');
      } catch {
        return dateStr;
      }
    }
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
      <div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          Comp-Off Management
        </h1>
        <p className="text-lg text-slate-600">
          Grant compensatory off for employees who work extra hours or holidays
        </p>
      </div>

      {/* <div className="bg-gradient-to-r from-purple-50 to-amber-50 border border-purple-200 rounded-lg p-4"> */}
      {/*   <div className="flex items-start gap-3"> */}
      {/*     <Gift className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" /> */}
      {/*     <div className="flex-1"> */}
      {/*       <p className="font-medium text-purple-900 mb-1">What is Comp-Off?</p> */}
      {/*       <p className="text-sm text-purple-700"> */}
      {/*         Compensatory off is granted to employees who work on holidays, weekends, or put in extra hours beyond normal working time. */}
      {/*         Comp-off must be used within 90 days from the work date. */}
      {/*       </p> */}
      {/*     </div> */}
      {/*   </div> */}
      {/* </div> */}

      {/* Search */}
      <div className="bg-white p-4 rounded-lg border border-slate-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Employees Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredEmployees.map((employee) => {
          const compOff = getEmployeeCompOff(employee);
          const approvedRecords = getApprovedRecords(employee.email);
          const pendingRejectedRecords = getPendingRejectedRecords(employee.email);

          return (
            <Card key={employee.id} className="border-slate-200 hover:shadow-md transition-shadow">
              <CardHeader className="pb-3 bg-gradient-to-r from-purple-50/50 to-amber-50/50">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {employee.profile_picture_url ? (
                      <img
                        src={employee.profile_picture_url}
                        alt={employee.full_name}
                        className="w-12 h-12 rounded-full object-cover border-2 border-purple-200"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 to-slate-800 flex items-center justify-center text-white font-bold">
                        {employee.full_name?.charAt(0) || '?'}
                      </div>
                    )}
                    <div>
                      <CardTitle className="text-lg text-slate-900">{employee.full_name}</CardTitle>
                      <p className="text-sm text-slate-500">{employee.email}</p>
                      <div className="flex gap-1 mt-1">
                        <Badge variant="outline" className="text-xs">{employee.designation}</Badge>
                        <Badge variant="outline" className="text-xs">{employee.department}</Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleGrantCompOff(employee)}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    <Gift className="w-4 h-4 mr-1" />
                    Grant
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {/* Balance Summary - Uses employee.leave_balance.comp_off */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {/* <div className="p-3 bg-amber-50 rounded-lg text-center border border-amber-200"> */}
                  {/*   <p className="text-xs text-amber-600 font-medium uppercase">Total</p> */}
                  {/*   <p className="text-xl font-bold text-amber-700">{compOff.total}</p> */}
                  {/* </div> */}
                  <div className="p-3 bg-amber-50 rounded-lg text-center border border-amber-200">
                    <p className="text-xs text-amber-600 font-medium uppercase">Used</p>
                    <p className="text-xl font-bold text-amber-700">{compOff.used}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg text-center border border-emerald-200">
                    <p className="text-xs text-emerald-600 font-medium uppercase">Available</p>
                    <p className="text-xl font-bold text-emerald-700">{compOff.available}</p>
                  </div>
                </div>

                {/* Work Dates Granted Section */}
                {approvedRecords.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Work Dates Granted
                      </p>
                      {approvedRecords.length > 2 && (
                        <button
                          onClick={() => handleViewDetails(employee)}
                          className="text-xs text-purple-600 hover:text-purple-800 underline"
                        >
                          View All ({approvedRecords.length})
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {approvedRecords.slice(0, 2).map((record) => {
                        const daysLeft = getDaysUntilExpiry(record.expiry_date);
                        const expiryStatus = getExpiryStatus(daysLeft);
                        const isExpired = daysLeft !== null && daysLeft <= 0;

                        return (
                          <div
                            key={record.id}
                            className={`flex items-center justify-between p-2 rounded-lg border ${isExpired
                              ? 'bg-slate-50 border-slate-200 opacity-60'
                              : 'bg-purple-50 border-purple-200'
                              }`}
                          >
                            <div className="flex items-center gap-2">
                              <Calendar className={`w-3.5 h-3.5 ${isExpired ? 'text-slate-400' : 'text-purple-500'}`} />
                              <span className={`text-sm font-medium ${isExpired ? 'text-slate-500' : 'text-purple-800'}`}>
                                {formatShortDate(record.work_date)}
                              </span>
                              <span className={`text-xs ${isExpired ? 'text-slate-400' : 'text-purple-600'}`}>
                                • {record.remaining_days ?? record.days}d
                              </span>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus.badge}`}>
                              {expiryStatus.text}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pending/Rejected Requests */}
                {pendingRejectedRecords.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Pending/Rejected Requests
                    </p>
                    <div className="space-y-2">
                      {pendingRejectedRecords.slice(0, 2).map((record) => (
                        <div
                          key={record.id}
                          className={`p-2 rounded-lg border ${record.status === 'pending'
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-red-50 border-red-200'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-slate-700">
                                {record.days} day(s)
                              </span>
                              {getStatusBadge(record.status)}
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            <Calendar className="w-3 h-3 inline mr-1" />
                            Work Date: {formatDate(record.work_date)}
                          </p>
                          <p className="text-xs text-slate-500">{record.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {approvedRecords.length === 0 && pendingRejectedRecords.length === 0 && (
                  <div className="text-center py-4 text-slate-400">
                    <Gift className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No comp-off records</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredEmployees.length === 0 && (
        <Card className="border-slate-200">
          <CardContent className="py-12 text-center text-slate-500">
            <Gift className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg">No employees found</p>
            <p className="text-sm">Try a different search term</p>
          </CardContent>
        </Card>
      )}

      {/* Grant Comp-Off Dialog */}
      <Dialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-purple-600" />
              Grant Comp-Off
            </DialogTitle>
          </DialogHeader>

          {selectedEmployee && (
            <div className="space-y-4 mt-4">
              {/* Employee Info */}
              <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                {selectedEmployee.profile_picture_url ? (
                  <img
                    src={selectedEmployee.profile_picture_url}
                    alt={selectedEmployee.full_name}
                    className="w-10 h-10 rounded-full object-cover border-2 border-purple-200"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-slate-800 flex items-center justify-center text-white font-bold">
                    {selectedEmployee.full_name?.charAt(0) || '?'}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-purple-900">{selectedEmployee.full_name}</p>
                  <p className="text-sm text-purple-600">{selectedEmployee.email}</p>
                </div>
              </div>

              {/* Work Date */}
              <div>
                <Label>Work Date *</Label>
                <Input
                  type="date"
                  value={compOffForm.work_date}
                  onChange={(e) => setCompOffForm({ ...compOffForm, work_date: e.target.value })}
                  max={format(new Date(), 'yyyy-MM-dd')}
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">The date the employee worked extra</p>
              </div>

              {/* Days */}
              <div>
                <Label>Days *</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="5"
                  placeholder="e.g., 1 or 0.5"
                  value={compOffForm.days}
                  onChange={(e) => setCompOffForm({ ...compOffForm, days: e.target.value })}
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">Use 0.5 for half day</p>
              </div>

              {/* Reason */}
              <div>
                <Label>Reason *</Label>
                <Textarea
                  placeholder="e.g., Worked on Sunday for project delivery"
                  value={compOffForm.reason}
                  onChange={(e) => setCompOffForm({ ...compOffForm, reason: e.target.value })}
                  rows={3}
                  className="mt-1"
                />
              </div>

              {/* Info */}
              {/* <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg"> */}
              {/*   <p className="text-xs text-amber-800"> */}
              {/*     <strong>Note:</strong> Comp-off will expire 90 days from the work date. */}
              {/*     The days will be added to the employee's comp-off balance immediately. */}
              {/*   </p> */}
              {/* </div> */}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setGrantDialogOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitCompOff}
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                >
                  Grant Comp-Off
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View All Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-purple-600" />
              Comp-Off Details
            </DialogTitle>
          </DialogHeader>

          {selectedEmployee && (
            <div className="mt-4">
              {/* Employee Info */}
              <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200 mb-4">
                {selectedEmployee.profile_picture_url ? (
                  <img
                    src={selectedEmployee.profile_picture_url}
                    alt={selectedEmployee.full_name}
                    className="w-12 h-12 rounded-full object-cover border-2 border-purple-200"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 to-slate-800 flex items-center justify-center text-white font-bold text-lg">
                    {selectedEmployee.full_name?.charAt(0) || '?'}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-purple-900">{selectedEmployee.full_name}</p>
                  <p className="text-sm text-purple-600">{selectedEmployee.email}</p>
                  <div className="flex gap-1 mt-1">
                    <Badge variant="outline" className="text-xs">{selectedEmployee.designation}</Badge>
                    <Badge variant="outline" className="text-xs">{selectedEmployee.department}</Badge>
                  </div>
                </div>
              </div>

              {/* Summary */}
              {(() => {
                const compOff = getEmployeeCompOff(selectedEmployee);
                return (
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="p-3 bg-amber-50 rounded-lg text-center border border-amber-200">
                      <p className="text-xs text-amber-600 font-medium">Total Granted</p>
                      <p className="text-xl font-bold text-amber-700">{compOff.total}</p>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-lg text-center border border-amber-200">
                      <p className="text-xs text-amber-600 font-medium">Used</p>
                      <p className="text-xl font-bold text-amber-700">{compOff.used}</p>
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-lg text-center border border-emerald-200">
                      <p className="text-xs text-emerald-600 font-medium">Available</p>
                      <p className="text-xl font-bold text-emerald-700">{compOff.available}</p>
                    </div>
                  </div>
                );
              })()}

              {/* All Records */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700">All Comp-Off Records</p>
                {selectedEmployeeRecords.length > 0 ? (
                  <div className="space-y-2 max-h-[350px] overflow-y-auto">
                    {selectedEmployeeRecords.map((record) => {
                      const daysLeft = getDaysUntilExpiry(record.expiry_date);
                      const expiryStatus = getExpiryStatus(daysLeft);
                      const isExpired = daysLeft !== null && daysLeft <= 0;

                      return (
                        <div
                          key={record.id}
                          className={`p-3 rounded-lg border ${record.status === 'approved'
                            ? isExpired
                              ? 'bg-slate-50 border-slate-200 opacity-70'
                              : 'bg-purple-50 border-purple-200'
                            : record.status === 'pending'
                              ? 'bg-amber-50 border-amber-200'
                              : 'bg-red-50 border-red-200'
                            }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-purple-500" />
                              <span className="font-medium text-slate-800">
                                {formatDate(record.work_date)}
                              </span>
                              {getStatusBadge(record.status)}
                            </div>
                            {record.status === 'approved' && (
                              <div className="text-right">
                                <p className="text-sm font-bold text-purple-700">
                                  {record.remaining_days ?? record.days}/{record.days}d
                                </p>
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 mb-2">{record.reason}</p>
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            {record.expiry_date && record.status === 'approved' && (
                              <span className={`px-2 py-0.5 rounded ${expiryStatus.badge}`}>
                                {isExpired ? (
                                  <span className="flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Expired
                                  </span>
                                ) : (
                                  `Expires: ${formatDate(record.expiry_date)} (${expiryStatus.text})`
                                )}
                              </span>
                            )}
                            {record.granted_by && (
                              <span>Granted by: {record.granted_by}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400">
                    <Gift className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>No comp-off records found</p>
                  </div>
                )}
              </div>

              {/* Close Button */}
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={() => setDetailsDialogOpen(false)}
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CompOffPage;
