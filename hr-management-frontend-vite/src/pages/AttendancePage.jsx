import React, { useState, useEffect, useCallback } from 'react';
import { Download, ChevronLeft, ChevronRight, Check, X, Clock, Umbrella, RefreshCw, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';

const AttendancePage = () => {
  const { user } = getAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [daysInMonth, setDaysInMonth] = useState(31);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [pendingChanges, setPendingChanges] = useState({});
  const [downloading, setDownloading] = useState(false);
  const [holidays, setHolidays] = useState({});  // Map of day -> holiday info

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  const statusOptions = [
    { value: 'present', label: 'P', color: 'bg-emerald-500', textColor: 'text-white', icon: Check },
    { value: 'absent', label: 'A', color: 'bg-red-500', textColor: 'text-white', icon: X },
    { value: 'half-day', label: 'H', color: 'bg-amber-500', textColor: 'text-white', icon: Clock },
    { value: 'leave', label: 'L', color: 'bg-slate-900', textColor: 'text-white', icon: Umbrella },
    { value: '', label: '-', color: 'bg-slate-100', textColor: 'text-slate-400', icon: null }
  ];

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/attendance', {
        params: { month: selectedMonth, year: selectedYear }
      });
      setEmployees(response.data.employees);
      setDaysInMonth(response.data.daysInMonth);
      setPendingChanges({});

      // Create holiday map from response
      const holidayMap = {};
      if (response.data.holidays && response.data.holidays.length > 0) {
        response.data.holidays.forEach(holiday => {
          try {
            // Parse date - handles ISO strings, Date objects, and YYYY-MM-DD
            const dateObj = new Date(holiday.date);
            // Use getDate() for local timezone interpretation
            const day = dateObj.getDate();

            if (day >= 1 && day <= 31) {
              holidayMap[day] = {
                name: holiday.name,
                type: holiday.type,
                description: holiday.description
              };
            }
          } catch (e) {
            console.warn('Failed to parse holiday date:', holiday.date);
          }
        });
      }
      setHolidays(holidayMap);
      console.log('Holidays loaded:', Object.keys(holidayMap).length, 'for month', selectedMonth);
    } catch (error) {
      console.error('Failed to fetch attendance:', error);
      toast.error('Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const getStatusStyle = (status) => {
    const option = statusOptions.find(opt => opt.value === status);
    return option || statusOptions[statusOptions.length - 1];
  };

  const isHoliday = (day) => {
    return !!holidays[day];
  };

  const getHolidayInfo = (day) => {
    return holidays[day] || null;
  };

  const handleCellClick = (employeeId, day) => {
    if (user?.role !== 'admin') return;

    // Don't allow marking attendance on holidays
    if (isHoliday(day)) {
      const holidayInfo = getHolidayInfo(day);
      toast.info(`${holidayInfo?.name || 'Holiday'} - Cannot mark attendance on holidays`);
      return;
    }

    const key = `${employeeId}-${day}`;
    const employee = employees.find(e => e.employee_id === employeeId);
    const currentStatus = pendingChanges[key]?.status ?? employee?.attendance?.[day] ?? '';

    // Cycle through statuses (without holiday and weekend)
    const currentIndex = statusOptions.findIndex(opt => opt.value === currentStatus);
    const nextIndex = (currentIndex + 1) % statusOptions.length;
    const nextStatus = statusOptions[nextIndex].value;

    setPendingChanges(prev => ({
      ...prev,
      [key]: {
        employee_id: employeeId,
        date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        status: nextStatus
      }
    }));
  };

  const handleSaveChanges = async () => {
    const records = Object.values(pendingChanges);
    if (records.length === 0) {
      toast.info('No changes to save');
      return;
    }

    setSaving(true);
    try {
      await api.post('/attendance/bulk-mark', { records });
      toast.success(`Saved ${records.length} attendance record(s)`);
      setPendingChanges({});
      fetchAttendance();
    } catch (error) {
      console.error('Failed to save attendance:', error);
      toast.error('Failed to save attendance');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkColumn = async (day, status) => {
    if (user?.role !== 'admin') return;

    // Don't allow marking attendance on holidays
    if (isHoliday(day)) {
      const holidayInfo = getHolidayInfo(day);
      toast.info(`${holidayInfo?.name || 'Holiday'} - Cannot mark attendance on holidays`);
      return;
    }

    const date = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    try {
      await api.post('/attendance/mark-column', { date, status });
      toast.success(`Marked all employees as ${status} for day ${day}`);
      fetchAttendance();
    } catch (error) {
      console.error('Failed to mark column:', error);
      toast.error('Failed to mark column');
    }
  };

  const handleDownloadXLSX = async () => {
    setDownloading(true);
    try {
      const response = await api.post('/attendance/download', {
        month: selectedMonth,
        year: selectedYear
      }, {
        responseType: 'blob'
      });

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Attendance_${months[selectedMonth - 1]}_${selectedYear}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success('Attendance downloaded successfully');
    } catch (error) {
      console.error('Failed to download:', error);
      toast.error('Failed to download attendance');
    } finally {
      setDownloading(false);
    }
  };

  const getCellStatus = (employee, day) => {
    const key = `${employee.employee_id}-${day}`;
    if (pendingChanges[key]) {
      return pendingChanges[key].status;
    }
    return employee.attendance?.[day] ?? '';
  };

  const getDayName = (day) => {
    const date = new Date(selectedYear, selectedMonth - 1, day);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  };

  // Calculate summary
  const calculateSummary = (employee) => {
    let present = 0, absent = 0, halfDay = 0, leave = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const status = getCellStatus(employee, day);
      switch (status) {
        case 'present': present++; break;
        case 'absent': absent++; break;
        case 'half-day': halfDay++; break;
        case 'leave': leave++; break;
      }
    }

    return { present, absent, halfDay, leave };
  };

  const goToPreviousMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(prev => prev - 1);
    } else {
      setSelectedMonth(prev => prev - 1);
    }
  };

  const goToNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(prev => prev + 1);
    } else {
      setSelectedMonth(prev => prev + 1);
    }
  };

  // Count holidays in the month
  const holidayCount = Object.keys(holidays).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">Loading attendance...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              Attendance Management
            </h1>
            <p className="text-slate-600 mt-1">Mark and manage employee attendance</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Month/Year Navigation */}
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1">
              <Button variant="ghost" size="sm" onClick={goToPreviousMonth}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-2">
                <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                  <SelectTrigger className="w-32 border-0 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((month, idx) => (
                      <SelectItem key={idx} value={String(idx + 1)}>{month}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                  <SelectTrigger className="w-24 border-0 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map(year => (
                      <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="sm" onClick={goToNextMonth}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Actions */}
            <Button variant="outline" onClick={fetchAttendance} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>

            {user?.role === 'admin' && Object.keys(pendingChanges).length > 0 && (
              <Button onClick={handleSaveChanges} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                {saving ? 'Saving...' : `Save Changes (${Object.keys(pendingChanges).length})`}
              </Button>
            )}

            <Button onClick={handleDownloadXLSX} disabled={downloading} className="bg-slate-800 hover:bg-slate-900">
              <Download className="w-4 h-4 mr-2" />
              {downloading ? 'Downloading...' : 'Download XLSX'}
            </Button>
          </div>
        </div>

        {/* Legend */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium text-slate-600">Legend:</span>
              {statusOptions.filter(opt => opt.value !== '').map(option => (
                <div key={option.value} className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold ${option.color} ${option.textColor}`}>
                    {option.label}
                  </div>
                  <span className="text-sm text-slate-600 capitalize">{option.value.replace('-', ' ')}</span>
                </div>
              ))}
              {/* Holiday indicator */}
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-200">
                <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold bg-purple-100 text-purple-700 border border-purple-300">
                  <Calendar className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm text-slate-600">Holiday ({holidayCount} this month)</span>
              </div>
              <div className="ml-auto text-sm text-slate-500">
                <Users className="w-4 h-4 inline mr-1" />
                {employees.length} employees
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Attendance Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                {/* Days Header */}
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 border-r border-slate-200 min-w-[200px]">
                    Employee
                  </th>
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                    const holidayInfo = getHolidayInfo(day);
                    const dayIsHoliday = !!holidayInfo;

                    return (
                      <th
                        key={day}
                        className={`px-1 py-2 text-center text-xs font-medium border-r border-slate-100 min-w-[36px] ${dayIsHoliday ? 'bg-purple-50' : ''
                          }`}
                      >
                        {dayIsHoliday ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="cursor-help">
                                <div className="text-purple-600">{getDayName(day)}</div>
                                <div className="text-sm font-bold text-purple-700">{day}</div>
                                <Calendar className="w-3 h-3 mx-auto mt-0.5 text-purple-500" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="font-semibold">{holidayInfo.name}</p>
                              {holidayInfo.description && (
                                <p className="text-xs text-slate-400">{holidayInfo.description}</p>
                              )}
                              <p className="text-xs text-slate-400 capitalize">{holidayInfo.type} Holiday</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <>
                            <div className="text-slate-500">{getDayName(day)}</div>
                            <div className="text-sm font-bold text-slate-700">{day}</div>
                          </>
                        )}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-700 bg-emerald-50 border-l-2 border-emerald-200">
                    P
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-700 bg-red-50">
                    A
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-700 bg-amber-50">
                    H
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-700 bg-amber-50">
                    L
                  </th>
                </tr>

                {/* Quick Mark Row (Admin Only) */}
                {user?.role === 'admin' && (
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="sticky left-0 z-20 bg-slate-100 px-4 py-2 text-left text-xs text-slate-500 border-r border-slate-200">
                      Quick Mark All
                    </th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                      const dayIsHoliday = isHoliday(day);

                      return (
                        <td
                          key={day}
                          className={`px-1 py-1 text-center border-r border-slate-100 ${dayIsHoliday ? 'bg-purple-50' : ''
                            }`}
                        >
                          {dayIsHoliday ? (
                            <span className="text-purple-400 text-xs">-</span>
                          ) : (
                            <Select onValueChange={(status) => handleMarkColumn(day, status)}>
                              <SelectTrigger className="w-8 h-6 p-0 border-0 shadow-none text-xs">
                                <span className="text-slate-400">•</span>
                              </SelectTrigger>
                              <SelectContent>
                                {statusOptions.filter(opt => opt.value !== '').map(option => (
                                  <SelectItem key={option.value} value={option.value}>
                                    <span className="flex items-center gap-2">
                                      <span className={`w-4 h-4 rounded text-xs flex items-center justify-center ${option.color} ${option.textColor}`}>
                                        {option.label}
                                      </span>
                                      <span className="capitalize">{option.value}</span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                      );
                    })}
                    <td colSpan={4} className="bg-slate-50"></td>
                  </tr>
                )}
              </thead>
              <tbody>
                {employees.map((employee, idx) => {
                  const summary = calculateSummary(employee);
                  return (
                    <tr
                      key={employee.employee_id}
                      className={`border-b border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                    >
                      {/* Employee Info */}
                      <td className="sticky left-0 z-10 bg-inherit px-4 py-3 border-r border-slate-200">
                        <div className="min-w-[180px]">
                          <div className="font-medium text-slate-900 truncate">{employee.full_name}</div>
                          <div className="text-xs text-slate-500">{employee.employee_id} • {employee.department}</div>
                        </div>
                      </td>

                      {/* Attendance Cells */}
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                        const dayIsHoliday = isHoliday(day);
                        const holidayInfo = getHolidayInfo(day);
                        const status = getCellStatus(employee, day);
                        const style = getStatusStyle(status);
                        const key = `${employee.employee_id}-${day}`;
                        const hasChange = !!pendingChanges[key];

                        // Holiday cell
                        if (dayIsHoliday) {
                          return (
                            <td
                              key={day}
                              className="px-1 py-1 text-center border-r border-slate-100 bg-purple-50"
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold bg-purple-100 text-purple-600 border border-purple-200 cursor-not-allowed mx-auto">
                                    <Calendar className="w-3.5 h-3.5" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="font-semibold">{holidayInfo?.name}</p>
                                  <p className="text-xs">Attendance disabled</p>
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={day}
                            className="px-1 py-1 text-center border-r border-slate-100"
                          >
                            <button
                              onClick={() => handleCellClick(employee.employee_id, day)}
                              disabled={user?.role !== 'admin'}
                              className={`
                                w-8 h-8 rounded text-xs font-bold transition-all
                                ${style.color} ${style.textColor}
                                ${user?.role === 'admin' ? 'hover:ring-2 hover:ring-slate-400 cursor-pointer' : 'cursor-default'}
                                ${hasChange ? 'ring-2 ring-amber-400 ring-offset-1' : ''}
                              `}
                              title={`${employee.full_name} - Day ${day}: ${status || 'Not marked'}`}
                            >
                              {style.label}
                            </button>
                          </td>
                        );
                      })}

                      {/* Summary Columns */}
                      <td className="px-3 py-2 text-center text-sm font-bold text-emerald-700 bg-emerald-50 border-l-2 border-emerald-200">
                        {summary.present}
                      </td>
                      <td className="px-3 py-2 text-center text-sm font-bold text-red-700 bg-red-50">
                        {summary.absent}
                      </td>
                      <td className="px-3 py-2 text-center text-sm font-bold text-amber-700 bg-amber-50">
                        {summary.halfDay}
                      </td>
                      <td className="px-3 py-2 text-center text-sm font-bold text-amber-700 bg-amber-50">
                        {summary.leave}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {employees.length === 0 && (
            <div className="py-12 text-center text-slate-500">
              <Users className="w-12 h-12 mx-auto mb-4 text-slate-300" />
              <p>No employees found</p>
            </div>
          )}
        </Card>

        {/* Instructions */}
        {user?.role === 'admin' && (
          <Card>
            <CardContent className="py-4">
              <div className="text-sm text-slate-600">
                <strong>Instructions:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Click on any cell to cycle through attendance statuses (P → A → H → L → Empty)</li>
                  <li>Use "Quick Mark All" dropdowns in the header row to mark all employees for a specific day</li>
                  <li>Changes are highlighted with an orange ring - click "Save Changes" to persist</li>
                  <li>Purple highlighted columns are holidays (from your Holidays settings) - attendance cannot be marked</li>
                  <li>Download the attendance as an Excel file using the "Download XLSX" button</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
};

export default AttendancePage;
