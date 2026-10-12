// PWA helpers (PL-1): service-worker registration, the install prompt, and
// clearing cached API responses so one user's data is never served to the next.
import { registerSW } from 'virtual:pwa-register';

// Runtime cache names used by the service worker (see vite.config.js)
export const PRIVATE_CACHES = ['api-cache'];

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn(deferredPrompt));

/** Call once at startup (main.jsx), before React renders. */
export function initPwa() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // show our own prompt instead of the mini-infobar
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    registerSW({ immediate: true });
  }
}

/** Subscribe to install-prompt availability. Returns an unsubscribe function. */
export function onInstallPromptChange(fn) {
  listeners.add(fn);
  fn(deferredPrompt);
  return () => listeners.delete(fn);
}

/** Current deferred install prompt (or null) — snapshot for useSyncExternalStore. */
export const getInstallPrompt = () => deferredPrompt;

/** Show the browser's install dialog. Resolves 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  notify();
  promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' }));
  return choice?.outcome || 'dismissed';
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

export const isIos = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as Mac; detect touch support to tell it apart
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
};

/** Delete cached API responses (call on logout / login). Never throws. */
export async function clearPrivateCaches() {
  try {
    if (typeof caches === 'undefined') return;
    await Promise.all(PRIVATE_CACHES.map(name => caches.delete(name)));
  } catch { /* cache storage unavailable */ }
}
