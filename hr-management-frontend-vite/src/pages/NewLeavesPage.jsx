import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, X, Clock, Sun, Sunset, Trash2, Star, FileText, Gift, AlertCircle, Loader2, AlertTriangle, Info, Download, Layers, CalendarPlus, Plane, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { exportCsv } from '@/lib/exportCsv';
import ApprovalChain from '@/modules/leave/components/ApprovalChain';
import { fmtKey, toDateKey, creditLabel, leaveKey, keyToLocalDate, isCompOffKey } from '@/modules/leave/lib';
import PageHeader, { PageShell } from '@/modules/platform/components/PageHeader';
import { StatusBadge, IconTile, Segmented } from '@/components/ds';

// Public holidays close the office; optional / restricted ones can be taken as leave (Restricted Holiday quota)
const isOptionalHoliday = (h) => h && ['optional', 'restricted'].includes(h.type);
const groupKeyOf = (config) => `${config.leaveType}__${config.type === 'full' ? 'full' : `half_${config.period}`}`;

// Leave type → colour from the Figma palette (dot in tables, filled day in the calendar, tinted chip).
const TYPE_TONES = {
  casual_leave: { dot: 'bg-info-solid', fill: 'bg-info-solid hover:bg-info-fg', soft: 'border-info-solid/30 bg-info-bg', chip: 'bg-info-bg text-info-fg' },
  sick_leave: { dot: 'bg-danger-solid', fill: 'bg-danger-solid hover:bg-danger-fg', soft: 'border-danger-solid/30 bg-danger-bg', chip: 'bg-danger-bg text-danger-fg' },
  earned_leave: { dot: 'bg-success-solid', fill: 'bg-success-solid hover:bg-success-fg', soft: 'border-success-solid/30 bg-success-bg', chip: 'bg-success-bg text-success-fg' },
  paid_leave: { dot: 'bg-success-solid', fill: 'bg-success-solid hover:bg-success-fg', soft: 'border-success-solid/30 bg-success-bg', chip: 'bg-success-bg text-success-fg' },
  comp_off: { dot: 'bg-violet-fg', fill: 'bg-violet-fg hover:bg-violet-fg/90', soft: 'border-violet-fg/20 bg-violet-bg', chip: 'bg-violet-bg text-violet-fg' },
  unpaid_leave: { dot: 'bg-warning-solid', fill: 'bg-warning-solid hover:bg-warning-fg', soft: 'border-warning-solid/30 bg-warning-bg', chip: 'bg-warning-bg text-warning-fg' },
  restricted_holiday: { dot: 'bg-brand', fill: 'bg-brand-text hover:bg-brand-text/90', soft: 'border-brand/40 bg-brand-subtle', chip: 'bg-brand-subtle text-brand-text' },
  maternity_leave: { dot: 'bg-teal-solid', fill: 'bg-teal-solid hover:bg-teal-fg', soft: 'border-teal-solid/30 bg-teal-bg', chip: 'bg-teal-bg text-teal-fg' },
  paternity_leave: { dot: 'bg-teal-solid', fill: 'bg-teal-solid hover:bg-teal-fg', soft: 'border-teal-solid/30 bg-teal-bg', chip: 'bg-teal-bg text-teal-fg' },
};
const NEUTRAL_TONE = { dot: 'bg-ink-muted', fill: 'bg-ink-secondary hover:bg-ink', soft: 'border-line bg-canvas', chip: 'bg-subtle text-ink-secondary' };
const typeTone = (name) => TYPE_TONES[leaveKey(name)] || NEUTRAL_TONE;

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// "14 – 16 Oct 2026", "29 Sep 2026", "28 Sep – 02 Oct 2026"
const compactDates = (dates) => {
  const keys = (dates || []).map(toDateKey).filter(Boolean).sort();
  if (!keys.length) return '—';
  const first = keyToLocalDate(keys[0]);
  const last = keyToLocalDate(keys[keys.length - 1]);
  if (keys.length === 1 || keys[0] === keys[keys.length - 1]) return format(first, 'dd MMM yyyy');
  if (first.getFullYear() !== last.getFullYear()) return `${format(first, 'dd MMM yyyy')} – ${format(last, 'dd MMM yyyy')}`;
  if (first.getMonth() !== last.getMonth()) return `${format(first, 'dd MMM')} – ${format(last, 'dd MMM yyyy')}`;
  return `${format(first, 'dd')} – ${format(last, 'dd MMM yyyy')}`;
};

// Who the request sits with (pending) or who acted on it last.
const approverOf = (leave) => {
  const chain = Array.isArray(leave.approval_chain) ? leave.approval_chain : [];
  if (leave.status === 'pending' || leave.status === 'manager_approved') {
    const step = chain.find((s) => s.status === 'pending');
    if (step) return step.approver_type === 'admin' ? 'HR / admin' : (step.approver_name || step.approver_email || step.name);
    if (leave.current_step_name) return leave.current_step_name;
  }
  const approvals = leave.approvals || [];
  const last = approvals[approvals.length - 1];
  if (last?.approver_name) return last.approver_name;
  const acted = [...chain].reverse().find((s) => s.acted_by_name || s.acted_by_email);
  return acted ? (acted.acted_by_name || acted.acted_by_email) : '—';
};

// Exactly one Comp Off entry: a "Comp Off" / "CompOff" type in the policy and the
// built-in comp-off balance are the same thing (leave_balance.comp_off).
const withSingleCompOff = (types, available) => {
  const fromPolicy = types.find(t => isCompOffKey(t.key) || isCompOffKey(t.name));
  return [
    ...types.filter(t => t !== fromPolicy && !isCompOffKey(t.key) && !isCompOffKey(t.name)),
    {
      ...(fromPolicy || {}),
      name: fromPolicy?.name || 'Comp Off',
      key: 'comp_off',
      quota: 0,
      available: available ?? 0,
      description: fromPolicy?.description || 'Compensatory off for working on holidays/weekends',
      isCompOff: true,
      isUnlimited: false,
      perOccurrence: false,
      clubbingNotAllowedWith: fromPolicy?.clubbingNotAllowedWith || []
    }
  ];
};

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
const matchesFilter = (status, filter) => {
  if (filter === 'all') return true;
  if (filter === 'pending') return status === 'pending' || status === 'manager_approved';
  return status === filter;
};

const fieldLabel = 'text-[13px] font-medium leading-[18px] text-ink-secondary';

