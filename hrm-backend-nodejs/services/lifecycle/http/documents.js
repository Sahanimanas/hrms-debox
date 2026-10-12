/**
 * EL-4 Document vault — typed employee documents with expiry and verification.
 *
 * Employees upload / view their own (and may delete them until verified);
 * admins manage everyone's. Files are served only through the authenticated
 * download endpoint.
 */

const Joi = require('joi');
const multer = require('multer');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { removeFile } = require('../../fileStorage');
const {
  serverError, findEmployeeByUid, findMyEmployee, todayStr, addDaysStr, notifyMany, uidOf
} = require('../common');
const {
  DOCUMENT_TYPES, DOCUMENT_TYPE_KEYS, MAX_FILE_SIZE, isAllowedFile, createVaultDocument, readStoredFile, publicDoc
} = require('../vault');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1 } });

const DATE = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });

const uploadSchema = Joi.object({
  type: Joi.string().valid(...DOCUMENT_TYPE_KEYS).required(),
  title: Joi.string().trim().min(2).max(150),
  expiry_date: DATE.allow('', null),
  employee_uid: Joi.string().allow('', null)
});

const updateSchema = Joi.object({
  title: Joi.string().trim().min(2).max(150),
  type: Joi.string().valid(...DOCUMENT_TYPE_KEYS),
  expiry_date: DATE.allow(null, '')
}).min(1);

const verifySchema = Joi.object({
  status: Joi.string().valid('verified', 'rejected', 'pending').required(),
  reason: Joi.string().trim().max(500).allow('', null)
});

const typeLabel = (key) => DOCUMENT_TYPES.find(t => t.key === key)?.label || key;

/** Expiry state for a document relative to today. */
const expiryState = (doc, today = todayStr()) => {
  if (!doc.expiry_date) return null;
  if (doc.expiry_date < today) return 'expired';
  if (doc.expiry_date <= addDaysStr(today, 30)) return 'expiring';
  return 'valid';
};

const view = (doc) => ({ ...publicDoc(doc), type_label: typeLabel(doc.type), expiry_state: expiryState(doc) });

