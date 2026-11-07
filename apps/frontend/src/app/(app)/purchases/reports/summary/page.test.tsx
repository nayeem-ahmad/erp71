'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { render, screen, waitFor, within } from '@testing-library/react';
import PurchaseSummaryPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';

jest.mock('@/lib/api', () => ({
    api: {
        getPurchaseSummary: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/purchases/reports/summary',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const ROWS = [
    { date: '2026-05-31', orders: 2, grossPurchases: 3000, returns: 0, netPurchases: 3000 },
    { date: '2026-06-01', orders: 3, grossPurchases: 15000, returns: 500, netPurchases: 14500 },
    { date: '2026-06-02', orders: 5, grossPurchases: 32000, returns: 1500, netPurchases: 30500 },
];

function api() {
    return require('@/lib/api').api;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling?.textContent;
}

describe('PurchaseSummaryPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getPurchaseSummary.mockResolvedValue({ summary: {}, rows: ROWS });
    });

    it('opens on the last 30 days from the Period chip', async () => {
        render(<PurchaseSummaryPage />);
        await waitFor(() => expect(api().getPurchaseSummary).toHaveBeenCalledTimes(1));
        const { from, to } = createdRangeFromPreset('last30');
        expect(api().getPurchaseSummary).toHaveBeenCalledWith({ storeId: 'store-1', from, to });
        expect(screen.queryAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toHaveLength(0);
    });

    it('adds up the strip from the rows it shows', async () => {
        render(<PurchaseSummaryPage />);
        await screen.findByText('2026-06-02');

        expect(tile('Orders')).toBe('10');
        expect(tile('Net Purchases')).toBe('৳ 48,000');
        expect(tile('Returns')).toBe('৳ 2,000');
        expect(tile('Avg Order Value')).toBe('৳ 5,000');
    });
});
