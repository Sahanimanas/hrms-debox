/**
 * Employee identity: employee codes (employee_id), uuid ids, and the
 * idempotent backfill that repairs legacy rows.
 *
 * Legacy data has three shapes besides the app's own { id, employee_id }:
 *  - seed.js rows: { _id, employee_code, user_id } with no id / employee_id
 *  - rows with an empty employee_id
 *  - two employees sharing a code (an app-issued employee_id equal to a
 *    seeded employee_code), which made the attendance grid mark both rows
 *
 * backfillEmployeeIdentity() gives every employee a unique employee_id and a
 * uuid id, creates employee rows for user accounts that have none, and moves
 * references that can be attributed without guessing (see migrateReferences).
 * It runs at server startup and from scripts/backfill-employee-ids.js.
 */

const { generateUUID } = require('../utils/helpers');
const { defaultLeaveBalance } = require('../models/schemas');

const UNIQUE_INDEX = 'employee_id_unique';
const HEX_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Collections never rewritten by the reference migration
const SKIP_COLLECTIONS = new Set(['employees', 'users', 'audit_logs', 'settings']);
const EMAIL_FIELDS = ['employee_email', 'email', 'user_email'];

const codeOf = (e) => {
  const v = e && (e.employee_id || e.employee_code);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const formatCode = (prefix, counter) => `${prefix || 'EMP'}${String(counter).padStart(4, '0')}`;

/**
 * Atomically increment the employee ID counter and return the settings
 * document after the increment. Counter starts at 1000 if unset.
 */
async function nextEmployeeCounter(db) {
  const result = await db.collection('settings').findOneAndUpdate(
    {},
    [{ $set: { employee_id_counter: { $add: [{ $ifNull: ['$employee_id_counter', 1000] }, 1] } } }],
    { returnDocument: 'after' }
  );
  const doc = result && result.value !== undefined && result.employee_id_counter === undefined ? result.value : result;
  if (!doc) throw new Error('System settings not initialized');
  return doc;
}

/** Is a code already used by an employee (employee_id or legacy employee_code) or a user? */
async function isCodeTaken(db, code) {
  return !!(
    await db.collection('employees').findOne({ $or: [{ employee_id: code }, { employee_code: code }] }, { projection: { _id: 1 } })
    || await db.collection('users').findOne({ employee_id: code }, { projection: { _id: 1 } })
  );
}

/**
 * Next free employee code. The counter increment is atomic, so concurrent
 * callers never get the same candidate; candidates already in use (the
 * counter may have been reset below existing codes) are skipped. The unique
 * index on employees.employee_id is the final guard.
 */
async function allocateEmployeeCode(db) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const settings = await nextEmployeeCounter(db);
    const candidate = formatCode(settings.employee_id_prefix, settings.employee_id_counter);
    if (!(await isCodeTaken(db, candidate))) return candidate;
  }
  throw new Error('Could not allocate a unique employee ID');
}

const isDuplicateCodeError = (error) =>
  error && error.code === 11000 && !!(error.keyPattern && 'employee_id' in error.keyPattern);

/** Unique employee code (partial: rows with an empty / missing code are not indexed). */
async function ensureEmployeeCodeIndex(db) {
  await db.collection('employees').createIndex(
    { employee_id: 1 },
    { unique: true, name: UNIQUE_INDEX, partialFilterExpression: { employee_id: { $gt: '' } } }
  );
}

/**
 * Point references at an employee's new code. `aliases` are values that
 * identify only this employee (its Mongo _id, or the uuid it was keyed by
 * when it had no code); `sharedCode` is a code it shared with someone else,
 * so those records move only when an email field names this employee.
 * uuid aliases are only rewritten in employee_uid (and attendance), because
 * several collections store the uuid in employee_id on purpose.
 */
