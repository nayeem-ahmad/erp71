import { printDeliveryChallan, type ChallanLabels } from './delivery-challan-printer';

const labels: ChallanLabels = {
    title: 'Delivery Challan',
    challanNo: 'Challan No.',
    invoiceNo: 'Invoice No.',
    date: 'Date',
    deliverTo: 'Deliver To',
    challanDetails: 'Challan Details',
    address: 'Delivery Address',
    driver: 'Driver',
    vehicle: 'Vehicle No.',
    sl: 'SL',
    item: 'Item',
    sku: 'SKU',
    quantity: 'Qty',
    unit: 'Unit',
    totalQuantity: 'Total Quantity',
    note: 'Note',
    deliveredBy: 'Delivered By',
    carriedBy: 'Carried By',
    receivedBy: 'Received By',
    signatureAndDate: 'Signature & Date',
    footer: 'Goods received in good condition and full quantity.',
    noPriceHint: 'This document carries no price information.',
};

function renderChallan(overrides: Parameters<typeof printDeliveryChallan>[0] | null = null): string {
    const write = jest.fn();
    const mockWindow = {
        document: { write, close: jest.fn(), images: [] },
        print: jest.fn(),
        set onload(handler: () => void) {
            handler();
        },
    };
    jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    printDeliveryChallan(
        overrides ?? {
            challanNumber: 'INV-00042',
            invoiceNumber: 'INV-00042',
            date: '17 Sep 2026',
            companyName: 'Demo Store',
            customerName: 'Rahim Traders',
            customerPhone: '01711-000000',
            deliveryAddress: '12 Bijoy Sarani, Dhaka',
            driverName: 'Karim',
            vehicleNo: 'DHA-11-2233',
            items: [
                { name: 'Ceiling Fan', sku: 'FAN-56', quantity: 3, unit: 'pcs' },
                { name: 'Cable Roll', quantity: 2 },
            ],
            note: 'Call before arriving.',
            labels,
        },
    );

    expect(write).toHaveBeenCalledTimes(1);
    return write.mock.calls[0][0] as string;
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('printDeliveryChallan', () => {
    it('prints the goods, the parties and the carrier', () => {
        const html = renderChallan();

        expect(html).toContain('Delivery Challan');
        expect(html).toContain('INV-00042');
        expect(html).toContain('Rahim Traders');
        expect(html).toContain('12 Bijoy Sarani, Dhaka');
        expect(html).toContain('Ceiling Fan');
        expect(html).toContain('FAN-56');
        expect(html).toContain('Cable Roll');
        expect(html).toContain('Driver: Karim');
        expect(html).toContain('Vehicle No.: DHA-11-2233');
        expect(html).toContain('Call before arriving.');
    });

    /*
     * The reason this document exists. If a future change reintroduces a money
     * column, this fails.
     */
    it('carries no price, rate, discount or total amount', () => {
        const html = renderChallan();

        expect(html).not.toMatch(/৳|BDT|\$/);
        expect(html).not.toMatch(/Unit Price|Discount|Subtotal|VAT|Payment|Amount/i);
        expect(html).toContain('This document carries no price information.');
    });

    it('totals the quantity, which is the only total it has', () => {
        const html = renderChallan();

        expect(html).toContain('Total Quantity');
        // 3 fans + 2 rolls.
        expect(html).toMatch(/Total Quantity<\/td><td>5<\/td>/);
    });

    it('prints the invoice number only when it differs from the challan number', () => {
        const same = renderChallan({
            challanNumber: 'INV-00042',
            invoiceNumber: 'INV-00042',
            date: '17 Sep 2026',
            items: [{ name: 'Ceiling Fan', quantity: 1 }],
            labels,
        });
        expect(same).not.toContain('Invoice No.');

        const differs = renderChallan({
            challanNumber: 'CHL-0007',
            invoiceNumber: 'INV-00042',
            date: '17 Sep 2026',
            items: [{ name: 'Ceiling Fan', quantity: 1 }],
            labels,
        });
        expect(differs).toContain('Invoice No.: INV-00042');
    });

    it('prints three signature lines — sender, carrier and receiver', () => {
        const html = renderChallan();

        expect(html).toContain('Delivered By');
        expect(html).toContain('Carried By');
        expect(html).toContain('Received By');
        expect(html.match(/class="sign-line"/g)).toHaveLength(3);
    });

    it('escapes tenant and product text', () => {
        const html = renderChallan({
            challanNumber: 'INV-1',
            date: '17 Sep 2026',
            customerName: '<script>alert(1)</script>',
            items: [{ name: 'Bolt & Nut', quantity: 1 }],
            labels,
        });

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('Bolt &amp; Nut');
    });

    it('drops the money columns on thermal paper too', () => {
        const html = renderChallan({
            challanNumber: 'INV-2',
            date: '17 Sep 2026',
            items: [{ name: 'Ceiling Fan', quantity: 3 }],
            labels,
        });

        expect(html).toContain('Ceiling Fan');
        expect(html).not.toMatch(/৳|BDT|\$/);
    });
});