const Notice = ({ tone = 'warning', icon, title, children }) => {
  const Icon = icon;
  const tones = {
    warning: 'bg-warning-bg text-warning-fg',
    danger: 'bg-danger-bg text-danger-fg',
    info: 'bg-info-bg text-info-fg',
  };
  return (
    <div role="alert" className={cn('flex items-start gap-2.5 rounded-md px-3.5 py-3 text-[13px] leading-[18px]', tones[tone])}>
      {Icon && <Icon className="mt-px h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
};

const LeavesPage = () => {
  const navigate = useNavigate();
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

  // Range helper for long leave (maternity etc.)
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');

  // Server-side day count per application group (sandwich rule, type rules) — keyed by request signature
  const [serverPreview, setServerPreview] = useState({});

  // Inline "Apply for leave" panel: half-day toggle for the from/to range
  const [halfDay, setHalfDay] = useState({ on: false, period: 'morning' });

  // Requests list: status filter, expanded row, leave policy dialog
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [policyOpen, setPolicyOpen] = useState(false);

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
      // Preferred: policy types with the employee's effective balance (LV-2)
      try {
        const res = await api.get('/v2/leave/my-balance');
        if (res.data?.has_profile && res.data.types?.length) {
          const types = res.data.types
            .filter(t => t.eligible !== false)
            .map(t => ({
              name: t.leave_type,
              key: t.key,
              quota: t.annual_quota || 0,
              available: t.is_unlimited ? Infinity : (t.available ?? 0),
              description: t.description || '',
              carryForward: t.carry_forward_allowed,
              maxCarryForward: t.max_carry_forward_days,
              creditType: t.credit_type,
              monthlyCredit: t.monthly_credit || 0,
              advanceDaysRequired: t.advance_days_required || 0,
              clubbingNotAllowedWith: t.clubbing_not_allowed_with || [],
              isUnlimited: t.is_unlimited,
              perOccurrence: t.per_occurrence,
              restrictedOnly: t.restricted_holiday_only,
              sandwich: t.sandwich_rule,
              creditLabel: creditLabel(t),
            }));
          const merged = withSingleCompOff(types, res.data.comp_off);
          setLeaveTypes(merged);
          setDefaultLeaveType(merged[0].name);
          return;
        }
      } catch {
        // fall back to the policy + profile below
      }

      // Fetch leave policy (for quotas)
      const policyResponse = await api.get('/leaves/leave-policy');
      const policies = policyResponse.data?.policies || [];

      // Fetch employee profile (for current balance)
      const profileResponse = await api.get('/auth/me');
      const balance = profileResponse.data?.leave_balance || {};

      // Build leave types array with both quota and available balance
      const policyTypes = policies.map(policy => {
        const key = leaveKey(policy.leave_type);
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
          isUnlimited: policy.is_unlimited || false,
          perOccurrence: policy.credit_type === 'event' && (policy.event_scope || 'occurrence') === 'occurrence',
          restrictedOnly: policy.restricted_holiday_only || false,
          sandwich: policy.sandwich_rule || false,
          creditLabel: creditLabel(policy),
        };
      });

      // Add Comp Off (not in policy but always available as an option) — only once
      const types = withSingleCompOff(policyTypes, balance.comp_off);

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

  // One application per leave type + full/half configuration (same grouping as submit)
  const applicationGroups = useMemo(() => {
    const groups = {};
    Object.entries(selectedDates).forEach(([dateKey, config]) => {
      if (!config.leaveType) return;
      const key = groupKeyOf(config);
      if (!groups[key]) {
        groups[key] = {
          key,
          leaveType: config.leaveType,
          dates: [],
          is_half_day: config.type === 'half',
          half_day_period: config.type === 'half' ? config.period : null
        };
      }
      groups[key].dates.push(dateKey);
    });
    Object.values(groups).forEach(g => { g.dates.sort(); g.signature = `${g.key}|${g.dates.join(',')}`; });
    return Object.values(groups);
  }, [selectedDates]);

  // Ask the server for the real day count (sandwich rule) and policy checks, debounced.
  // Runs for the inline panel as well as the calendar dialog (both edit the same selection).
  useEffect(() => {
    if (applicationGroups.length === 0) return undefined;
    const timer = setTimeout(async () => {
      const results = {};
      await Promise.all(applicationGroups.map(async (g) => {
        try {
          const res = await api.post('/leaves/validate-application', {
            leave_type: g.leaveType,
            dates: g.dates.map(d => `${d}T00:00:00.000Z`),
            is_half_day: g.is_half_day,
            half_day_period: g.half_day_period
          });
          results[g.signature] = res.data;
        } catch {
          results[g.signature] = null;
        }
      }));
      setServerPreview(prev => ({ ...prev, ...results }));
    }, 350);
    return () => clearTimeout(timer);
  }, [applicationGroups]);

  const previewRows = applicationGroups.map(g => ({ group: g, result: serverPreview[g.signature] }));
  const previewPending = previewRows.some(r => r.result === undefined);
  const serverErrors = previewRows.flatMap(r => (r.result?.errors || []).map(e => ({ ...e, leaveType: r.group.leaveType })));
  const serverTotalDays = previewRows.reduce((sum, r) => sum + (r.result?.days?.days_count ?? 0), 0);
  const sandwichTotal = previewRows.reduce((sum, r) => sum + (r.result?.days?.sandwich_days ?? 0), 0);
  // Weekly offs / holidays in the selection that are not charged (sandwich rule off)
  const excludedDays = previewRows.flatMap(r => r.result?.days?.excluded_dates || []);

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

    // Prefer the server count (weekly offs / holidays skipped, sandwich rule) once it is in
    Object.keys(usage).forEach(type => {
      const rows = previewRows.filter(r => r.group.leaveType === type);
      if (rows.length && rows.every(r => r.result?.days)) {
        usage[type].days = rows.reduce((sum, r) => sum + r.result.days.days_count, 0);
      }
    });

    // Add balance info
    Object.keys(usage).forEach(type => {
      const typeInfo = leaveTypes.find(t => t.name === type);
      usage[type].available = typeInfo?.perOccurrence ? typeInfo.quota : (typeInfo?.available ?? 0);
      usage[type].isUnpaid = typeInfo?.isUnlimited || false;
      usage[type].perOccurrence = typeInfo?.perOccurrence || false;
      usage[type].sufficient = usage[type].isUnpaid || usage[type].available >= usage[type].days;
    });

    return usage;
  }, [selectedDates, leaveTypes, serverPreview, applicationGroups]);

  // Check for insufficient balance
  const insufficientBalanceTypes = useMemo(() => {
    return Object.entries(balanceUsage)
      .filter(([, info]) => !info.isUnpaid && !info.sufficient)
      .map(([type, info]) => ({
        type,
        available: info.available,
        requested: info.days
      }));
  }, [balanceUsage]);


  const addDateRange = () => {
    if (!rangeFrom || !rangeTo || rangeTo < rangeFrom) {
      toast.error('Pick a valid from / to date');
      return;
    }
    const additions = {};
    let skipped = 0;
    for (let d = new Date(`${rangeFrom}T12:00:00Z`); d.toISOString().slice(0, 10) <= rangeTo; d = new Date(d.getTime() + 86400000)) {
      const key = d.toISOString().slice(0, 10);
      const holiday = holidayMap[key];
      if ((holiday && !isOptionalHoliday(holiday)) || existingLeaveMap[key]) { skipped++; continue; }
      additions[key] = selectedDates[key] || { type: 'full', period: 'morning', leaveType: defaultLeaveType };
      if (Object.keys(additions).length > 366) break;
    }
    setSelectedDates(prev => ({ ...prev, ...additions }));
    setCurrentMonth(new Date(`${rangeFrom}T00:00:00`));
    if (skipped) toast.info(`${skipped} day(s) skipped (holiday or existing leave)`);
  };

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
      const dateKey = /^\d{4}-\d{2}-\d{2}/.test(String(holiday.date)) ? String(holiday.date).slice(0, 10) : toDateKey(holiday.date);
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
        const dateKey = toDateKey(dateStr);
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

  const isHoliday = (dateKey) => !!holidayMap[dateKey] && !isOptionalHoliday(holidayMap[dateKey]);
  const getHolidayInfo = (dateKey) => holidayMap[dateKey] || null;
  const hasExistingLeave = (dateKey) => !!existingLeaveMap[dateKey];
  const getExistingLeaveInfo = (dateKey) => existingLeaveMap[dateKey] || null;

  const getStatusDisplayText = (status) => {
    const statusMap = {
      pending: 'Pending',
      manager_approved: 'Partly approved',
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
        const rest = { ...prev };
        delete rest[dateKey];
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
      const rest = { ...prev };
      delete rest[dateKey];
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
    if (previewRows.length && !previewPending && previewRows.every(r => r.result?.days)) return serverTotalDays;
    return Object.values(selectedDates).reduce((total, config) => {
      return total + (config.type === 'full' ? 1 : 0.5);
    }, 0);
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

    // Server-side checks (sandwich-inclusive balance, restricted holidays, per-occurrence caps, overlaps)
    if (serverErrors.length > 0) {
      toast.error(serverErrors[0].message);
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
      // Group dates by leave type AND configuration (full/half + period)
      const groups = Object.fromEntries(applicationGroups.map(g => [g.key, g]));

      // Submit each group as a separate leave request
      const submissions = Object.values(groups).map(async (group) => {
        const payload = {
          leave_type: group.leaveType,
          dates: group.dates.map(d => `${d}T00:00:00.000Z`),
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
      setServerPreview({});
      setRangeFrom('');
      setRangeTo('');
      setHalfDay({ on: false, period: 'morning' });
      fetchLeaves();
      fetchLeaveTypesAndBalance();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit leave application');
    } finally {
      setSubmitting(false);
    }
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
      const isHolidayDate = !!holidayInfo && !isOptionalHoliday(holidayInfo);
      const isOptionalDate = !!holidayInfo && isOptionalHoliday(holidayInfo);
      const existingLeaveInfo = getExistingLeaveInfo(dateKey);
      const hasLeave = !!existingLeaveInfo;
      const isBlocked = isHolidayDate || hasLeave;

      // Fill colour follows the leave type picked for that day
      const selectedFill = isSelected && config?.leaveType ? typeTone(config.leaveType).fill : 'bg-success-solid hover:bg-success-fg';

      const dayButton = (
        <button
          key={day}
          type="button"
          onClick={() => !isBlocked && toggleDateSelection(dateKey)}
          disabled={isBlocked}
          className={cn(
            'relative h-8 w-8 rounded-full text-xs font-medium text-ink transition-colors sm:h-10 sm:w-10 sm:text-sm',
            isHolidayDate && 'cursor-not-allowed border-2 border-danger-solid/40 bg-danger-bg text-danger-fg',
            hasLeave && !isHolidayDate && 'cursor-not-allowed border-2 border-warning-solid/40 bg-warning-bg text-warning-fg',
            !isBlocked && !isSelected && 'cursor-pointer hover:bg-subtle',
            isOptionalDate && !isSelected && !hasLeave && 'border-2 border-dashed border-brand bg-brand-subtle text-brand-text',
            isToday && !isSelected && !isBlocked && 'ring-2 ring-brand ring-offset-1',
            (isWeekend || isPast) && !isSelected && !isBlocked && 'text-ink-muted',
            isSelected && `${selectedFill} text-white`,
            isSelected && config?.type === 'half' && 'opacity-70',
          )}
        >
          {day}
          {isSelected && config?.type === 'half' && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[6px] sm:text-[8px]">½</span>
          )}
          {isHolidayDate && (
            <Star className="absolute -right-1 -top-1 h-2.5 w-2.5 fill-danger-solid text-danger-solid sm:h-3 sm:w-3" />
          )}
          {isOptionalDate && !hasLeave && (
            <Star className="absolute -right-1 -top-1 h-2.5 w-2.5 text-brand-text sm:h-3 sm:w-3" />
          )}
          {hasLeave && !isHolidayDate && (
            <FileText className="absolute -right-1 -top-1 h-2.5 w-2.5 text-warning-fg sm:h-3 sm:w-3" />
          )}
        </button>
      );

      if (isHolidayDate || (isOptionalDate && !hasLeave)) {
        days.push(
          <TooltipProvider key={day}>
            <Tooltip>
              <TooltipTrigger asChild>{dayButton}</TooltipTrigger>
              <TooltipContent side="top" className={cn('text-xs text-white', isOptionalDate ? 'bg-brand-text' : 'bg-danger-fg')}>
                <p className="font-medium">{holidayInfo.name}</p>
                {holidayInfo.type && (
                  <p className="text-[10px] capitalize opacity-80">{holidayInfo.type} Holiday</p>
                )}
                {isOptionalDate && <p className="text-[10px] opacity-90">Can be taken as Restricted Holiday</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      } else if (hasLeave) {
        days.push(
          <TooltipProvider key={day}>
            <Tooltip>
              <TooltipTrigger asChild>{dayButton}</TooltipTrigger>
              <TooltipContent side="top" className="bg-navy text-xs text-white">
                <p className="font-medium">{existingLeaveInfo.leave_type}</p>
                <p className="text-[10px] opacity-80">{getStatusDisplayText(existingLeaveInfo.status)}</p>
                {existingLeaveInfo.is_half_day && (
                  <p className="text-[10px] capitalize opacity-80">Half Day ({existingLeaveInfo.half_day_period})</p>
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
        <div className="mb-1 grid grid-cols-7 gap-0.5 sm:mb-2 sm:gap-1">
          {dayNames.map((name, idx) => (
            <div key={idx} className="flex h-6 w-8 items-center justify-center text-[10px] font-semibold uppercase text-ink-muted sm:h-8 sm:w-10 sm:text-[11px]">
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

  const getStatusText = (status) => {
    const textMap = {
      pending: 'Pending',
      manager_approved: 'Partly approved',
      approved: 'Approved',
      rejected: 'Rejected',
    };
    return textMap[status]; // unknown statuses fall back to StatusBadge's title-casing
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

  // ---- Inline "Apply for leave" panel: leave type + from/to range + half day drive the same selection ----
  const buildRangeSelection = (from, to, leaveType, half) => {
    const dates = {};
    const skippedHolidays = [];
    let skippedExisting = 0;
    if (!from) return { dates, skippedHolidays, skippedExisting };
    const end = to && to >= from ? to : from;
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= end; d = new Date(d.getTime() + 86400000)) {
      const key = d.toISOString().slice(0, 10);
      const holiday = holidayMap[key];
      if (holiday && !isOptionalHoliday(holiday)) { skippedHolidays.push({ key, name: holiday.name }); continue; }
      if (existingLeaveMap[key]) { skippedExisting++; continue; }
      dates[key] = { type: half.on ? 'half' : 'full', period: half.period, leaveType };
      if (Object.keys(dates).length > 366) break;
    }
    return { dates, skippedHolidays, skippedExisting };
  };

  const applyQuick = (patch) => {
    const next = { from: rangeFrom, to: rangeTo, leaveType: defaultLeaveType, half: halfDay, ...patch };
    setRangeFrom(next.from);
    setRangeTo(next.to);
    setDefaultLeaveType(next.leaveType);
    setHalfDay(next.half);
    setSelectedDates(buildRangeSelection(next.from, next.to, next.leaveType, next.half).dates);
  };

  const quickRange = buildRangeSelection(rangeFrom, rangeTo, defaultLeaveType, halfDay);

  const submitDisabled =
    submitting ||
    sortedSelectedDates.length === 0 ||
    insufficientBalanceTypes.length > 0 ||
    serverErrors.length > 0;

  const leaveTypeOptionLabel = (type) => (
    type.isCompOff ? `(${type.available})` :
      (type.isUnlimited || type.name === 'Unpaid Leave') ? '(∞)' : type.perOccurrence ? `(${type.quota}/occurrence)` :
        `(${type.available}/${type.quota})`
  );

  // Validation messages shared by the inline panel and the calendar dialog
  const renderValidation = ({ withServerErrors = false } = {}) => (
    <>
      {pastDatesSelected.length > 0 && (
        <Notice tone="warning" icon={AlertTriangle} title="Retroactive leave application">
          You are applying for leave on {pastDatesSelected.length} past date{pastDatesSelected.length > 1 ? 's' : ''}.
          This may require additional approval from your manager.
        </Notice>
      )}
      {!clubbingValidation.valid && (
        <Notice tone="danger" icon={AlertCircle} title="Clubbing not allowed">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {clubbingValidation.errors.map((error, idx) => <li key={idx}>{error.message}</li>)}
          </ul>
          <p className="mt-1.5 font-medium">Change the leave type or remove a date.</p>
        </Notice>
      )}
      {advanceNoticeWarnings.length > 0 && (
        <Notice tone="warning" icon={AlertTriangle} title="Advance notice">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {advanceNoticeWarnings.map((warning, idx) => (
              <li key={idx}><strong>{warning.leaveType}</strong> requires {warning.required} days notice</li>
            ))}
          </ul>
        </Notice>
      )}
      {insufficientBalanceTypes.length > 0 && (
        <Notice tone="danger" icon={AlertCircle} title="Insufficient balance">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {insufficientBalanceTypes.map((item, idx) => (
              <li key={idx}><strong>{item.type}</strong>: {item.available} available, {item.requested} requested</li>
            ))}
          </ul>
        </Notice>
      )}
      {withServerErrors && serverErrors.length > 0 && (
        <Notice tone="danger" icon={AlertCircle}>
          {serverErrors.map((e, i) => <p key={i}>{e.message}</p>)}
        </Notice>
      )}
    </>
  );

  // "3 working days (Diwali on 20 Oct is excluded). You'll have 3 days of Casual Leave left."
  const renderBalanceHint = () => {
    if (sortedSelectedDates.length === 0) return null;
    if (previewPending) {
      return (
        <div className="flex items-center gap-2.5 rounded-md bg-info-bg px-3.5 py-3 text-[13px] leading-[18px] text-info-fg">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Checking working days…
        </div>
      );
    }
    const days = previewRows.length ? serverTotalDays : calculateTotalDays();
    const excluded = rangeFrom ? quickRange.skippedHolidays : [];
    const single = selectedLeaveTypesSet.length === 1 ? leaveTypes.find(t => t.name === selectedLeaveTypesSet[0]) : null;
    const left = single && !single.isUnlimited && !single.perOccurrence && Number.isFinite(single.available)
      ? round1(single.available - days)
      : null;
    return (
      <div className="flex items-start gap-2.5 rounded-md bg-info-bg px-3.5 py-3 text-[13px] leading-[18px] text-info-fg" data-testid="leave-balance-hint">
        <Sparkles className="mt-px h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          {sandwichTotal > 0
            ? `${days} days charged (incl. ${sandwichTotal} sandwiched day${sandwichTotal > 1 ? 's' : ''})`
            : `${days} working day${days !== 1 ? 's' : ''}`}
          {excluded.length > 0 && ` (${excluded.map(h => `${h.name} on ${fmtKey(h.key, 'dd MMM')}`).join(', ')} ${excluded.length > 1 ? 'are' : 'is'} excluded)`}
          {excludedDays.length > 0 && ` — ${excludedDays.length} weekly off/holiday day${excludedDays.length > 1 ? 's' : ''} not counted`}
          .
          {rangeFrom && quickRange.skippedExisting > 0 && ` ${quickRange.skippedExisting} day${quickRange.skippedExisting > 1 ? 's' : ''} skipped (existing leave).`}
          {left != null && ` You'll have ${left} day${left !== 1 ? 's' : ''} of ${single.name} left.`}
        </p>
      </div>
    );
  };

  // Balance cards: used / pending this year come from the leaves list (same rule as /v2/leave/my-balance)
  const currentYear = new Date().getFullYear();
  const usageByType = useMemo(() => {
    const year = String(new Date().getFullYear());
    const out = {};
    leaves.forEach((l) => {
      if (!['pending', 'manager_approved', 'approved'].includes(l.status)) return;
      if (!toDateKey((l.dates || [])[0]).startsWith(year)) return;
      const k = leaveKey(l.leave_type);
      if (!out[k]) out[k] = { used: 0, pending: 0 };
      if (l.status === 'pending') out[k].pending += l.days_count || 0;
      else out[k].used += l.days_count || 0;
    });
    return out;
  }, [leaves]);

  // First approver on your latest request — shown as "Goes to … for approval"
  const usualApprover = useMemo(() => {
    for (const l of leaves) {
      const chain = Array.isArray(l.approval_chain) ? [...l.approval_chain].sort((a, b) => (a.level ?? 0) - (b.level ?? 0)) : [];
      // Skipped levels (e.g. no reporting manager) never see the request
      const first = chain.find(s => s.status !== 'skipped');
      if (first) return first.approver_type === 'admin' ? 'HR / admin' : (first.approver_name || null);
    }
    return null;
  }, [leaves]);

  const visibleLeaves = leaves.filter(l => matchesFilter(l.status, statusFilter));

  const renderBalanceCard = (type) => {
    const isCompOff = type.isCompOff;
    const isUnlimited = type.isUnlimited || false;
    const isMonthly = type.creditType === 'monthly';
    const annualQuota = isMonthly && type.monthlyCredit > 0 ? type.monthlyCredit * 12 : type.quota;
    const isEmpty = type.available === 0 && !isUnlimited;
    const usage = usageByType[leaveKey(type.name)] || { used: 0, pending: 0 };

    const pct = isUnlimited || type.perOccurrence
      ? 100
      : isCompOff
        ? (type.available > 0 ? 100 : 0)
        : annualQuota > 0 ? Math.min(100, Math.max(0, (type.available / annualQuota) * 100)) : 0;

    const notes = [
      usage.used > 0 && `${round1(usage.used)} used`,
      usage.pending > 0 && `${round1(usage.pending)} pending`,
      isMonthly && type.monthlyCredit > 0 && `accrues ${type.monthlyCredit}/mo`,
      type.restrictedOnly && 'optional holidays only',
      type.sandwich && 'sandwich rule',
    ].filter(Boolean);

    return (
      <div key={type.name} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-xs">
        <div className="flex items-center gap-1.5">
          {isCompOff && <Gift className="h-3.5 w-3.5 shrink-0 text-violet-fg" />}
          <p className="truncate text-[13px] font-medium leading-[18px] text-ink-secondary">{type.name}</p>
        </div>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <p className={cn('font-display text-[30px] font-bold leading-9 tracking-[-0.02em] tabular-nums', isEmpty && !isCompOff ? 'text-danger-fg' : 'text-ink')}>
            {isUnlimited ? '∞' : round1(type.available)}
          </p>
          <p className="truncate text-[13px] leading-[18px] text-ink-muted">
            {isCompOff ? 'available' :
              isUnlimited ? 'unlimited' :
                type.perOccurrence ? `up to ${type.quota} per occurrence` :
                  `of ${annualQuota} days`}
          </p>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="truncate text-xs font-medium leading-4 text-ink-muted">
          {notes.length ? notes.join(' · ') : 'Nothing used this year'}
        </p>
      </div>
    );
  };

  const renderLeaveDetails = (leave) => (
    <div className="space-y-3 bg-canvas px-6 py-4 text-[13px] leading-[18px]">
      <p className="text-ink-secondary">
        <span className="font-medium text-ink">Reason: </span>
        {leave.reason || '—'}
      </p>
      {(leave.is_half_day || leave.sandwich_days > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {leave.is_half_day && (
            <StatusBadge tone="warning" dot={false} label={`Half day (${leave.half_day_period})`} />
          )}
          {leave.sandwich_days > 0 && (
            <span className="text-warning-fg">
              Includes {leave.sandwich_days} sandwiched day{leave.sandwich_days > 1 ? 's' : ''} ({(leave.sandwich_dates || []).map(d => fmtKey(d, 'dd MMM')).join(', ')})
            </span>
          )}
        </div>
      )}
      {leave.dates && leave.dates.length > 1 && !areDatesConsecutive(leave.dates) && (
        <div className="flex flex-wrap gap-1">
          {leave.dates
            .map(d => new Date(d))
            .sort((a, b) => a - b)
            .map((date, idx) => (
              <span key={idx} className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-secondary">
                {format(date, 'MMM dd')}
              </span>
            ))}
        </div>
      )}
      {Array.isArray(leave.approval_chain) && leave.approval_chain.length > 0 && leave.status !== 'rejected' && leave.status !== 'approved' && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Approval progress</p>
          <ApprovalChain chain={leave.approval_chain} />
        </div>
      )}
      {leave.approvals && leave.approvals.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Approval history</p>
          <div className="space-y-1.5">
            {leave.approvals.map((approval, idx) => (
              <div key={idx}>
                <span className="font-medium text-ink">{approval.approver_name}</span>
                <span className="text-ink-muted"> ({approval.approver_role}) </span>
                <span className={approval.action === 'approve' ? 'text-success-fg' : approval.action === 'reject' ? 'text-danger-fg' : 'text-ink-secondary'}>
                  {approval.action === 'approve' ? 'approved' : approval.action === 'reject' ? 'rejected' : approval.action}
                </span>
                {approval.step_name && <span className="text-ink-muted"> ({approval.step_name})</span>}
                {approval.on_behalf_of_name && <span className="text-ink-muted"> on behalf of {approval.on_behalf_of_name}</span>}
                {approval.comments && (
                  <p className="mt-0.5 text-ink-secondary">Comment: {approval.comments}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const toggleExpanded = (id) => setExpandedId(prev => (prev === id ? null : id));

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="My leaves"
        subtitle={`Plan time off, track requests and see your balances for ${currentYear}.`}
      >
        <Button variant="outline" onClick={() => setPolicyOpen(true)} disabled={loadingTypes} data-testid="leave-policy-btn">
          <FileText className="h-[18px] w-[18px]" />
          Leave policy
        </Button>
        <Button variant="outline" onClick={() => navigate('/team-calendar')}>
          <CalendarDays className="h-[18px] w-[18px]" />
          Team calendar
        </Button>
      </PageHeader>

      {/* Balances */}
      {loadingTypes ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface py-10 text-sm text-ink-muted shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading balances…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-6">
          {leaveTypes.map(renderBalanceCard)}
        </div>
      )}

      {/* Requests & apply */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Requests */}
        <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
          <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold leading-6 text-ink">Leave requests</h2>
              <p className="text-[13px] leading-[18px] text-ink-secondary">Your leave history and approval status</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                title="Export CSV"
                aria-label="Export CSV"
                disabled={!leaves.length}
                onClick={() => exportCsv('my-leaves', leaves, [
                  { key: 'leave_type', label: 'Leave type' },
                  { label: 'Dates', value: (l) => (l.dates || []).map(toDateKey).join(' ') },
                  { key: 'days_count', label: 'Days charged' },
                  { key: 'sandwich_days', label: 'Sandwich days' },
                  { label: 'Half day', value: (l) => (l.is_half_day ? l.half_day_period || 'yes' : '') },
                  { key: 'status', label: 'Status' },
                  { key: 'current_step_name', label: 'Waiting at' },
                  { key: 'reason', label: 'Reason' },
                  { label: 'Applied on', value: (l) => (l.created_at ? String(l.created_at).slice(0, 10) : '') },
                ])}
              >
                <Download />
              </Button>
            </div>
          </div>

          {leaves.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="min-w-[680px]">
                <div className="grid grid-cols-[150px_132px_44px_minmax(0,1fr)_120px_16px] items-center gap-4 border-y border-line bg-canvas px-6 py-2.5 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-ink-muted">
                  <span>Type</span>
                  <span>Dates</span>
                  <span>Days</span>
                  <span>Approver</span>
                  <span>Status</span>
                  <span aria-hidden="true" />
                </div>
                {visibleLeaves.length > 0 ? visibleLeaves.map((leave) => {
                  const open = expandedId === leave.id;
                  return (
                    <div key={leave.id} data-testid={`leave-item-${leave.id}`} className="border-b border-line last:border-b-0">
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        onClick={() => toggleExpanded(leave.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(leave.id); }
                        }}
                        className="grid cursor-pointer grid-cols-[150px_132px_44px_minmax(0,1fr)_120px_16px] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', typeTone(leave.leave_type).dot)} />
                          <span className="truncate text-sm font-medium leading-5 text-ink">{leave.leave_type}</span>
                        </div>
                        <span className="text-sm leading-5 text-ink-secondary">{compactDates(leave.dates)}</span>
                        <span className="text-sm leading-5 tabular-nums text-ink-secondary">{leave.days_count}</span>
                        <span className="truncate text-sm leading-5 text-ink-secondary">{approverOf(leave)}</span>
                        <div className="min-w-0">
                          <StatusBadge status={leave.status} label={getStatusText(leave.status)} />
                        </div>
                        <ChevronDown className={cn('h-4 w-4 text-ink-muted transition-transform', open && 'rotate-180')} />
                      </div>
                      {open && renderLeaveDetails(leave)}
                    </div>
                  );
                }) : (
                  <p className="px-6 py-10 text-center text-sm text-ink-muted">
                    No {STATUS_FILTERS.find(f => f.value === statusFilter)?.label.toLowerCase()} requests.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="border-t border-line px-6 py-12 text-center">
              <Calendar className="mx-auto mb-3 h-10 w-10 text-line-strong" />
              <p className="text-sm font-medium text-ink">No leave applications yet</p>
              <p className="mt-1 text-[13px] text-ink-muted">Use &quot;Apply for leave&quot; to submit your first application</p>
            </div>
          )}
        </section>

        {/* Apply for leave (inline; the calendar dialog below handles multi-date / mixed-type picks) */}
        <form
          onSubmit={handleSubmit}
          className="order-first flex min-w-0 flex-col gap-[18px] rounded-lg border border-line bg-surface p-6 shadow-xs xl:order-none"
          data-testid="apply-leave-panel"
        >
          <div className="flex items-center gap-3">
            <IconTile icon={Plane} tone="accent" size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold leading-6 text-ink">Apply for leave</h2>
              <p className="truncate text-[13px] leading-[18px] text-ink-secondary">
                {usualApprover ? `Goes to ${usualApprover} for approval` : 'Goes to your approver for approval'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className={fieldLabel}>Leave type</Label>
            <Select
              value={defaultLeaveType}
              onValueChange={(value) => applyQuick({ leaveType: value })}
              disabled={loadingTypes}
            >
              <SelectTrigger className="h-11 px-3.5" data-testid="inline-leave-type">
                {/* div, not span: the trigger line-clamps direct <span> children */}
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileText className="h-[18px] w-[18px] shrink-0 text-ink-muted" />
                  <SelectValue placeholder="Select leave type" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map(type => (
                  <SelectItem key={type.name} value={type.name}>
                    <span className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', typeTone(type.name).dot)} />
                      <span>{type.name}</span>
                      <span className="text-xs text-ink-muted">{leaveTypeOptionLabel(type)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="inline-from" className={fieldLabel}>From</Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
                <Input
                  id="inline-from"
                  type="date"
                  value={rangeFrom}
                  onChange={(e) => {
                    const v = e.target.value;
                    applyQuick({ from: v, to: v && (!rangeTo || rangeTo < v) ? v : rangeTo });
                  }}
                  className="h-11 pl-10"
                />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="inline-to" className={fieldLabel}>To</Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" />
                <Input
                  id="inline-to"
                  type="date"
                  value={rangeTo}
                  min={rangeFrom || undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    applyQuick({ to: v, from: rangeFrom || v });
                  }}
                  className="h-11 pl-10"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md bg-subtle px-3.5 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5 text-ink">Half day</p>
                <p className="text-xs font-medium leading-4 text-ink-muted">Apply for first or second half only</p>
              </div>
              <Switch
                checked={halfDay.on}
                onCheckedChange={(on) => applyQuick({ half: { ...halfDay, on } })}
                aria-label="Half day"
                className="data-[state=checked]:bg-brand data-[state=unchecked]:bg-line-strong"
              />
            </div>
            {halfDay.on && (
              <Segmented
                className="w-full bg-line/60 [&>button]:flex-1"
                options={[
                  { value: 'morning', label: 'First half' },
                  { value: 'afternoon', label: 'Second half' },
                ]}
                value={halfDay.period}
                onChange={(period) => applyQuick({ half: { ...halfDay, period } })}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inline-reason" className={fieldLabel}>Reason</Label>
            <Textarea
              id="inline-reason"
              data-testid="inline-reason-textarea"
              placeholder="Please provide a reason for your leave..."
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              className="h-24 resize-none px-3.5 py-3"
            />
          </div>

          {renderValidation({ withServerErrors: true })}
          {renderBalanceHint()}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              data-testid="apply-leave-btn"
              onClick={() => setDialogOpen(true)}
            >
              <CalendarDays />
              Pick dates on calendar
            </Button>
            {!clubbingValidation.valid ? (
              <Button type="button" variant="dark" disabled>
                <AlertCircle />
                Fix error first
              </Button>
            ) : (
              <Button type="submit" variant="dark" data-testid="inline-submit-leave-btn" disabled={submitDisabled}>
                {submitting ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                {submitting ? 'Submitting...' : `Submit request${selectedLeaveTypesSet.length > 1 ? `s (${selectedLeaveTypesSet.length})` : ''}`}
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Calendar picker: any set of days, a leave type per day, full / half day */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) {
          setSelectedDates({});
          setLeaveForm({ reason: '' });
          setRangeFrom('');
          setRangeTo('');
          setHalfDay({ on: false, period: 'morning' });
        }
      }}>
        <DialogContent className="mx-1 max-h-[95vh] max-w-3xl overflow-y-auto p-4 sm:mx-auto sm:p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold text-ink sm:text-xl">Apply for leave</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="mt-3 space-y-5 sm:mt-4">
            {/* Default Leave Type Selector */}
            {!loadingTypes && (
              <div className="rounded-md border border-line bg-canvas p-3">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex-1">
                    <Label className={fieldLabel}>Default leave type</Label>
                    <Select
                      value={defaultLeaveType}
                      onValueChange={(value) => setDefaultLeaveType(value)}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {leaveTypes.map(type => (
                          <SelectItem key={type.name} value={type.name}>
                            <div className="flex items-center gap-2">
                              <span className={cn('h-2 w-2 shrink-0 rounded-full', typeTone(type.name).dot)} />
                              <span>{type.name}</span>
                              <span className="ml-1 text-xs text-ink-muted">{leaveTypeOptionLabel(type)}</span>
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
                      className="sm:mt-6"
                    >
                      Apply to all
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  New dates will use this leave type. Change each day individually below.
                </p>
                <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-ink-secondary">Range from</Label>
                      <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="mt-1 h-9 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs text-ink-secondary">to</Label>
                      <Input type="date" value={rangeTo} min={rangeFrom || undefined} onChange={(e) => setRangeTo(e.target.value)} className="mt-1 h-9 text-xs" />
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addDateRange} className="h-9">
                    <CalendarPlus /> Add range
                  </Button>
                </div>
              </div>
            )}

            {/* Calendar and Selected Dates */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-6">
              {/* Calendar */}
              <div>
                <Label className={cn(fieldLabel, 'mb-2 block')}>Select dates</Label>
                <div className="rounded-lg border border-line bg-canvas p-2 sm:p-4">
                  <div className="mb-2 flex items-center justify-between sm:mb-4">
                    <Button type="button" variant="ghost" size="icon" onClick={goToPreviousMonth} className="h-8 w-8">
                      <ChevronLeft />
                    </Button>
                    <span className="font-display text-sm font-semibold text-ink sm:text-base">
                      <span className="sm:hidden">{monthNamesShort[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
                      <span className="hidden sm:inline">{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
                    </span>
                    <Button type="button" variant="ghost" size="icon" onClick={goToNextMonth} className="h-8 w-8">
                      <ChevronRight />
                    </Button>
                  </div>

                  {renderCalendar()}

                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3 text-[11px] sm:mt-4 sm:gap-3 sm:pt-4 sm:text-xs">
                    {[
                      ['Earned', TYPE_TONES.earned_leave.dot],
                      ['Sick', TYPE_TONES.sick_leave.dot],
                      ['Casual', TYPE_TONES.casual_leave.dot],
                      ['Comp off', TYPE_TONES.comp_off.dot],
                    ].map(([label, dot]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className={cn('h-3 w-3 rounded-full', dot)} />
                        <span className="text-ink-secondary">{label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5">
                      <span className="relative h-3 w-3 rounded-full border-2 border-danger-solid/40 bg-danger-bg">
                        <Star className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 fill-danger-solid text-danger-solid" />
                      </span>
                      <span className="text-ink-secondary">Holiday</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-full border-2 border-dashed border-brand bg-brand-subtle" />
                      <span className="text-ink-secondary">Optional holiday</span>
                    </div>
                  </div>

                  {currentMonthHolidays.length > 0 && (
                    <div className="mt-3 border-t border-line pt-3 sm:mt-4 sm:pt-4">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Holidays this month</p>
                      <div className="space-y-1">
                        {currentMonthHolidays.map((holiday, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <Star className="h-3 w-3 fill-danger-solid text-danger-solid" />
                            <span className="font-medium text-danger-fg">
                              {format(new Date(holiday.date), 'MMM dd')}
                            </span>
                            <span className="truncate text-ink-secondary">– {holiday.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Dates Configuration */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className={fieldLabel}>Selected ({calculateTotalDays()} days)</Label>
                  {sortedSelectedDates.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearAllDates}
                      className="h-7 px-2 text-xs text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
                    >
                      <Trash2 className="!size-3" />
                      Clear
                    </Button>
                  )}
                </div>

                <div className="min-h-[200px] max-h-[250px] overflow-y-auto rounded-lg border border-line bg-canvas sm:min-h-[300px] sm:max-h-[350px]">
                  {sortedSelectedDates.length > 0 ? (
                    <div className="space-y-2 p-2">
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
                            className={cn(
                              'rounded-md border p-2.5 shadow-xs sm:p-3',
                              isInConflict ? 'border-danger-solid bg-danger-bg ring-2 ring-danger-solid/30' : typeTone(config.leaveType).soft,
                            )}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-ink-muted" />
                                <span className="text-xs font-medium text-ink sm:text-sm">
                                  {format(date, 'EEE, MMM dd')}
                                </span>
                                {isPastDate && <StatusBadge tone="warning" dot={false} label="Past" className="px-2 py-0 text-[10px]" />}
                                {isInConflict && <StatusBadge tone="danger" dot={false} label="Conflict" className="px-2 py-0 text-[10px]" />}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeDate(dateKey)}
                                className="h-6 w-6 text-ink-muted hover:text-danger-fg"
                                aria-label="Remove date"
                              >
                                <X className="!size-3.5" />
                              </Button>
                            </div>

                            {/* Leave Type Selector for this date */}
                            <div className="mb-2">
                              <Select
                                value={config.leaveType}
                                onValueChange={(value) => updateDateConfig(dateKey, { leaveType: value })}
                              >
                                <SelectTrigger className={cn('h-8 text-xs', isInConflict && 'border-danger-solid bg-danger-bg')}>
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
                                      <SelectItem key={type.name} value={type.name} className="text-xs">
                                        <div className="flex items-center gap-2">
                                          {type.isCompOff && <Gift className="h-3 w-3 text-violet-fg" />}
                                          {wouldConflict && <AlertCircle className="h-3 w-3 text-danger-fg" />}
                                          <span className={wouldConflict ? 'text-danger-fg' : ''}>{type.name}</span>
                                          <span className="text-xs text-ink-muted">
                                            {(type.isUnlimited || type.name === 'Unpaid Leave') ? '∞' : type.perOccurrence ? `${type.quota}/occ.` : type.available}
                                          </span>
                                        </div>
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Full Day / Half Day Toggle */}
                            <Segmented
                              className="w-full [&>button]:flex-1"
                              options={[
                                { value: 'full', label: <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />Full</span> },
                                { value: 'half', label: <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />Half</span> },
                              ]}
                              value={config.type}
                              onChange={(type) => updateDateConfig(dateKey, { type })}
                            />

                            {config.type === 'half' && (
                              <div className="mt-2 flex gap-2">
                                {[
                                  ['morning', 'AM', <Sun key="am" className="h-3 w-3" />],
                                  ['afternoon', 'PM', <Sunset key="pm" className="h-3 w-3" />],
                                ].map(([period, label, periodIcon]) => (
                                  <button
                                    key={period}
                                    type="button"
                                    onClick={() => updateDateConfig(dateKey, { period })}
                                    className={cn(
                                      'flex flex-1 items-center justify-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium transition-colors',
                                      config.period === period
                                        ? 'border-brand bg-brand-subtle text-brand-text'
                                        : 'border-line bg-surface text-ink-secondary hover:text-ink',
                                    )}
                                  >
                                    {periodIcon}
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center py-12 text-ink-muted">
                      <Calendar className="mb-3 h-10 w-10 text-line-strong" />
                      <p className="text-sm">Click on dates to select</p>
                      <p className="mt-1 text-xs">You can select multiple days</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Balance Summary per Leave Type */}
            {Object.keys(balanceUsage).length > 0 && (
              <div className="rounded-md border border-line bg-canvas p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Leave balance summary</p>
                <div className="space-y-1.5">
                  {Object.entries(balanceUsage).map(([type, info]) => (
                    <div
                      key={type}
                      className={cn(
                        'flex items-center justify-between rounded-sm p-2 text-xs sm:text-sm',
                        info.sufficient ? 'bg-surface' : 'border border-danger-solid/30 bg-danger-bg',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', typeTone(type).chip)}>{type}</span>
                        <span className="text-xs text-ink-secondary">
                          {info.days} day{info.days !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className={cn('text-xs', info.sufficient ? 'text-ink-muted' : 'font-medium text-danger-fg')}>
                        {info.isUnpaid ? 'Unlimited' :
                          info.sufficient ? `${info.available} avail` :
                            `Only ${info.available}!`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {renderValidation()}

            {/* Day count from the server: sandwich rule + policy checks (LV-2 / LV-3) */}
            {previewRows.length > 0 && (
              <div className="space-y-1.5 rounded-md border border-line bg-canvas p-3" data-testid="day-count-preview">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-[13px] font-medium text-ink"><Layers className="h-3.5 w-3.5" /> Days that will be charged</Label>
                  {previewPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" /> : <span className="text-sm font-semibold text-ink">{serverTotalDays} day{serverTotalDays !== 1 ? 's' : ''}</span>}
                </div>
                {previewRows.map(({ group, result }) => (
                  <div key={group.signature} className="text-xs text-ink-secondary">
                    <span className="font-medium text-ink">{group.leaveType}</span>
                    {group.is_half_day ? ` (half day, ${group.half_day_period})` : ''}: {group.dates.length} selected
                    {result?.days && <> → <span className="font-medium">{result.days.days_count} day{result.days.days_count !== 1 ? 's' : ''}</span></>}
                    {result?.days?.excluded_dates?.length > 0 && (
                      <span className="text-ink-muted"> ({result.days.excluded_dates.length} weekly off/holiday day{result.days.excluded_dates.length > 1 ? 's' : ''} not counted)</span>
                    )}
                    {result?.days?.sandwich_days > 0 && (
                      <ul className="ml-3 mt-0.5 list-disc text-warning-fg">
                        {result.days.breakdown.map(b => <li key={b.date}>{fmtKey(b.date, 'EEE, dd MMM')} — {b.reason} (sandwich rule)</li>)}
                      </ul>
                    )}
                    {(result?.errors || []).map((e, i) => <p key={i} className="mt-0.5 text-danger-fg">{e.message}</p>)}
                  </div>
                ))}
                {sandwichTotal > 0 && (
                  <p className="text-xs text-warning-fg">Weekly offs / holidays between leave days count as leave for these types.</p>
                )}
              </div>
            )}

            {/* Reason */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason" className={fieldLabel}>Reason</Label>
              <Textarea
                id="reason"
                data-testid="reason-textarea"
                placeholder="Please provide a reason for your leave..."
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                required
                rows={2}
              />
            </div>

            {/* Summary */}
            {sortedSelectedDates.length > 0 && (
              <div className="rounded-md border border-line bg-canvas p-3 sm:p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Summary</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selectedLeaveTypesSet.map(type => (
                    <span key={type} className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', typeTone(type).chip)}>
                      {type}: {balanceUsage[type]?.days || 0}d
                    </span>
                  ))}
                </div>
                <div className="text-sm text-ink-secondary">
                  <span className="font-display text-base font-semibold text-ink">{calculateTotalDays()} total day{calculateTotalDays() !== 1 ? 's' : ''}</span>
                  {selectedLeaveTypesSet.length > 1 && (
                    <span className="ml-2 text-xs text-ink-muted">({selectedLeaveTypesSet.length} types)</span>
                  )}
                  {pastDatesSelected.length > 0 && (
                    <span className="ml-2 text-xs text-warning-fg">({pastDatesSelected.length} past)</span>
                  )}
                </div>
              </div>
            )}

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="flex-1"
                disabled={submitting}
              >
                Cancel
              </Button>
              {!clubbingValidation.valid ? (
                <Button type="button" variant="dark" className="flex-1" disabled>
                  <AlertCircle />
                  Fix error first
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="dark"
                  data-testid="submit-leave-btn"
                  className="flex-1"
                  disabled={submitDisabled}
                >
                  {submitting ? 'Submitting...' : `Submit${selectedLeaveTypesSet.length > 1 ? ` (${selectedLeaveTypesSet.length})` : ''}`}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Leave policy (moved out of the page body into a dialog behind the header button) */}
      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold text-ink">Leave policy</DialogTitle>
          </DialogHeader>
          <div className="divide-y divide-line">
            {leaveTypes.filter(t => !t.isCompOff).map(type => {
              const tags = [
                type.advanceDaysRequired > 0 && `${type.advanceDaysRequired}d advance notice`,
                type.carryForward && `carry forward${type.maxCarryForward ? ` up to ${type.maxCarryForward}d` : ''}`,
                type.sandwich && 'sandwich rule',
                type.restrictedOnly && 'optional holidays only',
                type.clubbingNotAllowedWith?.length > 0 && `not with ${type.clubbingNotAllowedWith.join(', ')}`,
              ].filter(Boolean);
              return (
                <div key={type.name} className="flex items-start gap-3 py-3">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', typeTone(type.name).dot)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{type.name}</p>
                    <p className="text-[13px] text-ink-secondary">
                      {type.isUnlimited ? 'Unlimited' : type.creditLabel || (type.creditType === 'monthly'
                        ? `${type.monthlyCredit}d/mo`
                        : `${type.quota}d/yr`)}
                    </p>
                    {type.description && <p className="mt-0.5 text-xs text-ink-muted">{type.description}</p>}
                    {tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {tags.map(tag => (
                          <span key={tag} className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-ink-secondary">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2.5 text-xs text-info-fg">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>Comp off is earned by working on holidays / weekly offs and does not follow an annual quota.</span>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default LeavesPage;