async function migrateReferences(db, moves, { dryRun = false } = {}) {
  if (!moves.length) return [];
  const report = [];
  const collections = (await db.listCollections().toArray()).map(c => c.name)
    .filter(n => !SKIP_COLLECTIONS.has(n) && !n.startsWith('_') && !n.startsWith('system.'));

  for (const name of collections) {
    const coll = db.collection(name);
    for (const field of ['employee_id', 'employee_uid']) {
      const byValue = new Map(); // old value -> [{ move, needsEmail }]
      for (const move of moves) {
        for (const alias of move.aliases) {
          if (UUID.test(alias) && field === 'employee_id' && name !== 'attendance') continue;
          byValue.set(alias, [...(byValue.get(alias) || []), { move, needsEmail: false }]);
        }
        if (move.sharedCode) byValue.set(move.sharedCode, [...(byValue.get(move.sharedCode) || []), { move, needsEmail: true }]);
      }
      if (!byValue.size) continue;
      const docs = await coll.find({ [field]: { $in: [...byValue.keys()] } },
        { projection: { _id: 1, [field]: 1, ...Object.fromEntries(EMAIL_FIELDS.map(f => [f, 1])) } }).toArray();
      for (const doc of docs) {
        const emails = EMAIL_FIELDS.map(f => doc[f]).filter(v => typeof v === 'string').map(v => v.toLowerCase());
        const target = (byValue.get(doc[field]) || [])
          .find(t => !t.needsEmail || emails.includes(String(t.move.email || '').toLowerCase()));
        if (!target) continue;
        report.push({ collection: name, field, from: doc[field], to: target.move.code, email: target.move.email });
        if (!dryRun) await coll.updateOne({ _id: doc._id }, { $set: { [field]: target.move.code } });
      }
    }
  }
  return report;
}

const createdAt = (doc) => {
  const t = doc && doc.created_at ? new Date(doc.created_at).getTime() : NaN;
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
};

/**
 * Repair employee identities. Idempotent: a second run changes nothing.
 * With dryRun nothing is written and codes are simulated from the counter.
 * Returns { codes: [...], ids: [...], created: [...], users: [...], references: [...], warnings: [...] }.
 */
