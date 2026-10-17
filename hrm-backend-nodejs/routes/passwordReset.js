const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const { hashPassword } = require('../utils/helpers');
const { passwordPolicyMessage } = require('../utils/passwordPolicy');
const { sendEmailNotification } = require('../services/emailService');
const { generatePasswordResetEmail, generateBulkPasswordResetEmail } = require('../utils/emailTemplates');
const { recordAuthEvent } = require('../services/platform/audit');

// Token expiry time (24 hours)
const TOKEN_EXPIRY_HOURS = 24;

// Upper bound on one admin-triggered batch
const MAX_ADMIN_BATCH = 500;

const EMPLOYEE_PROJECTION = { _id: 0, full_name: 1, email: 1, employee_id: 1, employment_status: 1 };

/**
 * Generate a secure random token
 */
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Find an employee by email. Emails are stored as entered at creation, so
 * fall back to a case-insensitive match when the exact one misses.
 */
async function findEmployeeByEmail(db, email) {
  const value = String(email).trim();
  const employees = db.collection('employees');
  const exact = await employees.findOne({ email: value }, { projection: EMPLOYEE_PROJECTION });
  if (exact) return exact;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return employees.findOne(
    { email: { $regex: `^${escaped}$`, $options: 'i' } },
    { projection: EMPLOYEE_PROJECTION }
  );
}

/**
 * Invalidate any open reset tokens for the employee, issue a fresh one and
 * email the reset link. Returns whether the email was sent.
 */
async function issueResetEmail(db, employee, { adminInitiated = false, initiatedBy = null } = {}) {
  const resetToken = generateResetToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Invalidate any existing tokens for this user
  await db.collection('password_reset_tokens').updateMany(
    { email: employee.email, used: false },
    { $set: { used: true, invalidated_at: new Date() } }
  );

  // Store new token
  await db.collection('password_reset_tokens').insertOne({
    token: resetToken,
    email: employee.email,
    employee_id: employee.employee_id,
    full_name: employee.full_name,
    created_at: new Date(),
    expires_at: expiresAt,
    used: false,
    initiated_by: initiatedBy
  });

  // Build reset URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  // Send email
  const template = adminInitiated ? generateBulkPasswordResetEmail : generatePasswordResetEmail;
  const emailSent = await sendEmailNotification(
    employee.email,
    adminInitiated ? 'Set Your New Password - HRMS' : 'Password Reset Request - HRMS',
    template(employee.full_name, resetUrl, TOKEN_EXPIRY_HOURS)
  );

  if (!emailSent) {
    console.error(`Failed to send password reset email to ${employee.email}`);
  }
  return emailSent;
}

/**
 * POST /api/password-reset/request
 * Request password reset - sends email with reset link
 */
