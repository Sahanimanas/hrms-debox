/**
 * Leave day counting (LV-3 sandwich rule) and per-type rules (LV-2:
 * per-occurrence caps, restricted-holiday dates, gender restriction).
 *
 * The same functions back apply, admin edit and the validate endpoint so the
 * number shown before submitting is the number that is charged.
 */

const { normalizeLeaveType } = require('../../utils/helpers');
const {
  toKeys,
  weekdayOfKey,
  addDaysKey,
  getWeeklyOffs,
  getHolidayMap,
  isPublicHoliday,
  isOccurrenceType,
  dateKey
} = require('./common');

const ACTIVE_STATUSES = ['pending', 'manager_approved', 'approved'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Count the days a leave application uses.
 *
 * - Every selected date counts 1 (0.5 when it is a half-day application).
 * - With the policy's sandwich rule on, weekly offs (from the employee's shift)
 *   and public holidays that sit between two leave days — i.e. a gap made up
 *   only of non-working days — are counted as leave as well.
 *
 * Returns { days_count, applied_days, sandwich_rule, sandwich_days, sandwich_dates,
 *           non_working_selected, weekly_offs, breakdown }
 */
async function computeLeaveDays(db, { employee, dates, isHalfDay = false, policyItem = null }) {
  const keys = toKeys(dates);
  const applied = isHalfDay ? keys.length * 0.5 : keys.length;
  const result = {
    dates: keys,
    applied_days: applied,
    sandwich_rule: !!policyItem?.sandwich_rule,
    sandwich_days: 0,
    sandwich_dates: [],
    non_working_selected: [],
    weekly_offs: [],
    breakdown: [],
    days_count: applied
  };
  if (!keys.length) return result;

  const offs = await getWeeklyOffs(db, employee);
  // Look a little past the ends so the UI can explain neighbouring holidays too
  const holidays = await getHolidayMap(db, addDaysKey(keys[0], -1), addDaysKey(keys[keys.length - 1], 1));
  const reasonFor = (k) => {
    if (isPublicHoliday(holidays[k])) return `Holiday — ${holidays[k].name}`;
    if (offs.includes(weekdayOfKey(k))) return `Weekly off (${WEEKDAY_NAMES[weekdayOfKey(k)]})`;
    return null;
  };

  result.weekly_offs = offs;
  result.non_working_selected = keys.filter(k => reasonFor(k)).map(k => ({ date: k, reason: reasonFor(k) }));

  if (policyItem?.sandwich_rule && !isHalfDay && keys.length >= 2) {
    for (let i = 0; i < keys.length - 1; i++) {
      const gap = [];
      for (let k = addDaysKey(keys[i], 1); k < keys[i + 1]; k = addDaysKey(k, 1)) gap.push(k);
      if (gap.length && gap.every(k => reasonFor(k))) {
        for (const k of gap) result.breakdown.push({ date: k, reason: reasonFor(k) });
      }
    }
    result.sandwich_dates = result.breakdown.map(b => b.date);
    result.sandwich_days = result.sandwich_dates.length;
  }

  result.days_count = applied + result.sandwich_days;
  return result;
}

const fail = (detail, extra = {}) => ({ ok: false, status: 400, detail, ...extra });

/**
 * Rules specific to the leave type. Returns { ok: true } or { ok: false, status, detail }.
 */
async function validateTypeRules(db, { employee, policyItem, keys, daysCount, excludeLeaveId = null }) {
  if (!policyItem) return { ok: true };
  const typeName = policyItem.leave_type;

  // Gender restriction (only enforced when the employee record carries a gender)
  const restriction = policyItem.gender_restriction;
  if (restriction && employee?.gender && String(employee.gender).toLowerCase() !== String(restriction).toLowerCase()) {
    return fail(`${typeName} is only available to ${restriction} employees`, { rule: 'gender' });
  }

  // Restricted / optional holiday quota: only on optional or restricted holidays
  if (policyItem.restricted_holiday_only && keys.length) {
    const holidays = await getHolidayMap(db, keys[0], keys[keys.length - 1]);
    const invalid = keys.filter(k => !['optional', 'restricted'].includes(holidays[k]?.type));
    if (invalid.length) {
      return fail(`${typeName} can only be taken on optional or restricted holidays. Not eligible: ${invalid.join(', ')}`, { rule: 'restricted_holiday', invalid_dates: invalid });
    }
  }

  // Event leave granted per occurrence
  if (isOccurrenceType(policyItem)) {
    const perOccurrence = Number(policyItem.annual_quota) || 0;
    if (perOccurrence > 0 && daysCount > perOccurrence) {
      return fail(`${typeName} allows up to ${perOccurrence} days per occurrence. Requested: ${daysCount} days`, { rule: 'per_occurrence' });
    }
    const maxPerYear = Number(policyItem.max_occurrences_per_year) || 0;
    if (maxPerYear > 0 && keys.length && employee?.email) {
      const year = keys[0].slice(0, 4);
      const wanted = normalizeLeaveType(typeName);
      const existing = await db.collection('leaves')
        .find({ employee_email: employee.email, status: { $in: ACTIVE_STATUSES } }, { projection: { _id: 0, id: 1, leave_type: 1, dates: 1 } })
        .toArray();
      const used = existing.filter(l =>
        l.id !== excludeLeaveId &&
        normalizeLeaveType(l.leave_type || '') === wanted &&
        (dateKey((l.dates || [])[0]) || '').startsWith(year)
      ).length;
      if (used >= maxPerYear) {
        return fail(`${typeName} can be taken ${maxPerYear} time(s) per year; you already have ${used} in ${year}`, { rule: 'occurrences' });
      }
    }
  }

  return { ok: true };
}

/**
 * An active leave of the same employee already covering one of these dates.
 * Two half days on the same date in different halves (morning / afternoon) don't clash.
 */
async function findOverlap(db, employeeEmail, keys, { excludeLeaveId = null, isHalfDay = false, halfDayPeriod = null } = {}) {
  if (!employeeEmail || !keys.length) return null;
  const leaves = await db.collection('leaves')
    .find({ employee_email: employeeEmail, status: { $in: ACTIVE_STATUSES } }, { projection: { _id: 0, id: 1, leave_type: 1, dates: 1, status: 1, is_half_day: 1, half_day_period: 1 } })
    .toArray();
  const wanted = new Set(keys);
  for (const l of leaves) {
    if (l.id === excludeLeaveId) continue;
    if (isHalfDay && l.is_half_day && halfDayPeriod && l.half_day_period && halfDayPeriod !== l.half_day_period) continue;
    const clash = (l.dates || []).map(dateKey).find(k => wanted.has(k));
    if (clash) return { leave: l, date: clash };
  }
  return null;
}

module.exports = { computeLeaveDays, validateTypeRules, findOverlap, ACTIVE_STATUSES };
