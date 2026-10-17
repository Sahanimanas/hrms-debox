/**
 * Recruitment / ATS module — mounted at /api/v2/recruitment
 *
 *  RC-1  Requisitions → job postings; public careers endpoints (/public/…, no login)
 *  RC-2  Candidate pipeline, profiles, notes, manual add, referrals, CV parsing
 *  RC-3  Interviews (`interviews` collection — shared contract), .ics, scorecards
 *  RC-4  Offers, offer letter PDF, convert to employee
 *        + analytics and a dashboard summary
 *
 * Access model
 *  - admin: everything
 *  - manager: jobs they are hiring manager for (or created) and those jobs' candidates,
 *    interviews and offers (offers are read-only for managers)
 *  - any employee: refer candidates, see their referrals, see/score interviews
 *    they are assigned to (limited candidate view)
 */

const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID } = require('../../utils/helpers');
const { createNotification } = require('../../services/notificationService');
const { sendEmailNotification } = require('../../services/emailService');
const { storeFile, removeFile, LOCAL_ROOT } = require('../../services/fileStorage');
const s3 = require('../../services/s3Service');
const { emitEvent } = require('../../services/events');

const C = require('../../services/recruitment/constants');
const { validateResumeFile } = require('../../services/recruitment/resumeFile');
const { parseResume } = require('../../services/recruitment/cvParser');
const { buildIcs } = require('../../services/recruitment/ics');
const { buildOfferLetterPdf } = require('../../services/recruitment/offerLetter');
const { createRateLimiter, clientIp } = require('../../services/recruitment/rateLimit');
const { todayStr } = require('../../services/recruitment/maintenance');

const router = express.Router();
const COL = C.COLLECTIONS;

router.get('/health', (req, res) => res.json({ module: 'recruitment', status: 'ok' }));

// ============================================================ infrastructure

let indexesReady = null;
const ensureIndexes = (db) => {
  if (!indexesReady) {
    indexesReady = Promise.all([
      db.collection(COL.requisitions).createIndex({ id: 1 }, { unique: true }),
      db.collection(COL.requisitions).createIndex({ requested_by_email: 1, status: 1 }),
      db.collection(COL.jobs).createIndex({ id: 1 }, { unique: true }),
      db.collection(COL.jobs).createIndex({ slug: 1 }, { unique: true }),
      db.collection(COL.jobs).createIndex({ status: 1, closing_date: 1 }),
      db.collection(COL.jobs).createIndex({ hiring_manager_email: 1 }),
      db.collection(COL.candidates).createIndex({ id: 1 }, { unique: true }),
      db.collection(COL.candidates).createIndex({ job_id: 1, email: 1 }, { unique: true }),
      db.collection(COL.candidates).createIndex({ email: 1 }),
      db.collection(COL.candidates).createIndex({ referred_by_email: 1 }),
      db.collection(COL.candidates).createIndex({ stage: 1, created_at: -1 }),
      db.collection(COL.interviews).createIndex({ id: 1 }, { unique: true }),
      db.collection(COL.interviews).createIndex({ candidate_id: 1 }),
      db.collection(COL.interviews).createIndex({ interviewer_emails: 1, scheduled_at: 1 }),
      db.collection(COL.interviews).createIndex({ scheduled_at: 1 }),
      db.collection(COL.scorecards).createIndex({ interview_id: 1, interviewer_email: 1 }, { unique: true }),
      db.collection(COL.scorecards).createIndex({ candidate_id: 1 }),
      db.collection(COL.offers).createIndex({ id: 1 }, { unique: true }),
      db.collection(COL.offers).createIndex({ candidate_id: 1 }),
      db.collection(COL.offers).createIndex({ status: 1, expiry_date: 1 })
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
};

const withIndexes = async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('[recruitment] index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

/** Wrap an async handler: (req, res, db) with uniform 500 handling. */
const handler = (label, fn) => async (req, res) => {
  try {
    await fn(req, res, getDB());
  } catch (error) {
    console.error(`[recruitment] ${label} error:`, error);
    if (!res.headersSent) res.status(500).json({ detail: 'Internal server error' });
  }
};

const fail = (res, status, detail, extra) => res.status(status).json({ detail, ...(extra || {}) });

/** Validate a plain object (e.g. a multipart body) the same way as middleware/roleCheck.validate. */
const checkSchema = (schema, body, res) => {
  const { error, value } = schema.validate(body || {}, { abortEarly: false, stripUnknown: true });
  if (error) {
    res.status(422).json({
      detail: 'Validation failed',
      errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
    });
    return null;
  }
  return value;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: C.RESUME_MAX_BYTES, files: 1, fields: 30, fieldSize: 20000 }
});

/** Single optional `resume` file; multer errors become clean 4xx responses. */
const resumeUpload = (req, res, next) => {
  upload.single('resume')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'Resume must be 5 MB or smaller');
    if (error instanceof multer.MulterError) return fail(res, 400, `Upload error: ${error.message}`);
    return fail(res, 400, 'Could not read the upload');
  });
};

// ============================================================ helpers

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const isAdmin = (user) => user?.role === 'admin';
const NO_ID = { projection: { _id: 0 } };

/** A manager (or admin) "owns" a job when they are its hiring manager or created it. */
const managesJob = (user, job) => !!job && (
  isAdmin(user)
  || (user.role === 'manager' && (job.hiring_manager_email === user.email || job.created_by_email === user.email))
);
const managedJobFilter = (user) => (isAdmin(user)
  ? {}
  : { $or: [{ hiring_manager_email: user.email }, { created_by_email: user.email }] });
/**
 * AND together independent filter clauses. Never spread an access-scope
 * filter into another object — a later key with the same name would silently
 * replace (and widen) the scope.
 */
const allOf = (...clauses) => {
  const list = clauses.filter(c => c && Object.keys(c).length);
  if (!list.length) return {};
  return list.length === 1 ? list[0] : { $and: list };
};
const managedJobIds = async (db, user) => {
  if (isAdmin(user)) return null;
  const jobs = await db.collection(COL.jobs).find(managedJobFilter(user), { projection: { _id: 0, id: 1 } }).toArray();
  return jobs.map(j => j.id);
};

const isAccepting = (job) => job?.status === 'open' && (!job.closing_date || job.closing_date >= todayStr());

const findEmployeeByEmail = async (db, email) => {
  if (!email) return null;
  const projection = { _id: 0, id: 1, email: 1, full_name: 1, role: 1, department: 1, designation: 1, employee_id: 1 };
  return (await db.collection('employees').findOne({ email }, { projection }))
    || db.collection('employees').findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } }, { projection });
};

const companyName = async (db) => {
  const settings = await db.collection('settings').findOne({}, { projection: { _id: 0, company_name: 1 } });
  return settings?.company_name || process.env.COMPANY_NAME || 'Xeno-HR';
};

const actor = (req) => ({ email: req.user.email, name: req.user.full_name || req.user.email });

/**
 * Fire-and-forget in-app notifications to a list of emails (users collection,
 * so admins without an employee record are covered too).
 */
const notifyEmails = (db, emails, payload, exceptEmail) => {
  const unique = [...new Set((emails || []).filter(e => e && e !== exceptEmail))];
  if (!unique.length) return;
  (async () => {
    const users = await db.collection('users')
      .find({ email: { $in: unique } }, { projection: { _id: 0, id: 1, email: 1 } })
      .toArray();
    await Promise.all(users.map(u => createNotification({
      userId: u.id,
      userEmail: u.email,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      actionUrl: payload.actionUrl || null,
      metadata: payload.metadata || {}
    })));
  })().catch(error => console.error('[recruitment] notify failed:', error.message));
};

const adminEmails = async (db) =>
  (await db.collection('users').find({ role: 'admin' }, { projection: { _id: 0, email: 1 } }).toArray()).map(u => u.email);

const sendMailQuietly = (to, subject, html) => {
  if (!to) return;
  Promise.resolve()
    .then(() => sendEmailNotification(to, subject, html))
    .catch(error => console.error('[recruitment] email failed:', error.message));
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uniqueSlug = async (db, title, excludeId) => {
  const base = String(title || 'job').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'job';
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const taken = await db.collection(COL.jobs).findOne(
      { slug, ...(excludeId ? { id: { $ne: excludeId } } : {}) },
      { projection: { _id: 1 } }
    );
    if (!taken) return slug;
    slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  }
  return `${base}-${generateUUID().slice(0, 8)}`;
};

const rangeError = (doc) => {
  if (doc.experience_min != null && doc.experience_max != null && doc.experience_min > doc.experience_max) {
    return 'Minimum experience cannot exceed maximum experience';
  }
  for (const [lo, hi, label] of [['budget_min', 'budget_max', 'budget'], ['salary_min', 'salary_max', 'salary']]) {
    if (doc[lo] != null && doc[hi] != null && doc[lo] > doc[hi]) return `Minimum ${label} cannot exceed maximum ${label}`;
  }
  return null;
};

/** Accept tags as an array, a JSON array string, or a comma-separated string. */
const parseTags = (value) => {
  if (value == null || value === '') return [];
  let list = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try { list = JSON.parse(trimmed); } catch { list = trimmed.split(','); }
    } else {
      list = trimmed.split(',');
    }
  }
  if (!Array.isArray(list)) return value; // let Joi reject it
  return [...new Set(list.map(t => String(t).trim().toLowerCase()).filter(Boolean))];
};

// ---------- serializers

const resumeMeta = (resume) => (resume
  ? { file_name: resume.file_name, size: resume.size, mime_type: resume.mime_type, uploaded_at: resume.uploaded_at }
  : null);

const candidateOut = (c) => {
  if (!c) return c;
  // eslint-disable-next-line no-unused-vars
  const { _id, resume, applied_ip, ...rest } = c;
  return { ...rest, resume: resumeMeta(resume), stage_label: C.STAGE_LABELS[c.stage] || c.stage };
};

/** What an assigned interviewer may see (no notes, ratings, scorecards or internal history). */
const candidateForInterviewer = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  linkedin_url: c.linkedin_url,
  job_id: c.job_id,
  job_title: c.job_title,
  stage: c.stage,
  stage_label: C.STAGE_LABELS[c.stage] || c.stage,
  cover_letter: c.cover_letter || '',
  resume: resumeMeta(c.resume),
  created_at: c.created_at
});

const candidateCard = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  job_id: c.job_id,
  job_title: c.job_title,
  source: c.source,
  rating: c.rating ?? null,
  tags: c.tags || [],
  stage: c.stage,
  stage_label: C.STAGE_LABELS[c.stage] || c.stage,
  offer_status: c.offer_status || null,
  referred_by_name: c.referred_by_name || null,
  has_resume: !!c.resume,
  stage_changed_at: c.stage_changed_at,
  created_at: c.created_at
});

const jobOut = (j) => {
  if (!j) return j;
  // eslint-disable-next-line no-unused-vars
  const { _id, ...rest } = j;
  return { ...rest, accepting_applications: isAccepting(j) };
};

