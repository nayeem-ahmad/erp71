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
import SupplierLedgerPage from './page';
import { api } from '@/lib/api';
import { mockBranchScope } from '@/test-utils/branch-scope';

let searchParams: Record<string, string> = {};

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: (key: string) => searchParams[key] ?? null }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getSuppliers: jest.fn(),
        getSupplierGlLedger: jest.fn(),
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

/** The strip's current-payable tile names whose ledger is open. */
function currentDueHint() {
    return mockTableProps?.stats?.items.find((item: any) => item.id === 'current')?.hint;
}

/** A strip figure by its id. */
function statValue(id: string) {
    return mockTableProps?.stats?.items.find((item: any) => item.id === id)?.value;
}

const ACME = { id: 'sup-acme', name: 'Acme Supplies', phone: '01700000001', due_balance: 100 };
const BETA = { id: 'sup-beta', name: 'Beta Goods', phone: '01700000002', due_balance: 40 };
const GAMMA = { id: 'sup-gamma', name: 'Gamma Traders', phone: '01700000003', due_balance: 0 };

const EMPTY_LEDGER = {
    due_balance: 0,
    opening_balance: 0,
    closing_balance: 0,
    transactions: [],
};

describe('SupplierLedgerPage branch', () => {
    // Dhaka (store-1, the header branch) has Acme and Beta; Chattogram has Gamma.
    const BY_BRANCH: Record<string, typeof ACME[]> = {
        'store-1': [ACME, BETA],
        'store-2': [GAMMA],
        all: [ACME, BETA, GAMMA],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = {};
        mockBranchScope();
        (api.getSuppliers as jest.Mock).mockImplementation(
            async ({ storeId }: { storeId?: string } = {}) => BY_BRANCH[storeId ?? 'all'],
        );
        (api.getSupplierGlLedger as jest.Mock).mockResolvedValue(EMPTY_LEDGER);
    });

    it("lists the header branch's suppliers", async () => {
        render(<SupplierLedgerPage />);

        await waitFor(() => expect(api.getSuppliers).toHaveBeenCalledWith({ storeId: 'store-1' }));
        await waitFor(() => expect(api.getSupplierGlLedger).toHaveBeenCalledWith('sup-acme', expect.any(Object)));
    });

    it("reloads the picker on a branch change and opens that branch's first supplier", async () => {
        render(<SupplierLedgerPage />);
        await waitFor(() => expect(api.getSupplierGlLedger).toHaveBeenCalledWith('sup-acme', expect.any(Object)));

        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'store-2' } });

        await waitFor(() => expect(api.getSuppliers).toHaveBeenLastCalledWith({ storeId: 'store-2' }));
        await waitFor(() => expect(api.getSupplierGlLedger).toHaveBeenLastCalledWith('sup-gamma', expect.any(Object)));
        await waitFor(() => expect(currentDueHint()).toBe('Gamma Traders'));
    });

    it('keeps a linked supplier of another branch open, named from its ledger', async () => {
        searchParams = { supplierId: 'sup-gamma' };
        (api.getSupplierGlLedger as jest.Mock).mockResolvedValue({
            ...EMPTY_LEDGER,
            supplier: { id: GAMMA.id, name: GAMMA.name, phone: GAMMA.phone },
        });

        render(<SupplierLedgerPage />);

        await waitFor(() => expect(api.getSuppliers).toHaveBeenCalledWith({ storeId: 'store-1' }));
        await waitFor(() => expect(currentDueHint()).toBe('Gamma Traders'));
        expect(api.getSupplierGlLedger).not.toHaveBeenCalledWith('sup-acme', expect.any(Object));
    });
});

describe('SupplierLedgerPage linked supplier', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTableProps = null;
        searchParams = { supplierId: ACME.id };
        mockBranchScope();
        (api.getSuppliers as jest.Mock).mockResolvedValue([BETA, ACME]);
        (api.getSupplierGlLedger as jest.Mock).mockResolvedValue({
            ...EMPTY_LEDGER,
            supplier: { id: ACME.id, name: ACME.name, phone: ACME.phone },
        });
    });

    it('opens the linked supplier without picking from the list', async () => {
        render(<SupplierLedgerPage />);

        await waitFor(() => {
            expect(api.getSupplierGlLedger).toHaveBeenCalledWith('sup-acme', expect.any(Object));
        });
        expect(api.getSupplierGlLedger).not.toHaveBeenCalledWith('sup-beta', expect.any(Object));
        expect(await screen.findByPlaceholderText('Acme Supplies')).toBeInTheDocument();
    });
});

