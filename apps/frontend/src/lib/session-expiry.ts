/**
 * Central handling for "this staff session is no longer valid".
 *
 * Every authenticated request goes through `requestWithAuth` / `fetchBlobWithAuth`
 * in `api.ts`. The unauthenticated endpoints — login, 2FA verify, signup, demo,
 * plans, invitations, and the public storefront — all use raw `fetch` instead.
 * So a 401 out of the authenticated helpers can only mean the token expired or
 * was revoked; there is nothing to disambiguate and no endpoint allowlist needed.
 *
 * Those helpers try a silent renewal against the refresh token first, so
 * reaching here means the renewal failed too — the session is really over, not
 * merely stale.
 *
 * This module imports only `session-store`, which itself imports nothing.
 * `api.ts` needs both, and `auth-session.ts` imports `api.ts`, so any heavier
 * dependency would close an import cycle.
 */
import { CREDENTIAL_KEYS, LAST_TENANT_KEY, WORKSPACE_KEYS } from './session-store';

/**
 * Everything that identifies the signed-in session. Credentials, the tab's
 * workspace and the cross-tab resume hint each live in a different backend, so
 * every key is cleared from both. Deliberately excludes preferences that should
 * survive a logout (`locale`, sidebar layout, `demo_banner_dismissed`).
 */
export const SESSION_STORAGE_KEYS = [
    ...CREDENTIAL_KEYS,
    ...WORKSPACE_KEYS,
    LAST_TENANT_KEY,
    'demo_session',
    'onboarding_complete',
] as const;

/** Wipe the stored session from both storage backends. */
export function clearStoredSession(): void {
    if (typeof window === 'undefined') return;
    for (const key of SESSION_STORAGE_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }
}

/**
 * Pages that are already part of the signed-out experience. Sending the user
 * back to one of these after logging in would be a no-op at best and a loop at
 * worst, so they get no `?redirect=`.
 */
const SIGNED_OUT_PATH_PREFIXES = [
    '/login',
    '/signup',
    '/demo',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/accept-invitation',
    '/select-account',
    '/store/',
];

function isSignedOutPath(pathname: string): boolean {
    return SIGNED_OUT_PATH_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(prefix),
    );
}

/**
 * Where an expired session on `pathname` should land. Returns `null` when the
 * user is already on the login page and no navigation is warranted.
 *
 * Pure so the routing rules can be tested directly — jsdom makes
 * `window.location` immutable, so the navigation itself is covered by the
 * Playwright spec in `e2e/session-expiry.spec.ts`.
 */
export function resolveExpiredSessionRedirect(pathname: string, search = ''): string | null {
    if (pathname === '/login' || pathname.startsWith('/login/')) return null;
    if (isSignedOutPath(pathname)) return '/login?reason=expired';

    const returnTo = encodeURIComponent(`${pathname}${search}`);
    return `/login?redirect=${returnTo}&reason=expired`;
}

/**
 * Latched once we start navigating. A single page easily fires half a dozen
 * requests in parallel, and every one of them 401s on an expired token — without
 * this the user would be redirected repeatedly mid-navigation.
 */
let redirecting = false;

/**
 * True the first time an expiry is handled after page load, false afterwards.
 * Callers use it to make the teardown run exactly once.
 */
export function claimExpiredSessionRedirect(): boolean {
    if (redirecting) return false;
    redirecting = true;
    return true;
}

/**
 * Tear down the dead session and send the user to the login page.
 *
 * Uses a full `window.location.replace` rather than a Next router push on
 * purpose: the app shell holds stale user/tenant state across a dozen contexts,
 * and a hard navigation is the only way to guarantee none of it survives into
 * the next session. `replace` also keeps the dead page out of browser history,
 * so Back doesn't return to it.
 */
export function handleExpiredSession(): void {
    if (typeof window === 'undefined') return;
    if (!claimExpiredSessionRedirect()) return;

    clearStoredSession();

    const target = resolveExpiredSessionRedirect(window.location.pathname, window.location.search);
    if (target) window.location.replace(target);
}

/** Test-only: clear the once-per-page-load redirect latch between cases. */
export function resetSessionExpiryGuard(): void {
    redirecting = false;
}
