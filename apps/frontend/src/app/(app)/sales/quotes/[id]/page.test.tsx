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
import QuoteDetailsPage from './page';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
    useParams: jest.fn(() => ({ id: 'quote-1' })),
    useRouter: jest.fn(() => ({ push: pushMock })),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getQuotation: jest.fn(),
        updateQuotation: jest.fn(),
        deleteQuotation: jest.fn(),
        reviseQuotation: jest.fn(),
        convertQuotation: jest.fn(),
        updateQuotationStatus: jest.fn(),
        getCustomers: jest.fn(),
        getProducts: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: number) => `BDT ${v}`,
    formatDate: (v: string) => `DATE:${v}`,
}));

const mockQuote = {
    id: 'quote-1',
    quote_number: 'QUO-00001',
    version: 1,
    status: 'DRAFT',
    valid_until: '2026-12-31T00:00:00.000Z',
    total_amount: 1500,
    customer_id: 'cust-1',
    notes: 'Test note here',
    customer: {
        name: 'Test Customer',
        phone: '01711111111',
    },
    items: [
        {
            id: 'item-1',
            product_id: 'prod-1',
            quantity: 3,
            unit_price: '500',
            product: { name: 'Product Alpha', sku: 'SKU-001' },
        },
    ],
};

function getApi() {
    return require('@/lib/api').api;
}

function setEditMode(enabled: boolean) {
    const nav = require('next/navigation');
    nav.useSearchParams.mockReturnValue({
        get: (k: string) => (k === 'edit' && enabled ? 'true' : null),
    });
}

