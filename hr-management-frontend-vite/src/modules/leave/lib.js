// Shared helpers for the leave pages (module pages and the original leave pages).
import { format } from 'date-fns';

// Same rule as the backend normalizeLeaveType: "Comp Off" / "Comp-Off" / "CompOff" are all comp_off
export const leaveKey = (name) => {
  const key = String(name || '').toLowerCase().replace(/ /g, '_');
  return /^comp[\s_-]*off$/.test(key.trim()) ? 'comp_off' : key;
};
export const isCompOffKey = (name) => leaveKey(name) === 'comp_off';

// Calendar day of a stored leave date. The API stores UTC midnight for a picked day.
export const toDateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  return format(d, 'yyyy-MM-dd');
};

// Local Date for a 'YYYY-MM-DD' key (avoids UTC shifts when formatting)
export const keyToLocalDate = (key) => new Date(`${key}T00:00:00`);
export const fmtKey = (key, pattern = 'EEE, dd MMM') => (key ? format(keyToLocalDate(key), pattern) : '');

export const TYPE_STYLES = {
  earned_leave: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  paid_leave: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  sick_leave: { badge: 'bg-red-100 text-red-800 border-red-200', dot: 'bg-red-500' },
  casual_leave: { badge: 'bg-slate-200 text-slate-800 border-slate-300', dot: 'bg-slate-800' },
  unpaid_leave: { badge: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  comp_off: { badge: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-500' },
  maternity_leave: { badge: 'bg-pink-100 text-pink-800 border-pink-200', dot: 'bg-pink-500' },
  paternity_leave: { badge: 'bg-sky-100 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  bereavement_leave: { badge: 'bg-slate-100 text-slate-700 border-slate-300', dot: 'bg-slate-500' },
  restricted_holiday: { badge: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
};
const FALLBACK_STYLE = { badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' };
export const typeStyle = (name) => TYPE_STYLES[leaveKey(name)] || FALLBACK_STYLE;

export const CATEGORY_STYLES = {
  'Time off': { chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  Sick: { chip: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  Family: { chip: 'bg-pink-100 text-pink-800', dot: 'bg-pink-500' },
  'Optional holiday': { chip: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  Unpaid: { chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  Other: { chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
};
export const categoryStyle = (category) => CATEGORY_STYLES[category] || CATEGORY_STYLES.Other;

export const LEAVE_STATUS = {
  pending: { label: 'Pending', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  manager_approved: { label: 'Partly approved', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-200' },
};
export const statusLabel = (status) => LEAVE_STATUS[status]?.label || status;

// Human description of how a policy type is credited
export const creditLabel = (t) => {
  if (!t) return '';
  if (t.is_unlimited) return 'Unlimited';
  if (t.credit_type === 'event') {
    return (t.event_scope || 'occurrence') === 'occurrence' ? `${t.annual_quota}d per occurrence` : `${t.annual_quota}d per year`;
  }
  if (t.credit_type === 'monthly') return `${t.monthly_credit}d / month`;
  return `${t.annual_quota}d / year`;
};

export const errorText = (error, fallback) => error?.response?.data?.detail || fallback;
