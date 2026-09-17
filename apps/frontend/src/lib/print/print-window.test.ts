import { buildPrintDocument, openPrintWindow } from './print-window';

const base = {
    title: 'Invoice INV-001',
    paperSize: 'A4' as const,
    bodyHtml: '<p>body</p>',
};

describe('buildPrintDocument', () => {
    it('sets the @page rule for the paper size', () => {
        expect(buildPrintDocument(base)).toContain('@page { size: A4 portrait; margin: 15mm; }');
        expect(buildPrintDocument({ ...base, paperSize: 'Thermal58' }))
            .toContain('@page { size: 58mm auto; margin: 3mm; }');
    });

    it('escapes the document title', () => {
        const html = buildPrintDocument({ ...base, title: 'Invoice "A" <b>' });

        expect(html).toContain('<title>Invoice &quot;A&quot; &lt;b&gt;</title>');
    });

    it('appends document styles after the base rules so they win', () => {
        const html = buildPrintDocument({ ...base, styles: '.custom { color: #123456; }' });

        expect(html.indexOf('.custom')).toBeGreaterThan(html.indexOf('.p71-wrap'));
    });

    it('places header, body and footer in order', () => {
        const html = buildPrintDocument({
            ...base,
            headerHtml: '<div>HEAD</div>',
            footerHtml: '<div>FOOT</div>',
        });

        expect(html.indexOf('HEAD')).toBeLessThan(html.indexOf('<p>body</p>'));
        expect(html.indexOf('<p>body</p>')).toBeLessThan(html.indexOf('FOOT'));
    });

    it('wraps the header in a thead so it repeats on every printed page', () => {
        const html = buildPrintDocument({
            ...base,
            headerHtml: '<div>HEAD</div>',
            repeatHeader: true,
        });

        expect(html).toContain('<thead><tr><td><div>HEAD</div></td></tr></thead>');
    });

    it('does not wrap in a table when there is no header to repeat', () => {
        expect(buildPrintDocument({ ...base, repeatHeader: true })).not.toContain('<thead>');
    });
});

describe('openPrintWindow', () => {
    afterEach(() => jest.restoreAllMocks());

    // Stand-ins for <img> elements — only `complete` and `addEventListener` matter.
    function mockWindow(images: Array<Record<string, unknown>> = []) {
        const win = {
            document: { write: jest.fn(), close: jest.fn(), images },
            print: jest.fn(),
            focus: jest.fn(),
            setTimeout: jest.fn(),
        };
        jest.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
        return win;
    }

    it('writes the document and prints when there is nothing to load', () => {
        const win = mockWindow();

        openPrintWindow(base);

        expect(win.document.write).toHaveBeenCalledTimes(1);
        expect(win.document.close).toHaveBeenCalledTimes(1);
        expect(win.print).toHaveBeenCalledTimes(1);
    });

    it('sizes the popup from the paper size', () => {
        mockWindow();
        const open = window.open as jest.Mock;

        openPrintWindow({ ...base, paperSize: 'Thermal58' });

        expect(open).toHaveBeenCalledWith('', '_blank', 'width=320,height=700');
    });

    it('waits for a pending logo before printing', () => {
        const listeners: Record<string, () => void> = {};
        const pendingImage = {
            complete: false,
            addEventListener: (event: string, handler: () => void) => {
                listeners[event] = handler;
            },
        };
        const win = mockWindow([pendingImage]);

        openPrintWindow({ ...base, headerHtml: '<img src="logo.png">' });

        expect(win.print).not.toHaveBeenCalled();

        listeners.load();
        expect(win.print).toHaveBeenCalledTimes(1);
    });

    it('prints anyway once the asset timeout fires', () => {
        const win = mockWindow([{ complete: false, addEventListener: jest.fn() }]);

        openPrintWindow({ ...base, headerHtml: '<img src="logo.png">' });
        expect(win.print).not.toHaveBeenCalled();

        const [fire] = win.setTimeout.mock.calls[0];
        fire();
        expect(win.print).toHaveBeenCalledTimes(1);
    });

    it('does not print twice when the image loads after the timeout', () => {
        const listeners: Record<string, () => void> = {};
        const win = mockWindow([
            {
                complete: false,
                addEventListener: (event: string, handler: () => void) => {
                    listeners[event] = handler;
                },
            },
        ]);

        openPrintWindow({ ...base, headerHtml: '<img src="logo.png">' });
        const [fire] = win.setTimeout.mock.calls[0];
        fire();
        listeners.load();

        expect(win.print).toHaveBeenCalledTimes(1);
    });

    it('skips printing when autoPrint is false', () => {
        const win = mockWindow();

        openPrintWindow({ ...base, autoPrint: false });

        expect(win.print).not.toHaveBeenCalled();
    });

    it('returns null when the popup is blocked', () => {
        jest.spyOn(window, 'open').mockReturnValue(null);

        expect(openPrintWindow(base)).toBeNull();
    });
});

