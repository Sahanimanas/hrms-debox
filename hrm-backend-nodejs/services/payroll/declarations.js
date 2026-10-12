/**
 * Investment declarations (PY-5): which amounts count towards old-regime TDS.
 */

const { localParts } = require('../../utils/helpers');
const { DEDUCTION_LABELS, round2 } = require('./statutory');

const SECTIONS = ['80C', '80D_self', '80D_parents', '80CCD1B', '24B', '80E', '80TTA', 'HRA', 'OTHER'];

const SECTION_INFO = SECTIONS.map(code => ({ code, label: DEDUCTION_LABELS[code] }));

// Rent above this (per year) needs the landlord's PAN
const LANDLORD_PAN_THRESHOLD = 100000;

const todayStr = () => localParts(new Date()).date;

/** Declared amounts still count (before proofs are verified) until the proof deadline. */
function declaredStillCounts(settings, today = todayStr()) {
  if (settings.use_declared_until_deadline === false) return false;
  return !settings.proof_deadline || today <= settings.proof_deadline;
}

function countedAmount(item, settings, today) {
  if (item.status === 'approved') return Number(item.approved_amount) || 0;
  if (item.status === 'rejected') return 0;
  return declaredStillCounts(settings, today) ? Number(item.declared_amount) || 0 : 0;
}

/**
 * Old-regime inputs from a declaration.
 * Returns { deductions: { section: amount }, rentPaid, metro }.
 */
function taxInputsFromDeclaration(declaration, settings, today) {
  const deductions = {};
  let rentPaid = 0;
  if (!declaration) return { deductions, rentPaid, metro: false };
  for (const item of declaration.items || []) {
    const amount = countedAmount(item, settings, today);
    if (!amount) continue;
    if (item.section === 'HRA') rentPaid += amount;
    else deductions[item.section] = round2((deductions[item.section] || 0) + amount);
  }
  return { deductions, rentPaid: round2(rentPaid), metro: !!declaration.metro_city };
}

function summarize(declaration, settings) {
  const items = declaration?.items || [];
  const sum = (fn) => round2(items.reduce((s, i) => s + fn(i), 0));
  return {
    declared: sum(i => Number(i.declared_amount) || 0),
    approved: sum(i => (i.status === 'approved' ? Number(i.approved_amount) || 0 : 0)),
    counted: sum(i => countedAmount(i, settings)),
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
  taxInputsFromDeclaration,
  summarize
};
