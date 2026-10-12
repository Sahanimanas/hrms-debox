// Shared helpers for the analytics module: chart palette, number formatting,
// date ranges and CSV downloads.

import api from '@/lib/api';

// Validated categorical palette (fixed order — never cycled). Slots 3–5 are
// below 3:1 contrast on white, so every chart also offers a table view.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'];
export const OTHER = '#9ca3af';

export const CHART = {
  grid: '#e5e7eb',
  axis: '#d1d5db',
  tick: '#6b7280',
  text: '#0f172a',
  muted: '#64748b',
};

export const AXIS_TICK = { fill: CHART.tick, fontSize: 11 };

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const fmtInr = (v) => (v == null ? '—' : inr0.format(v));
export const fmtNum = (v, dp = 1) => (v == null ? '—' : (dp === 2 ? num2 : num1).format(v));
export const fmtPct = (v, dp = 1) => (v == null ? '—' : `${Number(v).toFixed(dp)}%`);

/** 1,284 / 12.9K / 4.2L / 1.3Cr — compact INR-style figures for tiles and axes. */
export const fmtCompact = (v) => {
  if (v == null) return '—';
  const n = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (n >= 1e7) return `${sign}${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)}Cr`;
  if (n >= 1e5) return `${sign}${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)}L`;
  if (n >= 1e3) return `${sign}${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return `${sign}${Math.round(n)}`;
};
export const fmtInrCompact = (v) => (v == null ? '—' : `₹${fmtCompact(v)}`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2025-03' -> "Mar '25" */
export const monthLabel = (m) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}` : '');
/** '2025-03-07' -> '7 Mar' */
export const dayLabel = (d) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : '');

const pad = (n) => String(n).padStart(2, '0');
export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const addMonths = (m, n) => {
  const [y, mm] = m.split('-').map(Number);
  const idx = y * 12 + mm - 1 + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
};
export const addDays = (d, n) => {
  const t = new Date(`${d}T12:00:00Z`).getTime() + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

export const MONTH_PRESETS = [
  { key: '6m', label: 'Last 6 months', months: 6 },
  { key: '12m', label: 'Last 12 months', months: 12 },
  { key: '24m', label: 'Last 24 months', months: 24 },
  { key: 'ytd', label: 'Year to date' },
];
export const monthPresetRange = (key) => {
  const to = thisMonth();
  if (key === 'ytd') return { from: `${to.slice(0, 4)}-01`, to };
  const p = MONTH_PRESETS.find(x => x.key === key) || MONTH_PRESETS[1];
  return { from: addMonths(to, -(p.months - 1)), to };
};

export const DAY_PRESETS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'mtd', label: 'Month to date' },
];
export const dayPresetRange = (key) => {
  const to = todayIso();
  if (key === 'mtd') return { from: `${to.slice(0, 8)}01`, to };
  const p = DAY_PRESETS.find(x => x.key === key) || DAY_PRESETS[1];
  return { from: addDays(to, -(p.days - 1)), to };
};

/** Drop empty filter values so the API sees only what was chosen. */
export const cleanParams = (params) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '' && v !== 'all'));

const filenameFrom = (disposition, fallback) => {
  const m = /filename="?([^";]+)"?/i.exec(disposition || '');
  return m ? m[1] : fallback;
};

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Download a server-generated CSV (GET). */
export async function downloadServerCsv(path, params, fallbackName = 'export.csv') {
  const res = await api.get(path, { params, responseType: 'blob' });
  saveBlob(res.data, filenameFrom(res.headers?.['content-disposition'], fallbackName));
}

/** Download a server-generated CSV (POST body). */
export async function downloadServerCsvPost(path, body, fallbackName = 'export.csv') {
  const res = await api.post(path, body, { responseType: 'blob' });
  saveBlob(res.data, filenameFrom(res.headers?.['content-disposition'], fallbackName));
}

/** Error text from an axios error, including blob responses. */
export async function errorText(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).detail || fallback;
    } catch {
      return fallback;
    }
  }
  return data?.detail || fallback;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const scheduleSummary = (s) => {
  if (!s) return 'Not scheduled';
  const t = s.time;
  if (s.frequency === 'daily') return `Daily at ${t}`;
  if (s.frequency === 'weekly') return `Weekly on ${WEEKDAYS[s.day_of_week] || '—'} at ${t}`;
  if (s.frequency === 'monthly') return `Monthly on day ${s.day_of_month} at ${t}`;
  return '—';
};

export const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};
