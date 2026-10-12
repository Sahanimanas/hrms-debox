/**
 * assets module — mounted at /api/v2/assets
 *
 * AS-1 Asset management: asset register, categories, assignment / return with
 * history, employee acknowledgement, asset requests, issue reports, CSV import,
 * warranty alerts (cron/jobs/assets.js) and offboarding lookups.
 *
 * AS-2 Expense policy, per-diem, travel requests and receipt OCR live in
 * services/assets/expenseRoutes.js and are mounted on this router.
 *
 * Collections: assets, asset_assignments, asset_history, asset_categories,
 * asset_requests, asset_issues (+ AS-2: expense_policies, per_diem_config,
 * travel_requests; reimbursements gain policy_check / trip_id fields).
 */
const express = require('express');
const Joi = require('joi');
const router = express.Router();
const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID, employeeUid } = require('../../utils/helpers');
const { storeFile, removeFile } = require('../../services/fileStorage');
const { emitEvent } = require('../../services/events');
const {
  stripId, round2, escapeRegex, findMyEmployee, findEmployeeByRef, notify, notifyAdmins, toDateOnly, todayStr, actorOf
} = require('../../services/assets/common');
const { parseCsvObjects, toCsv } = require('../../services/assets/csv');
const { singleUpload, receiptUpload } = require('../../services/assets/uploads');
const expenseRoutes = require('../../services/assets/expenseRoutes');

router.get('/health', (req, res) => res.json({ module: 'assets', status: 'ok' }));

// ============= CONSTANTS =============

const BUILTIN_CATEGORIES = [
  { key: 'laptop', label: 'Laptop' },
  { key: 'desktop', label: 'Desktop' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'phone', label: 'Phone' },
  { key: 'tablet', label: 'Tablet' },
  { key: 'id_card', label: 'ID card' },
  { key: 'access_card', label: 'Access card' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'other', label: 'Other' }
];
const STATUSES = ['available', 'assigned', 'in_repair', 'retired', 'lost'];
const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];
const SEVERITIES = ['low', 'medium', 'high'];
const MAX_IMPORT_ROWS = 2000;

// ============= INDEXES / AUTH =============

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('assets').createIndex({ id: 1 }, { unique: true }),
    db.collection('assets').createIndex({ asset_tag_key: 1 }, { unique: true }),
    db.collection('assets').createIndex({ serial_number_key: 1 }, { unique: true, partialFilterExpression: { serial_number_key: { $type: 'string' } } }),
    db.collection('assets').createIndex({ assigned_to_uid: 1 }),
    db.collection('assets').createIndex({ assigned_to_email: 1 }),
    db.collection('assets').createIndex({ status: 1, category: 1 }),
    db.collection('assets').createIndex({ warranty_expiry: 1 }),
    db.collection('asset_assignments').createIndex({ asset_id: 1, assigned_at: -1 }),
    db.collection('asset_assignments').createIndex({ employee_email: 1, status: 1 }),
    db.collection('asset_history').createIndex({ asset_id: 1, at: -1 }),
    db.collection('asset_categories').createIndex({ key: 1 }, { unique: true }),
    db.collection('asset_requests').createIndex({ employee_email: 1, status: 1 }),
    db.collection('asset_requests').createIndex({ status: 1 }),
    db.collection('asset_issues').createIndex({ asset_id: 1 }),
    db.collection('asset_issues').createIndex({ status: 1 }),
    db.collection('expense_policies').createIndex({ id: 1 }, { unique: true }),
    db.collection('travel_requests').createIndex({ id: 1 }, { unique: true }),
    db.collection('travel_requests').createIndex({ employee_email: 1, created_at: -1 }),
    db.collection('travel_requests').createIndex({ status: 1 })
  ]);
  indexesReady = true;
};

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Assets index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

const adminOnly = requireRole(['admin']);

