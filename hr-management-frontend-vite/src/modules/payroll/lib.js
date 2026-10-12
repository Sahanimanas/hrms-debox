// Shared helpers for the payroll module.
import api from '@/lib/api';

export const API = '/v2/payroll';

export const fmtINR = (value, digits = 2) => {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

export const fmtNum = (value) => (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthLabel = (month, long = false) => {
  if (!month) return '—';
  const [y, m] = month.split('-').map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
};

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const fyOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** Last few financial years, newest first. */
export const recentFys = (count = 4) => {
  const current = fyOf(currentMonth());
  const start = parseInt(current.slice(0, 4), 10);
  return Array.from({ length: count }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, '0')}`);
};

export const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const errMsg = (error, fallback = 'Something went wrong') => {
  const data = error?.response?.data;
  if (data?.errors?.length) return data.errors.map(e => e.message).join('; ');
  return data?.detail || fallback;
};

/** Download a file from the API (auth header included). */
export async function downloadFile(path, filename, params) {
  const response = await api.get(path, { params, responseType: 'blob' });
  const disposition = response.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] || filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return response;
}

/** Error responses for blob requests arrive as Blobs — read the JSON detail out of them. */
export async function blobErrMsg(error, fallback = 'Download failed') {
  try {
    const text = await error?.response?.data?.text?.();
    return JSON.parse(text).detail || fallback;
  } catch {
    return errMsg(error, fallback);
  }
}

export const RUN_STATUS_STYLES = {
  draft: 'bg-amber-100 text-amber-700',
  locked: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
};

export const LOAN_STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  disbursed: 'bg-purple-100 text-purple-700',
  closed: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

export const ITEM_STATUS_STYLES = {
  declared: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export const SECTION_LABELS = {
  '80C': '80C — PPF, ELSS, LIC, tuition, home-loan principal',
  '80D_self': '80D — health insurance (self & family)',
  '80D_parents': '80D — health insurance (parents)',
  '80CCD1B': '80CCD(1B) — additional NPS',
  '24B': '24(b) — home-loan interest',
  '80E': '80E — education-loan interest',
  '80TTA': '80TTA — savings interest',
  HRA: 'HRA — rent paid',
  OTHER: 'Other deductions',
};

export const ONE_OFF_LABELS = {
  bonus: 'Bonus',
  arrears: 'Arrears',
  incentive: 'Incentive',
  other_earning: 'Other earning',
  other_deduction: 'Other deduction',
};

/** Open an uploaded declaration proof in a new tab (fetched with the auth header). */
export async function openProof(declarationId, itemId, proof) {
  const res = await api.get(`${API}/declarations/${declarationId}/items/${itemId}/proofs/${proof.id}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
