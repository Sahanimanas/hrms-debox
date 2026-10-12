# HRMS Roadmap — Task Sheet

Tracks the work to turn this HRMS into a full HR suite. Each row is one shippable feature.
Source: the gap analysis in `HRMS_Feature_Gap_Analysis.pdf`.

**Status:** `[ ]` not started · `[~]` in progress / partly built · `[x]` done

All 67 tasks are built. Before going live, see **Before production** at the end of this file.

<!-- test-summary:start -->
## Test results

Automated API tests (`hrm-backend-nodejs/tests/`) — **2118 of 2118 checks passing** across 12 suites, last run 2026-10-10 07:18 UTC.
Each suite runs against its own fresh database. Re-run with `node tests/run.mjs` then `node tests/update-task-sheet.mjs`.

| Suite | Passed | Failed | Total |
|-------|--------|--------|-------|
| analytics | 167 | 0 | 167 |
| assets | 211 | 0 | 211 |
| core | 20 | 0 | 20 |
| engagement | 249 | 0 | 249 |
| leave | 155 | 0 | 155 |
| lifecycle | 254 | 0 | 254 |
| payroll | 226 | 0 | 226 |
| performance | 272 | 0 | 272 |
| platform | 248 | 0 | 248 |
| recruitment | 207 | 0 | 207 |
| time-advanced | 69 | 0 | 69 |
| time-tracking | 40 | 0 | 40 |
| **All** | **2118** | **0** | **2118** |

The **Tests** column in each table shows passing / total checks for that task (✅ all passing, ❌ some failing, — no automated tests yet).
<!-- test-summary:end -->

---

## Phase 1 — Time & attendance (highest impact)

Attendance is currently entered by an admin in a grid. These tasks let employees record their own time and feed the existing grid automatically.

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| TA-1 | [x] | Shifts | Admin creates shifts (start/end time, grace period, full-day and half-day hours, weekly offs); one default shift; assign shifts to employees | ✅ 10/10 |
| TA-2 | [x] | Employee clock-in / clock-out | Clock in/out from the dashboard; one punch log per employee per day; marks the attendance grid automatically | ✅ 8/8 |
| TA-3 | [x] | Late arrival, early exit, overtime | Computed from the employee's shift on every punch; worked hours decide present vs half-day | ✅ 8/8 |
| TA-4 | [x] | Location on clock-in | Capture browser geolocation (optional, if the employee allows it) with each punch | ✅ 8/8 |
| TA-5 | [x] | Attendance correction requests | Employee requests a fix for a missed punch; manager/admin approves; grid and punch log update | ✅ 17/17 |
| TA-6 | [x] | Work-from-home and on-duty requests | Same request flow as TA-5, recorded with a work mode | ✅ 17/17 |
| TA-7 | [x] | My Attendance page | Employee view of today's status, the month's punches and their requests | ✅ 1/1 |
| TA-8 | [x] | Daily punch report | Admin/manager view of everyone's punches, late marks and hours for a day | ✅ 3/3 |
| TA-9 | [x] | Biometric / RFID device integration | Ingest punches from devices via an API endpoint | ✅ 22/22 |
| TA-10 | [x] | Timesheets and project time tracking | Log hours against projects/tasks | ✅ 29/29 |
| TA-11 | [x] | Auto-absent and missed clock-out handling | Nightly job flags missing clock-outs and (optionally) marks absentees; night-shift clock-ins after midnight now count as late | ✅ 18/18 |

## Phase 2 — Payroll & compliance (India)

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| PY-1 | [x] | Statutory engine | PF (12% capped), ESI (0.75%/3.25% under threshold), Professional Tax by state, LWF, TDS (old/new regime) | ✅ 40/40 |
| PY-2 | [x] | Loss-of-pay from attendance | Absent/unpaid days from the grid and leaves deducted automatically | ✅ 7/7 |
| PY-3 | [x] | Payroll run | Monthly run per org: draft → review → lock → paid; no edits after lock | ✅ 54/54 |
| PY-4 | [x] | PDF salary slips | Generated PDF, emailed and downloadable from the employee portal | ✅ 14/14 |
| PY-5 | [x] | Investment declarations | Employee declares 80C/80D/HRA etc.; proof upload; feeds TDS | ✅ 26/26 |
| PY-6 | [x] | Form 16 and statutory files | Form 16 Part B, PF ECR file, ESI return data | ✅ 24/24 |
| PY-7 | [x] | Salary advances and loans | Request → approval → EMI deduction in payroll | ✅ 25/25 |
| PY-8 | [x] | Bonuses, arrears, variable pay | One-off earnings in a payroll run | ✅ 10/10 |
| PY-9 | [x] | Gratuity calculation | 15/26 × last basic × years (≥5 years) | ✅ 8/8 |
| PY-10 | [x] | Bank transfer file | Export payouts in bank bulk-upload format | ✅ 6/6 |
| PY-11 | [x] | Salary revision history | Effective-dated salary changes | ✅ 12/12 |

