import React, { useState, useEffect } from 'react';
import { Calendar, Plus, ChevronLeft, ChevronRight, Trash2, Edit2, X, CalendarDays, Repeat, Eye, Grid3X3, CalendarRange } from 'lucide-react';
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
import { getAuth } from '@/lib/auth';
import { format } from 'date-fns';

const HolidaysPage = () => {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [viewMode, setViewMode] = useState('year'); // 'month' or 'year'
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedHoliday, setSelectedHoliday] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()); // For recurring holidays

  // Form states
  const [holidayForm, setHolidayForm] = useState({
    name: '',
    type: 'public',
    description: ''
  });

  const [recurringForm, setRecurringForm] = useState({
    name: '',
    day_of_week: '6',
    scope: 'year',
    type: 'public'
  });

  useEffect(() => {
    fetchHolidays();
  }, [currentYear]);

  const fetchHolidays = async () => {
    try {
      const response = await api.get(`/holidays?year=${currentYear}`);
      setHolidays(response.data);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
      toast.error('Failed to load holidays');
    } finally {
      setLoading(false);
    }
  };

  // Get non-recurring holidays only
  const getNonRecurringHolidays = () => {
    return holidays.filter(h => !h.is_recurring);
  };

  // Check if a date is in the past
  const isDatePast = (dateKey) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(dateKey);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate < today;
  };

  // Year navigation
  const goToPreviousYear = () => {
    setCurrentYear(currentYear - 1);
  };

  const goToNextYear = () => {
    setCurrentYear(currentYear + 1);
  };

  const goToCurrentYear = () => {
    setCurrentYear(new Date().getFullYear());
    setCurrentMonth(new Date().getMonth());
  };

  // Month navigation
  const goToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const goToToday = () => {
    setCurrentYear(new Date().getFullYear());
    setCurrentMonth(new Date().getMonth());
  };

  // Calendar helpers
  const getDaysInMonth = (year, month) => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    return { daysInMonth, startingDay };
  };

  const formatDateKey = (year, month, day) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const getHolidayForDate = (dateStr) => {
    return holidays.find(h => h.date === dateStr);
  };

  // Handle date click
  const handleDateClick = (dateKey, isPast) => {
    const holiday = getHolidayForDate(dateKey);

    if (holiday) {
      setSelectedHoliday(holiday);
      setHolidayForm({
        name: holiday.name,
        type: holiday.type,
        description: holiday.description || ''
      });

      if (isPast) {
        setViewDialogOpen(true);
      } else if (isAdmin) {
        setEditDialogOpen(true);
      } else {
        setViewDialogOpen(true);
      }
    } else if (isAdmin && !isPast) {
      setSelectedDate(dateKey);
      setHolidayForm({ name: '', type: 'public', description: '' });
      setAddDialogOpen(true);
    } else if (isAdmin && isPast) {
      toast.error('Cannot add holidays for past dates');
    }
  };

  // Create holiday
  const handleCreateHoliday = async () => {
    if (!holidayForm.name.trim()) {
      toast.error('Please enter a holiday name');
      return;
    }

    if (isDatePast(selectedDate)) {
      toast.error('Cannot add holidays for past dates');
      return;
    }

    try {
      await api.post('/holidays', {
        name: holidayForm.name,
        date: selectedDate,
        type: holidayForm.type,
        description: holidayForm.description
      });
      toast.success('Holiday created successfully');
      setAddDialogOpen(false);
      fetchHolidays();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create holiday');
    }
  };

  // Update holiday
  const handleUpdateHoliday = async () => {
    if (!holidayForm.name.trim()) {
      toast.error('Please enter a holiday name');
      return;
    }

    if (isDatePast(selectedHoliday.date)) {
      toast.error('Cannot modify holidays for past dates');
      return;
    }

    try {
      await api.put(`/holidays/${selectedHoliday.id}`, {
        name: holidayForm.name,
        type: holidayForm.type,
        description: holidayForm.description
      });
      toast.success('Holiday updated successfully');
      setEditDialogOpen(false);
      fetchHolidays();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update holiday');
    }
  };

  // Delete holiday
  const handleDeleteHoliday = async () => {
    if (isDatePast(selectedHoliday.date)) {
      toast.error('Cannot delete holidays for past dates');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this holiday?')) return;

    try {
      await api.delete(`/holidays/${selectedHoliday.id}`);
      toast.success('Holiday deleted successfully');
      setEditDialogOpen(false);
      fetchHolidays();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete holiday');
    }
  };

  // Create recurring holidays
  const handleCreateRecurring = async () => {
    if (!recurringForm.name.trim()) {
      toast.error('Please enter a holiday name');
      return;
    }

    const today = new Date();

    if (recurringForm.scope === 'year' && currentYear < today.getFullYear()) {
      toast.error('Cannot add recurring holidays for past years');
      return;
    }

    if (recurringForm.scope === 'month') {
      const selectedDate = new Date(currentYear, selectedMonth, 1);
      const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      if (selectedDate < currentMonth) {
        toast.error('Cannot add recurring holidays for past months');
        return;
      }
    }

    try {
      const payload = {
        name: recurringForm.name,
        day_of_week: parseInt(recurringForm.day_of_week, 10),
        scope: recurringForm.scope,
        year: currentYear,
        type: recurringForm.type
      };

      if (recurringForm.scope === 'month') {
        payload.month = selectedMonth + 1;
      }

      const response = await api.post('/holidays/recurring', payload);
      toast.success(response.data.message);
      setRecurringDialogOpen(false);
      setRecurringForm({ name: '', day_of_week: '6', scope: 'year', type: 'public' });
      fetchHolidays();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create recurring holidays');
    }
  };

  // Delete recurring holidays
  const handleDeleteRecurring = async () => {
    if (!window.confirm(`Are you sure you want to delete all ${getDayName(parseInt(recurringForm.day_of_week, 10))} holidays for this ${recurringForm.scope}?`)) return;

    try {
      const payload = {
        day_of_week: parseInt(recurringForm.day_of_week, 10),
        scope: recurringForm.scope,
        year: currentYear
      };

      if (recurringForm.scope === 'month') {
        payload.month = selectedMonth + 1;
      }

      const response = await api.delete('/holidays/recurring', { data: payload });
      toast.success(response.data.message);
      setRecurringDialogOpen(false);
      fetchHolidays();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete recurring holidays');
    }
  };

  const getDayName = (dayIndex) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayIndex];
  };

  const getTypeColor = (type, isRecurring = false) => {
    if (isRecurring) {
      return {
        bg: 'bg-slate-100',
        border: 'border-slate-300',
        text: 'text-slate-500',
        dot: 'bg-slate-400'
      };
    }

    const colors = {
      public: { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-700', dot: 'bg-red-500' },
      optional: { bg: 'bg-amber-100', border: 'border-amber-400', text: 'text-amber-700', dot: 'bg-amber-500' },
      restricted: { bg: 'bg-amber-100', border: 'border-amber-400', text: 'text-amber-700', dot: 'bg-slate-900' }
    };
    return colors[type] || colors.public;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const monthNamesShort = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Render a single month calendar
  const renderMonthCalendar = (monthIndex) => {
    const { daysInMonth, startingDay } = getDaysInMonth(currentYear, monthIndex);
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Empty cells before first day
    for (let i = 0; i < startingDay; i++) {
      days.push(
        <div key={`empty-${monthIndex}-${i}`} className="h-6 w-6 sm:h-7 sm:w-7"></div>
      );
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = formatDateKey(currentYear, monthIndex, day);
      const date = new Date(currentYear, monthIndex, day);
      const isToday = date.getTime() === today.getTime();
      const isPast = date < today;
      const holiday = getHolidayForDate(dateKey);
      const isRecurring = holiday?.is_recurring;
      const typeColor = holiday ? getTypeColor(holiday.type, isRecurring) : null;

      const canClick = holiday || (isAdmin && !isPast);

      days.push(
        <div
          key={`${monthIndex}-${day}`}
          onClick={() => handleDateClick(dateKey, isPast)}
          className={`
            h-6 w-6 sm:h-7 sm:w-7 flex items-center justify-center text-[10px] sm:text-xs rounded-md transition-all relative
            ${isToday ? 'ring-2 ring-amber-400' : ''}
            ${holiday ? `${typeColor.bg} ${typeColor.text} font-medium` : ''}
            ${isPast && !holiday ? 'text-slate-300' : !holiday ? 'text-slate-700' : ''}
            ${canClick ? 'cursor-pointer hover:bg-slate-200' : ''}
            ${isRecurring ? 'opacity-50' : ''}
          `}
          title={holiday ? `${holiday.name}${isRecurring ? ' (Recurring)' : ''}` : ''}
        >
          {day}
          {holiday && !isRecurring && (
            <div className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${typeColor.dot}`}></div>
          )}
        </div>
      );
    }

    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="py-1.5 sm:py-2 px-2 sm:px-3 bg-slate-50 border-b">
          <CardTitle className="text-xs sm:text-sm font-semibold text-slate-700">
            <span className="sm:hidden">{monthNamesShort[monthIndex]}</span>
            <span className="hidden sm:inline">{monthNames[monthIndex]}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1.5 sm:p-2">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-0.5 sm:mb-1">
            {dayNames.map((day, idx) => (
              <div
                key={idx}
                className={`h-5 sm:h-6 w-6 sm:w-7 flex items-center justify-center text-[10px] sm:text-xs font-medium 
                  ${idx === 0 || idx === 6 ? 'text-slate-400' : 'text-slate-600'}`}
              >
                {day}
              </div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
            {days}
          </div>
        </CardContent>
      </Card>
    );
  };

  // Render large month view calendar (for month view mode)
  const renderLargeMonthCalendar = () => {
    const { daysInMonth, startingDay } = getDaysInMonth(currentYear, currentMonth);
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fullDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const shortDayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    // Empty cells before first day
    for (let i = 0; i < startingDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="h-16 sm:h-24 md:h-28 bg-slate-50 border border-slate-100"></div>
      );
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = formatDateKey(currentYear, currentMonth, day);
      const date = new Date(currentYear, currentMonth, day);
      const isToday = date.getTime() === today.getTime();
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isPast = date < today;
      const holiday = getHolidayForDate(dateKey);
      const isRecurring = holiday?.is_recurring;
      const typeColor = holiday ? getTypeColor(holiday.type, isRecurring) : null;

      const canClick = holiday || (isAdmin && !isPast);
      const showNotAllowed = isAdmin && isPast && !holiday;

      days.push(
        <div
          key={day}
          onClick={() => handleDateClick(dateKey, isPast)}
          className={`
            h-16 sm:h-24 md:h-28 border border-slate-100 p-1 sm:p-2 transition-all relative
            ${isToday ? 'ring-2 ring-amber-400 ring-inset' : ''}
            ${isWeekend && !holiday ? 'bg-slate-50' : 'bg-white'}
            ${holiday ? `${typeColor.bg} ${typeColor.border} border-2` : ''}
            ${isPast && !holiday ? 'bg-slate-100 opacity-60' : ''}
            ${canClick ? 'cursor-pointer hover:bg-slate-100' : ''}
            ${showNotAllowed ? 'cursor-not-allowed hover:bg-slate-100' : ''}
            ${isRecurring ? 'opacity-50' : ''}
          `}
        >
          <div className={`text-xs sm:text-sm font-medium ${isToday ? 'text-amber-600' : isPast ? 'text-slate-400' : isWeekend ? 'text-slate-400' : 'text-slate-700'}`}>
            {day}
          </div>
          {holiday && (
            <div className="mt-0.5 sm:mt-1">
              <p className={`text-[10px] sm:text-xs font-medium ${typeColor.text} truncate`}>
                {holiday.name}
              </p>
              {isRecurring && (
                <Repeat className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-400 mt-0.5 sm:mt-1" />
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <>
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-slate-200">
          {fullDayNames.map((day, idx) => (
            <div
              key={day}
              className={`p-1.5 sm:p-2 text-center text-[10px] sm:text-sm font-semibold 
                ${idx === 0 || idx === 6 ? 'text-slate-400 bg-slate-50' : 'text-slate-700 bg-white'}`}
            >
              <span className="sm:hidden">{shortDayNames[idx]}</span>
              <span className="hidden sm:inline">{day}</span>
            </div>
          ))}
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days}
        </div>
      </>
    );
  };

  // Get upcoming holidays (non-recurring only)
  const upcomingHolidays = getNonRecurringHolidays()
    .filter(h => {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      return h.date >= todayStr;
    })
    .slice(0, 5);

  // Get stats (non-recurring only)
  const nonRecurringHolidays = getNonRecurringHolidays();
  const stats = {
    total: nonRecurringHolidays.length,
    public: nonRecurringHolidays.filter(h => h.type === 'public').length,
    optional: nonRecurringHolidays.filter(h => h.type === 'optional').length,
    restricted: nonRecurringHolidays.filter(h => h.type === 'restricted').length,
    recurring: holidays.filter(h => h.is_recurring).length
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 text-sm sm:text-base">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 md:p-10 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 sm:mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Holidays
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-slate-600">
            {isAdmin ? 'Manage company holidays' : 'View company holidays'}
          </p>
        </div>

        {/* Controls Row */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* View Toggle */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 sm:p-1">
            <Button
              size="sm"
              onClick={() => setViewMode('month')}
              className={`
      gap-1 text-xs sm:text-sm h-7 sm:h-8 px-2 sm:px-3
      transition-colors
      ${viewMode === 'month'
                  ? 'bg-white text-black shadow-sm hover:bg-white'
                  : 'bg-transparent text-slate-600 hover:bg-slate-200'}
    `}
            >
              <CalendarRange className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden xs:inline">Month</span>
            </Button>

            <Button
              size="sm"
              onClick={() => setViewMode('year')}
              className={`
      gap-1 text-xs sm:text-sm h-7 sm:h-8 px-2 sm:px-3
      transition-colors
      ${viewMode === 'year'
                  ? 'bg-white text-black shadow-sm hover:bg-white'
                  : 'bg-transparent text-slate-600 hover:bg-slate-200'}
    `}
            >
              <Grid3X3 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden xs:inline">Year</span>
            </Button>
          </div>

          {/* Navigation */}
          {viewMode === 'year' ? (
            <div className="flex items-center gap-1 sm:gap-2 bg-white border border-slate-200 rounded-lg px-1.5 sm:px-2 py-0.5 sm:py-1">
              <Button variant="ghost" size="icon" onClick={goToPreviousYear} className="h-7 w-7 sm:h-8 sm:w-8">
                <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
              <span className="text-sm sm:text-lg font-semibold text-slate-900 min-w-[50px] sm:min-w-[60px] text-center">
                {currentYear}
              </span>
              <Button variant="ghost" size="icon" onClick={goToNextYear} className="h-7 w-7 sm:h-8 sm:w-8">
                <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={goToCurrentYear} className="text-[10px] sm:text-xs h-6 sm:h-7 px-1.5 sm:px-2">
                Today
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1 sm:gap-2 bg-white border border-slate-200 rounded-lg px-1.5 sm:px-2 py-0.5 sm:py-1">
              <Button variant="ghost" size="icon" onClick={goToPreviousMonth} className="h-7 w-7 sm:h-8 sm:w-8">
                <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
              <span className="text-xs sm:text-lg font-semibold text-slate-900 min-w-[80px] sm:min-w-[140px] text-center">
                <span className="sm:hidden">{monthNamesShort[currentMonth]} {currentYear}</span>
                <span className="hidden sm:inline">{monthNames[currentMonth]} {currentYear}</span>
              </span>
              <Button variant="ghost" size="icon" onClick={goToNextMonth} className="h-7 w-7 sm:h-8 sm:w-8">
                <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={goToToday} className="text-[10px] sm:text-xs h-6 sm:h-7 px-1.5 sm:px-2">
                Today
              </Button>
            </div>
          )}

          {isAdmin && (
            <Button
              onClick={() => setRecurringDialogOpen(true)}
              className="bg-slate-800 hover:bg-slate-900 text-white rounded-lg sm:rounded-full gap-1 sm:gap-2 text-xs sm:text-sm h-8 sm:h-9 px-2.5 sm:px-4 ml-auto"
            >
              <Repeat className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Add Recurring</span>
              <span className="sm:hidden">Recurring</span>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 sm:gap-6">
        {/* Calendar Section */}
        <div className="xl:col-span-3">
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50 py-2 sm:py-3 px-3 sm:px-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {viewMode === 'year' ? (
                    <Grid3X3 className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                  ) : (
                    <CalendarRange className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                  )}
                  <h2 className="text-base sm:text-lg md:text-xl font-semibold text-slate-900">
                    {viewMode === 'year'
                      ? `${currentYear} Calendar`
                      : `${monthNames[currentMonth]} ${currentYear}`
                    }
                  </h2>
                </div>
                <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-sm">
                  <span className="text-slate-500">
                    {stats.total} holidays • {stats.recurring} recurring
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className={viewMode === 'year' ? 'p-2 sm:p-4' : 'p-0'}>
              {viewMode === 'year' ? (
                /* 12 Month Grid - Year View */
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4">
                  {monthNames.map((_, monthIndex) => (
                    <div key={monthIndex}>
                      {renderMonthCalendar(monthIndex)}
                    </div>
                  ))}
                </div>
              ) : (
                /* Large Month Calendar - Month View */
                renderLargeMonthCalendar()
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <Card className="border-slate-100 shadow-sm mt-3 sm:mt-4">
            <CardContent className="py-2.5 sm:py-4 px-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-3 sm:gap-6">
                <span className="text-xs sm:text-sm font-medium text-slate-600">Legend:</span>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-red-100 border-2 border-red-400"></div>
                  <span className="text-[10px] sm:text-sm text-slate-600">Public</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-amber-100 border-2 border-amber-400"></div>
                  <span className="text-[10px] sm:text-sm text-slate-600">Optional</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-amber-100 border-2 border-amber-400"></div>
                  <span className="text-[10px] sm:text-sm text-slate-600">Restricted</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-slate-100 border-2 border-slate-300 opacity-50"></div>
                  <span className="text-[10px] sm:text-sm text-slate-600">Recurring</span>
                </div>
              </div>
              {isAdmin && (
                <p className="text-[10px] sm:text-xs text-slate-500 mt-2 sm:mt-3">
                  Click on any future date to add a holiday. Click on existing holidays to view or edit.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="xl:col-span-1 space-y-3 sm:space-y-4">
          {/* Upcoming Holidays - Non-recurring only */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-sm sm:text-lg font-semibold text-slate-900 flex items-center gap-1.5 sm:gap-2">
                <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
                Upcoming Holidays
              </CardTitle>
              <p className="text-[10px] sm:text-xs text-slate-500">Excludes recurring holidays</p>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              {upcomingHolidays.length > 0 ? (
                <div className="space-y-2 sm:space-y-3">
                  {upcomingHolidays.map(holiday => {
                    const typeColor = getTypeColor(holiday.type, false);
                    return (
                      <div
                        key={holiday.id}
                        className={`p-2 sm:p-3 rounded-lg border-l-4 ${typeColor.bg} ${typeColor.border} cursor-pointer hover:shadow-sm transition-shadow`}
                        onClick={() => {
                          setSelectedHoliday(holiday);
                          setHolidayForm({
                            name: holiday.name,
                            type: holiday.type,
                            description: holiday.description || ''
                          });
                          setViewDialogOpen(true);
                        }}
                      >
                        <p className={`font-medium text-xs sm:text-sm ${typeColor.text}`}>{holiday.name}</p>
                        <p className="text-[10px] sm:text-xs text-slate-600 mt-0.5 sm:mt-1">
                          {format(new Date(holiday.date), 'EEE, MMM dd, yyyy')}
                        </p>
                        <Badge variant="outline" className="mt-1.5 sm:mt-2 text-[10px] sm:text-xs capitalize px-1.5 sm:px-2">
                          {holiday.type}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 sm:py-6 text-slate-500">
                  <Calendar className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-1.5 sm:mb-2 text-slate-300" />
                  <p className="text-xs sm:text-sm">No upcoming holidays</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats Card - Non-recurring only */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-sm sm:text-lg font-semibold text-slate-900">
                {currentYear} Summary
              </CardTitle>
              <p className="text-[10px] sm:text-xs text-slate-500">Excludes recurring holidays</p>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="space-y-2 sm:space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-slate-600">Total Holidays</span>
                  <span className="font-bold text-slate-900 text-sm sm:text-base">{stats.total}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-slate-600">Public</span>
                  <span className="font-medium text-red-600 text-sm sm:text-base">{stats.public}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-slate-600">Optional</span>
                  <span className="font-medium text-amber-600 text-sm sm:text-base">{stats.optional}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-slate-600">Restricted</span>
                  <span className="font-medium text-amber-600 text-sm sm:text-base">{stats.restricted}</span>
                </div>
                <div className="pt-2 sm:pt-3 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <span className="text-xs sm:text-sm text-slate-400">Recurring</span>
                    <span className="font-medium text-slate-400 text-sm sm:text-base">{stats.recurring}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* All Holidays List for current year */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-sm sm:text-lg font-semibold text-slate-900">
                All {currentYear} Holidays
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-60 sm:max-h-80 overflow-y-auto px-3 sm:px-6 pb-3 sm:pb-6">
              {nonRecurringHolidays.length > 0 ? (
                <div className="space-y-1.5 sm:space-y-2">
                  {nonRecurringHolidays
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map(holiday => {
                      const typeColor = getTypeColor(holiday.type, false);
                      return (
                        <div
                          key={holiday.id}
                          className="flex items-center justify-between p-1.5 sm:p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                          onClick={() => {
                            setSelectedHoliday(holiday);
                            setHolidayForm({
                              name: holiday.name,
                              type: holiday.type,
                              description: holiday.description || ''
                            });
                            if (isDatePast(holiday.date) || !isAdmin) {
                              setViewDialogOpen(true);
                            } else {
                              setEditDialogOpen(true);
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                            <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${typeColor.dot}`}></div>
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-medium text-slate-800 truncate">{holiday.name}</p>
                              <p className="text-[10px] sm:text-xs text-slate-500">
                                {format(new Date(holiday.date), 'MMM dd')}
                              </p>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] sm:text-xs capitalize shrink-0 ml-1 px-1 sm:px-2">
                            {holiday.type}
                          </Badge>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="text-center py-4 sm:py-6 text-slate-500">
                  <p className="text-xs sm:text-sm">No holidays added yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Holiday Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg">
              <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
              Add Holiday
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
            <div className="p-2 sm:p-3 bg-slate-50 rounded-lg">
              <p className="text-xs sm:text-sm text-slate-600">Date</p>
              <p className="font-semibold text-slate-900 text-sm sm:text-base">
                {selectedDate && format(new Date(selectedDate), 'EEEE, MMMM dd, yyyy')}
              </p>
            </div>

            <div>
              <Label className="text-xs sm:text-sm">Holiday Name *</Label>
              <Input
                placeholder="e.g., Diwali, Christmas"
                value={holidayForm.name}
                onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                className="mt-1 text-sm h-9 sm:h-10"
              />
            </div>

            <div>
              <Label className="text-xs sm:text-sm">Type</Label>
              <Select
                value={holidayForm.type}
                onValueChange={(value) => setHolidayForm({ ...holidayForm, type: value })}
              >
                <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public" className="text-xs sm:text-sm">Public Holiday</SelectItem>
                  <SelectItem value="optional" className="text-xs sm:text-sm">Optional Holiday</SelectItem>
                  <SelectItem value="restricted" className="text-xs sm:text-sm">Restricted Holiday</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs sm:text-sm">Description (Optional)</Label>
              <Textarea
                placeholder="Add any notes about this holiday..."
                value={holidayForm.description}
                onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })}
                rows={2}
                className="mt-1 text-xs sm:text-sm"
              />
            </div>

            <div className="flex gap-2 sm:gap-3 pt-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)} className="flex-1 text-xs sm:text-sm h-8 sm:h-10">
                Cancel
              </Button>
              <Button onClick={handleCreateHoliday} className="flex-1 bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-8 sm:h-10">
                Add Holiday
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Holiday Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg">
              <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
              Edit Holiday
            </DialogTitle>
          </DialogHeader>
          {selectedHoliday && (
            <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              <div className="p-2 sm:p-3 bg-slate-50 rounded-lg">
                <p className="text-xs sm:text-sm text-slate-600">Date</p>
                <p className="font-semibold text-slate-900 text-sm sm:text-base">
                  {format(new Date(selectedHoliday.date), 'EEEE, MMMM dd, yyyy')}
                </p>
                {selectedHoliday.is_recurring && (
                  <Badge variant="outline" className="mt-1.5 sm:mt-2 text-[10px] sm:text-xs">
                    <Repeat className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-1" />
                    Recurring
                  </Badge>
                )}
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Holiday Name *</Label>
                <Input
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                  className="mt-1 text-sm h-9 sm:h-10"
                />
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Type</Label>
                <Select
                  value={holidayForm.type}
                  onValueChange={(value) => setHolidayForm({ ...holidayForm, type: value })}
                >
                  <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public" className="text-xs sm:text-sm">Public Holiday</SelectItem>
                    <SelectItem value="optional" className="text-xs sm:text-sm">Optional Holiday</SelectItem>
                    <SelectItem value="restricted" className="text-xs sm:text-sm">Restricted Holiday</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Description (Optional)</Label>
                <Textarea
                  value={holidayForm.description}
                  onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })}
                  rows={2}
                  className="mt-1 text-xs sm:text-sm"
                />
              </div>

              <div className="flex gap-2 sm:gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={handleDeleteHoliday}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 sm:h-10 px-2 sm:px-3"
                >
                  <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="flex-1 text-xs sm:text-sm h-8 sm:h-10">
                  Cancel
                </Button>
                <Button onClick={handleUpdateHoliday} className="flex-1 bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-8 sm:h-10">
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View Holiday Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-md mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg">
              <Eye className="w-4 h-4 sm:w-5 sm:h-5" />
              Holiday Details
            </DialogTitle>
          </DialogHeader>
          {selectedHoliday && (
            <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {isDatePast(selectedHoliday.date) && isAdmin && (
                <div className="p-2 sm:p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs sm:text-sm text-amber-800">
                    This holiday is in the past and cannot be modified.
                  </p>
                </div>
              )}

              <div className={`p-3 sm:p-4 rounded-lg border-2 ${getTypeColor(selectedHoliday.type, selectedHoliday.is_recurring).bg} ${getTypeColor(selectedHoliday.type, selectedHoliday.is_recurring).border}`}>
                <p className={`text-base sm:text-lg font-semibold ${getTypeColor(selectedHoliday.type, selectedHoliday.is_recurring).text}`}>
                  {selectedHoliday.name}
                </p>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5 sm:mt-1">
                  {format(new Date(selectedHoliday.date), 'EEEE, MMMM dd, yyyy')}
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-1.5 sm:mt-2">
                  <Badge variant="outline" className="capitalize text-[10px] sm:text-xs">
                    {selectedHoliday.type} Holiday
                  </Badge>
                  {selectedHoliday.is_recurring && (
                    <Badge variant="outline" className="text-slate-500 text-[10px] sm:text-xs">
                      <Repeat className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-1" />
                      Recurring
                    </Badge>
                  )}
                </div>
              </div>

              {selectedHoliday.description && (
                <div className="p-2 sm:p-3 bg-slate-50 rounded-lg">
                  <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider mb-0.5 sm:mb-1">Description</p>
                  <p className="text-xs sm:text-sm text-slate-700">{selectedHoliday.description}</p>
                </div>
              )}

              <Button variant="outline" onClick={() => setViewDialogOpen(false)} className="w-full text-xs sm:text-sm h-8 sm:h-10">
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Recurring Holidays Dialog */}
      <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
        <DialogContent className="max-w-md mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg">
              <Repeat className="w-4 h-4 sm:w-5 sm:h-5" />
              Recurring Holidays
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
            <div className="p-2 sm:p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[10px] sm:text-sm text-amber-800">
                Create or remove holidays for a specific day of the week. Only future dates will be affected.
              </p>
            </div>

            <div>
              <Label className="text-xs sm:text-sm">Holiday Name *</Label>
              <Input
                placeholder="e.g., Saturday Off, Weekend"
                value={recurringForm.name}
                onChange={(e) => setRecurringForm({ ...recurringForm, name: e.target.value })}
                className="mt-1 text-sm h-9 sm:h-10"
              />
            </div>

            <div>
              <Label className="text-xs sm:text-sm">Day of Week</Label>
              <Select
                value={recurringForm.day_of_week}
                onValueChange={(value) => setRecurringForm({ ...recurringForm, day_of_week: value })}
              >
                <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0" className="text-xs sm:text-sm">Sunday</SelectItem>
                  <SelectItem value="1" className="text-xs sm:text-sm">Monday</SelectItem>
                  <SelectItem value="2" className="text-xs sm:text-sm">Tuesday</SelectItem>
                  <SelectItem value="3" className="text-xs sm:text-sm">Wednesday</SelectItem>
                  <SelectItem value="4" className="text-xs sm:text-sm">Thursday</SelectItem>
                  <SelectItem value="5" className="text-xs sm:text-sm">Friday</SelectItem>
                  <SelectItem value="6" className="text-xs sm:text-sm">Saturday</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs sm:text-sm">Scope</Label>
              <Select
                value={recurringForm.scope}
                onValueChange={(value) => setRecurringForm({ ...recurringForm, scope: value })}
              >
                <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month" className="text-xs sm:text-sm">Current Month</SelectItem>
                  <SelectItem value="year" className="text-xs sm:text-sm">Entire Year ({currentYear})</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {recurringForm.scope === 'month' && (
              <div>
                <Label className="text-xs sm:text-sm">Month</Label>
                <Select
                  value={String(selectedMonth)}
                  onValueChange={(value) => setSelectedMonth(parseInt(value, 10))}
                >
                  <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthNames.map((month, idx) => (
                      <SelectItem key={idx} value={String(idx)} className="text-xs sm:text-sm">{month}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs sm:text-sm">Holiday Type</Label>
              <Select
                value={recurringForm.type}
                onValueChange={(value) => setRecurringForm({ ...recurringForm, type: value })}
              >
                <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public" className="text-xs sm:text-sm">Public Holiday</SelectItem>
                  <SelectItem value="optional" className="text-xs sm:text-sm">Optional Holiday</SelectItem>
                  <SelectItem value="restricted" className="text-xs sm:text-sm">Restricted Holiday</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="bg-slate-50 p-2 sm:p-3 rounded-lg">
              <p className="text-[10px] sm:text-sm text-slate-600">
                This will create holidays for all <strong>{getDayName(parseInt(recurringForm.day_of_week, 10))}s</strong> in{' '}
                <strong>
                  {recurringForm.scope === 'month'
                    ? `${monthNames[selectedMonth]} ${currentYear}`
                    : currentYear
                  }
                </strong>
                {' '}(only future dates)
              </p>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleDeleteRecurring}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 text-[10px] sm:text-xs h-8 sm:h-10 px-2 sm:px-3"
              >
                <Trash2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                Remove All
              </Button>
              <Button variant="outline" onClick={() => setRecurringDialogOpen(false)} className="flex-1 text-xs sm:text-sm h-8 sm:h-10">
                Cancel
              </Button>
              <Button onClick={handleCreateRecurring} className="flex-1 bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-8 sm:h-10">
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HolidaysPage;
