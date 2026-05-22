'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('[ServiceWorkerRegistrar] Registration failed:', err);
      });
    }
  }, []);

  return null;
}
