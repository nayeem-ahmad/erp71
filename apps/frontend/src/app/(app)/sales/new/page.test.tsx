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
