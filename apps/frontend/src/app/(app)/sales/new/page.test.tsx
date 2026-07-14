import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewSalePage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getSalesSettings: jest.fn(),
        getCurrentUser: jest.fn(),
        createNewSale: jest.fn(),
        getCustomers: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

describe('NewSalePage — editable sale date', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getSalesSettings as jest.Mock).mockResolvedValue({ tenant: { default_vat_rate: 0 } });
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getCustomers as jest.Mock).mockResolvedValue([]);
        (api.getPaymentMethods as jest.Mock).mockResolvedValue([]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([
            { id: 'prod-1', name: 'Rice 5kg', sku: 'R5KG', price: '100.00' },
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
