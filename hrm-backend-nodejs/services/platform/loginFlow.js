/**
 * Shared final step of every sign-in method (password, SSO, 2FA verify).
 *
 * - Blocks deactivated accounts (users.is_active === false).
 * - Users with 2FA enabled get { two_factor_required: true, challenge_token }
 *   instead of an access token (unless the second factor was just verified).
 * - Everyone else gets the classic login response
 *   { access_token, token_type, user } — plus `two_factor_setup_required`
 *   for admins when the "require 2FA for admins" setting is on.
 */

const { createAccessToken } = require('../../middleware/auth');
const { recordAuthEvent } = require('./audit');
const { createChallenge } = require('./twoFactor');
const { getSecuritySettings } = require('./settings');

const DISABLED_RESPONSE = {
  detail: 'Your account has been deactivated. Please contact your administrator.',
  error_code: 'ACCOUNT_DISABLED'
};

const publicUser = (userDoc) => ({
  id: userDoc.id,
  employee_id: userDoc.employee_id,
  email: userDoc.email,
  full_name: userDoc.full_name || userDoc.name,
  role: userDoc.role
});

async function twoFactorSetupRequired(db, userDoc) {
  if (userDoc.role !== 'admin' || userDoc.two_factor?.enabled) return false;
  const settings = await getSecuritySettings(db);
  return !!settings.require_admin_2fa;
}

/**
 * @param method 'password' | 'google' | 'microsoft' | '2fa'
 * @param secondFactorDone true when called after a verified 2FA code
 */
async function completeLogin(req, res, db, userDoc, { method = 'password', secondFactorDone = false } = {}) {
  if (userDoc.is_active === false) {
    recordAuthEvent(req, 'auth.login.failed', { email: userDoc.email, role: userDoc.role, outcome: 'failure', reason: 'account_disabled', details: { method } });
    return res.status(403).json(DISABLED_RESPONSE);
  }

  if (userDoc.two_factor?.enabled && !secondFactorDone) {
    const challenge = await createChallenge(db, userDoc, method);
    recordAuthEvent(req, 'auth.login.2fa_challenge', { email: userDoc.email, role: userDoc.role, details: { method } });
    return res.json({
      two_factor_required: true,
      ...challenge,
      methods: ['totp', 'backup_code']
    });
  }

  const accessToken = createAccessToken(userDoc.email);
  await db.collection('users').updateOne(
    { email: userDoc.email },
    { $set: { last_login_at: new Date(), last_login_method: method } }
  ).catch(() => {});
  recordAuthEvent(req, 'auth.login.success', { email: userDoc.email, role: userDoc.role, details: { method } });

  const body = {
    access_token: accessToken,
    token_type: 'bearer',
    user: publicUser(userDoc)
  };
  if (await twoFactorSetupRequired(db, userDoc)) body.two_factor_setup_required = true;
  return res.json(body);
}

module.exports = { completeLogin, publicUser, twoFactorSetupRequired, DISABLED_RESPONSE };
