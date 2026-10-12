// Shared helpers for the engagement module pages.
import { useCallback, useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';

export const API = '/v2/engagement';

export const PRIMARY_BTN = 'bg-slate-800 hover:bg-slate-900 rounded-lg sm:rounded-xl shadow-md gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto';

export const currentUser = () => getAuth().user || {};
export const currentRole = () => currentUser().role || 'employee';
export const isAdmin = () => currentRole() === 'admin';

export const errorMessage = (error, fallback = 'Something went wrong') => {
  const d = error?.response?.data;
  if (d?.errors?.length) return d.errors.map(e => e.message).join('; ');
  return d?.detail || fallback;
};

/**
 * Load JSON from the API. Returns { data, loading, error, reload, setData }.
 * `path` may be null to skip loading.
 */
export function useApi(path, { params, initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState(null);
  const paramsKey = JSON.stringify(params || {});

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(path, { params: JSON.parse(paramsKey) });
      setData(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [path, paramsKey]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload, setData };
}

// Uploaded files may come back as a path relative to the backend.
export const fileUrl = (url) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (import.meta.env.VITE_APP_BACKEND_URL || '').replace(/\/$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
};

export const fmtDate = (value, pattern = 'dd MMM yyyy') => {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return isNaN(d) ? '—' : format(d, pattern);
};

export const fmtDateTime = (value) => fmtDate(value, 'dd MMM yyyy, h:mm a');

export const timeAgo = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d) ? '' : formatDistanceToNow(d, { addSuffix: true });
};

// <input type="datetime-local"> value <-> ISO
export const toLocalInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return '';
  return format(d, "yyyy-MM-dd'T'HH:mm");
};
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

export const audienceLabel = (audience) =>
  !audience || audience.type !== 'departments' ? 'Everyone' : audience.departments.join(', ');

export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export const initials = (name) =>
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

export const AVATAR_TONES = [
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
];
export const avatarTone = (seed) => {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
};

export const VALUE_TONES = {
  Teamwork: 'bg-sky-100 text-sky-700 border-sky-200',
  Ownership: 'bg-amber-100 text-amber-700 border-amber-200',
  'Customer First': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Innovation: 'bg-violet-100 text-violet-700 border-violet-200',
  Integrity: 'bg-slate-100 text-slate-700 border-slate-200',
};
export const valueTone = (v) => VALUE_TONES[v] || 'bg-rose-100 text-rose-700 border-rose-200';

export const QUESTION_TYPE_LABELS = {
  rating: 'Rating (1–5)',
  nps: 'eNPS (0–10)',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  text: 'Text',
};

/** Download a file (e.g. CSV) from an authenticated API endpoint. */
export async function downloadFromApi(path, filename) {
  const res = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Axios error bodies for blob requests arrive as Blobs; read the detail message. */
export async function blobErrorMessage(error, fallback) {
  try {
    const text = await error?.response?.data?.text?.();
    return JSON.parse(text).detail || fallback;
  } catch {
    return errorMessage(error, fallback);
  }
}

export const GRIEVANCE_STATUS_STYLES = {
  open: 'bg-sky-100 text-sky-700',
  investigating: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-200 text-slate-600',
};
