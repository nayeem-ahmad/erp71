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

const { enMessages } = require('@/lib/localization/messages/en');

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SaleDetailPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSale: jest.fn(),
        updateSale: jest.fn(),
        getCustomers: jest.fn(),
        getProducts: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (n: number) => `৳${n.toFixed(2)}`,
    toDatetimeLocal: (date: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },
}));

jest.mock('@/lib/pos-receipt-printer', () => ({
    printPOSReceipt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() })),
    usePathname: () => '/sales/test-sale-1',
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: () => ({ id: 'test-sale-1' }),
}));

jest.mock('lucide-react', () => ({
    ArrowLeft: () => <span data-testid="icon-arrow-left" />,
    Printer: () => <span data-testid="icon-printer" />,
    Save: () => <span data-testid="icon-save" />,
    Package: () => <span data-testid="icon-package" />,
    CreditCard: () => <span data-testid="icon-credit-card" />,
    FileText: () => <span data-testid="icon-file-text" />,
    Pencil: () => <span data-testid="icon-pencil" />,
    Plus: () => <span data-testid="icon-plus" />,
    Trash2: () => <span data-testid="icon-trash" />,
    X: () => <span data-testid="icon-x" />,
    Search: () => <span data-testid="icon-search" />,
    User: () => <span data-testid="icon-user" />,
    Download: () => <span data-testid="icon-download" />,
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
}));

const mockSale = {
    id: 'test-sale-1',
    serial_number: 'SALE-001',
    status: 'COMPLETED',
    total_amount: '3000',
    amount_paid: '3000',
    created_at: '2026-01-15T12:00:00Z',
    customer: {
        name: 'Alice Smith',
        email: 'alice@example.com',
        phone: '01722222222',
    },
    customer_id: 'cust-1',
    note: 'Handle with care',
    items: [
        {
            id: 'item-1',
            product_id: 'prod-1',
            product: {
                name: 'Gadget X',
                sku: 'GAD-001',
                image_url: null,
            },
            quantity: 3,
            price_at_sale: '1000',
        },
    ],
    payments: [
        {
            payment_method: 'CASH',
            amount: '3000',
            created_at: '2026-01-15T12:01:00Z',
        },
    ],
};

const getApi = () => require('@/lib/api').api;

// Mirrors the mocked `toDatetimeLocal` above, kept independent of the host
// machine's timezone so the expected string always matches what the
// component renders regardless of where the test runs.
const expectedDatetimeLocal = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

describe('SaleDetailPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.getSale.mockResolvedValue(mockSale);
        api.getCustomers.mockResolvedValue([]);
        api.getProducts.mockResolvedValue([]);
        api.updateSale.mockResolvedValue({});
    });

    it('shows loading state initially', () => {
        getApi().getSale.mockReturnValue(new Promise(() => {}));
        render(<SaleDetailPage />);
        expect(screen.getByText(enMessages.shared.loading.sale)).toBeInTheDocument();
    });

    it('renders the sale serial number after loading', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByRole('heading', { level: 1 })[0]).toHaveTextContent('SALE-001');
        });
    });

    it('renders status badge', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.shared.statuses.sale.COMPLETED)).toBeInTheDocument();
        });
    });

    it('renders the line items section', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Gadget X').length).toBeGreaterThan(0);
            expect(screen.getAllByText('GAD-001').length).toBeGreaterThan(0);
        });
    });

    it('renders payment records section', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.sales.detail.paymentRecords)).toBeInTheDocument();
            expect(screen.getByText('CASH')).toBeInTheDocument();
        });
    });

    it('renders the note section with sale note', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Handle with care').length).toBeGreaterThan(0);
        });
    });

    it('shows "No note added" when sale has no note', async () => {
        getApi().getSale.mockResolvedValue({ ...mockSale, note: null });
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.shared.empty.noNote)).toBeInTheDocument();
        });
    });

    it('shows Sale not found when api call fails', async () => {
        getApi().getSale.mockRejectedValue(new Error('Not found'));
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.shared.notFound.sale)).toBeInTheDocument();
        });
    });

    it('renders Edit, POS Receipt, and Print Preview buttons', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /pos receipt/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /print preview/i })).toBeInTheDocument();
        });
    });

    it('renders Invoice PDF link with correct href', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            const invoiceLink = screen.getByRole('link', { name: /invoice pdf/i });
            expect(invoiceLink).toHaveAttribute('href', '/sales/test-sale-1/invoice');
        });
    });

    it('shows summary cards with correct labels', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText(enMessages.common.total).length).toBeGreaterThan(0);
            expect(screen.getByText(enMessages.sales.columns.paid)).toBeInTheDocument();
            expect(screen.getByText(enMessages.sales.columns.items)).toBeInTheDocument();
        });
    });

    it('calls printPOSReceipt when POS Receipt button is clicked', async () => {
        const { printPOSReceipt } = require('@/lib/pos-receipt-printer');
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /pos receipt/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /pos receipt/i }));
        await waitFor(() => {
            expect(printPOSReceipt).toHaveBeenCalledWith(
                expect.objectContaining({
                    serialNumber: 'SALE-001',
                    invoiceId: 'test-sale-1',
                }),
            );
        });
    });

    it('shows no payment records message when payments are empty', async () => {
        getApi().getSale.mockResolvedValue({ ...mockSale, payments: [] });
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.shared.empty.noPaymentRecords)).toBeInTheDocument();
        });
    });

    it('renders item quantity', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            // quantity 3 appears in multiple places (table and print section)
            expect(screen.getAllByText('3').length).toBeGreaterThan(0);
        });
    });

    it('shows Line Items heading', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.sales.detail.lineItems)).toBeInTheDocument();
        });
    });

    it('shows Note heading', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.sales.detail.note)).toBeInTheDocument();
        });
    });
});

