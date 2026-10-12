/**
 * platform module — mounted at /api/v2/platform (Phase 10: platform & security)
 *
 *   PL-2 audit trail        services/platform/routers/audit.js        (+ middleware/auditLog.js)
 *   PL-3 two-factor auth    services/platform/routers/security.js     (+ routes/auth.js login flow)
 *   PL-4 single sign-on     routes/auth.js /api/auth/sso/*            (services/platform/sso.js)
 *   PL-5 roles/permissions  services/platform/routers/roles.js        (+ requirePermission in middleware/roleCheck.js)
 *   PL-6 integrations       services/platform/routers/integrations.js
 *   PL-7 public API/hooks   services/platform/routers/publicApi.js
 *   PL-8 languages/currency services/platform/routers/preferences.js
 *   PL-9 AI assistant       services/platform/routers/assistant.js
 *
 * Public (no login): GET /calendar/:token.ics, GET /public/* (X-API-Key).
 */
const express = require('express');
const { authenticate } = require('../../middleware/auth');

const integrations = require('../../services/platform/routers/integrations');
const publicApi = require('../../services/platform/routers/publicApi');

const router = express.Router();

router.get('/health', (req, res) => res.json({ module: 'platform', status: 'ok' }));

// ---- Public endpoints (own auth) ----
router.use(integrations.publicRouter);
router.use(publicApi.publicRouter);

// ---- Everything else requires a signed-in user ----
router.use(authenticate);
router.use(require('../../services/platform/routers/audit'));
router.use(require('../../services/platform/routers/security'));
router.use(require('../../services/platform/routers/roles'));
router.use(integrations.router);
router.use(publicApi.router);
router.use(require('../../services/platform/routers/preferences'));
router.use(require('../../services/platform/routers/assistant'));

module.exports = router;
