const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee, createAccessToken } = require('../middleware/auth');
const { validate } = require('../middleware/roleCheck');
const { schemas, defaultLeaveBalance } = require('../models/schemas');
const { hashPassword, verifyPassword, generateUUID, generateEmployeeId, normalizeLeaveType } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { generateWelcomeEmail, generateNewEmployeeNotificationEmail } = require('../utils/emailTemplates');
const crypto = require('crypto');
const Joi = require('joi');
const { createNotification } = require('../services/notificationService');
const { recordAuthEvent } = require('../services/platform/audit');
const { completeLogin, twoFactorSetupRequired } = require('../services/platform/loginFlow');
const { readChallengeToken, verifySecondFactor, registerFailure, isUserLocked } = require('../services/platform/twoFactor');
const { providerConfig, verifyIdToken, issueNonce, consumeNonce, SsoError } = require('../services/platform/sso');
const { getSecuritySettings } = require('../services/platform/settings');
const { getEffectivePermissions } = require('../services/platform/permissions');
const { clientIp, findUserByEmail } = require('../services/platform/common');

/**
 * Helper: Get leave balance from configured policy
 * Falls back to default if no policy is configured
 */
async function getLeaveBalanceFromPolicy(db) {
  try {
    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

    if (!policy || !policy.policies || policy.policies.length === 0) {
      // Return default if no policy configured
      return { ...defaultLeaveBalance };
    }

    const balance = {};
    for (const policyItem of policy.policies) {
      const leaveKey = normalizeLeaveType(policyItem.leave_type);
      balance[leaveKey] = policyItem.annual_quota;
    }

    return balance;
  } catch (error) {
    console.error('Error fetching leave policy:', error);
    // Fallback to default on error
    return { ...defaultLeaveBalance };
  }
}

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', validate(schemas.userRegister), async (req, res) => {
  try {
    const db = getDB();
    const userData = req.validatedBody;

    // Check if user exists
    const existingUser = await db.collection('users').findOne({ email: userData.email });
    if (existingUser) {
      return res.status(400).json({ detail: 'Email already registered' });
    }

    // Generate employee ID
    const employeeId = await generateEmployeeId();
    const hashedPassword = await hashPassword(userData.password);
    const now = new Date();
    const userId = generateUUID();

    // Create user document
    const userDoc = {
      id: userId,
      employee_id: employeeId,
      email: userData.email,
      full_name: userData.full_name,
      role: userData.role,
      hashed_password: hashedPassword,
      created_at: now
    };

    await db.collection('users').insertOne(userDoc);

    // Get manager name if provided
    let managerName = null;
    if (userData.manager_email) {
      const manager = await db.collection('employees').findOne(
        { email: userData.manager_email },
        { projection: { full_name: 1 } }
      );
      if (manager) {
        managerName = manager.full_name;
      }
    }

    // ============================================
    // GET LEAVE BALANCE FROM CONFIGURED POLICY
    // ============================================
    const leaveBalance = await getLeaveBalanceFromPolicy(db);

    // Create employee profile
    const employeeDoc = {
      id: userId,
      employee_id: employeeId,
      email: userData.email,
      full_name: userData.full_name,
      role: userData.role,
      department: userData.department,
      designation: userData.designation,
      phone: userData.phone || null,
      organization_id: userData.organization_id || null,
      organization_name: null,
      joining_date: now,
      manager_email: userData.manager_email || null,
      manager_name: managerName,
      leave_balance: leaveBalance,  // Uses policy-based balance
      created_at: now
    };

    await db.collection('employees').insertOne(employeeDoc);

    // Send welcome email
    try {
      const welcomeHtml = generateWelcomeEmail(
        userData.full_name,
        employeeId,
        userData.email,
        userData.role,
        userData.department,
        userData.designation
      );
      await sendEmailNotification(
        userData.email,
        `Welcome to HRMS - ${userData.full_name}`,
        welcomeHtml
      );

      // Notify admin
      const admin = await db.collection('employees').findOne(
        { role: 'admin' },
        { projection: { email: 1, full_name: 1 } }
      );
      if (admin) {
        const adminNotificationHtml = generateNewEmployeeNotificationEmail(
          userData.full_name,
          employeeId,
          userData.email,
          userData.role,
          userData.department,
          userData.designation,
          admin.full_name || 'Admin'
        );
        await sendEmailNotification(
          admin.email,
          `New Employee Added - ${userData.full_name}`,
          adminNotificationHtml
        );
      }
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError.message);
    }

    // Create token
    const accessToken = createAccessToken(userData.email);

    res.status(201).json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: userId,
        employee_id: employeeId,
        email: userData.email,
        full_name: userData.full_name,
        role: userData.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= LOGIN (password, 2FA, SSO) =============

