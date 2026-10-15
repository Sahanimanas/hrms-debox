/**
 * AI HR assistant (PL-9) built on the Anthropic Messages API with tool use.
 *
 * Data scoping is enforced in code, not by the model: every tool receives the
 * signed-in user's context ({ user, employee }) and only ever queries that
 * user's own records. Tools take no employee identifiers as input, so the
 * model cannot ask for someone else's data. Admin-only aggregate tools are
 * only offered to (and only executable by) admins and return counts only.
 *
 * Config: an admin sets the API key (stored encrypted), model, effort and an
 * on/off switch on the AI Assistant settings page (platform_settings doc
 * { key: 'ai_assistant' }). Environment variables, when set, take precedence:
 *   ANTHROPIC_API_KEY     without a key (env or settings) the assistant reports { configured: false }
 *   ANTHROPIC_MODEL       default 'claude-opus-5-5'
 *   ANTHROPIC_EFFORT      default 'medium' (low | medium | high | xhigh | max)
 *   ANTHROPIC_FALLBACKS   'default' (server-side refusal fallback, the default) or 'off'
 *   ANTHROPIC_BASE_URL    honoured by the SDK (tests point it at a local stub)
 *
 * The model client is injectable: setClientFactory(() => stubClient).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getDB } = require('../../config/database');
const { employeeUid, localParts } = require('../../utils/helpers');
const { decryptSecret } = require('./common');

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_EFFORT = 'medium';

/** Models offered on the settings page. `fallbacks`: supports server-side refusal fallback ("default" form). */
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable for everyday HR questions (recommended)', fallbacks: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster and lower cost', fallbacks: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest', fallbacks: false },
];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MAX_TOOL_ROUNDS = 6;
const MAX_CONTEXT_MESSAGES = 80;   // API context is reset (not edited) beyond this
const MAX_DISPLAY_MESSAGES = 100;

// ============= CLIENT =============

let clientFactory = null;

/** Inject a client (tests): fn() => object exposing beta.messages.create(params). Pass null to reset. */
function setClientFactory(fn) {
  clientFactory = fn;
}

// ============= SETTINGS =============

const SETTINGS_KEY = 'ai_assistant';
const SETTINGS_TTL_MS = 30 * 1000;
let stored = null;     // cached platform_settings doc
let storedAt = 0;

/** Reload the admin's settings (cached for 30s; force after a save). Call before using the sync getters below. */
async function refreshSettings({ force = false, db } = {}) {
  if (!force && Date.now() - storedAt < SETTINGS_TTL_MS) return stored;
  try {
    stored = await (db || getDB()).collection('platform_settings').findOne({ key: SETTINGS_KEY }, { projection: { _id: 0 } });
  } catch (error) {
    console.error('[assistant] could not load settings:', error.message);
  }
  storedAt = Date.now();
  return stored;
}

const enabled = () => stored?.enabled !== false;
const storedApiKey = () => (stored?.api_key_enc ? decryptSecret(stored.api_key_enc) : null);
const apiKey = () => process.env.ANTHROPIC_API_KEY || storedApiKey();
const modelName = () => process.env.ANTHROPIC_MODEL || stored?.model || DEFAULT_MODEL;
const effortLevel = () => process.env.ANTHROPIC_EFFORT || stored?.effort || DEFAULT_EFFORT;
const supportsFallbacks = (model) => MODELS.find((m) => m.id === model)?.fallbacks ?? true;

function getClient() {
  if (clientFactory) return clientFactory();
  if (!enabled()) return null;
  const key = apiKey();
  return key ? new Anthropic({ apiKey: key }) : null;
}

const isConfigured = () => !!clientFactory || (enabled() && !!apiKey());

// ============= HELPERS =============

const todayStr = () => localParts(new Date()).date;

