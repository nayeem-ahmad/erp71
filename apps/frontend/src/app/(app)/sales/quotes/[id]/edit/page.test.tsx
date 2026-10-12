import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import EditQuotationPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
    useParams: () => ({ id: 'quote-1' }),
    useSearchParams: () => ({ get: () => null }),
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getCurrentUser: jest.fn(),
        getCustomers: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        getQuotation: jest.fn(),
        updateQuotation: jest.fn(),
    },
}));

describe('EditQuotationPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getCustomers as jest.Mock).mockResolvedValue([]);
        (api.getQuotation as jest.Mock).mockResolvedValue({
            id: 'quote-1',
            quote_number: 'Q-1001',
            doc_kind: 'QUOTE',
            customer_id: 'cust-1',
            customer: { id: 'cust-1', name: 'Rahim Ahmed', phone: '01700000001' },
            valid_until: '2026-12-31T00:00:00.000Z',
            notes: 'Handle with care',
            prices_include_vat: true,
            items: [{ product_id: 'prod-1', quantity: 3, unit_price: '250.00', product: { id: 'prod-1', name: 'Rice 5kg' } }],
        });
        (api.updateQuotation as jest.Mock).mockResolvedValue({ id: 'quote-1' });
        Object.defineProperty(window, 'localStorage', {
            value: { getItem: jest.fn(() => 'store-1'), setItem: jest.fn(), removeItem: jest.fn() },
            writable: true,
        });
    });

    it('loads the quotation into the entry form and saves with an update', async () => {
        await act(async () => { render(<EditQuotationPage />); });

        await waitFor(() => expect(screen.getByText('Edit Quotation Q-1001')).toBeInTheDocument());
        expect(screen.getByText('Rice 5kg')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Handle with care')).toBeInTheDocument();
        expect(screen.getByDisplayValue('2026-12-31')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save Quotation' }));
        });

        await waitFor(() => expect(api.updateQuotation).toHaveBeenCalledTimes(1));
        const [id, payload] = (api.updateQuotation as jest.Mock).mock.calls[0];
        expect(id).toBe('quote-1');
        expect(payload).toMatchObject({
            customerId: 'cust-1',
            validUntil: '2026-12-31',
            notes: 'Handle with care',
            totalAmount: 750,
            items: [{ productId: 'prod-1', quantity: 3, unitPrice: 250 }],
        });
        expect(push).toHaveBeenCalledWith('/sales/quotes/quote-1');
    });
});
