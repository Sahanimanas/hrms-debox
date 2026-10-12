/**
 * Mongo update operators applied to a decoded document in memory.
 * The collection layer wraps this in a row-locked read-modify-write.
 */

const { ObjectId, isPlainObject, clone, compareValues, valuesEqual } = require('./bson');
const { matches, positionalIndex, makeComparator, isOperatorObject } = require('./match');

const isOperatorUpdate = (update) => Array.isArray(update) || (isPlainObject(update) && Object.keys(update).some(k => k.startsWith('$')));

const updateError = (msg) => Object.assign(new Error(msg), { code: 2, codeName: 'BadValue' });

/** Resolve the positional `$` in a path using the filter's first matched array element. */
function resolvePath(path, doc, filter) {
  if (!path.includes('.$')) return path;
  const parts = path.split('.');
  const i = parts.indexOf('$');
  const arrayPath = parts.slice(0, i).join('.');
  const idx = positionalIndex(doc, filter, arrayPath);
  if (idx < 0) throw updateError(`The positional operator did not find the match needed from the query (${path})`);
  parts[i] = String(idx);
  return parts.join('.');
}

/** Parent container and final key for a path, creating intermediate objects. */
function locate(doc, path, create) {
  const parts = path.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    let next = Array.isArray(cur) ? cur[Number(part)] : cur[part];
    if (next === undefined || next === null) {
      if (!create) return null;
      next = /^\d+$/.test(parts[i + 1]) && Array.isArray(cur) ? [] : {};
      if (Array.isArray(cur)) cur[Number(part)] = next; else cur[part] = next;
    } else if (typeof next !== 'object') {
      if (!create) return null;
      throw updateError(`Cannot create field '${parts[i + 1]}' in element {${part}: ${JSON.stringify(next)}}`);
    }
    cur = next;
  }
  const key = parts[parts.length - 1];
  return { parent: cur, key: Array.isArray(cur) && /^\d+$/.test(key) ? Number(key) : key };
}

const getAt = (doc, path) => {
  const loc = locate(doc, path, false);
  return loc ? loc.parent[loc.key] : undefined;
};
const setAt = (doc, path, value) => {
  const loc = locate(doc, path, true);
  if (Array.isArray(loc.parent) && typeof loc.key === 'number') {
    while (loc.parent.length < loc.key) loc.parent.push(null);
  }
  loc.parent[loc.key] = value;
};
const unsetAt = (doc, path) => {
  const loc = locate(doc, path, false);
  if (!loc) return;
  if (Array.isArray(loc.parent) && typeof loc.key === 'number') loc.parent[loc.key] = null;
  else delete loc.parent[loc.key];
};

const asArray = (doc, path, op) => {
  const cur = getAt(doc, path);
  if (cur === undefined || cur === null) {
    const arr = [];
    setAt(doc, path, arr);
    return arr;
  }
  if (!Array.isArray(cur)) throw updateError(`${op} requires an array at '${path}'`);
  return cur;
};

/** $pull condition test for one element. */
function pullMatches(el, cond) {
  if (cond instanceof RegExp) return typeof el === 'string' && cond.test(el);
  if (isOperatorObject(cond)) return matches({ v: el }, { v: cond });
  if (isPlainObject(cond)) return isPlainObject(el) ? matches(el, cond) : false;
  return valuesEqual(el, cond);
}

/**
 * Apply `update` to a copy of `doc`. `filter` is used for positional `$`.
 * `isInsert` enables $setOnInsert. Returns the new document.
 */
