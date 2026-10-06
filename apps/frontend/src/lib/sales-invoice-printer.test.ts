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
