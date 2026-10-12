/**
 * Collection / cursor API (the subset of the MongoDB Node driver this app
 * uses) on top of one PostgreSQL table per collection:
 *
 *   CREATE TABLE <schema>."<collection>" (seq bigserial, _id text PRIMARY KEY, doc jsonb NOT NULL)
 *
 * Reads push filters (and, when exact, sort/skip/limit) down to SQL; writes
 * are row-locked read-modify-write transactions.
 */

const { encode, decode, clone, idKey, valuesEqual } = require('./bson');
const { matches, getPath, makeComparator, applyProjection } = require('./match');
const { applyUpdate, upsertSeed, ensureId, isOperatorUpdate } = require('./update');
const { runPipeline } = require('./aggregate');
const { Params, translate, orderBy } = require('./sql');

class FindCursor {
  constructor(collection, filter, options = {}) {
    this._c = collection;
    this._filter = filter || {};
    this._sort = options.sort || null;
    this._skip = options.skip || 0;
    this._limit = options.limit || 0;
    this._projection = options.projection || options.fields || null;
    this._maps = [];
    this._buffer = null;
  }

  sort(spec, dir) { this._sort = typeof spec === 'string' ? { [spec]: dir ?? 1 } : spec; return this; }
  skip(n) { this._skip = n; return this; }
  limit(n) { this._limit = n; return this; }
  project(p) { this._projection = p; return this; }
  map(fn) { this._maps.push(fn); return this; }
  batchSize() { return this; }
  maxTimeMS() { return this; }
  hint() { return this; }
  collation() { return this; }

  async toArray() {
    const rows = await this._c._select({ filter: this._filter, sort: this._sort, skip: this._skip, limit: this._limit });
    return rows.map(r => {
      let doc = applyProjection(r.doc, this._projection);
      for (const fn of this._maps) doc = fn(doc);
      return doc;
    });
  }

  async forEach(fn) { for (const doc of await this.toArray()) { if ((await fn(doc)) === false) break; } }
  async count() { return this._c.countDocuments(this._filter, { skip: this._skip, limit: this._limit }); }
  async _fill() { if (!this._buffer) this._buffer = await this.toArray(); }
  async hasNext() { await this._fill(); return this._buffer.length > 0; }
  async next() { await this._fill(); return this._buffer.length ? this._buffer.shift() : null; }
  async close() { this._buffer = []; }
  async *[Symbol.asyncIterator]() { for (const doc of await this.toArray()) yield doc; }
}

class AggregationCursor {
  constructor(collection, pipeline) {
    this._c = collection;
    this._pipeline = pipeline || [];
  }

  async toArray() {
    let stages = this._pipeline;
    let filter = {};
    if (stages[0] && stages[0].$match) {
      filter = stages[0].$match;
      stages = stages.slice(1);
    }
    const rows = await this._c._select({ filter });
    return runPipeline(rows.map(r => r.doc), stages);
  }

  async forEach(fn) { for (const doc of await this.toArray()) await fn(doc); }
  async next() { if (!this._buf) this._buf = await this.toArray(); return this._buf.shift() ?? null; }
  async *[Symbol.asyncIterator]() { for (const doc of await this.toArray()) yield doc; }
}

class Collection {
  constructor(db, name) {
    this.db = db;
    this.collectionName = name;
    this.namespace = `${db.databaseName}.${name}`;
  }

  get _table() { return this.db._tableRef(this.collectionName); }

  /**
   * Fetch matching rows as [{ key, doc }] (doc decoded).
   * Exact filters run fully in SQL; others are pre-filtered in SQL and
   * finished here.
   */
  async _select({ filter = {}, sort = null, skip = 0, limit = 0, forUpdate = false, client = null }) {
    await this.db._ensureTable(this.collectionName);
    const p = new Params();
    const t = translate(filter, p);
    const where = t.sql ? ` WHERE ${t.sql}` : '';
    const order = t.exact ? (sort ? orderBy(sort, p, this.db._schemaRef) : 'seq ASC') : null;
    const q = client || this.db._pool;

    if (t.exact && order) {
      let sql = `SELECT _id, doc FROM ${this._table}${where} ORDER BY ${order}`;
      if (limit) sql += ` LIMIT ${Math.max(0, parseInt(limit, 10))}`;
      if (skip) sql += ` OFFSET ${Math.max(0, parseInt(skip, 10))}`;
      if (forUpdate) sql += ' FOR UPDATE';
      const { text, values } = p.sql(sql);
      const { rows } = await q.query(text, values);
      return rows.map(r => ({ key: r._id, doc: decode(r.doc) }));
    }

    const { text, values } = p.sql(`SELECT _id, doc FROM ${this._table}${where} ORDER BY seq ASC${forUpdate ? ' FOR UPDATE' : ''}`);
    const { rows } = await q.query(text, values);
    let docs = rows.map(r => ({ key: r._id, doc: decode(r.doc) }));
    if (!t.exact) docs = docs.filter(r => matches(r.doc, filter));
    if (sort) {
      const cmp = makeComparator(sort);
      docs.sort((a, b) => cmp(a.doc, b.doc));
    }
    if (skip) docs = docs.slice(skip);
    if (limit) docs = docs.slice(0, limit);
    return docs;
  }

