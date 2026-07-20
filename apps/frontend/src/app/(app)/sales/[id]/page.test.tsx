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
import { render, screen, fireEvent, act } from '@testing-library/react';
import SaleDetailPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSale: jest.fn(),
        updateSale: jest.fn(),
        deleteSale: jest.fn(),
        finalizeSale: jest.fn(),
        getCustomers: jest.fn(),
        getProducts: jest.fn(),
        getPaymentMethods: jest.fn(),
        searchProductsByQuantity: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
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

jest.mock('@/lib/sales-invoice-printer', () => ({
    printSalesInvoice: jest.fn(),
    PAPER_SIZES: ['A4', 'A5'],
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: mockPush, back: jest.fn(), replace: jest.fn() })),
    usePathname: () => '/sales/test-sale-1',
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: () => ({ id: 'test-sale-1' }),
}));

const mockSale = {
    id: 'test-sale-1',
    serial_number: 'SALE-001',
    reference_number: 'REF-9',
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
            product: { name: 'Gadget X', sku: 'GAD-001', image_url: null },
            quantity: 3,
            price_at_sale: '1000',
        },
    ],
    payments: [
        { payment_method: 'Cash', amount: '3000', created_at: '2026-01-15T12:01:00Z' },
    ],
};

const getApi = () => require('@/lib/api').api;

const setEditMode = (enabled: boolean) => {
    const nav = require('next/navigation');
    nav.useSearchParams.mockReturnValue({
        get: (k: string) => (k === 'edit' && enabled ? 'true' : null),
    });
};

// Mirrors the mocked `toDatetimeLocal` above, kept independent of the host
// machine's timezone so the expected string always matches what the component
// renders regardless of where the test runs.
const expectedDatetimeLocal = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const renderPage = async () => {
    await act(async () => {
        render(<SaleDetailPage />);
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    const api = getApi();
    api.getSale.mockResolvedValue(mockSale);
    api.getCustomers.mockResolvedValue([]);
    api.getProducts.mockResolvedValue([]);
    api.getPaymentMethods.mockResolvedValue([]);
    api.searchProductsByQuantity.mockResolvedValue([]);
    api.updateSale.mockResolvedValue({});
    api.deleteSale.mockResolvedValue({ deleted: true });
    setEditMode(false);
});

describe('SaleDetailPage — view mode', () => {
    it('shows loading state initially', () => {
        getApi().getSale.mockReturnValue(new Promise(() => {}));
        render(<SaleDetailPage />);
        expect(screen.getByText(enMessages.shared.loading.sale)).toBeInTheDocument();
    });

    it('shows Sale not found when the api call fails', async () => {
        getApi().getSale.mockRejectedValue(new Error('Not found'));
        await renderPage();
        expect(screen.getByText(enMessages.shared.notFound.sale)).toBeInTheDocument();
    });

    it('renders the serial number as the entry-form title', async () => {
        await renderPage();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SALE-001');
    });

    it('renders the sale meta, customer, line item and note read-only', async () => {
        await renderPage();

        expect(screen.getByText('REF-9')).toBeInTheDocument();
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
        expect(screen.getByText('Gadget X')).toBeInTheDocument();
        expect(screen.getByText('Handle with care')).toBeInTheDocument();
        // The recorded payment shows as a plain row, not an amount input.
        expect(screen.getByText('Cash')).toBeInTheDocument();
        expect(screen.queryByLabelText('Cash amount')).not.toBeInTheDocument();
    });

    it('exposes no editable inputs while viewing', async () => {
        await renderPage();
        expect(document.querySelectorAll('input')).toHaveLength(0);
        expect(screen.queryByPlaceholderText(/Add product/i)).not.toBeInTheDocument();
    });

    it('shows the status badge', async () => {
        await renderPage();
        expect(screen.getByText(enMessages.shared.statuses.sale.COMPLETED)).toBeInTheDocument();
    });

    it('carries the gap between line subtotal and stored total as an adjustment', async () => {
        // 3 x 1000 = 3000 of lines, but the sale was stored at 3250.
        getApi().getSale.mockResolvedValue({ ...mockSale, total_amount: '3250' });
        await renderPage();

        expect(screen.getByText('Adjustment')).toBeInTheDocument();
        expect(screen.getByText('৳250.00')).toBeInTheDocument();
        expect(screen.getByText('৳3250.00')).toBeInTheDocument();
    });

    it('omits the adjustment row when the total matches the line subtotal', async () => {
        await renderPage();
        expect(screen.queryByText('Adjustment')).not.toBeInTheDocument();
    });

    it('renders the Invoice PDF link with the correct href', async () => {
        await renderPage();
        expect(screen.getByRole('link', { name: /invoice pdf/i })).toHaveAttribute(
            'href',
            '/sales/test-sale-1/invoice',
        );
    });

    it('prints a POS receipt built from the sale', async () => {
        const { printPOSReceipt } = require('@/lib/pos-receipt-printer');
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /pos receipt/i }));
        });

        expect(printPOSReceipt).toHaveBeenCalledWith(
            expect.objectContaining({ serialNumber: 'SALE-001', invoiceId: 'test-sale-1' }),
        );
    });

    it('navigates to edit mode from the Edit action', async () => {
        await renderPage();
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
        expect(mockPush).toHaveBeenCalledWith('/sales/test-sale-1?edit=true');
    });
});

