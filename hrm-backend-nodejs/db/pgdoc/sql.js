/**
 * Mongo filter -> PostgreSQL WHERE clause over `doc jsonb`.
 *
 * Conditions become SQL/JSON path predicates (`doc @? '<jsonpath>'`), which
 * a GIN (jsonb_path_ops) index serves for equality. Lax mode gives Mongo's
 * array semantics for free: `{tags: 'x'}` / `{'members.email': e}` match
 * array elements, and jsonpath comparisons are type-bracketed like Mongo's.
 *
 * translate() returns { sql, exact }:
 *   sql   - SQL condition, or null for "no constraint"
 *   exact - true when sql selects exactly the matching rows; otherwise sql is
 *           a superset and the caller re-checks rows with match.js
 * Only well-understood cases are marked exact.
 */

const { ObjectId, isPlainObject, idKey } = require('./bson');
const { normalizeSort, isOperatorObject } = require('./match');

/**
 * Bind parameters. add() returns a placeholder token; sql() renumbers the
 * tokens actually present in the final text, so parameters from branches the
 * translator discarded are dropped.
 */
class Params {
  constructor() { this._values = []; }
  add(value, cast) {
    this._values.push(value);
    return `\u0000${this._values.length - 1}\u0000${cast ? `::${cast}` : ''}`;
  }
  sql(text) {
    const values = [];
    const seen = new Map();
    const out = text.replace(/\u0000(\d+)\u0000/g, (_, i) => {
      if (!seen.has(i)) { values.push(this._values[Number(i)]); seen.set(i, values.length); }
      return `$${seen.get(i)}`;
    });
    return { text: out, values };
  }
}

/** Inline (DDL) variant: values are rendered as escaped literals. */
class InlineParams {
  add(value, cast) {
    const lit = Array.isArray(value)
      ? `ARRAY[${value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')}]`
      : `'${String(value).replace(/'/g, "''")}'`;
    return `${lit}${cast ? `::${cast}` : ''}`;
  }
}

const TRUE = { sql: null, exact: true };
const INEXACT = { sql: null, exact: false };
const FALSE = { sql: 'FALSE', exact: true };

const validPath = (path) => path.length > 0 && path.split('.').every(p => p.length && !p.startsWith('$') && !/^\d+$/.test(p));
const jpPath = (path) => `$${path.split('.').map(k => `.${JSON.stringify(k)}`).join('')}`;

/** jsonpath literal + accessor suffix for a scalar operand, or null when not translatable. */
function scalar(v) {
  if (typeof v === 'string' || typeof v === 'boolean') return { lit: JSON.stringify(v), suffix: '' };
  if (typeof v === 'number') return Number.isFinite(v) ? { lit: JSON.stringify(v), suffix: '' } : null;
  if (v instanceof Date) return isNaN(v) ? null : { lit: JSON.stringify(v.toISOString()), suffix: '."$date"' };
  if (v instanceof ObjectId) return { lit: JSON.stringify(v.toHexString()), suffix: '."$oid"' };
  return null;
}

const pathExists = (p, path) => `doc @? ${p.add(`lax ${jpPath(path)}`, 'jsonpath')}`;

/** Equality on a field. */
function eq(p, path, v) {
  if (v === null || v === undefined) {
    // null matches missing or null; exact only for top-level fields (sub-document arrays are subtle)
    if (path.includes('.')) return INEXACT;
    return { sql: `(NOT ${pathExists(p, path)} OR doc @? ${p.add(`lax ${jpPath(path)} ? (@ == null)`, 'jsonpath')})`, exact: true };
  }
  const s = scalar(v);
  if (!s) return INEXACT; // regex, arrays and sub-documents are decided in JS
  return { sql: `doc @? ${p.add(`lax ${jpPath(path)}${s.suffix} ? (@ == ${s.lit})`, 'jsonpath')}`, exact: true };
}

function inList(p, path, list) {
  if (!Array.isArray(list)) return INEXACT;
  if (!list.length) return FALSE;
  const groups = new Map(); // suffix -> literals
  const extra = [];
  for (const v of list) {
    if (v === null || v === undefined) {
      const r = eq(p, path, null);
      if (!r.exact) return INEXACT;
      extra.push(r.sql);
      continue;
    }
    const s = scalar(v);
    if (!s) return INEXACT;
    if (!groups.has(s.suffix)) groups.set(s.suffix, []);
    groups.get(s.suffix).push(s.lit);
  }
  const parts = [...groups.entries()].map(([suffix, lits]) =>
    `doc @? ${p.add(`lax ${jpPath(path)}${suffix} ? (${lits.map(l => `@ == ${l}`).join(' || ')})`, 'jsonpath')}`);
  const all = [...parts, ...extra];
  return { sql: all.length === 1 ? all[0] : `(${all.join(' OR ')})`, exact: true };
}

function range(p, path, op, v) {
  const s = scalar(v);
  if (!s || v instanceof ObjectId) return INEXACT;
  const sym = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[op];
  return { sql: `doc @? ${p.add(`lax ${jpPath(path)}${s.suffix} ? (@ ${sym} ${s.lit})`, 'jsonpath')}`, exact: true };
}