function applyUpdate(doc, update, { filter = {}, isInsert = false } = {}) {
  if (Array.isArray(update)) {
    // Pipeline update: $set / $addFields / $unset / $project / $replaceWith stages
    const { runPipeline } = require('./aggregate');
    const [out] = runPipeline([clone(doc)], update);
    if (doc._id !== undefined) out._id = doc._id;
    return out;
  }
  if (!isOperatorUpdate(update)) {
    const replacement = clone(update);
    if (doc._id !== undefined) replacement._id = doc._id;
    return replacement;
  }
  const out = clone(doc);
  for (const [op, fields] of Object.entries(update)) {
    if (!isPlainObject(fields)) throw updateError(`Modifier ${op} needs an object`);
    for (const [rawPath, rawValue] of Object.entries(fields)) {
      const path = resolvePath(rawPath, out, filter);
      if (path === '_id' && op !== '$setOnInsert' && !isInsert && op === '$set' && !valuesEqual(rawValue, doc._id)) {
        throw Object.assign(new Error("Performing an update on the path '_id' would modify the immutable field '_id'"), { code: 66 });
      }
      const value = clone(rawValue);
      switch (op) {
        case '$set': setAt(out, path, value); break;
        case '$setOnInsert': if (isInsert) setAt(out, path, value); break;
        case '$unset': unsetAt(out, path); break;
        case '$inc': case '$mul': {
          const cur = getAt(out, path);
          if (cur !== undefined && cur !== null && typeof cur !== 'number') throw updateError(`Cannot apply ${op} to a non-numeric value at '${path}'`);
          if (typeof value !== 'number') throw updateError(`${op} needs a number`);
          setAt(out, path, op === '$inc' ? (cur || 0) + value : (cur || 0) * value);
          break;
        }
        case '$min': case '$max': {
          const cur = getAt(out, path);
          const c = cur === undefined ? null : compareValues(value, cur);
          if (cur === undefined || (op === '$min' ? c < 0 : c > 0)) setAt(out, path, value);
          break;
        }
        case '$currentDate': setAt(out, path, new Date()); break;
        case '$rename': {
          const cur = getAt(out, path);
          if (cur !== undefined) { unsetAt(out, path); setAt(out, value, cur); }
          break;
        }
        case '$push': {
          const arr = asArray(out, path, '$push');
          if (isPlainObject(value) && '$each' in value) {
            const items = value.$each.map(clone);
            const pos = value.$position;
            if (pos === undefined) arr.push(...items);
            else arr.splice(pos < 0 ? Math.max(0, arr.length + pos) : pos, 0, ...items);
            if (value.$sort !== undefined) {
              arr.sort(isPlainObject(value.$sort) ? makeComparator(value.$sort) : (a, b) => compareValues(a, b) * value.$sort);
            }
            if (value.$slice !== undefined) {
              const s = value.$slice;
              const kept = s >= 0 ? arr.slice(0, s) : arr.slice(s);
              arr.splice(0, arr.length, ...kept);
            }
          } else arr.push(value);
          break;
        }
        case '$addToSet': {
          const arr = asArray(out, path, '$addToSet');
          const items = isPlainObject(value) && '$each' in value ? value.$each : [value];
          for (const item of items) if (!arr.some(e => valuesEqual(e, item))) arr.push(clone(item));
          break;
        }
        case '$pull': {
          const cur = getAt(out, path);
          if (Array.isArray(cur)) setAt(out, path, cur.filter(el => !pullMatches(el, value)));
          break;
        }
        case '$pullAll': {
          const cur = getAt(out, path);
          if (Array.isArray(cur)) setAt(out, path, cur.filter(el => !value.some(v => valuesEqual(el, v))));
          break;
        }
        case '$pop': {
          const cur = getAt(out, path);
          if (Array.isArray(cur) && cur.length) { if (value === -1) cur.shift(); else cur.pop(); }
          break;
        }
        default:
          throw updateError(`Unsupported update operator ${op}`);
      }
    }
  }
  return out;
}

/** Starting document for an upsert: the equality conditions of the filter. */
function upsertSeed(filter) {
  const seed = {};
  const take = (f) => {
    for (const [k, v] of Object.entries(f || {})) {
      if (k === '$and') v.forEach(take);
      else if (k.startsWith('$')) continue;
      else if (isOperatorObject(v)) { if ('$eq' in v) setAt(seed, k, clone(v.$eq)); }
      else if (!(v instanceof RegExp)) setAt(seed, k, clone(v));
    }
  };
  take(filter);
  return seed;
}

const ensureId = (doc) => {
  if (doc._id === undefined || doc._id === null) doc._id = new ObjectId();
  return doc;
};

module.exports = { applyUpdate, upsertSeed, ensureId, isOperatorUpdate };
