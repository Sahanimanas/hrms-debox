// Phone numbers are stored as "+<dial code> <national digits>", e.g. "+91 9876543210".
// Each country lists the allowed length of the national number (without the dial
// code or a leading trunk 0) and, where useful, a stricter pattern.

export const DEFAULT_COUNTRY = 'IN';

export const COUNTRIES = [
  { iso: 'IN', name: 'India', dial: '91', min: 10, max: 10, pattern: /^[6-9]\d{9}$/, hint: 'Indian mobile numbers start with 6, 7, 8 or 9' },
  { iso: 'US', name: 'United States', dial: '1', min: 10, max: 10, pattern: /^[2-9]\d{9}$/ },
  { iso: 'CA', name: 'Canada', dial: '1', min: 10, max: 10, pattern: /^[2-9]\d{9}$/ },
  { iso: 'GB', name: 'United Kingdom', dial: '44', min: 9, max: 10 },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', min: 8, max: 9 },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', min: 9, max: 9 },
  { iso: 'QA', name: 'Qatar', dial: '974', min: 8, max: 8 },
  { iso: 'KW', name: 'Kuwait', dial: '965', min: 8, max: 8 },
  { iso: 'OM', name: 'Oman', dial: '968', min: 8, max: 8 },
  { iso: 'BH', name: 'Bahrain', dial: '973', min: 8, max: 8 },
  { iso: 'SG', name: 'Singapore', dial: '65', min: 8, max: 8 },
  { iso: 'MY', name: 'Malaysia', dial: '60', min: 9, max: 10 },
  { iso: 'AU', name: 'Australia', dial: '61', min: 9, max: 9 },
  { iso: 'NZ', name: 'New Zealand', dial: '64', min: 8, max: 10 },
  { iso: 'BD', name: 'Bangladesh', dial: '880', min: 10, max: 10 },
  { iso: 'PK', name: 'Pakistan', dial: '92', min: 10, max: 10 },
  { iso: 'LK', name: 'Sri Lanka', dial: '94', min: 9, max: 9 },
  { iso: 'NP', name: 'Nepal', dial: '977', min: 8, max: 10 },
  { iso: 'CN', name: 'China', dial: '86', min: 11, max: 11 },
  { iso: 'HK', name: 'Hong Kong', dial: '852', min: 8, max: 8 },
  { iso: 'JP', name: 'Japan', dial: '81', min: 9, max: 10 },
  { iso: 'KR', name: 'South Korea', dial: '82', min: 9, max: 10 },
  { iso: 'PH', name: 'Philippines', dial: '63', min: 10, max: 10 },
  { iso: 'ID', name: 'Indonesia', dial: '62', min: 9, max: 12 },
  { iso: 'TH', name: 'Thailand', dial: '66', min: 9, max: 9 },
  { iso: 'VN', name: 'Vietnam', dial: '84', min: 9, max: 10 },
  { iso: 'DE', name: 'Germany', dial: '49', min: 7, max: 11 },
  { iso: 'FR', name: 'France', dial: '33', min: 9, max: 9 },
  { iso: 'NL', name: 'Netherlands', dial: '31', min: 9, max: 9 },
  { iso: 'BE', name: 'Belgium', dial: '32', min: 8, max: 9 },
  { iso: 'IE', name: 'Ireland', dial: '353', min: 7, max: 9 },
  { iso: 'ES', name: 'Spain', dial: '34', min: 9, max: 9 },
  { iso: 'PT', name: 'Portugal', dial: '351', min: 9, max: 9 },
  { iso: 'IT', name: 'Italy', dial: '39', min: 6, max: 11, leadingZero: true },
  { iso: 'CH', name: 'Switzerland', dial: '41', min: 9, max: 9 },
  { iso: 'AT', name: 'Austria', dial: '43', min: 4, max: 13 },
  { iso: 'SE', name: 'Sweden', dial: '46', min: 7, max: 9 },
  { iso: 'NO', name: 'Norway', dial: '47', min: 8, max: 8 },
  { iso: 'DK', name: 'Denmark', dial: '45', min: 8, max: 8 },
  { iso: 'FI', name: 'Finland', dial: '358', min: 6, max: 10 },
  { iso: 'PL', name: 'Poland', dial: '48', min: 9, max: 9 },
  { iso: 'RU', name: 'Russia', dial: '7', min: 10, max: 10 },
  { iso: 'TR', name: 'Turkey', dial: '90', min: 10, max: 10 },
  { iso: 'IL', name: 'Israel', dial: '972', min: 8, max: 9 },
  { iso: 'EG', name: 'Egypt', dial: '20', min: 10, max: 10 },
  { iso: 'ZA', name: 'South Africa', dial: '27', min: 9, max: 9 },
  { iso: 'NG', name: 'Nigeria', dial: '234', min: 8, max: 10 },
  { iso: 'KE', name: 'Kenya', dial: '254', min: 9, max: 9 },
  { iso: 'BR', name: 'Brazil', dial: '55', min: 10, max: 11 },
  { iso: 'MX', name: 'Mexico', dial: '52', min: 10, max: 10 },
  { iso: 'AR', name: 'Argentina', dial: '54', min: 10, max: 10 },
  { iso: 'CL', name: 'Chile', dial: '56', min: 9, max: 9 },
  { iso: 'CO', name: 'Colombia', dial: '57', min: 10, max: 10 },
];

