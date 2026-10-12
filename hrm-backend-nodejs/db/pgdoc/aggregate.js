/**
 * Aggregation pipelines. A leading $match is pushed down to SQL by the
 * collection; the remaining stages run here.
 *
 * Stages: $match $group $sort $skip $limit $count $unwind $project $addFields
 * $set $unset $replaceRoot $sortByCount $facet.
 */

const { isPlainObject, clone, compareValues, valuesEqual } = require('./bson');
const { matches, getPath, makeComparator, applyProjection } = require('./match');

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fieldRef(path, doc, vars) {
  if (path.startsWith('$$')) {
    const [name, ...rest] = path.slice(2).split('.');
    const base = name === 'ROOT' || name === 'CURRENT' ? vars.ROOT : vars[name];
    return rest.length ? getPath(base, rest.join('.')) : base;
  }
  return getPath(doc, path.slice(1));
}

function evalExpr(expr, doc, vars = { ROOT: doc }) {
  if (typeof expr === 'string' && expr.startsWith('$')) return fieldRef(expr, doc, vars);
  if (Array.isArray(expr)) return expr.map(e => evalExpr(e, doc, vars));
  if (!isPlainObject(expr)) return expr;
  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0].startsWith('$')) return evalOperator(keys[0], expr[keys[0]], doc, vars);
  const out = {};
  for (const k of keys) out[k] = evalExpr(expr[k], doc, vars);
  return out;
}

const args = (arg, doc, vars) => (Array.isArray(arg) ? arg : [arg]).map(a => evalExpr(a, doc, vars));
const truthy = (v) => !(v === false || v === null || v === undefined || v === 0);

