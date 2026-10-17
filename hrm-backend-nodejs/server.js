/**
 * HRMS Backend Server
 * Express.js + PostgreSQL (document store in db/pgdoc)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { connectDB, getDB, closeDB } = require('./config/database');
const { isSetupCompleted, markSetupCompleted, SETUP_CONFIG_FILE } = require('./config/config');

// Import routes
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const leaveRoutes = require('./routes/leaves');
const organizationRoutes = require('./routes/organizations');
const dashboardRoutes = require('./routes/dashboard');
const payrollRoutes = require('./routes/payroll');
const setupRoutes = require('./routes/setup');
const notificationRoutes = require('./routes/notifications');
const holidayRoutes = require('./routes/holidays');
const uploadsRouter = require('./routes/uploads');
const passwordResetRouter = require('./routes/passwordReset');
const attendanceRouter = require('./routes/attendance');
const reimbursementRoutes = require('./routes/Reimbursements');
const compOffRoutes = require('./routes/compoffRoutes');
const leaveCreditRoutes = require('./routes/leaveCredit');
const userNotificationRoutes = require('./routes/userNotifications');
const whatsappRoutes = require('./routes/whatsapp');
const timeTrackingRoutes = require('./routes/timeTracking');
const timeDeviceRoutes = require('./routes/timeDevices');
const timesheetRoutes = require('./routes/timesheets');
const { mountModules } = require('./routes/modules');
const { auditLog } = require('./middleware/auditLog');
const { startCron } = require('./cron');
const { runStartupMigrations } = require('./services/employeeIdentity');
const baileysService = require('./services/baileysService');







const app = express();

// Behind Nginx / a load balancer: trust X-Forwarded-* from loopback and
// private addresses so req.ip is the real client (audit log, password reset).
// TRUST_PROXY overrides: a hop count, 'true', 'false' or a list of subnets.
const trustProxy = (process.env.TRUST_PROXY || '').trim();
app.set('trust proxy', !trustProxy ? 'loopback, linklocal, uniquelocal'
  : /^\d+$/.test(trustProxy) ? Number(trustProxy)
    : trustProxy === 'true' ? true : trustProxy === 'false' ? false : trustProxy);

// Middleware
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Device-Key"]
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Log setup status on startup
function logSetupStatus() {
  const status = isSetupCompleted();
  const color = status ? '\x1b[36m' : '\x1b[31m'; // cyan or red
  console.log(`${color}[HRMS SETUP] setup_completed = ${status}\x1b[0m`);
}

// Locally stored uploads (used when S3 is not configured)
// Private files (resumes, tax proofs, employee documents) live under
// uploads/private and are only available through authenticated endpoints.
app.use('/uploads/private', (req, res) => res.status(404).json({ detail: 'Not found' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { fallthrough: false, dotfiles: 'deny' }));

// Audit trail for mutating API requests
app.use('/api', auditLog);

// ============= API ROUTES =============

// Setup routes (available even without setup)
app.use('/api/setup', setupRoutes);

// Health check
app.get('/health', async (req, res) => {
  try {
    const db = getDB();
    if (db) {
      await db.command({ ping: 1 });
      return res.json({
        status: 'healthy',
        service: 'HRMS Backend',
        database: 'connected',
        setup_completed: isSetupCompleted(),
        timestamp: new Date().toISOString()
      });
    } else {
      return res.json({
        status: 'setup_required',
        service: 'HRMS Backend',
        database: 'not_configured',
        setup_completed: isSetupCompleted(),
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    return res.json({
      status: 'unhealthy',
      service: 'HRMS Backend',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'HRMS API',
    version: '1.0.0',
    status: 'running',
    docs: '/api-docs',
    health: '/health'
  });
});

// Protected routes (require database connection)
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', payrollRoutes); // Payroll handles /comp-off, /salary-template, /salary-structure, /payroll
app.use('/api', leaveRoutes); // Leave also handles /leave-policy
app.use('/api', employeeRoutes); // Employee also handles /employee-id-settings
app.use('/api', notificationRoutes); // Notification handles /notification-settings
app.use('/api/holidays', holidayRoutes);
app.use('/api/uploads', uploadsRouter);
app.use('/api/password-reset', passwordResetRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/reimbursements', reimbursementRoutes);
app.use('/api/comp-off', compOffRoutes);
app.use('/api/admin/leave-credit', leaveCreditRoutes);
app.use('/api/notifications', userNotificationRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/time/devices', timeDeviceRoutes); // before /api/time: device punches use a device key, not a user token
app.use('/api/time', timeTrackingRoutes);
app.use('/api/timesheets', timesheetRoutes);

// Feature modules at /api/v2/<module>
mountModules(app);







// 404 handler
app.use((req, res) => {
  res.status(404).json({ detail: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ detail: 'Internal server error' });
});

// ============= SERVER STARTUP =============

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  logSetupStatus();

  // Connect to PostgreSQL if DATABASE_URL is set (DB_NAME is the schema)
  const databaseUrl = process.env.DATABASE_URL;
  const dbName = process.env.DB_NAME || 'hrms_production';

  console.log(`[DATABASE] DATABASE_URL: ${databaseUrl ? 'Set' : 'Not set'}`);
  console.log(`[DATABASE] DB_NAME (schema): ${dbName}`);

  if (databaseUrl) {
    try {
      const db = await connectDB(databaseUrl, dbName);
      console.log('\x1b[32m[DATABASE] Connected to PostgreSQL\x1b[0m');
      // Employee codes / ids backfill + unique indexes (idempotent, never throws)
      await runStartupMigrations(db);
      startCron(db);
    } catch (error) {
      console.error('\x1b[31m[DATABASE] Failed to connect to PostgreSQL:\x1b[0m', error.message);
    }
  } else {
    console.log('\x1b[33m[DATABASE] Skipping connection - DATABASE_URL not set in .env\x1b[0m');
  }

  app.listen(PORT, HOST, () => {
    console.log(`\x1b[32m[SERVER] HRMS Backend running on http://${HOST}:${PORT}\x1b[0m`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SERVER] Shutting down...');
  await baileysService.disconnect(false);
  await closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SERVER] Shutting down...');
  await baileysService.disconnect(false);
  await closeDB();
  process.exit(0);
});

startServer().catch(console.error);

module.exports = app;
