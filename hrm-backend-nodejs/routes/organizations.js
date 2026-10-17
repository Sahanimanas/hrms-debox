const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, UserRole } = require('../models/schemas');
const { generateUUID, toISOString } = require('../utils/helpers');
const { orgNameKey } = require('../services/employeeIdentity');

/**
 * Another organization already using this name (trimmed, case-insensitive)?
 * Rows created before name_key existed are compared by name too.
 */
async function findNameClash(db, name, exceptId = null) {
  const key = orgNameKey(name);
  const orgs = await db.collection('organizations').find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
  return orgs.find(o => o.id !== exceptId && orgNameKey(o.name) === key) || null;
}

const nameTaken = (name) => ({ detail: `An organization named "${name}" already exists` });

/**
 * POST /api/organizations
 * Create organization (admin only)
 */
router.post('/', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.organizationCreate), async (req, res) => {
  try {
    const db = getDB();
    const orgData = req.validatedBody;

    const clash = await findNameClash(db, orgData.name);
    if (clash) return res.status(409).json(nameTaken(clash.name));

    const orgDoc = {
      id: generateUUID(),
      name: orgData.name,
      name_key: orgNameKey(orgData.name),
      logo_url: orgData.logo_url || null,
      description: orgData.description || null,
      created_at: toISOString(new Date()),
      created_by: req.user.email
    };

    try {
      await db.collection('organizations').insertOne(orgDoc);
    } catch (error) {
      // Unique name_key index: a concurrent create with the same name
      if (error.code === 11000) return res.status(409).json(nameTaken(orgData.name));
      throw error;
    }

    delete orgDoc._id;

    // Convert date for response
    orgDoc.created_at = new Date(orgDoc.created_at);

    res.status(201).json(orgDoc);
  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/organizations
 * Get all organizations
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const orgs = await db.collection('organizations')
      .find({}, { projection: { _id: 0 } })
      .toArray();

    // Normalize dates
    for (const org of orgs) {
      if (typeof org.created_at === 'string') {
        org.created_at = new Date(org.created_at);
      }
    }

    res.json(orgs);
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/organizations/:orgId
 * Update organization (admin only)
 */
router.put('/:orgId', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.organizationUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { orgId } = req.params;
    const orgData = req.validatedBody;

    // Check if organization exists
    const org = await db.collection('organizations').findOne(
      { id: orgId },
      { projection: { _id: 0 } }
    );

    if (!org) {
      return res.status(404).json({ detail: 'Organization not found' });
    }

    // Build update
    const updateDict = {};
    if (orgData.name !== undefined) {
      // Only a real rename is checked, so a legacy duplicate can still be edited
      if (orgNameKey(orgData.name) !== orgNameKey(org.name)) {
        const clash = await findNameClash(db, orgData.name, orgId);
        if (clash) return res.status(409).json(nameTaken(clash.name));
        updateDict.name_key = orgNameKey(orgData.name);
      }
      updateDict.name = orgData.name;
    }
    if (orgData.logo_url !== undefined) updateDict.logo_url = orgData.logo_url;
    if (orgData.description !== undefined) updateDict.description = orgData.description;

    if (Object.keys(updateDict).length > 0) {
      try {
        await db.collection('organizations').updateOne(
          { id: orgId },
          { $set: updateDict }
        );
      } catch (error) {
        if (error.code === 11000) return res.status(409).json(nameTaken(orgData.name));
        throw error;
      }

      // Update organization_name in all employees
      if (updateDict.name) {
        await db.collection('employees').updateMany(
          { organization_id: orgId },
          { $set: { organization_name: updateDict.name } }
        );
      }
    }

    // Get updated organization
    const updatedOrg = await db.collection('organizations').findOne(
      { id: orgId },
      { projection: { _id: 0 } }
    );

    // Normalize date
    if (typeof updatedOrg.created_at === 'string') {
      updatedOrg.created_at = new Date(updatedOrg.created_at);
    }

    res.json(updatedOrg);
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/organizations/:orgId
 * Delete organization (admin only)
 */
router.delete('/:orgId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { orgId } = req.params;

    // Check if there are employees in this organization
    const employeeCount = await db.collection('employees').countDocuments({ organization_id: orgId });

    if (employeeCount > 0) {
      return res.status(400).json({
        detail: `Cannot delete organization with ${employeeCount} employees. Please reassign or remove employees first.`
      });
    }

    const result = await db.collection('organizations').deleteOne({ id: orgId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ detail: 'Organization not found' });
    }

    res.json({ status: 'success', message: 'Organization deleted' });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