const publicJob = (j, { full = false } = {}) => ({
  id: j.id,
  slug: j.slug,
  title: j.title,
  department: j.department,
  location: j.location,
  employment_type: j.employment_type,
  work_mode: j.work_mode,
  experience_min: j.experience_min ?? null,
  experience_max: j.experience_max ?? null,
  salary: j.show_salary && (j.salary_min != null || j.salary_max != null)
    ? { min: j.salary_min ?? null, max: j.salary_max ?? null, currency: 'INR' }
    : null,
  closing_date: j.closing_date || null,
  published_at: j.published_at || null,
  accepting_applications: isAccepting(j),
  ...(full
    ? { description: j.description || '', requirements: j.requirements || '', benefits: j.benefits || '' }
    : { summary: String(j.description || '').replace(/[#*_>`-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) })
});

const interviewOut = (i) => {
  if (!i) return i;
  // eslint-disable-next-line no-unused-vars
  const { _id, ...rest } = i;
  return rest;
};

const historyEntry = (req, extra) => ({ at: new Date(), by_email: req.user.email, by_name: req.user.full_name || req.user.email, ...extra });

// ============================================================ Joi schemas

const dateStr = Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const d = new Date(`${value}T00:00:00Z`);
    return !isNaN(d) && d.toISOString().slice(0, 10) === value ? value : helpers.error('any.invalid');
  }, 'calendar date')
  .messages({
    'string.pattern.base': '{{#label}} must be a date in YYYY-MM-DD format',
    'any.invalid': '{{#label}} is not a valid date'
  });
const text = (max) => Joi.string().trim().max(max);
const money = Joi.number().min(0).max(1e10);
// Any syntactically valid TLD (Joi's bundled IANA list lags behind new gTLDs)
const emailSchema = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254);
const personEmail = Joi.string().trim().email({ tlds: { allow: false } }).max(254);
const phoneSchema = Joi.string().trim().pattern(/^\+?[0-9()\s.-]{7,20}$/)
  .messages({ 'string.pattern.base': 'Enter a valid phone number' });
const linkedinSchema = Joi.string().trim().max(300).uri({ scheme: ['http', 'https'] })
  .pattern(/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i)
  .messages({ 'string.pattern.base': 'Enter a LinkedIn profile URL (https://www.linkedin.com/in/…)' });
const tagsSchema = Joi.array().items(Joi.string().trim().min(1).max(30)).max(15).unique();

const requisitionFields = {
  title: text(120).min(2),
  department: text(80).min(1),
  headcount: Joi.number().integer().min(1).max(500),
  employment_type: Joi.string().valid(...C.EMPLOYMENT_TYPES),
  location: text(120).min(1),
  work_mode: Joi.string().valid(...C.WORK_MODES),
  experience_min: Joi.number().min(0).max(60),
  experience_max: Joi.number().min(0).max(60),
  budget_min: money,
  budget_max: money,
  justification: text(3000).min(10),
  target_start_date: dateStr.allow(null, ''),
  hiring_manager_email: personEmail.allow(null, '')
};
const requisitionCreate = Joi.object({
  ...requisitionFields,
  title: requisitionFields.title.required(),
  department: requisitionFields.department.required(),
  headcount: requisitionFields.headcount.default(1),
  employment_type: requisitionFields.employment_type.required(),
  location: requisitionFields.location.required(),
  work_mode: requisitionFields.work_mode.default('onsite'),
  experience_min: requisitionFields.experience_min.required(),
  experience_max: requisitionFields.experience_max.required(),
  budget_min: requisitionFields.budget_min.required(),
  budget_max: requisitionFields.budget_max.required(),
  justification: requisitionFields.justification.required()
});
const requisitionUpdate = Joi.object(requisitionFields).min(1);
const decisionSchema = Joi.object({ note: text(1000).allow(''), create_job: Joi.boolean().default(true) });
const rejectSchema = Joi.object({ note: text(1000).min(3).required() });

const jobFields = {
  title: text(120).min(2),
  department: text(80).min(1),
  location: text(120).min(1),
  employment_type: Joi.string().valid(...C.EMPLOYMENT_TYPES),
  work_mode: Joi.string().valid(...C.WORK_MODES),
  experience_min: Joi.number().min(0).max(60).allow(null),
  experience_max: Joi.number().min(0).max(60).allow(null),
  salary_min: money.allow(null),
  salary_max: money.allow(null),
  show_salary: Joi.boolean(),
  headcount: Joi.number().integer().min(1).max(500),
  description: Joi.string().trim().max(20000).allow(''),
  requirements: Joi.string().trim().max(10000).allow(''),
  benefits: Joi.string().trim().max(5000).allow(''),
  closing_date: dateStr.allow(null, ''),
  hiring_manager_email: personEmail.allow(null, ''),
  scorecard_criteria: Joi.array().items(text(60).min(2)).min(1).max(12).unique(),
  slug: Joi.string().trim().lowercase().max(80).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .messages({ 'string.pattern.base': 'Slug may only contain lowercase letters, numbers and single hyphens' })
};
const jobCreate = Joi.object({
  ...jobFields,
  title: jobFields.title.required(),
  department: jobFields.department.required(),
  location: jobFields.location.required(),
  employment_type: jobFields.employment_type.required(),
  work_mode: jobFields.work_mode.default('onsite'),
  headcount: jobFields.headcount.default(1),
  show_salary: jobFields.show_salary.default(false),
  description: jobFields.description.default(''),
  requirements: jobFields.requirements.default(''),
  benefits: jobFields.benefits.default(''),
  requisition_id: Joi.string().max(64)
});
const jobUpdate = Joi.object(jobFields).min(1);
const jobStatusSchema = Joi.object({ status: Joi.string().valid(...C.JOB_STATUSES).required() });

const applySchema = Joi.object({
  name: text(100).min(2).required(),
  email: emailSchema.required(),
  phone: phoneSchema.required(),
  linkedin_url: linkedinSchema.allow('', null),
  cover_letter: Joi.string().trim().max(5000).allow(''),
  consent: Joi.string().valid('true', 'on', '1', 'yes').required()
    .messages({ 'any.only': 'Please accept the privacy notice to apply', 'any.required': 'Please accept the privacy notice to apply' })
});

const candidateCreate = Joi.object({
  job_id: Joi.string().max(64).required(),
  name: text(100).min(2).required(),
  email: emailSchema.required(),
  phone: phoneSchema.allow('', null),
  linkedin_url: linkedinSchema.allow('', null),
  source: Joi.string().valid(...C.SOURCES).default('manual'),
  source_detail: text(120).allow(''),
  tags: tagsSchema.default([]),
  cover_letter: Joi.string().trim().max(5000).allow('')
});
const candidateUpdate = Joi.object({
  name: text(100).min(2),
  phone: phoneSchema.allow('', null),
  linkedin_url: linkedinSchema.allow('', null),
  source: Joi.string().valid(...C.SOURCES),
  source_detail: text(120).allow(''),
  tags: tagsSchema,
  rating: Joi.number().integer().min(1).max(5).allow(null)
}).min(1);
const stageSchema = Joi.object({
  stage: Joi.string().valid(...C.STAGES).required(),
  reason: Joi.when('stage', {
    is: 'rejected',
    then: text(500).min(3).required().messages({ 'any.required': 'A rejection reason is required' }),
    otherwise: text(500).allow('')
  })
});
const noteSchema = Joi.object({ text: text(3000).min(1).required() });

const referralSchema = Joi.object({
  job_id: Joi.string().max(64).required(),
  name: text(100).min(2).required(),
  email: emailSchema.required(),
  phone: phoneSchema.allow('', null),
  linkedin_url: linkedinSchema.allow('', null),
  relationship: text(100).allow(''),
  note: text(2000).allow('')
});

const interviewFields = {
  round_name: text(80).min(2),
  scheduled_at: Joi.date().iso(),
  duration_minutes: Joi.number().integer().min(15).max(480),
  mode: Joi.string().valid(...C.INTERVIEW_MODES),
  meeting_link: Joi.string().trim().max(500).uri({ scheme: ['http', 'https'] }).allow('', null),
  location: text(200).allow('', null),
  interviewer_emails: Joi.array().items(personEmail).min(1).max(10).unique((a, b) => a.toLowerCase() === b.toLowerCase()),
  notes: text(2000).allow('', null)
};
const interviewCreate = Joi.object({
  ...interviewFields,
  round_name: interviewFields.round_name.required(),
  scheduled_at: interviewFields.scheduled_at.required(),
  duration_minutes: interviewFields.duration_minutes.default(60),
  mode: interviewFields.mode.required(),
  interviewer_emails: interviewFields.interviewer_emails.required()
});
const interviewUpdate = Joi.object(interviewFields).min(1);
const cancelSchema = Joi.object({ reason: text(500).allow('') });
const interviewStatusSchema = Joi.object({ status: Joi.string().valid('scheduled', 'completed', 'no_show').required() });
const scorecardSchema = Joi.object({
  ratings: Joi.array().items(Joi.object({
    criterion: text(60).min(1).required(),
    rating: Joi.number().integer().min(1).max(5).required()
  })).min(1).max(12).required(),
  strengths: text(3000).allow(''),
  concerns: text(3000).allow(''),
  recommendation: Joi.string().valid(...C.RECOMMENDATIONS).required()
});

const offerFields = {
  designation: text(100).min(2),
  department: text(80).min(1),
  ctc: Joi.number().positive().max(1e10),
  joining_date: dateStr,
  expiry_date: dateStr,
  notes: text(3000).allow('')
};
const offerCreate = Joi.object({
  ...offerFields,
  designation: offerFields.designation.required(),
  department: offerFields.department.required(),
  ctc: offerFields.ctc.required(),
  joining_date: offerFields.joining_date.required(),
  expiry_date: offerFields.expiry_date.required(),
  notes: offerFields.notes.default('')
});
const offerUpdate = Joi.object(offerFields).min(1);
const respondSchema = Joi.object({ response: Joi.string().valid('accepted', 'declined').required(), note: text(1000).allow('') });
const convertSchema = Joi.object({
  email: personEmail,
  role: Joi.string().valid('employee', 'manager').default('employee'),
  department: text(80).min(1),
  designation: text(100).min(2),
  manager_email: personEmail.allow(null, ''),
  joining_date: dateStr
});

// ============================================================ PUBLIC (no login)

const pub = express.Router();
pub.use(withIndexes);

const TEN_MINUTES = 10 * 60 * 1000;
const applyLimiter = createRateLimiter({ windowMs: TEN_MINUTES, max: 5 });    // successful applications
const attemptLimiter = createRateLimiter({ windowMs: TEN_MINUTES, max: 30 }); // all attempts (incl. invalid)

const openJobsFilter = () => ({
  status: 'open',
  $or: [{ closing_date: null }, { closing_date: '' }, { closing_date: { $exists: false } }, { closing_date: { $gte: todayStr() } }]
});

/**
 * GET /public/jobs?q=&department=&location=&employment_type=&work_mode=
 * Open roles for the careers page plus filter facets.
 */
pub.get('/jobs', handler('Public jobs', async (req, res, db) => {
  const all = await db.collection(COL.jobs).find(openJobsFilter(), NO_ID).sort({ published_at: -1, created_at: -1 }).toArray();
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
  const eq = (field) => {
    const v = String(req.query[field] || '').trim();
    return v ? (j) => String(j[field] || '').toLowerCase() === v.toLowerCase() : () => true;
  };
  const filters = ['department', 'location', 'employment_type', 'work_mode'].map(eq);
  const jobs = all.filter(j => filters.every(f => f(j)) && (!q || [j.title, j.department, j.location, j.description]
    .some(v => String(v || '').toLowerCase().includes(q))));
  const facet = (field) => [...new Set(all.map(j => j[field]).filter(Boolean))].sort();

  res.json({
    company_name: await companyName(db),
    jobs: jobs.map(j => publicJob(j)),
    total: jobs.length,
    facets: {
      departments: facet('department'),
      locations: facet('location'),
      employment_types: facet('employment_type'),
      work_modes: facet('work_mode')
    }
  });
}));

/** GET /public/jobs/:slug — job detail (closed jobs still render, without the form). */
pub.get('/jobs/:slug', handler('Public job', async (req, res, db) => {
  const job = await db.collection(COL.jobs).findOne({ slug: String(req.params.slug).toLowerCase() }, NO_ID);
  if (!job || job.status === 'draft') return fail(res, 404, 'Job not found');
  res.json({ company_name: await companyName(db), job: publicJob(job, { full: true }) });
}));

const applyGate = (req, res, next) => {
  const ip = clientIp(req);
  req.clientIp = ip;
  const attempts = attemptLimiter.check(ip);
  const successes = applyLimiter.check(ip);
  if (!attempts.allowed || !successes.allowed) {
    res.set('Retry-After', String(Math.max(attempts.retryAfterSec, successes.retryAfterSec)));
    return fail(res, 429, 'Too many applications from your network. Please try again in a few minutes.');
  }
  attemptLimiter.hit(ip);
  next();
};

/**
 * POST /public/jobs/:slug/apply   (multipart: resume + fields)
 * Abuse protection: honeypot field `website`, per-IP rate limit, duplicate
 * check (same email + job), field length limits, resume type/size checks.
 */
pub.post('/jobs/:slug/apply', applyGate, resumeUpload, handler('Public apply', async (req, res, db) => {
  // Honeypot: real users never see the field. Pretend success, store nothing.
  if (String(req.body?.website || '').trim()) {
    console.warn(`[recruitment] honeypot triggered from ${req.clientIp}`);
    return res.status(201).json({ message: 'Application received', reference: crypto.randomBytes(4).toString('hex').toUpperCase() });
  }

  const value = checkSchema(applySchema, req.body, res);
  if (!value) return;

  const job = await db.collection(COL.jobs).findOne({ slug: String(req.params.slug).toLowerCase() }, NO_ID);
  if (!job || job.status === 'draft') return fail(res, 404, 'Job not found');
  if (!isAccepting(job)) return fail(res, 410, 'This job is no longer accepting applications');

  const file = validateResumeFile(req.file);
  if (!file.ok) return fail(res, 422, file.error);

  if (await db.collection(COL.candidates).findOne({ job_id: job.id, email: value.email }, { projection: { _id: 1 } })) {
    return fail(res, 409, 'You have already applied for this role');
  }

  const parsed = parseResume(req.file.buffer, file.ext);
  const stored = await storeFile(req.file.buffer, file.fileName, file.mime, 'recruitment', job.id, { visibility: 'private' });
  const candidate = buildCandidate({
    job,
    name: value.name,
    email: value.email,
    phone: value.phone,
    linkedin_url: value.linkedin_url,
    cover_letter: value.cover_letter,
    source: 'careers_page',
    resume: resumeRecord(stored, file, req.file.size),
    parsed,
    by: null
  });
  candidate.consent = { given: true, at: new Date(), text_version: 'careers-v1' };
  candidate.applied_ip = req.clientIp;

  try {
    await db.collection(COL.candidates).insertOne(candidate);
  } catch (error) {
    await removeFile(stored.key);
    if (error.code === 11000) return fail(res, 409, 'You have already applied for this role');
    throw error;
  }
  applyLimiter.hit(req.clientIp);

  notifyEmails(db, [...await adminEmails(db), job.hiring_manager_email], {
    type: 'recruitment_application',
    title: `New application: ${job.title}`,
    message: `${candidate.name} applied via the careers page`,
    actionUrl: `/recruitment/candidates/${candidate.id}`,
    metadata: { candidate_id: candidate.id, job_id: job.id }
  });
  const company = await companyName(db);
  sendMailQuietly(candidate.email, `We received your application — ${job.title}`,
    `<p>Hi ${escapeHtml(candidate.name)},</p><p>Thank you for applying for <strong>${escapeHtml(job.title)}</strong> at ${escapeHtml(company)}. Our team will review your application and get back to you.</p><p>Reference: ${candidate.id.slice(0, 8).toUpperCase()}</p>`);

  res.status(201).json({ message: 'Application received', reference: candidate.id.slice(0, 8).toUpperCase() });
}));

router.use('/public', pub);

// ============================================================ shared candidate helpers

function resumeRecord(stored, file, size) {
  return {
    key: stored.key,
    url: stored.url,
    storage: stored.storage,
    file_name: file.fileName,
    mime_type: file.mime,
    size,
    uploaded_at: new Date()
  };
}

function buildCandidate({ job, name, email, phone, linkedin_url, cover_letter, source, source_detail, tags, resume, parsed, by, referral }) {
  const now = new Date();
  return {
    id: generateUUID(),
    job_id: job.id,
    job_title: job.title,
    department: job.department,
    name,
    email,
    phone: phone || parsed?.phone || null,
    linkedin_url: linkedin_url || parsed?.linkedin_url || null,
    cover_letter: cover_letter || '',
    source,
    source_detail: source_detail || '',
    referred_by_email: referral?.email || null,
    referred_by_name: referral?.name || null,
    referral_relationship: referral?.relationship || '',
    referral_note: referral?.note || '',
    tags: tags || [],
    rating: null,
    resume: resume || null,
    resume_parsed: parsed ? { email: parsed.email, phone: parsed.phone, linkedin_url: parsed.linkedin_url, method: parsed.method, found: parsed.found } : null,
    stage: 'applied',
    stage_changed_at: now,
    stage_history: [{
      stage: 'applied',
      from: null,
      at: now,
      by_email: by?.email || null,
      by_name: by?.name || (source === 'careers_page' ? 'Careers page' : 'System'),
      reason: ''
    }],
    notes: [],
    offer_status: null,
    offer_id: null,
    rejection_reason: null,
    created_by_email: by?.email || null,
    created_at: now,
    updated_at: now
  };
}

const loadCandidate = (db, id) => db.collection(COL.candidates).findOne({ id: String(id) }, NO_ID);
const loadJob = (db, id) => db.collection(COL.jobs).findOne({ id: String(id) }, NO_ID);

/** 'full' (admin / hiring manager), 'interviewer' (assigned to one of their interviews) or null. */
async function candidateAccess(db, user, candidate) {
  const job = await loadJob(db, candidate.job_id);
  if (managesJob(user, job)) return { level: 'full', job };
  const assigned = await db.collection(COL.interviews).findOne(
    { candidate_id: candidate.id, interviewer_emails: user.email, status: { $ne: 'cancelled' } },
    { projection: { _id: 1 } }
  );
  return { level: assigned ? 'interviewer' : null, job };
}

async function sendResume(res, resume) {
  if (!resume?.key) return fail(res, 404, 'No resume on file');
  const asciiName = String(resume.file_name || 'resume').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  res.setHeader('Content-Type', resume.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(resume.file_name || 'resume')}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');

  if (resume.key.startsWith('local/')) {
    const root = path.resolve(LOCAL_ROOT);
    const filePath = path.resolve(root, resume.key.slice('local/'.length));
    if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) {
      res.removeHeader('Content-Disposition');
      return fail(res, 404, 'Resume file not found');
    }
    return res.send(fs.readFileSync(filePath));
  }
  const url = await s3.getPresignedUrl(resume.key, 120);
  const upstream = await fetch(url);
  if (!upstream.ok) {
    res.removeHeader('Content-Disposition');
    return fail(res, 502, 'Could not fetch the resume from storage');
  }
  return res.send(Buffer.from(await upstream.arrayBuffer()));
}

