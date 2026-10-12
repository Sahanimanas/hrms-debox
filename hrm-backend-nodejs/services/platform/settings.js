/**
 * Platform-wide security settings, stored as a single document in
 * `platform_settings` ({ id: 'security', ... }). Cached briefly in memory.
 */

const { getDB } = require('../../config/database');

const DEFAULTS = {
  require_admin_2fa: false,
  sso_auto_provision: false,
  sso_allowed_domains: []
};

let cache = null;
let cachedAt = 0;
const TTL_MS = 15 * 1000;

async function getSecuritySettings(db = getDB()) {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const doc = db ? await db.collection('platform_settings').findOne({ id: 'security' }, { projection: { _id: 0 } }) : null;
  cache = { ...DEFAULTS, ...(doc || {}) };
  delete cache.id;
  cachedAt = Date.now();
  return cache;
}

async function updateSecuritySettings(db, patch, actorEmail) {
  await db.collection('platform_settings').updateOne(
    { id: 'security' },
    { $set: { ...patch, updated_at: new Date(), updated_by: actorEmail }, $setOnInsert: { id: 'security' } },
    { upsert: true }
  );
  cache = null;
  return getSecuritySettings(db);
}

module.exports = { getSecuritySettings, updateSecuritySettings, SECURITY_DEFAULTS: DEFAULTS };