## Phase 3 — Employee lifecycle

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| EL-1 | [x] | Onboarding checklists | Template tasks (docs, assets, accounts) assigned on joining; progress tracking | ✅ 36/36 |
| EL-2 | [x] | Offboarding | Resignation request → approval → notice period → exit checklist → full and final settlement | ✅ 67/67 |
| EL-3 | [x] | Exit interviews | Questionnaire captured during offboarding | ✅ 20/20 |
| EL-4 | [x] | Document vault | Typed documents per employee with verification, private storage and expiry alerts | ✅ 26/26 |
| EL-5 | [x] | Letter templates | Offer, appointment, experience, relieving letters generated from templates | ✅ 20/20 |
| EL-6 | [x] | Job history | Promotions, transfers, designation changes with dates | ✅ 19/19 |
| EL-7 | [x] | Probation and confirmation | Probation end date, reminder, confirm/extend action | ✅ 26/26 |
| EL-8 | [x] | Profile change requests | Employee edits personal details; HR approves | ✅ 22/22 |
| EL-9 | [x] | Visual org chart | Interactive org chart (search, zoom, expand/collapse) | ✅ 14/14 |

## Phase 4 — Leave (advanced)

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| LV-1 | [x] | Year-end carry-forward and encashment | Year-end carry-forward up to the cap, encash the excess, lapse the rest; January reset keeps carried days | ✅ 37/37 |
| LV-2 | [x] | More leave types | Maternity, paternity, bereavement; restricted/optional holiday quota | ✅ 30/30 |
| LV-3 | [x] | Sandwich rules | Configurable counting of weekends/holidays between leave days | ✅ 13/13 |
| LV-4 | [x] | Multi-level approvals and delegation | Approval chains; delegate approvals while away | ✅ 49/49 |
| LV-5 | [x] | Team "who's out" calendar | Month view of the team's approved leave | ✅ 15/15 |

## Phase 5 — Engagement & communication

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| EN-1 | [x] | Announcements | Admin posts company news; feed on the dashboard; optional pin/expiry | ✅ 37/37 |
| EN-2 | [x] | Birthdays and work anniversaries | Dashboard widget + daily notification | ✅ 39/39 |
| EN-3 | [x] | Policy acknowledgement | Publish policy documents; track "I have read this" | ✅ 39/39 |
| EN-4 | [x] | Surveys and eNPS | Create surveys; anonymous responses; results | ✅ 52/52 |
| EN-5 | [x] | Polls, suggestions, grievances | Quick polls; suggestion box; anonymous grievance with status | ✅ 52/52 |
| EN-6 | [x] | Recognition / kudos | Peer shout-outs on the feed | ✅ 27/27 |

## Phase 6 — Performance & growth

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| PF-1 | [x] | Goals / OKRs / KRAs | Set goals per review cycle with weightage and progress | ✅ 50/50 |
| PF-2 | [x] | Appraisal cycles | Self → manager review; ratings; optional 360° peers | ✅ 75/75 |
| PF-3 | [x] | 1:1s and continuous feedback | Meeting notes and feedback log | ✅ 39/39 |
| PF-4 | [x] | Performance improvement plans | PIP with goals, duration and outcome | ✅ 44/44 |
| PF-5 | [x] | Learning and skills | Courses, certifications, skill matrix | ✅ 64/64 |

## Phase 7 — Recruitment

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| RC-1 | [x] | Job requisitions and postings | Open roles; public careers page | ✅ 58/58 |
| RC-2 | [x] | Candidate pipeline | Kanban stages; CV upload | ✅ 55/55 |
| RC-3 | [x] | Interviews and scorecards | Schedule rounds; interviewer feedback | ✅ 45/45 |
| RC-4 | [x] | Offers and conversion | Offer letter; convert candidate to employee in one step | ✅ 49/49 |

## Phase 8 — Assets & expenses

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| AS-1 | [x] | Asset management | Asset register; assign/return to employees; tie into offboarding | ✅ 107/107 |
| AS-2 | [x] | Expense policy and travel | Category limits (hard/soft), receipts, travel requests with advances, per-diem tiers, receipt OCR (needs ANTHROPIC_API_KEY) | ✅ 104/104 |

