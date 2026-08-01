import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountingVouchersListPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('@/components/data-table', () => ({
    DataTable: ({ columns, data }: {
        columns: Array<{ id?: string; accessorKey?: string; header: unknown; cell: (info: unknown) => React.ReactNode }>;
        data: Array<Record<string, unknown>>;
    }) => (
        <div>
            <div>
                {columns.map((column, index) => (
                    <span key={column.id ?? column.accessorKey ?? index}>
                        {typeof column.header === 'string' ? column.header : null}
                    </span>
                ))}
            </div>
            {data.map((row) => (
                <div key={String(row.voucher_number)}>
                    {columns
                        .filter((column) => column.accessorKey)
                        .map((column, index) => (
                            <span key={column.accessorKey ?? index}>
                                {column.cell({ getValue: () => row[column.accessorKey as string] })}
                            </span>
                        ))}
                </div>
            ))}
        </div>
    ),
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ businessName: 'Demo Store' }),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('lucide-react', () => ({
    ChevronLeft: () => <span />,
    ChevronRight: () => <span />,
    Eye: () => <span />,
    FileText: () => <span />,
    Pencil: () => <span />,
    Plus: () => <span />,
    Printer: () => <span />,
    Trash2: () => <span />,
}));

jest.mock('@/lib/api', () => ({
    // The print-header hook resolves the tenant's print template on mount.
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getVouchers: jest.fn(),
        getVoucher: jest.fn(),
        deleteVoucher: jest.fn(),
    },
}));

describe('AccountingVouchersListPage', () => {
    it('loads voucher rows with filters and pagination controls', async () => {
        const getVouchers = api.getVouchers as jest.Mock;
        getVouchers.mockResolvedValue({
            data: [
                {
                    id: 'voucher-1',
                    voucher_number: 'CP-00001',
                    voucher_type: 'cash_payment',
                    reference_number: 'CP-REF-01',
                    date: '2026-03-21T00:00:00.000Z',
                    description: 'Office rent for March',
                    total_amount: 125,
                },
            ],
            meta: { page: 1, limit: 20, total: 2, totalPages: 2 },
        });

        render(<AccountingVouchersListPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
        });

        expect(screen.getByText('Narration')).toBeInTheDocument();
        expect(screen.getByText('Office rent for March')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Journal voucher type'), {
            target: { value: 'cash_payment' },
        });

        await waitFor(() => {
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ voucherType: 'cash_payment' }));
        });

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        await waitFor(() => {
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
        });
    });
});