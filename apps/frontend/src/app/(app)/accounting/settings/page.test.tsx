import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountingSettingsPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/api', () => ({
    api: {
        getAccountingSettings: jest.fn(),
        updateAccountingSettings: jest.fn(),
        getMe: jest.fn(),
    },
}));

const mockMe = (role: string) => {
    (api.getMe as jest.Mock).mockResolvedValue({ tenants: [{ id: 'tenant-1', role, permissions: [] }] });
};

describe('AccountingSettingsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.setItem('tenant_id', 'tenant-1');
        (api.getAccountingSettings as jest.Mock).mockResolvedValue({
            requireVoucherApproval: false,
            autoApproveSystemVouchers: true,
            reportsApprovedOnly: false,
        });
        (api.updateAccountingSettings as jest.Mock).mockResolvedValue({});
    });

    it('saves the three approval flags for an owner', async () => {
        mockMe('OWNER');

        render(<AccountingSettingsPage />);

        const requireApproval = await screen.findByLabelText(/Require approval before a voucher counts/i);
        fireEvent.click(requireApproval);
        fireEvent.click(screen.getByLabelText(/Count only approved vouchers in reports/i));
        fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

        await waitFor(() => {
            expect(api.updateAccountingSettings).toHaveBeenCalledWith({
                requireVoucherApproval: true,
                autoApproveSystemVouchers: true,
                reportsApprovedOnly: true,
            });
        });
    });

    it('shows a read-only notice and no save button for a non-owner', async () => {
        mockMe('ACCOUNTANT');

        render(<AccountingSettingsPage />);

        expect(await screen.findByText(/Only the business owner can change these settings\./i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument();
    });

    it('keeps auto-approve disabled until approval is actually required', async () => {
        mockMe('OWNER');

        render(<AccountingSettingsPage />);

        const autoApprove = await screen.findByLabelText(/Auto-approve vouchers posted by other modules/i);
        expect(autoApprove).toBeDisabled();

        fireEvent.click(screen.getByLabelText(/Require approval before a voucher counts/i));
        expect(autoApprove).not.toBeDisabled();
    });
});
