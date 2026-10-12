#!/usr/bin/env node
/**
 * Unit / differential tests for the PostgreSQL document store (db/pgdoc).
 *
 *   DATABASE_URL=postgres://... node tests/pgdoc.test.mjs
 *
 * Every filter is evaluated twice — through SQL (sql.js) and through the
 * in-process reference matcher (match.js) — and the results must agree.
 * Uses a throwaway schema that is dropped at the end.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PgDocClient, ObjectId } = require('../db/pgdoc');
const { matches, makeComparator } = require('../db/pgdoc/match');
const { applyUpdate } = require('../db/pgdoc/update');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(2); }

let passed = 0;
let failed = 0;
const check = (name, ok, extra) => {
  if (ok) passed += 1;
  else { failed += 1; console.log(`\x1b[31mFAIL\x1b[0m ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
};

const client = await new PgDocClient(url).connect();
const db = client.db(`pgdoc_test_${process.pid}`);

try {
  // ---------- differential query tests ----------
  const col = db.collection('items');
  const d = (iso) => new Date(iso);
  const oid = new ObjectId();
  const docs = [
    { id: 'a', n: 1, s: 'apple', tags: ['x', 'y'], at: d('2026-01-01T00:00:00Z'), flag: true, members: [{ email: 'p@x.com', role: 'admin' }, { email: 'q@x.com', role: 'member' }], nested: { k: 1 }, ref: oid },
    { id: 'b', n: 2, s: 'banana', tags: ['y'], at: d('2026-02-01T00:00:00Z'), flag: false, members: [{ email: 'q@x.com', role: 'viewer' }], nested: { k: 2 } },
    { id: 'c', n: 3.5, s: 'Cherry', tags: [], at: d('2026-03-01T00:00:00Z'), members: [], nullable: null },
    { id: 'd', n: '4', s: 'date', at: '2026-04-01', flag: null, nested: { k: [1, 2] } },
    { id: 'e', s: 'élan', tags: 'x', at: d('2025-12-31T23:59:59Z'), parent_id: null, members: [{ email: 'p@x.com' }] },
    { id: 'f', n: 0, s: '', tags: ['z', 'x'], status_category: 'done', due_date: '2026-10-01', dates: ['2026-10-05T00:00:00.000Z', '2026-10-06T00:00:00.000Z'] }
  ];
  await col.insertMany(docs);

  const filters = [
    {}, { id: 'a' }, { n: 1 }, { n: 2.0 }, { n: '4' }, { n: { $gt: 1 } }, { n: { $gte: 1, $lt: 3.5 } }, { n: { $lte: 0 } },
    { s: { $gt: 'b' } }, { s: { $in: ['apple', 'date'] } }, { s: { $nin: ['apple', 'date'] } }, { s: { $ne: 'apple' } },
    { tags: 'x' }, { tags: { $in: ['z'] } }, { tags: { $ne: 'y' } }, { tags: { $exists: true } }, { tags: { $exists: false } },
    { tags: { $size: 0 } }, { tags: { $all: ['x', 'y'] } },
    { at: { $gte: d('2026-01-15T00:00:00Z') } }, { at: { $lt: d('2026-01-01T00:00:00Z') } }, { at: '2026-04-01' }, { at: d('2026-02-01T00:00:00Z') },
    { flag: true }, { flag: false }, { flag: null }, { flag: { $ne: null } }, { nullable: null }, { parent_id: null }, { missing: null }, { missing: { $exists: false } },
    { 'members.email': 'p@x.com' }, { 'members.role': { $in: ['viewer', 'admin'] } }, { 'members.email': { $ne: 'p@x.com' } }, { 'members.role': null },
    { 'nested.k': 1 }, { 'nested.k': 2 }, { 'nested.k': { $gte: 2 } }, { nested: { k: 1 } },
    { ref: oid }, { ref: { $in: [oid, new ObjectId()] } },
    { $or: [{ n: 1 }, { s: 'date' }] }, { $or: [{ n: { $gt: 2 } }, { tags: 'z' }], flag: { $ne: true } }, { $and: [{ n: { $gte: 0 } }, { n: { $lte: 2 } }] },
    { $nor: [{ n: 1 }, { tags: 'y' }] }, { n: { $not: { $gt: 1 } } }, { s: /an/ }, { s: { $regex: '^c', $options: 'i' } }, { s: { $not: /a/ } },
    { status_category: { $ne: 'done' } }, { due_date: { $ne: null, $lt: '2026-10-12' } }, { dates: { $elemMatch: { $gte: '2026-10-06', $lte: '2026-10-31' } } },
    { members: { $elemMatch: { email: 'q@x.com', role: 'member' } } }, { n: { $type: 'string' } }, { n: { $type: 'number' } },
    { s: { $in: [] } }, { s: { $nin: [] } }, { $or: [{}, { n: 1 }] }, { _id: docs[0]._id }, { _id: { $in: [docs[1]._id, docs[2]._id] } },
    { $expr: { $gt: ['$n', 1] } }, { 'tags.0': 'z' }
  ];
  const all = await col.find({}).toArray();
  for (const f of filters) {
    const viaSql = (await col.find(f).toArray()).map(x => x.id).sort();
    const viaJs = all.filter(x => matches(x, f)).map(x => x.id).sort();
    check(`filter ${JSON.stringify(f)}`, JSON.stringify(viaSql) === JSON.stringify(viaJs), { viaSql, viaJs });
    check(`count ${JSON.stringify(f)}`, (await col.countDocuments(f)) === viaJs.length);
  }

  // ---------- sort parity ----------
  for (const sort of [{ n: 1 }, { n: -1 }, { s: 1 }, { at: -1 }, { flag: 1, id: -1 }, { 'nested.k': 1 }]) {
    const viaSql = (await col.find({}).sort(sort).toArray()).map(x => x.id);
    const viaJs = [...all].sort(makeComparator(sort)).map(x => x.id);
    check(`sort ${JSON.stringify(sort)}`, JSON.stringify(viaSql) === JSON.stringify(viaJs), { viaSql, viaJs });
  }
  const page = (await col.find({ n: { $gte: 0 } }).sort({ n: 1 }).skip(1).limit(2).toArray()).map(x => x.id);
  check('skip/limit with sort', JSON.stringify(page) === JSON.stringify(['a', 'b']), page);
  const proj = await col.findOne({ id: 'a' }, { projection: { _id: 0, id: 1, 'members.email': 1 } });
  check('projection inclusion with dot path', JSON.stringify(proj) === JSON.stringify({ id: 'a', members: [{ email: 'p@x.com' }, { email: 'q@x.com' }] }), proj);
  const excl = await col.findOne({ id: 'a' }, { projection: { _id: 0, members: 0, tags: 0 } });
  check('projection exclusion', !('members' in excl) && !('_id' in excl) && excl.s === 'apple', excl);
  check('types round-trip', (await col.findOne({ id: 'a' })).at instanceof Date && (await col.findOne({ id: 'a' })).ref instanceof ObjectId);

  // ---------- updates ----------
  const u = db.collection('updates');
  await u.insertOne({ id: 1, n: 1, arr: [1, 2], items: [{ id: 'i1', status: 'pending', proofs: [] }, { id: 'i2', status: 'pending', proofs: [] }], counts: {} });
  let r = await u.updateOne({ id: 1 }, { $inc: { n: 2, 'counts.a': 1 }, $push: { arr: 3 }, $addToSet: { arr: 2 }, $set: { 'deep.x.y': true }, $unset: { missing: '' } });
  let doc = await u.findOne({ id: 1 });
  check('$inc/$push/$addToSet/$set nested', r.matchedCount === 1 && r.modifiedCount === 1 && doc.n === 3 && doc.counts.a === 1 && JSON.stringify(doc.arr) === '[1,2,3]' && doc.deep.x.y === true, doc);
  await u.updateOne({ id: 1, 'items.id': 'i2' }, { $set: { 'items.$.status': 'declared' }, $push: { 'items.$.proofs': { id: 'p1' } } });
  doc = await u.findOne({ id: 1 });
  check('positional $ update', doc.items[1].status === 'declared' && doc.items[1].proofs.length === 1 && doc.items[0].status === 'pending', doc.items);
  await u.updateOne({ id: 1, 'items.id': 'i2' }, { $pull: { 'items.$.proofs': { id: 'p1' } } });
  await u.updateOne({ id: 1 }, { $pull: { arr: { $in: [1, 3] } } });
  doc = await u.findOne({ id: 1 });
  check('$pull with condition', doc.items[1].proofs.length === 0 && JSON.stringify(doc.arr) === '[2]', doc);
  r = await u.updateOne({ id: 1 }, { $set: { n: 3 } });
  check('no-op update reports modifiedCount 0', r.matchedCount === 1 && r.modifiedCount === 0, r);
  r = await u.updateOne({ id: 2, kind: 'x' }, { $set: { n: 5 }, $setOnInsert: { created: true } }, { upsert: true });
  doc = await u.findOne({ id: 2 });
  check('upsert seeds equality fields + $setOnInsert', r.upsertedCount === 1 && doc.kind === 'x' && doc.n === 5 && doc.created === true, doc);
  await u.updateOne({ id: 2 }, { $set: { n: 6 }, $setOnInsert: { created: false } }, { upsert: true });
  check('$setOnInsert ignored on update', (await u.findOne({ id: 2 })).created === true);
  const after = await u.findOneAndUpdate({ id: 2 }, { $inc: { n: 1 } }, { returnDocument: 'after', projection: { _id: 0, n: 1 } });
  check('findOneAndUpdate returnDocument after', JSON.stringify(after) === '{"n":7}', after);
  r = await u.updateMany({}, { $set: { touched: true } });
  check('updateMany', r.matchedCount === 2 && (await u.countDocuments({ touched: true })) === 2, r);
  check('pure-JS update matches', applyUpdate({ a: [1] }, { $push: { a: { $each: [3, 2], $sort: 1, $slice: -2 } } }).a.join() === '2,3');
  r = await u.deleteMany({ id: { $in: [1, 2] } });
  check('deleteMany', r.deletedCount === 2, r);

  // ---------- unique indexes ----------
  const uq = db.collection('uniq');
  await uq.createIndex({ key: 1 }, { unique: true });
  await uq.createIndex({ serial: 1 }, { unique: true, partialFilterExpression: { serial: { $type: 'string' } } });
  await uq.insertOne({ key: 'A', serial: 'S1' });
  let err = null;
  try { await uq.insertOne({ key: 'A' }); } catch (e) { err = e; }
  check('unique violation -> code 11000 with keyPattern', err && err.code === 11000 && err.keyPattern.key === 1, err && { code: err.code, kp: err.keyPattern });
  await uq.insertOne({ key: 'B' });
  await uq.insertOne({ key: 'C' });
  check('missing values do not collide on partial unique', (await uq.countDocuments({})) === 3);
  err = null;
  try { await uq.updateOne({ key: 'C' }, { $set: { serial: 'S1' } }); } catch (e) { err = e; }
  check('unique violation on update', err && err.code === 11000, err && err.message);

  // ---------- aggregation ----------
  const agg = await col.aggregate([
    { $match: { n: { $type: 'number' } } },
    { $group: { _id: { $cond: [{ $gte: ['$n', 2] }, 'big', 'small'] }, total: { $sum: '$n' }, count: { $sum: 1 }, last: { $last: '$id' } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  check('aggregate $match/$group/$cond/$sort', JSON.stringify(agg) === JSON.stringify([{ _id: 'big', total: 5.5, count: 2, last: 'c' }, { _id: 'small', total: 1, count: 2, last: 'f' }]), agg);
  const unwound = await col.aggregate([{ $match: { id: 'a' } }, { $unwind: '$members' }, { $project: { _id: 0, email: '$members.email' } }]).toArray();
  check('aggregate $unwind/$project', unwound.length === 2 && unwound[1].email === 'q@x.com', unwound);
  check('distinct flattens arrays', (await col.distinct('tags')).sort().join() === 'x,y,z');
  const names = (await db.listCollections().toArray()).map(c => c.name);
  check('listCollections', names.includes('items') && names.includes('uniq') && !names.includes('_pgdoc_indexes'), names);
} finally {
  await db.dropDatabase();
  await client.close();
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}pgdoc: ${passed}/${passed + failed} passed${failed ? `, ${failed} failed` : ''}\x1b[0m`);
process.exitCode = failed ? 1 : 0;
