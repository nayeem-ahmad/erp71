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
    Printer: () => <span data-testid="icon-printer" />,
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

    it('shows VAT Invoice label when there is VAT', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('VAT Invoice (Mushak 6.3)')).toBeInTheDocument();
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
            expect(screen.getByText('NBR VAT Compliance (Mushak 6.3)')).toBeInTheDocument();
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
            expect(screen.getByRole('button', { name: /back to sale/i })).toBeInTheDocument();
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
