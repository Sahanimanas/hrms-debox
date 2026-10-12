/**
 * PL-3 Two-factor authentication + security settings.
 *
 *   GET    /2fa/status
 *   POST   /2fa/setup                     → { otpauth_url, qr_code, secret }   (pending until confirmed)
 *   POST   /2fa/enable        { code }    → { enabled: true, backup_codes }     (codes shown once)
 *   POST   /2fa/backup-codes  { code }    → { backup_codes }                    (regenerate)
 *   POST   /2fa/disable       { password, code }
 *   DELETE /2fa/users/:userId              admin: reset another user's 2FA
 *   GET    /security/settings | PUT       admin: require_admin_2fa, SSO auto-provisioning
 *   GET    /security/users                admin: users with role / 2FA / status (no secrets)
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { verifyPassword } = require('../../../utils/helpers');
const { createNotification } = require('../../notificationService');
const { handle, encryptSecret, decryptSecret, escapeRegex } = require('../common');
const tf = require('../twoFactor');
const { recordAuthEvent } = require('../audit');
const { getSecuritySettings, updateSecuritySettings } = require('../settings');
const { providerConfig } = require('../sso');

const router = express.Router();

const codeSchema = Joi.object({ code: Joi.string().trim().max(32).required() });
const disableSchema = Joi.object({
  password: Joi.string().max(200).required(),
  code: Joi.string().trim().max(32).required()
});

const loadUser = (db, email) => db.collection('users').findOne({ email }, { projection: { _id: 0 } });

router.get('/2fa/status', handle('2fa status', async (req, res) => {
  const db = getDB();
  const user = await loadUser(db, req.user.email);
  const t = user?.two_factor || {};
  const settings = await getSecuritySettings(db);
  res.json({
    enabled: !!t.enabled,
    enabled_at: t.enabled_at || null,
    backup_codes_remaining: t.enabled ? (t.backup_codes || []).length : 0,
    setup_pending: !t.enabled && !!t.pending_secret_enc,
    required: req.user.role === 'admin' && !!settings.require_admin_2fa,
    issuer: tf.ISSUER
  });
}));

router.post('/2fa/setup', handle('2fa setup', async (req, res) => {
  const db = getDB();
  const user = await loadUser(db, req.user.email);
  if (!user) return res.status(404).json({ detail: 'User not found' });
  if (user.two_factor?.enabled) return res.status(400).json({ detail: 'Two-factor authentication is already enabled. Disable it first to enrol a new device.' });
  const secret = tf.newSecret();
  await db.collection('users').updateOne(
    { email: user.email },
    { $set: { 'two_factor.pending_secret_enc': encryptSecret(secret), 'two_factor.pending_created_at': new Date() } }
  );
  res.json(await tf.enrolmentPayload(secret, user.email));
}));

router.post('/2fa/enable', validate(codeSchema), handle('2fa enable', async (req, res) => {
  const db = getDB();
  const user = await loadUser(db, req.user.email);
  const t = user?.two_factor || {};
  if (t.enabled) return res.status(400).json({ detail: 'Two-factor authentication is already enabled' });
  const secret = decryptSecret(t.pending_secret_enc);
  if (!secret) return res.status(400).json({ detail: 'Start the setup first' });
  if (t.pending_created_at && Date.now() - new Date(t.pending_created_at).getTime() > 30 * 60 * 1000) {
    return res.status(400).json({ detail: 'This setup has expired. Start again.' });
  }
  const result = await tf.verifyTotp(secret, req.validatedBody.code);
  if (!result.valid) {
    recordAuthEvent(req, 'auth.2fa.enable_failed', { email: user.email, role: user.role, outcome: 'failure', reason: 'invalid_code' });
    return res.status(400).json({ detail: 'That code is not valid. Check the time on your phone and try again.', error_code: 'INVALID_2FA_CODE' });
  }
  const codes = tf.generateBackupCodes();
  await db.collection('users').updateOne(
    { email: user.email },
    {
      $set: {
        two_factor: {
          enabled: true,
          enabled_at: new Date(),
          secret_enc: encryptSecret(secret),
          backup_codes: await tf.hashBackupCodes(codes),
          last_used_step: result.step,
          failed_attempts: 0
        }
      }
    }
  );
  recordAuthEvent(req, 'auth.2fa.enabled', { email: user.email, role: user.role });
  res.json({ enabled: true, backup_codes: codes });
}));

router.post('/2fa/backup-codes', validate(codeSchema), handle('2fa regenerate codes', async (req, res) => {
  const db = getDB();
  const user = await loadUser(db, req.user.email);
  if (!user?.two_factor?.enabled) return res.status(400).json({ detail: 'Two-factor authentication is not enabled' });
  if (tf.isUserLocked(user)) return res.status(429).json({ detail: 'Too many failed attempts. Try again in 15 minutes.' });
  const secret = decryptSecret(user.two_factor.secret_enc);
  const result = await tf.verifyTotp(secret, req.validatedBody.code, user.two_factor.last_used_step);
  if (!result.valid) {
    await tf.noteUserFailure(db, user);
    recordAuthEvent(req, 'auth.2fa.backup_codes_failed', { email: user.email, role: user.role, outcome: 'failure', reason: 'invalid_code' });
    return res.status(400).json({ detail: 'Enter a current code from your authenticator app', error_code: 'INVALID_2FA_CODE' });
  }
  const codes = tf.generateBackupCodes();
  await db.collection('users').updateOne(
    { email: user.email },
    { $set: { 'two_factor.backup_codes': await tf.hashBackupCodes(codes), 'two_factor.last_used_step': result.step } }
  );
  recordAuthEvent(req, 'auth.2fa.backup_codes_regenerated', { email: user.email, role: user.role });
  res.json({ backup_codes: codes });
}));

router.post('/2fa/disable', validate(disableSchema), handle('2fa disable', async (req, res) => {
  const db = getDB();
  const user = await loadUser(db, req.user.email);
  if (!user?.two_factor?.enabled) return res.status(400).json({ detail: 'Two-factor authentication is not enabled' });
  if (tf.isUserLocked(user)) return res.status(429).json({ detail: 'Too many failed attempts. Try again in 15 minutes.' });
  const { password, code } = req.validatedBody;
  const passwordOk = user.hashed_password && await verifyPassword(password, user.hashed_password);
  if (!passwordOk) {
    recordAuthEvent(req, 'auth.2fa.disable_failed', { email: user.email, role: user.role, outcome: 'failure', reason: 'invalid_password' });
    return res.status(400).json({ detail: 'Incorrect password' });
  }
  const result = await tf.verifySecondFactor(db, user, code);
  if (!result.valid) {
    await tf.noteUserFailure(db, user);
    recordAuthEvent(req, 'auth.2fa.disable_failed', { email: user.email, role: user.role, outcome: 'failure', reason: 'invalid_code' });
    return res.status(400).json({ detail: 'Incorrect verification code', error_code: 'INVALID_2FA_CODE' });
  }
  await db.collection('users').updateOne({ email: user.email }, { $unset: { two_factor: '' } });
  recordAuthEvent(req, 'auth.2fa.disabled', { email: user.email, role: user.role });
  res.json({ enabled: false });
}));

router.delete('/2fa/users/:userId', requireRole(['admin']), handle('2fa admin reset', async (req, res) => {
  const db = getDB();
  const target = await db.collection('users').findOne({ id: req.params.userId }, { projection: { _id: 0, id: 1, email: 1, role: 1, two_factor: 1 } });
  if (!target) return res.status(404).json({ detail: 'User not found' });
  if (target.email === req.user.email) return res.status(400).json({ detail: 'Use Security settings to change your own two-factor authentication' });
  if (!target.two_factor?.enabled && !target.two_factor?.pending_secret_enc) return res.status(400).json({ detail: 'This user does not have two-factor authentication enabled' });
  await db.collection('users').updateOne({ id: target.id }, { $unset: { two_factor: '' } });
  recordAuthEvent(req, 'auth.2fa.reset_by_admin', { email: target.email, role: target.role, details: { admin: req.user.email } });
  Promise.resolve(createNotification({
    userId: target.id,
    userEmail: target.email,
    type: 'two_factor_reset',
    title: 'Two-factor authentication was reset',
    message: 'An administrator reset your two-factor authentication. Set it up again from Security settings.',
    actionUrl: '/security'
  })).catch(() => {});
  res.json({ reset: true, user_id: target.id });
}));

// ============= SETTINGS =============

const settingsSchema = Joi.object({
  require_admin_2fa: Joi.boolean(),
  sso_auto_provision: Joi.boolean(),
  sso_allowed_domains: Joi.array().items(Joi.string().trim().lowercase().pattern(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/)).max(20).unique()
}).min(1);

router.get('/security/settings', requireRole(['admin']), handle('security settings', async (req, res) => {
  const settings = await getSecuritySettings(getDB());
  const sso = providerConfig();
  res.json({
    ...settings,
    sso_providers: { google: !!sso.google, microsoft: !!sso.microsoft, microsoft_tenant: sso.microsoft?.tenant || null }
  });
}));

router.put('/security/settings', requireRole(['admin']), validate(settingsSchema), handle('update security settings', async (req, res) => {
  const body = req.validatedBody;
  if (body.sso_auto_provision === true) {
    const current = await getSecuritySettings(getDB());
    const domains = body.sso_allowed_domains ?? current.sso_allowed_domains;
    if (!domains?.length) return res.status(400).json({ detail: 'Add at least one allowed email domain before enabling auto-provisioning' });
  }
  const settings = await updateSecuritySettings(getDB(), body, req.user.email);
  recordAuthEvent(req, 'security.settings.updated', { email: req.user.email, role: req.user.role, details: body });
  res.json(settings);
}));

const usersQuery = Joi.object({ search: Joi.string().trim().max(100).allow('') });

router.get('/security/users', requireRole(['admin']), handle('security users', async (req, res) => {
  const { error, value } = usersQuery.validate(req.query, { stripUnknown: true });
  if (error) return res.status(422).json({ detail: 'Validation failed' });
  const db = getDB();
  const filter = value.search
    ? { $or: [{ email: { $regex: escapeRegex(value.search), $options: 'i' } }, { full_name: { $regex: escapeRegex(value.search), $options: 'i' } }] }
    : {};
  const users = await db.collection('users').find(filter, {
    projection: { _id: 0, id: 1, email: 1, full_name: 1, name: 1, role: 1, employee_id: 1, custom_role_id: 1, is_active: 1, last_login_at: 1, last_login_method: 1, 'two_factor.enabled': 1 }
  }).sort({ full_name: 1 }).limit(1000).toArray();
  const roles = await db.collection('custom_roles').find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
  const roleNames = new Map(roles.map(r => [r.id, r.name]));
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name || u.name || u.email,
    employee_id: u.employee_id || null,
    role: u.role,
    custom_role_id: u.custom_role_id || null,
    custom_role_name: roleNames.get(u.custom_role_id) || null,
    is_active: u.is_active !== false,
    two_factor_enabled: !!u.two_factor?.enabled,
    last_login_at: u.last_login_at || null,
    last_login_method: u.last_login_method || null
  })));
}));

module.exports = router;
