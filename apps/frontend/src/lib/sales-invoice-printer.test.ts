import { printSalesInvoice, type InvoiceData, type PaperSize } from './sales-invoice-printer';
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

function render(data: InvoiceData = baseInvoice, paperSize?: PaperSize): string {
    const write = jest.fn();
    const mockWindow = {
        document: { write, close: jest.fn(), images: [] },
        print: jest.fn(),
        set onload(handler: () => void) {
            handler();
        },
    };
    jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    if (paperSize) printSalesInvoice(data, paperSize);
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

describe('customer dues', () => {
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
