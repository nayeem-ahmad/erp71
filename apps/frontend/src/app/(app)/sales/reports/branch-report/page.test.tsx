'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import BranchReportPage from './page';
import { mockBranchScope, resetToHeaderSpy } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('@/lib/api', () => ({
    api: {
        getBranchReport: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    ...jest.requireActual('@/lib/format'),
    formatBDT: (n: number) => `৳${n}`,
    formatDate: (d: string) => d,
}));

// A wide screen, so the chips sit in the toolbar and every column is drawn.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

/** A toolbar chip: a button that opens its own panel. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

/** The figure (and its hint) beside a label in the summary strip. */
function stat(label: string): string {
    const strip = screen.getByRole('region', { name: 'Branch summary' });
    return within(strip).getByText(label).nextElementSibling?.textContent ?? '';
}

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/branch-report',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

const mockStores = [
    { id: 'store1', name: 'Main Store' },
    { id: 'store2', name: 'North Branch' },
];

const mockReport = {
    store: { id: 'store1', name: 'Main Store' },
    period: { from: '2026-05-12', to: '2026-06-11' },
    summary: {
        revenue: 90000,
        transactions: 200,
        returns: 5000,
        net_revenue: 85000,
        avg_order: 450,
    },
    company_comparison: {
        company_revenue: 150000,
        company_transactions: 320,
        revenue_share: 60,
    },
    top_products: [
        { name: 'Widget A', unitsSold: 50, revenue: 25000 },
        { name: 'Gadget B', unitsSold: 30, revenue: 15000 },
    ],
    daily: [
        { date: '2026-06-01', transactions: 10, gross_revenue: 4500, returns: 0, net_revenue: 4500 },
        { date: '2026-06-02', transactions: 8, gross_revenue: 3600, returns: 200, net_revenue: 3400 },
    ],
};

const mockEmptyReport = {
    store: { id: 'store1', name: 'Main Store' },
    period: { from: '2026-05-12', to: '2026-06-11' },
    summary: {
        revenue: 0,
        transactions: 0,
        returns: 0,
        net_revenue: 0,
        avg_order: 0,
    },
    company_comparison: {
        company_revenue: 0,
        company_transactions: 0,
        revenue_share: 0,
    },
    top_products: [],
    daily: [],
};

describe('BranchReportPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope({ branches: mockStores, headerBranchId: 'store1', value: 'store1' });
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockEmptyReport);
    });

    it('renders the page heading', async () => {
        render(<BranchReportPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Branch Report' })).toBeInTheDocument();
    });

    it('renders the page description', async () => {
        render(<BranchReportPage />);
        await waitFor(() => {
            expect(
                screen.getByText('Detailed sales performance for a single branch'),
            ).toBeInTheDocument();
        });
    });

    it('offers one branch at a time, never All branches', async () => {
        render(<BranchReportPage />);

        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Branch' })).toBeInTheDocument());
        expect(screen.queryByRole('option', { name: 'All branches' })).not.toBeInTheDocument();
    });

    it('renders store selector with loaded stores', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByRole('option', { name: 'Main Store' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'North Branch' })).toBeInTheDocument();
        });
    });

    it('opens on the header branch rather than the first one', async () => {
        const { api } = require('@/lib/api');
        mockBranchScope({ branches: mockStores, headerBranchId: 'store2', value: 'store2' });
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(api.getBranchReport).toHaveBeenCalledWith(
                expect.objectContaining({ storeId: 'store2' }),
            );
        });
        expect(api.getBranchReport).not.toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store1' }));
    });

    it('fetches the branch picked in the filter', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);
        await waitFor(() => expect(api.getBranchReport).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store1' })));

        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'store2' } });

        await waitFor(() =>
            expect(api.getBranchReport).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'store2' })),
        );
    });

    it('goes back to the header branch when the server refuses the chosen one', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockImplementation(async ({ storeId }: { storeId: string }) => {
            if (storeId === 'store2') throw Object.assign(new Error('Forbidden'), { status: 403 });
            return mockReport;
        });

        render(<BranchReportPage />);
        await waitFor(() => expect(api.getBranchReport).toHaveBeenCalled());
        fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'store2' } });

        await waitFor(() => expect(resetToHeaderSpy).toHaveBeenCalled());
        expect(screen.queryByText('Forbidden')).not.toBeInTheDocument();
    });

    it('opens on the last 30 days, and reloads when a period preset is picked', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);
        await waitFor(() =>
            expect(api.getBranchReport).toHaveBeenCalledWith(
                expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
            ),
        );
        const [{ from, to }] = api.getBranchReport.mock.calls[0];
        expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(29);
        api.getBranchReport.mockClear();

        fireEvent.click(chip(/^Period/));
        fireEvent.click(screen.getByRole('button', { name: 'This year' }));

        await waitFor(() =>
            expect(api.getBranchReport).toHaveBeenLastCalledWith(
                expect.objectContaining({ storeId: 'store1', from: expect.stringMatching(/-01-01$/) }),
            ),
        );
    });

    it('has no date boxes or Generate button of its own any more', async () => {
        render(<BranchReportPage />);
        await waitFor(() => expect(chip(/^Period/)).toBeInTheDocument());

        expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
        expect(screen.queryByText('From')).not.toBeInTheDocument();
    });

    it('shows the branch figures in the summary strip', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => expect(stat('Branch Revenue')).toContain('৳90000'));
        expect(stat('Branch Revenue')).toMatch(/60\.0% of company/);
        expect(stat('Transactions')).toMatch(/200.*of 320 total/);
        expect(stat('Avg Order Value')).toContain('৳450');
        expect(stat('Returns')).toContain('৳5000');
        expect(stat('Net Revenue')).toContain('৳85000');
        expect(stat('Revenue Share')).toMatch(/60\.0%.*of ৳150000 total/);
    });

    it('lists each day with a total row', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('2026-06-01')).toBeInTheDocument();
            expect(screen.getByText('2026-06-02')).toBeInTheDocument();
        });
        const footer = screen.getAllByRole('rowgroup').find((group) => group.tagName === 'TFOOT')!;
        expect(footer).toHaveTextContent('Total');
        expect(footer).toHaveTextContent('18');
        expect(footer).toHaveTextContent('৳7900');
    });

    it('rolls the days up by month from the Group by chip', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);
        await screen.findByText('2026-06-01');

        fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'month' } });

        await waitFor(() => expect(screen.queryByText('2026-06-01')).not.toBeInTheDocument());
        expect(screen.getByText('2026-06')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Month/ })).toBeInTheDocument();
    });

    it('rolls the days up into ISO weeks', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);
        await screen.findByText('2026-06-01');

        fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'week' } });

        // 1 and 2 June 2026 are a Monday and a Tuesday: one week, starting the 1st.
        await waitFor(() => expect(screen.queryByText('2026-06-02')).not.toBeInTheDocument());
        expect(screen.getByText('2026-06-01')).toBeInTheDocument();
    });

    it('shows the empty state when there are no daily rows', async () => {
        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No daily data')).toBeInTheDocument();
        });
    });

    it('shows Top Products table with product rows', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Top Products' })).toBeInTheDocument();
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('Gadget B')).toBeInTheDocument();
        });
    });

    it('shows empty state for Top Products when list is empty', async () => {
        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No sales data')).toBeInTheDocument();
        });
    });

    it('shows an error message when getBranchReport fails', async () => {
        const { api } = require('@/lib/api');
        api.getBranchReport.mockRejectedValue(new Error('Report failed to load'));

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Report failed to load')).toBeInTheDocument();
        });
    });

    it('says there is no branch when the member has none', async () => {
        mockBranchScope({ branches: [], headerBranchId: null, value: '', hidden: true });

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No stores found')).toBeInTheDocument();
        });
    });
});
