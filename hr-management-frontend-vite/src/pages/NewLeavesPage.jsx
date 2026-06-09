import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Calendar, ChevronLeft, ChevronRight, X, Clock, Sun, Sunset, Trash2, Star, FileText, Gift, AlertCircle, Loader2, AlertTriangle, Info, Stethoscope, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';

const LeavesPage = () => {
  // Hardcoded clubbing rules as fallback (in case API doesn't return them)
  const CLUBBING_RULES = {
    'Sick Leave': ['Casual Leave'],
    'Casual Leave': ['Sick Leave'],
  };

  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [holidays, setHolidays] = useState([]);

  // Selected dates with their configurations including leave type per day
  // Format: { 'YYYY-MM-DD': { type: 'full' | 'half', period: 'morning' | 'afternoon', leaveType: 'Earned Leave' } }
  const [selectedDates, setSelectedDates] = useState({});

  // Default leave type for new date selections
  const [defaultLeaveType, setDefaultLeaveType] = useState('');

  const [leaveForm, setLeaveForm] = useState({
    reason: '',
  });

  useEffect(() => {
    fetchLeaves();
    fetchLeaveTypesAndBalance();
    fetchHolidays();
  }, []);

  /**
   * Fetch leave types from backend policy AND employee's current balance
   */
  const fetchLeaveTypesAndBalance = async () => {
    setLoadingTypes(true);
    try {
      // Fetch leave policy (for quotas)
      const policyResponse = await api.get('/leaves/leave-policy');
      const policies = policyResponse.data?.policies || [];

      // Fetch employee profile (for current balance)
      const profileResponse = await api.get('/auth/me');
      const balance = profileResponse.data?.leave_balance || {};

      // Build leave types array with both quota and available balance
      const types = policies.map(policy => {
        const key = policy.leave_type.toLowerCase().replace(/ /g, '_');
        return {
          name: policy.leave_type,
          key: key,
          quota: policy.annual_quota || 0,
          available: balance[key] ?? 0,
          description: policy.description || '',
          carryForward: policy.carry_forward_allowed || false,
          maxCarryForward: policy.max_carry_forward_days || 0,
          creditType: policy.credit_type || 'annually',
          monthlyCredit: policy.monthly_credit || 0,
          advanceDaysRequired: policy.advance_days_required || 0,
          clubbingNotAllowedWith: policy.clubbing_not_allowed_with || [],
          isUnlimited: policy.is_unlimited || false
        };
      });

      // Add Comp Off (not in policy but always available as an option)
      const compOffBalance = balance.comp_off ?? 0;
      types.push({
        name: 'Comp Off',
        key: 'comp_off',
        quota: 0,
        available: compOffBalance,
        description: 'Compensatory off for working on holidays/weekends',
        isCompOff: true,
        clubbingNotAllowedWith: []
      });

      setLeaveTypes(types);

      // Set default leave type
      if (types.length > 0) {
        setDefaultLeaveType(types[0].name);
      }
    } catch (error) {
      console.error('Failed to fetch leave types:', error);
      toast.error('Failed to load leave types');

      // Fallback to defaults
      const defaultTypes = [
        { name: 'Earned Leave', key: 'earned_leave', quota: 12, available: 0, creditType: 'monthly', monthlyCredit: 1, advanceDaysRequired: 7, clubbingNotAllowedWith: [] },
        { name: 'Sick Leave', key: 'sick_leave', quota: 6, available: 0, creditType: 'monthly', monthlyCredit: 0.5, clubbingNotAllowedWith: ['Casual Leave'] },
        { name: 'Casual Leave', key: 'casual_leave', quota: 6, available: 0, clubbingNotAllowedWith: ['Sick Leave'] },
        { name: 'Unpaid Leave', key: 'unpaid_leave', quota: 0, available: Infinity, clubbingNotAllowedWith: [] },
        { name: 'Comp Off', key: 'comp_off', quota: 0, available: 0, isCompOff: true, clubbingNotAllowedWith: [] }
      ];
      setLeaveTypes(defaultTypes);
      setDefaultLeaveType('Earned Leave');
    } finally {
      setLoadingTypes(false);
    }
  };

  const fetchLeaves = async () => {
    try {
      const response = await api.get('/leaves/my-leaves');
      setLeaves(response.data);
    } catch (error) {
      console.error('Failed to fetch leaves:', error);
      toast.error('Failed to load leaves');
    } finally {
      setLoading(false);
    }
  };

  const fetchHolidays = async () => {
    try {
      const response = await api.get('/holidays');
      setHolidays(response.data);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    }
  };

  const formatDateKey = (year, month, day) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Get unique leave types selected across all dates
  const selectedLeaveTypesSet = useMemo(() => {
    const types = new Set(Object.values(selectedDates).map(d => d.leaveType).filter(Boolean));
    return Array.from(types);
  }, [selectedDates]);

  // Check clubbing rules between selected leave types
  const clubbingValidation = useMemo(() => {
    const errors = [];
    const types = selectedLeaveTypesSet;

    if (types.length < 2) return { valid: true, errors: [] };

    // Check each pair of leave types
    for (let i = 0; i < types.length; i++) {
      for (let j = i + 1; j < types.length; j++) {
        const type1 = types[i];
        const type2 = types[j];

        const type1Info = leaveTypes.find(t => t.name === type1);
        const type2Info = leaveTypes.find(t => t.name === type2);

        // Get clubbing restrictions from API or fallback to hardcoded rules
        const type1Restrictions = type1Info?.clubbingNotAllowedWith?.length > 0
          ? type1Info.clubbingNotAllowedWith
          : (CLUBBING_RULES[type1] || []);

        const type2Restrictions = type2Info?.clubbingNotAllowedWith?.length > 0
          ? type2Info.clubbingNotAllowedWith
          : (CLUBBING_RULES[type2] || []);

        // Check if type1 cannot be clubbed with type2
        if (type1Restrictions.includes(type2)) {
          errors.push({
            type1,
            type2,
            message: `${type1} cannot be clubbed with ${type2}`
          });
        }
        // Check reverse - if type2 cannot be clubbed with type1
        else if (type2Restrictions.includes(type1)) {
          errors.push({
            type1: type2,
            type2: type1,
            message: `${type2} cannot be clubbed with ${type1}`
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }, [selectedLeaveTypesSet, leaveTypes]);

  // Calculate balance usage per leave type
  const balanceUsage = useMemo(() => {
    const usage = {};

    Object.entries(selectedDates).forEach(([date, config]) => {
      const leaveType = config.leaveType;
      if (!leaveType) return;

      if (!usage[leaveType]) {
        usage[leaveType] = { days: 0, dates: [] };
      }
      const dayValue = config.type === 'full' ? 1 : 0.5;
      usage[leaveType].days += dayValue;
      usage[leaveType].dates.push(date);
    });

    // Add balance info
    Object.keys(usage).forEach(type => {
      const typeInfo = leaveTypes.find(t => t.name === type);
      usage[type].available = typeInfo?.available ?? 0;
      usage[type].isUnpaid = typeInfo?.isUnlimited || false;
      usage[type].sufficient = usage[type].isUnpaid || usage[type].available >= usage[type].days;
    });

    return usage;
  }, [selectedDates, leaveTypes]);

  // Check for insufficient balance
  const insufficientBalanceTypes = useMemo(() => {
    return Object.entries(balanceUsage)
      .filter(([type, info]) => !info.isUnpaid && !info.sufficient)
      .map(([type, info]) => ({
        type,
        available: info.available,
        requested: info.days
      }));
  }, [balanceUsage]);

  // Validate advance notice for all selected leave types (only for future dates)
  const advanceNoticeWarnings = useMemo(() => {
    const warnings = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    Object.entries(selectedDates).forEach(([dateStr, config]) => {
      if (!config.leaveType) return;

      const typeInfo = leaveTypes.find(t => t.name === config.leaveType);
      if (!typeInfo || !typeInfo.advanceDaysRequired) return;

      const leaveDate = new Date(dateStr);
      leaveDate.setHours(0, 0, 0, 0);

      // Only check advance notice for future dates
      if (leaveDate < today) return;

      const diffDays = Math.ceil((leaveDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays < typeInfo.advanceDaysRequired) {
        const existingWarning = warnings.find(w => w.leaveType === config.leaveType);
        if (!existingWarning) {
          warnings.push({
            leaveType: config.leaveType,
            required: typeInfo.advanceDaysRequired,
            dates: [dateStr]
          });
        } else {
          existingWarning.dates.push(dateStr);
        }
      }
    });

    return warnings;
  }, [selectedDates, leaveTypes]);

  // Check if any past dates are selected
  const pastDatesSelected = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Object.keys(selectedDates).filter(dateStr => {
      const date = new Date(dateStr);
      date.setHours(0, 0, 0, 0);
      return date < today;
    });
  }, [selectedDates]);

  // Create a map of holiday dates for quick lookup
  const getHolidayMap = () => {
    const holidayMap = {};
    holidays.forEach(holiday => {
      const date = new Date(holiday.date);
      const dateKey = formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
      holidayMap[dateKey] = holiday;
    });
    return holidayMap;
  };

  const holidayMap = getHolidayMap();

  // Create a map of dates that already have leave applied
  const getExistingLeaveMap = () => {
    const leaveMap = {};
    leaves.forEach(leave => {
      if (leave.status === 'rejected') return;

      const dates = leave.dates || [];
      dates.forEach(dateStr => {
        const date = new Date(dateStr);
        const dateKey = formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
        leaveMap[dateKey] = {
          leave_type: leave.leave_type,
          status: leave.status,
          is_half_day: leave.is_half_day,
          half_day_period: leave.half_day_period
        };
      });
    });
    return leaveMap;
  };

  const existingLeaveMap = getExistingLeaveMap();

  const isHoliday = (dateKey) => !!holidayMap[dateKey];
  const getHolidayInfo = (dateKey) => holidayMap[dateKey] || null;
  const hasExistingLeave = (dateKey) => !!existingLeaveMap[dateKey];
  const getExistingLeaveInfo = (dateKey) => existingLeaveMap[dateKey] || null;

  const getStatusDisplayText = (status) => {
    const statusMap = {
      pending: 'Pending',
      manager_approved: 'Manager Approved',
      approved: 'Approved'
    };
    return statusMap[status] || status;
  };

  // Calendar helper functions
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    return { daysInMonth, startingDay, year, month };
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const toggleDateSelection = (dateKey) => {
    if (isHoliday(dateKey)) {
      const holiday = getHolidayInfo(dateKey);
      toast.error(`${holiday.name} - This is a holiday, no need to apply for leave`);
      return;
    }

    if (hasExistingLeave(dateKey)) {
      const leaveInfo = getExistingLeaveInfo(dateKey);
      toast.error(`You already have ${leaveInfo.leave_type} (${getStatusDisplayText(leaveInfo.status)}) on this date`);
      return;
    }

    setSelectedDates(prev => {
      if (prev[dateKey]) {
        const { [dateKey]: removed, ...rest } = prev;
        return rest;
      } else {
        return {
          ...prev,
          [dateKey]: { type: 'full', period: 'morning', leaveType: defaultLeaveType }
        };
      }
    });
  };

  const updateDateConfig = (dateKey, config) => {
    // If changing leave type, check for clubbing conflicts immediately
    if (config.leaveType) {
      const newLeaveType = config.leaveType;
      const otherTypes = Object.entries(selectedDates)
        .filter(([key]) => key !== dateKey)
        .map(([, cfg]) => cfg.leaveType)
        .filter(Boolean);

      // Get clubbing restrictions
      const newTypeRestrictions = CLUBBING_RULES[newLeaveType] || [];

      // Check if any existing type conflicts with the new type
      for (const existingType of otherTypes) {
        const existingRestrictions = CLUBBING_RULES[existingType] || [];

        if (newTypeRestrictions.includes(existingType) || existingRestrictions.includes(newLeaveType)) {
          toast.error(`⚠️ Clubbing not allowed: ${newLeaveType} cannot be combined with ${existingType}`, {
            duration: 4000,
          });
          // Still update, but show the warning - user can see the error alert below
          break;
        }
      }
    }

    setSelectedDates(prev => ({
      ...prev,
      [dateKey]: { ...prev[dateKey], ...config }
    }));
  };

  const removeDate = (dateKey) => {
    setSelectedDates(prev => {
      const { [dateKey]: removed, ...rest } = prev;
      return rest;
    });
  };

  const clearAllDates = () => {
    setSelectedDates({});
  };

  // Apply default leave type to all selected dates
  const applyLeaveTypeToAll = () => {
    setSelectedDates(prev => {
      const updated = {};
      Object.entries(prev).forEach(([dateKey, config]) => {
        updated[dateKey] = { ...config, leaveType: defaultLeaveType };
      });
      return updated;
    });
  };

  const calculateTotalDays = () => {
    return Object.values(selectedDates).reduce((total, config) => {
      return total + (config.type === 'full' ? 1 : 0.5);
    }, 0);
  };

  const getLeaveTypeInfo = (typeName) => {
    return leaveTypes.find(t => t.name === typeName);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (Object.keys(selectedDates).length === 0) {
      toast.error('Please select at least one date');
      return;
    }

    if (!leaveForm.reason.trim()) {
      toast.error('Please provide a reason for your leave');
      return;
    }

    // Final clubbing validation check
    if (!clubbingValidation.valid) {
      toast.error(`⛔ Cannot submit: ${clubbingValidation.errors[0].message}. Please fix the clubbing conflict first.`, {
        duration: 5000,
      });
      return;
    }

    // Double-check clubbing rules manually as extra safeguard
    const allSelectedTypes = [...new Set(Object.values(selectedDates).map(d => d.leaveType))];
    for (let i = 0; i < allSelectedTypes.length; i++) {
      for (let j = i + 1; j < allSelectedTypes.length; j++) {
        const type1 = allSelectedTypes[i];
        const type2 = allSelectedTypes[j];
        const type1Restrictions = CLUBBING_RULES[type1] || [];
        const type2Restrictions = CLUBBING_RULES[type2] || [];

        if (type1Restrictions.includes(type2) || type2Restrictions.includes(type1)) {
          toast.error(`⛔ Cannot submit: ${type1} cannot be clubbed with ${type2}`, {
            duration: 5000,
          });
          return;
        }
      }
    }

    // Check balance for all types
    if (insufficientBalanceTypes.length > 0) {
      const first = insufficientBalanceTypes[0];
      toast.error(`Insufficient ${first.type} balance. Available: ${first.available}, Requested: ${first.requested}`);
      return;
    }

    setSubmitting(true);

    try {
      // Group dates by leave type AND configuration (full/half + period)
      const groups = {};

      Object.entries(selectedDates).forEach(([dateKey, config]) => {
        const groupKey = `${config.leaveType}__${config.type === 'full' ? 'full' : `half_${config.period}`}`;

        if (!groups[groupKey]) {
          groups[groupKey] = {
            leaveType: config.leaveType,
            dates: [],
            is_half_day: config.type === 'half',
            half_day_period: config.type === 'half' ? config.period : null
          };
        }
        groups[groupKey].dates.push(dateKey);
      });

      // Submit each group as a separate leave request
      const submissions = Object.values(groups).map(async (group) => {
        const payload = {
          leave_type: group.leaveType,
          dates: group.dates.map(d => new Date(d).toISOString()),
          reason: leaveForm.reason,
          is_half_day: group.is_half_day,
          half_day_period: group.half_day_period,
        };

        return api.post('/leaves', payload);
      });

      await Promise.all(submissions);

      const count = Object.keys(groups).length;
      toast.success(
        count > 1
          ? `${count} leave applications submitted successfully!`
          : 'Leave application submitted successfully!'
      );

      setDialogOpen(false);
      setLeaveForm({ reason: '' });
      setSelectedDates({});
      fetchLeaves();
      fetchLeaveTypesAndBalance();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit leave application');
    } finally {
      setSubmitting(false);
    }
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

    if (sortedDates.length <= 3) {
      const formatted = sortedDates.map((d, i) =>
        i === sortedDates.length - 1
          ? format(d, 'MMM dd, yyyy')
          : format(d, 'MMM dd')
      );
      return formatted.join(', ');
    }

    return `${format(sortedDates[0], 'MMM dd')} - ${format(sortedDates[sortedDates.length - 1], 'MMM dd, yyyy')} (${sortedDates.length} days)`;
  };

  const areDatesConsecutive = (dates) => {
    if (!dates || dates.length <= 1) return true;

    const sortedDates = dates
      .map(d => new Date(d))
      .sort((a, b) => a - b);

    for (let i = 1; i < sortedDates.length; i++) {
      const diff = (sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24);
      if (diff !== 1) return false;
    }
    return true;
  };

  const getLeaveTypeColor = (type) => {
    const colors = {
      'Sick Leave': 'border-red-200 bg-red-50',
      'Casual Leave': 'border-amber-200 bg-amber-50',
      'Paid Leave': 'border-emerald-200 bg-emerald-50',
      'Earned Leave': 'border-emerald-200 bg-emerald-50',
      'Unpaid Leave': 'border-amber-200 bg-amber-50',
      'Comp Off': 'border-purple-200 bg-purple-50',
    };
    return colors[type] || 'border-slate-200 bg-slate-50';
  };

  const getLeaveTypeBadgeColor = (type) => {
    const colors = {
      'Sick Leave': 'bg-red-100 text-red-800 border-red-200',
      'Casual Leave': 'bg-amber-100 text-amber-800 border-amber-200',
      'Paid Leave': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'Earned Leave': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'Unpaid Leave': 'bg-amber-100 text-amber-800 border-amber-200',
      'Comp Off': 'bg-purple-100 text-purple-800 border-purple-200',
    };
    return colors[type] || 'bg-slate-100 text-slate-800 border-slate-200';
  };

  const getLeaveTypeCalendarColor = (type) => {
    const colors = {
      'Sick Leave': 'bg-red-500 hover:bg-red-600',
      'Casual Leave': 'bg-slate-900 hover:bg-slate-800',
      'Paid Leave': 'bg-emerald-500 hover:bg-emerald-600',
      'Earned Leave': 'bg-emerald-500 hover:bg-emerald-600',
      'Unpaid Leave': 'bg-amber-500 hover:bg-amber-600',
      'Comp Off': 'bg-purple-500 hover:bg-purple-600',
    };
    return colors[type] || 'bg-slate-500 hover:bg-slate-600';
  };

  const renderCalendar = () => {
    const { daysInMonth, startingDay, year, month } = getDaysInMonth(currentMonth);
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    for (let i = 0; i < startingDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-8 w-8 sm:h-10 sm:w-10"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = formatDateKey(year, month, day);
      const date = new Date(year, month, day);
      const isSelected = !!selectedDates[dateKey];
      const isToday = date.getTime() === today.getTime();
      const isPast = date < today;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const config = selectedDates[dateKey];
      const holidayInfo = getHolidayInfo(dateKey);
      const isHolidayDate = !!holidayInfo;
      const existingLeaveInfo = getExistingLeaveInfo(dateKey);
      const hasLeave = !!existingLeaveInfo;
      const isBlocked = isHolidayDate || hasLeave;

      // Get color based on selected leave type
      const selectedLeaveTypeCalendarColor = isSelected && config?.leaveType
        ? getLeaveTypeCalendarColor(config.leaveType)
        : 'bg-emerald-500 hover:bg-emerald-600';

      const dayButton = (
        <button
          key={day}
          type="button"
          onClick={() => !isBlocked && toggleDateSelection(dateKey)}
          disabled={isBlocked}
          className={`
            h-8 w-8 sm:h-10 sm:w-10 rounded-full text-xs sm:text-sm font-medium transition-all relative
            ${isHolidayDate ? 'bg-rose-100 text-rose-600 cursor-not-allowed border-2 border-rose-300' : ''}
            ${hasLeave && !isHolidayDate ? 'bg-amber-100 text-amber-600 cursor-not-allowed border-2 border-amber-300' : ''}
            ${!isBlocked ? 'cursor-pointer hover:bg-slate-100' : ''}
            ${isToday && !isSelected && !isBlocked ? 'ring-2 ring-amber-400 ring-offset-1' : ''}
            ${isWeekend && !isSelected && !isBlocked ? 'text-slate-400' : ''}
            ${isPast && !isSelected && !isBlocked ? 'text-slate-400' : ''}
            ${isSelected && config?.type === 'full' ? `${selectedLeaveTypeCalendarColor} text-white` : ''}
            ${isSelected && config?.type === 'half' ? `${selectedLeaveTypeCalendarColor} text-white opacity-70` : ''}
          `}
        >
          {day}
          {isSelected && config?.type === 'half' && (
            <span className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 text-[6px] sm:text-[8px]">
              ½
            </span>
          )}
          {isHolidayDate && (
            <Star className="absolute -top-1 -right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 text-rose-500 fill-rose-500" />
          )}
          {hasLeave && !isHolidayDate && (
            <FileText className="absolute -top-1 -right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-600" />
          )}
        </button>
      );

      if (isHolidayDate) {
        days.push(
          <TooltipProvider key={day}>
            <Tooltip>
              <TooltipTrigger asChild>{dayButton}</TooltipTrigger>
              <TooltipContent side="top" className="bg-rose-600 text-white text-xs">
                <p className="font-medium">{holidayInfo.name}</p>
                {holidayInfo.type && (
                  <p className="text-[10px] opacity-80 capitalize">{holidayInfo.type} Holiday</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      } else if (hasLeave) {
        days.push(
          <TooltipProvider key={day}>
            <Tooltip>
              <TooltipTrigger asChild>{dayButton}</TooltipTrigger>
              <TooltipContent side="top" className="bg-slate-900 text-white text-xs">
                <p className="font-medium">{existingLeaveInfo.leave_type}</p>
                <p className="text-[10px] opacity-80">{getStatusDisplayText(existingLeaveInfo.status)}</p>
                {existingLeaveInfo.is_half_day && (
                  <p className="text-[10px] opacity-80 capitalize">Half Day ({existingLeaveInfo.half_day_period})</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      } else {
        days.push(dayButton);
      }
    }

    return (
      <div>
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1 sm:mb-2">
          {dayNames.map((name, idx) => (
            <div key={idx} className="h-6 sm:h-8 w-8 sm:w-10 flex items-center justify-center text-[10px] sm:text-xs font-medium text-slate-500">
              {name}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {days}
        </div>
      </div>
    );
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      manager_approved: 'bg-amber-100 text-amber-800 border-amber-200',
      approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      rejected: 'bg-red-100 text-red-800 border-red-200',
    };
    return statusConfig[status] || statusConfig.pending;
  };

  const getStatusText = (status) => {
    const textMap = {
      pending: 'Pending',
      manager_approved: 'Manager Approved',
      approved: 'Approved',
      rejected: 'Rejected',
    };
    return textMap[status] || status;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const monthNamesShort = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const sortedSelectedDates = Object.keys(selectedDates).sort();

  const currentMonthHolidays = holidays.filter(holiday => {
    const holidayDate = new Date(holiday.date);
    return holidayDate.getMonth() === currentMonth.getMonth() &&
      holidayDate.getFullYear() === currentMonth.getFullYear();
  }).sort((a, b) => new Date(a.date) - new Date(b.date));

  const currentMonthLeaves = leaves.filter(leave => {
    if (leave.status === 'rejected') return false;
    return leave.dates?.some(dateStr => {
      const date = new Date(dateStr);
      return date.getMonth() === currentMonth.getMonth() &&
        date.getFullYear() === currentMonth.getFullYear();
    });
  });

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 sm:mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            My Leaves
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-slate-600">Manage your leave applications</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setSelectedDates({});
            setLeaveForm({ reason: '' });
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="apply-leave-btn" className="bg-slate-800 hover:bg-slate-900 rounded-full text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto">
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
              Apply Leave
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto mx-1 sm:mx-auto p-3 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-xl">Apply for Leave</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6 mt-3 sm:mt-4">
              {/* Default Leave Type Selector */}
              {!loadingTypes && (
                <div className="p-2 sm:p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                    <div className="flex-1">
                      <Label className="text-xs sm:text-sm font-medium">Default Leave Type</Label>
                      <Select
                        value={defaultLeaveType}
                        onValueChange={(value) => setDefaultLeaveType(value)}
                      >
                        <SelectTrigger className="mt-1 text-xs sm:text-sm h-8 sm:h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {leaveTypes.map(type => (
                            <SelectItem key={type.name} value={type.name} className="text-xs sm:text-sm">
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                {type.isCompOff && <Gift className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600" />}
                                <span>{type.name}</span>
                                <span className="text-[10px] sm:text-xs text-slate-500 ml-1 sm:ml-2">
                                  {type.isCompOff ? `(${type.available})` :
                                    type.name === 'Unpaid Leave' ? '(∞)' :
                                      `(${type.available}/${type.quota})`}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {sortedSelectedDates.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={applyLeaveTypeToAll}
                        className="sm:mt-6 text-[10px] sm:text-xs h-7 sm:h-8"
                      >
                        Apply to All
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] sm:text-xs text-slate-500 mt-1.5 sm:mt-2">
                    New dates will use this leave type. Change each day individually below.
                  </p>
                </div>
              )}

              {/* Calendar and Selected Dates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                {/* Calendar */}
                <div>
                  <Label className="mb-2 sm:mb-3 block text-xs sm:text-sm">Select Dates</Label>
                  <div className="bg-slate-50 rounded-lg sm:rounded-xl p-2 sm:p-4 border border-slate-200">
                    <div className="flex items-center justify-between mb-2 sm:mb-4">
                      <Button type="button" variant="ghost" size="icon" onClick={goToPreviousMonth} className="h-7 w-7 sm:h-8 sm:w-8">
                        <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </Button>
                      <span className="font-semibold text-slate-700 text-xs sm:text-base">
                        <span className="sm:hidden">{monthNamesShort[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
                        <span className="hidden sm:inline">{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
                      </span>
                      <Button type="button" variant="ghost" size="icon" onClick={goToNextMonth} className="h-7 w-7 sm:h-8 sm:w-8">
                        <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </Button>
                    </div>

                    {renderCalendar()}

                    {/* Legend */}
                    <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-slate-200 flex flex-wrap gap-2 sm:gap-3 text-[10px] sm:text-xs">
                      <div className="flex items-center gap-1 sm:gap-2">
                        <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-emerald-500"></div>
                        <span className="text-slate-600">Earned</span>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-2">
                        <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-red-500"></div>
                        <span className="text-slate-600">Sick</span>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-2">
                        <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-slate-900"></div>
                        <span className="text-slate-600">Casual</span>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-2">
                        <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-rose-100 border-2 border-rose-300 relative">
                          <Star className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 sm:w-2 sm:h-2 text-rose-500 fill-rose-500" />
                        </div>
                        <span className="text-slate-600">Holiday</span>
                      </div>
                    </div>

                    {currentMonthHolidays.length > 0 && (
                      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-slate-200">
                        <p className="text-[10px] sm:text-xs font-medium text-slate-500 mb-1.5 sm:mb-2">Holidays this month:</p>
                        <div className="space-y-0.5 sm:space-y-1">
                          {currentMonthHolidays.map((holiday, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs">
                              <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-rose-500 fill-rose-500" />
                              <span className="text-rose-600 font-medium">
                                {format(new Date(holiday.date), 'MMM dd')}
                              </span>
                              <span className="text-slate-600 truncate">- {holiday.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected Dates Configuration */}
                <div>
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <Label className="text-xs sm:text-sm">Selected ({calculateTotalDays()} days)</Label>
                    {sortedSelectedDates.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearAllDates}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 h-6 sm:h-7 px-1.5 sm:px-2 text-[10px] sm:text-xs"
                      >
                        <Trash2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 sm:mr-1" />
                        Clear
                      </Button>
                    )}
                  </div>

                  <div className="bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200 min-h-[200px] sm:min-h-[300px] max-h-[250px] sm:max-h-[350px] overflow-y-auto">
                    {sortedSelectedDates.length > 0 ? (
                      <div className="p-1.5 sm:p-2 space-y-1.5 sm:space-y-2">
                        {sortedSelectedDates.map((dateKey) => {
                          const config = selectedDates[dateKey];
                          const date = new Date(dateKey);
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const isPastDate = date < today;

                          // Check if this date's leave type is part of a clubbing conflict
                          const isInConflict = clubbingValidation.errors.some(
                            err => err.type1 === config.leaveType || err.type2 === config.leaveType
                          );

                          return (
                            <div
                              key={dateKey}
                              className={`bg-white rounded-lg p-2 sm:p-3 border-2 shadow-sm ${isInConflict
                                ? 'border-red-500 bg-red-50 ring-2 ring-red-300'
                                : getLeaveTypeColor(config.leaveType)
                                }`}
                            >
                              <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                  <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-slate-400" />
                                  <span className="font-medium text-slate-700 text-xs sm:text-sm">
                                    {format(date, 'EEE, MMM dd')}
                                  </span>
                                  {isPastDate && (
                                    <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[8px] sm:text-xs px-1 sm:px-1.5 py-0">
                                      Past
                                    </Badge>
                                  )}
                                  {isInConflict && (
                                    <Badge className="bg-red-500 text-white text-[8px] sm:text-xs px-1 sm:px-1.5 py-0">
                                      ⚠️
                                    </Badge>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeDate(dateKey)}
                                  className="h-5 w-5 sm:h-6 sm:w-6 text-slate-400 hover:text-red-500"
                                >
                                  <X className="w-3 h-3 sm:w-4 sm:h-4" />
                                </Button>
                              </div>

                              {/* Leave Type Selector for this date */}
                              <div className="mb-1.5 sm:mb-2">
                                <Select
                                  value={config.leaveType}
                                  onValueChange={(value) => updateDateConfig(dateKey, { leaveType: value })}
                                >
                                  <SelectTrigger className={`h-7 sm:h-8 text-[10px] sm:text-xs ${isInConflict ? 'border-red-400 bg-red-50' : 'bg-white'}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {leaveTypes.map(type => {
                                      // Check if selecting this type would cause a conflict
                                      const wouldConflict = Object.entries(selectedDates)
                                        .filter(([key]) => key !== dateKey)
                                        .some(([, cfg]) => {
                                          const restrictions = CLUBBING_RULES[type.name] || [];
                                          const otherRestrictions = CLUBBING_RULES[cfg.leaveType] || [];
                                          return restrictions.includes(cfg.leaveType) || otherRestrictions.includes(type.name);
                                        });

                                      return (
                                        <SelectItem key={type.name} value={type.name} className="text-[10px] sm:text-xs">
                                          <div className="flex items-center gap-1 sm:gap-2">
                                            {type.isCompOff && <Gift className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-purple-600" />}
                                            {wouldConflict && <AlertCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-red-500" />}
                                            <span className={wouldConflict ? 'text-red-600' : ''}>{type.name}</span>
                                            <span className="text-[10px] sm:text-xs text-slate-400">
                                              {type.name === 'Unpaid Leave' ? '∞' : type.available}
                                            </span>
                                          </div>
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Full Day / Half Day Toggle */}
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                <div className="flex bg-slate-100 rounded-lg p-0.5 flex-1">
                                  <button
                                    type="button"
                                    onClick={() => updateDateConfig(dateKey, { type: 'full' })}
                                    className={`flex-1 py-0.5 sm:py-1 px-1.5 sm:px-2 rounded-md text-[10px] sm:text-xs font-medium transition-all flex items-center justify-center gap-0.5 sm:gap-1
                                      ${config.type === 'full'
                                        ? 'bg-white shadow-sm text-slate-900'
                                        : 'text-slate-600 hover:text-slate-900'
                                      }`}
                                  >
                                    <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                    Full
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateDateConfig(dateKey, { type: 'half' })}
                                    className={`flex-1 py-0.5 sm:py-1 px-1.5 sm:px-2 rounded-md text-[10px] sm:text-xs font-medium transition-all flex items-center justify-center gap-0.5 sm:gap-1
                                      ${config.type === 'half'
                                        ? 'bg-white shadow-sm text-slate-900'
                                        : 'text-slate-600 hover:text-slate-900'
                                      }`}
                                  >
                                    <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                    Half
                                  </button>
                                </div>
                              </div>

                              {config.type === 'half' && (
                                <div className="flex gap-1.5 sm:gap-2 mt-1.5 sm:mt-2">
                                  <button
                                    type="button"
                                    onClick={() => updateDateConfig(dateKey, { period: 'morning' })}
                                    className={`flex-1 py-0.5 sm:py-1 px-1.5 sm:px-2 rounded-md text-[10px] sm:text-xs font-medium transition-all flex items-center justify-center gap-0.5 sm:gap-1 border
                                      ${config.period === 'morning'
                                        ? 'bg-amber-100 border-amber-400 text-amber-700'
                                        : 'bg-white border-slate-200 text-slate-600'
                                      }`}
                                  >
                                    <Sun className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                    AM
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateDateConfig(dateKey, { period: 'afternoon' })}
                                    className={`flex-1 py-0.5 sm:py-1 px-1.5 sm:px-2 rounded-md text-[10px] sm:text-xs font-medium transition-all flex items-center justify-center gap-0.5 sm:gap-1 border
                                      ${config.period === 'afternoon'
                                        ? 'bg-amber-100 border-amber-400 text-amber-700'
                                        : 'bg-white border-slate-200 text-slate-600'
                                      }`}
                                  >
                                    <Sunset className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                    PM
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-8 sm:py-12 text-slate-400">
                        <Calendar className="w-8 h-8 sm:w-12 sm:h-12 mb-2 sm:mb-3 opacity-50" />
                        <p className="text-xs sm:text-sm">Click on dates to select</p>
                        <p className="text-[10px] sm:text-xs mt-0.5 sm:mt-1">You can select multiple days</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Balance Summary per Leave Type */}
              {Object.keys(balanceUsage).length > 0 && (
                <div className="p-2 sm:p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <Label className="text-xs sm:text-sm font-medium text-amber-900 mb-1.5 sm:mb-2 block">
                    Leave Balance Summary
                  </Label>
                  <div className="space-y-1 sm:space-y-1.5">
                    {Object.entries(balanceUsage).map(([type, info]) => (
                      <div
                        key={type}
                        className={`flex items-center justify-between text-xs sm:text-sm p-1.5 sm:p-2 rounded ${info.sufficient ? 'bg-white' : 'bg-red-50 border border-red-200'
                          }`}
                      >
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <Badge variant="outline" className={`text-[10px] sm:text-xs px-1 sm:px-2 ${getLeaveTypeBadgeColor(type)}`}>
                            {type}
                          </Badge>
                          <span className="text-slate-600 text-[10px] sm:text-xs">
                            {info.days} day{info.days !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className={`text-[10px] sm:text-xs ${info.sufficient ? 'text-slate-500' : 'text-red-600 font-medium'}`}>
                          {info.isUnpaid ? 'Unlimited' :
                            info.sufficient ? `${info.available} avail` :
                              `Only ${info.available}!`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Past Dates Warning */}
              {pastDatesSelected.length > 0 && (
                <Alert className="bg-orange-50 border-orange-200 p-2 sm:p-4">
                  <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-orange-600" />
                  <AlertTitle className="text-orange-800 text-xs sm:text-sm">Retroactive Leave Application</AlertTitle>
                  <AlertDescription className="text-orange-700 text-[10px] sm:text-sm">
                    You are applying for leave on {pastDatesSelected.length} past date{pastDatesSelected.length > 1 ? 's' : ''}.
                    This may require additional approval from your manager.
                  </AlertDescription>
                </Alert>
              )}

              {/* Clubbing Validation Error - More Prominent */}
              {!clubbingValidation.valid && (
                <Alert variant="destructive" className="bg-red-100 border-2 border-red-500 animate-pulse p-2 sm:p-4">
                  <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-red-600" />
                  <AlertTitle className="text-red-800 text-xs sm:text-base font-bold">⛔ Clubbing Not Allowed!</AlertTitle>
                  <AlertDescription className="text-red-700 text-[10px] sm:text-sm">
                    <ul className="list-disc list-inside space-y-0.5 sm:space-y-1 mt-1 sm:mt-2 font-medium">
                      {clubbingValidation.errors.map((error, idx) => (
                        <li key={idx}>{error.message}</li>
                      ))}
                    </ul>
                    <p className="mt-2 sm:mt-3 text-[10px] sm:text-sm bg-red-200 p-1.5 sm:p-2 rounded">
                      <strong>Action required:</strong> Change leave type or remove a date.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {/* Advance Notice Warnings */}
              {advanceNoticeWarnings.length > 0 && (
                <Alert className="bg-amber-50 border-amber-200 p-2 sm:p-4">
                  <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-600" />
                  <AlertTitle className="text-amber-800 text-xs sm:text-sm">Advance Notice Warning</AlertTitle>
                  <AlertDescription className="text-amber-700 text-[10px] sm:text-sm">
                    <ul className="list-disc list-inside space-y-0.5 sm:space-y-1 mt-0.5 sm:mt-1">
                      {advanceNoticeWarnings.map((warning, idx) => (
                        <li key={idx}>
                          <strong>{warning.leaveType}</strong> requires {warning.required} days notice
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Insufficient Balance Error */}
              {insufficientBalanceTypes.length > 0 && (
                <Alert variant="destructive" className="bg-red-50 border-red-200 p-2 sm:p-4">
                  <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-600" />
                  <AlertTitle className="text-red-800 text-xs sm:text-sm">Insufficient Balance</AlertTitle>
                  <AlertDescription className="text-red-700 text-[10px] sm:text-sm">
                    <ul className="list-disc list-inside space-y-0.5 sm:space-y-1 mt-0.5 sm:mt-1">
                      {insufficientBalanceTypes.map((item, idx) => (
                        <li key={idx}>
                          <strong>{item.type}</strong>: {item.available} avail, {item.requested} requested
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Reason */}
              <div>
                <Label htmlFor="reason" className="text-xs sm:text-sm">Reason</Label>
                <Textarea
                  id="reason"
                  data-testid="reason-textarea"
                  placeholder="Please provide a reason for your leave..."
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  required
                  rows={2}
                  className="mt-1 text-xs sm:text-sm"
                />
              </div>

              {/* Summary */}
              {sortedSelectedDates.length > 0 && (
                <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg sm:rounded-xl p-2.5 sm:p-4 border border-slate-200">
                  <h4 className="font-semibold text-slate-700 mb-1.5 sm:mb-2 text-xs sm:text-sm">Summary</h4>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                    {selectedLeaveTypesSet.map(type => (
                      <Badge key={type} className={`${getLeaveTypeBadgeColor(type)} text-[10px] sm:text-xs`}>
                        {type}: {balanceUsage[type]?.days || 0}d
                      </Badge>
                    ))}
                  </div>
                  <div className="text-xs sm:text-sm text-slate-600">
                    <span className="font-medium text-emerald-600 text-sm sm:text-lg">{calculateTotalDays()} total day{calculateTotalDays() !== 1 ? 's' : ''}</span>
                    {selectedLeaveTypesSet.length > 1 && (
                      <span className="ml-1.5 sm:ml-2 text-slate-500 text-[10px] sm:text-xs">
                        ({selectedLeaveTypesSet.length} types)
                      </span>
                    )}
                    {pastDatesSelected.length > 0 && (
                      <span className="ml-1.5 sm:ml-2 text-orange-600 text-[10px] sm:text-xs">
                        ({pastDatesSelected.length} past)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex gap-2 sm:gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="flex-1 text-xs sm:text-sm h-8 sm:h-10"
                  disabled={submitting}
                >
                  Cancel
                </Button>
                {!clubbingValidation.valid ? (
                  <Button
                    type="button"
                    className="flex-1 bg-red-200 text-red-800 cursor-not-allowed hover:bg-red-200 text-[10px] sm:text-sm h-8 sm:h-10"
                    disabled
                  >
                    ⛔ Fix Error First
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    data-testid="submit-leave-btn"
                    className="flex-1 bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-8 sm:h-10"
                    disabled={
                      submitting ||
                      sortedSelectedDates.length === 0 ||
                      insufficientBalanceTypes.length > 0
                    }
                  >
                    {submitting ? 'Submitting...' : `Submit${selectedLeaveTypesSet.length > 1 ? ` (${selectedLeaveTypesSet.length})` : ''}`}
                  </Button>
                )}
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Leave Balance Summary Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-4">
        {loadingTypes ? (
          <div className="col-span-full text-center py-3 sm:py-4 text-slate-500">
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin mx-auto mb-1.5 sm:mb-2" />
            <span className="text-xs sm:text-sm">Loading balances...</span>
          </div>
        ) : (
          leaveTypes.map(type => {
            const isCompOff = type.isCompOff;
            const isUnlimited = type.isUnlimited || false;
            const isLow = type.available < 3 && type.available > 0 && !isCompOff && !isUnlimited;
            const isEmpty = type.available === 0 && !isUnlimited;
            const isMonthly = type.creditType === 'monthly';
            const annualQuota = isMonthly && type.monthlyCredit > 0
              ? type.monthlyCredit * 12
              : type.quota;

            return (
              <Card
                key={type.name}
                className={`border-2 transition-all ${isEmpty && !isCompOff ? 'border-red-200 bg-red-50' :
                  isLow ? 'border-amber-200 bg-amber-50' :
                    getLeaveTypeColor(type.name)
                  }`}
              >
                <CardContent className="p-2 sm:p-4">
                  <div className="flex items-center gap-1 sm:gap-2 mb-0.5 sm:mb-1">
                    {isCompOff && <Gift className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600" />}
                    <p className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase tracking-wider truncate">
                      {type.name.replace(' Leave', '')}
                    </p>
                  </div>
                  <p className={`text-lg sm:text-2xl font-bold ${isEmpty && !isCompOff ? 'text-red-700' :
                    isLow ? 'text-amber-700' :
                      'text-slate-900'
                    }`}>
                    {isUnlimited ? '∞' : type.available}
                  </p>
                  <p className="text-[10px] sm:text-xs text-slate-500">
                    {isCompOff ? 'available' :
                      isUnlimited ? 'unlimited' :
                        isMonthly ? `/${annualQuota}/yr` :
                          `/${type.quota}/yr`}
                  </p>
                  {isMonthly && type.monthlyCredit > 0 && (
                    <Badge variant="outline" className="mt-1 sm:mt-2 text-[8px] sm:text-xs bg-emerald-50 text-emerald-700 border-emerald-200 px-1 sm:px-2">
                      +{type.monthlyCredit}/mo
                    </Badge>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Leave Policy Quick Info */}
      <Card className="border-slate-100 shadow-sm bg-gradient-to-r from-amber-50 to-amber-50">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start gap-2 sm:gap-3">
            <Info className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-amber-900 mb-1.5 sm:mb-2 text-xs sm:text-sm">Leave Policy</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-[10px] sm:text-sm text-amber-800">
                {leaveTypes.filter(t => !t.isCompOff && t.name !== 'Unpaid Leave').slice(0, 3).map(type => (
                  <div key={type.name}>
                    <p className="font-medium truncate flex items-center gap-1">
                      {type.name === 'Earned Leave' && <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-amber-600 shrink-0" />}
                      {type.name === 'Sick Leave' && <Stethoscope className="w-3 h-3 sm:w-4 sm:h-4 text-amber-600 shrink-0" />}
                      {type.name === 'Casual Leave' && <Target className="w-3 h-3 sm:w-4 sm:h-4 text-amber-600 shrink-0" />}
                      <span>{type.name}</span>
                    </p>
                    <p className="text-[10px] sm:text-xs text-amber-600">
                      {type.creditType === 'monthly'
                        ? `${type.monthlyCredit}d/mo`
                        : `${type.quota}d/yr`}
                      {type.advanceDaysRequired > 0 && ` • ${type.advanceDaysRequired}d advance`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Leaves List */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="p-3 sm:p-6">
          <CardTitle className="text-lg sm:text-xl md:text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Leave History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
          {leaves.length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {leaves.map((leave) => (
                <div
                  key={leave.id}
                  data-testid={`leave-item-${leave.id}`}
                  className={`p-3 sm:p-5 rounded-lg sm:rounded-xl hover:shadow-md transition-all border-2 ${getLeaveTypeColor(leave.leave_type)}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-2 sm:mb-3 gap-2">
                    <div>
                      <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2 flex-wrap">
                        {leave.leave_type === 'Comp Off' && (
                          <Gift className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600" />
                        )}
                        <h3 className="font-semibold text-slate-900 text-sm sm:text-base">{leave.leave_type}</h3>
                        <Badge className={`${getStatusBadge(leave.status)} text-[10px] sm:text-xs`}>{getStatusText(leave.status)}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-slate-600 flex-wrap">
                        <Calendar className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="truncate">{formatLeaveDates(leave.dates)}</span>
                        <span className="text-slate-400">•</span>
                        <span>{leave.days_count}d</span>
                        {leave.is_half_day && (
                          <Badge variant="outline" className="text-[10px] sm:text-xs bg-amber-50 text-amber-700 border-amber-200 px-1 sm:px-2">
                            Half ({leave.half_day_period})
                          </Badge>
                        )}
                      </div>
                      {leave.dates && leave.dates.length > 1 && !areDatesConsecutive(leave.dates) && (
                        <div className="mt-1.5 sm:mt-2 flex flex-wrap gap-1">
                          {leave.dates
                            .map(d => new Date(d))
                            .sort((a, b) => a - b)
                            .map((date, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className="text-[10px] sm:text-xs bg-slate-100 text-slate-600 border-slate-200 px-1 sm:px-2"
                              >
                                {format(date, 'MMM dd')}
                              </Badge>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="bg-white/70 p-2 sm:p-3 rounded-lg border border-slate-200">
                    <p className="text-[11px] sm:text-sm text-slate-600">
                      <span className="font-medium text-slate-700">Reason: </span>
                      {leave.reason}
                    </p>
                  </div>
                  {leave.approvals && leave.approvals.length > 0 && (
                    <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-slate-200">
                      <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 sm:mb-2">Approval History</p>
                      <div className="space-y-1.5 sm:space-y-2">
                        {leave.approvals.map((approval, idx) => (
                          <div key={idx} className="text-[11px] sm:text-sm">
                            <span className="font-medium text-slate-700">{approval.approver_name}</span>
                            <span className="text-slate-500"> ({approval.approver_role}) </span>
                            <span className={approval.action === 'approve' ? 'text-emerald-600' : 'text-red-600'}>
                              {approval.action === 'approve' ? 'approved' : 'rejected'}
                            </span>
                            {approval.comments && (
                              <p className="text-slate-600 mt-0.5 sm:mt-1">Comment: {approval.comments}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 sm:py-12 text-slate-500">
              <Calendar className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-slate-300" />
              <p className="text-sm sm:text-lg mb-1.5 sm:mb-2">No leave applications yet</p>
              <p className="text-xs sm:text-sm">Click &quot;Apply Leave&quot; to submit your first application</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LeavesPage;
