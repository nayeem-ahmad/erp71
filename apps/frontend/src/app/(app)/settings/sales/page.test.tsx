import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SalesSettingsPage from './page';

jest.mock('@/lib/api', () => ({
    api: { getSalesSettings: jest.fn(), updateSalesSettings: jest.fn() },
}));
jest.mock('@/hooks/use-me', () => ({ fetchMe: jest.fn() }));
jest.mock('@/lib/session-store', () => ({ getWorkspaceItem: () => 't1' }));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api');
const { fetchMe } = jest.requireMock('@/hooks/use-me');

const SWITCH = /Sell only to the branch's own customers/;

function member(role: string, permissions: string[] = []) {
    fetchMe.mockResolvedValue({ tenants: [{ id: 't1', role, permissions }] });
}

async function renderPage() {
    render(<SalesSettingsPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Save Settings' }));
}

describe('SalesSettingsPage — branch customers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getSalesSettings.mockResolvedValue({ paper_size: 'A4', branch_customers_only: true });
        api.updateSalesSettings.mockResolvedValue({});
    });

    it('lets an owner turn the rule off', async () => {
        member('OWNER');
        await renderPage();

        const box = screen.getByRole('checkbox', { name: SWITCH });
        expect(box).toBeChecked();
        fireEvent.click(box);
        fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

        await waitFor(() => expect(api.updateSalesSettings).toHaveBeenCalledWith(
            expect.objectContaining({ branch_customers_only: false }),
        ));
    });

    it('lets a tenant admin change it too', async () => {
        member('MEMBER', ['MANAGE_USERS']);
        await renderPage();

        fireEvent.click(screen.getByRole('checkbox', { name: SWITCH }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

        await waitFor(() => expect(api.updateSalesSettings).toHaveBeenCalledWith(
            expect.objectContaining({ branch_customers_only: false }),
        ));
        // The owner-only checkout switches stay out of a tenant admin's save.
        expect(api.updateSalesSettings.mock.calls[0][0]).not.toHaveProperty('pos_enabled');
    });

    it('is shown on for a tenant that has never set it', async () => {
        api.getSalesSettings.mockResolvedValue({ paper_size: 'A4' });
        member('OWNER');
        await renderPage();

        expect(screen.getByRole('checkbox', { name: SWITCH })).toBeChecked();
    });

    it('is neither shown to nor sent by a member without admin rights', async () => {
        member('MEMBER', ['CREATE_SALE']);
        await renderPage();

        expect(screen.queryByRole('checkbox', { name: SWITCH })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

        await waitFor(() => expect(api.updateSalesSettings).toHaveBeenCalled());
        expect(api.updateSalesSettings.mock.calls[0][0]).not.toHaveProperty('branch_customers_only');
    });
});
