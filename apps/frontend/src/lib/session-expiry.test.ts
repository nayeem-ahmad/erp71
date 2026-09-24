/**
 * Tests for src/lib/session-expiry.ts — the single place that decides what
 * happens when the backend says the staff session is no longer valid.
 *
 * Regression context: an expired token used to leave the app shell rendered but
 * dead — sidebar and menus visible, user name showing "—", every link 401ing —
 * because the 401 was swallowed and nothing ever navigated to /login.
 *
 * jsdom 26 makes `window.location` non-configurable, so the navigation call
 * itself is covered by e2e/session-expiry.spec.ts; here we test the routing
 * policy, the storage teardown, and the once-only latch.
 */

import {
    claimExpiredSessionRedirect,
    clearStoredSession,
    isUnconfirmedSessionError,
    resetSessionExpiryGuard,
    resolveExpiredSessionRedirect,
    sessionConfirmRetryDelayMs,
} from './session-expiry';
import { getWorkspaceItem, setWorkspaceItem } from './session-store';

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetSessionExpiryGuard();
});

describe('clearStoredSession', () => {
    it('removes session keys from BOTH storage backends', () => {
        // Credentials live in localStorage; sessionStorage is where they used to
        // go when "Remember me" was unchecked, and an old tab may still hold one.
        localStorage.setItem('access_token', 'local-token');
        sessionStorage.setItem('access_token', 'session-token');
        setWorkspaceItem('tenant_id', 'tenant-1');
        setWorkspaceItem('active_context', 'platform-admin');

        clearStoredSession();

        expect(localStorage.getItem('access_token')).toBeNull();
        expect(sessionStorage.getItem('access_token')).toBeNull();
        expect(getWorkspaceItem('tenant_id')).toBeNull();
        expect(getWorkspaceItem('active_context')).toBeNull();
    });

    it('leaves preferences that should survive a logout alone', () => {
        localStorage.setItem('locale', 'bn');
        localStorage.setItem('sidebar-collapsed', '1');

        clearStoredSession();

        expect(localStorage.getItem('locale')).toBe('bn');
        expect(localStorage.getItem('sidebar-collapsed')).toBe('1');
    });
});

describe('resolveExpiredSessionRedirect', () => {
    it('sends the user to /login carrying the path they were on', () => {
        expect(resolveExpiredSessionRedirect('/sales/orders')).toBe(
            '/login?redirect=%2Fsales%2Forders&reason=expired',
        );
    });

    it('preserves the query string in the return path', () => {
        expect(resolveExpiredSessionRedirect('/sales/orders', '?status=DRAFT')).toBe(
            '/login?redirect=%2Fsales%2Forders%3Fstatus%3DDRAFT&reason=expired',
        );
    });

    it('flags the reason so the login page can explain why the user is back', () => {
        expect(resolveExpiredSessionRedirect('/dashboard')).toContain('reason=expired');
    });

    it.each([
        '/select-account',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/verify-email',
        '/accept-invitation',
        '/store/acme-shop',
    ])('offers no return path back into signed-out page %s', (pathname) => {
        expect(resolveExpiredSessionRedirect(pathname)).toBe('/login?reason=expired');
    });

    it('returns null on the login page itself, so there is no redirect loop', () => {
        expect(resolveExpiredSessionRedirect('/login')).toBeNull();
        expect(resolveExpiredSessionRedirect('/login', '?redirect=%2Fdashboard')).toBeNull();
    });

    it('does not mistake a business path for a signed-out one', () => {
        // '/storefront' is an in-app page; only the public '/store/' shop is not.
        expect(resolveExpiredSessionRedirect('/storefront/settings')).toBe(
            '/login?redirect=%2Fstorefront%2Fsettings&reason=expired',
        );
    });

    describe('when the browser was never signed in', () => {
        it('still carries the path they were trying to reach', () => {
            expect(resolveExpiredSessionRedirect('/sales/orders', '', { expired: false })).toBe(
                '/login?redirect=%2Fsales%2Forders',
            );
        });

        it('does not claim a session expired when none ever existed', () => {
            // A bookmark opened in a signed-out browser is not a fault, and saying
            // it is has sent people looking for one.
            expect(resolveExpiredSessionRedirect('/dashboard', '', { expired: false }))
                .not.toContain('reason=expired');
            expect(resolveExpiredSessionRedirect('/select-account', '', { expired: false }))
                .toBe('/login');
        });

        it('returns null on the login page, exactly as an expiry does', () => {
            expect(resolveExpiredSessionRedirect('/login', '', { expired: false })).toBeNull();
        });
    });
});

describe('claimExpiredSessionRedirect', () => {
    it('grants the teardown to exactly one caller when a page 401s in parallel', () => {
        // A dashboard fires half a dozen requests at once; all of them 401.
        expect(claimExpiredSessionRedirect()).toBe(true);
        expect(claimExpiredSessionRedirect()).toBe(false);
        expect(claimExpiredSessionRedirect()).toBe(false);
    });
});

describe('isUnconfirmedSessionError', () => {
    // Regression: a bookmark opened while `/auth/refresh` was rate-limited left
    // the shell up with user "—" and empty tables, and nothing ever retried.
    it('treats a renewal that could not be asked as no verdict', () => {
        expect(isUnconfirmedSessionError({ status: 503, code: 'SESSION_RENEWAL_UNAVAILABLE' })).toBe(true);
    });

    it('treats rate limits and server errors as no verdict', () => {
        expect(isUnconfirmedSessionError({ status: 429 })).toBe(true);
        expect(isUnconfirmedSessionError({ status: 500 })).toBe(true);
        expect(isUnconfirmedSessionError({ status: 502 })).toBe(true);
    });

    it('treats a request that never got a response as no verdict', () => {
        expect(isUnconfirmedSessionError(new TypeError('Failed to fetch'))).toBe(true);
    });

    it('leaves a 401 to the API layer, which is already navigating to /login', () => {
        expect(isUnconfirmedSessionError({ status: 401 })).toBe(false);
    });

    it('does not bounce on a 4xx the server judged, which could loop', () => {
        expect(isUnconfirmedSessionError({ status: 403 })).toBe(false);
        expect(isUnconfirmedSessionError({ status: 404 })).toBe(false);
    });
});

describe('sessionConfirmRetryDelayMs', () => {
    it('waits as long as the server asked', () => {
        expect(sessionConfirmRetryDelayMs({ status: 503, retryAfter: 5 })).toBe(5_000);
    });

    it('caps a large server-suggested wait', () => {
        expect(sessionConfirmRetryDelayMs({ status: 429, retryAfter: 600 })).toBe(15_000);
    });

    it('falls back to a fixed wait when none was suggested', () => {
        expect(sessionConfirmRetryDelayMs(new TypeError('Failed to fetch'))).toBe(3_000);
    });
});
