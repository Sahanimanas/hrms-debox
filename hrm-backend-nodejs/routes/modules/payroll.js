/**
 * payroll module — mounted at /api/v2/payroll
 *
 * PY-1  statutory engine & settings        /settings, /calculate/*
 * PY-2  LOP from attendance                 (engine) /lop/:uid
 * PY-3  payroll runs                        /runs
 * PY-4  PDF payslips & publishing           /payslips/:id/pdf, /runs/:id/publish, /my/payslips
 * PY-5  investment declarations             /declarations
 * PY-6  Form 16, ECR, ESI, PT, statutory    /form16, /runs/:id/{ecr,esi,pt}, /statutory
 * PY-7  loans & advances                    /loans
 * PY-8  one-off earnings/deductions         /runs/:id/adjustments
 * PY-9  gratuity                            /gratuity/calculate
 * PY-10 bank transfer file                  /runs/:id/bank-file
 * PY-11 salary revisions                    /revisions, /my/revisions
 *
 * Payroll data is admin-only; every other role (managers included) sees only
 * their own payslips, declarations, loans and salary history.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const multer = require('multer');
const router = express.Router();

const { getDB } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { requireRole, validate } = require('../../middleware/roleCheck');
const { generateUUID, employeeUid } = require('../../utils/helpers');
const { createNotification } = require('../../services/notificationService');
const { storeFile, removeFile, LOCAL_ROOT } = require('../../services/fileStorage');

const statutory = require('../../services/payroll/statutory');
const { getSettings, saveSettings, taxConfigFor, DEFAULT_SETTINGS } = require('../../services/payroll/settings');
const engine = require('../../services/payroll/engine');
const { PayrollError, ONE_OFF_TYPES } = engine;
const { saveStructure, effectiveStructure, monthlyComponents, currentMonth } = require('../../services/payroll/structures');
const { computeLop } = require('../../services/payroll/lop');
const { buildPayslipPdf, buildForm16Pdf, monthLabel } = require('../../services/payroll/pdf');
const { sendMailWithAttachments, isMailConfigured } = require('../../services/payroll/mailer');
const { buildEcr, buildEsiCsv, buildPtCsv, buildBankFile, toCsv } = require('../../services/payroll/files');
const { buildForm16Data } = require('../../services/payroll/form16');
const { computeGratuity } = require('../../services/payroll/gratuity');
const declarationsSvc = require('../../services/payroll/declarations');
const { settleLoansOnExit } = require('../../services/payroll/loans');
const { onEvent } = require('../../services/events');

// Lifecycle's full & final settlement recovers outstanding loans; close them here (idempotent)
onEvent(async (name, payload) => {
  if (name !== 'employee.exited') return;
  try {
    const result = await settleLoansOnExit(getDB(), payload || {});
    if (result.closed.length || result.cancelled.length) {
      console.log(`[payroll] employee.exited ${payload?.email || payload?.employee_uid}: closed ${result.closed.length} loan(s), cancelled ${result.cancelled.length} request(s)`);
    }
  } catch (error) {
    console.error('[payroll] Failed to settle loans on exit:', error.message);
  }
});

const { round2, MONTH_RE, fyOf, isValidFy } = statutory;
const adminOnly = requireRole(['admin']);

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UAN_RE = /^\d{12}$/;
const ESIC_RE = /^\d{10}(\d{7})?$/;
const ACCOUNT_RE = /^\d{9,18}$/;

const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const PROOF_MAX_BYTES = 5 * 1024 * 1024;

// ============= SETUP =============

let indexesReady = false;
const ensureIndexes = async (db) => {
  if (indexesReady) return;
  await Promise.all([
    db.collection('payroll_runs').createIndex({ month: 1 }, { unique: true }),
    db.collection('payroll_runs').createIndex({ id: 1 }, { unique: true }),
    db.collection('payslips').createIndex({ run_id: 1, employee_uid: 1 }),
    db.collection('payslips').createIndex({ employee_uid: 1, month: 1 }),
    db.collection('payroll_adjustments').createIndex({ run_id: 1, employee_uid: 1 }),
    db.collection('loans').createIndex({ id: 1 }, { unique: true }),
    db.collection('loans').createIndex({ employee_uid: 1, status: 1 }),
    db.collection('tax_declarations').createIndex({ employee_uid: 1, financial_year: 1 }, { unique: true }),
    db.collection('employee_statutory').createIndex({ employee_uid: 1 }, { unique: true }),
    db.collection('salary_revisions').createIndex({ employee_uid: 1, effective_from: -1 })
  ]);
  indexesReady = true;
};

router.get('/health', (req, res) => res.json({ module: 'payroll', status: 'ok' }));

router.use(authenticate, async (req, res, next) => {
  try {
    await ensureIndexes(getDB());
    next();
  } catch (error) {
    console.error('Payroll index setup error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/** Wrap async handlers: PayrollError -> its status, anything else -> 500. */
const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof PayrollError || error.status) {
      return res.status(error.status).json({ detail: error.message });
    }
    console.error(`Payroll ${req.method} ${req.originalUrl} error:`, error);
    res.status(500).json({ detail: 'Internal server error' });
  }
};

const fail = (status, detail) => { throw new PayrollError(status, detail); };

const myEmployee = async (db, req) => {
  const employee = await db.collection('employees').findOne({ email: req.user.email }, { projection: { _id: 0 } });
  if (!employee) fail(404, 'No employee profile is linked to your account');
  return employee;
};

const findEmployeeByUid = async (db, uid) => {
  const employee = await db.collection('employees').findOne(
    { $or: [{ employee_id: uid }, { employee_code: uid }, { id: uid }] },
    { projection: { _id: 0 } }
  );
  if (!employee) fail(404, 'Employee not found');
  return employee;
};

const companyInfo = async (db, settings) => {
  let name = settings.company_name;
  if (!name) {
    const org = await db.collection('organizations').findOne({}, { projection: { _id: 0, name: 1 } });
    name = org?.name;
  }
  return { name: name || 'Xeno-HR', address: settings.company_address || '', tan: settings.employer_tan || '', pan: settings.employer_pan || '' };
};

const sendFile = (res, buffer, filename, type) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
};

const statutoryMap = async (db, uids) => {
  const docs = await db.collection('employee_statutory').find({ employee_uid: { $in: uids } }, { projection: { _id: 0 } }).toArray();
  return Object.fromEntries(docs.map(d => [d.employee_uid, d]));
};

const notify = (user, payload) => {
  if (!user) return;
  createNotification({ userId: user.id, userEmail: user.email, ...payload }).catch(() => {});
};

const notifyEmail = async (db, email, payload) => {
  const user = await db.collection('users').findOne({ email }, { projection: { _id: 0, id: 1, email: 1 } });
  notify(user || { id: null, email }, payload);
};

const notifyAdmins = async (db, payload) => {
  const admins = await db.collection('users').find({ role: 'admin' }, { projection: { _id: 0, id: 1, email: 1 } }).toArray();
  admins.forEach(a => notify(a, payload));
};

// ============= PY-1 SETTINGS & CALCULATORS =============

const monthSchema = Joi.string().pattern(MONTH_RE).messages({ 'string.pattern.base': 'month must be YYYY-MM' });
const stateCodes = Object.keys(statutory.INDIAN_STATES);

const settingsSchema = Joi.object({
  company_name: Joi.string().allow('').max(200),
  company_address: Joi.string().allow('').max(500),
  employer_pan: Joi.string().allow('').uppercase().pattern(PAN_RE).messages({ 'string.pattern.base': 'Employer PAN must look like ABCDE1234F' }),
  employer_tan: Joi.string().allow('').uppercase().pattern(/^[A-Z]{4}[0-9]{5}[A-Z]$/).messages({ 'string.pattern.base': 'TAN must look like ABCD12345E' }),
  pf_establishment_code: Joi.string().allow('').max(40),
  pf_enabled: Joi.boolean(),
  pf_restrict_to_ceiling: Joi.boolean(),
  pf_ceiling: Joi.number().min(1000).max(1000000),
  esi_enabled: Joi.boolean(),
  esi_threshold: Joi.number().min(1000).max(1000000),
  lwf_enabled: Joi.boolean(),
  default_pt_state: Joi.string().valid(...stateCodes),
  lop_basis: Joi.string().valid('calendar', '26', '30'),
  pay_day: Joi.number().integer().min(1).max(31),
  auto_draft_enabled: Joi.boolean(),
  declaration_window_open: Joi.boolean(),
  proof_deadline: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, ''),
  use_declared_until_deadline: Joi.boolean()
}).min(1);

