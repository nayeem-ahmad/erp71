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
        getProductRateHistory: jest.fn(),
        createPurchase: jest.fn(),
        getPurchase: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getInventorySettings: jest.fn(),
    },
}));

const COFFEE = {
    id: 'prod-1',
    name: 'Coffee Beans',
    sku: 'CB-001',
    price: '10.00',
    stocks: [{ quantity: 4 }, { quantity: 2 }],
};

const MAIN_WAREHOUSE = {
    id: 'wh-main',
    name: 'Main Store',
    code: 'WH-MAIN',
    store_id: 'store-1',
    is_default: true,
    is_active: true,
};
const ANNEX_WAREHOUSE = {
    id: 'wh-annex',
    name: 'Annex',
    code: 'WH-ANNEX',
    store_id: 'store-1',
    is_default: false,
    is_active: true,
};

/** The rate hint renders on every staged product; most cases don't exercise it. */
const EMPTY_RATE_HISTORY = { type: 'purchase', forParty: [], recent: [], summary: null };

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
        (api.getProductRateHistory as jest.Mock).mockResolvedValue(EMPTY_RATE_HISTORY);
        (api.createPurchase as jest.Mock).mockResolvedValue({
            id: 'purchase-2',
            purchase_number: 'PUR-00002',
        });
        // One warehouse by default — which is the shape of almost every tenant,
        // and the case where no picker must appear at all.
        (api.getInventoryWarehouses as jest.Mock).mockResolvedValue([MAIN_WAREHOUSE]);
        (api.getInventorySettings as jest.Mock).mockResolvedValue({ default_purchase_warehouse_id: null });

        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: jest.fn(() => 'store-1'),
                setItem: jest.fn(),
                removeItem: jest.fn(),
            },
            writable: true,
        });
        // The active branch really lives in sessionStorage (it is per tab), and
        // jest.setup clears storage between tests. Seeding it directly beats
        // relying on the one-shot localStorage bootstrap, which only runs for
        // whichever test happens to read the workspace first.
        window.sessionStorage.setItem('store_id', 'store-1');
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
                    items: [
                        { productId: 'prod-1', quantity: 4, unitCost: 12.5, warehouseId: undefined },
                    ],
                }),
            );
        });
        expect(push).toHaveBeenCalledWith('/purchases/list');
    });

    it('hides the warehouse controls entirely for a one-warehouse shop', async () => {
        await renderPage();

        expect(screen.queryByLabelText('Warehouse')).not.toBeInTheDocument();
        expect(screen.queryByText('Per-line warehouse')).not.toBeInTheDocument();
    });

    it('posts to the chosen warehouse, and per line once the column is on', async () => {
        (api.getInventoryWarehouses as jest.Mock).mockResolvedValue([MAIN_WAREHOUSE, ANNEX_WAREHOUSE]);
        await renderPage();

        // Opens on the branch default rather than blank, so the strip states
        // where the goods are going before anything is typed.
        const picker = await screen.findByLabelText('Warehouse');
        expect((picker as HTMLSelectElement).value).toBe('wh-main');

        await stageProduct();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        fireEvent.click(screen.getByLabelText('Per-line warehouse'));
        fireEvent.change(screen.getByLabelText('Warehouse — Coffee Beans'), {
            target: { value: 'wh-annex' },
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(
                expect.objectContaining({
                    warehouseId: 'wh-main',
                    items: [expect.objectContaining({ warehouseId: 'wh-annex' })],
                }),
            );
        });
    });

    it('does not post a line override the user cannot see', async () => {
        // Turning the column off is how a user undoes a split, so the override
        // it leaves behind must not still reach the server.
        (api.getInventoryWarehouses as jest.Mock).mockResolvedValue([MAIN_WAREHOUSE, ANNEX_WAREHOUSE]);
        await renderPage();
        await screen.findByLabelText('Warehouse');

        await stageProduct();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        fireEvent.click(screen.getByLabelText('Per-line warehouse'));
        fireEvent.change(screen.getByLabelText('Warehouse — Coffee Beans'), {
            target: { value: 'wh-annex' },
        });
        fireEvent.click(screen.getByLabelText('Per-line warehouse'));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: [expect.objectContaining({ warehouseId: undefined })],
                }),
            );
        });
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

    it('copies an existing purchase from ?duplicate= and posts it as a new one', async () => {
        (api.getPurchase as jest.Mock).mockResolvedValue({
            id: 'purchase-1',
            purchase_number: 'PUR-00001',
            supplier_id: 'sup-1',
            supplier: { id: 'sup-1', name: 'Fresh Farms', phone: '01710000000', due_balance: 250 },
            notes: 'Weekly beans',
            tax_amount: '0',
            discount_amount: '0',
            freight_amount: '100',
            items: [
                { product_id: 'prod-1', quantity: 4, unit_cost: '12.50', product: { name: 'Coffee Beans' } },
            ],
        });
        searchParams = new URLSearchParams('duplicate=purchase-1');
        await renderPage();

        await waitFor(() => expect(api.getPurchase).toHaveBeenCalledWith('purchase-1'));
        await waitFor(() => expect(screen.getAllByText('Coffee Beans').length).toBeGreaterThan(0));

        // The source is named, and its supplier, charges and note came across.
        expect(screen.getAllByText(/PUR-00001/).length).toBeGreaterThan(0);
        expect(screen.getByLabelText('Notes')).toHaveValue('Weekly beans');
        expect(screen.getByLabelText('Freight')).toHaveValue(100);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /post purchase/i }));
        });

        await waitFor(() => {
            expect(api.createPurchase).toHaveBeenCalledWith(expect.objectContaining({
                supplierId: 'sup-1',
                freightAmount: 100,
                notes: 'Weekly beans',
                items: [{ productId: 'prod-1', quantity: 4, unitCost: 12.5 }],
            }));
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
