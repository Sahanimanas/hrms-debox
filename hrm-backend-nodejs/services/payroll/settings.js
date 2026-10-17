/**
 * Org-wide payroll settings (single document in `payroll_settings`).
 */

const { TAX_SLABS_FY2025_26, fyStartYear } = require('./statutory');

const SETTINGS_ID = 'default';

const DEFAULT_SETTINGS = {
  company_name: '',
  company_address: '',
  employer_pan: '',
  employer_tan: '',
  pf_establishment_code: '',
  pf_enabled: true,
  pf_restrict_to_ceiling: true,
  pf_ceiling: 15000,
  esi_enabled: true,
  esi_threshold: 21000,
  lwf_enabled: true,
  default_pt_state: 'MH',
  lop_basis: 'calendar', // 'calendar' | '26' | '30'
  pay_day: 1,
  auto_draft_enabled: false,
  declaration_window_open: true,
  proof_deadline: null, // 'YYYY-MM-DD'; with use_declared_until_deadline, declared amounts count for TDS until then
  use_declared_until_deadline: false, // off: only verified (approved) amounts reduce TDS
  tax_slabs: { '2025-26': TAX_SLABS_FY2025_26 }
};

const clone = (v) => JSON.parse(JSON.stringify(v));

async function getSettings(db) {
  const doc = await db.collection('payroll_settings').findOne({ id: SETTINGS_ID }, { projection: { _id: 0 } });
  const merged = { ...clone(DEFAULT_SETTINGS), ...(doc || {}) };
  if (!merged.tax_slabs || !Object.keys(merged.tax_slabs).length) merged.tax_slabs = clone(DEFAULT_SETTINGS.tax_slabs);
  merged.id = SETTINGS_ID;
  return merged;
}

async function saveSettings(db, patch, userEmail) {
  const now = new Date();
  await db.collection('payroll_settings').updateOne(
    { id: SETTINGS_ID },
    { $set: { ...patch, updated_at: now, updated_by: userEmail }, $setOnInsert: { id: SETTINGS_ID, created_at: now } },
    { upsert: true }
  );
  return getSettings(db);
}

/**
 * Tax config for a FY: its own table, else the latest configured FY before it,
 * else the earliest configured one. Returns { fy, config: { new, old }, fallback }.
 */
function taxConfigFor(settings, fy) {
  const tables = settings.tax_slabs || {};
  if (tables[fy]) return { fy, config: tables[fy], fallback: false };
  const years = Object.keys(tables).sort();
  const earlier = years.filter(y => fyStartYear(y) < fyStartYear(fy));
  const use = earlier.length ? earlier[earlier.length - 1] : years[0];
  if (!use) return { fy: '2025-26', config: TAX_SLABS_FY2025_26, fallback: true };
  return { fy: use, config: tables[use], fallback: true };
}

/** Days used to value one day's pay for LOP. */
function lopBasisDays(settings, daysInMonth) {
  if (settings.lop_basis === '26') return 26;
  if (settings.lop_basis === '30') return 30;
  return daysInMonth;
}

module.exports = { DEFAULT_SETTINGS, getSettings, saveSettings, taxConfigFor, lopBasisDays };
