/**
 * In-process evaluation of Mongo query documents, projections and sorts.
 *
 * This is the reference implementation of query semantics: SQL translation
 * (sql.js) only pre-filters rows, and anything it can't translate exactly is
 * decided here.
 */

const { ObjectId, isPlainObject, compareValues, valuesEqual } = require('./bson');

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isOperatorObject = (v) => isPlainObject(v) && Object.keys(v).length > 0 && Object.keys(v).every(k => k.startsWith('$'));

/**
 * All values reachable at `path` (dot notation), traversing arrays like Mongo.
 * `undefined` entries mark branches where the field is missing.
 */
function pathValues(doc, path) {
  const parts = typeof path === 'string' ? path.split('.') : path;
  const out = [];
  const walk = (value, i) => {
    if (i === parts.length) { out.push(value); return; }
    const part = parts[i];
    if (Array.isArray(value)) {
      if (/^\d+$/.test(part)) {
        const idx = Number(part);
        if (idx < value.length) walk(value[idx], i + 1);
        else out.push(undefined);
        return;
      }
      let any = false;
      for (const el of value) {
        if (isPlainObject(el)) { walk(el, i); any = true; }
      }
      if (!any) out.push(undefined);
      return;
    }
    if (isPlainObject(value) && hasOwn(value, part)) walk(value[part], i + 1);
    else out.push(undefined);
  };
  walk(doc, 0);
  return out;
}

