// Helpers shared by the platform module pages.
import { format } from 'date-fns';
import { toast } from 'sonner';
import api from '@/lib/api';

/** Human-readable message from an axios error (handles 422 field errors). */
export function errorMessage(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (data?.errors?.length) return data.errors.map(e => e.message.replace(/"/g, '')).join('; ');
  if (typeof data?.detail === 'string') return data.detail;
  return fallback;
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d) ? '—' : format(d, 'dd MMM yyyy, HH:mm');
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d) ? '—' : format(d, 'dd MMM yyyy');
}

/** Download an authenticated file (CSV / XML) from the API. */
export async function downloadFile(path, params, fallbackName) {
  const res = await api.get(path, { params, responseType: 'blob' });
  const disposition = res.headers?.['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** For blob responses the error body is a Blob; read its JSON detail. */
export async function blobErrorMessage(error, fallback) {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.detail || fallback;
    } catch {
      return fallback;
    }
  }
  return errorMessage(error, fallback);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const STATUS_TONES = {
  success: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  retrying: 'bg-amber-100 text-amber-700',
  pending: 'bg-slate-100 text-slate-700',
};

// Microsoft SSO: state + nonce kept in sessionStorage between redirect and callback
export const MS_SSO_STATE_KEY = 'xenohr-ms-sso';

/** Copy to the clipboard and confirm with a toast. */
export async function copyWithToast(text, label = 'Copied to clipboard') {
  if (await copyText(text)) toast.success(label);
  else toast.error('Could not copy — select the text and copy it manually');
}
