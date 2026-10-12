# Xeno-HR — Feature Module Guide

How feature areas (payroll, lifecycle, engagement, …) are built and wired into Xeno-HR.
The roadmap with task IDs is in [`TASKS.md`](../TASKS.md).

## Layout

| Piece | Location | Notes |
|---|---|---|
| Backend router | `hrm-backend-nodejs/routes/modules/<module>.js` | Mounted at **`/api/v2/<module>`** by `routes/modules/index.js`. A module that fails to load is logged and skipped. |
| Backend helpers | `hrm-backend-nodejs/services/<module>/…` | Business logic, PDF builders, calculators. (Don't create a `routes/modules/<module>/` folder — it would shadow the router file.) |
| Scheduled jobs | `hrm-backend-nodejs/cron/jobs/<module>.js` | `module.exports = [{ name, schedule, description, run: async (db) => result }]`. Registered by `cron/index.js`, run in `APP_TIMEZONE`. Admins can trigger one with `POST /api/v2/jobs/<name>/run`. |
| API tests | `hrm-backend-nodejs/tests/suites/<module>.test.mjs` | See **Testing**. |
| Frontend module | `hr-management-frontend-vite/src/modules/<module>/index.jsx` | Default export `{ routes, publicRoutes, nav, dashboardWidgets }` — see `src/modules/registry.js`. |
| Frontend pages | `src/modules/<module>/pages/*.jsx`, `src/modules/<module>/components/*.jsx` | |

### Modules

| Module | Phase | API prefix |
|---|---|---|
| `payroll` | 2 — Payroll & compliance | `/api/v2/payroll` |
| `lifecycle` | 3 — Employee lifecycle | `/api/v2/lifecycle` |
| `leave` | 4 — Leave (advanced) | `/api/v2/leave` (+ existing `/api/leaves`) |
| `engagement` | 5 — Engagement & communication | `/api/v2/engagement` |
| `performance` | 6 — Performance & growth | `/api/v2/performance` |
| `recruitment` | 7 — Recruitment | `/api/v2/recruitment` (has public endpoints) |
| `assets` | 8 — Assets & expenses | `/api/v2/assets` (+ existing `/api/reimbursements`) |
| `analytics` | 9 — Analytics | `/api/v2/analytics` |
| `platform` | 10 — Platform & security | `/api/v2/platform` |

Time & attendance (Phase 1) predates the module system and lives in `routes/timeTracking.js` at `/api/time`.

## Backend conventions

- **Auth:** `const { authenticate } = require('../../middleware/auth')`; `const { requireRole, validate } = require('../../middleware/roleCheck')`. `req.user` = `{ id, employee_id, full_name, email, role }`. Roles: `admin`, `manager`, `employee`. Public endpoints simply skip `authenticate`.
- **Validation:** Joi schemas defined inside your module (`validate(schema)` → `req.validatedBody`; failures return 422). Don't edit `models/schemas.js` unless you own it.
- **DB:** `const { getDB } = require('../../config/database')`. Documents use a uuid `id` (`generateUUID()` from `utils/helpers`), `created_at` / `updated_at` as `Date`. Strip `_id` from responses (`{ projection: { _id: 0 } }`). Create indexes lazily once per process (see `ensureIndexes` in `routes/timeTracking.js`).
- **Errors:** `res.status(4xx).json({ detail: 'Human readable message' })`; unexpected errors log and return `500 { detail: 'Internal server error' }`.
- **Current employee:** `db.collection('employees').findOne({ email: req.user.email })` (admins may have no employee record — handle `null`). Stable per-employee key: `employeeUid(employee)` from `utils/helpers`.
- **Manager's team:** employees whose `manager_email` is the manager's email, or in the manager's department (excluding the manager) — same rule as `teamQuery` in `routes/timeTracking.js`.
- **Time:** company timezone helpers in `utils/helpers`: `APP_TIMEZONE`, `localParts(date)` → `{ date: 'YYYY-MM-DD', year, month, day, weekday, minutes }`, `zonedTimeToDate(dateStr, 'HH:mm')`.
- **Notifications:** `createNotification({ userId, userEmail, type, title, message, actionUrl, metadata })` from `services/notificationService` (`type` is any snake_case string). Email: `sendEmailNotification(to, subject, html)` from `services/emailService` (no-op without Mailjet keys). Don't block the response on notifications.
- **Files:** `storeFile(buffer, originalName, mimeType, folder, ownerId)` / `removeFile(key)` from `services/fileStorage` (S3 in production, local `uploads/` otherwise). Parse uploads with `multer({ storage: multer.memoryStorage(), limits: { fileSize } })`.
- **PDFs:** `pdfkit` is installed.
- **Events:** call `emitEvent('noun.verb', payload)` from `services/events` on notable changes (e.g. `employee.exited`, `payroll.run.locked`, `candidate.hired`, `leave.approved`). The platform module turns these into webhooks / Slack messages.
- **Money:** INR, stored as numbers rounded to 2 decimals.

## Shared data contracts

Fields and collections other modules read. The owner writes; everyone else reads.

| Data | Owner | Shape |
|---|---|---|
| `employees` (existing) | lifecycle (new fields) | existing: `id`, `employee_id`, `email`, `full_name`, `role`, `department`, `designation`, `manager_email`, `joining_date`, `phone`, `organization_id`, `monthly_salary`, `leave_balance`, `shift_id`. **New:** `date_of_birth` (Date), `gender`, `employment_status` (`active` \| `probation` \| `notice` \| `exited`; missing ⇒ `active`), `probation_end_date`, `confirmation_date`, `exit_date` (Date), `exit_reason` |
| `salary_structures` (existing) | payroll | `{ employee_id, basic_salary, components: [{ name, amount, type: 'earning'\|'deduction', is_percentage, calculation_base }] }` |
| `payslips` | payroll | `{ id, run_id, month: 'YYYY-MM', employee_uid, employee_name, department, gross_earnings, total_deductions, net_pay, lop_days, earnings: [{ name, amount }], deductions: [{ name, amount }], employer_contributions: { pf, esi }, status }` |
| `payroll_runs` | payroll | `{ id, month: 'YYYY-MM', status: 'draft'\|'locked'\|'paid', totals: { gross, deductions, net, employer_cost } }` |
| `loans` | payroll | `{ id, employee_uid, principal, outstanding, emi, status }` |
| `assets` | assets | `{ id, asset_tag, name, category, status: 'available'\|'assigned'\|'in_repair'\|'retired'\|'lost', assigned_to_uid, assigned_to_email }` — assets in repair or lost keep `assigned_to_*`, so match on those fields to find what someone holds |
| `attendance` (existing) | core | `{ employee_id, month, year, attendance: { '<day>': 'present'\|'absent'\|'half-day'\|'leave' } }` |
| `attendance_logs` | core (time tracking) | one per employee per day: `clock_in`, `clock_out`, `late_minutes`, `worked_minutes`, `overtime_minutes`, `status`, `work_mode` |
| `leaves` (existing) | leave | `{ id, employee_id (= employees.id uuid, not the EMP code), employee_email, employee_name, manager_email, leave_type, dates: [ISO string], days_count, is_half_day, status: 'pending'\|'manager_approved'\|'approved'\|'rejected' }` |
| `audit_logs` | platform | written by `middleware/auditLog.js` |
| `users` (existing) | platform | auth accounts. **New:** `is_active` (false ⇒ login blocked; lifecycle sets it when an employee exits), `custom_role_id`, 2FA fields |
| `leave_encashments` | leave | `{ id, employee_id (uuid), employee_email, leave_type, days, year, amount, status: 'pending'\|'paid', payroll_run_id }` — payroll pays pending ones |
| `policy_documents` | engagement | `{ id, title, body, file_url, version, published_at, requires_ack }` |
| `announcements` | engagement | `{ id, title, body, pinned, published_at, expires_at, audience }` |
| `interviews` | recruitment | `{ id, candidate_id, candidate_name, job_id, job_title, scheduled_at (Date), duration_minutes, interviewer_emails: [], mode, meeting_link, status }` |
| `one_on_ones` | performance | `{ id, manager_email, employee_email, scheduled_at (Date), duration_minutes, status }` |
| `employee_statutory` | payroll | `{ employee_uid, pan, uan, esic_number, bank_name, bank_account_number, ifsc, tax_regime: 'new'\|'old', pt_state }` |

## Frontend conventions

- API client: `import api from '@/lib/api'` (base URL already ends in `/api`) → `api.get('/v2/<module>/…')`.
- UI kit: `@/components/ui/*` (button, card, input, label, textarea, badge, dialog, select, tabs, checkbox, switch, …), toasts via `import { toast } from 'sonner'`, icons from `lucide-react`, dates via `date-fns`, charts via `recharts`, CSV via `exportCsv` from `@/lib/exportCsv`.
- Page pattern: copy the header / card / table style of `src/pages/MyAttendancePage.jsx` (dark icon tile + title + subtitle, `max-w-6xl` container, responsive tables that hide secondary columns on mobile).
- Every list page offers **Export CSV** (AN-4).
- Lint rules that bite: don't destructure-rename components in params (`({ icon: Icon })`) — assign `const Icon = item.icon` instead; don't call `setState` synchronously inside `useEffect` — define the loader with `useCallback` and call it from the effect; use `catch {` when the error is unused.
- Nav entries: `{ name, href: '/path', icon, roles: [...], section }` where `section` is one of `NAV_SECTIONS` in `src/modules/registry.js`.

## Testing

```bash
cd hrm-backend-nodejs
node tests/run.mjs                                   # every suite, fresh DB
node tests/run.mjs payroll --port 4021 --db hrms_t_payroll
```

`tests/run.mjs` drops the test database, starts the backend on the given port with email / WhatsApp / S3 credentials blanked and cron disabled, runs the suites, then stops the server and drops the database. Results land in `tests/results/` (git-ignored).

Suites import `tests/lib/harness.mjs`:

```js
import { run, section, check, get, post, put, del, upload, bootstrap, createUser, withDb } from '../lib/harness.mjs';

await run(async () => {
  const admin = await bootstrap();                       // admin token
  const emp = await createUser(admin, { role: 'employee' }); // { email, token, employee_id, … }
  section('PY-1 Statutory engine');                      // start section names with the task ID
  const r = await get('/v2/payroll/…', admin);
  check('describes the expectation', r.s === 200 && …, r); // 3rd arg printed on failure
});
```

Name each `section()` after its task ID so results map onto `TASKS.md`.

## Not to be edited by modules

`server.js`, `routes/modules/index.js`, `cron/index.js`, `package.json` files, `src/App.jsx`, `src/modules/registry.js`, and other modules' folders. Need something there? Ask in the module's integration notes.
