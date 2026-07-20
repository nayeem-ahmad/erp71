import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewSalesOrderPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCurrentUser: jest.fn(),
        getCustomers: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        createOrder: jest.fn(),
    },
}));

const addRiceToCart = async () => {
    const searchInput = screen.getByPlaceholderText(/Add product/i);
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'Rice' } });
    await waitFor(() => screen.getByText('Rice 5kg'));
    fireEvent.click(screen.getByText('Rice 5kg'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
};

describe('NewSalesOrderPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Rahim Ahmed', phone: '01700000001' },
        ]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([
            { id: 'prod-1', name: 'Rice 5kg', sku: 'R5KG', price: '250.00', stocks: [{ quantity: 4 }] },
        ]);
        (api.createOrder as jest.Mock).mockResolvedValue({ id: 'order-1' });

        Object.defineProperty(window, 'localStorage', {
            value: { getItem: jest.fn(() => 'store-1'), setItem: jest.fn(), removeItem: jest.fn() },
            writable: true,
        });
    });

    it('renders on the shared entry shell with a Delivery Date field', async () => {
        await act(async () => { render(<NewSalesOrderPage />); });

        expect(screen.getByText('New Sales Order')).toBeInTheDocument();
        expect(screen.getByText('Delivery Date')).toBeInTheDocument();
        expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
    });

    it('omits the note box, which CreateSalesOrderDto has no field for', async () => {
        await act(async () => { render(<NewSalesOrderPage />); });

        expect(screen.queryByPlaceholderText(/Note/i)).not.toBeInTheDocument();
    });

    it('hides the fields a sales order cannot store', async () => {
        await act(async () => { render(<NewSalesOrderPage />); });

        expect(screen.queryByText('Transport')).not.toBeInTheDocument();
        expect(screen.queryByText('Disc %')).not.toBeInTheDocument();
        expect(document.querySelector('input[type="datetime-local"]')).not.toBeInTheDocument();
    });

    it('submits the order as a DRAFT with the chosen delivery date', async () => {
        await act(async () => { render(<NewSalesOrderPage />); });
        await addRiceToCart();

        fireEvent.change(document.querySelector('input[type="date"]')!, {
            target: { value: '2026-12-31' },
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Order/i }));
        });

        await waitFor(() => {
            expect(api.createOrder).toHaveBeenCalledWith(
                expect.objectContaining({
                    storeId: 'store-1',
                    status: 'DRAFT',
                    deliveryDate: '2026-12-31',
                    totalAmount: 250,
                    items: [{ productId: 'prod-1', quantity: 1, priceAtOrder: 250 }],
                }),
            );
        });
        expect(push).toHaveBeenCalledWith('/sales/orders');
    });

    it('keeps the submit button disabled until an item is added', async () => {
        await act(async () => { render(<NewSalesOrderPage />); });

        expect(screen.getByRole('button', { name: /Create Order/i })).toBeDisabled();
        await addRiceToCart();
        expect(screen.getByRole('button', { name: /Create Order/i })).toBeEnabled();
    });

    it('surfaces a failed create and stays on the page', async () => {
        (api.createOrder as jest.Mock).mockRejectedValue(new Error('Server error'));
        await act(async () => { render(<NewSalesOrderPage />); });
        await addRiceToCart();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Order/i }));
        });

        await waitFor(() => expect(api.createOrder).toHaveBeenCalled());
        expect(push).not.toHaveBeenCalled();
    });
});
