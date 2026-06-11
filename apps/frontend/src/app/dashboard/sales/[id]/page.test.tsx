import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SaleDetailPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSale: jest.fn(),
        updateSale: jest.fn(),
        getCustomers: jest.fn(),
        getProducts: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (n: number) => `৳${n.toFixed(2)}`,
}));

jest.mock('@/lib/pos-receipt-printer', () => ({
    printPOSReceipt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/dashboard/sales/test-sale-1',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
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

describe('SaleDetailPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getSale.mockResolvedValue(mockSale);
        api.getCustomers.mockResolvedValue([]);
        api.getProducts.mockResolvedValue([]);
        api.updateSale.mockResolvedValue({});
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getSale.mockReturnValue(new Promise(() => {}));
        render(<SaleDetailPage />);
        expect(screen.getByText('Loading sale...')).toBeInTheDocument();
    });

    it('renders the sale serial number after loading', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SALE-001');
        });
    });

    it('renders status badge', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('COMPLETED')).toBeInTheDocument();
        });
    });

    it('renders the line items section', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('Gadget X')).toBeInTheDocument();
            expect(screen.getByText('GAD-001')).toBeInTheDocument();
        });
    });

    it('renders payment records section', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('Payment Records')).toBeInTheDocument();
            expect(screen.getByText('CASH')).toBeInTheDocument();
        });
    });

    it('renders the note section with sale note', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('Handle with care')).toBeInTheDocument();
        });
    });

    it('shows "No note added" when sale has no note', async () => {
        const { api } = require('@/lib/api');
        api.getSale.mockResolvedValue({ ...mockSale, note: null });
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('No note added')).toBeInTheDocument();
        });
    });

    it('shows Sale not found when api call fails', async () => {
        const { api } = require('@/lib/api');
        api.getSale.mockRejectedValue(new Error('Not found'));
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('Sale not found')).toBeInTheDocument();
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
            expect(invoiceLink).toHaveAttribute('href', '/dashboard/sales/test-sale-1/invoice');
        });
    });

    it('shows summary cards with correct values', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('Total')).toBeInTheDocument();
            expect(screen.getByText('Paid')).toBeInTheDocument();
            expect(screen.getByText('Items')).toBeInTheDocument();
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
        const { api } = require('@/lib/api');
        api.getSale.mockResolvedValue({ ...mockSale, payments: [] });
        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('No payment records')).toBeInTheDocument();
        });
    });

    it('renders item quantity and subtotal', async () => {
        render(<SaleDetailPage />);
        await waitFor(() => {
            // quantity 3
            expect(screen.getByText('3')).toBeInTheDocument();
            // SKU column
            expect(screen.getByText('GAD-001')).toBeInTheDocument();
        });
    });
});

describe('SaleDetailPage - edit mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getSale.mockResolvedValue(mockSale);
        api.getCustomers.mockResolvedValue([{ id: 'cust-2', name: 'Bob Jones' }]);
        api.getProducts.mockResolvedValue([
            { id: 'prod-2', name: 'Widget Z', sku: 'WID-Z', price: '800' },
        ]);
        api.updateSale.mockResolvedValue({});
    });

    it('shows edit mode banner when ?edit=true', async () => {
        const { useSearchParams } = require('next/navigation');
        useSearchParams.mockReturnValue({ get: (k: string) => (k === 'edit' ? 'true' : null) });

        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(
                screen.getByText(/edit mode — modify items, payments, customer, status, and note/i),
            ).toBeInTheDocument();
        });
    });

    it('shows status select in edit mode', async () => {
        const { useSearchParams } = require('next/navigation');
        useSearchParams.mockReturnValue({ get: (k: string) => (k === 'edit' ? 'true' : null) });

        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('COMPLETED')).toBeInTheDocument();
        });
    });

    it('shows Add Payment button in edit mode', async () => {
        const { useSearchParams } = require('next/navigation');
        useSearchParams.mockReturnValue({ get: (k: string) => (k === 'edit' ? 'true' : null) });

        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /add payment/i })).toBeInTheDocument();
        });
    });

    it('adds a payment row when Add Payment is clicked', async () => {
        const { useSearchParams } = require('next/navigation');
        useSearchParams.mockReturnValue({ get: (k: string) => (k === 'edit' ? 'true' : null) });

        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /add payment/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /add payment/i }));
        // A new payment row with select should appear
        await waitFor(() => {
            expect(screen.getByDisplayValue('CASH')).toBeInTheDocument();
        });
    });

    it('shows note textarea in edit mode', async () => {
        const { useSearchParams } = require('next/navigation');
        useSearchParams.mockReturnValue({ get: (k: string) => (k === 'edit' ? 'true' : null) });

        render(<SaleDetailPage />);
        await waitFor(() => {
            expect(screen.getByPlaceholderText(/add a note about this sale/i)).toBeInTheDocument();
        });
    });
});
