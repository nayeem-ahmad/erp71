import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import ManufacturingBomsPage from './page';

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
    fetchAllPages: jest.fn(),
    api: { getProducts: jest.fn() },
}));

jest.mock('@/lib/format', () => ({
    formatDate: (d: string) => d,
    formatBDT: (n: number) => `৳${n}`,
}));

// Suppress lucide-react SVG rendering issues in tests
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    X: () => <span data-testid="icon-x" />,
    RefreshCw: () => <span data-testid="icon-refresh" />,
    Cog: () => <span data-testid="icon-cog" />,
    Trash2: () => <span data-testid="icon-trash" />,
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
    // Used by shared ui primitives (Alert, Button loading spinner) rendered by this page's modals.
    AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
    Info: () => <span data-testid="icon-info" />,
    XCircle: () => <span data-testid="icon-xcircle" />,
    Loader2: () => <span data-testid="icon-loader" />,
}));

// fetchWithAuth already parses the response and unwraps the `{ data: T }`
// envelope, so mocks resolve directly to the payload (not a Response).
const mockFetchWithAuth = require('@/lib/api').fetchWithAuth as jest.Mock;
// BOM lists go through `fetchAllPages`, which walks the paginated endpoint and
// resolves to a flat array — the API caps `limit` at 100, so the page cannot ask
// for every recipe in one request.
const mockFetchAllPages = require('@/lib/api').fetchAllPages as jest.Mock;
const mockGetProducts = require('@/lib/api').api.getProducts as jest.Mock;

const sampleProducts = [
    { id: 'prod-1', name: 'Widget A', sku: 'WGT-001' },
    { id: 'prod-flour', name: 'Flour', sku: 'FLR-1' },
];

const sampleBoms = [
    {
        id: 'bom-1',
        productId: 'prod-1',
        productName: 'Widget A',
        productSku: 'WGT-001',
        outputQty: 10,
        notes: 'Sample notes',
        componentCount: 3,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
    },
    {
        id: 'bom-2',
        productId: 'prod-2',
        productName: 'Widget B',
        productSku: null,
        outputQty: 5,
        notes: null,
        componentCount: 1,
        created_at: '2024-01-02',
        updated_at: '2024-01-02',
    },
];