/** Single value at a dot path, no array traversal except numeric indexes (for sort / update / projection). */
function getPath(doc, path) {
  let cur = doc;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(part)) {
      const vals = cur.map(el => (isPlainObject(el) ? el[part] : undefined)).filter(v => v !== undefined);
      return vals.length ? vals : undefined;
    }
    if (typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// ----- per-value operator tests -----

const sameBracket = (a, b) => {
  const num = (v) => typeof v === 'number';
  if (num(a) && num(b)) return true;
  if (typeof a === 'string' && typeof b === 'string') return true;
  if (a instanceof Date && b instanceof Date) return true;
  if (a instanceof ObjectId && b instanceof ObjectId) return true;
  if (typeof a === 'boolean' && typeof b === 'boolean') return true;
  if (Array.isArray(a) && Array.isArray(b)) return true;
  if (isPlainObject(a) && isPlainObject(b)) return true;
  return false;
};

/** Candidate values for element-wise operators: the value itself plus its elements when it's an array. */
const expand = (values) => {
  const out = [];
  for (const v of values) {
    out.push(v);
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
};

function eqMatch(values, target) {
  if (target instanceof RegExp) return regexMatch(values, target);
  if (target === null) return expand(values).some(v => v === undefined || v === null);
  return expand(values).some(v => v !== undefined && valuesEqual(v, target));
}

function regexMatch(values, re) {
  return expand(values).some(v => {
    if (typeof v !== 'string') return false;
    re.lastIndex = 0;
    return re.test(v);
  });
}

const toRegExp = (pattern, options = '') => {
  if (pattern instanceof RegExp) {
    const flags = [...new Set((pattern.flags + options).replace(/[^imsu]/g, ''))].join('');
    return new RegExp(pattern.source, flags);
  }
  return new RegExp(pattern, String(options).replace(/[^imsu]/g, ''));
};

const TYPE_ALIASES = {
  double: 'number', int: 'number', long: 'number', decimal: 'number', number: 'number',
  string: 'string', object: 'object', array: 'array', bool: 'bool', boolean: 'bool',
  date: 'date', null: 'null', objectId: 'objectId', regex: 'regex', binData: 'binData'
};
const NUMERIC_TYPES = { 1: 'number', 2: 'string', 3: 'object', 4: 'array', 5: 'binData', 7: 'objectId', 8: 'bool', 9: 'date', 10: 'null', 11: 'regex', 16: 'number', 18: 'number', 19: 'number' };
const typeName = (v) => {
  if (v === null) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (v instanceof Date) return 'date';
  if (v instanceof ObjectId) return 'objectId';
  if (v instanceof RegExp) return 'regex';
  if (Buffer.isBuffer(v)) return 'binData';
  if (Array.isArray(v)) return 'array';
  return 'object';
};

function opMatch(values, op, arg, opsObj) {
  switch (op) {
    case '$eq': return eqMatch(values, arg);
    case '$ne': return !eqMatch(values, arg);
    case '$gt': case '$gte': case '$lt': case '$lte':
      return expand(values).some(v => {
        if (v === undefined || !sameBracket(v, arg)) return false;
        const c = compareValues(v, arg);
        return op === '$gt' ? c > 0 : op === '$gte' ? c >= 0 : op === '$lt' ? c < 0 : c <= 0;
      });
    case '$in':
      if (!Array.isArray(arg)) throw new Error('$in needs an array');
      return arg.some(t => eqMatch(values, t));
    case '$nin':
      if (!Array.isArray(arg)) throw new Error('$nin needs an array');
      return !arg.some(t => eqMatch(values, t));
    case '$exists': return arg ? values.some(v => v !== undefined) : values.every(v => v === undefined);
    case '$regex': return regexMatch(values, toRegExp(arg, opsObj.$options));
    case '$options': return true;
    case '$size': return values.some(v => Array.isArray(v) && v.length === arg);
    case '$all': return Array.isArray(arg) && arg.every(t => eqMatch(values, t));
    case '$type': {
      const wanted = (Array.isArray(arg) ? arg : [arg]).map(t => (typeof t === 'number' ? NUMERIC_TYPES[t] : TYPE_ALIASES[t]));
      return values.some(v => v !== undefined && (wanted.includes(typeName(v)) || (Array.isArray(v) && v.some(e => wanted.includes(typeName(e))))));
    }
    case '$mod': return expand(values).some(v => typeof v === 'number' && v % arg[0] === arg[1]);
    case '$elemMatch':
      return values.some(v => Array.isArray(v) && v.some(el => (isOperatorObject(arg) ? fieldMatch([el], arg) : isPlainObject(el) && matches(el, arg))));
    case '$not':
      return !(arg instanceof RegExp ? regexMatch(values, arg) : fieldMatch(values, arg));
    default:
      throw new Error(`Unsupported query operator ${op}`);
  }
}

function fieldMatch(values, cond) {
  if (isOperatorObject(cond)) return Object.keys(cond).every(op => opMatch(values, op, cond[op], cond));
  return eqMatch(values, cond);
}

/** Does `doc` match the Mongo `filter`? */
function matches(doc, filter) {
  if (!filter) return true;
  for (const key of Object.keys(filter)) {
    const cond = filter[key];
    switch (key) {
      case '$and': if (!cond.every(f => matches(doc, f))) return false; break;
      case '$or': if (!cond.some(f => matches(doc, f))) return false; break;
      case '$nor': if (cond.some(f => matches(doc, f))) return false; break;
      case '$expr': {
        const { evalExpr } = require('./aggregate');
        if (!evalExpr(cond, doc)) return false;
        break;
      }
      case '$comment': break;
      case '$where':
        if (typeof cond === 'function' ? !cond.call(doc) : true) return false;
        break;
      default:
        if (!fieldMatch(pathValues(doc, key), cond)) return false;
    }
  }
  return true;
}

/**
 * Index of the first element of `arrayPath` matched by the filter, for the
 * positional `$` update operator.
 */
function positionalIndex(doc, filter, arrayPath) {
  const arr = getPath(doc, arrayPath);
  if (!Array.isArray(arr)) return -1;
  const conds = [];
  const collect = (f) => {
    for (const [k, v] of Object.entries(f || {})) {
      if (k === '$and') v.forEach(collect);
      else if (k === arrayPath && isOperatorObject(v) && v.$elemMatch) conds.push({ sub: null, cond: v.$elemMatch, elem: true });
      else if (k.startsWith(`${arrayPath}.`)) conds.push({ sub: k.slice(arrayPath.length + 1), cond: v });
      else if (k === arrayPath) conds.push({ sub: null, cond: v });
    }
  };
  collect(filter);
  if (!conds.length) return -1;
  return arr.findIndex(el => conds.every(({ sub, cond, elem }) => {
    if (elem) return isOperatorObject(cond) ? fieldMatch([el], cond) : isPlainObject(el) && matches(el, cond);
    return fieldMatch(sub ? pathValues(el, sub) : [el], cond);
  }));
}

// ----- sort -----

function sortKey(value, dir) {
  if (Array.isArray(value)) {
    if (!value.length) return undefined;
    return value.reduce((best, v) => (compareValues(v, best) * dir < 0 ? v : best));
  }
  return value;
}

function makeComparator(sort) {
  const spec = normalizeSort(sort);
  return (a, b) => {
    for (const [path, dir] of spec) {
      const c = compareValues(sortKey(getPath(a, path), dir), sortKey(getPath(b, path), dir));
      if (c) return c * dir;
    }
    return 0;
  };
}

function normalizeSort(sort) {
  if (!sort) return [];
  if (Array.isArray(sort)) {
    if (sort.length === 2 && typeof sort[0] === 'string' && !Array.isArray(sort[1])) return [[sort[0], dirOf(sort[1])]];
    return sort.map(s => (Array.isArray(s) ? [s[0], dirOf(s[1])] : [s, 1]));
  }
  if (typeof sort === 'string') return [[sort, 1]];
  return Object.entries(sort).map(([k, v]) => [k, dirOf(v)]);
}
const dirOf = (v) => (v === -1 || v === 'desc' || v === 'descending' ? -1 : 1);

// ----- projection -----

function applyProjection(doc, projection) {
  if (!projection || !Object.keys(projection).length) return doc;
  const entries = Object.entries(projection);
  const idSpec = hasOwn(projection, '_id') ? projection._id : 1;
  const fieldEntries = entries.filter(([k]) => k !== '_id');
  const inclusion = fieldEntries.some(([, v]) => v && v !== 0);

  if (inclusion) {
    const out = {};
    if (idSpec && doc._id !== undefined) out._id = doc._id;
    for (const [path, v] of fieldEntries) {
      if (!v) continue;
      copyPath(doc, out, path.split('.'));
    }
    return out;
  }
  const out = { ...doc };
  if (!idSpec) delete out._id;
  for (const [path, v] of fieldEntries) if (!v) removePath(out, path.split('.'));
  return out;
}

function copyPath(src, dst, parts) {
  const [head, ...rest] = parts;
  if (src == null || typeof src !== 'object' || !hasOwn(src, head)) return;
  if (!rest.length) { dst[head] = src[head]; return; }
  const val = src[head];
  if (Array.isArray(val)) {
    const prev = Array.isArray(dst[head]) ? dst[head] : [];
    dst[head] = val.map((el, i) => {
      if (!isPlainObject(el)) return undefined;
      const target = isPlainObject(prev[i]) ? prev[i] : {};
      copyPath(el, target, rest);
      return target;
    }).filter(v => v !== undefined);
  } else if (isPlainObject(val)) {
    dst[head] = isPlainObject(dst[head]) ? dst[head] : {};
    copyPath(val, dst[head], rest);
  }
}

function removePath(obj, parts) {
  const [head, ...rest] = parts;
  if (obj == null || typeof obj !== 'object' || !hasOwn(obj, head)) return;
  if (!rest.length) { delete obj[head]; return; }
  if (Array.isArray(obj[head])) obj[head] = obj[head].map(el => { if (isPlainObject(el)) { const c = { ...el }; removePath(c, rest); return c; } return el; });
  else if (isPlainObject(obj[head])) { obj[head] = { ...obj[head] }; removePath(obj[head], rest); }
}

module.exports = { matches, pathValues, getPath, positionalIndex, makeComparator, normalizeSort, applyProjection, isOperatorObject, toRegExp };