const handle = (label, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || '';
      const msg = field.startsWith('serial') ? 'Serial number already exists' : field.startsWith('asset_tag') ? 'Asset tag already exists' : 'Duplicate record';
      return res.status(409).json({ detail: msg });
    }
    if (error.status) return res.status(error.status).json({ detail: error.message });
    console.error(`${label} error:`, error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

// ============= HELPERS =============

const getCategories = async (db) => {
  const custom = await db.collection('asset_categories').find({}, { projection: { _id: 0 } }).sort({ label: 1 }).toArray();
  return [
    ...BUILTIN_CATEGORIES.map(c => ({ ...c, builtin: true })),
    ...custom.map(c => ({ key: c.key, label: c.label, builtin: false, id: c.id }))
  ];
};

/** Resolve a category by key or label (case-insensitive); returns the key or null. */
const resolveCategory = (categories, value) => {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  const match = categories.find(c => c.key === v || c.label.toLowerCase() === v || c.key === v.replace(/[\s-]+/g, '_'));
  return match ? match.key : null;
};

const slugify = (label) => String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

const cleanStr = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

const logHistory = (db, asset, action, req, details = {}) =>
  db.collection('asset_history').insertOne({
    id: generateUUID(),
    asset_id: asset.id,
    asset_tag: asset.asset_tag,
    action,
    details,
    actor_email: req?.user?.email || 'system',
    actor_name: req?.user?.full_name || 'System',
    at: new Date()
  });

/** Build the stored asset document from validated input. */
const assetFields = (data, categoryKey) => {
  const fields = {};
  const setIf = (key, value) => { if (value !== undefined) fields[key] = value; };
  if (data.asset_tag !== undefined) {
    fields.asset_tag = data.asset_tag.trim();
    fields.asset_tag_key = data.asset_tag.trim().toLowerCase();
  }
  setIf('name', data.name?.trim());
  if (categoryKey) fields.category = categoryKey;
  setIf('brand', data.brand === undefined ? undefined : cleanStr(data.brand));
  setIf('model', data.model === undefined ? undefined : cleanStr(data.model));
  if (data.serial_number !== undefined) {
    fields.serial_number = cleanStr(data.serial_number);
    fields.serial_number_key = fields.serial_number ? fields.serial_number.toLowerCase() : null;
  }
  setIf('purchase_date', data.purchase_date === undefined ? undefined : toDateOnly(data.purchase_date));
  setIf('cost', data.cost === undefined ? undefined : (data.cost == null ? null : round2(data.cost)));
  setIf('vendor', data.vendor === undefined ? undefined : cleanStr(data.vendor));
  setIf('warranty_expiry', data.warranty_expiry === undefined ? undefined : toDateOnly(data.warranty_expiry));
  setIf('condition', data.condition);
  setIf('location', data.location === undefined ? undefined : cleanStr(data.location));
  setIf('notes', data.notes === undefined ? undefined : (data.notes || ''));
  return fields;
};

const ensureUnique = async (db, fields, excludeId) => {
  const base = excludeId ? { id: { $ne: excludeId } } : {};
  if (fields.asset_tag_key && await db.collection('assets').findOne({ ...base, asset_tag_key: fields.asset_tag_key })) {
    throw httpError(409, 'Asset tag already exists');
  }
  if (fields.serial_number_key && await db.collection('assets').findOne({ ...base, serial_number_key: fields.serial_number_key })) {
    throw httpError(409, 'Serial number already exists');
  }
};

/** Public shape of an asset; non-admins don't see cost / vendor / invoice. */
const presentAsset = (asset, { admin }) => {
  if (!asset) return asset;
  const out = { ...asset };
  delete out._id;
  delete out.asset_tag_key;
  delete out.serial_number_key;
  delete out.invoice_key;
  if (!admin) {
    delete out.cost;
    delete out.vendor;
    delete out.invoice_url;
    delete out.invoice_name;
    delete out.notes;
    delete out.warranty_alert_for;
    delete out.warranty_alerted_at;
  }
  return out;
};

const loadAsset = async (db, id) => {
  const asset = await db.collection('assets').findOne({ id }, { projection: { _id: 0 } });
  if (!asset) throw httpError(404, 'Asset not found');
  return asset;
};

const isAssignee = (asset, user) => !!asset.assigned_to_email && asset.assigned_to_email === user.email;

/**
 * Assign an available asset to an employee. Shared by the assign endpoint and
 * request fulfilment.
 */
const assignAsset = async (db, req, asset, employee, { expected_return_date, condition, notes, request_id }) => {
  if (asset.status !== 'available') throw httpError(400, `Asset is ${asset.status.replace('_', ' ')}, not available`);
  if (employee.employment_status === 'exited') throw httpError(400, 'Cannot assign an asset to an exited employee');

  const now = new Date();
  const uid = employeeUid(employee);
  const assignment = {
    id: generateUUID(),
    asset_id: asset.id,
    asset_tag: asset.asset_tag,
    asset_name: asset.name,
    category: asset.category,
    employee_uid: uid,
    employee_email: employee.email,
    employee_name: employee.full_name,
    department: employee.department || null,
    assigned_at: now,
    assigned_by: req.user.email,
    assigned_by_name: req.user.full_name || req.user.email,
    expected_return_date: toDateOnly(expected_return_date),
    condition_at_handover: condition || asset.condition || 'good',
    handover_notes: notes || '',
    request_id: request_id || null,
    acknowledged_at: null,
    status: 'active',
    returned_at: null,
    return_condition: null,
    return_notes: null,
    returned_by: null
  };

  // Guard against a concurrent assignment
  const { modifiedCount } = await db.collection('assets').updateOne(
    { id: asset.id, status: 'available' },
    {
      $set: {
        status: 'assigned',
        assigned_to_uid: uid,
        assigned_to_email: employee.email,
        assigned_to_name: employee.full_name,
        assigned_at: now,
        expected_return_date: assignment.expected_return_date,
        current_assignment_id: assignment.id,
        acknowledged_at: null,
        condition: assignment.condition_at_handover,
        updated_at: now
      }
    }
  );
  if (!modifiedCount) throw httpError(409, 'Asset was just assigned by someone else');
  await db.collection('asset_assignments').insertOne(assignment);
  await logHistory(db, asset, 'assigned', req, {
    employee_email: employee.email,
    employee_name: employee.full_name,
    expected_return_date: assignment.expected_return_date,
    condition: assignment.condition_at_handover,
    notes: assignment.handover_notes
  });

  notify({ id: employee.id, email: employee.email }, {
    type: 'asset_assigned',
    title: 'Asset assigned to you',
    message: `${asset.name} (${asset.asset_tag}) has been assigned to you. Please acknowledge receipt.`,
    actionUrl: '/my-assets',
    metadata: { asset_id: asset.id, assignment_id: assignment.id }
  });
  emitEvent('asset.assigned', { asset_id: asset.id, asset_tag: asset.asset_tag, employee_uid: uid, employee_email: employee.email });

  return stripId(assignment);
};

// ============= CATEGORIES =============

router.get('/categories', handle('List asset categories', async (req, res) => {
  res.json(await getCategories(getDB()));
}));

const categorySchema = Joi.object({ label: Joi.string().trim().min(2).max(40).required() });

router.post('/categories', adminOnly, validate(categorySchema), handle('Create asset category', async (req, res) => {
  const db = getDB();
  const { label } = req.validatedBody;
  const key = slugify(label);
  if (!key) return res.status(422).json({ detail: 'Category name must contain letters or numbers' });
  const categories = await getCategories(db);
  if (categories.some(c => c.key === key || c.label.toLowerCase() === label.toLowerCase())) {
    return res.status(409).json({ detail: 'Category already exists' });
  }
  const doc = { id: generateUUID(), key, label, created_by: req.user.email, created_at: new Date() };
  await db.collection('asset_categories').insertOne(doc);
  res.status(201).json({ key, label, builtin: false, id: doc.id });
}));

router.delete('/categories/:key', adminOnly, handle('Delete asset category', async (req, res) => {
  const db = getDB();
  const { key } = req.params;
  if (BUILTIN_CATEGORIES.some(c => c.key === key)) return res.status(400).json({ detail: 'Built-in categories cannot be deleted' });
  const cat = await db.collection('asset_categories').findOne({ key });
  if (!cat) return res.status(404).json({ detail: 'Category not found' });
  const inUse = await db.collection('assets').countDocuments({ category: key });
  if (inUse) return res.status(400).json({ detail: `${inUse} asset(s) use this category; move them first` });
  await db.collection('asset_categories').deleteOne({ key });
  res.json({ message: 'Category deleted' });
}));

// ============= ASSET REGISTER =============

const dateField = Joi.alternatives().try(Joi.date().iso(), Joi.valid(null, ''));
const optStr = (max) => Joi.string().trim().max(max).allow('', null);

const assetBase = {
  asset_tag: Joi.string().trim().min(1).max(50).pattern(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
    .messages({ 'string.pattern.base': 'Asset tag may only contain letters, numbers and . _ / -' }),
  name: Joi.string().trim().min(1).max(150),
  category: Joi.string().trim().max(60),
  brand: optStr(80),
  model: optStr(80),
  serial_number: optStr(100),
  purchase_date: dateField,
  cost: Joi.number().min(0).max(1e10).allow(null),
  vendor: optStr(150),
  warranty_expiry: dateField,
  condition: Joi.string().valid(...CONDITIONS),
  location: optStr(150),
  notes: Joi.string().max(2000).allow('', null)
};

const assetCreateSchema = Joi.object({
  ...assetBase,
  asset_tag: assetBase.asset_tag.required(),
  name: assetBase.name.required(),
  category: assetBase.category.required(),
  condition: assetBase.condition.default('good'),
  status: Joi.string().valid('available', 'in_repair', 'retired', 'lost').default('available')
});

const assetUpdateSchema = Joi.object(assetBase).min(1);

/**
 * GET /api/v2/assets/items
 * Filters: status, category, q (tag/name/serial/brand/model/assignee), assigned_to (email or uid),
 * warranty=expiring (next 30 days) | expired
 */
router.get('/items', adminOnly, handle('List assets', async (req, res) => {
  const db = getDB();
  const { status, category, q, assigned_to, warranty } = req.query;
  const filter = {};
  if (status && STATUSES.includes(status)) filter.status = status;
  if (category) filter.category = String(category);
  if (assigned_to) filter.$or = [{ assigned_to_email: String(assigned_to) }, { assigned_to_uid: String(assigned_to) }];
  if (q && String(q).trim()) {
    const rx = { $regex: escapeRegex(String(q).trim()), $options: 'i' };
    filter.$and = [{ $or: ['asset_tag', 'name', 'serial_number', 'brand', 'model', 'assigned_to_name', 'assigned_to_email', 'location'].map(f => ({ [f]: rx })) }];
  }
  const today = toDateOnly(todayStr());
  if (warranty === 'expiring') filter.warranty_expiry = { $gte: today, $lte: new Date(today.getTime() + 30 * 86400000) };
  if (warranty === 'expired') filter.warranty_expiry = { $lt: today };

  const assets = await db.collection('assets').find(filter, { projection: { _id: 0 } }).sort({ asset_tag_key: 1 }).limit(5000).toArray();
  res.json(assets.map(a => presentAsset(a, { admin: true })));
}));

/** GET /api/v2/assets/items/import-template — CSV header + example row */
router.get('/items/import-template', adminOnly, handle('Import template', async (req, res) => {
  const csv = toCsv(
    ['asset_tag', 'name', 'category', 'brand', 'model', 'serial_number', 'purchase_date', 'cost', 'vendor', 'warranty_expiry', 'condition', 'location', 'notes', 'status'],
    [['LAP-001', 'MacBook Pro 14', 'laptop', 'Apple', 'M3 Pro', 'C02XYZ123', '2025-04-01', '185000', 'Imagine Store', '2027-03-31', 'new', 'Bengaluru HQ', '', 'available']]
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="asset-import-template.csv"');
  res.send(csv);
}));

/**
 * POST /api/v2/assets/items/import (multipart: file=<csv>, dry_run=true|false)
 * Validates every row; inserts the valid ones (unless dry_run) and reports errors per row.
 */
router.post('/items/import', adminOnly, singleUpload('file', {
  maxBytes: 2 * 1024 * 1024,
  types: ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv'],
  extensions: ['csv'],
  typeError: 'Upload a .csv file'
}), handle('Import assets', async (req, res) => {
  const db = getDB();
  if (!req.file) return res.status(400).json({ detail: 'Attach a CSV file in the "file" field' });
  const dryRun = String(req.body.dry_run || '').toLowerCase() === 'true';

  const { headers, records } = parseCsvObjects(req.file.buffer.toString('utf8'));
  const missing = ['asset_tag', 'name', 'category'].filter(h => !headers.includes(h));
  if (missing.length) return res.status(400).json({ detail: `Missing required column(s): ${missing.join(', ')}` });
  if (!records.length) return res.status(400).json({ detail: 'The file has no data rows' });
  if (records.length > MAX_IMPORT_ROWS) return res.status(400).json({ detail: `Import at most ${MAX_IMPORT_ROWS} rows at a time` });

  const categories = await getCategories(db);
  const existing = await db.collection('assets').find({}, { projection: { _id: 0, asset_tag_key: 1, serial_number_key: 1 } }).toArray();
  const tags = new Set(existing.map(a => a.asset_tag_key));
  const serials = new Set(existing.map(a => a.serial_number_key).filter(Boolean));

  const errors = [];
  const docs = [];
  const now = new Date();
  for (const rec of records) {
    const rowErrors = [];
    const input = {};
    for (const key of ['asset_tag', 'name', 'category', 'brand', 'model', 'serial_number', 'purchase_date', 'cost', 'vendor', 'warranty_expiry', 'condition', 'location', 'notes', 'status']) {
      if (rec[key] !== undefined && rec[key] !== '') input[key] = rec[key];
    }
    if (input.condition) input.condition = input.condition.toLowerCase();
    if (input.status) input.status = input.status.toLowerCase().replace(/\s+/g, '_');
    if (input.cost !== undefined) input.cost = String(input.cost).replace(/[,₹\s]/g, '');

    const { error, value } = assetCreateSchema.validate(input, { abortEarly: false, convert: true });
    if (error) error.details.forEach(d => rowErrors.push(d.message.replace(/"/g, '')));
    const categoryKey = resolveCategory(categories, input.category);
    if (input.category && !categoryKey) rowErrors.push(`Unknown category "${input.category}"`);

    const tagKey = input.asset_tag ? String(input.asset_tag).trim().toLowerCase() : null;
    const serialKey = input.serial_number ? String(input.serial_number).trim().toLowerCase() : null;
    if (tagKey && tags.has(tagKey)) rowErrors.push(`Asset tag "${input.asset_tag}" already exists`);
    if (serialKey && serials.has(serialKey)) rowErrors.push(`Serial number "${input.serial_number}" already exists`);

    if (rowErrors.length) {
      errors.push({ row: rec.__row, asset_tag: input.asset_tag || null, errors: rowErrors });
      continue;
    }
    tags.add(tagKey);
    if (serialKey) serials.add(serialKey);
    docs.push({
      id: generateUUID(),
      ...assetFields(value, categoryKey),
      serial_number: cleanStr(value.serial_number),
      serial_number_key: serialKey,
      status: value.status,
      assigned_to_uid: null,
      assigned_to_email: null,
      assigned_to_name: null,
      current_assignment_id: null,
      invoice_url: null,
      invoice_key: null,
      created_by: req.user.email,
      created_at: now,
      updated_at: now,
      source: 'import'
    });
  }

  if (!dryRun && docs.length) {
    await db.collection('assets').insertMany(docs);
    await db.collection('asset_history').insertMany(docs.map(d => ({
      id: generateUUID(), asset_id: d.id, asset_tag: d.asset_tag, action: 'created', details: { source: 'csv_import' },
      actor_email: req.user.email, actor_name: req.user.full_name || req.user.email, at: now
    })));
  }

  res.json({
    dry_run: dryRun,
    total: records.length,
    valid: docs.length,
    created: dryRun ? 0 : docs.length,
    failed: errors.length,
    errors
  });
}));

router.post('/items', adminOnly, validate(assetCreateSchema), handle('Create asset', async (req, res) => {
  const db = getDB();
  const data = req.validatedBody;
  const categoryKey = resolveCategory(await getCategories(db), data.category);
  if (!categoryKey) return res.status(422).json({ detail: `Unknown category "${data.category}"` });

  const fields = assetFields(data, categoryKey);
  await ensureUnique(db, fields);
  const now = new Date();
  const asset = {
    id: generateUUID(),
    brand: null, model: null, serial_number: null, serial_number_key: null, purchase_date: null, cost: null,
    vendor: null, warranty_expiry: null, location: null, notes: '',
    ...fields,
    status: data.status,
    assigned_to_uid: null,
    assigned_to_email: null,
    assigned_to_name: null,
    current_assignment_id: null,
    invoice_url: null,
    invoice_key: null,
    created_by: req.user.email,
    created_at: now,
    updated_at: now
  };
  await db.collection('assets').insertOne(asset);
  await logHistory(db, asset, 'created', req, { status: asset.status });
  res.status(201).json(presentAsset(asset, { admin: true }));
}));

/**
 * GET /api/v2/assets/items/:id — admin, or the employee it is assigned to.
 * Includes assignment history, event log and issues.
 */
router.get('/items/:id', handle('Get asset', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  const admin = req.user.role === 'admin';
  if (!admin && !isAssignee(asset, req.user)) return res.status(403).json({ detail: 'Not authorized to view this asset' });

  const assignmentFilter = admin ? { asset_id: asset.id } : { asset_id: asset.id, employee_email: req.user.email };
  const [assignments, history, issues] = await Promise.all([
    db.collection('asset_assignments').find(assignmentFilter, { projection: { _id: 0 } }).sort({ assigned_at: -1 }).toArray(),
    admin ? db.collection('asset_history').find({ asset_id: asset.id }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(200).toArray() : [],
    db.collection('asset_issues').find(admin ? { asset_id: asset.id } : { asset_id: asset.id, reported_by_email: req.user.email }, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray()
  ]);
  res.json({ ...presentAsset(asset, { admin }), assignments, history, issues });
}));

router.put('/items/:id', adminOnly, validate(assetUpdateSchema), handle('Update asset', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  const data = req.validatedBody;
  let categoryKey;
  if (data.category !== undefined) {
    categoryKey = resolveCategory(await getCategories(db), data.category);
    if (!categoryKey) return res.status(422).json({ detail: `Unknown category "${data.category}"` });
  }
  const fields = assetFields(data, categoryKey);
  await ensureUnique(db, fields, asset.id);
  if (fields.warranty_expiry !== undefined) fields.warranty_alert_for = null;

  await db.collection('assets').updateOne({ id: asset.id }, { $set: { ...fields, updated_at: new Date() } });
  const changed = Object.keys(fields).filter(k => !k.endsWith('_key') && k !== 'warranty_alert_for' && String(fields[k]) !== String(asset[k]));
  if (changed.length) await logHistory(db, asset, 'updated', req, { fields: changed });
  const updated = await loadAsset(db, asset.id);
  res.json(presentAsset(updated, { admin: true }));
}));

router.delete('/items/:id', adminOnly, handle('Delete asset', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  if (asset.assigned_to_email) return res.status(400).json({ detail: 'Return the asset before deleting it' });
  const assignments = await db.collection('asset_assignments').countDocuments({ asset_id: asset.id });
  if (assignments) return res.status(400).json({ detail: 'This asset has assignment history; mark it retired instead of deleting' });
  await db.collection('assets').deleteOne({ id: asset.id });
  await db.collection('asset_history').deleteMany({ asset_id: asset.id });
  await db.collection('asset_issues').deleteMany({ asset_id: asset.id });
  if (asset.invoice_key) removeFile(asset.invoice_key);
  res.json({ message: 'Asset deleted' });
}));

/** POST /api/v2/assets/items/:id/invoice (multipart: invoice) — image or PDF ≤ 10 MB */
router.post('/items/:id/invoice', adminOnly, receiptUpload('invoice'), handle('Upload invoice', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  if (!req.file) return res.status(400).json({ detail: 'Attach the invoice in the "invoice" field' });
  const stored = await storeFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'asset_invoices', asset.id);
  if (asset.invoice_key) removeFile(asset.invoice_key);
  await db.collection('assets').updateOne({ id: asset.id }, {
    $set: { invoice_url: stored.url, invoice_key: stored.key, invoice_name: req.file.originalname, updated_at: new Date() }
  });
  await logHistory(db, asset, 'invoice_uploaded', req, { file: req.file.originalname });
  res.json({ invoice_url: stored.url, invoice_name: req.file.originalname });
}));

router.delete('/items/:id/invoice', adminOnly, handle('Remove invoice', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  if (!asset.invoice_key && !asset.invoice_url) return res.status(404).json({ detail: 'No invoice attached' });
  removeFile(asset.invoice_key);
  await db.collection('assets').updateOne({ id: asset.id }, { $set: { invoice_url: null, invoice_key: null, invoice_name: null, updated_at: new Date() } });
  await logHistory(db, asset, 'invoice_removed', req);
  res.json({ message: 'Invoice removed' });
}));

// ============= ASSIGN / RETURN / STATUS =============

const assignSchema = Joi.object({
  employee: Joi.string().trim().max(200).required(),
  expected_return_date: dateField,
  condition: Joi.string().valid(...CONDITIONS),
  notes: Joi.string().max(1000).allow('', null)
});

router.post('/items/:id/assign', adminOnly, validate(assignSchema), handle('Assign asset', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  const { employee: ref, expected_return_date, condition, notes } = req.validatedBody;
  const employee = await findEmployeeByRef(db, ref);
  if (!employee) return res.status(404).json({ detail: 'Employee not found' });
  if (expected_return_date && toDateOnly(expected_return_date) < toDateOnly(todayStr())) {
    return res.status(422).json({ detail: 'Expected return date cannot be in the past' });
  }
  const assignment = await assignAsset(db, req, asset, employee, { expected_return_date, condition, notes });
  const updated = await loadAsset(db, asset.id);
  res.status(201).json({ asset: presentAsset(updated, { admin: true }), assignment });
}));

const returnSchema = Joi.object({
  condition: Joi.string().valid(...CONDITIONS).required(),
  notes: Joi.string().max(1000).allow('', null)
});

router.post('/items/:id/return', adminOnly, validate(returnSchema), handle('Return asset', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  if (!asset.assigned_to_email || !asset.current_assignment_id) return res.status(400).json({ detail: 'Asset is not assigned to anyone' });
  const { condition, notes } = req.validatedBody;
  const now = new Date();

  await db.collection('asset_assignments').updateOne(
    { id: asset.current_assignment_id },
    { $set: { status: 'returned', returned_at: now, return_condition: condition, return_notes: notes || '', returned_by: req.user.email } }
  );
  const nextStatus = asset.status === 'in_repair' ? 'in_repair' : 'available';
  await db.collection('assets').updateOne({ id: asset.id }, {
    $set: {
      status: nextStatus, condition, assigned_to_uid: null, assigned_to_email: null, assigned_to_name: null,
      assigned_at: null, expected_return_date: null, current_assignment_id: null, acknowledged_at: null, updated_at: now
    }
  });
  await logHistory(db, asset, 'returned', req, { employee_email: asset.assigned_to_email, employee_name: asset.assigned_to_name, condition, notes: notes || '' });
  notify({ email: asset.assigned_to_email }, {
    type: 'asset_returned',
    title: 'Asset return recorded',
    message: `Return of ${asset.name} (${asset.asset_tag}) has been recorded.`,
    actionUrl: '/my-assets',
    metadata: { asset_id: asset.id }
  });
  emitEvent('asset.returned', { asset_id: asset.id, asset_tag: asset.asset_tag, employee_uid: asset.assigned_to_uid, employee_email: asset.assigned_to_email, condition });

  res.json(presentAsset(await loadAsset(db, asset.id), { admin: true }));
}));