## Phase 9 — Analytics

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| AN-1 | [x] | People analytics dashboard | Headcount, joiners/leavers, attrition, department split | ✅ 42/42 |
| AN-2 | [x] | Attendance and leave trends | Late marks, absenteeism, leave usage over time | ✅ 36/36 |
| AN-3 | [x] | Payroll cost analytics | Cost by month/department | ✅ 17/17 |
| AN-4 | [x] | Exports everywhere | CSV export on every list and chart; server-side CSV for large datasets | ✅ 20/20 |
| AN-5 | [x] | Custom and scheduled reports | Pick fields/filters; email on a schedule | ✅ 59/59 |

## Phase 10 — Platform & security

| ID | Status | Feature | Scope | Tests |
|----|--------|---------|-------|-------|
| PL-1 | [x] | Mobile PWA | Service worker fixed (was never registering), install prompt, offline page, new Xeno-HR icons | — |
| PL-2 | [x] | Audit trail | Who changed what, when, on key records | ✅ 33/33 |
| PL-3 | [x] | Two-factor authentication | TOTP for admins (optional for others) | ✅ 47/47 |
| PL-4 | [x] | Single sign-on | Google / Microsoft login | ✅ 29/29 |
| PL-5 | [x] | Custom roles and permissions | Fine-grained permissions beyond admin/manager/employee | ✅ 24/24 |
| PL-6 | [x] | Integrations | Slack/Teams notifications; Google/Outlook calendar sync; Tally/Zoho Books export | ✅ 31/31 |
| PL-7 | [x] | Public API and webhooks | API keys; outbound webhooks on key events | ✅ 43/43 |
| PL-8 | [x] | Multiple languages and currencies | i18n of the UI; currency per organization | ✅ 11/11 |
| PL-9 | [x] | AI HR assistant | Answer policy/leave/payroll questions from company data | ✅ 29/29 |

---

## Changelog

_Completed work is logged here with the date it landed._

### 2026-10-10 — Phase 1 core: self-service time & attendance (TA-1 → TA-8)
- **Backend:** new `routes/timeTracking.js` at `/api/time`: shifts CRUD and assignment, clock-in/out, my logs, daily report, and attendance requests (missed punch / WFH / on duty) with manager/admin approval and in-app notifications.
- Punches are stored in `attendance_logs` (one per employee per day) and mirrored into the existing `attendance` grid, so the admin Attendance page and payroll keep working. Days already marked as leave are never overwritten.
- Late, early-exit, worked and overtime minutes are computed against the employee's shift in the company timezone (`APP_TIMEZONE`, default `Asia/Kolkata`); overnight shifts are supported.
- **Frontend:** clock-in widget on the dashboard, **My Attendance** page (all roles), **Time Tracking** page (admin/manager: approvals + daily report), **Shifts** page (admin).
- If no shift exists, everyone uses a built-in General shift (9:30–18:30, Sunday off) until an admin creates one.

### 2026-10-10 — Phases 2–10 complete

All remaining tasks were built as feature modules (see `docs/MODULES.md`); each has its own API under `/api/v2/<module>`, pages and sidebar section, scheduled jobs and test suite.

