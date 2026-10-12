import { DEFAULT_INVOICE_PRINT_PREFS } from '@erp71/shared-types';
import { printSaleChallan, printSaleInvoice, printSaleInvoices, printSaleReceipt, saleToInvoiceData, type PrintableSale, type SalePrintContext } from './sale-print-actions';
import { printSalesInvoice, printSalesInvoices } from './sales-invoice-printer';
import { invoiceQrDataUrl } from './invoice-qr';
import { printDeliveryChallan } from './delivery-challan-printer';
import { printPOSReceipt } from './pos-receipt-printer';
import { enMessages } from './localization/messages/en';

jest.mock('./sales-invoice-printer', () => ({
    ...jest.requireActual('./sales-invoice-printer'),
    printSalesInvoice: jest.fn(),
    printSalesInvoices: jest.fn(),
}));
jest.mock('./invoice-qr', () => ({
    invoiceQrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,QR'),
}));
jest.mock('./pos-receipt-printer', () => ({
    printPOSReceipt: jest.fn().mockResolvedValue(undefined),
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
    it('reads a list row and a cart row to the same invoice', async () => {
        await printSaleInvoice(listShapedSale, 'A4', ctx, true);
        const fromList = (printSalesInvoice as jest.Mock).mock.calls[0][0];

        await printSaleInvoice(cartShapedSale, 'A4', ctx, true);
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

    it('prints at the size it is given', async () => {
        await printSaleInvoice(listShapedSale, 'Thermal80', ctx, true);
        expect(printSalesInvoice).toHaveBeenCalledWith(
            expect.anything(),
            'Thermal80',
            undefined,
            undefined,
        );
    });

    it('prints in the layout the member saved', async () => {
        const invoiceLayout = { ...DEFAULT_INVOICE_PRINT_PREFS, table_style: 'grid' as const };
        await printSaleInvoice(listShapedSale, 'A4', { ...ctx, invoiceLayout }, true);
        expect(printSalesInvoice).toHaveBeenCalledWith(expect.anything(), 'A4', undefined, invoiceLayout);
    });

    it('attaches a preview toolbar unless the operator opted out', async () => {
        await printSaleInvoice(listShapedSale, 'A4', ctx, false);
        const preview = (printSalesInvoice as jest.Mock).mock.calls[0][2];

        expect(preview).toMatchObject({
            printLabel: 'Print',
            closeLabel: 'Close',
            skipLabel: 'Skip preview next time',
        });
        expect(preview.title).toContain('Invoice');

        (printSalesInvoice as jest.Mock).mockClear();
        await printSaleInvoice(listShapedSale, 'A4', ctx, true);
        expect((printSalesInvoice as jest.Mock).mock.calls[0][2]).toBeUndefined();
    });

    it('hands the invoice what was paid and what the customer owed before', async () => {
        await printSaleInvoice(
            { ...listShapedSale, total_amount: '3000', amount_paid: '1000', previous_due: 2500 },
            'A4',
            ctx,
            true,
        );
        const data = (printSalesInvoice as jest.Mock).mock.calls[0][0];

        expect(data.amountPaid).toBe(1000);
        expect(data.previousDue).toBe(2500);
    });

    it('trusts the stored amount paid over payment rows an imported sale never had', async () => {
        await printSaleInvoice(
            { ...listShapedSale, amount_paid: '1200', payments: [], previous_due: 0 },
            'A4',
            ctx,
            true,
        );

        expect((printSalesInvoice as jest.Mock).mock.calls[0][0].amountPaid).toBe(1200);
    });

    it('carries the gap between the lines and the stored total as an adjustment', async () => {
        // 3 x 1000 is 3000, but the sale was posted at 2900 after a discount.
        await printSaleInvoice({ ...listShapedSale, total_amount: '2900' }, 'A4', ctx, true);
        const data = (printSalesInvoice as jest.Mock).mock.calls[0][0];

        expect(data.total).toBe(2900);
        expect(data.rounding).toBeCloseTo(-100);
    });
});

describe('the sale\u2019s store on the letterhead', () => {
    it('passes the sale\u2019s store name and address onto the invoice', async () => {
        await printSaleInvoice(
            { ...listShapedSale, store: { name: 'Gulshan', address: '12 Gulshan Ave' } },
            'A4',
            ctx,
            true,
        );
        expect(printSalesInvoice).toHaveBeenCalledWith(
            expect.objectContaining({
                companyName: 'Acme Traders',
                storeName: 'Gulshan',
                companyAddress: '12 Gulshan Ave',
            }),
            'A4',
            undefined,
            undefined,
        );
    });

    it('leaves the address alone when the store has none', async () => {
        await printSaleInvoice({ ...listShapedSale, store: { name: 'Gulshan', address: '' } }, 'A4', ctx, true);
        expect((printSalesInvoice as jest.Mock).mock.calls[0][0].companyAddress).toBeUndefined();
    });

    it('carries the sale\u2019s store name and address onto the challan', () => {
        printSaleChallan(
            { ...listShapedSale, store: { name: 'Gulshan', address: '12 Gulshan Ave' } },
            'A4',
            ctx,
            true,
        );
        expect(printDeliveryChallan).toHaveBeenCalledWith(
            expect.objectContaining({ storeName: 'Gulshan', companyAddress: '12 Gulshan Ave' }),
            'A4',
            undefined,
        );
    });

    it('keeps the company name and the store name apart on the receipt', async () => {
        await printSaleReceipt({ ...listShapedSale, store: { name: 'Gulshan' } }, 'Thermal80', ctx, true);
        expect(printPOSReceipt).toHaveBeenCalledWith(
            expect.objectContaining({ companyName: 'Acme Traders', storeName: 'Gulshan' }),
            'Thermal80',
            undefined,
        );
    });
});

describe('the detailed invoice\u2019s data', () => {
    const detailedCtx: SalePrintContext = {
        ...ctx,
        invoiceLayout: { ...DEFAULT_INVOICE_PRINT_PREFS, layout: 'detailed' },
    };
    const postedSale: PrintableSale = {
        ...listShapedSale,
        total_amount: '2850',
        vat_amount: '300.00',
        sd_amount: '50.00',
        salesOrder: { order_number: 'SO-0042' },
        prepared_by: 'Rina Akter',
        customer: { name: 'Alice Smith', phone: '01700000000', address: '12 Mirpur Road', customer_code: 'C00404' },
        items: [
            {
                quantity: 3,
                price_at_sale: '1000',
                product: { name: 'Gadget X', sku: 'GX-1', warranty_enabled: true, warranty_duration_days: 180 },
            },
        ],
    };

    it('reads the stored tax, the order, the preparer, the customer code and the address off the sale', () => {
        const data = saleToInvoiceData(postedSale, detailedCtx);

        // Tax already inside the total: VAT and supplementary duty together.
        expect(data.taxIncluded).toBe(350);
        expect(data.orderNumber).toBe('SO-0042');
        expect(data.preparedBy).toBe('Rina Akter');
        expect(data.shippingAddress).toBe('12 Mirpur Road');
        expect(data.customerCode).toBe('C00404');
    });

    it('does not claim to know the tax of a sale that never reported it', () => {
        expect(saleToInvoiceData(listShapedSale, detailedCtx).taxIncluded).toBeUndefined();
    });

    it('words a product\u2019s warranty period, and says nothing when it has none', () => {
        const days = (n: number, enabled = true) =>
            saleToInvoiceData(
                {
                    ...postedSale,
                    items: [{ quantity: 1, price_at_sale: '1', product: { name: 'P', warranty_enabled: enabled, warranty_duration_days: n } }],
                },
                detailedCtx,
            ).items[0].warranty;

        expect(days(365)).toBe('1 year');
        expect(days(730)).toBe('2 years');
        expect(days(180)).toBe('6 months');
        expect(days(30)).toBe('1 month');
        expect(days(45)).toBe('45 days');
        expect(days(180, false)).toBeUndefined();
        expect(days(0)).toBeUndefined();
    });

    it('attaches the QR code for the sale when the member prints the detailed design', async () => {
        await printSaleInvoice(postedSale, 'A4', detailedCtx, true);

        expect(invoiceQrDataUrl).toHaveBeenCalledWith('sale-1');
        expect((printSalesInvoice as jest.Mock).mock.calls[0][0].qrDataUrl).toBe('data:image/png;base64,QR');
    });

    it('does not draw a code for the standard design, which has nowhere to print it', async () => {
        await printSaleInvoice(postedSale, 'A4', ctx, true);

        expect(invoiceQrDataUrl).not.toHaveBeenCalled();
        expect((printSalesInvoice as jest.Mock).mock.calls[0][0].qrDataUrl).toBeUndefined();
    });

    it('gives each invoice of a batch its own code', async () => {
        (invoiceQrDataUrl as jest.Mock).mockImplementation(async (id: string) => `data:image/png;base64,${id}`);
        (printSalesInvoices as jest.Mock).mockReturnValue({} as Window);

        const opened = await printSaleInvoices(
            [postedSale, { ...postedSale, id: 'sale-2' }],
            'A4',
            detailedCtx,
            true,
        );

        expect(opened).toBe(true);
        const sheets = (printSalesInvoices as jest.Mock).mock.calls[0][0];
        expect(sheets.map((d: { qrDataUrl: string }) => d.qrDataUrl)).toEqual([
            'data:image/png;base64,sale-1',
            'data:image/png;base64,sale-2',
        ]);
    });
});

describe('who sold the sale', () => {
    it('carries the sale\u2019s sales rep onto the invoice as Sales By', () => {
        expect(saleToInvoiceData({ ...listShapedSale, salesRep: { id: 'emp-1', name: 'Rafiq Islam' } }, ctx).salesBy).toBe('Rafiq Islam');
        expect(saleToInvoiceData(listShapedSale, ctx).salesBy).toBeUndefined();
    });
});

describe('who printed the invoice', () => {
    it('carries the signed-in user from the print context onto the invoice', () => {
        expect(saleToInvoiceData(listShapedSale, { ...ctx, printedBy: 'Rina Akter' }).printedBy).toBe('Rina Akter');
        expect(saleToInvoiceData(listShapedSale, ctx).printedBy).toBeUndefined();
    });
});

describe('a sale entered before VAT', () => {
    // 1,000 before VAT less a 10 discount, with 15% added on top: stored as a
    // 1,150 line, a 1,138.50 total and 148.50 of VAT.
    const onTopSale: PrintableSale = {
        ...listShapedSale,
        total_amount: '1138.50',
        amount_paid: '1138.50',
        vat_amount: '148.50',
        sd_amount: '0',
        prices_include_vat: false,
        items: [{ quantity: 1, price_at_sale: '1150.00', vat_rate: '15.00', sd_rate: '0', product: { name: 'Gadget X' } }],
    };

    it('prints the before-VAT price, the discount and the VAT added on top', () => {
        const data = saleToInvoiceData(onTopSale, ctx);

        expect(data.items[0].unitPrice).toBe(1000);
        expect(data.subtotal).toBe(1000);
        expect(data.discountAmount).toBe(10);
        expect(data.vat).toBe(148.5);
        expect(data.total).toBe(1138.5);
        // Not the "VAT inside the prices" reading, and no stray rounding row.
        expect(data.taxIncluded).toBeUndefined();
        expect(data.rounding).toBeUndefined();
    });

    it('takes a cart line\u2019s price as already before VAT', () => {
        const data = saleToInvoiceData(
            { ...onTopSale, items: [{ quantity: 1, price: 1000, name: 'Gadget X' }] },
            ctx,
        );

        expect(data.items[0].unitPrice).toBe(1000);
        expect(data.discountAmount).toBe(10);
    });

    it('leaves a VAT-inclusive sale as it always printed', () => {
        const data = saleToInvoiceData({ ...onTopSale, prices_include_vat: true }, ctx);

        expect(data.items[0].unitPrice).toBe(1150);
        expect(data.taxIncluded).toBe(148.5);
        expect(data.vat).toBeUndefined();
        expect(data.rounding).toBe(-11.5);
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
