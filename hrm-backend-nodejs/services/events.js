/**
 * Domain events. Modules call emitEvent() when something notable happens
 * (e.g. 'employee.exited', 'payroll.run.locked', 'candidate.hired').
 *
 * The platform module (PL-6/PL-7) delivers these to outbound webhooks and
 * chat integrations (Slack / Microsoft Teams) — see services/platform/delivery.js.
 * Emitting never throws and never blocks the request.
 */

const listeners = [];

/** Register a listener: fn(name, payload, meta). Used by the platform module. */
function onEvent(fn) {
  listeners.push(fn);
}

// Platform delivery listener, registered lazily on first emit so this file
// has no load-time dependency on the platform module (and no require cycles).
let platformListenerRegistered = false;
function ensurePlatformListener() {
  if (platformListenerRegistered) return;
  platformListenerRegistered = true;
  try {
    const { dispatchEvent } = require('./platform/delivery');
    listeners.push(dispatchEvent);
  } catch (error) {
    console.error('[events] platform delivery unavailable:', error.message);
  }
}

function emitEvent(name, payload = {}, meta = {}) {
  ensurePlatformListener();
  const event = { name, payload, meta: { ...meta, emitted_at: new Date() } };
  for (const fn of listeners) {
    Promise.resolve()
      .then(() => fn(event.name, event.payload, event.meta))
      .catch(err => console.error(`[events] listener failed for ${name}:`, err.message));
  }
}

module.exports = { emitEvent, onEvent };