describe('SupplierLedgerPage list UI', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTableProps = null;
        searchParams = {};
        mockBranchScope();
        (api.getSuppliers as jest.Mock).mockResolvedValue([ACME]);
        (api.getSupplierGlLedger as jest.Mock).mockResolvedValue(EMPTY_LEDGER);
    });

    it('opens on this month, on the workspace calendar', async () => {
        render(<SupplierLedgerPage />);

        const month = createdRangeFromPreset('thisMonth');
        await waitFor(() =>
            expect(api.getSupplierGlLedger).toHaveBeenCalledWith('sup-acme', { from: month.from, to: month.to }),
        );
    });

    it('draws the ledger with View options and its date range in the table toolbar', async () => {
        render(<SupplierLedgerPage />);
        await screen.findByTestId('ledger-table');

        expect(mockTableProps.viewOptions).toBe(true);
        expect(mockTableProps.filterLayout).toBe('row');
        expect(mockTableProps.filters).toEqual([
            expect.objectContaining({ id: 'date', type: 'date-range', label: 'Date', operators: true }),
            expect.objectContaining({ id: 'direction', type: 'multi-select', label: 'Direction' }),
        ]);
        // The balances sit in the table's strip rather than in cards above it.
        expect(mockTableProps.stats.items.map((item: any) => item.id)).toEqual(
            ['opening', 'purchases', 'due', 'payment', 'closing', 'current'],
        );
        // No date boxes of its own above the table any more.
        expect(screen.queryByText('Date (from)')).not.toBeInTheDocument();
    });

    it('reads the whole history once the range is cleared', async () => {
        render(<SupplierLedgerPage />);
        await screen.findByTestId('ledger-table');

        act(() => mockTableProps.filters[0].onChange(null));

        await waitFor(() =>
            expect(api.getSupplierGlLedger).toHaveBeenLastCalledWith('sup-acme', { from: undefined, to: undefined }),
        );
    });

    it('right-aligns purchase total, paid, due, payment and balance', async () => {
        render(<SupplierLedgerPage />);
        await screen.findByTestId('ledger-table');

        const align = (id: string) =>
            mockTableProps.columns.find((column: any) => (column.id ?? column.accessorKey) === id)?.meta?.align;
        expect(align('purchase_total')).toBe('end');
        expect(align('amount_paid')).toBe('end');
        expect(align('due')).toBe('end');
        expect(align('payment')).toBe('end');
        expect(align('balance_after')).toBe('end');
        expect(align('amount')).toBeUndefined();
    });

    it('keeps a fully paid purchase on the ledger and totals the money columns', async () => {
        (api.getSupplierGlLedger as jest.Mock).mockResolvedValue({
            ...EMPTY_LEDGER,
            transactions: [
                {
                    id: 'purchase:1',
                    type: 'PURCHASE',
                    debit: 0,
                    credit: 0,
                    purchase_total: 2000,
                    amount_paid: 2000,
                    payment_number: 'PUR-002',
                    source_type: 'purchase',
                    source_id: 'pur-1',
                    balance_before: 0,
                    balance_after: 0,
                    created_at: '2026-05-03T00:00:00.000Z',
                },
            ],
        });

        render(<SupplierLedgerPage />);

        await waitFor(() => {
            expect(mockTableProps.data.find((row: any) => row.id === 'purchase:1')).toEqual(expect.objectContaining({
                type: 'PURCHASE',
                purchase_total: 2000,
                amount_paid: 2000,
                debit: 0,
                credit: 0,
                source_type: 'purchase',
            }));
        });
        expect(mockTableProps.columns.find((column: any) => column.id === 'due')?.footer).toEqual(expect.any(Function));
        expect(mockTableProps.columns.find((column: any) => column.id === 'payment')?.footer).toEqual(expect.any(Function));
    });

    describe('chips and strip', () => {
        const LEDGER = {
            due_balance: 1500,
            opening_balance: 500,
            closing_balance: 1500,
            transactions: [
                {
                    id: 'tx-1', type: 'CREDIT_PURCHASE', debit: 3000, credit: 0, purchase_total: 3000, amount_paid: 0,
                    payment_number: 'PUR-001', balance_after: 3500, notes: null, created_at: '2026-05-02T00:00:00.000Z',
                },
                {
                    id: 'tx-2', type: 'PAYMENT', debit: 0, credit: 2000, purchase_total: null, amount_paid: null,
                    payment_number: 'SPAY-001', balance_after: 1500, notes: 'bKash', created_at: '2026-05-04T00:00:00.000Z',
                },
            ],
        };

        beforeEach(() => {
            (api.getSupplierGlLedger as jest.Mock).mockResolvedValue(LEDGER);
        });

        it('reads opening and closing from the ledger and sums the entries', async () => {
            render(<SupplierLedgerPage />);
            await waitFor(() => expect(mockTableProps?.data).toHaveLength(3));

            expect(statValue('opening')).toContain('500');
            expect(statValue('closing')).toContain('1,500');
            expect(statValue('due')).toContain('3,000');
            expect(statValue('payment')).toContain('2,000');
            expect(mockTableProps.stats.items.find((item: any) => item.id === 'closing').tone).toBe('warning');
        });

        it('narrows by direction and keeps the opening balance row', async () => {
            render(<SupplierLedgerPage />);
            await waitFor(() => expect(mockTableProps?.data).toHaveLength(3));

            act(() => mockTableProps.filters.find((filter: any) => filter.id === 'direction').onChange(['pay']));

            await waitFor(() => expect(mockTableProps.data.map((row: any) => row.id)).toEqual(['__opening__', 'tx-2']));
            expect(statValue('due')).toContain('0');
            expect(statValue('payment')).toContain('2,000');
        });

        it('searches the entries, and the strip follows', async () => {
            render(<SupplierLedgerPage />);
            await waitFor(() => expect(mockTableProps?.data).toHaveLength(3));

            act(() => mockTableProps.onSearchChange('PUR-001'));

            await waitFor(() => expect(mockTableProps.data.map((row: any) => row.id)).toEqual(['__opening__', 'tx-1']));
            expect(statValue('payment')).toContain('0');
            expect(statValue('due')).toContain('3,000');
        });
    });
});
