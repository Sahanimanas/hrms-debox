/**
 * Biometric / RFID attendance devices (TA-9).
 *
 * Admins register devices and get an API key (shown once). Devices — or the
 * vendor sync software next to them (eSSL, ZKTeco, Matrix, …) — push raw
 * punches to POST /api/time/devices/punches with the X-Device-Key header.
 * Punches are de-duplicated, mapped to employees via their device user ID and
 * folded into the daily attendance log as "first in, last out".
 *
 * Mounted at /api/time/devices, before the /api/time router, because the
 * punch endpoint authenticates with a device key instead of a user token.
 */

const express = require('express');
const crypto = require('crypto');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { generateUUID, employeeUid } = require('../utils/helpers');
const { stripId, getShiftForEmployee, attributionDate, applyPunches } = require('../services/time/core');

const MAX_PUNCHES_PER_REQUEST = 1000;
const MAX_PUNCH_AGE_DAYS = 45;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const schemas = {
  device: Joi.object({
    name: Joi.string().trim().max(80).required(),
    location: Joi.string().trim().max(120).allow('', null),
    type: Joi.string().valid('biometric', 'rfid', 'face', 'other').default('biometric')
  }),
  deviceUpdate: Joi.object({
    name: Joi.string().trim().max(80),
    location: Joi.string().trim().max(120).allow('', null),
    type: Joi.string().valid('biometric', 'rfid', 'face', 'other'),
    is_active: Joi.boolean()
  }).min(1),
  userMap: Joi.object({
    mappings: Joi.array().items(Joi.object({
      employee_id: Joi.string().required(),
      device_user_id: Joi.string().trim().max(40).allow('', null).required()
    })).min(1).max(2000).required()
  }),
  punches: Joi.object({
    punches: Joi.array().items(Joi.object({
      device_user_id: Joi.alternatives(Joi.string().trim().max(40), Joi.number()).required(),
      timestamp: Joi.date().iso().required()
    }).unknown(true)).min(1).max(MAX_PUNCHES_PER_REQUEST).required()
  })
};

const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');
const newKey = () => `xdev_${crypto.randomBytes(24).toString('hex')}`;

const publicDevice = (d) => {
  const { key_hash: _omit, _id, ...rest } = d;
  return rest;
};

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('attendance_devices').createIndex({ id: 1 }, { unique: true }),
    db.collection('attendance_devices').createIndex({ key_hash: 1 }, { unique: true }),
    db.collection('device_punches').createIndex({ device_id: 1, device_user_id: 1, timestamp: 1 }, { unique: true }),
    db.collection('device_punches').createIndex({ employee_uid: 1, attributed_date: 1 })
  ]);
  indexesReady = true;
};

const withIndexes = async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Device index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

// ============= PUNCH INGEST (device key) =============

/**
 * POST /api/time/devices/punches
 * Header: X-Device-Key
 * Body: { punches: [{ device_user_id, timestamp (ISO 8601 with offset) }] }
 */
