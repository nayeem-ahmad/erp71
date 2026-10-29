jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');

    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, unknown> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createdRangeFromPreset } from '@/lib/created-range';
import CustomerLedgerPage from './page';
import { api } from '@/lib/api';
import { mockBranchScope } from '@/test-utils/branch-scope';

let searchParams: Record<string, string> = {};

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: (key: string) => searchParams[key] ?? null }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCustomers: jest.fn(),
        getCustomerGlLedger: jest.fn(),
    },
}));

// What the page hands the table: its columns, the toolbar filters, View options.
let mockTableProps: any = null;
jest.mock('@/components/data-table', () => ({
    DataTable: (props: { title: string }) => {
        mockTableProps = props;
        return <div data-testid="ledger-table">{props.title}</div>;
    },
}));

const ALICE = { id: 'cust-alice', name: 'Alice Corp', phone: '01700000001', due_balance: 100 };
const BOB = { id: 'cust-bob', name: 'Bob Traders', phone: '01700000002', due_balance: 50 };
const KARIM = { id: 'cust-karim', name: 'Karim Electronics', phone: '01700000003', due_balance: 0 };

const EMPTY_LEDGER = {
    due_balance: 0,
    opening_balance: 0,
    closing_balance: 0,
    transactions: [],
};

describe('CustomerLedgerPage customer picker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = {};
        mockBranchScope();
        (api.getCustomers as jest.Mock).mockResolvedValue([ALICE, BOB, KARIM]);
        (api.getCustomerGlLedger as jest.Mock).mockResolvedValue(EMPTY_LEDGER);
    });

    it('narrows the customer list as you type and loads the picked ledger', async () => {
        render(<CustomerLedgerPage />);

        const search = await screen.findByLabelText('Select customer…');
        await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-alice', expect.any(Object)));

        fireEvent.focus(search);
        fireEvent.change(search, { target: { value: 'Bob' } });

        expect(await screen.findByText('Bob Traders')).toBeInTheDocument();
        expect(screen.queryByText(/Karim Electronics/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Bob Traders'));

        await waitFor(() => {
            expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-bob', expect.any(Object));
        });
    });
});

describe('CustomerLedgerPage branch', () => {
    // Dhaka (store-1, the header branch) has Alice and Bob; Chattogram has Karim.
    const BY_BRANCH: Record<string, typeof ALICE[]> = {
        'store-1': [ALICE, BOB],
        'store-2': [KARIM],
        all: [ALICE, BOB, KARIM],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = {};
        mockBranchScope();
        (api.getCustomers as jest.Mock).mockImplementation(
            async ({ storeId }: { storeId?: string } = {}) => BY_BRANCH[storeId ?? 'all'],
        );
        (api.getCustomerGlLedger as jest.Mock).mockResolvedValue(EMPTY_LEDGER);
    });

    it("lists the header branch's customers", async () => {
        render(<CustomerLedgerPage />);

        await waitFor(() => expect(api.getCustomers).toHaveBeenCalledWith({ storeId: 'store-1' }));
        await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-alice', expect.any(Object)));
    });

    it("reloads the picker on a branch change and opens that branch's first customer", async () => {
        render(<CustomerLedgerPage />);
        await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-alice', expect.any(Object)));

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'store-2' } });

        await waitFor(() => expect(api.getCustomers).toHaveBeenLastCalledWith({ storeId: 'store-2' }));
        await waitFor(() => expect(api.getCustomerGlLedger).toHaveBeenLastCalledWith('cust-karim', expect.any(Object)));
        expect(screen.getByText('Karim Electronics')).toBeInTheDocument();
    });

    it('keeps a linked customer of another branch open, named from its ledger', async () => {
        searchParams = { customerId: 'cust-karim' };
        (api.getCustomerGlLedger as jest.Mock).mockResolvedValue({
            ...EMPTY_LEDGER,
            customer: { id: KARIM.id, name: KARIM.name, phone: KARIM.phone },
        });

        render(<CustomerLedgerPage />);

        await waitFor(() => expect(api.getCustomers).toHaveBeenCalledWith({ storeId: 'store-1' }));
        expect(await screen.findByText('Karim Electronics')).toBeInTheDocument();
        expect(api.getCustomerGlLedger).not.toHaveBeenCalledWith('cust-alice', expect.any(Object));
    });
});

describe('CustomerLedgerPage list UI', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTableProps = null;
        searchParams = {};
        mockBranchScope();
        (api.getCustomers as jest.Mock).mockResolvedValue([ALICE]);
        (api.getCustomerGlLedger as jest.Mock).mockResolvedValue(EMPTY_LEDGER);
    });

    it('opens on this month, on the workspace calendar', async () => {
        render(<CustomerLedgerPage />);

        const month = createdRangeFromPreset('thisMonth');
        await waitFor(() =>
            expect(api.getCustomerGlLedger).toHaveBeenCalledWith('cust-alice', { from: month.from, to: month.to }),
        );
    });

    it('draws the ledger with View options and its date range in the table toolbar', async () => {
        render(<CustomerLedgerPage />);
        await screen.findByTestId('ledger-table');

        expect(mockTableProps.viewOptions).toBe(true);
        expect(mockTableProps.filters).toEqual([
            expect.objectContaining({ id: 'date', type: 'date-range', label: 'Date' }),
        ]);
        // No date boxes of its own above the table any more.
        expect(screen.queryByText('Date (from)')).not.toBeInTheDocument();
    });

    it('reads the whole history once the range is cleared', async () => {
        render(<CustomerLedgerPage />);
        await screen.findByTestId('ledger-table');

        act(() => mockTableProps.filters[0].onChange(null));

        await waitFor(() =>
            expect(api.getCustomerGlLedger).toHaveBeenLastCalledWith('cust-alice', { from: undefined, to: undefined }),
        );
    });

    it('right-aligns sales total, paid, due, payment and balance', async () => {
        render(<CustomerLedgerPage />);
        await screen.findByTestId('ledger-table');

        const align = (id: string) =>
            mockTableProps.columns.find((column: any) => (column.id ?? column.accessorKey) === id)?.meta?.align;
        expect(align('sale_total')).toBe('end');
        expect(align('amount_paid')).toBe('end');
        expect(align('due')).toBe('end');
        expect(align('payment')).toBe('end');
        expect(align('balance_after')).toBe('end');
        expect(align('amount')).toBeUndefined();
    });

    it('keeps a fully paid sale on the ledger and totals the money columns', async () => {
        (api.getCustomerGlLedger as jest.Mock).mockResolvedValue({
            ...EMPTY_LEDGER,
            transactions: [
                {
                    id: 'sale:1',
                    type: 'SALE',
                    debit: 0,
                    credit: 0,
                    sale_total: 2000,
                    amount_paid: 2000,
                    payment_number: 'INV-002',
                    source_type: 'sale',
                    source_id: 'sale-1',
                    balance_before: 0,
                    balance_after: 0,
                    created_at: '2026-05-03T00:00:00.000Z',
                },
            ],
        });

        render(<CustomerLedgerPage />);

        await waitFor(() => {
            expect(mockTableProps.data.find((row: any) => row.id === 'sale:1')).toEqual(expect.objectContaining({
                type: 'SALE',
                sale_total: 2000,
                amount_paid: 2000,
                debit: 0,
                credit: 0,
                source_type: 'sale',
            }));
        });
        expect(mockTableProps.columns.find((column: any) => column.id === 'due')?.footer).toEqual(expect.any(Function));
        expect(mockTableProps.columns.find((column: any) => column.id === 'payment')?.footer).toEqual(expect.any(Function));
    });
});