describe('ManufacturingBomsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchAllPages.mockResolvedValue([]);
        mockGetProducts.mockResolvedValue(sampleProducts);
        mockFetchWithAuth.mockResolvedValue({});
    });

    it('renders the Bill of Materials heading', async () => {
        render(<ManufacturingBomsPage />);
        expect(screen.getByRole('heading', { name: 'Bill of Materials' })).toBeInTheDocument();
    });

    it('breadcrumbs back to the Manufacturing module', async () => {
        render(<ManufacturingBomsPage />);
        const crumbs = screen.getByLabelText('Breadcrumb');
        expect(within(crumbs).getByRole('link', { name: 'Manufacturing' })).toHaveAttribute(
            'href',
            '/manufacturing',
        );
    });

    it('shows the empty state when there are no recipes', async () => {
        render(<ManufacturingBomsPage />);
        await waitFor(() => {
            expect(screen.getByText('No BOM recipes yet. Create one to get started.')).toBeInTheDocument();
        });
    });

    it('displays BOM recipes when loaded', async () => {
        mockFetchAllPages.mockResolvedValue(sampleBoms);
        render(<ManufacturingBomsPage />);
        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('WGT-001')).toBeInTheDocument();
            expect(screen.getByText('Widget B')).toBeInTheDocument();
        });
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('shows "1 recipe" for a single BOM', async () => {
        mockFetchAllPages.mockResolvedValue([sampleBoms[0]]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => {
            expect(screen.getByText('1 recipe')).toBeInTheDocument();
        });
    });

    it('shows error message when BOM fetch fails', async () => {
        mockFetchAllPages.mockRejectedValue(new Error('Network error'));
        render(<ManufacturingBomsPage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load BOMs')).toBeInTheDocument();
        });
    });

    it('opens New BOM modal when button clicked', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        expect(screen.getByText('New BOM Recipe')).toBeInTheDocument();
        expect(screen.getByLabelText('Output Product *')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('Widget A (WGT-001)')).toBeInTheDocument();
        });
    });

    it('closes the BOM modal when Cancel is clicked', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('New BOM Recipe')).not.toBeInTheDocument();
    });

    it('shows validation error in BOM modal when productId is empty', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Create'));
        expect(screen.getByText('Please select the product to manufacture.')).toBeInTheDocument();
    });

    it('adds a component row in the BOM modal', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Add Component'));
        expect(screen.getByLabelText('Select a component…')).toBeInTheDocument();
    });

    it('removes a component row from the BOM modal', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Add Component'));
        expect(screen.getByLabelText('Select a component…')).toBeInTheDocument();
        // Remove it via the trash button
        const trashButtons = screen.getAllByTestId('icon-trash');
        fireEvent.click(trashButtons[0]);
        expect(screen.queryByLabelText('Select a component…')).not.toBeInTheDocument();
    });

    it('submits BOM creation successfully', async () => {
        mockFetchWithAuth.mockResolvedValueOnce({ id: 'bom-new' }); // save POST
        mockFetchAllPages.mockResolvedValueOnce([]).mockResolvedValueOnce(sampleBoms);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        await waitFor(() => screen.getByText('Widget A (WGT-001)'));
        fireEvent.change(screen.getByLabelText('Output Product *'), {
            target: { value: 'prod-1' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        await waitFor(() => {
            expect(mockFetchWithAuth).toHaveBeenCalledWith(
                expect.stringContaining('bom'),
                expect.objectContaining({ method: 'POST' }),
            );
        });
    });

    it('shows save error when BOM creation fails', async () => {
        mockFetchWithAuth.mockRejectedValueOnce(new Error('Product not found'));
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        await waitFor(() => screen.getByText('Widget A (WGT-001)'));
        fireEvent.change(screen.getByLabelText('Output Product *'), {
            target: { value: 'prod-1' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        await waitFor(() => {
            expect(screen.getByText('Product not found')).toBeInTheDocument();
        });
    });

    it('keeps the output product out of the component picker', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        await waitFor(() => screen.getByText('Widget A (WGT-001)'));
        fireEvent.click(screen.getByText('Add Component'));

        const componentPicker = screen.getByLabelText('Select a component…');
        expect(within(componentPicker).getByText('Widget A (WGT-001)')).toBeInTheDocument();

        // Choosing Widget A as the output takes it off the component list: a
        // recipe cannot consume the goods it produces.
        fireEvent.change(screen.getByLabelText('Output Product *'), { target: { value: 'prod-1' } });
        expect(within(componentPicker).queryByText('Widget A (WGT-001)')).not.toBeInTheDocument();
        expect(within(componentPicker).getByText('Flour (FLR-1)')).toBeInTheDocument();
    });

    it('clears a component row that the new output product has just become', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        await waitFor(() => screen.getByText('Widget A (WGT-001)'));
        fireEvent.click(screen.getByText('Add Component'));

        const componentPicker = screen.getByLabelText('Select a component…') as HTMLSelectElement;
        fireEvent.change(componentPicker, { target: { value: 'prod-flour' } });
        expect(componentPicker.value).toBe('prod-flour');

        fireEvent.change(screen.getByLabelText('Output Product *'), { target: { value: 'prod-flour' } });
        expect(componentPicker.value).toBe('');
    });

    it('asks for BOM pages within the API\'s limit cap', async () => {
        mockFetchAllPages.mockResolvedValue(sampleBoms);
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('Widget A'));
        // The endpoint validates `limit` at Max(100); a hand-built `?limit=200`
        // came back 400 and the page rendered nothing but "Failed to load BOMs".
        expect(mockFetchAllPages).toHaveBeenCalledWith('/manufacturing/bom');
        for (const [url] of mockFetchWithAuth.mock.calls) {
            expect(String(url)).not.toContain('limit=200');
        }
    });

    it('deletes a BOM after confirmation', async () => {
        const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
        mockFetchAllPages.mockResolvedValueOnce(sampleBoms).mockResolvedValueOnce([]);
        mockFetchWithAuth.mockResolvedValueOnce({});
        render(<ManufacturingBomsPage />);
        await waitFor(() => screen.getByText('Widget A'));
        const deleteButtons = screen.getAllByText('Delete');
        await act(async () => {
            fireEvent.click(deleteButtons[0]);
        });
        expect(confirmSpy).toHaveBeenCalled();
        await waitFor(() => {
            expect(mockFetchWithAuth).toHaveBeenCalledWith(
                expect.stringContaining('bom/bom-1'),
                expect.objectContaining({ method: 'DELETE' }),
            );
        });
        confirmSpy.mockRestore();
    });
});
