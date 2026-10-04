import { applyTenantContext, clearAuthSession, clearSidebarLayoutState, storeAuthResponse } from './auth-session';
import { getQueryClient, ME_QUERY_KEY } from './query-client';
import { getWorkspaceItem, setWorkspaceItem } from './session-store';

jest.mock('./api', () => ({
    api: { getMe: jest.fn() },
}));

const { api } = jest.requireMock('./api') as { api: { getMe: jest.Mock } };

describe('clearSidebarLayoutState', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('removes the persisted sidebar layout keys from localStorage', () => {
        localStorage.setItem('sidebar-open-groups', '{"accounting":true}');
        localStorage.setItem('sidebar-collapsed', 'true');
        localStorage.setItem('sidebar-width', '320');

        clearSidebarLayoutState();

        expect(localStorage.getItem('sidebar-open-groups')).toBeNull();
        expect(localStorage.getItem('sidebar-collapsed')).toBeNull();
        expect(localStorage.getItem('sidebar-width')).toBeNull();
    });

    it('clears sidebar keys from sessionStorage too', () => {
        sessionStorage.setItem('sidebar-width', '320');

        clearSidebarLayoutState();

        expect(sessionStorage.getItem('sidebar-width')).toBeNull();
    });

    it('leaves unrelated keys untouched', () => {
        setWorkspaceItem('tenant_id', 'abc');

        clearSidebarLayoutState();

        expect(getWorkspaceItem('tenant_id')).toBe('abc');
    });
});

describe('storeAuthResponse with a workspace named in the URL', () => {
    const KARIM = {
        id: 'tenant-karim',
        name: 'Karim Electronics',
        storefront_slug: 'karim',
        stores: [{ id: 'store-karim' }],
        subscription: { plan: { code: 'PREMIUM' } },
    };
    const RAHIM = { id: 'tenant-rahim', name: 'Rahim Pharmacy', storefront_slug: null, stores: [] };

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        api.getMe.mockReset();
        api.getMe.mockResolvedValue({ id: 'user-1', tenants: [KARIM, RAHIM] });
    });

    const credentials = { access_token: 'token', refresh_token: 'refresh' };

    it('enters the named workspace instead of the chooser', async () => {
        const result = await storeAuthResponse(credentials, { workspaceSlug: 'karim' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-karim');
        expect(getWorkspaceItem('store_id')).toBe('store-karim');
        expect(getWorkspaceItem('subscription_plan_code')).toBe('PREMIUM');
    });

    it('resolves a workspace by its slugified name', async () => {
        const result = await storeAuthResponse(credentials, { workspaceSlug: 'rahim-pharmacy' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-rahim');
    });

    it('still asks when the named workspace is not one of theirs', async () => {
        const result = await storeAuthResponse(credentials, { workspaceSlug: 'someone-else' });

        expect(result).toEqual({ redirectTo: '/select-account' });
        expect(getWorkspaceItem('tenant_id')).toBeNull();
    });

    it('still asks when no workspace was named', async () => {
        const result = await storeAuthResponse(credentials);

        expect(result).toEqual({ redirectTo: '/select-account' });
        expect(getWorkspaceItem('tenant_id')).toBeNull();
    });

    it('never lets a slug reach past the workspaces the account actually holds', async () => {
        api.getMe.mockResolvedValue({ id: 'user-1', tenants: [RAHIM] });

        // `karim` is a real workspace — just not one this user belongs to. With a
        // single shop left there is nothing to choose, so they enter that one.
        const result = await storeAuthResponse(credentials, { workspaceSlug: 'karim' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-rahim');
    });

    it('sends a platform admin who names a shop into that shop', async () => {
        api.getMe.mockResolvedValue({ id: 'user-1', is_platform_admin: true, tenants: [KARIM] });

        const result = await storeAuthResponse(credentials, { workspaceSlug: 'karim' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-karim');
        expect(getWorkspaceItem('active_context')).toBeNull();
    });
});

describe('the query cache across sign-in, sign-out and workspace switches', () => {
    const SHOP_A = { id: 'tenant-a', stores: [{ id: 'store-a' }] };
    const SHOP_B = { id: 'tenant-b', stores: [{ id: 'store-b' }] };
    const credentials = { access_token: 'token', refresh_token: 'refresh' };

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        api.getMe.mockReset();
    });

    it('seeds /auth/me at sign-in, fresh, so the next screen does not fetch it again', async () => {
        api.getMe.mockResolvedValue({ id: 'user-1', tenants: [SHOP_A] });

        await storeAuthResponse(credentials);

        const state = getQueryClient().getQueryState(ME_QUERY_KEY);
        expect(state?.data).toEqual({ id: 'user-1', tenants: [SHOP_A] });
        expect(state?.isInvalidated).toBe(false);
        expect(api.getMe).toHaveBeenCalledTimes(1);
    });

    it('drops everything the previous session cached when a new one signs in', async () => {
        const client = getQueryClient();
        client.setQueryData(['dashboard', 'tenant-a', 'store-a', 'kpis'], { total: 99 });
        client.setQueryData(ME_QUERY_KEY, { id: 'previous-user' });
        api.getMe.mockResolvedValue({ id: 'user-2', tenants: [SHOP_B] });

        await storeAuthResponse(credentials);

        expect(client.getQueryData(['dashboard', 'tenant-a', 'store-a', 'kpis'])).toBeUndefined();
        expect(client.getQueryData(ME_QUERY_KEY)).toEqual({ id: 'user-2', tenants: [SHOP_B] });
    });

    it('clears the whole cache on sign-out', () => {
        const client = getQueryClient();
        client.setQueryData(ME_QUERY_KEY, { id: 'user-1' });
        client.setQueryData(['dashboard', 'tenant-a', 'store-a', 'kpis'], { total: 1 });

        clearAuthSession();

        expect(client.getQueryCache().getAll()).toHaveLength(0);
    });

    it('resets workspace data when the tab enters a different shop, and only then', () => {
        const client = getQueryClient();
        applyTenantContext(SHOP_A);
        client.setQueryData(['dashboard', 'tenant-a', 'store-a', 'kpis'], { total: 1 });

        // The app shell re-applies the shop it is already in on every navigation.
        applyTenantContext(SHOP_A);
        expect(client.getQueryData(['dashboard', 'tenant-a', 'store-a', 'kpis'])).toEqual({ total: 1 });

        applyTenantContext(SHOP_B);
        expect(client.getQueryData(['dashboard', 'tenant-a', 'store-a', 'kpis'])).toBeUndefined();
    });
});
