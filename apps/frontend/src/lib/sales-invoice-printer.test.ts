import { DEFAULT_INVOICE_PRINT_PREFS, type InvoicePrintPrefs } from '@erp71/shared-types';
import { printSalesInvoice, printSalesInvoices, type InvoiceData, type PaperSize } from './sales-invoice-printer';
import { formatBDT } from './format';

const baseInvoice: InvoiceData = {
    referenceNumber: '2609-010',
    date: '17/09/2026',
    companyName: 'Demo Store',
    customerName: 'Tanvir Akter',
    customerPhone: '01400300051',
    items: [
        { name: 'Disposable Mask', sku: 'P00163', quantity: 2, unitPrice: 110 },
        { name: 'Power Adapter AC-DC 5V', sku: 'P00280', quantity: 1, unitPrice: 70 },
    ],
    payments: [{ method: 'MOBILE_WALLET', amount: 290 }],
    subtotal: 290,
    total: 290,
};

function render(
    data: InvoiceData = baseInvoice,
    paperSize?: PaperSize,
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

    if (layout) printSalesInvoice(data, paperSize ?? 'A4', undefined, { ...DEFAULT_INVOICE_PRINT_PREFS, ...layout });
    else if (paperSize) printSalesInvoice(data, paperSize);
    else printSalesInvoice(data);

    expect(write).toHaveBeenCalledTimes(1);
    return write.mock.calls[0][0] as string;
}

afterEach(() => jest.restoreAllMocks());

/**
 * The `.rule { … }` block for a selector, so a test can assert on its
 * declarations.
 *
 * Anchored to the start of the selector, or asking for `.item-disc` would also
 * match the `thead th.item-disc` rule and read the wrong declarations.
 */
function ruleFor(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|[\\s{};])${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
}

