import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import InventoryTransfersPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/test',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, className }: any) => (
        <a href={href} className={className}>{children}</a>
    ),
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ data }: any) => <div data-testid="data-table">{data?.length} rows</div>,
}));

jest.mock('@/components/PostingBadge', () => ({
    PostingBadge: ({ status }: any) => <span>{status}</span>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getWarehouseTransfers: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProducts: jest.fn(),
        createWarehouseTransfer: jest.fn(),
    },
}));

import { api } from '@/lib/api';
const mockApi = api as jest.Mocked<typeof api>;

const sampleTransfers = [
    {
        id: 't1',
        transfer_number: 'TRF-001',
        status: 'SENT',
        created_at: '2024-01-01T10:00:00Z',
        sent_at: '2024-01-01T11:00:00Z',
        received_at: null,
        sourceWarehouse: { id: 'w1', name: 'Main Warehouse' },
        destinationWarehouse: { id: 'w2', name: 'Branch Warehouse' },
        items: [{ id: 'i1', product_id: 'p1', quantity_sent: 10, quantity_received: 0, product: { name: 'Widget A' } }],
        posting_status: 'POSTED',
        voucher_number: 'V-001',
    },
    {
        id: 't2',
        transfer_number: 'TRF-002',
        status: 'DRAFT',
        created_at: '2024-01-02T10:00:00Z',
        sent_at: null,
        received_at: null,
        sourceWarehouse: { id: 'w2', name: 'Branch Warehouse' },
        destinationWarehouse: { id: 'w1', name: 'Main Warehouse' },
        items: [{ id: 'i2', product_id: 'p2', quantity_sent: 5, quantity_received: 5, product: { name: 'Widget B' } }],
        posting_status: null,
        voucher_number: null,
    },
];

const sampleWarehouses = [
    { id: 'w1', name: 'Main Warehouse', is_active: true },
    { id: 'w2', name: 'Branch Warehouse', is_active: true },
    { id: 'w3', name: 'Inactive Warehouse', is_active: false },
];

const sampleProducts = [
    { id: 'p1', name: 'Widget A' },
    { id: 'p2', name: 'Widget B' },
];

function setupDefaultMocks() {
    mockApi.getWarehouseTransfers.mockResolvedValue(sampleTransfers);
    mockApi.getInventoryWarehouses.mockResolvedValue(sampleWarehouses);
    mockApi.getProducts.mockResolvedValue(sampleProducts);
}

beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
});

