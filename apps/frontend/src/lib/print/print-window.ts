/**
 * The single way this app opens a print window.
 *
 * Every printed document used to hand-roll `window.open` + `document.write` +
 * `print()`, each with its own `@page` rules and its own race against images
 * loading. This module owns all three.
 */

import {
    footerBleeds,
    footerPinsToBottom,
    footerRepeats,
    headerCss,
    renderFooterHtml,
} from './header';
import {
    isThermalPaper,
    PAGE_MARGIN_MM,
    type DeepPartial,
    type HeaderContext,
    type PaperSize,
    type PrintHeaderConfig,
} from './types';

/** Sizes are paired with the margins in `PAGE_MARGIN_MM` — keep them in step. */
const PAGE_SIZE: Record<PaperSize, string> = {
    A4: 'A4 portrait',
    A5: 'A5 portrait',
    Letter: 'letter portrait',
    Thermal80: '80mm auto',
    Thermal58: '58mm auto',
};

function pageCss(paperSize: PaperSize): string {
    return `@page { size: ${PAGE_SIZE[paperSize]}; margin: ${PAGE_MARGIN_MM[paperSize]}mm; }`;
}

/**
 * The printable height of one page — the sheet minus its two margins.
 *
 * A footer pinned to the page bottom needs it: the document table is stretched
 * to exactly this height so the browser pushes the `<tfoot>` down to the edge.
 * Rolls print to an open-ended length and have no page bottom, so they are
 * absent here and never pin.
 */
const PAGE_CONTENT_HEIGHT_MM: Partial<Record<PaperSize, number>> = {
    A4: 297 - PAGE_MARGIN_MM.A4 * 2,
    A5: 210 - PAGE_MARGIN_MM.A5 * 2,
    Letter: 279 - PAGE_MARGIN_MM.Letter * 2,
};

const WINDOW_SIZE: Record<PaperSize, { width: number; height: number }> = {
    A4: { width: 950, height: 850 },
    A5: { width: 670, height: 600 },
    Letter: { width: 950, height: 850 },
    Thermal80: { width: 420, height: 700 },
    Thermal58: { width: 320, height: 700 },
};

/** Longest we wait on images (a slow CDN logo) before printing anyway. */
const ASSET_TIMEOUT_MS = 3000;

export interface PrintDocumentOptions {
    /** Browser/tab title — also the default filename when saving as PDF. */
    title: string;
    paperSize: PaperSize;
    /** Markup from `renderHeaderHtml`; omit for documents without a header. */
    headerHtml?: string;
    bodyHtml: string;
    /**
     * The document's own footer. Used only when the tenant's template does not
     * design one — a tenant who writes their own footer does not also want the
     * printer's hardcoded "Thank you for your business!" underneath it.
     */
    footerHtml?: string;
    /** Document-specific CSS, appended last so it wins over the base rules. */
    styles?: string;
    /** Template config the header/footer CSS is generated from. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    /** Values the tenant footer's {{tokens}} resolve against. */
    context?: HeaderContext;
    /**
     * Repeat the header at the top of every printed page. Uses a table/thead
     * wrapper because Chrome only repeats table headers — `position: fixed`
     * does not survive pagination.
     */
    repeatHeader?: boolean;
    autoPrint?: boolean;
}

/**
 * The content column.
 *
 * Capped and centred so long lines stay readable in the preview window. In
 * print the cap is irrelevant — the page is already the right measure — and a
 * bleeding footer has to escape it, so printing drops it. See the bleed rules
 * in `headerCss`, which are print-only for the same reason.
 */
function wrapCss(thermal: boolean, bleeds: boolean): string {
    const base = thermal
        ? '.p71-wrap { padding: 6px; }'
        : '.p71-wrap { max-width: 780px; margin: 0 auto; }';
    if (thermal || !bleeds) return base;

    return `${base}
        @media print { .p71-wrap { max-width: none; margin: 0; } }`;
}

