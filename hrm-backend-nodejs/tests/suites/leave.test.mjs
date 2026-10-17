// Phase 4 — advanced leave (LV-1 … LV-5) plus regression checks on the original /api/leaves flow
import { run, section, check, get, post, put, del, bootstrap, createUser, withDb } from '../lib/harness.mjs';

const DAY = 86400000;
const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
const iso = (key) => `${key}T00:00:00.000Z`;
const range = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());

const setBalance = (email, balance) => withDb(db => db.collection('employees').updateOne(
  { email },
  { $set: Object.fromEntries(Object.entries(balance).map(([k, v]) => [`leave_balance.${k}`, v])) }
));
const balanceOf = async (email) => (await withDb(db => db.collection('employees').findOne({ email })))?.leave_balance || {};
const apply = (token, leave_type, keys, extra = {}) => post('/leaves', token, {
  leave_type, dates: keys.map(iso), reason: 'Test leave', is_half_day: false, ...extra
});
const act = (token, id, action, comments) => put(`/leaves/${id}/action`, token, { action, ...(comments ? { comments } : {}) });

const POLICY = {
  policies: [
    { leave_type: 'Earned Leave', annual_quota: 12, order: 1, credit_type: 'monthly', monthly_credit: 1, advance_days_required: 7, encashment_allowed: true, carry_forward_allowed: true, max_carry_forward_days: 5, clubbing_not_allowed_with: [] },
    { leave_type: 'Sick Leave', annual_quota: 6, order: 2, credit_type: 'monthly', monthly_credit: 0.5, advance_days_required: 0, encashment_allowed: false, carry_forward_allowed: false, max_carry_forward_days: 0, clubbing_not_allowed_with: [] },
    { leave_type: 'Casual Leave', annual_quota: 6, order: 3, credit_type: 'annually', monthly_credit: 0, advance_days_required: 0, encashment_allowed: false, carry_forward_allowed: false, max_carry_forward_days: 0, clubbing_not_allowed_with: [], sandwich_rule: true },
    { leave_type: 'Unpaid Leave', annual_quota: 0, order: 4, credit_type: 'annually', monthly_credit: 0, is_unlimited: true }
  ],
  clubbing_rules: []
};

