/**
 * PostgreSQL document store — client and database objects.
 *
 * A "database" (DB_NAME) is a PostgreSQL schema inside the database named in
 * DATABASE_URL; every collection is a table in that schema, created on first
 * use. Unique indexes become PostgreSQL unique expression indexes (violations
 * surface as Mongo-style `code: 11000` errors); TTL indexes are honoured by
 * a sweeper that runs every minute.
 */

const crypto = require('crypto');
const { Pool } = require('pg');
const { Collection } = require('./collection');
const { InlineParams, translate, jpPath, validPath } = require('./sql');
const { getPath } = require('./match');

const META = '_pgdoc_indexes';
const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lockKey = (s) => crypto.createHash('sha1').update(s).digest().readInt32BE(0);

/** PostgreSQL identifiers are limited to 63 bytes. */
const pgIdent = (name) => {
  if (Buffer.byteLength(name) <= 63) return name;
  const hash = crypto.createHash('sha1').update(name).digest('hex').slice(0, 10);
  return `${name.slice(0, 50)}_${hash}`;
};

const FUNCTIONS = (s) => `
CREATE OR REPLACE FUNCTION ${s}.pgdoc_rank(v jsonb) RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN 1
    WHEN jsonb_typeof(v) = 'number' THEN 2
    WHEN jsonb_typeof(v) = 'string' THEN 3
    WHEN jsonb_typeof(v) = 'array' THEN 5
    WHEN jsonb_typeof(v) = 'boolean' THEN 8
    WHEN v ? '$date' THEN 9
    WHEN v ? '$oid' THEN 7
    ELSE 4 END $f$;
CREATE OR REPLACE FUNCTION ${s}.pgdoc_num(v jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE WHEN jsonb_typeof(v) = 'number' THEN v::numeric END $f$;
CREATE OR REPLACE FUNCTION ${s}.pgdoc_str(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE
    WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}'
    WHEN jsonb_typeof(v) = 'object' AND v ? '$date' THEN v ->> '$date'
    WHEN jsonb_typeof(v) = 'object' AND v ? '$oid' THEN v ->> '$oid'
  END $f$;
CREATE OR REPLACE FUNCTION ${s}.pgdoc_bool(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE WHEN jsonb_typeof(v) = 'boolean' THEN v::boolean END $f$;
-- Sort key: arrays sort by their smallest element ascending / largest descending (Mongo semantics)
CREATE OR REPLACE FUNCTION ${s}.pgdoc_key(v jsonb, d int) RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE WHEN v IS NULL OR jsonb_typeof(v) <> 'array' THEN v
    WHEN jsonb_array_length(v) = 0 THEN NULL
    ELSE (SELECT e FROM jsonb_array_elements(v) AS e ORDER BY
      CASE WHEN d = 1 THEN ${s}.pgdoc_rank(e) END ASC, CASE WHEN d = 1 THEN ${s}.pgdoc_num(e) END ASC,
      CASE WHEN d = 1 THEN ${s}.pgdoc_str(e) END COLLATE "C" ASC, CASE WHEN d = 1 THEN ${s}.pgdoc_bool(e) END ASC,
      CASE WHEN d = -1 THEN ${s}.pgdoc_rank(e) END DESC, CASE WHEN d = -1 THEN ${s}.pgdoc_num(e) END DESC,
      CASE WHEN d = -1 THEN ${s}.pgdoc_str(e) END COLLATE "C" DESC, CASE WHEN d = -1 THEN ${s}.pgdoc_bool(e) END DESC
      LIMIT 1)
  END $f$;
CREATE TABLE IF NOT EXISTS ${s}.${META} (
  collection text NOT NULL,
  name text NOT NULL,
  pg_name text NOT NULL,
  keys jsonb NOT NULL,
  options jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (collection, name)
);`;

class Db {
  constructor(client, name) {
    this.client = client;
    this.databaseName = name;
    this._pool = client.pool;
    this._schemaRef = quoteIdent(name);
    this._collections = new Map();
    this._tables = new Map(); // collection -> Promise
    this._schemaReady = null;
    this._indexMeta = new Map(); // pg index name -> { collection, name, keys }
    this._ttl = new Map(); // `${collection}:${name}` -> { collection, field, seconds }
  }

