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
import SalesByProductPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSalesByProduct: jest.fn(),
        getProductGroups: jest.fn(),
        getProductSubgroups: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/reports/products',
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

describe('SalesByProductPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getSalesByProduct.mockResolvedValue({
            summary: { totalRevenue: 0, totalUnitsSold: 0, productCount: 0 },
            rows: [],
        });
        api.getProductGroups.mockResolvedValue([]);
        api.getProductSubgroups.mockResolvedValue([]);
    });

    it('renders the page heading', async () => {
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Sales by Product' })).toBeInTheDocument();
    });

    it('renders the DataTable with correct title', async () => {
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table-title')).toHaveTextContent('Product Performance');
        });
    });

    it('renders KPI cards for revenue, units sold, and products', async () => {
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getByText('Total Revenue')).toBeInTheDocument();
            expect(screen.getByText('Units Sold')).toBeInTheDocument();
            expect(screen.getByText('Products Sold')).toBeInTheDocument();
        });
    });

    it('renders group and subgroup filter dropdowns', async () => {
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('All Groups')).toBeInTheDocument();
            expect(screen.getByDisplayValue('All Subgroups')).toBeInTheDocument();
        });
    });

    it('renders date range inputs', async () => {
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toHaveLength(2);
        });
    });

    it('calls getSalesByProduct and filter APIs on mount', async () => {
        const { api } = require('@/lib/api');
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(api.getSalesByProduct).toHaveBeenCalled();
            expect(api.getProductGroups).toHaveBeenCalled();
            expect(api.getProductSubgroups).toHaveBeenCalled();
        });
    });

    it('shows empty message when no rows', async () => {
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getByTestId('empty-message')).toHaveTextContent('No sales recorded for this filter');
        });
    });

    it('populates group options from API', async () => {
        const { api } = require('@/lib/api');
        api.getProductGroups.mockResolvedValue([{ id: 'g1', name: 'Electronics' }]);
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getByText('Electronics')).toBeInTheDocument();
        });
    });

    it('handles getSalesByProduct error gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getSalesByProduct.mockRejectedValue(new Error('Server error'));
        render(<SalesByProductPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Sales by Product' })).toBeInTheDocument();
        });
    });
});
