import { render, waitFor } from '@testing-library/react';
import WorkspaceEntryClient from './WorkspaceEntryClient';
import { getWorkspaceItem } from '@/lib/session-store';

const replaceMock = jest.fn();
let pathname = '/w/karim';
let search = '';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: replaceMock }),
    usePathname: () => pathname,
    useSearchParams: () => new URLSearchParams(search),
}));

jest.mock('@/lib/api', () => ({
    api: { getMe: jest.fn() },
}));

const { api } = jest.requireMock('@/lib/api') as { api: { getMe: jest.Mock } };

const KARIM = {
    id: 'tenant-karim',
    name: 'Karim Electronics',
    storefront_slug: 'karim',
    stores: [{ id: 'store-karim' }],
};
const RAHIM = { id: 'tenant-rahim', name: 'Rahim Pharmacy', storefront_slug: null, stores: [] };

/** Sign in on this browser. Only the token's presence is read here. */
function signIn() {
    localStorage.setItem('access_token', 'token');
}

describe('/w/<workspace>', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        replaceMock.mockClear();
        api.getMe.mockReset();
        api.getMe.mockResolvedValue({ tenants: [KARIM, RAHIM] });
        pathname = '/w/karim';
        search = '';
    });

    it('sends a signed-out visitor to sign in, carrying the workspace', async () => {
        render(<WorkspaceEntryClient />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login?workspace=karim'));
        expect(api.getMe).not.toHaveBeenCalled();
    });

    it('carries the destination through sign-in too', async () => {
        pathname = '/w/karim/sales/pos';

        render(<WorkspaceEntryClient />);

        await waitFor(() =>
            expect(replaceMock).toHaveBeenCalledWith('/login?workspace=karim&redirect=%2Fsales%2Fpos'),
        );
    });

    it('enters the workspace and lands on the dashboard when signed in', async () => {
        signIn();

        render(<WorkspaceEntryClient />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-karim');
        expect(getWorkspaceItem('store_id')).toBe('store-karim');
    });

    it('opens the page the link asked for, inside that workspace', async () => {
        signIn();
        pathname = '/w/rahim-pharmacy/sales/pos';

        render(<WorkspaceEntryClient />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/sales/pos'));
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-rahim');
    });

    it('re-attaches a query string, which belongs to the page and not the lookup', async () => {
        signIn();
        pathname = '/w/karim/sales';
        search = 'status=DUE';

        render(<WorkspaceEntryClient />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/sales?status=DUE'));
    });

    it('hands an unknown workspace to the chooser rather than guessing', async () => {
        signIn();
        pathname = '/w/someone-else/inventory';

        render(<WorkspaceEntryClient />);

        await waitFor(() =>
            expect(replaceMock).toHaveBeenCalledWith('/select-account?workspace=someone-else&redirect=%2Finventory'),
        );
        expect(getWorkspaceItem('tenant_id')).toBeNull();
    });

    it('sends a stale session back to sign in', async () => {
        signIn();
        api.getMe.mockRejectedValue(new Error('401'));

        render(<WorkspaceEntryClient />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login?workspace=karim'));
    });

    it('treats bare `/w` as the app front door', async () => {
        signIn();
        pathname = '/w';

        render(<WorkspaceEntryClient />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
        expect(api.getMe).not.toHaveBeenCalled();
    });
});