describe('sales invoice layout', () => {
    it('pads the content away from the page edge', () => {
        const html = render();

        expect(ruleFor(html, '.invoice-body')).toMatch(/padding:/);
    });

    it('aligns each column header with the cells beneath it', () => {
        const html = render();

        // A right-aligned number under a left-aligned header is the misalignment
        // the invoice actually showed; the header must follow its own column.
        expect(ruleFor(html, '.items-table thead th.item-qty')).toContain('center');
        expect(ruleFor(html, '.items-table thead th.item-price')).toContain('right');
        expect(ruleFor(html, '.items-table thead th.item-disc')).toContain('right');
        expect(ruleFor(html, '.items-table thead th.item-total')).toContain('right');
    });

    it('does not paint the empty-discount placeholder red', () => {
        const html = render();

        // The dash means "no discount" — colouring it red reads as a value.
        // The marker class alone proves nothing; it has to actually override
        // the red it inherits from `.item-disc`.
        expect(html).toContain('<td class="item-disc item-disc--empty">—</td>');
        expect(ruleFor(html, '.item-disc--empty')).toMatch(/color:\s*inherit/);
    });

    it('keeps a real discount marked in red', () => {
        const html = render({
            ...baseInvoice,
            items: [{ name: 'Mask', quantity: 2, unitPrice: 110, discount: 20 }],
        });

        expect(html).toContain('class="item-disc"');
        expect(ruleFor(html, '.item-disc')).toContain('#ef4444');
    });

    it('prints the grand total in the body text colour, not an accent', () => {
        const html = render();
        const rule = ruleFor(html, '.grand-total td');

        expect(rule).not.toMatch(/#1d4ed8/);
    });

    it('leaves the thermal receipt in its own tight treatment', () => {
        const html = render(baseInvoice, 'Thermal80');

        // A roll is monospace and edge-to-edge; page padding would waste paper.
        expect(ruleFor(html, '.invoice-body')).not.toMatch(/padding:\s*\d+mm/);
    });
});

/** The totals block as [label, amount] pairs, top to bottom. */
function totalsRows(html: string): [string, string][] {
    const table = html.match(/<table class="totals-table">([\s\S]*?)<\/table>/)?.[1] ?? '';
    return [...table.matchAll(/<tr[^>]*><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)]
        .map(([, label, amount]) => [label, amount]);
}

/** A ৳4,800 credit sale with ৳3,000 paid, to a customer who owed ৳2,000. */
const creditSale: InvoiceData = {
    ...baseInvoice,
    items: [{ name: 'Rice 25kg', quantity: 2, unitPrice: 2400 }],
    payments: [{ method: 'Cash', amount: 3000 }],
    subtotal: 4800,
    total: 4800,
    amountPaid: 3000,
    previousDue: 2000,
};

describe('customer dues', () => {
    it('closes on paid, this invoice\'s due, the previous due and the total due', () => {
        const rows = totalsRows(render(creditSale));

        expect(rows.slice(-4)).toEqual([
            ['Paid', formatBDT(3000)],
            ['Due', formatBDT(1800)],
            ['Previous Due', formatBDT(2000)],
            ['Total Due', formatBDT(3800)],
        ]);
    });

    it('rules the total due off, on a roll as well as a page', () => {
        for (const size of ['A4', 'Thermal80'] as const) {
            const html = render(creditSale, size);

            expect(html).toContain(`<tr class="total-due"><td>Total Due</td><td>${formatBDT(3800)}</td></tr>`);
            expect(ruleFor(html, '.total-due td')).toMatch(/border-top:/);
        }
    });

    it('drops the invoice\'s own due when it was paid in full', () => {
        const rows = totalsRows(render({ ...creditSale, amountPaid: 4800 }));
        const labels = rows.map(([label]) => label);

        expect(labels).not.toContain('Due');
        expect(rows.slice(-3)).toEqual([
            ['Paid', formatBDT(4800)],
            ['Previous Due', formatBDT(2000)],
            ['Total Due', formatBDT(2000)],
        ]);
    });

    it('takes what was paid from the payments when no figure is given', () => {
        const rows = totalsRows(render({ ...creditSale, amountPaid: undefined }));

        expect(rows).toContainEqual(['Paid', formatBDT(3000)]);
        expect(rows).toContainEqual(['Total Due', formatBDT(3800)]);
    });

    it('prints a walk-in invoice as it always has', () => {
        const labels = totalsRows(render(baseInvoice)).map(([label]) => label);

        expect(labels).not.toContain('Previous Due');
        expect(labels).not.toContain('Total Due');
        expect(labels).not.toContain('Paid');
    });

    it('prints no dues for a settled invoice to a customer who owes nothing', () => {
        const labels = totalsRows(render({ ...baseInvoice, amountPaid: 290, previousDue: 0 }))
            .map(([label]) => label);

        expect(labels).not.toContain('Total Due');
    });
});

describe('payment method labels', () => {
    function labelFor(method: string): string {
        const html = render({
            ...baseInvoice,
            payments: [{ method, amount: 290 }],
        });
        return html.match(/<td class="pay-label">([^<]*)/)?.[1] ?? '';
    }

    it('prints the stored display strings unchanged', () => {
        // What the database actually holds for ~99% of rows.
        expect(labelFor('Cash')).toBe('Cash');
        expect(labelFor('bKash')).toBe('bKash');
        expect(labelFor('Card')).toBe('Card');
        expect(labelFor('Nagad')).toBe('Nagad');
        expect(labelFor('Mobile Wallet')).toBe('Mobile Wallet');
        expect(labelFor('Bank')).toBe('Bank');
    });

    it('gives a legacy uppercase key the same label as its modern spelling', () => {
        // Older rows stored the enum key. `CARD` rendering as "Credit Card"
        // while `Card` renders as "Card" makes one payment type read as two.
        expect(labelFor('CARD')).toBe(labelFor('Card'));
        expect(labelFor('CASH')).toBe(labelFor('Cash'));
        expect(labelFor('BKASH')).toBe(labelFor('bKash'));
    });

    it('labels the shared-type keys rather than printing them raw', () => {
        expect(labelFor('MOBILE_WALLET')).toBe('Mobile Wallet');
        expect(labelFor('BANK')).toBe('Bank');
    });
});

describe('bulk invoices', () => {
    function renderMany(
        invoices: InvoiceData[],
        paperSize: PaperSize = 'A4',
        layout?: Partial<InvoicePrintPrefs>,
    ): string {
        const write = jest.fn();
        const mockWindow = {
            document: { write, close: jest.fn(), images: [] },
            print: jest.fn(),
            focus: jest.fn(),
            set onload(handler: () => void) {
                handler();
            },
        };
        jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);
        printSalesInvoices(
            invoices,
            paperSize,
            undefined,
            layout ? { ...DEFAULT_INVOICE_PRINT_PREFS, ...layout } : undefined,
        );
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
        return write.mock.calls[0][0] as string;
    }

    /** Each document's markup — a preview sheet or a print section alike. */
    const jobsOf = (html: string) => html.split(/<[a-z]+ class="[^"]*\bp71-job\b[^"]*">/).slice(1);

    const three = ['2609-010', '2609-011', '2609-012'].map((referenceNumber) => ({
        ...baseInvoice,
        referenceNumber,
    }));

    it('prints every invoice in one window, each on its own page', () => {
        const html = renderMany(three);

        for (const invoice of three) {
            expect(html).toContain(`Invoice #: <strong>${invoice.referenceNumber}</strong>`);
        }
        expect(html).toContain('<title>Invoices (3) — A4</title>');
        expect(jobsOf(html)).toHaveLength(3);
        // Before the next sheet, not after each, so the job ends on the last invoice.
        expect(ruleFor(html, '.p71-job + .p71-job')).toMatch(/break-before:\s*page/);
    });

    it('lays each invoice out as it prints alone, letterhead and all', () => {
        const html = renderMany([
            { ...baseInvoice, referenceNumber: 'G-1', storeName: 'Gulshan' },
            { ...baseInvoice, referenceNumber: 'D-1', storeName: 'Dhanmondi' },
        ]);

        // The letterhead repeats down each long invoice, as it does alone.
        expect(html.match(/<thead><tr><td>/g)).toHaveLength(2);
        const sheets = jobsOf(html);
        expect(sheets).toHaveLength(2);
        expect(sheets[0]).toContain('G-1');
        expect(sheets[1]).toContain('D-1');
    });

    it('prints with the member\'s own layout, as a single invoice does', () => {
        const html = renderMany(three, 'A4', { footer_text: 'Goods once sold are not returned' });

        expect(html.match(/Goods once sold are not returned/g)).toHaveLength(3);
        expect(html).not.toContain('Thank you for your business!');
    });

    it('opens nothing for an empty selection', () => {
        jest.spyOn(window, 'open');
        expect(printSalesInvoices([])).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });
});

