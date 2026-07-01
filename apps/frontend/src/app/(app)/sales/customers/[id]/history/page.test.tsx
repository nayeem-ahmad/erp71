import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useParams: jest.fn(() => ({ id: 'cust-1' })),
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    usePathname: jest.fn(() => '/test'),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCustomerHistory: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (val: number) => `৳${val.toFixed(2)}`,
    formatDate: (val: string) => val,
}));

import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const mockHistory = {
    customer: {
        id: 'cust-1',
        name: 'Rahim Ahmed',
        customer_code: 'CUST-001',
        segment_category: 'VIP',
        total_spent: '5000',
    },
    summary: {
        totalOrders: 10,
        totalSpent: 5000,
        avgOrderValue: 500,
        firstPurchase: '2024-01-01',
        lastPurchase: '2024-06-01',
        purchaseFrequencyDays: 15,
    },
    monthlyTotals: [
        { month: '2024-01', orders: 2, spent: 1000 },
        { month: '2024-02', orders: 3, spent: 1500 },
    ],
    topProducts: [
        { productId: 'p1', name: 'Rice 5kg', quantity: 20, totalValue: 2000, orderCount: 8 },
        { productId: 'p2', name: 'Oil 1L', quantity: 10, totalValue: 500, orderCount: 4 },
    ],
    transactions: [
        {
            id: 'sale-1',
            serial_number: 'SN-0001',
            created_at: '2024-05-10T10:00:00Z',
            amount_paid: '500',
            status: 'COMPLETED',
            items: [
                { id: 'item-1', quantity: 2, price_at_sale: '100', product: { name: 'Rice 5kg' } },
            ],
        },
        {
            id: 'sale-2',
            serial_number: 'SN-0002',
            created_at: '2024-06-01T11:00:00Z',
            amount_paid: '200',
            status: 'REFUNDED',
            items: [
                { id: 'item-2', quantity: 1, price_at_sale: '200', product: { name: 'Oil 1L' } },
            ],
        },
    ],
};

describe('PurchaseHistoryPage', () => {
    const mockPush = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
        (useParams as jest.Mock).mockReturnValue({ id: 'cust-1' });
    });

    it('shows loading state initially', async () => {
        let resolvePromise: (val: any) => void;
        const pending = new Promise((resolve) => { resolvePromise = resolve; });
        (api.getCustomerHistory as jest.Mock).mockReturnValue(pending);

        render(
            React.createElement(
                require('./page').default
            )
        );

        expect(screen.getByText(/Loading history/i)).toBeInTheDocument();
    });

    it('renders customer name and history after data loads', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rahim Ahmed' })).toBeInTheDocument());

        expect(screen.getByText('CUST-001')).toBeInTheDocument();
        expect(screen.getByText('VIP')).toBeInTheDocument();
        expect(screen.getAllByText('Purchase History').length).toBeGreaterThan(0);
    });

    it('renders summary cards', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rahim Ahmed' })).toBeInTheDocument());

        expect(screen.getByText('Total Orders')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
        expect(screen.getByText('Lifetime Spend')).toBeInTheDocument();
        expect(screen.getByText('Avg. Order Value')).toBeInTheDocument();
        expect(screen.getByText('Purchase Frequency')).toBeInTheDocument();
        expect(screen.getByText('every 15d')).toBeInTheDocument();
    });

    it('renders purchase timeline when first and last purchase dates exist', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText(/Purchase Timeline/i)).toBeInTheDocument());
    });

    it('renders monthly spending chart', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText(/Monthly Spending/i)).toBeInTheDocument());
        expect(screen.getByText('2024-01')).toBeInTheDocument();
        expect(screen.getByText('2024-02')).toBeInTheDocument();
    });

    it('renders top products section', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText(/Top Purchased Products/i)).toBeInTheDocument());
        expect(screen.getByText('Rice 5kg')).toBeInTheDocument();
        expect(screen.getByText('Oil 1L')).toBeInTheDocument();
        expect(screen.getByText('20 units')).toBeInTheDocument();
    });

    it('renders transaction list', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('SN-0001')).toBeInTheDocument());
        expect(screen.getByText('SN-0002')).toBeInTheDocument();
        expect(screen.getByText('COMPLETED')).toBeInTheDocument();
        expect(screen.getByText('REFUNDED')).toBeInTheDocument();
    });

    it('filters transactions by serial number on search', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('SN-0001')).toBeInTheDocument());

        const searchInput = screen.getByPlaceholderText(/Search by reference or product/i);
        fireEvent.change(searchInput, { target: { value: 'SN-0001' } });

        await waitFor(() => {
            expect(screen.getByText('SN-0001')).toBeInTheDocument();
            expect(screen.queryByText('SN-0002')).not.toBeInTheDocument();
        });
    });

    it('filters transactions by product name on search', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('SN-0001')).toBeInTheDocument());

        const searchInput = screen.getByPlaceholderText(/Search by reference or product/i);
        fireEvent.change(searchInput, { target: { value: 'Oil 1L' } });

        await waitFor(() => {
            expect(screen.queryByText('SN-0001')).not.toBeInTheDocument();
            expect(screen.getByText('SN-0002')).toBeInTheDocument();
        });
    });

    it('shows no transactions message when search matches nothing', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('SN-0001')).toBeInTheDocument());

        const searchInput = screen.getByPlaceholderText(/Search by reference or product/i);
        fireEvent.change(searchInput, { target: { value: 'ZZZZZZ' } });

        await waitFor(() => expect(screen.getByText(/No transactions found/i)).toBeInTheDocument());
    });

    it('navigates back when back button is clicked', async () => {
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rahim Ahmed' })).toBeInTheDocument());

        const backLink = screen.getByRole('link', { name: 'Rahim Ahmed' });
        expect(backLink).toHaveAttribute('href', '/sales/customers/cust-1');
    });

    it('shows "History not available" when data is null after load', async () => {
        (api.getCustomerHistory as jest.Mock).mockRejectedValue(new Error('Not found'));

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText(/History not available/i)).toBeInTheDocument());
    });

    it('renders purchase frequency as em dash when null', async () => {
        const dataWithNullFrequency = {
            ...mockHistory,
            summary: { ...mockHistory.summary, purchaseFrequencyDays: null },
        };
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(dataWithNullFrequency);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rahim Ahmed' })).toBeInTheDocument());
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('shows At-Risk segment color class', async () => {
        const atRiskData = {
            ...mockHistory,
            customer: { ...mockHistory.customer, segment_category: 'At-Risk' },
        };
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(atRiskData);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText('At-Risk')).toBeInTheDocument());
    });

    it('does not fetch when id is not present', async () => {
        (useParams as jest.Mock).mockReturnValue({});
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(mockHistory);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        expect(api.getCustomerHistory).not.toHaveBeenCalled();
    });

    it('handles items with no product name (Unknown Item)', async () => {
        const dataWithUnknownItem = {
            ...mockHistory,
            transactions: [
                {
                    id: 'sale-3',
                    serial_number: 'SN-0003',
                    created_at: '2024-06-05T10:00:00Z',
                    amount_paid: '100',
                    status: 'COMPLETED',
                    items: [
                        { id: 'item-3', quantity: 1, price_at_sale: '100', product: undefined },
                    ],
                },
            ],
        };
        (api.getCustomerHistory as jest.Mock).mockResolvedValue(dataWithUnknownItem);

        await act(async () => {
            render(React.createElement(require('./page').default));
        });

        await waitFor(() => expect(screen.getByText(/Unknown Item/i)).toBeInTheDocument());
    });
});
