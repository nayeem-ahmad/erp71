/**
 * One place that knows how to turn a configured backend host into a callable
 * API base.
 *
 * This exists because the deploy script (`scripts/sync-erp71-env-urls.sh`) sets
 * `NEXT_PUBLIC_API_BASE=https://app.erp71.com` — the bare origin, with no path —
 * while the backend mounts everything under a global `api/v1` prefix
 * (`apps/backend/src/main.ts`). Anything that concatenates the configured value
 * with an endpoint path and forgets the prefix 404s in production while working
 * fine locally, where the fallback happens to carry the prefix. That is exactly
 * how the public `/s`, `/q`, `/store/.../p` routes and the `/r` referral route
 * all shipped broken.
 */

/** Backend base used when nothing is configured (local `npm run dev`). */
export const DEFAULT_LOCAL_API_BASE = 'http://localhost:4000/api/v1';

/**
 * Trim trailing slashes and guarantee exactly one `/api/v1` suffix. Returns
 * `null` for an empty/unset value so callers can pick their own fallback.
 */
export function normalizeApiBase(rawBase?: string | null): string | null {
    const base = rawBase?.trim().replace(/\/+$/, '');

    if (!base) {
        return null;
    }

    return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

/**
 * API base for code that runs in the browser.
 *
 * Production points this at the app's own origin, `https://app.erp71.com`, whose
 * reverse proxy hands `/api/v1/*` straight to the backend. Same origin is the
 * whole point: a cross-origin call carrying `Authorization` and the tenant
 * headers needs a CORS preflight first — one more round trip, about 0.25 s from
 * Bangladesh, on nearly every call — plus a second TLS connection per page load.
 *
 * It stays an absolute URL when configured because the marketing host
 * (`erp71.com`) serves pages that call the API too, and those belong on the app
 * host rather than on their own origin.
 *
 * Unset, it is the same thing said relatively: `/api/v1` on whichever origin
 * served the page — the backend behind the production proxy, the
 * `next.config.js` rewrite under `next dev`. The fallback used to be the retired
 * Render host, which turned a missing build arg into an app that could not reach
 * its API at all.
 */
export function browserApiBase(): string {
    return normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL) ?? '/api/v1';
}

/**
 * API base for server-side fetches on public (unauthenticated) routes.
 *
 * On the server this prefers `BACKEND_URL` — the backend on the compose network
 * (`http://backend:4000`), the same target the `next.config.js` rewrite uses —
 * over the public origin, which would only send the request out to the reverse
 * proxy and back into the same box. The backend reads nothing from `Host`, so
 * the shorter path answers identically.
 *
 * Not during `next build`, though. The builder stage sets `BACKEND_URL` too (the
 * rewrite needs it baked in), but no backend runs next to the build, and pages
 * that pre-render then — the sitemap, the RSS feed — would bake in an empty
 * result for their whole revalidate window. The public origin is reachable from
 * the build, so the build keeps using it.
 *
 * Read from `process.env` on every call rather than once at module load: these
 * run in the Node.js server runtime where the value is a real runtime
 * environment variable, and reading it lazily also lets tests exercise the
 * configured-value path.
 */
export function publicApiBase(): string {
    const onServer = typeof window === 'undefined' && process.env.NEXT_PHASE !== 'phase-production-build';
    const internal = onServer ? normalizeApiBase(process.env.BACKEND_URL) : null;

    return (
        internal
        ?? normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL)
        ?? DEFAULT_LOCAL_API_BASE
    );
}
