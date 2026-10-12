/**
 * Gratuity (Payment of Gratuity Act, 1972) — PY-9.
 *
 *   amount = 15 / 26 × last drawn monthly basic (+DA) × completed years of service
 *
 * - A part year of 6 months or more counts as a full year.
 * - Payable only after 5 years of continuous service (actual service, before rounding).
 * - Capped at ₹20,00,000.
 *
 * Signature is relied on by the lifecycle module (full & final settlement):
 *   computeGratuity({ basicMonthly, joiningDate, exitDate }) -> { eligible, years, amount, ... }
 */

const GRATUITY_CAP = 2000000;
const MIN_YEARS = 5;

const toDate = (value) => {
  if (value instanceof Date) return new Date(value.getTime());
  const d = new Date(value);
  return isNaN(d) ? null : d;
};

/** Completed years, months and days between two dates (UTC calendar arithmetic). */
function serviceBetween(start, end) {
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  let days = end.getUTCDate() - start.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

function computeGratuity({ basicMonthly, joiningDate, exitDate } = {}) {
  const basic = Math.max(0, Number(basicMonthly) || 0);
  const start = toDate(joiningDate);
  const end = exitDate ? toDate(exitDate) : new Date();

  if (!start || !end || end < start) {
    return { eligible: false, years: 0, amount: 0, service: { years: 0, months: 0, days: 0 }, reason: 'Invalid joining or exit date' };
  }

  const service = serviceBetween(start, end);
  const years = service.years + (service.months >= 6 ? 1 : 0);
  const eligible = service.years >= MIN_YEARS;
  const uncapped = eligible ? (15 / 26) * basic * years : 0;
  const amount = Math.round(Math.min(uncapped, GRATUITY_CAP) * 100) / 100;

  return {
    eligible,
    years,
    amount,
    service,
    capped: uncapped > GRATUITY_CAP,
    reason: eligible ? null : `Gratuity is payable after ${MIN_YEARS} years of continuous service`
  };
}

module.exports = { computeGratuity, GRATUITY_CAP, serviceBetween };
