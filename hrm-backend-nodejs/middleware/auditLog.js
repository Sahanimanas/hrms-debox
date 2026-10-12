/**
 * Audit trail middleware (PL-2). Mounted globally in server.js at '/api'
 * before every API route.
 *
 * Records every mutating request (POST / PUT / PATCH / DELETE) once the
 * response has finished: actor, method, path, status, duration, IP, user
 * agent and a sanitised copy of the body (secrets redacted, long values
 * truncated, file contents dropped). Writes happen asynchronously and can
 * never fail or slow down the request.
 */

const jwt = require('jsonwebtoken');
const { config } = require('../config/config');
const { sanitize, writeAudit, isAnonymousRoute } = require('../services/platform/audit');
const { clientIp } = require('../services/platform/common');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24}|\d+|[A-Za-z]+-?\d{3,}|[A-Za-z0-9_-]{32,})$/i;

/** '/api/v2/assets/3f2a…/assign' -> '/api/v2/assets/:id/assign' */
const routeTemplate = (path) => path.split('/').map(seg => (ID_SEGMENT.test(seg) ? ':id' : seg)).join('/');

/** Email of the Bearer token's subject, if the token is valid (no DB hit). */
const actorFromToken = (req) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.typ && payload.typ !== 'access') return null;
    return payload.sub || null;
  } catch {
    return null;
  }
};

const fileSummary = (req) => {
  const files = [];
  const add = (f) => f && files.push({ field: f.fieldname, name: f.originalname, type: f.mimetype, size: f.size });
  if (req.file) add(req.file);
  if (Array.isArray(req.files)) req.files.forEach(add);
  else if (req.files && typeof req.files === 'object') Object.values(req.files).flat().forEach(add);
  return files.length ? files : undefined;
};

const auditLog = (req, res, next) => {
  if (!MUTATING.has(req.method)) return next();

  const started = process.hrtime.bigint();
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    try {
      const path = (req.originalUrl || req.url || '').split('?')[0];
      if (isAnonymousRoute(req.method, path)) {
        // Anonymous-by-design routes: no actor, IP, user agent, query, body or exact path
        const template = routeTemplate(path);
        writeAudit({
          kind: 'request',
          anonymous: true,
          actor_email: null,
          actor_role: null,
          action: `${req.method} ${template}`,
          method: req.method,
          path: template,
          status: res.statusCode
        });
        return;
      }
      const query =req.query && Object.keys(req.query).length ? sanitize(req.query) : undefined;
      const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length ? sanitize(req.body) : undefined;
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      writeAudit({
        kind: 'request',
        actor_email: req.user?.email || actorFromToken(req),
        actor_role: req.user?.role || null,
        action: `${req.method} ${routeTemplate(path)}`,
        method: req.method,
        path,
        status: res.statusCode,
        aborted: !res.writableFinished || undefined,
        duration_ms: Math.round(durationMs * 10) / 10,
        ip: clientIp(req),
        user_agent: (req.get('User-Agent') || '').slice(0, 300),
        query,
        body,
        files: fileSummary(req),
        api_key_prefix: req.apiKey?.prefix || undefined
      });
    } catch (error) {
      console.error('[audit] failed to record request:', error.message);
    }
  };

  res.on('finish', finish);
  res.on('close', finish);
  next();
};

module.exports = { auditLog, routeTemplate };