router.post('/request', async (req, res) => {
  try {
    const db = getDB();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ detail: 'Email is required' });
    }

    const employee = await findEmployeeByEmail(db, email);

    // Always return success to prevent email enumeration
    if (!employee) {
      console.log(`Password reset requested for non-existent email: ${email}`);
      recordAuthEvent(req, 'auth.password_reset.requested', { email: String(email).slice(0, 254), outcome: 'failure', reason: 'unknown_email' });
      return res.json({
        status: 'success',
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    const emailSent = await issueResetEmail(db, employee);

    recordAuthEvent(req, 'auth.password_reset.requested', { email: employee.email, details: { email_sent: !!emailSent } });

    // Log the request
    await db.collection('password_reset_logs').insertOne({
      email: employee.email,
      employee_id: employee.employee_id,
      action: 'requested',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      email_sent: emailSent,
      timestamp: new Date()
    });

    res.json({
      status: 'success',
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/password-reset/validate/:token
 * Validate reset token and return user info
 */
router.get('/validate/:token', async (req, res) => {
  try {
    const db = getDB();
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ detail: 'Token is required' });
    }

    // Find token
    const tokenDoc = await db.collection('password_reset_tokens').findOne({
      token,
      used: false
    });

    if (!tokenDoc) {
      return res.status(400).json({
        detail: 'Invalid or expired reset link',
        code: 'INVALID_TOKEN'
      });
    }

    // Check if token is expired
    if (new Date() > new Date(tokenDoc.expires_at)) {
      return res.status(400).json({
        detail: 'This reset link has expired. Please request a new one.',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.json({
      status: 'valid',
      full_name: tokenDoc.full_name,
      email: tokenDoc.email,
      expires_at: tokenDoc.expires_at
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/password-reset/reset
 * Reset password using token
 */
router.post('/reset', async (req, res) => {
  try {
    const db = getDB();
    const { token, new_password } = req.body;

    if (!token) {
      return res.status(400).json({ detail: 'Token is required' });
    }

    const policyProblem = passwordPolicyMessage(new_password || '');
    if (policyProblem) {
      return res.status(400).json({ detail: policyProblem, errors: [{ field: 'new_password', message: policyProblem }] });
    }

    // Find and validate token
    const tokenDoc = await db.collection('password_reset_tokens').findOne({
      token,
      used: false
    });

    if (!tokenDoc) {
      recordAuthEvent(req, 'auth.password_reset.failed', { outcome: 'failure', reason: 'invalid_token' });
      return res.status(400).json({
        detail: 'Invalid or expired reset link',
        code: 'INVALID_TOKEN'
      });
    }

    // Check if token is expired
    if (new Date() > new Date(tokenDoc.expires_at)) {
      return res.status(400).json({
        detail: 'This reset link has expired. Please request a new one.',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(new_password);

    // Update user password
    await db.collection('users').updateOne(
      { email: tokenDoc.email },
      {
        $set: {
          hashed_password: hashedPassword,
          password_updated_at: new Date(),
          // Sign out every existing session for this account
          tokens_valid_after: new Date()
        }
      }
    );

    // Mark token as used
    await db.collection('password_reset_tokens').updateOne(
      { token },
      {
        $set: {
          used: true,
          used_at: new Date()
        }
      }
    );

    recordAuthEvent(req, 'auth.password_reset.completed', { email: tokenDoc.email });

    // Log the reset
    await db.collection('password_reset_logs').insertOne({
      email: tokenDoc.email,
      employee_id: tokenDoc.employee_id,
      action: 'reset_completed',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      timestamp: new Date()
    });

    // Send confirmation email
    try {
      const confirmationHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 30px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #020202; margin: 0; font-size: 24px;">Password Changed Successfully</h1>
          </div>
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
              Hi ${tokenDoc.full_name},
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
              Your password has been successfully changed. You can now log in with your new password.
            </p>
            <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin-top: 20px;">
              If you did not make this change, please contact your administrator immediately.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="color: #94a3b8; font-size: 12px;">
              This is an automated message from HRMS. Please do not reply.
            </p>
          </div>
        </div>
      `;
      await sendEmailNotification(tokenDoc.email, 'Password Changed - HRMS', confirmationHtml);
    } catch (emailError) {
      console.error('Failed to send password change confirmation:', emailError);
    }

    res.json({
      status: 'success',
      message: 'Password has been reset successfully. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/password-reset/admin/send
 * Admin-triggered reset: emails a set-new-password link to the given employees.
 * Body: { employee_ids: string[] }
 */
router.post('/admin/send', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const ids = Array.isArray(req.body.employee_ids)
      ? [...new Set(req.body.employee_ids.filter((id) => typeof id === 'string' && id))]
      : [];

    if (!ids.length) {
      return res.status(400).json({ detail: 'employee_ids must be a non-empty array' });
    }
    if (ids.length > MAX_ADMIN_BATCH) {
      return res.status(400).json({ detail: `At most ${MAX_ADMIN_BATCH} employees per request` });
    }

    // ids may be emails (unique) or employee_id codes
    const emails = ids.filter((id) => id.includes('@'));
    const codes = ids.filter((id) => !id.includes('@'));
    const employees = await db.collection('employees')
      .find({ $or: [{ email: { $in: emails } }, { employee_id: { $in: codes } }] }, { projection: EMPLOYEE_PROJECTION })
      .toArray();
    const found = new Set(employees.flatMap((e) => [e.email, e.employee_id]));

    const sent = [];
    const failed = [];
    const skipped = ids.filter((id) => !found.has(id)).map((id) => ({ employee_id: id, reason: 'not_found' }));

    // Sequential on purpose: keeps us inside the mail provider's rate limits
    for (const employee of employees) {
      if (employee.employment_status === 'exited') {
        skipped.push({ employee_id: employee.employee_id, reason: 'exited' });
        continue;
      }
      if (!employee.email) {
        skipped.push({ employee_id: employee.employee_id, reason: 'no_email' });
        continue;
      }
      const emailSent = await issueResetEmail(db, employee, { adminInitiated: true, initiatedBy: req.user.email });
      (emailSent ? sent : failed).push({ employee_id: employee.employee_id, email: employee.email });

      recordAuthEvent(req, 'auth.password_reset.admin_sent', {
        email: employee.email,
        outcome: emailSent ? 'success' : 'failure',
        details: { initiated_by: req.user.email }
      });
      await db.collection('password_reset_logs').insertOne({
        email: employee.email,
        employee_id: employee.employee_id,
        action: 'admin_requested',
        initiated_by: req.user.email,
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
        email_sent: emailSent,
        timestamp: new Date()
      });
    }

    res.json({ status: 'success', sent, failed, skipped });
  } catch (error) {
    console.error('Admin password reset error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
