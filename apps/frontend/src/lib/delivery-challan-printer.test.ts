import {
    printDeliveryChallan,
    type ChallanLabels,
    type DeliveryChallanData,
    type PaperSize,
} from './delivery-challan-printer';
import { messageCatalog } from './localization/messages';

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

const fullChallan: DeliveryChallanData = {
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
};

/**
 * Every money marker a sale could put on paper: the symbols `formatBDT` and
 * `formatCurrency` emit, and the column and row headings the invoice printer
 * uses. If a price ever reaches the challan it arrives wearing one of these.
 */
const MONEY_MARKERS = /৳|BDT|\$|€|Unit Price|Discount|Subtotal|VAT|Payment|Amount|Total Price|Rate|Paid|Balance|Due/i;

let lastOpenArgs: unknown[] = [];

function renderChallan(
    data: DeliveryChallanData = fullChallan,
    paperSize?: PaperSize,
): string {
    const write = jest.fn();
    const mockWindow = {
        document: { write, close: jest.fn(), images: [] },
        print: jest.fn(),
        set onload(handler: () => void) {
            handler();
        },
    };
    const open = jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    if (paperSize) printDeliveryChallan(data, paperSize);
    else printDeliveryChallan(data);

    expect(write).toHaveBeenCalledTimes(1);
    lastOpenArgs = open.mock.calls[0] as unknown[];
    return write.mock.calls[0][0] as string;
}

afterEach(() => {
    jest.restoreAllMocks();
    lastOpenArgs = [];
});

describe('printDeliveryChallan — what it carries', () => {
    it('prints the goods, the parties and the carrier', () => {
        const html = renderChallan();

        expect(html).toContain('Delivery Challan');
        expect(html).toContain('INV-00042');
        expect(html).toContain('Rahim Traders');
        expect(html).toContain('01711-000000');
        expect(html).toContain('12 Bijoy Sarani, Dhaka');
        expect(html).toContain('Ceiling Fan');
        expect(html).toContain('FAN-56');
        expect(html).toContain('Cable Roll');
        expect(html).toContain('Driver: Karim');
        expect(html).toContain('Vehicle No.: DHA-11-2233');
        expect(html).toContain('Call before arriving.');
    });

    it('numbers each line and marks a line with no unit rather than leaving it blank', () => {
        const html = renderChallan();

        // Two lines, numbered 1 and 2 — a rider counts down the page.
        expect(html).toContain('<td class="item-sl">1</td>');
        expect(html).toContain('<td class="item-sl">2</td>');
        // The fan is in pcs; the cable roll was given no unit.
        expect(html).toContain('<td class="item-unit">pcs</td>');
        expect(html).toContain('<td class="item-unit">—</td>');
    });

    it('totals the quantity, which is the only total it has', () => {
        const html = renderChallan();

        expect(html).toContain('Total Quantity');
        // 3 fans + 2 rolls.
        expect(html).toMatch(/Total Quantity<\/td><td>5<\/td>/);
    });

    it('totals loose quantities too, for goods sold by weight', () => {
        const html = renderChallan({
            ...fullChallan,
            items: [
                { name: 'Rice', quantity: 12.5, unit: 'kg' },
                { name: 'Dal', quantity: 3.25, unit: 'kg' },
            ],
        });

        expect(html).toMatch(/Total Quantity<\/td><td>15\.75<\/td>/);
    });

    it('prints three signature lines — sender, carrier and receiver', () => {
        const html = renderChallan();

        expect(html).toContain('Delivered By');
        expect(html).toContain('Carried By');
        expect(html).toContain('Received By');
        expect(html.match(/class="sign-line"/g)).toHaveLength(3);
        // The band must not be split by a page break — a signature stranded on
        // page 2 is how a delivery ends up with no proof of receipt.
        expect(html).toContain('page-break-inside: avoid');
    });

    it('prints the invoice number only when it differs from the challan number', () => {
        const same = renderChallan({ ...fullChallan, invoiceNumber: 'INV-00042' });
        expect(same).not.toContain('Invoice No.');

        const differs = renderChallan({ ...fullChallan, challanNumber: 'CHL-0007' });
        expect(differs).toContain('Invoice No.: INV-00042');
    });
});

/*
 * The reason this document exists. If a future change reintroduces a money
 * column, or a caller finds a way to smuggle a figure in, these fail.
 */
describe('printDeliveryChallan — the no-price guarantee', () => {
    it('carries no price, rate, discount, VAT or total amount', () => {
        const html = renderChallan();

        expect(html).not.toMatch(MONEY_MARKERS);
        expect(html).toContain('This document carries no price information.');
    });

    it('holds even when a caller force-casts money fields onto the payload', () => {
        // Not reachable through the type, which is the point — this pins the
        // behaviour for a caller who casts around it (an `any` from an API
        // response, say) rather than trusting the compiler alone.
        const smuggled = {
            ...fullChallan,
            total: 11500,
            subtotal: 10000,
            vat: 1500,
            items: [
                { name: 'Ceiling Fan', quantity: 3, unitPrice: 5000, price: 5000, discount: 250 },
            ],
        } as unknown as DeliveryChallanData;

        const html = renderChallan(smuggled);

        expect(html).toContain('Ceiling Fan');
        expect(html).not.toContain('11500');
        expect(html).not.toContain('10000');
        expect(html).not.toContain('5000');
        expect(html).not.toContain('1500');
        expect(html).not.toContain('250');
        expect(html).not.toMatch(MONEY_MARKERS);
    });

    it('stays money-free on thermal paper, where the layout differs', () => {
        const html = renderChallan(fullChallan, 'Thermal80');

        expect(html).toContain('@page { size: 80mm auto');
        expect(html).toContain('Ceiling Fan');
        expect(html).not.toMatch(MONEY_MARKERS);
    });
});

