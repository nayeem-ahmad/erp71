/**
 * Where a signed-in session lives in the browser.
 *
 * Two things with genuinely different lifetimes used to share one bucket, and
 * conflating them is what let a refresh in one tab drop the user into a
 * different shop:
 *
 *  - **Credentials** (`access_token`, `refresh_token`) follow the "Remember me"
 *    choice — localStorage when it was checked (survives a browser restart and
 *    is shared by every tab), sessionStorage when it was not (dies with the
 *    tab). Whichever backend wins, the other is cleared, so a leftover token
 *    from an earlier sign-in can never outrank the current one.
 *  - **The workspace** (`tenant_id`, `store_id`, `subscription_plan_code`,
 *    `active_context`) is always **per tab**. Someone who owns three shops can
 *    keep one open in each tab; entering a shop in one tab no longer rewrites
 *    what the others are looking at.
 *  - **`last_tenant_id`** stays in localStorage on purpose: it is the only
 *    thing a brand-new tab has to go on, and it is a hint, not a scope.
 *
 * The backend re-checks membership on every request (`TenantInterceptor`), so
 * none of this is a security boundary — it is about the app showing you the
 * shop you thought you were in.
 *
 * Deliberately imports nothing: `session-expiry` and `api` both depend on it,
 * and `auth-session` depends on `api`.
 */

/** Credentials. Storage backend depends on "Remember me". */
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
/** Epoch millis the access token stops being accepted; drives pre-emptive renewal. */
const ACCESS_EXPIRY_KEY = 'access_token_expires_at';

export const CREDENTIAL_KEYS = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, ACCESS_EXPIRY_KEY] as const;

/** Which workspace this tab is looking at. Always sessionStorage. */
export const WORKSPACE_KEYS = [
    'tenant_id',
    'store_id',
    'subscription_plan_code',
    'active_context',
] as const;

export type WorkspaceKey = (typeof WORKSPACE_KEYS)[number];

/** The cross-tab "where was I?" hint. Always localStorage. */
export const LAST_TENANT_KEY = 'last_tenant_id';

function hasWindow(): boolean {
    return typeof window !== 'undefined';
}

/* -------------------------------------------------------------------------- */
/* Workspace                                                                  */
/* -------------------------------------------------------------------------- */

let bootstrapped = false;

/**
 * Give a tab that has no workspace of its own something to start from.
 *
 * Runs at most once per tab and covers two cases:
 *  1. A tab open across the deploy that moved these keys per-tab — its whole
 *     workspace is still sitting in localStorage, so take it across verbatim
 *     rather than bouncing the user to the account chooser mid-task.
 *  2. A genuinely new tab — resume the last shop the user entered anywhere.
 *     Optimistic: the app shell re-checks it against the real membership list
 *     once `GET /auth/me` comes back, and corrects it if it no longer holds.
 */
function bootstrapWorkspace(): void {
    if (bootstrapped || !hasWindow()) return;
    bootstrapped = true;

    if (sessionStorage.getItem('tenant_id') || sessionStorage.getItem('active_context')) return;

    const legacyWorkspace =
        localStorage.getItem('tenant_id') || localStorage.getItem('active_context');

    if (legacyWorkspace) {
        for (const key of WORKSPACE_KEYS) {
            const value = localStorage.getItem(key);
            if (value !== null) sessionStorage.setItem(key, value);
        }
        return;
    }

    const resume = localStorage.getItem(LAST_TENANT_KEY);
    // Only the tenant: a `store_id` left over from another shop would be
    // rejected outright, and the shell picks a store for the tenant anyway.
    if (resume) sessionStorage.setItem('tenant_id', resume);
}

export function getWorkspaceItem(key: WorkspaceKey): string | null {
    if (!hasWindow()) return null;
    bootstrapWorkspace();
    return sessionStorage.getItem(key);
}

export function setWorkspaceItem(key: WorkspaceKey, value: string): void {
    if (!hasWindow()) return;
    bootstrapWorkspace();
    sessionStorage.setItem(key, value);
    // Drop the pre-per-tab copy so a later tab adopts `last_tenant_id` instead
    // of a scope that belongs to whichever tab happened to write last.
    localStorage.removeItem(key);
}

export function removeWorkspaceItem(key: WorkspaceKey): void {
    if (!hasWindow()) return;
    bootstrapWorkspace();
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
}

export function clearWorkspace(): void {
    if (!hasWindow()) return;
    for (const key of WORKSPACE_KEYS) {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
    }
}

export function getLastTenantId(): string | null {
    return hasWindow() ? localStorage.getItem(LAST_TENANT_KEY) : null;
}

export function setLastTenantId(tenantId: string): void {
    if (hasWindow()) localStorage.setItem(LAST_TENANT_KEY, tenantId);
}

export function clearLastTenantId(): void {
    if (!hasWindow()) return;
    localStorage.removeItem(LAST_TENANT_KEY);
    sessionStorage.removeItem(LAST_TENANT_KEY);
}

/* -------------------------------------------------------------------------- */
/* Credentials                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tab-local first. A "Remember me" token in localStorage is the fallback, which
 * is what makes a newly-opened tab signed in; a token this tab wrote for itself
 * always wins over one another tab left behind.
 */
function readCredential(key: string): string | null {
    if (!hasWindow()) return null;
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

export function getAccessToken(): string | null {
    return readCredential(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
    return readCredential(REFRESH_TOKEN_KEY);
}

export interface AuthTokens {
    access_token: string;
    refresh_token?: string | null;
    /** Seconds, as the backend reports it. */
    expires_in?: number | null;
}

/**
 * Write a freshly-issued set of credentials, clearing the backend we are not
 * using. That second half matters: reads fall back from sessionStorage to
 * localStorage, so a remembered token left over from a previous account would
 * otherwise keep answering for a session signed in without "Remember me".
 */
export function setCredentials(tokens: AuthTokens, rememberMe = false): void {
    if (!hasWindow()) return;

    const target = rememberMe ? localStorage : sessionStorage;
    const other = rememberMe ? sessionStorage : localStorage;

    for (const key of CREDENTIAL_KEYS) {
        target.removeItem(key);
        other.removeItem(key);
    }

    target.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
    if (tokens.refresh_token) target.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
    if (tokens.expires_in) {
        target.setItem(ACCESS_EXPIRY_KEY, String(Date.now() + tokens.expires_in * 1000));
    }
}

/**
 * Replace the tokens after a silent renewal, staying in whichever backend the
 * session already occupies — a renewal must not quietly upgrade a
 * "Remember me: no" session into one that outlives the tab.
 */
export function updateCredentials(tokens: AuthTokens): void {
    if (!hasWindow()) return;

    const inSession = sessionStorage.getItem(ACCESS_TOKEN_KEY) !== null;
    setCredentials(tokens, !inSession);
}

export function clearCredentials(): void {
    if (!hasWindow()) return;
    for (const key of CREDENTIAL_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }
}

/**
 * True when the access token is close enough to expiry that the next request
 * should renew first rather than spend a round-trip discovering a 401.
 *
 * Unknown expiry (a token issued before this shipped, or one from a flow that
 * reports no `expires_in`) reads as "not near expiry": the 401 path still
 * catches it, and guessing would renew on every single request.
 */
export function isAccessTokenNearExpiry(withinMs = 60_000): boolean {
    const raw = readCredential(ACCESS_EXPIRY_KEY);
    if (!raw) return false;

    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt)) return false;

    return Date.now() + withinMs >= expiresAt;
}

/** Test-only: forget that this tab already bootstrapped its workspace. */
export function resetWorkspaceBootstrapForTests(): void {
    bootstrapped = false;
}