const collectionExists = async (db, name) => (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;

const ymd = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

const ownLeaveFilter = (ctx) => {
  const or = [{ employee_email: ctx.user.email }];
  if (ctx.employee?.id) or.push({ employee_id: ctx.employee.id });
  return { $or: or };
};

// ============= TOOLS =============

const TOOLS = [
  {
    name: 'get_my_leave_balance',
    description: "Get the signed-in employee's current leave balances by leave type, plus how many days are pending approval.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db, ctx) => {
      const balance = ctx.employee?.leave_balance || {};
      const pending = await db.collection('leaves').find(
        { $and: [ownLeaveFilter(ctx), { status: { $in: ['pending', 'manager_approved'] } }] },
        { projection: { _id: 0, leave_type: 1, days_count: 1 } }
      ).toArray();
      return {
        balances: balance,
        pending_requests: pending.length,
        pending_days: pending.reduce((s, l) => s + (Number(l.days_count) || 0), 0),
        has_employee_profile: !!ctx.employee
      };
    }
  },
  {
    name: 'get_my_leave_history',
    description: "List the signed-in employee's leave requests (most recent first), optionally for one calendar year.",
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Calendar year, e.g. 2026. Omit for the most recent requests.' },
        status: { type: 'string', enum: ['pending', 'manager_approved', 'approved', 'rejected'], description: 'Optional status filter.' }
      },
      additionalProperties: false
    },
    run: async (db, ctx, input = {}) => {
      // Ownership is a separate $and clause so no other condition can ever widen it
      const clauses = [ownLeaveFilter(ctx)];
      if (input.status && ['pending', 'manager_approved', 'approved', 'rejected'].includes(input.status)) clauses.push({ status: input.status });
      const filter = { $and: clauses };
      let leaves = await db.collection('leaves')
        .find(filter, { projection: { _id: 0, leave_type: 1, dates: 1, start_date: 1, end_date: 1, days_count: 1, is_half_day: 1, status: 1, created_at: 1 } })
        .sort({ created_at: -1 })
        .limit(100)
        .toArray();
      const year = Number.isInteger(input.year) ? String(input.year) : null;
      leaves = leaves.map(l => {
        const dates = Array.isArray(l.dates) && l.dates.length ? l.dates.map(ymd).sort() : [ymd(l.start_date), ymd(l.end_date)].filter(Boolean);
        return { leave_type: l.leave_type, from: dates[0] || null, to: dates[dates.length - 1] || null, days: l.days_count, half_day: !!l.is_half_day, status: l.status };
      });
      if (year) leaves = leaves.filter(l => (l.from || '').startsWith(year) || (l.to || '').startsWith(year));
      return { count: leaves.length, leaves: leaves.slice(0, 40) };
    }
  },
  {
    name: 'get_leave_policy',
    description: 'Get the company leave policy: leave types, annual quotas, carry-forward and encashment rules.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db) => {
      const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
      if (!policy?.policies?.length) return { configured: false, note: 'No leave policy has been configured yet.' };
      return {
        configured: true,
        policies: policy.policies.map(p => {
          const out = {};
          for (const [k, v] of Object.entries(p)) if (v !== null && typeof v !== 'object') out[k] = v;
          return out;
        })
      };
    }
  },
  {
    name: 'get_upcoming_holidays',
    description: 'List upcoming company holidays from today onwards.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 30, description: 'How many holidays to return (default 10).' } },
      additionalProperties: false
    },
    run: async (db, ctx, input = {}) => {
      const limit = Math.min(30, Math.max(1, Number(input.limit) || 10));
      const today = todayStr();
      const all = await db.collection('holidays').find({}, { projection: { _id: 0, name: 1, date: 1, type: 1 } }).toArray();
      const upcoming = all.map(h => ({ ...h, date: ymd(h.date) })).filter(h => h.date && h.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      return { today, holidays: upcoming.slice(0, limit) };
    }
  },
  {
    name: 'get_my_attendance_summary',
    description: "Summarise the signed-in employee's attendance for a month: days present, half days, absences, leave days, late arrivals and hours worked.",
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: "Month as 'YYYY-MM'. Defaults to the current month." } },
      additionalProperties: false
    },
    run: async (db, ctx, input = {}) => {
      if (!ctx.employee) return { has_employee_profile: false, note: 'This account has no employee profile, so there is no attendance.' };
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(input.month || '') ? input.month : todayStr().slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      const uid = employeeUid(ctx.employee);
      const logs = await db.collection('attendance_logs')
        .find({ employee_uid: uid, date: { $regex: `^${month}` } }, { projection: { _id: 0, date: 1, status: 1, late_minutes: 1, worked_minutes: 1, overtime_minutes: 1, work_mode: 1 } })
        .toArray();
      const grid = await db.collection('attendance').findOne(
        { employee_id: { $in: [uid, ctx.employee.employee_id].filter(Boolean) }, month: m, year: y },
        { projection: { _id: 0, attendance: 1 } }
      );
      const counts = { present: 0, 'half-day': 0, absent: 0, leave: 0, holiday: 0 };
      for (const status of Object.values(grid?.attendance || {})) if (status in counts) counts[status] += 1;
      return {
        month,
        grid: counts,
        punches: {
          days_logged: logs.length,
          late_arrivals: logs.filter(l => (l.late_minutes || 0) > 0).length,
          total_worked_hours: Math.round(logs.reduce((s, l) => s + (l.worked_minutes || 0), 0) / 6) / 10,
          total_overtime_hours: Math.round(logs.reduce((s, l) => s + (l.overtime_minutes || 0), 0) / 6) / 10,
          work_from_home_days: logs.filter(l => l.work_mode === 'wfh').length
        }
      };
    }
  },
  {
    name: 'get_my_latest_payslip',
    description: "Get a summary of the signed-in employee's most recent finalised payslip (gross, deductions, net pay and components).",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db, ctx) => {
      if (!ctx.employee) return { available: false, note: 'This account has no employee profile.' };
      if (!(await collectionExists(db, 'payslips'))) return { available: false, note: 'Payslips are not available yet.' };
      const slip = await db.collection('payslips').findOne(
        { employee_uid: employeeUid(ctx.employee), status: { $nin: ['draft', 'cancelled', 'void'] } },
        { projection: { _id: 0, month: 1, gross_earnings: 1, total_deductions: 1, net_pay: 1, lop_days: 1, earnings: 1, deductions: 1, status: 1 }, sort: { month: -1 } }
      );
      if (!slip) return { available: false, note: 'No finalised payslip found yet.' };
      return { available: true, currency: 'INR', ...slip };
    }
  },
  {
    name: 'search_company_policies',
    description: 'Search published company policy documents (e.g. travel, WFH, code of conduct) and return the most relevant excerpts.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keywords to search for, e.g. "work from home" or "travel reimbursement".' } },
      required: ['query'],
      additionalProperties: false
    },
    run: async (db, ctx, input = {}) => {
      if (!(await collectionExists(db, 'policy_documents'))) return { results: [], note: 'No policy documents have been published.' };
      const words = String(input.query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
      const docs = await db.collection('policy_documents')
        .find({ $or: [{ published_at: { $ne: null, $lte: new Date() } }, { published_at: { $exists: false } }] }, { projection: { _id: 0, title: 1, body: 1, version: 1, published_at: 1 } })
        .limit(200)
        .toArray();
      const scored = docs.map(d => {
        const title = String(d.title || '').toLowerCase();
        const body = String(d.body || '').toLowerCase();
        const score = words.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (body.split(w).length - 1), 0);
        return { d, score };
      }).filter(x => x.score > 0 || !words.length).sort((a, b) => b.score - a.score).slice(0, 3);
      return {
        results: scored.map(({ d }) => ({ title: d.title, version: d.version, excerpt: String(d.body || '').slice(0, 4000) }))
      };
    }
  },
  {
    name: 'get_announcements',
    description: 'List current company announcements visible to the signed-in employee.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db, ctx) => {
      if (!(await collectionExists(db, 'announcements'))) return { announcements: [] };
      const now = new Date();
      const list = await db.collection('announcements')
        .find({ published_at: { $lte: now }, $or: [{ expires_at: null }, { expires_at: { $exists: false } }, { expires_at: { $gt: now } }] }, { projection: { _id: 0, title: 1, body: 1, pinned: 1, published_at: 1, audience: 1 } })
        .sort({ pinned: -1, published_at: -1 })
        .limit(30)
        .toArray();
      const dept = ctx.employee?.department;
      const visible = list.filter(a => ctx.user.role === 'admin' || !a.audience || a.audience.type !== 'departments' || (dept && (a.audience.departments || []).includes(dept)));
      return { announcements: visible.slice(0, 10).map(a => ({ title: a.title, body: String(a.body || '').slice(0, 1500), pinned: !!a.pinned, published_at: ymd(a.published_at) })) };
    }
  },
  {
    name: 'get_headcount_by_department',
    adminOnly: true,
    description: 'ADMIN ONLY. Count active employees per department (aggregate numbers, no personal data).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db) => {
      const rows = await db.collection('employees').aggregate([
        { $match: { employment_status: { $ne: 'exited' } } },
        { $group: { _id: { $ifNull: ['$department', 'Unassigned'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      return { total: rows.reduce((s, r) => s + r.count, 0), departments: rows.map(r => ({ department: r._id, count: r.count })) };
    }
  },
  {
    name: 'get_pending_approvals_count',
    adminOnly: true,
    description: 'ADMIN ONLY. Count items waiting for approval across the company (leaves, attendance requests, reimbursements, comp-offs).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db) => {
      const count = async (name, filter) => ((await collectionExists(db, name)) ? db.collection(name).countDocuments(filter) : 0);
      const [leaves, attendance, reimbursements, compOffs] = await Promise.all([
        count('leaves', { status: { $in: ['pending', 'manager_approved'] } }),
        count('attendance_requests', { status: 'pending' }),
        count('reimbursements', { status: 'pending' }),
        count('comp_off_requests', { status: 'pending' })
      ]);
      return { leaves, attendance_requests: attendance, reimbursements, comp_offs: compOffs, total: leaves + attendance + reimbursements + compOffs };
    }
  }
];

const toolsFor = (user) => TOOLS.filter(t => !t.adminOnly || user.role === 'admin');

/** Execute a tool for a user. Unknown tools and admin tools for non-admins are refused. */
async function runTool(db, ctx, name, input) {
  const tool = toolsFor(ctx.user).find(t => t.name === name);
  if (!tool) return { error: `Tool "${name}" is not available to this user.` };
  return tool.run(db, ctx, input && typeof input === 'object' ? input : {});
}

// ============= PROMPT =============

const SYSTEM_PROMPT = `You are the Xeno-HR assistant, an HR helpdesk inside the company's HR system.

You answer employees' questions about their own leave, attendance, payslips, holidays, company policies and announcements, using the tools provided. Rules:
- Use tools to look up facts; never invent balances, dates, amounts or policy wording. If a tool returns nothing useful, say so and suggest who to contact (HR or their manager).
- You can only see the signed-in person's own records. If asked about another employee's personal data (leave, salary, attendance, contact details), explain that you can't share other people's information.
- Admin users may also have aggregate tools (headcount, pending approvals); these return counts only.
- You cannot take actions (apply for leave, approve requests, change data). Point the user to the relevant page in Xeno-HR instead (e.g. "My Leaves", "My Attendance").
- Amounts are in Indian Rupees (₹) unless stated otherwise. Keep answers short and friendly; use bullet points for lists.`;

const contextBlock = (ctx) => {
  const e = ctx.employee;
  return [
    `Today is ${todayStr()}.`,
    `Signed-in user: ${e?.full_name || ctx.user.full_name || ctx.user.email} (role: ${ctx.user.role}${e?.department ? `, department: ${e.department}` : ''}${e?.designation ? `, ${e.designation}` : ''}).`
  ].join(' ');
};

// ============= CONVERSATION LOOP =============

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter(b => b && b.type === 'text' && typeof b.text === 'string')
  .map(b => b.text)
  .join('\n')
  .trim();

/** Strip SDK-only/undefined fields so stored content blocks are plain JSON. */
const plainBlocks = (content) => JSON.parse(JSON.stringify(Array.isArray(content) ? content : []));

/**
 * Run one user turn. `history` is the stored API message list (append-only).
 * Returns { reply, messages (new full list), tools_used, stop_reason }.
 */
async function chat({ db = getDB(), client, ctx, history = [], message }) {
  const tools = toolsFor(ctx.user).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const messages = [...history, { role: 'user', content: message }];
  const toolsUsed = [];
  let reply = '';
  let stopReason = null;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const params = {
      model: modelName(),
      max_tokens: 16000,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: contextBlock(ctx) }
      ],
      tools,
      messages,
      output_config: { effort: effortLevel() }
    };
    if ((process.env.ANTHROPIC_FALLBACKS || 'default') !== 'off' && supportsFallbacks(params.model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    const response = await client.beta.messages.create(params);
    stopReason = response.stop_reason;

    if (stopReason === 'refusal') {
      // Don't keep a refused turn in the context; drop the user message too.
      return { reply: "Sorry, I can't help with that request.", messages: history, tools_used: toolsUsed, stop_reason: stopReason };
    }

    messages.push({ role: 'assistant', content: plainBlocks(response.content) });

    if (stopReason === 'pause_turn') continue;
    if (stopReason !== 'tool_use') {
      reply = textOf(response.content);
      if (stopReason === 'max_tokens') reply = `${reply}\n\n(Answer truncated.)`.trim();
      break;
    }

    if (round === MAX_TOOL_ROUNDS) {
      reply = textOf(response.content) || 'Sorry, that took too many steps. Please try a more specific question.';
      // Close the dangling tool calls so the stored history stays valid
      const pending = response.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'user', content: pending.map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Stopped: step limit reached.', is_error: true })) });
      messages.push({ role: 'assistant', content: [{ type: 'text', text: reply }] });
      break;
    }

    const calls = response.content.filter(b => b.type === 'tool_use');
    const results = await Promise.all(calls.map(async (call) => {
      toolsUsed.push(call.name);
      try {
        const out = await runTool(db, ctx, call.name, call.input);
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out), ...(out?.error ? { is_error: true } : {}) };
      } catch (error) {
        console.error(`[assistant] tool ${call.name} failed:`, error);
        return { type: 'tool_result', tool_use_id: call.id, content: 'The lookup failed. Please try again later.', is_error: true };
      }
    }));
    // All results for one assistant turn go back in a single user message
    messages.push({ role: 'user', content: results });
  }

  return { reply: reply || "I'm not sure how to answer that.", messages, tools_used: [...new Set(toolsUsed)], stop_reason: stopReason };
}

module.exports = {
  TOOLS,
  DEFAULT_MODEL,
  MAX_CONTEXT_MESSAGES,
  MAX_DISPLAY_MESSAGES,
  setClientFactory,
  getClient,
  isConfigured,
  modelName,
  effortLevel,
  refreshSettings,
  storedApiKey,
  enabled,
  MODELS,
  EFFORTS,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  SETTINGS_KEY,
  toolsFor,
  runTool,
  chat
};