// ============================================================ AUTHENTICATED

const app = express.Router();
app.use(authenticate, withIndexes);
router.use(app);

const staff = requireRole(['admin', 'manager']);
const adminOnly = requireRole(['admin']);

// ------------------------------------------------------------ people picker

/** GET /people?q= — employees for interviewer / hiring-manager pickers. */
app.get('/people', staff, handler('People', async (req, res, db) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const filter = q
    ? { $or: [{ full_name: { $regex: escapeRegex(q), $options: 'i' } }, { email: { $regex: escapeRegex(q), $options: 'i' } }, { department: { $regex: escapeRegex(q), $options: 'i' } }] }
    : {};
  if (req.query.role === 'manager') filter.role = { $in: ['manager', 'admin'] };
  const people = await db.collection('employees')
    .find(filter, { projection: { _id: 0, id: 1, full_name: 1, email: 1, department: 1, designation: 1, role: 1 } })
    .sort({ full_name: 1 })
    .limit(q ? 25 : 300)
    .toArray();
  res.json(people);
}));

// ------------------------------------------------------------ RC-1 requisitions

/** GET /requisitions?status= — admins see all, managers their own. */
app.get('/requisitions', staff, handler('List requisitions', async (req, res, db) => {
  const filter = isAdmin(req.user) ? {} : { requested_by_email: req.user.email };
  if (req.query.status && C.REQUISITION_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const list = await db.collection(COL.requisitions).find(filter, NO_ID).sort({ created_at: -1 }).limit(1000).toArray();
  res.json(list);
}));

app.post('/requisitions', staff, validate(requisitionCreate), handler('Create requisition', async (req, res, db) => {
  const data = req.validatedBody;
  const problem = rangeError(data);
  if (problem) return fail(res, 422, problem);
  let hiringManager = null;
  if (data.hiring_manager_email && isAdmin(req.user)) {
    hiringManager = await findEmployeeByEmail(db, data.hiring_manager_email);
    if (!hiringManager || !['manager', 'admin'].includes(hiringManager.role)) {
      return fail(res, 422, 'Hiring manager must be an existing manager or admin');
    }
  }
  const now = new Date();
  const requisition = {
    id: generateUUID(),
    ...data,
    target_start_date: data.target_start_date || null,
    hiring_manager_email: hiringManager?.email || (req.user.role === 'manager' ? req.user.email : null),
    hiring_manager_name: hiringManager?.full_name || (req.user.role === 'manager' ? req.user.full_name : null),
    status: 'pending',
    requested_by_email: req.user.email,
    requested_by_name: req.user.full_name || req.user.email,
    decided_by_email: null,
    decided_by_name: null,
    decided_at: null,
    decision_note: '',
    job_id: null,
    created_at: now,
    updated_at: now
  };
  await db.collection(COL.requisitions).insertOne(requisition);
  delete requisition._id;

  notifyEmails(db, await adminEmails(db), {
    type: 'recruitment_requisition',
    title: 'New job requisition',
    message: `${requisition.requested_by_name} requested ${requisition.headcount} × ${requisition.title} (${requisition.department})`,
    actionUrl: '/recruitment/requisitions',
    metadata: { requisition_id: requisition.id }
  }, req.user.email);
  res.status(201).json(requisition);
}));

const loadOwnRequisition = async (db, req, res) => {
  const requisition = await db.collection(COL.requisitions).findOne({ id: req.params.id }, NO_ID);
  if (!requisition) { fail(res, 404, 'Requisition not found'); return null; }
  if (!isAdmin(req.user) && requisition.requested_by_email !== req.user.email) { fail(res, 403, 'Not enough permissions'); return null; }
  return requisition;
};

app.put('/requisitions/:id', staff, validate(requisitionUpdate), handler('Update requisition', async (req, res, db) => {
  const requisition = await loadOwnRequisition(db, req, res);
  if (!requisition) return;
  if (requisition.status !== 'pending') return fail(res, 400, 'Only pending requisitions can be edited');
  const updates = { ...req.validatedBody };
  if ('hiring_manager_email' in updates) {
    if (!isAdmin(req.user)) delete updates.hiring_manager_email;
    else if (updates.hiring_manager_email) {
      const hm = await findEmployeeByEmail(db, updates.hiring_manager_email);
      if (!hm || !['manager', 'admin'].includes(hm.role)) return fail(res, 422, 'Hiring manager must be an existing manager or admin');
      updates.hiring_manager_email = hm.email;
      updates.hiring_manager_name = hm.full_name;
    } else {
      updates.hiring_manager_email = null;
      updates.hiring_manager_name = null;
    }
  }
  const merged = { ...requisition, ...updates };
  const problem = rangeError(merged);
  if (problem) return fail(res, 422, problem);
  await db.collection(COL.requisitions).updateOne({ id: requisition.id }, { $set: { ...updates, updated_at: new Date() } });
  res.json(await db.collection(COL.requisitions).findOne({ id: requisition.id }, NO_ID));
}));

app.post('/requisitions/:id/cancel', staff, handler('Cancel requisition', async (req, res, db) => {
  const requisition = await loadOwnRequisition(db, req, res);
  if (!requisition) return;
  if (requisition.status !== 'pending') return fail(res, 400, 'Only pending requisitions can be cancelled');
  await db.collection(COL.requisitions).updateOne({ id: requisition.id }, { $set: { status: 'cancelled', updated_at: new Date() } });
  res.json({ ...requisition, status: 'cancelled' });
}));

/** Job posting (draft) created from an approved requisition. */
async function jobFromRequisition(db, requisition, req) {
  const now = new Date();
  const job = {
    id: generateUUID(),
    requisition_id: requisition.id,
    title: requisition.title,
    slug: await uniqueSlug(db, requisition.title),
    department: requisition.department,
    location: requisition.location,
    employment_type: requisition.employment_type,
    work_mode: requisition.work_mode || 'onsite',
    experience_min: requisition.experience_min ?? null,
    experience_max: requisition.experience_max ?? null,
    salary_min: requisition.budget_min ?? null,
    salary_max: requisition.budget_max ?? null,
    show_salary: false,
    headcount: requisition.headcount || 1,
    hires_count: 0,
    description: '',
    requirements: '',
    benefits: '',
    closing_date: null,
    hiring_manager_email: requisition.hiring_manager_email || null,
    hiring_manager_name: requisition.hiring_manager_name || null,
    scorecard_criteria: [...C.DEFAULT_SCORECARD_CRITERIA],
    status: 'draft',
    published_at: null,
    closed_at: null,
    created_by_email: requisition.requested_by_email,
    created_by_name: requisition.requested_by_name,
    approved_by_email: req.user.email,
    created_at: now,
    updated_at: now
  };
  await db.collection(COL.jobs).insertOne(job);
  delete job._id;
  return job;
}

app.post('/requisitions/:id/approve', adminOnly, validate(decisionSchema), handler('Approve requisition', async (req, res, db) => {
  const requisition = await db.collection(COL.requisitions).findOne({ id: req.params.id }, NO_ID);
  if (!requisition) return fail(res, 404, 'Requisition not found');
  if (requisition.status !== 'pending') return fail(res, 400, `Requisition is already ${requisition.status}`);

  const now = new Date();
  const claimed = await db.collection(COL.requisitions).updateOne(
    { id: requisition.id, status: 'pending' },
    { $set: { status: 'approved', decided_by_email: req.user.email, decided_by_name: req.user.full_name, decided_at: now, decision_note: req.validatedBody.note || '', updated_at: now } }
  );
  if (!claimed.modifiedCount) return fail(res, 409, 'Requisition was already decided');

  let job = null;
  if (req.validatedBody.create_job) {
    job = await jobFromRequisition(db, requisition, req);
    await db.collection(COL.requisitions).updateOne({ id: requisition.id }, { $set: { job_id: job.id } });
  }
  notifyEmails(db, [requisition.requested_by_email], {
    type: 'recruitment_requisition',
    title: 'Requisition approved',
    message: `Your requisition for ${requisition.title} was approved${job ? ' — a draft job posting is ready to publish' : ''}`,
    actionUrl: job ? `/recruitment/jobs/${job.id}` : '/recruitment/requisitions',
    metadata: { requisition_id: requisition.id, job_id: job?.id || null }
  }, req.user.email);
  emitEvent('requisition.approved', { requisition_id: requisition.id, title: requisition.title, job_id: job?.id || null });

  res.json({ requisition: await db.collection(COL.requisitions).findOne({ id: requisition.id }, NO_ID), job: jobOut(job) });
}));

app.post('/requisitions/:id/reject', adminOnly, validate(rejectSchema), handler('Reject requisition', async (req, res, db) => {
  const requisition = await db.collection(COL.requisitions).findOne({ id: req.params.id }, NO_ID);
  if (!requisition) return fail(res, 404, 'Requisition not found');
  if (requisition.status !== 'pending') return fail(res, 400, `Requisition is already ${requisition.status}`);
  const now = new Date();
  await db.collection(COL.requisitions).updateOne(
    { id: requisition.id, status: 'pending' },
    { $set: { status: 'rejected', decided_by_email: req.user.email, decided_by_name: req.user.full_name, decided_at: now, decision_note: req.validatedBody.note, updated_at: now } }
  );
  notifyEmails(db, [requisition.requested_by_email], {
    type: 'recruitment_requisition',
    title: 'Requisition rejected',
    message: `Your requisition for ${requisition.title} was rejected: ${req.validatedBody.note}`,
    actionUrl: '/recruitment/requisitions',
    metadata: { requisition_id: requisition.id }
  }, req.user.email);
  res.json(await db.collection(COL.requisitions).findOne({ id: requisition.id }, NO_ID));
}));

// ------------------------------------------------------------ RC-1 jobs

const stageCountsByJob = async (db, jobIds) => {
  const rows = await db.collection(COL.candidates).aggregate([
    { $match: { job_id: { $in: jobIds } } },
    { $group: { _id: { job: '$job_id', stage: '$stage' }, n: { $sum: 1 } } }
  ]).toArray();
  const map = {};
  for (const r of rows) {
    map[r._id.job] = map[r._id.job] || { total: 0, active: 0 };
    map[r._id.job][r._id.stage] = r.n;
    map[r._id.job].total += r.n;
    if (C.ACTIVE_STAGES.includes(r._id.stage)) map[r._id.job].active += r.n;
  }
  return map;
};

/** GET /jobs?status=&q= — admin: all; manager: jobs they manage. Includes candidate counts. */
app.get('/jobs', staff, handler('List jobs', async (req, res, db) => {
  const clauses = [managedJobFilter(req.user)];
  if (req.query.status && C.JOB_STATUSES.includes(req.query.status)) clauses.push({ status: req.query.status });
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    clauses.push({ $or: [{ title: { $regex: escapeRegex(q), $options: 'i' } }, { department: { $regex: escapeRegex(q), $options: 'i' } }, { location: { $regex: escapeRegex(q), $options: 'i' } }] });
  }
  const filter = allOf(...clauses);
  const jobs = await db.collection(COL.jobs).find(filter, NO_ID).sort({ created_at: -1 }).limit(1000).toArray();
  const counts = await stageCountsByJob(db, jobs.map(j => j.id));
  res.json(jobs.map(j => ({ ...jobOut(j), counts: counts[j.id] || { total: 0, active: 0 } })));
}));