describe('InventoryTransfersPage', () => {
    it('renders the page heading', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Warehouse Transfers' })).toBeInTheDocument();
        });
    });

    it('renders page description', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByText(/Send stock between warehouses/)).toBeInTheDocument();
        });
    });

    it('renders the DataTable with transfer data', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
            expect(screen.getByTestId('data-table').textContent).toContain('2');
        });
    });

    it('renders 0 rows in table when no transfers', async () => {
        mockApi.getWarehouseTransfers.mockResolvedValue([]);
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table').textContent).toContain('0');
        });
    });

    it('renders the New Transfer form', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByText('New Transfer')).toBeInTheDocument();
        });
    });

    it('renders Create Transfer button', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Create Transfer/ })).toBeInTheDocument();
        });
    });

    it('renders status filter dropdown', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByText('All Statuses')).toBeInTheDocument();
        });
    });

    it('renders filter options for status', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByRole('option', { name: 'Draft' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Sent' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Received' })).toBeInTheDocument();
        });
    });

    it('loads warehouses and shows them in filter dropdowns', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Main Warehouse').length).toBeGreaterThan(0);
        });
    });

    it('filters out inactive warehouses in selects', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.queryByText('Inactive Warehouse')).not.toBeInTheDocument();
        });
    });

    it('loads products and shows them in select', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Widget A').length).toBeGreaterThan(0);
        });
    });

    it('calls getWarehouseTransfers on mount', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalled();
        });
    });

    it('calls getInventoryWarehouses on mount', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(mockApi.getInventoryWarehouses).toHaveBeenCalled();
        });
    });

    it('calls getProducts on mount', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(mockApi.getProducts).toHaveBeenCalled();
        });
    });

    it('changes status filter and reloads transfers', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByText('All Statuses')).toBeInTheDocument());
        const statusDropdowns = screen.getAllByRole('combobox');
        // The status filter is the first combobox in the header area
        const statusSelect = statusDropdowns[0];
        await act(async () => {
            fireEvent.change(statusSelect, { target: { value: 'SENT' } });
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'SENT' })
            );
        });
    });

    it('renders Add Line button in the form', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Add Line/ })).toBeInTheDocument();
        });
    });

    it('adds a new item line when Add Line is clicked', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Add Line/ })).toBeInTheDocument());
        const addLineBtn = screen.getByRole('button', { name: /Add Line/ });
        const initialRemoveButtons = screen.getAllByText('Remove');
        expect(initialRemoveButtons.length).toBe(1);
        fireEvent.click(addLineBtn);
        await waitFor(() => {
            expect(screen.getAllByText('Remove').length).toBe(2);
        });
    });

    it('does not remove the last item line when Remove is clicked', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByText('Remove')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Remove'));
        // Should still have 1 line (can't go below 1)
        await waitFor(() => {
            expect(screen.getAllByText('Remove').length).toBe(1);
        });
    });

    it('removes an item line when there are multiple lines', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Add Line/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Add Line/ }));
        await waitFor(() => expect(screen.getAllByText('Remove').length).toBe(2));
        fireEvent.click(screen.getAllByText('Remove')[0]);
        await waitFor(() => {
            expect(screen.getAllByText('Remove').length).toBe(1);
        });
    });

    it('submits the new transfer form and shows success message', async () => {
        mockApi.createWarehouseTransfer.mockResolvedValue({ id: 'tnew' });
        mockApi.getWarehouseTransfers
            .mockResolvedValueOnce(sampleTransfers)
            .mockResolvedValueOnce(sampleTransfers);
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByText('New Transfer')).toBeInTheDocument());

        // Select source warehouse
        const sourceSelect = screen.getAllByRole('combobox').find(
            (el) => el.querySelector?.('option[value=""]')?.textContent === 'Select source'
        );
        // Use form selects directly by their option text
        const allSelects = screen.getAllByRole('combobox');
        // Source warehouse select is labeled "Source Warehouse"
        const sourceLabel = screen.getByText('Source Warehouse');
        const sourceSelectEl = sourceLabel.closest('div')!.querySelector('select')!;
        fireEvent.change(sourceSelectEl, { target: { value: 'w1' } });

        const destLabel = screen.getByText('Destination Warehouse');
        const destSelectEl = destLabel.closest('div')!.querySelector('select')!;
        fireEvent.change(destSelectEl, { target: { value: 'w2' } });

        const productLabel = screen.getByText('Product');
        const productSelectEl = productLabel.closest('div')!.querySelector('select')!;
        fireEvent.change(productSelectEl, { target: { value: 'p1' } });

        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: /Create Transfer/ }).closest('form')!);
        });

        await waitFor(() => {
            expect(mockApi.createWarehouseTransfer).toHaveBeenCalled();
            expect(screen.getByText('Transfer created.')).toBeInTheDocument();
        });
    });

    it('shows error message when create transfer fails', async () => {
        mockApi.createWarehouseTransfer.mockRejectedValue(new Error('Transfer failed'));
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByText('New Transfer')).toBeInTheDocument());

        const sourceLabel = screen.getByText('Source Warehouse');
        const sourceSelectEl = sourceLabel.closest('div')!.querySelector('select')!;
        fireEvent.change(sourceSelectEl, { target: { value: 'w1' } });

        const destLabel = screen.getByText('Destination Warehouse');
        const destSelectEl = destLabel.closest('div')!.querySelector('select')!;
        fireEvent.change(destSelectEl, { target: { value: 'w2' } });

        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: /Create Transfer/ }).closest('form')!);
        });

        await waitFor(() => {
            expect(screen.getByText('Transfer failed')).toBeInTheDocument();
        });
    });

    it('handles API error for getWarehouseTransfers gracefully', async () => {
        mockApi.getWarehouseTransfers.mockRejectedValue(new Error('Network error'));
        // Should not throw
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('changes source warehouse filter', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getAllByText('Main Warehouse').length).toBeGreaterThan(0));
        // Filter section has "All Sources" dropdown
        const allSources = screen.getByRole('option', { name: 'All Sources' }).closest('select')!;
        await act(async () => {
            fireEvent.change(allSources, { target: { value: 'w1' } });
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ sourceWarehouseId: 'w1' })
            );
        });
    });

    it('changes destination warehouse filter', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getAllByText('Main Warehouse').length).toBeGreaterThan(0));
        const allDestinations = screen.getByRole('option', { name: 'All Destinations' }).closest('select')!;
        await act(async () => {
            fireEvent.change(allDestinations, { target: { value: 'w2' } });
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ destinationWarehouseId: 'w2' })
            );
        });
    });

    it('changes from date filter', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByText('New Transfer')).toBeInTheDocument());
        const dateInputs = screen.getAllByDisplayValue('');
        const fromDateInput = dateInputs.find(
            (el) => (el as HTMLInputElement).type === 'date'
        )!;
        await act(async () => {
            fireEvent.change(fromDateInput, { target: { value: '2024-01-01' } });
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ from: '2024-01-01' })
            );
        });
    });

    it('renders form initial status as Send Now', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByRole('option', { name: 'Send Now' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Save as Draft' })).toBeInTheDocument();
        });
    });

    it('updates notes field in the form', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByPlaceholderText('Optional')).toBeInTheDocument());
        const notesInput = screen.getByPlaceholderText('Optional') as HTMLInputElement;
        fireEvent.change(notesInput, { target: { value: 'Test notes' } });
        expect(notesInput.value).toBe('Test notes');
    });
});