describe('buildPrintDocument — tenant footer', () => {
    const withFooter = (footer: Record<string, unknown> = {}) => ({
        footer: {
            show: true,
            lines: [{ text: 'Bank: BRAC 1234' }],
            ...footer,
        },
    });

    it('keeps the document’s own footer when the tenant designed none', () => {
        const html = buildPrintDocument({
            title: 'Invoice',
            paperSize: 'A4',
            bodyHtml: '<p>body</p>',
            footerHtml: '<div>Thank you for your business!</div>',
        });

        expect(html).toContain('Thank you for your business!');
    });

    it('replaces the document’s footer with the tenant’s, rather than printing both', () => {
        const html = buildPrintDocument({
            title: 'Invoice',
            paperSize: 'A4',
            bodyHtml: '<p>body</p>',
            footerHtml: '<div>Thank you for your business!</div>',
            headerConfig: withFooter(),
        });

        expect(html).toContain('Bank: BRAC 1234');
        expect(html).not.toContain('Thank you for your business!');
    });

    it('resolves footer tokens against the supplied context', () => {
        const html = buildPrintDocument({
            title: 'Invoice',
            paperSize: 'A4',
            bodyHtml: '<p>body</p>',
            headerConfig: withFooter({ lines: [{ text: 'Tel: {{phone}}' }] }),
            context: { phone: '01711-000000' },
        });

        expect(html).toContain('Tel: 01711-000000');
    });

    it('prints the footer inside the content flow by default', () => {
        const html = buildPrintDocument({
            title: 'Invoice',
            paperSize: 'A4',
            bodyHtml: '<p>body</p>',
            headerConfig: withFooter(),
        });

        expect(html).not.toContain('<tfoot>');
        expect(html).toContain('Bank: BRAC 1234');
    });

    it('moves the footer into a tfoot when it repeats on every page', () => {
        const html = buildPrintDocument({
            title: 'Invoice',
            paperSize: 'A4',
            bodyHtml: '<p>body</p>',
            headerConfig: withFooter({ repeatOnEveryPage: true }),
        });

        // Chrome repeats tfoot across pages; the body must not carry a copy.
        expect(html).toContain('<tfoot>');
        expect(html.match(/Bank: BRAC 1234/g)).toHaveLength(1);
    });

    it('keeps the header out of the thead when only the footer repeats', () => {
        const html = buildPrintDocument({
            title: 'Invoice',
            paperSize: 'A4',
            headerHtml: '<div class="p71-hd">letterhead</div>',
            bodyHtml: '<p>body</p>',
            headerConfig: withFooter({ repeatOnEveryPage: true }),
        });

        expect(html).not.toContain('<thead>');
        expect(html.match(/letterhead/g)).toHaveLength(1);
    });

    it('repeats both bands when the header and the footer both repeat', () => {
        const html = buildPrintDocument({
            title: 'Invoice',
            paperSize: 'A4',
            headerHtml: '<div class="p71-hd">letterhead</div>',
            bodyHtml: '<p>body</p>',
            repeatHeader: true,
            headerConfig: withFooter({ repeatOnEveryPage: true }),
        });

        expect(html).toContain('<thead>');
        expect(html).toContain('<tfoot>');
        // tfoot before tbody — the ordering every browser repeats correctly.
        expect(html.indexOf('<tfoot>')).toBeLessThan(html.indexOf('<tbody>'));
    });
});

