#!/usr/bin/env node
/**
 * Write the latest API test results into TASKS.md.
 *
 *   node tests/run.mjs                 # run the suites (writes tests/results/*.json)
 *   node tests/update-task-sheet.mjs   # update the Tests column + summary in TASKS.md
 *
 * A suite section named after task IDs ("PY-3 Payroll run", "TA-2/3/4 Clock in")
 * counts towards those tasks. Sections without an ID only count towards the suite total.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const TASKS_FILE = path.resolve(__dirname, '..', '..', 'TASKS.md');

const SUMMARY_START = '<!-- test-summary:start -->';
const SUMMARY_END = '<!-- test-summary:end -->';

const files = fs.existsSync(RESULTS_DIR)
  ? fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && f !== 'summary.json')
  : [];
const suites = files.map(f => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')))
  .sort((a, b) => a.suite.localeCompare(b.suite));

// task ID -> { passed, total, suites:Set }
const byTask = new Map();
for (const suite of suites) {
  for (const r of suite.results || []) {
    const m = /^([A-Z]{2})-(\d+(?:\/\d+)*)\b/.exec(r.section || '');
    if (!m) continue;
    for (const n of m[2].split('/')) {
      const id = `${m[1]}-${n}`;
      const t = byTask.get(id) || { passed: 0, total: 0, suites: new Set() };
      t.total += 1;
      if (r.passed) t.passed += 1;
      t.suites.add(suite.suite);
      byTask.set(id, t);
    }
  }
}

const cell = (id) => {
  const t = byTask.get(id);
  if (!t) return '—';
  return `${t.passed === t.total ? '✅' : '❌'} ${t.passed}/${t.total}`;
};

let md = fs.readFileSync(TASKS_FILE, 'utf8');
const lines = md.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^\|\s*ID\s*\|/.test(line)) {
    if (!/\|\s*Tests\s*\|\s*$/.test(line)) lines[i] = `${line.trimEnd()} Tests |`;
    if (lines[i + 1] && /^\|[-\s|]+\|\s*$/.test(lines[i + 1]) && (lines[i + 1].match(/\|/g) || []).length < (lines[i].match(/\|/g) || []).length) {
      lines[i + 1] = `${lines[i + 1].trimEnd()}-------|`;
    }
    continue;
  }
  const row = /^\|\s*([A-Z]{2}-\d+)\s*\|/.exec(line);
  if (!row) continue;
  const cells = line.split('|');
  // ['', ID, Status, Feature, Scope, (Tests), '']
  if (cells.length === 6) cells.splice(5, 0, ` ${cell(row[1])} `);
  else if (cells.length >= 7) cells[cells.length - 2] = ` ${cell(row[1])} `;
  lines[i] = cells.join('|');
}
md = lines.join('\n');

const totals = suites.reduce((t, s) => ({ passed: t.passed + s.passed, total: t.total + s.total }), { passed: 0, total: 0 });
const latest = suites.map(s => s.ran_at).sort().pop();
const summary = [
  SUMMARY_START,
  '## Test results',
  '',
  `Automated API tests (\`hrm-backend-nodejs/tests/\`) — **${totals.passed} of ${totals.total} checks passing** across ${suites.length} suites` +
    (latest ? `, last run ${latest.slice(0, 16).replace('T', ' ')} UTC.` : '.'),
  'Each suite runs against its own fresh database. Re-run with `node tests/run.mjs` then `node tests/update-task-sheet.mjs`.',
  '',
  '| Suite | Passed | Failed | Total |',
  '|-------|--------|--------|-------|',
  ...suites.map(s => `| ${s.suite} | ${s.passed} | ${s.failed} | ${s.total} |`),
  `| **All** | **${totals.passed}** | **${totals.total - totals.passed}** | **${totals.total}** |`,
  '',
  'The **Tests** column in each table shows passing / total checks for that task (✅ all passing, ❌ some failing, — no automated tests yet).',
  SUMMARY_END
].join('\n');

if (md.includes(SUMMARY_START)) {
  md = md.replace(new RegExp(`${SUMMARY_START}[\\s\\S]*?${SUMMARY_END}`), summary);
} else {
  md = md.replace(/\n---\n/, `\n${summary}\n\n---\n`);
}

fs.writeFileSync(TASKS_FILE, md);
console.log(`TASKS.md updated: ${totals.passed}/${totals.total} checks across ${suites.length} suites, ${byTask.size} tasks with tests.`);
