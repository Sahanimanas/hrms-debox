/**
 * EL-5 Letter templates — admin CRUD, preview with an employee's data,
 * generate a PDF into the employee's document vault.
 */

const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const {
  generateUUID, serverError, findEmployeeByUid, getSettings, SETTINGS_KEY, todayStr, notifyMany, uidOf
} = require('../common');
const {
  PLACEHOLDERS, LETTER_TYPES, VAULT_TYPE_FOR_LETTER, DEFAULT_TEMPLATES, placeholderValues, renderText, unknownPlaceholders
} = require('../letters');
const { buildLetterPdf } = require('../pdf');
const { createVaultDocument, publicDoc } = require('../vault');
const { DOCUMENT_TYPE_KEYS } = require('../vault');

const templateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  type: Joi.string().valid(...LETTER_TYPES).required(),
  title: Joi.string().trim().max(150).allow(''),
  body: Joi.string().trim().min(10).max(20000).required(),
  vault_type: Joi.string().valid(...DOCUMENT_TYPE_KEYS).allow(null, '')
});

const previewSchema = Joi.object({
  employee_uid: Joi.string().required(),
  template_id: Joi.string().allow(null, ''),
  title: Joi.string().allow('', null).max(150),
  body: Joi.string().allow('', null).max(20000)
}).or('template_id', 'body');

const generateSchema = Joi.object({
  employee_uid: Joi.string().required(),
  template_id: Joi.string().required(),
  allow_missing: Joi.boolean().default(false)
});

/** Seed the default templates once (first use). */
const seedDefaults = async (db) => {
  const settings = await getSettings(db);
  if (settings.letters_seeded) return;
  const count = await db.collection('letter_templates').countDocuments();
  if (!count) {
    const now = new Date();
    await db.collection('letter_templates').insertMany(DEFAULT_TEMPLATES.map(t => ({
      id: generateUUID(),
      ...t,
      vault_type: VAULT_TYPE_FOR_LETTER[t.type],
      is_system: true,
      created_by: 'system',
      created_at: now,
      updated_at: now
    })));
  }
  await db.collection('lifecycle_settings').updateOne(
    { key: SETTINGS_KEY },
    { $set: { letters_seeded: true }, $setOnInsert: { key: SETTINGS_KEY, created_at: new Date() } },
    { upsert: true }
  );
};

const render = async (db, employee, title, body) => {
  const settings = await getSettings(db);
  const values = await placeholderValues(db, employee, settings);
  const t = renderText(title || '', values);
  const b = renderText(body || '', values);
  return { settings, title: t.text, body: b.text, missing: [...new Set([...t.missing, ...b.missing])], values };
};

