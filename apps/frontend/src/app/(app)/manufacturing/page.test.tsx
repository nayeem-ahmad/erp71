import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ManufacturingPage from './page';

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

jest.mock('@/lib/format', () => ({
    formatDate: (d: string) => d,
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
}));

const mockFetchWithAuth = require('@/lib/api').fetchWithAuth as jest.Mock;

const makeBomResponse = (items: object[]) => ({
    ok: true,
    json: jest.fn().mockResolvedValue(items),
});

const makeJobsResponse = (items: object[]) => ({
    ok: true,
    json: jest.fn().mockResolvedValue({ items, total: items.length, page: 1, limit: 20, pages: 1 }),
});

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
        mockFetchWithAuth.mockResolvedValue(makeBomResponse([]));
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
        mockFetchWithAuth.mockResolvedValue(makeBomResponse(sampleBoms));
        render(<ManufacturingPage />);
        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('WGT-001')).toBeInTheDocument();
            expect(screen.getByText('Widget B')).toBeInTheDocument();
        });
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('shows "1 recipe" for a single BOM', async () => {
        mockFetchWithAuth.mockResolvedValue(makeBomResponse([sampleBoms[0]]));
        render(<ManufacturingPage />);
        await waitFor(() => {
            expect(screen.getByText('1 recipe')).toBeInTheDocument();
        });
    });

    it('shows error message when BOM fetch fails', async () => {
        mockFetchWithAuth.mockRejectedValue(new Error('Network error'));
        render(<ManufacturingPage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load BOMs')).toBeInTheDocument();
        });
    });

    it('opens New BOM modal when button clicked', async () => {
        mockFetchWithAuth.mockResolvedValue(makeBomResponse([]));
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        expect(screen.getByText('New BOM Recipe')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Product ID of the manufactured item')).toBeInTheDocument();
    });

    it('closes the BOM modal when Cancel is clicked', async () => {
        mockFetchWithAuth.mockResolvedValue(makeBomResponse([]));
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('New BOM Recipe')).not.toBeInTheDocument();
    });

    it('shows validation error in BOM modal when productId is empty', async () => {
        mockFetchWithAuth.mockResolvedValue(makeBomResponse([]));
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Create'));
        expect(screen.getByText('Product ID is required.')).toBeInTheDocument();
    });

    it('adds a component row in the BOM modal', async () => {
        mockFetchWithAuth.mockResolvedValue(makeBomResponse([]));
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Add Component'));
        expect(screen.getByPlaceholderText('Component Product ID')).toBeInTheDocument();
    });

    it('removes a component row from the BOM modal', async () => {
        mockFetchWithAuth.mockResolvedValue(makeBomResponse([]));
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('Add Component'));
        expect(screen.getByPlaceholderText('Component Product ID')).toBeInTheDocument();
        // Remove it via the trash button
        const trashButtons = screen.getAllByTestId('icon-trash');
        fireEvent.click(trashButtons[0]);
        expect(screen.queryByPlaceholderText('Component Product ID')).not.toBeInTheDocument();
    });

    it('submits BOM creation successfully', async () => {
        const saveResponse = { ok: true, json: jest.fn().mockResolvedValue({ id: 'bom-new' }) };
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))  // initial load
            .mockResolvedValueOnce(saveResponse)          // save POST
            .mockResolvedValueOnce(makeBomResponse(sampleBoms)); // reload after save
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.change(screen.getByPlaceholderText('Product ID of the manufactured item'), {
            target: { value: 'new-product-id' },
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
        const failResponse = { ok: false, json: jest.fn().mockResolvedValue({ message: 'Product not found' }) };
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockResolvedValueOnce(failResponse);
        render(<ManufacturingPage />);
        await waitFor(() => screen.getByText('New BOM'));
        fireEvent.click(screen.getByText('New BOM'));
        fireEvent.change(screen.getByPlaceholderText('Product ID of the manufactured item'), {
            target: { value: 'bad-id' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        await waitFor(() => {
            expect(screen.getByText('Product not found')).toBeInTheDocument();
        });
    });

    it('switches to Production Jobs tab', async () => {
        mockFetchWithAuth.mockResolvedValue(makeJobsResponse([]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('No production jobs yet.')).toBeInTheDocument();
        });
    });

    it('loads and displays production jobs', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))  // BOM tab initial load
            .mockResolvedValueOnce(makeJobsResponse(sampleJobs)); // Jobs tab
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
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockResolvedValueOnce(makeJobsResponse([sampleJobs[0]]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('1 job')).toBeInTheDocument();
        });
    });

    it('shows error when jobs fetch fails', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockRejectedValueOnce(new Error('Network error'));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('Failed to load production jobs')).toBeInTheDocument();
        });
    });

    it('shows Start button for DRAFT jobs', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockResolvedValueOnce(makeJobsResponse([sampleJobs[0]]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('Start')).toBeInTheDocument();
        });
    });

    it('shows Complete button for IN_PROGRESS jobs', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockResolvedValueOnce(makeJobsResponse([sampleJobs[1]]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => {
            expect(screen.getByText('Complete')).toBeInTheDocument();
        });
    });

    it('opens New Job modal when button clicked', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockResolvedValueOnce(makeJobsResponse([]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('New Job'));
        fireEvent.click(screen.getByText('New Job'));
        expect(screen.getByText('New Production Job')).toBeInTheDocument();
    });

    it('validates recipe ID in the job modal', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockResolvedValueOnce(makeJobsResponse([]));
        render(<ManufacturingPage />);
        fireEvent.click(screen.getByText('Production Jobs'));
        await waitFor(() => screen.getByText('New Job'));
        fireEvent.click(screen.getByText('New Job'));
        fireEvent.click(screen.getByText('Create Job'));
        expect(screen.getByText('Recipe ID is required.')).toBeInTheDocument();
    });

    it('filters jobs by status tab', async () => {
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse([]))
            .mockResolvedValue(makeJobsResponse([]));
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

    it('deletes a BOM after confirmation', async () => {
        const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
        const deleteResponse = { ok: true, json: jest.fn().mockResolvedValue({}) };
        mockFetchWithAuth
            .mockResolvedValueOnce(makeBomResponse(sampleBoms))
            .mockResolvedValueOnce(deleteResponse)
            .mockResolvedValueOnce(makeBomResponse([]));
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