const statusSchema = Joi.object({
  status: Joi.string().valid('available', 'in_repair', 'retired', 'lost').required(),
  notes: Joi.string().max(1000).allow('', null)
});

/**
 * POST /api/v2/assets/items/:id/status
 *   in_repair — from available or assigned (an assigned asset stays with its assignee)
 *   available — back in service: an asset still assigned returns to 'assigned'
 *   retired   — only when not assigned
 *   lost      — closes any open assignment
 */
router.post('/items/:id/status', adminOnly, validate(statusSchema), handle('Change asset status', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  const { status, notes } = req.validatedBody;
  const now = new Date();
  const set = { updated_at: now };
  const assigned = !!asset.current_assignment_id;

  if (status === 'in_repair') {
    if (!['available', 'assigned'].includes(asset.status)) return res.status(400).json({ detail: `Cannot send a ${asset.status.replace('_', ' ')} asset to repair` });
    set.status = 'in_repair';
  } else if (status === 'available') {
    if (asset.status === 'assigned' || asset.status === 'available') return res.status(400).json({ detail: `Asset is already ${asset.status}` });
    set.status = assigned ? 'assigned' : 'available';
  } else if (status === 'retired') {
    if (assigned) return res.status(400).json({ detail: 'Return the asset before retiring it' });
    if (asset.status === 'retired') return res.status(400).json({ detail: 'Asset is already retired' });
    set.status = 'retired';
  } else if (status === 'lost') {
    if (asset.status === 'lost') return res.status(400).json({ detail: 'Asset is already marked lost' });
    set.status = 'lost';
    if (assigned) {
      await db.collection('asset_assignments').updateOne(
        { id: asset.current_assignment_id },
        { $set: { status: 'lost', returned_at: now, return_condition: null, return_notes: notes || 'Reported lost', returned_by: req.user.email } }
      );
      Object.assign(set, { assigned_to_uid: null, assigned_to_email: null, assigned_to_name: null, assigned_at: null, expected_return_date: null, current_assignment_id: null, acknowledged_at: null });
    }
  }

  await db.collection('assets').updateOne({ id: asset.id }, { $set: set });
  await logHistory(db, asset, 'status_changed', req, { from: asset.status, to: set.status, notes: notes || '' });
  if (asset.assigned_to_email && ['in_repair', 'lost'].includes(set.status)) {
    notify({ email: asset.assigned_to_email }, {
      type: 'asset_status_changed',
      title: set.status === 'in_repair' ? 'Asset sent for repair' : 'Asset marked lost',
      message: `${asset.name} (${asset.asset_tag}) is now ${set.status.replace('_', ' ')}.`,
      actionUrl: '/my-assets',
      metadata: { asset_id: asset.id }
    });
  }
  res.json(presentAsset(await loadAsset(db, asset.id), { admin: true }));
}));

