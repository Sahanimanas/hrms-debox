// Shared constants and formatters for the assets & expenses module.
import { format } from 'date-fns';

export const ASSET_STATUSES = [
  { value: 'available', label: 'Available', cls: 'bg-emerald-100 text-emerald-700' },
  { value: 'assigned', label: 'Assigned', cls: 'bg-sky-100 text-sky-700' },
  { value: 'in_repair', label: 'In repair', cls: 'bg-amber-100 text-amber-700' },
  { value: 'retired', label: 'Retired', cls: 'bg-slate-200 text-slate-700' },
  { value: 'lost', label: 'Lost', cls: 'bg-red-100 text-red-700' },
];
export const STATUS_MAP = Object.fromEntries(ASSET_STATUSES.map(s => [s.value, s]));

export const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];

export const REQUEST_STATUS = {
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', cls: 'bg-sky-100 text-sky-700' },
  fulfilled: { label: 'Fulfilled', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
};

export const ISSUE_STATUS = {
  open: { label: 'Open', cls: 'bg-amber-100 text-amber-700' },
  in_repair: { label: 'In repair', cls: 'bg-sky-100 text-sky-700' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-100 text-emerald-700' },
  closed: { label: 'Closed', cls: 'bg-slate-200 text-slate-600' },
};

export const TRAVEL_STATUS = {
  pending_manager: { label: 'Awaiting manager', cls: 'bg-amber-100 text-amber-700' },
  pending_admin: { label: 'Awaiting admin', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
  settled: { label: 'Settled', cls: 'bg-purple-100 text-purple-700' },
};

export const TRAVEL_MODES = [
  { value: 'flight', label: 'Flight' },
  { value: 'train', label: 'Train' },
  { value: 'bus', label: 'Bus' },
  { value: 'car', label: 'Own car' },
  { value: 'cab', label: 'Cab' },
  { value: 'other', label: 'Other' },
];

export const TIER_LABELS = { tier_1: 'Tier 1', tier_2: 'Tier 2', tier_3: 'Tier 3' };

export const EXPENSE_CATEGORIES = [
  'Travel', 'Food & Meals', 'Accommodation', 'Office Supplies', 'Equipment',
  'Software & Tools', 'Training & Courses', 'Medical', 'Communication', 'Other',
];

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,application/pdf';

export const inr = (n) => (n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

export const fmtDate = (value, pattern = 'dd MMM yyyy') => {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return isNaN(d) ? '—' : format(d, pattern);
};

export const isoDay = (value) => (value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : '');

export const humanize = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : '');

export const errorText = (error, fallback) => error?.response?.data?.detail || fallback;

export const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

export const categoryLabel = (categories, key) => categories.find(c => c.key === key)?.label || humanize(key);