await run(async () => {
  const admin = await bootstrap();
  const today = todayIST();
  const currentYear = Number(today.slice(0, 4));

  // A Monday at least three weeks out, so advance-notice rules don't interfere
  let base = addDays(today, 21);
  while (weekday(base) !== 1) base = addDays(base, 1);
  const FRI = addDays(base, 4), SAT = addDays(base, 5), SUN = addDays(base, 6), MON2 = addDays(base, 7);
  const TUE2 = addDays(base, 8), WED2 = addDays(base, 9), THU2 = addDays(base, 10);
  const MON3 = addDays(base, 14), WED3 = addDays(base, 16), THU3 = addDays(base, 17);

  // ------------------------------------------------------------------ setup
  let r = await post('/leaves/leave-policy', admin, POLICY);
  const policySaved = r.s === 200;
  r = await post('/time/shifts', admin, { name: 'Mon-Fri', start_time: '09:30', end_time: '18:30', weekly_offs: [0, 6], is_default: true });
  const shiftId = r.d?.id;
  r = await post('/time/shifts', admin, { name: 'Six day', start_time: '09:30', end_time: '18:30', weekly_offs: [0] });
  const sixDayShift = r.d?.id;
  await post('/holidays', admin, { name: 'Founders Day', date: WED2, type: 'public' });
  await post('/holidays', admin, { name: 'Regional Festival', date: THU3, type: 'optional' });

  // Everyone joined well before last year so the year-end close applies to them
  const JOINED = '2024-01-15';
  const mgr = await createUser(admin, { role: 'manager', name: 'Mira Manager', department: 'Engineering', joining_date: JOINED });
  const emp = await createUser(admin, { role: 'employee', name: 'Eli Employee', department: 'Engineering', manager_email: mgr.email, joining_date: JOINED });
  const emp2 = await createUser(admin, { role: 'employee', name: 'Ena Colleague', department: 'Engineering', manager_email: mgr.email, joining_date: JOINED });
  const emp3 = await createUser(admin, { role: 'employee', name: 'Fay Female', department: 'Engineering', manager_email: mgr.email, joining_date: JOINED });
  const sixer = await createUser(admin, { role: 'employee', name: 'Sid Sixday', department: 'Engineering', manager_email: mgr.email, joining_date: JOINED });
  const mgr2 = await createUser(admin, { role: 'manager', name: 'Max OtherManager', department: 'Sales', joining_date: JOINED });
  const sales = await createUser(admin, { role: 'employee', name: 'Sam Sales', department: 'Sales', manager_email: mgr2.email, joining_date: JOINED });
  const hr = await createUser(admin, { role: 'admin', name: 'Hana HR', department: 'HR', joining_date: JOINED });
  await put('/time/shifts-assign', admin, { shift_id: sixDayShift, employee_ids: [sixer.employee_id] });
  for (const u of [emp, emp2, emp3, sixer, sales, mgr, mgr2]) {
    await setBalance(u.email, { earned_leave: 10, sick_leave: 4, casual_leave: 6, comp_off: 0 });
  }

  // ===================================================================== LV-2
  section('LV-2 More leave types');
  check('custom policy saved', policySaved);
  r = await post('/leaves/leave-policy', admin, { policies: [{ leave_type: 'Bad', annual_quota: 1, credit_type: 'weekly' }] });
  check('policy with an unknown credit type is rejected', r.s === 422, r);
  r = await post('/leaves/leave-policy', admin, { policies: [{ leave_type: 'Dup', annual_quota: 1 }, { leave_type: 'dup', annual_quota: 2 }] });
  check('policy with a duplicate leave type is rejected', r.s === 422, r);
  r = await get('/v2/leave/types', emp.token);
  check('types lists the four standard types as missing', r.s === 200 && r.d.missing_standard_types.length === 4, r.d);
  r = await post('/v2/leave/policy/add-standard-types', emp.token, {});
  check('employee cannot add standard types', r.s === 403, r);
  r = await post('/v2/leave/policy/add-standard-types', admin, { types: ['Nonsense'] });
  check('unknown standard type rejected', r.s === 422, r);
  r = await post('/v2/leave/policy/add-standard-types', admin, {});
  check('admin adds maternity, paternity, bereavement, restricted holiday', r.s === 200 && r.d.added.length === 4, r.d);
  r = await post('/v2/leave/policy/add-standard-types', admin, {});
  check('adding again is a no-op', r.s === 200 && r.d.added.length === 0, r.d);
  r = await get('/leaves/leave-policy', emp.token);
  const mat = r.d?.policies?.find(p => p.leave_type === 'Maternity Leave');
  check("policy stores maternity as credit_type 'event' with 182 days per occurrence", mat?.credit_type === 'event' && mat.annual_quota === 182 && mat.event_scope === 'occurrence', mat);
  check('existing types kept their settings', r.d?.policies?.find(p => p.leave_type === 'Casual Leave')?.sandwich_rule === true, r.d?.policies);

  r = await get('/v2/leave/my-balance', emp.token);
  const rh = r.d?.types?.find(t => t.key === 'restricted_holiday');
  const matBal = r.d?.types?.find(t => t.key === 'maternity_leave');
  check('restricted holiday quota defaults to 2 for existing employees', rh?.available === 2, rh);
  check('maternity shows a per-occurrence entitlement', matBal?.per_occurrence === true && matBal.available === 182, matBal);

  await withDb(db => db.collection('employees').updateOne({ email: emp.email }, { $set: { gender: 'male' } }));
  await withDb(db => db.collection('employees').updateOne({ email: emp3.email }, { $set: { gender: 'female' } }));
  const matDays = range(addDays(base, 35), 10);
  r = await apply(emp.token, 'Maternity Leave', matDays);
  check('maternity blocked when the employee record says male', r.s === 400 && /female/.test(r.d?.detail), r);
  r = await apply(emp3.token, 'Maternity Leave', range(addDays(base, 60), 183));
  check('maternity over 182 days per occurrence rejected', r.s === 400 && /182/.test(r.d?.detail), r);
  r = await apply(emp3.token, 'Maternity Leave', matDays);
  check('maternity of 10 days accepted for a female employee', r.s === 201 && r.d.days_count === 10, r);
  const matId = r.d?.id;
  r = await act(admin, matId, 'approve');
  check('admin approves maternity', r.s === 200 && r.d.status === 'approved', r);
  check('per-occurrence leave does not deduct a balance', (await balanceOf(emp3.email)).maternity_leave === undefined || (await balanceOf(emp3.email)).maternity_leave === 182);
  r = await apply(emp3.token, 'Maternity Leave', range(addDays(base, 50), 2));
  check('second maternity occurrence in the same year rejected (max 1/year)', r.s === 400 && /per year/.test(r.d?.detail), r);
  // No sandwich rule on these types, so weekly offs in the range aren't charged:
  // 23 calendar days from a Monday = 17 working days, Mon → next Mon = 6
  r = await apply(emp.token, 'Paternity Leave', range(addDays(base, 35), 23));
  check('paternity over 15 days rejected', r.s === 400 && /15/.test(r.d?.detail), r);
  r = await apply(emp.token, 'Paternity Leave', range(addDays(base, 35), 3));
  check('paternity of 3 days accepted', r.s === 201, r);
  r = await apply(emp2.token, 'Bereavement Leave', range(addDays(base, 35), 8));
  check('bereavement over 5 days rejected', r.s === 400, r);
  r = await apply(emp2.token, 'Bereavement Leave', range(addDays(base, 35), 5));
  check('bereavement of 5 days accepted', r.s === 201 && r.d.days_count === 5, r);
  r = await act(admin, r.d?.id, 'approve');
  check('approving bereavement leaves the balance alone', r.s === 200 && (await balanceOf(emp2.email)).earned_leave === 10, r);

  r = await post('/leaves/validate-application', emp.token, { leave_type: 'Restricted Holiday', dates: [iso(TUE2)] });
  check('validate flags restricted holiday on a normal working day', r.s === 200 && r.d.valid === false && r.d.errors.some(e => e.type === 'restricted_holiday'), r.d);
  r = await apply(emp.token, 'Restricted Holiday', [TUE2]);
  check('restricted holiday on a non-optional day rejected', r.s === 400 && /optional or restricted/.test(r.d?.detail), r);
  r = await apply(emp.token, 'Restricted Holiday', [WED2]);
  check('restricted holiday on a public holiday rejected', r.s === 400, r);
  r = await get(`/v2/leave/restricted-holidays?year=${THU3.slice(0, 4)}`, emp.token);
  check('restricted-holidays lists the optional holiday', r.s === 200 && r.d.holidays.some(h => h.date === THU3 && !h.booked), r.d);
  r = await apply(emp.token, 'Restricted Holiday', [THU3]);
  check('restricted holiday on an optional holiday accepted', r.s === 201, r);
  const rhId = r.d?.id;
  r = await act(admin, rhId, 'approve');
  check('approving RH deducts the RH quota (2 → 1)', r.s === 200 && (await balanceOf(emp.email)).restricted_holiday === 1, await balanceOf(emp.email));
  r = await get(`/v2/leave/restricted-holidays?year=${THU3.slice(0, 4)}`, emp.token);
  check('restricted-holidays marks the day as booked', r.d?.holidays?.find(h => h.date === THU3)?.booked === true, r.d);

  // ===================================================================== LV-3
  section('LV-3 Sandwich rule');
  r = await post('/leaves/validate-application', emp2.token, { leave_type: 'Casual Leave', dates: [iso(FRI), iso(MON2)] });
  check('validate counts Fri + Mon as 4 days with the weekend sandwiched', r.s === 200 && r.d.days?.days_count === 4 && r.d.days.sandwich_dates.join() === [SAT, SUN].join(), r.d?.days);
  check('validate explains the sandwiched days', r.d?.warnings?.some(w => w.type === 'sandwich') && r.d.days.breakdown.every(b => /Weekly off/.test(b.reason)), r.d);
  r = await post('/leaves/validate-application', emp2.token, { leave_type: 'Casual Leave', dates: ['not-a-date'] });
  check('validate rejects malformed input with 422', r.s === 422, r);
  r = await apply(emp2.token, 'Casual Leave', [FRI, MON2]);
  check('apply stores days_count 4 and the sandwich dates', r.s === 201 && r.d.days_count === 4 && r.d.sandwich_days === 2 && r.d.applied_days === 2, r.d);
  const sandwichId = r.d?.id;
  r = await act(admin, sandwichId, 'approve');
  check('approval deducts the sandwich-inclusive days (6 → 2)', r.s === 200 && (await balanceOf(emp2.email)).casual_leave === 2, await balanceOf(emp2.email));
  r = await apply(emp2.token, 'Earned Leave', [FRI, MON2]);
  check('same dates on another active leave are rejected (overlap)', r.s === 400 && r.d?.warning_type === 'overlap', r);
  r = await apply(emp.token, 'Earned Leave', [FRI, MON2], { force_submit: true });
  check('type without the sandwich rule counts only the selected days', r.s === 201 && r.d.days_count === 2 && r.d.sandwich_days === 0, r.d);
  r = await apply(emp.token, 'Casual Leave', [TUE2, THU2]);
  check('public holiday between leave days is sandwiched (3 days)', r.s === 201 && r.d.days_count === 3 && r.d.sandwich_dates[0] === WED2 && /Founders Day/.test(r.d.days_breakdown[0].reason), r.d);
  r = await apply(emp.token, 'Casual Leave', [MON3, WED3]);
  check('a working day in the gap means no sandwich (2 days)', r.s === 201 && r.d.days_count === 2, r.d);
  const editId = r.d?.id;
  r = await apply(sixer.token, 'Casual Leave', [FRI, MON2]);
  check("weekly offs come from the employee's shift (Saturday is a working day → 2 days)", r.s === 201 && r.d.days_count === 2, r.d);
  r = await apply(emp3.token, 'Sick Leave', [addDays(base, 21), addDays(base, 22)], { is_half_day: true, half_day_period: 'morning' });
  check('half-day application counts 0.5 per date', r.s === 201 && r.d.days_count === 1, r.d);
  r = await put(`/leaves/${editId}`, admin, { dates: [iso(addDays(base, 18)), iso(addDays(base, 21))] });
  check('admin edit recounts with the sandwich rule', r.s === 200 && r.d.days_count === 4 && r.d.sandwich_days === 2, r.d);
  r = await put(`/leaves/${editId}`, emp.token, { dates: [iso(FRI)] });
  check('employee cannot use the admin edit endpoint', r.s === 403, r);

  // ===================================================================== LV-4
  section('LV-4 Multi-level approvals and delegation');
  r = await get('/v2/leave/approval-settings', emp.token);
  check('default chain is manager → HR/admin', r.s === 200 && r.d.steps.map(s => s.approver_type).join() === 'manager,admin' && r.d.is_default, r.d);
  r = await put('/v2/leave/approval-settings', emp.token, { steps: [{ name: 'X', approver_type: 'admin' }] });
  check('employee cannot change the chain', r.s === 403, r);
  r = await put('/v2/leave/approval-settings', admin, { steps: [{ name: 'HR', approver_type: 'user' }] });
  check('user level without an approver email rejected', r.s === 422, r);
  r = await put('/v2/leave/approval-settings', admin, { steps: [{ name: 'HR', approver_type: 'admin', min_days: 3 }] });
  check('chain where no level always applies rejected', r.s === 400, r);
  r = await put('/v2/leave/approval-settings', admin, { steps: [{ name: 'Mgr', approver_type: 'manager' }, { name: 'Peer', approver_type: 'user', approver_email: emp2.email }] });
  check('an employee cannot be a named approver', r.s === 400, r);
  r = await put('/v2/leave/approval-settings', admin, {
    steps: [
      { name: 'Reporting manager', approver_type: 'manager', min_days: 0 },
      { name: 'HR', approver_type: 'admin', min_days: 0 },
      { name: 'HR head', approver_type: 'user', approver_email: hr.email, min_days: 3 }
    ],
    admin_override: false
  });
  check('admin saves a 3-level chain with an extra level over 3 days', r.s === 200 && r.d.steps.length === 3, r);

  await setBalance(emp.email, { earned_leave: 10 });
  r = await apply(emp.token, 'Earned Leave', range(addDays(base, 42), 2), { force_submit: true });
  check('short leave gets 2 levels (extra level skipped)', r.s === 201 && r.d.approval_chain.length === 2 && r.d.current_approver_email === mgr.email, r.d?.approval_chain);
  const shortId = r.d?.id;
  r = await apply(emp.token, 'Earned Leave', range(addDays(base, 49), 5), { force_submit: true });
  check('5-day leave gets the extra HR-head level', r.s === 201 && r.d.approval_chain.length === 3 && r.d.approval_chain[2].approver_email === hr.email, r.d?.approval_chain);
  const longId = r.d?.id;

  r = await act(emp2.token, longId, 'approve');
  check('employee cannot approve', r.s === 403, r);
  r = await act(mgr2.token, longId, 'approve');
  check("another department's manager cannot approve level 1", r.s === 403, r);
  r = await act(emp.token, longId, 'approve');
  check('applicant cannot approve their own leave', r.s === 403, r);
  r = await get('/leaves/pending', mgr.token);
  check('manager sees the leave waiting at their level', r.s === 200 && r.d.some(l => l.id === longId && l.can_act), r.d?.map?.(l => l.id));
  r = await act(mgr.token, longId, 'approve', 'ok from me');
  check('manager approves level 1 → manager_approved, now at HR', r.s === 200 && r.d.status === 'manager_approved' && r.d.current_level === 2, r.d);
  check('balance deducted at the first approval (10 → 5)', (await balanceOf(emp.email)).earned_leave === 5);
  r = await act(mgr.token, longId, 'approve');
  check('manager cannot act on the HR level', r.s === 403, r);
  r = await get('/leaves/pending', mgr.token);
  check('leave leaves the manager queue after their level', !r.d?.some?.(l => l.id === longId), r.d?.map?.(l => l.id));
  r = await act(admin, longId, 'approve');
  check('admin approves level 2 (strict mode) → still pending HR head', r.s === 200 && r.d.status === 'manager_approved' && r.d.current_level === 3, r.d);
  r = await act(admin, longId, 'approve');
  check('admin cannot approve the HR-head level without override', r.s === 403, r);
  r = await act(hr.token, longId, 'approve');
  check('HR head approves the final level → approved', r.s === 200 && r.d.status === 'approved' && r.d.approval_chain.every(s => s.status === 'approved'), r.d);
  check('approval history records every level', r.d?.approvals?.length === 3 && r.d.approvals.map(a => a.level).join() === '1,2,3', r.d?.approvals);
  r = await act(hr.token, longId, 'approve');
  check('acting on a finished leave is rejected', r.s === 400, r);

  r = await act(mgr.token, shortId, 'approve');
  r = await act(admin, shortId, 'reject', 'Busy period');
  check('rejecting at level 2 rejects the leave and cancels nothing pending', r.s === 200 && r.d.status === 'rejected' && r.d.approval_chain[1].status === 'rejected', r.d);
  check('rejection after a level was approved refunds the balance (5 → 5)', (await balanceOf(emp.email)).earned_leave === 5, await balanceOf(emp.email));

  // Delegation
  const until = addDays(today, 5);
  r = await post('/v2/leave/delegations', emp.token, { delegate_email: mgr2.email, start_date: today, end_date: until });
  check('employee cannot delegate', r.s === 403, r);
  r = await post('/v2/leave/delegations', mgr.token, { delegate_email: emp2.email, start_date: today, end_date: until });
  check('delegate must be a manager or admin', r.s === 400, r);
  r = await post('/v2/leave/delegations', mgr.token, { delegate_email: mgr.email, start_date: today, end_date: until });
  check('cannot delegate to yourself', r.s === 400, r);
  r = await post('/v2/leave/delegations', mgr.token, { delegate_email: mgr2.email, start_date: until, end_date: today });
  check('end before start rejected', r.s === 400, r);
  r = await post('/v2/leave/delegations', mgr.token, { delegate_email: mgr2.email, start_date: 'tomorrow', end_date: until });
  check('malformed date rejected', r.s === 422, r);
  r = await post('/v2/leave/delegations', mgr.token, { delegate_email: mgr2.email, start_date: today, end_date: until, reason: 'On leave' });
  check('manager delegates approvals to another manager', r.s === 201 && r.d.is_current, r);
  const delegationId = r.d?.id;
  r = await post('/v2/leave/delegations', mgr.token, { delegate_email: hr.email, start_date: addDays(today, 2), end_date: addDays(today, 9) });
  check('overlapping delegation rejected', r.s === 409, r);
  r = await get('/notifications', mgr2.token);
  check('delegate is notified', JSON.stringify(r.d).includes('leave_delegation'), r.d);

  r = await apply(emp.token, 'Earned Leave', range(addDays(base, 56), 2), { force_submit: true });
  const delegatedId = r.d?.id;
  r = await get('/leaves/pending', mgr2.token);
  const seen = r.d?.find?.(l => l.id === delegatedId);
  check('delegate sees the delegated leave with "on behalf of"', !!seen && seen.can_act && seen.on_behalf_of?.email === mgr.email, seen);
  r = await act(mgr2.token, delegatedId, 'approve', 'covering');
  check('delegate approves on behalf of the manager', r.s === 200 && r.d.status === 'manager_approved' && r.d.approvals[0].on_behalf_of_email === mgr.email && r.d.approval_chain[0].on_behalf_of_email === mgr.email, r.d);
  r = await get('/v2/leave/delegations', mgr2.token);
  check('delegate lists the delegation they received', r.s === 200 && r.d.some(d => d.id === delegationId), r.d);
  r = await del(`/v2/leave/delegations/${delegationId}`, mgr2.token);
  check('delegate cannot cancel the delegation', r.s === 403, r);
  r = await del(`/v2/leave/delegations/${delegationId}`, mgr.token);
  check('delegator cancels the delegation', r.s === 200, r);
  r = await apply(emp.token, 'Earned Leave', range(addDays(base, 63), 1), { force_submit: true });
  const afterCancelId = r.d?.id;
  r = await act(mgr2.token, afterCancelId, 'approve');
  check('after cancellation the former delegate cannot act', r.s === 403, r);

  r = await get('/notifications', mgr.token);
  check('manager notified of new applications', JSON.stringify(r.d).includes('leave_applied'), r.d);
  r = await get('/notifications', emp.token);
  check('employee notified at each step', JSON.stringify(r.d).includes('Leave Approved by'), r.d);

  // Manager's own leave: no manager above them → goes to HR
  await setBalance(mgr.email, { earned_leave: 10 });
  r = await apply(mgr.token, 'Earned Leave', range(addDays(base, 70), 1), { force_submit: true });
  check("manager's own leave skips the manager level", r.s === 201 && r.d.approval_chain[0].status === 'skipped' && r.d.current_approver_type === 'admin', r.d?.approval_chain);
  r = await act(mgr.token, r.d?.id, 'approve');
  check('manager cannot approve their own leave', r.s === 403, r);

  // Override on: an admin approval completes every level (original behaviour)
  r = await put('/v2/leave/approval-settings', admin, { steps: [{ name: 'Reporting manager', approver_type: 'manager' }, { name: 'HR / Admin', approver_type: 'admin' }], admin_override: true });
  check('restore the default chain with admin override', r.s === 200, r);
  r = await act(admin, afterCancelId, 'approve');
  check('admin override approves straight from pending', r.s === 200 && r.d.status === 'approved' && r.d.approval_chain.every(s => s.status === 'approved'), r.d);

  // Leaves created before approval chains
  const legacyId = `legacy-${Date.now()}`;
  const empDoc = await withDb(db => db.collection('employees').findOne({ email: emp2.email }));
  await withDb(db => db.collection('leaves').insertOne({
    id: legacyId, employee_id: empDoc.id, employee_name: empDoc.full_name, employee_email: emp2.email, manager_email: mgr.email,
    leave_type: 'Sick Leave', dates: [iso(addDays(base, 77))], days_count: 1, reason: 'legacy', is_half_day: false,
    status: 'pending', approvals: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }));
  r = await get('/leaves/pending', mgr.token);
  check('legacy leave (no chain) appears for its manager', r.d?.some?.(l => l.id === legacyId), r.d?.map?.(l => l.id));
  r = await act(mgr2.token, legacyId, 'approve');
  check("a manager with their own team (Sales) gets 403 on another team's legacy leave", r.s === 403, r);
  r = await get('/leaves/pending', mgr2.token);
  check("another team's manager does not see the legacy leave as pending", !r.d?.some?.(l => l.id === legacyId), r.d?.map?.(l => l.id));
  r = await act(mgr.token, legacyId, 'approve');
  check('manager approves a legacy leave → manager_approved', r.s === 200 && r.d.status === 'manager_approved', r.d);
  r = await act(admin, legacyId, 'approve');
  check('admin completes the legacy leave', r.s === 200 && r.d.status === 'approved', r.d);
  r = await get('/leaves/my-leaves', emp2.token);
  check('my-leaves returns an approval chain for every leave', r.s === 200 && r.d.every(l => Array.isArray(l.approval_chain)), r.d?.length);

  // ===================================================================== LV-5
  section("LV-5 Team calendar and who's out");
  const month = MON2.slice(0, 7);
  r = await get(`/v2/leave/team-calendar?month=${month}`, emp.token);
  const empEntries = r.d?.entries || [];
  check('employee sees approved leave of colleagues in their department', r.s === 200 && r.d.scope === 'employee' && empEntries.some(e => e.employee_name === emp2.name), r.d);
  check('employee view has no leave type, reason or email', empEntries.length > 0 && empEntries.every(e => !('leave_type' in e) && !('reason' in e) && !('employee_email' in e) && e.category), empEntries[0]);
  check('employee view hides other departments', !empEntries.some(e => e.employee_name === sales.name));
  check('calendar includes the month holidays', (r.d?.holidays || []).some(h => h.date === WED2) || WED2.slice(0, 7) !== month, r.d?.holidays);
  check('pending leave hidden by default', !empEntries.some(e => e.status === 'pending'), empEntries);
  r = await get(`/v2/leave/team-calendar?month=${month}&include_pending=true`, emp.token);
  check('include_pending shows pending leave too', r.d?.entries?.some(e => e.status === 'pending'), r.d?.entries);
  r = await get(`/v2/leave/team-calendar?month=${month}`, mgr.token);
  check('manager sees their team with the leave type', r.s === 200 && r.d.scope === 'manager' && r.d.entries.some(e => e.employee_email === emp2.email && e.leave_type === 'Casual Leave'), r.d?.entries);
  r = await get(`/v2/leave/team-calendar?month=${month}`, mgr2.token);
  check("another department's manager doesn't see Engineering", r.s === 200 && !r.d.entries.some(e => e.employee_email === emp2.email), r.d?.entries);
  r = await get(`/v2/leave/team-calendar?month=${month}`, admin);
  check('admin sees everyone and gets the department list', r.s === 200 && r.d.scope === 'admin' && r.d.departments.includes('Sales') && r.d.entries.some(e => e.employee_email === emp2.email), r.d?.departments);
  r = await get(`/v2/leave/team-calendar?month=${month}&department=Sales`, admin);
  check('admin department filter', r.s === 200 && !r.d.entries.some(e => e.department === 'Engineering'), r.d?.entries);
  r = await get('/v2/leave/team-calendar?month=2026-13', emp.token);
  check('invalid month falls back to the current month', r.s === 200 && r.d.month === today.slice(0, 7), r.d?.month);

  await setBalance(sales.email, { casual_leave: 6 });
  r = await apply(sales.token, 'Casual Leave', [today]);
  r = await act(admin, r.d?.id, 'approve');
  r = await apply(emp3.token, 'Casual Leave', [today]);
  r = await act(admin, r.d?.id, 'approve');
  r = await get('/v2/leave/whos-out-today', emp.token);
  check("who's out today shows a colleague out today", r.s === 200 && r.d.date === today && r.d.out.some(e => e.employee_name === emp3.name), r.d);
  check("who's out today for an employee hides other departments", !r.d?.out?.some(e => e.employee_name === sales.name), r.d?.out);
  r = await get('/v2/leave/whos-out-today', admin);
  check("admin's who's out includes every department", r.d?.out?.some(e => e.employee_name === sales.name) && r.d.out.some(e => e.employee_name === emp3.name), r.d?.out);
  r = await get('/v2/leave/whos-out-today');
  check('calendar requires login', r.s === 401, r);

  // ===================================================================== LV-1
  section('LV-1 Year-end carry-forward and encashment');
  const prevYear = currentYear - 1;
  // emp: EL 9 → carry 5 (cap), encash 4; SL 3 lapses; CL 2 lapses. Basic 26,000 → ₹1,000/day
  await setBalance(emp.email, { earned_leave: 9, sick_leave: 3, casual_leave: 2 });
  await setBalance(emp2.email, { earned_leave: 3, sick_leave: 1, casual_leave: 0 });
  await withDb(async db => {
    const e = await db.collection('employees').findOne({ email: emp.email });
    await db.collection('salary_structures').deleteMany({ employee_id: e.employee_id });
    await db.collection('salary_structures').insertOne({ employee_id: e.employee_id, basic_salary: 26000, components: [] });
    await db.collection('employees').updateOne({ email: emp2.email }, { $set: { monthly_salary: 52000 } });
  });

  const newbie = await createUser(admin, { role: 'employee', name: 'Nia Newbie', department: 'Engineering' }); // joined today
  await setBalance(newbie.email, { earned_leave: 7 });

  r = await get(`/v2/leave/year-end/preview?year=${prevYear}`, emp.token);
  check('employee cannot preview year-end', r.s === 403, r);
  r = await get(`/v2/leave/year-end/preview?year=${currentYear + 1}`, admin);
  check('future year preview rejected', r.s === 400, r);
  r = await get(`/v2/leave/year-end/preview?year=${prevYear}`, admin);
  const pv = r.d?.employees?.find(e => e.employee_email === emp.email);
  const pvEl = pv?.rows?.find(x => x.key === 'earned_leave');
  const pvSl = pv?.rows?.find(x => x.key === 'sick_leave');
  check('preview: EL 9 → carry 5, encash 4, lapse 0', pvEl?.carry === 5 && pvEl.encash === 4 && pvEl.lapse === 0, pvEl);
  check('preview: SL 3 lapses (no carry, no encash)', pvSl?.carry === 0 && pvSl.encash === 0 && pvSl.lapse === 3, pvSl);
  check('preview: encashment = 4 × 26,000 / 26 = ₹4,000 from the salary structure', pv?.totals?.amount === 4000 && pv.basic_source === 'salary_structure', pv?.totals);
  check('preview excludes employees who joined after the year', !r.d?.employees?.some(e => e.employee_email === newbie.email));
  check('preview skips per-occurrence types', !pv?.rows?.some(x => x.key === 'maternity_leave'), pv?.rows?.map(x => x.key));
  check('preview is a dry run (balance untouched)', (await balanceOf(emp.email)).earned_leave === 9);

  r = await post('/v2/leave/year-end/run', emp.token, { year: prevYear, force: true });
  check('employee cannot run year-end', r.s === 403, r);
  r = await post('/v2/leave/year-end/run', admin, { year: 'last' });
  check('run validates the year', r.s === 422, r);
  r = await post('/v2/leave/year-end/run', admin, { year: currentYear });
  check("can't close a year that hasn't ended", r.s === 400, r);
  r = await post('/v2/leave/year-end/run', admin, { year: prevYear - 1 });
  check('only the most recent year can be closed', r.s === 400, r);
  if (Number(today.slice(5, 7)) > 1) {
    r = await post('/v2/leave/year-end/run', admin, { year: prevYear });
    check('late run (after January) needs explicit force', r.s === 409 && r.d.requires_force === true, r);
  }
  r = await post('/v2/leave/year-end/run', admin, { year: prevYear, force: true });
  check('admin runs year-end', r.s === 200 && r.d.closed >= 2 && r.d.opening_applied >= 2, r.d);

  let bal = await balanceOf(emp.email);
  check('January opening: EL = 0 + 5 carried', bal.earned_leave === 5, bal);
  check('January opening: SL reset to 0.5, CL reset to 6 (nothing carried)', bal.sick_leave === 0.5 && bal.casual_leave === 6, bal);
  check('January opening: restricted holiday quota back to 2', bal.restricted_holiday === 2, bal);
  check('emp2: EL 3 fully carried', (await balanceOf(emp2.email)).earned_leave === 3);
  check('employees who joined after the closed year are left alone', (await balanceOf(newbie.email)).earned_leave === 7);

  const encashments = await withDb(db => db.collection('leave_encashments').find({ employee_email: emp.email, year: prevYear }).toArray());
  check('one pending encashment written per the contract', encashments.length === 1 && encashments[0].days === 4 && encashments[0].amount === 4000 &&
    encashments[0].status === 'pending' && encashments[0].payroll_run_id === null && encashments[0].leave_type === 'Earned Leave' && typeof encashments[0].employee_id === 'string', encashments[0]);
  const empDocAfter = await withDb(db => db.collection('employees').findOne({ email: emp.email }));
  check('employee_id on the encashment is the employee uuid', encashments[0]?.employee_id === empDocAfter.id);
  check('carry-forward stored on the employee', empDocAfter.leave_carry_forward?.year === currentYear && empDocAfter.leave_carry_forward.balances.earned_leave === 5, empDocAfter.leave_carry_forward);

  r = await post('/v2/leave/year-end/run', admin, { year: prevYear, force: true });
  check('running again is idempotent (nothing closed, nothing reset)', r.s === 200 && r.d.closed === 0 && r.d.opening_applied === 0, r.d);
  const encCount = await withDb(db => db.collection('leave_encashments').countDocuments({ year: prevYear }));
  check('no duplicate encashments', encCount === (await withDb(db => db.collection('leave_encashments').distinct('employee_id', { year: prevYear }))).length);
  check('balances unchanged by the second run', (await balanceOf(emp.email)).earned_leave === 5);

  r = await post('/admin/leave-credit/run-monthly', admin, { simulate_date: `${currentYear}-01-01` });
  check('legacy January reset is idempotent per year', r.s === 200 && r.d.results.processed === 0 && r.d.results.skipped.length >= 2, r.d?.results);
  r = await post('/admin/leave-credit/run-monthly', admin, { simulate_date: `${currentYear}-02-01` });
  check('February credit adds on top of the carry (EL 5 → 6)', r.s === 200 && (await balanceOf(emp.email)).earned_leave === 6, await balanceOf(emp.email));
  r = await post('/admin/leave-credit/run-monthly', admin, { simulate_date: `${currentYear}-02-01` });
  check('monthly credit is idempotent per month', r.s === 200 && r.d.results.processed === 0 && (await balanceOf(emp.email)).earned_leave === 6, r.d?.results);
  r = await post('/admin/leave-credit/run-monthly', admin, { simulate_date: 'garbage' });
  check('run-monthly rejects an invalid date', r.s === 400, r);

  r = await get(`/v2/leave/year-end/preview?year=${prevYear}`, admin);
  check('preview after the run shows employees as processed with recorded values', r.d?.processed_count >= 2 && r.d.employees.find(e => e.employee_email === emp.email)?.totals?.encash === 4, r.d?.processed_count);
  r = await get(`/v2/leave/year-end/logs?year=${prevYear}`, admin);
  check('year-end logs record each employee', r.s === 200 && r.d.some(l => l.employee_email === emp.email && l.rows.length > 0), r.d?.length);
  r = await get('/v2/leave/year-end/runs', admin);
  check('runs are logged', r.s === 200 && r.d.length >= 2 && r.d[0].status.startsWith('completed'), r.d?.[0]);
  r = await get(`/v2/leave/encashments?year=${prevYear}`, admin);
  check('admin lists encashments', r.s === 200 && r.d.some(e => e.employee_email === emp.email), r.d);
  r = await get('/v2/leave/encashments', emp.token);
  check('employee cannot list all encashments', r.s === 403, r);
  r = await get('/v2/leave/encashments/my', emp.token);
  check('employee sees their own encashment without salary details', r.s === 200 && r.d.length === 1 && !('basic_salary' in r.d[0]), r.d);
  r = await get('/v2/jobs', admin);
  check("cron job 'leave-year-end' is registered", r.s === 200 && r.d.some(j => j.name === 'leave-year-end' && j.module === 'leave'), r.d);
  r = await post('/v2/jobs/leave-year-end/run', admin);
  check('cron job runs (idempotent for an already closed year)', r.s === 200 && r.d.result.closed === 0, r.d);

  // ===================================================================== regression
  section('Regression: original leave endpoints');
  r = await get('/leaves/leave-policy', emp.token);
  check('GET leave-policy still works', r.s === 200 && Array.isArray(r.d.policies));
  r = await get('/leaves/calendar/me', emp.token);
  check('GET calendar/me still works', r.s === 200 && Array.isArray(r.d.events));
  r = await get('/leaves/all', emp.token);
  check('GET all is admin only', r.s === 403, r);
  r = await get('/leaves/pending', emp.token);
  check('GET pending is forbidden to employees', r.s === 403, r);
  r = await post('/leaves', emp.token, { leave_type: 'Casual Leave', dates: [], reason: 'x' });
  check('apply validates input', r.s === 422, r);
  await setBalance(emp2.email, { casual_leave: 1 });
  r = await apply(emp2.token, 'Casual Leave', [addDays(base, 84), addDays(base, 85)]);
  check('insufficient balance still rejected', r.s === 400 && /Insufficient/.test(r.d?.detail), r);
  await setBalance(emp2.email, { casual_leave: 5 });
  r = await apply(emp2.token, 'Casual Leave', [addDays(base, 84)]);
  const delId = r.d?.id;
  r = await act(admin, delId, 'approve');
  check('approve deducts (5 → 4)', (await balanceOf(emp2.email)).casual_leave === 4);
  r = await del(`/leaves/${delId}`, admin);
  check('delete refunds the balance (4 → 5)', r.s === 200 && (await balanceOf(emp2.email)).casual_leave === 5, r);
  r = await apply(emp2.token, 'Unpaid Leave', [addDays(base, 91), addDays(base, 92)]);
  check('unlimited leave needs no balance', r.s === 201, r);
  // RH is back at its quota of 2 after the January opening: adjust within the quota
  r = await post('/admin/leave-credit/leave-balance/update/' + emp.employee_id, admin, { action_type: 'deduct', leave_type: 'restricted_holiday', days: 1, reason: 'used offline' });
  r = await post('/admin/leave-credit/leave-balance/update/' + emp.employee_id, admin, { action_type: 'add', leave_type: 'restricted_holiday', days: 1, reason: 'bonus RH' });
  check('admin can adjust a policy-defined balance key', r.s === 200 && r.d.new_balance === 2, r.d);
  r = await post('/admin/leave-credit/leave-balance/update/' + emp.employee_id, admin, { action_type: 'add', leave_type: 'restricted_holiday', days: 1, reason: 'over quota' });
  check('a balance cannot be raised above the yearly quota plus carry-forward (RH max 2)', r.s === 400 && /at most 2/.test(r.d?.detail), r.d);
  r = await post('/admin/leave-credit/leave-balance/update/' + emp.employee_id, admin, { action_type: 'add', leave_type: 'made_up_leave', days: 1 });
  check('unknown balance key still rejected', r.s === 400, r);

  // ===================================================================== UAT fixes
  section('UAT fixes: weekly offs, holidays, comp-off, balances, rejection reason');

  // #7 Sandwich rule off: weekly offs (default shift is Mon–Fri) and holidays inside a range are skipped
  const RANGE = range(base, 14); // Mon .. Sun two weeks later, Founders Day (WED2) inside
  const nonWorking = RANGE.filter(k => weekday(k) === 0 || weekday(k) === 6 || k === WED2);
  r = await post('/leaves/validate-application', emp.token, { leave_type: 'Sick Leave', dates: RANGE.map(iso) });
  check('sandwich off: weekends and holidays in a range are not counted',
    r.s === 200 && r.d.days?.days_count === RANGE.length - nonWorking.length &&
    r.d.days.excluded_dates.map(e => e.date).join() === nonWorking.join() && r.d.warnings.some(w => w.type === 'non_working_days'), r.d?.days);
  r = await apply(emp.token, 'Sick Leave', [SUN]);
  check('a leave on a weekly off only is rejected', r.s === 400 && r.d?.warning_type === 'non_working_days', r);
  await setBalance(emp3.email, { sick_leave: 6 });
  const friToMon = [addDays(base, 102), addDays(base, 103), addDays(base, 104), addDays(base, 105)];
  r = await apply(emp3.token, 'Sick Leave', friToMon);
  const weekendId = r.d?.id;
  check('stored dates and days_count skip the weekend (Fri–Mon = 2 days)',
    r.s === 201 && r.d.days_count === 2 && r.d.dates.length === 2 &&
    !r.d.dates.some(d => [friToMon[1], friToMon[2]].includes(new Date(d).toISOString().slice(0, 10))), r.d);

  // #25 Rejection needs a reason
  r = await act(admin, weekendId, 'reject');
  check('reject without a reason is refused', r.s === 400 && /reason/i.test(r.d?.detail), r);
  r = await act(admin, weekendId, 'reject', '   ');
  check('a blank reason is refused too', r.s === 400, r);
  r = await act(admin, weekendId, 'reject', 'Team offsite');
  check('reject with a reason works', r.s === 200 && r.d.status === 'rejected', r);

  // #8 One holiday source: seeded copies (Date-typed, no id, one per organisation) collapse into one row
  const year = Number(today.slice(0, 4));
  const seededDay = `${year}-10-02`;
  await withDb(db => db.collection('holidays').insertMany([
    { organization_id: 'org-a', name: 'Gandhi Jayanti', date: new Date(`${seededDay}T00:00:00Z`), type: 'public' },
    { organization_id: 'org-b', name: 'Gandhi Jayanti', date: new Date(`${seededDay}T00:00:00Z`), type: 'public' }
  ]));
  r = await get(`/holidays?year=${year}`, emp.token);
  const gandhi = (r.d || []).filter(h => h.name === 'Gandhi Jayanti');
  check('the year filter finds seeded holidays, once each', r.s === 200 && gandhi.length === 1 && gandhi[0].date === seededDay && !!gandhi[0].id, gandhi);
  r = await get('/holidays', emp.token);
  check('the unfiltered list has no date + name duplicates', r.s === 200 && new Set(r.d.map(h => `${h.date}|${h.name}`)).size === r.d.length, r.d);
  const stored = await withDb(db => db.collection('holidays').find({ name: 'Gandhi Jayanti' }).toArray());
  check('the store keeps one row with a string date and an id', stored.length === 1 && stored[0].date === seededDay && !!stored[0].id, stored);
  r = await post('/leaves/validate-application', emp.token, { leave_type: 'Sick Leave', dates: [iso(seededDay)] });
  check('leave day count sees the repaired holiday', r.s === 200 && r.d.days?.days_count === 0 && /Gandhi Jayanti/.test(r.d.days.excluded_dates?.[0]?.reason || ''), r.d?.days);

  // #2 / #3 Employees without an employee code are found by email
  const noCode = await createUser(admin, { role: 'employee', name: 'Nia NoCode', department: 'Engineering', manager_email: mgr.email, joining_date: JOINED });
  await withDb(db => db.collection('employees').updateOne({ email: noCode.email }, { $set: { employee_id: '' }, $unset: { id: '' } }));
  r = await post('/comp-off/grant', admin, { employee_email: noCode.email, days: 1, work_date: addDays(today, -6), reason: 'Weekend release' });
  check('comp-off grant works by email for an employee without a code', r.s === 200 && r.d.new_balance === 1, r.d);
  check('the grant credits leave_balance.comp_off', (await balanceOf(noCode.email)).comp_off === 1, await balanceOf(noCode.email));
  r = await post('/comp-off/grant', admin, { days: 1, work_date: addDays(today, -5), reason: 'No one selected' });
  check('a grant without an employee is a clear 400 (not 422 "user_id" is required)', r.s === 400 && !/user_id/.test(r.d?.detail), r);
  r = await post(`/admin/leave-credit/leave-balance/update/${encodeURIComponent(noCode.email)}`, admin, { action_type: 'set', leave_type: 'casual_leave', days: 6, reason: 'UAT' });
  check('balance update by email works for an employee without a code', r.s === 200 && (await balanceOf(noCode.email)).casual_leave === 6, r.d);
  r = await post('/admin/leave-credit/leave-balance/update/undefined', admin, { action_type: 'set', leave_type: 'casual_leave', days: 6 });
  check('an unknown employee is still a 404', r.s === 404, r);

  // #9 Credits never leave a balance above quota + carry-forward; one Comp Off type
  await setBalance(noCode.email, { casual_leave: 15 });
  r = await post('/admin/leave-credit/run-monthly', admin, { simulate_date: `${today.slice(0, 7)}-01`, force: true });
  check('the monthly credit pulls an over-quota balance back to the quota (CL 15 → 6)', r.s === 200 && (await balanceOf(noCode.email)).casual_leave === 6, await balanceOf(noCode.email));
  r = await post('/leaves/leave-policy', admin, { ...POLICY, policies: [...POLICY.policies, { leave_type: 'Comp Off', annual_quota: 0, credit_type: 'annually' }, { leave_type: 'CompOff', annual_quota: 0, credit_type: 'annually' }] });
  check('"Comp Off" and "CompOff" are one leave type', r.s === 422 && /listed twice/.test(r.d?.detail), r.d);
});
