/**
 * Small in-memory sliding-window rate limiter for the public careers endpoints.
 * Per process only (good enough for a single backend instance); counters reset
 * on restart.
 */

const MAX_KEYS = 50000;

function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> timestamps (ascending)
  let lastSweep = Date.now();

  const prune = (key, now) => {
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };

  const sweep = (now) => {
    if (now - lastSweep < windowMs && hits.size < MAX_KEYS) return;
    lastSweep = now;
    for (const key of [...hits.keys()]) prune(key, now);
    // Still too many keys (e.g. a flood of spoofed addresses): drop the oldest
    if (hits.size >= MAX_KEYS) {
      const excess = hits.size - Math.floor(MAX_KEYS / 2);
      let i = 0;
      for (const key of hits.keys()) {
        if (i++ >= excess) break;
        hits.delete(key);
      }
    }
  };

  return {
    /** Whether another hit is allowed; does not record one. */
    check(key) {
      const now = Date.now();
      sweep(now);
      const list = prune(key, now);
      return {
        allowed: list.length < max,
        remaining: Math.max(0, max - list.length),
        retryAfterSec: list.length >= max ? Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000)) : 0
      };
    },
    hit(key) {
      const now = Date.now();
      const list = prune(key, now);
      list.push(now);
      hits.set(key, list);
    },
    reset() {
      hits.clear();
    }
  };
}

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|localhost)/i;
const normalizeIp = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '');

/**
 * Best guess at the client address. When the request arrives from a local /
 * private address (i.e. through the Nginx reverse proxy) the right-most
 * X-Forwarded-For entry — the one the proxy itself appended — is used, so a
 * client cannot dodge the limit by sending its own X-Forwarded-For header.
 */
function clientIp(req) {
  const socketIp = normalizeIp(req.socket?.remoteAddress || req.ip || 'unknown');
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && PRIVATE_IP.test(socketIp)) {
    const parts = String(forwarded).split(',').map(normalizeIp).filter(Boolean);
    if (parts.length) return parts[parts.length - 1].slice(0, 64);
  }
  return socketIp.slice(0, 64);
}

module.exports = { createRateLimiter, clientIp };
