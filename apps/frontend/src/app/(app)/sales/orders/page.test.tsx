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


jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());
jest.mock('@/lib/print', () => require('@/test-utils/print-paper').printModuleSpy());
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { mockBrowserPaper, printedPaper } from '@/test-utils/print-paper';
import OrdersPage from './page';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

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
    // Forwards the rest of the props: an icon-only action carries its label in
    // `aria-label`/`title`, and a mock that drops those leaves it nameless.
    default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getOrders: jest.fn(),
        deleteOrder: jest.fn(),
        updateOrderStatus: jest.fn(),
        createOrder: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: number) => `BDT ${v}`,
    formatDate: (v: string) => `DATE:${v}`,
    formatDateTime: (v: string) => `DATETIME:${v}`,
}));

jest.mock('@/components/data-table', () => ({
    createdAtColumn: () => ({ id: 'created_at', header: 'Created' }),
    CreatedRangeFilter: () => <div data-testid="created-range-filter" />,
    DataTable: ({ data, columns, isLoading, emptyMessage, toolbarActions, onRowSelectionChange, bulkActions }: any) => {
        // The row actions are a column definition, so render that cell too —
        // otherwise the per-row buttons are invisible to every assertion.
        const actions = columns?.find((column: any) => column.id === 'actions');
        return (
            <div data-testid="data-table">
                {isLoading && <span>Loading...</span>}
                {!isLoading && data.length === 0 && <span>{emptyMessage || 'No data'}</span>}
                {!isLoading && data.map((row: any) => (
                    <div key={row.id} data-testid={`row-${row.id}`}>
                        <span>{row.order_number}</span>
                        <span>{row.status}</span>
                        <span>{row.payment_status}</span>
                        {row.customer && <span>{row.customer.name}</span>}
                        {actions?.cell({ row: { original: row } })}
                    </div>
                ))}
                {toolbarActions && <div data-testid="toolbar">{toolbarActions}</div>}
                {/* Ticks every row, as the header checkbox would. */}
                <button type="button" onClick={() => onRowSelectionChange?.(data)}>tick-all</button>
                <div data-testid="bulk-bar">
                    {(bulkActions ?? []).map((action: any) => (
                        <button key={action.label} type="button" onClick={() => action.onClick(data)}>
                            {action.label}
                        </button>
                    ))}
                </div>
            </div>
        );
    },
}));