describe('SaleDetailPage — edit mode', () => {
    beforeEach(() => setEditMode(true));

    it('shows the edit banner and a status select', async () => {
        await renderPage();
        expect(screen.getByText(enMessages.shared.editMode.sale)).toBeInTheDocument();
        expect(
            screen.getByDisplayValue(enMessages.shared.statuses.sale.COMPLETED),
        ).toBeInTheDocument();
    });

    it('makes quantity, price and the product search available', async () => {
        await renderPage();
        expect(screen.getByDisplayValue('3')).toBeInTheDocument();
        expect(screen.getByDisplayValue('1000')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Add product/i)).toBeInTheDocument();
    });

    it('seeds the date input from sale_date in preference to created_at', async () => {
        getApi().getSale.mockResolvedValue({
            ...mockSale,
            sale_date: '2026-02-20T09:00:00Z',
            created_at: '2026-01-15T12:00:00Z',
        });
        await renderPage();

        expect(
            screen.getByDisplayValue(expectedDatetimeLocal('2026-02-20T09:00:00Z')),
        ).toBeInTheDocument();
        expect(
            screen.queryByDisplayValue(expectedDatetimeLocal('2026-01-15T12:00:00Z')),
        ).not.toBeInTheDocument();
    });

    it('saves items, payments, date and the adjusted total via api.updateSale', async () => {
        await renderPage();

        const dateInput = screen.getByDisplayValue(expectedDatetimeLocal(mockSale.created_at));
        fireEvent.change(dateInput, { target: { value: '2026-02-20T09:30' } });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        });

        expect(getApi().updateSale).toHaveBeenCalledWith('test-sale-1', expect.objectContaining({
            customerId: 'cust-1',
            status: 'COMPLETED',
            note: 'Handle with care',
            saleDate: new Date('2026-02-20T09:30').toISOString(),
            totalAmount: 3000,
            items: [{ productId: 'prod-1', quantity: 3, priceAtSale: 1000 }],
            payments: [{ paymentMethod: 'Cash', amount: 3000 }],
        }));
    });

    it('sends the stored total back unchanged when the lines are untouched', async () => {
        // The 250 that separates lines from total must survive a plain re-save.
        getApi().getSale.mockResolvedValue({ ...mockSale, total_amount: '3250' });
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        });

        expect(getApi().updateSale).toHaveBeenCalledWith(
            'test-sale-1',
            expect.objectContaining({ totalAmount: 3250 }),
        );
    });

    it('reloads a saved payment into its matching tenant method', async () => {
        // The sale stores the canonical "Mobile Wallet"; the tenant calls it bKash.
        getApi().getPaymentMethods.mockResolvedValue([
            { id: 'pm-1', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: true, sort_order: 0 },
        ]);
        getApi().getSale.mockResolvedValue({
            ...mockSale,
            payments: [{ payment_method: 'Mobile Wallet', amount: '3000', created_at: '2026-01-15T12:01:00Z' }],
        });
        await renderPage();

        expect(screen.getByLabelText('bKash amount')).toHaveValue(3000);
    });
});

describe('SaleDetailPage — drafts', () => {
    const draftSale = { ...mockSale, status: 'DRAFT' };

    it('shows the draft notice and the Complete Sale action', async () => {
        getApi().getSale.mockResolvedValue(draftSale);
        await renderPage();

        expect(screen.getByText(enMessages.sales.detail.draftBanner)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /complete sale/i })).toBeInTheDocument();
    });

    it('does not offer Complete Sale on a posted sale', async () => {
        await renderPage();
        expect(screen.queryByRole('button', { name: /complete sale/i })).not.toBeInTheDocument();
    });

    it('finalizes the draft through api.finalizeSale', async () => {
        getApi().getSale.mockResolvedValue(draftSale);
        getApi().finalizeSale.mockResolvedValue({});
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /complete sale/i }));
        });

        expect(getApi().finalizeSale).toHaveBeenCalledWith('test-sale-1');
    });

    it('locks the status select to DRAFT in edit mode', async () => {
        setEditMode(true);
        getApi().getSale.mockResolvedValue(draftSale);
        await renderPage();

        const statusSelect = screen.getByDisplayValue(
            enMessages.shared.statuses.sale.DRAFT,
        ) as HTMLSelectElement;
        expect(statusSelect.options).toHaveLength(1);
    });
});

describe('SaleDetailPage — delete', () => {
    it('deletes after confirmation and returns to the list', async () => {
        window.confirm = jest.fn(() => true);
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
        });

        expect(window.confirm).toHaveBeenCalledWith(enMessages.shared.confirm.deleteSale);
        expect(getApi().deleteSale).toHaveBeenCalledWith('test-sale-1');
        expect(mockPush).toHaveBeenCalledWith('/sales/list');
    });

    it('does nothing when the confirmation is dismissed', async () => {
        window.confirm = jest.fn(() => false);
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
        });

        expect(getApi().deleteSale).not.toHaveBeenCalled();
    });

    it('surfaces a backend refusal as an error toast', async () => {
        window.confirm = jest.fn(() => true);
        const { toast } = require('@/lib/toast');
        getApi().deleteSale.mockRejectedValue(new Error('This sale has returns against it'));
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
        });

        expect(toast.error).toHaveBeenCalledWith('This sale has returns against it');
        expect(mockPush).not.toHaveBeenCalledWith('/sales/list');
    });
});
