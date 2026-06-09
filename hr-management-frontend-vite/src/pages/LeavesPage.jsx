import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Calendar, X, Gift, AlertCircle, Clock, AlertTriangle, Info, CheckCircle2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format, eachDayOfInterval, differenceInDays, addDays } from 'date-fns';

const LeavesPage = () => {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState({});
  const [compOffBalance, setCompOffBalance] = useState(0);
  const [leavePolicy, setLeavePolicy] = useState(null);
  const [joiningDate, setJoiningDate] = useState(null);

  // Validation states
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);
  const [isValidating, setIsValidating] = useState(false);
  const [forceSubmit, setForceSubmit] = useState(false);

  // NEW: Per-day leave type selection
  // Format: { '2024-01-07': 'Earned Leave', '2024-01-08': 'Casual Leave', ... }
  const [dateLeaveTypes, setDateLeaveTypes] = useState({});
  const [defaultLeaveType, setDefaultLeaveType] = useState('Earned Leave');

  const [leaveForm, setLeaveForm] = useState({
    dates: [],
    reason: '',
    is_half_day: false,
    half_day_period: 'morning',
  });

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchLeaves();
    fetchProfile();
    loadLeavePolicy();
  }, []);

  const loadLeavePolicy = async () => {
    try {
      const response = await api.get('/leaves/leave-policy');
      setLeavePolicy(response.data);

      if (response.data?.policies) {
        const types = response.data.policies.map(p => ({
          name: p.leave_type,
          quota: p.annual_quota,
          credit_type: p.credit_type || 'annually',
          monthly_credit: p.monthly_credit || 0,
          advance_days_required: p.advance_days_required || 0,
          encashment_allowed: p.encashment_allowed || false,
          carry_forward_allowed: p.carry_forward_allowed || false,
          clubbing_not_allowed_with: p.clubbing_not_allowed_with || []
        }));

        // Add Comp Off if not present
        if (!types.find(t => t.name.toLowerCase().includes('comp'))) {
          types.push({
            name: 'Comp Off',
            quota: 0,
            credit_type: 'earned',
            advance_days_required: 0,
            encashment_allowed: false,
            carry_forward_allowed: true,
            clubbing_not_allowed_with: []
          });
        }
        setLeaveTypes(types);
      }
    } catch (error) {
      console.error('Failed to load leave policy:', error);
      setLeaveTypes([
        { name: 'Earned Leave', quota: 12, credit_type: 'monthly', monthly_credit: 1, advance_days_required: 7, clubbing_not_allowed_with: [] },
        { name: 'Sick Leave', quota: 6, credit_type: 'monthly', monthly_credit: 0.5, advance_days_required: 0, clubbing_not_allowed_with: ['Casual Leave'] },
        { name: 'Casual Leave', quota: 6, credit_type: 'annually', advance_days_required: 0, clubbing_not_allowed_with: ['Sick Leave'] },
        { name: 'Unpaid Leave', quota: 0, credit_type: 'annually', advance_days_required: 0, clubbing_not_allowed_with: [] },
        { name: 'Comp Off', quota: 0, credit_type: 'earned', advance_days_required: 0, clubbing_not_allowed_with: [] }
      ]);
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

  const fetchProfile = async () => {
    try {
      const response = await api.get('/auth/me');
      setLeaveBalance(response.data.leave_balance || {});
      setCompOffBalance(response.data.leave_balance?.comp_off || 0);
      setJoiningDate(response.data.joining_date ? new Date(response.data.joining_date) : null);
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    }
  };

  // Get unique leave types selected across all dates
  const selectedLeaveTypes = useMemo(() => {
    const types = new Set(Object.values(dateLeaveTypes));
    return Array.from(types);
  }, [dateLeaveTypes]);

  // Check clubbing rules between selected leave types
  const clubbingValidation = useMemo(() => {
    const errors = [];
    const types = selectedLeaveTypes;

    if (types.length < 2) return { valid: true, errors: [] };

    // Check each pair of leave types
    for (let i = 0; i < types.length; i++) {
      for (let j = i + 1; j < types.length; j++) {
        const type1 = types[i];
        const type2 = types[j];

        const type1Info = leaveTypes.find(t => t.name === type1);
        const type2Info = leaveTypes.find(t => t.name === type2);

        // Check if type1 cannot be clubbed with type2
        if (type1Info?.clubbing_not_allowed_with?.includes(type2)) {
          errors.push({
            type1,
            type2,
            message: `${type1} cannot be clubbed with ${type2}`
          });
        }
        // Check reverse - if type2 cannot be clubbed with type1
        else if (type2Info?.clubbing_not_allowed_with?.includes(type1)) {
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
  }, [selectedLeaveTypes, leaveTypes]);

  // Calculate balance usage per leave type
  const balanceUsage = useMemo(() => {
    const usage = {};

    Object.entries(dateLeaveTypes).forEach(([date, type]) => {
      if (!usage[type]) {
        usage[type] = { days: 0, dates: [] };
      }
      // For half day, only count 0.5 if it's single date and half day selected
      const dayValue = leaveForm.is_half_day && leaveForm.dates.length === 1 ? 0.5 : 1;
      usage[type].days += dayValue;
      usage[type].dates.push(date);
    });

    // Add balance info
    Object.keys(usage).forEach(type => {
      const key = type.toLowerCase().replace(/ /g, '_');
      usage[type].available = leaveBalance[key] ?? 0;
      usage[type].sufficient = usage[type].available >= usage[type].days;
    });

    return usage;
  }, [dateLeaveTypes, leaveBalance, leaveForm.is_half_day, leaveForm.dates.length]);

  // Check for insufficient balance
  const insufficientBalanceTypes = useMemo(() => {
    return Object.entries(balanceUsage)
      .filter(([type, info]) => {
        // Skip unpaid leave
        if (type.toLowerCase().includes('unpaid')) return false;
        return !info.sufficient;
      })
      .map(([type, info]) => ({
        type,
        available: info.available,
        requested: info.days
      }));
  }, [balanceUsage]);

  // Validate advance notice for all selected leave types
  const advanceNoticeWarnings = useMemo(() => {
    const warnings = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    Object.entries(dateLeaveTypes).forEach(([dateStr, leaveType]) => {
      const typeInfo = leaveTypes.find(t => t.name === leaveType);
      if (!typeInfo || !typeInfo.advance_days_required) return;

      const leaveDate = new Date(dateStr);
      leaveDate.setHours(0, 0, 0, 0);

      const diffDays = Math.ceil((leaveDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays < typeInfo.advance_days_required) {
        // Check if we already have this warning
        const existingWarning = warnings.find(w => w.leaveType === leaveType);
        if (!existingWarning) {
          warnings.push({
            leaveType,
            required: typeInfo.advance_days_required,
            dates: [dateStr]
          });
        } else {
          existingWarning.dates.push(dateStr);
        }
      }
    });

    return warnings;
  }, [dateLeaveTypes, leaveTypes]);

  const handleDateRangeChange = () => {
    if (!startDate || !endDate) {
      setLeaveForm(prev => ({ ...prev, dates: [] }));
      setDateLeaveTypes({});
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end < start) {
      toast.error('End date cannot be before start date');
      return;
    }

    const dates = eachDayOfInterval({ start, end });
    const dateStrings = dates.map(d => format(d, 'yyyy-MM-dd'));

    // Initialize leave types for new dates with default type
    const newDateLeaveTypes = {};
    dateStrings.forEach(dateStr => {
      newDateLeaveTypes[dateStr] = dateLeaveTypes[dateStr] || defaultLeaveType;
    });

    setLeaveForm(prev => ({ ...prev, dates: dateStrings }));
    setDateLeaveTypes(newDateLeaveTypes);
  };

  useEffect(() => {
    handleDateRangeChange();
  }, [startDate, endDate]);

  // Update leave type for a specific date
  const updateDateLeaveType = (dateStr, leaveType) => {
    setDateLeaveTypes(prev => ({
      ...prev,
      [dateStr]: leaveType
    }));
  };

  // Apply a leave type to all dates
  const applyLeaveTypeToAll = (leaveType) => {
    const newDateLeaveTypes = {};
    leaveForm.dates.forEach(dateStr => {
      newDateLeaveTypes[dateStr] = leaveType;
    });
    setDateLeaveTypes(newDateLeaveTypes);
    setDefaultLeaveType(leaveType);
  };

  const toggleDate = (dateStr) => {
    setLeaveForm(prev => {
      const exists = prev.dates.includes(dateStr);
      const newDates = exists
        ? prev.dates.filter(d => d !== dateStr)
        : [...prev.dates, dateStr].sort();

      // Update dateLeaveTypes accordingly
      if (exists) {
        setDateLeaveTypes(prevTypes => {
          const newTypes = { ...prevTypes };
          delete newTypes[dateStr];
          return newTypes;
        });
      } else {
        setDateLeaveTypes(prevTypes => ({
          ...prevTypes,
          [dateStr]: defaultLeaveType
        }));
      }

      return { ...prev, dates: newDates };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (leaveForm.dates.length === 0) {
      toast.error('Please select at least one date');
      return;
    }

    // Check clubbing validation
    if (!clubbingValidation.valid) {
      toast.error(clubbingValidation.errors[0].message);
      return;
    }

    // Check balance for all types
    if (insufficientBalanceTypes.length > 0) {
      const first = insufficientBalanceTypes[0];
      toast.error(`Insufficient ${first.type} balance. Available: ${first.available}, Requested: ${first.requested}`);
      return;
    }

    setSubmitting(true);

    try {
      // Group dates by leave type
      const leaveGroups = {};
      Object.entries(dateLeaveTypes).forEach(([dateStr, leaveType]) => {
        if (!leaveGroups[leaveType]) {
          leaveGroups[leaveType] = [];
        }
        leaveGroups[leaveType].push(dateStr);
      });

      // Submit separate leave applications for each leave type
      const submissions = Object.entries(leaveGroups).map(async ([leaveType, dates]) => {
        const payload = {
          leave_type: leaveType,
          dates: dates.sort(),
          reason: leaveForm.reason,
          is_half_day: leaveForm.is_half_day && dates.length === 1,
          half_day_period: leaveForm.half_day_period,
          force_submit: forceSubmit
        };

        return api.post('/leaves', payload);
      });

      await Promise.all(submissions);

      const count = Object.keys(leaveGroups).length;
      toast.success(
        count > 1
          ? `${count} leave applications submitted successfully!`
          : 'Leave application submitted successfully!'
      );

      setDialogOpen(false);
      resetForm();
      fetchLeaves();
      fetchProfile();
    } catch (error) {
      const errorData = error.response?.data;

      if (errorData?.can_override && errorData?.warning_type === 'advance_notice') {
        toast.warning(errorData.detail, {
          action: {
            label: 'Submit Anyway',
            onClick: () => {
              setForceSubmit(true);
              setTimeout(() => {
                document.getElementById('leave-submit-btn')?.click();
              }, 100);
            }
          },
          duration: 10000
        });
      } else {
        toast.error(errorData?.detail || 'Failed to submit leave application');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setLeaveForm({
      dates: [],
      reason: '',
      is_half_day: false,
      half_day_period: 'morning',
    });
    setStartDate('');
    setEndDate('');
    setDateLeaveTypes({});
    setDefaultLeaveType('Earned Leave');
    setValidationWarnings([]);
    setValidationErrors([]);
    setForceSubmit(false);
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: 'bg-amber-100 text-amber-800',
      manager_approved: 'bg-amber-100 text-amber-800',
      approved: 'bg-emerald-100 text-emerald-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return statusMap[status] || 'bg-slate-100 text-slate-800';
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

  const formatDates = (dates) => {
    if (!dates || dates.length === 0) return 'No dates';

    const sortedDates = dates.map(d => new Date(d)).sort((a, b) => a - b);

    if (sortedDates.length === 1) {
      return format(sortedDates[0], 'MMM dd, yyyy');
    }

    if (sortedDates.length === 2) {
      return `${format(sortedDates[0], 'MMM dd')} & ${format(sortedDates[1], 'MMM dd, yyyy')}`;
    }

    let isConsecutive = true;
    for (let i = 1; i < sortedDates.length; i++) {
      const diff = differenceInDays(sortedDates[i], sortedDates[i - 1]);
      if (diff > 1) {
        isConsecutive = false;
        break;
      }
    }

    if (isConsecutive) {
      return `${format(sortedDates[0], 'MMM dd')} - ${format(sortedDates[sortedDates.length - 1], 'MMM dd, yyyy')}`;
    }

    if (sortedDates.length <= 3) {
      return sortedDates.map(d => format(d, 'MMM dd')).join(', ');
    }

    return `${format(sortedDates[0], 'MMM dd')} - ${format(sortedDates[sortedDates.length - 1], 'MMM dd')} (${sortedDates.length} days)`;
  };

  const getAvailableBalance = (leaveType) => {
    const key = leaveType.toLowerCase().replace(/ /g, '_');
    return leaveBalance[key] ?? 0;
  };

  const getLeaveTypeInfo = (leaveTypeName) => {
    return leaveTypes.find(t => t.name === leaveTypeName) || {};
  };

  const getMinDate = () => {
    // Use the minimum advance notice from default type or allow from today
    return format(new Date(), 'yyyy-MM-dd');
  };

  // Calculate accrued balance for monthly-credited leaves
  const calculateAccruedBalance = (monthlyCredit) => {
    if (!joiningDate || !monthlyCredit) return 0;

    const now = new Date();
    const joining = new Date(joiningDate);

    let months = (now.getFullYear() - joining.getFullYear()) * 12;
    months += now.getMonth() - joining.getMonth();

    if (now.getDate() < joining.getDate()) {
      months--;
    }

    months = Math.max(0, months);

    return Math.round(months * monthlyCredit * 10) / 10;
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
            My Leavesaaaaaaaaaaaaaaaaaaa
          </h1>
          <p className="text-lg text-slate-600">Manage your leave applications</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="apply-leave-btn" className="bg-slate-800 hover:bg-slate-900 rounded-full">
              <Plus className="w-4 h-4 mr-2" />
              Apply Leaveiiiiiii
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Apply for Leave</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              {/* Date Selection */}
              <div>
                <Label>Select Date Range</Label>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <Label className="text-xs text-slate-500">Start Date</Label>
                    <Input
                      id="start-date"
                      data-testid="start-date-input"
                      type="date"
                      value={startDate}
                      min={getMinDate()}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">End Date</Label>
                    <Input
                      id="end-date"
                      data-testid="end-date-input"
                      type="date"
                      value={endDate}
                      min={startDate || getMinDate()}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>

              {/* Default Leave Type & Apply to All */}
              {leaveForm.dates.length > 0 && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <Label className="text-sm font-medium">Default Leave Type</Label>
                      <Select
                        value={defaultLeaveType}
                        onValueChange={(value) => setDefaultLeaveType(value)}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {leaveTypes.map(type => (
                            <SelectItem key={type.name} value={type.name}>
                              <span className="flex items-center gap-2">
                                {type.name.toLowerCase().includes('comp') && <Gift className="w-4 h-4 text-purple-600" />}
                                {type.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => applyLeaveTypeToAll(defaultLeaveType)}
                      className="mt-6"
                    >
                      Apply to All Days
                    </Button>
                  </div>
                </div>
              )}

              {/* Per-Day Leave Type Selection */}
              {leaveForm.dates.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">
                      Leave Type per Day
                      <span className="text-slate-400 font-normal ml-2">
                        ({leaveForm.dates.length} day{leaveForm.dates.length !== 1 ? 's' : ''} selected)
                      </span>
                    </Label>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-white">
                    {leaveForm.dates.map((dateStr, idx) => {
                      const currentType = dateLeaveTypes[dateStr] || defaultLeaveType;
                      const typeInfo = getLeaveTypeInfo(currentType);
                      const balance = getAvailableBalance(currentType);

                      return (
                        <div
                          key={dateStr}
                          className={`flex items-center gap-3 p-2 rounded-lg border ${getLeaveTypeColor(currentType)} transition-all`}
                        >
                          <div className="flex-shrink-0 w-24">
                            <p className="text-sm font-medium text-slate-900">
                              {format(new Date(dateStr), 'EEE')}
                            </p>
                            <p className="text-xs text-slate-500">
                              {format(new Date(dateStr), 'MMM dd')}
                            </p>
                          </div>

                          <div className="flex-1">
                            <Select
                              value={currentType}
                              onValueChange={(value) => updateDateLeaveType(dateStr, value)}
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {leaveTypes.map(type => {
                                  const typeBalance = getAvailableBalance(type.name);
                                  const isUnpaid = type.name.toLowerCase().includes('unpaid');

                                  return (
                                    <SelectItem key={type.name} value={type.name}>
                                      <div className="flex items-center justify-between w-full">
                                        <span className="flex items-center gap-2">
                                          {type.name.toLowerCase().includes('comp') && (
                                            <Gift className="w-3 h-3 text-purple-600" />
                                          )}
                                          {type.name}
                                        </span>
                                        <span className="text-xs text-slate-400 ml-2">
                                          {isUnpaid ? '∞' : typeBalance}
                                        </span>
                                      </div>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => toggleDate(dateStr)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Balance Summary per Leave Type */}
              {Object.keys(balanceUsage).length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <Label className="text-sm font-medium text-amber-900 mb-2 block">
                    Leave Balance Summary
                  </Label>
                  <div className="space-y-1.5">
                    {Object.entries(balanceUsage).map(([type, info]) => {
                      const isUnpaid = type.toLowerCase().includes('unpaid');
                      const hasEnough = isUnpaid || info.sufficient;

                      return (
                        <div
                          key={type}
                          className={`flex items-center justify-between text-sm p-2 rounded ${hasEnough ? 'bg-white' : 'bg-red-50 border border-red-200'
                            }`}
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs ${getLeaveTypeBadgeColor(type)}`}>
                              {type}
                            </Badge>
                            <span className="text-slate-600">
                              {info.days} day{info.days !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className={`text-xs ${hasEnough ? 'text-slate-500' : 'text-red-600 font-medium'}`}>
                            {isUnpaid ? (
                              'Unlimited'
                            ) : hasEnough ? (
                              `${info.available} available`
                            ) : (
                              `Only ${info.available} available!`
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Clubbing Validation Error */}
              {!clubbingValidation.valid && (
                <Alert variant="destructive" className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertTitle className="text-red-800">Clubbing Not Allowed</AlertTitle>
                  <AlertDescription className="text-red-700">
                    <ul className="list-disc list-inside space-y-1 mt-1">
                      {clubbingValidation.errors.map((error, idx) => (
                        <li key={idx}>{error.message}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-sm">
                      Please select different leave types or dates to resolve this conflict.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {/* Advance Notice Warnings */}
              {advanceNoticeWarnings.length > 0 && (
                <Alert className="bg-amber-50 border-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-800">Advance Notice Warning</AlertTitle>
                  <AlertDescription className="text-amber-700">
                    <ul className="list-disc list-inside space-y-1 mt-1">
                      {advanceNoticeWarnings.map((warning, idx) => (
                        <li key={idx}>
                          <strong>{warning.leaveType}</strong> requires {warning.required} days advance notice
                          ({warning.dates.length} date{warning.dates.length > 1 ? 's' : ''} affected)
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-sm">You can still submit, but approval may be affected.</p>
                  </AlertDescription>
                </Alert>
              )}

              {/* Insufficient Balance Error */}
              {insufficientBalanceTypes.length > 0 && (
                <Alert variant="destructive" className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertTitle className="text-red-800">Insufficient Balance</AlertTitle>
                  <AlertDescription className="text-red-700">
                    <ul className="list-disc list-inside space-y-1 mt-1">
                      {insufficientBalanceTypes.map((item, idx) => (
                        <li key={idx}>
                          <strong>{item.type}</strong>: Available {item.available} days, Requested {item.requested} days
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Half Day Option - Only for single date */}
              {leaveForm.dates.length === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <input
                      id="is-half-day"
                      type="checkbox"
                      checked={leaveForm.is_half_day}
                      onChange={(e) => setLeaveForm({ ...leaveForm, is_half_day: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    <Label htmlFor="is-half-day" className="text-sm font-medium">
                      Half Day Leave
                    </Label>
                  </div>
                  {leaveForm.is_half_day && (
                    <div>
                      <Label htmlFor="half-day-period">Half Day Period</Label>
                      <Select
                        value={leaveForm.half_day_period}
                        onValueChange={(value) => setLeaveForm({ ...leaveForm, half_day_period: value })}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="morning">Morning</SelectItem>
                          <SelectItem value="afternoon">Afternoon</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="reason">Reason</Label>
                <Textarea
                  id="reason"
                  data-testid="reason-textarea"
                  placeholder="Please provide a reason for your leave..."
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  required
                  rows={3}
                  className="mt-1"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    resetForm();
                  }}
                  className="flex-1"
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  id="leave-submit-btn"
                  type="submit"
                  data-testid="submit-leave-btn"
                  className="flex-1 bg-slate-800 hover:bg-slate-900"
                  disabled={
                    submitting ||
                    leaveForm.dates.length === 0 ||
                    !clubbingValidation.valid ||
                    insufficientBalanceTypes.length > 0
                  }
                >
                  {submitting ? 'Submitting...' : `Submit${selectedLeaveTypes.length > 1 ? ` (${selectedLeaveTypes.length} types)` : ''}`}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Leave Balance Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {leaveTypes.map(type => {
          const key = type.name.toLowerCase().replace(/ /g, '_');
          const balance = leaveBalance[key] ?? 0;
          const isCompOff = type.name.toLowerCase().includes('comp');
          const isUnpaid = type.name.toLowerCase().includes('unpaid');
          const isMonthly = type.credit_type === 'monthly';

          const annualQuota = isMonthly && type.monthly_credit > 0
            ? type.monthly_credit * 12
            : type.quota;

          return (
            <Card key={type.name} className={`border ${getLeaveTypeColor(type.name)}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  {isCompOff && <Gift className="w-4 h-4 text-purple-600" />}
                  <p className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                    {type.name}
                  </p>
                </div>
                <p className="text-2xl font-bold text-slate-900">
                  {isUnpaid ? '∞' : balance}
                </p>
                <p className="text-xs text-slate-500">
                  {isCompOff
                    ? 'days available'
                    : isUnpaid
                      ? 'unlimited'
                      : isMonthly
                        ? `of ${annualQuota} days/year`
                        : (type.quota > 0 ? `of ${type.quota} days/year` : 'days taken')
                  }
                </p>
                {isMonthly && type.monthly_credit > 0 && (
                  <Badge variant="outline" className="mt-2 text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                    +{type.monthly_credit}/month
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Leave Policy Quick Info */}
      <Card className="border-slate-100 shadow-sm bg-gradient-to-r from-amber-50 to-amber-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-2">Leave Policy Highlights</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-amber-800">
                {leaveTypes.filter(t => !t.name.toLowerCase().includes('comp') && !t.name.toLowerCase().includes('unpaid')).slice(0, 3).map(type => (
                  <div key={type.name}>
                    <p className="font-medium">
                      {type.name === 'Earned Leave' && '📅'}
                      {type.name === 'Sick Leave' && '🏥'}
                      {type.name === 'Casual Leave' && '🎯'}
                      {' '}{type.name}
                    </p>
                    <p className="text-xs text-amber-600">
                      {type.credit_type === 'monthly'
                        ? `${type.monthly_credit} day/month`
                        : `${type.quota} days/year`}
                      {type.advance_days_required > 0 && ` • ${type.advance_days_required} days advance`}
                      {type.clubbing_not_allowed_with?.length > 0 && (
                        <span className="text-red-600"> • No club with {type.clubbing_not_allowed_with.join(', ')}</span>
                      )}
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
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Leave History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leaves.length > 0 ? (
            <div className="space-y-3">
              {leaves.map((leave) => (
                <div
                  key={leave.id}
                  data-testid={`leave-item-${leave.id}`}
                  className={`p-5 rounded-xl hover:shadow-md transition-all border-2 ${getLeaveTypeColor(leave.leave_type)}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        {leave.leave_type === 'Comp Off' && (
                          <Gift className="w-4 h-4 text-purple-600" />
                        )}
                        <h3 className="font-semibold text-slate-900">{leave.leave_type}</h3>
                        <Badge className={getStatusBadge(leave.status)}>{getStatusText(leave.status)}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Calendar className="w-4 h-4" />
                        <span>{formatDates(leave.dates)}</span>
                        <span className="text-slate-400">•</span>
                        <span>{leave.days_count} day{leave.days_count > 1 ? 's' : ''}</span>
                        {leave.is_half_day && (
                          <span className="text-slate-400"> • Half Day ({leave.half_day_period})</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/70 p-3 rounded-lg border border-slate-200">
                    <p className="text-sm text-slate-600">
                      <span className="font-medium text-slate-700">Reason: </span>
                      {leave.reason}
                    </p>
                  </div>
                  {leave.approvals && leave.approvals.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Approval History</p>
                      <div className="space-y-2">
                        {leave.approvals.map((approval, idx) => (
                          <div key={idx} className="text-sm">
                            <span className="font-medium text-slate-700">{approval.approver_name}</span>
                            <span className="text-slate-500"> ({approval.approver_role}) </span>
                            <span className={approval.action === 'approve' ? 'text-emerald-600' : 'text-red-600'}>
                              {approval.action === 'approve' ? 'approved' : approval.action === 'reject' ? 'rejected' : approval.action}
                            </span>
                            {approval.comments && (
                              <p className="text-slate-600 mt-1">Comment: {approval.comments}</p>
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
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <p className="text-lg mb-2">No leave applications yet</p>
              <p className="text-sm">Click &quot;Apply Leave&quot; to submit your first application</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LeavesPage;