/** GET /jobs/open — open roles for any employee (referrals). */
app.get('/jobs/open', handler('Open jobs', async (req, res, db) => {
  const jobs = await db.collection(COL.jobs).find(openJobsFilter(), NO_ID).sort({ published_at: -1 }).toArray();
  res.json(jobs.map(j => publicJob(j)));
}));

app.post('/jobs', adminOnly, validate(jobCreate), handler('Create job', async (req, res, db) => {
  const data = req.validatedBody;
  const problem = rangeError(data);
  if (problem) return fail(res, 422, problem);

  let hm = null;
  if (data.hiring_manager_email) {
    hm = await findEmployeeByEmail(db, data.hiring_manager_email);
    if (!hm || !['manager', 'admin'].includes(hm.role)) return fail(res, 422, 'Hiring manager must be an existing manager or admin');
  }
  if (data.requisition_id) {
    const requisition = await db.collection(COL.requisitions).findOne({ id: data.requisition_id });
    if (!requisition || requisition.status !== 'approved') return fail(res, 400, 'Requisition must exist and be approved');
  }
  if (data.slug && await db.collection(COL.jobs).findOne({ slug: data.slug })) return fail(res, 409, 'That URL slug is already in use');

  const now = new Date();
  const job = {
    id: generateUUID(),
    requisition_id: data.requisition_id || null,
    ...data,
    slug: data.slug || await uniqueSlug(db, data.title),
    experience_min: data.experience_min ?? null,
    experience_max: data.experience_max ?? null,
    salary_min: data.salary_min ?? null,
    salary_max: data.salary_max ?? null,
    closing_date: data.closing_date || null,
    hiring_manager_email: hm?.email || null,
    hiring_manager_name: hm?.full_name || null,
    scorecard_criteria: data.scorecard_criteria || [...C.DEFAULT_SCORECARD_CRITERIA],
    hires_count: 0,
    status: 'draft',
    published_at: null,
    closed_at: null,
    created_by_email: req.user.email,
    created_by_name: req.user.full_name,
    created_at: now,
    updated_at: now
  };
  await db.collection(COL.jobs).insertOne(job);
  if (job.requisition_id) {
    await db.collection(COL.requisitions).updateOne({ id: job.requisition_id, job_id: null }, { $set: { job_id: job.id, updated_at: now } });
  }
  res.status(201).json(jobOut(job));
}));

const loadManagedJob = async (db, req, res) => {
  const job = await loadJob(db, req.params.id);
  if (!job) { fail(res, 404, 'Job not found'); return null; }
  if (!managesJob(req.user, job)) { fail(res, 403, 'Not enough permissions'); return null; }
  return job;
};

app.get('/jobs/:id', staff, handler('Get job', async (req, res, db) => {
  const job = await loadManagedJob(db, req, res);
  if (!job) return;
  const counts = await stageCountsByJob(db, [job.id]);
  const requisition = job.requisition_id
    ? await db.collection(COL.requisitions).findOne({ id: job.requisition_id }, { projection: { _id: 0, id: 1, title: 1, justification: 1, budget_min: 1, budget_max: 1, requested_by_name: 1, status: 1 } })
    : null;
  res.json({ ...jobOut(job), counts: counts[job.id] || { total: 0, active: 0 }, requisition });
}));

app.put('/jobs/:id', staff, validate(jobUpdate), handler('Update job', async (req, res, db) => {
  const job = await loadManagedJob(db, req, res);
  if (!job) return;
  const updates = { ...req.validatedBody };

  if ('hiring_manager_email' in updates) {
    if (!isAdmin(req.user)) return fail(res, 403, 'Only admins can change the hiring manager');
    if (updates.hiring_manager_email) {
      const hm = await findEmployeeByEmail(db, updates.hiring_manager_email);
      if (!hm || !['manager', 'admin'].includes(hm.role)) return fail(res, 422, 'Hiring manager must be an existing manager or admin');
      updates.hiring_manager_email = hm.email;
      updates.hiring_manager_name = hm.full_name;
    } else {
      updates.hiring_manager_email = null;
      updates.hiring_manager_name = null;
    }
  }
  if (updates.slug && updates.slug !== job.slug) {
    if (await db.collection(COL.jobs).findOne({ slug: updates.slug, id: { $ne: job.id } })) return fail(res, 409, 'That URL slug is already in use');
  }
  if (updates.closing_date === '') updates.closing_date = null;
  const merged = { ...job, ...updates };
  const problem = rangeError(merged);
  if (problem) return fail(res, 422, problem);
  if (merged.status === 'open' && merged.closing_date && merged.closing_date < todayStr()) {
    return fail(res, 422, 'Closing date cannot be in the past for an open job');
  }

  await db.collection(COL.jobs).updateOne({ id: job.id }, { $set: { ...updates, updated_at: new Date() } });
  if (updates.title && updates.title !== job.title) {
    await db.collection(COL.candidates).updateMany({ job_id: job.id }, { $set: { job_title: updates.title } });
    await db.collection(COL.interviews).updateMany({ job_id: job.id }, { $set: { job_title: updates.title } });
  }
  res.json(jobOut(await loadJob(db, job.id)));
}));

/** POST /jobs/:id/status { status: draft|open|closed } — publish / unpublish / close. */
app.post('/jobs/:id/status', staff, validate(jobStatusSchema), handler('Job status', async (req, res, db) => {
  const job = await loadManagedJob(db, req, res);
  if (!job) return;
  const { status } = req.validatedBody;
  if (status === job.status) return res.json(jobOut(job));

  const set = { status, updated_at: new Date() };
  if (status === 'open') {
    if (String(job.description || '').trim().length < 30) return fail(res, 422, 'Add a job description (at least 30 characters) before publishing');
    if (job.closing_date && job.closing_date < todayStr()) return fail(res, 422, 'The closing date has passed — update it before publishing');
    if (!job.published_at) set.published_at = new Date();
    set.closed_at = null;
    set.closed_reason = null;
  }
  if (status === 'closed') {
    set.closed_at = new Date();
    set.closed_reason = 'manual';
  }
  await db.collection(COL.jobs).updateOne({ id: job.id }, { $set: set });
  if (status === 'open') emitEvent('job.published', { job_id: job.id, title: job.title, slug: job.slug });
  res.json(jobOut(await loadJob(db, job.id)));
}));

app.delete('/jobs/:id', adminOnly, handler('Delete job', async (req, res, db) => {
  const job = await loadJob(db, req.params.id);
  if (!job) return fail(res, 404, 'Job not found');
  if (await db.collection(COL.candidates).countDocuments({ job_id: job.id })) {
    return fail(res, 400, 'This job has candidates — close it instead of deleting it');
  }
  await db.collection(COL.jobs).deleteOne({ id: job.id });
  if (job.requisition_id) await db.collection(COL.requisitions).updateOne({ id: job.requisition_id, job_id: job.id }, { $set: { job_id: null } });
  res.json({ message: 'Job deleted' });
}));

/** GET /jobs/:id/pipeline — Kanban data: candidates grouped by stage. */
app.get('/jobs/:id/pipeline', staff, handler('Pipeline', async (req, res, db) => {
  const job = await loadManagedJob(db, req, res);
  if (!job) return;
  const candidates = await db.collection(COL.candidates).find({ job_id: job.id }, NO_ID).sort({ stage_changed_at: -1 }).toArray();
  const upcoming = await db.collection(COL.interviews).aggregate([
    { $match: { job_id: job.id, status: 'scheduled', scheduled_at: { $gte: new Date() } } },
    { $group: { _id: '$candidate_id', n: { $sum: 1 }, next: { $min: '$scheduled_at' } } }
  ]).toArray();
  const upMap = Object.fromEntries(upcoming.map(u => [u._id, u]));
  const cards = candidates.map(c => ({ ...candidateCard(c), upcoming_interviews: upMap[c.id]?.n || 0, next_interview_at: upMap[c.id]?.next || null }));
  res.json({
    job: jobOut(job),
    stages: C.STAGES.map(key => ({ key, label: C.STAGE_LABELS[key], candidates: cards.filter(c => c.stage === key) })),
    total: cards.length
  });
}));

// ------------------------------------------------------------ analytics + summary

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** GET /analytics?job_id= — candidates per stage, sources, funnel, time-to-hire, offers. */
app.get('/analytics', staff, handler('Analytics', async (req, res, db) => {
  const jobFilter = allOf(managedJobFilter(req.user), req.query.job_id ? { id: String(req.query.job_id) } : null);
  const jobs = await db.collection(COL.jobs).find(jobFilter, NO_ID).toArray();
  const jobIds = jobs.map(j => j.id);
  const candidates = await db.collection(COL.candidates)
    .find({ job_id: { $in: jobIds } }, { projection: { _id: 0, id: 1, job_id: 1, stage: 1, source: 1, created_at: 1, hired_at: 1, stage_history: 1 } })
    .toArray();
  const offers = await db.collection(COL.offers).find({ job_id: { $in: jobIds } }, { projection: { _id: 0, status: 1 } }).toArray();

  const byStage = Object.fromEntries(C.STAGES.map(s => [s, 0]));
  const bySource = Object.fromEntries(C.SOURCES.map(s => [s, 0]));
  const reached = Object.fromEntries(['applied', 'screening', 'interview', 'offer', 'hired'].map(s => [s, 0]));
  const hireDays = [];
  for (const c of candidates) {
    byStage[c.stage] = (byStage[c.stage] || 0) + 1;
    bySource[c.source] = (bySource[c.source] || 0) + 1;
    const seen = new Set((c.stage_history || []).map(h => h.stage));
    seen.add(c.stage);
    for (const s of Object.keys(reached)) if (seen.has(s)) reached[s] += 1;
    if (c.stage === 'hired' && c.hired_at && c.created_at) {
      hireDays.push((new Date(c.hired_at) - new Date(c.created_at)) / 86400000);
    }
  }

  // Applications per ISO week (last 8 weeks)
  const weeks = [];
  const startOfWeek = (d) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x;
  };
  const thisWeek = startOfWeek(new Date());
  for (let i = 7; i >= 0; i--) {
    const start = new Date(thisWeek.getTime() - i * 7 * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    weeks.push({ week_start: start.toISOString().slice(0, 10), applications: candidates.filter(c => new Date(c.created_at) >= start && new Date(c.created_at) < end).length });
  }

  const offerCounts = Object.fromEntries(C.OFFER_STATUSES.map(s => [s, 0]));
  offers.forEach(o => { offerCounts[o.status] = (offerCounts[o.status] || 0) + 1; });
  const decided = offerCounts.accepted + offerCounts.declined + offerCounts.expired;

  const perJob = jobs.map(j => {
    const list = candidates.filter(c => c.job_id === j.id);
    return {
      job_id: j.id,
      title: j.title,
      department: j.department,
      status: j.status,
      headcount: j.headcount,
      hires: list.filter(c => c.stage === 'hired').length,
      total: list.length,
      active: list.filter(c => C.ACTIVE_STAGES.includes(c.stage)).length
    };
  }).sort((a, b) => b.total - a.total);

  res.json({
    jobs: { total: jobs.length, open: jobs.filter(j => j.status === 'open').length, draft: jobs.filter(j => j.status === 'draft').length, closed: jobs.filter(j => j.status === 'closed').length },
    candidates: { total: candidates.length, active: candidates.filter(c => C.ACTIVE_STAGES.includes(c.stage)).length },
    by_stage: C.STAGES.map(s => ({ stage: s, label: C.STAGE_LABELS[s], count: byStage[s] || 0 })),
    by_source: Object.entries(bySource).map(([source, count]) => ({ source, count })),
    funnel: Object.entries(reached).map(([stage, count]) => ({ stage, label: C.STAGE_LABELS[stage], count })),
    time_to_hire: {
      hires: hireDays.length,
      average_days: hireDays.length ? round2(hireDays.reduce((a, b) => a + b, 0) / hireDays.length) : null,
      median_days: hireDays.length ? round2(median(hireDays)) : null,
      fastest_days: hireDays.length ? round2(Math.min(...hireDays)) : null,
      slowest_days: hireDays.length ? round2(Math.max(...hireDays)) : null
    },
    offers: { ...offerCounts, acceptance_rate: decided ? round2((offerCounts.accepted / decided) * 100) : null },
    applications_by_week: weeks,
    per_job: perJob
  });
}));

/** GET /summary — dashboard widget data for the current user. */
app.get('/summary', handler('Summary', async (req, res, db) => {
  const now = new Date();
  const mine = await db.collection(COL.interviews)
    .find({ interviewer_emails: req.user.email, status: 'scheduled', scheduled_at: { $gte: new Date(now.getTime() - 60 * 60000) } }, NO_ID)
    .sort({ scheduled_at: 1 }).limit(5).toArray();
  const past = await db.collection(COL.interviews)
    .find({ interviewer_emails: req.user.email, status: { $in: ['scheduled', 'completed'] }, scheduled_at: { $lt: now } }, { projection: { _id: 0, id: 1 } })
    .toArray();
  const submitted = past.length
    ? await db.collection(COL.scorecards).countDocuments({ interview_id: { $in: past.map(i => i.id) }, interviewer_email: req.user.email })
    : 0;
  const out = {
    my_upcoming_interviews: mine.map(i => ({ id: i.id, candidate_name: i.candidate_name, job_title: i.job_title, round_name: i.round_name, scheduled_at: i.scheduled_at, duration_minutes: i.duration_minutes, mode: i.mode, meeting_link: i.meeting_link })),
    pending_scorecards: Math.max(0, past.length - submitted),
    my_referrals: await db.collection(COL.candidates).countDocuments({ referred_by_email: req.user.email })
  };
  if (['admin', 'manager'].includes(req.user.role)) {
    const jobIds = await managedJobIds(db, req.user);
    const jobScope = jobIds ? { job_id: { $in: jobIds } } : {};
    out.open_jobs = await db.collection(COL.jobs).countDocuments(allOf(managedJobFilter(req.user), { status: 'open' }));
    out.new_applications_7d = await db.collection(COL.candidates).countDocuments(allOf(jobScope, { created_at: { $gte: new Date(now.getTime() - 7 * 86400000) } }));
    out.active_candidates = await db.collection(COL.candidates).countDocuments(allOf(jobScope, { stage: { $in: C.ACTIVE_STAGES } }));
    out.interviews_this_week = await db.collection(COL.interviews).countDocuments(allOf(jobScope, { status: 'scheduled', scheduled_at: { $gte: now, $lt: new Date(now.getTime() + 7 * 86400000) } }));
    out.offers_awaiting_response = await db.collection(COL.offers).countDocuments(allOf(jobScope, { status: 'sent' }));
    out.pending_requisitions = await db.collection(COL.requisitions).countDocuments(isAdmin(req.user) ? { status: 'pending' } : { status: 'pending', requested_by_email: req.user.email });
  }
  res.json(out);
}));

