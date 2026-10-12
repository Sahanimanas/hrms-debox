/**
 * AN-1 People analytics: headcount trend, joiners/leavers, attrition, splits,
 * tenure and age bands, manager span of control.
 *
 * Headcount at the end of a month counts everyone who joined on/before the
 * last day and has not exited on/before it. Attrition for a month is
 * leavers ÷ average of opening and closing headcount.
 */

const {
  round, monthRange, monthStart, monthEnd, addDays, todayStr,
  inHeadcountAfter, fullMonthsBetween, ageOn, splitBy, titleCase
} = require('./common');

const TENURE_BANDS = ['< 6 months', '6–12 months', '1–2 years', '2–5 years', '5+ years'];
const AGE_BANDS = ['Under 25', '25–34', '35–44', '45–54', '55+'];

const tenureBand = (months) => {
  if (months < 6) return TENURE_BANDS[0];
  if (months < 12) return TENURE_BANDS[1];
  if (months < 24) return TENURE_BANDS[2];
  if (months < 60) return TENURE_BANDS[3];
  return TENURE_BANDS[4];
};

const ageBand = (age) => {
  if (age < 25) return AGE_BANDS[0];
  if (age < 35) return AGE_BANDS[1];
  if (age < 45) return AGE_BANDS[2];
  if (age < 55) return AGE_BANDS[3];
  return AGE_BANDS[4];
};

/**
 * @param employees normalised employees (already scoped / filtered)
 * @param opts { from: 'YYYY-MM', to: 'YYYY-MM', today?: 'YYYY-MM-DD', managerInfo?: Map(email -> { name, department }) }
 */
function computePeople(employees, { from, to, today = todayStr(), managerInfo = new Map() }) {
  const months = monthRange(from, to);
  const asOf = monthEnd(to) < today ? monthEnd(to) : today;

  const trend = months.map((month) => {
    const first = monthStart(month);
    const last = monthEnd(month);
    const before = addDays(first, -1);
    let opening = 0, closing = 0, joiners = 0, leavers = 0;
    for (const e of employees) {
      if (e.exitedUnknown) continue;
      if (inHeadcountAfter(e, before)) opening += 1;
      if (inHeadcountAfter(e, last)) closing += 1;
      if (e.join && e.join >= first && e.join <= last && (!e.exit || e.exit >= e.join)) joiners += 1;
      if (e.exit && e.exit >= first && e.exit <= last && (!e.join || e.join <= e.exit)) leavers += 1;
    }
    const avg = (opening + closing) / 2;
    return {
      month,
      opening,
      headcount: closing,
      joiners,
      leavers,
      avg_headcount: round(avg),
      attrition_pct: avg ? round(leavers / avg * 100) : 0
    };
  });

  const totalLeavers = trend.reduce((s, m) => s + m.leavers, 0);
  const totalJoiners = trend.reduce((s, m) => s + m.joiners, 0);
  const avgHeadcount = trend.length ? trend.reduce((s, m) => s + (m.opening + m.headcount) / 2, 0) / trend.length : 0;
  const attritionPct = avgHeadcount ? totalLeavers / avgHeadcount * 100 : 0;
  const annualised = trend.length ? attritionPct * 12 / trend.length : 0;

  // Snapshot of the workforce at the end of the range (or today)
  const active = employees.filter(e => inHeadcountAfter(e, asOf));

  const withTenure = active.filter(e => e.join).map(e => ({ e, months: fullMonthsBetween(e.join, asOf) }));
  const withAge = active.filter(e => e.dob && e.dob <= asOf).map(e => ({ e, age: ageOn(e.dob, asOf) }));

  // Span of control: direct reports (manager_email) among the active workforce
  const spans = new Map();
  for (const e of active) {
    if (!e.manager_email) continue;
    const s = spans.get(e.manager_email) || { manager_email: e.manager_email, manager_name: null, direct_reports: 0 };
    s.direct_reports += 1;
    s.manager_name = s.manager_name || managerInfo.get(e.manager_email)?.name || e.manager_name || null;
    spans.set(e.manager_email, s);
  }
  const span = [...spans.values()]
    .map(s => ({ ...s, manager_name: s.manager_name || s.manager_email, department: managerInfo.get(s.manager_email)?.department || null }))
    .sort((a, b) => b.direct_reports - a.direct_reports || a.manager_name.localeCompare(b.manager_name));
  const spanTotal = span.reduce((s, m) => s + m.direct_reports, 0);

  const roster = active.map(e => {
    const tenureMonths = e.join ? fullMonthsBetween(e.join, asOf) : null;
    const age = e.dob && e.dob <= asOf ? ageOn(e.dob, asOf) : null;
    return {
      employee_id: e.employee_id,
      full_name: e.full_name,
      email: e.email,
      department: e.department,
      designation: e.designation,
      organization: e.organization_name || e.organization_id || '',
      gender: e.gender,
      employment_status: titleCase(e.status),
      joining_date: e.join,
      tenure_months: tenureMonths,
      tenure_band: tenureMonths == null ? 'Unknown' : tenureBand(tenureMonths),
      age,
      age_band: age == null ? 'Unknown' : ageBand(age),
      manager_email: e.manager_email || ''
    };
  }).sort((a, b) => a.full_name.localeCompare(b.full_name));

  return {
    range: { from, to, months: months.length, as_of: asOf },
    summary: {
      headcount: active.length,
      opening_headcount: trend[0]?.opening ?? 0,
      joiners: totalJoiners,
      leavers: totalLeavers,
      net_change: totalJoiners - totalLeavers,
      avg_headcount: round(avgHeadcount),
      attrition_pct: round(attritionPct),
      attrition_annualised_pct: round(annualised),
      avg_tenure_months: withTenure.length ? round(withTenure.reduce((s, t) => s + t.months, 0) / withTenure.length, 1) : null,
      avg_tenure_years: withTenure.length ? round(withTenure.reduce((s, t) => s + t.months, 0) / withTenure.length / 12) : null,
      avg_age: withAge.length ? round(withAge.reduce((s, a) => s + a.age, 0) / withAge.length, 1) : null
    },
    trend,
    splits: {
      department: splitBy(active, e => e.department),
      designation: splitBy(active, e => e.designation),
      gender: splitBy(active, e => e.gender),
      employment_status: splitBy(active, e => titleCase(e.status)),
      organization: splitBy(active, e => e.organization_name || (e.organization_id ? e.organization_id : 'No organization'))
    },
    tenure_bands: splitBy(withTenure, t => tenureBand(t.months), TENURE_BANDS),
    age_bands: splitBy(withAge, a => ageBand(a.age), AGE_BANDS),
    span_of_control: {
      managers: span.length,
      avg_direct_reports: span.length ? round(spanTotal / span.length) : 0,
      max_direct_reports: span.length ? span[0].direct_reports : 0,
      rows: span
    },
    roster,
    data_quality: {
      records: employees.length,
      missing_joining_date: employees.filter(e => !e.join).length,
      exited_without_exit_date: employees.filter(e => e.exitedUnknown).length,
      dob_coverage_pct: active.length ? round(withAge.length / active.length * 100, 1) : 0,
      gender_unspecified: active.filter(e => e.gender === 'Unspecified').length
    }
  };
}

module.exports = { computePeople, TENURE_BANDS, AGE_BANDS, tenureBand, ageBand };
