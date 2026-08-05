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
    resetSessionExpiryGuard,
    resolveExpiredSessionRedirect,
} from './session-expiry';

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetSessionExpiryGuard();
});

describe('clearStoredSession', () => {
    it('removes session keys from BOTH storage backends', () => {
        // "Remember me" writes the token to localStorage, otherwise sessionStorage.
        localStorage.setItem('access_token', 'local-token');
        sessionStorage.setItem('access_token', 'session-token');
        localStorage.setItem('tenant_id', 'tenant-1');
        localStorage.setItem('active_context', 'platform-admin');

        clearStoredSession();

        expect(localStorage.getItem('access_token')).toBeNull();
        expect(sessionStorage.getItem('access_token')).toBeNull();
        expect(localStorage.getItem('tenant_id')).toBeNull();
        expect(localStorage.getItem('active_context')).toBeNull();
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
});

describe('claimExpiredSessionRedirect', () => {
    it('grants the teardown to exactly one caller when a page 401s in parallel', () => {
        // A dashboard fires half a dozen requests at once; all of them 401.
        expect(claimExpiredSessionRedirect()).toBe(true);
        expect(claimExpiredSessionRedirect()).toBe(false);
        expect(claimExpiredSessionRedirect()).toBe(false);
    });
});
