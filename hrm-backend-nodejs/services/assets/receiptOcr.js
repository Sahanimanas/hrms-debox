/**
 * Receipt OCR (AS-2): extract amount, date, vendor and a suggested expense
 * category from a receipt image or PDF using Claude.
 *
 * Only active when ANTHROPIC_API_KEY is set; otherwise callers get
 * { configured: false } and the UI falls back to manual entry.
 *
 * The Anthropic client is injectable (extractReceipt(input, { client })) so the
 * request/response handling can be tested without calling the API.
 */

const MODEL = 'claude-opus-5-5';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const PDF_TYPE = 'application/pdf';

class ReceiptOcrError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

const isOcrConfigured = () => !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());

const isSupportedType = (mimeType) => IMAGE_TYPES.includes(normaliseMime(mimeType)) || normaliseMime(mimeType) === PDF_TYPE;

function normaliseMime(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  return m === 'image/jpg' ? 'image/jpeg' : m;
}

function createClient() {
  const sdk = require('@anthropic-ai/sdk');
  const Anthropic = sdk.default || sdk.Anthropic || sdk;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

function outputSchema(categories) {
  return {
    type: 'object',
    properties: {
      amount: nullable({ type: 'number' }),
      currency: nullable({ type: 'string' }),
      date: nullable({ type: 'string' }),
      vendor: nullable({ type: 'string' }),
      suggested_category: nullable({ type: 'string', enum: categories }),
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      is_receipt: { type: 'boolean' }
    },
    required: ['amount', 'currency', 'date', 'vendor', 'suggested_category', 'confidence', 'is_receipt'],
    additionalProperties: false
  };
}

/** Build the Messages API request for one receipt. */
function buildRequest({ buffer, mimeType, categories }) {
  const mime = normaliseMime(mimeType);
  const data = Buffer.from(buffer).toString('base64');
  const fileBlock = mime === PDF_TYPE
    ? { type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data } };

  const prompt = [
    'This file was uploaded by an employee as a receipt for an expense reimbursement claim.',
    'Read it and extract:',
    '- amount: the final total paid (after taxes and discounts), as a plain number. If several totals appear, use the grand total.',
    '- currency: ISO 4217 code if identifiable (most receipts here are INR).',
    '- date: the transaction date as YYYY-MM-DD. Indian receipts usually write dates day-first (DD/MM/YYYY).',
    '- vendor: the merchant or business name as printed.',
    `- suggested_category: the best match from this list: ${categories.join(', ')}.`,
    '- confidence: how legible and unambiguous the receipt was.',
    '- is_receipt: false if the file is not a receipt, bill or invoice.',
    'Use null for any field that is not present or not readable rather than guessing.'
  ].join('\n');

  return {
    model: MODEL,
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: outputSchema(categories) }
    },
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }]
  };
}

const extractJson = (text) => {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
    }
    return null;
  }
};

const normaliseDate = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // day-first
  if (m) return validDate(+m[3], +m[2], +m[1]);
  return null;
};

function validDate(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(dt) || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const normaliseAmount = (value) => {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * Turn a Messages API response into clean receipt fields.
 * Throws ReceiptOcrError when the model refused or returned nothing usable.
 */
function parseReceiptResponse(message, categories = []) {
  if (!message || !Array.isArray(message.content)) throw new ReceiptOcrError('Empty response from the receipt reader', 502);
  if (message.stop_reason === 'refusal') throw new ReceiptOcrError('The receipt could not be read. Please enter the details manually.');

  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const data = extractJson(text);
  if (!data || typeof data !== 'object') throw new ReceiptOcrError('The receipt could not be read. Please enter the details manually.');

  const category = data.suggested_category
    ? categories.find(c => c.toLowerCase() === String(data.suggested_category).trim().toLowerCase()) || null
    : null;

  return {
    is_receipt: data.is_receipt !== false,
    amount: normaliseAmount(data.amount),
    currency: data.currency ? String(data.currency).trim().toUpperCase().slice(0, 3) : null,
    date: normaliseDate(data.date),
    vendor: data.vendor ? String(data.vendor).trim().slice(0, 200) : null,
    suggested_category: category,
    confidence: ['high', 'medium', 'low'].includes(data.confidence) ? data.confidence : 'low',
    model: message.model || MODEL
  };
}

/**
 * Extract receipt fields. Pass { client } to inject an Anthropic client (tests).
 * @returns {Promise<{ configured: boolean, ... }>}
 */
async function extractReceipt({ buffer, mimeType, categories }, { client } = {}) {
  if (!client && !isOcrConfigured()) {
    return { configured: false, detail: 'Receipt scanning is not configured. Enter the details manually.' };
  }
  if (!isSupportedType(mimeType)) throw new ReceiptOcrError('Only JPG, PNG, GIF, WEBP images and PDFs can be scanned', 400);

  const api = client || createClient();
  const message = await api.beta.messages.create(buildRequest({ buffer, mimeType, categories }));
  return { configured: true, ...parseReceiptResponse(message, categories) };
}

module.exports = {
  MODEL,
  ReceiptOcrError,
  isOcrConfigured,
  isSupportedType,
  buildRequest,
  parseReceiptResponse,
  extractReceipt
};
