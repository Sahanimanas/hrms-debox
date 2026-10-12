/**
 * PL-2 Audit trail API.
 *   GET /audit-logs          filters: actor, action (matches action or path), method, status (e.g. 403 or 4xx),
 *                            kind (request|auth), outcome, from, to (YYYY-MM-DD), page, limit
 *   GET /audit-logs/export   same filters, CSV (max 10 000 rows)
 *   GET /audit-logs/summary  counts for the dashboard widget
 */

const express = require('express');
const Joi = require('joi');
const { getDB } = require('../../../config/database');
const { requirePermission } = require('../permissions');
const { handle, validateQuery, escapeRegex, toCsv } = require('../common');
const { zonedTimeToDate } = require('../../../utils/helpers');

const router = express.Router();

const filterSchema = Joi.object({
  actor: Joi.string().trim().max(200).allow(''),
  action: Joi.string().trim().max(200).allow(''),
  method: Joi.string().valid('POST', 'PUT', 'PATCH', 'DELETE', 'GET').allow(''),
  status: Joi.string().trim().pattern(/^([1-5]\d\d|[1-5]xx)$/).allow(''),
  kind: Joi.string().valid('request', 'auth').allow(''),
  outcome: Joi.string().valid('success', 'failure').allow(''),
  from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(''),
  to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(''),
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25)
});

function buildFilter(q) {
  const filter = {};
  if (q.actor) filter.actor_email = { $regex: escapeRegex(q.actor), $options: 'i' };
  if (q.action) {
    const rx = { $regex: escapeRegex(q.action), $options: 'i' };
    filter.$or = [{ action: rx }, { path: rx }];
  }
  if (q.method) filter.method = q.method;
  if (q.kind) filter.kind = q.kind;
  if (q.outcome) filter.outcome = q.outcome === 'success' ? { $in: ['success', null] } : 'failure';
  if (q.status) {
    if (/xx$/.test(q.status)) {
      const base = Number(q.status[0]) * 100;
      filter.status = { $gte: base, $lt: base + 100 };
    } else {
      filter.status = Number(q.status);
    }
  }
  if (q.from || q.to) {
    filter.at = {};
    if (q.from) filter.at.$gte = zonedTimeToDate(q.from, '00:00');
    if (q.to) filter.at.$lt = new Date(zonedTimeToDate(q.to, '00:00').getTime() + 86400000);
  }
  return filter;
}

router.get('/audit-logs', requirePermission('audit.view'), validateQuery(filterSchema), handle('list audit logs', async (req, res) => {
  const db = getDB();
  const q = req.validatedQuery;
  if (q.from && q.to && q.from > q.to) return res.status(400).json({ detail: "'from' must be on or before 'to'" });
  const filter = buildFilter(q);
  const [items, total] = await Promise.all([
    db.collection('audit_logs').find(filter, { projection: { _id: 0 } }).sort({ at: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).toArray(),
    db.collection('audit_logs').countDocuments(filter)
  ]);
  res.json({ items, total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) });
}));

router.get('/audit-logs/export', requirePermission('audit.view'), validateQuery(filterSchema), handle('export audit logs', async (req, res) => {
  const db = getDB();
  const rows = await db.collection('audit_logs').find(buildFilter(req.validatedQuery), { projection: { _id: 0 } }).sort({ at: -1 }).limit(10000).toArray();
  const csv = toCsv(rows, [
    { label: 'Time (UTC)', value: r => (r.at ? new Date(r.at).toISOString() : '') },
    { label: 'Kind', key: 'kind' },
    { label: 'Actor', key: 'actor_email' },
    { label: 'Role', key: 'actor_role' },
    { label: 'Action', key: 'action' },
    { label: 'Method', key: 'method' },
    { label: 'Path', key: 'path' },
    { label: 'Status', key: 'status' },
    { label: 'Outcome', key: 'outcome' },
    { label: 'Reason', key: 'reason' },
    { label: 'Duration (ms)', key: 'duration_ms' },
    { label: 'IP', key: 'ip' },
    { label: 'User agent', key: 'user_agent' },
    { label: 'Body', value: r => (r.body ? JSON.stringify(r.body) : r.details ? JSON.stringify(r.details) : '') }
  ]);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${csv}`);
}));

router.get('/audit-logs/summary', requirePermission('audit.view'), handle('audit summary', async (req, res) => {
  const db = getDB();
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [changes, failedLogins, denied] = await Promise.all([
    db.collection('audit_logs').countDocuments({ kind: 'request', at: { $gte: since } }),
    db.collection('audit_logs').countDocuments({ kind: 'auth', outcome: 'failure', at: { $gte: since } }),
    db.collection('audit_logs').countDocuments({ kind: 'request', status: 403, at: { $gte: since } })
  ]);
  res.json({ window_hours: 24, changes, failed_logins: failedLogins, permission_denied: denied });
}));

module.exports = router;
