/**
 * Indian statutory payroll calculations (PY-1).
 *
 * Pure functions only — no database access — so they can be unit tested and
 * reused by the payroll engine, Form 16 and the settings preview endpoint.
 *
 * Money is INR. Contributions are rounded the way the authorities expect
 * (PF to the nearest rupee, ESI up to the next rupee); everything else is
 * rounded to 2 decimals.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const roundRupee = (n) => Math.round(Number(n) || 0);
const ceilRupee = (n) => Math.ceil(round2(n));

// ============= FINANCIAL YEAR HELPERS =============

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FY_RE = /^\d{4}-\d{2}$/;

/** 'YYYY-MM' -> '2025-26' (Indian FY runs April to March) */
function fyOf(month) {
  const [y, m] = month.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** '2025-26' -> start calendar year 2025 */
const fyStartYear = (fy) => parseInt(String(fy).slice(0, 4), 10);

/** Months of a FY in order: ['2025-04', …, '2026-03'] */
function fyMonths(fy) {
  const start = fyStartYear(fy);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/** April = 0 … March = 11 */
const monthIndexInFy = (month) => {
  const m = parseInt(month.slice(5, 7), 10);
  return (m + 8) % 12;
};

const isValidFy = (fy) => FY_RE.test(fy) && (fyStartYear(fy) + 1) % 100 === parseInt(fy.slice(5), 10);

// ============= INCOME TAX =============

/**
 * Seeded slabs for FY 2025-26 (Finance Act 2025). Admins can add/edit other
 * financial years in payroll settings; a FY without its own table falls back
 * to the most recent configured year.
 */
const TAX_SLABS_FY2025_26 = {
  new: {
    slabs: [
      { upto: 400000, rate: 0 },
      { upto: 800000, rate: 5 },
      { upto: 1200000, rate: 10 },
      { upto: 1600000, rate: 15 },
      { upto: 2000000, rate: 20 },
      { upto: 2400000, rate: 25 },
      { upto: null, rate: 30 }
    ],
    standard_deduction: 75000,
    rebate_limit: 1200000,
    rebate_max: 60000,
    marginal_relief: true,
    cess_rate: 4,
    surcharge: [
      { above: 5000000, rate: 10 },
      { above: 10000000, rate: 15 },
      { above: 20000000, rate: 25 }
    ]
  },
  old: {
    slabs: [
      { upto: 250000, rate: 0 },
      { upto: 500000, rate: 5 },
      { upto: 1000000, rate: 20 },
      { upto: null, rate: 30 }
    ],
    standard_deduction: 50000,
    rebate_limit: 500000,
    rebate_max: 12500,
    marginal_relief: false,
    cess_rate: 4,
    surcharge: [
      { above: 5000000, rate: 10 },
      { above: 10000000, rate: 15 },
      { above: 20000000, rate: 25 },
      { above: 50000000, rate: 37 }
    ]
  }
};

/** Tax on income using progressive slabs (before rebate, surcharge, cess). */
function slabTax(income, slabs) {
  let tax = 0;
  let lower = 0;
  for (const slab of slabs) {
    const upper = slab.upto == null ? Infinity : slab.upto;
    if (income > lower) tax += (Math.min(income, upper) - lower) * (slab.rate / 100);
    lower = upper;
    if (income <= upper) break;
  }
  return tax;
}

const surchargeRate = (income, table = []) =>
  [...table].sort((a, b) => b.above - a.above).find(s => income > s.above)?.rate || 0;

/**
 * Full tax computation on taxable income for one regime config.
 * Returns { tax_on_income, rebate, surcharge, cess, total }.
 */
function computeTaxOnIncome(taxableIncome, config) {
  const income = Math.max(0, roundRupee(taxableIncome));
  let tax = slabTax(income, config.slabs);
  let rebate = 0;

  if (config.rebate_limit && income <= config.rebate_limit) {
    rebate = Math.min(tax, config.rebate_max ?? tax);
  } else if (config.rebate_limit && config.marginal_relief) {
    // Section 87A marginal relief: tax can't exceed the income above the rebate limit
    const excess = income - config.rebate_limit;
    if (tax > excess) rebate = tax - excess;
  }
  tax -= rebate;

  // Surcharge with marginal relief at each threshold
  let surcharge = 0;
  const rate = surchargeRate(income, config.surcharge);
  if (rate > 0 && tax > 0) {
    surcharge = tax * rate / 100;
    const threshold = [...config.surcharge].sort((a, b) => b.above - a.above).find(s => income > s.above).above;
    const taxAtThreshold = slabTax(threshold, config.slabs);
    const surchargeAtThreshold = taxAtThreshold * surchargeRate(threshold, config.surcharge) / 100;
    const cap = taxAtThreshold + surchargeAtThreshold + (income - threshold);
    if (tax + surcharge > cap) surcharge = Math.max(0, cap - tax);
  }

  const cess = (tax + surcharge) * (config.cess_rate ?? 4) / 100;
  return {
    tax_on_income: round2(tax + rebate),
    rebate: round2(rebate),
    surcharge: round2(surcharge),
    cess: round2(cess),
    total: roundRupee(tax + surcharge + cess)
  };
}

// Caps for old-regime deductions (Chapter VI-A and house property)
const DEDUCTION_CAPS = {
  '80C': 150000,
  '80CCD1B': 50000,
  '80D_self': 25000,
  '80D_parents': 50000,
  '24B': 200000,
  '80E': null,
  '80TTA': 10000,
  'OTHER': null
};

const DEDUCTION_LABELS = {
  '80C': '80C (PPF, ELSS, LIC, tuition fees, principal, EPF…)',
  '80CCD1B': '80CCD(1B) — additional NPS',
  '80D_self': '80D — medical insurance (self & family)',
  '80D_parents': '80D — medical insurance (parents)',
  '24B': '24(b) — home loan interest',
  '80E': '80E — education loan interest',
  '80TTA': '80TTA — savings account interest',
  'OTHER': 'Other deductions',
  'HRA': 'HRA — rent paid'
};

/**
 * HRA exemption u/s 10(13A), all values for the same period (usually annual):
 * least of actual HRA, rent paid − 10% of basic+DA, and 50% (metro) / 40% of basic+DA.
 */
function computeHraExemption({ hraReceived = 0, basicDa = 0, rentPaid = 0, metro = false }) {
  if (hraReceived <= 0 || rentPaid <= 0) return 0;
  const exemption = Math.min(hraReceived, rentPaid - 0.1 * basicDa, (metro ? 0.5 : 0.4) * basicDa);
  return round2(Math.max(0, exemption));
}

/**
 * Apply caps to old-regime deductions.
 * `deductions` = { '80C': n, '80D_self': n, … } (employee PF is added to 80C by the caller).
 * Returns { total, breakdown: { section: allowed } }.
 */
function capDeductions(deductions = {}) {
  const breakdown = {};
  let total = 0;
  for (const [section, cap] of Object.entries(DEDUCTION_CAPS)) {
    const claimed = Math.max(0, Number(deductions[section]) || 0);
    if (!claimed) continue;
    const allowed = cap == null ? claimed : Math.min(claimed, cap);
    breakdown[section] = round2(allowed);
    total += allowed;
  }
  return { total: round2(total), breakdown };
}

/**
 * Annual income tax for salary income under one regime.
 *  grossSalary: annual taxable salary (after LOP, incl. taxable one-offs)
 *  hraExemption, professionalTax: annual (old regime only)
 *  deductions: old-regime claims by section (see DEDUCTION_CAPS)
 */
function computeAnnualTax({ regime = 'new', config, grossSalary = 0, hraExemption = 0, professionalTax = 0, deductions = {} }) {
  const gross = Math.max(0, round2(grossSalary));
  const isOld = regime === 'old';
  const standardDeduction = Math.min(gross, config.standard_deduction || 0);
  const exemptions = {
    hra: isOld ? round2(Math.min(hraExemption, gross)) : 0,
    standard_deduction: round2(standardDeduction),
    professional_tax: isOld ? round2(professionalTax) : 0
  };
  const chapterVia = isOld ? capDeductions(deductions) : { total: 0, breakdown: {} };
  const taxable = Math.max(0, gross - exemptions.hra - exemptions.standard_deduction - exemptions.professional_tax - chapterVia.total);
  const taxableIncome = roundRupee(taxable);
  const tax = computeTaxOnIncome(taxableIncome, config);
  return {
    regime: isOld ? 'old' : 'new',
    gross_salary: gross,
    exemptions,
    deductions: chapterVia,
    taxable_income: taxableIncome,
    ...tax
  };
}

/**
 * Monthly TDS = (projected annual tax − TDS already deducted this FY) / remaining months
 * (remaining months includes the current one). Never negative.
 */
function monthlyTds({ annualTax, tdsDeducted = 0, remainingMonths }) {
  const months = Math.max(1, remainingMonths);
  return Math.max(0, roundRupee((annualTax - tdsDeducted) / months));
}

// ============= PROVIDENT FUND =============

/**
 * PF for one month.
 *  basicDa: earned Basic + DA for the month (after LOP)
 *  settings: { pf_enabled, pf_restrict_to_ceiling, pf_ceiling }
 *  age: employee age — no EPS after 58
 */
function computePF({ basicDa = 0, settings = {}, age = null, optOut = false }) {
  const zero = { applicable: false, pf_wage: 0, eps_wage: 0, edli_wage: 0, employee: 0, employer_total: 0, employer_eps: 0, employer_epf: 0, edli: 0, admin: 0 };
  if (settings.pf_enabled === false || optOut || basicDa <= 0) return zero;

  const ceiling = settings.pf_ceiling || 15000;
  const wage = roundRupee(basicDa);
  const capped = Math.min(wage, ceiling);
  const pfWage = settings.pf_restrict_to_ceiling === false ? wage : capped;

  const employee = roundRupee(pfWage * 0.12);
  const employerTotal = roundRupee(pfWage * 0.12);
  const epsWage = age != null && age >= 58 ? 0 : capped;
  const eps = Math.min(employerTotal, roundRupee(epsWage * 0.0833));
  return {
    applicable: true,
    pf_wage: pfWage,
    eps_wage: epsWage,
    edli_wage: capped,
    employee,
    employer_total: employerTotal,
    employer_eps: eps,
    employer_epf: employerTotal - eps,
    edli: roundRupee(capped * 0.005),
    admin: roundRupee(pfWage * 0.005)
  };
}

// ============= ESI =============

/**
 * ESI for one month.
 *  monthlyGross: the employee's regular monthly gross (decides coverage)
 *  esiWage: wages actually paid this month (after LOP)
 */
function computeESI({ monthlyGross = 0, esiWage = 0, settings = {} }) {
  const threshold = settings.esi_threshold || 21000;
  if (settings.esi_enabled === false || monthlyGross <= 0 || monthlyGross > threshold || esiWage <= 0) {
    return { applicable: false, wage: 0, employee: 0, employer: 0 };
  }
  return {
    applicable: true,
    wage: round2(esiWage),
    employee: ceilRupee(esiWage * 0.0075),
    employer: ceilRupee(esiWage * 0.0325)
  };
}

// ============= PROFESSIONAL TAX =============

/**
 * Monthly slabs by gross. `feb` overrides the amount in February (annual cap top-up).
 * Tamil Nadu levies PT half-yearly; it is spread evenly over the six months here.
 */
const PT_STATES = {
  MH: {
    name: 'Maharashtra',
    slabs: [{ upto: 7500, amount: 0 }, { upto: 10000, amount: 175 }, { upto: null, amount: 200, feb: 300 }],
    // Women earning up to ₹25,000 a month are exempt
    female_slabs: [{ upto: 25000, amount: 0 }, { upto: null, amount: 200, feb: 300 }]
  },
  KA: { name: 'Karnataka', slabs: [{ upto: 24999, amount: 0 }, { upto: null, amount: 200, feb: 300 }] },
  WB: {
    name: 'West Bengal',
    slabs: [
      { upto: 10000, amount: 0 }, { upto: 15000, amount: 110 }, { upto: 25000, amount: 130 },
      { upto: 40000, amount: 150 }, { upto: null, amount: 200 }
    ]
  },
  TN: {
    name: 'Tamil Nadu',
    half_yearly: true,
    slabs: [
      { upto: 21000, amount: 0 }, { upto: 30000, amount: 180 }, { upto: 45000, amount: 425 },
      { upto: 60000, amount: 930 }, { upto: 75000, amount: 1025 }, { upto: null, amount: 1250 }
    ]
  },
  TS: { name: 'Telangana', slabs: [{ upto: 15000, amount: 0 }, { upto: 20000, amount: 150 }, { upto: null, amount: 200 }] },
  GJ: { name: 'Gujarat', slabs: [{ upto: 11999, amount: 0 }, { upto: null, amount: 200 }] },
  AP: { name: 'Andhra Pradesh', slabs: [{ upto: 15000, amount: 0 }, { upto: 20000, amount: 150 }, { upto: null, amount: 200 }] }
};

const INDIAN_STATES = {
  ...Object.fromEntries(Object.entries(PT_STATES).map(([code, s]) => [code, s.name])),
  DL: 'Delhi', UP: 'Uttar Pradesh', HR: 'Haryana', RJ: 'Rajasthan', PB: 'Punjab', KL: 'Kerala',
  MP: 'Madhya Pradesh', OD: 'Odisha', BR: 'Bihar', AS: 'Assam', JH: 'Jharkhand', CG: 'Chhattisgarh',
  GA: 'Goa', HP: 'Himachal Pradesh', UK: 'Uttarakhand', JK: 'Jammu & Kashmir', CH: 'Chandigarh', OT: 'Other'
};

/** Monthly professional tax. month: 1–12. Unlisted states return 0. */
function computePT({ state, gross = 0, month, gender }) {
  const cfg = PT_STATES[state];
  if (!cfg || gross <= 0) return 0;
  const slabs = String(gender || '').toLowerCase() === 'female' && cfg.female_slabs ? cfg.female_slabs : cfg.slabs;
  const basis = cfg.half_yearly ? gross * 6 : gross;
  const slab = slabs.find(s => s.upto == null || basis <= s.upto);
  if (!slab) return 0;
  const amount = month === 2 && slab.feb != null ? slab.feb : slab.amount;
  return cfg.half_yearly ? round2(amount / 6) : amount;
}

// ============= LABOUR WELFARE FUND =============

/** Contribution months and amounts (employee / employer) for states that levy LWF. */
const LWF_STATES = {
  MH: { months: [6, 12], employee: 25, employer: 75, min_gross: 3000 },
  KA: { months: [12], employee: 50, employer: 100 },
  TN: { months: [12], employee: 20, employer: 40 },
  WB: { months: [6, 12], employee: 3, employer: 15 },
  GJ: { months: [6, 12], employee: 6, employer: 12 },
  TS: { months: [12], employee: 2, employer: 5 },
  AP: { months: [12], employee: 30, employer: 70 }
};

function computeLWF({ state, month, gross = 0, settings = {} }) {
  const cfg = LWF_STATES[state];
  if (settings.lwf_enabled === false || !cfg || gross <= 0 || !cfg.months.includes(month)) {
    return { employee: 0, employer: 0 };
  }
  if (cfg.min_gross && gross <= cfg.min_gross) return { employee: 0, employer: 0 };
  return { employee: cfg.employee, employer: cfg.employer };
}

// ============= MISC =============

/** Age in completed years on a date. */
function ageOn(dob, on = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d)) return null;
  let age = on.getFullYear() - d.getFullYear();
  const beforeBirthday = on.getMonth() < d.getMonth() || (on.getMonth() === d.getMonth() && on.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const threeDigits = (n) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
};

/** Indian numbering: 123456.5 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only" */
function amountInWords(amount) {
  const value = Math.abs(round2(amount));
  let rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';

  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rupees) parts.push(threeDigits(rupees));

  let words = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${amount < 0 ? 'Minus ' : ''}${words} Only`;
}

module.exports = {
  round2,
  roundRupee,
  MONTH_RE,
  FY_RE,
  fyOf,
  fyStartYear,
  fyMonths,
  monthIndexInFy,
  isValidFy,
  TAX_SLABS_FY2025_26,
  slabTax,
  computeTaxOnIncome,
  computeAnnualTax,
  computeHraExemption,
  capDeductions,
  DEDUCTION_CAPS,
  DEDUCTION_LABELS,
  monthlyTds,
  computePF,
  computeESI,
  PT_STATES,
  INDIAN_STATES,
  computePT,
  LWF_STATES,
  computeLWF,
  ageOn,
  amountInWords
};