const regimeSchema = Joi.object({
  slabs: Joi.array().items(Joi.object({
    upto: Joi.number().positive().allow(null).required(),
    rate: Joi.number().min(0).max(100).required()
  })).min(1).max(15).required(),
  standard_deduction: Joi.number().min(0).max(1000000).required(),
  rebate_limit: Joi.number().min(0).max(100000000).default(0),
  rebate_max: Joi.number().min(0).max(10000000).default(0),
  marginal_relief: Joi.boolean().default(false),
  cess_rate: Joi.number().min(0).max(20).default(4),
  surcharge: Joi.array().items(Joi.object({
    above: Joi.number().positive().required(),
    rate: Joi.number().min(0).max(100).required()
  })).max(10).default([])
});

const slabTableSchema = Joi.object({ new: regimeSchema.required(), old: regimeSchema.required() });

const checkSlabs = (cfg, label) => {
  const slabs = cfg.slabs;
  for (let i = 0; i < slabs.length; i++) {
    const last = i === slabs.length - 1;
    if (last && slabs[i].upto != null) fail(422, `${label}: the last slab must be open-ended (upto: null)`);
    if (!last && slabs[i].upto == null) fail(422, `${label}: only the last slab can be open-ended`);
    if (i > 0 && !last && slabs[i].upto <= slabs[i - 1].upto) fail(422, `${label}: slab limits must increase`);
  }
};

router.get('/meta', h(async (req, res) => {
  const settings = await getSettings(getDB());
  const fy = fyOf(currentMonth());
  res.json({
    current_month: currentMonth(),
    current_fy: fy,
    states: statutory.INDIAN_STATES,
    pt_states: Object.keys(statutory.PT_STATES),
    lwf_states: Object.keys(statutory.LWF_STATES),
    sections: declarationsSvc.SECTION_INFO,
    deduction_caps: statutory.DEDUCTION_CAPS,
    combined_caps: statutory.COMBINED_CAPS,
    one_off_types: ONE_OFF_TYPES,
    declaration_window_open: settings.declaration_window_open !== false,
    proof_deadline: settings.proof_deadline || null,
    declared_counts_now: declarationsSvc.declaredStillCounts(settings),
    landlord_pan_threshold: declarationsSvc.LANDLORD_PAN_THRESHOLD,
    tax_slab_years: Object.keys(settings.tax_slabs || {}).sort(),
    mail_configured: isMailConfigured()
  });
}));

router.get('/settings', adminOnly, h(async (req, res) => {
  const settings = await getSettings(getDB());
  res.json({ ...settings, defaults: DEFAULT_SETTINGS });
}));

router.put('/settings', adminOnly, validate(settingsSchema), h(async (req, res) => {
  const patch = { ...req.validatedBody };
  if (patch.proof_deadline === '') patch.proof_deadline = null;
  const settings = await saveSettings(getDB(), patch, req.user.email);
  res.json(settings);
}));

router.put('/settings/tax-slabs/:fy', adminOnly, validate(slabTableSchema), h(async (req, res) => {
  const { fy } = req.params;
  if (!isValidFy(fy)) fail(422, 'Financial year must look like 2025-26');
  const table = req.validatedBody;
  checkSlabs(table.new, 'New regime');
  checkSlabs(table.old, 'Old regime');
  const db = getDB();
  const current = await getSettings(db);
  const settings = await saveSettings(db, { tax_slabs: { ...current.tax_slabs, [fy]: table } }, req.user.email);
  res.json(settings);
}));

router.delete('/settings/tax-slabs/:fy', adminOnly, h(async (req, res) => {
  const db = getDB();
  const current = await getSettings(db);
  if (!current.tax_slabs[req.params.fy]) fail(404, 'No tax slabs saved for that financial year');
  if (Object.keys(current.tax_slabs).length === 1) fail(400, 'At least one financial year of tax slabs is required');
  const next = { ...current.tax_slabs };
  delete next[req.params.fy];
  res.json(await saveSettings(db, { tax_slabs: next }, req.user.email));
}));

const statutoryCalcSchema = Joi.object({
  basic_da: Joi.number().min(0).max(100000000).default(0),
  gross: Joi.number().min(0).max(100000000).required(),
  state: Joi.string().valid(...stateCodes).allow(null),
  month: Joi.number().integer().min(1).max(12).required(),
  gender: Joi.string().allow(null, ''),
  age: Joi.number().integer().min(14).max(100).allow(null)
});

/** Monthly PF / ESI / PT / LWF for given figures, using the org's settings. */
router.post('/calculate/statutory', validate(statutoryCalcSchema), h(async (req, res) => {
  const settings = await getSettings(getDB());
  const b = req.validatedBody;
  const state = b.state || settings.default_pt_state;
  res.json({
    state,
    pf: statutory.computePF({ basicDa: b.basic_da, settings, age: b.age }),
    esi: statutory.computeESI({ monthlyGross: b.gross, esiWage: b.gross, settings }),
    pt: statutory.computePT({ state, gross: b.gross, month: b.month, gender: b.gender }),
    lwf: statutory.computeLWF({ state, month: b.month, gross: b.gross, settings })
  });
}));

const taxCalcSchema = Joi.object({
  financial_year: Joi.string().pattern(statutory.FY_RE),
  annual_gross: Joi.number().min(0).max(1000000000).required(),
  basic_da_annual: Joi.number().min(0).max(1000000000).default(0),
  hra_received_annual: Joi.number().min(0).max(1000000000).default(0),
  rent_paid_annual: Joi.number().min(0).max(1000000000).default(0),
  metro: Joi.boolean().default(false),
  professional_tax: Joi.number().min(0).max(100000).default(0),
  senior_citizen: Joi.boolean().default(false),
  parents_senior_citizen: Joi.boolean().default(false),
  deductions: Joi.object(Object.fromEntries(Object.keys(statutory.DEDUCTION_CAPS).map(k => [k, Joi.number().min(0).max(1000000000)]))).default({})
});

/** Annual tax under both regimes (regime comparison / what-if). */
router.post('/calculate/tax', validate(taxCalcSchema), h(async (req, res) => {
  const settings = await getSettings(getDB());
  const b = req.validatedBody;
  const fy = b.financial_year || fyOf(currentMonth());
  const cfg = taxConfigFor(settings, fy);
  const hraExemption = statutory.computeHraExemption({ hraReceived: b.hra_received_annual, basicDa: b.basic_da_annual, rentPaid: b.rent_paid_annual, metro: b.metro });
  const result = {};
  for (const regime of ['new', 'old']) {
    result[regime] = statutory.computeAnnualTax({
      regime, config: cfg.config[regime], grossSalary: b.annual_gross, hraExemption, professionalTax: b.professional_tax, deductions: b.deductions,
      capOptions: { selfSenior: b.senior_citizen, parentsSenior: b.parents_senior_citizen }
    });
  }
  res.json({ financial_year: fy, slabs_fy: cfg.fy, fallback: cfg.fallback, ...result, better: result.old.total < result.new.total ? 'old' : 'new' });
}));

// ============= EMPLOYEES (admin pickers) =============

router.get('/employees', adminOnly, h(async (req, res) => {
  const db = getDB();
  const employees = await db.collection('employees').find(
    req.query.include_exited === 'true' ? {} : { employment_status: { $ne: 'exited' } },
    { projection: { _id: 0, id: 1, employee_id: 1, employee_code: 1, full_name: 1, email: 1, department: 1, designation: 1, joining_date: 1, employment_status: 1, exit_date: 1 } }
  ).sort({ full_name: 1 }).toArray();
  const structures = await db.collection('salary_structures').find({}, { projection: { _id: 0, employee_id: 1, gross_salary: 1 } }).toArray();
  const grossBy = Object.fromEntries(structures.map(s => [s.employee_id, s.gross_salary]));
  res.json(employees.map(e => ({
    uid: employeeUid(e),
    name: e.full_name,
    email: e.email,
    employee_code: e.employee_id || e.employee_code || null,
    department: e.department || null,
    designation: e.designation || null,
    joining_date: e.joining_date || null,
    employment_status: e.employment_status || 'active',
    exit_date: e.exit_date || null,
    monthly_gross: grossBy[e.employee_id] ?? grossBy[employeeUid(e)] ?? null
  })));
}));

