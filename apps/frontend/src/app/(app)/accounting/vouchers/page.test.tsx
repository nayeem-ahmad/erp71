import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountingVouchersListPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    CreatedRangeFilter: () => <div data-testid="created-range-filter" />,
    DataTable: ({ columns, data, enableRowSelection, onRowSelectionChange, bulkActions }: {
        columns: Array<{ id?: string; accessorKey?: string; header: unknown; cell: (info: unknown) => React.ReactNode }>;
        data: Array<Record<string, unknown>>;
        enableRowSelection?: boolean;
        onRowSelectionChange?: (rows: Array<Record<string, unknown>>) => void;
        bulkActions?: Array<{ label: string; onClick: (rows: Array<Record<string, unknown>>) => void }>;
    }) => (
        <div>
            {enableRowSelection ? (
                <button type="button" onClick={() => onRowSelectionChange?.(data)}>select-all</button>
            ) : null}
            {(bulkActions ?? []).map((action) => (
                <button key={action.label} type="button" onClick={() => action.onClick(data)}>
                    bulk-{action.label}
                </button>
            ))}
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
                    {/* Display columns (the action buttons) take the row, not a value. */}
                    {columns
                        .filter((column) => !column.accessorKey && column.id === 'actions')
                        .map((column) => (
                            <span key={column.id}>{column.cell({ row: { original: row } })}</span>
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
    Check: () => <span />,
    Copy: () => <span />,
    X: () => <span />,
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
        approveVoucher: jest.fn(),
        rejectVoucher: jest.fn(),
        bulkApproveVouchers: jest.fn(),
        bulkRejectVouchers: jest.fn(),
        getPendingVoucherCount: jest.fn().mockResolvedValue({ count: 0, approvalEnabled: false }),
        // The page resolves the caller's APPROVE_VOUCHER grant on mount.
        getMe: jest.fn().mockResolvedValue({ tenants: [{ id: 'tenant-1', role: 'ACCOUNTANT', permissions: [] }] }),
    },
}));

describe('AccountingVouchersListPage', () => {
    beforeEach(() => {
        // Mock state leaks between tests otherwise — the bulk assertions below
        // check that an endpoint was NOT called, which a stale call defeats.
        jest.clearAllMocks();
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'ACCOUNTANT', permissions: [] }],
        });
        (api.getPendingVoucherCount as jest.Mock).mockResolvedValue({ count: 0, approvalEnabled: false });
    });

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

    it('offers a duplicate action that opens the entry form prefilled from the voucher', async () => {
        (api.getVouchers as jest.Mock).mockResolvedValue({
            data: [
                {
                    id: 'voucher-1',
                    voucher_number: 'CP-00001',
                    voucher_type: 'cash_payment',
                    reference_number: 'CP-REF-01',
                    date: '2026-03-21T00:00:00.000Z',
                    description: 'Office rent for March',
                    total_amount: 125,
                    // System-posted vouchers cannot be edited, but they can be copied.
                    source: { module: 'sales', type: 'invoice', id: 'inv-1' },
                },
            ],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });

        render(<AccountingVouchersListPage />);

        const duplicate = await screen.findByTitle('Duplicate voucher');
        expect(duplicate).toHaveAttribute('href', '/accounting/vouchers/new?duplicate=voucher-1');
    });

    it('badges an unapproved voucher and filters the list down to the approval queue', async () => {
        const getVouchers = api.getVouchers as jest.Mock;
        getVouchers.mockResolvedValue({
            data: [
                {
                    id: 'voucher-2',
                    voucher_number: 'JV-00007',
                    voucher_type: 'journal',
                    reference_number: null,
                    date: '2026-03-22T00:00:00.000Z',
                    description: 'Accrual',
                    total_amount: 400,
                    approval_status: 'PENDING',
                },
            ],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });

        render(<AccountingVouchersListPage />);

        await waitFor(() => {
            expect(screen.getByText('JV-00007')).toBeInTheDocument();
        });

        // "Pending" also names an option in the status filter, so pin the badge itself.
        expect(screen.getAllByText('Pending').some((node) => node.tagName === 'SPAN')).toBe(true);

        fireEvent.change(screen.getByLabelText('Approval'), { target: { value: 'PENDING' } });

        await waitFor(() => {
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ approvalStatus: 'PENDING' }));
        });
    });

    it('bulk-approves the selected pending vouchers and refreshes the list', async () => {
        const getVouchers = api.getVouchers as jest.Mock;
        getVouchers.mockResolvedValue({
            data: [
                {
                    id: 'voucher-2',
                    voucher_number: 'JV-00007',
                    voucher_type: 'journal',
                    reference_number: null,
                    date: '2026-03-22T00:00:00.000Z',
                    description: 'Accrual',
                    total_amount: 400,
                    approval_status: 'PENDING',
                },
            ],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'ACCOUNTANT', permissions: ['APPROVE_VOUCHER'] }],
        });
        (api.bulkApproveVouchers as jest.Mock).mockResolvedValue({ updated: 1, skipped: 0, notFound: 0 });

        render(<AccountingVouchersListPage />);

        await waitFor(() => {
            expect(screen.getByText('select-all')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('select-all'));
        fireEvent.click(await screen.findByText('bulk-Approve selected'));

        await waitFor(() => {
            expect(api.bulkApproveVouchers).toHaveBeenCalledWith(['voucher-2']);
        });
    });

    it('does not call the API when the selection holds nothing pending', async () => {
        const getVouchers = api.getVouchers as jest.Mock;
        getVouchers.mockResolvedValue({
            data: [
                {
                    id: 'voucher-3',
                    voucher_number: 'JV-00008',
                    voucher_type: 'journal',
                    reference_number: null,
                    date: '2026-03-23T00:00:00.000Z',
                    description: 'Already signed off',
                    total_amount: 400,
                    approval_status: 'APPROVED',
                },
            ],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
        (api.getMe as jest.Mock).mockResolvedValue({
            tenants: [{ id: 'tenant-1', role: 'ACCOUNTANT', permissions: ['APPROVE_VOUCHER'] }],
        });

        render(<AccountingVouchersListPage />);

        fireEvent.click(await screen.findByText('select-all'));
        fireEvent.click(await screen.findByText('bulk-Approve selected'));

        await waitFor(() => {
            expect(screen.getByText('bulk-Approve selected')).toBeInTheDocument();
        });
        expect(api.bulkApproveVouchers).not.toHaveBeenCalled();
    });
});
