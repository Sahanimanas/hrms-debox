import React, { useState, useEffect } from 'react';
import { Plus, Minus, Gift, Search, Users, Calendar, ChevronLeft, ChevronRight, LayoutGrid, Clock, FileText, PartyPopper, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';

const LeaveBalancePage = () => {
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveTypesError, setLeaveTypesError] = useState(null);

  // Calendar states
  const [viewMode, setViewMode] = useState('cards');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarEmployee, setCalendarEmployee] = useState('all');
  const [calendarLeaves, setCalendarLeaves] = useState([]);
  const [calendarHolidays, setCalendarHolidays] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [leaveDetailsOpen, setLeaveDetailsOpen] = useState(false);
  const [selectedHoliday, setSelectedHoliday] = useState(null);
  const [holidayDetailsOpen, setHolidayDetailsOpen] = useState(false);

  const [adjustForm, setAdjustForm] = useState({
    leave_type: '',
    adjustment_type: 'add',
    days: '',
    reason: '',
  });

  // Leave color legend
  const leaveColors = {
    sick_leave: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
    casual_leave: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
    paid_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
    earned_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
    unpaid_leave: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
    comp_off: { bg: '#e9d5ff', border: '#a855f7', text: '#6b21a8' },
    comp_off_leave: { bg: '#e9d5ff', border: '#a855f7', text: '#6b21a8' }
  };

  // Holiday color legend
  const holidayColors = {
    public: { bg: '#fef2f2', border: '#dc2626', text: '#991b1b' },
    optional: { bg: '#fffbeb', border: '#d97706', text: '#92400e' },
    restricted: { bg: '#eff6ff', border: '#2563eb', text: '#1e40af' }
  };

  useEffect(() => {
    fetchEmployees();
    loadLeaveTypes();
  }, []);

  useEffect(() => {
    filterEmployees();
  }, [employees, searchTerm]);

  useEffect(() => {
    if (viewMode === 'calendar') {
      fetchCalendarLeaves();
      fetchCalendarHolidays();
    }
  }, [viewMode, currentDate, calendarEmployee]);

  const loadLeaveTypes = async () => {
    try {
      setLeaveTypesError(null);
      const response = await api.get('/leaves/leave-policy');
      const policy = response.data;

      if (policy && policy.policies && policy.policies.length > 0) {
        const types = policy.policies.map(p => ({
          name: p.leave_type,
          quota: p.annual_quota,
          order: p.order || 0
        }));

        types.sort((a, b) => a.order - b.order);
        setLeaveTypes(types);
      } else {
        setLeaveTypes([]);
        setLeaveTypesError('No leave policy configured');
      }
    } catch (error) {
      console.error('Failed to load leave types:', error);
      setLeaveTypes([]);
      setLeaveTypesError('Unable to fetch leave policy');
    }
  };

  const fetchEmployees = async () => {
    try {
      setError(null);
      const response = await api.get('/employees');
      setEmployees(response.data);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      setError('Unable to fetch employees');
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  // Helper to normalize date to YYYY-MM-DD string
  const normalizeToDateString = (dateValue) => {
    if (!dateValue) return '';
    if (typeof dateValue === 'string') {
      return dateValue.split('T')[0];
    }
    if (dateValue instanceof Date) {
      return format(dateValue, 'yyyy-MM-dd');
    }
    return '';
  };

  // Helper to get normalized dates array from leave
  const getNormalizedDates = (leave) => {
    if (!leave.dates || !Array.isArray(leave.dates)) return [];
    return leave.dates.map(d => normalizeToDateString(d));
  };

  const fetchCalendarLeaves = async () => {
    setCalendarLoading(true);
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;

      let allLeaves = [];

      if (calendarEmployee === 'all') {
        const response = await api.get('/leaves/all');
        allLeaves = response.data || [];
      } else {
        const response = await api.get(`/leaves/calendar/${calendarEmployee}?year=${year}&month=${month}`);
        const events = response.data.events || [];

        allLeaves = events.map(event => ({
          ...event,
          dates: event.date ? [event.date] : [],
          employee_name: response.data.employee?.name || '',
          days_count: event.total_days_in_application || 1
        }));
      }

      const processedLeaves = allLeaves.map(leave => {
        const leaveType = leave.leave_type || '';
        const leaveTypeKey = leave.leave_type_key || leaveType.toLowerCase().replace(/ /g, '_');
        const normalizedDates = getNormalizedDates(leave);

        return {
          ...leave,
          id: leave.id,
          leave_type: leaveType,
          leave_type_key: leaveTypeKey,
          dates: normalizedDates,
          colors: leave.colors || leaveColors[leaveTypeKey] || { bg: '#f1f5f9', border: '#64748b', text: '#334155' },
          employee_name: leave.employee_name,
          status: leave.status || 'pending',
          days_count: leave.days_count || normalizedDates.length || 1,
          reason: leave.reason || '',
          is_half_day: leave.is_half_day || false,
          half_day_period: leave.half_day_period || ''
        };
      });

      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const filtered = processedLeaves.filter(leave => {
        if (!leave.dates || leave.dates.length === 0) return false;
        return leave.dates.some(dateStr => dateStr >= monthStart && dateStr <= monthEnd);
      });

      setCalendarLeaves(filtered);
    } catch (error) {
      console.error('Failed to fetch calendar leaves:', error);
      toast.error('Failed to load calendar data');
    } finally {
      setCalendarLoading(false);
    }
  };

  const fetchCalendarHolidays = async () => {
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const response = await api.get(`/holidays?year=${year}&month=${month}`);
      setCalendarHolidays(response.data || []);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    }
  };

  const filterEmployees = () => {
    if (!searchTerm) {
      setFilteredEmployees(employees);
      return;
    }

    const filtered = employees.filter(emp =>
      (emp.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.department || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredEmployees(filtered);
  };

  const handleAdjustBalance = (employee) => {
    setSelectedEmployee(employee);
    setAdjustForm({
      leave_type: '',
      adjustment_type: 'add',
      days: '',
      reason: '',
    });
    setAdjustDialogOpen(true);
  };

  const handleSubmitAdjustment = async () => {
    if (!adjustForm.leave_type || !adjustForm.days || !adjustForm.reason) {
      toast.error('Please fill all fields');
      return;
    }

    try {
      const days = parseFloat(adjustForm.days);

      await api.put(`/employees/${selectedEmployee.id}/leave-balance`, {
        leave_type: adjustForm.leave_type,
        adjustment_type: adjustForm.adjustment_type,
        days: days,
        reason: adjustForm.reason
      });

      toast.success(
        `${adjustForm.adjustment_type === 'add' ? 'Added' : 'Deducted'} ${days} ${adjustForm.leave_type} ${days > 1 ? 'days' : 'day'}`
      );

      setAdjustDialogOpen(false);
      fetchEmployees();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to adjust leave balance');
    }
  };

  const getTotalLeaves = (leaveBalance = {}) => {
    if (!leaveBalance || typeof leaveBalance !== 'object') return 0;
    return Object.values(leaveBalance).reduce((sum, val) => sum + (Number(val) || 0), 0);
  };

  // Format leave type key to display name
  const formatLeaveTypeName = (key) => {
    return key
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Check if leave type is comp-off
  const isCompOffType = (key) => {
    return key.toLowerCase().includes('comp');
  };

  // Calendar functions
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    return { daysInMonth, startingDay, year, month };
  };

  const formatLocalDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getLeavesForDate = (date) => {
    const dateStr = formatLocalDate(date);

    return calendarLeaves.filter(leave => {
      if (!leave.dates || !Array.isArray(leave.dates)) return false;
      return leave.dates.includes(dateStr);
    });
  };

  const getHolidayForDate = (date) => {
    const dateStr = formatLocalDate(date);
    return calendarHolidays.find(h => {
      const holidayDate = h.date ? normalizeToDateString(h.date) : '';
      return holidayDate === dateStr;
    });
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
      manager_approved: { label: 'Manager Approved', className: 'bg-amber-100 text-amber-800 border-amber-300' },
      approved: { label: 'Approved', className: 'bg-green-100 text-green-800 border-green-300' },
      rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800 border-red-300' }
    };
    const config = statusConfig[status] || statusConfig.pending;
    return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
  };

  const formatLeaveDates = (dates) => {
    if (!dates || dates.length === 0) return 'No dates';

    const sortedDates = dates
      .map(d => new Date(d))
      .sort((a, b) => a - b);

    if (sortedDates.length === 1) {
      return format(sortedDates[0], 'MMM dd, yyyy');
    }

    if (sortedDates.length === 2) {
      return `${format(sortedDates[0], 'MMM dd')} & ${format(sortedDates[1], 'MMM dd, yyyy')}`;
    }

    return `${format(sortedDates[0], 'MMM dd')} - ${format(sortedDates[sortedDates.length - 1], 'MMM dd, yyyy')}`;
  };

  const getHolidayTypeColor = (type) => {
    return holidayColors[type] || holidayColors.public;
  };

  const renderCalendar = () => {
    const { daysInMonth, startingDay, year, month } = getDaysInMonth(currentDate);
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < startingDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="h-24 md:h-28 bg-slate-50 border border-slate-100"></div>
      );
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateLeaves = getLeavesForDate(date);
      const holiday = getHolidayForDate(date);
      const isToday = date.getTime() === today.getTime();
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const holidayTypeColor = holiday ? getHolidayTypeColor(holiday.type) : null;

      days.push(
        <div
          key={day}
          className={`h-24 md:h-28 border border-slate-100 p-1 overflow-hidden transition-all hover:bg-slate-50
            ${isToday ? 'ring-2 ring-amber-400 ring-inset' : ''}
            ${holiday ? 'bg-gradient-to-br from-red-50 to-orange-50' : isWeekend ? 'bg-slate-50' : 'bg-white'}
          `}
        >
          <div className="flex items-center justify-between">
            <div className={`text-sm font-medium ${isToday ? 'text-amber-600' : holiday ? 'text-red-600' : isWeekend ? 'text-slate-400' : 'text-slate-700'}`}>
              {day}
            </div>
            {holiday && (
              <PartyPopper className="w-3 h-3 text-red-500" />
            )}
          </div>

          {holiday && (
            <div
              onClick={() => {
                setSelectedHoliday(holiday);
                setHolidayDetailsOpen(true);
              }}
              className="text-xs px-1 py-0.5 rounded cursor-pointer truncate transition-all hover:scale-105 mb-0.5 border"
              style={{
                backgroundColor: holidayTypeColor.bg,
                borderColor: holidayTypeColor.border,
                color: holidayTypeColor.text
              }}
              title={holiday.name}
            >
              🎉 {holiday.name}
            </div>
          )}

          <div className="space-y-0.5 overflow-y-auto max-h-12 md:max-h-14">
            {dateLeaves.slice(0, holiday ? 2 : 3).map((leave, idx) => (
              <div
                key={`${leave.id}-${idx}`}
                onClick={() => {
                  setSelectedLeave(leave);
                  setLeaveDetailsOpen(true);
                }}
                className={`text-xs px-1 py-0.5 rounded cursor-pointer truncate transition-all hover:scale-105
                  ${leave.status === 'rejected' ? 'line-through opacity-50' : ''}
                  ${leave.status === 'pending' ? 'border border-dashed' : ''}
                `}
                style={{
                  backgroundColor: leave.colors?.bg || '#f1f5f9',
                  borderColor: leave.colors?.border || '#64748b',
                  color: leave.colors?.text || '#334155',
                  opacity: leave.status === 'pending' ? 0.7 : 1
                }}
                title={`${leave.employee_name || ''} - ${leave.leave_type || ''}`}
              >
                {calendarEmployee === 'all' && leave.employee_name && (
                  <span className="font-medium">{leave.employee_name.split(' ')[0]}: </span>
                )}
                {leave.is_half_day ? '½ ' : ''}{(leave.leave_type || '').replace(' Leave', '')}
              </div>
            ))}
            {dateLeaves.length > (holiday ? 2 : 3) && (
              <div className="text-xs text-slate-500 pl-1">+{dateLeaves.length - (holiday ? 2 : 3)} more</div>
            )}
          </div>
        </div>
      );
    }

    return days;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
          <p className="text-lg text-red-600 mb-2">{error}</p>
          <Button onClick={fetchEmployees} variant="outline">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Leave Balance Management
          </h1>
          <p className="text-lg text-slate-600">View and manage employee leave balances</p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
          <Button
            variant={viewMode === 'cards' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('cards')}
            className={`gap-2 ${viewMode === 'cards' ? 'bg-white text-black hover:text-white shadow-sm' : ''}`}
          >
            <LayoutGrid className="w-4 h-4" />
            Cards
          </Button>
          <Button
            variant={viewMode === 'calendar' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('calendar')}
            className={`gap-2 ${viewMode === 'calendar' ? 'bg-white text-black hover:text-white shadow-sm' : ''}`}
          >
            <Calendar className="w-4 h-4" />
            Calendar
          </Button>
        </div>
      </div>

      {/* Search (Cards View) */}
      {viewMode === 'cards' && (
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Search by name, email, or department..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div className="space-y-4">
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50 py-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <Button variant="outline" size="icon" onClick={goToPreviousMonth}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <h2 className="text-xl font-semibold text-slate-900 min-w-48 text-center">
                    {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                  </h2>
                  <Button variant="outline" size="icon" onClick={goToNextMonth}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={goToToday} size="sm" className="gap-2">
                    <Calendar className="w-4 h-4" />
                    Today
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-slate-500" />
                  <Select value={calendarEmployee} onValueChange={setCalendarEmployee}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Select Employee" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Employees</SelectItem>
                      {employees.map(emp => (
                        <SelectItem key={emp.employee_id} value={emp.employee_id}>
                          {emp.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {calendarLoading ? (
                <div className="flex items-center justify-center h-96">
                  <div className="text-slate-500">Loading calendar...</div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-7 border-b border-slate-200">
                    {dayNames.map(day => (
                      <div
                        key={day}
                        className={`p-2 text-center text-sm font-semibold 
                          ${day === 'Sun' || day === 'Sat' ? 'text-slate-400 bg-slate-50' : 'text-slate-700 bg-white'}`}
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {renderCalendar()}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <Card className="border-slate-100 shadow-sm">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-sm font-medium text-slate-600">Leaves:</span>
                {Object.entries(leaveColors).map(([type, colors]) => (
                  <div key={type} className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded border-2"
                      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                    />
                    <span className="text-sm text-slate-600 capitalize">
                      {type.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
                <div className="border-l border-slate-200 pl-4 flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border-2 border-dashed border-slate-400 bg-slate-100" />
                    <span className="text-sm text-slate-600">Pending</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border-2 border-slate-400 bg-slate-100 line-through" />
                    <span className="text-sm text-slate-600">Rejected</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-slate-200">
                <span className="text-sm font-medium text-slate-600">Holidays:</span>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded border-2 bg-red-50 border-red-500" />
                  <span className="text-sm text-slate-600">Public</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded border-2 bg-amber-50 border-amber-500" />
                  <span className="text-sm text-slate-600">Optional</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded border-2 bg-amber-50 border-amber-500" />
                  <span className="text-sm text-slate-600">Restricted</span>
                </div>
                <div className="flex items-center gap-2">
                  <PartyPopper className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-slate-600">Holiday Indicator</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cards View */}
      {viewMode === 'cards' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredEmployees.map((employee) => {
              const leaveBalance = employee.leave_balance || {};
              const leaveEntries = Object.entries(leaveBalance);

              return (
                <Card key={employee.id} className="border-slate-100 shadow-sm">
                  <CardHeader className="bg-slate-50 border-b border-slate-100">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden">
                          {employee.profile_picture_url ? (
                            <img
                              src={employee.profile_picture_url}
                              alt={employee.full_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Users className="w-6 h-6 text-slate-600" />
                          )}
                        </div>
                        <div>
                          <CardTitle className="text-lg font-semibold text-slate-900">
                            {employee.full_name}
                          </CardTitle>
                          <p className="text-sm text-slate-500">{employee.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {employee.department}
                            </Badge>
                            <Badge variant="outline" className="text-xs capitalize">
                              {employee.role}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCalendarEmployee(employee.employee_id);
                            setViewMode('calendar');
                          }}
                          className="rounded-full"
                        >
                          <Calendar className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleAdjustBalance(employee)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full"
                        >
                          <Gift className="w-4 h-4 mr-1" />
                          Adjust
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    {leaveEntries.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">
                        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p>No leave balance available</p>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          {leaveEntries.map(([key, value]) => {
                            const balance = Number(value) || 0;
                            const isLow = balance < 3 && balance > 0;
                            const isEmpty = balance === 0;
                            const displayName = formatLeaveTypeName(key);
                            const isCompOff = isCompOffType(key);
                            const colorKey = key.toLowerCase().replace(/-/g, '_');

                            if (isCompOff) {
                              return (
                                <div
                                  key={key}
                                  className="p-4 rounded-lg border-2 bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-300 transition-all"
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <Gift className="w-4 h-4 text-emerald-600" />
                                    <p className="text-xs font-medium text-emerald-700 uppercase tracking-wider">
                                      {displayName}
                                    </p>
                                  </div>
                                  <p className="text-2xl font-bold text-emerald-700">{balance}</p>
                                  <p className="text-xs text-emerald-600 mt-1">Extra earned days</p>
                                </div>
                              );
                            }

                            return (
                              <div
                                key={key}
                                className={`p-4 rounded-lg border-2 transition-all ${isEmpty
                                    ? 'bg-red-50 border-red-200'
                                    : isLow
                                      ? 'bg-amber-50 border-amber-200'
                                      : 'bg-slate-50 border-slate-200'
                                  }`}
                              >
                                <p className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-1">
                                  {displayName}
                                </p>
                                <p
                                  className={`text-2xl font-bold ${isEmpty
                                      ? 'text-red-700'
                                      : isLow
                                        ? 'text-amber-700'
                                        : 'text-slate-900'
                                    }`}
                                >
                                  {balance}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">days available</p>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-200">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-600">Total Balance:</span>
                            <span className="text-xl font-bold text-slate-900">
                              {getTotalLeaves(employee.leave_balance)} days
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filteredEmployees.length === 0 && (
            <Card className="border-slate-100 shadow-sm">
              <CardContent className="py-12">
                <div className="text-center text-slate-500">
                  <Users className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                  <p className="text-lg mb-2">No employees found</p>
                  <p className="text-sm">Try adjusting your search</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Adjust Balance Dialog */}
      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Leave Balance</DialogTitle>
          </DialogHeader>
          {selectedEmployee && (
            <div className="space-y-4 mt-4">
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="font-semibold text-slate-900">{selectedEmployee.full_name}</p>
                <p className="text-sm text-slate-600">{selectedEmployee.email}</p>
              </div>

              <div>
                <Label>Adjustment Type</Label>
                <Select
                  value={adjustForm.adjustment_type}
                  onValueChange={(value) => setAdjustForm({ ...adjustForm, adjustment_type: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">
                      <div className="flex items-center gap-2">
                        <Plus className="w-4 h-4 text-green-600" />
                        Add Leaves
                      </div>
                    </SelectItem>
                    <SelectItem value="deduct">
                      <div className="flex items-center gap-2">
                        <Minus className="w-4 h-4 text-red-600" />
                        Deduct Leaves
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Leave Type</Label>
                {leaveTypesError ? (
                  <div className="mt-1 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                    {leaveTypesError}
                  </div>
                ) : leaveTypes.length === 0 ? (
                  <div className="mt-1 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500">
                    No leave types available
                  </div>
                ) : (
                  <Select
                    value={adjustForm.leave_type}
                    onValueChange={(value) => setAdjustForm({ ...adjustForm, leave_type: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select leave type" />
                    </SelectTrigger>
                    <SelectContent>
                      {leaveTypes.map((type) => (
                        <SelectItem key={type.name} value={type.name}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div>
                <Label>Number of Days</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="e.g., 1 or 0.5"
                  value={adjustForm.days}
                  onChange={(e) => setAdjustForm({ ...adjustForm, days: e.target.value })}
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">Use 0.5 for half day</p>
              </div>

              <div>
                <Label>Reason *</Label>
                <Textarea
                  placeholder="e.g., Worked on Sunday, Extra hours compensation"
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                  rows={3}
                  className="mt-1"
                />
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                <p className="text-sm text-amber-800">
                  {adjustForm.adjustment_type === 'add' ? (
                    <>
                      <strong>Add:</strong> Adding leaves to the balance.
                    </>
                  ) : (
                    <>
                      <strong>Deduction:</strong> Removing leaves from balance.
                    </>
                  )}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setAdjustDialogOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitAdjustment}
                  disabled={leaveTypes.length === 0 || leaveTypesError}
                  className={`flex-1 ${adjustForm.adjustment_type === 'add'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-slate-800 hover:bg-slate-900'
                    }`}
                >
                  {adjustForm.adjustment_type === 'add' ? 'Add Leaves' : 'Deduct Leaves'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Leave Details Dialog */}
      <Dialog open={leaveDetailsOpen} onOpenChange={setLeaveDetailsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Leave Details
            </DialogTitle>
          </DialogHeader>
          {selectedLeave && (
            <div className="space-y-4 mt-4">
              <div
                className="p-4 rounded-lg border-2"
                style={{
                  backgroundColor: selectedLeave.colors?.bg || '#f1f5f9',
                  borderColor: selectedLeave.colors?.border || '#64748b'
                }}
              >
                <p className="text-lg font-semibold" style={{ color: selectedLeave.colors?.text || '#334155' }}>
                  {selectedLeave.leave_type || 'Leave'}
                </p>
                {selectedLeave.employee_name && (
                  <p className="text-sm mt-1" style={{ color: selectedLeave.colors?.text || '#334155' }}>
                    {selectedLeave.employee_name}
                  </p>
                )}
                <div className="mt-2">
                  {getStatusBadge(selectedLeave.status)}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Calendar className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-slate-500">Leave Dates</p>
                    <p className="font-medium text-slate-900 mb-2">
                      {formatLeaveDates(selectedLeave.dates)}
                    </p>
                    {selectedLeave.dates && selectedLeave.dates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedLeave.dates
                          .map(d => new Date(d))
                          .sort((a, b) => a - b)
                          .map((date, idx) => (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="text-xs bg-white text-slate-700 border-slate-300 py-1 px-2"
                            >
                              {format(date, 'EEE, MMM dd')}
                            </Badge>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-500">Days</p>
                    <p className="font-medium text-slate-900">
                      {selectedLeave.days_count} {selectedLeave.days_count !== 1 ? 'days' : 'day'}
                      {selectedLeave.is_half_day && ` (${selectedLeave.half_day_period} half)`}
                    </p>
                  </div>
                </div>

                {selectedLeave.reason && (
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-slate-500">Reason</p>
                      <p className="font-medium text-slate-900">{selectedLeave.reason}</p>
                    </div>
                  </div>
                )}
              </div>

              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={() => setLeaveDetailsOpen(false)}
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Holiday Details Dialog */}
      <Dialog open={holidayDetailsOpen} onOpenChange={setHolidayDetailsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PartyPopper className="w-5 h-5 text-red-500" />
              Holiday Details
            </DialogTitle>
          </DialogHeader>
          {selectedHoliday && (
            <div className="space-y-4 mt-4">
              <div
                className="p-4 rounded-lg border-2"
                style={{
                  backgroundColor: getHolidayTypeColor(selectedHoliday.type).bg,
                  borderColor: getHolidayTypeColor(selectedHoliday.type).border
                }}
              >
                <p className="text-lg font-semibold" style={{ color: getHolidayTypeColor(selectedHoliday.type).text }}>
                  🎉 {selectedHoliday.name}
                </p>
                <p className="text-sm mt-1" style={{ color: getHolidayTypeColor(selectedHoliday.type).text }}>
                  {format(new Date(selectedHoliday.date), 'EEEE, MMMM dd, yyyy')}
                </p>
                <Badge variant="outline" className="mt-2 capitalize">
                  {selectedHoliday.type} Holiday
                </Badge>
              </div>

              {selectedHoliday.description && (
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Description</p>
                  <p className="text-sm text-slate-700">{selectedHoliday.description}</p>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setHolidayDetailsOpen(false)}
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeaveBalancePage;
