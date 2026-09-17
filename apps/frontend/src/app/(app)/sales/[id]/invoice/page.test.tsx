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

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import InvoicePage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSaleInvoice: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/test-sale-1/invoice',
    useParams: () => ({ id: 'test-sale-1' }),
}));

jest.mock('lucide-react', () => ({
    ArrowLeft: () => <span data-testid="icon-arrow-left" />,
    Download: () => <span data-testid="icon-download" />,
    FileCheck: () => <span data-testid="icon-file-check" />,
    Printer: () => <span data-testid="icon-printer" />,
    Truck: () => <span data-testid="icon-truck" />,
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
}));

// Mock window.print
const mockPrint = jest.fn();
Object.defineProperty(window, 'print', { value: mockPrint, writable: true });

const mockInvoiceData = {
    sale: {
        id: 'test-sale-1',
        serial_number: 'SALE-INV-001',
        created_at: '2026-01-20T09:00:00Z',
        status: 'COMPLETED',
        total_amount: '11500',
        amount_paid: '11500',
        note: null,
        store: { name: 'Main Store' },
        customer: {
            name: 'Mohammed Rahman',
            email: 'mrahman@example.com',
            phone: '01799999999',
            address: '123 Dhaka Road',
        },
        items: [
            {
                id: 'item-1',
                quantity: 2,
                price_at_sale: '5000',
                product: {
                    name: 'Premium Widget',
                    sku: 'PW-001',
                    vat_rate: 15,
                },
            },
            {
                id: 'item-2',
                quantity: 3,
                price_at_sale: '500',
                product: {
                    name: 'Basic Widget',
                    sku: 'BW-001',
                    vat_rate: 0,
                },
            },
        ],
        payments: [{ payment_method: 'CASH', amount: '11500' }],
    },
    tenant: {
        name: 'Acme Bangladesh Ltd',
        default_vat_rate: 15,
        vat_registration_no: 'BIN-12345678',
        business_tin: 'TIN-98765',
        brand_primary_color: '#1a73e8',
        brand_logo_url: null,
        brand_business_name: 'Acme BD',
    },
};

const getApi = () => require('@/lib/api').api;

