import { buildMushakReceiptBody, type MushakReceiptData } from './mushak-receipt-printer';

/**
 * The thermal 6.3 is a statutory document printed on an 80mm roll. These tests
 * pin the two things that make it one: the gazetted wording survives the narrow
 * layout, and the figures on the paper are the ones the server computed.
 */

const doc: MushakReceiptData = {
    form: '6.3',
    issuer: {
        name: 'Karim Stores Ltd',
        bin: '004123456-0101',
        address: '12 Motijheel, Dhaka',
        economicActivity: 'Retail trade',
        officerName: 'Karim Uddin',
        officerDesignation: 'Proprietor',
    },
    buyer: { name: 'Rahim Traders', bin: '009876543-0202', nid: null, address: 'Chattogram' },
    invoice: {
        saleId: 'sale-1',
        number: 'INV-1001',
        serialNumber: 'INV-1001',
        issuedAt: '2026-09-17T10:30:00.000Z',
        status: 'COMPLETED',
        cancelled: false,
        destination: 'Chattogram depot',
        vehicleNo: 'Truck DM-11-2345',
        branch: 'Main',
    },
    lines: [
        {
            serial: 1,
            description: 'Ceiling Fan',
            sku: 'FAN-01',
            unitBn: 'সংখ্যা',
            unitEn: 'Nos',
            quantity: 2,
            unitValue: 1000,
            totalValue: 2000,
            sdRate: 5,
            sdAmount: 100,
            vatRate: 15,
            vatAmount: 315,
            inclusiveTotal: 2415,
        },
    ],
    totals: { totalValue: 2000, sdAmount: 100, vatAmount: 315, inclusiveTotal: 2415 },
    estimated: false,
    date: '17 Sep 2026, 4:30 PM',
    payments: [{ method: 'CASH', amount: 2500 }],
    amountPaid: 2500,
};

describe('buildMushakReceiptBody', () => {
    it('names the form and the issuing authority', () => {
        const html = buildMushakReceiptBody(doc, 'Thermal80');
        expect(html).toContain('মূসক-৬.৩');
        expect(html).toContain('গণপ্রজাতন্ত্রী বাংলাদেশ সরকার');
        expect(html).toContain('জাতীয় রাজস্ব বোর্ড');
    });

    it('carries both parties and their BINs', () => {
        const html = buildMushakReceiptBody(doc, 'Thermal80');
        expect(html).toContain('Karim Stores Ltd');
        expect(html).toContain('004123456-0101');
        expect(html).toContain('Rahim Traders');
        expect(html).toContain('009876543-0202');
    });

    it('prints each line with its own SD and VAT figures, not just a total', () => {
        const html = buildMushakReceiptBody(doc, 'Thermal80');
        expect(html).toContain('Ceiling Fan');
        // Per-line rates are what distinguish a 6.3 from the ordinary receipt.
        expect(html).toContain('15%');
        expect(html).toContain('5%');
        expect(html).toMatch(/315/);
        expect(html).toMatch(/100/);
    });

    it('foots to the server-supplied totals', () => {
        const html = buildMushakReceiptBody(doc, 'Thermal80');
        // The inclusive total is the figure the customer pays and the figure
        // NBR reads; it must appear exactly as the server computed it.
        expect(html).toMatch(/2,415|2415/);
    });

    it('shows the delivery boxes Rule 40 asks for when they are set', () => {
        const html = buildMushakReceiptBody(doc, 'Thermal80');
        expect(html).toContain('Chattogram depot');
        expect(html).toContain('Truck DM-11-2345');
    });

    it('omits the delivery block entirely when the customer carries the goods out', () => {
        const walkIn = {
            ...doc,
            invoice: { ...doc.invoice, destination: null, vehicleNo: null },
        };
        const html = buildMushakReceiptBody(walkIn, 'Thermal80');
        expect(html).not.toContain('গন্তব্যস্থল');
    });

    it('declares a reconstructed document rather than passing it off as a reprint', () => {
        const html = buildMushakReceiptBody({ ...doc, estimated: true }, 'Thermal80');
        expect(html.toLowerCase()).toContain('estimated');
    });

    it('marks a cancelled sale so the slip cannot be passed off as live', () => {
        const cancelled = {
            ...doc,
            invoice: { ...doc.invoice, cancelled: true, status: 'CANCELLED' },
        };
        const html = buildMushakReceiptBody(cancelled, 'Thermal80');
        expect(html.toLowerCase()).toContain('cancelled');
    });

    it('escapes party names so a quote in a shop name cannot break the markup', () => {
        const nasty = {
            ...doc,
            buyer: { ...doc.buyer, name: '<script>alert("x")</script>' },
        };
        const html = buildMushakReceiptBody(nasty, 'Thermal80');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('still carries every statutory field at 58mm', () => {
        // 58mm is the narrowest roll the print stack supports. The layout may
        // compress but nothing statutory may be dropped to make it fit.
        const html = buildMushakReceiptBody(doc, 'Thermal58');
        expect(html).toContain('মূসক-৬.৩');
        expect(html).toContain('004123456-0101');
        expect(html).toContain('009876543-0202');
        expect(html).toContain('Ceiling Fan');
        expect(html).toMatch(/2,415|2415/);
    });
});
