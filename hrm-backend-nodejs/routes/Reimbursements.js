const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const { generateUUID, toISOString } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { extractKeyFromUrl } = require('../services/s3Service');
const { storeFile, removeFile } = require('../services/fileStorage');
const { createNotification, NotificationType } = require('../services/notificationService');
const { emitEvent } = require('../services/events');
const { receiptUpload } = require('../services/assets/uploads');
const { evaluatePolicy } = require('../services/assets/expensePolicy');
const { LINKABLE_TRIP_STATUSES } = require('../services/assets/travel');

// Receipts: images or PDF up to 10 MB (stored via services/fileStorage — S3 or local uploads/)
const upload = receiptUpload('bill_image');

const claimFields = {
  title: Joi.string().trim().max(200),
  category: Joi.string().trim().max(60),
  amount: Joi.number().positive().max(1e9),
  description: Joi.string().max(2000).allow(''),
  expense_date: Joi.alternatives().try(Joi.date().iso(), Joi.valid('')),
  trip_id: Joi.string().trim().max(100).allow('', 'none'),
  remove_bill: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false'))
};
const applySchema = Joi.object(claimFields);
const editSchema = Joi.object(claimFields);

/** Validate multipart fields; returns [value, errorMessage]. */
const validateFields = (schema, body) => {
  const { error, value } = schema.validate(body || {}, { abortEarly: true, stripUnknown: true, convert: true });
  if (error) {
    const d = error.details[0];
    const field = d.path.join('.');
    const msg = field === 'amount' ? 'Invalid amount' : field === 'expense_date' ? 'Invalid expense date' : d.message.replace(/"/g, '');
    return [null, msg];
  }
  return [value, null];
};

const toDateString = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
};

/** Delete a stored bill (new fileStorage keys, legacy S3 keys, or legacy URL-only records). */
const removeBill = async (reimbursement) => {
  const key = reimbursement.bill_key || (reimbursement.bill_url ? extractKeyFromUrl(reimbursement.bill_url) : null);
  if (key) await removeFile(key);
};

/** Compact snapshot of a policy check stored on the claim (shown to the approver). */
const policySnapshot = (check) => ({
  status: check.status,
  has_policy: check.has_policy,
  enforcement: check.enforcement,
  category: check.policy?.category || null,
  max_per_claim: check.policy?.max_per_claim ?? null,
  monthly_cap: check.policy?.monthly_cap ?? null,
  receipt_required_above: check.policy?.receipt_required_above ?? null,
  month: check.month,
  month_to_date: check.month_to_date,
  violations: check.violations,
  checked_at: check.checked_at
});

/** Resolve a trip the employee may link a claim to; throws { status, message } when invalid. */
const resolveTrip = async (db, tripId, employeeEmail) => {
  if (!tripId || tripId === 'none') return null;
  const trip = await db.collection('travel_requests').findOne({ id: tripId }, { projection: { _id: 0 } });
  if (!trip || trip.employee_email !== employeeEmail) {
    throw Object.assign(new Error('Travel request not found'), { status: 400 });
  }
  if (!LINKABLE_TRIP_STATUSES.includes(trip.status)) {
    throw Object.assign(new Error('Claims can only be linked to approved trips'), { status: 400 });
  }
  return trip;
};

const tripLabel = (trip) => `${trip.from_city} → ${trip.to_city} (${toDateString(trip.start_date)})`;

/**
 * POST /api/reimbursements/apply
 * Apply for reimbursement (employee/manager). The claim is checked against the
 * category's expense policy: hard violations are blocked, soft ones are saved
 * and flagged for the approver.
 */
