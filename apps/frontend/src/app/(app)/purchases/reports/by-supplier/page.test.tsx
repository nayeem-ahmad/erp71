'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { render, screen, waitFor, within } from '@testing-library/react';
import PurchasesBySupplierPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';

jest.mock('@/lib/api', () => ({
    api: {
        getPurchasesBySupplier: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/purchases/reports/by-supplier',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const ROWS = [
    {
        supplier: { id: 's1', name: 'Rahman Traders', phone: '01811000001' },
        orderCount: 4,
        spend: 12000,
        avgOrderValue: 3000,
        spendShare: 70,
    },
    {
        supplier: { id: null, name: 'No supplier', phone: null },
        orderCount: 2,
        spend: 5000,
        avgOrderValue: 2500,
        spendShare: 30,
    },
];

function api() {
    return require('@/lib/api').api;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling?.textContent;
}

describe('PurchasesBySupplierPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getPurchasesBySupplier.mockResolvedValue({ summary: {}, rows: ROWS });
    });

    it('opens on the last 30 days', async () => {
        render(<PurchasesBySupplierPage />);
        await waitFor(() => expect(api().getPurchasesBySupplier).toHaveBeenCalledTimes(1));
        const { from, to } = createdRangeFromPreset('last30');
        expect(api().getPurchasesBySupplier).toHaveBeenCalledWith({ storeId: 'store-1', from, to });
    });

    it('sums spend and orders in the stats strip', async () => {
        render(<PurchasesBySupplierPage />);
        await screen.findByText('Rahman Traders');

        expect(tile('Total Spend')).toBe('৳ 17,000');
        expect(tile('Total Orders')).toBe('6');
        expect(tile('Suppliers')).toBe('1');
    });
});
