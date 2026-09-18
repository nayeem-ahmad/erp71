import { printSaleChallan, printSaleInvoice, type PrintableSale, type SalePrintContext } from './sale-print-actions';
import { printSalesInvoice } from './sales-invoice-printer';
import { printDeliveryChallan } from './delivery-challan-printer';
import { enMessages } from './localization/messages/en';

jest.mock('./sales-invoice-printer', () => ({
    ...jest.requireActual('./sales-invoice-printer'),
    printSalesInvoice: jest.fn(),
}));
jest.mock('./delivery-challan-printer', () => ({
    ...jest.requireActual('./delivery-challan-printer'),
    printDeliveryChallan: jest.fn(),
}));

const ctx: SalePrintContext = {
    invoiceHeader: { companyName: 'Acme Traders' },
    challanHeader: { companyName: 'Acme Traders' },
    locale: 'en',
    challanLabels: enMessages.sales.challan,
    menuLabels: enMessages.sales.printMenu,
    unknownProductLabel: 'Unknown product',
};

/** A list row: `price_at_sale`, products nested, payments as `payment_method`. */
const listShapedSale: PrintableSale = {
    id: 'sale-1',
    serial_number: 'SL-00001',
    created_at: '2026-03-20T10:00:00.000Z',
    total_amount: '3000',
    amount_paid: '3000',
    items: [
        { quantity: 3, price_at_sale: '1000', product: { name: 'Gadget X', sku: 'GX-1' } },
    ],
    payments: [{ payment_method: 'CASH', amount: '3000' }],
    customer: { name: 'Alice Smith', phone: '01700000000' },
};

/** The detail screen's cart: `price`, flat names, payments as `method`. */
const cartShapedSale: PrintableSale = {
    id: 'sale-1',
    serial_number: 'SL-00001',
    created_at: '2026-03-20T10:00:00.000Z',
    total_amount: '3000',
    amount_paid: '3000',
    items: [{ quantity: 3, price: 1000, name: 'Gadget X' }],
    payments: [{ method: 'CASH', amount: 3000 }],
    customer: { name: 'Alice Smith' },
};

beforeEach(() => jest.clearAllMocks());

describe('printSaleInvoice', () => {
    it('reads a list row and a cart row to the same invoice', () => {
        printSaleInvoice(listShapedSale, 'A4', ctx, true);
        const fromList = (printSalesInvoice as jest.Mock).mock.calls[0][0];

        printSaleInvoice(cartShapedSale, 'A4', ctx, true);
        const fromCart = (printSalesInvoice as jest.Mock).mock.calls[1][0];

        // The two screens hold the same sale in different shapes; an operator
        // must not get a different invoice depending on where they pressed.
        expect(fromList.items[0]).toMatchObject({ name: 'Gadget X', quantity: 3, unitPrice: 1000 });
        expect(fromCart.items[0]).toMatchObject({ name: 'Gadget X', quantity: 3, unitPrice: 1000 });
        expect(fromList.total).toBe(3000);
        expect(fromCart.total).toBe(3000);
        expect(fromList.payments[0]).toMatchObject({ method: 'CASH', amount: 3000 });
        expect(fromCart.payments[0]).toMatchObject({ method: 'CASH', amount: 3000 });
    });

    it('prints at the size it is given', () => {
        printSaleInvoice(listShapedSale, 'Thermal80', ctx, true);
        expect(printSalesInvoice).toHaveBeenCalledWith(
            expect.anything(),
            'Thermal80',
            undefined,
        );
    });

    it('attaches a preview toolbar unless the operator opted out', () => {
        printSaleInvoice(listShapedSale, 'A4', ctx, false);
        const preview = (printSalesInvoice as jest.Mock).mock.calls[0][2];

        expect(preview).toMatchObject({
            printLabel: 'Print',
            closeLabel: 'Close',
            skipLabel: 'Skip preview next time',
        });
        expect(preview.title).toContain('Invoice');

        (printSalesInvoice as jest.Mock).mockClear();
        printSaleInvoice(listShapedSale, 'A4', ctx, true);
        expect((printSalesInvoice as jest.Mock).mock.calls[0][2]).toBeUndefined();
    });

    it('carries the gap between the lines and the stored total as an adjustment', () => {
        // 3 x 1000 is 3000, but the sale was posted at 2900 after a discount.
        printSaleInvoice({ ...listShapedSale, total_amount: '2900' }, 'A4', ctx, true);
        const data = (printSalesInvoice as jest.Mock).mock.calls[0][0];

        expect(data.total).toBe(2900);
        expect(data.rounding).toBeCloseTo(-100);
    });
});

describe('printSaleChallan', () => {
    it('carries the goods and the parties but never a price', () => {
        printSaleChallan(listShapedSale, 'A4', ctx, true);
        const data = (printDeliveryChallan as jest.Mock).mock.calls[0][0];

        expect(data.items).toEqual([
            { name: 'Gadget X', sku: 'GX-1', quantity: 3 },
        ]);
        expect(data.customerName).toBe('Alice Smith');
        // The challan type has no field for money, and this is the assertion
        // that keeps it that way if someone widens the mapping later.
        expect(JSON.stringify(data)).not.toMatch(/1000|3000/);
    });
});