/** POST /api/v2/assets/items/:id/acknowledge — the assignee confirms receipt */
router.post('/items/:id/acknowledge', handle('Acknowledge asset', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  if (!isAssignee(asset, req.user)) return res.status(403).json({ detail: 'This asset is not assigned to you' });
  if (asset.acknowledged_at) return res.status(400).json({ detail: 'You have already acknowledged this asset' });
  const now = new Date();
  await db.collection('assets').updateOne({ id: asset.id }, { $set: { acknowledged_at: now, updated_at: now } });
  await db.collection('asset_assignments').updateOne({ id: asset.current_assignment_id }, { $set: { acknowledged_at: now } });
  await logHistory(db, asset, 'acknowledged', req);
  res.json({ message: 'Receipt acknowledged', acknowledged_at: now });
}));

// ============= MY ASSETS / OFFBOARDING =============

router.get('/my-assets', handle('My assets', async (req, res) => {
  const db = getDB();
  const [assets, past] = await Promise.all([
    db.collection('assets').find({ assigned_to_email: req.user.email }, { projection: { _id: 0 } }).sort({ assigned_at: -1 }).toArray(),
    db.collection('asset_assignments').find({ employee_email: req.user.email, status: { $ne: 'active' } }, { projection: { _id: 0 } }).sort({ assigned_at: -1 }).limit(100).toArray()
  ]);
  const active = await db.collection('asset_assignments').find({ id: { $in: assets.map(a => a.current_assignment_id).filter(Boolean) } }, { projection: { _id: 0 } }).toArray();
  const byId = Object.fromEntries(active.map(a => [a.id, a]));
  res.json({
    assets: assets.map(a => ({ ...presentAsset(a, { admin: false }), assignment: byId[a.current_assignment_id] || null })),
    past_assignments: past
  });
}));

