jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, string | number> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
// `?saleId=` — set when the exchange is started from a sale.
let saleIdParam: string | null = null;
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: jest.fn() }),
    useSearchParams: () => ({ get: (key: string) => (key === 'saleId' ? saleIdParam : null) }),
}));

jest.mock('@/lib/toast', () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/document-entry/ProductSearch', () => ({
    __esModule: true,
    default: ({ initialPriceOf, initialQuantity, onProductSelect }: any) => (
        <button
            type="button"
            onClick={() => onProductSelect(
                { id: 'shirt-l', name: 'Shirt L', price: 999 },
                {
                    quantity: initialQuantity ?? 1,
                    price: initialPriceOf?.({ id: 'shirt-l' }),
                    availableQty: 4,
                },
            )}
        >
            Pick replacement
        </button>
    ),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewExchangePage from './page';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getCurrentUser: jest.fn(),
        getSalesList: jest.fn(),
        getSale: jest.fn(),
        createExchange: jest.fn(),
    },
}));

const SALE = {
    id: 'sale-1',
    serial_number: 'S-00001',
    status: 'COMPLETED',
    total_amount: '100.00',
    amount_paid: '100.00',
    payments: [{ payment_method: 'Cash', created_at: '2026-10-01T00:00:00.000Z' }],
    items: [
        {
            id: 'line-1',
            quantity: 2,
            price_at_sale: '100.00',
            product: { name: 'Shirt M' },
            returns: [],
            exchangeLines: [],
        },
        {
            id: 'line-closed',
            quantity: 1,
            price_at_sale: '40.00',
            product: { name: 'Cap' },
            returns: [],
            exchangeLines: [{ returned_quantity: 1 }],
        },
    ],
};

describe('NewExchangePage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        saleIdParam = null;
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Cashier' });
        (api.getSalesList as jest.Mock).mockResolvedValue({
            items: [{ id: 'sale-1', serial_number: 'S-00001' }],
        });
        (api.getSale as jest.Mock).mockResolvedValue(SALE);
    });

    async function findInvoice() {
        fireEvent.change(screen.getByPlaceholderText('Invoice serial'), { target: { value: 'S-00001' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Find invoice' }));
        });
        await screen.findByText('Shirt M');
    }

    it('loads an invoice by serial and starts the replacement at the price they paid', async () => {
        render(<NewExchangePage />);
        await findInvoice();

        expect(screen.queryByText('Cap')).not.toBeInTheDocument();
        expect(screen.getByText('Even swap. No money moves.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Pick replacement' }));

        expect(screen.getByText('Shirt L')).toBeInTheDocument();
        expect(screen.getByDisplayValue('100')).toBeInTheDocument();
        expect(screen.getAllByDisplayValue('2')).toHaveLength(2);
        expect(screen.getByText('Even swap. No money moves.')).toBeInTheDocument();
    });

    it('says the customer pays cash when the replacement price is higher', async () => {
        render(<NewExchangePage />);
        await findInvoice();
        fireEvent.click(screen.getByRole('button', { name: 'Pick replacement' }));

        const price = screen.getByDisplayValue('100');
        fireEvent.change(price, { target: { value: '150' } });

        expect(screen.getByText('Customer pays ৳ 100.00 by cash.')).toBeInTheDocument();
    });

    it('opens the slip after a successful post', async () => {
        (api.createExchange as jest.Mock).mockResolvedValue({ id: 'ex-9' });
        render(<NewExchangePage />);
        await findInvoice();
        fireEvent.click(screen.getByRole('button', { name: 'Pick replacement' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Post exchange' }));
        });
        await waitFor(() => {
            expect(push).toHaveBeenCalledWith('/sales/exchanges/ex-9?print=1');
        });
    });

    it('refuses a draft sale', async () => {
        (api.getSale as jest.Mock).mockResolvedValue({ ...SALE, status: 'DRAFT' });
        render(<NewExchangePage />);
        fireEvent.change(screen.getByPlaceholderText('Invoice serial'), { target: { value: 'S-00001' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Find invoice' }));
        });
        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('A draft or cancelled sale cannot be exchanged.');
        });
    });

    it('loads the sale named in the URL without asking for its serial', async () => {
        saleIdParam = 'sale-1';
        render(<NewExchangePage />);

        expect(await screen.findByText('Shirt M')).toBeInTheDocument();
        expect(api.getSale).toHaveBeenCalledWith('sale-1');
        expect(api.getSalesList).not.toHaveBeenCalled();
        expect(screen.getByPlaceholderText('Invoice serial')).toHaveValue('S-00001');
    });
});
