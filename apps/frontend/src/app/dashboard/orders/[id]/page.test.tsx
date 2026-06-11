import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OrderDetailsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getOrder: jest.fn(),
        updateOrderStatus: jest.fn(),
        addOrderDeposit: jest.fn(),
        updateOrder: jest.fn(),
        getCustomers: jest.fn(),
        getProducts: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (n: number) => `৳${n.toFixed(2)}`,
    formatDate: (d: string) => d,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/dashboard/orders/test-order-1',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({ id: 'test-order-1' }),
}));

jest.mock('lucide-react', () => ({
    ArrowLeft: () => <span data-testid="icon-arrow-left" />,
    Package: () => <span data-testid="icon-package" />,
    DollarSign: () => <span data-testid="icon-dollar" />,
    Printer: () => <span data-testid="icon-printer" />,
    Save: () => <span data-testid="icon-save" />,
    Pencil: () => <span data-testid="icon-pencil" />,
    X: () => <span data-testid="icon-x" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Search: () => <span data-testid="icon-search" />,
    PackageCheck: () => <span data-testid="icon-package-check" />,
}));

const mockOrder = {
    id: 'test-order-1',
    order_number: 'ORD-001',
    status: 'DRAFT',
    payment_status: 'UNPAID',
    total_amount: '5000',
    amount_paid: '0',
    created_at: '2026-01-01T10:00:00Z',
    customer: {
        name: 'John Doe',
        phone: '01711111111',
    },
    customer_id: 'cust-1',
    delivery_date: '2026-01-10',
    items: [
        {
            id: 'item-1',
            product_id: 'prod-1',
            product: { name: 'Widget A', sku: 'WID-001' },
            quantity: 2,
            price_at_order: '2500',
        },
    ],
    deposits: [],
};

describe('OrderDetailsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue(mockOrder);
        api.getCustomers.mockResolvedValue([]);
        api.getProducts.mockResolvedValue([]);
        api.updateOrderStatus.mockResolvedValue({});
        api.addOrderDeposit.mockResolvedValue({});
        api.updateOrder.mockResolvedValue({});
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockReturnValue(new Promise(() => {}));
        render(<OrderDetailsPage />);
        expect(screen.getByText('Loading order...')).toBeInTheDocument();
    });

    it('renders order number after loading', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ORD-001');
        });
    });

    it('renders order status badge', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getAllByText('DRAFT').length).toBeGreaterThan(0);
        });
    });

    it('renders order items table', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText('Widget A')).toBeInTheDocument();
        });
    });

    it('renders financial summary cards', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText('Total Amount')).toBeInTheDocument();
            expect(screen.getByText('Amount Due')).toBeInTheDocument();
            expect(screen.getByText('Payment')).toBeInTheDocument();
        });
    });

    it('shows Confirm Order button for DRAFT orders', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
        });
    });

    it('shows Start Processing button for CONFIRMED orders', async () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue({ ...mockOrder, status: 'CONFIRMED' });
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /start processing/i })).toBeInTheDocument();
        });
    });

    it('shows Mark Delivered button for PROCESSING orders', async () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue({ ...mockOrder, status: 'PROCESSING' });
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /mark delivered/i })).toBeInTheDocument();
        });
    });

    it('shows customer name in customer details section', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText('John Doe')).toBeInTheDocument();
            expect(screen.getByText('01711111111')).toBeInTheDocument();
        });
    });

    it('shows Walk-in Customer text when no customer', async () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue({ ...mockOrder, customer: null });
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
        });
    });

    it('shows order not found when api returns null', async () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockRejectedValue(new Error('Not found'));
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText('Order not found')).toBeInTheDocument();
        });
    });

    it('calls updateOrderStatus when Confirm Order is clicked', async () => {
        const { api } = require('@/lib/api');
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
        await waitFor(() => {
            expect(api.updateOrderStatus).toHaveBeenCalledWith('test-order-1', 'CONFIRMED');
        });
    });

    it('shows Record Payment Deposit button when amount due > 0', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText(/record payment deposit/i)).toBeInTheDocument();
        });
    });

    it('opens deposit modal when Record Payment Deposit is clicked', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText(/record payment deposit/i)).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText(/record payment deposit/i));
        expect(screen.getByText('Add Deposit')).toBeInTheDocument();
    });

    it('hides deposit button when amount_paid equals total_amount', async () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue({
            ...mockOrder,
            amount_paid: '5000',
            payment_status: 'PAID',
        });
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.queryByText(/record payment deposit/i)).not.toBeInTheDocument();
        });
    });

    it('shows deposit history when deposits exist', async () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue({
            ...mockOrder,
            deposits: [
                {
                    id: 'dep-1',
                    payment_method: 'CASH',
                    amount: '1000',
                    created_at: '2026-01-02T10:00:00Z',
                },
            ],
        });
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText('Deposit History')).toBeInTheDocument();
            expect(screen.getByText('CASH')).toBeInTheDocument();
        });
    });

    it('shows Edit button for DRAFT orders', async () => {
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
        });
    });

    it('does not show Edit button for DELIVERED orders', async () => {
        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue({ ...mockOrder, status: 'DELIVERED' });
        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
        });
    });
});

describe('OrderDetailsPage - edit mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        const { api } = require('@/lib/api');
        api.getOrder.mockResolvedValue(mockOrder);
        api.getCustomers.mockResolvedValue([{ id: 'cust-2', name: 'Jane Smith' }]);
        api.getProducts.mockResolvedValue([
            { id: 'prod-2', name: 'Widget B', sku: 'WID-002', price: '1500' },
        ]);
        api.updateOrder.mockResolvedValue({});
    });

    it('shows edit mode banner when ?edit=true', async () => {
        const { useSearchParams } = require('next/navigation');
        useSearchParams.mockReturnValue({ get: (k: string) => (k === 'edit' ? 'true' : null) });

        render(<OrderDetailsPage />);
        await waitFor(() => {
            expect(
                screen.getByText(/edit mode — modify order details and items/i),
            ).toBeInTheDocument();
        });
    });
});
