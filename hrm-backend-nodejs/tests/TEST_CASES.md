# DeBox HRMS — Test Cases & API Verification

Two things live here:

1. **`api-smoke.js`** — an executable check that logs in and hits every endpoint,
   reporting `PASS / WARN / FAIL`. Use it to answer *"are all the APIs working?"*
2. **This document** — structured test cases per module (happy path, validation,
   auth/role, edge cases) for manual / QA / future automated coverage.

---

## Running the API smoke test

```bash
# backend must be running and connected to MongoDB
npm run test            # read-only checks (safe on production data)
npm run test:write      # also runs create→update→delete CRUD (auto-cleans up)
```

Override target / credentials via env:

```bash
API_URL=http://127.0.0.1:4001/api ADMIN_EMAIL=you@co.com ADMIN_PASSWORD=secret npm test
```

**Verdicts:**
- `PASS` — 2xx response
- `WARN` — 400/403 or a soft 404 (validation/permission worked, or optional data absent) — *not broken*
- `FAIL` — 401 with a valid token, 404 (missing route), 5xx, or no connection

**Last run:** `51 PASS, 4 WARN, 0 FAIL` (the 4 warns are role-enforcement 403s on
employee/manager-only routes hit by an admin, plus a 400 for an invalid reset token).

---

## Auth & roles cheat-sheet

| Role | Token gives access to |
|------|----------------------|
| `admin` | everything (org-wide) |
| `manager` | team approvals, team views, own data |
| `employee` | own leaves/comp-off/reimbursements/profile |

A `403` when an admin hits an employee-only route (e.g. "my requests") is **correct** behaviour.

---

## Module test cases

### 1. Setup  (`/api/setup`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| SET-1 | Status check | `GET /setup/status` | 200, `setup_completed:true` |
| SET-2 | Valid Mongo URL | `POST /setup/test-connection` | 200, `success:true` |
| SET-3 | Invalid Mongo URL | `POST /setup/test-connection` (bad host) | 200, `success:false` + message |
| SET-4 | URL with un-encoded special chars | bad password | `success:false`, encoding hint |

### 2. Auth  (`/api/auth`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| AUT-1 | Login valid | `POST /auth/login` | 200 + JWT + user |
| AUT-2 | Login wrong password | `POST /auth/login` | 401 `INVALID_PASSWORD` |
| AUT-3 | Login unknown email | `POST /auth/login` | 401 `USER_NOT_FOUND` |
| AUT-4 | Get profile with token | `GET /auth/me` | 200, current employee |
| AUT-5 | Get profile no token | `GET /auth/me` | 401 |
| AUT-6 | **Register as admin is blocked** | `POST /auth/register` role=admin | 400/422 validation error |
| AUT-7 | Register employee/manager | `POST /auth/register` | 201 + creates user+employee |
| AUT-8 | Register duplicate email | `POST /auth/register` | 400 "already registered" |
| AUT-9 | Register missing fields | `POST /auth/register` | 400/422 |

### 3. Employees  (`/api/employees`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| EMP-1 | List employees (admin/manager) | `GET /employees` | 200 array |
| EMP-2 | List as employee | `GET /employees` | 403 |
| EMP-3 | Create employee | `POST /employees` | 201 |
| EMP-4 | Update employee | `PUT /employees/:userId` | 200 |
| EMP-5 | Change role | `PUT /employees/:userId/role` | 200 |
| EMP-6 | Adjust leave balance | `PUT /employees/:userId/leave-balance` | 200 |
| EMP-7 | Delete employee | `DELETE /employees/:employeeId` | 200 |
| EMP-8 | Employee-ID settings get/set | `GET`/`POST /employee-id-settings` | 200 |
| EMP-9 | Duplicate detection | `GET /employees/check-duplicates` | 200 list |
| EMP-10 | Recalculate balance | `POST /recalculate-leave-balance/:id` | 200 |