// ============= PY-2 LOP PREVIEW =============

router.get('/lop/:uid', adminOnly, h(async (req, res) => {
  const month = req.query.month || currentMonth();
  if (!MONTH_RE.test(month)) fail(422, 'month must be YYYY-MM');
  const db = getDB();
  const employee = await findEmployeeByUid(db, req.params.uid);
  const settings = await getSettings(db);
  const lop = await computeLop(db, employee, month, settings);
  const eff = await effectiveStructure(db, employee, month);
  const gross = eff ? monthlyComponents(eff.structure).gross : 0;
  res.json({ employee_uid: employeeUid(employee), month, ...lop, monthly_gross: gross, lop_amount: gross ? round2(Math.min(gross, gross / lop.basis_days * lop.lop_days)) : 0 });
}));

// ============= PY-3 PAYROLL RUNS =============

const loadRunWithSlips = async (db, runId) => {
  const run = await engine.getRun(db, runId);
  const payslips = await db.collection('payslips')
    .find({ run_id: runId }, { projection: { _id: 0, lop_dates: 0 } })
    .sort({ employee_name: 1 })
    .toArray();
  return { ...run, payslips };
};

router.get('/runs', adminOnly, h(async (req, res) => {
  const runs = await getDB().collection('payroll_runs')
    .find({}, { projection: { _id: 0, settings_snapshot: 0 } })
    .sort({ month: -1 })
    .toArray();
  res.json(runs);
}));

router.post('/runs', adminOnly, validate(Joi.object({ month: monthSchema.required() })), h(async (req, res) => {
  const { month } = req.validatedBody;
  const [y, m] = currentMonth().split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  if (month > next) fail(400, 'Payroll can be run up to next month only');
  const db = getDB();
  const run = await engine.createRun(db, month, req.user);
  res.status(201).json(await loadRunWithSlips(db, run.id));
}));

router.get('/runs/:id', adminOnly, h(async (req, res) => {
  res.json(await loadRunWithSlips(getDB(), req.params.id));
}));

router.post('/runs/:id/recompute', adminOnly, h(async (req, res) => {
  const db = getDB();
  const run = await engine.getRun(db, req.params.id);
  await engine.computeRun(db, run);
  res.json(await loadRunWithSlips(db, run.id));
}));

router.post('/runs/:id/lock', adminOnly, h(async (req, res) => {
  const db = getDB();
  await engine.lockRun(db, req.params.id, req.user);
  res.json(await loadRunWithSlips(db, req.params.id));
}));

const paySchema = Joi.object({
  payment_reference: Joi.string().max(100).allow('', null),
  paid_on: Joi.date().iso().allow(null)
});

router.post('/runs/:id/pay', adminOnly, validate(paySchema), h(async (req, res) => {
  const db = getDB();
  await engine.markPaid(db, req.params.id, req.user, req.validatedBody);
  res.json(await loadRunWithSlips(db, req.params.id));
}));

router.delete('/runs/:id', adminOnly, h(async (req, res) => {
  await engine.deleteRun(getDB(), req.params.id);
  res.json({ status: 'deleted' });
}));

/** Notify employees (and email PDFs when Mailjet is configured). Runs in the background. */
router.post('/runs/:id/publish', adminOnly, h(async (req, res) => {
  const db = getDB();
  const run = await engine.getRun(db, req.params.id);
  if (run.status === 'draft') fail(409, 'Lock the payroll run before publishing payslips');
  const payslips = await db.collection('payslips').find({ run_id: run.id }, { projection: { _id: 0 } }).toArray();
  const now = new Date();
  await db.collection('payroll_runs').updateOne({ id: run.id }, { $set: { published_at: now, published_by: req.user.email } });
  await db.collection('payslips').updateMany({ run_id: run.id }, { $set: { published_at: now } });

  const emailing = isMailConfigured();
  const settings = await getSettings(db);
  const company = await companyInfo(db, settings);
  const label = monthLabel(run.month);

  setImmediate(async () => {
    for (const p of payslips) {
      try {
        await notifyEmail(db, p.employee_email, {
          type: 'payslip_published',
          title: `Payslip for ${label}`,
          message: `Your salary slip for ${label} is ready. Net pay ₹${p.net_pay.toLocaleString('en-IN')}.`,
          actionUrl: '/my-payslips',
          metadata: { payslip_id: p.id, run_id: run.id, month: run.month }
        });
        if (emailing) {
          const pdf = await buildPayslipPdf(p, company);
          const sent = await sendMailWithAttachments({
            to: p.employee_email,
            subject: `Salary slip — ${label}`,
            html: `<p>Hi ${p.employee_name},</p><p>Your salary slip for <b>${label}</b> is attached.</p><p>Net pay: <b>₹${p.net_pay.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></p><p>— ${company.name}</p>`,
            attachments: [{ filename: `payslip-${run.month}.pdf`, contentType: 'application/pdf', content: pdf }]
          });
          if (sent) await db.collection('payslips').updateOne({ id: p.id }, { $set: { emailed_at: new Date() } });
        }
      } catch (error) {
        console.error(`[payroll] publish failed for ${p.employee_email}:`, error.message);
      }
    }
  });

  res.json({ status: 'published', payslips: payslips.length, email_configured: emailing, emailing: emailing ? payslips.length : 0 });
}));

// ============= PY-8 ONE-OFF ADJUSTMENTS =============

const adjustmentSchema = Joi.object({
  employee_uid: Joi.string().required(),
  type: Joi.string().valid(...Object.keys(ONE_OFF_TYPES)).required(),
  label: Joi.string().trim().max(80).allow('', null),
  amount: Joi.number().positive().max(100000000).required(),
  taxable: Joi.boolean().default(true),
  note: Joi.string().max(300).allow('', null)
});

router.get('/runs/:id/adjustments', adminOnly, h(async (req, res) => {
  const db = getDB();
  await engine.getRun(db, req.params.id);
  const list = await db.collection('payroll_adjustments').find({ run_id: req.params.id }, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray();
  res.json(list);
}));

router.post('/runs/:id/adjustments', adminOnly, validate(adjustmentSchema), h(async (req, res) => {
  const db = getDB();
  const run = await engine.getRun(db, req.params.id);
  engine.requireDraft(run);
  const b = req.validatedBody;
  const employee = await findEmployeeByUid(db, b.employee_uid);
  if (employee.employment_status === 'exited') fail(400, 'Employee has exited');
  const adjustment = {
    id: generateUUID(),
    run_id: run.id,
    month: run.month,
    employee_uid: employeeUid(employee),
    employee_name: employee.full_name,
    type: b.type,
    label: b.label || ONE_OFF_TYPES[b.type],
    amount: round2(b.amount),
    taxable: b.type === 'other_deduction' ? false : b.taxable,
    note: b.note || null,
    created_by: req.user.email,
    created_at: new Date()
  };
  await db.collection('payroll_adjustments').insertOne({ ...adjustment });
  const payslip = await engine.recomputeEmployee(db, run, adjustment.employee_uid);
  res.status(201).json({ adjustment, payslip });
}));

router.delete('/runs/:id/adjustments/:adjId', adminOnly, h(async (req, res) => {
  const db = getDB();
  const run = await engine.getRun(db, req.params.id);
  engine.requireDraft(run);
  const adjustment = await db.collection('payroll_adjustments').findOne({ id: req.params.adjId, run_id: run.id });
  if (!adjustment) fail(404, 'Adjustment not found');
  await db.collection('payroll_adjustments').deleteOne({ id: adjustment.id });
  const payslip = await engine.recomputeEmployee(db, run, adjustment.employee_uid);
  res.json({ status: 'deleted', payslip });
}));

// ============= PY-4 PAYSLIPS =============

const canSeePayslip = (req, payslip) =>
  req.user.role === 'admin' || (payslip.employee_email === req.user.email && ['locked', 'paid'].includes(payslip.status));

router.get('/payslips/:id', h(async (req, res) => {
  const payslip = await getDB().collection('payslips').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!payslip || !canSeePayslip(req, payslip)) fail(404, 'Payslip not found');
  res.json(payslip);
}));

