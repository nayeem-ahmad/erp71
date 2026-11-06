import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BadDebtsReportPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getCustomerWriteOffs: jest.fn(),
        reverseCustomerWriteOff: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// A wide screen, so the secondary columns and the chips sit in the toolbar rather than the phone's sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/customers/reports/bad-debts',
    useSearchParams: () => ({ get: jest.fn() }),
}));

/** A toolbar chip: a button that opens its own panel. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

/** The figure beside a label in the summary strip. */
function stat(label: string) {
    const strip = screen.getByRole('region', { name: 'Write-off summary' });
    return within(strip).getByText(label).nextElementSibling?.textContent ?? '';
}

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

    it('totals what has been forgiven, in the strip and the total row', async () => {
        api.getCustomerWriteOffs.mockResolvedValue([ROW, { ...ROW, id: 'wo-2', amount: 1500 }]);
        render(<BadDebtsReportPage />);

        await waitFor(() => expect(stat('Written Off')).toContain('4,500'));
        expect(stat('Write-offs')).toBe('2');
        expect(stat('Customers')).toBe('1');
        expect(stat('Largest')).toContain('3,000');
        expect(screen.getAllByText(/4,500/)).toHaveLength(2);
    });

    it('narrows the register and its strip by reason', async () => {
        api.getCustomerWriteOffs.mockResolvedValue([
            ROW,
            { ...ROW, id: 'wo-2', amount: 1500, reason: 'REFUSED', customer: { id: 'cust-2', name: 'Bob Stores', phone: null } },
        ]);
        render(<BadDebtsReportPage />);
        await screen.findByText('Bob Stores');

        fireEvent.click(chip('Reason'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Refuses to pay' }));

        await waitFor(() => expect(screen.queryByText('Alice Corp')).not.toBeInTheDocument());
        expect(screen.getByText('Bob Stores')).toBeInTheDocument();
        expect(stat('Written Off')).toContain('1,500');
        expect(stat('Write-offs')).toBe('1');
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
