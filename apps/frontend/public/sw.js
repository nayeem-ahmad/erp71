// Service Worker for Retail POS Offline Support
// Bumped whenever the caching *strategy* changes, so the activate handler drops
// the entries the old strategy left behind — and since the browser only
// installs a new worker when these bytes change, a bump is also what ships a
// change to clients at all. v3 cached every public asset cache-first and
// forever: a new logo or favicon only appeared on a hard reload (which bypasses
// the SW) and the next ordinary reload served the old one back. v5 stopped
// answering API calls and pre-caches the POS under its real URL.
const CACHE_NAME = 'retail-pos-v5';

// Pages fetched into the cache at install, so a reload with no connection
// still has a POS to come back to.
//
// Only `/sales/pos`: it is the one screen built to work offline (sales queue in
// IndexedDB, products from the products-cache), and a cashier usually reaches
// it through in-app links — client-side navigations this worker never sees as
// a page load, so the navigation handler below would never cache it. The list
// used to be `/` and `/dashboard/pos`. The latter is a permanent redirect to
// `/sales/pos`, so it was stored under the old URL, where a reload of the POS
// never looks — and a redirected response cannot answer a navigation anyway.
// `/` is the front door, which only reads the session and moves on.
//
// Taken once per install, i.e. per version of this file rather than per deploy,
// so the copy can predate the latest release; every full load of `/sales/pos`
// replaces it through the navigation handler.
const PRECACHE_URLS = ['/sales/pos'];

// ── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Take over immediately — don't wait for old SW to release clients
  self.skipWaiting();
  event.waitUntil(Promise.all([precache(), routeApiPastWorker(event)]));
});

function precache() {
  return caches.open(CACHE_NAME).then((cache) =>
    Promise.all(
      PRECACHE_URLS.map((url) =>
        fetch(url)
          .then((response) => {
            // A redirected or failed response could never answer the offline
            // reload it is kept for, so it is not worth a cache entry.
            if (response.ok && !response.redirected) return cache.put(url, response);
            console.warn('[SW] Pre-cache skipped:', url, response.status);
          })
          .catch((err) => {
            // Non-fatal: the install must not fail over an offline extra.
            console.warn('[SW] Pre-cache failed:', url, err);
          })
      )
    )
  );
}

// Where the browser supports it (the static routing API, Chromium 123+), tell
// it at install that API calls never come to this worker, so it doesn't have to
// start the worker just to have the fetch handler below decline them. Every
// other browser gets the same result, one step later, from that handler.
function routeApiPastWorker(event) {
  if (typeof event.addRoutes !== 'function' || typeof URLPattern !== 'function') {
    return Promise.resolve();
  }
  try {
    return event
      .addRoutes({ condition: { urlPattern: new URLPattern({ pathname: '/api/*' }) }, source: 'network' })
      .catch((err) => console.warn('[SW] API route not registered:', err));
  } catch (err) {
    console.warn('[SW] API route not registered:', err);
    return Promise.resolve();
  }
}

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Next.js internal assets — never intercept, let browser handle directly
  if (url.pathname.startsWith('/_next/')) {
    return;
  }

  // Next.js App Router navigation data (React Server Component payloads and
  // route prefetches) is fetched from the route URL itself — not under /_next/.
  // These MUST reach the network untouched: serving a cached payload from a
  // previous deployment makes the client router detect a build mismatch and
  // fall back to a full page reload on every navigation. Never cache them.
  if (
    request.headers.get('RSC') === '1' ||
    request.headers.get('Next-Router-Prefetch') === '1' ||
    url.searchParams.has('_rsc')
  ) {
    return;
  }

  // API calls go straight to the network: no respondWith, so the worker adds
  // nothing to the request. They used to be answered through it, and since the
  // app calls the API on its own origin that would be every call. Nothing is
  // lost offline: the page sees a failed fetch (it used to see a made-up 503
  // `{ error: 'offline' }`, which the POS did not recognise as a network
  // failure) and queues the sale in IndexedDB. Queued sales are posted by
  // syncPendingSales below, whose requests never reach this handler (a
  // worker's own fetches skip it), and by useOfflineSync's syncNow in the page,
  // which takes this early return like any other API call.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests: serve cached shell if available
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          return networkResponse;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Branding assets — logo, favicons, app icons, the manifest. These live at
  // stable, unhashed URLs, so cache-first pins whatever was fetched first and a
  // rebrand never reaches anyone. Network-first instead: the cache is only a
  // fallback for genuinely offline loads.
  if (isBrandingAsset(url)) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok && url.origin === self.location.origin) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          }
          return networkResponse;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // Everything else same-origin and unhashed: stale-while-revalidate. Serves
  // instantly from cache (and offline), but always refreshes the entry in the
  // background so a stale copy survives at most one load.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((networkResponse) => {
          // Only cache same-origin successful responses
          if (
            networkResponse.ok &&
            url.origin === self.location.origin
          ) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          }
          return networkResponse;
        })
        .catch((err) => {
          if (cached) return cached;
          throw err;
        });

      return cached || network;
    })
  );
});

// Stable-URL brand artwork that must never be pinned to a stale copy.
function isBrandingAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  return (
    path.startsWith('/logo/') ||
    path === '/favicon.ico' ||
    path === '/manifest.webmanifest' ||
    /^\/(apple-)?icon(-\d+x?\d*)?\.(png|svg|ico)$/.test(path)
  );
}

// ── Message ───────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'pos-sync') {
    event.waitUntil(syncPendingSales());
  }
});

// ── IndexedDB helpers (SW scope) ──────────────────────────────────────────────
function openSwDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pos-offline', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending-sales')) {
        db.createObjectStore('pending-sales', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('products-cache')) {
        db.createObjectStore('products-cache', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteFromStore(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Sync pending sales ─────────────────────────────────────────────────────────
async function syncPendingSales() {
  let db;
  try {
    db = await openSwDb();
  } catch (err) {
    console.error('[SW] Failed to open IndexedDB:', err);
    return;
  }

  const pendingSales = await getAllFromStore(db, 'pending-sales');
  if (pendingSales.length === 0) return;

  let anySuccess = false;

  for (const sale of pendingSales) {
    const { authToken, tenantId, id, ...salePayload } = sale;

    try {
      const response = await fetch('/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify(salePayload),
      });

      if (response.ok) {
        await deleteFromStore(db, 'pending-sales', id);
        anySuccess = true;
      } else {
        console.warn('[SW] Sale sync failed with status:', response.status);
      }
    } catch (err) {
      console.warn('[SW] Sale sync network error:', err);
    }
  }

  if (anySuccess) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'sync-complete' });
    }
  }
}
