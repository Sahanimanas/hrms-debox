// Money formatting (PL-8).
//
//   import { formatMoney } from '@/lib/money';
//   formatMoney(125000)                                   // "₹1,25,000.00"
//   formatMoney(1999.5, { currency: 'USD', locale: 'en-US' }) // "$1,999.50"
//   formatMoney(125000, { compact: true })                 // "₹1.3L"
//
// Pages should take the organization's currency/locale from
// useOrgPreferences() (src/lib/orgPreferences.js):
//   const { prefs } = useOrgPreferences();
//   formatMoney(amount, prefs);   // prefs = { currency, locale, date_format }
//
// Amounts are stored in the backend as plain numbers (INR by default, rounded to
// 2 decimals); this module only formats them — it never converts currencies.

export const DEFAULT_CURRENCY = 'INR';
export const DEFAULT_LOCALE = 'en-IN';

const formatters = new Map();

function getFormatter(currency, locale, opts) {
  const key = `${currency}|${locale}|${JSON.stringify(opts)}`;
  if (!formatters.has(key)) {
    try {
      formatters.set(key, new Intl.NumberFormat(locale, { style: 'currency', currency, ...opts }));
    } catch {
      formatters.set(key, new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY, ...opts }));
    }
  }
  return formatters.get(key);
}

/**
 * Format an amount as currency.
 * @param {number|string} amount
 * @param {{ currency?: string, locale?: string, decimals?: number, compact?: boolean }} [options]
 */
export function formatMoney(amount, { currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE, decimals, compact = false } = {}) {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return '—';
  const opts = compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2 };
  return getFormatter(currency || DEFAULT_CURRENCY, locale || DEFAULT_LOCALE, opts).format(n);
}

/** The currency symbol for a currency/locale pair, e.g. "₹" or "$". */
export function currencySymbol(currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) {
  const part = getFormatter(currency, locale, {}).formatToParts(0).find(p => p.type === 'currency');
  return part?.value || currency;
}

/** Round to 2 decimals the way the backend stores money. */
export const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;
