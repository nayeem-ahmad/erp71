'use client';

import { useEffect } from 'react';

/**
 * Registers the offline-POS service worker, once.
 *
 * `register()` on a script that is already registered resolves with the
 * existing registration and fetches nothing, so calling it on every load is
 * free. The browser keeps the worker current on its own: it re-checks `/sw.js`
 * on navigation, bypassing the HTTP cache, and installs a new worker whenever
 * the bytes differ — which is why `sw.js` carries a version in `CACHE_NAME`.
 *
 * This used to unregister every registration and register again on every page
 * load, to shake off a v1 worker that cached `/_next/` assets. That ran a fresh
 * install, with its pre-cache requests, at the busiest moment of every load.
 * The current worker never touches `/_next/` and takes over as soon as it
 * installs (`skipWaiting` + `clients.claim`), so a broken worker is fixed by
 * shipping a new `sw.js`, not by tearing down the good one each time.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[ServiceWorkerRegistrar] Registration failed:', err);
    });
  }, []);

  return null;
}
