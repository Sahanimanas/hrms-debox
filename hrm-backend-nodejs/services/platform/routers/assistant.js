/**
 * PL-9 AI HR assistant API.
 *
 *   GET    /assistant/status     { configured, model }
 *   GET    /assistant/history    { configured, messages: [{ role, text, at, tools_used }] }
 *   POST   /assistant/chat       { message } → { reply, tools_used, messages }
 *   DELETE /assistant/history
 *
 * Admin (permission settings.manage):
 *   GET    /assistant/settings        { enabled, model, effort, has_key, key_hint, key_source, env, models, efforts }
 *   PUT    /assistant/settings        { enabled?, model?, effort?, api_key?, clear_key? } — a new key is checked against the API first
 *   POST   /assistant/settings/test   check the key and model currently in effect
 *
 * `assistant_conversations` { user_email, api_messages (append-only model context),
 *                             display (chat transcript), updated_at }
 */

const express = require('express');
const Joi = require('joi');
const Anthropic = require('@anthropic-ai/sdk');
const { getDB } = require('../../../config/database');
const { validate } = require('../../../middleware/roleCheck');
const { handle, encryptSecret } = require('../common');
const { requirePermission } = require('../permissions');
const assistant = require('../assistant');

const router = express.Router();

const chatSchema = Joi.object({ message: Joi.string().trim().min(1).max(2000).required() });

const RATE = parseInt(process.env.ASSISTANT_RATE_LIMIT || '20', 10); // messages per 10 minutes per user
const rate = new Map();
const rateLimited = (email) => {
  const now = Date.now();
  const r = rate.get(email);
  if (!r || now - r.start > 10 * 60 * 1000) {
    rate.set(email, { start: now, count: 1 });
    return false;
  }
  r.count += 1;
  return r.count > RATE;
};

const NOT_CONFIGURED = { configured: false, detail: 'The AI assistant is not set up yet. Ask your administrator to add an API key under Administration → AI Assistant.' };

// Pick up changes made on the settings page (cached for 30s inside the service)
router.use('/assistant', (req, res, next) => { assistant.refreshSettings().then(() => next(), next); });

router.get('/assistant/status', (req, res) => {
  res.json({ configured: assistant.isConfigured(), model: assistant.isConfigured() ? assistant.modelName() : null });
});

// ============= ADMIN SETTINGS =============

const settingsSchema = Joi.object({
  enabled: Joi.boolean(),
  model: Joi.string().valid(...assistant.MODELS.map((m) => m.id)),
  effort: Joi.string().valid(...assistant.EFFORTS),
  api_key: Joi.string().trim().min(20).max(300).pattern(/^\S+$/).messages({
    'string.min': 'That does not look like a complete API key',
    'string.pattern.base': 'The API key cannot contain spaces',
  }),
  clear_key: Joi.boolean(),
});

const keyHint = (key) => (key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null);