// ------------------------------------------------------------ RC-2 candidates

/** GET /candidates?q=&job_id=&stage=&source=&tag=&min_rating=&page=&limit= */
app.get('/candidates', staff, handler('List candidates', async (req, res, db) => {
  const filter = {};
  const ids = await managedJobIds(db, req.user);
  const scope = ids ? { job_id: { $in: ids } } : {};
  if (req.query.job_id) {
    const jobId = String(req.query.job_id);
    if (ids && !ids.includes(jobId)) return fail(res, 403, 'Not enough permissions');
    filter.job_id = jobId;
  }
  if (req.query.stage) {
    const stages = String(req.query.stage).split(',').filter(s => C.STAGES.includes(s));
    if (stages.length) filter.stage = { $in: stages };
  }
  if (req.query.source && C.SOURCES.includes(req.query.source)) filter.source = req.query.source;
  if (req.query.tag) filter.tags = String(req.query.tag).toLowerCase().slice(0, 30);
  const minRating = Number(req.query.min_rating);
  if (minRating >= 1 && minRating <= 5) filter.rating = { $gte: minRating };
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { job_title: rx }, { tags: q.toLowerCase() }];
  }
  const query = allOf(scope, filter);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const [total, list] = await Promise.all([
    db.collection(COL.candidates).countDocuments(query),
    db.collection(COL.candidates).find(query, NO_ID).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray()
  ]);
  res.json({ candidates: list.map(candidateCard), total, page, limit });
}));

/** POST /candidates/parse-resume (multipart) — extract email/phone/LinkedIn to prefill a form. */
app.post('/candidates/parse-resume', resumeUpload, handler('Parse resume', async (req, res) => {
  const file = validateResumeFile(req.file);
  if (!file.ok) return fail(res, 422, file.error);
  res.json(parseResume(req.file.buffer, file.ext));
}));

/** GET /candidates/check-duplicate?email= — existing applications with this email. */
app.get('/candidates/check-duplicate', staff, handler('Duplicate check', async (req, res, db) => {
  const { error, value: email } = emailSchema.required().validate(req.query.email);
  if (error) return fail(res, 422, 'Enter a valid email');
  const matches = await db.collection(COL.candidates).find({ email }, NO_ID).toArray();
  const ids = await managedJobIds(db, req.user);
  const visible = ids ? matches.filter(m => ids.includes(m.job_id)) : matches;
  res.json({
    email,
    duplicate: matches.length > 0,
    matches: visible.map(candidateCard),
    other_jobs_count: matches.length - visible.length
  });
}));

/** POST /candidates (multipart; resume optional) — manual add by admin / hiring manager. */
app.post('/candidates', staff, resumeUpload, handler('Create candidate', async (req, res, db) => {
  const body = { ...req.body, tags: parseTags(req.body?.tags) };
  const value = checkSchema(candidateCreate, body, res);
  if (!value) return;
  const job = await loadJob(db, value.job_id);
  if (!job) return fail(res, 404, 'Job not found');
  if (!managesJob(req.user, job)) return fail(res, 403, 'Not enough permissions');
  if (job.status === 'closed') return fail(res, 400, 'This job is closed');

  let file = null;
  if (req.file) {
    file = validateResumeFile(req.file);
    if (!file.ok) return fail(res, 422, file.error);
  }
  const existing = await db.collection(COL.candidates).findOne({ job_id: job.id, email: value.email }, NO_ID);
  if (existing) return fail(res, 409, 'A candidate with this email already applied for this job', { candidate_id: existing.id });
  const otherApplications = await db.collection(COL.candidates)
    .find({ email: value.email }, { projection: { _id: 0, id: 1, job_id: 1, job_title: 1, stage: 1 } }).toArray();

  const parsed = file ? parseResume(req.file.buffer, file.ext) : null;
  const stored = file ? await storeFile(req.file.buffer, file.fileName, file.mime, 'recruitment', job.id, { visibility: 'private' }) : null;
  const candidate = buildCandidate({
    job,
    name: value.name,
    email: value.email,
    phone: value.phone,
    linkedin_url: value.linkedin_url,
    cover_letter: value.cover_letter,
    source: value.source,
    source_detail: value.source_detail,
    tags: value.tags,
    resume: stored ? resumeRecord(stored, file, req.file.size) : null,
    parsed,
    by: actor(req)
  });
  try {
    await db.collection(COL.candidates).insertOne(candidate);
  } catch (error) {
    if (stored) await removeFile(stored.key);
    if (error.code === 11000) return fail(res, 409, 'A candidate with this email already applied for this job');
    throw error;
  }
  const ids = await managedJobIds(db, req.user);
  res.status(201).json({
    candidate: candidateOut(candidate),
    duplicates: otherApplications.filter(o => !ids || ids.includes(o.job_id)),
    duplicate_count: otherApplications.length
  });
}));

async function scorecardSummary(db, candidateId) {
  const cards = await db.collection(COL.scorecards).find({ candidate_id: candidateId }, NO_ID).sort({ submitted_at: 1 }).toArray();
  const criteria = new Map();
  const recommendations = Object.fromEntries(C.RECOMMENDATIONS.map(r => [r, 0]));
  let recScore = 0;
  for (const card of cards) {
    recommendations[card.recommendation] += 1;
    recScore += C.RECOMMENDATION_SCORE[card.recommendation] || 0;
    for (const r of card.ratings || []) {
      const agg = criteria.get(r.criterion) || { sum: 0, count: 0 };
      agg.sum += r.rating;
      agg.count += 1;
      criteria.set(r.criterion, agg);
    }
  }
  const avgRec = cards.length ? recScore / cards.length : null;
  return {
    count: cards.length,
    average_rating: cards.length ? round2(cards.reduce((s, c) => s + (c.overall_rating || 0), 0) / cards.length) : null,
    recommendations,
    recommendation_score: avgRec == null ? null : round2(avgRec),
    verdict: avgRec == null ? null : avgRec >= 1.5 ? 'strong_hire' : avgRec > 0 ? 'hire' : avgRec <= -1.5 ? 'strong_no_hire' : 'no_hire',
    criteria: [...criteria.entries()].map(([criterion, a]) => ({ criterion, average: round2(a.sum / a.count), count: a.count })),
    scorecards: cards
  };
}

/** GET /candidates/:id — full profile (admin / hiring manager) or limited view (assigned interviewer). */
app.get('/candidates/:id', handler('Get candidate', async (req, res, db) => {
  const candidate = await loadCandidate(db, req.params.id);
  if (!candidate) return fail(res, 404, 'Candidate not found');
  const { level, job } = await candidateAccess(db, req.user, candidate);
  if (!level) return fail(res, 403, 'Not enough permissions');

  if (level === 'interviewer') {
    return res.json({
      access: 'interviewer',
      candidate: candidateForInterviewer(candidate),
      job: job ? { id: job.id, title: job.title, department: job.department, scorecard_criteria: job.scorecard_criteria || C.DEFAULT_SCORECARD_CRITERIA } : null
    });
  }

  const [interviews, offers, others, summary] = await Promise.all([
    db.collection(COL.interviews).find({ candidate_id: candidate.id }, NO_ID).sort({ scheduled_at: 1 }).toArray(),
    db.collection(COL.offers).find({ candidate_id: candidate.id }, NO_ID).sort({ created_at: -1 }).toArray(),
    db.collection(COL.candidates).find({ email: candidate.email, id: { $ne: candidate.id } }, NO_ID).toArray(),
    scorecardSummary(db, candidate.id)
  ]);
  const ids = await managedJobIds(db, req.user);
  res.json({
    access: 'full',
    candidate: candidateOut(candidate),
    job: jobOut(job),
    interviews,
    offers,
    other_applications: others.filter(o => !ids || ids.includes(o.job_id)).map(candidateCard),
    scorecard_summary: summary
  });
}));

const loadFullCandidate = async (db, req, res) => {
  const candidate = await loadCandidate(db, req.params.id);
  if (!candidate) { fail(res, 404, 'Candidate not found'); return {}; }
  const { level, job } = await candidateAccess(db, req.user, candidate);
  if (level !== 'full') { fail(res, 403, 'Not enough permissions'); return {}; }
  return { candidate, job };
};

app.put('/candidates/:id', staff, validate(candidateUpdate), handler('Update candidate', async (req, res, db) => {
  const { candidate } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  const updates = { ...req.validatedBody };
  if (updates.tags) updates.tags = [...new Set(updates.tags.map(t => t.toLowerCase()))];
  await db.collection(COL.candidates).updateOne({ id: candidate.id }, { $set: { ...updates, updated_at: new Date() } });
  if (updates.name && updates.name !== candidate.name) {
    await db.collection(COL.interviews).updateMany({ candidate_id: candidate.id }, { $set: { candidate_name: updates.name } });
  }
  res.json(candidateOut(await loadCandidate(db, candidate.id)));
}));

/** POST /candidates/:id/stage { stage, reason } */
app.post('/candidates/:id/stage', staff, validate(stageSchema), handler('Move candidate', async (req, res, db) => {
  const { candidate } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  const { stage, reason } = req.validatedBody;
  if (candidate.stage === 'hired') return fail(res, 409, 'Hired candidates cannot be moved');
  if (stage === 'hired') return fail(res, 400, 'Use "Convert to employee" on an accepted offer to mark a candidate hired');
  if (stage === candidate.stage) return res.json(candidateOut(candidate));

  const now = new Date();
  const set = { stage, stage_changed_at: now, updated_at: now };
  if (stage === 'rejected') set.rejection_reason = reason;
  else set.rejection_reason = null;
  await db.collection(COL.candidates).updateOne(
    { id: candidate.id },
    { $set: set, $push: { stage_history: historyEntry(req, { stage, from: candidate.stage, reason: reason || '' }) } }
  );

  // Rejected / withdrawn: cancel their upcoming interviews
  if (['rejected', 'withdrawn'].includes(stage)) {
    const upcoming = await db.collection(COL.interviews)
      .find({ candidate_id: candidate.id, status: 'scheduled', scheduled_at: { $gte: now } }, NO_ID).toArray();
    if (upcoming.length) {
      await db.collection(COL.interviews).updateMany(
        { id: { $in: upcoming.map(i => i.id) } },
        { $set: { status: 'cancelled', cancel_reason: `Candidate ${stage}`, cancelled_at: now, updated_at: now }, $inc: { sequence: 1 } }
      );
      for (const i of upcoming) {
        notifyEmails(db, i.interviewer_emails, {
          type: 'recruitment_interview',
          title: 'Interview cancelled',
          message: `${i.round_name} with ${i.candidate_name} on ${new Date(i.scheduled_at).toUTCString()} was cancelled`,
          actionUrl: '/recruitment/interviews',
          metadata: { interview_id: i.id }
        });
      }
    }
  }

  if (candidate.referred_by_email && C.REFERRAL_STATUS[stage] !== C.REFERRAL_STATUS[candidate.stage]) {
    notifyEmails(db, [candidate.referred_by_email], {
      type: 'recruitment_referral',
      title: 'Referral update',
      message: `${candidate.name} (${candidate.job_title}): ${C.REFERRAL_STATUS[stage]}`,
      actionUrl: '/recruitment/my-referrals',
      metadata: { candidate_id: candidate.id }
    }, req.user.email);
  }
  emitEvent('candidate.stage_changed', { candidate_id: candidate.id, job_id: candidate.job_id, from: candidate.stage, to: stage });
  res.json(candidateOut(await loadCandidate(db, candidate.id)));
}));

app.post('/candidates/:id/notes', staff, validate(noteSchema), handler('Add note', async (req, res, db) => {
  const { candidate } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  const note = { id: generateUUID(), text: req.validatedBody.text, by_email: req.user.email, by_name: req.user.full_name || req.user.email, at: new Date() };
  await db.collection(COL.candidates).updateOne({ id: candidate.id }, { $push: { notes: note }, $set: { updated_at: new Date() } });
  res.status(201).json(note);
}));

app.delete('/candidates/:id/notes/:noteId', staff, handler('Delete note', async (req, res, db) => {
  const { candidate } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  const note = (candidate.notes || []).find(n => n.id === req.params.noteId);
  if (!note) return fail(res, 404, 'Note not found');
  if (note.by_email !== req.user.email && !isAdmin(req.user)) return fail(res, 403, 'You can only delete your own notes');
  await db.collection(COL.candidates).updateOne({ id: candidate.id }, { $pull: { notes: { id: note.id } } });
  res.json({ message: 'Note deleted' });
}));

/** GET /candidates/:id/resume — download (admin, hiring manager, assigned interviewer). */
app.get('/candidates/:id/resume', handler('Download resume', async (req, res, db) => {
  const candidate = await loadCandidate(db, req.params.id);
  if (!candidate) return fail(res, 404, 'Candidate not found');
  const { level } = await candidateAccess(db, req.user, candidate);
  if (!level) return fail(res, 403, 'Not enough permissions');
  await sendResume(res, candidate.resume);
}));

