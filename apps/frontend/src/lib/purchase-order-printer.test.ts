import { printPurchaseOrder, type PrintablePurchaseOrder, type PurchaseOrderPrintContext } from './purchase-order-printer';
import { openPrintWindow } from './print';

jest.mock('./print', () => ({
    ...jest.requireActual('./print'),
    openPrintWindow: jest.fn(() => ({})),
}));

const po: PrintablePurchaseOrder = {
    po_number: 'PO-00007',
    created_at: '2026-10-01T04:00:00.000Z',
    expected_date: '2026-10-09T00:00:00.000Z',
    status: 'SENT',
    notes: 'Deliver to <back gate>',
    subtotal_amount: '1200',
    tax_amount: '0',
    discount_amount: '100',
    freight_amount: '50',
    total_amount: '1150',
    store: { name: 'Press Club', address: '18 Topkhana Rd' },
    supplier: { name: 'Rahim & Sons', phone: '01711000000', email: null, address: 'Chawkbazar' },
    items: [
        { id: 'i1', quantity: 12, unit_cost: '100', line_total: '1200', product: { name: 'Rice <5kg>', sku: 'R5' } },
    ],
};

const ctx: PurchaseOrderPrintContext = {
    headerConfig: { layout: 'text-only', lines: [{ text: '{{store_name}} — {{address}}' }] },
    companyName: 'KH Tradind',
    paperSize: 'A5',
    locale: 'en',
    labels: {
        title: 'Purchase Order',
        poNumber: 'PO Number',
        date: 'Date',
        expectedDate: 'Expected Delivery',
        supplier: 'Supplier',
        noSupplier: 'No supplier',
        description: 'Description',
        sku: 'SKU',
        qty: 'Qty',
        unitCost: 'Unit Cost',
        lineTotal: 'Line Total',
        subtotal: 'Subtotal',
        tax: 'Tax',
        freight: 'Freight',
        discount: 'Discount',
        total: 'Total',
        note: 'Note:',
    },
};

const printed = () => (openPrintWindow as jest.Mock).mock.calls.at(-1)[0];

describe('printPurchaseOrder', () => {
    beforeEach(() => (openPrintWindow as jest.Mock).mockClear());

    it('prints on the paper it is given', () => {
        printPurchaseOrder(po, ctx);

        expect(printed().paperSize).toBe('A5');
    });

    it('prints on A4 when this browser prints on a till roll', () => {
        printPurchaseOrder(po, { ...ctx, paperSize: 'Thermal80' });

        expect(printed().paperSize).toBe('A4');
    });

    it('prints the letterhead it is given, filled with the order’s branch', () => {
        printPurchaseOrder(po, ctx);

        expect(printed().headerConfig).toBe(ctx.headerConfig);
        expect(printed().headerHtml).toContain('Press Club — 18 Topkhana Rd');
        expect(printed().headerHtml).toContain('PO-00007');
    });

    it('lists the lines and totals, with what the user typed escaped', () => {
        printPurchaseOrder(po, ctx);

        const body = printed().bodyHtml as string;
        expect(body).toContain('Rice &lt;5kg&gt;');
        expect(body).toContain('Rahim &amp; Sons');
        expect(body).toContain('Deliver to &lt;back gate&gt;');
        expect(body).toContain('Expected Delivery');
        expect(body).not.toContain('<back gate>');
        expect(body).not.toContain('Tax');
    });

    it('repeats the letterhead on every page and offers Compact', () => {
        printPurchaseOrder(po, ctx);

        expect(printed()).toEqual(expect.objectContaining({ repeatHeader: true, compactable: true }));
    });
});
