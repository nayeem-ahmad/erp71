import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import ManufacturingPage from './page';

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
    Factory: () => <span data-testid="icon-factory" />,
    Plus: () => <span data-testid="icon-plus" />,
    X: () => <span data-testid="icon-x" />,
    RefreshCw: () => <span data-testid="icon-refresh" />,
    Cog: () => <span data-testid="icon-cog" />,
    Trash2: () => <span data-testid="icon-trash" />,
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
    CheckCircle2: () => <span data-testid="icon-check" />,
    Package: () => <span data-testid="icon-package" />,
    Wallet: () => <span data-testid="icon-wallet" />,
    Calculator: () => <span data-testid="icon-calculator" />,
    TrendingUp: () => <span data-testid="icon-trending-up" />,
    TrendingDown: () => <span data-testid="icon-trending-down" />,
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

const makeJobsPage = (items: object[]) => ({ items, total: items.length, page: 1, limit: 20, pages: 1 });

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

const sampleJobs = [
    {
        id: 'job-1234567890',
        tenantId: 'tenant-1',
        recipeId: 'bom-1',
        productId: 'prod-1',
        quantity: 5,
        status: 'DRAFT',
        notes: null,
        startedAt: null,
        completedAt: null,
        created_at: '2024-01-01',
        recipe: {
            id: 'bom-1',
            outputQty: 10,
            product: { id: 'prod-1', name: 'Widget A', sku: 'WGT-001' },
            components: [],
        },
    },
    {
        id: 'job-in-progress',
        tenantId: 'tenant-1',
        recipeId: 'bom-2',
        productId: 'prod-2',
        quantity: 2,
        status: 'IN_PROGRESS',
        notes: null,
        startedAt: '2024-01-02',
        completedAt: null,
        created_at: '2024-01-02',
        recipe: {
            id: 'bom-2',
            outputQty: 5,
            product: { id: 'prod-2', name: 'Widget B', sku: null },
            components: [],
        },
    },
];