/**
 * Arranges the header, body and footer into the page structure their settings
 * ask for.
 *
 * A repeating footer must live in a `<tfoot>`, the only element a browser
 * repeats across printed pages — `position: fixed` does not survive
 * pagination. But a `<tfoot>` repeats *by default*, which makes it the wrong
 * home for a footer meant to print once. So a footer that is pinned without
 * repeating goes in a page-tall flex column instead: the body absorbs the
 * slack, pushing the footer to the bottom of a short document, and simply
 * flows past the break on a long one — the foot of the last page either way.
 * Both behaviours were verified against printed PDFs, not just asserted on.
 */
function layoutDocument(parts: {
    header: string;
    bodyHtml: string;
    footer: string;
    repeatHeader: boolean;
    repeatFooter: boolean;
    pinFooter: boolean;
    flexPin: boolean;
}): string {
    const { header, bodyHtml, footer, repeatHeader, repeatFooter, pinFooter, flexPin } = parts;

    if (repeatHeader || repeatFooter) {
        const thead = repeatHeader ? `<thead><tr><td>${header}</td></tr></thead>` : '';
        const tfoot = repeatFooter ? `<tfoot><tr><td>${footer}</td></tr></tfoot>` : '';
        // Whatever a table section did not take stays in the body, in order.
        const inner = `${repeatHeader ? '' : header}${bodyHtml}${repeatFooter || flexPin ? '' : footer}`;
        const table = `<table class="p71-doc${pinFooter && repeatFooter ? ' p71-doc--pinned' : ''}">
            ${thead}
            ${tfoot}
            <tbody><tr><td>${inner}</td></tr></tbody>
        </table>`;
        // The footer is a sibling of the table, not a row inside it — a cell
        // cannot be pushed to the sheet's bottom by the column around it.
        return flexPin ? `<div class="p71-sheet">${table}${footer}</div>` : table;
    }

    if (flexPin) {
        return `<div class="p71-sheet">
            <div class="p71-sheet-body">${header}${bodyHtml}</div>
            ${footer}
        </div>`;
    }

    return `${header}${bodyHtml}${footer}`;
}

