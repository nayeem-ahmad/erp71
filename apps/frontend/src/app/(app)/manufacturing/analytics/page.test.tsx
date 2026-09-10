import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ManufacturingAnalyticsPage from './page';

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
    fetchAllPages: jest.fn(),
    api: { getProducts: jest.fn() },
}));

jest.mock('@/lib/format', () => ({
    formatDate: (d: string) => d,
    formatBDT: (n: number) => `৳${n}`,
}));

jest.mock('lucide-react', () => ({
    CheckCircle2: () => <span data-testid="icon-check" />,
    Package: () => <span data-testid="icon-package" />,
    Wallet: () => <span data-testid="icon-wallet" />,
    Calculator: () => <span data-testid="icon-calculator" />,
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
    TrendingUp: () => <span data-testid="icon-trending-up" />,
    TrendingDown: () => <span data-testid="icon-trending-down" />,
    AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
    Info: () => <span data-testid="icon-info" />,
    XCircle: () => <span data-testid="icon-xcircle" />,
    Loader2: () => <span data-testid="icon-loader" />,
}));

const mockFetchWithAuth = require('@/lib/api').fetchWithAuth as jest.Mock;

const emptyAnalytics = {
    totalCompletedJobs: 0,
    totalUnitsProduced: 0,
    totalMaterialCost: 0,
    avgUnitProductionCost: 0,
    jobs: [],
    volumeTrend: [],
};

describe('ManufacturingAnalyticsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchWithAuth.mockResolvedValue(emptyAnalytics);
    });

    it('renders the Analytics heading', async () => {
        render(<ManufacturingAnalyticsPage />);
        expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
        await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledWith('/manufacturing/analytics'));
    });

    it('shows an empty state when there are no completed jobs', async () => {
        render(<ManufacturingAnalyticsPage />);
        await waitFor(() => {
            expect(screen.getByText(/No completed production jobs yet/)).toBeInTheDocument();
        });
    });

    it('keeps the page header on screen while the report is loading', async () => {
        render(<ManufacturingAnalyticsPage />);
        // The report returns early for loading/error/empty; the header must not
        // go with it, or the breadcrumb trail vanishes on a slow request.
        expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
        expect(screen.getByText('Loading...')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    });

    it('shows an error when the analytics fetch fails', async () => {
        mockFetchWithAuth.mockRejectedValueOnce(new Error('Network error'));
        render(<ManufacturingAnalyticsPage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load manufacturing analytics')).toBeInTheDocument();
        });
    });

    it('shows KPI tiles, a volume trend, and a cost table', async () => {
        mockFetchWithAuth.mockResolvedValueOnce({
            totalCompletedJobs: 2,
            totalUnitsProduced: 30,
            totalMaterialCost: 156,
            avgUnitProductionCost: 5.2,
            jobs: [
                {
                    jobId: 'job-1',
                    productId: 'prod-1',
                    productName: 'Widget A',
                    productSku: 'WGT-001',
                    quantityProduced: 20,
                    plannedMaterialCost: 100,
                    wastageCost: 6,
                    actualMaterialCost: 106,
                    unitProductionCost: 5.3,
                    completedAt: '2026-07-01',
                },
            ],
            volumeTrend: [
                { date: '2026-07-01', quantityProduced: 20 },
                { date: '2026-07-02', quantityProduced: 10 },
            ],
        });
        render(<ManufacturingAnalyticsPage />);
        await waitFor(() => {
            expect(screen.getByText('Completed Jobs')).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
            expect(screen.getByText('Production Volume Trend')).toBeInTheDocument();
            expect(screen.getByText('Planned vs. Actual Material Cost')).toBeInTheDocument();
            expect(screen.getByText('Widget A')).toBeInTheDocument();
            expect(screen.getByText('WGT-001')).toBeInTheDocument();
        });
    });
});
