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
    usePathname: () => '/dashboard/sales/test-sale-1/invoice',
    useParams: () => ({ id: 'test-sale-1' }),
}));

jest.mock('lucide-react', () => ({
    ArrowLeft: () => <span data-testid="icon-arrow-left" />,
    Download: () => <span data-testid="icon-download" />,
    Printer: () => <span data-testid="icon-printer" />,
}));

// window.print mock
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
        payments: [
            { payment_method: 'CASH', amount: '11500' },
        ],
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

describe('InvoicePage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockResolvedValue(mockInvoiceData);
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockReturnValue(new Promise(() => {}));
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

    it('shows VAT column in line items table', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('VAT')).toBeInTheDocument();
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

    it('renders status badge with correct styling for COMPLETED', async () => {
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('COMPLETED')).toBeInTheDocument();
        });
    });

    it('shows error when invoice fetch fails', async () => {
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockRejectedValue(new Error('Server error'));
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load invoice')).toBeInTheDocument();
        });
    });

    it('renders without VAT section when no VAT items', async () => {
        const { api } = require('@/lib/api');
        const noVatData = {
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
        };
        api.getSaleInvoice.mockResolvedValue(noVatData);
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.queryByText('VAT Invoice (Mushak 6.3)')).not.toBeInTheDocument();
            expect(screen.getByText('Invoice')).toBeInTheDocument();
        });
    });

    it('shows Walk-in Customer section when no customer', async () => {
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, customer: null },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
        });
    });

    it('shows note when sale has a note', async () => {
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, note: 'Deliver by afternoon' },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Deliver by afternoon')).toBeInTheDocument();
        });
    });

    it('shows balance due when amount_paid is less than total', async () => {
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, amount_paid: '5000', total_amount: '11500' },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Balance Due')).toBeInTheDocument();
        });
    });

    it('shows Change when amount_paid exceeds total', async () => {
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            sale: { ...mockInvoiceData.sale, amount_paid: '12000', total_amount: '11500' },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getByText('Change')).toBeInTheDocument();
        });
    });

    it('uses fallback business name from tenant.name when brand_business_name is null', async () => {
        const { api } = require('@/lib/api');
        api.getSaleInvoice.mockResolvedValue({
            ...mockInvoiceData,
            tenant: { ...mockInvoiceData.tenant, brand_business_name: null },
        });
        render(<InvoicePage />);
        await waitFor(() => {
            expect(screen.getAllByText('Acme Bangladesh Ltd').length).toBeGreaterThan(0);
        });
    });
});
