/**
 * Investment declarations (PY-5): which amounts count towards old-regime TDS.
 *
 * Only verified (approved) amounts count, unless payroll settings opt in to
 * using declared amounts until the proof deadline. Section limits (80C/80CCE,
 * 80D, 24(b) …) are applied by statutory.capDeductions.
 */

const { localParts } = require('../../utils/helpers');
const { DEDUCTION_LABELS, round2, capDeductions, sectionCap, COMBINED_CAPS } = require('./statutory');

const SECTIONS = ['80C', '80CCC', '80CCD1', '80D_self', '80D_parents', '80CCD1B', '24B', '80E', '80TTA', 'HRA', 'OTHER'];

const SECTION_INFO = SECTIONS.map(code => ({ code, label: DEDUCTION_LABELS[code] }));

// Rent above this (per year) needs the landlord's PAN
const LANDLORD_PAN_THRESHOLD = 100000;

const todayStr = () => localParts(new Date()).date;

/**
 * Declared (not yet verified) amounts count only when settings opt in AND a proof
 * deadline is set and not yet passed; otherwise only approved amounts count.
 */
function declaredStillCounts(settings, today = todayStr()) {
  if (settings.use_declared_until_deadline !== true || !settings.proof_deadline) return false;
  return today <= settings.proof_deadline;
}

function countedAmount(item, settings, today) {
  if (item.status === 'approved') return Number(item.approved_amount) || 0;
  if (item.status === 'rejected') return 0;
  return declaredStillCounts(settings, today) ? Number(item.declared_amount) || 0 : 0;
}

/** 80D limit options from a declaration (+ the employee's own age when known). */
const capOptionsFor = (declaration, { selfSenior = false } = {}) => ({
  selfSenior: !!selfSenior,
  parentsSenior: !!declaration?.parents_senior_citizen
});

/**
 * Old-regime inputs from a declaration (uncapped; caps apply in the tax computation).
 * Returns { deductions: { section: amount }, rentPaid, metro, capOptions }.
 */
function taxInputsFromDeclaration(declaration, settings, today) {
  const deductions = {};
  let rentPaid = 0;
  if (!declaration) return { deductions, rentPaid, metro: false, capOptions: capOptionsFor(null) };
  for (const item of declaration.items || []) {
    const amount = countedAmount(item, settings, today);
    if (!amount) continue;
    if (item.section === 'HRA') rentPaid += amount;
    else deductions[item.section] = round2((deductions[item.section] || 0) + amount);
  }
  return { deductions, rentPaid: round2(rentPaid), metro: !!declaration.metro_city, capOptions: capOptionsFor(declaration) };
}

/**
 * Totals for the declaration screens. `counted` is what reduces TDS: verified amounts
 * after section limits (employee PF also uses the 80C limit in the payroll run).
 * Rent (HRA) is shown as counted rent paid; the exemption itself depends on salary.
 */
function summarize(declaration, settings, { selfSenior = false } = {}) {
  const items = declaration?.items || [];
  const sum = (fn) => round2(items.reduce((s, i) => s + fn(i), 0));
  const inputs = taxInputsFromDeclaration(declaration, settings);
  const options = { ...inputs.capOptions, selfSenior: !!selfSenior };
  const capped = capDeductions(inputs.deductions, options);

  const bySection = {};
  for (const [section, claimed] of Object.entries(inputs.deductions)) {
    const group = COMBINED_CAPS.find(g => g.sections.includes(section));
    bySection[section] = {
      claimed,
      counted: capped.breakdown[section] || 0,
      cap: group ? group.cap : sectionCap(section, options) ?? null,
      cap_group: group ? group.code : null
    };
  }
  if (inputs.rentPaid) bySection.HRA = { claimed: inputs.rentPaid, counted: inputs.rentPaid, cap: null, cap_group: null };

  const uncapped = round2(Object.values(inputs.deductions).reduce((s, v) => s + v, 0) + inputs.rentPaid);
  const counted = round2(capped.total + inputs.rentPaid);
  return {
    declared: sum(i => Number(i.declared_amount) || 0),
    approved: sum(i => (i.status === 'approved' ? Number(i.approved_amount) || 0 : 0)),
    counted,
    counted_before_caps: uncapped,
    over_limit: round2(uncapped - counted),
    by_section: bySection,
    declared_counts: declaredStillCounts(settings),
    pending_items: items.filter(i => i.status === 'declared').length,
    rejected_items: items.filter(i => i.status === 'rejected').length
  };
}

module.exports = {
  SECTIONS,
  SECTION_INFO,
  LANDLORD_PAN_THRESHOLD,
  countedAmount,
  declaredStillCounts,
  capOptionsFor,
  taxInputsFromDeclaration,
  summarize
};
