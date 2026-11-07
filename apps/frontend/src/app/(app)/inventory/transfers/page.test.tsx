import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import InventoryTransfersPage from './page';
import { pickSearchOption } from '@/test-utils/id-search-select';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/test',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, className, ...rest }: any) => (
        <a href={href} className={className} {...rest}>{children}</a>
    ),
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, columns, filters, stats, filterLayout, viewOptions }: any) => (
        <div data-testid="data-table">
            <span>{data?.length} rows</span>
            <div data-testid="filter-layout">{filterLayout ?? ''}</div>
            <div data-testid="has-view-options">{viewOptions ? 'yes' : 'no'}</div>
            <div data-testid="stats-label">{stats?.label ?? ''}</div>
            <div data-testid="stats-count">{stats?.items?.length ?? 0}</div>
            {(data ?? []).map((row: any) => {
                const actionsCol = (columns ?? []).find((column: any) => column.id === 'actions');
                return (
                    <div key={row.id} data-testid={`row-actions-${row.id}`}>
                        {actionsCol?.cell?.({ row: { original: row } })}
                    </div>
                );
            })}
            {(filters ?? []).map((filter: any) => {
                if (filter.type === 'date-range') {
                    return (
                        <div key={filter.id} data-testid={`filter-${filter.id}`}>
                            <span data-testid={`filter-${filter.id}-type`}>date-range</span>
                            <button type="button" onClick={() => filter.onChange?.({ from: '2024-01-01', to: '2024-01-01' })}>
                                Created · Any time
                            </button>
                        </div>
                    );
                }
                if (filter.type === 'toggle') {
                    return (
                        <div key={filter.id} data-testid={`filter-${filter.id}`}>
                            <span data-testid={`filter-${filter.id}-pressed`}>{String(Boolean(filter.pressed))}</span>
                        </div>
                    );
                }
                const value = filter.type === 'multi-select'
                    ? (Array.isArray(filter.value) ? (filter.value[0] ?? '') : '')
                    : (filter.value ?? '');
                return (
                    <div key={filter.id} data-testid={`filter-${filter.id}`}>
                        <label htmlFor={`filter-${filter.id}-select`}>{filter.label ?? filter.id}</label>
                        <select
                            id={`filter-${filter.id}-select`}
                            aria-label={filter.label ?? filter.id}
                            value={value}
                            onChange={(e) => {
                                const next = e.target.value;
                                if (filter.type === 'multi-select') {
                                    filter.onChange?.(next ? [next] : []);
                                } else {
                                    filter.onChange?.(next || null);
                                }
                            }}
                        >
                            <option value="">All</option>
                            {(filter.options ?? []).map((opt: any) => (
                                <option
                                    key={opt.value}
                                    value={opt.value}
                                    data-testid={`filter-${filter.id}-option-${opt.value}`}
                                >
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        {filter.searchable ? <span data-testid={`filter-${filter.id}-searchable`}>searchable</span> : null}
                    </div>
                );
            })}
        </div>
    ),
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    CreatedRangeFilter: ({ onChange }: { onChange: (next: { from: string; to: string }) => void }) => (
        <button type="button" onClick={() => onChange({ from: '2024-01-01', to: '2024-01-01' })}>
            Created · Any time
        </button>
    ),
}));

jest.mock('@/components/PostingBadge', () => ({
    PostingBadge: ({ status }: any) => <span>{status}</span>,
}));

jest.mock('@/lib/toast', () => ({
    toast: {
        success: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
    },
}));

jest.mock('@/lib/api', () => ({
    api: {
        getWarehouseTransfers: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getProducts: jest.fn(),
        getStores: jest.fn(),
        createWarehouseTransfer: jest.fn(),
        updateWarehouseTransfer: jest.fn(),
        deleteWarehouseTransfer: jest.fn(),
    },
}));

import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

const mockApi = api as jest.Mocked<typeof api>;
const mockToast = toast as jest.Mocked<typeof toast>;

