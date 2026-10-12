#!/usr/bin/env node
/**
 * Run API test suites against a fresh throwaway database.
 *
 *   node tests/run.mjs                       # all suites in tests/suites
 *   node tests/run.mjs payroll lifecycle     # only these suites
 *   node tests/run.mjs payroll --port 4021 --db hrms_t_payroll --keep-db
 *   node tests/run.mjs --pg postgres://user:pass@localhost:5432/hrms_test
 *
 * For each suite: drops schema --db (default hrms_test_run) in the PostgreSQL
 * database --pg (default $DATABASE_URL), starts the backend on --port
 * (default 4090) with email/WhatsApp/S3 credentials blanked and cron disabled,
 * runs the suite and stops the server. The database is dropped at the end
 * unless --keep-db.
 * Results are written to tests/results/<suite>.json and tests/results/summary.json.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..');
const SUITES_DIR = path.join(__dirname, 'suites');
const RESULTS_DIR = path.join(__dirname, 'results');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--keep-db'].includes(args[i - 1])));

const PORT = opt('port', '4090');
const PG_URL = opt('pg', process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/hrms');
const DB = opt('db', 'hrms_test_run');
const KEEP_DB = flag('keep-db');

const allSuites = fs.readdirSync(SUITES_DIR).filter(f => f.endsWith('.test.mjs')).map(f => f.replace('.test.mjs', '')).sort();
const suites = positional.length ? positional : allSuites;
for (const s of suites) {
  if (!allSuites.includes(s)) {
    console.error(`Unknown suite "${s}". Available: ${allSuites.join(', ')}`);
    process.exit(2);
  }
}

const env = {
  ...process.env,
  DATABASE_URL: PG_URL,
  DB_NAME: DB,
  PORT,
  CRON_ENABLED: 'false',
  MAILJET_API_KEY: '',
  MAILJET_API_SECRET: '',
  EMAIL_API_KEY: '',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  S3_ENDPOINT_URL: '',
  S3_ACCESS_KEY: '',
  S3_SECRET_KEY: '',
  S3_BUCKET_NAME: '',
  BACKEND_PUBLIC_URL: `http://localhost:${PORT}`
};

const dropDb = async () => {
  const { PgDocClient } = createRequire(import.meta.url)('../db/pgdoc');
  const client = new PgDocClient(PG_URL);
  await client.connect();
  await client.db(DB).dropDatabase();
  await client.close();
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      const d = await r.json();
      if (d.database === 'connected') return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

const killTree = (child) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
};

fs.mkdirSync(RESULTS_DIR, { recursive: true });

// Each suite gets a fresh database and its own server so suites never see
// each other's data.
async function startServer(suite) {
  await dropDb();
  const logFile = path.join(RESULTS_DIR, `server-${suite}.log`);
  const logStream = fs.createWriteStream(logFile);
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  if (!(await waitForHealth())) {
    killTree(server);
    throw new Error(`Backend did not start on port ${PORT}. See ${logFile}`);
  }
  return server;
}

let current = null;
process.on('exit', () => killTree(current));

const summary = [];
for (const suite of suites) {
  console.log(`
[36m═══ ${suite} ═══[0m`);
  let result = { suite, passed: 0, failed: 1, total: 1 };
  try {
    current = await startServer(suite);
    const res = spawnSync(process.execPath, [path.join(SUITES_DIR, `${suite}.test.mjs`)], {
      cwd: BACKEND_DIR,
      env: { ...env, API_URL: `http://localhost:${PORT}/api`, TEST_SUITE: suite },
      stdio: 'inherit',
      timeout: 10 * 60 * 1000
    });
    try {
      result = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, `${suite}.json`), 'utf8'));
    } catch { /* suite crashed before writing results */ }
    if (res.status !== 0 && result.failed === 0) result.failed = 1;
  } catch (error) {
    console.error(error.message);
  } finally {
    killTree(current);
    current = null;
    await sleep(500);
  }
  summary.push({ suite, passed: result.passed, failed: result.failed, total: result.total });
}

if (!KEEP_DB) await dropDb();

const totals = summary.reduce((t, s) => ({ passed: t.passed + s.passed, failed: t.failed + s.failed }), { passed: 0, failed: 0 });
if (!positional.length) {
  fs.writeFileSync(path.join(RESULTS_DIR, 'summary.json'), JSON.stringify({ ran_at: new Date().toISOString(), totals, suites: summary }, null, 2));
}

console.log('\n\x1b[1mSummary\x1b[0m');
for (const s of summary) {
  console.log(`  ${s.failed ? '\x1b[31m✗' : '\x1b[32m✓'}\x1b[0m ${s.suite.padEnd(16)} ${s.passed}/${s.total}`);
}
console.log(`  ${totals.passed} passed, ${totals.failed} failed`);
process.exit(totals.failed ? 1 : 0);
