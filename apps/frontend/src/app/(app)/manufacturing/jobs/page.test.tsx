import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ManufacturingJobsPage from './page';

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
    Trash2: () => <span data-testid="icon-trash" />,
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
    CheckCircle2: () => <span data-testid="icon-check" />,
    Wallet: () => <span data-testid="icon-wallet" />,
    // Used by shared ui primitives (Alert, Button loading spinner) rendered by this page's modals.
    AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
    Info: () => <span data-testid="icon-info" />,
    XCircle: () => <span data-testid="icon-xcircle" />,
    Loader2: () => <span data-testid="icon-loader" />,
}));

// fetchWithAuth already parses the response and unwraps the `{ data: T }`
// envelope, so mocks resolve directly to the payload (not a Response).
const mockFetchWithAuth = require('@/lib/api').fetchWithAuth as jest.Mock;
// The job modal's recipe picker goes through `fetchAllPages`, which walks the
// paginated BOM endpoint and resolves to a flat array.
const mockFetchAllPages = require('@/lib/api').fetchAllPages as jest.Mock;

const makeJobsPage = (items: object[]) => ({ items, total: items.length, page: 1, limit: 20, pages: 1 });

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

describe('ManufacturingJobsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchAllPages.mockResolvedValue(sampleBoms);
        mockFetchWithAuth.mockResolvedValue(makeJobsPage([]));
    });

    it('renders the Production Jobs heading', async () => {
        render(<ManufacturingJobsPage />);
        expect(screen.getByRole('heading', { name: 'Production Jobs' })).toBeInTheDocument();
    });

    it('shows the empty state when there are no jobs', async () => {
        render(<ManufacturingJobsPage />);
        await waitFor(() => {
            expect(screen.getByText('No production jobs yet.')).toBeInTheDocument();
        });
    });

    it('loads and displays production jobs', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(makeJobsPage(sampleJobs));
        render(<ManufacturingJobsPage />);
        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('Widget B')).toBeInTheDocument();
        });
        expect(screen.getByText('2 jobs')).toBeInTheDocument();
    });

    it('shows "1 job" for a single job', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(makeJobsPage([sampleJobs[0]]));
        render(<ManufacturingJobsPage />);
        await waitFor(() => {
            expect(screen.getByText('1 job')).toBeInTheDocument();
        });
    });

    it('shows error when jobs fetch fails', async () => {
        mockFetchWithAuth.mockRejectedValueOnce(new Error('Network error'));
        render(<ManufacturingJobsPage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load production jobs')).toBeInTheDocument();
        });
    });

    it('shows Start button for DRAFT jobs', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(makeJobsPage([sampleJobs[0]]));
        render(<ManufacturingJobsPage />);
        await waitFor(() => {
            expect(screen.getByText('Start')).toBeInTheDocument();
        });
    });

    it('shows Complete button for IN_PROGRESS jobs', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(makeJobsPage([sampleJobs[1]]));
        render(<ManufacturingJobsPage />);
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
        render(<ManufacturingJobsPage />);
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
        render(<ManufacturingJobsPage />);
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
        render(<ManufacturingJobsPage />);
        await waitFor(() => screen.getByText('New Job'));
        await act(async () => {
            fireEvent.click(screen.getByText('New Job'));
        });
        fireEvent.click(screen.getByText('Create Job'));
        expect(screen.getByText('Please select a product to manufacture.')).toBeInTheDocument();
    });

    it('shows a material requirements preview with an insufficient-stock warning', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeJobsPage([])) // page load
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
        render(<ManufacturingJobsPage />);
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

    it('filters jobs by status tab', async () => {
        render(<ManufacturingJobsPage />);
        await waitFor(() => screen.getByText('Draft'));
        fireEvent.click(screen.getByText('Draft'));
        await waitFor(() => {
            const calls = mockFetchWithAuth.mock.calls;
            const lastCall = calls[calls.length - 1];
            expect(lastCall[0]).toContain('status=DRAFT');
        });
    });

    it('opens the complete modal for a job whose recipe carries no components', async () => {
        const { components, ...recipeWithoutComponents } = sampleJobs[1].recipe;
        mockFetchWithAuth.mockResolvedValueOnce(
            makeJobsPage([{ ...sampleJobs[1], recipe: recipeWithoutComponents }]),
        );
        render(<ManufacturingJobsPage />);
        await waitFor(() => screen.getByText('Complete'));
        await act(async () => {
            fireEvent.click(screen.getByText('Complete'));
        });
        expect(screen.getByText('Complete Production Job')).toBeInTheDocument();
    });
});
