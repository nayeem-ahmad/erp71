import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewSalesReturnPage from './page';
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
        getSalesList: jest.fn(),
        getSale: jest.fn(),
        createReturn: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getInventorySettings: jest.fn(),
    },
}));

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

const SALE = {
    id: 'sale-1',
    store_id: 'store-1',
    serial_number: 'S-00001',
    items: [
        {
            id: 'line-1',
            quantity: 5,
            price_at_sale: '100.00',
            product: { name: 'Rice 5kg' },
            returns: [{ quantity: 2 }],
        },
        {
            id: 'line-2',
            quantity: 3,
            price_at_sale: '50.00',
            product: { name: 'Oil 1L' },
            returns: [{ quantity: 3 }],
        },
    ],
};

const findSale = async (serial = 'S-00001') => {
    fireEvent.change(screen.getByPlaceholderText(/Sale serial number/i), {
        target: { value: serial },
    });
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Find/i }));
    });
};

describe('NewSalesReturnPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getSalesList as jest.Mock).mockResolvedValue({
            items: [{ id: 'sale-1', serial_number: 'S-00001' }],
            total: 1, page: 1, limit: 20, pages: 1,
        });
        (api.getSale as jest.Mock).mockResolvedValue(SALE);
        (api.createReturn as jest.Mock).mockResolvedValue({ id: 'return-1' });
        // One warehouse — the shape of almost every tenant, and the case
        // where no picker must appear at all.
        (api.getInventoryWarehouses as jest.Mock).mockResolvedValue([MAIN_WAREHOUSE]);
        (api.getInventorySettings as jest.Mock).mockResolvedValue({});
    });

    it('renders the sale lookup instead of a product search', async () => {
        await act(async () => { render(<NewSalesReturnPage />); });

        expect(screen.getByText('New Sales Return')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Sale serial number/i)).toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/Add product/i)).not.toBeInTheDocument();
    });

    it('loads only the still-returnable lines, capped at the returnable quantity', async () => {
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        // line-1: 5 sold − 2 already returned = 3 returnable, seeded at the cap.
        expect(await screen.findByText('Rice 5kg')).toBeInTheDocument();
        const qtyInput = screen.getByDisplayValue('3') as HTMLInputElement;
        expect(qtyInput.max).toBe('3');

        // line-2 is fully returned (3 of 3), so it is not offered at all.
        expect(screen.queryByText('Oil 1L')).not.toBeInTheDocument();
    });

    it('prices the refund from the sale and does not allow editing it', async () => {
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        await screen.findByText('Rice 5kg');
        // 3 returnable × ৳100 line price
        expect(screen.getAllByText('৳300.00').length).toBeGreaterThan(0);
        expect(screen.getByText('Refund Total')).toBeInTheDocument();
        // Price is rendered as text, so it is not one of the spinbuttons.
        expect(screen.queryByDisplayValue('100')).not.toBeInTheDocument();
    });

    it('caps a typed quantity at the returnable amount', async () => {
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        await screen.findByText('Rice 5kg');
        const qtyInput = screen.getByDisplayValue('3');
        fireEvent.change(qtyInput, { target: { value: '9' } });

        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('3');
    });

    it('reports a serial that matches no sale', async () => {
        (api.getSalesList as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 0 });
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale('S-99999');

        expect(api.getSale).not.toHaveBeenCalled();
        expect(screen.queryByText('Rice 5kg')).not.toBeInTheDocument();
    });

    it('submits the return against the originating sale line ids', async () => {
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();
        await screen.findByText('Rice 5kg');

        fireEvent.change(screen.getByPlaceholderText(/Reason for return/i), {
            target: { value: 'Damaged' },
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Return/i }));
        });

        await waitFor(() => {
            expect(api.createReturn).toHaveBeenCalledWith({
                storeId: 'store-1',
                saleId: 'sale-1',
                // The single warehouse the shop has; the picker stayed hidden.
                warehouseId: 'wh-main',
                items: [{ saleItemId: 'line-1', quantity: 3, warehouseId: undefined }],
                reason: 'Damaged',
            });
        });
        expect(push).toHaveBeenCalledWith('/sales/returns');
    });

    it('puts the goods back where the sale took them from', async () => {
        // The point of the picker on a return: default to the sale's own
        // warehouse, not the branch default, and say so on screen.
        (api.getInventoryWarehouses as jest.Mock).mockResolvedValue([MAIN_WAREHOUSE, ANNEX_WAREHOUSE]);
        (api.getSale as jest.Mock).mockResolvedValue({ ...SALE, warehouse_id: 'wh-annex' });

        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();
        await screen.findByText('Rice 5kg');

        expect((screen.getByLabelText('Warehouse') as HTMLSelectElement).value).toBe('wh-annex');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Return/i }));
        });

        await waitFor(() => {
            expect(api.createReturn).toHaveBeenCalledWith(
                expect.objectContaining({ warehouseId: 'wh-annex' }),
            );
        });
    });

    it('reveals the per-line column when the sale itself was split', async () => {
        (api.getInventoryWarehouses as jest.Mock).mockResolvedValue([MAIN_WAREHOUSE, ANNEX_WAREHOUSE]);
        (api.getSale as jest.Mock).mockResolvedValue({
            ...SALE,
            warehouse_id: 'wh-main',
            items: [{ ...SALE.items[0], warehouse_id: 'wh-annex' }],
        });

        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();
        await screen.findByText('Rice 5kg');

        // Not hidden behind the switch: a warehouse steering a line has to be
        // visible on the line, or the return silently restocks elsewhere.
        expect((screen.getByLabelText('Warehouse — Rice 5kg') as HTMLSelectElement).value)
            .toBe('wh-annex');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Return/i }));
        });

        await waitFor(() => {
            expect(api.createReturn).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: [expect.objectContaining({ warehouseId: 'wh-annex' })],
                }),
            );
        });
    });

    it('keeps the submit button disabled until a sale is loaded', async () => {
        await act(async () => { render(<NewSalesReturnPage />); });

        expect(screen.getByRole('button', { name: /Create Return/i })).toBeDisabled();
        await findSale();
        await screen.findByText('Rice 5kg');
        expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled();
    });
});