describe('a footer pinned to the page bottom', () => {
    const footer = {
        show: true,
        lines: [{ text: 'Bank: Sonali 123' }],
        images: [],
        rule: { show: true, thicknessPx: 1, color: '#d1d5db' },
        spacingMm: 4,
        repeatOnEveryPage: true,
        pinToPageBottom: true,
    };
    const pinned = { ...base, headerConfig: { footer } };

    it('stretches the document table to a full page so the tfoot is pushed down', () => {
        const html = buildPrintDocument(pinned);

        expect(html).toContain('p71-doc--pinned');
        // A4 is 297mm tall less its two 15mm margins.
        expect(html).toContain('.p71-doc--pinned { height: 267mm; }');
        expect(html).toContain('<tfoot>');
    });

    it('uses each paper size\'s own printable height', () => {
        expect(buildPrintDocument({ ...pinned, paperSize: 'A5' }))
            .toContain('.p71-doc--pinned { height: 190mm; }');
    });

    it('does not pin on a roll, which prints to an open-ended length', () => {
        expect(buildPrintDocument({ ...pinned, paperSize: 'Thermal80' })).not.toContain('p71-doc--pinned');
    });

    it('does not pin a footer that does not repeat — there is no tfoot', () => {
        const html = buildPrintDocument({
            ...base,
            headerConfig: { footer: { ...footer, repeatOnEveryPage: false } },
        });

        expect(html).not.toContain('p71-doc--pinned');
    });

    it('drops the centred column so a bleeding footer can reach the paper edge', () => {
        const html = buildPrintDocument({ ...base, headerConfig: { footer: { ...footer, bleed: true } } });

        // Print-only: on screen there is no @page margin to escape, and the
        // band would just overflow the viewport and be cropped.
        expect(html).toContain('@media print { .p71-wrap { max-width: none; margin: 0; } }');
        expect(html).toContain('max-width: 780px');
    });

    it('keeps the centred column when nothing bleeds', () => {
        const html = buildPrintDocument(pinned);

        expect(html).toContain('max-width: 780px');
        expect(html).not.toContain('@media print { .p71-wrap');
    });
});

describe('a pinned footer that does not repeat', () => {
    // The reported bug: pinToPageBottom was silently ignored unless
    // repeatOnEveryPage was also on, so a short invoice printed its footer in
    // the middle of the sheet. The two settings are independent.
    const footer = {
        show: true,
        lines: [{ text: 'Bank: Sonali 123' }],
        images: [],
        rule: { show: true, thicknessPx: 1, color: '#d1d5db' },
        spacingMm: 4,
        repeatOnEveryPage: false,
        pinToPageBottom: true,
    };
    const opts = { ...base, headerConfig: { footer } };

    it('uses a page-tall flex column rather than a repeating tfoot', () => {
        const html = buildPrintDocument(opts);

        expect(html).toContain('p71-sheet');
        expect(html).toContain('min-height: 267mm');
        // A <tfoot> repeats on every page by default, which is wrong for a
        // footer meant to print once.
        expect(html).not.toContain('<tfoot>');
    });

    it('keeps the footer out of the table when a repeating header needs one', () => {
        const html = buildPrintDocument({ ...opts, repeatHeader: true, headerHtml: '<div>hd</div>' });

        expect(html).toContain('<thead>');
        expect(html).not.toContain('<tfoot>');
        // The footer must be a sibling of the table: a cell cannot be pushed to
        // the sheet's bottom by the flex column around it. Compared inside
        // <body>, since the class name also appears earlier in the stylesheet.
        const body = html.slice(html.indexOf('<body>'));
        expect(body.indexOf('</table>')).toBeLessThan(body.indexOf('class="p71-ft'));
    });

    it('still repeats the footer in a tfoot when that is what was asked for', () => {
        const html = buildPrintDocument({
            ...base,
            headerConfig: { footer: { ...footer, repeatOnEveryPage: true } },
        });

        expect(html).toContain('<tfoot>');
        expect(html).toContain('p71-doc--pinned');
    });

    it('does not pin on a roll, which has no page bottom', () => {
        expect(buildPrintDocument({ ...opts, paperSize: 'Thermal80' })).not.toContain('p71-sheet');
    });

    it('leaves an unpinned footer flowing under the content', () => {
        const html = buildPrintDocument({
            ...base,
            headerConfig: { footer: { ...footer, pinToPageBottom: false } },
        });

        expect(html).not.toContain('p71-sheet');
    });
});