async function backfillEmployeeIdentity(db, { dryRun = false } = {}) {
  const report = { codes: [], ids: [], created: [], users: [], references: [], warnings: [] };
  const employeesColl = db.collection('employees');
  const usersColl = db.collection('users');
  const employees = await employeesColl.find({}).toArray();
  const users = await usersColl.find({}, { projection: { hashed_password: 0 } }).toArray();
  const settings = await db.collection('settings').findOne({});
  const userByEmail = new Map(users.filter(u => u.email).map(u => [u.email.toLowerCase(), u]));

  // Code allocation: the real atomic counter, or a simulation for a dry run
  const taken = new Set([...employees.flatMap(e => [e.employee_id, e.employee_code]), ...users.map(u => u.employee_id)]
    .filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()));
  let simulated = Number(settings?.employee_id_counter) || 1000;
  const allocate = async () => {
    if (!settings) throw new Error('System settings not initialized');
    if (!dryRun) return allocateEmployeeCode(db);
    let code;
    do { simulated += 1; code = formatCode(settings.employee_id_prefix, simulated); } while (taken.has(code));
    taken.add(code);
    return code;
  };

  // 1. Decide who keeps each code: earliest created, admin on a tie
  const ordered = [...employees].sort((a, b) =>
    (createdAt(a) - createdAt(b)) || ((b.role === 'admin') - (a.role === 'admin')));
  const owner = new Map();
  for (const e of ordered) {
    const code = codeOf(e);
    if (code && !owner.has(code)) owner.set(code, e);
  }

  const moves = [];
  const usedIds = new Set(employees.map(e => e.id).filter(Boolean));
  const keepsCode = (e) => !!codeOf(e) && owner.get(codeOf(e)) === e;
  // Re-code the duplicates first so promoting an owner's employee_code never
  // collides (unique index) with the copy it is taking over
  for (const e of [...ordered.filter(x => !keepsCode(x)), ...ordered.filter(keepsCode)]) {
    const code = codeOf(e);
    const keeps = keepsCode(e);
    const user = e.email ? userByEmail.get(e.email.toLowerCase()) : null;
    const set = {};
    let newCode = keeps ? code : null;

    if (!keeps) {
      try {
        newCode = await allocate();
      } catch (error) {
        report.warnings.push(`${e.email || e._id}: no employee code assigned (${error.message})`);
        continue;
      }
      report.codes.push({ email: e.email, full_name: e.full_name, from: code, to: newCode, reason: code ? `duplicate of ${owner.get(code).email}` : 'missing' });
      const aliases = [String(e._id)];
      if (!code && e.id) aliases.push(e.id); // it was keyed by its uuid until now
      moves.push({ email: e.email, code: newCode, aliases, sharedCode: code });
    } else if (e.employee_id !== code) {
      // Seeded rows: promote employee_code (already their key) to employee_id
      report.codes.push({ email: e.email, full_name: e.full_name, from: e.employee_id || null, to: code, reason: 'promoted employee_code' });
      if (HEX_ID.test(String(e._id))) moves.push({ email: e.email, code, aliases: [String(e._id)], sharedCode: null });
    }
    if (newCode && e.employee_id !== newCode) set.employee_id = newCode;

    if (!e.id) {
      const id = user?.id && !usedIds.has(user.id) ? user.id : generateUUID();
      usedIds.add(id);
      set.id = id;
      report.ids.push({ email: e.email, id });
    }

    if (Object.keys(set).length && !dryRun) {
      await employeesColl.updateOne({ _id: e._id }, { $set: set });
    }

    // Keep the linked user account in step (app-created users carry the same code and id)
    if (user && newCode) {
      const userSet = {};
      if (user.employee_id !== newCode) {
        userSet.employee_id = newCode;
        // seed.js users held the employee's _id here; keep it for reference
        if (HEX_ID.test(String(user.employee_id || '')) || UUID.test(String(user.employee_id || ''))) {
          userSet.legacy_employee_ref = user.employee_id;
        }
      }
      if (!user.id) userSet.id = set.id || e.id;
      if (Object.keys(userSet).length) {
        report.users.push({ email: user.email, ...userSet });
        if (!dryRun) await usersColl.updateOne({ _id: user._id }, { $set: userSet });
      }
    }
  }

  // 2. User accounts with no employee row ("old user table"): create the record
  const employeeEmails = new Set(employees.map(e => (e.email || '').toLowerCase()).filter(Boolean));
  for (const u of users) {
    if (!u.email || employeeEmails.has(u.email.toLowerCase())) continue;
    let code = codeOf({ employee_id: u.employee_id });
    if (!code || HEX_ID.test(code) || UUID.test(code) || owner.has(code)) {
      try {
        code = await allocate();
      } catch (error) {
        report.warnings.push(`${u.email}: no employee record created (${error.message})`);
        continue;
      }
    }
    owner.set(code, u);
    const id = u.id && !usedIds.has(u.id) ? u.id : generateUUID();
    usedIds.add(id);
    const now = new Date();
    const doc = {
      id,
      employee_id: code,
      email: u.email,
      full_name: u.full_name || u.name || u.email.split('@')[0],
      role: u.role || 'employee',
      department: u.department || 'Unassigned',
      designation: u.designation || 'Employee',
      phone: u.phone || null,
      organization_id: u.organization_id || null,
      organization_name: null,
      joining_date: u.date_of_joining || u.created_at || now,
      manager_email: null,
      manager_name: null,
      leave_balance: { ...defaultLeaveBalance },
      created_at: u.created_at || now,
      provisioned_via: 'identity_backfill'
    };
    report.created.push({ email: u.email, full_name: doc.full_name, employee_id: code });
    if (!dryRun) {
      await employeesColl.insertOne(doc);
      const userSet = { ...(u.employee_id !== code ? { employee_id: code } : {}), ...(!u.id ? { id } : {}) };
      if (Object.keys(userSet).length) await usersColl.updateOne({ _id: u._id }, { $set: userSet });
    }
  }

  report.references = await migrateReferences(db, moves, { dryRun });
  return report;
}

