import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import PurchaseDetailPage from './page';
import { api } from '@/lib/api';
import { clearRateHistoryCache } from '@/components/document-entry/RateHistory';

jest.mock('next/link', () => {
    const MockLink = ({ children, href, title }: any) => <a href={href} title={title}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
    useSearchParams: () => searchParams,
    useParams: () => ({ id: 'purchase-1' }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPurchase: jest.fn(),
        updatePurchase: jest.fn(),
        cancelPurchase: jest.fn(),
        getPurchaseInvoice: jest.fn(),
        getMe: jest.fn().mockResolvedValue({ tenants: [] }),
        getSuppliers: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        getProductRateHistory: jest.fn(),
        getInventoryWarehouses: jest.fn(),
        getInventorySettings: jest.fn(),
        getPaymentMethods: jest.fn(),
        getSalesSettings: jest.fn().mockResolvedValue({}),
    },
}));

const CASH_METHOD = { id: 'pm-1', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1 };

const MAIN_WAREHOUSE = {
    id: 'wh-main',
    name: 'Main Store',
    code: 'WH-MAIN',
    store_id: 'store-1',
    is_default: true,
    is_active: true,
};

/** A 10 × ৳140 bill from Fresh Farms with ৳400 paid in cash at the counter. */
const recordedPurchase = (overrides: Record<string, unknown> = {}) => ({
    id: 'purchase-1',
    purchase_number: 'PUR-00007',
    status: 'RECORDED',
    store_id: 'store-1',
    warehouse_id: 'wh-main',
    supplier_id: 'sup-1',
    supplier: { id: 'sup-1', name: 'Fresh Farms', due_balance: 1000 },
    created_at: '2026-10-01T04:00:00.000Z',
    subtotal_amount: '1400',
    tax_amount: '0',
    discount_amount: '0',
    freight_amount: '0',
    total_amount: '1400',
    paid_amount: '400',
    notes: 'Morning delivery',
    items: [
        { id: 'line-1', product_id: 'prod-1', quantity: 10, unit_cost: '140', warehouse_id: null, product: { id: 'prod-1', name: 'Coffee Beans' } },
    ],
    payments: [{ id: 'pp-1', payment_method: 'Cash', amount: '400' }],
    entry_paid_amount: 400,
    later_paid_amount: 0,
    posting_status: 'posted',
    voucher_number: 'JV-00012',
    ...overrides,
});

describe('PurchaseDetailPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        (api.getPurchase as jest.Mock).mockResolvedValue(recordedPurchase());
        (api.updatePurchase as jest.Mock).mockResolvedValue({ id: 'purchase-1' });
        (api.getSuppliers as jest.Mock).mockResolvedValue([
            { id: 'sup-1', name: 'Fresh Farms', due_balance: 1000 },
        ]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([]);
        (api.getProductRateHistory as jest.Mock).mockResolvedValue({ type: 'purchase', forParty: [], recent: [], summary: null });
        (api.getInventoryWarehouses as jest.Mock).mockResolvedValue([MAIN_WAREHOUSE]);
        (api.getInventorySettings as jest.Mock).mockResolvedValue({ default_purchase_warehouse_id: null });
        (api.getPaymentMethods as jest.Mock).mockResolvedValue([CASH_METHOD]);
        window.sessionStorage.setItem('store_id', 'store-1');
        clearRateHistoryCache();
    });

    const renderPage = async () => {
        await act(async () => { renderWithQueryClient(<PurchaseDetailPage />); });
        await screen.findAllByText('PUR-00007');
    };

    it('shows the purchase on the entry screen, read-only', async () => {
        await renderPage();

        expect(screen.getByText('Coffee Beans')).toBeInTheDocument();
        expect(screen.getByText('Morning delivery')).toBeInTheDocument();
        expect(screen.getByText('Recorded')).toBeInTheDocument();
        // Nothing to type into: no product search, no editable charges, no save.
        expect(screen.queryByPlaceholderText(/search products/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Freight')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
        expect(screen.getByLabelText('Transaction date')).not.toHaveAttribute('type');
        expect(screen.getByLabelText('Created')).not.toHaveTextContent('Auto');

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(push).toHaveBeenCalledWith('/purchases/purchase-1?edit=true');
    });

    it('offers no edit on a cancelled purchase', async () => {
        (api.getPurchase as jest.Mock).mockResolvedValue(recordedPurchase({
            status: 'CANCELLED',
            cancellation_note: 'Supplier never shipped',
        }));
        searchParams = new URLSearchParams('edit=true');

        await renderPage();

        expect(screen.getByText('Cancelled')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    });

    it('saves the corrected bill with the payment it was recorded with', async () => {
        searchParams = new URLSearchParams('edit=true');
        await renderPage();

        fireEvent.change(screen.getByLabelText('Freight'), { target: { value: '50' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        });

        await waitFor(() => {
            expect(api.updatePurchase).toHaveBeenCalledWith('purchase-1', expect.objectContaining({
                supplierId: 'sup-1',
                warehouseId: 'wh-main',
                freightAmount: 50,
                notes: 'Morning delivery',
                items: [{ productId: 'prod-1', quantity: 10, unitCost: 140, warehouseId: undefined }],
                payments: [expect.objectContaining({ paymentMethod: 'Cash', amount: 400 })],
            }));
        });
        // A recorded bill keeps its branch: there is no storeId on an edit.
        expect((api.updatePurchase as jest.Mock).mock.calls[0][1]).not.toHaveProperty('storeId');
        expect((api.updatePurchase as jest.Mock).mock.calls[0][1]).not.toHaveProperty('purchaseDate');
        expect(screen.queryByLabelText('Transaction date')).not.toHaveAttribute('type');
        expect(push).toHaveBeenCalledWith('/purchases/purchase-1');
    });

    it('keeps an imported bill\'s paid-with-the-goods, which has no tender rows', async () => {
        (api.getPurchase as jest.Mock).mockResolvedValue(recordedPurchase({ payments: [], entry_paid_amount: 400 }));
        searchParams = new URLSearchParams('edit=true');
        await renderPage();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        });

        await waitFor(() => {
            expect(api.updatePurchase).toHaveBeenCalledWith('purchase-1', expect.objectContaining({
                payments: [expect.objectContaining({ paymentMethod: 'Cash', amount: 400 })],
            }));
        });
    });

    it('takes this bill back out of the payable it shows as already owed', async () => {
        // Fresh Farms is owed 1250 today, which already includes this bill's
        // 1400 less the 400 paid with it — so 250 was owed apart from it.
        (api.getPurchase as jest.Mock).mockResolvedValue(recordedPurchase({
            supplier: { id: 'sup-1', name: 'Fresh Farms', due_balance: 1250 },
        }));
        await renderPage();

        const row = screen.getByText('Previous Payable').parentElement!;
        expect(row).toHaveTextContent('250');
        expect(row).not.toHaveTextContent('1,250');
    });
});
