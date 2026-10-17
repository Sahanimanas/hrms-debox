// Field checks for people forms. They mirror the Joi rules in
// hrm-backend-nodejs/models/schemas.js (emailField, personNameField) — keep in sync.
// Each returns an error message, or null when the value is fine.

const EMAIL_RE = /^[^\s@"'\\<>]+@[^\s@"'\\<>]+\.[A-Za-z]{2,}$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'-]*$/u;

export function emailError(value, { required = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) return required ? 'Email is required' : null;
  if (v.length > 254 || !EMAIL_RE.test(v) || v.includes('..')) return 'Enter a valid email address';
  return null;
}

export function nameError(value, { required = true, label = 'Name' } = {}) {
  const v = String(value ?? '').trim();
  if (!v) return required ? `${label} is required` : null;
  if (v.length < 2) return `${label} must be at least 2 characters`;
  if (v.length > 100) return `${label} is too long`;
  if (!NAME_RE.test(v)) return `${label} must start with a letter and contain only letters, numbers, spaces and . ' -`;
  return null;
}

/** YYYY-MM-DD date checks: required, not in the future, minimum age. */
export function dateError(value, { required = false, label = 'Date', notFuture = false, minAgeYears } = {}) {
  if (!value) return required ? `${label} is required` : null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `Enter a valid ${label.toLowerCase()}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (notFuture && d > today) return `${label} cannot be in the future`;
  if (minAgeYears) {
    const cutoff = new Date(today);
    cutoff.setFullYear(cutoff.getFullYear() - minAgeYears);
    if (d > cutoff) return `Employee must be at least ${minAgeYears} years old`;
  }
  if (d.getFullYear() < 1900) return `Enter a valid ${label.toLowerCase()}`;
  return null;
}

export function amountError(value, { label = 'Amount' } = {}) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0) return `${label} cannot be negative`;
  return null;
}

/** First non-null message from an { field: message } map. */
export const firstError = (errors) => Object.values(errors).find(Boolean) || null;