module.exports = (router) => {
  router.get('/letters/placeholders', requireRole(['admin']), (req, res) => res.json(PLACEHOLDERS));

  router.get('/letters/templates', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      await seedDefaults(db);
      const list = await db.collection('letter_templates').find({}, { projection: { _id: 0 } }).sort({ type: 1, name: 1 }).toArray();
      res.json(list);
    } catch (error) {
      serverError(res, 'list letter templates', error);
    }
  });

  router.post('/letters/templates', requireRole(['admin']), validate(templateSchema), async (req, res) => {
    try {
      const db = getDB();
      await seedDefaults(db);
      const body = req.validatedBody;
      const unknown = unknownPlaceholders(`${body.title || ''} ${body.body}`);
      if (unknown.length) return res.status(400).json({ detail: `Unknown placeholder(s): ${unknown.map(u => `{{${u}}}`).join(', ')}` });
      const now = new Date();
      const doc = {
        id: generateUUID(),
        name: body.name,
        type: body.type,
        title: body.title || '',
        body: body.body,
        vault_type: body.vault_type || VAULT_TYPE_FOR_LETTER[body.type],
        is_system: false,
        created_by: req.user.email,
        created_at: now,
        updated_at: now
      };
      await db.collection('letter_templates').insertOne(doc);
      delete doc._id;
      res.status(201).json(doc);
    } catch (error) {
      serverError(res, 'create letter template', error);
    }
  });

  router.put('/letters/templates/:id', requireRole(['admin']), validate(templateSchema), async (req, res) => {
    try {
      const db = getDB();
      const existing = await db.collection('letter_templates').findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!existing) return res.status(404).json({ detail: 'Template not found' });
      const body = req.validatedBody;
      const unknown = unknownPlaceholders(`${body.title || ''} ${body.body}`);
      if (unknown.length) return res.status(400).json({ detail: `Unknown placeholder(s): ${unknown.map(u => `{{${u}}}`).join(', ')}` });
      const update = {
        name: body.name,
        type: body.type,
        title: body.title || '',
        body: body.body,
        vault_type: body.vault_type || VAULT_TYPE_FOR_LETTER[body.type],
        updated_at: new Date(),
        updated_by: req.user.email
      };
      await db.collection('letter_templates').updateOne({ id: existing.id }, { $set: update });
      res.json({ ...existing, ...update });
    } catch (error) {
      serverError(res, 'update letter template', error);
    }
  });

  router.delete('/letters/templates/:id', requireRole(['admin']), async (req, res) => {
    try {
      const r = await getDB().collection('letter_templates').deleteOne({ id: req.params.id });
      if (!r.deletedCount) return res.status(404).json({ detail: 'Template not found' });
      res.json({ message: 'Template deleted' });
    } catch (error) {
      serverError(res, 'delete letter template', error);
    }
  });

  router.post('/letters/preview', requireRole(['admin']), validate(previewSchema), async (req, res) => {
    try {
      const db = getDB();
      const body = req.validatedBody;
      const employee = await findEmployeeByUid(db, body.employee_uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      let title = body.title || '';
      let text = body.body || '';
      if (body.template_id) {
        const template = await db.collection('letter_templates').findOne({ id: body.template_id });
        if (!template) return res.status(404).json({ detail: 'Template not found' });
        title = body.title || template.title;
        text = body.body || template.body;
      }
      const out = await render(db, employee, title, text);
      res.json({ title: out.title, body: out.body, missing: out.missing, company_name: out.settings.company_name, values: out.values });
    } catch (error) {
      serverError(res, 'preview letter', error);
    }
  });

  router.post('/letters/generate', requireRole(['admin']), validate(generateSchema), async (req, res) => {
    try {
      const db = getDB();
      const body = req.validatedBody;
      const employee = await findEmployeeByUid(db, body.employee_uid);
      if (!employee) return res.status(404).json({ detail: 'Employee not found' });
      const template = await db.collection('letter_templates').findOne({ id: body.template_id });
      if (!template) return res.status(404).json({ detail: 'Template not found' });
      const out = await render(db, employee, template.title, template.body);
      if (out.missing.length && !body.allow_missing) {
        return res.status(400).json({ detail: `Missing data for: ${out.missing.join(', ')}. Fill these in or generate anyway.`, missing: out.missing });
      }
      const issueDate = todayStr();
      const reference = `${(template.type || 'letter').toUpperCase().slice(0, 3)}/${uidOf(employee)}/${issueDate.replace(/-/g, '')}`;
      const pdf = await buildLetterPdf({
        company: { name: out.settings.company_name, address: out.settings.company_address },
        title: out.title,
        body: out.body,
        issueDate,
        reference
      });
      const safeName = String(template.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'letter';
      const doc = await createVaultDocument(db, {
        employee,
        type: template.vault_type || VAULT_TYPE_FOR_LETTER[template.type] || 'other',
        title: template.name,
        buffer: pdf,
        fileName: `${safeName}-${uidOf(employee)}.pdf`,
        mimeType: 'application/pdf',
        source: 'letter',
        verificationStatus: 'verified',
        actor: req.user,
        extra: { letter_template_id: template.id, letter_type: template.type, letter_reference: reference, issued_on: issueDate }
      });
      notifyMany(db, [employee.email], {
        type: 'letter_issued',
        title: `${template.name} issued`,
        message: `Your ${template.name.toLowerCase()} is available in My Documents.`,
        actionUrl: '/my-documents',
        metadata: { document_id: doc.id }
      });
      res.status(201).json(publicDoc(doc));
    } catch (error) {
      serverError(res, 'generate letter', error);
    }
  });

  /** GET /letters/issued?employee_uid= — letters generated so far (admin). */
  router.get('/letters/issued', requireRole(['admin']), async (req, res) => {
    try {
      const query = { source: 'letter' };
      if (req.query.employee_uid) query.employee_uid = String(req.query.employee_uid);
      const docs = await getDB().collection('employee_documents').find(query).sort({ created_at: -1 }).limit(1000).toArray();
      res.json(docs.map(publicDoc));
    } catch (error) {
      serverError(res, 'issued letters', error);
    }
  });

  /** GET /letters/my — letters issued to me. */
  router.get('/letters/my', async (req, res) => {
    try {
      const docs = await getDB().collection('employee_documents').find({ source: 'letter', employee_email: req.user.email }).sort({ created_at: -1 }).toArray();
      res.json(docs.map(publicDoc));
    } catch (error) {
      serverError(res, 'my letters', error);
    }
  });
};