describe('ManufacturingPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: BOM tab loads empty; Jobs tab loads empty
        mockFetchAllPages.mockResolvedValue([]);
        mockGetProducts.mockResolvedValue(sampleProducts);
        mockFetchWithAuth.mockResolvedValue(makeJobsPage([]));
    });

    it('renders the Manufacturing heading', async () => {
        render(<ManufacturingPage />);
        expect(screen.getByRole('heading', { name: 'Manufacturing' })).toBeInTheDocument();
    });

    it('shows BOM and Production Jobs tabs', async () => {
        render(<ManufacturingPage />);
        expect(screen.getByText('Bill of Materials')).toBeInTheDocument();
        expect(screen.getByText('Production Jobs')).toBeInTheDocument();
    });

    it('loads BOM tab by default and shows empty state', async () => {
        render(<ManufacturingPage />);
        await waitFor(() => {
            expect(screen.getByText('No BOM recipes yet. Create one to get started.')).toBeInTheDocument();
        });
    });

    it('displays BOM recipes when loaded', async () => {
        mockFetchAllPages.mockResolvedValue(sampleBoms);
        render(<ManufacturingPage />);
        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('WGT-001')).toBeInTheDocument();
            expect(screen.getByText('Widget B')).toBeInTheDocument();
        });
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('shows "1 recipe" for a single BOM', async () => {
        mockFetchAllPages.mockResolvedValue([sampleBoms[0]]);
        render(<ManufacturingPage />);
        await waitFor(() => {
            expect(screen.getByText('1 recipe')).toBeInTheDocument();
        });
    });

    it('shows error message when BOM fetch fails', async () => {
        mockFetchAllPages.mockRejectedValue(new Error('Network error'));
        render(<ManufacturingPage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load BOMs')).toBeInTheDocument();
        });
    });

    it('opens New BOM modal when button clicked', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingPage />);
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
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('New BOM Recipe')).not.toBeInTheDocument();
    });

    it('shows validation error in BOM modal when productId is empty', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Create'));
        expect(screen.getByText('Please select the product to manufacture.')).toBeInTheDocument();
    });

    it('adds a component row in the BOM modal', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Add Component'));
        expect(screen.getByLabelText('Select a component…')).toBeInTheDocument();
    });

    it('removes a component row from the BOM modal', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingPage />);
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
        render(<ManufacturingPage />);
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
        render(<ManufacturingPage />);
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

    it('switches to Production Jobs tab', async () => {
        mockFetchWithAuth.mockResolvedValue(makeJobsPage([]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('No production jobs yet.')).toBeInTheDocument();
        });
    });

    it('loads and displays production jobs', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeJobsPage(sampleJobs)); // Jobs tab
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('Widget B')).toBeInTheDocument();
        });
        expect(screen.getByText('2 jobs')).toBeInTheDocument();
    });

    it('shows "1 job" for a single job', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeJobsPage([sampleJobs[0]]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('1 job')).toBeInTheDocument();
        });
    });

    it('shows error when jobs fetch fails', async () => {
        mockFetchWithAuth
            .mockRejectedValueOnce(new Error('Network error'));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('Failed to load production jobs')).toBeInTheDocument();
        });
    });

    it('shows Start button for DRAFT jobs', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeJobsPage([sampleJobs[0]]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('Start')).toBeInTheDocument();
        });
    });

    it('shows Complete button for IN_PROGRESS jobs', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeJobsPage([sampleJobs[1]]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('Complete')).toBeInTheDocument();
        });
    });

    it('opens the complete modal and submits recorded wastage', async () => {
        const jobWithComponents = {
            ...sampleJobs[1],
            recipe: {
                ...sampleJobs[1].recipe,
                components: [
                    { id: 'comp-1', productId: 'prod-flour', quantity: 5, product: { id: 'prod-flour', name: 'Flour', sku: 'FLR-1' } },
                ],
            },
        };
        mockFetchWithAuth
            .mockResolvedValueOnce(makeJobsPage([jobWithComponents]))
            .mockResolvedValueOnce({ status: 'COMPLETED' }) // complete POST
            .mockResolvedValueOnce(makeJobsPage([])); // reload after complete
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('Complete'));
        fireEvent.click(screen.getByText('Complete'));
        expect(screen.getByText('Complete Production Job')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/Flour/), { target: { value: '2' } });
        await act(async () => {
            fireEvent.click(screen.getAllByText('Complete')[1]);
        });

        await waitFor(() => {
            expect(mockFetchWithAuth).toHaveBeenCalledWith(
                expect.stringContaining(`jobs/${jobWithComponents.id}/complete`),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ wastage: [{ productId: 'prod-flour', quantity: 2 }] }),
                }),
            );
        });
    });

    it('opens New Job modal and populates the recipe dropdown', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(makeJobsPage([])); // Jobs tab load
        mockFetchAllPages.mockResolvedValueOnce([]).mockResolvedValueOnce(sampleBoms); // boms on modal open
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('New Job'));
        await act(async () => {
            fireEvent.click(screen.getByText('New Job'));
        });
        expect(screen.getByText('New Production Job')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('Widget A (WGT-001)')).toBeInTheDocument();
        });
    });

    it('validates recipe selection in the job modal', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(makeJobsPage([]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('New Job'));
        await act(async () => {
            fireEvent.click(screen.getByText('New Job'));
        });
        fireEvent.click(screen.getByText('Create Job'));
        expect(screen.getByText('Please select a product to manufacture.')).toBeInTheDocument();
    });

    it('shows a material requirements preview with an insufficient-stock warning', async () => {
        mockFetchAllPages.mockResolvedValueOnce([]).mockResolvedValueOnce(sampleBoms); // boms on modal open
        mockFetchWithAuth
            .mockResolvedValueOnce(makeJobsPage([])) // Jobs tab load
            .mockResolvedValueOnce({
                recipeId: 'bom-1',
                quantity: 1,
                outputQty: 10,
                sufficient: false,
                components: [
                    {
                        productId: 'prod-flour',
                        productName: 'Flour',
                        productSku: 'FLR-1',
                        perUnitQty: 5,
                        requiredQty: 5,
                        availableQty: 2,
                        sufficient: false,
                    },
                ],
            });
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('New Job'));
        await act(async () => {
            fireEvent.click(screen.getByText('New Job'));
        });
        await waitFor(() => screen.getByText('Widget A (WGT-001)'));
        fireEvent.change(screen.getByLabelText('Product (BOM Recipe) *'), { target: { value: 'bom-1' } });
        await waitFor(() => {
            expect(screen.getByText(/Insufficient stock for one or more materials/)).toBeInTheDocument();
            expect(screen.getByText('Flour')).toBeInTheDocument();
            expect(screen.getByText('(FLR-1)')).toBeInTheDocument();
        });
    });

    it('shows an empty state on the Analytics tab when there are no completed jobs', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce({
                totalCompletedJobs: 0,
                totalUnitsProduced: 0,
                totalMaterialCost: 0,
                avgUnitProductionCost: 0,
                jobs: [],
                volumeTrend: [],
            });
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Analytics'));
        await waitFor(() => {
            expect(screen.getByText(/No completed production jobs yet/)).toBeInTheDocument();
        });
    });

    it('shows KPI tiles, a volume trend, and a cost table on the Analytics tab', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce({
                totalCompletedJobs: 2,
                totalUnitsProduced: 30,
                totalMaterialCost: 156,
                avgUnitProductionCost: 5.2,
                jobs: [
                    {
                        jobId: 'job-1',
                        productId: 'prod-1',
                        productName: 'Widget A',
                        productSku: 'WGT-001',
                        quantityProduced: 20,
                        plannedMaterialCost: 100,
                        wastageCost: 6,
                        actualMaterialCost: 106,
                        unitProductionCost: 5.3,
                        completedAt: '2026-07-01',
                    },
                ],
                volumeTrend: [
                    { date: '2026-07-01', quantityProduced: 20 },
                    { date: '2026-07-02', quantityProduced: 10 },
                ],
            });
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Analytics'));
        await waitFor(() => {
            expect(screen.getByText('Completed Jobs')).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
            expect(screen.getByText('Production Volume Trend')).toBeInTheDocument();
            expect(screen.getByText('Planned vs. Actual Material Cost')).toBeInTheDocument();
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('WGT-001')).toBeInTheDocument();
        });
    });

    it('filters jobs by status tab', async () => {
        mockFetchWithAuth
            .mockResolvedValue(makeJobsPage([]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('Draft'));
        fireEvent.click(screen.getByText('Draft'));
        await waitFor(() => {
            const calls = mockFetchWithAuth.mock.calls;
            const lastCall = calls[calls.length - 1];
            expect(lastCall[0]).toContain('status=DRAFT');
        });
    });

    it('keeps the output product out of the component picker', async () => {
        mockFetchAllPages.mockResolvedValue([]);
        render(<ManufacturingPage />);
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
        render(<ManufacturingPage />);
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
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('Widget A'));
        // The endpoint validates `limit` at Max(100); a hand-built `?limit=200`
        // came back 400 and the tab rendered nothing but "Failed to load BOMs".
        expect(mockFetchAllPages).toHaveBeenCalledWith('/manufacturing/bom');
        for (const [url] of mockFetchWithAuth.mock.calls) {
            expect(String(url)).not.toContain('limit=200');
        }
    });

    it('opens the complete modal for a job whose recipe carries no components', async () => {
        const { components, ...recipeWithoutComponents } = sampleJobs[1].recipe;
        mockFetchWithAuth.mockResolvedValueOnce(
            makeJobsPage([{ ...sampleJobs[1], recipe: recipeWithoutComponents }]),
        );
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('Complete'));
        await act(async () => {
            fireEvent.click(screen.getByText('Complete'));
        });
        expect(screen.getByText('Complete Production Job')).toBeInTheDocument();
    });

    it('deletes a BOM after confirmation', async () => {
        const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
        mockFetchAllPages.mockResolvedValueOnce(sampleBoms).mockResolvedValueOnce([]);
        mockFetchWithAuth.mockResolvedValueOnce({});
        render(<ManufacturingPage />);
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