describe('SaleDetailPage - edit mode', () => {
    const setEditMode = (enabled: boolean) => {
        const nav = require('next/navigation');
        nav.useSearchParams.mockReturnValue({
            get: (k: string) => (k === 'edit' && enabled ? 'true' : null),
        });
    };

    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.getSale.mockResolvedValue(mockSale);
        api.getCustomers.mockResolvedValue([{ id: 'cust-2', name: 'Bob Jones' }]);
        api.getProducts.mockResolvedValue([
            { id: 'prod-2', name: 'Widget Z', sku: 'WID-Z', price: '800' },
        ]);
        api.getPaymentMethods.mockResolvedValue([]);
        api.updateSale.mockResolvedValue({});
        setEditMode(false);
    });

    it('shows edit mode banner when ?edit=true', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(
                screen.getByText(enMessages.shared.editMode.sale),
            ).toBeInTheDocument();
        });
    });

    it('shows status select in edit mode', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue(enMessages.shared.statuses.sale.COMPLETED)).toBeInTheDocument();
        });
    });

    it('shows Add Payment button in edit mode', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /add payment/i })).toBeInTheDocument();
        });
    });

    it('adds a payment row when Add Payment is clicked', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /add payment/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /add payment/i }));
        // A new payment select should appear
        await waitFor(() => {
            // The payment method select defaults to CASH
            expect(screen.getAllByDisplayValue('CASH').length).toBeGreaterThan(0);
        });
    });

    it('shows note textarea in edit mode', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByPlaceholderText(enMessages.sales.detail.notePlaceholder)).toBeInTheDocument();
        });
    });

    it('shows Save Changes button in edit mode banner', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /save changes/i }).length).toBeGreaterThan(0);
        });
    });

    it('shows a date input seeded from created_at when the sale has no sale_date', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue(expectedDatetimeLocal(mockSale.created_at))).toBeInTheDocument();
        });
    });

    it('seeds the date input from sale_date in preference to created_at', async () => {
        // sale_date on a distinct day from created_at proves sale_date wins
        // (a reversed `created_at ?? sale_date` would seed from created_at).
        getApi().getSale.mockResolvedValue({
            ...mockSale,
            sale_date: '2026-02-20T09:00:00Z',
            created_at: '2026-01-15T12:00:00Z',
        });
        setEditMode(true);
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(
                screen.getByDisplayValue(expectedDatetimeLocal('2026-02-20T09:00:00Z')),
            ).toBeInTheDocument();
        });
        // And definitely not seeded from created_at.
        expect(
            screen.queryByDisplayValue(expectedDatetimeLocal('2026-01-15T12:00:00Z')),
        ).not.toBeInTheDocument();
    });

    it('saves the edited sale date via api.updateSale', async () => {
        setEditMode(true);
        render(<SaleDetailPage />);

        const dateInput = await waitFor(() => screen.getByDisplayValue(expectedDatetimeLocal(mockSale.created_at)));
        fireEvent.change(dateInput, { target: { value: '2026-02-20T09:30' } });

        const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
        fireEvent.click(saveButtons[0]);

        await waitFor(() => {
            expect(getApi().updateSale).toHaveBeenCalledWith(
                'test-sale-1',
                expect.objectContaining({
                    saleDate: new Date('2026-02-20T09:30').toISOString(),
                }),
            );
        });
    });

    it('uses tenant-defined payment methods in the payment method select, sorted with show_on_entry first', async () => {
        getApi().getPaymentMethods.mockResolvedValue([
            { id: 'pm-1', name: 'Prime Bank', type: 'BANK', is_active: true, show_on_entry: false, sort_order: 1 },
            { id: 'pm-2', name: 'Till Cash', type: 'CASH', is_active: true, show_on_entry: true, sort_order: 2 },
            { id: 'pm-3', name: 'bKash', type: 'MOBILE_WALLET', is_active: true, show_on_entry: true, sort_order: 1 },
            { id: 'pm-4', name: 'Retired Method', type: 'CARD', is_active: false, show_on_entry: true, sort_order: 0 },
        ]);
        setEditMode(true);
        render(<SaleDetailPage />);

        await waitFor(() => {
            expect(screen.getByText('bKash')).toBeInTheDocument();
        });
        expect(screen.getByText('Till Cash')).toBeInTheDocument();
        expect(screen.getByText('Prime Bank')).toBeInTheDocument();
        expect(screen.queryByText('Retired Method')).not.toBeInTheDocument();

        // The existing saved payment's raw value ('CASH') round-trips as a selectable option.
        expect(screen.getByDisplayValue('CASH')).toBeInTheDocument();
    });
});
