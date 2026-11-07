'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MarginBridgePage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';
import { precedingRange } from '../../report-period';

jest.mock('@/lib/api', () => ({ api: { getMarginBridge: jest.fn() } }));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/gross-profit/bridge',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));

const bridge = (values: Partial<Record<string, number>>) => ({
    previousGrossProfit: 0,
    currentGrossProfit: 0,
    totalChange: 0,
    volumeEffect: 0,
    priceEffect: 0,
    costEffect: 0,
    mixEffect: 0,
    ...values,
});

function api() {
    return require('@/lib/api').api;
}

function chip(name: RegExp) {
    return screen.getAllByRole('button', { name }).find((button) => button.getAttribute('aria-haspopup') === 'dialog')!;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling;
}

describe('MarginBridgePage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getMarginBridge.mockResolvedValue({
            summary: {
                bridge: bridge({ previousGrossProfit: 5000, currentGrossProfit: 4000, totalChange: -1000, volumeEffect: 500, costEffect: -1200, mixEffect: -300 }),
            },
            rows: [
                { productId: 'p1', productName: 'Soybean Oil 1L', ...bridge({ previousGrossProfit: 3000, currentGrossProfit: 1800, totalChange: -1200, costEffect: -1200 }) },
                { productId: 'p2', productName: 'Miniket Rice 5kg', ...bridge({ previousGrossProfit: 2000, currentGrossProfit: 2200, totalChange: 200, volumeEffect: 200 }) },
            ],
        });
    });

    it('compares the last 30 days with the 30 before them', async () => {
        render(<MarginBridgePage />);
        await waitFor(() => expect(api().getMarginBridge).toHaveBeenCalledTimes(1));
        const current = createdRangeFromPreset('last30');
        const previous = precedingRange(current);
        expect(api().getMarginBridge).toHaveBeenCalledWith({
            storeId: 'store-1',
            from: current.from,
            to: current.to,
            compareFrom: previous.from,
            compareTo: previous.to,
        });
    });

    it('moves the comparison with the period until one is picked', async () => {
        render(<MarginBridgePage />);
        await waitFor(() => expect(api().getMarginBridge).toHaveBeenCalledTimes(1));

        fireEvent.click(chip(/^Current period/));
        fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

        await waitFor(() => expect(api().getMarginBridge).toHaveBeenCalledTimes(2));
        const current = createdRangeFromPreset('last7');
        expect(api().getMarginBridge).toHaveBeenLastCalledWith(
            expect.objectContaining({ from: current.from, compareFrom: precedingRange(current).from, compareTo: precedingRange(current).to }),
        );
    });

    it('reads the overall bridge in the strip, then the rows a chip leaves', async () => {
        render(<MarginBridgePage />);
        await screen.findByRole('cell', { name: 'Soybean Oil 1L' });

        expect(tile('Total change')).toHaveTextContent('৳ -1,000');
        expect(tile('Total change')).toHaveClass('text-red-600');
        expect(tile('Mix')).toHaveTextContent('৳ -300');

        fireEvent.click(chip(/^Main driver/));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Volume' }));

        await waitFor(() => expect(screen.queryByRole('cell', { name: 'Soybean Oil 1L' })).not.toBeInTheDocument());
        expect(tile('Total change')).toHaveTextContent('৳ 200');
        expect(tile('Mix')).toHaveTextContent('৳ 0');
    });
});