const not = (r) => {
  if (!r.exact) return INEXACT;
  if (r.sql === null) return FALSE;
  if (r.sql === 'FALSE') return TRUE;
  return { sql: `NOT ${r.sql}`, exact: true };
};

function and(results) {
  const sqls = [];
  let exact = true;
  for (const r of results) {
    if (r.sql === 'FALSE' && r.exact) return FALSE;
    if (r.sql) sqls.push(r.sql);
    if (!r.exact) exact = false;
  }
  if (!sqls.length) return { sql: null, exact };
  return { sql: sqls.length === 1 ? sqls[0] : `(${sqls.join(' AND ')})`, exact };
}

function or(results) {
  if (!results.length) return INEXACT;
  const sqls = [];
  let exact = true;
  for (const r of results) {
    if (r.sql === null) return r.exact ? TRUE : INEXACT; // one branch matches everything (or unknown)
    if (r.sql !== 'FALSE') sqls.push(r.sql);
    if (!r.exact) exact = false;
  }
  if (!sqls.length) return { sql: 'FALSE', exact };
  return { sql: sqls.length === 1 ? sqls[0] : `(${sqls.join(' OR ')})`, exact };
}

const TYPE_JSON = { string: 'string', number: 'number', double: 'number', int: 'number', long: 'number', bool: 'boolean', boolean: 'boolean' };

function fieldOp(p, path, op, arg, cond) {
  switch (op) {
    case '$eq': return eq(p, path, arg);
    case '$ne': return not(eq(p, path, arg));
    case '$in': return inList(p, path, arg);
    case '$nin': return not(inList(p, path, arg));
    case '$gt': case '$gte': case '$lt': case '$lte': return range(p, path, op, arg);
    case '$exists': return arg ? { sql: pathExists(p, path), exact: true } : not({ sql: pathExists(p, path), exact: true });
    case '$type': {
      const t = TYPE_JSON[arg];
      if (!t) return INEXACT;
      return { sql: `doc @? ${p.add(`lax ${jpPath(path)} ? (@.type() == "${t}")`, 'jsonpath')}`, exact: true };
    }
    case '$not': return isOperatorObject(arg) ? not(field(p, path, arg)) : INEXACT;
    case '$options': return TRUE;
    default: return INEXACT; // $regex, $elemMatch, $size, $all, $mod ... decided in JS
  }
}

function field(p, path, cond) {
  if (!validPath(path)) return INEXACT;
  if (isOperatorObject(cond)) {
    if ('$regex' in cond) return INEXACT;
    return and(Object.keys(cond).map(op => fieldOp(p, path, op, cond[op], cond)));
  }
  return eq(p, path, cond);
}

/** Primary-key fast path for _id equality / $in. */
function idCondition(p, cond) {
  const simple = (v) => typeof v === 'string' || typeof v === 'number' || v instanceof ObjectId;
  if (simple(cond)) return { sql: `_id = ${p.add(idKey(cond))}`, exact: true };
  if (isOperatorObject(cond) && Object.keys(cond).length === 1) {
    if ('$eq' in cond && simple(cond.$eq)) return { sql: `_id = ${p.add(idKey(cond.$eq))}`, exact: true };
    if (Array.isArray(cond.$in) && cond.$in.every(simple)) {
      if (!cond.$in.length) return FALSE;
      return { sql: `_id = ANY(${p.add(cond.$in.map(idKey), 'text[]')})`, exact: true };
    }
  }
  return null;
}

function translate(filter, p) {
  if (!filter || !isPlainObject(filter)) return TRUE;
  const results = [];
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and') results.push(Array.isArray(cond) ? and(cond.map(f => translate(f, p))) : INEXACT);
    else if (key === '$or') results.push(Array.isArray(cond) ? or(cond.map(f => translate(f, p))) : INEXACT);
    else if (key === '$nor') results.push(Array.isArray(cond) ? not(or(cond.map(f => translate(f, p)))) : INEXACT);
    else if (key === '$comment') continue;
    else if (key.startsWith('$')) results.push(INEXACT);
    else if (key === '_id' && idCondition(p, cond)) results.push(idCondition(p, cond));
    else results.push(field(p, key, cond));
  }
  return and(results);
}

/** ORDER BY using Mongo's cross-type ordering; null when a sort path can't be pushed down. */
function orderBy(sort, p, schema = '') {
  const fn = (name) => `${schema ? `${schema}.` : ''}${name}`;
  const spec = normalizeSort(sort);
  const parts = [];
  for (const [path, dir] of spec) {
    if (!validPath(path)) return null;
    const d = dir === -1 ? 'DESC' : 'ASC';
    const v = `${fn('pgdoc_key')}(doc #> ${p.add(path.split('.'), 'text[]')}, ${dir === -1 ? -1 : 1})`;
    parts.push(`${fn('pgdoc_rank')}(${v}) ${d}`, `${fn('pgdoc_num')}(${v}) ${d}`, `${fn('pgdoc_str')}(${v}) COLLATE "C" ${d}`, `${fn('pgdoc_bool')}(${v}) ${d}`);
  }
  parts.push('seq ASC');
  return parts.join(', ');
}

module.exports = { Params, InlineParams, translate, orderBy, jpPath, validPath };