### 4. Leaves  (`/api/leaves`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| LV-1 | Apply for leave | `POST /leaves` | 201, status `pending` |
| LV-2 | Apply with insufficient balance | `POST /leaves` | 400 |
| LV-3 | Apply overlapping dates | `POST /leaves` | 400 |
| LV-4 | Validate before apply | `POST /validate-application` | 200 ok / 400 reason |
| LV-5 | My leaves | `GET /my-leaves` | 200 |
| LV-6 | Pending (manager/admin) | `GET /pending` | 200 |
| LV-7 | All leaves (admin) | `GET /all` | 200 |
| LV-8 | Calendar (me / employee) | `GET /calendar/me`, `/calendar/:id` | 200 |
| LV-9 | Approve/reject | `PUT /:leaveId/action` | 200, status changes, balance updated |
| LV-10 | Edit a leave | `PUT /:leaveId` | 200 |
| LV-11 | Cancel/delete leave | `DELETE /:leaveId` | 200, balance restored |

### 5. Leave Policy  (`/api/leave-policy`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| LP-1 | Get policy | `GET /leave-policy` | 200 |
| LP-2 | Save policy | `POST /leave-policy` | 200 |
| LP-3 | Apply to one employee | `POST /leave-policy/apply-to-employee/:id` | 200 |
| LP-4 | Apply to all | `POST /leave-policy/apply-to-all` | 200 |

### 6. Leave Credit / Balance Mgmt  (`/api/admin/leave-credit`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| LC-1 | Credit rules | `GET /rules` | 200 |
| LC-2 | Bulk update balances | `POST /leave-balance/bulk-update` | 200 |
| LC-3 | Update one | `POST /leave-balance/update/:id` | 200 |
| LC-4 | Run monthly credit | `POST /run-monthly` | 200 |
| LC-5 | Initialize all | `POST /initialize-all` | 200 |
| LC-6 | Logs / adjustment logs | `GET /logs`, `/adjustment-logs` | 200 |
| LC-7 | Simulate | `POST /simulate` | 200 |
| LC-8 | Balance summary | `GET /leave-balance/summary` | 200 |

### 7. Attendance  (`/api/attendance`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| ATT-1 | Monthly grid | `GET /?month&year` | 200 |
| ATT-2 | Mark one | `POST /mark` | 200 |
| ATT-3 | Bulk mark | `POST /bulk-mark` | 200 |
| ATT-4 | Mark whole column (date) | `POST /mark-column` | 200 |
| ATT-5 | Summary | `GET /summary` | 200 |
| ATT-6 | Clear | `DELETE /clear` | 200 |
| ATT-7 | Export | `POST /download` | 200 file (xlsx) |
| ATT-8 | As employee | any | 403 |

### 8. Holidays  (`/api/holidays`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| HOL-1 | List / upcoming | `GET /`, `/list/upcoming` | 200 |
| HOL-2 | Create | `POST /` | 201 |
| HOL-3 | Create duplicate date | `POST /` | 400 |
| HOL-4 | Update / delete | `PUT`/`DELETE /:id` | 200 |
| HOL-5 | Recurring add/remove | `POST`/`DELETE /recurring` | 200 |
| HOL-6 | Check a date | `GET /check/:date` | 200 |

### 9. Comp-Off  (`/api/comp-off`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| CO-1 | Request (employee) | `POST /request` | 201 |
| CO-2 | My / team / all requests | `GET /my-requests`, `/team-requests`, `/all-requests` | 200 (role-scoped) |
| CO-3 | Approve/reject | `POST /:id/action` | 200 |
| CO-4 | Balance | `GET /balance` | 200 |
| CO-5 | Grant (admin) | `POST /grant` | 200 |
| CO-6 | Use / use-balance | `POST /:id/use`, `/use-balance` | 200 |

### 10. Reimbursements  (`/api/reimbursements`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| RB-1 | Apply with receipt | `POST /apply` | 201 |
| RB-2 | Mine / all | `GET /my`, `/all` | 200 (role-scoped) |
| RB-3 | Stats | `GET /stats` | 200 |
| RB-4 | Approve / reject / clear | `POST /:id/action` | 200 |
| RB-5 | Edit | `PUT /:id` | 200 |
| RB-6 | Get one / delete | `GET`/`DELETE /:id` | 200 |

