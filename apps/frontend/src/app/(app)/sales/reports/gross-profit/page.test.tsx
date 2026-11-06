'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GrossProfitByProductPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';

jest.mock('@/lib/api', () => ({ api: { getGrossProfitByProduct: jest.fn() } }));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/gross-profit',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));

const coverage = (costedRevenue: number, costedLines: number) => ({
    costedLines,
    uncostedLines: costedLines ? 0 : 1,
    costedRevenue,
    uncostedRevenue: costedLines ? 0 : 500,
    costedRevenuePct: costedLines ? 100 : 0,
});

const ROWS = [
    { productId: 'p1', productName: 'Miniket Rice 5kg', unitsSold: 10, revenue: 10000, cogs: 8000, grossProfit: 2000, grossMarginPct: 20, coverage: coverage(10000, 2) },
    { productId: 'p2', productName: 'Soybean Oil 1L', unitsSold: 5, revenue: 1000, cogs: 1100, grossProfit: -100, grossMarginPct: -10, coverage: coverage(1000, 1) },
    { productId: 'p3', productName: 'Loose Candy', unitsSold: 50, revenue: 500, cogs: 0, grossProfit: null, grossMarginPct: null, coverage: coverage(0, 0) },
];

function api() {
    return require('@/lib/api').api;
}

function chip(name: RegExp) {
    return screen.getAllByRole('button', { name }).find((button) => button.getAttribute('aria-haspopup') === 'dialog')!;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling;
}

describe('GrossProfitByProductPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getGrossProfitByProduct.mockResolvedValue({
            summary: { netRevenue: 11500, cogs: 9100, grossProfit: 1900, grossMarginPct: 17.27, coverage: coverage(11000, 3) },
            rows: ROWS,
        });
    });

    it('asks for the last 30 days of the header branch', async () => {
        render(<GrossProfitByProductPage />);
        await waitFor(() => expect(api().getGrossProfitByProduct).toHaveBeenCalledTimes(1));
        expect(api().getGrossProfitByProduct).toHaveBeenCalledWith({ storeId: 'store-1', ...createdRangeFromPreset('last30') });
    });

    it('works the strip out from the rows as the server would, and counts products sold at a loss', async () => {
        render(<GrossProfitByProductPage />);
        await screen.findByRole('cell', { name: 'Miniket Rice 5kg' });

        expect(tile('Revenue')).toHaveTextContent('৳ 11,500');
        expect(tile('Gross Profit')).toHaveTextContent('৳ 1,900');
        // Over the revenue that has a cost: 1,900 / 11,000.
        expect(tile('Margin')).toHaveTextContent('17.3%');
        expect(tile('At a loss')).toHaveTextContent('1');
        expect(tile('At a loss')).toHaveClass('text-red-600');
    });

    it('narrows to the loss-makers with the Margin chip, and the strip follows', async () => {
        render(<GrossProfitByProductPage />);
        await screen.findByRole('cell', { name: 'Miniket Rice 5kg' });

        fireEvent.click(chip(/^Margin/));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Loss' }));

        await waitFor(() => expect(screen.queryByRole('cell', { name: 'Miniket Rice 5kg' })).not.toBeInTheDocument());
        expect(screen.getByRole('cell', { name: 'Soybean Oil 1L' })).toBeInTheDocument();
        expect(tile('Revenue')).toHaveTextContent('৳ 1,000');
        expect(tile('Gross Profit')).toHaveClass('text-red-600');
    });

    it('keeps the links to the other gross-profit reports', async () => {
        render(<GrossProfitByProductPage />);
        expect(screen.getByRole('link', { name: 'Margin Exceptions' })).toHaveAttribute('href', '/sales/reports/gross-profit/exceptions');
    });
});