/** POST /candidates/:id/resume (multipart) — replace the resume; returns parsed suggestions. */
app.post('/candidates/:id/resume', staff, resumeUpload, handler('Replace resume', async (req, res, db) => {
  const { candidate } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  const file = validateResumeFile(req.file);
  if (!file.ok) return fail(res, 422, file.error);
  const parsed = parseResume(req.file.buffer, file.ext);
  const stored = await storeFile(req.file.buffer, file.fileName, file.mime, 'recruitment', candidate.job_id, { visibility: 'private' });
  await db.collection(COL.candidates).updateOne(
    { id: candidate.id },
    { $set: { resume: resumeRecord(stored, file, req.file.size), resume_parsed: { email: parsed.email, phone: parsed.phone, linkedin_url: parsed.linkedin_url, method: parsed.method, found: parsed.found }, updated_at: new Date() } }
  );
  if (candidate.resume?.key) await removeFile(candidate.resume.key);
  res.json({ candidate: candidateOut(await loadCandidate(db, candidate.id)), parsed });
}));

app.get('/candidates/:id/scorecards', staff, handler('Candidate scorecards', async (req, res, db) => {
  const { candidate } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  res.json(await scorecardSummary(db, candidate.id));
}));

// ------------------------------------------------------------ RC-2 referrals

/** POST /referrals (multipart, resume required) — any employee refers someone for an open job. */
app.post('/referrals', resumeUpload, handler('Create referral', async (req, res, db) => {
  const value = checkSchema(referralSchema, req.body, res);
  if (!value) return;
  const job = await loadJob(db, value.job_id);
  if (!job || job.status === 'draft') return fail(res, 404, 'Job not found');
  if (!isAccepting(job)) return fail(res, 400, 'This job is not open for referrals');
  if (value.email.toLowerCase() === String(req.user.email).toLowerCase()) return fail(res, 400, 'You cannot refer yourself');
  const file = validateResumeFile(req.file);
  if (!file.ok) return fail(res, 422, file.error);
  if (await db.collection(COL.candidates).findOne({ job_id: job.id, email: value.email }, { projection: { _id: 1 } })) {
    return fail(res, 409, 'This person has already applied for this role');
  }

  const parsed = parseResume(req.file.buffer, file.ext);
  const stored = await storeFile(req.file.buffer, file.fileName, file.mime, 'recruitment', job.id, { visibility: 'private' });
  const me = actor(req);
  const candidate = buildCandidate({
    job,
    name: value.name,
    email: value.email,
    phone: value.phone,
    linkedin_url: value.linkedin_url,
    source: 'referral',
    source_detail: `Referred by ${me.name}`,
    resume: resumeRecord(stored, file, req.file.size),
    parsed,
    by: me,
    referral: { email: req.user.email, name: me.name, relationship: value.relationship, note: value.note }
  });
  try {
    await db.collection(COL.candidates).insertOne(candidate);
  } catch (error) {
    await removeFile(stored.key);
    if (error.code === 11000) return fail(res, 409, 'This person has already applied for this role');
    throw error;
  }
  notifyEmails(db, [...await adminEmails(db), job.hiring_manager_email], {
    type: 'recruitment_referral',
    title: `New referral: ${job.title}`,
    message: `${me.name} referred ${candidate.name}`,
    actionUrl: `/recruitment/candidates/${candidate.id}`,
    metadata: { candidate_id: candidate.id, job_id: job.id }
  }, req.user.email);
  emitEvent('candidate.referred', { candidate_id: candidate.id, job_id: job.id, referred_by: req.user.email });
  res.status(201).json(referralOut(candidate));
}));

const referralOut = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  job_id: c.job_id,
  job_title: c.job_title,
  status: C.REFERRAL_STATUS[c.stage] || 'In review',
  is_closed: ['hired', 'rejected', 'withdrawn'].includes(c.stage),
  relationship: c.referral_relationship || '',
  created_at: c.created_at,
  updated_at: c.updated_at
});

app.get('/referrals/my', handler('My referrals', async (req, res, db) => {
  const list = await db.collection(COL.candidates).find({ referred_by_email: req.user.email }, NO_ID).sort({ created_at: -1 }).toArray();
  res.json(list.map(referralOut));
}));

// ------------------------------------------------------------ RC-3 interviews

const resolveInterviewers = async (db, emails) => {
  const people = [];
  const unknown = [];
  for (const email of emails) {
    const emp = await findEmployeeByEmail(db, email);
    if (emp) people.push({ id: emp.id, email: emp.email, name: emp.full_name });
    else unknown.push(email);
  }
  return { people, unknown };
};

const findConflicts = async (db, emails, start, end, excludeId) => {
  const clashes = await db.collection(COL.interviews).find({
    interviewer_emails: { $in: emails },
    status: 'scheduled',
    scheduled_at: { $lt: end },
    end_at: { $gt: start },
    ...(excludeId ? { id: { $ne: excludeId } } : {})
  }, { projection: { _id: 0, id: 1, candidate_name: 1, round_name: 1, scheduled_at: 1, interviewer_emails: 1 } }).toArray();
  return clashes.map(c => ({ ...c, interviewer_emails: c.interviewer_emails.filter(e => emails.includes(e)) }));
};

const checkInterviewTiming = (scheduledAt) => {
  const t = new Date(scheduledAt).getTime();
  if (t < Date.now() - 7 * 86400000) return 'Interviews cannot be scheduled more than 7 days in the past';
  if (t > Date.now() + 366 * 86400000) return 'Interviews must be within the next year';
  return null;
};

const fmtWhen = (date) => new Date(date).toLocaleString('en-IN', {
  timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short'
});

const interviewEmail = (interview, heading) => `
  <p>${escapeHtml(heading)}</p>
  <ul>
    <li><strong>Candidate:</strong> ${escapeHtml(interview.candidate_name)}</li>
    <li><strong>Role:</strong> ${escapeHtml(interview.job_title)}</li>
    <li><strong>Round:</strong> ${escapeHtml(interview.round_name)}</li>
    <li><strong>When:</strong> ${escapeHtml(fmtWhen(interview.scheduled_at))} (${interview.duration_minutes} min)</li>
    <li><strong>Mode:</strong> ${escapeHtml(interview.mode)}${interview.meeting_link ? ` — <a href="${escapeHtml(interview.meeting_link)}">join link</a>` : ''}${interview.location ? ` — ${escapeHtml(interview.location)}` : ''}</li>
  </ul>
  <p>Open Xeno-HR → My Interviews to download the calendar invite and submit your scorecard.</p>`;

/** POST /candidates/:id/interviews — schedule a round. */
app.post('/candidates/:id/interviews', staff, validate(interviewCreate), handler('Schedule interview', async (req, res, db) => {
  const { candidate, job } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  if (['hired', 'rejected', 'withdrawn'].includes(candidate.stage)) return fail(res, 400, `Cannot schedule interviews for a ${candidate.stage} candidate`);
  const data = req.validatedBody;
  const timing = checkInterviewTiming(data.scheduled_at);
  if (timing) return fail(res, 422, timing);
  if (data.mode === 'video' && !data.meeting_link) return fail(res, 422, 'A meeting link is required for video interviews');

  const { people, unknown } = await resolveInterviewers(db, data.interviewer_emails);
  if (unknown.length) return fail(res, 422, `Not an employee: ${unknown.join(', ')}`);
  const emails = people.map(p => p.email);

  const start = new Date(data.scheduled_at);
  const end = new Date(start.getTime() + data.duration_minutes * 60000);
  const conflicts = await findConflicts(db, emails, start, end);
  const now = new Date();
  const interview = {
    id: generateUUID(),
    candidate_id: candidate.id,
    candidate_name: candidate.name,
    candidate_email: candidate.email,
    job_id: candidate.job_id,
    job_title: candidate.job_title,
    round_name: data.round_name,
    scheduled_at: start,
    end_at: end,
    duration_minutes: data.duration_minutes,
    mode: data.mode,
    meeting_link: data.meeting_link || null,
    location: data.location || null,
    interviewer_emails: emails,
    interviewers: people,
    notes: data.notes || '',
    status: 'scheduled',
    sequence: 0,
    cancel_reason: null,
    history: [historyEntry(req, { action: 'scheduled' })],
    created_by_email: req.user.email,
    created_by_name: req.user.full_name,
    created_at: now,
    updated_at: now
  };
  await db.collection(COL.interviews).insertOne(interview);

  if (['applied', 'screening'].includes(candidate.stage)) {
    await db.collection(COL.candidates).updateOne({ id: candidate.id }, {
      $set: { stage: 'interview', stage_changed_at: now, updated_at: now },
      $push: { stage_history: historyEntry(req, { stage: 'interview', from: candidate.stage, reason: `${data.round_name} scheduled` }) }
    });
  }

  notifyEmails(db, emails, {
    type: 'recruitment_interview',
    title: 'Interview assigned',
    message: `${interview.round_name} with ${candidate.name} (${candidate.job_title}) on ${fmtWhen(start)}`,
    actionUrl: '/recruitment/interviews',
    metadata: { interview_id: interview.id, candidate_id: candidate.id }
  });
  for (const email of emails) sendMailQuietly(email, `Interview: ${candidate.name} — ${interview.round_name}`, interviewEmail(interview, 'You have been added as an interviewer.'));
  emitEvent('interview.scheduled', { interview_id: interview.id, candidate_id: candidate.id, job_id: job?.id, scheduled_at: start, interviewer_emails: emails });

  res.status(201).json({ interview: interviewOut(interview), conflicts });
}));

/** GET /interviews?scope=mine|all&status=&candidate_id=&job_id=&from=&to= */
app.get('/interviews', handler('List interviews', async (req, res, db) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  let access;
  if (scope === 'mine' || req.user.role === 'employee') {
    access = { interviewer_emails: req.user.email };
  } else if (isAdmin(req.user)) {
    access = {};
  } else {
    access = { $or: [{ job_id: { $in: await managedJobIds(db, req.user) } }, { interviewer_emails: req.user.email }] };
  }
  const filter = {};
  if (req.query.status) {
    const statuses = String(req.query.status).split(',').filter(s => C.INTERVIEW_STATUSES.includes(s));
    if (statuses.length) filter.status = { $in: statuses };
  }
  if (req.query.candidate_id) filter.candidate_id = String(req.query.candidate_id);
  if (req.query.job_id) filter.job_id = String(req.query.job_id);
  const range = {};
  if (req.query.from && !isNaN(Date.parse(req.query.from))) range.$gte = new Date(req.query.from);
  if (req.query.to && !isNaN(Date.parse(req.query.to))) range.$lte = new Date(req.query.to);
  if (Object.keys(range).length) filter.scheduled_at = range;

  const list = await db.collection(COL.interviews).find(allOf(access, filter), NO_ID).sort({ scheduled_at: 1 }).limit(1000).toArray();
  const ids = list.map(i => i.id);
  const myCards = await db.collection(COL.scorecards)
    .find({ interview_id: { $in: ids }, interviewer_email: req.user.email }, { projection: { _id: 0, interview_id: 1 } }).toArray();
  const counts = await db.collection(COL.scorecards).aggregate([
    { $match: { interview_id: { $in: ids } } },
    { $group: { _id: '$interview_id', n: { $sum: 1 } } }
  ]).toArray();
  const countMap = Object.fromEntries(counts.map(c => [c._id, c.n]));
  const mineSet = new Set(myCards.map(c => c.interview_id));
  const jobs = await db.collection(COL.jobs).find({ id: { $in: [...new Set(list.map(i => i.job_id))] } }, { projection: { _id: 0, id: 1, scorecard_criteria: 1, hiring_manager_email: 1, created_by_email: 1 } }).toArray();
  const jobMap = Object.fromEntries(jobs.map(j => [j.id, j]));

  res.json(list.map(i => ({
    ...i,
    is_interviewer: i.interviewer_emails.includes(req.user.email),
    my_scorecard_submitted: mineSet.has(i.id),
    scorecards_submitted: countMap[i.id] || 0,
    can_manage: managesJob(req.user, jobMap[i.job_id]),
    scorecard_criteria: jobMap[i.job_id]?.scorecard_criteria || C.DEFAULT_SCORECARD_CRITERIA
  })));
}));

const loadInterviewWithAccess = async (db, req, res) => {
  const interview = await db.collection(COL.interviews).findOne({ id: req.params.id }, NO_ID);
  if (!interview) { fail(res, 404, 'Interview not found'); return {}; }
  const job = await loadJob(db, interview.job_id);
  const canManage = managesJob(req.user, job);
  const isInterviewer = interview.interviewer_emails.includes(req.user.email);
  if (!canManage && !isInterviewer) { fail(res, 403, 'Not enough permissions'); return {}; }
  return { interview, job, canManage, isInterviewer };
};

app.get('/interviews/:id', handler('Get interview', async (req, res, db) => {
  const { interview, job, canManage, isInterviewer } = await loadInterviewWithAccess(db, req, res);
  if (!interview) return;
  const mine = await db.collection(COL.scorecards).findOne({ interview_id: interview.id, interviewer_email: req.user.email }, NO_ID);
  res.json({
    ...interview,
    can_manage: canManage,
    is_interviewer: isInterviewer,
    my_scorecard: mine,
    scorecard_criteria: job?.scorecard_criteria || C.DEFAULT_SCORECARD_CRITERIA
  });
}));