- **Phase 2 Payroll (PY-1 → PY-11):** statutory engine (PF/EPS/EDLI, ESI, PT for 7 states, LWF, TDS old/new regime with 87A, surcharge, cess; slabs editable per FY), LOP from attendance + unpaid leave, payroll runs (draft → lock → paid), PDF payslips + publishing, investment declarations with proofs, Form 16 Part B, PF ECR, ESI/PT files, loans with EMI recovery (closed automatically on exit), one-off earnings, gratuity calculator, bank transfer files, salary revision history; pays leave encashments.
- **Phase 3 Lifecycle (EL-1 → EL-9):** onboarding checklists (start automatically on hire), resignation/termination → notice → exit checklist (incl. assets held) → full & final settlement PDF → exit (login disabled), exit interviews, private document vault with expiry alerts, letter templates → PDFs, automatic job history, probation confirm/extend with reminders, profile change requests, interactive org chart.
- **Phase 4 Leave (LV-1 → LV-5):** year-end carry-forward/encashment/lapse (runs automatically 1 Jan, idempotent), maternity/paternity/bereavement/restricted-holiday types, sandwich rule, configurable multi-level approval chains with delegation, team "who's out" calendar.
- **Phase 5 Engagement (EN-1 → EN-6):** announcements with audiences and read tracking, birthdays/anniversaries with wishes, policy acknowledgement with versioning, surveys/eNPS with real anonymity, polls, suggestions, confidential grievances with tracking codes, kudos with leaderboard.
- **Phase 6 Performance (PF-1 → PF-5):** review cycles and weighted goals/OKRs with approval, appraisal cycles (self → manager → 360° peers → calibration → release; peer feedback withheld below 2 responses), 1:1s with agendas and action items, continuous feedback, PIPs, courses, certifications, skills matrix and gap analysis.
- **Phase 7 Recruitment (RC-1 → RC-4):** requisitions → job postings, public careers site with applications (spam-protected), Kanban pipeline, referrals, best-effort CV parsing, interviews with .ics invites and blind scorecards, offer letters, one-click conversion to employee.
- **Phase 8 Assets & expenses (AS-1, AS-2):** asset register with assignment history, acknowledgement, requests, repairs, CSV import and warranty alerts; expense policies, receipts, travel requests with advances, per-diem tiers, receipt OCR.
- **Phase 9 Analytics (AN-1 → AN-5):** people, attendance & leave, and payroll cost dashboards; exports on every list; custom report builder with scheduled email delivery.
- **Phase 10 Platform (PL-1 → PL-9):** working PWA, audit trail (anonymous features excluded), TOTP 2FA, Google/Microsoft SSO, custom roles and permissions, Slack/Teams + calendar feeds + Tally/Zoho exports, public API keys and signed webhooks, English/Hindi + per-organization currency, AI HR assistant (needs ANTHROPIC_API_KEY).
- **Integration fixes:** manager permission check in time tracking could match any employee (fixed, regression-tested); uploads of resumes, tax proofs and employee documents are now private; employee self-edit can no longer change salary/designation; employee-ID generation crash on duplicate IDs fixed.

### 2026-10-10 — Phase 1 complete (TA-9 → TA-11)
- **TA-9 Devices:** register biometric/RFID devices (API key shown once, rotate/disable), map employees to device user IDs, `POST /api/time/devices/punches` ingests batches with de-duplication and "first in, last out" per day; night-shift punches count toward the shift's start date; approved corrections are never overwritten.
- **TA-10 Timesheets:** projects (open or member-restricted, billable flag), weekly timesheet grid, submit/recall, manager approval or send-back with comments, hours report by project/person with CSV export.
- **TA-11 Nightly close** (`attendance-daily-close`, 01:30): flags missed clock-outs and notifies the employee (optionally counts the day as a half day); optional auto-absent skips leave, weekly offs, holidays and people who hadn't joined yet. Settings and "run now" on the Shifts page.
- Fixed: clock-ins after midnight on night shifts weren't marked late.
- Infrastructure: feature-module system (`docs/MODULES.md`), grouped sidebar, scheduler now actually started (legacy monthly leave credit only with `ENABLE_LEAVE_CREDIT_CRON=true`), local file storage fallback, test runner with a fresh DB per suite.

### 2026-10-10 — Rebrand DeBox → Xeno-HR
- Product name changed in the page title, PWA manifest, landing page, login page and sidebar. The logo image was replaced with a text wordmark (`components/BrandLogo.jsx`).
- Still to do: favicon / app icons in `public/` and `logo_debox_tagline-w.png` are the old DeBox artwork and need new image files.

---

## Before production

Things that need a person, a credential or a decision before this goes live:

- **Review money-affecting behaviour:** leave year-end now runs automatically on 1 January (carry-forward up to the policy cap, excess encashed and paid in the next payroll run); half-day leave now costs 0.5 per day; payroll PT/LWF slabs are hard-coded and should be checked against current state notifications; PF ECR / HDFC bank files haven't been validated on the EPFO / bank portals.
- **Credentials (optional features stay off without them):** `ANTHROPIC_API_KEY` (AI assistant, receipt OCR), `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` (SSO), Slack/Teams webhook URLs (set in the app), Mailjet keys (already configured) for payslip / report emails.
- **Keep secrets stable:** `PLATFORM_ENCRYPTION_KEY` (defaults to one derived from the JWT secret) encrypts 2FA and webhook secrets; changing it later makes them unreadable.
- **Existing data:** existing employees have no `employment_status` (treated as active) and no date of birth / probation dates; existing leave policies need "Add standard types" to show the new leave types.
- **Exit documents:** exited employees can't log in, so settlement statements and relieving letters must be sent to them (email with attachment isn't built yet).
- **Known gaps:** no higher TDS rate when PAN is missing (warning only); no previous-employer income in TDS; CV parsing only reads text PDFs/DOCX; receipt OCR is untested against the live API; rate limits are per server process.
