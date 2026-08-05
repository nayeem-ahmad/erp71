/**
 * One place that knows how to turn a configured backend host into a callable
 * API base.
 *
 * This exists because the deploy script (`scripts/sync-erp71-env-urls.sh`) sets
 * `NEXT_PUBLIC_API_BASE=https://api.erp71.com` — the bare origin, with no path —
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
 * API base for server-side fetches on public (unauthenticated) routes.
 *
 * Read from `process.env` on every call rather than once at module load: these
 * run in the Node.js server runtime where the value is a real runtime
 * environment variable, and reading it lazily also lets tests exercise the
 * configured-value path.
 */
export function publicApiBase(): string {
    return (
        normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL)
        ?? DEFAULT_LOCAL_API_BASE
    );
}
