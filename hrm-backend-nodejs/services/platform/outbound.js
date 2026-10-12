/**
 * Outbound HTTP for webhooks and chat integrations, with SSRF protection.
 *
 * - Only http(s) URLs, no credentials in the URL, standard ports only
 *   unless private targets are allowed.
 * - Every address the hostname resolves to is checked at CONNECT time (custom
 *   DNS lookup), so DNS rebinding can't redirect a delivery to an internal host.
 * - Redirects are never followed.
 * - Private / loopback / link-local / metadata addresses are rejected unless
 *   ALLOW_PRIVATE_WEBHOOKS=true (development and tests only).
 */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const allowPrivate = () => process.env.ALLOW_PRIVATE_WEBHOOKS === 'true';

class UnsafeUrlError extends Error {}

// ============= ADDRESS CHECKS =============

const ipv4ToInt = (ip) => ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
const inV4Range = (ip, base, bits) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
};

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
];

function isPrivateAddress(address) {
  if (!address) return true;
  let ip = String(address).replace(/^\[|\]$/g, '').toLowerCase();
  if (ip.includes('%')) ip = ip.split('%')[0];
  if (net.isIPv4(ip)) return PRIVATE_V4.some(([base, bits]) => inV4Range(ip, base, bits));
  if (!net.isIPv6(ip)) return true;
  // IPv4-mapped / translated IPv6 (::ffff:10.0.0.1, ::ffff:a00:1)
  const mapped = /^(?:0*:)*:?ffff:(?:0+:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);
  const hexMapped = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (ip === '::' || ip === '::1') return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true;   // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true;   // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true;   // multicast
  if (ip.startsWith('64:ff9b:')) return true;      // NAT64 (may map to private v4)
  if (ip.startsWith('2001:db8:')) return true;     // documentation
  return false;
}

/**
 * Validate a target URL. Returns the parsed URL or throws UnsafeUrlError.
 * Hostname resolution is checked later, at connect time.
 */
function assertSafeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new UnsafeUrlError('Enter a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError('Only http:// and https:// URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('URLs must not contain credentials');
  if (String(raw).length > 2048) throw new UnsafeUrlError('URL is too long');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new UnsafeUrlError('URL has no host');
  if (!allowPrivate()) {
    if (url.protocol !== 'https:') throw new UnsafeUrlError('Only https:// URLs are allowed');
    if (url.port && !['443'].includes(url.port)) throw new UnsafeUrlError('Only the standard HTTPS port is allowed');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !net.isIP(host)) {
      throw new UnsafeUrlError('Private or internal addresses are not allowed');
    }
    if (net.isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError('Private or internal addresses are not allowed');
  }
  return url;
}

/** dns.lookup replacement that refuses private addresses (unless allowed). */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!allowPrivate() && list.some(a => isPrivateAddress(a.address))) {
      return callback(new UnsafeUrlError(`Refusing to connect to private address for ${hostname}`));
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

// ============= REQUEST =============

/**
 * POST a body to a URL. Resolves { status, body, duration_ms } (never follows
 * redirects; response body truncated to 2 KB). Rejects on network errors,
 * timeouts and unsafe targets.
 */
function postJson(rawUrl, bodyString, headers = {}, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = assertSafeUrl(rawUrl);
    } catch (error) {
      return reject(error);
    }
    const lib = url.protocol === 'https:' ? https : http;
    const started = Date.now();
    const req = lib.request(url, {
      method: 'POST',
      lookup: guardedLookup,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'User-Agent': 'Xeno-HR-Webhooks/1.0',
        ...headers
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        if (size < 2048) chunks.push(c);
        size += c.length;
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8').slice(0, 2048),
        duration_ms: Date.now() - started
      }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Timed out after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(bodyString);
  });
}

module.exports = { isPrivateAddress, assertSafeUrl, postJson, UnsafeUrlError, allowPrivate };
