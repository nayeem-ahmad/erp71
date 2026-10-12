import { DEFAULT_INVOICE_PRINT_PREFS, type InvoicePrintPrefs } from '@erp71/shared-types';
import { printSalesQuotation, type PrintableQuotation, type QuotationPrintContext } from './sales-quotation-printer';

const quote: PrintableQuotation = {
    id: 'quote-1',
    quote_number: 'QUO-00042',
    version: 1,
    created_at: '2026-10-06T06:00:00.000Z',
    valid_until: '2026-10-20T00:00:00.000Z',
    total_amount: '2200',
    vat_amount: '0',
    doc_kind: 'QUOTE',
    currency: 'BDT',
    notes: 'Prices hold for two weeks',
    store_id: 'store-1',
    customer: { name: 'Bio Care', phone: '01711111111', address: '12 Mirpur Road', customer_code: 'C00404' },
    items: [
        {
            quantity: 2,
            unit_price: '700',
            product: { name: '3 Head Fascial Gun', warranty_enabled: true, warranty_duration_days: 180 },
        },
        { quantity: 2, unit_price: '400', product: { name: '360 Spin Massager' } },
    ],
};

const ctx: QuotationPrintContext = {
    companyName: 'Life Tech Medical',
    locale: 'en',
    unknownProductLabel: 'Unknown product',
    printedBy: 'Rina Akter',
    printedAt: '06-10-2026 1:02:59 PM',
};

function render(
    data: PrintableQuotation = quote,
    layout: Partial<InvoicePrintPrefs> = {},
    context: Partial<QuotationPrintContext> = {},
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

    printSalesQuotation(data, { ...ctx, ...context }, { ...DEFAULT_INVOICE_PRINT_PREFS, ...layout });

    expect(write).toHaveBeenCalledTimes(1);
    return write.mock.calls[0][0] as string;
}

afterEach(() => jest.restoreAllMocks());

/** The customer side and the document side of the boxed block. */
function infoBox(html: string): { left: string; right: string } {
    const start = html.indexOf('<div class="d-info">');
    const box = html.slice(start, html.indexOf('</thead>', start));
    return {
        left: box.slice(box.indexOf('d-info-l'), box.indexOf('d-info-r')),
        right: box.slice(box.indexOf('d-info-r')),
    };
}

const customerLine = (label: string, value: string) =>
    `<span class="d-info-k">${label}</span><span class="d-info-c">:</span><span>${value}</span>`;

