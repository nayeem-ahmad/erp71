'use client';
jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
      locale: 'en',
    }),
    formatMessage: (template, values = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
      ),
  };
}, { virtual: true });


import { render, screen, waitFor } from '@testing-library/react';
import SalesSummaryPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSalesSummary: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/reports/summary',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ title, emptyMessage, isLoading }: { title: string; emptyMessage: string; isLoading: boolean }) => (
        <div>
            <div data-testid="data-table-title">{title}</div>
            {isLoading && <div data-testid="loading-indicator">Loading</div>}
            <div data-testid="empty-message">{emptyMessage}</div>
        </div>
    ),
}));

describe('SalesSummaryPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getSalesSummary.mockResolvedValue({
            summary: {
                totalRevenue: 0,
                totalReturns: 0,
                netRevenue: 0,
                transactionCount: 0,
                avgOrderValue: 0,
            },
            rows: [],
        });
    });

    it('renders the page heading', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Sales Summary' })).toBeInTheDocument();
    });

    it('renders the DataTable with correct title', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table-title')).toHaveTextContent('Daily Breakdown');
        });
    });

    it('renders date range inputs', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => {
            expect(screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toHaveLength(2);
        });
    });

    it('displays summary KPI cards', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => {
            expect(screen.getByText('Gross Revenue')).toBeInTheDocument();
            expect(screen.getByText('Returns')).toBeInTheDocument();
            expect(screen.getByText('Net Revenue')).toBeInTheDocument();
            expect(screen.getByText('Transactions')).toBeInTheDocument();
            expect(screen.getByText('Avg Order Value')).toBeInTheDocument();
        });
    });

    it('calls getSalesSummary on mount', async () => {
        const { api } = require('@/lib/api');
        render(<SalesSummaryPage />);
        await waitFor(() => {
            expect(api.getSalesSummary).toHaveBeenCalledTimes(1);
        });
    });

    it('renders summary data when provided', async () => {
        const { api } = require('@/lib/api');
        api.getSalesSummary.mockResolvedValue({
            summary: {
                totalRevenue: 50000,
                totalReturns: 2000,
                netRevenue: 48000,
                transactionCount: 10,
                avgOrderValue: 5000,
            },
            rows: [
                { date: '2026-06-01', transactions: 3, grossRevenue: 15000, returns: 500, netRevenue: 14500 },
            ],
        });
        render(<SalesSummaryPage />);
        await waitFor(() => {
            expect(screen.getByText('10')).toBeInTheDocument();
        });
    });

    it('shows empty message when no rows', async () => {
        render(<SalesSummaryPage />);
        await waitFor(() => {
            expect(screen.getByTestId('empty-message')).toHaveTextContent('No sales recorded in this period');
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getSalesSummary.mockRejectedValue(new Error('Network error'));
        render(<SalesSummaryPage />);
        // Page should not crash
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Sales Summary' })).toBeInTheDocument();
        });
    });
});