router.post('/punches', withIndexes, async (req, res) => {
  try {
    const db = getDB();
    const key = req.get('X-Device-Key');
    if (!key) return res.status(401).json({ detail: 'Missing X-Device-Key header' });
    const device = await db.collection('attendance_devices').findOne({ key_hash: hashKey(key) });
    if (!device) return res.status(401).json({ detail: 'Invalid device key' });
    if (device.is_active === false) return res.status(403).json({ detail: 'Device is disabled' });

    const { error, value } = schemas.punches.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(422).json({
        detail: 'Validation failed',
        errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
      });
    }

    const now = Date.now();
    const rejected = [];
    const valid = [];
    value.punches.forEach((p, index) => {
      const ts = new Date(p.timestamp);
      if (ts.getTime() > now + MAX_FUTURE_SKEW_MS) rejected.push({ index, reason: 'timestamp is in the future' });
      else if (ts.getTime() < now - MAX_PUNCH_AGE_DAYS * 86400000) rejected.push({ index, reason: `older than ${MAX_PUNCH_AGE_DAYS} days` });
      else valid.push({ device_user_id: String(p.device_user_id), timestamp: ts });
    });

    // Map device user IDs to employees
    const userIds = [...new Set(valid.map(p => p.device_user_id))];
    const employees = await db.collection('employees').find({ device_user_id: { $in: userIds } }).toArray();
    const byDeviceUser = Object.fromEntries(employees.map(e => [e.device_user_id, e]));
    const unknown = userIds.filter(id => !byDeviceUser[id]);

    // Store raw punches (dedupe on device + user + timestamp) and group new ones per employee/day
    let accepted = 0;
    let duplicates = 0;
    const groups = new Map();
    const shiftCache = new Map();
    for (const p of valid) {
      const employee = byDeviceUser[p.device_user_id];
      let attributed = null;
      if (employee) {
        const uid = employeeUid(employee);
        if (!shiftCache.has(uid)) shiftCache.set(uid, await getShiftForEmployee(db, employee));
        attributed = attributionDate(shiftCache.get(uid), p.timestamp);
      }
      try {
        await db.collection('device_punches').insertOne({
          id: generateUUID(),
          device_id: device.id,
          device_user_id: p.device_user_id,
          employee_uid: employee ? employeeUid(employee) : null,
          timestamp: p.timestamp,
          attributed_date: attributed,
          received_at: new Date()
        });
        accepted += 1;
      } catch (insertError) {
        if (insertError.code === 11000) { duplicates += 1; continue; }
        throw insertError;
      }
      if (employee) {
        const key = `${employeeUid(employee)}|${attributed}`;
        if (!groups.has(key)) groups.set(key, { employee, date: attributed, times: [] });
        groups.get(key).times.push(p.timestamp);
      }
    }

    const days = [];
    for (const { employee, date, times } of groups.values()) {
      const result = await applyPunches(db, employee, date, times, { source: 'device', deviceId: device.id });
      days.push({ employee_id: employeeUid(employee), date, action: result.action });
    }

    await db.collection('attendance_devices').updateOne(
      { id: device.id },
      { $set: { last_seen_at: new Date() }, $inc: { punch_count: accepted } }
    );

    res.json({ accepted, duplicates, rejected, unknown_user_ids: unknown, days_updated: days });
  } catch (error) {
    console.error('Device punch ingest error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============= DEVICE MANAGEMENT (admin) =============

router.use(authenticate, requireRole(['admin']), withIndexes);

/**
 * GET /api/time/devices/user-map — employees and their device user IDs
 */
router.get('/user-map', async (req, res) => {
  try {
    const employees = await getDB().collection('employees')
      .find({}, { projection: { _id: 1, id: 1, employee_id: 1, employee_code: 1, full_name: 1, email: 1, department: 1, device_user_id: 1 } })
      .sort({ full_name: 1 })
      .toArray();
    res.json(employees.map(e => ({
      employee_id: employeeUid(e),
      full_name: e.full_name,
      email: e.email,
      department: e.department,
      device_user_id: e.device_user_id || null
    })));
  } catch (error) {
    console.error('Device user map error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/time/devices/user-map
 * Body: { mappings: [{ employee_id, device_user_id (blank to clear) }] }
 */
router.put('/user-map', validate(schemas.userMap), async (req, res) => {
  try {
    const db = getDB();
    const { mappings } = req.validatedBody;

    const ids = mappings.map(m => m.device_user_id).filter(Boolean);
    const dupInRequest = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dupInRequest) return res.status(400).json({ detail: `Device user ID ${dupInRequest} is used twice` });

    const errors = [];
    let updated = 0;
    for (const { employee_id: empId, device_user_id: deviceUserId } of mappings) {
      const filter = { $or: [{ employee_id: empId }, { employee_code: empId }, { id: empId }] };
      const employee = await db.collection('employees').findOne(filter);
      if (!employee) { errors.push({ employee_id: empId, reason: 'employee not found' }); continue; }
      if (deviceUserId) {
        const taken = await db.collection('employees').findOne({ device_user_id: deviceUserId, email: { $ne: employee.email } });
        if (taken) { errors.push({ employee_id: empId, reason: `device user ID already assigned to ${taken.full_name}` }); continue; }
      }
      await db.collection('employees').updateOne(
        { email: employee.email },
        deviceUserId ? { $set: { device_user_id: deviceUserId } } : { $unset: { device_user_id: '' } }
      );
      updated += 1;
    }
    res.status(errors.length && !updated ? 400 : 200).json({ updated, errors });
  } catch (error) {
    console.error('Update device user map error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const devices = await getDB().collection('attendance_devices').find({}).sort({ created_at: -1 }).toArray();
    res.json(devices.map(publicDevice));
  } catch (error) {
    console.error('List devices error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.post('/', validate(schemas.device), async (req, res) => {
  try {
    const key = newKey();
    const device = {
      id: generateUUID(),
      ...req.validatedBody,
      key_hash: hashKey(key),
      key_prefix: key.slice(0, 9),
      is_active: true,
      punch_count: 0,
      last_seen_at: null,
      created_by: req.user.email,
      created_at: new Date(),
      updated_at: new Date()
    };
    await getDB().collection('attendance_devices').insertOne(device);
    res.status(201).json({ ...publicDevice(device), api_key: key });
  } catch (error) {
    console.error('Create device error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.put('/:id', validate(schemas.deviceUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { matchedCount } = await db.collection('attendance_devices').updateOne(
      { id: req.params.id },
      { $set: { ...req.validatedBody, updated_at: new Date() } }
    );
    if (!matchedCount) return res.status(404).json({ detail: 'Device not found' });
    res.json(publicDevice(await db.collection('attendance_devices').findOne({ id: req.params.id })));
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.post('/:id/rotate-key', async (req, res) => {
  try {
    const key = newKey();
    const { matchedCount } = await getDB().collection('attendance_devices').updateOne(
      { id: req.params.id },
      { $set: { key_hash: hashKey(key), key_prefix: key.slice(0, 9), updated_at: new Date() } }
    );
    if (!matchedCount) return res.status(404).json({ detail: 'Device not found' });
    res.json({ api_key: key });
  } catch (error) {
    console.error('Rotate device key error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { deletedCount } = await getDB().collection('attendance_devices').deleteOne({ id: req.params.id });
    if (!deletedCount) return res.status(404).json({ detail: 'Device not found' });
    res.json({ message: 'Device removed' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/time/devices/:id/punches?limit= — most recent raw punches from a device
 */
router.get('/:id/punches', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const punches = await getDB().collection('device_punches')
      .find({ device_id: req.params.id }, { projection: { _id: 0 } })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    res.json(punches.map(stripId));
  } catch (error) {
    console.error('Device punches error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