const sampleTransfers = [
    {
        id: 't1',
        transfer_number: 'TRF-001',
        status: 'SENT',
        created_at: '2024-01-01T10:00:00Z',
        sent_at: '2024-01-01T11:00:00Z',
        received_at: null,
        is_cross_branch: true,
        source_store_id: 's1',
        destination_store_id: 's2',
        sourceWarehouse: { id: 'w1', name: 'Main Warehouse', store_id: 's1' },
        destinationWarehouse: { id: 'w2', name: 'Branch Warehouse', store_id: 's2' },
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
        notes: 'Draft notes',
        sourceWarehouse: { id: 'w2', name: 'Branch Warehouse' },
        destinationWarehouse: { id: 'w1', name: 'Main Warehouse' },
        items: [{ id: 'i2', product_id: 'p2', quantity_sent: 5, quantity_received: 5, product: { name: 'Widget B' } }],
        posting_status: null,
        voucher_number: null,
    },
];

const sampleWarehouses = [
    { id: 'w1', name: 'Main Warehouse', is_active: true, store_id: 's1' },
    { id: 'w2', name: 'Branch Warehouse', is_active: true, store_id: 's2' },
    { id: 'w3', name: 'Inactive Warehouse', is_active: false, store_id: 's2' },
];

const sampleStores = [
    { id: 's1', name: 'Dhaka Main' },
    { id: 's2', name: 'Chattogram' },
];

const sampleProducts = [
    { id: 'p1', name: 'Widget A' },
    { id: 'p2', name: 'Widget B' },
];

async function openNewTransferForm() {
    await waitFor(() => expect(screen.getByRole('button', { name: /New Transfer/ })).toBeInTheDocument());
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /New Transfer/ }));
    });
    await waitFor(() => expect(screen.getByText('Source Warehouse')).toBeInTheDocument());
}

