import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewSalePage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    // The print-header hook resolves the tenant's print template on mount.
    fetchWithAuth: jest.fn().mockResolvedValue(null),
    api: {
        getSalesSettings: jest.fn(),
        getCurrentUser: jest.fn(),
        createNewSale: jest.fn(),
        getCustomers: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        getPaymentMethods: jest.fn(),
        getQuotation: jest.fn(),
        getOrder: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const mockReplace = jest.fn();
let searchParams: Record<string, string> = {};

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace }),
    usePathname: () => '/sales/new',
    useSearchParams: () => ({ get: (key: string) => searchParams[key] ?? null }),
    useParams: () => ({}),
}));

/** `?quotationId=…` / `?salesOrderId=…`, as the convert buttons pass them. */
const setSearchParams = (next: Record<string, string> = {}) => {
    searchParams = next;
};

describe('NewSalePage — editable sale date', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSearchParams();
        (api.getSalesSettings as jest.Mock).mockResolvedValue({ tenant: { default_vat_rate: 0 } });
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getCustomers as jest.Mock).mockResolvedValue([]);
        (api.getPaymentMethods as jest.Mock).mockResolvedValue([]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([
            {
                id: 'prod-1',
                name: 'Rice 5kg',
                sku: 'R5KG',
                price: '100.00',
                stocks: [{ quantity: 7 }, { quantity: 5 }],
            },
        ]);
        (api.createNewSale as jest.Mock).mockResolvedValue({ serial_number: 'S-00001' });

        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: jest.fn(() => 'store-1'),
                setItem: jest.fn(),
                removeItem: jest.fn(),
            },
            writable: true,
        });
    });

    it('renders an editable datetime-local input seeded to now', async () => {
        await act(async () => {
            render(<NewSalePage />);
        });
        await waitFor(() => expect(api.getSalesSettings).toHaveBeenCalled());

        const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
        expect(dateInput).toBeInTheDocument();
        expect(dateInput?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('sends the chosen sale date/time when creating a sale', async () => {
        await act(async () => {
            render(<NewSalePage />);
        });
        await waitFor(() => expect(api.getSalesSettings).toHaveBeenCalled());

        // Edit the sale date
        const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
        fireEvent.change(dateInput, { target: { value: '2026-01-15T10:30' } });
        expect(dateInput.value).toBe('2026-01-15T10:30');

        // Add a product to the cart
        const searchInput = screen.getByPlaceholderText(/Add product/i);
        fireEvent.focus(searchInput);
        fireEvent.change(searchInput, { target: { value: 'Rice' } });
        await waitFor(() => screen.getByText('Rice 5kg'));
        fireEvent.click(screen.getByText('Rice 5kg'));
        // Picking a product stages it — confirm price/qty to add it to the cart.
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        // Settle payment in full via Cash (falls back to generic methods since
        // getPaymentMethods resolves empty)
        const cashInput = await screen.findByLabelText('Cash amount');
        fireEvent.change(cashInput, { target: { value: '100' } });

        // Submit
        await act(async () => {
            fireEvent.click(screen.getByText('Create Sale'));
        });

        await waitFor(() => {
            expect(api.createNewSale).toHaveBeenCalledWith(
                expect.objectContaining({ saleDate: expect.stringContaining('2026-01-15') }),
            );
        });
    });
});

describe('NewSalePage — product staging and drafts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSearchParams();
        (api.getSalesSettings as jest.Mock).mockResolvedValue({ tenant: { default_vat_rate: 0 } });
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getCustomers as jest.Mock).mockResolvedValue([]);
        (api.getPaymentMethods as jest.Mock).mockResolvedValue([]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([
            {
                id: 'prod-1',
                name: 'Rice 5kg',
                sku: 'R5KG',
                price: '100.00',
                stocks: [{ quantity: 7 }, { quantity: 5 }],
            },
        ]);
        (api.createNewSale as jest.Mock).mockResolvedValue({
            serial_number: 'S-00001',
            reference_number: '2607-001',
        });

        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: jest.fn(() => 'store-1'),
                setItem: jest.fn(),
                removeItem: jest.fn(),
            },
            writable: true,
        });
    });

    const stageProduct = async () => {
        const searchInput = screen.getByPlaceholderText(/Add product/i);
        fireEvent.focus(searchInput);
        fireEvent.change(searchInput, { target: { value: 'Rice' } });
        await waitFor(() => screen.getByText('Rice 5kg'));
        fireEvent.click(screen.getByText('Rice 5kg'));
    };

    it('stages the picked product with its price and available stock', async () => {
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getSalesSettings).toHaveBeenCalled());

        await stageProduct();

        // Stock is summed across warehouses
        expect(screen.getByText(/Available 12/)).toBeInTheDocument();
        const priceInput = screen.getByLabelText('Unit Price') as HTMLInputElement;
        expect(priceInput.value).toBe('100');
    });

    it('adds the item with the edited unit price and quantity', async () => {
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getSalesSettings).toHaveBeenCalled());

        await stageProduct();
        fireEvent.change(screen.getByLabelText('Unit Price'), { target: { value: '90' } });
        fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        // 90 × 3 line total — the cell splits "৳" and the amount into separate
        // text nodes, so match on the cell's combined text.
        const lineTotal = screen
            .getAllByRole('cell')
            .find((cell) => cell.textContent === '৳270.00');
        expect(lineTotal).toBeDefined();
    });

    it('selects a product with arrow keys and Enter', async () => {
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getSalesSettings).toHaveBeenCalled());

        const searchInput = screen.getByPlaceholderText(/Add product/i);
        fireEvent.focus(searchInput);
        fireEvent.change(searchInput, { target: { value: 'Rice' } });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
        fireEvent.keyDown(searchInput, { key: 'Enter' });

        expect(screen.getByLabelText('Unit Price')).toBeInTheDocument();
    });

    it('saves a draft without requiring payment', async () => {
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getSalesSettings).toHaveBeenCalled());

        await stageProduct();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
        });

        await waitFor(() => {
            expect(api.createNewSale).toHaveBeenCalledWith(
                expect.objectContaining({ isDraft: true, amountPaid: 0 }),
            );
        });
    });
});

