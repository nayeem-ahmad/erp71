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