describe('QuoteDetailsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pushMock.mockReset();
        window.alert = jest.fn();
        window.confirm = jest.fn(() => true);
        window.print = jest.fn();
        setEditMode(false);

        const nav = require('next/navigation');
        nav.useRouter.mockReturnValue({ push: pushMock });
        nav.useParams.mockReturnValue({ id: 'quote-1' });

        const api = getApi();
        api.getQuotation.mockResolvedValue(mockQuote);
        api.updateQuotation.mockResolvedValue({ ...mockQuote });
        api.deleteQuotation.mockResolvedValue({ deleted: true });
        api.reviseQuotation.mockResolvedValue({ id: 'quote-2' });
        api.convertQuotation.mockResolvedValue({ id: 'order-1', order_number: 'ORD-00001' });
        api.updateQuotationStatus.mockResolvedValue({ ...mockQuote, status: 'SENT' });
        api.getCustomers.mockResolvedValue([{ id: 'cust-1', name: 'Test Customer' }]);
        api.getProducts.mockResolvedValue([
            { id: 'prod-2', name: 'Product Beta', sku: 'SKU-002', price: '750' },
        ]);
    });

    it('shows loading state initially', () => {
        const api = getApi();
        api.getQuotation.mockReturnValue(new Promise(() => {}));
        render(<QuoteDetailsPage />);
        expect(screen.getByText(/loading quote/i)).toBeInTheDocument();
    });

    it('renders quote details after loading', async () => {
        render(<QuoteDetailsPage />);
        await waitFor(() => {
            expect(screen.getAllByText('QUO-00001').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('Test Customer')).toBeInTheDocument();
        expect(screen.getByText('Product Alpha')).toBeInTheDocument();
    });

    it('shows "Quote not found" when API returns null', async () => {
        const api = getApi();
        api.getQuotation.mockResolvedValue(null);
        render(<QuoteDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText(/quote not found/i)).toBeInTheDocument();
        });
    });

    it('shows customer notes when present', async () => {
        render(<QuoteDetailsPage />);
        await waitFor(() => {
            expect(screen.getByText(/Test note here/)).toBeInTheDocument();
        });
    });

    it('shows "Mark as Sent" button for DRAFT status', async () => {
        render(<QuoteDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: enMessages.quotes.detail.markSent })).toBeInTheDocument();
        });
    });

    it('shows "Mark Accepted" and "Mark Rejected" for SENT status', async () => {
        const api = getApi();
        api.getQuotation.mockResolvedValue({ ...mockQuote, status: 'SENT' });
        render(<QuoteDetailsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: enMessages.quotes.detail.accept })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: enMessages.quotes.detail.reject })).toBeInTheDocument();
        });
    });

    it('does not show Revise or Convert when status is REVISED', async () => {
        const api = getApi();
        api.getQuotation.mockResolvedValue({ ...mockQuote, status: 'REVISED' });
        render(<QuoteDetailsPage />);
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /revise/i })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /convert to order/i })).not.toBeInTheDocument();
        });
    });

    it('calls updateQuotationStatus when "Mark as Sent" is clicked', async () => {
        const api = getApi();
        render(<QuoteDetailsPage />);
        await waitFor(() => screen.getByRole('button', { name: enMessages.quotes.detail.markSent }));
        fireEvent.click(screen.getByRole('button', { name: enMessages.quotes.detail.markSent }));
        await waitFor(() => {
            expect(api.updateQuotationStatus).toHaveBeenCalledWith('quote-1', 'SENT');
        });
    });

    it('calls deleteQuotation after confirmation', async () => {
        const api = getApi();
        render(<QuoteDetailsPage />);
        await waitFor(() => screen.getByRole('button', { name: /delete/i }));
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));
        await waitFor(() => {
            expect(api.deleteQuotation).toHaveBeenCalledWith('quote-1');
        });
        expect(pushMock).toHaveBeenCalledWith('/sales/quotes');
    });

    it('does not delete when confirm is cancelled', async () => {
        const api = getApi();
        window.confirm = jest.fn(() => false);
        render(<QuoteDetailsPage />);
        await waitFor(() => screen.getByRole('button', { name: /delete/i }));
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));
        // Confirm is false, so API should not be called
        expect(api.deleteQuotation).not.toHaveBeenCalled();
    });

    it('calls reviseQuotation and navigates to new quote', async () => {
        const api = getApi();
        render(<QuoteDetailsPage />);
        await waitFor(() => screen.getByRole('button', { name: /revise/i }));
        fireEvent.click(screen.getByRole('button', { name: /revise/i }));
        await waitFor(() => {
            expect(api.reviseQuotation).toHaveBeenCalledWith('quote-1');
        });
        expect(pushMock).toHaveBeenCalledWith('/sales/quotes/quote-2');
    });

    it('calls convertQuotation and navigates to new order', async () => {
        const api = getApi();
        render(<QuoteDetailsPage />);
        await waitFor(() => screen.getByRole('button', { name: /convert to order/i }));
        fireEvent.click(screen.getByRole('button', { name: /convert to order/i }));
        await waitFor(() => {
            expect(api.convertQuotation).toHaveBeenCalledWith('quote-1');
        });
        expect(pushMock).toHaveBeenCalledWith('/sales/orders/order-1');
    });

    it('navigates to edit mode when Edit button is clicked', async () => {
        render(<QuoteDetailsPage />);
        await waitFor(() => screen.getByRole('button', { name: /^edit$/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
        expect(pushMock).toHaveBeenCalledWith('/sales/quotes/quote-1?edit=true');
    });

    it('prints when Print PDF is clicked', async () => {
        render(<QuoteDetailsPage />);
        await waitFor(() => screen.getByRole('button', { name: /print pdf/i }));
        fireEvent.click(screen.getByRole('button', { name: /print pdf/i }));
        expect(window.print).toHaveBeenCalled();
    });

    describe('Edit mode', () => {
        beforeEach(() => {
            setEditMode(true);
        });

        it('shows edit mode banner and loads customers/products', async () => {
            const api = getApi();
            render(<QuoteDetailsPage />);
            await waitFor(() => {
                expect(screen.getByText(/edit mode/i)).toBeInTheDocument();
            });
            expect(api.getCustomers).toHaveBeenCalled();
            expect(api.getProducts).toHaveBeenCalled();
        });

        it('shows Save Changes button in edit mode', async () => {
            render(<QuoteDetailsPage />);
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
            });
        });

        it('shows product search input in edit mode', async () => {
            render(<QuoteDetailsPage />);
            await waitFor(() => {
                expect(screen.getByPlaceholderText(/search products by name or sku/i)).toBeInTheDocument();
            });
        });

        it('shows product search dropdown when typing', async () => {
            render(<QuoteDetailsPage />);
            await waitFor(() => screen.getByPlaceholderText(/search products by name or sku/i));
            fireEvent.change(screen.getByPlaceholderText(/search products by name or sku/i), {
                target: { value: 'Beta' },
            });
            await waitFor(() => {
                expect(screen.getByText('Product Beta')).toBeInTheDocument();
            });
        });

        it('calls updateQuotation on save', async () => {
            const api = getApi();
            render(<QuoteDetailsPage />);
            // Wait for quote to load and edit items to populate (button becomes enabled)
            await waitFor(() => {
                const btn = screen.getByRole('button', { name: /save changes/i });
                expect(btn).not.toBeDisabled();
            });
            fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
            await waitFor(() => {
                expect(api.updateQuotation).toHaveBeenCalledWith('quote-1', expect.any(Object));
            });
            expect(pushMock).toHaveBeenCalledWith('/sales/quotes/quote-1');
        });

        it('cancel navigates back to view mode', async () => {
            render(<QuoteDetailsPage />);
            await waitFor(() => screen.getByRole('button', { name: /cancel/i }));
            fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
            expect(pushMock).toHaveBeenCalledWith('/sales/quotes/quote-1');
        });

        it('shows customer select dropdown in edit mode', async () => {
            render(<QuoteDetailsPage />);
            await waitFor(() => {
                expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
            });
        });

        it('shows valid until date input in edit mode', async () => {
            render(<QuoteDetailsPage />);
            await waitFor(() => {
                expect(screen.getByDisplayValue('2026-12-31')).toBeInTheDocument();
            });
        });
    });
});
