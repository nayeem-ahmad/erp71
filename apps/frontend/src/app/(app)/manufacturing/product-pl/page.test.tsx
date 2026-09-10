import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ManufacturingProductPLPage from './page';

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

const emptyReport = {
    products: [],
    totals: {
        quantityProduced: 0,
        totalProductionCost: 0,
        revenue: 0,
        grossProfit: 0,
    },
};

const sampleReport = {
    products: [
        {
            productId: 'prod-1',
            productName: 'Widget A',
            productSku: 'WGT-001',
            jobsCompleted: 2,
            quantityProduced: 30,
            unitsSold: 25,
            avgCostPerUnit: 5.2,
            totalProductionCost: 156,
            revenue: 250,
            grossProfit: 120,
            grossMarginPct: 48,
        },
        {
            productId: 'prod-2',
            productName: 'Widget B',
            productSku: null,
            jobsCompleted: 1,
            quantityProduced: 5,
            unitsSold: 1,
            avgCostPerUnit: 20,
            totalProductionCost: 100,
            revenue: 15,
            grossProfit: -5,
            grossMarginPct: -33.3,
        },
    ],
    totals: {
        quantityProduced: 35,
        totalProductionCost: 256,
        revenue: 265,
        grossProfit: 115,
    },
};

describe('ManufacturingProductPLPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchWithAuth.mockResolvedValue(emptyReport);
    });

    it('renders the Product P&L heading', async () => {
        render(<ManufacturingProductPLPage />);
        expect(screen.getByRole('heading', { name: 'Product P&L' })).toBeInTheDocument();
        await waitFor(() =>
            expect(mockFetchWithAuth).toHaveBeenCalledWith('/manufacturing/reports/product-pl'),
        );
    });

    it('shows an empty state when no job has been completed', async () => {
        render(<ManufacturingProductPLPage />);
        await waitFor(() => {
            expect(screen.getByText('No completed production jobs yet.')).toBeInTheDocument();
        });
    });

    it('keeps the page header on screen while the report is loading', async () => {
        render(<ManufacturingProductPLPage />);
        expect(screen.getByRole('heading', { name: 'Product P&L' })).toBeInTheDocument();
        expect(screen.getByText('Loading...')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    });

    it('shows an error when the report fetch fails', async () => {
        mockFetchWithAuth.mockRejectedValueOnce(new Error('Network error'));
        render(<ManufacturingProductPLPage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load the product P&L report')).toBeInTheDocument();
        });
    });

    it('shows totals tiles and a row per product', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(sampleReport);
        render(<ManufacturingProductPLPage />);
        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
        });
        expect(screen.getByText('WGT-001')).toBeInTheDocument();
        expect(screen.getByText('Widget B')).toBeInTheDocument();
        // Totals row: quantity produced is a plain count, the rest are money.
        expect(screen.getByText('35')).toBeInTheDocument();
        expect(screen.getByText('৳265')).toBeInTheDocument();
        expect(screen.getByText('48.0%')).toBeInTheDocument();
    });

    it('marks a loss-making product in the danger colour', async () => {
        mockFetchWithAuth.mockResolvedValueOnce(sampleReport);
        render(<ManufacturingProductPLPage />);
        await waitFor(() => screen.getByText('Widget B'));
        // Widget B sold one unit of a five-unit run: the negative gross profit
        // has to read as a loss, not as just another number in the column.
        expect(screen.getByText('৳-5')).toHaveClass('text-danger');
        expect(screen.getByText('-33.3%')).toHaveClass('text-danger');
    });
});