router.get('/payslips/:id/pdf', h(async (req, res) => {
  const db = getDB();
  const payslip = await db.collection('payslips').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!payslip || !canSeePayslip(req, payslip)) fail(404, 'Payslip not found');
  const company = await companyInfo(db, await getSettings(db));
  const pdf = await buildPayslipPdf(payslip, company);
  sendFile(res, pdf, `payslip-${payslip.employee_code || payslip.employee_uid}-${payslip.month}.pdf`, 'application/pdf');
}));

router.get('/my/payslips', h(async (req, res) => {
  const payslips = await getDB().collection('payslips')
    .find({ employee_email: req.user.email, status: { $in: ['locked', 'paid'] } }, { projection: { _id: 0, lop_dates: 0 } })
    .sort({ month: -1 })
    .toArray();
  res.json(payslips);
}));

router.get('/my/summary', h(async (req, res) => {
  const db = getDB();
  const latest = await db.collection('payslips')
    .find({ employee_email: req.user.email, status: { $in: ['locked', 'paid'] } }, { projection: { _id: 0, id: 1, month: 1, net_pay: 1, gross_earnings: 1, total_deductions: 1, status: 1 } })
    .sort({ month: -1 }).limit(1).toArray();
  const loans = await db.collection('loans').find({ employee_email: req.user.email, status: { $in: ['pending', 'approved', 'disbursed'] } }, { projection: { _id: 0, id: 1, outstanding: 1, emi: 1, status: 1, principal: 1 } }).toArray();
  const fy = fyOf(currentMonth());
  const declaration = await db.collection('tax_declarations').findOne({ employee_email: req.user.email, financial_year: fy }, { projection: { _id: 0, id: 1, tax_regime: 1, items: 1 } });
  res.json({
    latest_payslip: latest[0] || null,
    loans,
    financial_year: fy,
    declaration: declaration ? { id: declaration.id, tax_regime: declaration.tax_regime, items: declaration.items.length, pending: declaration.items.filter(i => i.status === 'declared').length } : null
  });
}));

router.get('/dashboard', adminOnly, h(async (req, res) => {
  const db = getDB();
  const month = currentMonth();
  const [currentRun, lastRuns, pendingDeclarations, pendingLoans, activeEmployees, statutoryDocs] = await Promise.all([
    db.collection('payroll_runs').findOne({ month }, { projection: { _id: 0, settings_snapshot: 0, skipped: 0 } }),
    db.collection('payroll_runs').find({}, { projection: { _id: 0, id: 1, month: 1, status: 1, totals: 1, employee_count: 1 } }).sort({ month: -1 }).limit(6).toArray(),
    db.collection('tax_declarations').countDocuments({ financial_year: fyOf(month), 'items.status': 'declared' }),
    db.collection('loans').countDocuments({ status: 'pending' }),
    db.collection('employees').find({ employment_status: { $ne: 'exited' } }, { projection: { _id: 0, employee_id: 1, employee_code: 1, id: 1 } }).toArray(),
    db.collection('employee_statutory').find({}, { projection: { _id: 0, employee_uid: 1, bank_account_number: 1, ifsc: 1, pan: 1 } }).toArray()
  ]);
  const st = Object.fromEntries(statutoryDocs.map(s => [s.employee_uid, s]));
  const uids = activeEmployees.map(employeeUid);
  res.json({
    month,
    current_run: currentRun,
    recent_runs: lastRuns.reverse(),
    pending_declarations: pendingDeclarations,
    pending_loans: pendingLoans,
    missing_bank: uids.filter(u => !st[u]?.bank_account_number || !st[u]?.ifsc).length,
    missing_pan: uids.filter(u => !st[u]?.pan).length,
    active_employees: uids.length
  });
}));

// ============= PY-6 STATUTORY DETAILS =============

const statutoryFields = {
  pan: Joi.string().trim().uppercase().pattern(PAN_RE).allow('', null).messages({ 'string.pattern.base': 'PAN must look like ABCDE1234F' }),
  uan: Joi.string().trim().pattern(UAN_RE).allow('', null).messages({ 'string.pattern.base': 'UAN must be 12 digits' }),
  bank_name: Joi.string().trim().max(100).allow('', null),
  bank_account_number: Joi.string().trim().pattern(ACCOUNT_RE).allow('', null).messages({ 'string.pattern.base': 'Account number must be 9–18 digits' }),
  ifsc: Joi.string().trim().uppercase().pattern(IFSC_RE).allow('', null).messages({ 'string.pattern.base': 'IFSC must look like HDFC0001234' }),
  account_holder_name: Joi.string().trim().max(100).allow('', null)
};

const adminStatutorySchema = Joi.object({
  ...statutoryFields,
  esic_number: Joi.string().trim().pattern(ESIC_RE).allow('', null).messages({ 'string.pattern.base': 'ESIC number must be 10 or 17 digits' }),
  tax_regime: Joi.string().valid('new', 'old'),
  pt_state: Joi.string().valid(...stateCodes).allow(null, ''),
  pf_opt_out: Joi.boolean()
}).min(1);

const selfStatutorySchema = Joi.object(statutoryFields).min(1);

const cleanStatutory = (body) => Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));

async function upsertStatutory(db, employee, patch, userEmail) {
  const uid = employeeUid(employee);
  const now = new Date();
  await db.collection('employee_statutory').updateOne(
    { employee_uid: uid },
    {
      $set: { ...patch, employee_email: employee.email, employee_name: employee.full_name, updated_at: now, updated_by: userEmail },
      $setOnInsert: { employee_uid: uid, ...(patch.tax_regime ? {} : { tax_regime: 'new' }), created_at: now }
    },
    { upsert: true }
  );
  return db.collection('employee_statutory').findOne({ employee_uid: uid }, { projection: { _id: 0 } });
}

const statutoryView = (employee, doc) => ({
  employee_uid: employeeUid(employee),
  employee_name: employee.full_name,
  employee_email: employee.email,
  employee_code: employee.employee_id || employee.employee_code || null,
  department: employee.department || null,
  pan: doc?.pan || null,
  uan: doc?.uan || null,
  esic_number: doc?.esic_number || null,
  bank_name: doc?.bank_name || null,
  bank_account_number: doc?.bank_account_number || null,
  ifsc: doc?.ifsc || null,
  account_holder_name: doc?.account_holder_name || null,
  tax_regime: doc?.tax_regime || 'new',
  pt_state: doc?.pt_state || null,
  pf_opt_out: !!doc?.pf_opt_out,
  updated_at: doc?.updated_at || null
});

router.get('/statutory', adminOnly, h(async (req, res) => {
  const db = getDB();
  const employees = await db.collection('employees').find({ employment_status: { $ne: 'exited' } }, { projection: { _id: 0 } }).sort({ full_name: 1 }).toArray();
  const map = await statutoryMap(db, employees.map(employeeUid));
  res.json(employees.map(e => statutoryView(e, map[employeeUid(e)])));
}));

router.put('/statutory/:uid', adminOnly, validate(adminStatutorySchema), h(async (req, res) => {
  const db = getDB();
  const employee = await findEmployeeByUid(db, req.params.uid);
  const doc = await upsertStatutory(db, employee, cleanStatutory(req.validatedBody), req.user.email);
  res.json(statutoryView(employee, doc));
}));

router.get('/my/statutory', h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  const doc = await db.collection('employee_statutory').findOne({ employee_uid: employeeUid(employee) }, { projection: { _id: 0 } });
  res.json(statutoryView(employee, doc));
}));

router.put('/my/statutory', validate(selfStatutorySchema), h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  const doc = await upsertStatutory(db, employee, cleanStatutory(req.validatedBody), req.user.email);
  res.json(statutoryView(employee, doc));
}));

// ============= PY-6 STATUTORY FILES / PY-10 BANK FILE =============

const lockedRunSlips = async (db, runId) => {
  const run = await engine.getRun(db, runId);
  if (run.status === 'draft') fail(409, 'Lock the payroll run before generating statutory or bank files');
  const payslips = await db.collection('payslips').find({ run_id: runId }, { projection: { _id: 0 } }).sort({ employee_name: 1 }).toArray();
  const map = await statutoryMap(db, payslips.map(p => p.employee_uid));
  return { run, payslips, map };
};

