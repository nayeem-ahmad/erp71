import { printPurchaseInvoice, type PurchaseInvoiceData } from './purchase-invoice-printer';
import { enMessages } from './localization/messages/en';

const labels = {
    docTitle: enMessages.purchases.invoice.purchaseReceipt,
    supplier: 'Supplier',
    noSupplier: enMessages.purchases.invoice.noSupplier,
    purchaseNo: enMessages.purchases.invoice.purchaseNo,
    date: 'Date',
    branch: 'Branch',
    item: enMessages.purchases.invoice.item,
    qty: enMessages.purchases.invoice.qty,
    unitCost: enMessages.purchases.invoice.unitCost,
    lineTotal: enMessages.purchases.invoice.lineTotal,
    subtotal: enMessages.purchases.invoice.subtotal,
    tax: enMessages.purchases.invoice.tax,
    freight: enMessages.purchases.invoice.freight,
    discount: enMessages.purchases.invoice.discount,
    total: enMessages.purchases.invoice.total,
    payment: enMessages.purchases.invoice.paymentDetails,
    notePrefix: enMessages.purchases.invoice.notePrefix,
    footer: 'Purchase Receipt · Demo Store',
};

const baseInvoice: PurchaseInvoiceData = {
    purchaseNumber: 'PUR-00001',
    date: '20/03/2026',
    companyName: 'Demo Store',
    supplierName: 'Fresh Farms',
    supplierPhone: '01700000000',
    items: [
        { name: 'Coffee Beans', sku: 'CB-1', quantity: 2, unitCost: 10 },
        { name: 'Milk', quantity: 1, unitCost: 22 },
    ],
    payments: [{ method: 'CASH', amount: 42 }],
    subtotal: 42,
    total: 42,
    labels,
};

function render(data: PurchaseInvoiceData = baseInvoice, paperSize?: 'A4' | 'Thermal80'): string {
    const write = jest.fn();
    const mockWindow = {
        document: { write, close: jest.fn(), images: [] },
        print: jest.fn(),
        set onload(handler: () => void) {
            handler();
        },
    };
    jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    printPurchaseInvoice(data, paperSize ?? 'A4');

    expect(write).toHaveBeenCalledTimes(1);
    return write.mock.calls[0][0] as string;
}

afterEach(() => jest.restoreAllMocks());

describe('purchase invoice printer', () => {
    it('prints the supplier, the purchase number and the goods', () => {
        const html = render();

        expect(html).toContain('Purchase Receipt');
        expect(html).toContain('PUR-00001');
        expect(html).toContain('Fresh Farms');
        expect(html).toContain('Coffee Beans');
        expect(html).toContain('CB-1');
        expect(html).toContain('Unit Cost');
    });

    it('prints invoice-level tax, freight and discount when they are on the bill', () => {
        const html = render({
            ...baseInvoice,
            tax: 5,
            freight: 8,
            discount: 3,
            total: 52,
        });

        expect(html).toContain('Tax');
        expect(html).toContain('Freight');
        expect(html).toContain('Discount');
    });

    it('prints the payment that settled the bill, with its instrument', () => {
        const html = render({
            ...baseInvoice,
            payments: [{ method: 'BANK_TRANSFER', amount: 42, reference: 'CHQ-889001 · City Bank' }],
        });

        expect(html).toContain('Payment Details');
        expect(html).toContain('CHQ-889001 · City Bank');
    });

    it('prints a note when the purchase has one', () => {
        const html = render({ ...baseInvoice, note: 'Deliver to warehouse B' });

        expect(html).toContain('Note:');
        expect(html).toContain('Deliver to warehouse B');
    });

    it('names the document a purchase receipt, not a sales invoice', () => {
        const html = render();

        expect(html).toContain('Purchase Receipt');
        expect(html).not.toContain('Bill To');
        expect(html).not.toContain('Unit Price');
        expect(html).not.toContain('Thank you for your business');
    });
});
