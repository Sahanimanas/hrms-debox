#!/usr/bin/env node
/**
 * One-off migration: copy every collection from MongoDB into PostgreSQL.
 *
 *   node scripts/migrate-mongo-to-postgres.js \
 *     --from mongodb://127.0.0.1:27017 --from-db hrms \
 *     --to postgres://user:pass@localhost:5432/hrms --to-db hrms [--drop] [--only users,employees]
 *
 * Defaults: --from $MONGO_URL (or mongodb://127.0.0.1:27017), --from-db $DB_NAME,
 *           --to $DATABASE_URL, --to-db $DB_NAME.
 *
 * - Each collection becomes a table in the target schema (see db/pgdoc).
 * - BSON types are converted: ObjectId and Date are preserved, Decimal128 /
 *   Long / Int32 / Double become numbers, Binary becomes a Buffer.
 * - Unique and TTL indexes are recreated; other indexes are not needed
 *   (lookups use the GIN index pgdoc creates for every table).
 * - Refuses to write into a non-empty target collection unless --drop is given
 *   (which empties it first), so it is safe to re-run.
 * - Prints source vs target counts per collection and exits non-zero on mismatch.
 *
 * Needs the `mongodb` package (devDependency) only for reading the source.
 */

require('dotenv').config();
const { PgDocClient, ObjectId } = require('../db/pgdoc');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const FROM = opt('from', process.env.MONGO_URL || 'mongodb://127.0.0.1:27017');
const FROM_DB = opt('from-db', process.env.DB_NAME || 'hrms');
const TO = opt('to', process.env.DATABASE_URL);
const TO_DB = opt('to-db', process.env.DB_NAME || FROM_DB);
const DROP = flag('drop');
const ONLY = opt('only', '') ? opt('only', '').split(',').map(s => s.trim()) : null;
const BATCH = Number(opt('batch', 500));

/** Convert driver BSON values into plain JS / pgdoc types. */
function fromBson(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(fromBson);
  switch (value._bsontype) {
    case 'ObjectId':
    case 'ObjectID': return new ObjectId(value.toHexString());
    case 'Decimal128': return Number(value.toString());
    case 'Long': return value.toNumber();
    case 'Int32':
    case 'Double': return value.valueOf();
    case 'Binary': return Buffer.from(value.buffer);
    case 'Timestamp': return new Date(value.getHighBits() * 1000);
    case 'BSONRegExp': return new RegExp(value.pattern, value.options.replace(/[^imsu]/g, ''));
    case 'MinKey':
    case 'MaxKey':
    case 'Code': return null;
    default: break;
  }
  if (Buffer.isBuffer(value)) return value;
  const out = {};
  for (const k of Object.keys(value)) out[k] = fromBson(value[k]);
  return out;
}

async function main() {
  if (!TO) {
    console.error('Target not set: pass --to postgres://... or set DATABASE_URL');
    process.exit(2);
  }
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch {
    console.error('The `mongodb` package is needed to read the source: npm install --no-save mongodb');
    process.exit(2);
  }

  const mask = (u) => u.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
  console.log(`Source: ${mask(FROM)}  db=${FROM_DB}`);
  console.log(`Target: ${mask(TO)}  schema=${TO_DB}${DROP ? '  (--drop: target collections are emptied first)' : ''}\n`);

  const mongo = new MongoClient(FROM);
  await mongo.connect();
  const pg = await new PgDocClient(TO).connect();
  const src = mongo.db(FROM_DB);
  const dst = pg.db(TO_DB);

  const collections = (await src.listCollections({}, { nameOnly: true }).toArray())
    .map(c => c.name)
    .filter(n => !n.startsWith('system.'))
    .filter(n => !ONLY || ONLY.includes(n))
    .sort();

  const report = [];
  let problems = 0;
  for (const name of collections) {
    const source = src.collection(name);
    const target = dst.collection(name);
    const sourceCount = await source.countDocuments();
    const existing = await target.countDocuments();
    if (existing && !DROP) {
      report.push({ collection: name, source: sourceCount, target: existing, status: 'SKIPPED (target not empty; use --drop)' });
      problems += 1;
      continue;
    }
    if (existing) await target.deleteMany({});

    let batch = [];
    let copied = 0;
    for await (const doc of source.find({})) {
      batch.push(fromBson(doc));
      if (batch.length >= BATCH) {
        await target.insertMany(batch);
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await target.insertMany(batch);
      copied += batch.length;
    }

    // Recreate unique / TTL indexes
    let indexes = 0;
    for (const ix of await source.indexes()) {
      if (ix.name === '_id_' || (!ix.unique && ix.expireAfterSeconds === undefined)) continue;
      const options = { name: ix.name };
      if (ix.unique) options.unique = true;
      if (ix.sparse) options.sparse = true;
      if (ix.partialFilterExpression) options.partialFilterExpression = fromBson(ix.partialFilterExpression);
      if (ix.expireAfterSeconds !== undefined) options.expireAfterSeconds = ix.expireAfterSeconds;
      try {
        await target.createIndex(ix.key, options);
        indexes += 1;
      } catch (error) {
        console.warn(`  ! ${name}: could not recreate index ${ix.name}: ${error.message}`);
      }
    }

    const targetCount = await target.countDocuments();
    const ok = targetCount === sourceCount;
    if (!ok) problems += 1;
    report.push({ collection: name, source: sourceCount, target: targetCount, indexes, status: ok ? 'OK' : 'MISMATCH' });
    process.stdout.write(`  ${ok ? '✓' : '✗'} ${name}: ${copied} documents\n`);
  }

  console.log('');
  console.table(report);
  console.log(problems ? `\n${problems} collection(s) need attention.` : `\nMigrated ${collections.length} collection(s) successfully.`);

  await mongo.close();
  await pg.close();
  process.exitCode = problems ? 1 : 0;
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
