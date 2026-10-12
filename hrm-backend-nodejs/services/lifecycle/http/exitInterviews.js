/**
 * EL-3 Exit interviews — editable question template, employee submission
 * during notice, admin responses and aggregates.
 */

const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requireRole, validate } = require('../../../middleware/roleCheck');
const { generateUUID, serverError, notifyAdmins } = require('../common');

const TEMPLATE_KEY = 'exit_interview_template';

const DEFAULT_REASONS = [
  'Better compensation',
  'Career growth',
  'Work-life balance',
  'Relationship with manager',
  'Work environment / culture',
  'Relocation',
  'Higher studies',
  'Personal / family reasons',
  'Other'
];

const DEFAULT_QUESTIONS = [
  { id: 'reason', type: 'choice', text: 'What is the primary reason for leaving?', required: true, is_reason: true, options: DEFAULT_REASONS },
  { id: 'overall', type: 'rating', text: 'Overall, how would you rate your experience working here?', required: true },
  { id: 'manager', type: 'rating', text: 'How would you rate the support you received from your manager?', required: true },
  { id: 'growth', type: 'rating', text: 'How would you rate the learning and growth opportunities?', required: true },
  { id: 'compensation', type: 'rating', text: 'How fair was your compensation and benefits?', required: true },
  { id: 'culture', type: 'rating', text: 'How would you rate the work culture and team environment?', required: true },
  { id: 'liked', type: 'text', text: 'What did you like most about working here?', required: false },
  { id: 'improve', type: 'text', text: 'What should we improve?', required: false },
  { id: 'return', type: 'choice', text: 'Would you consider working with us again?', required: false, options: ['Yes', 'Maybe', 'No'] }
];

const questionSchema = Joi.object({
  id: Joi.string().trim().pattern(/^[a-zA-Z0-9_-]{1,40}$/).allow('', null),
  type: Joi.string().valid('rating', 'text', 'choice').required(),
  text: Joi.string().trim().min(3).max(300).required(),
  required: Joi.boolean().default(false),
  is_reason: Joi.boolean().default(false),
  options: Joi.when('type', {
    is: 'choice',
    then: Joi.array().items(Joi.string().trim().min(1).max(100)).min(2).max(20).unique().required(),
    otherwise: Joi.any().strip()
  })
});

const templateSchema = Joi.object({
  questions: Joi.array().items(questionSchema).min(1).max(40).required()
});

const submitSchema = Joi.object({
  answers: Joi.array().items(Joi.object({
    question_id: Joi.string().required(),
    rating: Joi.number().integer().min(1).max(5),
    text: Joi.string().trim().max(3000).allow(''),
    choice: Joi.string().trim().max(100)
  })).max(60).required()
});

const getTemplate = async (db) => {
  const doc = await db.collection('lifecycle_settings').findOne({ key: TEMPLATE_KEY }, { projection: { _id: 0 } });
  return doc?.questions?.length ? doc.questions : DEFAULT_QUESTIONS;
};

