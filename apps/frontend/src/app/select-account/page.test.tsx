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

    describe('a login with employee-portal cards', () => {
        const card = (id: string, tenantId: string) => ({ id, tenant_id: tenantId, employee_code: id.toUpperCase(), name: 'Karim' });

        it('names each workspace when the login is staff in more than one', async () => {
            api.getMe.mockResolvedValue({
                name: 'Karim',
                tenants: [KARIM, RAHIM],
                employee: card('emp-k', KARIM.id),
                employees: [card('emp-k', KARIM.id), card('emp-r', RAHIM.id)],
            });
            render(<SelectAccountPage />);

            expect(await screen.findByText('Employee portal · Karim Electronics')).toBeInTheDocument();
            expect(screen.getByText('Employee portal · Rahim Pharmacy')).toBeInTheDocument();
        });

        it('enters the portal pinned to the workspace of the card chosen', async () => {
            api.getMe.mockResolvedValue({
                name: 'Karim',
                tenants: [KARIM, RAHIM],
                employees: [card('emp-k', KARIM.id), card('emp-r', RAHIM.id)],
            });
            render(<SelectAccountPage />);

            (await screen.findByText('Employee portal · Rahim Pharmacy')).click();

            await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/my'));
            expect(getWorkspaceItem('active_context')).toBe('employee');
            expect(getWorkspaceItem('tenant_id')).toBe(RAHIM.id);
        });

        it('keeps the plain label for a single card, read from an older answer with no list', async () => {
            api.getMe.mockResolvedValue({ name: 'Karim', tenants: [KARIM, RAHIM], employee: card('emp-k', KARIM.id) });
            render(<SelectAccountPage />);

            await screen.findByText('Karim Electronics');
            expect(screen.queryByText(/Employee portal ·/)).not.toBeInTheDocument();
            expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(3);
        });
    });
});
