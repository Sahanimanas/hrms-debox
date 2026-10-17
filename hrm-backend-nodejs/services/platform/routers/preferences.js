/**
 * PL-8 Languages and currencies.
 *
 *   GET  /preferences/me                  { language }
 *   PUT  /preferences/me      { language: 'en' | 'hi' }
 *   GET  /org-preferences                 the caller's organization (falls back to 'default'), plus timezone
 *   GET  /org-preferences/all             admin: every organization + its preferences
 *   PUT  /org-preferences/:orgId          admin: { currency, locale, date_format }  (orgId 'default' allowed)
 *
 * `org_preferences` { organization_id, currency, locale, date_format, updated_at, updated_by }
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { handle } = require('../common');
const { APP_TIMEZONE } = require('../../../utils/helpers');

const router = express.Router();

const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' }
];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY', 'SAR', 'ZAR', 'NZD', 'CHF', 'MYR', 'BDT', 'LKR', 'NPR'];
const LOCALES = ['en-IN', 'hi-IN', 'en-US', 'en-GB', 'en-AE', 'en-SG', 'en-AU', 'en-CA', 'de-DE', 'fr-FR', 'ja-JP', 'zh-CN', 'ar-AE'];
const DATE_FORMATS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd MMM yyyy', 'MMM d, yyyy', 'dd.MM.yyyy'];
const DEFAULT_PREFS = { organization_id: 'default', currency: 'INR', locale: 'en-IN', date_format: 'dd/MM/yyyy' };

const languageSchema = Joi.object({ language: Joi.string().valid(...LANGUAGES.map(l => l.code)).required() });
const orgPrefsSchema = Joi.object({
  currency: Joi.string().valid(...CURRENCIES).required(),
  locale: Joi.string().valid(...LOCALES).required(),
  date_format: Joi.string().valid(...DATE_FORMATS).required()
});

router.get('/preferences/me', handle('get my preferences', async (req, res) => {
  const user = await getDB().collection('users').findOne({ email: req.user.email }, { projection: { _id: 0, preferences: 1 } });
  res.json({ language: user?.preferences?.language || null, languages: LANGUAGES });
}));

router.put('/preferences/me', validate(languageSchema), handle('set my preferences', async (req, res) => {
  await getDB().collection('users').updateOne(
    { email: req.user.email },
    { $set: { 'preferences.language': req.validatedBody.language, 'preferences.updated_at': new Date() } }
  );
  res.json({ language: req.validatedBody.language });
}));

const resolvePrefs = async (db, orgId) => {
  const id = orgId || 'default';
  const doc = await db.collection('org_preferences').findOne({ organization_id: id }, { projection: { _id: 0 } })
    || (id !== 'default' ? await db.collection('org_preferences').findOne({ organization_id: 'default' }, { projection: { _id: 0 } }) : null);
  // timezone: the company timezone (APP_TIMEZONE, Asia/Kolkata by default) unless the org has its own
  return { ...DEFAULT_PREFS, timezone: APP_TIMEZONE, ...(doc || {}), organization_id: id, inherited: !doc || doc.organization_id !== id };
};

router.get('/org-preferences', handle('get org preferences', async (req, res) => {
  const db = getDB();
  const employee = await db.collection('employees').findOne({ email: req.user.email }, { projection: { _id: 0, organization_id: 1 } });
  res.json({
    ...(await resolvePrefs(db, employee?.organization_id)),
    options: { currencies: CURRENCIES, locales: LOCALES, date_formats: DATE_FORMATS }
  });
}));

router.get('/org-preferences/all', requireRole(['admin']), handle('list org preferences', async (req, res) => {
  const db = getDB();
  const orgs = await db.collection('organizations').find({}, { projection: { _id: 0, id: 1, name: 1 } }).sort({ name: 1 }).limit(500).toArray();
  const rows = [{ id: 'default', name: 'Company default' }, ...orgs.filter(o => o.id)];
  const prefs = await db.collection('org_preferences').find({}, { projection: { _id: 0 } }).toArray();
  const byOrg = new Map(prefs.map(p => [p.organization_id, p]));
  const fallback = { ...DEFAULT_PREFS, ...(byOrg.get('default') || {}) };
  res.json({
    options: { currencies: CURRENCIES, locales: LOCALES, date_formats: DATE_FORMATS },
    organizations: rows.map(o => {
      const own = byOrg.get(o.id);
      return {
        organization_id: o.id,
        name: o.name,
        currency: (own || fallback).currency,
        locale: (own || fallback).locale,
        date_format: (own || fallback).date_format,
        inherited: !own,
        updated_at: own?.updated_at || null
      };
    })
  });
}));

router.put('/org-preferences/:orgId', requireRole(['admin']), validate(orgPrefsSchema), handle('set org preferences', async (req, res) => {
  const db = getDB();
  const orgId = req.params.orgId;
  if (orgId !== 'default') {
    const org = await db.collection('organizations').findOne({ id: orgId }, { projection: { _id: 1 } });
    if (!org) return res.status(404).json({ detail: 'Organization not found' });
  }
  const doc = { organization_id: orgId, ...req.validatedBody, updated_at: new Date(), updated_by: req.user.email };
  await db.collection('org_preferences').updateOne({ organization_id: orgId }, { $set: doc }, { upsert: true });
  res.json({ ...doc, inherited: false });
}));

module.exports = router;