/**
 * GET /api/v2/assets/employees/:ref/assets — assets currently with an employee
 * (ref = employee code, uuid or email). Used by offboarding (admin).
 */
router.get('/employees/:ref/assets', adminOnly, handle('Employee assets', async (req, res) => {
  const db = getDB();
  const employee = await findEmployeeByRef(db, req.params.ref);
  if (!employee) return res.status(404).json({ detail: 'Employee not found' });
  const uid = employeeUid(employee);
  const assets = await db.collection('assets').find(
    { $or: [{ assigned_to_uid: uid }, { assigned_to_email: employee.email }] },
    { projection: { _id: 0 } }
  ).sort({ asset_tag_key: 1 }).toArray();
  res.json({
    employee: { employee_uid: uid, email: employee.email, full_name: employee.full_name, department: employee.department || null },
    count: assets.length,
    pending_return: assets.length > 0,
    assets: assets.map(a => presentAsset(a, { admin: true }))
  });
}));

// ============= ISSUES =============

const issueSchema = Joi.object({
  description: Joi.string().trim().min(5).max(2000).required(),
  severity: Joi.string().valid(...SEVERITIES).default('medium')
});

router.post('/items/:id/issues', validate(issueSchema), handle('Report asset issue', async (req, res) => {
  const db = getDB();
  const asset = await loadAsset(db, req.params.id);
  if (req.user.role !== 'admin' && !isAssignee(asset, req.user)) return res.status(403).json({ detail: 'You can only report issues on assets assigned to you' });
  const open = await db.collection('asset_issues').findOne({ asset_id: asset.id, status: { $in: ['open', 'in_repair'] }, reported_by_email: req.user.email });
  if (open) return res.status(400).json({ detail: 'You already have an open issue on this asset' });
  const now = new Date();
  const issue = {
    id: generateUUID(),
    asset_id: asset.id,
    asset_tag: asset.asset_tag,
    asset_name: asset.name,
    reported_by_email: req.user.email,
    reported_by_name: req.user.full_name || req.user.email,
    ...req.validatedBody,
    status: 'open',
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: now,
    updated_at: now
  };
  await db.collection('asset_issues').insertOne(issue);
  await logHistory(db, asset, 'issue_reported', req, { issue_id: issue.id, severity: issue.severity, description: issue.description });
  notifyAdmins(db, {
    type: 'asset_issue_reported',
    title: 'Asset issue reported',
    message: `${issue.reported_by_name} reported a ${issue.severity} issue with ${asset.name} (${asset.asset_tag})`,
    actionUrl: '/asset-requests?tab=issues',
    metadata: { asset_id: asset.id, issue_id: issue.id }
  }, req.user.email);
  res.status(201).json(stripId(issue));
}));

