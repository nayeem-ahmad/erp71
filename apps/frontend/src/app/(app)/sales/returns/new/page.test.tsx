import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewSalesReturnPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
const replace = jest.fn();
// `?saleId=` — set when the return is started from the sales list's row menu.
let saleIdParam: string | null = null;
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace }),
    useSearchParams: () => ({ get: (key: string) => (key === 'saleId' ? saleIdParam : null) }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCurrentUser: jest.fn(),
        getSalesList: jest.fn(),
        getSale: jest.fn(),
        createReturn: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getInventorySettings: jest.fn(),
        getPaymentLayout: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

/** A method row as the layout route returns it. */
const method = (over: { id: string; name: string; type: string; sort_order: number }) => ({
    account_id: null,
    is_active: true,
    show_on_entry: true,
    all_branches: true,
    store_ids: [],
    ...over,
});
const CASH = method({ id: 'pm-cash', name: 'Cash', type: 'Cash', sort_order: 1 });
const BKASH = method({ id: 'pm-bkash', name: 'bKash', type: 'Mobile Wallet', sort_order: 2 });

/** What the branch offers the signed-in user: Cash first, then bKash. */
function mockLayout(visible = [CASH, BKASH], available = visible) {
    (api.getPaymentLayout as jest.Mock).mockResolvedValue({ customised: false, visible, available });
    (api.getPaymentMethods as jest.Mock).mockResolvedValue(available);
}

/**
 * ৳500 paid on bKash by a customer who owes `due` in all. With a `balance`
 * the sale itself was not paid in full: it came to ৳500 + balance.
 */
const bkashSaleOf = (due: number, { balance = 0 }: { balance?: number } = {}) => ({
    ...SALE,
    customer_id: 'cust-1',
    customer: { id: 'cust-1', name: 'Rahim', due_balance: String(due) },
    total_amount: (500 + balance).toFixed(2),
    amount_paid: '500.00',
    payments: [
        { payment_method: 'Mobile Wallet', payment_method_name: 'bKash', payment_method_id: 'pm-bkash', amount: '500.00' },
    ],
});

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
        saleIdParam = null;
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
        mockLayout();
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

        expect((screen.getByLabelText('Qty — Rice 5kg') as HTMLInputElement).value).toBe('3');
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
        await waitFor(() => expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled());

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
                // A walk-in sale: no due to settle, so all of it goes back in
                // the user's first method.
                payments: [{ paymentMethod: 'Cash', paymentMethodId: 'pm-cash', amount: 300 }],
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
        await waitFor(() => expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled());

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
        await waitFor(() => expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled());

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
        await waitFor(() => expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled());
    });

    it('sales return opens with the refund prefilled and submits payments with paymentMethodId', async () => {
        // Paid on bKash by a customer who owes nothing: the whole ৳300 goes
        // back on bKash, with no click.
        (api.getSale as jest.Mock).mockResolvedValue(bkashSaleOf(0));
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        const bkash = (await screen.findByLabelText('bKash amount')) as HTMLInputElement;
        await waitFor(() => expect(bkash.value).toBe('300'));
        expect((screen.getByLabelText('Cash amount') as HTMLInputElement).value).toBe('');
        expect(screen.getByText('✓ Settled')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Return/i }));
        });

        await waitFor(() => expect(api.createReturn).toHaveBeenCalledTimes(1));
        const sent = (api.createReturn as jest.Mock).mock.calls[0][0];
        // Exactly the DTO's fields: the server rejects a `label` or an `accountId`.
        expect(sent.payments).toEqual([{ paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 300 }]);
        expect(Object.keys(sent.payments[0]).sort()).toEqual(['amount', 'paymentMethod', 'paymentMethodId']);
    });

    it('sales return chip reads "Adjusted against due ৳…" for a partial refund', async () => {
        // The sale left ৳400 unpaid; the customer owes ৳120 of it now.
        (api.getSale as jest.Mock).mockResolvedValue(bkashSaleOf(120, { balance: 400 }));
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        // ৳300 − ৳120 due = ৳180 refunded; the ৳120 is kept against the due.
        const bkash = (await screen.findByLabelText('bKash amount')) as HTMLInputElement;
        await waitFor(() => expect(bkash.value).toBe('180'));
        expect(screen.getByText(/^Adjusted against due ৳\s*120\.00$/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled();
    });

    it('a paid sale refunds the whole return in its tender, whatever the customer owes on other sales', async () => {
        // Paid in full on bKash; the customer owes ৳5,000 on other sales.
        (api.getSale as jest.Mock).mockResolvedValue(bkashSaleOf(5000));
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        const bkash = (await screen.findByLabelText('bKash amount')) as HTMLInputElement;
        await waitFor(() => expect(bkash.value).toBe('300'));
        expect(screen.queryByText(/Adjusted against due/)).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Return/i }));
        });
        await waitFor(() => expect(api.createReturn).toHaveBeenCalledTimes(1));
        expect((api.createReturn as jest.Mock).mock.calls[0][0].payments).toEqual([
            { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 300 },
        ]);
    });

    it('falls back to the first method the user sees when the sale\'s own is no longer offered', async () => {
        (api.getSale as jest.Mock).mockResolvedValue(bkashSaleOf(0));
        mockLayout([CASH]);
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        const cash = (await screen.findByLabelText('Cash amount')) as HTMLInputElement;
        await waitFor(() => expect(cash.value).toBe('300'));
    });

    it('a sale saved before methods were recorded refunds on the method the strip shows, with its id', async () => {
        // The tender has a name but no method id, as every pre-feature sale does.
        (api.getSale as jest.Mock).mockResolvedValue({
            ...bkashSaleOf(0),
            payments: [
                { payment_method: 'Mobile Wallet', payment_method_name: 'bKash', payment_method_id: null, amount: '500.00' },
            ],
        });
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        const bkash = (await screen.findByLabelText('bKash amount')) as HTMLInputElement;
        await waitFor(() => expect(bkash.value).toBe('300'));
        await waitFor(() => expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled());
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Return/i }));
        });

        await waitFor(() => expect(api.createReturn).toHaveBeenCalledTimes(1));
        expect((api.createReturn as jest.Mock).mock.calls[0][0].payments).toEqual([
            { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 300 },
        ]);
    });

    it('uses the first visible method, not the sale\'s second tender, when its first is not offered', async () => {
        const CARD = method({ id: 'pm-card', name: 'Card', type: 'Card', sort_order: 3 });
        // Paid bKash (no longer offered here) and then Cash (offered).
        (api.getSale as jest.Mock).mockResolvedValue({
            ...bkashSaleOf(0),
            payments: [
                { payment_method: 'Mobile Wallet', payment_method_name: 'bKash', payment_method_id: 'pm-bkash', amount: '200.00' },
                { payment_method: 'Cash', payment_method_name: 'Cash', payment_method_id: 'pm-cash', amount: '300.00' },
            ],
        });
        mockLayout([CARD, CASH]);
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();

        const card = (await screen.findByLabelText('Card amount')) as HTMLInputElement;
        await waitFor(() => expect(card.value).toBe('300'));
        expect((screen.getByLabelText('Cash amount') as HTMLInputElement).value).toBe('');
    });

    it('never overwrites what the user typed', async () => {
        (api.getSale as jest.Mock).mockResolvedValue(bkashSaleOf(0));
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();
        const bkash = (await screen.findByLabelText('bKash amount')) as HTMLInputElement;
        await waitFor(() => expect(bkash.value).toBe('300'));

        fireEvent.change(bkash, { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Cash amount'), { target: { value: '200' } });
        // Lowering the quantity changes the total, but the figures are the user's now.
        fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '2' } });

        expect((screen.getByLabelText('bKash amount') as HTMLInputElement).value).toBe('100');
        expect((screen.getByLabelText('Cash amount') as HTMLInputElement).value).toBe('200');
    });

    it('follows the total while the user has not touched the strip', async () => {
        (api.getSale as jest.Mock).mockResolvedValue(bkashSaleOf(0));
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();
        const bkash = (await screen.findByLabelText('bKash amount')) as HTMLInputElement;
        await waitFor(() => expect(bkash.value).toBe('300'));

        fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '2' } });

        await waitFor(() => expect((screen.getByLabelText('bKash amount') as HTMLInputElement).value).toBe('200'));
    });

    it('will not take a partial refund with no customer', async () => {
        await act(async () => { render(<NewSalesReturnPage />); });
        await findSale();
        const cash = (await screen.findByLabelText('Cash amount')) as HTMLInputElement;
        await waitFor(() => expect(cash.value).toBe('300'));

        fireEvent.change(cash, { target: { value: '100' } });

        expect(await screen.findByText("Refund the full amount, or pick the customer's sale")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create Return/i })).toBeDisabled();
    });

    describe('started from a sale', () => {
        it('loads the sale named in the URL without asking for its serial', async () => {
            saleIdParam = 'sale-1';
            await act(async () => { render(<NewSalesReturnPage />); });

            expect(await screen.findByText('Rice 5kg')).toBeInTheDocument();
            expect(api.getSale).toHaveBeenCalledWith('sale-1');
            expect(api.getSalesList).not.toHaveBeenCalled();
            // The lookup shows which sale it is, locked until "Change".
            expect(screen.getByPlaceholderText(/Sale serial number/i)).toHaveValue('S-00001');
            expect(screen.getByPlaceholderText(/Sale serial number/i)).toBeDisabled();
            await waitFor(() => expect(screen.getByRole('button', { name: /Create Return/i })).toBeEnabled());
        });

        it('drops the sale from the URL when the user picks another', async () => {
            saleIdParam = 'sale-1';
            await act(async () => { render(<NewSalesReturnPage />); });
            await screen.findByText('Rice 5kg');

            fireEvent.click(screen.getByRole('button', { name: /Change/i }));

            expect(replace).toHaveBeenCalledWith('/sales/returns/new');
            expect(screen.queryByText('Rice 5kg')).not.toBeInTheDocument();
            expect(screen.getByPlaceholderText(/Sale serial number/i)).toBeEnabled();
        });
    });
});