/** PUT /interviews/:id — reschedule / change panel. */
app.put('/interviews/:id', staff, validate(interviewUpdate), handler('Reschedule interview', async (req, res, db) => {
  const { interview, canManage } = await loadInterviewWithAccess(db, req, res);
  if (!interview) return;
  if (!canManage) return fail(res, 403, 'Not enough permissions');
  if (interview.status !== 'scheduled') return fail(res, 400, `Cannot change a ${interview.status} interview`);
  const updates = { ...req.validatedBody };
  const merged = { ...interview, ...updates };
  if (updates.scheduled_at) {
    const timing = checkInterviewTiming(updates.scheduled_at);
    if (timing) return fail(res, 422, timing);
  }
  if (merged.mode === 'video' && !merged.meeting_link) return fail(res, 422, 'A meeting link is required for video interviews');

  let people = interview.interviewers;
  if (updates.interviewer_emails) {
    const resolved = await resolveInterviewers(db, updates.interviewer_emails);
    if (resolved.unknown.length) return fail(res, 422, `Not an employee: ${resolved.unknown.join(', ')}`);
    people = resolved.people;
  }
  const emails = people.map(p => p.email);
  const start = new Date(merged.scheduled_at);
  const end = new Date(start.getTime() + merged.duration_minutes * 60000);
  const timeChanged = start.getTime() !== new Date(interview.scheduled_at).getTime() || merged.duration_minutes !== interview.duration_minutes;

  const set = {
    round_name: merged.round_name,
    scheduled_at: start,
    end_at: end,
    duration_minutes: merged.duration_minutes,
    mode: merged.mode,
    meeting_link: merged.meeting_link || null,
    location: merged.location || null,
    notes: merged.notes || '',
    interviewer_emails: emails,
    interviewers: people,
    updated_at: new Date()
  };
  await db.collection(COL.interviews).updateOne({ id: interview.id }, {
    $set: set,
    $inc: { sequence: 1 },
    $push: { history: historyEntry(req, { action: timeChanged ? 'rescheduled' : 'updated', previous_scheduled_at: interview.scheduled_at }) }
  });
  const updated = await db.collection(COL.interviews).findOne({ id: interview.id }, NO_ID);

  const removed = interview.interviewer_emails.filter(e => !emails.includes(e));
  const added = emails.filter(e => !interview.interviewer_emails.includes(e));
  const kept = emails.filter(e => interview.interviewer_emails.includes(e));
  notifyEmails(db, removed, { type: 'recruitment_interview', title: 'Removed from interview', message: `You are no longer on the panel for ${interview.candidate_name} (${interview.round_name})`, actionUrl: '/recruitment/interviews', metadata: { interview_id: interview.id } });
  notifyEmails(db, added, { type: 'recruitment_interview', title: 'Interview assigned', message: `${updated.round_name} with ${updated.candidate_name} on ${fmtWhen(start)}`, actionUrl: '/recruitment/interviews', metadata: { interview_id: interview.id } });
  if (timeChanged) {
    notifyEmails(db, kept, { type: 'recruitment_interview', title: 'Interview rescheduled', message: `${updated.round_name} with ${updated.candidate_name} moved to ${fmtWhen(start)}`, actionUrl: '/recruitment/interviews', metadata: { interview_id: interview.id } });
    for (const email of kept) sendMailQuietly(email, `Rescheduled: ${updated.candidate_name} — ${updated.round_name}`, interviewEmail(updated, 'An interview you are on has been rescheduled.'));
  }
  for (const email of added) sendMailQuietly(email, `Interview: ${updated.candidate_name} — ${updated.round_name}`, interviewEmail(updated, 'You have been added as an interviewer.'));

  res.json({ interview: updated, conflicts: await findConflicts(db, emails, start, end, interview.id) });
}));

app.post('/interviews/:id/cancel', staff, validate(cancelSchema), handler('Cancel interview', async (req, res, db) => {
  const { interview, canManage } = await loadInterviewWithAccess(db, req, res);
  if (!interview) return;
  if (!canManage) return fail(res, 403, 'Not enough permissions');
  if (interview.status !== 'scheduled') return fail(res, 400, `Interview is already ${interview.status}`);
  const now = new Date();
  await db.collection(COL.interviews).updateOne({ id: interview.id }, {
    $set: { status: 'cancelled', cancel_reason: req.validatedBody.reason || '', cancelled_at: now, updated_at: now },
    $inc: { sequence: 1 },
    $push: { history: historyEntry(req, { action: 'cancelled', reason: req.validatedBody.reason || '' }) }
  });
  notifyEmails(db, interview.interviewer_emails, {
    type: 'recruitment_interview',
    title: 'Interview cancelled',
    message: `${interview.round_name} with ${interview.candidate_name} on ${fmtWhen(interview.scheduled_at)} was cancelled`,
    actionUrl: '/recruitment/interviews',
    metadata: { interview_id: interview.id }
  });
  res.json(await db.collection(COL.interviews).findOne({ id: interview.id }, NO_ID));
}));

app.post('/interviews/:id/status', staff, validate(interviewStatusSchema), handler('Interview status', async (req, res, db) => {
  const { interview, canManage } = await loadInterviewWithAccess(db, req, res);
  if (!interview) return;
  if (!canManage) return fail(res, 403, 'Not enough permissions');
  if (interview.status === 'cancelled') return fail(res, 400, 'Interview was cancelled');
  await db.collection(COL.interviews).updateOne({ id: interview.id }, {
    $set: { status: req.validatedBody.status, updated_at: new Date() },
    $push: { history: historyEntry(req, { action: `marked_${req.validatedBody.status}` }) }
  });
  res.json(await db.collection(COL.interviews).findOne({ id: interview.id }, NO_ID));
}));

/** GET /interviews/:id/ics — calendar invite. */
app.get('/interviews/:id/ics', handler('Interview ics', async (req, res, db) => {
  const { interview } = await loadInterviewWithAccess(db, req, res);
  if (!interview) return;
  const ics = buildIcs(interview, { organizerEmail: interview.created_by_email, organizerName: interview.created_by_name, companyName: await companyName(db) });
  const fileName = `interview-${interview.candidate_name}-${interview.round_name}`.replace(/[^\w-]+/g, '-').slice(0, 80);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.ics"`);
  res.send(ics);
}));

/** POST /interviews/:id/scorecard — assigned interviewers only; resubmitting updates it. */
app.post('/interviews/:id/scorecard', validate(scorecardSchema), handler('Submit scorecard', async (req, res, db) => {
  const interview = await db.collection(COL.interviews).findOne({ id: req.params.id }, NO_ID);
  if (!interview) return fail(res, 404, 'Interview not found');
  if (!interview.interviewer_emails.includes(req.user.email)) {
    return fail(res, 403, 'Only interviewers assigned to this interview can submit a scorecard');
  }
  if (interview.status === 'cancelled') return fail(res, 400, 'This interview was cancelled');

  const job = await loadJob(db, interview.job_id);
  const criteria = job?.scorecard_criteria?.length ? job.scorecard_criteria : C.DEFAULT_SCORECARD_CRITERIA;
  const data = req.validatedBody;
  const given = data.ratings.map(r => r.criterion);
  const unknown = given.filter(c => !criteria.includes(c));
  if (unknown.length) return fail(res, 422, `Unknown criteria: ${unknown.join(', ')}`);
  if (new Set(given).size !== given.length) return fail(res, 422, 'Each criterion can be rated once');
  const missing = criteria.filter(c => !given.includes(c));
  if (missing.length) return fail(res, 422, `Please rate: ${missing.join(', ')}`);

  const now = new Date();
  const ratings = criteria.map(c => data.ratings.find(r => r.criterion === c));
  const overall = round2(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length);
  const existing = await db.collection(COL.scorecards).findOne({ interview_id: interview.id, interviewer_email: req.user.email });
  await db.collection(COL.scorecards).updateOne(
    { interview_id: interview.id, interviewer_email: req.user.email },
    {
      $set: {
        ratings,
        overall_rating: overall,
        strengths: data.strengths || '',
        concerns: data.concerns || '',
        recommendation: data.recommendation,
        interviewer_name: req.user.full_name || req.user.email,
        round_name: interview.round_name,
        updated_at: now
      },
      $setOnInsert: {
        id: generateUUID(),
        interview_id: interview.id,
        interviewer_email: req.user.email,
        candidate_id: interview.candidate_id,
        job_id: interview.job_id,
        submitted_at: now,
        created_at: now
      }
    },
    { upsert: true }
  );
  const card = await db.collection(COL.scorecards).findOne({ interview_id: interview.id, interviewer_email: req.user.email }, NO_ID);

  const submittedCount = await db.collection(COL.scorecards).countDocuments({ interview_id: interview.id });
  if (interview.status === 'scheduled' && submittedCount >= interview.interviewer_emails.length) {
    await db.collection(COL.interviews).updateOne({ id: interview.id, status: 'scheduled' }, {
      $set: { status: 'completed', completed_at: now, updated_at: now },
      $push: { history: { action: 'completed', at: now, by_email: null, by_name: 'All scorecards submitted' } }
    });
  }
  if (!existing) {
    notifyEmails(db, [job?.hiring_manager_email], {
      type: 'recruitment_scorecard',
      title: 'Scorecard submitted',
      message: `${card.interviewer_name} rated ${interview.candidate_name} (${interview.round_name}): ${data.recommendation.replace(/_/g, ' ')}`,
      actionUrl: `/recruitment/candidates/${interview.candidate_id}`,
      metadata: { interview_id: interview.id, candidate_id: interview.candidate_id }
    }, req.user.email);
  }
  res.status(existing ? 200 : 201).json(card);
}));

/**
 * GET /interviews/:id/scorecards
 * Admin / hiring manager: all. Interviewer: only after submitting their own
 * (avoids anchoring bias); before that the list is hidden.
 */
app.get('/interviews/:id/scorecards', handler('Interview scorecards', async (req, res, db) => {
  const { interview, canManage } = await loadInterviewWithAccess(db, req, res);
  if (!interview) return;
  const cards = await db.collection(COL.scorecards).find({ interview_id: interview.id }, NO_ID).sort({ submitted_at: 1 }).toArray();
  if (!canManage && !cards.some(c => c.interviewer_email === req.user.email)) {
    return res.json({ hidden: true, message: 'Submit your scorecard to see feedback from other interviewers', scorecards: [], submitted_count: cards.length });
  }
  res.json({ hidden: false, scorecards: cards, submitted_count: cards.length });
}));

// ------------------------------------------------------------ RC-4 offers

const loadOfferWithAccess = async (db, req, res, { write = false } = {}) => {
  const offer = await db.collection(COL.offers).findOne({ id: req.params.id }, NO_ID);
  if (!offer) { fail(res, 404, 'Offer not found'); return {}; }
  const job = await loadJob(db, offer.job_id);
  if (write ? !isAdmin(req.user) : !managesJob(req.user, job)) { fail(res, 403, 'Not enough permissions'); return {}; }
  return { offer, job };
};

const offerDatesError = (offer, { checkExpiryFuture = true } = {}) => {
  const today = todayStr();
  if (checkExpiryFuture && offer.expiry_date < today) return 'Offer expiry date cannot be in the past';
  if (offer.joining_date < today) return 'Joining date cannot be in the past';
  return null;
};

/**
 * Salary band check. An offer whose CTC is outside the job's salary band is
 * flagged out_of_band and needs an admin's approval before it can be sent.
 * The approver must be someone other than whoever set the CTC, unless they are
 * the only admin. Older offers without these fields are treated as in band.
 */
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const bandFor = (ctc, job) => {
  const min = job?.salary_min ?? null;
  const max = job?.salary_max ?? null;
  const outOfBand = (min != null && ctc < min) || (max != null && ctc > max);
  return {
    salary_band: min == null && max == null ? null : { min, max },
    out_of_band: outOfBand,
    requires_approval: outOfBand,
    band_approved_by_email: null,
    band_approved_by_name: null,
    band_approved_at: null
  };
};
const bandLabel = (band) => (band.min != null && band.max != null ? `${inr(band.min)}–${inr(band.max)}`
  : band.min != null ? `at least ${inr(band.min)}` : `at most ${inr(band.max)}`);

app.get('/offers', staff, handler('List offers', async (req, res, db) => {
  const ids = await managedJobIds(db, req.user);
  const scope = ids ? { job_id: { $in: ids } } : {};
  const filter = {};
  if (req.query.status && C.OFFER_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.job_id) {
    if (ids && !ids.includes(String(req.query.job_id))) return fail(res, 403, 'Not enough permissions');
    filter.job_id = String(req.query.job_id);
  }
  const offers = await db.collection(COL.offers).find(allOf(scope, filter), NO_ID).sort({ created_at: -1 }).limit(1000).toArray();
  res.json(offers);
}));

app.post('/candidates/:id/offers', adminOnly, validate(offerCreate), handler('Create offer', async (req, res, db) => {
  const { candidate, job } = await loadFullCandidate(db, req, res);
  if (!candidate) return;
  if (['hired', 'rejected', 'withdrawn'].includes(candidate.stage)) return fail(res, 400, `Cannot make an offer to a ${candidate.stage} candidate`);
  const open = await db.collection(COL.offers).findOne({ candidate_id: candidate.id, status: { $in: C.OPEN_OFFER_STATUSES } });
  if (open) return fail(res, 409, `This candidate already has an ${open.status} offer`);
  const data = req.validatedBody;
  const dateProblem = offerDatesError(data);
  if (dateProblem) return fail(res, 422, dateProblem);

  const now = new Date();
  const offer = {
    id: generateUUID(),
    candidate_id: candidate.id,
    candidate_name: candidate.name,
    candidate_email: candidate.email,
    job_id: candidate.job_id,
    job_title: candidate.job_title,
    designation: data.designation,
    department: data.department,
    ctc: round2(data.ctc),
    joining_date: data.joining_date,
    expiry_date: data.expiry_date,
    notes: data.notes || '',
    status: 'draft',
    ...bandFor(round2(data.ctc), job),
    ctc_set_by_email: req.user.email,
    signatory_name: req.user.full_name || 'Human Resources',
    history: [historyEntry(req, { status: 'draft' })],
    employee_id: null,
    created_by_email: req.user.email,
    created_by_name: req.user.full_name,
    created_at: now,
    updated_at: now
  };
  await db.collection(COL.offers).insertOne(offer);
  delete offer._id;
  const candidateSet = { offer_status: 'draft', offer_id: offer.id, updated_at: now };
  const update = { $set: candidateSet };
  if (candidate.stage !== 'offer') {
    Object.assign(candidateSet, { stage: 'offer', stage_changed_at: now });
    update.$push = { stage_history: historyEntry(req, { stage: 'offer', from: candidate.stage, reason: 'Offer drafted' }) };
  }
  await db.collection(COL.candidates).updateOne({ id: candidate.id }, update);
  res.status(201).json(offer);
}));