router.get('/runs/:id/compliance', adminOnly, h(async (req, res) => {
  const db = getDB();
  const run = await engine.getRun(db, req.params.id);
  const payslips = await db.collection('payslips').find({ run_id: run.id }, { projection: { _id: 0 } }).toArray();
  const map = await statutoryMap(db, payslips.map(p => p.employee_uid));
  const pick = (p) => ({ employee_uid: p.employee_uid, employee_name: p.employee_name, employee_email: p.employee_email, net_pay: p.net_pay });
  res.json({
    run_id: run.id,
    month: run.month,
    missing_bank: payslips.filter(p => p.net_pay > 0 && (!map[p.employee_uid]?.bank_account_number || !map[p.employee_uid]?.ifsc)).map(pick),
    missing_uan: payslips.filter(p => p.statutory?.pf_employee > 0 && !map[p.employee_uid]?.uan).map(pick),
    missing_esic: payslips.filter(p => p.statutory?.esi_applicable && !map[p.employee_uid]?.esic_number).map(pick),
    missing_pan: payslips.filter(p => !map[p.employee_uid]?.pan).map(pick),
    pf_members: payslips.filter(p => p.statutory?.pf_employee > 0).length,
    esi_members: payslips.filter(p => p.statutory?.esi_applicable).length
  });
}));

router.get('/runs/:id/ecr', adminOnly, h(async (req, res) => {
  const { run, payslips, map } = await lockedRunSlips(getDB(), req.params.id);
  const ecr = buildEcr(payslips, map);
  res.setHeader('X-Members-Included', String(ecr.included));
  res.setHeader('X-Missing-UAN', String(ecr.missing.length));
  sendFile(res, ecr.text, `ECR-${run.month}.txt`, 'text/plain; charset=utf-8');
}));

router.get('/runs/:id/esi', adminOnly, h(async (req, res) => {
  const { run, payslips, map } = await lockedRunSlips(getDB(), req.params.id);
  const esi = buildEsiCsv(payslips, map);
  res.setHeader('X-Missing-ESIC', String(esi.missing.length));
  sendFile(res, esi.csv, `ESI-${run.month}.csv`, 'text/csv; charset=utf-8');
}));

router.get('/runs/:id/pt', adminOnly, h(async (req, res) => {
  const { run, payslips } = await lockedRunSlips(getDB(), req.params.id);
  sendFile(res, buildPtCsv(payslips).csv, `PT-${run.month}.csv`, 'text/csv; charset=utf-8');
}));

router.get('/runs/:id/bank-file', adminOnly, h(async (req, res) => {
  const format = req.query.format === 'hdfc' ? 'hdfc' : 'standard';
  const { run, payslips, map } = await lockedRunSlips(getDB(), req.params.id);
  const file = buildBankFile(payslips, map, { month: run.month, format, paymentDate: run.paid_at || new Date() });
  res.setHeader('X-Included', String(file.included));
  res.setHeader('X-Missing-Bank', String(file.missing.length));
  res.setHeader('X-Total-Amount', String(file.total));
  sendFile(res, file.csv, `${format === 'hdfc' ? 'HDFC-bulk' : 'bank-transfer'}-${run.month}.csv`, 'text/csv; charset=utf-8');
}));

router.get('/runs/:id/register', adminOnly, h(async (req, res) => {
  const db = getDB();
  const run = await engine.getRun(db, req.params.id);
  const payslips = await db.collection('payslips').find({ run_id: run.id }, { projection: { _id: 0 } }).sort({ employee_name: 1 }).toArray();
  const rows = payslips.map(p => [
    p.employee_code, p.employee_name, p.department, p.payable_days, p.lop_days, p.gross_earnings, p.lop_amount,
    p.statutory.pf_employee, p.statutory.esi_employee, p.statutory.pt, p.tax.monthly_tds, p.total_deductions, p.net_pay,
    p.employer_contributions.pf, p.employer_contributions.esi
  ]);
  const csv = toCsv(['Employee Code', 'Name', 'Department', 'Paid Days', 'LOP Days', 'Gross', 'LOP', 'PF (EE)', 'ESI (EE)', 'PT', 'TDS', 'Total Deductions', 'Net Pay', 'PF (ER)', 'ESI (ER)'], rows);
  sendFile(res, csv, `payroll-register-${run.month}.csv`, 'text/csv; charset=utf-8');
}));

// ============= PY-6 FORM 16 =============

const fyParam = (req) => {
  const fy = req.query.fy || fyOf(currentMonth());
  if (!isValidFy(fy)) fail(422, 'fy must look like 2025-26');
  return fy;
};

router.get('/form16', adminOnly, h(async (req, res) => {
  const fy = fyParam(req);
  const rows = await getDB().collection('payslips').aggregate([
    { $match: { financial_year: fy, status: { $in: ['locked', 'paid'] } } },
    { $sort: { month: 1 } },
    {
      $group: {
        _id: '$employee_uid',
        employee_name: { $last: '$employee_name' },
        employee_code: { $last: '$employee_code' },
        employee_email: { $last: '$employee_email' },
        months: { $sum: 1 },
        gross: { $sum: '$taxable_gross' },
        tds: { $sum: '$tax.monthly_tds' },
        regime: { $last: '$tax_regime' }
      }
    },
    { $sort: { employee_name: 1 } }
  ]).toArray();
  res.json(rows.map(r => ({ employee_uid: r._id, ...r, _id: undefined, gross: round2(r.gross), tds: round2(r.tds) })));
}));

const sendForm16 = async (res, db, uid, fy, asPdf) => {
  const settings = await getSettings(db);
  const data = await buildForm16Data(db, uid, fy, settings);
  if (!data) fail(404, `No locked payslips for FY ${fy}`);
  if (!asPdf) return res.json(data);
  const pdf = await buildForm16Pdf(data, await companyInfo(db, settings));
  sendFile(res, pdf, `Form16-PartB-${data.employee_code || uid}-${fy}.pdf`, 'application/pdf');
};

router.get('/form16/:uid', adminOnly, h(async (req, res) => sendForm16(res, getDB(), req.params.uid, fyParam(req), false)));
router.get('/form16/:uid/pdf', adminOnly, h(async (req, res) => sendForm16(res, getDB(), req.params.uid, fyParam(req), true)));

router.get('/my/form16', h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  await sendForm16(res, db, employeeUid(employee), fyParam(req), false);
}));

router.get('/my/form16/pdf', h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  await sendForm16(res, db, employeeUid(employee), fyParam(req), true);
}));

// ============= PY-5 INVESTMENT DECLARATIONS =============

const itemSchema = Joi.object({
  id: Joi.string().max(64),
  section: Joi.string().valid(...declarationsSvc.SECTIONS).required(),
  label: Joi.string().trim().max(120).allow('', null),
  declared_amount: Joi.number().min(0).max(100000000).required(),
  landlord_name: Joi.string().trim().max(120).allow('', null),
  landlord_pan: Joi.string().trim().uppercase().pattern(PAN_RE).allow('', null).messages({ 'string.pattern.base': 'Landlord PAN must look like ABCDE1234F' }),
  rent_address: Joi.string().trim().max(300).allow('', null)
});

const declarationSchema = Joi.object({
  financial_year: Joi.string().pattern(statutory.FY_RE).required(),
  tax_regime: Joi.string().valid('new', 'old').required(),
  metro_city: Joi.boolean().default(false),
  parents_senior_citizen: Joi.boolean().default(false),
  items: Joi.array().items(itemSchema).max(50).default([])
});

const emptyDeclaration = (employee, fy, regime) => ({
  id: null,
  employee_uid: employeeUid(employee),
  employee_email: employee.email,
  employee_name: employee.full_name,
  financial_year: fy,
  tax_regime: regime,
  metro_city: false,
  parents_senior_citizen: false,
  items: []
});

// Employee is a senior citizen (60+) by the end of the FY: higher 80D (self) limit
const isSeniorInFy = (employee, fy) => {
  const age = statutory.ageOn(employee?.date_of_birth, new Date(Date.UTC(statutory.fyStartYear(fy) + 1, 2, 31)));
  return age != null && age >= 60;
};