function evalOperator(op, arg, doc, vars) {
  switch (op) {
    case '$literal': return arg;
    case '$sum': {
      const vals = args(arg, doc, vars);
      const flat = vals.length === 1 && Array.isArray(vals[0]) ? vals[0] : vals;
      return flat.reduce((s, v) => (isNum(v) ? s + v : s), 0);
    }
    case '$avg': {
      const vals = args(arg, doc, vars);
      const flat = (vals.length === 1 && Array.isArray(vals[0]) ? vals[0] : vals).filter(isNum);
      return flat.length ? flat.reduce((a, b) => a + b, 0) / flat.length : null;
    }
    case '$max': case '$min': {
      const vals = args(arg, doc, vars);
      const flat = (vals.length === 1 && Array.isArray(vals[0]) ? vals[0] : vals).filter(v => v !== null && v !== undefined);
      if (!flat.length) return null;
      return flat.reduce((best, v) => ((op === '$max' ? compareValues(v, best) > 0 : compareValues(v, best) < 0) ? v : best));
    }
    case '$add': {
      const vals = args(arg, doc, vars);
      if (vals.some(v => v === null || v === undefined)) return null;
      const date = vals.find(v => v instanceof Date);
      const total = vals.reduce((s, v) => s + (v instanceof Date ? v.getTime() : v), 0);
      return date ? new Date(total) : total;
    }
    case '$subtract': {
      const [a, b] = args(arg, doc, vars);
      if (a == null || b == null) return null;
      if (a instanceof Date && b instanceof Date) return a - b;
      if (a instanceof Date) return new Date(a.getTime() - b);
      return a - b;
    }
    case '$multiply': { const vals = args(arg, doc, vars); return vals.some(v => v == null) ? null : vals.reduce((p, v) => p * v, 1); }
    case '$divide': { const [a, b] = args(arg, doc, vars); return a == null || b == null ? null : a / b; }
    case '$mod': { const [a, b] = args(arg, doc, vars); return a == null || b == null ? null : a % b; }
    case '$abs': { const [a] = args(arg, doc, vars); return a == null ? null : Math.abs(a); }
    case '$round': {
      const [a, places = 0] = args(arg, doc, vars);
      if (a == null) return null;
      const f = 10 ** places;
      return Math.round(a * f) / f;
    }
    case '$floor': { const [a] = args(arg, doc, vars); return a == null ? null : Math.floor(a); }
    case '$ceil': { const [a] = args(arg, doc, vars); return a == null ? null : Math.ceil(a); }
    case '$eq': case '$ne': case '$gt': case '$gte': case '$lt': case '$lte': case '$cmp': {
      const [a, b] = args(arg, doc, vars);
      const c = compareValues(a === undefined ? null : a, b === undefined ? null : b);
      if (op === '$eq') return valuesEqual(a === undefined ? null : a, b === undefined ? null : b);
      if (op === '$ne') return !valuesEqual(a === undefined ? null : a, b === undefined ? null : b);
      if (op === '$cmp') return Math.sign(c);
      return op === '$gt' ? c > 0 : op === '$gte' ? c >= 0 : op === '$lt' ? c < 0 : c <= 0;
    }
    case '$and': return args(arg, doc, vars).every(truthy);
    case '$or': return args(arg, doc, vars).some(truthy);
    case '$not': return !truthy(args(arg, doc, vars)[0]);
    case '$cond': {
      const [c, t, f] = Array.isArray(arg) ? arg : [arg.if, arg.then, arg.else];
      return truthy(evalExpr(c, doc, vars)) ? evalExpr(t, doc, vars) : evalExpr(f, doc, vars);
    }
    case '$ifNull': {
      const vals = Array.isArray(arg) ? arg : [arg];
      for (const v of vals) {
        const r = evalExpr(v, doc, vars);
        if (r !== null && r !== undefined) return r;
      }
      return null;
    }
    case '$switch': {
      for (const b of arg.branches) if (truthy(evalExpr(b.case, doc, vars))) return evalExpr(b.then, doc, vars);
      return evalExpr(arg.default, doc, vars);
    }
    case '$in': { const [v, arr] = args(arg, doc, vars); return Array.isArray(arr) && arr.some(e => valuesEqual(e, v)); }
    case '$size': { const [a] = args(arg, doc, vars); return Array.isArray(a) ? a.length : null; }
    case '$arrayElemAt': { const [a, i] = args(arg, doc, vars); return Array.isArray(a) ? a[i < 0 ? a.length + i : i] : null; }
    case '$first': { const [a] = args(arg, doc, vars); return Array.isArray(a) ? a[0] : null; }
    case '$last': { const [a] = args(arg, doc, vars); return Array.isArray(a) ? a[a.length - 1] : null; }
    case '$concatArrays': return args(arg, doc, vars).reduce((acc, a) => (Array.isArray(a) ? acc.concat(a) : acc), []);
    case '$filter': {
      const input = evalExpr(arg.input, doc, vars);
      const as = arg.as || 'this';
      return Array.isArray(input) ? input.filter(item => truthy(evalExpr(arg.cond, doc, { ...vars, [as]: item }))) : null;
    }
    case '$map': {
      const input = evalExpr(arg.input, doc, vars);
      const as = arg.as || 'this';
      return Array.isArray(input) ? input.map(item => evalExpr(arg.in, doc, { ...vars, [as]: item })) : null;
    }
    case '$concat': { const vals = args(arg, doc, vars); return vals.some(v => v == null) ? null : vals.join(''); }
    case '$toLower': { const [s] = args(arg, doc, vars); return s == null ? '' : String(s).toLowerCase(); }
    case '$toUpper': { const [s] = args(arg, doc, vars); return s == null ? '' : String(s).toUpperCase(); }
    case '$toString': { const [s] = args(arg, doc, vars); return s == null ? null : s instanceof Date ? s.toISOString() : String(s); }
    case '$toInt': case '$toDouble': case '$toDecimal': case '$toLong': {
      const [s] = args(arg, doc, vars);
      if (s == null) return null;
      return op === '$toInt' || op === '$toLong' ? Math.trunc(Number(s)) : Number(s);
    }
    case '$substr': case '$substrCP': case '$substrBytes': {
      const [s, start, len] = args(arg, doc, vars);
      return s == null ? '' : String(s).substr(start, len < 0 ? undefined : len);
    }
    case '$split': { const [s, d] = args(arg, doc, vars); return s == null ? null : String(s).split(d); }
    case '$year': case '$month': case '$dayOfMonth': case '$hour': case '$minute': case '$dayOfWeek': {
      const [d] = args(arg && arg.date !== undefined ? arg.date : arg, doc, vars);
      if (!(d instanceof Date)) return null;
      return { $year: d.getUTCFullYear(), $month: d.getUTCMonth() + 1, $dayOfMonth: d.getUTCDate(), $hour: d.getUTCHours(), $minute: d.getUTCMinutes(), $dayOfWeek: d.getUTCDay() + 1 }[op];
    }
    case '$dateToString': {
      const d = evalExpr(arg.date, doc, vars);
      if (!(d instanceof Date)) return null;
      const pad = (n, w = 2) => String(n).padStart(w, '0');
      return (arg.format || '%Y-%m-%dT%H:%M:%S.%LZ')
        .replace('%Y', d.getUTCFullYear()).replace('%m', pad(d.getUTCMonth() + 1)).replace('%d', pad(d.getUTCDate()))
        .replace('%H', pad(d.getUTCHours())).replace('%M', pad(d.getUTCMinutes())).replace('%S', pad(d.getUTCSeconds()))
        .replace('%L', pad(d.getUTCMilliseconds(), 3));
    }
    case '$objectToArray': { const [o] = args(arg, doc, vars); return isPlainObject(o) ? Object.entries(o).map(([k, v]) => ({ k, v })) : null; }
    case '$type': {
      const [v] = args(arg, doc, vars);
      if (v === undefined) return 'missing';
      if (v === null) return 'null';
      if (Array.isArray(v)) return 'array';
      if (v instanceof Date) return 'date';
      return typeof v === 'number' ? 'double' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'string' : 'object';
    }
    default:
      throw new Error(`Unsupported aggregation expression ${op}`);
  }
}

// ----- accumulators -----

