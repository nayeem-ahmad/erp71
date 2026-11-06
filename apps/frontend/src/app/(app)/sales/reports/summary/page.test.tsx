'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SalesSummaryPage from './page';
import { mockBranchScope, resetToHeaderSpy } from '@/test-utils/branch-scope';
import { createdRangeFromPreset } from '@/lib/created-range';

jest.mock('@/lib/api', () => ({
    api: {
        getSalesSummary: jest.fn(),
        aiNarrateReport: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/summary',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const ROWS = [
    { date: '2026-05-31', transactions: 2, grossRevenue: 3000, returns: 0, netRevenue: 3000 },
    { date: '2026-06-01', transactions: 3, grossRevenue: 15000, returns: 500, netRevenue: 14500 },
    { date: '2026-06-02', transactions: 5, grossRevenue: 32000, returns: 1500, netRevenue: 30500 },
];

function api() {
    return require('@/lib/api').api;
}

function strip() {
    return within(screen.getByRole('region', { name: 'Report figures' }));
}

/** The figure on a strip tile, by its label. */
function tile(label: string) {
    return strip().getByText(label).nextElementSibling?.textContent;
}

describe('SalesSummaryPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getSalesSummary.mockResolvedValue({ summary: {}, rows: ROWS });
    });

    it('renders the heading and the daily breakdown', async () => {
        render(<SalesSummaryPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Sales Summary' })).toBeInTheDocument();
        expect(await screen.findByText('2026-06-02')).toBeInTheDocument();
    });

    it('opens on the last 30 days, read from the Period chip', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => expect(api().getSalesSummary).toHaveBeenCalledTimes(1));
        const { from, to } = createdRangeFromPreset('last30');
        expect(api().getSalesSummary).toHaveBeenCalledWith({ storeId: 'store-1', from, to });
        expect(screen.queryAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toHaveLength(0);
    });

    it('adds up the strip and the totals row from the rows it shows', async () => {
        render(<SalesSummaryPage />);
        await screen.findByText('2026-06-02');

        expect(tile('Transactions')).toBe('10');
        expect(tile('Net Revenue')).toBe('৳ 48,000');
        expect(tile('Returns')).toBe('৳ 2,000');
        // Gross over transactions: 50,000 / 10.
        expect(tile('Avg Order Value')).toBe('৳ 5,000');
        expect(screen.getByText('Total')).toBeInTheDocument();
        expect(screen.getByText('৳ 48,000.00')).toBeInTheDocument();
    });

    it('narrows to the days with returns, and the strip follows', async () => {
        render(<SalesSummaryPage />);
        await screen.findByText('2026-05-31');

        fireEvent.click(screen.getByRole('button', { name: 'With returns' }));

        await waitFor(() => expect(screen.queryByText('2026-05-31')).not.toBeInTheDocument());
        expect(tile('Transactions')).toBe('8');
    });

    it('rolls the days up into months', async () => {
        render(<SalesSummaryPage />);
        await screen.findByText('2026-06-02');

        fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'month' } });

        expect(await screen.findByText('Jun 2026')).toBeInTheDocument();
        expect(screen.getByText('May 2026')).toBeInTheDocument();
        expect(screen.queryByText('2026-06-02')).not.toBeInTheDocument();
        // Still the same period: grouping is done here, not asked of the server.
        expect(api().getSalesSummary).toHaveBeenCalledTimes(1);
    });

    it('refetches when the period changes', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => expect(api().getSalesSummary).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getAllByRole('button', { name: /^Period/ }).find((b) => b.getAttribute('aria-haspopup') === 'dialog')!);
        fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

        await waitFor(() => expect(api().getSalesSummary).toHaveBeenCalledTimes(2));
        expect(api().getSalesSummary).toHaveBeenLastCalledWith(expect.objectContaining(createdRangeFromPreset('last7')));
    });

    it('handles an API error without crashing', async () => {
        api().getSalesSummary.mockRejectedValue(new Error('Network error'));
        render(<SalesSummaryPage />);
        await waitFor(() => expect(api().getSalesSummary).toHaveBeenCalled());
        expect(screen.getByRole('heading', { name: 'Sales Summary' })).toBeInTheDocument();
        expect(await screen.findByText('No sales recorded in this period')).toBeInTheDocument();
    });

    it('asks for the header branch, then the one picked in the filter', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => expect(api().getSalesSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' })));

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'all' } });

        await waitFor(() => expect(api().getSalesSummary).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'all' })));
    });

    it('goes back to the header branch when the server refuses the chosen one', async () => {
        api().getSalesSummary.mockImplementation(async ({ storeId }: { storeId?: string }) => {
            if (storeId === 'store-2') throw Object.assign(new Error('Forbidden'), { status: 403 });
            return { summary: null, rows: [] };
        });
        render(<SalesSummaryPage />);
        await waitFor(() => expect(api().getSalesSummary).toHaveBeenCalled());

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'store-2' } });

        await waitFor(() => expect(resetToHeaderSpy).toHaveBeenCalled());
    });

    it('narrates the figures the page shows', async () => {
        api().aiNarrateReport.mockResolvedValue({ narration: 'Sales rose through June.' });
        render(<SalesSummaryPage />);
        await screen.findByText('2026-06-02');

        fireEvent.click(screen.getByRole('button', { name: 'AI Narrate' }));

        expect(await screen.findByText('Sales rose through June.')).toBeInTheDocument();
        expect(api().aiNarrateReport.mock.calls[0][0].reportData).toMatchObject({ netRevenue: 48000, transactionCount: 10 });
    });
});