router.get('/issues', handle('List asset issues', async (req, res) => {
  const db = getDB();
  const filter = req.user.role === 'admin' ? {} : { reported_by_email: req.user.email };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.asset_id) filter.asset_id = String(req.query.asset_id);
  const issues = await db.collection('asset_issues').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(2000).toArray();
  res.json(issues);
}));

const issueUpdateSchema = Joi.object({
  status: Joi.string().valid('in_repair', 'resolved', 'closed').required(),
  notes: Joi.string().max(1000).allow('', null)
});

/**
 * PUT /api/v2/assets/issues/:id — admin: in_repair (asset → in_repair),
 * resolved (asset back in service), closed (no action needed).
 */
router.put('/issues/:id', adminOnly, validate(issueUpdateSchema), handle('Update asset issue', async (req, res) => {
  const db = getDB();
  const issue = await db.collection('asset_issues').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!issue) return res.status(404).json({ detail: 'Issue not found' });
  if (['resolved', 'closed'].includes(issue.status)) return res.status(400).json({ detail: `Issue is already ${issue.status}` });
  const { status, notes } = req.validatedBody;
  if (status === issue.status) return res.status(400).json({ detail: `Issue is already ${status.replace('_', ' ')}` });
  const asset = await loadAsset(db, issue.asset_id);
  const now = new Date();

  if (status === 'in_repair' && ['available', 'assigned'].includes(asset.status)) {
    await db.collection('assets').updateOne({ id: asset.id }, { $set: { status: 'in_repair', updated_at: now } });
    await logHistory(db, asset, 'status_changed', req, { from: asset.status, to: 'in_repair', issue_id: issue.id, notes: notes || '' });
  }
  if (status === 'resolved' && asset.status === 'in_repair') {
    const back = asset.current_assignment_id ? 'assigned' : 'available';
    await db.collection('assets').updateOne({ id: asset.id }, { $set: { status: back, updated_at: now } });
    await logHistory(db, asset, 'status_changed', req, { from: 'in_repair', to: back, issue_id: issue.id, notes: notes || '' });
  }

  const update = { status, updated_at: now, resolution_notes: notes || issue.resolution_notes || null };
  if (status !== 'in_repair') Object.assign(update, { resolved_at: now, resolved_by: req.user.email });
  await db.collection('asset_issues').updateOne({ id: issue.id }, { $set: update });

  notify({ email: issue.reported_by_email }, {
    type: 'asset_issue_updated',
    title: 'Asset issue updated',
    message: `Your issue on ${issue.asset_name} (${issue.asset_tag}) is now ${status.replace('_', ' ')}${notes ? `: ${notes}` : ''}`,
    actionUrl: '/my-assets',
    metadata: { issue_id: issue.id, asset_id: asset.id }
  });
  res.json(await db.collection('asset_issues').findOne({ id: issue.id }, { projection: { _id: 0 } }));
}));