describe('sales quotation — detailed layout', () => {
    it('prints the detailed design even for a member whose invoice is standard', () => {
        const html = render(quote, { layout: 'standard' });
        expect(html).toContain('<div class="d-info">');
        expect(html).toContain('class="d-table');
        expect(html).not.toContain('Invoice Details');
    });

    it('titles the paper a Quotation, with the QR code in place of the number and date', () => {
        const html = render(quote, {}, { qrDataUrl: 'data:image/png;base64,AAAA' });
        const header = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));

        expect(html).toContain('<title>Quotation QUO-00042</title>');
        expect(header).toContain('Quotation');
        expect(header).toContain('<img class="p71-hd-qr" src="data:image/png;base64,AAAA"');
        expect(header).not.toContain('p71-hd-meta');
    });

    it('boxes the customer on the left and the quotation on the right', () => {
        const { left, right } = infoBox(render());

        expect(left).toContain(customerLine('Customer ID', 'C00404'));
        expect(left).toContain(customerLine('Name', 'Bio Care'));
        expect(left).toContain(customerLine('Address', '12 Mirpur Road'));
        expect(left).toContain(customerLine('Mobile', '01711111111'));
        expect(right).toContain('<strong>Quotation No.:</strong> QUO-00042');
        expect(right).toContain('<strong>Date:</strong>');
        expect(right).toContain('<strong>Valid Until:</strong>');
        // A first version needs no version line; nothing invoice-only appears.
        for (const label of ['Version', 'Invoice No.', 'Order No.', 'Sales By', 'Entry By']) {
            expect(right).not.toContain(label);
        }
    });

    it('names the version of a revised quotation, which keeps its number', () => {
        expect(infoBox(render({ ...quote, version: 3 })).right).toContain('<strong>Version:</strong> 3');
    });

    it('names a walk-in as such and leaves out an open-ended validity', () => {
        const { left, right } = infoBox(render({ ...quote, customer: null, valid_until: null }));
        expect(left).toContain(customerLine('Name', 'Walk-in Customer'));
        expect(left).not.toContain('Customer ID');
        expect(right).not.toContain('Valid Until');
    });

    it('lists the items with their warranty, ৳ in the headers only', () => {
        const html = render();
        for (const heading of ['SL', 'Item', 'Warranty', 'Quantity', 'Unit Price (৳)', 'Total (৳)']) {
            expect(html).toContain(`>${heading}</th>`);
        }
        expect(html).toContain('<td class="d-warranty">6 months</td>');
        expect(html).toContain('<td class="d-num">700.00</td>');
        expect(html).toContain('<td class="d-num">1,400.00</td>');
        expect(html).not.toContain('Discount (৳)</th>');
    });

    it('follows the member’s warranty column and table rules', () => {
        const noWarranty = { ...quote, items: [quote.items[1]], total_amount: '800' };
        expect(render(noWarranty, { warranty_column: 'when-used' })).not.toContain('>Warranty</th>');
        expect(render(quote, { table_borders: 'columns' })).toContain('d-table--ruled');
    });

    it('totals the lines and closes on the total, with no payment, due or balance', () => {
        const html = render();
        expect(html).toContain('<td>Sub Total (৳):</td><td>2,200.00</td>');
        expect(html).toContain('<tr class="rule"><td>Total (৳):</td><td>2,200.00</td></tr>');
        for (const gone of ['Paid', 'Due', 'Previous Due', 'Total Due', 'VAT', 'Discount']) {
            expect(html).not.toContain(`<td>${gone}`);
        }
    });

    it('adds the VAT a quotation entered before VAT carries on top', () => {
        const html = render({ ...quote, vat_amount: '330', total_amount: '2530' });
        expect(html).toContain('<td>Sub Total (৳):</td><td>2,200.00</td>');
        expect(html).toContain('<td>VAT (৳):</td><td>330.00</td>');
        expect(html).toContain('<td>Total (৳):</td><td>2,530.00</td>');
    });

    it('shows a total below the lines as a discount, so the block foots', () => {
        const html = render({ ...quote, total_amount: '2100' });
        expect(html).toContain('<tr class="neg"><td>Discount (৳):</td><td>-100.00</td></tr>');
        expect(html).toContain('<td>Total (৳):</td><td>2,100.00</td>');
    });

    it('writes the total in words, the note and the signatures when the member asked for them', () => {
        const html = render(quote, { amount_in_words: true, signature_lines: true });
        expect(html).toContain('<strong>In Word:</strong> Taka Two Thousand Two Hundred Only');
        expect(html).toContain('<strong>Note:</strong> Prices hold for two weeks');
        expect(html).toContain("Customer's Signature");
    });

    it('pins the thank-you to the page foot and stamps who printed it', () => {
        const html = render();
        expect(html).toContain('<div class="d-foot-l">Thank you for your business!</div>');
        expect(html).toContain('Printed 06-10-2026 1:02:59 PM by Rina Akter');
        expect(render(quote, { footer_text: 'Valid while stocks last' })).toContain(
            '<div class="d-foot-l">Valid while stocks last</div>',
        );
    });

    it('escapes what a customer or a user typed', () => {
        const html = render({
            ...quote,
            notes: '<script>x</script>',
            customer: { ...quote.customer, name: '<b>Bio</b>' },
            items: [{ quantity: 1, unit_price: '10', product: { name: 'A & B' } }],
            total_amount: '10',
        });
        expect(html).not.toContain('<b>Bio</b>');
        expect(html).not.toContain('<script>x</script>');
        expect(html).toContain('&lt;b&gt;Bio&lt;/b&gt;');
        expect(html).toContain('<td class="d-item">A &amp; B</td>');
    });
});

describe('proforma invoice — detailed layout', () => {
    const proforma: PrintableQuotation = {
        ...quote,
        quote_number: 'PI-00007',
        doc_kind: 'PROFORMA',
        currency: 'USD',
        total_amount: '22',
        items: [{ quantity: 2, unit_price: '11', product: { name: 'Surgical Gloves' } }],
        incoterm: 'FOB',
        port_of_loading: 'Chattogram',
        payment_terms: '30% advance by TT, balance against BL copy',
        advance_percent: '30',
        delivery_lead_time_days: 45,
    };

    it('titles the paper a Proforma Invoice and numbers it as one', () => {
        const html = render(proforma);
        expect(html).toContain('<title>Proforma Invoice PI-00007</title>');
        expect(infoBox(html).right).toContain('<strong>Proforma No.:</strong> PI-00007');
    });

    it('names its own currency in the headers rather than ৳, and spells nothing out in taka', () => {
        const html = render(proforma, { amount_in_words: true });
        expect(html).toContain('>Unit Price (USD)</th>');
        expect(html).toContain('<td>Total (USD):</td><td>22.00</td>');
        expect(html).not.toContain('(৳)');
        expect(html).not.toContain('In Word:');
    });

    it('lists the terms that were filled in where an invoice keeps the account', () => {
        const html = render(proforma);
        const left = html.slice(html.indexOf('<div class="d-left">'), html.indexOf('<div class="d-right">'));
        expect(left).toContain('<td>Incoterm</td><td>FOB</td>');
        expect(left).toContain('<td>Port of Loading</td><td>Chattogram</td>');
        expect(left).toContain('<td>Delivery</td><td>45 days from order</td>');
        expect(left).toContain('<td>Advance</td><td>30%</td>');
        expect(left).toContain('<td>Payment Terms</td><td>30% advance by TT, balance against BL copy</td>');
        expect(left).not.toContain('Port of Discharge');
    });

    it('prints no terms block on an ordinary quotation', () => {
        expect(render({ ...quote, incoterm: 'FOB' })).not.toContain('d-terms"');
    });
});
