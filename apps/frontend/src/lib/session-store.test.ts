import {
    clearCredentials,
    clearWorkspace,
    getAccessToken,
    hasStoredSession,
    getLastTenantId,
    getRefreshToken,
    getWorkspaceItem,
    isAccessTokenNearExpiry,
    removeWorkspaceItem,
    resetWorkspaceBootstrapForTests,
    setCredentials,
    setLastTenantId,
    setWorkspaceItem,
    updateCredentials,
} from './session-store';

/** A fresh tab: no per-tab state, and nothing adopted yet. */
function newTab() {
    sessionStorage.clear();
    resetWorkspaceBootstrapForTests();
}

beforeEach(() => {
    localStorage.clear();
    newTab();
});

describe('workspace scope', () => {
    it('keeps the active shop out of localStorage, where another tab would see it', () => {
        setWorkspaceItem('tenant_id', 'shop-a');

        expect(sessionStorage.getItem('tenant_id')).toBe('shop-a');
        expect(localStorage.getItem('tenant_id')).toBeNull();
    });

    it('lets two tabs sit in two different shops', () => {
        setWorkspaceItem('tenant_id', 'shop-a');
        const tabA = sessionStorage.getItem('tenant_id');

        // A second tab has its own sessionStorage.
        newTab();
        setWorkspaceItem('tenant_id', 'shop-b');

        expect(getWorkspaceItem('tenant_id')).toBe('shop-b');
        expect(tabA).toBe('shop-a');
    });

    it('removes a key from both backends so no legacy copy resurfaces', () => {
        localStorage.setItem('store_id', 'stale-store');
        setWorkspaceItem('store_id', 'store-1');

        removeWorkspaceItem('store_id');

        expect(getWorkspaceItem('store_id')).toBeNull();
        expect(localStorage.getItem('store_id')).toBeNull();
    });

    it('reports nothing before a workspace has been chosen', () => {
        expect(getWorkspaceItem('tenant_id')).toBeNull();
        expect(getWorkspaceItem('active_context')).toBeNull();
    });
});

describe('bootstrapping a tab that has no workspace of its own', () => {
    it('adopts the whole workspace left behind by the browser-global layout', () => {
        localStorage.setItem('tenant_id', 'shop-a');
        localStorage.setItem('store_id', 'store-1');
        localStorage.setItem('subscription_plan_code', 'STANDARD');

        expect(getWorkspaceItem('tenant_id')).toBe('shop-a');
        expect(getWorkspaceItem('store_id')).toBe('store-1');
        expect(getWorkspaceItem('subscription_plan_code')).toBe('STANDARD');
    });

    it('adopts a legacy portal context too', () => {
        localStorage.setItem('active_context', 'platform-admin');

        expect(getWorkspaceItem('active_context')).toBe('platform-admin');
    });

    it('resumes a brand-new tab from the last shop entered anywhere', () => {
        setLastTenantId('shop-b');

        expect(getWorkspaceItem('tenant_id')).toBe('shop-b');
    });

    it('does not drag a store from another shop into a resumed tab', () => {
        setLastTenantId('shop-b');
        localStorage.setItem('store_id', 'store-of-shop-a');
        // `store_id` alone is not a legacy workspace — only `tenant_id` or
        // `active_context` mark one, and neither is set here.

        expect(getWorkspaceItem('tenant_id')).toBe('shop-b');
        expect(getWorkspaceItem('store_id')).toBeNull();
    });

    it('leaves a tab that already picked a shop alone', () => {
        setWorkspaceItem('tenant_id', 'shop-a');
        localStorage.setItem('tenant_id', 'shop-b');
        resetWorkspaceBootstrapForTests();

        expect(getWorkspaceItem('tenant_id')).toBe('shop-a');
    });

    it('stops the next tab from adopting a shop the previous one chose', () => {
        localStorage.setItem('tenant_id', 'legacy-shop');
        setWorkspaceItem('tenant_id', 'shop-a');

        newTab();

        expect(getWorkspaceItem('tenant_id')).toBeNull();
    });
});

