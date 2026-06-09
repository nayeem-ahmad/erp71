'use client';
import { render, screen, waitFor } from '@testing-library/react';
import SalesPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('../../../lib/api', () => ({
    api: {
        getSales: jest.fn(),
    },
}));

const mockSales = [
    {
        id: 'sale-1',
        serial_number: 'SL-00001',
        created_at: '2026-03-20T10:00:00.000Z',
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

describe('SalesPage — Sales Transaction List', () => {
    beforeEach(() => {
        const { api } = require('../../../lib/api');
        api.getSales.mockResolvedValue(mockSales);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Sales page heading', async () => {
        render(<SalesPage />);
        expect(screen.getByText(/sales/i)).toBeInTheDocument();
    });

    it('displays sales loaded from the API', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getByText('SL-00001')).toBeInTheDocument();
            expect(screen.getByText('SL-00002')).toBeInTheDocument();
        });
    });

    it('shows customer name for sales with a customer', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        });
    });

    it('shows Walk-in for sales with no customer', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Walk-in')).toBeInTheDocument();
        });
    });

    it('displays item count for each sale', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getByText('2 items')).toBeInTheDocument();
            expect(screen.getByText('1 items')).toBeInTheDocument();
        });
    });

    it('displays formatted total amounts', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('৳ 55.00').length).toBeGreaterThan(0);
            expect(screen.getAllByText('৳ 20.00').length).toBeGreaterThan(0);
        });
    });

    it('renders COMPLETED status badge', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getByText('COMPLETED')).toBeInTheDocument();
        });
    });

    it('renders REFUNDED status badge', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getByText('REFUNDED')).toBeInTheDocument();
        });
    });

    it('shows payment method tags', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.getByText('CASH')).toBeInTheDocument();
            expect(screen.getByText('BKASH')).toBeInTheDocument();
        });
    });

    it('renders view action link to sale detail page', async () => {
        render(<SalesPage />);
        await waitFor(() => {
            const link = screen.getAllByRole('link').find(
                (l) => l.getAttribute('href') === '/dashboard/sales/sale-1',
            );
            expect(link).toBeDefined();
        });
    });

    it('shows empty state when no sales exist', async () => {
        const { api } = require('../../../lib/api');
        api.getSales.mockResolvedValue([]);

        render(<SalesPage />);
        await waitFor(() => {
            expect(screen.queryByText('SL-00001')).not.toBeInTheDocument();
        });
    });

    it('calls getSales on mount', async () => {
        const { api } = require('../../../lib/api');
        render(<SalesPage />);
        await waitFor(() => {
            expect(api.getSales).toHaveBeenCalledTimes(1);
        });
    });
});
