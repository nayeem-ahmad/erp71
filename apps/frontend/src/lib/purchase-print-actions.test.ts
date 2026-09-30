import { printPurchaseInvoiceFromRecord, type PrintablePurchase, type PurchasePrintContext } from './purchase-print-actions';
import { printPurchaseInvoice } from './purchase-invoice-printer';
import { enMessages } from './localization/messages/en';

jest.mock('./purchase-invoice-printer', () => ({
    ...jest.requireActual('./purchase-invoice-printer'),
    printPurchaseInvoice: jest.fn(),
}));

const ctx: PurchasePrintContext = {
    header: { companyName: 'Acme Traders' },
    locale: 'en',
    invoiceLabels: enMessages.purchases.invoice,
    menuLabels: enMessages.sales.printMenu,
    unknownProductLabel: 'Unknown product',
    supplierLabel: 'Supplier',
    dateLabel: 'Date',
    branchLabel: 'Branch',
};

const purchase: PrintablePurchase = {
    purchase_number: 'PUR-00001',
    reference_number: 'INV-88',
    created_at: '2026-03-20T10:00:00.000Z',
    notes: 'Deliver to warehouse B',
    subtotal_amount: '42',
    tax_amount: '5',
    discount_amount: '3',
    freight_amount: '8',
    total_amount: '52',
    store: { name: 'Main Branch' },
    supplier: { name: 'Fresh Farms', phone: '01700000000', address: 'Farm Road' },
    items: [
        { quantity: 2, unit_cost: '10', product: { name: 'Coffee Beans', sku: 'CB-1' } },
        { quantity: 1, unit_cost: '22', product: { name: 'Milk', sku: null } },
    ],
    payments: [{ payment_method: 'CASH', amount: '20', reference_no: 'CHQ-1', bank_name: 'City Bank' }],
};

beforeEach(() => jest.clearAllMocks());

describe('printPurchaseInvoiceFromRecord', () => {
    it('maps the invoice payload onto the printer', () => {
        printPurchaseInvoiceFromRecord(purchase, 'A4', ctx, true);
        const data = (printPurchaseInvoice as jest.Mock).mock.calls[0][0];

        expect(data.purchaseNumber).toBe('PUR-00001');
        expect(data.referenceNumber).toBe('INV-88');
        expect(data.companyName).toBe('Acme Traders');
        expect(data.supplierName).toBe('Fresh Farms');
        expect(data.supplierPhone).toBe('01700000000');
        expect(data.storeName).toBe('Main Branch');
        expect(data.items).toEqual([
            { name: 'Coffee Beans', sku: 'CB-1', quantity: 2, unitCost: 10 },
            { name: 'Milk', sku: undefined, quantity: 1, unitCost: 22 },
        ]);
        expect(data.subtotal).toBe(42);
        expect(data.tax).toBe(5);
        expect(data.discount).toBe(3);
        expect(data.freight).toBe(8);
        expect(data.total).toBe(52);
        expect(data.note).toBe('Deliver to warehouse B');
        expect(data.payments[0]).toMatchObject({ method: 'CASH', amount: 20 });
        expect(data.payments[0].reference).toContain('CHQ-1');
    });

    it('prints at the size it is given', () => {
        printPurchaseInvoiceFromRecord(purchase, 'Thermal80', ctx, true);
        expect(printPurchaseInvoice).toHaveBeenCalledWith(
            expect.anything(),
            'Thermal80',
            undefined,
        );
    });

    it('attaches a preview toolbar unless the operator opted out', () => {
        printPurchaseInvoiceFromRecord(purchase, 'A4', ctx, false);
        const preview = (printPurchaseInvoice as jest.Mock).mock.calls[0][2];

        expect(preview).toMatchObject({
            printLabel: 'Print',
            closeLabel: 'Close',
            skipLabel: 'Skip preview next time',
        });
        expect(preview.title).toContain('Purchase Receipt');

        (printPurchaseInvoice as jest.Mock).mockClear();
        printPurchaseInvoiceFromRecord(purchase, 'A4', ctx, true);
        expect((printPurchaseInvoice as jest.Mock).mock.calls[0][2]).toBeUndefined();
    });

    it('falls back to the unknown-product label when a line has no catalogue name', () => {
        printPurchaseInvoiceFromRecord(
            { ...purchase, items: [{ quantity: 1, unit_cost: '10' }] },
            'A4',
            ctx,
            true,
        );
        const data = (printPurchaseInvoice as jest.Mock).mock.calls[0][0];
        expect(data.items[0].name).toBe('Unknown product');
    });
});
