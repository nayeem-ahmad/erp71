'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MonthlySalesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getMonthlySalesByCustomer: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/sales/reports/monthly',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockMonthlyData = {
    months: ['2026-01', '2026-02', '2026-03'],
    rows: [
        {
            customer: { id: 'cust-1', name: 'Alice Rahman', phone: '01700000001' },
            total: 45000,
            monthly: [
                { month: '2026-01', revenue: 15000, orderCount: 2 },
                { month: '2026-02', revenue: 20000, orderCount: 3 },
                { month: '2026-03', revenue: 10000, orderCount: 1 },
            ],
        },
        {
            customer: { id: null, name: 'Walk-in Customer', phone: null },
            total: 12000,
            monthly: [
                { month: '2026-01', revenue: 5000, orderCount: 1 },
                { month: '2026-02', revenue: 7000, orderCount: 2 },
                { month: '2026-03', revenue: 0, orderCount: 0 },
            ],
        },
    ],
};

describe('MonthlySalesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getMonthlySalesByCustomer.mockResolvedValue(mockMonthlyData);
    });

    it('renders the page heading', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByText('Monthly Sales by Customer')).toBeInTheDocument();
    });

    it('renders the subtitle', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Month-by-month revenue breakdown per customer')).toBeInTheDocument();
        });
    });

    it('calls getMonthlySalesByCustomer on mount', async () => {
        const { api } = require('@/lib/api');
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(api.getMonthlySalesByCustomer).toHaveBeenCalledTimes(1);
        });
    });

    it('renders date range inputs', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toHaveLength(2);
        });
    });

    it('renders customer names in the table', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Rahman')).toBeInTheDocument();
            expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
        });
    });

    it('renders customer phone numbers', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('01700000001')).toBeInTheDocument();
        });
    });

    it('renders table headers with month labels', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            // Month headers are formatted as e.g. "Jan '26"
            expect(screen.getByText(/Jan/i)).toBeInTheDocument();
        });
    });

    it('renders the Total column header', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Total').length).toBeGreaterThan(0);
        });
    });

    it('shows empty state when no rows', async () => {
        const { api } = require('@/lib/api');
        api.getMonthlySalesByCustomer.mockResolvedValue({ months: [], rows: [] });
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('No sales recorded in this period')).toBeInTheDocument();
        });
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getMonthlySalesByCustomer.mockImplementation(() => new Promise(() => {}));
        render(<MonthlySalesPage />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows error message on API failure', async () => {
        const { api } = require('@/lib/api');
        api.getMonthlySalesByCustomer.mockRejectedValue(new Error('Server error'));
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('Server error')).toBeInTheDocument();
        });
    });

    it('renders date inputs', async () => {
        const { api } = require('@/lib/api');
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(api.getMonthlySalesByCustomer).toHaveBeenCalled();
        });
        const dateInputs = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
        expect(dateInputs.length).toBeGreaterThanOrEqual(1);
    });

    it('renders From and To labels', async () => {
        render(<MonthlySalesPage />);
        await waitFor(() => {
            expect(screen.getByText('From')).toBeInTheDocument();
            expect(screen.getByText('To')).toBeInTheDocument();
        });
    });
});