// ============= ASSET REQUESTS =============

const requestSchema = Joi.object({
  category: Joi.string().trim().max(60).required(),
  justification: Joi.string().trim().min(10).max(2000).required(),
  needed_by: dateField
});

router.post('/requests', validate(requestSchema), handle('Create asset request', async (req, res) => {
  const db = getDB();
  const employee = await findMyEmployee(db, req.user.email);
  if (!employee) return res.status(400).json({ detail: 'No employee profile is linked to your account' });
  const { category, justification, needed_by } = req.validatedBody;
  const categoryKey = resolveCategory(await getCategories(db), category);
  if (!categoryKey) return res.status(422).json({ detail: `Unknown category "${category}"` });
  const dup = await db.collection('asset_requests').findOne({ employee_email: employee.email, category: categoryKey, status: { $in: ['pending', 'approved'] } });
  if (dup) return res.status(400).json({ detail: 'You already have an open request for this category' });

  const now = new Date();
  const request = {
    id: generateUUID(),
    employee_uid: employeeUid(employee),
    employee_email: employee.email,
    employee_name: employee.full_name,
    department: employee.department || null,
    category: categoryKey,
    justification,
    needed_by: toDateOnly(needed_by),
    status: 'pending',
    admin_comments: null,
    actioned_by: null,
    actioned_at: null,
    fulfilled_asset_id: null,
    fulfilled_asset_tag: null,
    created_at: now,
    updated_at: now
  };
  await db.collection('asset_requests').insertOne(request);
  notifyAdmins(db, {
    type: 'asset_request_created',
    title: 'New asset request',
    message: `${employee.full_name} requested a ${categoryKey.replace('_', ' ')}`,
    actionUrl: '/asset-requests',
    metadata: { request_id: request.id }
  }, req.user.email);
  res.status(201).json(stripId(request));
}));

router.get('/requests', handle('List asset requests', async (req, res) => {
  const db = getDB();
  const mine = req.query.scope === 'mine' || req.user.role !== 'admin';
  const filter = mine ? { employee_email: req.user.email } : {};
  if (req.query.status) filter.status = String(req.query.status);
  const requests = await db.collection('asset_requests').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(2000).toArray();
  res.json(requests);
}));