module.exports = (router) => {
  router.get('/exit-interview/template', async (req, res) => {
    try {
      res.json({ questions: await getTemplate(getDB()) });
    } catch (error) {
      serverError(res, 'exit template', error);
    }
  });

  router.put('/exit-interview/template', requireRole(['admin']), validate(templateSchema), async (req, res) => {
    try {
      const db = getDB();
      const seen = new Set();
      const questions = req.validatedBody.questions.map(q => {
        let id = q.id || generateUUID().slice(0, 8);
        while (seen.has(id)) id = generateUUID().slice(0, 8);
        seen.add(id);
        return { id, type: q.type, text: q.text, required: !!q.required, is_reason: q.type === 'choice' && !!q.is_reason, ...(q.type === 'choice' ? { options: q.options } : {}) };
      });
      if (questions.filter(q => q.is_reason).length > 1) {
        return res.status(400).json({ detail: 'Only one question can be marked as the reason for leaving' });
      }
      await db.collection('lifecycle_settings').updateOne(
        { key: TEMPLATE_KEY },
        { $set: { questions, updated_at: new Date(), updated_by: req.user.email }, $setOnInsert: { key: TEMPLATE_KEY } },
        { upsert: true }
      );
      res.json({ questions });
    } catch (error) {
      serverError(res, 'update exit template', error);
    }
  });

  /** GET /exit-interview/my — whether I can fill it now, the questions and my response. */
  router.get('/exit-interview/my', async (req, res) => {
    try {
      const db = getDB();
      const separation = await db.collection('separations').findOne(
        { employee_email: req.user.email, status: { $in: ['approved', 'completed'] } },
        { projection: { _id: 0, id: 1, status: 1, last_working_day: 1, type: 1 }, sort: { created_at: -1 } }
      );
      const response = separation
        ? await db.collection('exit_interviews').findOne({ separation_id: separation.id }, { projection: { _id: 0 } })
        : null;
      res.json({
        eligible: !!separation && separation.status === 'approved' && !response,
        separation: separation || null,
        questions: await getTemplate(db),
        response: response || null
      });
    } catch (error) {
      serverError(res, 'my exit interview', error);
    }
  });

  router.post('/exit-interview/my', validate(submitSchema), async (req, res) => {
    try {
      const db = getDB();
      const separation = await db.collection('separations').findOne(
        { employee_email: req.user.email, status: 'approved' },
        { sort: { created_at: -1 } }
      );
      if (!separation) return res.status(400).json({ detail: 'The exit interview opens once your resignation is accepted' });
      const existing = await db.collection('exit_interviews').findOne({ separation_id: separation.id });
      if (existing) return res.status(409).json({ detail: 'You have already submitted your exit interview' });

      const questions = await getTemplate(db);
      const byId = new Map(req.validatedBody.answers.map(a => [a.question_id, a]));
      const answers = [];
      const errors = [];
      let primaryReason = null;
      for (const q of questions) {
        const a = byId.get(q.id) || {};
        const entry = { question_id: q.id, question_text: q.text, type: q.type };
        if (q.type === 'rating') {
          if (a.rating == null) { if (q.required) errors.push(q.text); } else entry.rating = a.rating;
        } else if (q.type === 'choice') {
          if (!a.choice) { if (q.required) errors.push(q.text); } else if (!q.options.includes(a.choice)) {
            return res.status(422).json({ detail: `Invalid option for "${q.text}"` });
          } else entry.choice = a.choice;
          if (q.is_reason && entry.choice) primaryReason = entry.choice;
        } else {
          const text = (a.text || '').trim();
          if (!text) { if (q.required) errors.push(q.text); } else entry.text = text;
        }
        answers.push(entry);
      }
      if (errors.length) return res.status(422).json({ detail: `Please answer: ${errors.join('; ')}` });

      const doc = {
        id: generateUUID(),
        separation_id: separation.id,
        employee_uid: separation.employee_uid,
        employee_email: separation.employee_email,
        employee_name: separation.employee_name,
        department: separation.department || null,
        designation: separation.designation || null,
        separation_type: separation.type,
        last_working_day: separation.last_working_day,
        answers,
        primary_reason: primaryReason,
        submitted_at: new Date()
      };
      await db.collection('exit_interviews').insertOne(doc);
      delete doc._id;
      notifyAdmins(db, {
        type: 'exit_interview_submitted',
        title: 'Exit interview submitted',
        message: `${separation.employee_name} completed their exit interview.`,
        actionUrl: '/exit-interviews',
        metadata: { exit_interview_id: doc.id }
      }, req.user.email);
      res.status(201).json(doc);
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ detail: 'You have already submitted your exit interview' });
      serverError(res, 'submit exit interview', error);
    }
  });

  router.get('/exit-interviews/summary', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      const query = {};
      if (req.query.department) query.department = String(req.query.department);
      const list = await db.collection('exit_interviews').find(query, { projection: { _id: 0 } }).toArray();
      const questions = await getTemplate(db);
      const ratingStats = new Map();
      const reasons = new Map();
      for (const r of list) {
        for (const a of r.answers || []) {
          if (a.type === 'rating' && a.rating != null) {
            const s = ratingStats.get(a.question_id) || { question_id: a.question_id, text: a.question_text, total: 0, responses: 0 };
            s.total += a.rating;
            s.responses += 1;
            ratingStats.set(a.question_id, s);
          }
        }
        const reason = r.primary_reason || 'Not specified';
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
      }
      // Keep the template's question order, then any retired questions
      const order = questions.map(q => q.id);
      const ratings = [...ratingStats.values()]
        .sort((a, b) => (order.indexOf(a.question_id) + 1 || 999) - (order.indexOf(b.question_id) + 1 || 999))
        .map(s => ({ question_id: s.question_id, text: s.text, responses: s.responses, average: Math.round((s.total / s.responses) * 100) / 100 }));
      const overall = ratings.length ? Math.round((ratings.reduce((t, r) => t + r.average, 0) / ratings.length) * 100) / 100 : null;
      res.json({
        responses: list.length,
        overall_average: overall,
        ratings,
        reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
      });
    } catch (error) {
      serverError(res, 'exit interview summary', error);
    }
  });

  router.get('/exit-interviews', requireRole(['admin']), async (req, res) => {
    try {
      const db = getDB();
      const list = await db.collection('exit_interviews').find({}, { projection: { _id: 0 } }).sort({ submitted_at: -1 }).limit(1000).toArray();
      res.json(list.map(r => {
        const ratings = (r.answers || []).filter(a => a.type === 'rating' && a.rating != null);
        return {
          ...r,
          average_rating: ratings.length ? Math.round((ratings.reduce((t, a) => t + a.rating, 0) / ratings.length) * 100) / 100 : null
        };
      }));
    } catch (error) {
      serverError(res, 'list exit interviews', error);
    }
  });

  router.get('/exit-interviews/:id', requireRole(['admin']), async (req, res) => {
    try {
      const doc = await getDB().collection('exit_interviews').findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!doc) return res.status(404).json({ detail: 'Exit interview not found' });
      res.json(doc);
    } catch (error) {
      serverError(res, 'get exit interview', error);
    }
  });
};
