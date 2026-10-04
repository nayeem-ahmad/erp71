# Perceived Speed Plan — ERP71 on the current VPS

**Status:** approved 2026-10-04, in progress  
**Constraint:** the VPS stays as it is (`66.116.236.127`). No region move, no split into managed services.  
**Goal:** the app should *feel* fast to a shopkeeper in Bangladesh: screens appear quickly, clicks respond at once, and pages already visited show instantly.

The plan has four parts:
- [§1](#1-baseline-measured-2026-10-04): what was measured, and how.
- [§2](#2-where-the-time-goes): where the time actually goes.
- [§3](#3-the-plan)–[§7](#7-phase-3--edge-database-and-server): the work, in four phases (0–3).
- [§8](#8-rollout-ownership-and-rollback)–[§10](#10-out-of-scope-and-rejected-options): rollout, success criteria, and what was deliberately left out.

Every item gives the evidence for it, the change, the files involved, the risks, how to roll it back, and how to verify it.

---

## 1. Baseline (measured 2026-10-04)

Measured from a client in Dhaka (UTC+6) with `curl -w`. Read-only SSH on the VPS gave the server-side figures.

### Network

| Measure | Value |
|---|---|
| Round trip (ping), Dhaka → VPS | **250 ms**, steady (±1 ms) |
| Where the VPS is hosted | Oracle Cloud via webhostbox.net. The final hops are Oracle (AS registered in Austin, US) |
| New connection to `api.erp71.com`/`app.erp71.com` | TCP 0.25 s, TLS done at 0.52 s, first byte **0.78–0.88 s** |
| Request on an already-open connection | **0.29 s** |
| Same request made on the VPS itself (no distance) | 35–55 ms |
| HTTP version | HTTP/2; HTTP/3 advertised (`alt-svc: h3`) |
| Compression | gzip/zstd on, via the shared Hermes Caddy (`encode zstd gzip`) |
| `/_next/static/*` caching | `public, max-age=31536000, immutable` (correct) |

**Conclusion:** server work is about 15% of a request; distance is about 85%. Every round trip removed saves about 0.25 s.

### The server is idle

| Measure | Value |
|---|---|
| CPU / load | 4 vCPU, load average 0.00 / 0.00 / 0.00 |
| RAM | 7.9 GB total; 5.2 GB available; 1.1 GB swap in use (idle pages) |
| Disk | 81% (9.2 GB free of 49 GB). Docker build cache is most of the reclaimable space |
| ERP71 containers | frontend 359 MB, backend 363 MB, db 265 MB |
| Other apps on the box | profiles71, nayeem-portfolio, yt2mp3, jobxprss (web/api/assets/db), scrum71, Hermes proxy and static: **about 0.5 GB in total, about 0% CPU** |

**Conclusion:** the other apps are not slowing ERP71 down. Moving them off the box would not make ERP71 faster (see [§10](#10-out-of-scope-and-rejected-options)).

### Postgres

| Measure | Value |
|---|---|
| Database size | `retail_saas` 360 MB (profiles71's `nayeem_portfolio_db` is in the same container, 8 MB) |
| Cache hit rate | 99.9% |
| Settings | `shared_buffers` 160 MB, `work_mem` 4 MB, `effective_cache_size` 5 GB, `random_page_cost` 4, `max_connections` 100 |
| `pg_stat_statements` | **not installed**. No per-query timings exist |
| Prisma pool | no `connection_limit` in `DATABASE_URL`, so Prisma's default applies (cores × 2 + 1 ≈ 9) |

Tables read most by full scan (`pg_stat_user_tables`; statistics never reset):

| Table | Full scans | Index scans | Rows read by full scan | Live rows |
|---|---:|---:|---:|---:|
| `posting_events` | 60,776 | 222,070 | 1,363,941,154 | 64,064 |
| `InventoryMovement` | 14,232 | 1,019 | 496,347,406 | 99,601 |
| `PaymentRecord` | 75,898 | **4** | 380,708,134 | 11,540 |
| `CrmActivity` | 41,812 | 347,772 | 137,345,403 | 7,653 |
| `SaleItem` | 8,407 | 258,149 | 137,088,401 | 92,876 |
| `SalesReturnItem` | **349,882** | 43 | 135,186,806 | 838 |
| `PurchaseItem` | 18,176 | 84,908 | 78,612,734 | 20,558 |

`Tenant` (2.2 M full scans), `TenantUser` (1.5 M) and `UserStoreAccess` (486 k) are tiny tables, where a full scan is the right plan. Those counts show how often the auth chain runs, not missing indexes.

### Browser

| Page | Scripts | Gzipped JS |
|---|---:|---:|
| `/login` | 19 | **1.66 MB** |
| `/dashboard` | 31 | **1.92 MB** |

The biggest file, `chunks/5926-*.js`, is 4.87 MB raw / 1.25 MB gzipped and loads on every page. **3.66 MB of it is the translation catalogue for all 9 languages** (webpack module 15926 = `messageCatalog`). Every deploy changes the file names, so every user downloads all of it again after each release, and merges to `main` deploy automatically.

### API behaviour

| Behaviour | Evidence |
|---|---|
| Called on a separate domain | the browser calls `https://api.erp71.com` from `https://app.erp71.com` (`apps/frontend/src/lib/api.ts:138-139`, `NEXT_PUBLIC_API_BASE` set by `scripts/sync-erp71-env-urls.sh`) |
| A permission check ("CORS preflight") before nearly every call | `OPTIONS` returns 204 with **no `Access-Control-Max-Age`** (`apps/backend/src/main.ts:24-32`), so browsers keep the result for about 5 s, per exact URL. Each call carries `Authorization` + `x-tenant-id` + `x-store-id`, which makes the preflight mandatory |
| Rate limit | `x-ratelimit-limit: 20` per minute per IP on `/products` **and** `/auth/me`, live (`THROTTLE_LIMIT` unset; `app.module.ts:137-141`) |
| Server timings | `METRICS_TOKEN` unset, so `/api/v1/metrics` returns 404. No Sentry DSN, no Redis (Upstash variables unset) |
| Deploy outage | measured on the #766 deploy: backend container started 13:17:22Z, Nest ready 13:17:41Z, first 200 at 13:17:46Z. **About 19–24 s of 502s** while about 23 `sync:*` scripts and `prisma db push` run before `listen` |

### Side finding (not about speed)

BulkSMSBD has been unreachable from the VPS: about 300 failed health probes in 24 hours, and no alert recipients are configured. This is filed in `TODO.md` under Email & Notifications.

---

## 2. Where the time goes

### The dashboard today: about 9 round trips, one after another

Repeat visit with the JavaScript already cached and a valid token:

| Step | Round trips | ≈ s |
|---|---:|---:|
| HTML from `app.erp71.com` (TCP + TLS + request) | 3 | 0.88 |
| Download and run JS, hydrate | — | device-bound |
| New connection to `api.erp71.com` (TCP + TLS) | 2 | 0.50 |
| `/auth/me`: preflight + GET (the page waits on it, `dashboard/page.tsx:41`) | 2 | 0.50 |
| 9 dashboard calls: preflight + GET, shown only when all 9 finish (`RetailDashboard.tsx:138-150`) | 2 | 0.50 + slowest query |
| **Total network wait** | **≈ 9** | **≈ 2.4 s** |

The first load after more than an hour away also refreshes the access token first (`POST /auth/refresh`, preflight + POST): **+0.5 s**.

A first visit, or any visit after a deploy, also downloads **1.9 MB** of gzipped JS before any data call can start, because every fetch runs in `useEffect` after hydration.

### The dashboard after the plan

| Step | Round trips | ≈ s |
|---|---:|---:|
| HTML: TLS at the nearby Cloudflare edge, one trip to the origin on a warm connection ([P3.1](#p31-cloudflare-in-front-of-apperp71com)) | ~1 | 0.30 |
| `/auth/me`: shown from the client cache instantly, refreshed in the background ([P2.1](#p21-client-data-cache-starting-with-authme)) | 0 on the critical path | 0 |
| Dashboard cards: same domain, no preflight ([P1.1](#p11-serve-the-api-from-the-app-domain)), each card shows when its data lands ([P2.2](#p22-progressive-dashboard)) | 1 | 0.25 + query |
| **Total network wait** | **≈ 2** | **≈ 0.6 s** |

These estimates come from counting round trips, and each step's verification measures the real figure.

### Cost per click inside the app, today

Every route is dynamic, because the root layout calls `cookies()` (`src/app/layout.tsx:83`), and there is no `loading.tsx`. So a click shows nothing until the server responds. Then come the page's JS chunks, then the page's own preflight + GET pairs. That is roughly 1–1.5 s per click with no visible feedback for the first part.

---

## 3. The plan

| ID | Item | Phase | Gain | Effort | Needs a person for |
|---|---|---|---|---|---|
| P0 | Ship the `/auth/me` rate-limit fix | 0 | Removes 429s on the busiest call | done in code | merging dev → main |
| P1.1 | Serve the API from the app domain | 1 | −0.5 s per load, −0.25 s per call | M | — (Caddy change on the VPS) |
| P1.2 | Load only the active language | 1 | about −1 MB gzipped on every first load | M | — |
| P1.3 | Key the rate limit on the signed-in user | 1 | No forced waits for shared-IP shops | M | — |
| P1.4 | Service worker: install once, ignore API calls | 1 | Less work while the page loads | S | — |
| P1.5 | Pause polling in hidden tabs | 1 | Less background load and throttle use | S | — |
| P1.6 | Turn on server timings (`METRICS_TOKEN`) | 1 | Measurement for Phase 3 | S | — |
| P2.1 | Client data cache, starting with `/auth/me` | 2 | Revisited screens show instantly | L | — |
| P2.2 | Progressive dashboard | 2 | First cards about 0.5 s sooner | S | — |
| P2.3 | `loading.tsx` skeletons | 2 | Clicks respond immediately | S | — |
| P2.4 | Trim shared JS | 2 | Faster startup, smaller download | M | — |
| P3.1 | Cloudflare in front of `app.erp71.com` | 3 | TLS nearby, static files from the edge | M | Cloudflare account, nameservers |
| P3.2 | `pg_stat_statements` + Postgres tuning + indexes | 3 | Faster slow screens | M | Postgres restart window |
| P3.3 | Cache the auth chain; slim `/auth/me` | 3 | −3 to 6 queries per request | M | — |
| P3.4 | Browser → Cloudinary direct uploads | 3 | Faster image uploads | M | — |
| P3.5 | Shorter deploy outage | 3 | 19–24 s → a few seconds | M | — |
| P3.6 | Move nightly-type crons out of BDT business hours | 3 | Less contention at peak | S | — |

---

## 4. Phase 0 — ship what is already written

### P0. `/auth/me` rate-limit fix

- **Evidence:** live `x-ratelimit-limit: 20` on `/auth/me`. The app shell, about 35 call sites and several hooks call it on mount, so a shop behind one IP exhausts the budget between them. The shell then sends people to `/login`, where the `/auth/me` after a successful sign-in is refused too. People read that as "Too many sign-in attempts".
- **Change:** `@Throttle({ default: { ttl: 60_000, limit: 300 } })` on `GET /auth/me` (`apps/backend/src/auth/auth.controller.ts`). `auth.controller.throttle.spec.ts` covers it: 100 calls from one address pass, and an unbounded caller is still capped.
- **Ship:** commit to `dev`, open the release PR `dev` → `main`, merge after CI. Merging is done by a person; in auto mode it is blocked as "Merge Without Review".
- **Verify:** `curl -sD - -o /dev/null https://api.erp71.com/api/v1/auth/me | grep -i x-ratelimit-limit` reports `300`.

---

## 5. Phase 1 — fewer round trips, less to download

### P1.1 Serve the API from the app domain

- **Evidence:** [§1 API behaviour](#api-behaviour). A second connection costs about 0.5 s per fresh load, and the preflight costs about 0.25 s per call.
- **Design:** the reverse proxy sends `app.erp71.com/api/v1/*` straight to the backend container, and the browser calls its own domain. Same domain means no preflight and one shared HTTP/2 connection. Don't route it through the existing Next.js rewrite (`next.config.js:15-22`): that proxies every call through the Node frontend process, buffers request bodies (which breaks the 100 MB external-sync snapshot upload), and adds a hop.
- **Steps:**
  1. **Caddy (VPS, outside the repo):** in `/opt/hermes/caddy/Caddyfile`, replace the `app.erp71.com` block. Back up the file first, run `caddy validate`, then `caddy reload`:
     ```
     app.erp71.com {
     	encode zstd gzip
     	handle /api/v1/* {
     		reverse_proxy erp71-backend-1:4000 {
     			flush_interval -1
     		}
     	}
     	handle {
     		reverse_proxy erp71-frontend-1:3000
     	}
     }
     ```
     `flush_interval -1` keeps the support Server-Sent Events stream unbuffered. Mirror the same block in the in-repo `Caddyfile` (the `standalone-edge` profile) and in `docs/ops/deployment-runbook.md`, so the repo describes production.
  2. **Verify the route before switching the frontend:** `curl -s https://app.erp71.com/api/v1/health` returns the backend's JSON.
  3. **Frontend:** `scripts/sync-erp71-env-urls.sh` sets `NEXT_PUBLIC_API_BASE=https://app.erp71.com` (normalised to `…/api/v1` by `src/lib/api-base.ts`). Set it explicitly: when unset, `api.ts:139` falls back to the retired Render URL. Server-side public routes (`publicApiBase()`) reach the same domain through Caddy, as they reach `api.erp71.com` today.
  4. **Backend:** add `maxAge: 7200` to `enableCors` (`main.ts`). This doesn't help the app domain; it helps everything that stays cross-origin (the marketing host, any third-party embed).
  5. **Keep `api.erp71.com`** unchanged for the mobile app, API-key clients, payment callbacks (`BACKEND_PUBLIC_URL`) and anything already configured with it.
- **Risks:**
  - **Client IP:** the path is Caddy → backend, the same as `api.erp71.com`. The `X-Forwarded-For` handling and `trust proxy` walk (`common/trust-proxy.util.ts`) don't change.
  - **Service worker:** `public/sw.js` matches `pathname.startsWith('/api/')`. Same-origin calls would now go through it, so ship together with P1.4.
  - **Browser storage:** tokens are in `localStorage`, so there are no cookies and no CSRF change.
- **Rollback:** set `NEXT_PUBLIC_API_BASE` back to `https://api.erp71.com` and redeploy. The Caddy route is harmless to leave in place.
- **Verify:**
  - DevTools Network: API calls go to `app.erp71.com`, with no `OPTIONS` rows.
  - From Dhaka, a warm call costs about 0.29 s, not about 0.55 s.
  - `curl -s https://app.erp71.com/api/v1/health`.

### P1.2 Load only the active language

- **Evidence:**
  - `src/lib/localization/messages/index.ts` statically imports en, bn, ms, hi, de, fr, es, ur and ar into `messageCatalog`.
  - `src/lib/i18n.tsx:13` imports it into the root `I18nProvider`.
  - The result is 3.66 MB of JS (about 1 MB gzipped) on every page, including `/login`.
  - `src/lib/print/window-labels.ts` and `src/app/global-error.tsx` also import the whole catalogue.
- **Design:**
  - `en` stays bundled statically: it's the fallback, and English users wait for nothing.
  - Each other language becomes its own chunk, loaded with `import()` through a `loadMessages(locale)` function that caches its result.
  - The server already knows the language from the `LOCALE_COOKIE_NAME` cookie (`src/app/layout.tsx:84`) and renders HTML in it. On the client, `I18nProvider` reads the chosen dictionary with `React.use()` under a Suspense boundary. The server-rendered HTML stays on screen, in the right language, while the chunk loads, and hydration waits for it. Only first-time non-English visitors pay a short wait.
  - Switching language calls `loadMessages(next)` before `setLocale`, so the screen never shows a missing dictionary.
- **Files:**
  - `src/lib/localization/messages/index.ts`: split into a static `en` export and a `loaders` map of `() => import('./bn')`.
  - `src/lib/localization/load-messages.ts` (new): the cached loader.
  - `src/lib/i18n.tsx`: provider and context.
  - `src/app/global-error.tsx`: use `en`, or the cached dictionary if it's already loaded.
  - `src/lib/print/window-labels.ts`: same.
  - `catalog.test.ts` must still check every language for key parity: it can import the files directly, since tests aren't bundled.
- **Risks:**
  - A locale chunk fails to load (offline POS). Fall back to `en` and log it, never a blank screen.
  - The POS offline mode: the service worker should keep the active language chunk cached. `/_next/static` is already cache-first in `sw.js`, so check this.
- **Rollback:** revert the commit.
- **Verify:**
  - `/login` gzipped JS drops from 1.66 MB to ≤ 0.7 MB (same measurement as in [§9](#9-success-criteria)).
  - Pick Bangla and reload: no English flash, and no hydration warning in the console.
  - The language switcher still works.

### P1.3 Key the rate limit on the signed-in user

- **Evidence:** the default throttle is 20/min **per IP** (`app.module.ts:137-141`), and production doesn't override it. The dashboard alone makes about 18 calls. Several tills on one office line share that budget. `TODO.md` → Security → "The global 20/min per-IP default…" has the full analysis.
- **Design:** the throttler's tracker key is the **verified** user id when the request carries a valid access token, otherwise the IP. Verifying the JWT signature in the tracker (HMAC with `JWT_SECRET`, via the existing `JwtService`) stops a caller from creating unlimited buckets with fake `Authorization` headers.
  - Per user: 120/min default.
  - Per IP (unauthenticated, or as an overall ceiling): 600/min, so a shared office line serves a whole shop floor while one host still can't flood the API.
  - Routes with their own `@Throttle` (sign-in, password reset, `/auth/me`, `/auth/refresh`) keep their budgets.
- **Files:**
  - `src/common/api-throttler.guard.ts`: `getTracker`.
  - `src/app.module.ts`: throttler definitions.
  - A spec next to the existing `auth.controller.throttle.spec.ts`.
- **Risks:** an expensive endpoint that relied on the low default to protect itself. Check report endpoints and add an explicit `@Throttle` to any that need one.
- **Verify:**
  - Spec: 3 users behind one IP each make 100 calls a minute without a 429.
  - A forged token falls back to the IP bucket.
  - Live: `x-ratelimit-limit` on an authenticated call shows the per-user budget.

### P1.4 Service worker: install once, ignore API calls

- **Evidence:**
  - `src/components/ServiceWorkerRegistrar.tsx:11-17` unregisters every registration and registers `/sw.js` again **on every page load**.
  - Each install pre-caches `/` and `/dashboard/pos`, which redirects (308) to `/sales/pos` (`public/sw.js:7-20`). So every load costs extra requests at the worst moment.
  - `sw.js:61-74` also intercepts any URL whose path starts with `/api/`.
- **Change:**
  - Register once with `navigator.serviceWorker.register('/sw.js')`. The browser updates it when the bytes change; bump `CACHE_NAME` in `sw.js` to force it.
  - Pre-cache only the paths that are still real (`/sales/pos`), or nothing.
  - API requests (`/api/v1/*`) go straight to the network; the worker doesn't touch them. Keep the offline sale queue (`pos-db.ts`, `sw.js:161-251`): it posts through its own code path, so confirm that path still works.
- **Verify:**
  - DevTools → Application → Service Workers: one registration, which survives reloads.
  - Network on reload: no `sw.js` install and no pre-cache fetches.
  - Make an offline POS sale, reconnect, and confirm it syncs.

### P1.5 Pause polling in hidden tabs

- **Evidence:** about every 60 s, `NotificationBell.tsx:53-56`, `ChatBell.tsx:38-41` and `usePendingVoucherCount.ts:49-55` each poll, and none of them stops when the tab is hidden. The chat page (5 s), support page (5 s) and onboarding (4 s) poll faster still. Each poll costs a preflight plus a GET today and counts against the rate limit.
- **Change:**
  - Add one hook, `useVisibleInterval(callback, ms)` in `src/hooks/`: no ticks while `document.visibilityState === 'hidden'`, and one immediate tick when the tab becomes visible again.
  - Switch the three always-on polls and the fast page polls to it.
- **Verify:**
  - A hook unit test.
  - In DevTools, hide the tab for 3 minutes: no requests.

### P1.6 Turn on server timings

- **Change:**
  - Set `METRICS_TOKEN` in `/opt/erp71/.env.production`; it takes effect on the next deploy.
  - Document the scrape command in `docs/ops/uptime-monitoring.md`. It's already token-guarded (`system-health/metrics/metrics-token.guard.ts`).
- **Why now:** Phase 3's server work should be ranked by real per-route latency, not by reading source code. Start collecting a week before P3.2/P3.3.
- **Verify:** on the VPS, a curl of `/api/v1/metrics` with the token returns `http_request_duration_seconds` histograms.

---

## 6. Phase 2 — make it feel instant

### P2.1 Client data cache, starting with `/auth/me`

- **Evidence:** no client cache library is installed, and 269 of 275 `(app)` pages fetch in `useEffect` on every mount. `/auth/me` is called from about 35 sites:
  - `api.getMe()` in 34 files;
  - `getStores()`, which re-fetches `/auth/me` (`api.ts:2616-2622`);
  - `getCurrentUser()`;
  - hooks: `useTenantPlanFeatures` (16 users), `useTeamMemberOptions`, `useCanApproveCrmActivity`, `useLineItemFilters`.
- **Design:**
  - Add **TanStack Query v5** with one `QueryClient` in a client provider inside the root layout.
  - `useMe()` = `useQuery({ queryKey: ['me'], queryFn: api.getMe, staleTime: 60_000 })`. Concurrent callers share one request, revisits render from the cache, and a refresh runs in the background.
  - Invalidate `['me']` after anything that changes it: profile edit, workspace/store switch, role or permission edits, plan changes, sign-in, sign-out (sign-out clears the whole cache).
  - `getStores()` becomes a selector over `useMe()`.
  - Stage the call-site migration: first the layout, the dashboard and the hooks, then the remaining pages.
  - After `/auth/me`, move the dashboard queries (P2.2) and the five most-used list pages to `useQuery`, so going back to a screen is instant.
- **Not persisted** to storage in this phase: the in-memory cache lasts for the tab's session, which is where the repeated fetches happen. Persisting `me` across reloads is a later decision (stale permissions after a role change).
- **Files:**
  - `package.json` (`@tanstack/react-query`).
  - `src/lib/query-client.tsx` (new provider).
  - `src/hooks/use-me.ts` (new).
  - `src/app/layout.tsx` or `(app)/layout.tsx`: provider placement.
  - `src/lib/api.ts`: `getStores`.
  - The call sites listed above.
- **Risks:**
  - Stale permissions after a role change in another tab. Mitigation: `refetchOnWindowFocus`, plus invalidation on the existing workspace-epoch change in `(app)/layout.tsx`.
  - Tests that mock `api.getMe` need a `QueryClientProvider` wrapper; add a test helper.
- **Verify:**
  - One `/auth/me` request per navigation burst (DevTools filter).
  - Going back to the dashboard renders immediately from the cache.
  - Frontend jest stays green.

### P2.2 Progressive dashboard

- **Evidence:**
  - `dashboard/page.tsx:41` waits on its own `getMe` (a duplicate of the layout's) before choosing which dashboard variant to show.
  - `RetailDashboard.tsx:138-150` wraps 9 calls in one `Promise.allSettled`, so nothing shows until the slowest one returns.
  - `ProjectsDashboard.tsx:82` adds a third `getMe`.
- **Change:**
  - The variant comes from the cached `useMe()` (P2.1).
  - Each card or section owns its query and renders its own skeleton, then its data.
  - The previous-window comparison calls for the delta arrows load after the current-window ones, so they don't block the headline numbers.
- **Verify:**
  - Throttled to Slow 4G in DevTools, the first card shows before the last request finishes.
  - There are no duplicate `/auth/me` calls.

### P2.3 `loading.tsx` skeletons

- **Evidence:** no `loading.tsx` exists, and every route is dynamic.
- **Change:**
  - Add `loading.tsx` with the existing skeleton primitives to `src/app/(app)/` and to the busiest segments (dashboard, sales, purchases, inventory, customers, crm, accounting).
  - Next's `<Link>` prefetch fetches a dynamic route only down to the nearest `loading.tsx`, so these skeletons are also what makes a click feel instant.
  - Follow `docs/ui-design-guidelines.md`: use `PageShell` + `PageHeader` + skeleton, not a spinner.
- **Verify:** a click in the sidebar shows the skeleton within one frame; check in DevTools Performance.

### P2.4 Trim shared JS

Measure each change with `@next/bundle-analyzer` (add an `analyze` script) and the gzipped-JS command in [§9](#9-success-criteria).

| Item | Evidence | Change |
|---|---|---|
| Rich-text editor on every app page | The `@/components/ui` barrel re-exports `RichTextEditor` (`components/ui/index.ts:8`). The layout reaches it through `SetPasswordGate.tsx:11` and `TimeTracker.tsx:5`. Its top-level `Extension.create` stops tree-shaking | Remove it from the barrel; import it directly, wrapped in `next/dynamic({ ssr: false })` |
| Widgets loaded but rarely shown | `(app)/layout.tsx:14-18` imports AiChatWidget, VoiceNavWidget, FeedbackWidget, TimeTracker and TimerChip eagerly | Load them with `next/dynamic`, mounted only when enabled |
| xlsx + papaparse on 16 list pages | `lib/spreadsheet.ts:1-2` imports both statically, via `components/import-dialog.tsx` | `await import('xlsx')` inside the parse function, as `data-table/export-utils.ts` already does |
| Sentry Replay in `main-app` | `sentry.client.config.ts:3-15` | Load Replay with `Sentry.lazyLoadIntegration('replayIntegration')` once the page is idle, or drop it. Without a DSN, skip the client SDK entirely |
| Arabic font preloaded for everyone | `next/font` preloads Noto Sans Arabic (166 KB) | `preload: false` for Arabic. Keep Inter and Bengali, since Bangla product names appear even in the English UI |

Not in this phase, because it's larger: compiling `@erp71/shared-types` to ES modules so `zod` can be tree-shaken.

---

## 7. Phase 3 — edge, database and server

### P3.1 Cloudflare in front of `app.erp71.com`

- **Why:** a secure connection (TCP + TLS) costs two round trips before the first request. With Cloudflare, those happen at a nearby Cloudflare location, and Cloudflare reaches the VPS over connections it keeps open. Static JS (`immutable`) is served from that nearby location after the first fetch there, so a deploy's new files are downloaded from the VPS once per location, not once per user.
- **Needs a person:** a Cloudflare account, and moving the `erp71.com` nameservers to Cloudflare. A proxied apex needs the zone on Cloudflare.
- **Steps:**
  1. Add the `erp71.com` zone and import the existing records. **Proxied (orange cloud):** `app`, the apex, `www`. **DNS-only (grey):** `api` at first, `profiles`, `yt2mp3` and everything else, so the other apps are unaffected.
  2. TLS mode **Full (strict)**. Caddy still needs an origin certificate:
     - Either Caddy keeps issuing Let's Encrypt certificates through the HTTP-01 challenge (allow `/.well-known/acme-challenge/*` through with no redirect),
     - or install a **Cloudflare Origin CA** certificate in the Caddyfile for the proxied hosts.

     Use the Origin CA certificate. It's simpler and doesn't depend on ACME working through the proxy.
  3. **Client IP (critical):**
     - Behind Cloudflare, connections reach Caddy from Cloudflare's public IP ranges.
     - The backend's `trust proxy` walk stops at the first public address. It would treat Cloudflare's address as the client, and every user would share a few rate-limit buckets.
     - So: in Caddy's global options, set `servers { trusted_proxies static <Cloudflare IPv4 and IPv6 ranges> }` and `client_ip_headers CF-Connecting-IP`.
     - In `common/trust-proxy.util.ts`, extend the trusted list with the same ranges.
     - Spec: a request through a Cloudflare address resolves to the real client.
  4. Cache rules:
     - `/_next/static/*`: cache everything, respect the origin's headers.
     - Everything else: bypass. HTML is per-user and `private, no-store` already; API is never cached.
     - Turn off Rocket Loader, Auto Minify and Email Obfuscation, which can break the Next.js hydration markup.
  5. Limits to check:
     - The free plan caps request bodies at **100 MB**, which is exactly the external-sync snapshot upload limit; lower the app limit to 95 MB or keep uploads on `api.erp71.com`, which stays DNS-only.
     - Proxied idle connections close after 100 s. The support Server-Sent Events stream sends a heartbeat (`support.controller.ts:188`); make sure it fires more often than every 100 s.
     - HTTP/3 to the edge is on by default.
- **Rollback:** set the records back to DNS-only (grey cloud). This takes effect in minutes; a nameserver change takes hours, so do it in a quiet window.
- **Verify:**
  - From Dhaka, TLS for a new connection finishes in well under 0.1 s; compare `curl -w '%{time_appconnect}'` before and after.
  - `cf-cache-status: HIT` on `/_next/static/*`.
  - Rate-limit headers still count per user or IP.

### P3.2 Measure, tune Postgres, then add indexes

- **Steps:**
  1. **One Postgres restart**, in a quiet window. It also briefly restarts profiles71's database, which lives in the same container. Add to `docker-compose.prod.yml`:
     ```yaml
     db:
       command: >
         postgres
         -c shared_preload_libraries=pg_stat_statements
         -c pg_stat_statements.track=all
         -c shared_buffers=512MB
         -c effective_cache_size=4GB
         -c work_mem=16MB
         -c random_page_cost=1.1
         -c track_io_timing=on
       shm_size: 256mb
     ```
     Then run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`, as an idempotent `sync:*` step so it survives a rebuilt database. 512 MB covers the 360 MB database. The box has 5 GB free, which leaves room for the other apps.
  2. Add `?connection_limit=15&pool_timeout=20` to `DATABASE_URL`, so crons can't use up the request pool.
  3. After 3–7 days of traffic, rank by `total_exec_time`, then by `mean_exec_time`, from `pg_stat_statements`. Add `@@index` entries to `schema.prisma` for the top offenders. Start with the four tables in [§1](#postgres): `PaymentRecord` (4 index scans against 76 k full scans) and `SalesReturnItem` (43 against 350 k) are probably missing an index on a foreign key or tenant column. `posting_events` and `InventoryMovement` need the actual queries looked at before choosing.
  4. `db push` creates indexes without `CONCURRENTLY`. All four tables have ≤ 100 k rows, so each build takes well under a second; acceptable inside the deploy.
- **Verify:**
  - `pg_stat_statements` mean times for the top 10 queries, before and after.
  - On `pg_stat_user_tables`, the full-scan counts for those tables stop growing (reset with `pg_stat_reset()` after the index deploy).

### P3.3 Cache the auth chain; slim `/auth/me`

- **Evidence:**
  - `JwtStrategy.validate` (`auth/jwt.strategy.ts:18-30`) runs `user.findUnique` on **every** authenticated request.
  - Tenant membership, store grants and store access are cached per request only (`database/tenant-membership.loader.ts:64-81`), so an authenticated GET pays 3–6 sequential queries before the handler runs.
  - `/auth/me` (`auth.service.ts:922-1028`) runs about 19 statements across about 11 sequential levels. It uses `include` where `select` would do, and re-reads the subscription in `planEntitlements.getFeaturesForTenant`.
- **Design:**
  - There is one backend process, so an in-process cache is coherent.
  - Add a small LRU with a TTL (`lru-cache`, 30 s, about 5,000 entries) behind a `AuthCacheService` with explicit invalidation.
  - Cache keys:
    - `user:{id}` for the JWT user;
    - `membership:{userId}:{tenantId}`;
    - `grants:{userId}:{tenantId}`;
    - `storeAccess:{userId}:{tenantId}`.
  - Invalidate on writes to users (status, password, deactivation), tenant users and roles, store permissions and store access, and on sign-out.
  - For `/auth/me`: `select` only the fields `mapTenantMembership` reads, pass the subscription already loaded into the entitlement lookup, and look the user up by user id and email in one query.
- **Risk:** a revoked user keeps access for up to 30 s. Invalidate on the revoke path so the cache is cleared immediately, and keep the TTL as the safety net. Sign-out and password change already revoke refresh tokens.
- **Verify:**
  - Unit tests for invalidation.
  - The P1.6 metrics show lower p50 latency on authenticated routes.
  - The `pg_stat_statements` call count for the `User`/`TenantUser` lookups drops.

### P3.4 Upload images from the browser straight to Cloudinary

- **Evidence:** uploads travel Bangladesh → VPS (250 ms away) → Cloudinary, many as base64 inside JSON (`common/image-upload.util.ts`, `common/file-upload.util.ts`; 5 MB JSON limit), which makes them about 33% bigger.
- **Design:**
  - `POST /assets/upload-signature` returns `{ timestamp, signature, folder, api_key, cloud_name }`, scoped to the tenant's folder.
  - The browser uploads directly to `api.cloudinary.com` and sends the backend only the returned `secure_url`/`public_id`.
  - The backend checks that the `public_id` sits under the tenant's folder before saving it.
- **Verify:** uploading a 3 MB product image takes about half as long from Dhaka; DevTools shows the request going to `api.cloudinary.com`.

### P3.5 Shorter deploy outage

- **Evidence:** 19–24 s of 502s per deploy, measured. Images are built on the production box, which has 9.2 GB of disk free.
- **Design:**
  1. **Migrate before swapping:**
     - `scripts/deploy.sh` runs the `sync:*` scripts and `db push` in a one-off container (`docker compose run --rm backend npm run db:prepare`) while the **old** backend keeps serving.
     - Then `up -d`, and the new container's start command only `listen`s.
     - This needs the start command split into `db:prepare` and `start`; production starts with `start` only.
     - Every `sync:*` script and `db push` change is already additive and idempotent, so the old code keeps running safely against the new schema.
  2. **Build in CI:** the deploy workflow builds and pushes the images to GHCR, tagged by commit SHA, and the VPS pulls them. Deploy CPU and disk stop competing with live traffic, and a rollback becomes "redeploy the previous tag".
  3. Add a `healthcheck` on the backend in compose, so `depends_on: condition: service_healthy` and the deploy workflow's health check agree.
- **Verify:** a loop of `curl` against `/api/v1/health` every 0.5 s during a deploy sees at most about 3 s of non-200 responses.

### P3.6 Move heavy crons out of business hours

- **Evidence:** no cron sets a `timeZone`, so they run in UTC. For example, the reorder-activities job (`crm-activities.service.ts:701`) loops over every at-risk customer at **14:00 BDT**; dunning, period fees and payment retries fall between 14:00 and 16:00 BDT.
- **Change:** set `timeZone: 'Asia/Dhaka'` and move the batch jobs to 01:00–05:00 BDT. Leave the user-facing reminders (birthdays, low stock) in the morning.
- **Priority:** low; the box is idle today. Do it with P3.2, since both need someone to look at the load.

---

## 8. Rollout, ownership and rollback

- **Branching:**
  - Work happens on feature branches off `dev`, one PR per item or small group, merged into `dev`.
  - Release PRs `dev` → `main` ship it, and the merge auto-deploys.
  - **Merges are done by a person**: the auto-mode classifier blocks `gh pr merge`.
- **Order:**
  1. P0.
  2. P1.1 together with P1.4: the Caddy route first, then the frontend switch, then the service-worker fix in the same release.
  3. P1.2, P1.3, P1.5, P1.6.
  4. P2.1 → P2.2 → P2.3 → P2.4.
  5. P3.5 (makes later deploys cheaper).
  6. P3.2 (needs a week of P1.6 data) → P3.3 → P3.4.
  7. P3.1 whenever the Cloudflare account is ready; it doesn't depend on the others.
- **VPS changes outside the repo:**
  - The Hermes Caddyfile (P1.1, P3.1). Back up to `Caddyfile.bak-YYYYMMDD` and run `caddy validate` before every reload. It serves five apps, so a bad reload takes all of them down. Record each change in `docs/ops/deployment-runbook.md`.
  - `.env.production` (P1.6, P3.2).
  - The Postgres restart (P3.2).
- **Rollback:**
  - Code: revert the PR and redeploy.
  - Caddy: restore the `.bak` file and reload.
  - Cloudflare: grey-cloud the records.
  - Postgres flags: remove `command:` and restart.

---

## 9. Success criteria

Measured from Bangladesh, before and after each phase:

| Metric | Baseline | Target |
|---|---|---|
| `/login` gzipped JS | 1.66 MB | ≤ 0.7 MB |
| `/dashboard` gzipped JS | 1.92 MB | ≤ 0.9 MB |
| `OPTIONS` requests per dashboard load | about 11 | 0 |
| `/auth/me` requests per dashboard load | 2–3 | ≤ 1 (0 when cached) |
| Dashboard network wait, repeat visit | about 2.4 s | ≤ 0.8 s |
| First card on screen, repeat visit (Slow 4G profile) | — | ≤ 1.5 s |
| 429s in normal use (shop of 5 behind one IP) | possible within a minute | none |
| Deploy outage | 19–24 s | ≤ 3 s |
| New-connection TLS done (`time_appconnect`) | 0.52 s | ≤ 0.1 s (P3.1) |

Commands:

```bash
# Gzipped JS for a page
p=login; curl -s https://app.erp71.com/$p | grep -o '/_next/static/[^"]*\.js' | sort -u \
  | while read js; do curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' "https://app.erp71.com$js"; done \
  | awk '{s+=$1} END {print NR" scripts, "s" bytes gz"}'

# Connection costs
curl -s -o /dev/null -w 'connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer}\n' https://app.erp71.com/login

# Warm request cost (second line)
curl -s -o /dev/null -o /dev/null -w 'ttfb=%{time_starttransfer}\n' https://app.erp71.com/api/v1/health https://app.erp71.com/api/v1/health

# Preflight cache header (cross-origin hosts)
curl -s -o /dev/null -D - -X OPTIONS -H 'Origin: https://erp71.com' -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' https://api.erp71.com/api/v1/products | grep -i max-age

# Rate-limit budget
curl -sD - -o /dev/null https://api.erp71.com/api/v1/auth/me | grep -i x-ratelimit-limit
```

---

## 10. Out of scope and rejected options

- **Moving the other apps off the VPS.** Rejected for speed: together they use about 0.5 GB of RAM and about 0% CPU (§1). It would free disk for builds, which P3.5 solves more directly.
- **Moving the VPS to Singapore or Mumbai.** This is the biggest single lever, since each round trip would drop from 250 ms to about 50 ms. It's excluded by the constraint. With this plan in place, it would multiply the gains, not replace them.
- **Server-rendering the app pages (React Server Components with data).** The access token is in `localStorage`, so the server can't make authenticated fetches. Moving the session to an HttpOnly cookie is a separate project with security consequences (CSRF, cookie domain across `app`/`api`). Revisit after Phase 2.
- **Redis.** The existing client is Upstash over HTTPS, which is a remote call per command and slower than local Postgres for this workload. One backend process makes an in-process cache (P3.3) enough. Revisit if the backend ever runs as several processes.
- **Indexing all 235 unindexed foreign keys at once.** This stays measurement-led (P3.2), per the existing Server performance TODO.
