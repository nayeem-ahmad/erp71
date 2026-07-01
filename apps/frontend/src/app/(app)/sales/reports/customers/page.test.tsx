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
import SalesByCustomerPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSalesByCustomer: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/reports/customers',
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

describe('SalesByCustomerPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getSalesByCustomer.mockResolvedValue({
            summary: { totalRevenue: 0, totalOrders: 0, customerCount: 0, avgOrderValue: 0 },
            rows: [],
        });
    });

    it('renders the page heading', async () => {
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Customer-wise Sales Summary' })).toBeInTheDocument();
    });

    it('renders the DataTable with correct title', async () => {
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table-title')).toHaveTextContent('Customer Performance');
        });
    });

    it('renders all KPI cards', async () => {
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(screen.getByText('Total Revenue')).toBeInTheDocument();
            expect(screen.getByText('Total Orders')).toBeInTheDocument();
            expect(screen.getByText('Customers')).toBeInTheDocument();
            expect(screen.getByText('Avg Order Value')).toBeInTheDocument();
        });
    });

    it('renders date range filter inputs', async () => {
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toHaveLength(2);
        });
    });

    it('calls getSalesByCustomer on mount', async () => {
        const { api } = require('@/lib/api');
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(api.getSalesByCustomer).toHaveBeenCalledTimes(1);
        });
    });

    it('shows empty message when no rows', async () => {
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(screen.getByTestId('empty-message')).toHaveTextContent('No sales recorded in this period');
        });
    });

    it('renders summary totals from API', async () => {
        const { api } = require('@/lib/api');
        api.getSalesByCustomer.mockResolvedValue({
            summary: { totalRevenue: 100000, totalOrders: 25, customerCount: 8, avgOrderValue: 4000 },
            rows: [],
        });
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(screen.getByText('25')).toBeInTheDocument();
            expect(screen.getByText('8')).toBeInTheDocument();
        });
    });

    it('handles API errors gracefully without crashing', async () => {
        const { api } = require('@/lib/api');
        api.getSalesByCustomer.mockRejectedValue(new Error('Unauthorized'));
        render(<SalesByCustomerPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Customer-wise Sales Summary' })).toBeInTheDocument();
        });
    });
});
