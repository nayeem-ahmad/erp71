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

import { render, screen, waitFor } from '@testing-library/react';
import SupplierLedgerPage from './page';
import { api } from '@/lib/api';

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

let mockTableProps: any = null;
jest.mock('@/components/data-table', () => ({
    DataTable: (props: { title: string }) => {
        mockTableProps = props;
        return <div data-testid="ledger-table">{props.title}</div>;
    },
}));

const ACME = { id: 'sup-acme', name: 'Acme Supplies', phone: '01700000001', due_balance: 100 };
const BETA = { id: 'sup-beta', name: 'Beta Goods', phone: '01700000002', due_balance: 40 };

const EMPTY_LEDGER = {
    due_balance: 0,
    opening_balance: 0,
    closing_balance: 0,
    transactions: [],
};

describe('SupplierLedgerPage linked supplier', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTableProps = null;
        searchParams = { supplierId: ACME.id };
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
        (api.getSuppliers as jest.Mock).mockResolvedValue([ACME]);
        (api.getSupplierGlLedger as jest.Mock).mockResolvedValue(EMPTY_LEDGER);
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
        expect(align('status')).toBeUndefined();
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
});
