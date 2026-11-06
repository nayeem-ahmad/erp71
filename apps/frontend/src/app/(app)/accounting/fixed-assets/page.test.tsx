'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { formatBDT } from '@/lib/format';
import FixedAssetsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        listFixedAssets: jest.fn(),
        createFixedAsset: jest.fn(),
        updateFixedAsset: jest.fn(),
        runDepreciation: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/accounting/fixed-assets',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// DataTable hides `hideOnMobile` columns on a narrow viewport, which is all
// the global matchMedia mock reports.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
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
        category: 'Furniture',
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
        category: null,
    },
    {
        id: 'asset-3',
        asset_code: 'FA-003',
        name: 'Reception Desk',
        purchase_date: '2024-03-01T00:00:00.000Z',
        cost: 20000,
        residual_value: 0,
        useful_life_months: 60,
        depreciation_method: 'STRAIGHT_LINE',
        accumulated_depreciation: 2000,
        is_active: true,
        category: ' furniture',
    },
];

const openChip = (name: string) =>
    fireEvent.click(
        screen.getAllByRole('button', { name }).find((b) => b.getAttribute('aria-haspopup') === 'dialog')!,
    );

describe('FixedAssetsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.listFixedAssets.mockResolvedValue(mockAssets);
        api.createFixedAsset.mockResolvedValue({ id: 'asset-new' });
        api.updateFixedAsset.mockResolvedValue({ id: 'asset-2' });
        api.runDepreciation.mockResolvedValue({ processed: 2 });
    });

    it('renders the page subtitle', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => {
            expect(screen.getByText(/Asset register with depreciation schedules/i)).toBeInTheDocument();
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
        await waitFor(() => expect(screen.getByText('FA-001')).toBeInTheDocument());
        for (const name of ['Code', 'Name', 'Category', 'Purchase Date', 'Cost', 'Accum. Dep.', 'Net Book Value', 'Method']) {
            expect(screen.getByRole('columnheader', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
        }
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
        expect(screen.getByRole('region', { name: 'Fixed asset figures' })).toHaveAttribute('aria-busy', 'true');
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
            expect(screen.getAllByText('SL')).toHaveLength(2);
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

    it('sums the rows the search leaves in the strip', async () => {
        const money = (value: number) => formatBDT(value, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 });
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-002')).toBeInTheDocument());

        const strip = screen.getByRole('region', { name: 'Fixed asset figures' });
        expect(within(strip).getByText(money(190_000))).toBeInTheDocument();
        expect(within(strip).getByText(money(138_000))).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText('Search by code, name or category…'), { target: { value: 'server' } });

        await waitFor(() => expect(screen.queryByText('FA-001')).not.toBeInTheDocument());
        expect(screen.getByText('FA-002')).toBeInTheDocument();
        expect(within(strip).getByText(money(80_000))).toBeInTheDocument();
        expect(within(strip).queryByText(money(190_000))).not.toBeInTheDocument();
    });

    it('shows each asset\'s category, with a dash for none', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-002')).toBeInTheDocument());
        const row = (code: string) => screen.getByText(code).closest('tr') as HTMLElement;
        expect(within(row('FA-001')).getByText('Furniture')).toBeInTheDocument();
        expect(within(row('FA-002')).getByText('—')).toBeInTheDocument();
    });

    it('narrows by category — one entry per category however it was typed — and by none', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-002')).toBeInTheDocument());
        const strip = screen.getByRole('region', { name: 'Fixed asset figures' });

        openChip('Category');
        expect(screen.getAllByRole('checkbox', { name: 'Furniture' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Furniture' }));

        await waitFor(() => expect(screen.queryByText('FA-002')).not.toBeInTheDocument());
        expect(screen.getByText('FA-001')).toBeInTheDocument();
        expect(screen.getByText('FA-003')).toBeInTheDocument();
        expect(within(strip).getByText('2')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Furniture' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Uncategorised' }));

        await waitFor(() => expect(screen.queryByText('FA-001')).not.toBeInTheDocument());
        expect(screen.getByText('FA-002')).toBeInTheDocument();
        expect(screen.queryByText('FA-003')).not.toBeInTheDocument();
    });

    it('finds assets by category in the search box', async () => {
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-002')).toBeInTheDocument());
        fireEvent.change(screen.getByPlaceholderText('Search by code, name or category…'), { target: { value: 'furn' } });
        await waitFor(() => expect(screen.queryByText('FA-002')).not.toBeInTheDocument());
        expect(screen.getByText('FA-001')).toBeInTheDocument();
        expect(screen.getByText('FA-003')).toBeInTheDocument();
    });

    it('sends the typed category when adding an asset, suggesting the ones in use', async () => {
        const { api } = require('@/lib/api');
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-002')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /add asset/i }));

        const category = screen.getByPlaceholderText('e.g. Furniture, Vehicles');
        expect(category).toHaveAttribute('list', 'fixed-asset-categories');
        const suggestions = document.getElementById('fixed-asset-categories')!;
        expect([...suggestions.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['Furniture']);

        fireEvent.change(screen.getByPlaceholderText('e.g. FA-001'), { target: { value: 'FA-009' } });
        fireEvent.change(category, { target: { value: '  Vehicles ' } });
        fireEvent.click(screen.getByRole('button', { name: /save asset/i }));

        await waitFor(() => expect(api.createFixedAsset).toHaveBeenCalledWith(
            expect.objectContaining({ assetCode: 'FA-009', category: 'Vehicles' }),
        ));
    });

    it('leaves the category out when none was typed', async () => {
        const { api } = require('@/lib/api');
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-002')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /add asset/i }));
        fireEvent.click(screen.getByRole('button', { name: /save asset/i }));
        await waitFor(() => expect(api.createFixedAsset).toHaveBeenCalled());
        expect(api.createFixedAsset.mock.calls[0][0].category).toBeUndefined();
    });

    it('sets an asset\'s category from its row', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-002')).toBeInTheDocument());

        const row = screen.getByText('FA-002').closest('tr') as HTMLElement;
        fireEvent.click(within(row).getByRole('button', { name: 'Set category' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('FA-002 · Server Rack')).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: ' IT equipment ' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.updateFixedAsset).toHaveBeenCalledWith('asset-2', { category: 'IT equipment' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(toast.success).toHaveBeenCalledWith('Category saved.');
        expect(within(screen.getByText('FA-002').closest('tr') as HTMLElement).getByText('IT equipment')).toBeInTheDocument();
    });

    it('clears a category left blank, and keeps the dialog open with the error on failure', async () => {
        const { api } = require('@/lib/api');
        api.updateFixedAsset.mockRejectedValueOnce(new Error('Forbidden'));
        render(<FixedAssetsPage />);
        await waitFor(() => expect(screen.getByText('FA-001')).toBeInTheDocument());

        const row = screen.getByText('FA-001').closest('tr') as HTMLElement;
        fireEvent.click(within(row).getByRole('button', { name: 'Set category' }));
        const dialog = await screen.findByRole('dialog');
        const input = within(dialog).getByLabelText('Category');
        expect(input).toHaveValue('Furniture');

        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(within(dialog).getByText('Forbidden')).toBeInTheDocument());
        expect(api.updateFixedAsset).toHaveBeenCalledWith('asset-1', { category: null });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});
