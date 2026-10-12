// Recruitment module: shared constants and helpers (no components here, so
// react-refresh stays happy).
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { format, formatDistanceToNow } from 'date-fns';

export const API = '/v2/recruitment';

export const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
export const PIPELINE_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired'];
export const STAGE_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
export const STAGE_STYLES = {
  applied: 'bg-slate-100 text-slate-700',
  screening: 'bg-sky-100 text-sky-700',
  interview: 'bg-indigo-100 text-indigo-700',
  offer: 'bg-amber-100 text-amber-800',
  hired: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-zinc-200 text-zinc-600',
};
export const STAGE_ACCENT = {
  applied: 'border-t-slate-400',
  screening: 'border-t-sky-400',
  interview: 'border-t-indigo-400',
  offer: 'border-t-amber-400',
  hired: 'border-t-emerald-500',
  rejected: 'border-t-red-400',
  withdrawn: 'border-t-zinc-400',
};

export const SOURCE_LABELS = {
  careers_page: 'Careers page',
  referral: 'Referral',
  job_board: 'Job board',
  manual: 'Manual',
};
export const EMPLOYMENT_TYPE_LABELS = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
};
export const WORK_MODE_LABELS = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };
export const INTERVIEW_MODE_LABELS = { onsite: 'On-site', video: 'Video call', phone: 'Phone' };
export const RECOMMENDATION_LABELS = {
  strong_hire: 'Strong hire',
  hire: 'Hire',
  no_hire: 'No hire',
  strong_no_hire: 'Strong no hire',
};
export const RECOMMENDATION_STYLES = {
  strong_hire: 'bg-emerald-100 text-emerald-800',
  hire: 'bg-emerald-50 text-emerald-700',
  no_hire: 'bg-red-50 text-red-700',
  strong_no_hire: 'bg-red-100 text-red-800',
};
export const STATUS_STYLES = {
  // requisitions
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-zinc-200 text-zinc-600',
  filled: 'bg-indigo-100 text-indigo-700',
  // jobs
  draft: 'bg-slate-100 text-slate-700',
  open: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-zinc-200 text-zinc-600',
  // interviews
  scheduled: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  no_show: 'bg-red-100 text-red-700',
  // offers
  sent: 'bg-sky-100 text-sky-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-zinc-200 text-zinc-600',
};

export const DEFAULT_CRITERIA = ['Technical skills', 'Problem solving', 'Communication', 'Culture fit'];
export const RESUME_ACCEPT = '.pdf,.doc,.docx';
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const currentUser = () => getAuth().user || {};
export const isStaff = (user = currentUser()) => ['admin', 'manager'].includes(user?.role);

export const toOptions = (map) => Object.entries(map).map(([value, text]) => ({ value, label: text }));

export const label = (map, key) => map[key] || (key ? String(key).replace(/_/g, ' ') : '—');

export const errorMessage = (error, fallback = 'Something went wrong') => {
  const data = error?.response?.data;
  if (data?.errors?.length) return data.errors.map(e => e.message).join('; ');
  return data?.detail || fallback;
};

/** Read a Blob error body (downloads use responseType: 'blob'). */
const blobErrorMessage = async (error, fallback) => {
  try {
    const text = await error?.response?.data?.text?.();
    return JSON.parse(text).detail || fallback;
  } catch {
    return fallback;
  }
};

/** Download an authenticated file (resume, PDF, .ics). */
export async function downloadFile(url, fallbackName) {
  try {
    const res = await api.get(url, { responseType: 'blob' });
    const disposition = res.headers?.['content-disposition'] || '';
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) || /filename="?([^";]+)"?/i.exec(disposition);
    const name = match ? decodeURIComponent(match[1]) : fallbackName;
    const href = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return true;
  } catch (error) {
    throw new Error(await blobErrorMessage(error, 'Download failed'));
  }
}

/**
 * Send a resume to the server-side parser and prefill empty email / phone /
 * LinkedIn fields of a form (best effort). Returns { parsed, filled }.
 */
export async function parseResumeInto(file, setForm) {
  const body = new FormData();
  body.append('resume', file);
  const res = await api.post(`${API}/candidates/parse-resume`, body);
  const parsed = res.data || {};
  let filled = 0;
  setForm(f => {
    const next = { ...f };
    for (const key of ['email', 'phone', 'linkedin_url']) {
      if (parsed[key] && !String(f[key] || '').trim()) { next[key] = parsed[key]; filled++; }
    }
    return next;
  });
  return { parsed, filled };
}

/** Client-side resume check mirroring the server (extension + size). */
export function resumeProblem(file) {
  if (!file) return 'Please attach a resume';
  const ext = file.name.toLowerCase().split('.').pop();
  if (!['pdf', 'doc', 'docx'].includes(ext)) return 'Resume must be a PDF, DOC or DOCX file';
  if (file.size > RESUME_MAX_BYTES) return 'Resume must be 5 MB or smaller';
  return null;
}

export const fmtDate = (value, pattern = 'dd MMM yyyy') => {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return isNaN(d) ? '—' : format(d, pattern);
};
export const fmtDateTime = (value) => fmtDate(value, 'EEE, dd MMM yyyy · h:mm a');
export const fmtAgo = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d) ? '—' : formatDistanceToNow(d, { addSuffix: true });
};

export const fmtInr = (amount) => (amount == null || amount === ''
  ? '—'
  : `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(amount))}`);

export const fmtLakhs = (amount) => (amount == null ? '—' : `₹${(Number(amount) / 100000).toFixed(Number(amount) % 100000 ? 1 : 0)}L`);

export const experienceText = (min, max) => {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? `${min} yrs` : `${min}–${max} yrs`;
  return min != null ? `${min}+ yrs` : `Up to ${max} yrs`;
};

export const todayIso = () => format(new Date(), 'yyyy-MM-dd');

/** `datetime-local` input value (local time) ↔ ISO */
export const toLocalInput = (value) => (value ? format(new Date(value), "yyyy-MM-dd'T'HH:mm") : '');

// Chart conventions (matches the app's analytics charts)
export const CHART = { bar: '#334155', grid: '#e2e8f0', axis: '#cbd5e1', muted: '#64748b' };
export const AXIS_TICK = { fontSize: 11, fill: '#64748b' };