describe('NewSalePage — converting a quotation or sales order', () => {
    const quotation = {
        id: 'quote-1',
        quote_number: 'QUO-00001',
        currency: 'BDT',
        exchange_rate: null,
        notes: 'Deliver before Eid',
        customer_id: 'cust-1',
        customer: { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: '0' },
        items: [
            { product_id: 'prod-1', quantity: 2, unit_price: '150', product: { name: 'Rice 5kg' } },
        ],
    };

    const salesOrder = {
        id: 'order-1',
        order_number: 'ORD-00001',
        amount_paid: '500',
        customer_id: 'cust-1',
        customer: { id: 'cust-1', name: 'Alice Corp', phone: '01700000001', due_balance: '0' },
        items: [
            { product_id: 'prod-1', quantity: 3, price_at_order: '200', product: { name: 'Rice 5kg' } },
        ],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        setSearchParams();
        (api.getSalesSettings as jest.Mock).mockResolvedValue({ tenant: { default_vat_rate: 0 } });
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getCustomers as jest.Mock).mockResolvedValue([]);
        (api.getPaymentMethods as jest.Mock).mockResolvedValue([]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([]);
        (api.getQuotation as jest.Mock).mockResolvedValue(quotation);
        (api.getOrder as jest.Mock).mockResolvedValue(salesOrder);
        (api.createNewSale as jest.Mock).mockResolvedValue({ serial_number: 'S-00001' });

        Object.defineProperty(window, 'localStorage', {
            value: { getItem: jest.fn(() => 'store-1'), setItem: jest.fn(), removeItem: jest.fn() },
            writable: true,
        });
    });

    it('loads the quotation lines, customer and note into the entry form', async () => {
        setSearchParams({ quotationId: 'quote-1' });
        await act(async () => { render(<NewSalePage />); });

        await waitFor(() => expect(api.getQuotation).toHaveBeenCalledWith('quote-1'));

        expect(screen.getByText('Rice 5kg')).toBeInTheDocument();
        expect(screen.getByText('Alice Corp')).toBeInTheDocument();
        expect(screen.getByLabelText('Note')).toHaveValue('Deliver before Eid');
        // 2 × 150
        const lineTotal = screen.getAllByRole('cell').find((cell) => cell.textContent === '৳300.00');
        expect(lineTotal).toBeDefined();
    });

    it('names the quotation it is converting and links back to it', async () => {
        setSearchParams({ quotationId: 'quote-1' });
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getQuotation).toHaveBeenCalled());

        expect(screen.getByRole('link', { name: 'QUO-00001' }))
            .toHaveAttribute('href', '/sales/quotes/quote-1');
    });

    it('sends quotationId with the sale so the invoice records its source', async () => {
        setSearchParams({ quotationId: 'quote-1' });
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getQuotation).toHaveBeenCalled());

        const cashInput = await screen.findByLabelText('Cash amount');
        fireEvent.change(cashInput, { target: { value: '300' } });

        await act(async () => { fireEvent.click(screen.getByText('Create Sale')); });

        await waitFor(() => {
            expect(api.createNewSale).toHaveBeenCalledWith(
                expect.objectContaining({ quotationId: 'quote-1', salesOrderId: undefined }),
            );
        });
    });

    it('translates a foreign-currency proforma at the rate written on it', async () => {
        (api.getQuotation as jest.Mock).mockResolvedValue({
            ...quotation,
            currency: 'USD',
            exchange_rate: '120',
            items: [{ product_id: 'prod-1', quantity: 2, unit_price: '10', product: { name: 'Rice 5kg' } }],
        });
        setSearchParams({ quotationId: 'quote-1' });
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getQuotation).toHaveBeenCalled());

        // 2 × (10 USD × 120)
        const lineTotal = screen.getAllByRole('cell').find((cell) => cell.textContent === '৳2400.00');
        expect(lineTotal).toBeDefined();
    });

    it('refuses a foreign-currency proforma that carries no exchange rate', async () => {
        const { toast } = require('@/lib/toast');
        (api.getQuotation as jest.Mock).mockResolvedValue({
            ...quotation,
            currency: 'USD',
            exchange_rate: null,
        });
        setSearchParams({ quotationId: 'quote-1' });
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getQuotation).toHaveBeenCalled());

        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('no exchange rate'));
        expect(screen.queryByText('Rice 5kg')).not.toBeInTheDocument();
    });

    it('loads a sales order and sends salesOrderId with the sale', async () => {
        setSearchParams({ salesOrderId: 'order-1' });
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getOrder).toHaveBeenCalledWith('order-1'));

        // 3 × 200
        const lineTotal = screen.getAllByRole('cell').find((cell) => cell.textContent === '৳600.00');
        expect(lineTotal).toBeDefined();
        // Deposits already taken on the order are surfaced, not silently applied.
        expect(screen.getByText(/Deposits already collected/)).toBeInTheDocument();

        const cashInput = await screen.findByLabelText('Cash amount');
        fireEvent.change(cashInput, { target: { value: '600' } });

        await act(async () => { fireEvent.click(screen.getByText('Create Sale')); });

        await waitFor(() => {
            expect(api.createNewSale).toHaveBeenCalledWith(
                expect.objectContaining({ salesOrderId: 'order-1', quotationId: undefined }),
            );
        });
    });

    it('drops the source document once its sale is saved', async () => {
        setSearchParams({ quotationId: 'quote-1' });
        await act(async () => { render(<NewSalePage />); });
        await waitFor(() => expect(api.getQuotation).toHaveBeenCalled());

        const cashInput = await screen.findByLabelText('Cash amount');
        fireEvent.change(cashInput, { target: { value: '300' } });
        await act(async () => { fireEvent.click(screen.getByText('Create Sale')); });

        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sales/new'));
    });
});