router.get('/declarations/my', h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  const fy = fyParam(req);
  const settings = await getSettings(db);
  const uid = employeeUid(employee);
  const st = await db.collection('employee_statutory').findOne({ employee_uid: uid }, { projection: { _id: 0, tax_regime: 1 } });
  const declaration = await db.collection('tax_declarations').findOne({ employee_uid: uid, financial_year: fy }, { projection: { _id: 0 } })
    || emptyDeclaration(employee, fy, st?.tax_regime || 'new');
  res.json({
    ...declaration,
    summary: declarationsSvc.summarize(declaration, settings, { selfSenior: isSeniorInFy(employee, fy) }),
    window_open: settings.declaration_window_open !== false,
    proof_deadline: settings.proof_deadline || null
  });
}));

router.put('/declarations/my', validate(declarationSchema), h(async (req, res) => {
  const db = getDB();
  const settings = await getSettings(db);
  if (settings.declaration_window_open === false) fail(409, 'The declaration window is closed');
  const employee = await myEmployee(db, req);
  const b = req.validatedBody;
  if (!isValidFy(b.financial_year)) fail(422, 'financial_year must look like 2025-26');
  const uid = employeeUid(employee);

  for (const item of b.items) {
    if (item.section === 'HRA' && item.declared_amount > declarationsSvc.LANDLORD_PAN_THRESHOLD && !item.landlord_pan) {
      fail(422, `Landlord PAN is required when annual rent exceeds ₹${declarationsSvc.LANDLORD_PAN_THRESHOLD.toLocaleString('en-IN')}`);
    }
    if (item.section === 'HRA' && !item.landlord_name) fail(422, 'Landlord name is required for rent (HRA)');
  }

  const existing = await db.collection('tax_declarations').findOne({ employee_uid: uid, financial_year: b.financial_year });
  const oldItems = Object.fromEntries((existing?.items || []).map(i => [i.id, i]));
  const now = new Date();
  const items = b.items.map(input => {
    const prev = input.id ? oldItems[input.id] : null;
    const unchanged = prev && prev.section === input.section && Number(prev.declared_amount) === Number(input.declared_amount);
    return {
      id: prev ? prev.id : generateUUID(),
      section: input.section,
      label: input.label || statutory.DEDUCTION_LABELS[input.section],
      declared_amount: round2(input.declared_amount),
      landlord_name: input.landlord_name || null,
      landlord_pan: input.landlord_pan || null,
      rent_address: input.rent_address || null,
      proofs: prev?.proofs || [],
      // Changing an amount sends the item back for verification
      status: unchanged ? prev.status : 'declared',
      approved_amount: unchanged ? prev.approved_amount ?? null : null,
      rejection_reason: unchanged ? prev.rejection_reason ?? null : null,
      verified_by: unchanged ? prev.verified_by ?? null : null,
      verified_at: unchanged ? prev.verified_at ?? null : null
    };
  });

  // Files of removed items
  const keptIds = new Set(items.map(i => i.id));
  for (const old of existing?.items || []) {
    if (!keptIds.has(old.id)) for (const p of old.proofs || []) removeFile(p.key);
  }

  await db.collection('tax_declarations').updateOne(
    { employee_uid: uid, financial_year: b.financial_year },
    {
      $set: { tax_regime: b.tax_regime, metro_city: b.metro_city, parents_senior_citizen: b.parents_senior_citizen, items, employee_email: employee.email, employee_name: employee.full_name, submitted_at: now, updated_at: now },
      $setOnInsert: { id: generateUUID(), employee_uid: uid, financial_year: b.financial_year, created_at: now }
    },
    { upsert: true }
  );
  // The chosen regime drives TDS
  if (b.financial_year === fyOf(currentMonth()) || !existing) {
    await upsertStatutory(db, employee, { tax_regime: b.tax_regime }, req.user.email);
  }
  const saved = await db.collection('tax_declarations').findOne({ employee_uid: uid, financial_year: b.financial_year }, { projection: { _id: 0 } });
  if (items.some(i => i.status === 'declared')) {
    notifyAdmins(db, {
      type: 'tax_declaration_submitted',
      title: 'Investment declaration submitted',
      message: `${employee.full_name} submitted investment declarations for FY ${b.financial_year}.`,
      actionUrl: '/payroll/declarations',
      metadata: { declaration_id: saved.id }
    }).catch(() => {});
  }
  res.json({ ...saved, summary: declarationsSvc.summarize(saved, settings, { selfSenior: isSeniorInFy(employee, b.financial_year) }) });
}));

const proofUpload = (req, res, next) => {
  multer({ storage: multer.memoryStorage(), limits: { fileSize: PROOF_MAX_BYTES } }).single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ detail: 'File is larger than 5 MB' });
    if (err) return res.status(400).json({ detail: err.message });
    next();
  });
};

router.post('/declarations/my/items/:itemId/proofs', proofUpload, h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  if (!req.file) fail(400, 'Attach a file in the "file" field');
  if (!PROOF_TYPES.includes(req.file.mimetype)) fail(400, 'Proofs must be PDF, JPG, PNG or WEBP');
  const fy = req.body.financial_year || fyOf(currentMonth());
  const uid = employeeUid(employee);
  const declaration = await db.collection('tax_declarations').findOne({ employee_uid: uid, financial_year: fy });
  const item = declaration?.items?.find(i => i.id === req.params.itemId);
  if (!item) fail(404, 'Declaration item not found');
  if (item.status === 'approved') fail(409, 'This item is already verified');
  if ((item.proofs || []).length >= 10) fail(400, 'At most 10 proofs per item');

  const stored = await storeFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'tax-proofs', uid, { visibility: 'private' });
  const proof = {
    id: generateUUID(),
    key: stored.key,
    url: stored.url,
    name: req.file.originalname,
    mime_type: req.file.mimetype,
    size: req.file.size,
    uploaded_at: new Date()
  };
  await db.collection('tax_declarations').updateOne(
    { id: declaration.id, 'items.id': item.id },
    {
      $push: { 'items.$.proofs': proof },
      // A new proof re-opens a rejected item for verification
      $set: { 'items.$.status': 'declared', 'items.$.rejection_reason': null, updated_at: new Date() }
    }
  );
  res.status(201).json(proof);
}));

router.delete('/declarations/my/items/:itemId/proofs/:proofId', h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  const fy = req.query.fy || fyOf(currentMonth());
  const declaration = await db.collection('tax_declarations').findOne({ employee_uid: employeeUid(employee), financial_year: fy });
  const item = declaration?.items?.find(i => i.id === req.params.itemId);
  const proof = item?.proofs?.find(p => p.id === req.params.proofId);
  if (!proof) fail(404, 'Proof not found');
  if (item.status === 'approved') fail(409, 'This item is already verified');
  await db.collection('tax_declarations').updateOne(
    { id: declaration.id, 'items.id': item.id },
    { $pull: { 'items.$.proofs': { id: proof.id } }, $set: { updated_at: new Date() } }
  );
  removeFile(proof.key);
  res.json({ status: 'deleted' });
}));