describe('InvoicePage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getApi().getSaleInvoice.mockResolvedValue(mockInvoiceData);
    });

    it('shows loading state initially', () => {
        getApi().getSaleInvoice.mockReturnValue(new Promise(() => {}));
        render(<InvoicePage />);
        expect(screen.getByText('Loading invoice…')).toBeInTheDocument();
    });

    it('renders the invoice serial number after loading', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getAllByText('SALE-INV-001').length).toBeGreaterThan(0);
        });
    });

    it('renders the business name', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getAllByText('Acme BD').length).toBeGreaterThan(0);
        });
    });

    it('renders the customer information', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Mohammed Rahman')).toBeInTheDocument();
            expect(screen.getByText('mrahman@example.com')).toBeInTheDocument();
            expect(screen.getByText('01799999999')).toBeInTheDocument();
            expect(screen.getByText('123 Dhaka Road')).toBeInTheDocument();
        });
    });

    it('renders line items', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Premium Widget')).toBeInTheDocument();
            expect(screen.getByText('PW-001')).toBeInTheDocument();
            expect(screen.getByText('Basic Widget')).toBeInTheDocument();
            expect(screen.getByText('BW-001')).toBeInTheDocument();
        });
    });

    // The label no longer claims to be a Mushak 6.3: that is a gazetted form
    // with its own prescribed layout, now rendered at /sales/[id]/mushak. This
    // page is the shop's own commercial invoice and links across to it.
    it('shows VAT Invoice label when there is VAT', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('VAT Invoice')).toBeInTheDocument();
        });
        expect(screen.queryByText(/Mushak 6\.3\)/)).not.toBeInTheDocument();
    });

    it('links to the Mushak 6.3 tax invoice for the same sale', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByRole('link', { name: /Mushak 6\.3/ })).toHaveAttribute(
                'href',
                '/sales/test-sale-1/mushak',
            );
        });
    });

    it('prefers the VAT stored with the sale over the catalogue rate', async () => {
        // The point of the snapshot: an invoice the customer already holds must
        // not change when the product's rate is edited afterwards.
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: {
                ...mockInvoiceData.sale,
                total_amount: '1150',
                amount_paid: '1150',
                items: [
                    {
                        id: 'item-1',
                        quantity: 1,
                        price_at_sale: '1150',
                        vat_rate: '15.00',
                        // Since raised, the catalogue moved to 5%. The invoice
                        // must still show the 150 that was charged.
                        product: { name: 'Premium Widget', sku: 'PW-001', vat_rate: 5 },
                    },
                ],
            },
        });

        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText(/15% \/ .*150/)).toBeInTheDocument();
        });
    });

    it('shows VAT column header in line items table', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getAllByText('VAT').length).toBeGreaterThan(0);
        });
    });

    it('shows NBR compliance footer when VAT is present', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('NBR VAT Compliance')).toBeInTheDocument();
            expect(screen.getByText(/Supplier BIN: BIN-12345678/)).toBeInTheDocument();
        });
    });

    it('renders BIN and TIN numbers from tenant', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('BIN-12345678')).toBeInTheDocument();
            expect(screen.getByText('TIN-98765')).toBeInTheDocument();
        });
    });

    it('renders the payment details section', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Payment Details')).toBeInTheDocument();
            expect(screen.getByText('CASH')).toBeInTheDocument();
        });
    });

    it('shows store name in seller section', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Main Store')).toBeInTheDocument();
        });
    });

    it('shows Back to Sale button', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByRole('link', { name: 'SALE-INV-001' })).toBeInTheDocument();
        });
    });

    it('shows Print and Download PDF buttons', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^print$/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
        });
    });

    it('calls window.print when Print button is clicked', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^print$/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /^print$/i }));
        expect(mockPrint).toHaveBeenCalled();
    });

    it('prints a delivery challan with the goods but none of the money', async () => {
        const write = jest.fn();
        const open = jest.spyOn(window, 'open').mockReturnValue({
            document: { write, close: jest.fn(), images: [] },
            print: jest.fn(),
            set onload(handler: () => void) {
                handler();
            },
        } as unknown as Window);

        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /delivery challan/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /delivery challan/i }));

        expect(write).toHaveBeenCalledTimes(1);
        const html = write.mock.calls[0][0] as string;
        expect(html).toContain('Delivery Challan');
        expect(html).toContain('SALE-INV-001');
        // Every product on the invoice rides along, with its SKU...
        expect(html).toContain('Premium Widget');
        expect(html).toContain('Basic Widget');
        expect(html).toContain('PW-001');
        expect(html).toContain('Mohammed Rahman');
        expect(html).toContain('123 Dhaka Road');
        // ...and not one of its prices does.
        expect(html).not.toMatch(/৳|BDT|\$/);
        expect(html).not.toMatch(/Unit Price|Subtotal|VAT|Payment/i);

        open.mockRestore();
    });

    it('prints a challan for a walk-in sale, which has no customer to address', async () => {
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, customer: null },
        });
        const write = jest.fn();
        const open = jest.spyOn(window, 'open').mockReturnValue({
            document: { write, close: jest.fn(), images: [] },
            print: jest.fn(),
            set onload(handler: () => void) {
                handler();
            },
        } as unknown as Window);

        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /delivery challan/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /delivery challan/i }));

        const html = write.mock.calls[0][0] as string;
        expect(html).toContain('Premium Widget');
        expect(html).not.toContain('Deliver To');
        // Somebody still signs for the goods.
        expect(html).toContain('Received By');

        open.mockRestore();
    });

    it('renders COMPLETED status badge', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('COMPLETED')).toBeInTheDocument();
        });
    });

    it('shows error when invoice fetch fails', async () => {
        getApi().getSaleInvoice.mockRejectedValue(new Error('Server error'));
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load invoice')).toBeInTheDocument();
        });
    });

    it('renders plain Invoice label (no VAT) when no VAT items', async () => {
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: {
                ...mockInvoiceData.sale,
                items: [
                    {
                        id: 'item-1',
                        quantity: 1,
                        price_at_sale: '500',
                        product: { name: 'No VAT Item', sku: 'NV-001', vat_rate: 0 },
                    },
                ],
            },
            tenant: {
                ...mockInvoiceData.tenant,
                default_vat_rate: 0,
            },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.queryByText('VAT Invoice (Mushak 6.3)')).not.toBeInTheDocument();
            expect(screen.getByRole('heading', { name: 'Invoice' })).toBeInTheDocument();
        });
    });

    it('shows Walk-in Customer section when no customer', async () => {
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, customer: null },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getAllByText('Walk-in Customer').length).toBeGreaterThan(0);
        });
    });

    it('shows note when sale has a note', async () => {
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, note: 'Deliver by afternoon' },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Deliver by afternoon')).toBeInTheDocument();
        });
    });

    it('shows Balance Due when amount_paid is less than total', async () => {
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, amount_paid: '5000', total_amount: '11500' },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Balance Due')).toBeInTheDocument();
        });
    });

    it('shows Change when amount_paid exceeds total', async () => {
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, amount_paid: '12000', total_amount: '11500' },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Change')).toBeInTheDocument();
        });
    });

    it('uses fallback business name from tenant.name when brand_business_name is null', async () => {
        getApi().getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            tenant: { ...mockInvoiceData.tenant, brand_business_name: null },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getAllByText('Acme Bangladesh Ltd').length).toBeGreaterThan(0);
        });
    });

    it('shows Seller section with business info', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Seller')).toBeInTheDocument();
        });
    });

    it('shows Invoice No., Date, Status meta section', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Invoice No.')).toBeInTheDocument();
            expect(screen.getByText('Date')).toBeInTheDocument();
            expect(screen.getByText('Status')).toBeInTheDocument();
        });
    });

    it('renders thank you footer', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText(/thank you for your business/i)).toBeInTheDocument();
        });
    });
});