/**
 * Organizations: seeded rows have only a Mongo _id, which employees already
 * reference as organization_id, so it becomes their id. name_key (trimmed,
 * lower-case) backs the unique-name index; on existing duplicates only the
 * oldest row gets it (the API still rejects new duplicates by name).
 */
const orgNameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

async function backfillOrganizations(db, { dryRun = false } = {}) {
  const report = { ids: [], name_keys: [], duplicates: [] };
  const orgs = await db.collection('organizations').find({}).toArray();
  const seen = new Map();
  for (const org of [...orgs].sort((a, b) => createdAt(a) - createdAt(b))) {
    const set = {};
    if (!org.id) set.id = String(org._id);
    const key = orgNameKey(org.name);
    if (key && seen.has(key)) {
      report.duplicates.push({ name: org.name, id: org.id || String(org._id), duplicate_of: seen.get(key) });
    } else if (key) {
      seen.set(key, org.id || String(org._id));
      if (org.name_key !== key) set.name_key = key;
    }
    if (set.id) report.ids.push({ name: org.name, id: set.id });
    if (set.name_key) report.name_keys.push({ name: org.name, name_key: set.name_key });
    if (Object.keys(set).length && !dryRun) await db.collection('organizations').updateOne({ _id: org._id }, { $set: set });
  }
  return report;
}

async function ensureOrganizationNameIndex(db) {
  await db.collection('organizations').createIndex(
    { name_key: 1 },
    { unique: true, name: 'name_key_unique', partialFilterExpression: { name_key: { $type: 'string' } } }
  );
}

const summarize = (r) => Object.entries(r)
  .filter(([, v]) => Array.isArray(v) && v.length)
  .map(([k, v]) => `${k}: ${v.length}`).join(', ');

/** Startup: repair identities, then add the unique indexes. Never throws. */
async function runStartupMigrations(db) {
  if (String(process.env.STARTUP_MIGRATIONS || '').toLowerCase() === 'false') return;
  try {
    const employees = await backfillEmployeeIdentity(db);
    const changed = summarize(employees);
    if (changed) console.log(`[MIGRATIONS] Employee identity backfill — ${changed}`);
    employees.warnings.forEach(w => console.warn(`[MIGRATIONS] ${w}`));
    await ensureEmployeeCodeIndex(db).catch(error =>
      console.error('[MIGRATIONS] Could not add the unique employee code index:', error.message));

    const orgs = await backfillOrganizations(db);
    const orgChanged = summarize({ ids: orgs.ids, name_keys: orgs.name_keys });
    if (orgChanged) console.log(`[MIGRATIONS] Organization backfill — ${orgChanged}`);
    orgs.duplicates.forEach(d => console.warn(`[MIGRATIONS] Duplicate organization name "${d.name}" (${d.id}); rename it`));
    await ensureOrganizationNameIndex(db).catch(error =>
      console.error('[MIGRATIONS] Could not add the unique organization name index:', error.message));
  } catch (error) {
    console.error('[MIGRATIONS] Startup migrations failed:', error.message);
  }
}

module.exports = {
  allocateEmployeeCode,
  nextEmployeeCounter,
  isCodeTaken,
  isDuplicateCodeError,
  ensureEmployeeCodeIndex,
  migrateReferences,
  backfillEmployeeIdentity,
  backfillOrganizations,
  ensureOrganizationNameIndex,
  orgNameKey,
  runStartupMigrations,
  codeOf
};
