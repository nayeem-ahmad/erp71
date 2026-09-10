import { render, screen, waitFor } from '@testing-library/react';
import SelectAccountPage from './page';
import { getWorkspaceItem } from '@/lib/session-store';

const replaceMock = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: replaceMock }),
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
    role: 'OWNER',
    stores: [{ id: 'store-karim' }],
};
const RAHIM = { id: 'tenant-rahim', name: 'Rahim Pharmacy', storefront_slug: null, role: 'STAFF', stores: [] };

describe('the account chooser', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        replaceMock.mockClear();
        api.getMe.mockReset();
        api.getMe.mockResolvedValue({ name: 'Karim', tenants: [KARIM, RAHIM] });
        search = '';
    });

    it('lists every workspace when the URL names none', async () => {
        render(<SelectAccountPage />);

        expect(await screen.findByText('Karim Electronics')).toBeInTheDocument();
        expect(screen.getByText('Rahim Pharmacy')).toBeInTheDocument();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it('skips itself entirely when the URL names a workspace', async () => {
        search = 'workspace=karim';

        render(<SelectAccountPage />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-karim');
    });

    it('honours the destination the link asked for', async () => {
        search = 'workspace=rahim-pharmacy&redirect=%2Fsales%2Fpos';

        render(<SelectAccountPage />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/sales/pos'));
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-rahim');
    });

    it('refuses a destination that would leave the app', async () => {
        search = 'workspace=karim&redirect=%2F%2Fevil.example';

        render(<SelectAccountPage />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    });

    it('says why the list is showing when the named workspace is not one of theirs', async () => {
        search = 'workspace=someone-else';

        render(<SelectAccountPage />);

        expect(await screen.findByText(/No workspace of yours matches/i)).toBeInTheDocument();
        expect(screen.getByText('someone-else')).toBeInTheDocument();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it('shows the direct link for each workspace, so the chooser can be skipped next time', async () => {
        render(<SelectAccountPage />);

        expect(await screen.findByText(/\/w\/karim$/)).toBeInTheDocument();
        expect(screen.getByText(/\/w\/rahim-pharmacy$/)).toBeInTheDocument();
    });
});
