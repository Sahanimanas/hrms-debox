/**
 * Pure calendar helpers for the engagement module (no database / service deps,
 * so tests can load them directly).
 */

const { localParts } = require('../../utils/helpers');

const pad = (n) => String(n).padStart(2, '0');

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Add days to a 'YYYY-MM-DD' string. */
const addDays = (dateStr, n) =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const daysBetween = (fromStr, toStr) =>
  Math.round((Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`)) / 86400000);

/**
 * Calendar date of a stored date (date of birth, joining date).
 * Dates saved as UTC midnight ('YYYY-MM-DD' inputs) use their UTC date; other
 * timestamps use the company timezone. Returns { year, month, day } or null.
 */
const calendarParts = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return { year, month, day };
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  const p = localParts(d);
  return { year: p.year, month: p.month, day: p.day };
};

/**
 * The date (YYYY-MM-DD) on which a month/day recurs in `year`.
 * Feb 29 falls back to Feb 28 in non-leap years.
 */
const occurrenceIn = (year, month, day) => {
  if (month === 2 && day === 29 && !isLeapYear(year)) return `${year}-02-28`;
  return `${year}-${pad(month)}-${pad(day)}`;
};

module.exports = { pad, isLeapYear, addDays, daysBetween, calendarParts, occurrenceIn };