### 11. Payroll & Salary  (`/api`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| PAY-1 | Salary template get/save | `GET`/`POST /salary-template` | 200 |
| PAY-2 | Salary structure get/save | `GET`/`POST /salary-structure/:id` | 200 |
| PAY-3 | Send salary slip | `POST /payroll/send-salary-slip` | 200 (email) |
| PAY-4 | Detailed slip | `POST /payroll/send-detailed-salary-slip` | 200 |
| PAY-5 | Employee report | `GET /payroll/employee-report/:id/:month` | 200 |
| PAY-6 | Monthly summary | `GET /payroll/monthly-summary/:month` | 200 |

### 12. Organizations  (`/api/organizations`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| ORG-1 | Create (admin) | `POST /` | 201 |
| ORG-2 | Create as non-admin | `POST /` | 403 |
| ORG-3 | List | `GET /` | 200 |
| ORG-4 | Update / delete | `PUT`/`DELETE /:orgId` | 200 |

### 13. Dashboard  (`/api/dashboard`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| DSH-1 | Stats | `GET /stats` | 200 with counts |

### 14. Notification Settings  (`/api/notification-settings`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| NS-1 | Get / save settings | `GET`/`POST /notification-settings` | 200 |
| NS-2 | Test email | `POST /notification-settings/test-email` | 200 (sends) |
| NS-3 | Test WhatsApp | `POST /notification-settings/test-whatsapp` | 200 (sends) |

### 15. User Notifications  (`/api/notifications`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| UN-1 | List / unread count | `GET /`, `/unread-count` | 200 |
| UN-2 | Mark read / read-all | `PUT /:id/read`, `/read-all` | 200 |
| UN-3 | Delete / restore | `DELETE /:id`, `PUT /:id/restore` | 200 |
| UN-4 | Admin all | `GET /admin/all` | 200 |

### 16. Uploads  (`/api/uploads`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| UP-1 | Health | `GET /health` | 200 (auth required) |
| UP-2 | Profile picture up/del | `POST`/`DELETE /profile-picture` | 200 |
| UP-3 | Government ID up/del | `POST`/`DELETE /government-id` | 200 |
| UP-4 | Non-image / oversize file | `POST` | 400 |

### 17. Password Reset  (`/api/password-reset`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| PR-1 | Request reset | `POST /request` | 200 (email sent) |
| PR-2 | Validate good token | `GET /validate/:token` | 200 |
| PR-3 | Validate bad token | `GET /validate/:token` | 400/404 |
| PR-4 | Reset with token | `POST /reset` | 200, password changed |

### 18. WhatsApp  (`/api/whatsapp`)
| ID | Scenario | Endpoint | Expected |
|----|----------|----------|----------|
| WA-1 | Status | `GET /status` | 200 |
| WA-2 | Connect (QR) | `POST /connect` | 200 + QR |
| WA-3 | Disconnect | `POST /disconnect` | 200 |
| WA-4 | Send test | `POST /send-test` | 200 |

---

## Frontend (manual / e2e) — key flows

| Area | Flow to verify |
|------|----------------|
| Landing | `/` shows landing (logged out); Login & Register buttons → `/login` (Register opens Register tab) |
| Auth | Register (employee/manager only — no Admin option); login; logout |
| Dashboard | Stats cards + recent leaves render with real numbers |
| Leaves | Apply → appears in My Leaves; manager approves → status updates |
| Approvals | Pending list; approve/reject reflects on employee side |
| Attendance | Mark/bulk-mark; month switch; export |
| Payroll | Build salary structure; generate/send slip |
| Theme | Black sidebar + yellow active item; colored feature cards on landing |
| RBAC | Employee cannot see admin nav items; manager sees team-only |

> Not yet automated. Candidates for Playwright/Cypress later; the API smoke test
> already covers the backend contract.
