'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConsolidatedReportPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getConsolidatedReport: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (n: number) => `৳${n}`,
    formatDate: (d: string) => d,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/consolidated',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

const mockReport = {
    period: { from: '2026-05-12', to: '2026-06-11' },
    overall: {
        revenue: 150000,
        transactions: 320,
        avg_order: 468.75,
        top_product: 'Widget A',
    },
    by_store: [
        {
            store_id: 'store1',
            store_name: 'Main Store',
            revenue: 90000,
            transactions: 200,
            avg_order: 450,
            revenue_share: 60,
        },
        {
            store_id: 'store2',
            store_name: 'Branch Store',
            revenue: 60000,
            transactions: 120,
            avg_order: 500,
            revenue_share: 40,
        },
    ],
};

const emptyReport = {
    period: { from: '2026-05-12', to: '2026-06-11' },
    overall: {
        revenue: 0,
        transactions: 0,
        avg_order: 0,
        top_product: null,
    },
    by_store: [],
};

describe('ConsolidatedReportPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(emptyReport);
    });

    it('renders the page heading', async () => {
        render(<ConsolidatedReportPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Consolidated Report' })).toBeInTheDocument();
    });

    it('renders the page description', async () => {
        render(<ConsolidatedReportPage />);
        await waitFor(() => {
            expect(
                screen.getByText('Cross-branch revenue and transaction overview'),
            ).toBeInTheDocument();
        });
    });

    it('calls getConsolidatedReport on mount with a default date range', async () => {
        const { api } = require('@/lib/api');
        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(api.getConsolidatedReport).toHaveBeenCalledTimes(1);
            expect(api.getConsolidatedReport).toHaveBeenCalledWith(
                expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
            );
        });
    });

    it('renders the Generate button', async () => {
        render(<ConsolidatedReportPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
        });
    });

    it('renders From and To date labels', async () => {
        render(<ConsolidatedReportPage />);
        await waitFor(() => {
            expect(screen.getByText('From')).toBeInTheDocument();
            expect(screen.getByText('To')).toBeInTheDocument();
        });
    });

    it('shows overall summary cards after loading with data', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Total Revenue')).toBeInTheDocument();
            expect(screen.getByText('Total Transactions')).toBeInTheDocument();
            expect(screen.getByText('Avg Order Value')).toBeInTheDocument();
            expect(screen.getByText('Top Product')).toBeInTheDocument();
        });
    });

    it('displays overall revenue formatted correctly', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('৳150000')).toBeInTheDocument();
        });
    });

    it('displays top product name when available', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
        });
    });

    it('displays a dash for top product when null', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(emptyReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('—')).toBeInTheDocument();
        });
    });

    it('shows Store Breakdown table with store rows when data is available', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Store Breakdown')).toBeInTheDocument();
            expect(screen.getAllByText('Main Store').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Branch Store').length).toBeGreaterThan(0);
        });
    });

    it('shows Revenue by Store bar chart section when data is available', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Revenue by Store')).toBeInTheDocument();
        });
    });

    it('shows the empty state when by_store is empty', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(emptyReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No sales data found')).toBeInTheDocument();
        });
    });

    it('shows an error message when the API call fails', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockRejectedValue(new Error('Server unavailable'));

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Server unavailable')).toBeInTheDocument();
        });
    });

    it('calls getConsolidatedReport again when Generate button is clicked', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(emptyReport);

        render(<ConsolidatedReportPage />);
        await waitFor(() => screen.getByRole('button', { name: /generate/i }));

        fireEvent.click(screen.getByRole('button', { name: /generate/i }));

        await waitFor(() => {
            expect(api.getConsolidatedReport).toHaveBeenCalledTimes(2);
        });
    });

    it('disables Generate button while loading', async () => {
        const { api } = require('@/lib/api');
        // Make it never resolve so we stay in loading state
        api.getConsolidatedReport.mockReturnValue(new Promise(() => {}));

        render(<ConsolidatedReportPage />);

        // The initial call triggers loading — check the button is disabled
        const button = screen.getByRole('button', { name: /loading/i });
        expect(button).toBeDisabled();
    });

    it('shows revenue_share percentage in the store breakdown table', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('60.0%')).toBeInTheDocument();
            expect(screen.getByText('40.0%')).toBeInTheDocument();
        });
    });

    it('shows transaction counts in the store breakdown table', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            // store1 has 200 transactions
            expect(screen.getByText('200')).toBeInTheDocument();
        });
    });
});
