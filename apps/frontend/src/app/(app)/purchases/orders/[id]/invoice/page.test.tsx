import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PurchaseOrderInvoicePage from './page';
import { api } from '@/lib/api';
import { printPurchaseOrder } from '@/lib/purchase-order-printer';
import { mockBrowserPaper } from '@/test-utils/print-paper';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'po-1' }),
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/purchases/orders/po-1/invoice',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/api', () => ({
    api: { getPurchaseOrderInvoice: jest.fn() },
    fetchWithAuth: jest.fn().mockResolvedValue(null),
}));

const resolveHeader = jest.fn();
jest.mock('@/lib/print/use-print-header', () => ({
    usePrintHeader: (docType: string) => ({
        headerConfig: {},
        companyName: 'KH Tradind',
        resolve: (storeId?: string) => resolveHeader(docType, storeId),
    }),
}));

jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());
jest.mock('@/lib/purchase-order-printer', () => ({ printPurchaseOrder: jest.fn(() => ({})) }));

const po = {
    id: 'po-1',
    po_number: 'PO-00007',
    created_at: '2026-10-01T04:00:00.000Z',
    status: 'SENT',
    subtotal_amount: '1200',
    tax_amount: '0',
    discount_amount: '0',
    freight_amount: '0',
    total_amount: '1200',
    store_id: 'press-club',
    store: { name: 'Press Club', address: '18 Topkhana Rd' },
    supplier: { name: 'Rahim & Sons' },
    items: [{ id: 'i1', quantity: 12, unit_cost: '100', line_total: '1200', product: { name: 'Rice', sku: 'R5' } }],
};

describe('PurchaseOrderInvoicePage — print', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBrowserPaper('A5');
        (api.getPurchaseOrderInvoice as jest.Mock).mockResolvedValue({ purchaseOrder: po, tenant: { name: 'KH Tradind' } });
        resolveHeader.mockResolvedValue({ headerConfig: { layout: 'text-only' }, companyName: 'KH Tradind' });
    });

    it.each(['Print', 'Download PDF'])('%s prints on the order’s branch Purchase Order letterhead and this browser’s paper', async (button) => {
        render(<PurchaseOrderInvoicePage />);

        fireEvent.click(await screen.findByRole('button', { name: button }));

        await waitFor(() => expect(printPurchaseOrder).toHaveBeenCalled());
        expect(resolveHeader).toHaveBeenCalledWith('PURCHASE_ORDER', 'press-club');
        expect(printPurchaseOrder).toHaveBeenCalledWith(
            po,
            expect.objectContaining({ headerConfig: { layout: 'text-only' }, paperSize: 'A5', companyName: 'KH Tradind' }),
        );
    });
});