  collection(name) {
    if (!this._collections.has(name)) this._collections.set(name, new Collection(this, name));
    return this._collections.get(name);
  }

  _tableRef(name) { return `${this._schemaRef}.${quoteIdent(pgIdent(name))}`; }

  /** Run fn(client) inside a transaction. */
  async _tx(fn) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Serialise DDL across processes with an advisory lock. */
  async _ddl(key, sql) {
    return this._tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [lockKey(key)]);
      return c.query(sql);
    });
  }

  _ensureSchema() {
    if (!this._schemaReady) {
      this._schemaReady = this._ddl(`schema:${this.databaseName}`, `CREATE SCHEMA IF NOT EXISTS ${this._schemaRef};${FUNCTIONS(this._schemaRef)}`)
        .catch((error) => { this._schemaReady = null; throw error; });
    }
    return this._schemaReady;
  }

  _ensureTable(name) {
    if (!this._tables.has(name)) {
      const table = this._tableRef(name);
      const gin = quoteIdent(pgIdent(`${name}__doc_gin`));
      const p = this._ensureSchema()
        .then(() => this._ddl(`table:${this.databaseName}.${name}`, `
          CREATE TABLE IF NOT EXISTS ${table} (seq bigserial, _id text PRIMARY KEY, doc jsonb NOT NULL);
          CREATE INDEX IF NOT EXISTS ${gin} ON ${table} USING gin (doc jsonb_path_ops);`))
        .catch((error) => { this._tables.delete(name); throw error; });
      this._tables.set(name, p);
    }
    return this._tables.get(name);
  }

  async _createIndex(collection, keys, options = {}) {
    await this._ensureTable(collection);
    const fields = Object.keys(keys);
    const name = options.name || fields.map(f => `${f}_${keys[f]}`).join('_');
    const pgName = pgIdent(`${collection}__${name}`);

    // Uniqueness is the only index behaviour the app depends on; lookups are served by the GIN index.
    if (options.unique && fields.every(validPath) && !Object.values(keys).some(v => typeof v === 'string')) {
      const exprs = fields.map(f => `(doc #>> ARRAY[${f.split('.').map(k => `'${k.replace(/'/g, "''")}'`).join(',')}])`).join(', ');
      const conds = [];
      if (options.partialFilterExpression) {
        const t = translate(options.partialFilterExpression, new InlineParams());
        if (t.exact && t.sql) conds.push(t.sql);
      }
      if (options.sparse) fields.forEach(f => conds.push(`doc @? '${`lax ${jpPath(f)}`.replace(/'/g, "''")}'::jsonpath`));
      await this._ddl(`index:${this.databaseName}.${pgName}`,
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(pgName)} ON ${this._tableRef(collection)} (${exprs})${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''}`);
    }
    if (options.expireAfterSeconds !== undefined && fields.length === 1) {
      this._ttl.set(`${collection}:${name}`, { collection, field: fields[0], seconds: Number(options.expireAfterSeconds) });
      this.client._startTtl();
    }
    this._indexMeta.set(pgName, { collection, name, keys });
    await this._pool.query(
      `INSERT INTO ${this._schemaRef}.${META} (collection, name, pg_name, keys, options) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (collection, name) DO UPDATE SET pg_name = EXCLUDED.pg_name, keys = EXCLUDED.keys, options = EXCLUDED.options`,
      [collection, name, pgName, JSON.stringify(keys), JSON.stringify({ unique: !!options.unique, expireAfterSeconds: options.expireAfterSeconds })]
    );
    return name;
  }

  async _listIndexes(collection) {
    await this._ensureTable(collection);
    const { rows } = await this._pool.query(`SELECT name, keys, options FROM ${this._schemaRef}.${META} WHERE collection = $1 ORDER BY name`, [collection]);
    return [{ v: 2, key: { _id: 1 }, name: '_id_' }, ...rows.map(r => ({ v: 2, key: r.keys, name: r.name, ...r.options }))];
  }

  async _dropIndex(collection, name) {
    const { rows } = await this._pool.query(`DELETE FROM ${this._schemaRef}.${META} WHERE collection = $1 AND name = $2 RETURNING pg_name`, [collection, name]);
    if (rows[0]) await this._pool.query(`DROP INDEX IF EXISTS ${this._schemaRef}.${quoteIdent(rows[0].pg_name)}`);
    this._ttl.delete(`${collection}:${name}`);
  }

  async _dropTable(collection) {
    await this._ensureSchema();
    await this._pool.query(`DROP TABLE IF EXISTS ${this._tableRef(collection)}`);
    await this._pool.query(`DELETE FROM ${this._schemaRef}.${META} WHERE collection = $1`, [collection]);
    this._tables.delete(collection);
    return true;
  }

  /** Convert a PostgreSQL unique violation into a Mongo-style duplicate key error. */
  async _mapError(error, collection, doc) {
    if (error.code !== '23505') return error;
    let meta = this._indexMeta.get(error.constraint);
    if (!meta && error.constraint && !error.constraint.endsWith('_pkey')) {
      const { rows } = await this._pool.query(`SELECT collection, name, keys FROM ${this._schemaRef}.${META} WHERE pg_name = $1`, [error.constraint]).catch(() => ({ rows: [] }));
      if (rows[0]) meta = rows[0];
    }
    const keyPattern = meta ? meta.keys : { _id: 1 };
    const keyValue = Object.fromEntries(Object.keys(keyPattern).map(k => [k, doc ? getPath(doc, k) : undefined]));
    return Object.assign(new Error(`E11000 duplicate key error collection: ${this.databaseName}.${collection} index: ${meta ? meta.name : '_id_'} dup key: ${JSON.stringify(keyValue)}`), {
      name: 'MongoServerError',
      code: 11000,
      codeName: 'DuplicateKey',
      keyPattern,
      keyValue,
      cause: error
    });
  }

  async _sweepTtl() {
    for (const { collection, field, seconds } of this._ttl.values()) {
      const cutoff = new Date(Date.now() - seconds * 1000).toISOString();
      const path = `lax ${jpPath(field)}."$date" ? (@ < ${JSON.stringify(cutoff)})`;
      await this._pool.query(`DELETE FROM ${this._tableRef(collection)} WHERE doc @? $1::jsonpath`, [path])
        .catch(err => console.error(`[pgdoc] TTL sweep failed for ${collection}:`, err.message));
    }
  }

  // ----- database-level API -----

  listCollections(filter = {}) {
    const run = async () => {
      await this._ensureSchema();
      const { rows } = await this._pool.query(
        `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_name <> $2 ORDER BY table_name`,
        [this.databaseName, META]
      );
      return rows.filter(r => !filter.name || r.name === filter.name).map(r => ({ name: r.name, type: 'collection' }));
    };
    return { toArray: run };
  }

  async createCollection(name) { await this._ensureTable(name); return this.collection(name); }

  async command(cmd) {
    if (cmd.ping) { await this._pool.query('SELECT 1'); return { ok: 1 }; }
    if (cmd.dropDatabase) { await this.dropDatabase(); return { ok: 1 }; }
    throw new Error(`Unsupported command: ${Object.keys(cmd).join(', ')}`);
  }

  async dropDatabase() {
    await this._pool.query(`DROP SCHEMA IF EXISTS ${this._schemaRef} CASCADE`);
    this._tables.clear();
    this._schemaReady = null;
    this._indexMeta.clear();
    this._ttl.clear();
    return true;
  }

  admin() { return { ping: () => this.command({ ping: 1 }) }; }
}

class PgDocClient {
  /** url: postgres://user:pass@host:5432/database  (pg Pool options may be passed as `options`) */
  constructor(url, options = {}) {
    this.url = url;
    this.pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 10, ...options });
    this.pool.on('error', (err) => console.error('[pgdoc] idle client error:', err.message));
    this._dbs = new Map();
    this._ttlTimer = null;
  }

  async connect() {
    const c = await this.pool.connect();
    c.release();
    return this;
  }

  db(name) {
    if (!name) throw new Error('A database (schema) name is required');
    if (!this._dbs.has(name)) this._dbs.set(name, new Db(this, name));
    return this._dbs.get(name);
  }

  _startTtl() {
    if (this._ttlTimer) return;
    this._ttlTimer = setInterval(() => {
      for (const db of this._dbs.values()) db._sweepTtl();
    }, 60 * 1000);
    this._ttlTimer.unref();
  }

  async close() {
    if (this._ttlTimer) clearInterval(this._ttlTimer);
    await this.pool.end();
  }
}

module.exports = { PgDocClient, Db };
