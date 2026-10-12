import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DataManagementPage from './page';

jest.mock('@/lib/api', () => ({ fetchWithAuth: jest.fn() }));
jest.mock('@/hooks/use-me', () => ({ fetchMe: jest.fn() }));
jest.mock('@/lib/session-store', () => ({ getWorkspaceItem: () => 't1' }));
jest.mock('@/contexts/PlatformFeaturesContext', () => ({ usePlatformFeatures: () => ({ externalImport: false }) }));
jest.mock('./DemoDataCard', () => () => null);

const { fetchWithAuth } = jest.requireMock('@/lib/api');
const { fetchMe } = jest.requireMock('@/hooks/use-me');

function owner(stores: { id: string; name: string }[]) {
    fetchMe.mockResolvedValue({ tenants: [{ id: 't1', role: 'OWNER', stores }] });
}

async function renderPage() {
    render(<DataManagementPage />);
    await waitFor(() => screen.getByRole('button', { name: /clear all data/i }));
}

function typeAndConfirm(word: string) {
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: word } });
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }));
}

describe('DataManagementPage — Clear Data', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fetchWithAuth.mockResolvedValue({ cleared: 'all' });
    });

    it('clears all of the shop, keeping the groups unticked', async () => {
        owner([{ id: 's1', name: 'Main' }]);
        await renderPage();

        fireEvent.click(screen.getByRole('button', { name: /clear all data/i }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /Products & pricing/ }));
        typeAndConfirm('clear all');

        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith('/tenants/data?mode=all&keep=products', { method: 'DELETE' });
        });
    });

    it('clears all of one branch, offering only its own data', async () => {
        owner([{ id: 's1', name: 'Main' }, { id: 's2', name: 'Uttara' }]);
        await renderPage();

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 's2' } });
        fireEvent.click(screen.getByRole('button', { name: /clear all data/i }));

        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByText(/Uttara/)).toBeInTheDocument();
        expect(dialog.getAllByRole('checkbox')).toHaveLength(3);
        fireEvent.click(dialog.getByRole('checkbox', { name: /Stock levels/ }));
        typeAndConfirm('clear all');

        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith('/tenants/data?mode=all&storeId=s2&keep=stock', { method: 'DELETE' });
        });
    });

    it("clears one branch's transactions, with no checklist", async () => {
        owner([{ id: 's1', name: 'Main' }, { id: 's2', name: 'Uttara' }]);
        await renderPage();

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 's2' } });
        fireEvent.click(screen.getByRole('button', { name: /clear transactions/i }));

        expect(within(screen.getByRole('dialog')).queryByRole('checkbox')).not.toBeInTheDocument();
        typeAndConfirm('clear');

        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith('/tenants/data?mode=transactions&storeId=s2', { method: 'DELETE' });
        });
    });
});
