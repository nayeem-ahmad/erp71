import { DEFAULT_INVOICE_PRINT_PREFS, type InvoicePrintPrefs } from '@erp71/shared-types';
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

function render(
    data: PurchaseInvoiceData = baseInvoice,
    paperSize?: 'A4' | 'Thermal80',
    layout?: Partial<InvoicePrintPrefs>,
): string {
    const write = jest.fn();
    const mockWindow = {
        document: { write, close: jest.fn(), images: [] },
        print: jest.fn(),
        set onload(handler: () => void) {
            handler();
        },
    };
    jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    printPurchaseInvoice(
        data,
        paperSize ?? 'A4',
        undefined,
        layout ? { ...DEFAULT_INVOICE_PRINT_PREFS, ...layout } : undefined,
    );

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

describe('purchase receipt — detailed layout', () => {
    const detailed: PurchaseInvoiceData = {
        ...baseInvoice,
        referenceNumber: 'BILL-77',
        supplierCode: 'SUP-00012',
        supplierAddress: '12 Farm Road',
        storeName: 'Babu Bazar',
        preparedBy: 'Rina Akter',
        printedBy: 'Karim',
        printedAt: '13-10-2026 2:15:00 PM',
        qrDataUrl: 'data:image/png;base64,AAAA',
        items: [
            { name: 'Coffee Beans', sku: 'CB-1', quantity: 2, unitCost: 1000 },
            { name: 'Milk', quantity: 1, unitCost: 220 },
        ],
        payments: [{ method: 'CASH', amount: 1000 }],
        subtotal: 2220,
        tax: 100,
        freight: 80,
        discount: 50,
        total: 2350,
        note: 'Deliver to warehouse B',
    };

    /** The supplier side and the purchase side of the boxed block. */
    function infoBox(html: string): { left: string; right: string } {
        const start = html.indexOf('<div class="d-info">');
        const box = html.slice(start, html.indexOf('</thead>', start));
        return {
            left: box.slice(box.indexOf('d-info-l'), box.indexOf('d-info-r')),
            right: box.slice(box.indexOf('d-info-r')),
        };
    }

    const supplierLine = (label: string, value: string) =>
        `<span class="d-info-k">${label}</span><span class="d-info-c">:</span><span>${value}</span>`;

    it('prints the standard receipt for a member whose invoice layout is standard', () => {
        const html = render(detailed, 'A4', { layout: 'standard' });
        expect(html).not.toContain('<div class="d-info">');
        expect(html).toContain('Payment Details');
    });

    it('prints the detailed design for a member whose invoice layout is detailed', () => {
        const html = render(detailed, 'A4', { layout: 'detailed' });
        expect(html).toContain('<div class="d-info">');
        expect(html).toContain('class="d-table');
        expect(html).not.toContain('<div class="meta-grid">');
        expect(html).toContain('<title>Purchase Receipt PUR-00001</title>');
    });

    it('keeps the till receipt on a roll, whatever the layout', () => {
        const html = render(detailed, 'Thermal80', { layout: 'detailed' });
        expect(html).not.toContain('<div class="d-info">');
    });

    it('puts the QR code in the letterhead in place of the number and date', () => {
        const html = render(detailed, 'A4', { layout: 'detailed' });
        const header = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
        expect(header).toContain('<img class="p71-hd-qr" src="data:image/png;base64,AAAA"');
        expect(header).not.toContain('p71-hd-meta');
    });

    it('boxes the supplier on the left and the purchase on the right', () => {
        const { left, right } = infoBox(render(detailed, 'A4', { layout: 'detailed' }));

        expect(left).toContain(supplierLine('Supplier ID', 'SUP-00012'));
        expect(left).toContain(supplierLine('Name', 'Fresh Farms'));
        expect(left).toContain(supplierLine('Address', '12 Farm Road'));
        expect(left).toContain(supplierLine('Mobile', '01700000000'));
        expect(left).not.toContain('Customer');

        expect(right).toContain('<strong>Purchase No.:</strong> PUR-00001');
        expect(right).toContain('<strong>Reference No.:</strong> BILL-77');
        expect(right).toContain('<strong>Date:</strong> 20/03/2026');
        expect(right).toContain('<strong>Branch:</strong> Babu Bazar');
        expect(right).toContain('<strong>Entry By:</strong> Rina Akter');
    });

    it('says so when the purchase has no supplier, and leaves out empty lines', () => {
        const { left, right } = infoBox(render(
            { ...detailed, supplierName: undefined, supplierCode: undefined, supplierPhone: undefined, supplierAddress: undefined, referenceNumber: null },
            'A4',
            { layout: 'detailed' },
        ));
        expect(left).toContain(supplierLine('Name', 'No supplier linked'));
        expect(left).not.toContain('Supplier ID');
        expect(right).not.toContain('Reference No.');
    });

    it('heads the price column Unit Cost and prints no Warranty column', () => {
        const html = render(detailed, 'A4', { layout: 'detailed', warranty_column: 'always' });
        expect(html).toContain('Unit Cost (৳)');
        expect(html).not.toContain('Unit Price');
        expect(html).not.toContain('Warranty');
        expect(html).toContain('<td class="d-num">2,000.00</td>');
    });

    it('foots the money: sub total, tax, freight, discount, total, paid and due', () => {
        const html = render(detailed, 'A4', { layout: 'detailed' });
        const right = html.slice(html.indexOf('<div class="d-right">'));

        expect(right).toContain('<tr><td>Sub Total (৳):</td><td>2,220.00</td></tr>');
        expect(right).toContain('<tr><td>Total Tax (৳):</td><td>100.00</td></tr>');
        expect(right).toContain('<tr><td>Freight (৳):</td><td>80.00</td></tr>');
        expect(right).toContain('<tr class="neg"><td>Discount (৳):</td><td>-50.00</td></tr>');
        expect(right).toContain('<tr class="rule"><td>Total (৳):</td><td>2,350.00</td></tr>');
        expect(right).toContain('<tr><td>Paid (৳):</td><td>1,000.00</td></tr>');
        expect(right).toContain('<tr class="rule"><td>Due (৳):</td><td>1,350.00</td></tr>');
        expect(right).not.toContain('Adjustment');
    });

    it('takes the paid figure from the bill over the entry tenders', () => {
        const html = render({ ...detailed, amountPaid: 2350 }, 'A4', { layout: 'detailed' });
        expect(html).toContain('<tr><td>Paid (৳):</td><td>2,350.00</td></tr>');
        expect(html).toContain('<tr class="rule"><td>Due (৳):</td><td>0.00</td></tr>');
    });

    it('shows a stored total the figures do not add up to as an adjustment', () => {
        const html = render({ ...detailed, total: 2360 }, 'A4', { layout: 'detailed' });
        expect(html).toContain('<tr><td>Adjustment (৳):</td><td>10.00</td></tr>');
    });

    it('lists the tenders and the note, and signs for the supplier', () => {
        const html = render(detailed, 'A4', { layout: 'detailed', signature_lines: true });
        expect(html).toContain('Paid by: Cash 1,000.00');
        expect(html).toContain('<strong>Note:</strong> Deliver to warehouse B');
        expect(html).toContain("Supplier's Signature");
        expect(html).not.toContain("Customer's Signature");
    });

    it('spells the total out when the member asks for it', () => {
        expect(render(detailed, 'A4', { layout: 'detailed', amount_in_words: true }))
            .toContain('<strong>In Word:</strong> Taka Two Thousand Three Hundred Fifty Only');
        expect(render(detailed, 'A4', { layout: 'detailed' })).not.toContain('In Word:');
    });

    it("keeps the receipt's own foot rather than the invoice's customer-facing text", () => {
        const html = render(detailed, 'A4', { layout: 'detailed', footer_text: 'No returns after 7 days' });
        expect(html).toContain('Purchase Receipt · Demo Store');
        expect(html).not.toContain('No returns after 7 days');
        expect(html).not.toContain('Thank you for your business');
    });

    it('stamps who printed it and when, with page numbers', () => {
        const html = render(detailed, 'A4', { layout: 'detailed' });
        expect(html).toContain('Printed 13-10-2026 2:15:00 PM by Karim');
    });
});
