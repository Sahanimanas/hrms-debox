/**
 * PL-9 AI HR assistant API.
 *
 *   GET    /assistant/status     { configured, model }
 *   GET    /assistant/history    { configured, messages: [{ role, text, at, tools_used }] }
 *   POST   /assistant/chat       { message } → { reply, tools_used, messages }
 *   DELETE /assistant/history
 *
 * `assistant_conversations` { user_email, api_messages (append-only model context),
 *                             display (chat transcript), updated_at }
 */

const express = require('express');
const Joi = require('joi');
const Anthropic = require('@anthropic-ai/sdk');
const { getDB } = require('../../../config/database');
const { validate } = require('../../../middleware/roleCheck');
const { handle } = require('../common');
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

const NOT_CONFIGURED = { configured: false, detail: 'The AI assistant is not configured. Ask your administrator to set ANTHROPIC_API_KEY.' };

router.get('/assistant/status', (req, res) => {
  res.json({ configured: assistant.isConfigured(), model: assistant.isConfigured() ? assistant.modelName() : null });
});

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
