// Phase 8 — Assets & expenses (AS-1 asset management, AS-2 expense policy & travel)
import { createRequire } from 'node:module';
import { run, section, check, get, post, put, del, upload, bootstrap, createUser, withDb } from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const thisMonth = new Date().toISOString().slice(0, 10);
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const png = (field = 'bill_image', name = 'receipt.png') => ({ field, name, type: 'image/png', content: PNG });
const pdf = (field = 'bill_image', name = 'receipt.pdf') => ({ field, name, type: 'application/pdf', content: PDF });

await run(async () => {
  const admin = await bootstrap();
  const mgr = await createUser(admin, { role: 'manager', name: 'Maya Manager', department: 'Engineering' });
  const emp = await createUser(admin, { role: 'employee', name: 'Eli Employee', department: 'Engineering', manager_email: mgr.email });
  const finMgr = await createUser(admin, { role: 'manager', name: 'Fin Manager', department: 'Finance' });
  const emp2 = await createUser(admin, { role: 'employee', name: 'Fay Finance', department: 'Finance' });

  // ================= AS-1 =================
  section('AS-1 Asset categories');
  let r = await get('/v2/assets/categories', emp.token);
  check('built-in categories listed', r.s === 200 && r.d.length >= 10 && r.d.some(c => c.key === 'laptop') && r.d.some(c => c.key === 'access_card'), r);
  r = await post('/v2/assets/categories', emp.token, { label: 'Headset' });
  check('employee cannot add a category', r.s === 403, r);
  r = await post('/v2/assets/categories', admin, { label: 'Headset' });
  check('admin adds a custom category', r.s === 201 && r.d.key === 'headset', r);
  r = await post('/v2/assets/categories', admin, { label: 'headset' });
  check('duplicate category rejected', r.s === 409, r);
  r = await post('/v2/assets/categories', admin, { label: 'X' });
  check('too-short category name rejected', r.s === 422, r);
  r = await del('/v2/assets/categories/laptop', admin);
  check('built-in category cannot be deleted', r.s === 400, r);
  await post('/v2/assets/categories', admin, { label: 'Projector' });
  r = await del('/v2/assets/categories/projector', admin);
  check('unused custom category can be deleted', r.s === 200, r);

  section('AS-1 Asset register');
  r = await post('/v2/assets/items', admin, { asset_tag: 'LAP-001', category: 'laptop' });
  check('missing name rejected', r.s === 422, r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'LAP 001!', name: 'x', category: 'laptop' });
  check('invalid asset tag characters rejected', r.s === 422, r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'LAP-001', name: 'MacBook', category: 'spaceship' });
  check('unknown category rejected', r.s === 422, r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'LAP-001', name: 'MacBook', category: 'laptop', cost: -5 });
  check('negative cost rejected', r.s === 422, r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'LAP-001', name: 'MacBook', category: 'laptop', purchase_date: addDays(30) });
  check('future purchase date rejected', r.s === 422 && /future/.test(r.d?.detail), r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'LAP-001', name: 'MacBook', category: 'laptop', purchase_date: '2025-04-01', warranty_expiry: '2025-03-01' });
  check('warranty expiry before the purchase date rejected', r.s === 422 && /before the purchase/.test(r.d?.detail), r);
  r = await post('/v2/assets/items', emp.token, { asset_tag: 'LAP-001', name: 'MacBook', category: 'laptop' });
  check('employee cannot create assets', r.s === 403, r);
  r = await post('/v2/assets/items', admin, {
    asset_tag: 'LAP-001', name: 'MacBook Pro 14', category: 'Laptop', brand: 'Apple', model: 'M3', serial_number: 'SN-AAA-1',
    purchase_date: '2025-04-01', cost: 185000.456, vendor: 'Imagine', warranty_expiry: addDays(10), condition: 'new', location: 'HQ'
  });
  check('admin creates an asset (category by label, cost rounded)', r.s === 201 && r.d.category === 'laptop' && r.d.status === 'available' && r.d.cost === 185000.46 && !r.d.asset_tag_key, r);
  const lap = r.d;
  r = await put(`/v2/assets/items/${lap?.id}`, admin, { warranty_expiry: '2025-01-01' });
  check('update cannot move the warranty before the stored purchase date', r.s === 422, r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'lap-001', name: 'Dup', category: 'laptop' });
  check('asset tag unique (case-insensitive)', r.s === 409, r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'LAP-002', name: 'Dup serial', category: 'laptop', serial_number: 'sn-aaa-1' });
  check('serial number unique', r.s === 409, r);
  r = await post('/v2/assets/items', admin, { asset_tag: 'MON-001', name: 'Dell 27"', category: 'monitor', cost: 22000 });
  check('asset without serial number', r.s === 201, r);
  const mon = r.d;
  r = await post('/v2/assets/items', admin, { asset_tag: 'MON-002', name: 'Dell 24"', category: 'monitor' });
  check('second asset without serial (sparse unique index)', r.s === 201, r);
  const mon2 = r.d;
  r = await post('/v2/assets/items', admin, { asset_tag: 'HS-001', name: 'Jabra', category: 'headset' });
  check('asset in a custom category', r.s === 201 && r.d.category === 'headset', r);
  r = await del('/v2/assets/categories/headset', admin);
  check('category in use cannot be deleted', r.s === 400, r);
  r = await get('/v2/assets/items', emp.token);
  check('employee cannot list the register', r.s === 403, r);
  r = await get('/v2/assets/items?category=monitor', admin);
  check('filter by category', r.s === 200 && r.d.length === 2 && r.d.every(a => a.category === 'monitor'), r.d);
  r = await get('/v2/assets/items?q=macbook', admin);
  check('search by name', r.s === 200 && r.d.length === 1 && r.d[0].asset_tag === 'LAP-001', r.d);
  r = await get('/v2/assets/items?warranty=expiring', admin);
  check('filter warranty expiring in 30 days', r.s === 200 && r.d.some(a => a.id === lap.id), r.d);
  r = await put(`/v2/assets/items/${mon.id}`, admin, { location: 'Floor 2', notes: 'Spare' });
  check('update asset', r.s === 200 && r.d.location === 'Floor 2', r);
  r = await put(`/v2/assets/items/${mon.id}`, admin, { asset_tag: 'LAP-001' });
  check('update to an existing tag rejected', r.s === 409, r);
  r = await put(`/v2/assets/items/${mon.id}`, admin, {});
  check('empty update rejected', r.s === 422, r);
  r = await put(`/v2/assets/items/${mon.id}`, emp.token, { location: 'Home' });
  check('employee cannot update assets', r.s === 403, r);
  r = await upload(`/v2/assets/items/${lap.id}/invoice`, admin, [pdf('invoice', 'invoice.pdf')]);
  check('upload invoice PDF', r.s === 200 && /\/uploads\/asset_invoices\//.test(r.d.invoice_url), r);
  r = await upload(`/v2/assets/items/${lap.id}/invoice`, admin, [{ field: 'invoice', name: 'x.txt', type: 'text/plain', content: 'hello' }]);
  check('invoice must be an image or PDF', r.s === 400, r);
  r = await upload(`/v2/assets/items/${lap.id}/invoice`, emp.token, [pdf('invoice')]);
  check('employee cannot upload invoices', r.s === 403, r);
  r = await get('/v2/assets/items/does-not-exist', admin);
  check('unknown asset → 404', r.s === 404, r);
  const stored = await withDb(db => db.collection('assets').findOne({ id: lap.id }));
  check('assets contract fields present', stored && ['id', 'asset_tag', 'name', 'category', 'status'].every(k => k in stored) && 'assigned_to_uid' in stored && 'assigned_to_email' in stored, stored);

  section('AS-1 Assignment, acknowledgement and return');
  r = await post(`/v2/assets/items/${lap.id}/assign`, admin, { employee: 'nobody@example.com' });
  check('assign to unknown employee → 404', r.s === 404, r);
  r = await post(`/v2/assets/items/${lap.id}/assign`, admin, { employee: emp.email, expected_return_date: addDays(-3) });
  check('expected return date in the past rejected', r.s === 422, r);
  r = await post(`/v2/assets/items/${lap.id}/assign`, mgr.token, { employee: emp.email });
  check('manager cannot assign assets', r.s === 403, r);
  r = await post(`/v2/assets/items/${lap.id}/assign`, admin, { employee: emp.email, expected_return_date: addDays(365), condition: 'new', notes: 'With charger' });
  check('assign laptop to employee', r.s === 201 && r.d.asset.status === 'assigned' && r.d.asset.assigned_to_email === emp.email && r.d.assignment.condition_at_handover === 'new', r);
  check('assigned_to_uid is the employee code', r.d?.asset?.assigned_to_uid === emp.employee_id, { uid: r.d?.asset?.assigned_to_uid, emp: emp.employee_id });
  r = await post(`/v2/assets/items/${lap.id}/assign`, admin, { employee: emp2.email });
  check('cannot assign an already assigned asset', r.s === 400, r);
  r = await get(`/v2/assets/items/${lap.id}`, emp.token);
  check('assignee can view the asset without cost/invoice', r.s === 200 && r.d.cost === undefined && r.d.invoice_url === undefined && r.d.assignments.length === 1, r.d);
  r = await get(`/v2/assets/items/${lap.id}`, emp2.token);
  check('other employee cannot view the asset', r.s === 403, r);
  r = await get('/v2/assets/my-assets', emp.token);
  check('My Assets lists the laptop with its assignment', r.s === 200 && r.d.assets.length === 1 && r.d.assets[0].assignment?.handover_notes === 'With charger' && !r.d.assets[0].acknowledged_at, r.d);
  r = await post(`/v2/assets/items/${lap.id}/acknowledge`, emp2.token);
  check('only the assignee can acknowledge', r.s === 403, r);
  r = await post(`/v2/assets/items/${lap.id}/acknowledge`, emp.token);
  check('assignee acknowledges receipt', r.s === 200 && r.d.acknowledged_at, r);
  r = await post(`/v2/assets/items/${lap.id}/acknowledge`, emp.token);
  check('cannot acknowledge twice', r.s === 400, r);
  const notes = await withDb(db => db.collection('notifications').find({ user_email: emp.email, type: 'asset_assigned' }).toArray());
  check('employee notified of assignment', notes.length >= 1, notes.length);
  r = await get(`/v2/assets/employees/${encodeURIComponent(emp.email)}/assets`, admin);
  check('offboarding: assets currently with employee (by email)', r.s === 200 && r.d.count === 1 && r.d.pending_return && r.d.assets[0].id === lap.id, r.d);
  r = await get(`/v2/assets/employees/${emp.employee_id}/assets`, admin);
  check('offboarding: lookup by employee code', r.s === 200 && r.d.count === 1, r.d);
  r = await get(`/v2/assets/employees/${emp.employee_id}/assets`, mgr.token);
  check('offboarding lookup is admin-only', r.s === 403, r);
  r = await post(`/v2/assets/items/${lap.id}/status`, admin, { status: 'retired' });
  check('cannot retire an assigned asset', r.s === 400, r);
  r = await post(`/v2/assets/items/${lap.id}/return`, admin, { notes: 'x' });
  check('return requires a condition', r.s === 422, r);

  section('AS-1 Issue reports and repair');
  r = await post(`/v2/assets/items/${lap.id}/issues`, emp2.token, { description: 'Screen flickers a lot' });
  check('non-assignee cannot report an issue', r.s === 403, r);
  r = await post(`/v2/assets/items/${lap.id}/issues`, emp.token, { description: 'bad' });
  check('issue description too short', r.s === 422, r);
  r = await post(`/v2/assets/items/${lap.id}/issues`, emp.token, { description: 'Screen flickers when charging', severity: 'high' });
  check('assignee reports an issue', r.s === 201 && r.d.status === 'open', r);
  const issue = r.d;
  r = await post(`/v2/assets/items/${lap.id}/issues`, emp.token, { description: 'Another open issue here' });
  check('one open issue per asset per reporter', r.s === 400, r);
  r = await get('/v2/assets/issues', emp2.token);
  check('employees only see their own issues', r.s === 200 && r.d.length === 0, r.d);
  r = await put(`/v2/assets/issues/${issue.id}`, emp.token, { status: 'resolved' });
  check('employee cannot update issue status', r.s === 403, r);
  r = await put(`/v2/assets/issues/${issue.id}`, admin, { status: 'in_repair', notes: 'Sent to service centre' });
  check('admin moves issue to repair', r.s === 200 && r.d.status === 'in_repair', r);
  r = await get(`/v2/assets/items/${lap.id}`, admin);
  check('asset is in_repair and still assigned', r.d?.status === 'in_repair' && r.d.assigned_to_email === emp.email, r.d);
  r = await put(`/v2/assets/issues/${issue.id}`, admin, { status: 'resolved', notes: 'Panel replaced' });
  check('resolving the issue returns the asset to its assignee', r.s === 200 && r.d.status === 'resolved', r);
  r = await get(`/v2/assets/items/${lap.id}`, admin);
  check('asset back to assigned', r.d?.status === 'assigned', r.d?.status);
  r = await put(`/v2/assets/issues/${issue.id}`, admin, { status: 'closed' });
  check('resolved issue cannot change again', r.s === 400, r);
  r = await post(`/v2/assets/items/${mon.id}/status`, admin, { status: 'in_repair', notes: 'Dead pixel' });
  check('admin sends an available asset to repair', r.s === 200 && r.d.status === 'in_repair', r);
  r = await post(`/v2/assets/items/${mon.id}/status`, admin, { status: 'available' });
  check('and back to available', r.s === 200 && r.d.status === 'available', r);
  r = await post(`/v2/assets/items/${mon.id}/status`, admin, { status: 'assigned' });
  check('status endpoint cannot set assigned directly', r.s === 422, r);

  r = await post(`/v2/assets/items/${lap.id}/return`, admin, { condition: 'good', notes: 'Returned on exit' });
  check('return the laptop', r.s === 200 && r.d.status === 'available' && r.d.assigned_to_email === null && r.d.condition === 'good', r);
  r = await post(`/v2/assets/items/${lap.id}/return`, admin, { condition: 'good' });
  check('cannot return an unassigned asset', r.s === 400, r);
  r = await get(`/v2/assets/items/${lap.id}`, admin);
  const actions = (r.d?.history || []).map(h => h.action);
  check('history records the full lifecycle', ['created', 'invoice_uploaded', 'assigned', 'acknowledged', 'issue_reported', 'status_changed', 'returned'].every(a => actions.includes(a)), actions);
  check('assignment closed with return details', r.d?.assignments?.[0]?.status === 'returned' && r.d.assignments[0].return_condition === 'good' && r.d.assignments[0].acknowledged_at, r.d?.assignments);
  r = await get('/v2/assets/my-assets', emp.token);
  check('My Assets: nothing held, past assignment listed', r.d?.assets.length === 0 && r.d.past_assignments.length === 1, r.d);
  r = await get(`/v2/assets/items/${lap.id}`, emp.token);
  check('former assignee can no longer view the asset', r.s === 403, r);
  r = await del(`/v2/assets/items/${lap.id}`, admin);
  check('asset with assignment history cannot be deleted', r.s === 400, r);
  r = await del(`/v2/assets/items/${mon2.id}`, admin);
  check('fresh asset can be deleted', r.s === 200, r);
  r = await post(`/v2/assets/items/${mon.id}/assign`, admin, { employee: emp2.email });
  await post(`/v2/assets/items/${mon.id}/status`, admin, { status: 'lost', notes: 'Left in cab' });
  r = await get(`/v2/assets/items/${mon.id}`, admin);
  check('marking an assigned asset lost closes the assignment', r.d?.status === 'lost' && r.d.assigned_to_email === null && r.d.assignments[0].status === 'lost', r.d);

  section('AS-1 Asset requests');
  r = await post('/v2/assets/requests', emp.token, { category: 'laptop', justification: 'short' });
  check('justification too short rejected', r.s === 422, r);
  r = await post('/v2/assets/requests', emp.token, { category: 'hovercraft', justification: 'Need it to get to work faster' });
  check('unknown category rejected', r.s === 422, r);
  r = await post('/v2/assets/requests', emp.token, { category: 'laptop', justification: 'Current laptop is too slow for builds', needed_by: addDays(7) });
  check('employee raises an asset request', r.s === 201 && r.d.status === 'pending', r);
  const req1 = r.d;
  r = await post('/v2/assets/requests', emp.token, { category: 'laptop', justification: 'Another laptop request please' });
  check('duplicate open request for the same category rejected', r.s === 400, r);
  r = await get('/v2/assets/requests', emp2.token);
  check('other employees do not see the request', r.s === 200 && !r.d.some(x => x.id === req1.id), r.d);
  r = await get('/v2/assets/requests?status=pending', admin);
  check('admin sees pending requests', r.s === 200 && r.d.some(x => x.id === req1.id), r.d);
  r = await post(`/v2/assets/requests/${req1.id}/approve`, mgr.token, {});
  check('manager cannot approve asset requests', r.s === 403, r);
  r = await post(`/v2/assets/requests/${req1.id}/approve`, admin, { comments: 'OK' });
  check('admin approves the request', r.s === 200 && r.d.status === 'approved', r);
  r = await post(`/v2/assets/requests/${req1.id}/fulfil`, admin, { asset_id: mon.id });
  check('cannot fulfil with an unavailable asset', r.s === 400, r);
  r = await post(`/v2/assets/requests/${req1.id}/fulfil`, admin, { asset_id: lap.id, expected_return_date: addDays(200), condition: 'good' });
  check('fulfil by assigning the laptop', r.s === 200 && r.d.request.status === 'fulfilled' && r.d.assignment.request_id === req1.id, r);
  r = await get(`/v2/assets/items/${lap.id}`, admin);
  check('laptop now assigned to the requester', r.d?.assigned_to_email === emp.email, r.d?.assigned_to_email);
  r = await post(`/v2/assets/requests/${req1.id}/reject`, admin, { comments: 'Too late' });
  check('cannot reject a fulfilled request', r.s === 400, r);
  r = await post('/v2/assets/requests', emp2.token, { category: 'phone', justification: 'On-call rotation needs a work phone' });
  const req2 = r.d;
  r = await post(`/v2/assets/requests/${req2.id}/reject`, admin, {});
  check('rejection requires comments', r.s === 422, r);
  r = await post(`/v2/assets/requests/${req2.id}/reject`, admin, { comments: 'Use the shared on-call phone' });
  check('admin rejects with comments', r.s === 200 && r.d.status === 'rejected', r);
  r = await post('/v2/assets/requests', emp2.token, { category: 'tablet', justification: 'For field demos with customers' });
  const req3 = r.d;
  r = await del(`/v2/assets/requests/${req3.id}`, emp.token);
  check('cannot cancel someone else\'s request', r.s === 403, r);
  r = await del(`/v2/assets/requests/${req3.id}`, emp2.token);
  check('employee cancels own pending request', r.s === 200, r);

  section('AS-1 CSV bulk import');
  const csv = [
    'Asset Tag,Name,Category,Brand,Serial Number,Purchase Date,Cost,Warranty Expiry,Condition,Status',
    'PH-001,iPhone 15,Phone,Apple,IMEI-1,2025-01-10,"79,900",2026-01-10,new,available',
    'PH-002,Pixel 8,telescope,Google,IMEI-2,2025-01-10,60000,,good,available',
    'LAP-001,Duplicate tag,laptop,,,,,,,',
    'PH-003,Galaxy,phone,Samsung,IMEI-1,,,,,',
    'PH-004,Nokia,phone,,,not-a-date,abc,,broken,assigned',
    'ID-001,"ID card, ""blue""",ID card,,,,,,,'
  ].join('\n');
  const csvFile = { field: 'file', name: 'assets.csv', type: 'text/csv', content: csv };
  r = await upload('/v2/assets/items/import', admin, [csvFile], { dry_run: 'true' });
  check('dry run validates without inserting', r.s === 200 && r.d.dry_run && r.d.valid === 2 && r.d.created === 0 && r.d.failed === 4, r.d);
  const errs = r.d?.errors || [];
  check('errors reported per row with spreadsheet row numbers', errs.find(e => e.row === 3)?.errors.some(m => /Unknown category/.test(m))
    && errs.find(e => e.row === 4)?.errors.some(m => /already exists/.test(m))
    && errs.find(e => e.row === 5)?.errors.some(m => /Serial number/.test(m))
    && errs.find(e => e.row === 6)?.errors.length >= 3, errs);
  r = await get('/v2/assets/items?q=PH-001', admin);
  check('dry run inserted nothing', r.d?.length === 0, r.d);
  r = await upload('/v2/assets/items/import', admin, [csvFile]);
  check('import creates the valid rows', r.s === 200 && r.d.created === 2 && r.d.failed === 4, r.d);
  r = await get('/v2/assets/items?q=PH-001', admin);
  check('imported asset has parsed cost and category', r.d?.[0]?.cost === 79900 && r.d[0].category === 'phone' && r.d[0].source === 'import', r.d);
  r = await get('/v2/assets/items?q=ID-001', admin);
  check('quoted CSV fields parsed', r.d?.[0]?.name === 'ID card, "blue"' && r.d[0].category === 'id_card', r.d);
  r = await upload('/v2/assets/items/import', admin, [csvFile]);
  check('re-importing reports all rows as duplicates', r.s === 200 && r.d.created === 0 && r.d.failed === 6, r.d);
  r = await upload('/v2/assets/items/import', admin, [{ field: 'file', name: 'a.csv', type: 'text/csv', content: 'foo,bar\n1,2' }]);
  check('missing required columns rejected', r.s === 400 && /asset_tag/.test(r.d.detail), r);
  r = await upload('/v2/assets/items/import', admin, [{ field: 'file', name: 'a.png', type: 'image/png', content: PNG }]);
  check('non-CSV upload rejected', r.s === 400, r);
  r = await upload('/v2/assets/items/import', emp.token, [csvFile]);
  check('employee cannot import', r.s === 403, r);

  section('AS-1 Warranty alerts and dashboard');
  r = await post('/v2/jobs/asset-warranty-alerts/run', admin);
  check('warranty job alerts on the laptop', r.s === 200 && r.d.result.alerted >= 1 && r.d.result.assets.includes('LAP-001'), r);
  const alerts = await withDb(db => db.collection('notifications').find({ user_email: 'admin@example.com', type: 'asset_warranty_expiring' }).toArray());
  check('admin received a warranty notification', alerts.length >= 1 && /LAP-001/.test(alerts[0].message), alerts.length);
  r = await post('/v2/jobs/asset-warranty-alerts/run', admin);
  check('same expiry is not alerted twice', r.s === 200 && r.d.result.alerted === 0, r.d);
  r = await put(`/v2/assets/items/${lap.id}`, admin, { warranty_expiry: addDays(20) });
  r = await post('/v2/jobs/asset-warranty-alerts/run', admin);
  check('a changed expiry date is alerted again', r.s === 200 && r.d.result.alerted === 1, r.d);
  r = await post('/v2/jobs/asset-warranty-alerts/run', emp.token);
  check('employees cannot run jobs', r.s === 403, r);
  r = await get('/v2/assets/summary', admin);
  check('dashboard summary counts by status', r.s === 200 && r.d.by_status.assigned === 1 && r.d.by_status.lost === 1 && r.d.total >= 5 && r.d.warranty_expiring_30d >= 1 && typeof r.d.open_requests === 'number', r.d);
  check('summary counts unacknowledged assignments', r.d?.unacknowledged === 1, r.d);
  r = await get('/v2/assets/summary', emp.token);
  check('summary is admin-only', r.s === 403, r);

  // ================= AS-2 =================
  section('AS-2 Expense policies');
  r = await post('/v2/assets/expense-policies', emp.token, { category: 'Food & Meals', max_per_claim: 1000 });
  check('employee cannot create a policy', r.s === 403, r);
  r = await post('/v2/assets/expense-policies', admin, { category: 'Food & Meals', max_per_claim: 2000, monthly_cap: 1000 });
  check('per-claim limit above monthly cap rejected', r.s === 422, r);
  r = await post('/v2/assets/expense-policies', admin, { category: 'Food & Meals', enforcement: 'maybe' });
  check('invalid enforcement rejected', r.s === 422, r);
  r = await post('/v2/assets/expense-policies', admin, { category: 'Food & Meals', max_per_claim: 1000, monthly_cap: 1500, receipt_required_above: 500, enforcement: 'soft' });
  check('create soft policy', r.s === 201 && r.d.enforcement === 'soft' && r.d.active === true, r);
  const foodPolicy = r.d;
  r = await post('/v2/assets/expense-policies', admin, { category: 'food & meals' });
  check('one policy per category', r.s === 409, r);
  r = await post('/v2/assets/expense-policies', admin, { category: 'Office Supplies', max_per_claim: 2000, receipt_required_above: 0, enforcement: 'hard' });
  check('create hard policy', r.s === 201, r);
  r = await post('/v2/assets/expense-policies', admin, { category: 'Equipment', allowed_roles: ['manager'], enforcement: 'hard' });
  check('create role-restricted policy', r.s === 201, r);
  r = await post('/v2/assets/expense-policies', admin, { category: 'Training & Courses', allowed_departments: ['Sales'], enforcement: 'soft' });
  check('create department-restricted policy', r.s === 201, r);
  r = await get('/v2/assets/expense-policies', emp.token);
  check('employees can read active policies', r.s === 200 && r.d.length === 4, r.d);
  r = await put(`/v2/assets/expense-policies/${foodPolicy.id}`, admin, { description: 'Meals while working late' });
  check('update policy', r.s === 200 && r.d.description === 'Meals while working late', r);
  r = await get('/v2/assets/expense-categories', emp.token);
  check('expense categories include defaults', r.s === 200 && r.d.includes('Travel') && r.d.includes('Food & Meals'), r.d);

  section('AS-2 Policy check and enforcement on claims');
  r = await post('/v2/assets/expense-policies/check', emp.token, { category: 'Office Supplies', amount: 2500, expense_date: thisMonth });
  check('pre-submit check: hard limit → blocked', r.s === 200 && r.d.status === 'blocked' && r.d.violations.some(v => v.code === 'max_per_claim') && r.d.violations.some(v => v.code === 'receipt_required'), r.d);
  r = await post('/v2/assets/expense-policies/check', emp.token, { category: 'Medical', amount: 99999 });
  check('no policy → ok', r.s === 200 && r.d.status === 'ok' && r.d.has_policy === false, r.d);
  r = await post('/v2/assets/expense-policies/check', emp.token, { category: 'Medical', amount: -5 });
  check('check validates amount', r.s === 422, r);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Printer paper', category: 'Office Supplies', amount: '2500', expense_date: thisMonth });
  check('hard policy blocks an over-limit claim', r.s === 400 && r.d.policy_check?.status === 'blocked', r);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Printer paper', category: 'Office Supplies', amount: '1500', expense_date: thisMonth });
  check('hard policy blocks a claim without the required receipt', r.s === 400 && r.d.policy_check?.violations.some(v => v.code === 'receipt_required'), r);
  r = await upload('/reimbursements/apply', emp.token, [png()], { title: 'Printer paper', category: 'Office Supplies', amount: '1500', expense_date: thisMonth });
  check('compliant claim with receipt accepted', r.s === 200 && r.d.reimbursement.policy_check.status === 'ok' && !r.d.reimbursement.policy_flagged && /\/uploads\/reimbursements\//.test(r.d.reimbursement.bill_url), r);
  const officeClaim = r.d.reimbursement;
  r = await upload(`/reimbursements/${officeClaim.id}`, emp.token, [], { amount: '3000' }, 'PUT');
  check('edit re-checks policy and blocks', r.s === 400 && r.d.policy_check?.status === 'blocked', r);
  r = await upload(`/reimbursements/${officeClaim.id}`, emp.token, [], { remove_bill: 'true' }, 'PUT');
  check('removing a required receipt is blocked', r.s === 400, r);
  r = await upload(`/reimbursements/${officeClaim.id}`, emp.token, [], { amount: '1800', description: 'A4 reams' }, 'PUT');
  check('compliant edit saved', r.s === 200 && r.d.reimbursement.amount === 1800 && r.d.reimbursement.bill_url, r);

  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Team lunch', category: 'Food & Meals', amount: '400', expense_date: thisMonth });
  check('within soft policy → ok', r.s === 200 && r.d.reimbursement.policy_check.status === 'ok', r);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Client dinner', category: 'Food & Meals', amount: '1200', expense_date: thisMonth });
  const soft = r.d?.reimbursement;
  const codes = soft?.policy_check?.violations.map(v => v.code) || [];
  check('soft policy accepts but flags the claim', r.s === 200 && soft.policy_flagged === true && soft.policy_check.status === 'warning', r);
  check('flag lists per-claim, monthly cap and receipt violations', ['max_per_claim', 'monthly_cap', 'receipt_required'].every(c => codes.includes(c)), codes);
  check('monthly usage reported', soft?.policy_check?.month_to_date === 400, soft?.policy_check);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'New keyboard', category: 'Equipment', amount: '3000' });
  check('role-restricted category blocked for employees', r.s === 400 && r.d.policy_check.violations[0].code === 'role_not_allowed', r);
  r = await upload('/reimbursements/apply', mgr.token, [], { title: 'New keyboard', category: 'Equipment', amount: '3000' });
  check('allowed role can claim', r.s === 200 && r.d.reimbursement.policy_check.status === 'ok', r);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Sales course', category: 'Training & Courses', amount: '5000' });
  check('department restriction flags (soft)', r.s === 200 && r.d.reimbursement.policy_check.violations[0].code === 'department_not_allowed', r);
  r = await get(`/v2/assets/expense-policies/check/${soft.id}`, admin);
  check('approver can re-run the check', r.s === 200 && r.d.current.status === 'warning' && r.d.at_submission.status === 'warning', r.d);
  r = await get(`/v2/assets/expense-policies/check/${soft.id}`, emp2.token);
  check('other employees cannot see a claim\'s check', r.s === 403, r);
  r = await post('/v2/assets/expense-policies/check', emp.token, { category: 'Food & Meals', amount: 100, reimbursement_id: soft.id });
  check('check while editing excludes the claim itself', r.s === 200 && r.d.month_to_date === 400, r.d);
  r = await get('/reimbursements/all', admin);
  check('admin list carries policy flags', r.s === 200 && r.d.find(x => x.id === soft.id)?.policy_flagged === true, r.d?.length);

  section('AS-2 Receipt uploads');
  r = await upload('/reimbursements/apply', emp.token, [pdf()], { title: 'Taxi', category: 'Travel', amount: '350' });
  check('PDF receipt accepted', r.s === 200 && r.d.reimbursement.bill_type === 'application/pdf', r);
  const pdfClaim = r.d.reimbursement;
  r = await upload('/reimbursements/apply', emp.token, [{ field: 'bill_image', name: 'r.txt', type: 'text/plain', content: 'x' }], { title: 'Taxi', category: 'Travel', amount: '350' });
  check('non image/PDF receipt rejected', r.s === 400, r);
  r = await upload('/reimbursements/apply', emp.token, [{ field: 'bill_image', name: 'big.pdf', type: 'application/pdf', content: Buffer.alloc(10 * 1024 * 1024 + 10) }], { title: 'Taxi', category: 'Travel', amount: '350' });
  check('receipt over 10 MB rejected', r.s === 400 && /10 MB/.test(r.d.detail), r);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Taxi', category: 'Travel', amount: '0' });
  check('zero amount still rejected (backward compatible)', r.s === 400 && r.d.detail === 'Invalid amount', r);
  r = await upload('/reimbursements/apply', emp.token, [], { category: 'Travel', amount: '10' });
  check('missing title still rejected', r.s === 400, r);
  r = await upload(`/reimbursements/${pdfClaim.id}`, emp.token, [png()], {}, 'PUT');
  check('replace receipt on edit', r.s === 200 && r.d.reimbursement.bill_type === 'image/png' && r.d.reimbursement.bill_url !== pdfClaim.bill_url, r);
  r = await del(`/reimbursements/${pdfClaim.id}`, emp.token);
  check('delete claim with receipt', r.s === 200, r);
  await withDb(db => db.collection('reimbursements').insertOne({
    id: 'legacy-1', employee_id: emp.employee_id, employee_email: emp.email, employee_name: 'Eli', title: 'Old claim', category: 'Travel',
    amount: 100, description: '', expense_date: '2026-01-05T00:00:00.000Z', bill_url: null, status: 'pending', created_at: '2026-01-05T00:00:00.000Z'
  }));
  r = await get('/reimbursements/my', emp.token);
  check('legacy claims without policy fields still listed', r.s === 200 && r.d.some(x => x.id === 'legacy-1'), r.d?.length);
  r = await upload('/reimbursements/legacy-1', emp.token, [], { title: 'Old claim (edited)' }, 'PUT');
  check('legacy claim can be edited', r.s === 200 && r.d.reimbursement.title === 'Old claim (edited)' && r.d.reimbursement.policy_check, r);

  section('AS-2 Per-diem rates');
  r = await get('/v2/assets/per-diem', emp.token);
  check('default per-diem config', r.s === 200 && r.d.rates.tier_1 > 0 && r.d.cities.some(c => c.city === 'Mumbai'), r.d);
  r = await put('/v2/assets/per-diem', emp.token, { default_tier: 'tier_2' });
  check('employee cannot change per-diem', r.s === 403, r);
  r = await put('/v2/assets/per-diem', admin, { rates: { tier_1: 3000, tier_2: 2000 } });
  check('all three tier rates required', r.s === 422, r);
  r = await put('/v2/assets/per-diem', admin, { cities: [{ city: 'Pune', tier: 'tier_2' }, { city: 'pune', tier: 'tier_1' }] });
  check('duplicate cities rejected', r.s === 422, r);
  r = await put('/v2/assets/per-diem', admin, {
    rates: { tier_1: 3000, tier_2: 2000, tier_3: 1000 }, default_tier: 'tier_3',
    cities: [{ city: 'Mumbai', tier: 'tier_1' }, { city: 'Pune', tier: 'tier_2' }]
  });
  check('admin updates rates and city tiers', r.s === 200 && r.d.rates.tier_1 === 3000 && r.d.cities.length === 2, r);
  r = await get(`/v2/assets/per-diem/calculate?city=mumbai&start_date=${addDays(10)}&end_date=${addDays(12)}`, emp.token);
  check('per-diem: 3 days in a tier-1 city', r.s === 200 && r.d.tier === 'tier_1' && r.d.days === 3 && r.d.amount === 9000, r.d);
  r = await get(`/v2/assets/per-diem/calculate?city=Shimla&start_date=${addDays(10)}&end_date=${addDays(10)}`, emp.token);
  check('unlisted city uses the default tier', r.s === 200 && r.d.tier === 'tier_3' && r.d.amount === 1000, r.d);
  r = await get(`/v2/assets/per-diem/calculate?city=Pune&start_date=${addDays(10)}&end_date=${addDays(5)}`, emp.token);
  check('end before start rejected', r.s === 422, r);

  section('AS-2 Travel requests');
  const trip = { purpose: 'Customer workshop', from_city: 'Bengaluru', to_city: 'Mumbai', start_date: addDays(10), end_date: addDays(12), travel_mode: 'flight', accommodation_needed: true, estimated_cost: 20000, advance_requested: 5000 };
  r = await post('/v2/assets/travel', emp.token, { ...trip, end_date: addDays(8) });
  check('end date before start rejected', r.s === 422, r);
  r = await post('/v2/assets/travel', emp.token, { ...trip, advance_requested: 25000 });
  check('advance above estimate rejected', r.s === 422, r);
  r = await post('/v2/assets/travel', emp.token, { ...trip, to_city: 'bengaluru' });
  check('same from/to city rejected', r.s === 422, r);
  r = await post('/v2/assets/travel', emp.token, { ...trip, travel_mode: 'teleport' });
  check('invalid travel mode rejected', r.s === 422, r);
  r = await post('/v2/assets/travel', emp.token, trip);
  check('employee submits a trip → pending manager', r.s === 201 && r.d.status === 'pending_manager' && r.d.manager_email === mgr.email && r.d.advance_status === 'pending', r);
  check('per-diem auto-calculated for trip days', r.d?.per_diem?.tier === 'tier_1' && r.d.per_diem.days === 3 && r.d.per_diem.amount === 9000, r.d?.per_diem);
  const t1 = r.d;
  r = await get(`/v2/assets/travel/${t1.id}`, emp2.token);
  check('other employee cannot view the trip', r.s === 403, r);
  r = await get(`/v2/assets/travel/${t1.id}`, finMgr.token);
  check('manager of another team cannot view the trip', r.s === 403, r);
  const mgrNote = await withDb(db => db.collection('notifications').findOne({ user_email: mgr.email, type: 'travel_request_submitted' }));
  check('manager notified', !!mgrNote, mgrNote);
  r = await get('/v2/assets/travel?scope=approvals', mgr.token);
  check('trip in manager approvals queue', r.s === 200 && r.d.some(x => x.id === t1.id), r.d);
  r = await get('/v2/assets/travel?scope=approvals', finMgr.token);
  check('not in another manager\'s queue', r.s === 200 && !r.d.some(x => x.id === t1.id), r.d);
  r = await post(`/v2/assets/travel/${t1.id}/approve`, admin, {});
  check('admin cannot skip the manager stage', r.s === 403, r);
  r = await post(`/v2/assets/travel/${t1.id}/approve`, finMgr.token, {});
  check('other manager cannot approve', r.s === 403, r);
  r = await post(`/v2/assets/travel/${t1.id}/approve`, emp.token, {});
  check('employee cannot approve own trip', r.s === 403, r);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Hotel', category: 'Accommodation', amount: '100', trip_id: t1.id });
  check('claims cannot link to an unapproved trip', r.s === 400, r);
  r = await post(`/v2/assets/travel/${t1.id}/approve`, mgr.token, { comments: 'Go ahead' });
  check('manager approves → pending admin', r.s === 200 && r.d.status === 'pending_admin' && r.d.approvals[0].stage === 'manager', r);
  r = await post(`/v2/assets/travel/${t1.id}/approve`, mgr.token, {});
  check('manager cannot give final approval', r.s === 403, r);
  r = await get('/v2/assets/travel?scope=approvals', admin);
  check('trip in admin approvals queue', r.s === 200 && r.d.some(x => x.id === t1.id), r.d);
  r = await post(`/v2/assets/travel/${t1.id}/advance`, admin, {});
  check('advance cannot be paid before final approval', r.s === 400, r);
  r = await post(`/v2/assets/travel/${t1.id}/approve`, admin, { comments: 'Approved' });
  check('admin gives final approval', r.s === 200 && r.d.status === 'approved' && r.d.approvals.length === 2 && r.d.per_diem.amount === 9000, r);
  r = await get('/v2/assets/travel/linkable', emp.token);
  check('approved trip is linkable', r.s === 200 && r.d.some(x => x.id === t1.id && x.label), r.d);
  r = await upload('/reimbursements/apply', emp2.token, [], { title: 'Hotel', category: 'Accommodation', amount: '100', trip_id: t1.id });
  check('cannot link a claim to someone else\'s trip', r.s === 400, r);
  r = await upload('/reimbursements/apply', emp.token, [png()], { title: 'Hotel 2 nights', category: 'Accommodation', amount: '8000', trip_id: t1.id, expense_date: addDays(11) });
  check('claim linked to the approved trip', r.s === 200 && r.d.reimbursement.trip_id === t1.id && r.d.reimbursement.trip_label, r);
  const hotel = r.d.reimbursement;
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Flight', category: 'Travel', amount: '9000.50', trip_id: t1.id });
  const flight = r.d.reimbursement;
  r = await post(`/v2/assets/travel/${t1.id}/advance`, emp.token, {});
  check('employee cannot mark advance paid', r.s === 403, r);
  r = await post(`/v2/assets/travel/${t1.id}/advance`, admin, { amount: 6000 });
  check('cannot pay more than the advance requested', r.s === 422, r);
  r = await post(`/v2/assets/travel/${t1.id}/advance`, admin, { reference: 'NEFT-123' });
  check('admin marks advance disbursed', r.s === 200 && r.d.advance_status === 'disbursed' && r.d.advance_disbursed_amount === 5000, r);
  r = await post(`/v2/assets/travel/${t1.id}/advance`, admin, {});
  check('advance cannot be paid twice', r.s === 400, r);
  r = await get(`/v2/assets/travel/${t1.id}`, emp.token);
  const s = r.d?.summary;
  check('trip summary: claimed vs estimate, advance to settle', r.s === 200 && s.total_claimed === 17000.5 && s.per_diem_amount === 9000 && s.total_entitlement === 26000.5 && s.advance_disbursed === 5000 && s.balance === 21000.5 && s.over_estimate === true && s.settlement_direction === 'payable_to_employee', s);
  r = await get(`/v2/assets/travel/${t1.id}`, mgr.token);
  check('manager can view team trip', r.s === 200 && r.d.can_act === false, r.d?.can_act);
  r = await post(`/v2/assets/travel/${t1.id}/cancel`, emp.token);
  check('cannot cancel after the advance is paid', r.s === 400, r);
  r = await post(`/v2/assets/travel/${t1.id}/settle`, admin, {});
  check('cannot settle while linked claims are pending', r.s === 400, r);
  await post(`/reimbursements/${hotel.id}/action`, admin, { action: 'approve' });
  await post(`/reimbursements/${flight.id}/action`, admin, { action: 'reject', remarks: 'Booked by travel desk' });
  r = await post(`/v2/assets/travel/${t1.id}/settle`, admin, { comments: 'Settled via payroll' });
  check('admin settles the trip (rejected claims excluded)', r.s === 200 && r.d.status === 'settled' && r.d.settlement.total_claimed === 8000 && r.d.settlement.balance === 12000, r.d?.settlement);
  r = await upload('/reimbursements/apply', emp.token, [], { title: 'Late taxi', category: 'Travel', amount: '200', trip_id: t1.id });
  check('settled trip no longer accepts claims', r.s === 400, r);

  r = await post('/v2/assets/travel', emp2.token, { ...trip, to_city: 'Shimla', advance_requested: 0 });
  check('Finance employee without manager_email routes to the department manager', r.s === 201 && r.d.status === 'pending_manager' && r.d.manager_email === finMgr.email && r.d.per_diem.tier === 'tier_3', r);
  const t2 = r.d;
  r = await post(`/v2/assets/travel/${t2.id}/approve`, mgr.token, {});
  check('Engineering manager cannot approve a Finance trip', r.s === 403, r);
  r = await post(`/v2/assets/travel/${t2.id}/reject`, finMgr.token, {});
  check('rejection requires comments', r.s === 422, r);
  r = await post(`/v2/assets/travel/${t2.id}/reject`, finMgr.token, { comments: 'Budget freeze' });
  check('department manager rejects', r.s === 200 && r.d.status === 'rejected', r);
  r = await post(`/v2/assets/travel/${t2.id}/approve`, admin, {});
  check('rejected trip cannot be approved', r.s === 400, r);
  r = await post('/v2/assets/travel', mgr.token, { ...trip, advance_requested: 0 });
  check('manager without a manager goes straight to admin', r.s === 201 && r.d.status === 'pending_admin', r);
  const t3 = r.d;
  r = await post(`/v2/assets/travel/${t3.id}/cancel`, emp.token);
  check('cannot cancel someone else\'s trip', r.s === 403, r);
  r = await post(`/v2/assets/travel/${t3.id}/cancel`, mgr.token);
  check('owner cancels a pending trip', r.s === 200 && r.d.status === 'cancelled', r);
  r = await get('/v2/assets/travel', emp.token);
  check('employee list shows only own trips', r.s === 200 && r.d.length === 1 && r.d[0].id === t1.id, r.d?.map(x => x.employee_email));
  r = await get('/v2/assets/travel?scope=all', admin);
  check('admin sees all trips', r.s === 200 && r.d.length === 3, r.d?.length);

  section('AS-2 Receipt OCR');
  const ocr = require('../../services/assets/receiptOcr.js');
  const cats = ['Travel', 'Food & Meals', 'Accommodation', 'Other'];
  if (!process.env.ANTHROPIC_API_KEY) {
    r = await get('/v2/assets/receipts/scan/status', emp.token);
    check('scan status reports not configured', r.s === 200 && r.d.configured === false, r);
    r = await upload('/v2/assets/receipts/scan', emp.token, [png('receipt')]);
    check('scan returns a clear not-configured response', r.s === 200 && r.d.configured === false && /not configured/i.test(r.d.detail), r);
    const res = await ocr.extractReceipt({ buffer: PNG, mimeType: 'image/png', categories: cats });
    check('service: no key and no client → configured false', res.configured === false, res);
  } else {
    check('ANTHROPIC_API_KEY set: not-configured path skipped', true);
  }
  r = await upload('/v2/assets/receipts/scan', null, [png('receipt')]);
  check('scan requires login', r.s === 401, r);

  const mocked = (payload, extra = {}) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
    ...extra
  });
  let parsed = ocr.parseReceiptResponse(mocked({ amount: 1234.567, currency: 'inr', date: '2026-10-03', vendor: '  Taj Hotels ', suggested_category: 'accommodation', confidence: 'high', is_receipt: true }), cats);
  check('parses amount/date/vendor/category from a model response', parsed.amount === 1234.57 && parsed.date === '2026-10-03' && parsed.vendor === 'Taj Hotels' && parsed.suggested_category === 'Accommodation' && parsed.currency === 'INR' && parsed.confidence === 'high', parsed);
  parsed = ocr.parseReceiptResponse(mocked('```json\n{"amount":"₹ 450.00","currency":null,"date":"05/10/2026","vendor":null,"suggested_category":"Spaceships","confidence":"weird","is_receipt":true}\n```'), cats);
  check('normalises fenced JSON, day-first dates, string amounts, unknown category', parsed.amount === 450 && parsed.date === '2026-10-05' && parsed.suggested_category === null && parsed.confidence === 'low' && parsed.vendor === null, parsed);
  parsed = ocr.parseReceiptResponse(mocked({ amount: null, currency: null, date: '2026-02-31', vendor: 'X', suggested_category: null, confidence: 'low', is_receipt: false }), cats);
  check('invalid date dropped and non-receipt flagged', parsed.date === null && parsed.is_receipt === false && parsed.amount === null, parsed);
  let threw = null;
  try { ocr.parseReceiptResponse(mocked({}, { stop_reason: 'refusal', content: [] }), cats); } catch (e) { threw = e; }
  check('refusal surfaces as a readable error', threw instanceof ocr.ReceiptOcrError && threw.status === 422, threw?.message);
  threw = null;
  try { ocr.parseReceiptResponse(mocked('I cannot read this'), cats); } catch (e) { threw = e; }
  check('non-JSON output surfaces as a readable error', threw instanceof ocr.ReceiptOcrError, threw?.message);

  let captured = null;
  const fakeClient = { beta: { messages: { create: async (params) => { captured = params; return mocked({ amount: 99, currency: 'INR', date: '2026-10-01', vendor: 'Uber', suggested_category: 'Travel', confidence: 'medium', is_receipt: true }); } } } };
  const res = await ocr.extractReceipt({ buffer: PDF, mimeType: 'application/pdf', categories: cats }, { client: fakeClient });
  check('injected client: result returned', res.configured === true && res.amount === 99 && res.suggested_category === 'Travel', res);
  const blocks = captured?.messages?.[0]?.content || [];
  check('request uses the expected model, document block and JSON schema', captured?.model === 'claude-opus-5-5' && blocks[0]?.type === 'document' && blocks[0].source.media_type === 'application/pdf'
    && captured.output_config?.format?.type === 'json_schema' && captured.output_config.format.schema.properties.suggested_category.anyOf[0].enum.includes('Travel'), captured && { model: captured.model, block: blocks[0]?.type });
  await ocr.extractReceipt({ buffer: PNG, mimeType: 'image/jpg', categories: cats }, { client: fakeClient });
  check('images sent as image blocks (jpg normalised)', captured.messages[0].content[0].type === 'image' && captured.messages[0].content[0].source.media_type === 'image/jpeg', captured.messages[0].content[0].source.media_type);
  threw = null;
  try { await ocr.extractReceipt({ buffer: PNG, mimeType: 'text/plain', categories: cats }, { client: fakeClient }); } catch (e) { threw = e; }
  check('unsupported file types rejected before calling the API', threw?.status === 400, threw?.message);
});
