import { buildPrintDocument, openPrintWindow, PRINT_PREVIEW_SKIP_MESSAGE } from './print-window';
import { PRINT_DENSITY_KEY, PRINT_DENSITY_MESSAGE, readPrintDensity } from './density';

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

    it('pins it on the preview sheet as well, where the page is drawn to size', () => {
        const html = buildPrintDocument({
            ...pinned,
            preview: { title: 'Q-1', printLabel: 'Print', closeLabel: 'Close' },
        });

        // A percentage has nothing to resolve against inside the sheet, which
        // left the footer under the content on screen but at the bottom on paper.
        expect(html).toContain('.p71-pv-sheet .p71-doc--pinned { height: 267mm; }');
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

describe('preview toolbar', () => {
    const preview = {
        title: 'Invoice — A4',
        printLabel: 'Print',
        closeLabel: 'Close',
        skipLabel: 'Skip preview next time',
    };

    it('renders the toolbar above the document, and hides it from paper', () => {
        const html = buildPrintDocument({ ...base, preview });

        expect(html).toContain('Invoice &mdash; A4'.replace('&mdash;', '—'));
        expect(html).toContain('>Print<');
        expect(html).toContain('>Close<');
        // On screen but never on paper — the bar must not print.
        expect(html).toContain('.p71-pv { display: none !important; }');
        expect(html.indexOf('p71-pv')).toBeLessThan(html.indexOf('<p>body</p>'));
    });

    it('omits the toolbar entirely when no preview is asked for', () => {
        expect(buildPrintDocument(base)).not.toContain('p71-pv');
    });

    it('reports the skip choice back to the opener rather than writing storage', () => {
        // The popup is a different document; it cannot be trusted to write the
        // app's localStorage, so the opener owns the preference.
        const html = buildPrintDocument({ ...base, preview });

        expect(html).toContain(PRINT_PREVIEW_SKIP_MESSAGE);
        expect(html).toContain('window.opener');
        expect(html).not.toContain('localStorage');
    });

    it('drops the checkbox when no skip wording is given', () => {
        const html = buildPrintDocument({
            ...base,
            preview: { ...preview, skipLabel: undefined },
        });

        expect(html).toContain('p71-pv');
        // The class still appears in the stylesheet; what must be gone is the
        // checkbox itself.
        expect(html).not.toContain('<input type="checkbox"');
        expect(html).not.toContain('Skip preview next time');
    });

    it('does not print on open, leaving the operator to press Print', () => {
        const print = jest.fn();
        const open = jest.spyOn(window, 'open').mockReturnValue({
            document: { write: jest.fn(), close: jest.fn(), images: [] },
            print,
            focus: jest.fn(),
        } as unknown as Window);

        openPrintWindow({ ...base, preview });

        expect(print).not.toHaveBeenCalled();
        open.mockRestore();
    });
});

describe('preview sheet', () => {
    const bleedCfg = {
        footer: {
            show: true,
            bleed: true,
            pinToPageBottom: true,
            images: [{ url: 'https://cdn.test/strip.png', fullWidth: true }],
        },
    };
    const previewOpts = { title: 'Invoice (A4)', printLabel: 'Print', closeLabel: 'Close' };

    it('renders the preview on a paper-shaped sheet', () => {
        const html = buildPrintDocument({ ...base, preview: previewOpts });

        // The sheet must actually wrap the content, not merely be styled —
        // the CSS alone would leave the document rendering at popup width.
        expect(html).toContain('<div class="p71-pv-sheet"><div class="p71-wrap">');
        expect(html).toContain('width: 210mm');
    });

    it('does not wrap a non-preview document in a sheet', () => {
        const html = buildPrintDocument(base);

        expect(html).not.toContain('p71-pv-sheet');
        expect(html).toContain('<div class="p71-wrap">');
    });

    it('gives the preview sheet the real page margin as padding', () => {
        const html = buildPrintDocument({ ...base, preview: previewOpts });

        expect(html).toContain('padding: 15mm');
    });

    it('lets a bleeding footer escape the sheet on screen, not just in print', () => {
        const html = buildPrintDocument({
            ...base,
            preview: previewOpts,
            headerConfig: bleedCfg,
        });

        // The same negative margins that cancel the @page margin on paper must
        // also cancel the sheet's padding on screen, or the preview shows a
        // gap the printed page will not have.
        expect(html).toContain('.p71-pv-sheet .p71-ft');
    });

    it('gives a roll the paper width but no fixed sheet height', () => {
        const html = buildPrintDocument({
            ...base,
            paperSize: 'Thermal80',
            preview: previewOpts,
        });

        // A roll prints to an open-ended length, so a fixed-height sheet would
        // draw a page bottom that does not exist.
        expect(html).toContain('width: 80mm');
        expect(html).not.toContain('min-height: 297mm');
    });

    it('keeps the sheet out of the printed document', () => {
        const html = buildPrintDocument({ ...base, preview: previewOpts });

        // The sheet is screen furniture; on paper the page box is the sheet.
        expect(html).toMatch(/@media print \{[^}]*\.p71-pv-sheet[^}]*(box-shadow|margin|padding|width)\s*:\s*/);
    });
});

describe('compact density', () => {
    const withSwitch = {
        title: 'Invoice — A4',
        printLabel: 'Print',
        closeLabel: 'Close',
        compactLabel: 'Compact layout',
        compactHint: 'Fits more lines on each page',
    };
    const SWITCH = 'class="p71-pv-check p71-pv-compact"';

    it('marks a compact document on its root element', () => {
        expect(buildPrintDocument({ ...base, density: 'compact' })).toContain('<html class="p71-compact">');
        expect(buildPrintDocument({ ...base, density: 'normal' })).toContain('<html>');
    });

    it('leaves a document with no switch free of the compact rules', () => {
        expect(buildPrintDocument(base)).not.toContain('html.p71-compact');
    });

    it('ships the compact rules with the switch, so it can turn them on in place', () => {
        const html = buildPrintDocument({ ...base, preview: withSwitch });

        expect(html).toContain('<html>');
        expect(html).toContain('html.p71-compact body');
        expect(html).toContain(SWITCH);
        expect(html).toContain('title="Fits more lines on each page"');
    });

    it('lets a document restate the shared compact rules, by coming after them', () => {
        const html = buildPrintDocument({
            ...base,
            density: 'compact',
            styles: 'html.p71-compact body { font-size: 10px; }',
        });

        expect(html.indexOf('html.p71-compact body { font-size: 10px; }'))
            .toBeGreaterThan(html.indexOf('html.p71-compact body { font-size: 11px; }'));
    });

    it('never compacts a roll, and offers it no switch', () => {
        const html = buildPrintDocument({
            ...base,
            paperSize: 'Thermal80',
            density: 'compact',
            preview: withSwitch,
        });

        expect(html).toContain('<html>');
        expect(html).not.toContain(SWITCH);
        expect(html).not.toContain('html.p71-compact');
    });

    it('reports the switch back to the opener rather than writing storage', () => {
        const html = buildPrintDocument({ ...base, preview: withSwitch });

        expect(html).toContain(PRINT_DENSITY_MESSAGE);
        expect(html).not.toContain('localStorage');
    });

    /**
     * The switch is an inline handler in a document the app never scripts, so
     * the only real test is to load that document and flip it.
     */
    function loadInFrame(html: string) {
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const win = frame.contentWindow!;
        const postMessage = jest.fn();
        Object.defineProperty(win, 'opener', { value: { postMessage }, configurable: true });
        win.document.open();
        win.document.write(html);
        win.document.close();
        const box = win.document.querySelector<HTMLInputElement>('.p71-pv-compact input')!;
        return { win, box, postMessage, remove: () => frame.remove() };
    }

    it('reflows the open document and tells the opener when flipped', () => {
        const { win, box, postMessage, remove } = loadInFrame(
            buildPrintDocument({ ...base, preview: withSwitch }),
        );

        expect(box.checked).toBe(false);
        box.click();

        expect(win.document.documentElement.classList.contains('p71-compact')).toBe(true);
        expect(postMessage).toHaveBeenCalledWith(
            { type: PRINT_DENSITY_MESSAGE, density: 'compact' },
            '*',
        );

        box.click();
        expect(win.document.documentElement.classList.contains('p71-compact')).toBe(false);
        expect(postMessage).toHaveBeenLastCalledWith(
            { type: PRINT_DENSITY_MESSAGE, density: 'normal' },
            '*',
        );
        remove();
    });

    it('starts ticked on a document that is already compact', () => {
        const { box, remove } = loadInFrame(
            buildPrintDocument({ ...base, density: 'compact', preview: withSwitch }),
        );

        expect(box.checked).toBe(true);
        remove();
    });
});

describe('openPrintWindow — compactable documents', () => {
    function mockWindow() {
        const win = {
            document: { write: jest.fn(), close: jest.fn(), images: [] },
            print: jest.fn(),
            focus: jest.fn(),
            setTimeout: jest.fn(),
        };
        jest.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
        return win;
    }
    const written = (win: ReturnType<typeof mockWindow>) => win.document.write.mock.calls[0][0] as string;
    const SWITCH = 'class="p71-pv-check p71-pv-compact"';

    beforeEach(() => window.localStorage.clear());
    afterEach(() => {
        jest.restoreAllMocks();
        delete document.documentElement.dataset.locale;
    });

    it('prints at the density the counter chose', () => {
        window.localStorage.setItem(PRINT_DENSITY_KEY, 'compact');
        const win = mockWindow();

        openPrintWindow({ ...base, compactable: true });

        expect(written(win)).toContain('<html class="p71-compact">');
    });

    it('lets the caller settle the density itself', () => {
        window.localStorage.setItem(PRINT_DENSITY_KEY, 'compact');
        const win = mockWindow();

        openPrintWindow({ ...base, compactable: true, density: 'normal' });

        expect(written(win)).toContain('<html>');
    });

    it('gives a document printed straight away the switch, and still prints it at once', () => {
        const win = mockWindow();

        openPrintWindow({ ...base, compactable: true });

        const html = written(win);
        expect(html).toContain(SWITCH);
        expect(html).toContain('>Compact layout<');
        expect(html).toContain('>Print<');
        expect(html).toContain('>Close<');
        // No opt-out checkbox: there was no preview to skip.
        expect(html).not.toContain('p71-pv-check p71-pv-skip');
        expect(win.print).toHaveBeenCalledTimes(1);
    });

    it('adds the switch to a preview without replacing its own wording', () => {
        const win = mockWindow();

        openPrintWindow({
            ...base,
            compactable: true,
            preview: { title: 'Invoice — A4', printLabel: 'Imprimer', closeLabel: 'Fermer', skipLabel: 'Skip it' },
        });

        const html = written(win);
        expect(html).toContain('>Imprimer<');
        expect(html).toContain('Skip it');
        expect(html).toContain(SWITCH);
        expect(win.print).not.toHaveBeenCalled();
    });

    it('leaves a document that lists no rows exactly as it was', () => {
        window.localStorage.setItem(PRINT_DENSITY_KEY, 'compact');
        const win = mockWindow();

        openPrintWindow(base);

        const html = written(win);
        expect(html).toContain('<html>');
        expect(html).not.toContain('p71-pv');
        expect(html).not.toContain('html.p71-compact');
    });

    it('keeps a roll at its normal setting, even with compact remembered', () => {
        window.localStorage.setItem(PRINT_DENSITY_KEY, 'compact');
        const win = mockWindow();

        openPrintWindow({ ...base, paperSize: 'Thermal80', compactable: true });

        const html = written(win);
        expect(html).toContain('<html>');
        expect(html).not.toContain('p71-pv');
    });

    it('words the switch in the language the app is showing', () => {
        document.documentElement.dataset.locale = 'bn';
        const win = mockWindow();

        openPrintWindow({ ...base, compactable: true });

        expect(written(win)).toContain('কমপ্যাক্ট লেআউট');
    });

    it('remembers what the window reports back', () => {
        mockWindow();
        openPrintWindow({ ...base, compactable: true });

        window.dispatchEvent(new MessageEvent('message', {
            data: { type: PRINT_DENSITY_MESSAGE, density: 'compact' },
        }));

        expect(readPrintDensity()).toBe('compact');
    });
});
