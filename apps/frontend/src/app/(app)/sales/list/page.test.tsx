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
import SalesListPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getSales: jest.fn(),
        getSalesSettings: jest.fn().mockResolvedValue({ pos_enabled: true }),
    },
}));

const mockSales = [
    {
        id: 'sale-1',
        serial_number: 'SL-00001',
        created_at: '2026-03-20T10:00:00.000Z',
        sale_date: '2026-01-05T12:00:00.000Z',
        items: [{ id: 'item-1' }, { id: 'item-2' }],
        total_amount: '55.00',
        amount_paid: '55.00',
        status: 'COMPLETED',
        payments: [{ payment_method: 'CASH', amount: '55.00' }],
        customer: { name: 'Alice Smith' },
    },
    {
        id: 'sale-2',
        serial_number: 'SL-00002',
        created_at: '2026-03-21T11:00:00.000Z',
        items: [{ id: 'item-3' }],
        total_amount: '20.00',
        amount_paid: '20.00',
        status: 'REFUNDED',
        payments: [{ payment_method: 'BKASH', amount: '20.00' }],
        customer: undefined,
    },
];

describe('SalesListPage — Sales Transaction List', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getSales.mockResolvedValue(mockSales);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Sales page heading', async () => {
        render(<SalesListPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument();
    });

    it('displays sales loaded from the API', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('SL-00001')).toBeInTheDocument();
            expect(screen.getByText('SL-00002')).toBeInTheDocument();
        });
    });

    it('shows customer name for sales with a customer', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        });
    });

    it('shows Walk-in for sales with no customer', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Walk-in')).toBeInTheDocument();
        });
    });

    it('displays item count for each sale', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('2 items')).toBeInTheDocument();
            expect(screen.getByText('1 items')).toBeInTheDocument();
        });
    });

    it('displays formatted total amounts', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getAllByText('৳ 55.00').length).toBeGreaterThan(0);
            expect(screen.getAllByText('৳ 20.00').length).toBeGreaterThan(0);
        });
    });

    it('renders COMPLETED status badge', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Completed')).toBeInTheDocument();
        });
    });

    it('renders REFUNDED status badge', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('Refunded')).toBeInTheDocument();
        });
    });

    it('shows payment method tags', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.getByText('CASH')).toBeInTheDocument();
            expect(screen.getByText('BKASH')).toBeInTheDocument();
        });
    });

    it('renders view action link to sale detail page', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            const link = screen.getAllByRole('link').find(
                (l) => l.getAttribute('href') === '/sales/sale-1',
            );
            expect(link).toBeDefined();
        });
    });

    it('shows empty state when no sales exist', async () => {
        const { api } = require('@/lib/api');
        api.getSales.mockResolvedValue([]);

        render(<SalesListPage />);
        await waitFor(() => {
            expect(screen.queryByText('SL-00001')).not.toBeInTheDocument();
        });
    });

    it('calls getSales on mount', async () => {
        const { api } = require('@/lib/api');
        render(<SalesListPage />);
        await waitFor(() => {
            expect(api.getSales).toHaveBeenCalledTimes(1);
        });
    });

    it('displays the sale_date (not created_at) in the Date column', async () => {
        render(<SalesListPage />);
        await waitFor(() => {
            // sale_date is 2026-01-05; created_at is 2026-03-20 — the list must show the sale_date.
            expect(screen.getByText('05/01/2026')).toBeInTheDocument();
            expect(screen.queryByText('20/03/2026')).not.toBeInTheDocument();
        });
    });

    it('shows a New Sales Entry action linking to /sales/new (not POS)', async () => {
        render(<SalesListPage />);
        const link = await screen.findByRole('link', { name: /new sales entry/i });
        expect(link).toHaveAttribute('href', '/sales/new');
        expect(screen.queryByRole('link', { name: /^POS$/i })).toBeNull();
    });
});
