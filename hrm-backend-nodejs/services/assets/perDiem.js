/**
 * Per-diem rates by city tier (AS-2). One settings document in `per_diem_config`.
 */

const { round2, daysInclusive } = require('./common');

const TIERS = ['tier_1', 'tier_2', 'tier_3'];

const DEFAULT_CONFIG = {
  id: 'default',
  rates: { tier_1: 2500, tier_2: 1800, tier_3: 1200 },
  default_tier: 'tier_3',
  cities: [
    { city: 'Mumbai', tier: 'tier_1' },
    { city: 'Delhi', tier: 'tier_1' },
    { city: 'Bengaluru', tier: 'tier_1' },
    { city: 'Chennai', tier: 'tier_1' },
    { city: 'Hyderabad', tier: 'tier_1' },
    { city: 'Kolkata', tier: 'tier_1' },
    { city: 'Pune', tier: 'tier_1' },
    { city: 'Ahmedabad', tier: 'tier_1' },
    { city: 'Jaipur', tier: 'tier_2' },
    { city: 'Lucknow', tier: 'tier_2' },
    { city: 'Chandigarh', tier: 'tier_2' },
    { city: 'Kochi', tier: 'tier_2' },
    { city: 'Indore', tier: 'tier_2' },
    { city: 'Coimbatore', tier: 'tier_2' }
  ],
  updated_at: null,
  updated_by: null
};

async function getPerDiemConfig(db) {
  const doc = await db.collection('per_diem_config').findOne({ id: 'default' }, { projection: { _id: 0 } });
  return doc ? { ...DEFAULT_CONFIG, ...doc, rates: { ...DEFAULT_CONFIG.rates, ...(doc.rates || {}) } } : { ...DEFAULT_CONFIG, is_default: true };
}

const normaliseCity = (c) => String(c || '').trim().toLowerCase();

function tierForCity(config, city) {
  const match = (config.cities || []).find(c => normaliseCity(c.city) === normaliseCity(city));
  return match ? match.tier : config.default_tier || 'tier_3';
}

/** Per-diem for a trip: rate of the destination city's tier × trip days (inclusive). */
function calculatePerDiem(config, { city, startDate, endDate }) {
  const tier = tierForCity(config, city);
  const rate = round2(config.rates?.[tier] ?? 0);
  const days = daysInclusive(startDate, endDate);
  return { city: city || null, tier, rate, days, amount: round2(rate * days) };
}

module.exports = { TIERS, DEFAULT_CONFIG, getPerDiemConfig, tierForCity, calculatePerDiem };
