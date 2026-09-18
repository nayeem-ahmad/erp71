import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BadDebtsReportPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getCustomerWriteOffs: jest.fn(),
        reverseCustomerWriteOff: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('@/lib/toast');

const ROW = {
    id: 'wo-1',
    payment_number: 'CWO-00001',
    amount: 3000,
    notes: 'Shop shut, phone dead since March.',
    reason: 'UNTRACEABLE',
    created_at: '2026-09-01T00:00:00.000Z',
    accounting_voucher_number: 'JV-00042',
    customer: { id: 'cust-1', name: 'Alice Corp', phone: '01700000001' },
    creator: { id: 'user-1', name: 'Rahim' },
};

beforeEach(() => {
    jest.clearAllMocks();
    api.getCustomerWriteOffs.mockResolvedValue([ROW]);
    api.reverseCustomerWriteOff.mockResolvedValue({ reversed: true });
});

describe('BadDebtsReportPage', () => {
    it('lists each write-off with who entered it and why', async () => {
        render(<BadDebtsReportPage />);

        expect(await screen.findByText('Alice Corp')).toBeInTheDocument();
        expect(screen.getByText('CWO-00001')).toBeInTheDocument();
        expect(screen.getByText('Cannot be traced')).toBeInTheDocument();
        expect(screen.getByText('Shop shut, phone dead since March.')).toBeInTheDocument();
        expect(screen.getByText('Rahim')).toBeInTheDocument();
        // The voucher number ties the row to the ledger entry behind it.
        expect(screen.getByText('JV-00042')).toBeInTheDocument();
    });

    it('totals what has been forgiven', async () => {
        api.getCustomerWriteOffs.mockResolvedValue([ROW, { ...ROW, id: 'wo-2', amount: 1500 }]);
        render(<BadDebtsReportPage />);

        expect(await screen.findByText(/4,500/)).toBeInTheDocument();
    });

    it('says so plainly when nothing has been written off', async () => {
        api.getCustomerWriteOffs.mockResolvedValue([]);
        render(<BadDebtsReportPage />);

        expect(await screen.findByText('No data found')).toBeInTheDocument();
    });

    // Reversing puts a real debt back on a customer's ledger, so it asks first.
    it('confirms before reversing, and does nothing if cancelled', async () => {
        render(<BadDebtsReportPage />);
        fireEvent.click(await screen.findByRole('button', { name: /reverse/i }));

        expect(await screen.findByText(/put this debt back/i)).toBeInTheDocument();
        expect(api.reverseCustomerWriteOff).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        await waitFor(() =>
            expect(screen.queryByText(/put this debt back/i)).not.toBeInTheDocument(),
        );
        expect(api.reverseCustomerWriteOff).not.toHaveBeenCalled();
    });

    it('reverses on confirm and reloads the register', async () => {
        render(<BadDebtsReportPage />);
        fireEvent.click(await screen.findByRole('button', { name: /reverse/i }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /reverse/i }));

        await waitFor(() => expect(api.reverseCustomerWriteOff).toHaveBeenCalledWith('wo-1'));
        expect(toast.success).toHaveBeenCalled();
        // Reloaded, so a reversal that changed the list is reflected.
        await waitFor(() => expect(api.getCustomerWriteOffs).toHaveBeenCalledTimes(2));
    });

    it('surfaces a refused reversal without dropping the row', async () => {
        api.reverseCustomerWriteOff.mockRejectedValue(new Error('Period is locked'));
        render(<BadDebtsReportPage />);
        fireEvent.click(await screen.findByRole('button', { name: /reverse/i }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /reverse/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Period is locked'));
        expect(screen.getByText('Alice Corp')).toBeInTheDocument();
    });
});