const BY_ISO = Object.fromEntries(COUNTRIES.map((c) => [c.iso, c]));

// Longest dial codes first so "+971…" isn't read as "+97…"; for shared codes (+1) the first listed wins.
const BY_DIAL = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

export const getCountry = (iso) => BY_ISO[iso] || BY_ISO[DEFAULT_COUNTRY];

export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Split a stored value into { iso, national }. Accepts the stored format and
 * older free-text values ("9876543210", "+91-98765 43210", "(0) 98765…").
 */
export function parsePhone(value, defaultIso = DEFAULT_COUNTRY) {
  const raw = String(value ?? '').trim();
  if (!raw) return { iso: defaultIso, national: '' };

  if (raw.startsWith('+') || raw.startsWith('00')) {
    const digits = digitsOnly(raw).replace(/^00/, '');
    const match = BY_DIAL.find((c) => digits.startsWith(c.dial));
    if (match) return { iso: match.iso, national: stripTrunk(digits.slice(match.dial.length), match) };
    return { iso: defaultIso, national: digits };
  }

  const country = getCountry(defaultIso);
  let digits = digitsOnly(raw);
  // "919876543210" typed without the plus
  if (digits.length > country.max && digits.startsWith(country.dial)) digits = digits.slice(country.dial.length);
  return { iso: country.iso, national: stripTrunk(digits, country) };
}

const stripTrunk = (digits, country) => (country.leadingZero ? digits : digits.replace(/^0+/, ''));

/** "+91 9876543210", or '' when no number was entered. */
export const formatPhone = (iso, national) => {
  const digits = digitsOnly(national);
  return digits ? `+${getCountry(iso).dial} ${digits}` : '';
};

/** Error message for a stored/typed phone value, or null when it's fine. */
export function phoneError(value, { required = false } = {}) {
  const { iso, national } = parsePhone(value);
  const country = getCountry(iso);
  if (!national) return required ? 'Phone number is required' : null;
  if (!/^\d+$/.test(national)) return 'Use digits only';
  if (!country.leadingZero && national.startsWith('0')) return 'Leave out the leading 0';
  if (national.length < country.min || national.length > country.max) {
    const len = country.min === country.max ? `${country.max} digits` : `${country.min}–${country.max} digits`;
    return `${country.name} numbers have ${len}`;
  }
  if (country.pattern && !country.pattern.test(national)) return country.hint || `Enter a valid ${country.name} number`;
  return null;
}

export const isValidPhone = (value, opts) => phoneError(value, opts) === null;
