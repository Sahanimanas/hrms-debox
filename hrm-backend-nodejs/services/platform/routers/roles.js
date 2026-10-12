/**
 * PL-5 Custom roles and permissions.
 *
 *   GET    /permissions            catalog + the caller's effective permissions
 *   GET    /roles                  admin: custom roles with member counts
 *   POST   /roles                  admin: { name, description, base_role, permissions[] }
 *   PUT    /roles/:id              admin
 *   DELETE /roles/:id              admin (refused while users hold the role)
 *   PUT    /roles-assign           admin: { user_id, role_id | null, role? }
 *
 * Assigning a custom role sets users.role (and employees.role) to its
 * base_role, so every existing requireRole([...]) check keeps working.
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { generateUUID } = require('../../../utils/helpers');
const { handle, escapeRegex } = require('../common');
const { PERMISSIONS, PERMISSION_KEYS, BASE_ROLES, ROLE_DEFAULTS, getEffectivePermissions } = require('../permissions');
const { recordAuthEvent } = require('../audit');

const router = express.Router();

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  indexesReady = true;
  await db.collection('custom_roles').createIndex({ id: 1 }, { unique: true }).catch(() => { indexesReady = false; });
};

const roleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(60).required(),
  description: Joi.string().trim().max(300).allow('', null).default(null),
  base_role: Joi.string().valid(...BASE_ROLES).required(),
  permissions: Joi.array().items(Joi.string().valid(...PERMISSION_KEYS)).unique().max(PERMISSION_KEYS.length).default([])
});
const roleUpdateSchema = roleSchema.fork(['name', 'base_role'], s => s.optional()).keys({
  permissions: Joi.array().items(Joi.string().valid(...PERMISSION_KEYS)).unique().max(PERMISSION_KEYS.length),
  description: Joi.string().trim().max(300).allow('', null)
}).min(1);
const assignSchema = Joi.object({
  user_id: Joi.string().trim().max(100).required(),
  role_id: Joi.string().trim().max(100).allow(null).required(),
  role: Joi.string().valid(...BASE_ROLES)
});

router.get('/permissions', handle('permission catalog', async (req, res) => {
  res.json({
    permissions: PERMISSIONS,
    role_defaults: ROLE_DEFAULTS,
    mine: await getEffectivePermissions(req.user)
  });
}));

router.get('/roles', requireRole(['admin']), handle('list roles', async (req, res) => {
  const db = getDB();
  await ensureIndexes(db);
  const roles = await db.collection('custom_roles').find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  const counts = await db.collection('users').aggregate([
    { $match: { custom_role_id: { $ne: null } } },
    { $group: { _id: '$custom_role_id', n: { $sum: 1 } } }
  ]).toArray();
  const byId = new Map(counts.map(c => [c._id, c.n]));
  res.json(roles.map(r => ({ ...r, member_count: byId.get(r.id) || 0 })));
}));

const nameTaken = (db, name, exceptId) => db.collection('custom_roles').findOne({
  name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  ...(exceptId ? { id: { $ne: exceptId } } : {})
});

router.post('/roles', requireRole(['admin']), validate(roleSchema), handle('create role', async (req, res) => {
  const db = getDB();
  await ensureIndexes(db);
  const body = req.validatedBody;
  if (await nameTaken(db, body.name)) return res.status(409).json({ detail: 'A role with this name already exists' });
  const now = new Date();
  const role = { id: generateUUID(), ...body, created_by: req.user.email, created_at: now, updated_at: now };
  await db.collection('custom_roles').insertOne(role);
  delete role._id;
  res.status(201).json({ ...role, member_count: 0 });
}));

router.put('/roles/:id', requireRole(['admin']), validate(roleUpdateSchema), handle('update role', async (req, res) => {
  const db = getDB();
  const role = await db.collection('custom_roles').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!role) return res.status(404).json({ detail: 'Role not found' });
  const body = req.validatedBody;
  if (body.name && await nameTaken(db, body.name, role.id)) return res.status(409).json({ detail: 'A role with this name already exists' });
  const updated = { ...role, ...body, updated_at: new Date() };
  await db.collection('custom_roles').updateOne({ id: role.id }, { $set: { ...body, updated_at: updated.updated_at } });

  // Base role changed: move every member to the new built-in role (never the acting admin)
  let moved = 0;
  if (body.base_role && body.base_role !== role.base_role) {
    const members = await db.collection('users').find({ custom_role_id: role.id, email: { $ne: req.user.email } }, { projection: { email: 1 } }).toArray();
    const emails = members.map(m => m.email);
    if (emails.length) {
      await db.collection('users').updateMany({ email: { $in: emails } }, { $set: { role: body.base_role } });
      await db.collection('employees').updateMany({ email: { $in: emails } }, { $set: { role: body.base_role } });
    }
    moved = emails.length;
  }
  const memberCount = await db.collection('users').countDocuments({ custom_role_id: role.id });
  res.json({ ...updated, member_count: memberCount, members_moved: moved });
}));

router.delete('/roles/:id', requireRole(['admin']), handle('delete role', async (req, res) => {
  const db = getDB();
  const role = await db.collection('custom_roles').findOne({ id: req.params.id });
  if (!role) return res.status(404).json({ detail: 'Role not found' });
  const members = await db.collection('users').countDocuments({ custom_role_id: role.id });
  if (members) return res.status(409).json({ detail: `This role is assigned to ${members} user(s). Reassign them first.`, member_count: members });
  await db.collection('custom_roles').deleteOne({ id: role.id });
  res.json({ deleted: true });
}));

router.put('/roles-assign', requireRole(['admin']), validate(assignSchema), handle('assign role', async (req, res) => {
  const db = getDB();
  const { user_id, role_id, role: builtIn } = req.validatedBody;
  const user = await db.collection('users').findOne({ $or: [{ id: user_id }, { employee_id: user_id }] }, { projection: { _id: 0, id: 1, email: 1, role: 1, custom_role_id: 1 } });
  if (!user) return res.status(404).json({ detail: 'User not found' });
  if (user.email === req.user.email) return res.status(400).json({ detail: "You can't change your own role" });

  let newRole = user.role;
  let customRole = null;
  if (role_id) {
    customRole = await db.collection('custom_roles').findOne({ id: role_id }, { projection: { _id: 0 } });
    if (!customRole) return res.status(404).json({ detail: 'Role not found' });
    newRole = customRole.base_role;
  } else if (builtIn) {
    newRole = builtIn;
  }

  const set = { role: newRole, custom_role_id: customRole ? customRole.id : null, role_updated_at: new Date() };
  await db.collection('users').updateOne({ email: user.email }, { $set: set });
  await db.collection('employees').updateOne({ email: user.email }, { $set: { role: newRole } });
  recordAuthEvent(req, 'security.role.assigned', {
    email: user.email,
    role: newRole,
    details: { by: req.user.email, from_role: user.role, custom_role: customRole?.name || null }
  });
  res.json({
    user_id: user.id,
    email: user.email,
    role: newRole,
    custom_role_id: set.custom_role_id,
    custom_role_name: customRole?.name || null,
    permissions: await getEffectivePermissions({ role: newRole, custom_role_id: set.custom_role_id })
  });
}));

module.exports = router;
