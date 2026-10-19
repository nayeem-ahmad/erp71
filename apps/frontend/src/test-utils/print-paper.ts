import type { PaperSize } from '@/lib/print';

/**
 * Lets a page test choose the paper this browser prints sales on and read back
 * the paper a print used, without faking localStorage or the popup:
 *
 *     jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());
 *     jest.mock('@/lib/print', () => require('@/test-utils/print-paper').printModuleSpy());
 *     beforeEach(() => mockBrowserPaper('A5'));
 *     await waitFor(() => expect(printedPaper()).toEqual({ page: 'A5', letterhead: 'A5' }));
 *
 * The print module still does its real work; only `openPrintWindow` and
 * `renderHeaderHtml` are watched on the way through.
 */

let browserPaper: PaperSize = 'A4';

export function mockBrowserPaper(paper: PaperSize) {
    browserPaper = paper;
    openPrintWindowSpy.mockClear();
    renderHeaderHtmlSpy.mockClear();
}

export function salePrintPrefsModuleMock() {
    return {
        useSalePrintPrefs: () => ({
            paperSize: browserPaper,
            setPaperSize: jest.fn(),
            skipPreview: false,
            setSkipPreview: jest.fn(),
            density: 'normal',
            setDensity: jest.fn(),
            typeScale: 'normal',
            setTypeScale: jest.fn(),
        }),
        resolvePrintPaper: () => Promise.resolve(browserPaper),
    };
}

export const openPrintWindowSpy = jest.fn();
export const renderHeaderHtmlSpy = jest.fn();

export function printModuleSpy() {
    const actual = jest.requireActual('@/lib/print');
    return {
        ...actual,
        openPrintWindow: (...args: unknown[]) => {
            openPrintWindowSpy(...args);
            return actual.openPrintWindow(...args);
        },
        renderHeaderHtml: (...args: unknown[]) => {
            renderHeaderHtmlSpy(...args);
            return actual.renderHeaderHtml(...args);
        },
    };
}

/** The page size and letterhead design of the last print; undefined before one. */
export function printedPaper(): { page: PaperSize; letterhead: PaperSize } | undefined {
    const window = openPrintWindowSpy.mock.calls.at(-1)?.[0];
    if (!window) return undefined;
    return { page: window.paperSize, letterhead: renderHeaderHtmlSpy.mock.calls.at(-1)?.[2] };
}
