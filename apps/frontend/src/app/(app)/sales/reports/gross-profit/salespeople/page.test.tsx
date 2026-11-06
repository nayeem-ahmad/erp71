'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GrossProfitBySalespersonPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/api', () => ({ api: { getGrossProfitBySalesperson: jest.fn() } }));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/gross-profit/salespeople',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));

const coverage = { costedLines: 3, uncostedLines: 0, costedRevenue: 9000, uncostedRevenue: 0, costedRevenuePct: 100 };

function api() {
    return require('@/lib/api').api;
}

describe('GrossProfitBySalespersonPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getGrossProfitBySalesperson.mockResolvedValue({
            summary: { groupBy: 'salesRep', netRevenue: 9000, cogs: 7000, grossProfit: 2000, grossMarginPct: 22.2, coverage },
            rows: [
                { id: 'e1', name: 'Rafiq', orders: 6, units: 20, revenue: 9000, cogs: 7000, grossProfit: 2000, grossMarginPct: 22.2, coverage },
            ],
        });
    });

    it('opens by sales rep and regroups from the Group by chip beside Columns', async () => {
        render(<GrossProfitBySalespersonPage />);
        await waitFor(() => expect(api().getGrossProfitBySalesperson).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'salesRep' })));
        expect(await screen.findByRole('cell', { name: 'Rafiq' })).toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'counter' } });

        await waitFor(() => expect(api().getGrossProfitBySalesperson).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: 'counter' })));
        expect(screen.getAllByText('Counter').length).toBeGreaterThan(0);
    });

    it('keeps a totals row', async () => {
        render(<GrossProfitBySalespersonPage />);
        await screen.findByRole('cell', { name: 'Rafiq' });
        expect(screen.getByText('Total')).toBeInTheDocument();
    });
});