  // ----- reads -----

  find(filter, options) { return new FindCursor(this, filter, options); }

  async findOne(filter, options = {}) {
    const [doc] = await new FindCursor(this, filter, { ...options, limit: 1 }).toArray();
    return doc ?? null;
  }

  async countDocuments(filter = {}, options = {}) {
    await this.db._ensureTable(this.collectionName);
    const p = new Params();
    const t = translate(filter, p);
    if (t.exact && !options.skip && !options.limit) {
      const { text, values } = p.sql(`SELECT count(*)::int AS n FROM ${this._table}${t.sql ? ` WHERE ${t.sql}` : ''}`);
      const { rows } = await this.db._pool.query(text, values);
      return rows[0].n;
    }
    return (await this._select({ filter, skip: options.skip, limit: options.limit })).length;
  }

  async estimatedDocumentCount() { return this.countDocuments({}); }

  async distinct(field, filter = {}) {
    const rows = await this._select({ filter });
    const out = [];
    for (const { doc } of rows) {
      const v = getPath(doc, field);
      for (const item of Array.isArray(v) ? v : [v]) {
        if (item !== undefined && !out.some(o => valuesEqual(o, item))) out.push(item);
      }
    }
    return out;
  }

  aggregate(pipeline) { return new AggregationCursor(this, pipeline); }

  // ----- writes -----

  async insertOne(doc) {
    await this.db._ensureTable(this.collectionName);
    ensureId(doc);
    await this._insertRows(this.db._pool, [doc]);
    return { acknowledged: true, insertedId: doc._id };
  }

  async insertMany(docs, options = {}) {
    await this.db._ensureTable(this.collectionName);
    if (!docs.length) return { acknowledged: true, insertedCount: 0, insertedIds: {} };
    docs.forEach(ensureId);
    const insertedIds = Object.fromEntries(docs.map((d, i) => [i, d._id]));
    try {
      await this._insertRows(this.db._pool, docs);
      return { acknowledged: true, insertedCount: docs.length, insertedIds };
    } catch (error) {
      if (error.code !== 11000 || docs.length === 1) throw error;
      // Mongo semantics: ordered stops at the first duplicate, unordered skips duplicates
      let inserted = 0;
      let firstError = null;
      for (const d of docs) {
        try {
          await this._insertRows(this.db._pool, [d]);
          inserted += 1;
        } catch (e) {
          if (e.code !== 11000) throw e;
          firstError = firstError || e;
          if (options.ordered !== false) break;
        }
      }
      firstError.result = { insertedCount: inserted };
      firstError.insertedCount = inserted;
      throw firstError;
    }
  }

  async _insertRows(q, docs) {
    const keys = docs.map(d => idKey(d._id));
    const bodies = docs.map(d => JSON.stringify(encode(d)));
    try {
      await q.query(
        `INSERT INTO ${this._table} (_id, doc) SELECT k, d::jsonb FROM unnest($1::text[], $2::text[]) AS t(k, d)`,
        [keys, bodies]
      );
    } catch (error) {
      throw await this.db._mapError(error, this.collectionName, docs[0]);
    }
  }

  async _writeRow(client, key, doc) {
    try {
      await client.query(`UPDATE ${this._table} SET doc = $2::jsonb WHERE _id = $1`, [key, JSON.stringify(encode(doc))]);
    } catch (error) {
      throw await this.db._mapError(error, this.collectionName, doc);
    }
  }

  /** Shared implementation of update/replace/findOneAndUpdate. */
  async _modify(filter, update, { multi = false, upsert = false, sort = null, replace = false } = {}) {
    if (!replace && !isOperatorUpdate(update)) {
      throw Object.assign(new Error('Update document requires atomic operators'), { code: 9 });
    }
    await this.db._ensureTable(this.collectionName);
    return this.db._tx(async (client) => {
      const rows = await this._select({ filter, sort, limit: multi ? 0 : 1, forUpdate: true, client });
      if (!rows.length) {
        if (!upsert) return { matched: 0, modified: 0, before: null, after: null, upsertedId: null };
        const seed = upsertSeed(filter);
        let doc = replace ? { ...(seed._id !== undefined ? { _id: seed._id } : {}), ...clone(update) } : applyUpdate(seed, update, { filter, isInsert: true });
        doc = ensureId(doc);
        await this._insertRows(client, [doc]);
        return { matched: 0, modified: 0, before: null, after: doc, upsertedId: doc._id };
      }
      let modified = 0;
      let first = null;
      for (const { key, doc } of rows) {
        const next = applyUpdate(doc, update, { filter });
        if (next._id !== undefined && doc._id !== undefined && !valuesEqual(next._id, doc._id)) {
          throw Object.assign(new Error("Performing an update on the path '_id' would modify the immutable field '_id'"), { code: 66 });
        }
        if (!valuesEqual(next, doc)) {
          await this._writeRow(client, key, next);
          modified += 1;
        }
        if (!first) first = { before: doc, after: next };
      }
      return { matched: rows.length, modified, before: first.before, after: first.after, upsertedId: null };
    });
  }