describe('compact invoice', () => {
    beforeEach(() => window.localStorage.clear());

    it('ships tighter rows for a sheet, switched by the compact class', () => {
        const html = render();

        expect(ruleFor(html, 'html.p71-compact .items-table tbody td')).toMatch(/padding:2px 6px/);
        expect(ruleFor(html, 'html.p71-compact .items-table tbody td')).toMatch(/font-size:11px/);
        // Inert until the class is set: the normal cell keeps its own padding.
        expect(ruleFor(html, '.items-table tbody td')).toMatch(/padding:7px 10px/);
    });

    it('moves the SKU up beside the item name rather than onto a line of its own', () => {
        const html = render();

        expect(html).toContain('html.p71-compact .item-name br');
        // Grouped with the payment reference, which moves up the same way.
        expect(html).toMatch(/html\.p71-compact \.item-name \.sku[^{]*\{ margin-left:6px; \}/);
    });

    it('prints compact once the counter has chosen it, with the switch to undo it', () => {
        window.localStorage.setItem('erp71:print:density', 'compact');
        const html = render();

        expect(html).toContain('<html class="p71-compact">');
        expect(html).toMatch(/<input type="checkbox" checked onchange="document\.documentElement\.classList\.toggle/);
    });

    it('keeps a roll in its own treatment, compact or not', () => {
        window.localStorage.setItem('erp71:print:density', 'compact');
        const html = render(baseInvoice, 'Thermal80');

        expect(html).toContain('<html>');
        expect(html).not.toContain('html.p71-compact .items-table');
    });
});

describe('store tokens', () => {
    it('substitutes {{store_name}} from the sale\u2019s store', () => {
        const html = render({
            ...baseInvoice,
            storeName: 'Gulshan Branch',
            headerConfig: { lines: [{ text: 'Branch: {{store_name}}' }] },
        });
        expect(html).toContain('Branch: Gulshan Branch');
    });
});

describe('member layout preferences', () => {
    /** The item table's header labels, left to right. */
    function headerLabels(html: string): string[] {
        const head = html.match(/<table class="items-table[^"]*">\s*<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '';
        return [...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(([, label]) => label);
    }

    it('prints exactly as before when the member has saved nothing', () => {
        expect(render(baseInvoice, 'A4', {})).toBe(render(baseInvoice, 'A4'));
    });

    describe('padding', () => {
        it.each([
            ['narrow', '2mm 1mm'],
            ['normal', '6mm 4mm'],
            ['wide', '12mm 8mm'],
        ] as const)('%s pads the body by %s', (padding, value) => {
            expect(ruleFor(render(baseInvoice, 'A4', { padding }), '.invoice-body')).toContain(`padding:${value}`);
        });

        it('leaves a roll unpadded whatever the setting', () => {
            expect(ruleFor(render(baseInvoice, 'Thermal80', { padding: 'wide' }), '.invoice-body')).toContain('padding:0');
        });
    });

    describe('customer balance', () => {
        it('when-owed keeps today\'s behaviour', () => {
            const labels = totalsRows(render(creditSale, 'A4', { balance: 'when-owed' })).map(([l]) => l);
            expect(labels).toEqual(expect.arrayContaining(['Previous Due', 'Total Due']));
        });

        it('never hides the running balance but keeps what this invoice leaves unpaid', () => {
            const rows = totalsRows(render(creditSale, 'A4', { balance: 'never' }));
            const labels = rows.map(([l]) => l);

            expect(labels).not.toContain('Previous Due');
            expect(labels).not.toContain('Total Due');
            expect(rows.slice(-2)).toEqual([
                ['Paid', formatBDT(3000)],
                ['Due', formatBDT(1800)],
            ]);
        });

        it('never prints no dues at all for an invoice paid in full', () => {
            const labels = totalsRows(render({ ...creditSale, amountPaid: 4800 }, 'A4', { balance: 'never' }))
                .map(([l]) => l);
            expect(labels).not.toContain('Paid');
            expect(labels).not.toContain('Previous Due');
        });

        it('always shows a zero balance for a customer who owes nothing', () => {
            const rows = totalsRows(
                render({ ...baseInvoice, amountPaid: 290, previousDue: 0 }, 'A4', { balance: 'always' }),
            );
            expect(rows.slice(-3)).toEqual([
                ['Paid', formatBDT(290)],
                ['Previous Due', formatBDT(0)],
                ['Total Due', formatBDT(0)],
            ]);
        });

        it('always still prints no balance for a walk-in, who has no account', () => {
            const labels = totalsRows(render(baseInvoice, 'A4', { balance: 'always' })).map(([l]) => l);
            expect(labels).not.toContain('Total Due');
        });
    });

    describe('table style', () => {
        it.each(['striped', 'grid', 'shaded-header'] as const)('marks the table %s, with a rule to match', (style) => {
            const html = render(baseInvoice, 'A4', { table_style: style });
            expect(html).toContain(`<table class="items-table items-table--${style}">`);
            expect(html).toMatch(new RegExp(`\\.items-table--${style}[^{]*\\{[^}]*(background|border)`));
        });

        it('shades every other row when striped', () => {
            const html = render(baseInvoice, 'A4', { table_style: 'striped' });
            expect(html).toMatch(/\.items-table--striped tbody tr:nth-child\(even\) td\s*\{[^}]*background/);
        });

        it('keeps a roll plain, where grey only prints as dither', () => {
            const html = render(baseInvoice, 'Thermal80', { table_style: 'striped' });
            expect(html).toContain('<table class="items-table">');
        });
    });

    it('numbers the rows in an SL column', () => {
        const html = render(baseInvoice, 'A4', { serial_column: true });
        expect(headerLabels(html)[0]).toBe('SL');
        expect(html).toContain('<td class="item-sl">1</td>');
        expect(html).toContain('<td class="item-sl">2</td>');
    });

    it('drops the Discount column when no line has a discount', () => {
        const html = render(baseInvoice, 'A4', { hide_empty_discount: true });
        expect(headerLabels(html)).not.toContain('Discount');
        expect(html).not.toContain('class="item-disc item-disc--empty"');
    });

    it('keeps the Discount column when any line has one', () => {
        const withDiscount = {
            ...baseInvoice,
            items: [...baseInvoice.items, { name: 'Soap', quantity: 1, unitPrice: 50, discount: 5 }],
        };
        expect(headerLabels(render(withDiscount, 'A4', { hide_empty_discount: true }))).toContain('Discount');
    });

    it('writes the total out in words', () => {
        const html = render(creditSale, 'A4', { amount_in_words: true });
        expect(html).toContain('Taka Four Thousand Eight Hundred Only');
    });

    it('draws customer and authorised signature lines on a sheet, not a roll', () => {
        const html = render(baseInvoice, 'A4', { signature_lines: true });
        expect(html).toContain('Customer\'s Signature');
        expect(html).toContain('Authorised Signature');
        expect(render(baseInvoice, 'Thermal80', { signature_lines: true })).not.toContain('Authorised Signature');
    });

    describe('footer text', () => {
        it('prints the built-in thank-you by default', () => {
            expect(render(baseInvoice, 'A4', { footer_text: null })).toContain('Thank you for your business!');
        });

        it('prints the member\'s own text instead, escaped, keeping its line breaks', () => {
            const html = render(baseInvoice, 'A4', { footer_text: 'No returns <after> 7 days\nWarranty: 1 year' });
            expect(html).not.toContain('Thank you for your business!');
            expect(html).toContain('No returns &lt;after&gt; 7 days\nWarranty: 1 year');
            expect(ruleFor(html, '.invoice-note')).toContain('white-space:pre-line');
        });

        it('prints the member\'s text even under a letterhead with its own footer band', () => {
            const html = render(
                { ...baseInvoice, headerConfig: { version: 3, footer: { lines: [{ text: 'Letterhead footer' }] } } as any },
                'A4',
                { footer_text: 'Goods once sold are not returnable' },
            );
            expect(html).toContain('Goods once sold are not returnable');
        });

        it('prints no footer at all when the member cleared it', () => {
            const html = render(baseInvoice, 'A4', { footer_text: '' });
            expect(html).not.toContain('Thank you for your business!');
            expect(html).not.toContain('class="invoice-note"');
        });
    });
});

describe('detailed invoice layout', () => {
    // A posted sale: prices are tax-inclusive, so 6,936 holds 906 of tax and
    // the lines (6,946) are 10 more than the total, which is the discount.
    const posted: InvoiceData = {
        referenceNumber: 'S0020090001',
        date: '06/10/2026',
        companyName: 'Life Tech Medical',
        customerName: 'Bio Care',
        customerPhone: '185',
        shippingAddress: '12 Mirpur Road',
        orderNumber: 'SO-0042',
        preparedBy: 'Rina Akter',
        printedAt: '06-10-2026 1:02:59 PM',
        items: [
            { name: '3 Head Fascial Gun', quantity: 2, unitPrice: 700, warranty: '6 months' },
            { name: '360 Spin Massager', quantity: 2, unitPrice: 400 },
            { name: 'A01 Abdominal Belt L', quantity: 3, unitPrice: 1582 },
        ],
        payments: [],
        subtotal: 6946,
        total: 6936,
        taxIncluded: 906,
        amountPaid: 0,
        previousDue: 0,
    };

    const detailed = { layout: 'detailed' as const };

    it('keeps the standard design unless the member chose this one', () => {
        const html = render(posted, 'A4');
        expect(html).not.toContain('d-strip');
        expect(html).toContain('Invoice Details');
    });

    it('writes invoice no, order no and date on one labelled strip', () => {
        const html = render(posted, 'A4', detailed);
        expect(html).toMatch(/<strong>Invoice No:<\/strong> S0020090001/);
        expect(html).toMatch(/<strong>Order No:<\/strong> SO-0042/);
        expect(html).toMatch(/<strong>Invoice Date:<\/strong> 06\/10\/2026/);
    });

    it('prints bill to and the shipping block with the payment status', () => {
        const html = render(posted, 'A4', detailed);
        expect(html).toContain('Bill To');
        expect(html).toContain('Bio Care');
        expect(html).toContain('Phone No:');
        expect(html).toContain('Shipping Address');
        expect(html).toContain('12 Mirpur Road');
        expect(html).toMatch(/Payment Status:<\/span><span>Due</);
    });

    it('reads Paid when nothing is left to pay and Partial when some is', () => {
        expect(render({ ...posted, amountPaid: 6936 }, 'A4', detailed)).toMatch(/Payment Status:<\/span><span>Paid</);
        expect(render({ ...posted, amountPaid: 1000 }, 'A4', detailed)).toMatch(/Payment Status:<\/span><span>Partial</);
    });

    it('lists SL, item, warranty, quantity, unit price and total, with ৳ in the headers only', () => {
        const html = render(posted, 'A4', detailed);
        for (const heading of ['SL', 'Item', 'Warranty', 'Quantity', 'Unit Price (৳)', 'Total (৳)']) {
            expect(html).toContain(`>${heading}</th>`);
        }
        expect(html).toContain('<td class="d-warranty">6 months</td>');
        expect(html).toContain('<td class="d-num">700.00</td>');
        expect(html).toContain('<td class="d-num">1,400.00</td>');
    });

    it('adds a discount column only when a line carries one', () => {
        expect(render(posted, 'A4', detailed)).not.toContain('Discount (৳)</th>');
        const withDiscount = { ...posted, items: [{ ...posted.items[0], discount: 50 }] };
        expect(render(withDiscount, 'A4', detailed)).toContain('Discount (৳)</th>');
    });

    it('breaks a posted sale’s stored tax out of its total and keeps the total as stored', () => {
        const html = render(posted, 'A4', detailed);
        expect(html).toContain('<td>Sub Total (excl. tax) (৳):</td><td>6,030.00</td>');
        expect(html).toContain('<td>Total Tax (৳):</td><td>906.00</td>');
        expect(html).toContain('<td>Total (৳):</td><td>6,936.00</td>');
        // Sub total plus tax is the total — nothing is added on top of it.
        expect(6030 + 906).toBe(6936);
    });

    it('lists a posted sale’s discount as already deducted rather than taking it off again', () => {
        const html = render(posted, 'A4', detailed);
        expect(html).toContain('<tr class="memo"><td>Discount, already deducted (৳):</td><td>10.00</td></tr>');
        expect(html).not.toContain('-10.00');
    });

    it('prints no tax line for a sale that carries none', () => {
        const html = render({ ...posted, taxIncluded: 0, subtotal: 6936 }, 'A4', detailed);
        expect(html).not.toContain('Total Tax');
        expect(html).toContain('<td>Sub Total (৳):</td><td>6,936.00</td>');
    });

    it('adds tax and takes the discount off for an invoice still on the entry screen', () => {
        const entry: InvoiceData = {
            ...posted,
            taxIncluded: undefined,
            subtotal: 6040,
            vat: 906,
            discountAmount: 10,
            total: 6936,
        };
        const html = render(entry, 'A4', detailed);
        expect(html).toContain('<td>Sub Total (৳):</td><td>6,040.00</td>');
        expect(html).toContain('<td>Total Tax (৳):</td><td>906.00</td>');
        expect(html).toContain('<td>Discount (৳):</td><td>-10.00</td>');
        expect(html).toContain('<td>Total (৳):</td><td>6,936.00</td>');
    });

    it('computes paid and due from this invoice, never from the sample’s arithmetic', () => {
        const html = render({ ...posted, amountPaid: 2000 }, 'A4', detailed);
        expect(html).toContain('<td>Paid (৳):</td><td>2,000.00</td>');
        expect(html).toContain('<td>Due (৳):</td><td>4,936.00</td>');
    });

    it('closes the account block on the customer’s total due', () => {
        const html = render({ ...posted, previousDue: 1000, amountPaid: 2000 }, 'A4', detailed);
        expect(html).toContain('<td>Previous Due (৳)</td><td>1,000.00</td>');
        expect(html).toContain('<td>Sale Amount (৳)</td><td>6,936.00</td>');
        // What was paid is the right-hand block's Paid line, not repeated here.
        expect(html).not.toContain('Collected Amount');
        expect(html).toContain('<td>Paid (৳):</td><td>2,000.00</td>');
        // 1,000 owed before + 6,936 − 2,000 paid.
        expect(html).toContain('<td>Total Due (৳)</td><td>5,936.00</td>');
    });

    it('leaves the account block off for a walk-in and when the member hides balances', () => {
        expect(render({ ...posted, previousDue: null }, 'A4', detailed)).not.toContain('Previous Due');
        expect(render({ ...posted, previousDue: 500 }, 'A4', { ...detailed, balance: 'never' })).not.toContain('Previous Due');
    });

    it('writes the total in words across the full width, above both blocks, when the member asked for it', () => {
        const html = render(posted, 'A4', { ...detailed, amount_in_words: true });
        expect(html).toContain('<strong>In Word:</strong> Taka Six Thousand Nine Hundred Thirty Six Only');
        // Not inside either block, so the two start at the same height.
        expect(html.indexOf('class="d-words"')).toBeLessThan(html.indexOf('<div class="d-sums">'));
        expect(html.indexOf('<div class="d-left">')).toBeLessThan(html.indexOf('<div class="d-right">'));
        const sums = html.slice(html.indexOf('<div class="d-sums">'));
        expect(sums).not.toContain('class="d-words"');
    });

    it('puts who prepared the invoice in a footer pinned to the page bottom', () => {
        const html = render(posted, 'A4', detailed);
        expect(html).toContain('Prepared By- Rina Akter');
        // The print time moved to the page margin, beside the page number.
        expect(html).not.toContain('Print Date:');
        expect(html).toContain('class="p71-doc-ft d-foot"');
        // Totals and foot share the page table's last row, so they move to the
        // next page together when they do not fit under the items.
        const body = html.slice(html.indexOf('<body>'));
        const endRow = body.slice(body.indexOf('<tr class="p71-end">'));
        expect(endRow).toContain('class="d-sums"');
        expect(endRow.indexOf('class="d-sums"')).toBeLessThan(endRow.indexOf('class="p71-doc-ft d-foot"'));
        expect(ruleFor(html, '.p71-doc--end > tbody > tr.p71-end')).toContain('break-inside: avoid');
    });

    it('says the thank-you at the left of the foot unless the member wrote their own', () => {
        expect(render(posted, 'A4', detailed)).toContain('<div class="d-foot-l">Thank you for your business!</div>');
        expect(render(posted, 'A4', { ...detailed, footer_text: 'Serve you again' })).toContain(
            '<div class="d-foot-l">Serve you again</div>',
        );
        expect(render(posted, 'A4', { ...detailed, footer_text: '' })).toContain('<div class="d-foot-l"></div>');
    });

    it('escapes what a customer or a user typed', () => {
        const html = render({ ...posted, customerName: '<b>Bio</b>', preparedBy: 'A & B' }, 'A4', detailed);
        expect(html).not.toContain('<b>Bio</b>');
        expect(html).toContain('&lt;b&gt;Bio&lt;/b&gt;');
        expect(html).toContain('Prepared By- A &amp; B');
    });

    it('prints the QR code under the title in the header, in place of the number and date', () => {
        const html = render({ ...posted, qrDataUrl: 'data:image/png;base64,AAAA' }, 'A4', detailed);
        const header = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));

        expect(header).toContain('<img class="p71-hd-qr" src="data:image/png;base64,AAAA"');
        expect(header.indexOf('p71-hd-title')).toBeLessThan(header.indexOf('p71-hd-qr'));
        // The strip below still says the number and date; the title block does not.
        expect(header).not.toContain('p71-hd-meta');
        expect(header).toContain('<strong>Invoice No:</strong> S0020090001');
        expect(html.match(/data:image\/png;base64,AAAA/g)).toHaveLength(1);
    });

    it('leaves the number and date in the header of the standard design', () => {
        const html = render({ ...posted, qrDataUrl: 'data:image/png;base64,AAAA' }, 'A4');

        expect(html).toContain('<div class="p71-hd-meta"># S0020090001</div>');
        expect(html).not.toContain('p71-hd-qr"');
    });

    it('refuses a QR source that is not an image URL', () => {
        const html = render({ ...posted, qrDataUrl: 'javascript:alert(1)' }, 'A4', detailed);
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('<img class="p71-hd-qr"');
    });

    it('prints without a code when the invoice has none yet', () => {
        const html = render(posted, 'A4', detailed);
        expect(html).not.toContain('data:image/png');
        expect(html).not.toContain('<img class="p71-hd-qr"');
        // Nothing stands in for the dropped number and date, either.
        expect(html.slice(html.indexOf('<body>'))).not.toContain('p71-hd-meta');
    });

    it('still fills a template\u2019s own {{doc_number}} and {{date}} lines', () => {
        const html = render(
            {
                ...posted,
                headerConfig: { version: 3, lines: [{ text: 'Ref {{doc_number}} on {{date}}' }] } as any,
            },
            'A4',
            detailed,
        );
        expect(html).toContain('Ref S0020090001 on 06/10/2026');
    });

    it('repeats the invoice strip with the letterhead, so continuation pages say which invoice they are', () => {
        const html = render(posted, 'A4', detailed);
        const body = html.slice(html.indexOf('<body>'));
        // Inside the repeating <thead>, ahead of the invoice body.
        expect(body.indexOf('<thead>')).toBeLessThan(body.indexOf('d-strip'));
        expect(body.indexOf('d-strip')).toBeLessThan(body.indexOf('</thead>'));
        expect(body.indexOf('</thead>')).toBeLessThan(body.indexOf('invoice-body'));
    });

    it('keeps rows, totals and the foot whole across a page break', () => {
        const html = render(posted, 'A4', detailed);
        expect(ruleFor(html, '.d-table tr, .d-parties, .d-sums, .note-box, .signatures, .d-foot')).toContain('break-inside:avoid');
    });

    describe('warranty column', () => {
        const none = { ...posted, items: posted.items.map((item) => ({ ...item, warranty: undefined })) };
        const headed = (html: string) => html.includes('>Warranty</th>');

        it('prints, empty if need be, by default', () => {
            expect(headed(render(none, 'A4', detailed))).toBe(true);
            expect(headed(render(posted, 'A4', detailed))).toBe(true);
        });

        it('prints only when an item has a warranty, if asked', () => {
            const layout = { ...detailed, warranty_column: 'when-used' as const };
            expect(headed(render(none, 'A4', layout))).toBe(false);
            expect(headed(render(posted, 'A4', layout))).toBe(true);
        });

        it('is removed entirely when set to never, even for an item that has a warranty', () => {
            const html = render(posted, 'A4', { ...detailed, warranty_column: 'never' });
            expect(headed(html)).toBe(false);
            expect(html).not.toContain('<td class="d-warranty">');
            // The other columns are untouched.
            expect(html).toContain('>Quantity</th>');
            expect(html).toContain('<td class="d-num">1,400.00</td>');
        });
    });

    describe('page margin line', () => {
        it('prints when the invoice was printed and page X of Y on every page', () => {
            const html = render(posted, 'A4', detailed);
            expect(html).toContain('@bottom-left { content: "Printed 06-10-2026 1:02:59 PM";');
            expect(html).toContain('@bottom-right { content: "Page " counter(page) " of " counter(pages);');
        });

        it('prints whatever footer the letterhead designs, since it is not part of the footer', () => {
            const html = render(
                { ...posted, headerConfig: { version: 3, footer: { show: true, lines: [{ text: 'Shop footer' }] } } as any },
                'A4',
                detailed,
            );
            expect(html).toContain('Shop footer');
            expect(html).toContain('"Printed 06-10-2026 1:02:59 PM"');
            expect(html).toContain('counter(pages)');
        });

        it('leaves the standard design and the rolls as they were', () => {
            expect(render(posted, 'A4')).not.toContain('counter(pages)');
            expect(render(posted, 'Thermal80', detailed)).not.toContain('counter(pages)');
        });
    });

    it('keeps the strip exactly as wide as the table under Compact, which drops the side padding', () => {
        const html = render(posted, 'A4', detailed);
        expect(ruleFor(html, 'html.p71-compact .d-strip')).toContain('margin-left:0; margin-right:0');
        expect(ruleFor(html, 'html.p71-compact .invoice-body')).toContain('padding:1mm 0');
    });

    it('lines the strip up with the body\u2019s own padding', () => {
        expect(ruleFor(render(posted, 'A4', { ...detailed, padding: 'wide' }), '.d-strip')).toContain('margin:10px 8mm 0');
        expect(ruleFor(render(posted, 'A4', detailed), '.d-strip')).toContain('margin:10px 4mm 0');
    });

    it('foots a discounted sale with no tax on its face: lines, less the discount, is the total', () => {
        const html = render({ ...posted, taxIncluded: 0, subtotal: 6946 }, 'A4', detailed);
        expect(html).toContain('<td>Sub Total (৳):</td><td>6,946.00</td>');
        expect(html).toContain('<tr class="neg"><td>Discount (৳):</td><td>-10.00</td></tr>');
        expect(html).toContain('<td>Total (৳):</td><td>6,936.00</td>');
        expect(html).not.toContain('already deducted');
    });

    it('calls a negative previous due an advance balance, and still adds up', () => {
        const html = render({ ...posted, previousDue: -2000, amountPaid: 0 }, 'A4', detailed);
        expect(html).toContain('<td>Advance Balance (৳)</td><td>-2,000.00</td>');
        expect(html).not.toContain('Previous Due');
        // 6,936 − 2,000 advance.
        expect(html).toContain('<td>Total Due (৳)</td><td>4,936.00</td>');
    });

    it('says the customer is still in credit rather than printing a negative total due', () => {
        const html = render({ ...posted, previousDue: -10000, amountPaid: 0 }, 'A4', detailed);
        expect(html).toContain('<td>Advance Remaining (৳)</td><td>3,064.00</td>');
    });

    it('does not change a roll — the standard design prints whatever was chosen', () => {
        const html = render(posted, 'Thermal80', detailed);
        expect(html).not.toContain('d-strip');
        expect(html).not.toContain('Prepared By');
    });

    it('fills the footer tokens a letterhead footer can use', () => {
        const html = render(
            {
                ...posted,
                headerConfig: {
                    version: 3,
                    footer: { show: true, lines: [{ text: '{{prepared_by}} · {{print_date}}' }] },
                } as any,
            },
            'A4',
            detailed,
        );
        expect(html).toContain('Rina Akter · 06-10-2026 1:02:59 PM');
    });
});