// Simple in-memory throttle for repeated failed password attempts per IP + email
const FAILED_LOGIN_LIMIT = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map();

const throttleKey = (req, email) => `${clientIp(req) || '-'}|${String(email).toLowerCase()}`;
const isThrottled = (key) => {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > FAILED_LOGIN_WINDOW_MS) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= FAILED_LOGIN_LIMIT;
};
const noteFailure = (key) => {
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.first > FAILED_LOGIN_WINDOW_MS) failedLogins.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
  if (failedLogins.size > 10000) failedLogins.delete(failedLogins.keys().next().value);
};

/**
 * POST /api/auth/login
 * Login user. Users with 2FA enabled receive { two_factor_required, challenge_token }
 * and finish with POST /api/auth/2fa/verify.
 */
router.post('/login', validate(schemas.userLogin), async (req, res) => {
  try {
    const db = getDB();
    const { email, password } = req.validatedBody;
    const key = throttleKey(req, email);

    if (isThrottled(key)) {
      recordAuthEvent(req, 'auth.login.failed', { email, outcome: 'failure', reason: 'throttled' });
      return res.status(429).json({ detail: 'Too many failed sign-in attempts. Please wait a few minutes and try again.', error_code: 'TOO_MANY_ATTEMPTS' });
    }

    // Find user
    const userDoc = await db.collection('users').findOne(
      { email },
      { projection: { _id: 0 } }
    );

    // User not found - return specific error code
    if (!userDoc) {
      noteFailure(key);
      recordAuthEvent(req, 'auth.login.failed', { email, outcome: 'failure', reason: 'user_not_found' });
      return res.status(401).json({
        detail: 'No account found with this email',
        error_code: 'USER_NOT_FOUND'
      });
    }

    // Verify password
    const hashedPassword = userDoc.hashed_password;
    if (!hashedPassword) {
      recordAuthEvent(req, 'auth.login.failed', { email, role: userDoc.role, outcome: 'failure', reason: 'password_not_set' });
      return res.status(500).json({ detail: 'Password not set' });
    }

    const isValid = await verifyPassword(password, hashedPassword);

    // Invalid password - return specific error code
    if (!isValid) {
      noteFailure(key);
      recordAuthEvent(req, 'auth.login.failed', { email, role: userDoc.role, outcome: 'failure', reason: 'invalid_password' });
      return res.status(401).json({
        detail: 'Incorrect password',
        error_code: 'INVALID_PASSWORD'
      });
    }

    failedLogins.delete(key);
    return completeLogin(req, res, db, userDoc, { method: 'password' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

const twoFactorVerifySchema = Joi.object({
  challenge_token: Joi.string().max(2048).required(),
  code: Joi.string().trim().max(32).required()
});

const CHALLENGE_INVALID = { detail: 'Your sign-in session has expired. Please sign in again.', error_code: 'CHALLENGE_INVALID' };

/**
 * POST /api/auth/2fa/verify
 * Second step of sign-in: { challenge_token, code } where code is a 6-digit
 * authenticator code or a backup code. Returns the normal login response.
 * A challenge is locked after 5 wrong codes.
 */
router.post('/2fa/verify', validate(twoFactorVerifySchema), async (req, res) => {
  try {
    const db = getDB();
    const { challenge_token, code } = req.validatedBody;
    const payload = readChallengeToken(challenge_token);
    if (!payload) {
      recordAuthEvent(req, 'auth.2fa.failed', { outcome: 'failure', reason: 'invalid_challenge' });
      return res.status(401).json(CHALLENGE_INVALID);
    }

    const challenge = await db.collection('auth_challenges').findOne({ id: payload.jti });
    if (!challenge || challenge.user_email !== payload.sub || challenge.used || new Date(challenge.expires_at) < new Date()) {
      recordAuthEvent(req, 'auth.2fa.failed', { email: payload.sub, outcome: 'failure', reason: 'challenge_expired' });
      return res.status(401).json(CHALLENGE_INVALID);
    }
    if (challenge.locked) {
      recordAuthEvent(req, 'auth.2fa.failed', { email: payload.sub, outcome: 'failure', reason: 'challenge_locked' });
      return res.status(429).json({ detail: 'Too many incorrect codes. Please sign in again.', error_code: 'CHALLENGE_LOCKED' });
    }

    const userDoc = await db.collection('users').findOne({ email: payload.sub }, { projection: { _id: 0 } });
    if (!userDoc || !userDoc.two_factor?.enabled) return res.status(401).json(CHALLENGE_INVALID);
    if (isUserLocked(userDoc)) {
      recordAuthEvent(req, 'auth.2fa.failed', { email: userDoc.email, role: userDoc.role, outcome: 'failure', reason: 'user_locked' });
      return res.status(429).json({ detail: 'Two-factor verification is temporarily locked after too many failed attempts. Try again in 15 minutes.', error_code: 'TWO_FACTOR_LOCKED' });
    }

    const result = await verifySecondFactor(db, userDoc, code);
    if (!result.valid) {
      const { locked, attempts_left } = await registerFailure(db, challenge, userDoc);
      recordAuthEvent(req, 'auth.2fa.failed', { email: userDoc.email, role: userDoc.role, outcome: 'failure', reason: locked ? 'invalid_code_locked' : 'invalid_code' });
      if (locked) {
        return res.status(429).json({ detail: 'Too many incorrect codes. Please sign in again.', error_code: 'CHALLENGE_LOCKED' });
      }
      return res.status(401).json({ detail: 'Incorrect verification code', error_code: 'INVALID_2FA_CODE', attempts_left });
    }

    // Single use: only the request that flips `used` may continue
    const claimed = await db.collection('auth_challenges').updateOne(
      { id: challenge.id, used: false, locked: false },
      { $set: { used: true, used_at: new Date() } }
    );
    if (!claimed.modifiedCount) return res.status(401).json(CHALLENGE_INVALID);

    await db.collection('users').updateOne({ email: userDoc.email }, { $set: { 'two_factor.failed_attempts': 0 } });
    recordAuthEvent(req, 'auth.2fa.success', { email: userDoc.email, role: userDoc.role, details: { method: result.method } });
    if (result.method === 'backup_code' && result.remaining_backup_codes <= 2) {
      Promise.resolve(createNotification({
        userId: userDoc.id,
        userEmail: userDoc.email,
        type: 'two_factor_backup_codes_low',
        title: 'Backup codes running low',
        message: `You have ${result.remaining_backup_codes} backup code(s) left. Generate new ones from Security settings.`,
        actionUrl: '/security'
      })).catch(() => {});
    }
    return completeLogin(req, res, db, userDoc, { method: challenge.method || 'password', secondFactorDone: true });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/auth/sso/config — public: which SSO providers are configured.
 */
router.get('/sso/config', (req, res) => {
  const cfg = providerConfig();
  res.json({
    google: cfg.google ? { enabled: true, client_id: cfg.google.client_id } : { enabled: false },
    microsoft: cfg.microsoft
      ? { enabled: true, client_id: cfg.microsoft.client_id, tenant: cfg.microsoft.tenant, authorize_url: cfg.microsoft.authorize_url }
      : { enabled: false }
  });
});

/**
 * GET /api/auth/sso/nonce — public: a signed, short-lived nonce to embed in the
 * provider sign-in request (and send back with the ID token).
 */
router.get('/sso/nonce', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(issueNonce());
});

const ssoSchema = Joi.object({
  id_token: Joi.string().max(8192).required(),
  nonce: Joi.string().max(256).required()
});

/** Create a user + employee for a first-time SSO sign-in (auto-provisioning). */
async function provisionSsoUser(db, identity) {
  const now = new Date();
  const userId = generateUUID();
  const employeeId = await generateEmployeeId();
  const fullName = identity.name || identity.email.split('@')[0];
  const userDoc = {
    id: userId,
    employee_id: employeeId,
    email: identity.email,
    full_name: fullName,
    role: 'employee',
    // Random unusable password: SSO users can set one through "Forgot password"
    hashed_password: await hashPassword(crypto.randomBytes(32).toString('hex')),
    is_active: true,
    sso_provider: identity.provider,
    created_at: now
  };
  await db.collection('users').insertOne(userDoc);
  await db.collection('employees').insertOne({
    id: userId,
    employee_id: employeeId,
    email: identity.email,
    full_name: fullName,
    role: 'employee',
    department: 'Unassigned',
    designation: 'Employee',
    phone: null,
    organization_id: null,
    joining_date: now,
    manager_email: null,
    leave_balance: await getLeaveBalanceFromPolicy(db),
    created_at: now,
    provisioned_via: `sso:${identity.provider}`
  });
  delete userDoc._id;
  return userDoc;
}

/**
 * POST /api/auth/sso/:provider  (google | microsoft)
 * Body: { id_token, nonce }. Verifies the provider ID token and signs in the
 * matching existing user (2FA still applies).
 */
router.post('/sso/:provider', validate(ssoSchema), async (req, res) => {
  const provider = req.params.provider;
  if (!['google', 'microsoft'].includes(provider)) return res.status(404).json({ detail: 'Unknown sign-in provider' });
  try {
    const db = getDB();
    const { id_token, nonce } = req.validatedBody;
    let identity;
    try {
      identity = await verifyIdToken(provider, id_token, { nonce });
    } catch (error) {
      if (!(error instanceof SsoError)) throw error;
      recordAuthEvent(req, 'auth.sso.failed', { outcome: 'failure', reason: error.reason, details: { provider } });
      const status = error.reason === 'not_configured' ? 400 : 401;
      return res.status(status).json({ detail: error.message, error_code: 'SSO_INVALID_TOKEN', reason: error.reason });
    }
    if (!(await consumeNonce(db, identity.nonce))) {
      recordAuthEvent(req, 'auth.sso.failed', { email: identity.email, outcome: 'failure', reason: 'nonce_replayed', details: { provider } });
      return res.status(401).json({ detail: 'This sign-in response was already used. Please try again.', error_code: 'SSO_INVALID_TOKEN', reason: 'bad_nonce' });
    }

    let userDoc = await findUserByEmail(db, identity.email);
    if (!userDoc) {
      const settings = await getSecuritySettings(db);
      const domain = identity.email.split('@')[1];
      const allowed = settings.sso_auto_provision && (settings.sso_allowed_domains || []).map(d => d.toLowerCase()).includes(domain);
      if (!allowed) {
        recordAuthEvent(req, 'auth.sso.failed', { email: identity.email, outcome: 'failure', reason: 'user_not_found', details: { provider } });
        return res.status(401).json({ detail: 'No Xeno-HR account is linked to this email. Ask your administrator to invite you.', error_code: 'USER_NOT_FOUND' });
      }
      userDoc = await provisionSsoUser(db, identity);
      recordAuthEvent(req, 'auth.sso.provisioned', { email: identity.email, role: 'employee', details: { provider } });
    }

    await db.collection('users').updateOne(
      { email: userDoc.email },
      { $set: { [`sso_identities.${provider}`]: { subject: identity.subject, tenant: identity.tenant, last_used_at: new Date() } } }
    );
    return completeLogin(req, res, db, userDoc, { method: provider });
  } catch (error) {
    console.error('SSO login error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Current user profile, plus effective permissions, custom role, 2FA status
 * and language preference.
 */
router.get('/me', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const userDoc = await db.collection('users').findOne(
      { email: req.user.email },
      { projection: { _id: 0, custom_role_id: 1, 'two_factor.enabled': 1, preferences: 1 } }
    );
    const permissions = await getEffectivePermissions({ role: req.user.role, custom_role_id: userDoc?.custom_role_id });
    let customRole = null;
    if (userDoc?.custom_role_id) {
      customRole = await db.collection('custom_roles').findOne({ id: userDoc.custom_role_id }, { projection: { _id: 0, id: 1, name: 1 } });
    }
    res.json({
      ...req.employee,
      permissions,
      custom_role_id: customRole?.id || null,
      custom_role_name: customRole?.name || null,
      two_factor_enabled: !!userDoc?.two_factor?.enabled,
      two_factor_setup_required: await twoFactorSetupRequired(db, { role: req.user.role, two_factor: userDoc?.two_factor }),
      language: userDoc?.preferences?.language || null
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