function setupDefaultMocks() {
    mockApi.getWarehouseTransfers.mockResolvedValue(sampleTransfers);
    mockApi.getInventoryWarehouses.mockResolvedValue(sampleWarehouses);
    mockApi.getProducts.mockResolvedValue(sampleProducts);
    mockApi.getStores.mockResolvedValue(sampleStores);
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

    it('keeps the create form in a modal until New Transfer is clicked', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByRole('button', { name: /New Transfer/ })).toBeInTheDocument());
        expect(screen.queryByText('Source Warehouse')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Create Transfer/ })).not.toBeInTheDocument();
        await openNewTransferForm();
        expect(screen.getByRole('button', { name: /Create Transfer/ })).toBeInTheDocument();
    });

    it('renders status filter chip', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-status')).toBeInTheDocument();
        });
        expect(screen.getByTestId('filter-layout')).toHaveTextContent('row');
        expect(screen.getByTestId('has-view-options')).toHaveTextContent('yes');
        expect(screen.getByTestId('stats-label')).toHaveTextContent('Transfer summary');
    });

    it('renders filter options for status', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-status-option-DRAFT')).toHaveTextContent('Draft');
            expect(screen.getByTestId('filter-status-option-SENT')).toHaveTextContent('Sent');
            expect(screen.getByTestId('filter-status-option-RECEIVED')).toHaveTextContent('Received');
        });
    });

    it('loads warehouses and shows them in filter dropdowns', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-source')).toBeInTheDocument();
            expect(screen.getByTestId('filter-source-option-w1')).toBeInTheDocument();
        });
    });

    it('filters out inactive warehouses in selects', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-source-option-w1')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('filter-source-option-w3')).not.toBeInTheDocument();
        expect(screen.queryByText('Inactive Warehouse')).not.toBeInTheDocument();
    });

    it('loads products and shows them in the product filter', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('filter-product')).toBeInTheDocument();
            expect(screen.getByTestId('filter-product-option-p1')).toHaveTextContent('Widget A');
        });
        expect(screen.getByTestId('filter-product-searchable')).toBeInTheDocument();
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
        await waitFor(() => expect(screen.getByTestId('filter-status')).toBeInTheDocument());
        await act(async () => {
            fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'SENT' } });
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'SENT' })
            );
        });
    });

    it('lists the header branch\'s transfers, and re-asks for the branch picked', async () => {
        mockBranchScope();
        render(<InventoryTransfersPage />);
        await waitFor(() =>
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' })),
        );
        expect(mockApi.getWarehouseTransfers).toHaveBeenCalledTimes(1);

        await act(async () => {
            // Scope chip is also labelled "Branch"; the header control owns this test id.
            fireEvent.change(screen.getByTestId('branch-filter'), { target: { value: 'store-2' } });
        });

        await waitFor(() =>
            expect(mockApi.getWarehouseTransfers).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'store-2' })),
        );
    });

    it('clears a warehouse filter when the branch changes', async () => {
        mockBranchScope();
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('filter-source-option-w1')).toBeInTheDocument());
        await act(async () => {
            fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'w1' } });
        });
        await waitFor(() =>
            expect(mockApi.getWarehouseTransfers).toHaveBeenLastCalledWith(expect.objectContaining({ sourceWarehouseId: 'w1' })),
        );

        await act(async () => {
            fireEvent.change(screen.getByTestId('branch-filter'), { target: { value: 'all' } });
        });

        await waitFor(() =>
            expect(mockApi.getWarehouseTransfers).toHaveBeenLastCalledWith(
                expect.objectContaining({ storeId: 'all', sourceWarehouseId: undefined }),
            ),
        );
    });

    it('renders Add Line button in the form', async () => {
        render(<InventoryTransfersPage />);
        await openNewTransferForm();
        expect(screen.getByRole('button', { name: /Add Line/ })).toBeInTheDocument();
    });

    it('adds a new item line when Add Line is clicked', async () => {
        render(<InventoryTransfersPage />);
        await openNewTransferForm();
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
        await openNewTransferForm();
        fireEvent.click(screen.getByText('Remove'));
        await waitFor(() => {
            expect(screen.getAllByText('Remove').length).toBe(1);
        });
    });

    it('removes an item line when there are multiple lines', async () => {
        render(<InventoryTransfersPage />);
        await openNewTransferForm();
        fireEvent.click(screen.getByRole('button', { name: /Add Line/ }));
        await waitFor(() => expect(screen.getAllByText('Remove').length).toBe(2));
        fireEvent.click(screen.getAllByText('Remove')[0]);
        await waitFor(() => {
            expect(screen.getAllByText('Remove').length).toBe(1);
        });
    });

    it('submits the new transfer form and shows a success toast', async () => {
        mockApi.createWarehouseTransfer.mockResolvedValue({ id: 'tnew' });
        mockApi.getWarehouseTransfers
            .mockResolvedValueOnce(sampleTransfers)
            .mockResolvedValueOnce(sampleTransfers);
        render(<InventoryTransfersPage />);
        await openNewTransferForm();

        fireEvent.change(screen.getByLabelText(/Source Warehouse/), { target: { value: 'w1' } });
        fireEvent.change(screen.getByLabelText(/Destination Warehouse/), { target: { value: 'w2' } });
        pickSearchOption('Product', 'Widget A');

        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: /Create Transfer/ }).closest('form')!);
        });

        await waitFor(() => {
            expect(mockApi.createWarehouseTransfer).toHaveBeenCalled();
            expect(mockToast.success).toHaveBeenCalledWith('Transfer created.');
        });
    });

    it('shows the selected product\'s stock at the source and destination, and warns past it', async () => {
        mockApi.getProducts.mockResolvedValue([
            {
                id: 'p1',
                name: 'Widget A',
                stocks: [
                    { warehouse_id: 'w1', quantity: 12 },
                    { warehouse_id: 'w2', quantity: 3 },
                ],
            },
            { id: 'p2', name: 'Widget B', stocks: [] },
        ]);
        render(<InventoryTransfersPage />);
        await openNewTransferForm();

        pickSearchOption('Product', 'Widget A');
        expect(screen.getByTestId('transfer-line-stock-0')).toHaveTextContent('In stock (all warehouses): 15');

        fireEvent.change(screen.getByLabelText(/Source Warehouse/), { target: { value: 'w1' } });
        fireEvent.change(screen.getByLabelText(/Destination Warehouse/), { target: { value: 'w2' } });
        expect(screen.getByTestId('transfer-line-stock-0')).toHaveTextContent('Available at source: 12 · At destination: 3');
        expect(screen.queryByText(/More than the source holds/)).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '20' } });
        expect(screen.getByText(/More than the source holds/)).toBeInTheDocument();
    });

    it('shows error message when create transfer fails', async () => {
        mockApi.createWarehouseTransfer.mockRejectedValue(new Error('Transfer failed'));
        render(<InventoryTransfersPage />);
        await openNewTransferForm();

        fireEvent.change(screen.getByLabelText(/Source Warehouse/), { target: { value: 'w1' } });
        fireEvent.change(screen.getByLabelText(/Destination Warehouse/), { target: { value: 'w2' } });

        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: /Create Transfer/ }).closest('form')!);
        });

        await waitFor(() => {
            expect(screen.getByText('Transfer failed')).toBeInTheDocument();
        });
    });

    it('handles API error for getWarehouseTransfers gracefully', async () => {
        mockApi.getWarehouseTransfers.mockRejectedValue(new Error('Network error'));
        render(<InventoryTransfersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('changes source warehouse filter', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('filter-source-option-w1')).toBeInTheDocument());
        await act(async () => {
            fireEvent.change(screen.getByTestId('filter-source').querySelector('select')!, { target: { value: 'w1' } });
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ sourceWarehouseId: 'w1' })
            );
        });
    });

    it('changes destination warehouse filter', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('filter-destination-option-w2')).toBeInTheDocument());
        await act(async () => {
            fireEvent.change(screen.getByTestId('filter-destination').querySelector('select')!, { target: { value: 'w2' } });
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ destinationWarehouseId: 'w2' })
            );
        });
    });

    it('changes from date filter', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('filter-created')).toBeInTheDocument());
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /created · any time/i }));
        });
        await waitFor(() => {
            expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ from: '2024-01-01' })
            );
        });
    });

    it('renders form initial status as Send Now', async () => {
        render(<InventoryTransfersPage />);
        await openNewTransferForm();
        expect(screen.getByRole('option', { name: 'Send Now' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Save as Draft' })).toBeInTheDocument();
    });

    it('updates notes field in the form', async () => {
        render(<InventoryTransfersPage />);
        await openNewTransferForm();
        const notesInput = screen.getByPlaceholderText('Optional') as HTMLInputElement;
        fireEvent.change(notesInput, { target: { value: 'Test notes' } });
        expect(notesInput.value).toBe('Test notes');
    });

    it('offers Edit and Delete on a draft, but not Edit on a sent transfer', async () => {
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('row-actions-t2')).toBeInTheDocument());

        const draftActions = within(screen.getByTestId('row-actions-t2'));
        expect(draftActions.getByLabelText('Edit')).toBeInTheDocument();
        expect(draftActions.getByLabelText('Delete')).toBeInTheDocument();
        expect(draftActions.getByLabelText('View')).toHaveAttribute('href', '/inventory/transfers/t2');

        const sentActions = within(screen.getByTestId('row-actions-t1'));
        expect(sentActions.getByLabelText('View')).toBeInTheDocument();
        expect(sentActions.queryByLabelText('Edit')).not.toBeInTheDocument();
        expect(sentActions.queryByLabelText('Delete')).not.toBeInTheDocument();
    });

    it('opens the edit modal from a draft row and saves via update', async () => {
        mockApi.updateWarehouseTransfer.mockResolvedValue({ id: 't2' });
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('row-actions-t2')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(within(screen.getByTestId('row-actions-t2')).getByLabelText('Edit'));
        });

        await waitFor(() => expect(screen.getByText('Edit Transfer')).toBeInTheDocument());
        expect(screen.getByDisplayValue('Draft notes')).toBeInTheDocument();

        await act(async () => {
            fireEvent.submit(screen.getByRole('button', { name: /Save Transfer/ }).closest('form')!);
        });

        await waitFor(() => {
            expect(mockApi.updateWarehouseTransfer).toHaveBeenCalledWith(
                't2',
                expect.objectContaining({
                    sourceWarehouseId: 'w2',
                    destinationWarehouseId: 'w1',
                    status: 'DRAFT',
                }),
            );
            expect(mockToast.success).toHaveBeenCalledWith('Transfer updated.');
        });
    });

    it('deletes a draft after confirm', async () => {
        mockApi.deleteWarehouseTransfer.mockResolvedValue(undefined);
        render(<InventoryTransfersPage />);
        await waitFor(() => expect(screen.getByTestId('row-actions-t2')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(within(screen.getByTestId('row-actions-t2')).getByLabelText('Delete'));
        });

        await waitFor(() => expect(screen.getByText('Delete transfer?')).toBeInTheDocument());
        await act(async () => {
            // Row action keeps an aria-labelled Delete; the confirm is the last one.
            const deleteButtons = screen.getAllByRole('button', { name: /^Delete$/ });
            fireEvent.click(deleteButtons[deleteButtons.length - 1]);
        });

        await waitFor(() => {
            expect(mockApi.deleteWarehouseTransfer).toHaveBeenCalledWith('t2');
            expect(mockToast.success).toHaveBeenCalledWith('Transfer deleted.');
        });
    });

    describe('cross-branch transfers', () => {
        it('groups the warehouse pickers by branch so a cross-branch pick is visible', async () => {
            render(<InventoryTransfersPage />);
            await openNewTransferForm();

            expect(screen.getAllByRole('group', { name: 'Dhaka Main' }).length).toBe(2);
            expect(screen.getAllByRole('group', { name: 'Chattogram' }).length).toBe(2);
        });

        it('offers a scope filter and asks the API for cross-branch transfers only', async () => {
            render(<InventoryTransfersPage />);
            await waitFor(() => expect(screen.getByTestId('filter-scope')).toBeInTheDocument());

            await act(async () => {
                fireEvent.change(screen.getByTestId('filter-scope').querySelector('select')!, { target: { value: 'cross' } });
            });

            await waitFor(() => expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ isCrossBranch: true }),
            ));
        });

        it('asks for intra-branch transfers with an explicit false, not an omitted filter', async () => {
            render(<InventoryTransfersPage />);
            await waitFor(() => expect(screen.getByTestId('filter-scope')).toBeInTheDocument());

            await act(async () => {
                fireEvent.change(screen.getByTestId('filter-scope').querySelector('select')!, { target: { value: 'within' } });
            });

            await waitFor(() => expect(mockApi.getWarehouseTransfers).toHaveBeenCalledWith(
                expect.objectContaining({ isCrossBranch: false }),
            ));
        });

        it('warns that a cross-branch pick will wait for approval', async () => {
            render(<InventoryTransfersPage />);
            await openNewTransferForm();

            expect(screen.queryByText(/waits for approval/)).not.toBeInTheDocument();

            await act(async () => {
                fireEvent.change(screen.getByLabelText(/Source Warehouse/), { target: { value: 'w1' } });
                fireEvent.change(screen.getByLabelText(/Destination Warehouse/), { target: { value: 'w2' } });
            });

            expect(screen.getByText(/waits for approval/)).toBeInTheDocument();
        });

        it('shows no approval warning for two warehouses in the same branch', async () => {
            mockApi.getInventoryWarehouses.mockResolvedValue([
                { id: 'w1', name: 'Main Warehouse', is_active: true, store_id: 's1' },
                { id: 'w4', name: 'Overflow Warehouse', is_active: true, store_id: 's1' },
            ]);
            render(<InventoryTransfersPage />);
            await openNewTransferForm();

            await act(async () => {
                fireEvent.change(screen.getByLabelText(/Source Warehouse/), { target: { value: 'w1' } });
                fireEvent.change(screen.getByLabelText(/Destination Warehouse/), { target: { value: 'w4' } });
            });

            expect(screen.queryByText(/waits for approval/)).not.toBeInTheDocument();
        });

        it('leaves a single-branch shop ungrouped and without a scope filter', async () => {
            mockApi.getInventoryWarehouses.mockResolvedValue([
                { id: 'w1', name: 'Main Warehouse', is_active: true, store_id: 's1' },
                { id: 'w4', name: 'Overflow Warehouse', is_active: true, store_id: 's1' },
            ]);
            render(<InventoryTransfersPage />);
            await openNewTransferForm();

            expect(screen.queryAllByRole('group')).toHaveLength(0);
            expect(screen.queryByTestId('filter-scope')).not.toBeInTheDocument();
        });

        it('offers the two approval statuses in the status filter', async () => {
            render(<InventoryTransfersPage />);
            await waitFor(() => expect(screen.getByTestId('filter-status')).toBeInTheDocument());

            expect(screen.getByTestId('filter-status-option-PENDING_APPROVAL')).toHaveTextContent('Pending Approval');
            expect(screen.getByTestId('filter-status-option-REJECTED')).toHaveTextContent('Rejected');
        });
    });
});
