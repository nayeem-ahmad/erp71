'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Unregister any stale SW registrations first, then re-register the current one.
    // This ensures a broken/outdated SW never blocks _next/ static asset loading.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      const unregisterAll = registrations.map((r) => r.unregister());
      return Promise.all(unregisterAll);
    }).then(() => {
      return navigator.serviceWorker.register('/sw.js');
    }).catch((err) => {
      console.error('[ServiceWorkerRegistrar] Registration failed:', err);
    });
  }, []);

  return null;
}
