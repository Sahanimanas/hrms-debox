// Shared helpers for the lifecycle module (Phase 3).
import { format } from 'date-fns';
import api from '@/lib/api';

export const API = '/v2/lifecycle';

export const errMsg = (error, fallback = 'Something went wrong') => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') {
    const fieldErrors = error.response.data.errors;
    if (detail === 'Validation failed' && Array.isArray(fieldErrors) && fieldErrors.length) {
      return fieldErrors.map(e => e.message.replace(/"/g, '')).join('; ');
    }
    return detail;
  }
  return fallback;
};

// 'YYYY-MM-DD' or ISO → '12 Oct 2026'
export const fmtDate = (value, pattern = 'dd MMM yyyy') => {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (isNaN(d)) return '—';
  return format(d, pattern);
};

export const toYmd = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return isNaN(d) ? '' : format(d, 'yyyy-MM-dd');
};

export const todayYmd = () => format(new Date(), 'yyyy-MM-dd');

export const fmtMoney = (n) =>
  n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const initials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts.length === 1 ? parts[0][0] : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const AVATAR_COLORS = ['bg-slate-800', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500', 'bg-orange-500', 'bg-indigo-500'];
export const avatarColor = (name) => {
  if (!name) return AVATAR_COLORS[0];
  return AVATAR_COLORS[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
};

/** Download a file from an authenticated API endpoint. */
export const downloadFile = async (url, filename, { inline = false } = {}) => {
  const response = await api.get(url, { responseType: 'blob', params: inline ? { inline: 1 } : undefined });
  const blobUrl = URL.createObjectURL(response.data);
  if (inline) {
    window.open(blobUrl, '_blank', 'noopener');
  } else {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
};

export const OWNER_LABELS = { hr: 'HR', manager: 'Manager', employee: 'Employee', it: 'IT' };

export const EMPLOYMENT_STATUS = {
  active: { label: 'Active', cls: 'bg-emerald-100 text-emerald-700' },
  probation: { label: 'Probation', cls: 'bg-amber-100 text-amber-700' },
  notice: { label: 'Notice period', cls: 'bg-orange-100 text-orange-700' },
  exited: { label: 'Exited', cls: 'bg-slate-200 text-slate-600' },
};

export const SEPARATION_STATUS = {
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Serving notice', cls: 'bg-blue-100 text-blue-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-slate-100 text-slate-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600' },
  completed: { label: 'Exited', cls: 'bg-emerald-100 text-emerald-700' },
};

export const REQUEST_STATUS = {
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600' },
};

export const VERIFICATION_STATUS = {
  pending: { label: 'Pending review', cls: 'bg-amber-100 text-amber-700' },
  verified: { label: 'Verified', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
};

export const JOB_TYPE_LABELS = {
  joined: 'Joined',
  promotion: 'Promotion',
  transfer: 'Transfer',
  increment: 'Increment',
  salary_change: 'Salary change',
  designation_change: 'Designation change',
  department_change: 'Department change',
  manager_change: 'Manager change',
  role_change: 'Role change',
  confirmation: 'Confirmed',
  probation_extension: 'Probation extended',
  separation: 'Separation',
  exit: 'Exited',
  other: 'Other',
};

export const humanize = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '');