  static _updateResult(r) {
    return {
      acknowledged: true,
      matchedCount: r.matched,
      modifiedCount: r.modified,
      upsertedCount: r.upsertedId != null ? 1 : 0,
      upsertedId: r.upsertedId ?? null
    };
  }

  async updateOne(filter, update, options = {}) { return Collection._updateResult(await this._modify(filter, update, { upsert: options.upsert, sort: options.sort })); }
  async updateMany(filter, update, options = {}) { return Collection._updateResult(await this._modify(filter, update, { multi: true, upsert: options.upsert })); }
  async replaceOne(filter, replacement, options = {}) { return Collection._updateResult(await this._modify(filter, replacement, { upsert: options.upsert, replace: true })); }

  async _findOneAnd(filter, update, options, replace) {
    const r = await this._modify(filter, update, { upsert: options.upsert, sort: options.sort, replace });
    const after = options.returnDocument === 'after' || options.returnOriginal === false;
    const raw = after ? r.after : r.before;
    const value = raw ? applyProjection(raw, options.projection) : null;
    if (options.includeResultMetadata) return { value, ok: 1, lastErrorObject: { n: r.matched || (r.upsertedId ? 1 : 0), updatedExisting: r.matched > 0, upserted: r.upsertedId ?? undefined } };
    return value;
  }

  async findOneAndUpdate(filter, update, options = {}) { return this._findOneAnd(filter, update, options, false); }
  async findOneAndReplace(filter, replacement, options = {}) { return this._findOneAnd(filter, replacement, options, true); }

  async findOneAndDelete(filter, options = {}) {
    await this.db._ensureTable(this.collectionName);
    const doc = await this.db._tx(async (client) => {
      const [row] = await this._select({ filter, sort: options.sort, limit: 1, forUpdate: true, client });
      if (!row) return null;
      await client.query(`DELETE FROM ${this._table} WHERE _id = $1`, [row.key]);
      return row.doc;
    });
    const value = doc ? applyProjection(doc, options.projection) : null;
    return options.includeResultMetadata ? { value, ok: 1 } : value;
  }

  async deleteOne(filter = {}) {
    await this.db._ensureTable(this.collectionName);
    const deleted = await this.db._tx(async (client) => {
      const [row] = await this._select({ filter, limit: 1, forUpdate: true, client });
      if (!row) return 0;
      await client.query(`DELETE FROM ${this._table} WHERE _id = $1`, [row.key]);
      return 1;
    });
    return { acknowledged: true, deletedCount: deleted };
  }

  async deleteMany(filter = {}) {
    await this.db._ensureTable(this.collectionName);
    const p = new Params();
    const t = translate(filter, p);
    if (t.exact) {
      const { text, values } = p.sql(`DELETE FROM ${this._table}${t.sql ? ` WHERE ${t.sql}` : ''}`);
      const { rowCount } = await this.db._pool.query(text, values);
      return { acknowledged: true, deletedCount: rowCount };
    }
    const rows = await this._select({ filter });
    if (!rows.length) return { acknowledged: true, deletedCount: 0 };
    const { rowCount } = await this.db._pool.query(`DELETE FROM ${this._table} WHERE _id = ANY($1::text[])`, [rows.map(r => r.key)]);
    return { acknowledged: true, deletedCount: rowCount };
  }

  async bulkWrite(ops) {
    const result = { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, upsertedIds: {}, insertedIds: {} };
    for (const [i, op] of ops.entries()) {
      const [[type, a]] = Object.entries(op);
      if (type === 'insertOne') { const r = await this.insertOne(a.document); result.insertedCount += 1; result.insertedIds[i] = r.insertedId; continue; }
      if (type === 'deleteOne' || type === 'deleteMany') { const r = await this[type](a.filter); result.deletedCount += r.deletedCount; continue; }
      const r = type === 'replaceOne'
        ? await this.replaceOne(a.filter, a.replacement, { upsert: a.upsert })
        : await this[type](a.filter, a.update, { upsert: a.upsert });
      result.matchedCount += r.matchedCount;
      result.modifiedCount += r.modifiedCount;
      if (r.upsertedId != null) { result.upsertedCount += 1; result.upsertedIds[i] = r.upsertedId; }
    }
    return result;
  }

  // ----- indexes / admin -----

  async createIndex(keys, options = {}) { return this.db._createIndex(this.collectionName, keys, options); }
  async createIndexes(specs) { return Promise.all(specs.map(s => this.createIndex(s.key, s))); }
  async indexes() { return this.db._listIndexes(this.collectionName); }
  listIndexes() { return { toArray: () => this.indexes() }; }
  async dropIndex(name) { return this.db._dropIndex(this.collectionName, name); }
  async drop() { return this.db._dropTable(this.collectionName); }
}

module.exports = { Collection, FindCursor, AggregationCursor };
