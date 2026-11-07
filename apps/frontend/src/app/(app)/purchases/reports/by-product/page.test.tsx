'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { render, screen, waitFor, within } from '@testing-library/react';
import PurchasesByProductPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';

jest.mock('@/lib/api', () => ({
    api: {
        getPurchasesByProduct: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/purchases/reports/by-product',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const ROWS = [
    {
        product: { id: 'p1', name: 'Miniket Rice 5kg', sku: 'RICE-5', group: { name: 'Grocery' }, subgroup: { name: 'Rice' } },
        unitsOrdered: 10,
        spend: 6000,
        spendShare: 60,
    },
    {
        product: { id: 'p2', name: 'USB-C Cable', sku: 'USB-1', group: { name: 'Electronics' }, subgroup: null },
        unitsOrdered: 8,
        spend: 3000,
        spendShare: 30,
    },
];

function api() {
    return require('@/lib/api').api;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling?.textContent;
}

describe('PurchasesByProductPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getPurchasesByProduct.mockResolvedValue({ summary: {}, rows: ROWS });
    });

    it('loads the period once without server group filters', async () => {
        render(<PurchasesByProductPage />);
        await waitFor(() => expect(api().getPurchasesByProduct).toHaveBeenCalledTimes(1));
        const { from, to } = createdRangeFromPreset('last30');
        expect(api().getPurchasesByProduct).toHaveBeenCalledWith({ storeId: 'store-1', from, to });
        expect(api().getPurchasesByProduct).toHaveBeenCalledWith(expect.not.objectContaining({ groupId: expect.anything() }));
    });

    it('shows spend and product count in the stats strip', async () => {
        render(<PurchasesByProductPage />);
        await waitFor(() => expect(api().getPurchasesByProduct).toHaveBeenCalled());
        await screen.findByRole('region', { name: 'Report figures' });

        expect(tile('Total Spend')).toBe('৳ 9,000');
        expect(tile('Products')).toBe('2');
        expect(tile('Top product')).toContain('Miniket Rice 5kg');
    });
});