module.exports = (router) => {
  router.get('/documents/types', (req, res) => res.json(DOCUMENT_TYPES));

  router.get('/documents/my', async (req, res) => {
    try {
      const db = getDB();
      const docs = await db.collection('employee_documents').find({ employee_email: req.user.email }).sort({ created_at: -1 }).toArray();
      res.json(docs.map(view));
    } catch (error) {
      serverError(res, 'my documents', error);
    }
  });

  /** GET /documents/expiring?days=30 — admin: documents expiring within N days or already expired. */
  router.get('/documents/expiring', requireRole(['admin']), async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
      const limit = addDaysStr(todayStr(), days);
      const docs = await getDB().collection('employee_documents')
        .find({ expiry_date: { $ne: null, $lte: limit } })
        .sort({ expiry_date: 1 }).toArray();
      res.json(docs.map(view));
    } catch (error) {
      serverError(res, 'expiring documents', error);
    }
  });

  /** GET /documents — admin list with filters: employee_uid, type, status, q. */
  router.get('/documents', requireRole(['admin']), async (req, res) => {
    try {
      const query = {};
      if (req.query.employee_uid) query.employee_uid = String(req.query.employee_uid);
      if (req.query.type) query.type = String(req.query.type);
      if (req.query.status) query.verification_status = String(req.query.status);
      if (req.query.q) {
        const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ employee_name: rx }, { title: rx }, { employee_email: rx }];
      }
      const docs = await getDB().collection('employee_documents').find(query).sort({ created_at: -1 }).limit(2000).toArray();
      res.json(docs.map(view));
    } catch (error) {
      serverError(res, 'list documents', error);
    }
  });

  router.post('/documents', upload.single('file'), async (req, res) => {
    try {
      const db = getDB();
      const { error, value } = uploadSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
      if (error) {
        return res.status(422).json({ detail: 'Validation failed', errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message })) });
      }
      if (!req.file) return res.status(400).json({ detail: 'No file provided' });
      if (!isAllowedFile(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ detail: 'Invalid file type. Allowed: PDF, JPG, PNG, WebP, DOC, DOCX' });
      }

      let employee;
      if (value.employee_uid) {
        employee = await findEmployeeByUid(db, value.employee_uid);
        if (!employee) return res.status(404).json({ detail: 'Employee not found' });
        if (employee.email !== req.user.email && req.user.role !== 'admin') {
          return res.status(403).json({ detail: 'You can only upload your own documents' });
        }
      } else {
        employee = await findMyEmployee(db, req.user.email);
        if (!employee) return res.status(404).json({ detail: 'Employee profile not found' });
      }

      const byAdminForOther = req.user.role === 'admin' && employee.email !== req.user.email;
      const doc = await createVaultDocument(db, {
        employee,
        type: value.type,
        title: value.title || typeLabel(value.type),
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        expiryDate: value.expiry_date || null,
        source: 'upload',
        verificationStatus: byAdminForOther ? 'verified' : 'pending',
        actor: req.user
      });
      if (byAdminForOther) {
        notifyMany(db, [employee.email], {
          type: 'document_added',
          title: 'New document in your vault',
          message: `${req.user.full_name} added "${doc.title}" to your documents.`,
          actionUrl: '/my-documents',
          metadata: { document_id: doc.id }
        });
      }
      res.status(201).json(view(doc));
    } catch (error) {
      serverError(res, 'upload document', error);
    }
  });

  const loadDoc = async (req, res) => {
    const db = getDB();
    const doc = await db.collection('employee_documents').findOne({ id: req.params.id });
    if (!doc) { res.status(404).json({ detail: 'Document not found' }); return null; }
    const isOwner = doc.employee_email === req.user.email;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) { res.status(403).json({ detail: 'Not enough permissions' }); return null; }
    return { db, doc, isOwner, isAdmin };
  };

  router.get('/documents/:id', async (req, res) => {
    try {
      const ctx = await loadDoc(req, res);
      if (!ctx) return;
      res.json(view(ctx.doc));
    } catch (error) {
      serverError(res, 'get document', error);
    }
  });

  router.get('/documents/:id/download', async (req, res) => {
    try {
      const ctx = await loadDoc(req, res);
      if (!ctx) return;
      const buffer = await readStoredFile(ctx.doc);
      if (!buffer) return res.status(404).json({ detail: 'File not found' });
      const safeName = String(ctx.doc.file_name || 'document').replace(/["\r\n]/g, '');
      res.setHeader('Content-Type', ctx.doc.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${safeName}"`);
      res.send(buffer);
    } catch (error) {
      serverError(res, 'download document', error);
    }
  });

  router.patch('/documents/:id', validate(updateSchema), async (req, res) => {
    try {
      const ctx = await loadDoc(req, res);
      if (!ctx) return;
      const { db, doc, isAdmin } = ctx;
      if (!isAdmin && doc.verification_status === 'verified') {
        return res.status(400).json({ detail: 'Verified documents can only be changed by an admin' });
      }
      const body = req.validatedBody;
      const update = { updated_at: new Date() };
      if (body.title) update.title = body.title;
      if (body.type) update.type = body.type;
      if (body.expiry_date !== undefined) {
        update.expiry_date = body.expiry_date || null;
        update.expiry_alert_stage = null;
      }
      // An employee editing a rejected document resubmits it for verification
      if (!isAdmin && doc.verification_status === 'rejected') {
        update.verification_status = 'pending';
        update.rejection_reason = null;
      }
      await db.collection('employee_documents').updateOne({ id: doc.id }, { $set: update });
      res.json(view({ ...doc, ...update }));
    } catch (error) {
      serverError(res, 'update document', error);
    }
  });

  router.post('/documents/:id/verify', requireRole(['admin']), validate(verifySchema), async (req, res) => {
    try {
      const db = getDB();
      const doc = await db.collection('employee_documents').findOne({ id: req.params.id });
      if (!doc) return res.status(404).json({ detail: 'Document not found' });
      const { status, reason } = req.validatedBody;
      if (status === 'rejected' && !reason) return res.status(422).json({ detail: 'A reason is required to reject a document' });
      const update = {
        verification_status: status,
        verified_by: status === 'pending' ? null : req.user.email,
        verified_by_name: status === 'pending' ? null : req.user.full_name,
        verified_at: status === 'pending' ? null : new Date(),
        rejection_reason: status === 'rejected' ? reason : null,
        updated_at: new Date()
      };
      await db.collection('employee_documents').updateOne({ id: doc.id }, { $set: update });
      if (status !== 'pending') {
        notifyMany(db, [doc.employee_email], {
          type: status === 'verified' ? 'document_verified' : 'document_rejected',
          title: status === 'verified' ? 'Document verified' : 'Document rejected',
          message: status === 'verified' ? `"${doc.title}" was verified.` : `"${doc.title}" was rejected: ${reason}`,
          actionUrl: '/my-documents',
          metadata: { document_id: doc.id }
        });
      }
      res.json(view({ ...doc, ...update }));
    } catch (error) {
      serverError(res, 'verify document', error);
    }
  });

  router.delete('/documents/:id', async (req, res) => {
    try {
      const ctx = await loadDoc(req, res);
      if (!ctx) return;
      const { db, doc, isAdmin } = ctx;
      if (!isAdmin && doc.verification_status === 'verified') {
        return res.status(403).json({ detail: 'Verified documents cannot be deleted' });
      }
      await db.collection('employee_documents').deleteOne({ id: doc.id });
      await removeFile(doc.file_key);
      res.json({ message: 'Document deleted' });
    } catch (error) {
      serverError(res, 'delete document', error);
    }
  });

  /** Document counts per employee (admin) — used by the employee detail view. */
  router.get('/documents-summary/:uid', async (req, res) => {
    try {
      const db = getDB();
      const employee = await findEmployeeByUid(db, req.params.uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      if (req.user.role !== 'admin' && employee.email !== req.user.email) return res.status(403).json({ detail: 'Not enough permissions' });
      const docs = await db.collection('employee_documents').find({ employee_uid: uidOf(employee) }).sort({ created_at: -1 }).toArray();
      res.json(docs.map(view));
    } catch (error) {
      serverError(res, 'documents summary', error);
    }
  });
};

module.exports.expiryState = expiryState;