/** Check a key can reach the chosen model (models.retrieve is free). Returns null or an error message. */
async function checkKey(apiKey, model) {
  try {
    await new Anthropic({ apiKey, maxRetries: 1, timeout: 15000 }).models.retrieve(model);
    return null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return 'Anthropic rejected this API key. Check that it was copied in full and has not been revoked.';
    if (error instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use the Claude API. Check its workspace permissions.';
    if (error instanceof Anthropic.NotFoundError) return `This API key cannot access ${model}. Choose another model or check your Anthropic plan.`;
    if (error instanceof Anthropic.RateLimitError) return 'Anthropic is rate-limiting this key right now. Try again in a minute.';
    if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API from the server. Check its internet access.';
    if (error instanceof Anthropic.APIError) return `Anthropic returned an error (${error.status}). Try again later.`;
    throw error;
  }
}

const settingsView = (doc) => ({
  enabled: assistant.enabled(),
  model: assistant.modelName(),
  effort: assistant.effortLevel(),
  has_key: !!(process.env.ANTHROPIC_API_KEY || doc?.api_key_enc),
  key_hint: process.env.ANTHROPIC_API_KEY ? keyHint(process.env.ANTHROPIC_API_KEY) : (doc?.api_key_hint || null),
  key_source: process.env.ANTHROPIC_API_KEY ? 'env' : doc?.api_key_enc ? 'settings' : null,
  env: {
    api_key: !!process.env.ANTHROPIC_API_KEY,
    model: !!process.env.ANTHROPIC_MODEL,
    effort: !!process.env.ANTHROPIC_EFFORT,
  },
  configured: assistant.isConfigured(),
  models: assistant.MODELS.map(({ id, label, note }) => ({ id, label, note })),
  efforts: assistant.EFFORTS,
  updated_at: doc?.updated_at || null,
  updated_by: doc?.updated_by || null,
});

router.get('/assistant/settings', requirePermission('settings.manage'), handle('assistant settings', async (req, res) => {
  const doc = await assistant.refreshSettings({ force: true });
  res.json(settingsView(doc));
}));

router.put('/assistant/settings', requirePermission('settings.manage'), validate(settingsSchema), handle('update assistant settings', async (req, res) => {
  const db = getDB();
  const body = req.validatedBody;
  const current = await assistant.refreshSettings({ force: true, db });
  const set = { key: assistant.SETTINGS_KEY, updated_at: new Date(), updated_by: req.user.email };
  const unset = {};
  if (body.enabled !== undefined) set.enabled = body.enabled;
  if (body.model) set.model = body.model;
  if (body.effort) set.effort = body.effort;

  const model = process.env.ANTHROPIC_MODEL || body.model || current?.model || assistant.DEFAULT_MODEL;
  if (body.api_key) {
    const problem = await checkKey(body.api_key, model);
    if (problem) return res.status(400).json({ detail: problem, errors: [{ field: 'api_key', message: problem }] });
    set.api_key_enc = encryptSecret(body.api_key);
    set.api_key_hint = keyHint(body.api_key);
  } else if (body.clear_key) {
    unset.api_key_enc = '';
    unset.api_key_hint = '';
  }

  await db.collection('platform_settings').updateOne(
    { key: assistant.SETTINGS_KEY },
    Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
    { upsert: true }
  );
  const doc = await assistant.refreshSettings({ force: true, db });
  res.json(settingsView(doc));
}));

router.post('/assistant/settings/test', requirePermission('settings.manage'), handle('test assistant settings', async (req, res) => {
  await assistant.refreshSettings({ force: true });
  const key = process.env.ANTHROPIC_API_KEY || assistant.storedApiKey();
  if (!key) return res.status(400).json({ ok: false, detail: 'No API key is saved yet.' });
  const model = assistant.modelName();
  const problem = await checkKey(key, model);
  if (problem) return res.status(400).json({ ok: false, detail: problem });
  res.json({ ok: true, model, detail: `Connected — ${model} is reachable with this key.` });
}));

router.get('/assistant/history', handle('assistant history', async (req, res) => {
  const convo = await getDB().collection('assistant_conversations').findOne({ user_email: req.user.email }, { projection: { _id: 0, display: 1, updated_at: 1 } });
  res.json({ configured: assistant.isConfigured(), messages: convo?.display || [], updated_at: convo?.updated_at || null });
}));

router.delete('/assistant/history', handle('clear assistant history', async (req, res) => {
  await getDB().collection('assistant_conversations').deleteOne({ user_email: req.user.email });
  res.json({ cleared: true });
}));

router.post('/assistant/chat', validate(chatSchema), handle('assistant chat', async (req, res) => {
  const client = assistant.getClient();
  if (!client) return res.status(503).json(NOT_CONFIGURED);
  if (rateLimited(req.user.email)) return res.status(429).json({ detail: 'You are sending messages too quickly. Please wait a few minutes.' });

  const db = getDB();
  const employee = await db.collection('employees').findOne({ email: req.user.email }, { projection: { _id: 0 } });
  const convo = await db.collection('assistant_conversations').findOne({ user_email: req.user.email });
  let history = Array.isArray(convo?.api_messages) ? convo.api_messages : [];
  // Start a fresh model context (rather than editing old turns) once it grows large
  if (history.length > assistant.MAX_CONTEXT_MESSAGES) history = [];

  let result;
  try {
    result = await assistant.chat({ db, client, ctx: { user: req.user, employee }, history, message: req.validatedBody.message });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error('[assistant] API key rejected:', error.message);
      return res.status(503).json({ configured: false, detail: 'The AI assistant is misconfigured (API key rejected). Contact your administrator.' });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ detail: 'The AI assistant is busy right now. Please try again in a minute.' });
    }
    if (error instanceof Anthropic.APIError) {
      console.error('[assistant] API error:', error.status, error.message);
      return res.status(502).json({ detail: 'The AI assistant is temporarily unavailable. Please try again.' });
    }
    throw error;
  }

  const now = new Date();
  const display = [
    ...(convo?.display || []),
    { role: 'user', text: req.validatedBody.message, at: now },
    { role: 'assistant', text: result.reply, at: new Date(), tools_used: result.tools_used }
  ].slice(-assistant.MAX_DISPLAY_MESSAGES);

  await db.collection('assistant_conversations').updateOne(
    { user_email: req.user.email },
    { $set: { user_email: req.user.email, api_messages: result.messages, display, updated_at: new Date() } },
    { upsert: true }
  );
  res.json({ reply: result.reply, tools_used: result.tools_used, messages: display });
}));

module.exports = router;
