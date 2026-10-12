/**
 * Value model for the PostgreSQL document store.
 *
 * Documents are stored as JSONB. Types JSON can't represent are tagged so
 * they round-trip exactly:  Date -> {"$date": ISO},  ObjectId -> {"$oid": hex},
 * Buffer -> {"$binary": base64},  NaN/Infinity -> {"$numberDouble": "..."},
 * RegExp -> {"$regex": src, "$options": flags}.
 *
 * Also defines Mongo's cross-type ordering and equality used by the query
 * matcher, sorting and update operators.
 */

const crypto = require('crypto');

// ============= ObjectId =============

const PROCESS_UNIQUE = crypto.randomBytes(5);
let counter = crypto.randomBytes(3).readUIntBE(0, 3);

class ObjectId {
  constructor(id) {
    if (id instanceof ObjectId) this._hex = id._hex;
    else if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) this._hex = id.toLowerCase();
    else if (id == null) this._hex = ObjectId.generate();
    else throw new TypeError(`Invalid ObjectId: ${id}`);
  }

  static generate() {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
    PROCESS_UNIQUE.copy(buf, 4);
    counter = (counter + 1) % 0xffffff;
    buf.writeUIntBE(counter, 9, 3);
    return buf.toString('hex');
  }

  static isValid(value) {
    return value instanceof ObjectId || (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value));
  }

  static createFromHexString(hex) { return new ObjectId(hex); }

  toHexString() { return this._hex; }
  toString() { return this._hex; }
  toJSON() { return this._hex; }
  equals(other) { return other != null && String(other instanceof ObjectId ? other._hex : other).toLowerCase() === this._hex; }
  getTimestamp() { return new Date(parseInt(this._hex.slice(0, 8), 16) * 1000); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return `new ObjectId("${this._hex}")`; }
}

// ============= encode / decode =============

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  !(v instanceof Date) && !(v instanceof ObjectId) && !(v instanceof RegExp) && !Buffer.isBuffer(v) && !(v instanceof Uint8Array);

/** JS value -> JSON-safe value (for JSONB). undefined becomes null, functions are dropped. */
function encode(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return { $date: isNaN(value) ? null : value.toISOString() };
  if (value instanceof ObjectId) return { $oid: value._hex };
  if (value instanceof RegExp) return { $regex: value.source, $options: value.flags };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { $binary: Buffer.from(value).toString('base64') };
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $numberDouble: String(value) };
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(v => (typeof v === 'function' ? null : encode(v)));
  if (typeof value === 'object') {
    if (typeof value.toBSON === 'function') return encode(value.toBSON());
    const out = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (typeof v === 'function') continue;
      out[key] = encode(v);
    }
    return out;
  }
  return value;
}

/** JSONB value -> JS value (revives tagged types). */
function decode(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const keys = Object.keys(value);
  if (keys.length === 1) {
    if (keys[0] === '$date') return value.$date === null ? new Date(NaN) : new Date(value.$date);
    if (keys[0] === '$oid') return new ObjectId(value.$oid);
    if (keys[0] === '$binary') return Buffer.from(value.$binary, 'base64');
    if (keys[0] === '$numberDouble') return Number(value.$numberDouble);
  }
  if (keys.length === 2 && '$regex' in value && '$options' in value) return new RegExp(value.$regex, value.$options);
  const out = {};
  for (const k of keys) out[k] = decode(value[k]);
  return out;
}

/** Deep clone keeping Date / ObjectId / Buffer types. */
function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof ObjectId) return new ObjectId(value._hex);
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const k of Object.keys(value)) out[k] = clone(value[k]);
  return out;
}

/** Stable primary-key text for an _id value. */
const idKey = (id) => JSON.stringify(encode(id));

// ============= ordering / equality (Mongo semantics) =============

// MinKey < null < numbers < strings < objects < arrays < binary < ObjectId < booleans < dates < regex
function typeRank(v) {
  if (v === undefined || v === null) return 1;
  if (typeof v === 'number' || typeof v === 'bigint') return 2;
  if (typeof v === 'string') return 3;
  if (v instanceof Date) return 9;
  if (v instanceof ObjectId) return 7;
  if (v instanceof RegExp) return 11;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return 6;
  if (Array.isArray(v)) return 5;
  if (typeof v === 'boolean') return 8;
  return 4;
}

function compareValues(a, b) {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 1: return 0;
    case 2: return Number(a) - Number(b);
    case 3: return a < b ? -1 : a > b ? 1 : 0;
    case 6: return Buffer.compare(Buffer.from(a), Buffer.from(b));
    case 7: return a._hex < b._hex ? -1 : a._hex > b._hex ? 1 : 0;
    case 8: return (a ? 1 : 0) - (b ? 1 : 0);
    case 9: return (a.getTime() || 0) - (b.getTime() || 0);
    case 11: return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    case 5: {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const c = compareValues(a[i], b[i]);
        if (c) return c;
      }
      return a.length - b.length;
    }
    default: {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
        const c = compareValues(a[ka[i]], b[kb[i]]);
        if (c) return c;
      }
      return ka.length - kb.length;
    }
  }
}

function valuesEqual(a, b) {
  if (a === b) return true;
  const ra = typeRank(a);
  if (ra !== typeRank(b)) return false;
  if (ra === 1) return true;
  if (ra === 4) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && valuesEqual(a[k], b[k]));
  }
  if (ra === 5) return a.length === b.length && a.every((v, i) => valuesEqual(v, b[i]));
  return compareValues(a, b) === 0;
}

module.exports = { ObjectId, isPlainObject, encode, decode, clone, idKey, typeRank, compareValues, valuesEqual };
