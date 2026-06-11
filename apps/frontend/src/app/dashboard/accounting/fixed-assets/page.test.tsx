'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FixedAssetsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        listFixedAssets: jest.fn(),
        createFixedAsset: jest.fn(),
        runDepreciation: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/accounting/fixed-assets',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockAssets = [
    {
        id: 'asset-1',
        asset_code: 'FA-001',
        name: 'Office Furniture',
        purchase_date: '2024-01-15T00:00:00.000Z',
        cost: 50000,
        residual_value: 5000,
        useful_life_months: 60,
        depreciation_method: 'STRAIGHT_LINE',
        accumulated_depreciation: 10000,
        is_active: true,
    },
    {
        id: 'asset-2',
        asset_code: 'FA-002',
        name: 'Server Rack',
        purchase_date: '2023-06-01T00:00:00.000Z',
        cost: 120000,
        residual_value: 10000,
        useful_life_months: 36,
        depreciation_method: 'DECLINING_BALANCE',
        accumulated_depreciation: 40000,
        is_active: true,
    },
];

describe('FixedAssetsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.listFixedAssets.mockResolvedValue(mockAssets);
        api.createFixedAsset.mockResolvedValue({ id: 'asset-new' });
        api.runDepreciation.mockResolvedValue({ processed: 2 });
    });

    it('renders the page heading', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByText('Fixed Asset Register')).toBeInTheDocument();
    });

    it('renders the page subtitle', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText(/Track assets, useful life/i)).toBeInTheDocument();
        });
    });

    it('calls listFixedAssets on mount', async () => {
        const { api } = require('@/lib/api');
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(api.listFixedAssets).toHaveBeenCalledTimes(1);
        });
    });

    it('renders asset table with loaded assets', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText('FA-001')).toBeInTheDocument();
            expect(screen.getByText('Office Furniture')).toBeInTheDocument();
            expect(screen.getByText('FA-002')).toBeInTheDocument();
            expect(screen.getByText('Server Rack')).toBeInTheDocument();
        });
    });

    it('renders table column headers', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText('Code')).toBeInTheDocument();
            expect(screen.getByText('Name')).toBeInTheDocument();
            expect(screen.getByText('Purchase Date')).toBeInTheDocument();
            expect(screen.getByText('Cost')).toBeInTheDocument();
            expect(screen.getByText('Accum. Dep.')).toBeInTheDocument();
            expect(screen.getByText('Net Book Value')).toBeInTheDocument();
            expect(screen.getByText('Method')).toBeInTheDocument();
        });
    });

    it('renders Add Asset button', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /add asset/i })).toBeInTheDocument();
        });
    });

    it('renders Run Depreciation button', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /run depreciation/i })).toBeInTheDocument();
        });
    });

    it('shows Add Asset form when Add Asset button is clicked', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /add asset/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /add asset/i }));
        expect(screen.getByText('Add Fixed Asset')).toBeInTheDocument();
    });

    it('shows Run Depreciation form when button is clicked', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /run depreciation/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /run depreciation/i }));
        expect(screen.getByText('Run Monthly Depreciation')).toBeInTheDocument();
    });

    it('shows Run Depreciation result on success', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /run depreciation/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /run depreciation/i }));
        fireEvent.click(screen.getByRole('button', { name: /run now/i }));
        await waitFor(() => {
            expect(screen.getByText(/Depreciation posted: 2 asset\(s\) processed/i)).toBeInTheDocument();
        });
    });

    it('shows error when depreciation run fails', async () => {
        const { api } = require('@/lib/api');
        api.runDepreciation.mockRejectedValue(new Error('Depreciation failed'));
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /run depreciation/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /run depreciation/i }));
        fireEvent.click(screen.getByRole('button', { name: /run now/i }));
        await waitFor(() => {
            expect(screen.getByText(/Error: Depreciation failed/i)).toBeInTheDocument();
        });
    });

    it('closes Run Depreciation form with Close button', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /run depreciation/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /run depreciation/i }));
        expect(screen.getByText('Run Monthly Depreciation')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
        expect(screen.queryByText('Run Monthly Depreciation')).not.toBeInTheDocument();
    });

    it('shows empty state when no assets', async () => {
        const { api } = require('@/lib/api');
        api.listFixedAssets.mockResolvedValue([]);
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText('No assets yet. Add your first fixed asset.')).toBeInTheDocument();
        });
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.listFixedAssets.mockImplementation(() => new Promise(() => {}));
        render(<FixedAssetsPage />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows error message on API failure', async () => {
        const { api } = require('@/lib/api');
        api.listFixedAssets.mockRejectedValue(new Error('Failed to load'));
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load')).toBeInTheDocument();
        });
    });

    it('shows depreciation method abbreviation SL for STRAIGHT_LINE', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText('SL')).toBeInTheDocument();
        });
    });

    it('shows depreciation method abbreviation DB for DECLINING_BALANCE', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText('DB')).toBeInTheDocument();
        });
    });

    it('renders Asset Code field in Add Asset form', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            fireEvent.click(screen.getByRole('button', { name: /add asset/i }));
        });
        expect(screen.getByPlaceholderText('e.g. FA-001')).toBeInTheDocument();
    });

    it('cancels Add Asset form with Cancel button', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            fireEvent.click(screen.getByRole('button', { name: /add asset/i }));
        });
        expect(screen.getByText('Add Fixed Asset')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(screen.queryByText('Add Fixed Asset')).not.toBeInTheDocument();
    });
});