const loadRequest = async (db, id) => {
  const r = await db.collection('asset_requests').findOne({ id }, { projection: { _id: 0 } });
  if (!r) throw httpError(404, 'Request not found');
  return r;
};

const requestNotify = (request, title, message) => notify({ email: request.employee_email }, {
  type: 'asset_request_updated', title, message, actionUrl: '/my-assets', metadata: { request_id: request.id }
});

const commentSchema = Joi.object({ comments: Joi.string().trim().max(1000).allow('', null) });
const rejectSchema = Joi.object({ comments: Joi.string().trim().min(3).max(1000).required() });

router.post('/requests/:id/approve', adminOnly, validate(commentSchema), handle('Approve asset request', async (req, res) => {
  const db = getDB();
  const request = await loadRequest(db, req.params.id);
  if (request.status !== 'pending') return res.status(400).json({ detail: `Request is already ${request.status}` });
  const now = new Date();
  await db.collection('asset_requests').updateOne({ id: request.id }, {
    $set: { status: 'approved', admin_comments: req.validatedBody.comments || null, actioned_by: req.user.email, actioned_at: now, updated_at: now }
  });
  requestNotify(request, 'Asset request approved', `Your ${request.category.replace('_', ' ')} request was approved and will be fulfilled soon.`);
  res.json(await loadRequest(db, request.id));
}));

router.post('/requests/:id/reject', adminOnly, validate(rejectSchema), handle('Reject asset request', async (req, res) => {
  const db = getDB();
  const request = await loadRequest(db, req.params.id);
  if (!['pending', 'approved'].includes(request.status)) return res.status(400).json({ detail: `Request is already ${request.status}` });
  const now = new Date();
  await db.collection('asset_requests').updateOne({ id: request.id }, {
    $set: { status: 'rejected', admin_comments: req.validatedBody.comments, actioned_by: req.user.email, actioned_at: now, updated_at: now }
  });
  requestNotify(request, 'Asset request rejected', `Your ${request.category.replace('_', ' ')} request was rejected: ${req.validatedBody.comments}`);
  res.json(await loadRequest(db, request.id));
}));

const fulfilSchema = Joi.object({
  asset_id: Joi.string().trim().required(),
  expected_return_date: dateField,
  condition: Joi.string().valid(...CONDITIONS),
  notes: Joi.string().max(1000).allow('', null)
});

router.post('/requests/:id/fulfil', adminOnly, validate(fulfilSchema), handle('Fulfil asset request', async (req, res) => {
  const db = getDB();
  const request = await loadRequest(db, req.params.id);
  if (!['pending', 'approved'].includes(request.status)) return res.status(400).json({ detail: `Request is already ${request.status}` });
  const { asset_id, expected_return_date, condition, notes } = req.validatedBody;
  const asset = await loadAsset(db, asset_id);
  const employee = await findEmployeeByRef(db, request.employee_email);
  if (!employee) return res.status(404).json({ detail: 'The requesting employee no longer exists' });

  const assignment = await assignAsset(db, req, asset, employee, { expected_return_date, condition, notes, request_id: request.id });
  const now = new Date();
  await db.collection('asset_requests').updateOne({ id: request.id }, {
    $set: {
      status: 'fulfilled', fulfilled_asset_id: asset.id, fulfilled_asset_tag: asset.asset_tag, fulfilled_at: now,
      actioned_by: req.user.email, actioned_at: request.actioned_at || now, updated_at: now,
      ...(notes ? { admin_comments: notes } : {})
    }
  });
  res.json({ request: await loadRequest(db, request.id), assignment });
}));

router.delete('/requests/:id', handle('Cancel asset request', async (req, res) => {
  const db = getDB();
  const request = await loadRequest(db, req.params.id);
  if (request.employee_email !== req.user.email) return res.status(403).json({ detail: 'You can only cancel your own requests' });
  if (request.status !== 'pending') return res.status(400).json({ detail: 'Only pending requests can be cancelled' });
  await db.collection('asset_requests').updateOne({ id: request.id }, { $set: { status: 'cancelled', updated_at: new Date() } });
  res.json({ message: 'Request cancelled' });
}));

// ============= DASHBOARD =============

router.get('/summary', adminOnly, handle('Assets summary', async (req, res) => {
  const db = getDB();
  const today = toDateOnly(todayStr());
  const [byStatus, byCategory, openRequests, openIssues, expiring, unacknowledged] = await Promise.all([
    db.collection('assets').aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$cost', 0] } } } }]).toArray(),
    db.collection('assets').aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
    db.collection('asset_requests').countDocuments({ status: { $in: ['pending', 'approved'] } }),
    db.collection('asset_issues').countDocuments({ status: { $in: ['open', 'in_repair'] } }),
    db.collection('assets').countDocuments({ warranty_expiry: { $gte: today, $lte: new Date(today.getTime() + 30 * 86400000) }, status: { $nin: ['retired', 'lost'] } }),
    db.collection('assets').countDocuments({ assigned_to_email: { $ne: null }, acknowledged_at: null })
  ]);
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  let total = 0;
  let value = 0;
  byStatus.forEach(s => { if (s._id) counts[s._id] = s.count; total += s.count; value += s.value; });
  res.json({
    total,
    total_value: round2(value),
    by_status: counts,
    by_category: byCategory.map(c => ({ category: c._id, count: c.count })),
    open_requests: openRequests,
    open_issues: openIssues,
    warranty_expiring_30d: expiring,
    unacknowledged
  });
}));

// ============= AS-2: EXPENSE POLICY, PER-DIEM, TRAVEL, RECEIPT OCR =============

router.use('/', expenseRoutes);

module.exports = router;