describe('credentials', () => {
    it('puts a session where every tab of the browser can see it', () => {
        setCredentials({ access_token: 'a', refresh_token: 'r' });

        expect(localStorage.getItem('access_token')).toBe('a');
        expect(sessionStorage.getItem('access_token')).toBeNull();
    });

    it('signs a newly-opened tab in', () => {
        setCredentials({ access_token: 'a', refresh_token: 'r' });

        newTab();

        // The bug this replaced: credentials in sessionStorage meant a second
        // tab — duplicated, bookmarked or opened from a link — saw a login page.
        expect(getAccessToken()).toBe('a');
        expect(getRefreshToken()).toBe('r');
    });

    it('lets a later sign-in replace an earlier account outright', () => {
        setCredentials({ access_token: 'account-a', refresh_token: 'ra' });
        setCredentials({ access_token: 'account-b', refresh_token: 'rb' });

        expect(getAccessToken()).toBe('account-b');
        expect(getRefreshToken()).toBe('rb');
    });

    it('drops a stale refresh token when a sign-in returns none', () => {
        setCredentials({ access_token: 'a', refresh_token: 'r' });
        setCredentials({ access_token: 'b' });

        expect(getRefreshToken()).toBeNull();
    });

    it('clears both backends on sign-out', () => {
        setCredentials({ access_token: 'a', refresh_token: 'r' });
        sessionStorage.setItem('access_token', 'leftover');

        clearCredentials();

        expect(getAccessToken()).toBeNull();
        expect(getRefreshToken()).toBeNull();
    });

    describe('hasStoredSession', () => {
        it('is false in a browser that has never signed in', () => {
            expect(hasStoredSession()).toBe(false);
        });

        it('is true while either token survives', () => {
            setCredentials({ access_token: 'a', refresh_token: 'r' });
            expect(hasStoredSession()).toBe(true);

            localStorage.removeItem('access_token');
            expect(hasStoredSession()).toBe(true);
        });
    });

    describe('sessions that predate the move out of sessionStorage', () => {
        it('adopts one rather than signing the tab out mid-task', () => {
            sessionStorage.setItem('access_token', 'legacy-a');
            sessionStorage.setItem('refresh_token', 'legacy-r');

            expect(getAccessToken()).toBe('legacy-a');
            expect(getRefreshToken()).toBe('legacy-r');
            // Moved, not copied: a spent token left behind is what gets replayed.
            expect(sessionStorage.getItem('access_token')).toBeNull();
            expect(localStorage.getItem('access_token')).toBe('legacy-a');
        });

        it('defers to a sign-in that has happened since, and drops the old copy', () => {
            setCredentials({ access_token: 'current', refresh_token: 'current-r' });
            sessionStorage.setItem('access_token', 'legacy-a');
            sessionStorage.setItem('refresh_token', 'legacy-r');
            resetWorkspaceBootstrapForTests();

            expect(getAccessToken()).toBe('current');
            expect(sessionStorage.getItem('access_token')).toBeNull();
        });

        it('runs once, so a token this tab clears does not come back', () => {
            sessionStorage.setItem('access_token', 'legacy-a');
            expect(getAccessToken()).toBe('legacy-a');

            clearCredentials();

            expect(getAccessToken()).toBeNull();
        });
    });

    describe('renewal', () => {
        it('writes the new tokens where every tab reads them', () => {
            setCredentials({ access_token: 'a', refresh_token: 'r' });

            updateCredentials({ access_token: 'a2', refresh_token: 'r2' });

            expect(localStorage.getItem('access_token')).toBe('a2');
            expect(getRefreshToken()).toBe('r2');
            expect(sessionStorage.getItem('access_token')).toBeNull();
        });
    });
});

describe('isAccessTokenNearExpiry', () => {
    it('is false for a token with plenty of life left', () => {
        setCredentials({ access_token: 'a', expires_in: 3600 });

        expect(isAccessTokenNearExpiry()).toBe(false);
    });

    it('is true once the token is inside the renewal window', () => {
        setCredentials({ access_token: 'a', expires_in: 30 });

        expect(isAccessTokenNearExpiry()).toBe(true);
    });

    it('is true for a token that already lapsed', () => {
        setCredentials({ access_token: 'a', expires_in: 3600 });
        localStorage.setItem('access_token_expires_at', String(Date.now() - 1000));

        expect(isAccessTokenNearExpiry()).toBe(true);
    });

    it('stays false when the expiry is unknown, so the 401 path handles it', () => {
        setCredentials({ access_token: 'a' });

        expect(isAccessTokenNearExpiry()).toBe(false);
    });

    it('ignores a corrupted expiry rather than renewing on every request', () => {
        setCredentials({ access_token: 'a' });
        localStorage.setItem('access_token_expires_at', 'soon');

        expect(isAccessTokenNearExpiry()).toBe(false);
    });
});

describe('clearWorkspace', () => {
    it('leaves the resume hint alone — signing out of a shop is not forgetting it', () => {
        setWorkspaceItem('tenant_id', 'shop-a');
        setLastTenantId('shop-a');

        clearWorkspace();

        expect(getWorkspaceItem('tenant_id')).toBeNull();
        expect(getLastTenantId()).toBe('shop-a');
    });
});
