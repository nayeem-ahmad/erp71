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


import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OrdersPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/orders',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

jest.mock('./StorefrontOrdersPanel', () => ({
    __esModule: true,
    default: () => <div data-testid="storefront-orders-panel">Online Orders</div>,
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getOrders: jest.fn(),
        deleteOrder: jest.fn(),
        createOrder: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: number) => `BDT ${v}`,
    formatDate: (v: string) => `DATE:${v}`,
}));

jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, isLoading, emptyMessage, toolbarActions }: any) => (
        <div data-testid="data-table">
            {isLoading && <span>Loading...</span>}
            {!isLoading && data.length === 0 && <span>{emptyMessage || 'No data'}</span>}
            {!isLoading && data.map((row: any) => (
                <div key={row.id} data-testid={`row-${row.id}`}>
                    <span>{row.order_number}</span>
                    <span>{row.status}</span>
                    <span>{row.payment_status}</span>
                    {row.customer && <span>{row.customer.name}</span>}
                </div>
            ))}
            {toolbarActions && <div data-testid="toolbar">{toolbarActions}</div>}
        </div>
    ),
}));

const mockOrders = [
    {
        id: 'ord-1',
        order_number: 'ORD-00001',
        status: 'DRAFT',
        payment_status: 'UNPAID',
        total_amount: '5000',
        amount_paid: '0',
        created_at: '2026-01-10T10:00:00Z',
        delivery_date: null,
        items: [{ id: 'i-1', product_id: 'p-1', quantity: 5, price_at_order: '1000' }],
        deposits: [],
        customer: { name: 'Bob Ltd', phone: '01700000002' },
    },
    {
        id: 'ord-2',
        order_number: 'ORD-00002',
        status: 'CONFIRMED',
        payment_status: 'PARTIAL',
        total_amount: '2000',
        amount_paid: '1000',
        created_at: '2026-01-11T10:00:00Z',
        delivery_date: '2026-02-01T00:00:00Z',
        items: [],
        deposits: [],
        customer: null,
    },
];

describe('OrdersPage', () => {
    beforeEach(() => {
        window.alert = jest.fn();
        window.confirm = jest.fn(() => true);

        const { api } = require('@/lib/api');
        api.getOrders.mockResolvedValue(mockOrders);
        api.deleteOrder.mockResolvedValue({ deleted: true });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getOrders.mockReturnValue(new Promise(() => {}));
        render(<OrdersPage />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders order rows after loading', async () => {
        render(<OrdersPage />);
        await waitFor(() => {
            expect(screen.getByText('ORD-00001')).toBeInTheDocument();
            expect(screen.getByText('ORD-00002')).toBeInTheDocument();
        });
    });

    it('renders order statuses', async () => {
        render(<OrdersPage />);
        await waitFor(() => {
            expect(screen.getByText('DRAFT')).toBeInTheDocument();
            expect(screen.getByText('CONFIRMED')).toBeInTheDocument();
        });
    });

    it('renders payment statuses', async () => {
        render(<OrdersPage />);
        await waitFor(() => {
            expect(screen.getByText('UNPAID')).toBeInTheDocument();
            expect(screen.getByText('PARTIAL')).toBeInTheDocument();
        });
    });

    it('renders customer name for orders with customer', async () => {
        render(<OrdersPage />);
        await waitFor(() => {
            expect(screen.getByText('Bob Ltd')).toBeInTheDocument();
        });
    });

    it('renders DataTable', async () => {
        render(<OrdersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('shows empty state when no orders', async () => {
        const { api } = require('@/lib/api');
        api.getOrders.mockResolvedValue([]);
        render(<OrdersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('links to the /sales/orders/new entry page from the toolbar', async () => {
        render(<OrdersPage />);
        const link = await screen.findByRole('link', { name: /new order/i });
        expect(link).toHaveAttribute('href', '/sales/orders/new');
    });




    it('calls getOrders on mount', async () => {
        const { api } = require('@/lib/api');
        render(<OrdersPage />);
        await waitFor(() => {
            expect(api.getOrders).toHaveBeenCalledTimes(1);
        });
    });

    it('handles API error gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getOrders.mockRejectedValue(new Error('Server error'));
        render(<OrdersPage />);
        await waitFor(() => {
            expect(screen.getByTestId('data-table')).toBeInTheDocument();
        });
    });

    it('shows page heading', async () => {
        render(<OrdersPage />);
        await waitFor(() => {
            // The page should have some heading with "Order" in it
            expect(screen.getByRole('heading', { name: 'Sales Orders' })).toBeInTheDocument();
        });
    });
});