/** Builds the full HTML document. Exported for tests and the settings preview. */
export function buildPrintDocument(opts: PrintDocumentOptions): string {
    const thermal = isThermalPaper(opts.paperSize);
    const header = opts.headerHtml ?? '';

    // Rendered here rather than by each caller so every print path picks up a
    // tenant-designed footer without threading it through 13 printers.
    const tenantFooter = renderFooterHtml(opts.headerConfig, opts.context ?? {}, opts.paperSize);
    const footer = tenantFooter || (opts.footerHtml ?? '');

    const repeatHeader = !!opts.repeatHeader && !!header;
    const repeatFooter = !!tenantFooter && footerRepeats(opts.headerConfig, opts.paperSize);

    // Pinning stretches the table to a full page so the browser pushes the
    // `<tfoot>` down to the bottom edge. Only possible on a fixed-height sheet,
    // so a roll — which prints to an open-ended length — never pins.
    const pageHeightMm = PAGE_CONTENT_HEIGHT_MM[opts.paperSize];
    const bleeds = !!tenantFooter && footerBleeds(opts.headerConfig, opts.paperSize);
    const pinFooter = !!tenantFooter
        && !!pageHeightMm
        && footerPinsToBottom(opts.headerConfig, opts.paperSize);

    // Repeating and pinning are independent settings answering different
    // questions — "every page or only the last?" versus "at the page bottom or
    // right under the content?" — so they need different mechanisms. See
    // `layoutDocument`.
    const useTable = repeatHeader || repeatFooter;
    const flexPin = pinFooter && !repeatFooter;
    const content = layoutDocument({
        header,
        bodyHtml: opts.bodyHtml,
        footer,
        repeatHeader,
        repeatFooter,
        pinFooter,
        flexPin,
    });

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escapeAttr(opts.title)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: ${thermal ? '11px' : '13px'};
            color: #111;
            background: #fff;
        }
        ${wrapCss(thermal, bleeds)}
        .p71-doc { width: 100%; border-collapse: collapse; }
        .p71-doc > thead > tr > td,
        .p71-doc > tfoot > tr > td,
        .p71-doc > tbody > tr > td { padding: 0; border: 0; }
        ${pinFooter && repeatFooter ? `
        /* A full-page-height table leaves the tbody to absorb the slack, which
           pushes the repeating tfoot onto the bottom edge of every page. */
        @media print {
            .p71-doc--pinned { height: ${pageHeightMm}mm; }
            .p71-doc--pinned > tbody > tr > td { vertical-align: top; }
            .p71-doc--pinned > tfoot > tr > td { vertical-align: bottom; }
        }
        @media screen {
            .p71-doc--pinned { height: 100%; }
            html, body, .p71-wrap { height: 100%; }
            .p71-doc--pinned > tfoot > tr > td { vertical-align: bottom; }
        }` : ''}
        ${flexPin ? `
        /* A page-tall flex column: the body absorbs the slack, so the footer is
           pushed to the page bottom when the document is short and flows past
           the break when it is long — the foot of the last page either way.
           The height is stated in mm because a percentage resolves against the
           viewport, which knows nothing about the @page box. */
        .p71-sheet { display: flex; flex-direction: column; min-height: ${pageHeightMm}mm; }
        .p71-sheet > .p71-sheet-body, .p71-sheet > .p71-doc { flex: 1 0 auto; }
        .p71-sheet > .p71-ft { margin-top: auto; }
        @media screen {
            /* No pages on screen, so the viewport stands in for the sheet and
               the preview shows where the footer will actually print. */
            html, body { height: 100%; }
            .p71-wrap { min-height: 100%; }
        }` : ''}
        ${headerCss(opts.headerConfig, opts.paperSize)}
        ${pageCss(opts.paperSize)}
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        ${opts.styles ?? ''}
    </style>
</head>
<body>
<div class="p71-wrap">${content}</div>
</body>
</html>`;
}

/**
 * Opens the print window and triggers printing once images have settled.
 *
 * Returns the window, or null when the popup was blocked — callers should show
 * the usual "allow popups" toast in that case.
 */
export function openPrintWindow(opts: PrintDocumentOptions): Window | null {
    const { width, height } = WINDOW_SIZE[opts.paperSize];
    const win = window.open('', '_blank', `width=${width},height=${height}`);
    if (!win) return null;

    win.document.write(buildPrintDocument(opts));
    win.document.close();

    if (opts.autoPrint !== false) printWhenReady(win);
    return win;
}

/**
 * Waits for pending images before printing.
 *
 * Without this a Cloudinary logo regularly misses the print snapshot and the
 * header prints with an empty box. Prints synchronously when there is nothing
 * to wait for.
 */
function printWhenReady(win: Window): void {
    const images: HTMLImageElement[] = win.document?.images
        ? Array.from(win.document.images)
        : [];
    const pending = images.filter((img) => !img.complete);

    if (pending.length === 0) {
        safePrint(win);
        return;
    }

    let remaining = pending.length;
    let fired = false;
    const fire = () => {
        if (fired) return;
        fired = true;
        safePrint(win);
    };
    const tick = () => {
        remaining -= 1;
        if (remaining <= 0) fire();
    };

    pending.forEach((img) => {
        img.addEventListener('load', tick, { once: true });
        img.addEventListener('error', tick, { once: true });
    });

    // Called on `win` so the timer dies with the popup rather than firing into a
    // closed window.
    if (typeof win.setTimeout === 'function') win.setTimeout(fire, ASSET_TIMEOUT_MS);
    else setTimeout(fire, ASSET_TIMEOUT_MS);
}

function safePrint(win: Window): void {
    try {
        win.focus?.();
        win.print?.();
    } catch {
        // Popup closed before printing — nothing useful to do.
    }
}

function escapeAttr(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