const ordersInEveryStatus = [
    { id: 'o-draft', order_number: 'SO-D', status: 'DRAFT' },
    { id: 'o-conf', order_number: 'SO-C', status: 'CONFIRMED' },
    { id: 'o-proc', order_number: 'SO-P', status: 'PROCESSING' },
    { id: 'o-deliv', order_number: 'SO-V', status: 'DELIVERED' },
].map((o) => ({
    ...o, payment_status: 'UNPAID', total_amount: '100', amount_paid: '0', created_at: '2026-01-10T10:00:00Z',
    items: [], deposits: [], customer: null,
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

    it('offers a convert-to-sale action pointing at the seeded entry screen', async () => {
        render(<OrdersPage />);
        const row = await screen.findByTestId('row-ord-1');
        const link = within(row).getByRole('link', { name: 'Convert to Sale' });
        expect(link).toHaveAttribute('href', '/sales/new?salesOrderId=ord-1');
    });

    it('asks before deleting an order in a dialog, not the browser confirm', async () => {
        const { api } = require('@/lib/api');
        render(<OrdersPage />);
        fireEvent.click(within(await screen.findByTestId('row-ord-1')).getByRole('button', { name: 'Delete' }));
        expect(window.confirm).not.toHaveBeenCalled();
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.deleteOrder).toHaveBeenCalledWith('ord-1'));
        await waitFor(() => expect(screen.queryByTestId('row-ord-1')).not.toBeInTheDocument());
    });

    describe('bulk actions on ticked orders', () => {
        beforeEach(() => {
            const { api } = require('@/lib/api');
            api.getOrders.mockResolvedValue(ordersInEveryStatus);
            api.updateOrderStatus.mockResolvedValue({});
        });

        async function tickAll() {
            render(<OrdersPage />);
            await screen.findByTestId('row-o-draft');
            fireEvent.click(screen.getByRole('button', { name: 'tick-all' }));
            return within(screen.getByTestId('bulk-bar'));
        }

        it('offers each step with the number of ticked orders it fits', async () => {
            const bar = await tickAll();
            expect(bar.getByRole('button', { name: 'Confirm (1)' })).toBeInTheDocument();
            expect(bar.getByRole('button', { name: 'Start processing (1)' })).toBeInTheDocument();
            expect(bar.getByRole('button', { name: 'Mark delivered (1)' })).toBeInTheDocument();
            // A delivered order is never deleted.
            expect(bar.getByRole('button', { name: 'Delete (3)' })).toBeInTheDocument();
        });

        it('offers nothing before any order is ticked', async () => {
            render(<OrdersPage />);
            await screen.findByTestId('row-o-draft');
            expect(within(screen.getByTestId('bulk-bar')).queryAllByRole('button')).toHaveLength(0);
        });

        it('confirms only the drafts among the ticked orders', async () => {
            const { api } = require('@/lib/api');
            const bar = await tickAll();
            fireEvent.click(bar.getByRole('button', { name: 'Confirm (1)' }));
            await waitFor(() => expect(api.updateOrderStatus).toHaveBeenCalledTimes(1));
            expect(api.updateOrderStatus).toHaveBeenCalledWith('o-draft', 'CONFIRMED');
        });

        it('asks before marking orders delivered, since stock moves', async () => {
            const { api } = require('@/lib/api');
            const bar = await tickAll();
            fireEvent.click(bar.getByRole('button', { name: 'Mark delivered (1)' }));
            expect(api.updateOrderStatus).not.toHaveBeenCalled();
            const dialog = await screen.findByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: 'Mark delivered (1)' }));
            await waitFor(() => expect(api.updateOrderStatus).toHaveBeenCalledWith('o-proc', 'DELIVERED'));
        });

        it('deletes every ticked order but the delivered one, after asking', async () => {
            const { api } = require('@/lib/api');
            const bar = await tickAll();
            fireEvent.click(bar.getByRole('button', { name: 'Delete (3)' }));
            const dialog = await screen.findByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: 'Delete (3)' }));
            await waitFor(() => expect(api.deleteOrder).toHaveBeenCalledTimes(3));
            expect(api.deleteOrder).not.toHaveBeenCalledWith('o-deliv');
        });

        it('names the orders a step could not change and keeps the rest done', async () => {
            const { api } = require('@/lib/api');
            const { toast } = require('@/lib/toast');
            const error = jest.spyOn(toast, 'error');
            const success = jest.spyOn(toast, 'success');
            api.deleteOrder.mockImplementation((id: string) => (id === 'o-conf' ? Promise.reject(new Error('no')) : Promise.resolve({})));
            const bar = await tickAll();
            fireEvent.click(bar.getByRole('button', { name: 'Delete (3)' }));
            fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete (3)' }));
            await waitFor(() => expect(error).toHaveBeenCalledWith('Not changed: SO-C'));
            expect(success).toHaveBeenCalledWith('Orders deleted: 2');
        });
    });

    describe('printing on the browser’s paper', () => {
        let openSpy: jest.SpyInstance;
        beforeEach(() => {
            openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
        });
        afterEach(() => openSpy.mockRestore());

        it.each([
            ['A5', 'A5'],
            ['Letter', 'Letter'],
            ['Thermal80', 'A4'],
        ] as const)('prints an order chosen as %s on %s, with that paper’s letterhead', async (chosen, printed) => {
            mockBrowserPaper(chosen);
            render(<OrdersPage />);
            fireEvent.click(within(await screen.findByTestId('row-ord-1')).getByTitle('Print'));
            await waitFor(() => expect(printedPaper()).toEqual({ page: printed, letterhead: printed }));
        });
    });
});
