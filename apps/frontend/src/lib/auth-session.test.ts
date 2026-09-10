import { clearSidebarLayoutState, storeAuthResponse } from './auth-session';
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
        const result = await storeAuthResponse(credentials, false, { workspaceSlug: 'karim' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-karim');
        expect(getWorkspaceItem('store_id')).toBe('store-karim');
        expect(getWorkspaceItem('subscription_plan_code')).toBe('PREMIUM');
    });

    it('resolves a workspace by its slugified name', async () => {
        const result = await storeAuthResponse(credentials, false, { workspaceSlug: 'rahim-pharmacy' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-rahim');
    });

    it('still asks when the named workspace is not one of theirs', async () => {
        const result = await storeAuthResponse(credentials, false, { workspaceSlug: 'someone-else' });

        expect(result).toEqual({ redirectTo: '/select-account' });
        expect(getWorkspaceItem('tenant_id')).toBeNull();
    });

    it('still asks when no workspace was named', async () => {
        const result = await storeAuthResponse(credentials, false);

        expect(result).toEqual({ redirectTo: '/select-account' });
        expect(getWorkspaceItem('tenant_id')).toBeNull();
    });

    it('never lets a slug reach past the workspaces the account actually holds', async () => {
        api.getMe.mockResolvedValue({ id: 'user-1', tenants: [RAHIM] });

        // `karim` is a real workspace — just not one this user belongs to. With a
        // single shop left there is nothing to choose, so they enter that one.
        const result = await storeAuthResponse(credentials, false, { workspaceSlug: 'karim' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-rahim');
    });

    it('sends a platform admin who names a shop into that shop', async () => {
        api.getMe.mockResolvedValue({ id: 'user-1', is_platform_admin: true, tenants: [KARIM] });

        const result = await storeAuthResponse(credentials, false, { workspaceSlug: 'karim' });

        expect(result).toEqual({ redirectTo: '/dashboard' });
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-karim');
        expect(getWorkspaceItem('active_context')).toBeNull();
    });
});
