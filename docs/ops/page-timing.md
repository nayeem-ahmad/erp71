# Page timing

How long each page takes to load, split into the steps of the journey. There are two views of it:

- **On the page, for platform staff.** Avatar menu → **Show page timing** (stored per device). A strip then appears along the bottom of the content area on every page (`PageTimingStrip`, rendered by the `(app)` layout, so pages need nothing of their own). It shows the total, each phase and the API/server/DB totals. **Details** opens the breakdown of this and the last 20 page views. The strip takes its height from the page above it; for everyone else the page has the full height as before.
- **The dashboard, for platform staff.** System Health → **Page performance**: p50/p95 per page over 1, 7 or 30 days, from every signed-in user's browser. Each row also shows median phases and the endpoint that is usually slowest. Support engineers see it too, as they do the rest of System Health.

## The phases

| Phase | Full load | In-app navigation |
|---|---|---|
| Document | DNS, connect, server response and download of the HTML, from the browser's navigation timing | — |
| App start / Route change | JavaScript, hydration and first render, until the page makes its first API call | From the router transition (`onRouterTransitionStart` in `src/instrumentation-client.ts`) to the first API call |
| Data | First API call starting → last one finishing | same |
| Render | Last response → the next paint | same |

A view ends once no API call has been in flight for 300 ms after a paint and no route loading skeleton is on screen. Next commits the new path as soon as a route's `loading.tsx` skeleton shows, before the page's own code has arrived, so the collector waits while an element marked `data-route-loading` (set by `PageSkeleton`) is present, checking every 100 ms. Views over 30 s, and views in a tab that was hidden at any point, appear in the panel but are not sent to the dashboard.

Each API call is split further:

- **Token check:** time spent in `renewIfNearExpiry` before the request goes out.
- **Network:** the rest of the call that is not server time.
- **Server:** from the `Server-Timing` response header, split into `auth`, `db` and `app`.

## Server-Timing

Every API response carries `Server-Timing: auth;dur=…, db;dur=…, app;dur=…, total;dur=…`:

- **auth:** from the request reaching Nest until the guards pass. Its own queries are counted here.
- **db:** wall time with at least one Prisma query in flight after the guards. Parallel queries count once.
- **app:** everything else.

Platform staff also get the query counts in `desc` (`db;dur=24;desc="33 queries"`). CORS exposes the header (`exposedHeaders`), so the app reads it across origins. It also shows in DevTools → Network → Timing for any request.

Code:

- `apps/backend/src/common/server-timing.ts`: the middleware. It is registered after the body parsers in `main.ts`.
- `server-timing.interceptor.ts`: marks where the guards end.
- `DatabaseService`: a `$use` hook that times every query.

## Collection

- **Browser.** `lib/page-timing/collector.ts` is fed by `requestWithAuth` in `lib/api.ts`. `PageTimingTracker`, mounted in the `(app)` layout, commits each route and batches samples to `POST /api/v1/page-timings` every 15 s, and again when the tab is hidden.
- **Privacy.** Routes and endpoints are sent with ids replaced by `:id`. No user or tenant is stored.
- **Storage.** Samples go into `PageTimingSample` and are pruned after 30 days by the service, at most once an hour.
