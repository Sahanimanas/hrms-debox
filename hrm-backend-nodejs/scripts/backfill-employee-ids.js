/**
 * Repair employee identities (the same backfill the server runs at startup):
 *  - every employee gets a unique employee_id code (from the settings
 *    prefix / counter) and a uuid id; seeded employee_code values are kept
 *  - duplicate codes: the earliest-created employee keeps it, the others get
 *    new codes; records that name them by email follow them
 *  - user accounts without an employee row get one
 *  - organizations without an id get their _id; name_key for unique names
 * then adds the unique indexes.
 *
 *   node scripts/backfill-employee-ids.js --dry-run   # report only, writes nothing
 *   node scripts/backfill-employee-ids.js             # apply
 *
 * Uses DATABASE_URL and DB_NAME from .env. Safe to run more than once.
 */

require('dotenv').config();
const { PgDocClient } = require('../db/pgdoc');
const {
  backfillEmployeeIdentity, backfillOrganizations, ensureEmployeeCodeIndex, ensureOrganizationNameIndex
} = require('../services/employeeIdentity');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/hrms';
const DB_NAME = process.env.DB_NAME || 'hrms_production';
const dryRun = process.argv.includes('--dry-run');

const table = (title, rows) => {
  console.log(`\n${title}: ${rows.length}`);
  if (rows.length) console.table(rows);
};

async function main() {
  const client = new PgDocClient(DATABASE_URL);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    console.log(`${dryRun ? 'DRY RUN — nothing is written. ' : ''}Schema: ${DB_NAME}`);

    const employees = await backfillEmployeeIdentity(db, { dryRun });
    table('Employee codes assigned / changed', employees.codes);
    table('Employee uuid ids added', employees.ids);
    table('Employee records created for users', employees.created);
    table('User accounts updated', employees.users);
    table('References moved to the new code', employees.references);
    employees.warnings.forEach(w => console.warn(`WARNING: ${w}`));

    const orgs = await backfillOrganizations(db, { dryRun });
    table('Organization ids added', orgs.ids);
    table('Organization name keys set', orgs.name_keys);
    table('Duplicate organization names (rename these)', orgs.duplicates);

    if (!dryRun) {
      await ensureEmployeeCodeIndex(db);
      await ensureOrganizationNameIndex(db).catch(e => console.warn(`Organization name index not added: ${e.message}`));
      console.log('\nUnique indexes in place.');
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