app.get('/offers/:id', staff, handler('Get offer', async (req, res, db) => {
  const { offer } = await loadOfferWithAccess(db, req, res);
  if (!offer) return;
  res.json(offer);
}));

app.put('/offers/:id', adminOnly, validate(offerUpdate), handler('Update offer', async (req, res, db) => {
  const { offer, job } = await loadOfferWithAccess(db, req, res, { write: true });
  if (!offer) return;
  if (offer.status !== 'draft') return fail(res, 400, 'Only draft offers can be edited');
  const updates = { ...req.validatedBody };
  if (updates.ctc != null) updates.ctc = round2(updates.ctc);
  // A changed CTC is checked against the band again and any earlier approval lapses
  if (updates.ctc != null && updates.ctc !== offer.ctc) Object.assign(updates, bandFor(updates.ctc, job), { ctc_set_by_email: req.user.email });
  const dateProblem = offerDatesError({ ...offer, ...updates });
  if (dateProblem) return fail(res, 422, dateProblem);
  await db.collection(COL.offers).updateOne({ id: offer.id }, { $set: { ...updates, updated_at: new Date() } });
  res.json(await db.collection(COL.offers).findOne({ id: offer.id }, NO_ID));
}));

app.delete('/offers/:id', adminOnly, handler('Discard offer', async (req, res, db) => {
  const { offer } = await loadOfferWithAccess(db, req, res, { write: true });
  if (!offer) return;
  if (offer.status !== 'draft') return fail(res, 400, 'Only draft offers can be discarded');
  await db.collection(COL.offers).deleteOne({ id: offer.id });
  await db.collection(COL.candidates).updateOne({ id: offer.candidate_id, offer_id: offer.id }, { $set: { offer_status: null, offer_id: null, updated_at: new Date() } });
  res.json({ message: 'Offer discarded' });
}));

/** POST /offers/:id/approve — approve a draft offer whose CTC is outside the job's salary band. */
app.post('/offers/:id/approve', adminOnly, handler('Approve offer', async (req, res, db) => {
  const { offer } = await loadOfferWithAccess(db, req, res, { write: true });
  if (!offer) return;
  if (offer.status !== 'draft') return fail(res, 400, `Offer is already ${offer.status}`);
  if (!offer.requires_approval) return fail(res, 400, 'This offer does not need approval');
  if (offer.ctc_set_by_email === req.user.email) {
    const admins = await db.collection('users').find({ role: 'admin' }, { projection: { _id: 0, email: 1, is_active: 1 } }).toArray();
    if (admins.some(a => a.is_active !== false && a.email !== req.user.email)) {
      return fail(res, 403, 'You set this CTC, so another admin must approve it');
    }
  }
  const now = new Date();
  await db.collection(COL.offers).updateOne({ id: offer.id, status: 'draft' }, {
    $set: { requires_approval: false, band_approved_by_email: req.user.email, band_approved_by_name: req.user.full_name || req.user.email, band_approved_at: now, updated_at: now },
    $push: { history: historyEntry(req, { status: 'draft', reason: `CTC ${inr(offer.ctc)} approved outside the salary band` }) }
  });
  res.json(await db.collection(COL.offers).findOne({ id: offer.id }, NO_ID));
}));

app.post('/offers/:id/send', adminOnly, handler('Send offer', async (req, res, db) => {
  const { offer } = await loadOfferWithAccess(db, req, res, { write: true });
  if (!offer) return;
  if (offer.status !== 'draft') return fail(res, 400, `Offer is already ${offer.status}`);
  if (offer.requires_approval) {
    return fail(res, 400, `The CTC ${inr(offer.ctc)} is outside the job's salary band (${bandLabel(offer.salary_band || {})}); an admin must approve the offer before it is sent`);
  }
  const dateProblem = offerDatesError(offer);
  if (dateProblem) return fail(res, 422, dateProblem);
  const now = new Date();
  await db.collection(COL.offers).updateOne({ id: offer.id, status: 'draft' }, {
    $set: { status: 'sent', sent_at: now, updated_at: now },
    $push: { history: historyEntry(req, { status: 'sent' }) }
  });
  await db.collection(COL.candidates).updateOne({ id: offer.candidate_id }, { $set: { offer_status: 'sent', updated_at: now } });
  const company = await companyName(db);
  sendMailQuietly(offer.candidate_email, `Offer of employment — ${offer.designation} at ${company}`,
    `<p>Dear ${escapeHtml(offer.candidate_name)},</p><p>We are pleased to offer you the position of <strong>${escapeHtml(offer.designation)}</strong> (${escapeHtml(offer.department)}). Our HR team will share the offer letter with you. Please respond by ${escapeHtml(offer.expiry_date)}.</p><p>— ${escapeHtml(company)}</p>`);
  emitEvent('offer.sent', { offer_id: offer.id, candidate_id: offer.candidate_id, job_id: offer.job_id });
  res.json(await db.collection(COL.offers).findOne({ id: offer.id }, NO_ID));
}));

/** POST /offers/:id/respond { response: accepted|declined } — record the candidate's answer. */
app.post('/offers/:id/respond', adminOnly, validate(respondSchema), handler('Offer response', async (req, res, db) => {
  const { offer, job } = await loadOfferWithAccess(db, req, res, { write: true });
  if (!offer) return;
  if (offer.status !== 'sent') return fail(res, 400, offer.status === 'draft' ? 'Send the offer before recording a response' : `Offer is already ${offer.status}`);
  const now = new Date();
  if (offer.expiry_date < todayStr()) {
    await db.collection(COL.offers).updateOne({ id: offer.id }, { $set: { status: 'expired', expired_at: now, updated_at: now } });
    await db.collection(COL.candidates).updateOne({ id: offer.candidate_id }, { $set: { offer_status: 'expired', updated_at: now } });
    return fail(res, 400, 'This offer has expired');
  }
  const { response, note } = req.validatedBody;
  await db.collection(COL.offers).updateOne({ id: offer.id, status: 'sent' }, {
    $set: { status: response, responded_at: now, response_note: note || '', updated_at: now },
    $push: { history: historyEntry(req, { status: response, note: note || '' }) }
  });
  await db.collection(COL.candidates).updateOne({ id: offer.candidate_id }, {
    $set: { offer_status: response, updated_at: now },
    $push: { stage_history: historyEntry(req, { stage: 'offer', from: 'offer', reason: response === 'accepted' ? 'Offer accepted' : `Offer declined${note ? `: ${note}` : ''}` }) }
  });
  notifyEmails(db, [job?.hiring_manager_email], {
    type: 'recruitment_offer',
    title: `Offer ${response}`,
    message: `${offer.candidate_name} ${response} the offer for ${offer.designation}`,
    actionUrl: `/recruitment/candidates/${offer.candidate_id}`,
    metadata: { offer_id: offer.id }
  }, req.user.email);
  emitEvent(`offer.${response}`, { offer_id: offer.id, candidate_id: offer.candidate_id, job_id: offer.job_id });
  res.json(await db.collection(COL.offers).findOne({ id: offer.id }, NO_ID));
}));

/** GET /offers/:id/pdf — offer letter. */
app.get('/offers/:id/pdf', staff, handler('Offer PDF', async (req, res, db) => {
  const { offer, job } = await loadOfferWithAccess(db, req, res);
  if (!offer) return;
  const pdf = await buildOfferLetterPdf({ offer, job, companyName: await companyName(db) });
  const fileName = `offer-letter-${offer.candidate_name}`.replace(/[^\w-]+/g, '-').slice(0, 80);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
  res.send(pdf);
}));

const generateTempPassword = () => {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '@#$%&*!?'];
  const all = sets.join('');
  const chars = sets.map(s => s[crypto.randomInt(s.length)]);
  while (chars.length < 14) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

/**
 * POST /offers/:id/convert — create the employee through the existing
 * POST /api/employees endpoint (so all employee-creation logic runs), then
 * mark the candidate hired. The temporary password is returned once.
 */
app.post('/offers/:id/convert', adminOnly, validate(convertSchema), handler('Convert to employee', async (req, res, db) => {
  const { offer, job } = await loadOfferWithAccess(db, req, res, { write: true });
  if (!offer) return;
  if (offer.employee_id) return fail(res, 409, 'This offer was already converted to an employee');
  if (offer.status !== 'accepted') return fail(res, 400, 'Only accepted offers can be converted');
  const candidate = await loadCandidate(db, offer.candidate_id);
  if (!candidate) return fail(res, 404, 'Candidate not found');
  if (candidate.stage === 'hired') return fail(res, 409, 'Candidate is already hired');

  const value = req.validatedBody;
  let managerEmail = value.manager_email === '' ? null : value.manager_email;
  if (managerEmail === undefined && job?.hiring_manager_email) {
    managerEmail = (await findEmployeeByEmail(db, job.hiring_manager_email))?.email || null;
  }

  // Claim the offer so a double click cannot create two employees
  const claim = await db.collection(COL.offers).updateOne(
    { id: offer.id, status: 'accepted', employee_id: null, converting: { $ne: true } },
    { $set: { converting: true, converting_at: new Date() } }
  );
  if (!claim.modifiedCount) return fail(res, 409, 'Conversion is already in progress');
  const release = () => db.collection(COL.offers).updateOne({ id: offer.id }, { $unset: { converting: '', converting_at: '' } });

  try {
    const temporaryPassword = generateTempPassword();
    const body = {
      email: value.email || offer.candidate_email,
      password: temporaryPassword,
      full_name: candidate.name,
      role: value.role,
      department: value.department || offer.department,
      designation: value.designation || offer.designation,
      phone: candidate.phone || '',
      joining_date: value.joining_date || offer.joining_date,
      ...(managerEmail ? { manager_email: managerEmail } : {})
    };
    let response;
    let payload = {};
    try {
      response = await fetch(`http://127.0.0.1:${process.env.PORT || 8000}/api/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization },
        body: JSON.stringify(body)
      });
      payload = await response.json().catch(() => ({}));
    } catch (error) {
      await release();
      console.error('[recruitment] employee API unreachable:', error.message);
      return fail(res, 502, 'Could not reach the employee service');
    }
    if (!response.ok) {
      await release();
      const status = response.status === 422 ? 422 : response.status >= 500 ? 502 : 400;
      return fail(res, status, `Could not create the employee: ${payload.detail || response.statusText}`, payload.errors ? { errors: payload.errors } : undefined);
    }

    const employee = payload;
    const now = new Date();
    await db.collection(COL.offers).updateOne({ id: offer.id }, {
      $set: { employee_id: employee.id, employee_code: employee.employee_id, converted_at: now, converted_by_email: req.user.email, updated_at: now },
      $unset: { converting: '', converting_at: '' },
      $push: { history: historyEntry(req, { status: 'accepted', action: 'converted_to_employee' }) }
    });
    await db.collection(COL.candidates).updateOne({ id: candidate.id }, {
      $set: {
        stage: 'hired',
        stage_changed_at: now,
        hired_at: now,
        employee_id: employee.id,
        employee_code: employee.employee_id,
        employee_email: employee.email,
        offer_status: 'accepted',
        updated_at: now
      },
      $push: { stage_history: historyEntry(req, { stage: 'hired', from: candidate.stage, reason: `Converted to employee ${employee.employee_id}` }) }
    });

    let jobClosed = false;
    if (job) {
      const updatedJob = await db.collection(COL.jobs).findOneAndUpdate(
        { id: job.id },
        { $inc: { hires_count: 1 }, $set: { updated_at: now } },
        { returnDocument: 'after' }
      );
      const jobDoc = updatedJob?.value !== undefined ? updatedJob.value : updatedJob;
      if (jobDoc && jobDoc.hires_count >= (jobDoc.headcount || 1) && jobDoc.status !== 'closed') {
        await db.collection(COL.jobs).updateOne({ id: job.id }, { $set: { status: 'closed', closed_at: now, closed_reason: 'filled' } });
        if (job.requisition_id) await db.collection(COL.requisitions).updateOne({ id: job.requisition_id }, { $set: { status: 'filled', updated_at: now } });
        jobClosed = true;
      }
    }

    emitEvent('candidate.hired', {
      candidate_id: candidate.id,
      candidate_name: candidate.name,
      candidate_email: candidate.email,
      job_id: offer.job_id,
      job_title: offer.job_title,
      offer_id: offer.id,
      employee_id: employee.id,
      employee_code: employee.employee_id,
      employee_email: employee.email,
      department: employee.department,
      designation: employee.designation,
      joining_date: employee.joining_date,
      source: candidate.source
    });
    notifyEmails(db, [job?.hiring_manager_email], {
      type: 'recruitment_hired',
      title: 'Candidate hired',
      message: `${candidate.name} joins as ${employee.designation} (${employee.employee_id})`,
      actionUrl: `/recruitment/candidates/${candidate.id}`,
      metadata: { candidate_id: candidate.id, employee_id: employee.id }
    }, req.user.email);
    if (candidate.referred_by_email) {
      notifyEmails(db, [candidate.referred_by_email], {
        type: 'recruitment_referral',
        title: 'Your referral was hired',
        message: `${candidate.name} accepted the ${offer.job_title} role. Thank you for the referral!`,
        actionUrl: '/recruitment/my-referrals',
        metadata: { candidate_id: candidate.id }
      });
    }

    res.status(201).json({
      employee: {
        id: employee.id,
        employee_id: employee.employee_id,
        email: employee.email,
        full_name: employee.full_name,
        role: employee.role,
        department: employee.department,
        designation: employee.designation,
        joining_date: employee.joining_date,
        manager_email: employee.manager_email || null
      },
      temporary_password: temporaryPassword,
      job_closed: jobClosed
    });
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
}));

module.exports = router;