describe('printDeliveryChallan — paper', () => {
    it('defaults to A4 and opens a window sized for it', () => {
        const html = renderChallan();

        expect(html).toContain('@page { size: A4 portrait');
        expect(lastOpenArgs[2]).toBe('width=950,height=850');
    });

    it('honours the paper size the operator chose', () => {
        const html = renderChallan(fullChallan, 'A5');

        expect(html).toContain('@page { size: A5 portrait');
        expect(lastOpenArgs[2]).toBe('width=670,height=600');
    });

    /*
     * Thermal drops the Challan Details block from the body to save paper, so
     * the number has to survive in the letterhead — a challan nobody can tie
     * back to a sale is not worth carrying.
     */
    it('still identifies the challan on thermal, where the details block is dropped', () => {
        const html = renderChallan(fullChallan, 'Thermal58');

        expect(html).not.toContain('Challan Details');
        expect(html).toContain('INV-00042');
        expect(html).toContain('17 Sep 2026');
        // The carrier still rides along — the rider's own copy names the rider.
        expect(html).toContain('Driver: Karim');
    });

    /*
     * A blocked popup is the ordinary case at a counter, not an edge one: the
     * browser hands back null and the shop's screen must stay usable.
     */
    it('does not throw when the browser blocks the print window', () => {
        jest.spyOn(window, 'open').mockReturnValue(null);

        expect(() => printDeliveryChallan(fullChallan)).not.toThrow();
    });
});

describe('printDeliveryChallan — sparse sales', () => {
    it('prints a walk-in sale with no customer, keeping the receipt signature', () => {
        const html = renderChallan({
            challanNumber: 'INV-00043',
            date: '17 Sep 2026',
            items: [{ name: 'Ceiling Fan', quantity: 1 }],
            labels,
        });

        // Nobody to address it to, so the block is skipped rather than printed empty.
        expect(html).not.toContain('Deliver To');
        // But somebody still signs for the goods.
        expect(html).toContain('Received By');
        expect(html.match(/class="sign-line"/g)).toHaveLength(3);
    });

    it('omits the note box when the sale has no note', () => {
        const html = renderChallan({ ...fullChallan, note: undefined });

        expect(html).not.toContain('class="note-box"');
    });

    it('omits the SKU line for a product that has none', () => {
        const html = renderChallan({
            ...fullChallan,
            items: [{ name: 'Cable Roll', quantity: 2 }],
        });

        expect(html).not.toContain('class="sku"');
    });

    it('renders an empty sale without crashing, at zero quantity', () => {
        const html = renderChallan({ ...fullChallan, items: [] });

        expect(html).toMatch(/Total Quantity<\/td><td>0<\/td>/);
        expect(html).toContain('Received By');
    });
});

describe('printDeliveryChallan — locale and escaping', () => {
    /*
     * Every printed string comes from `labels`, so a Bengali shop's challan is
     * Bengali end to end. If a heading is ever hardcoded back into the printer,
     * this catches it.
     */
    it('prints entirely in the locale it is given', () => {
        const bn = messageCatalog.bn.sales.challan;
        const html = renderChallan({ ...fullChallan, labels: bn });

        expect(html).toContain(bn.title);
        expect(html).toContain(bn.receivedBy);
        expect(html).toContain(bn.totalQuantity);
        expect(html).toContain(bn.noPriceHint);
        // None of the English headings survive.
        expect(html).not.toContain('Delivery Challan');
        expect(html).not.toContain('Received By');
        expect(html).not.toContain('Total Quantity');
    });

    it('titles the browser window and the letterhead from the locale', () => {
        const bn = messageCatalog.bn.sales.challan;
        const html = renderChallan({ ...fullChallan, labels: bn });

        expect(html).toContain(`<title>${bn.title} INV-00042</title>`);
    });

    it('escapes tenant, customer and product text', () => {
        const html = renderChallan({
            challanNumber: 'INV-1',
            date: '17 Sep 2026',
            customerName: '<script>alert(1)</script>',
            items: [{ name: 'Bolt & Nut', quantity: 1, sku: '"BN-1"', unit: '<b>pcs</b>' }],
            note: 'Ring the bell & wait',
            labels,
        });

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('Bolt &amp; Nut');
        expect(html).toContain('&quot;BN-1&quot;');
        expect(html).toContain('&lt;b&gt;pcs&lt;/b&gt;');
        expect(html).toContain('Ring the bell &amp; wait');
    });

    it('escapes a driver name reaching the page through a label-prefixed line', () => {
        const html = renderChallan({
            ...fullChallan,
            driverName: '<img src=x onerror=alert(1)>',
        });

        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x');
    });
});
