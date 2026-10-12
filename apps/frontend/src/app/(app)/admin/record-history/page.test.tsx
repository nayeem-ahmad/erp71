import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import AdminRecordHistoryPage from './page';

jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, emptyMessage, onRowClick }: { data: any[]; emptyMessage?: string; onRowClick?: (row: any) => void }) => (
        <div data-testid="data-table">
            {data.length === 0 ? (
                <span>{emptyMessage}</span>
            ) : (
                data.map((row) => (
                    <button key={row.id} type="button" onClick={() => onRowClick?.(row)}>
                        {row.entity_label}
                    </button>
                ))
            )}
        </div>
    ),
    createdAtColumn: () => ({ id: 'created_at' }),
    CreatedRangeFilter: () => null,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getAdminTenants: jest.fn(),
        getAdminRecordHistory: jest.fn(),
        getAdminRecordHistoryEntry: jest.fn(),
        getRecordHistorySettings: jest.fn(),
        updateRecordHistorySettings: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/admin/record-history',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
}));

const mockedApi = api as jest.Mocked<typeof api>;

const row = {
    id: '0b9e6d4c-1d7a-4c38-9a40-2f5f0f1e9a11',
    tenant_id: 't1',
    tenant_name: 'KH Trading',
    entity_type: 'SALE',
    entity_id: 'sale-1',
    entity_label: 'INV-2627-00001',
    action: 'UPDATE',
    change_count: 2,
    changed_paths: ['total_amount', 'items[Oil 1L].quantity'],
    ip_address: '198.51.100.7',
    created_at: '2026-10-12T04:00:00.000Z',
    user: { id: 'u1', name: 'Nayeem', email: 'n@example.com' },
};

beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getAdminTenants.mockResolvedValue([{ id: 't1', name: 'KH Trading' }]);
    mockedApi.getAdminRecordHistory.mockResolvedValue({ rows: [row], total: 1, limit: 50, offset: 0 });
    mockedApi.getAdminRecordHistoryEntry.mockResolvedValue({
        ...row,
        user_agent: 'Chrome',
        before: { total_amount: 400, items: [{ _key: 'p1', _label: 'Oil 1L', quantity: 2 }] },
        after: { total_amount: 720, items: [{ _key: 'p1', _label: 'Oil 1L', quantity: 3 }] },
        changes: [
            { path: 'total_amount', from: 400, to: 720 },
            { path: 'items[Oil 1L].quantity', from: 2, to: 3 },
        ],
    });
    mockedApi.getRecordHistorySettings.mockResolvedValue({ customer: 'true', sale: 'false', retention_days: '365' });
    mockedApi.updateRecordHistorySettings.mockResolvedValue({});
});

describe('AdminRecordHistoryPage', () => {
    it('lists history and filters by record type', async () => {
        render(<AdminRecordHistoryPage />);

        expect(await screen.findByText('INV-2627-00001')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'PURCHASE' } });

        await waitFor(() =>
            expect(mockedApi.getAdminRecordHistory).toHaveBeenLastCalledWith(
                expect.objectContaining({ entity_type: 'PURCHASE', offset: 0 }),
            ),
        );
    });

    it('opens an entry with its field-level changes', async () => {
        render(<AdminRecordHistoryPage />);

        fireEvent.click(await screen.findByText('INV-2627-00001'));

        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByText('items › Oil 1L › quantity')).toBeInTheDocument();
        expect(within(dialog).getByText('total amount')).toBeInTheDocument();
        expect(within(dialog).getByText('720')).toBeInTheDocument();
        expect(within(dialog).getByText('KH Trading')).toBeInTheDocument();
    });

    it("narrows the list to one record's history from an entry", async () => {
        render(<AdminRecordHistoryPage />);
        fireEvent.click(await screen.findByText('INV-2627-00001'));
        const dialog = await screen.findByRole('dialog');

        fireEvent.click(within(dialog).getByRole('button', { name: /All history for this record/ }));

        await waitFor(() =>
            expect(mockedApi.getAdminRecordHistory).toHaveBeenLastCalledWith(
                expect.objectContaining({ entity_id: 'sale-1' }),
            ),
        );
        expect(screen.getByText(/Showing the history of one record: INV-2627-00001/)).toBeInTheDocument();
    });

    it('saves every switch and the retention from the settings panel', async () => {
        render(<AdminRecordHistoryPage />);
        fireEvent.click(screen.getByRole('button', { name: /Settings/ }));

        const dialog = await screen.findByRole('dialog');
        const sale = await within(dialog).findByRole('switch', { name: 'Sale' });
        expect(sale).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(sale);

        fireEvent.change(within(dialog).getByLabelText('Keep history for (days)'), { target: { value: '90' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mockedApi.updateRecordHistorySettings).toHaveBeenCalled());
        expect(mockedApi.updateRecordHistorySettings).toHaveBeenCalledWith(
            expect.objectContaining({ sale: 'true', customer: 'true', supplier_payment: 'true', retention_days: '90' }),
        );
        expect(toast.success).toHaveBeenCalledWith('Record history settings saved');
    });

    it('refuses a retention that is not a whole number of days', async () => {
        render(<AdminRecordHistoryPage />);
        fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
        const dialog = await screen.findByRole('dialog');
        const input = await within(dialog).findByLabelText('Keep history for (days)');

        fireEvent.change(input, { target: { value: '-5' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        expect(await within(dialog).findByText('Enter a whole number of days, 0 or more.')).toBeInTheDocument();
        expect(mockedApi.updateRecordHistorySettings).not.toHaveBeenCalled();
    });
});