/** Stream a proof file to its owner or an admin. */
router.get('/declarations/:id/items/:itemId/proofs/:proofId', h(async (req, res) => {
  const db = getDB();
  const declaration = await db.collection('tax_declarations').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!declaration || (req.user.role !== 'admin' && declaration.employee_email !== req.user.email)) fail(404, 'Proof not found');
  const proof = declaration.items.find(i => i.id === req.params.itemId)?.proofs?.find(p => p.id === req.params.proofId);
  if (!proof) fail(404, 'Proof not found');
  if (proof.key?.startsWith('local/')) {
    const filePath = path.join(LOCAL_ROOT, proof.key.slice('local/'.length));
    if (!filePath.startsWith(LOCAL_ROOT) || !fs.existsSync(filePath)) fail(404, 'File is no longer available');
    res.setHeader('Content-Type', proof.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(proof.name).replace(/"/g, '')}"`);
    return fs.createReadStream(filePath).pipe(res);
  }
  const s3 = require('../../services/s3Service');
  const url = await s3.getPresignedUrl(proof.key, 600).catch(() => proof.url);
  res.redirect(url || proof.url);
}));

router.get('/declarations', adminOnly, h(async (req, res) => {
  const db = getDB();
  const fy = fyParam(req);
  const settings = await getSettings(db);
  const query = { financial_year: fy };
  if (req.query.status === 'pending') query['items.status'] = 'declared';
  const list = await db.collection('tax_declarations').find(query, { projection: { _id: 0 } }).sort({ updated_at: -1 }).toArray();
  res.json(list.map(d => ({ ...d, summary: declarationsSvc.summarize(d, settings) })));
}));

router.get('/declarations/:id', adminOnly, h(async (req, res) => {
  const db = getDB();
  const declaration = await db.collection('tax_declarations').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  if (!declaration) fail(404, 'Declaration not found');
  res.json({ ...declaration, summary: declarationsSvc.summarize(declaration, await getSettings(db)) });
}));

const verifySchema = Joi.object({
  action: Joi.string().valid('approve', 'reject').required(),
  approved_amount: Joi.number().min(0).max(100000000),
  reason: Joi.string().trim().max(300).allow('', null)
});

router.post('/declarations/:id/items/:itemId/verify', adminOnly, validate(verifySchema), h(async (req, res) => {
  const db = getDB();
  const b = req.validatedBody;
  const declaration = await db.collection('tax_declarations').findOne({ id: req.params.id }, { projection: { _id: 0 } });
  const item = declaration?.items?.find(i => i.id === req.params.itemId);
  if (!item) fail(404, 'Declaration item not found');
  const now = new Date();
  let set;
  if (b.action === 'approve') {
    const amount = b.approved_amount ?? item.declared_amount;
    if (amount > item.declared_amount) fail(400, 'Approved amount cannot exceed the declared amount');
    set = { 'items.$.status': 'approved', 'items.$.approved_amount': round2(amount), 'items.$.rejection_reason': null };
  } else {
    if (!b.reason) fail(422, 'Give a reason for rejecting');
    set = { 'items.$.status': 'rejected', 'items.$.approved_amount': 0, 'items.$.rejection_reason': b.reason };
  }
  await db.collection('tax_declarations').updateOne(
    { id: declaration.id, 'items.id': item.id },
    { $set: { ...set, 'items.$.verified_by': req.user.email, 'items.$.verified_at': now, updated_at: now } }
  );
  notifyEmail(db, declaration.employee_email, {
    type: b.action === 'approve' ? 'tax_proof_approved' : 'tax_proof_rejected',
    title: b.action === 'approve' ? 'Investment proof approved' : 'Investment proof rejected',
    message: b.action === 'approve'
      ? `${item.label}: ₹${(b.approved_amount ?? item.declared_amount).toLocaleString('en-IN')} approved for FY ${declaration.financial_year}.`
      : `${item.label}: ${b.reason}`,
    actionUrl: '/my-tax',
    metadata: { declaration_id: declaration.id, item_id: item.id }
  }).catch(() => {});
  const saved = await db.collection('tax_declarations').findOne({ id: declaration.id }, { projection: { _id: 0 } });
  res.json({ ...saved, summary: declarationsSvc.summarize(saved, await getSettings(db)) });
}));

// ============= PY-7 LOANS & ADVANCES =============

const loanRequestSchema = Joi.object({
  type: Joi.string().valid('loan', 'advance').default('loan'),
  amount: Joi.number().positive().max(10000000).required(),
  reason: Joi.string().trim().min(3).max(500).required(),
  tenure_months: Joi.number().integer().min(1).max(60).required()
});

const loanView = (l) => l && ({ ...l, repayments: (l.repayments || []).sort((a, b) => new Date(a.at) - new Date(b.at)) });

const getLoan = async (db, id) => {
  const loan = await db.collection('loans').findOne({ id }, { projection: { _id: 0 } });
  if (!loan) fail(404, 'Loan not found');
  return loan;
};

router.post('/loans/my', validate(loanRequestSchema), h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  const uid = employeeUid(employee);
  const b = req.validatedBody;
  const open = await db.collection('loans').countDocuments({ employee_uid: uid, status: 'pending' });
  if (open) fail(409, 'You already have a pending request');
  const now = new Date();
  const loan = {
    id: generateUUID(),
    employee_uid: uid,
    employee_email: employee.email,
    employee_name: employee.full_name,
    department: employee.department || null,
    type: b.type,
    principal: round2(b.amount),
    requested_amount: round2(b.amount),
    reason: b.reason,
    tenure_months: b.tenure_months,
    emi: round2(Math.ceil(b.amount / b.tenure_months)),
    outstanding: 0,
    recovered: 0,
    status: 'pending',
    start_month: null,
    repayments: [],
    created_at: now,
    updated_at: now
  };
  await db.collection('loans').insertOne({ ...loan });
  notifyAdmins(db, {
    type: 'loan_requested',
    title: `${b.type === 'advance' ? 'Salary advance' : 'Loan'} request`,
    message: `${employee.full_name} requested ₹${loan.principal.toLocaleString('en-IN')} over ${b.tenure_months} month(s).`,
    actionUrl: '/payroll/loans',
    metadata: { loan_id: loan.id }
  }).catch(() => {});
  res.status(201).json(loan);
}));

router.get('/loans/my', h(async (req, res) => {
  const loans = await getDB().collection('loans').find({ employee_email: req.user.email }, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
  res.json(loans.map(loanView));
}));

router.delete('/loans/my/:id', h(async (req, res) => {
  const db = getDB();
  const loan = await getLoan(db, req.params.id);
  if (loan.employee_email !== req.user.email) fail(404, 'Loan not found');
  if (loan.status !== 'pending') fail(409, 'Only pending requests can be cancelled');
  await db.collection('loans').updateOne({ id: loan.id, status: 'pending' }, { $set: { status: 'cancelled', updated_at: new Date() } });
  res.json({ status: 'cancelled' });
}));

router.get('/loans', adminOnly, h(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.employee_uid) query.employee_uid = req.query.employee_uid;
  const loans = await getDB().collection('loans').find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
  res.json(loans.map(loanView));
}));

router.get('/loans/:id', h(async (req, res) => {
  const loan = await getLoan(getDB(), req.params.id);
  if (req.user.role !== 'admin' && loan.employee_email !== req.user.email) fail(404, 'Loan not found');
  res.json(loanView(loan));
}));

const loanTermsSchema = Joi.object({
  principal: Joi.number().positive().max(10000000),
  emi: Joi.number().positive().max(10000000),
  tenure_months: Joi.number().integer().min(1).max(60),
  start_month: monthSchema,
  note: Joi.string().max(300).allow('', null)
});

router.post('/loans/:id/approve', adminOnly, validate(loanTermsSchema), h(async (req, res) => {
  const db = getDB();
  const loan = await getLoan(db, req.params.id);
  if (loan.status !== 'pending') fail(409, `Loan is ${loan.status}`);
  const b = req.validatedBody;
  const principal = round2(b.principal ?? loan.principal);
  const tenure = b.tenure_months ?? loan.tenure_months;
  const emi = round2(b.emi ?? Math.ceil(principal / tenure));
  if (emi > principal) fail(400, 'EMI cannot exceed the principal');
  const now = new Date();
  await db.collection('loans').updateOne({ id: loan.id, status: 'pending' }, {
    $set: {
      status: 'approved', principal, emi, tenure_months: Math.ceil(principal / emi),
      start_month: b.start_month || null, approval_note: b.note || null,
      approved_by: req.user.email, approved_at: now, updated_at: now
    }
  });
  notifyEmail(db, loan.employee_email, {
    type: 'loan_approved', title: 'Loan request approved',
    message: `Your request for ₹${principal.toLocaleString('en-IN')} was approved. EMI ₹${emi.toLocaleString('en-IN')}.`,
    actionUrl: '/my-loans', metadata: { loan_id: loan.id }
  }).catch(() => {});
  res.json(loanView(await getLoan(db, loan.id)));
}));

router.post('/loans/:id/reject', adminOnly, validate(Joi.object({ reason: Joi.string().trim().min(2).max(300).required() })), h(async (req, res) => {
  const db = getDB();
  const loan = await getLoan(db, req.params.id);
  if (loan.status !== 'pending') fail(409, `Loan is ${loan.status}`);
  const now = new Date();
  await db.collection('loans').updateOne({ id: loan.id, status: 'pending' }, {
    $set: { status: 'rejected', rejection_reason: req.validatedBody.reason, rejected_by: req.user.email, rejected_at: now, updated_at: now }
  });
  notifyEmail(db, loan.employee_email, {
    type: 'loan_rejected', title: 'Loan request rejected', message: req.validatedBody.reason,
    actionUrl: '/my-loans', metadata: { loan_id: loan.id }
  }).catch(() => {});
  res.json(loanView(await getLoan(db, loan.id)));
}));

router.post('/loans/:id/disburse', adminOnly, validate(Joi.object({
  start_month: monthSchema,
  disbursed_on: Joi.date().iso(),
  reference: Joi.string().max(100).allow('', null)
})), h(async (req, res) => {
  const db = getDB();
  const loan = await getLoan(db, req.params.id);
  if (loan.status !== 'approved') fail(409, 'Only approved loans can be disbursed');
  const b = req.validatedBody;
  const startMonth = b.start_month || loan.start_month || currentMonth();
  const lockedRun = await db.collection('payroll_runs').findOne({ month: startMonth, status: { $ne: 'draft' } });
  if (lockedRun) fail(400, `Payroll for ${startMonth} is already locked — choose a later first EMI month`);
  const now = new Date();
  await db.collection('loans').updateOne({ id: loan.id, status: 'approved' }, {
    $set: {
      status: 'disbursed', outstanding: loan.principal, start_month: startMonth,
      disbursed_on: b.disbursed_on || now, disbursement_reference: b.reference || null,
      disbursed_by: req.user.email, updated_at: now
    }
  });
  res.json(loanView(await getLoan(db, loan.id)));
}));

router.put('/loans/:id', adminOnly, validate(Joi.object({
  emi: Joi.number().positive().max(10000000),
  start_month: monthSchema,
  note: Joi.string().max(300).allow('', null)
}).min(1)), h(async (req, res) => {
  const db = getDB();
  const loan = await getLoan(db, req.params.id);
  if (!['approved', 'disbursed'].includes(loan.status)) fail(409, `Loan is ${loan.status}`);
  const b = req.validatedBody;
  const set = { updated_at: new Date() };
  if (b.emi != null) {
    if (b.emi > loan.principal) fail(400, 'EMI cannot exceed the principal');
    set.emi = round2(b.emi);
  }
  if (b.start_month) set.start_month = b.start_month;
  if (b.note != null) set.admin_note = b.note;
  await db.collection('loans').updateOne({ id: loan.id }, { $set: set });
  res.json(loanView(await getLoan(db, loan.id)));
}));

const recordRepayment = async (db, loan, amount, type, user, note) => {
  const now = new Date();
  const remaining = round2(loan.outstanding - amount);
  await db.collection('loans').updateOne({ id: loan.id, status: 'disbursed', outstanding: loan.outstanding }, {
    $set: {
      outstanding: Math.max(0, remaining),
      updated_at: now,
      ...(remaining <= 0 ? { status: 'closed', closed_at: now } : {})
    },
    $inc: { recovered: amount },
    $push: { repayments: { id: generateUUID(), type, month: currentMonth(), run_id: null, amount, note: note || null, by: user.email, at: now } }
  });
  return getLoan(db, loan.id);
};

router.post('/loans/:id/prepay', adminOnly, validate(Joi.object({
  amount: Joi.number().positive().max(10000000).required(),
  note: Joi.string().max(300).allow('', null)
})), h(async (req, res) => {
  const db = getDB();
  const loan = await getLoan(db, req.params.id);
  if (loan.status !== 'disbursed') fail(409, 'Only disbursed loans can be prepaid');
  const amount = round2(req.validatedBody.amount);
  if (amount > loan.outstanding) fail(400, `Prepayment exceeds the outstanding ₹${loan.outstanding}`);
  res.json(loanView(await recordRepayment(db, loan, amount, 'prepayment', req.user, req.validatedBody.note)));
}));

router.post('/loans/:id/close', adminOnly, validate(Joi.object({ note: Joi.string().max(300).allow('', null) })), h(async (req, res) => {
  const db = getDB();
  const loan = await getLoan(db, req.params.id);
  if (loan.status !== 'disbursed') fail(409, 'Only disbursed loans can be closed');
  res.json(loanView(await recordRepayment(db, loan, loan.outstanding, 'closure', req.user, req.validatedBody.note)));
}));

/** Manual / fallback for the employee.exited listener: close loans recovered in F&F. */
router.post('/loans/settle-exit/:uid', adminOnly, h(async (req, res) => {
  const db = getDB();
  const employee = await findEmployeeByUid(db, req.params.uid);
  const result = await settleLoansOnExit(db, { employee_uid: employeeUid(employee), email: employee.email });
  res.json({ employee_uid: employeeUid(employee), ...result });
}));

// ============= PY-9 GRATUITY =============

const gratuitySchema = Joi.object({
  employee_uid: Joi.string().allow('', null),
  basic_monthly: Joi.number().min(0).max(100000000),
  joining_date: Joi.date().iso(),
  exit_date: Joi.date().iso().allow(null)
});

router.post('/gratuity/calculate', adminOnly, validate(gratuitySchema), h(async (req, res) => {
  const db = getDB();
  const b = req.validatedBody;
  let employee = null;
  let basic = b.basic_monthly;
  if (b.employee_uid) {
    employee = await findEmployeeByUid(db, b.employee_uid);
    if (basic == null) {
      const eff = await effectiveStructure(db, employee, currentMonth());
      if (eff) {
        const c = monthlyComponents(eff.structure);
        basic = c.basic + c.da;
      }
    }
  }
  const joining = b.joining_date || employee?.joining_date;
  if (basic == null) fail(422, 'basic_monthly is required (no salary structure found)');
  if (!joining) fail(422, 'joining_date is required');
  const exit = b.exit_date || employee?.exit_date || new Date();
  const result = computeGratuity({ basicMonthly: basic, joiningDate: joining, exitDate: exit });
  res.json({
    ...result,
    basic_monthly: round2(basic),
    joining_date: new Date(joining).toISOString().slice(0, 10),
    exit_date: new Date(exit).toISOString().slice(0, 10),
    employee: employee ? { uid: employeeUid(employee), name: employee.full_name } : null
  });
}));

// ============= PY-11 SALARY REVISIONS =============

const revisionSchema = Joi.object({
  employee_uid: Joi.string().required(),
  effective_from: monthSchema.required(),
  reason: Joi.string().trim().min(2).max(300).required(),
  basic_salary: Joi.number().positive().max(100000000).required(),
  components: Joi.array().items(Joi.object({
    name: Joi.string().trim().max(80).required(),
    amount: Joi.number().min(0).max(100000000).required(),
    type: Joi.string().valid('earning', 'deduction').required(),
    is_percentage: Joi.boolean().default(false),
    calculation_base: Joi.string().valid('ctc', 'basic', 'gross', 'fixed').allow(null, ''),
    order: Joi.number()
  }).unknown(true)).max(40).default([])
});

router.get('/revisions', adminOnly, h(async (req, res) => {
  const query = req.query.employee_uid ? { employee_uid: req.query.employee_uid } : {};
  const list = await getDB().collection('salary_revisions').find(query, { projection: { _id: 0 } })
    .sort({ effective_from: -1, created_at: -1 }).limit(500).toArray();
  res.json(list);
}));

router.post('/revisions', adminOnly, validate(revisionSchema), h(async (req, res) => {
  const db = getDB();
  const b = req.validatedBody;
  const employee = await findEmployeeByUid(db, b.employee_uid);
  const locked = await db.collection('payroll_runs').findOne({ month: { $gte: b.effective_from }, status: { $ne: 'draft' } }, { projection: { month: 1 } });
  const result = await saveStructure(db, employee, b, { effectiveFrom: b.effective_from, reason: b.reason, user: req.user });
  res.status(201).json({
    ...result,
    note: locked ? `Payroll from ${locked.month} is already locked; add any arrears as a one-off earning in the next run.` : null
  });
}));

router.get('/my/revisions', h(async (req, res) => {
  const db = getDB();
  const employee = await myEmployee(db, req);
  const list = await db.collection('salary_revisions').find(
    { employee_uid: employeeUid(employee) },
    { projection: { _id: 0, revised_by: 0 } }
  ).sort({ effective_from: -1, created_at: -1 }).toArray();
  res.json(list);
}));

module.exports = router;