function accumulate(spec, docs) {
  const [[op, expr]] = Object.entries(spec);
  const values = () => docs.map(d => evalExpr(expr, d));
  switch (op) {
    case '$sum': return values().reduce((s, v) => (isNum(v) ? s + v : s), 0);
    case '$count': return docs.length;
    case '$avg': { const v = values().filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
    case '$min': case '$max': {
      const v = values().filter(x => x !== null && x !== undefined);
      if (!v.length) return null;
      return v.reduce((best, x) => ((op === '$max' ? compareValues(x, best) > 0 : compareValues(x, best) < 0) ? x : best));
    }
    case '$first': return docs.length ? (evalExpr(expr, docs[0]) ?? null) : null;
    case '$last': return docs.length ? (evalExpr(expr, docs[docs.length - 1]) ?? null) : null;
    case '$push': return values().filter(v => v !== undefined);
    case '$addToSet': {
      const out = [];
      for (const v of values()) if (v !== undefined && !out.some(o => valuesEqual(o, v))) out.push(v);
      return out;
    }
    default:
      throw new Error(`Unsupported accumulator ${op}`);
  }
}

// ----- stages -----

function runPipeline(docs, pipeline) {
  let cur = docs;
  for (const stage of pipeline) {
    const [[name, spec]] = Object.entries(stage);
    switch (name) {
      case '$match': cur = cur.filter(d => matches(d, spec)); break;
      case '$sort': cur = [...cur].sort(makeComparator(spec)); break;
      case '$skip': cur = cur.slice(spec); break;
      case '$limit': cur = cur.slice(0, spec); break;
      case '$count': cur = cur.length ? [{ [spec]: cur.length }] : []; break;
      case '$group': {
        const groups = new Map();
        for (const d of cur) {
          const id = evalExpr(spec._id, d);
          const key = JSON.stringify(require('./bson').encode(id === undefined ? null : id));
          if (!groups.has(key)) groups.set(key, { id: id === undefined ? null : id, docs: [] });
          groups.get(key).docs.push(d);
        }
        cur = [...groups.values()].map(g => {
          const out = { _id: g.id };
          for (const [field, acc] of Object.entries(spec)) if (field !== '_id') out[field] = accumulate(acc, g.docs);
          return out;
        });
        break;
      }
      case '$unwind': {
        const opts = typeof spec === 'string' ? { path: spec } : spec;
        const path = opts.path.slice(1);
        const next = [];
        for (const d of cur) {
          const arr = getPath(d, path);
          if (Array.isArray(arr) && arr.length) {
            arr.forEach((el, i) => {
              const copy = clone(d);
              setTop(copy, path, el);
              if (opts.includeArrayIndex) copy[opts.includeArrayIndex] = i;
              next.push(copy);
            });
          } else if (opts.preserveNullAndEmptyArrays) {
            const copy = clone(d);
            if (Array.isArray(arr)) setTop(copy, path, undefined);
            if (opts.includeArrayIndex) copy[opts.includeArrayIndex] = null;
            next.push(copy);
          } else if (arr !== undefined && arr !== null && !Array.isArray(arr)) {
            next.push(d);
          }
        }
        cur = next;
        break;
      }
      case '$project': {
        const computed = Object.entries(spec).some(([k, v]) => k !== '_id' && !(v === 0 || v === 1 || v === true || v === false));
        if (!computed) { cur = cur.map(d => applyProjection(d, spec)); break; }
        cur = cur.map(d => {
          const out = {};
          if (spec._id !== 0 && spec._id !== false) out._id = spec._id === undefined || spec._id === 1 || spec._id === true ? d._id : evalExpr(spec._id, d);
          for (const [k, v] of Object.entries(spec)) {
            if (k === '_id') continue;
            if (v === 1 || v === true) { const val = getPath(d, k); if (val !== undefined) setTop(out, k, val); } else if (v !== 0 && v !== false) setTop(out, k, evalExpr(v, d));
          }
          return out;
        });
        break;
      }
      case '$addFields': case '$set':
        cur = cur.map(d => {
          const out = clone(d);
          for (const [k, v] of Object.entries(spec)) setTop(out, k, evalExpr(v, d));
          return out;
        });
        break;
      case '$unset': {
        const fields = Array.isArray(spec) ? spec : [spec];
        cur = cur.map(d => applyProjection(d, Object.fromEntries(fields.map(f => [f, 0]))));
        break;
      }
      case '$replaceRoot': case '$replaceWith': cur = cur.map(d => evalExpr(spec.newRoot ?? spec, d)); break;
      case '$sortByCount':
        cur = runPipeline(cur, [{ $group: { _id: spec, count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
        break;
      case '$facet':
        cur = [Object.fromEntries(Object.entries(spec).map(([k, p]) => [k, runPipeline(cur, p)]))];
        break;
      default:
        throw new Error(`Unsupported aggregation stage ${name}`);
    }
  }
  return cur;
}

function setTop(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  if (value === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = value;
}

module.exports = { runPipeline, evalExpr };
