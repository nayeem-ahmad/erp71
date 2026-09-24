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
 * Where a session that can no longer be used on `pathname` should land. Returns
 * `null` when the user is already on the login page and no navigation is
 * warranted.
 *
 * `expired` separates the two ways of getting here, because they read very
 * differently to the person: a token the server refused is worth explaining, and
 * arriving with no token at all — a bookmark opened in a signed-out browser — is
 * not. Telling the second one their session expired is a small lie that has sent
 * people looking for a fault that is not there.
 *
 * Pure so the routing rules can be tested directly — jsdom makes
 * `window.location` immutable, so the navigation itself is covered by the
 * Playwright spec in `e2e/session-expiry.spec.ts`.
 */
export function resolveExpiredSessionRedirect(
    pathname: string,
    search = '',
    { expired = true }: { expired?: boolean } = {},
): string | null {
    if (pathname === '/login' || pathname.startsWith('/login/')) return null;

    const reason = expired ? 'reason=expired' : '';
    if (isSignedOutPath(pathname)) return reason ? `/login?${reason}` : '/login';

    const returnTo = encodeURIComponent(`${pathname}${search}`);
    return `/login?redirect=${returnTo}${reason ? `&${reason}` : ''}`;
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

/**
 * Send a browser that was never signed in to the login page.
 *
 * Deliberately not `handleExpiredSession`. Nothing expired, so it does not say
 * so — and, more importantly, it clears nothing. `clearStoredSession` reaches
 * into localStorage, which every tab shares, so treating "this request had no
 * token" as an expiry meant one stray navigation wiped `last_tenant_id` and the
 * workspace pointer out from under whatever else the user had open.
 */
export function handleMissingSession(): void {
    redirectToLoginKeepingSession();
}

/**
 * Send a tab whose session could not be confirmed to the login page.
 *
 * For when `GET /auth/me` never got a verdict — the renewal was rate-limited,
 * the API answered 5xx, or the connection dropped — and retrying did not help.
 * Leaving the shell up in that state draws a signed-out-looking app (user "—",
 * empty tables) with no way forward, which is what a bookmark opened into a
 * busy or restarting API used to show.
 *
 * Like `handleMissingSession` it clears nothing and claims no expiry: the
 * refresh token may well still be good, and signing in again replaces it
 * anyway. The page travels as `?redirect=` so login lands back on it.
 */
export function handleUnconfirmedSession(): void {
    redirectToLoginKeepingSession();
}

function redirectToLoginKeepingSession(): void {
    if (typeof window === 'undefined') return;
    if (!claimExpiredSessionRedirect()) return;

    const target = resolveExpiredSessionRedirect(
        window.location.pathname,
        window.location.search,
        { expired: false },
    );
    if (target) window.location.replace(target);
}

/** How many times the app shell re-asks `/auth/me` before giving up on a tab. */
export const SESSION_CONFIRM_MAX_RETRIES = 3;

/** Fallback wait between those attempts, and the ceiling on a server-suggested one. */
const SESSION_CONFIRM_RETRY_MS = 3_000;
const SESSION_CONFIRM_MAX_RETRY_MS = 15_000;

/**
 * True when a failed `/auth/me` said nothing about whether the session is good.
 *
 * A 401 is a verdict and is already handled — the API layer is navigating to
 * /login by the time the caller sees it. Other 4xx answers are the server
 * judging the request, and redirecting on them could loop. What is left — a
 * renewal that could not be asked, a 429, a 5xx, or a request that never got a
 * response at all — is worth another try, then a trip to the login page.
 *
 * Duck-typed rather than `instanceof ApiError`: this module must not import
 * `api.ts` (see the header comment).
 */
export function isUnconfirmedSessionError(error: unknown): boolean {
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status !== 'number') return true;
    return status === 429 || status >= 500;
}

/** How long to wait before re-asking, honouring a server-suggested wait. */
export function sessionConfirmRetryDelayMs(error: unknown): number {
    const retryAfter = (error as { retryAfter?: unknown } | null)?.retryAfter;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(retryAfter * 1000, SESSION_CONFIRM_MAX_RETRY_MS);
    }
    return SESSION_CONFIRM_RETRY_MS;
}

/** Test-only: clear the once-per-page-load redirect latch between cases. */
export function resetSessionExpiryGuard(): void {
    redirecting = false;
}