router.post('/apply', authenticate, requireRole([UserRole.EMPLOYEE, UserRole.MANAGER]), upload, async (req, res) => {
  try {
    const db = getDB();

    // Validate required fields
    const { title, category, amount } = req.body || {};
    if (!title || !category || !amount) {
      return res.status(400).json({ detail: 'Title, category, and amount are required' });
    }
    const [fields, fieldError] = validateFields(applySchema, req.body);
    if (fieldError) return res.status(400).json({ detail: fieldError });
    if (!fields.title || !fields.category) {
      return res.status(400).json({ detail: 'Title, category, and amount are required' });
    }
    const parsedAmount = Math.round(fields.amount * 100) / 100;

    // Get employee info
    const employee = await db.collection('employees').findOne(
      { email: req.user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    let trip = null;
    try {
      trip = await resolveTrip(db, fields.trip_id, employee.email);
    } catch (e) {
      return res.status(e.status || 400).json({ detail: e.message });
    }

    const expenseDate = toDateString(fields.expense_date) || toISOString(new Date());
    const check = await evaluatePolicy(db, {
      employee,
      role: req.user.role,
      category: fields.category,
      amount: parsedAmount,
      expenseDate,
      hasReceipt: !!req.file
    });
    if (check.status === 'blocked') {
      return res.status(400).json({
        detail: `Blocked by expense policy: ${check.violations.map(v => v.message).join('; ')}`,
        policy_check: check
      });
    }

    // Store the bill (receipt) if provided
    let billUrl = null;
    let billKey = null;
    if (req.file) {
      try {
        const stored = await storeFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'reimbursements',
          employee.employee_id || employee.id
        );
        billUrl = stored.url;
        billKey = stored.key;
      } catch (uploadError) {
        console.error('Failed to upload bill image:', uploadError);
        if (check.receipt_required) {
          return res.status(502).json({ detail: 'Could not store the receipt. Please try again.' });
        }
        // Otherwise continue without the image - it's optional
      }
    }

    // Create reimbursement record
    const reimbursement = {
      id: generateUUID(),
      employee_id: employee.employee_id || employee.id,
      employee_email: employee.email,
      employee_name: employee.full_name,
      department: employee.department,
      title: fields.title,
      category: fields.category,
      amount: parsedAmount,
      description: fields.description || '',
      expense_date: expenseDate,
      bill_url: billUrl,
      bill_key: billKey,  // Store key for deletion later if needed
      bill_name: req.file ? req.file.originalname : null,
      bill_type: req.file ? req.file.mimetype : null,
      trip_id: trip ? trip.id : null,
      trip_label: trip ? tripLabel(trip) : null,
      policy_check: policySnapshot(check),
      policy_flagged: check.status === 'warning',
      status: 'pending',
      created_at: toISOString(new Date()),
      updated_at: toISOString(new Date()),
      admin_remarks: null,
      processed_by: null,
      processed_at: null,
      cleared_at: null
    };

    await db.collection('reimbursements').insertOne(reimbursement);

    // Notify admins about new reimbursement request
    try {
      const admins = await db.collection('employees')
        .find({ role: 'admin' }, { projection: { id: 1, email: 1 } })
        .toArray();

      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          userEmail: admin.email,
          type: NotificationType.REIMBURSEMENT_APPLIED,
          title: reimbursement.policy_flagged ? 'New Reimbursement Request (policy exception)' : 'New Reimbursement Request',
          message: `${employee.full_name} has submitted a reimbursement request for ₹${parsedAmount} (${fields.category})${reimbursement.policy_flagged ? ' — flagged by expense policy' : ''}`,
          actionUrl: '/adminreimbursements',
          metadata: { reimbursement_id: reimbursement.id, employee_name: employee.full_name, amount: parsedAmount, policy_flagged: reimbursement.policy_flagged }
        });
      }
    } catch (notifyError) {
      console.error('Failed to send reimbursement notification:', notifyError.message);
    }
    if (reimbursement.policy_flagged) {
      emitEvent('expense.flagged', { reimbursement_id: reimbursement.id, employee_email: employee.email, category: fields.category, amount: parsedAmount, violations: check.violations.map(v => v.code) });
    }

    delete reimbursement._id;

    res.json({
      status: 'success',
      message: reimbursement.policy_flagged
        ? 'Reimbursement request submitted and flagged for review against the expense policy'
        : 'Reimbursement request submitted successfully',
      reimbursement,
      policy_check: check
    });
  } catch (error) {
    console.error('Apply reimbursement error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/reimbursements/:id
 * Edit reimbursement (only if pending, only by owner; admin can edit any).
 * The policy is re-checked; hard violations block the owner's edit.
 */
router.put('/:id', authenticate, upload, async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    // Get reimbursement
    const reimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!reimbursement) {
      return res.status(404).json({ detail: 'Reimbursement not found' });
    }

    // Check permission - only owner can edit, admin can edit any
    if (req.user.role !== UserRole.ADMIN && reimbursement.employee_email !== req.user.email) {
      return res.status(403).json({ detail: 'Not authorized to edit this reimbursement' });
    }

    // Can only edit pending reimbursements (unless admin)
    if (req.user.role !== UserRole.ADMIN && reimbursement.status !== 'pending') {
      return res.status(400).json({ detail: 'Can only edit pending reimbursements' });
    }

    const [fields, fieldError] = validateFields(editSchema, req.body);
    if (fieldError) return res.status(400).json({ detail: fieldError });

    // Build update object
    const updateData = {
      updated_at: toISOString(new Date())
    };

    if (fields.title !== undefined && fields.title.trim()) {
      updateData.title = fields.title.trim();
    }

    if (fields.category !== undefined && fields.category.trim()) {
      updateData.category = fields.category.trim();
    }

    if (fields.amount !== undefined) {
      updateData.amount = Math.round(fields.amount * 100) / 100;
    }

    if (fields.description !== undefined) {
      updateData.description = fields.description;
    }

    if (fields.expense_date !== undefined && fields.expense_date !== '') {
      updateData.expense_date = toDateString(fields.expense_date);
    }

    if (fields.trip_id !== undefined) {
      if (fields.trip_id === '' || fields.trip_id === 'none') {
        updateData.trip_id = null;
        updateData.trip_label = null;
      } else if (fields.trip_id !== reimbursement.trip_id) {
        try {
          const trip = await resolveTrip(db, fields.trip_id, reimbursement.employee_email);
          updateData.trip_id = trip.id;
          updateData.trip_label = tripLabel(trip);
        } catch (e) {
          return res.status(e.status || 400).json({ detail: e.message });
        }
      }
    }

    const removeExisting = fields.remove_bill === true || fields.remove_bill === 'true';
    const willHaveReceipt = !!req.file || (!!reimbursement.bill_url && !removeExisting);

    // Re-check the expense policy against the edited claim
    const employee = await db.collection('employees').findOne({ email: reimbursement.employee_email }, { projection: { _id: 0 } });
    const merged = { ...reimbursement, ...updateData };
    const check = await evaluatePolicy(db, {
      employee: employee || { email: reimbursement.employee_email },
      role: employee?.role,
      category: merged.category,
      amount: merged.amount,
      expenseDate: merged.expense_date,
      hasReceipt: willHaveReceipt,
      excludeId: reimbursement.id
    });
    if (check.status === 'blocked' && req.user.role !== UserRole.ADMIN) {
      return res.status(400).json({
        detail: `Blocked by expense policy: ${check.violations.map(v => v.message).join('; ')}`,
        policy_check: check
      });
    }
    updateData.policy_check = policySnapshot(check);
    updateData.policy_flagged = check.status !== 'ok';

    // Handle bill image
    // If remove_bill is true, delete the existing bill
    if (removeExisting) {
      await removeBill(reimbursement);
      updateData.bill_url = null;
      updateData.bill_key = null;
      updateData.bill_name = null;
      updateData.bill_type = null;
    }

    // If new image is uploaded, replace the old one
    if (req.file) {
      // Upload new bill
      try {
        const stored = await storeFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'reimbursements',
          reimbursement.employee_id
        );
        if (!removeExisting) await removeBill(reimbursement);
        updateData.bill_url = stored.url;
        updateData.bill_key = stored.key;
        updateData.bill_name = req.file.originalname;
        updateData.bill_type = req.file.mimetype;
      } catch (uploadError) {
        console.error('Failed to upload new bill image:', uploadError);
        // Continue without updating the image
      }
    }

    // Update the reimbursement
    await db.collection('reimbursements').updateOne(
      { id },
      { $set: updateData }
    );

    // Get updated reimbursement
    const updatedReimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    res.json({
      status: 'success',
      message: 'Reimbursement updated successfully',
      reimbursement: updatedReimbursement,
      policy_check: check
    });
  } catch (error) {
    console.error('Edit reimbursement error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/my
 * Get my reimbursements (employee/manager)
 */
router.get('/my', authenticate, requireRole([UserRole.EMPLOYEE, UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();

    const reimbursements = await db.collection('reimbursements')
      .find(
        { employee_email: req.user.email },
        { projection: { _id: 0 } }
      )
      .sort({ created_at: -1 })
      .toArray();

    res.json(reimbursements);
  } catch (error) {
    console.error('Get my reimbursements error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/all
 * Get all reimbursements (admin only)
 */
router.get('/all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const reimbursements = await db.collection('reimbursements')
      .find({}, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    res.json(reimbursements);
  } catch (error) {
    console.error('Get all reimbursements error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/stats
 * Get reimbursement statistics (admin only)
 */
router.get('/stats', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const reimbursements = await db.collection('reimbursements')
      .find({}, { projection: { _id: 0, status: 1, amount: 1 } })
      .toArray();

    const stats = {
      total_count: reimbursements.length,
      total_amount: 0,
      pending_count: 0,
      pending_amount: 0,
      approved_count: 0,
      approved_amount: 0,
      cleared_count: 0,
      cleared_amount: 0,
      rejected_count: 0,
      rejected_amount: 0
    };

    reimbursements.forEach(r => {
      const amount = parseFloat(r.amount) || 0;
      stats.total_amount += amount;

      switch (r.status) {
        case 'pending':
          stats.pending_count++;
          stats.pending_amount += amount;
          break;
        case 'approved':
          stats.approved_count++;
          stats.approved_amount += amount;
          break;
        case 'cleared':
          stats.cleared_count++;
          stats.cleared_amount += amount;
          break;
        case 'rejected':
          stats.rejected_count++;
          stats.rejected_amount += amount;
          break;
      }
    });

    res.json(stats);
  } catch (error) {
    console.error('Get reimbursement stats error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/reimbursements/:id/action
 * Process reimbursement action (admin only)
 * Actions: approve, reject, clear
 */
router.post('/:id/action', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { action, remarks } = req.body;

    if (!['approve', 'reject', 'clear'].includes(action)) {
      return res.status(400).json({ detail: 'Invalid action. Must be approve, reject, or clear' });
    }

    // Get reimbursement
    const reimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!reimbursement) {
      return res.status(404).json({ detail: 'Reimbursement not found' });
    }

    // Validate action based on current status
    if (action === 'approve' && reimbursement.status !== 'pending') {
      return res.status(400).json({ detail: 'Can only approve pending reimbursements' });
    }
    if (action === 'reject' && reimbursement.status !== 'pending') {
      return res.status(400).json({ detail: 'Can only reject pending reimbursements' });
    }
    if (action === 'clear' && reimbursement.status !== 'approved') {
      return res.status(400).json({ detail: 'Can only clear approved reimbursements' });
    }

    // Require remarks for rejection
    if (action === 'reject' && !remarks?.trim()) {
      return res.status(400).json({ detail: 'Remarks are required for rejection' });
    }

    // Determine new status
    let newStatus;
    switch (action) {
      case 'approve':
        newStatus = 'approved';
        break;
      case 'reject':
        newStatus = 'rejected';
        break;
      case 'clear':
        newStatus = 'cleared';
        break;
    }

    // Update reimbursement
    const updateData = {
      status: newStatus,
      admin_remarks: remarks || null,
      processed_by: req.user.email,
      processed_at: toISOString(new Date()),
      updated_at: toISOString(new Date())
    };

    if (action === 'clear') {
      updateData.cleared_at = toISOString(new Date());
    }

    await db.collection('reimbursements').updateOne(
      { id },
      { $set: updateData }
    );

    // Get employee record for notifications
    const employeeRecord = await db.collection('employees').findOne(
      { email: reimbursement.employee_email },
      { projection: { id: 1 } }
    );

    // Send email notification for cleared reimbursements
    if (action === 'clear') {
      const emailHtml = generateReimbursementClearedEmail({
        employeeName: reimbursement.employee_name,
        title: reimbursement.title,
        category: reimbursement.category,
        amount: reimbursement.amount,
        expenseDate: reimbursement.expense_date,
        clearedDate: new Date(),
        remarks: remarks
      });

      await sendEmailNotification(
        reimbursement.employee_email,
        'Reimbursement Cleared - Payment Processed',
        emailHtml
      );

      // Create in-app notification
      await createNotification({
        userId: employeeRecord?.id,
        userEmail: reimbursement.employee_email,
        type: NotificationType.REIMBURSEMENT_CLEARED,
        title: 'Reimbursement Cleared',
        message: `Your reimbursement of ₹${reimbursement.amount} (${reimbursement.title}) has been cleared/paid`,
        actionUrl: '/myreimbursements',
        metadata: { reimbursement_id: id, amount: reimbursement.amount }
      });
    }

    // Send email for rejection
    if (action === 'reject') {
      const emailHtml = generateReimbursementRejectedEmail({
        employeeName: reimbursement.employee_name,
        title: reimbursement.title,
        category: reimbursement.category,
        amount: reimbursement.amount,
        reason: remarks
      });

      await sendEmailNotification(
        reimbursement.employee_email,
        'Reimbursement Request Rejected',
        emailHtml
      );

      // Create in-app notification
      await createNotification({
        userId: employeeRecord?.id,
        userEmail: reimbursement.employee_email,
        type: NotificationType.REIMBURSEMENT_REJECTED,
        title: 'Reimbursement Rejected',
        message: `Your reimbursement request for ₹${reimbursement.amount} (${reimbursement.title}) has been rejected${remarks ? `. Reason: ${remarks}` : ''}`,
        actionUrl: '/myreimbursements',
        metadata: { reimbursement_id: id, amount: reimbursement.amount }
      });
    }

    // Send notification for approval
    if (action === 'approve') {
      await createNotification({
        userId: employeeRecord?.id,
        userEmail: reimbursement.employee_email,
        type: NotificationType.REIMBURSEMENT_APPROVED,
        title: 'Reimbursement Approved',
        message: `Your reimbursement request for ₹${reimbursement.amount} (${reimbursement.title}) has been approved. Payment will be processed soon.`,
        actionUrl: '/myreimbursements',
        metadata: { reimbursement_id: id, amount: reimbursement.amount }
      });
    }

    res.json({
      status: 'success',
      message: `Reimbursement ${action}${action === 'clear' ? 'ed' : action === 'approve' ? 'd' : 'ed'} successfully`,
      reimbursement_id: id,
      new_status: newStatus
    });
  } catch (error) {
    console.error('Process reimbursement action error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/:id
 * Get single reimbursement details
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    const reimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!reimbursement) {
      return res.status(404).json({ detail: 'Reimbursement not found' });
    }

    // Check permission
    if (req.user.role !== UserRole.ADMIN && reimbursement.employee_email !== req.user.email) {
      return res.status(403).json({ detail: 'Not authorized' });
    }

    res.json(reimbursement);
  } catch (error) {
    console.error('Get reimbursement error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/reimbursements/:id
 * Cancel/delete reimbursement (only if pending)
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    const reimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!reimbursement) {
      return res.status(404).json({ detail: 'Reimbursement not found' });
    }

    // Check permission - only owner can delete pending, admin can delete any
    if (req.user.role !== UserRole.ADMIN) {
      if (reimbursement.employee_email !== req.user.email) {
        return res.status(403).json({ detail: 'Not authorized' });
      }
      if (reimbursement.status !== 'pending') {
        return res.status(400).json({ detail: 'Can only cancel pending reimbursements' });
      }
    }

    // Delete the stored bill if any (never throws)
    await removeBill(reimbursement);

    await db.collection('reimbursements').deleteOne({ id });

    res.json({
      status: 'success',
      message: 'Reimbursement deleted successfully'
    });
  } catch (error) {
    console.error('Delete reimbursement error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Email Template Functions

/**
 * Generate reimbursement cleared email
 */
const generateReimbursementClearedEmail = ({ employeeName, title, category, amount, expenseDate, clearedDate, remarks }) => {
  const formattedExpenseDate = new Date(expenseDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const formattedClearedDate = clearedDate.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 60px;">
        <span style="font-size: 28px; color: #ffffff;">✓</span>
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Reimbursement Cleared!</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Your payment has been processed</p>
    </div>

    <!-- Content -->
    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        Dear <strong>${employeeName}</strong>,
      </p>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
        Great news! Your reimbursement request has been processed and the payment has been cleared. Here are the details:
      </p>

      <!-- Details Box -->
      <div style="background-color: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Title</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${title}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Category</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${category}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Expense Date</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${formattedExpenseDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Cleared Date</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${formattedClearedDate}</td>
          </tr>
        </table>
        
        <!-- Amount -->
        <div style="margin-top: 16px; padding-top: 16px; border-top: 2px dashed #e2e8f0; text-align: center;">
          <p style="color: #64748b; font-size: 12px; margin: 0 0 4px 0;">Amount Reimbursed</p>
          <p style="color: #059669; font-size: 32px; font-weight: 700; margin: 0;">₹${parseFloat(amount).toLocaleString('en-IN')}</p>
        </div>
      </div>

      ${remarks ? `
      <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #065f46; font-size: 13px; margin: 0;">
          <strong>Note from Admin:</strong> ${remarks}
        </p>
      </div>
      ` : ''}

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        The amount will be credited to your account as per company policy. If you have any questions, please contact the HR department.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.<br>
        Please do not reply to this email.
      </p>
    </div>

  </div>
</body>
</html>
  `;
};

/**
 * Generate reimbursement rejected email
 */
const generateReimbursementRejectedEmail = ({ employeeName, title, category, amount, reason }) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 60px;">
        <span style="font-size: 28px; color: #334155;">✕</span>
      </div>
      <h1 style="color: #334155; margin: 0; font-size: 24px; font-weight: 700;">Reimbursement Rejected</h1>
    </div>

    <!-- Content -->
    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        Dear <strong>${employeeName}</strong>,
      </p>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
        We regret to inform you that your reimbursement request has been rejected. Here are the details:
      </p>

      <!-- Details Box -->
      <div style="background-color: #fef2f2; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #fecaca;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Title</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${title}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Category</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${category}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Amount</td>
            <td style="padding: 8px 0; color: #dc2626; font-size: 14px; font-weight: 600; text-align: right;">₹${parseFloat(amount).toLocaleString('en-IN')}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #991b1b; font-size: 13px; margin: 0;">
          <strong>Reason for Rejection:</strong> ${reason}
        </p>
      </div>

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        If you believe this was rejected in error or have any questions, please contact the HR department.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.<br>
        Please do not reply to this email.
      </p>
    </div>

  </div>
</body>
</html>
  `;
};

module.exports = router;
