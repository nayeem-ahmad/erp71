'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SalesByProductPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';

jest.mock('@/lib/api', () => ({
    api: {
        getSalesByProduct: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/products',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const ROWS = [
    {
        product: { id: 'p1', name: 'Miniket Rice 5kg', sku: 'RICE-5', group: { name: 'Grocery' }, subgroup: { name: 'Rice' } },
        unitsSold: 10,
        revenue: 6000,
        revenueShare: 60,
    },
    {
        product: { id: 'p2', name: 'USB-C Cable', sku: 'USB-1', group: { name: 'Electronics' }, subgroup: null },
        unitsSold: 8,
        revenue: 3000,
        revenueShare: 30,
    },
    {
        product: { id: 'p3', name: 'Loose Candy', sku: null, group: null, subgroup: null },
        unitsSold: 50,
        revenue: 1000,
        revenueShare: 10,
    },
];

function api() {
    return require('@/lib/api').api;
}

/** A filter chip's button, not the column header of the same name. */
function chip(name: RegExp) {
    return screen.getAllByRole('button', { name }).find((button) => button.getAttribute('aria-haspopup') === 'dialog')!;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling?.textContent;
}

describe('SalesByProductPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getSalesByProduct.mockResolvedValue({
            summary: { totalRevenue: 10000, totalUnitsSold: 68, productCount: 3 },
            rows: ROWS,
        });
    });

    it('renders the heading and the products', async () => {
        render(<SalesByProductPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Sales by Product' })).toBeInTheDocument();
        expect(await screen.findByRole('cell', { name: 'Miniket Rice 5kg' })).toBeInTheDocument();
    });

    it('asks for the last 30 days of the header branch, and nothing else', async () => {
        render(<SalesByProductPage />);
        await waitFor(() => expect(api().getSalesByProduct).toHaveBeenCalledTimes(1));
        expect(api().getSalesByProduct).toHaveBeenCalledWith({ storeId: 'store-1', ...createdRangeFromPreset('last30') });
    });

    it('fills the strip from the rows, top seller included', async () => {
        render(<SalesByProductPage />);
        await screen.findByRole('cell', { name: 'Miniket Rice 5kg' });

        expect(tile('Total Revenue')).toBe('৳ 10,000');
        expect(tile('Units Sold')).toBe('68');
        expect(tile('Products Sold')).toBe('3');
        expect(tile('Top seller')).toContain('Miniket Rice 5kg');
        expect(tile('Top seller')).toContain('60.0% of revenue');
    });

    it('narrows by group on the rows in hand, and the strip follows', async () => {
        render(<SalesByProductPage />);
        await screen.findByRole('cell', { name: 'Miniket Rice 5kg' });

        fireEvent.click(chip(/^Group/));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Electronics' }));

        await waitFor(() => expect(screen.queryByRole('cell', { name: 'Miniket Rice 5kg' })).not.toBeInTheDocument());
        expect(screen.getByRole('cell', { name: 'USB-C Cable' })).toBeInTheDocument();
        expect(tile('Total Revenue')).toBe('৳ 3,000');
        expect(tile('Products Sold')).toBe('1');
        // Grouping narrows what is in hand rather than asking the server again.
        expect(api().getSalesByProduct).toHaveBeenCalledTimes(1);
    });

    it('offers uncategorised products as a group of their own', async () => {
        render(<SalesByProductPage />);
        await screen.findByRole('cell', { name: 'Loose Candy' });

        fireEvent.click(chip(/^Group/));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Uncategorized' }));

        await waitFor(() => expect(screen.queryByRole('cell', { name: 'USB-C Cable' })).not.toBeInTheDocument());
        expect(screen.getByRole('cell', { name: 'Loose Candy' })).toBeInTheDocument();
    });

    it('keeps a totals row under the products', async () => {
        render(<SalesByProductPage />);
        await screen.findByRole('cell', { name: 'Miniket Rice 5kg' });
        expect(screen.getByText('Total')).toBeInTheDocument();
        expect(screen.getByText('৳ 10,000.00')).toBeInTheDocument();
    });

    it('shows the empty message when nothing sold', async () => {
        api().getSalesByProduct.mockResolvedValue({ summary: null, rows: [] });
        render(<SalesByProductPage />);
        expect(await screen.findByText('No sales recorded for this filter')).toBeInTheDocument();
    });

    it('handles an API error without crashing', async () => {
        api().getSalesByProduct.mockRejectedValue(new Error('Server error'));
        render(<SalesByProductPage />);
        await waitFor(() => expect(api().getSalesByProduct).toHaveBeenCalled());
        expect(screen.getByRole('heading', { name: 'Sales by Product' })).toBeInTheDocument();
    });
});
