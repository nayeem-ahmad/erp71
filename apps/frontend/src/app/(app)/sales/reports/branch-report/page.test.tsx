'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BranchReportPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getStores: jest.fn(),
        getBranchReport: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (n: number) => `৳${n}`,
    formatDate: (d: string) => d,
}));

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
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue([]);
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

    it('calls getStores on mount', async () => {
        const { api } = require('@/lib/api');
        render(<BranchReportPage />);

        await waitFor(() => {
            expect(api.getStores).toHaveBeenCalledTimes(1);
        });
    });

    it('renders store selector with loaded stores', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Main Store')).toBeInTheDocument();
            expect(screen.getByText('North Branch')).toBeInTheDocument();
        });
    });

    it('auto-selects first store and fetches report on mount', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(api.getBranchReport).toHaveBeenCalledWith(
                expect.objectContaining({ storeId: 'store1' }),
            );
        });
    });

    it('renders the Generate button', async () => {
        render(<BranchReportPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
        });
    });

    it('renders From and To date labels', async () => {
        render(<BranchReportPage />);
        await waitFor(() => {
            expect(screen.getByText('From')).toBeInTheDocument();
            expect(screen.getByText('To')).toBeInTheDocument();
        });
    });

    it('shows KPI cards after loading report data', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Branch Revenue')).toBeInTheDocument();
            expect(screen.getByText('Transactions')).toBeInTheDocument();
            expect(screen.getByText('Avg Order Value')).toBeInTheDocument();
            expect(screen.getByText('Returns')).toBeInTheDocument();
        });
    });

    it('displays formatted branch revenue', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            // revenue = 90000 → formatBDT returns ৳90000
            expect(screen.getByText('৳90000')).toBeInTheDocument();
        });
    });

    it('shows revenue_share sub-label on Branch Revenue card', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('60.0% of company')).toBeInTheDocument();
        });
    });

    it('shows Top Products table with product rows', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Top Products')).toBeInTheDocument();
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('Gadget B')).toBeInTheDocument();
        });
    });

    it('shows empty state for Top Products when list is empty', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockEmptyReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No sales data')).toBeInTheDocument();
        });
    });

    it('shows Daily Breakdown table with daily rows', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Daily Breakdown')).toBeInTheDocument();
            expect(screen.getByText('2026-06-01')).toBeInTheDocument();
            expect(screen.getByText('2026-06-02')).toBeInTheDocument();
        });
    });

    it('shows empty state for Daily Breakdown when list is empty', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockEmptyReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No daily data')).toBeInTheDocument();
        });
    });

    it('shows Branch vs Company Revenue comparison section', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Branch vs Company Revenue')).toBeInTheDocument();
            expect(screen.getByText('All Branches')).toBeInTheDocument();
        });
    });

    it('calls getBranchReport with new dates when Generate is clicked', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);
        // Wait for auto-fetch triggered by store selection
        await waitFor(() => expect(api.getBranchReport).toHaveBeenCalled());
        api.getBranchReport.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /generate/i }));

        await waitFor(() => {
            expect(api.getBranchReport).toHaveBeenCalledTimes(1);
        });
    });

    it('shows an error message when getBranchReport fails', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockRejectedValue(new Error('Report failed to load'));

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Report failed to load')).toBeInTheDocument();
        });
    });

    it('shows "No stores found" option when stores list is empty', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue([]);

        render(<BranchReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No stores found')).toBeInTheDocument();
        });
    });

    it('disables Generate button while loading', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        // Never-resolving promise keeps loading state active
        api.getBranchReport.mockReturnValue(new Promise(() => {}));

        render(<BranchReportPage />);

        await waitFor(() => {
            const button = screen.getByRole('button', { name: /loading/i });
            expect(button).toBeDisabled();
        });
    });

    it('shows store name badge in report content area', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            // The store badge shows the selected store name
            const badges = screen.getAllByText('Main Store');
            expect(badges.length).toBeGreaterThan(0);
        });
    });

    it('shows total transactions sub-label on Transactions card', async () => {
        const { api } = require('@/lib/api');
        api.getStores.mockResolvedValue(mockStores);
        api.getBranchReport.mockResolvedValue(mockReport);

        render(<BranchReportPage />);

        await waitFor(() => {
            // company_transactions = 320
            expect(screen.getByText('of 320 total')).toBeInTheDocument();
        });
    });
});
