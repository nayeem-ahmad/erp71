import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import NewPurchasePage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
    useSearchParams: () => searchParams,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCurrentUser: jest.fn(),
        getSuppliers: jest.fn(),
        getProduct: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        createPurchase: jest.fn(),
    },
}));

const COFFEE = {
    id: 'prod-1',
    name: 'Coffee Beans',
    sku: 'CB-001',
    price: '10.00',
    stocks: [{ quantity: 4 }, { quantity: 2 }],
};

describe('NewPurchasePage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getSuppliers as jest.Mock).mockResolvedValue([
            { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000', due_balance: 250 },
        ]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([COFFEE]);
        (api.getProduct as jest.Mock).mockResolvedValue(COFFEE);
        (api.createPurchase as jest.Mock).mockResolvedValue({
            id: 'purchase-2',
            purchase_number: 'PUR-00002',
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

    const renderPage = async () => {
        await act(async () => { render(<NewPurchasePage />); });
        await waitFor(() => expect(api.getSuppliers).toHaveBeenCalled());
    };

    const stageProduct = async () => {
        const search = screen.getByPlaceholderText(/search products/i);
        fireEvent.focus(search);
        fireEvent.change(search, { target: { value: 'coffee' } });
        await waitFor(() => screen.getAllByText('Coffee Beans'));
        fireEvent.click(screen.getAllByText('Coffee Beans')[0]);
    };

    it('stages a picked product at its cost before adding it to the receipt', async () => {
        await renderPage();
        await stageProduct();

        const costInput = screen.getByLabelText('Unit Cost') as HTMLInputElement;
        expect(costInput.value).toBe('10');
        // Stock on hand is summed across warehouses.
        expect(screen.getByText(/Available 6/)).toBeInTheDocument();
    });

    it('posts the purchase with the edited cost, quantity and supplier', async () => {
        await renderPage();

        const supplierSearch = screen.getByPlaceholderText(/Supplier/i);
        fireEvent.focus(supplierSearch);
        fireEvent.change(supplierSearch, { target: { value: 'Fresh' } });
        fireEvent.click(await screen.findByText('Fresh Farms'));

        await stageProduct();
        fireEvent.change(screen.getByLabelText('Unit Cost'), { target: { value: '12.5' } });
        fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        fireEvent.change(screen.getByLabelText('Freight'), { target: { value: '100' } });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(
                expect.objectContaining({
                    storeId: 'store-1',
                    supplierId: 'sup-1',
                    freightAmount: 100,
                    items: [{ productId: 'prod-1', quantity: 4, unitCost: 12.5 }],
                }),
            );
        });
        expect(push).toHaveBeenCalledWith('/purchases/list');
    });

    it('creates a supplier inline with the purchase', async () => {
        await renderPage();

        fireEvent.click(screen.getByTitle('New Supplier'));
        fireEvent.change(screen.getByPlaceholderText('Supplier name'), {
            target: { value: 'New Source' },
        });

        await stageProduct();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(
                expect.objectContaining({
                    supplierId: undefined,
                    newSupplier: expect.objectContaining({ name: 'New Source' }),
                }),
            );
        });
    });

    it('refuses to post an inline supplier with no name', async () => {
        await renderPage();

        fireEvent.click(screen.getByTitle('New Supplier'));
        await stageProduct();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        expect(api.createPurchase).not.toHaveBeenCalled();
    });

    it('counts a compound-unit product in its two parts', async () => {
        const sugar = {
            id: 'prod-2',
            name: 'Loose Sugar',
            sku: 'SUG',
            price: '0.12',
            unit_type: 'kg_g',
            stocks: [{ quantity: 50000 }],
        };
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([sugar]);
        await renderPage();

        const search = screen.getByPlaceholderText(/search products/i);
        fireEvent.focus(search);
        fireEvent.change(search, { target: { value: 'sugar' } });
        await waitFor(() => screen.getAllByText('Loose Sugar'));
        fireEvent.click(screen.getAllByText('Loose Sugar')[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        const row = screen.getByRole('cell', { name: 'Loose Sugar' }).closest('tr') as HTMLElement;
        // Unit cost, then the kg and g halves of the quantity.
        const [, kg, grams] = within(row).getAllByRole('spinbutton') as HTMLInputElement[];
        fireEvent.change(kg, { target: { value: '3' } });
        fireEvent.change(grams, { target: { value: '250' } });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: [expect.objectContaining({ productId: 'prod-2', quantity: 3250 })],
                }),
            );
        });
    });

    it('seeds the first line from ?productId= and returns to the products list', async () => {
        searchParams = new URLSearchParams('productId=prod-1&from=products');
        await renderPage();

        await waitFor(() => expect(api.getProduct).toHaveBeenCalledWith('prod-1'));
        await waitFor(() => expect(screen.getAllByText('Coffee Beans').length).toBeGreaterThan(0));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        await waitFor(() => expect(push).toHaveBeenCalledWith('/inventory/products'));
    });
});
