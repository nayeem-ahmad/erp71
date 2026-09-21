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
    /**
     * Show the document with a toolbar instead of printing straight away.
     *
     * The preview is the real print document, not a second rendering of it —
     * the only difference is a `no-print` toolbar bar pinned to the top and a
     * suppressed `print()` call. Anything that looks right here prints right,
     * which is the whole reason it is not a separate screen.
     */
    preview?: PrintPreviewOptions;
}

export interface PrintPreviewOptions {
    /** Toolbar heading — normally the document and its paper size. */
    title: string;
    printLabel: string;
    closeLabel: string;
    /** Wording of the opt-out checkbox; omitted to hide it entirely. */
    skipLabel?: string;
}

/**
 * The content column.
 *
 * Capped and centred so long lines stay readable in the preview window. In
 * print the cap is irrelevant — the page is already the right measure — and a
 * bleeding footer has to escape it, so printing drops it. See the bleed rules
 * in `headerCss`, which are print-only for the same reason.
 *
 * The preview replaces this column with a paper-shaped sheet — see
 * `previewSheetCss` — so there the cap is dropped on screen too.
 */
function wrapCss(thermal: boolean, bleeds: boolean, sheet: boolean): string {
    if (sheet) {
        // The sheet is the measure, so the column must not also cap the width
        // or a bleeding footer would be boxed in by it on screen.
        return '.p71-wrap { width: 100%; margin: 0; }';
    }

    const base = thermal
        ? '.p71-wrap { padding: 6px; }'
        : '.p71-wrap { max-width: 780px; margin: 0 auto; }';
    if (thermal || !bleeds) return base;

    return `${base}
        @media print { .p71-wrap { max-width: none; margin: 0; } }`;
}

/** The paper's width in mm — the sheet is drawn to it on screen. */
const PAGE_WIDTH_MM: Record<PaperSize, number> = {
    A4: 210,
    A5: 148,
    Letter: 216,
    Thermal80: 80,
    Thermal58: 58,
};

/**
 * Draws the preview on a paper-shaped sheet instead of in the popup's own
 * width.
 *
 * The preview's promise is that what you see is what prints. That only holds
 * if the screen has the same geometry as the page, so the sheet takes the real
 * paper width and the real `@page` margin as padding. That padding is the
 * load-bearing part: the bleed rules cancel the page margin with equal
 * negative margins, and on screen there was previously no margin to cancel —
 * which is exactly why a bleeding footer looked inset in the preview but ran
 * to the edge on paper. Give the sheet a real margin and the same rules work
 * in both media.
 *
 * Screen-only. On paper the page box already is the sheet, so every rule here
 * is switched off in print.
 */
function previewSheetCss(paperSize: PaperSize): string {
    const margin = PAGE_MARGIN_MM[paperSize];
    const width = PAGE_WIDTH_MM[paperSize];
    const heightMm = PAGE_CONTENT_HEIGHT_MM[paperSize];

    // A roll prints to an open-ended length and has no page bottom, so it gets
    // the paper width but never a fixed height — a sheet would draw a bottom
    // edge that does not exist.
    const sheetHeight = heightMm ? `min-height: ${heightMm + margin * 2}mm;` : '';

    return `
        @media screen {
            body { background: #9ca3af; }
            .p71-pv-sheet {
                width: ${width}mm;
                ${sheetHeight}
                box-sizing: border-box;
                padding: ${margin}mm;
                margin: 16px auto;
                background: #fff;
                box-shadow: 0 1px 4px rgba(0,0,0,0.28);
                overflow: hidden;
            }
        }
        /* On paper the @page box is the sheet — the screen furniture would
           otherwise add a second margin inside the real one. */
        @media print {
            .p71-pv-sheet {
                width: auto;
                min-height: 0;
                padding: 0;
                margin: 0;
                background: none;
                box-shadow: none;
                overflow: visible;
            }
        }`;
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
        ${wrapCss(thermal, bleeds, !!opts.preview)}
        ${opts.preview ? previewSheetCss(opts.paperSize) : ''}
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
        ${opts.preview ? previewCss() : ''}
    </style>
</head>
<body>
${opts.preview ? previewToolbarHtml(opts.preview) : ''}
${opts.preview
        ? `<div class="p71-pv-sheet"><div class="p71-wrap">${content}</div></div>`
        : `<div class="p71-wrap">${content}</div>`}
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

    // A previewed document waits for the operator to press Print; printing it
    // on open would defeat the point of previewing it.
    if (opts.preview) return win;
    if (opts.autoPrint !== false) printWhenReady(win);
    return win;
}

/** Message a preview window posts back when "skip next time" is ticked. */
export const PRINT_PREVIEW_SKIP_MESSAGE = 'erp71:print-preview-skip';

/**
 * The preview toolbar, rendered into the print document itself.
 *
 * It is `no-print` and `position: fixed`, so it is on screen but never on
 * paper. The buttons are wired with inline handlers rather than a script the
 * opener injects, because the document is written through `document.write` and
 * a popup blocker that permits the window still races an injected listener.
 *
 * The checkbox reports back through `postMessage` — the opener owns the
 * preference, and a popup writing to the app's localStorage would be writing
 * to a different origin's copy in some browsers.
 */
function previewToolbarHtml(preview: PrintPreviewOptions): string {
    const skip = preview.skipLabel
        ? `<label class="p71-pv-skip">
               <input type="checkbox" onchange="try{window.opener&&window.opener.postMessage({type:'${PRINT_PREVIEW_SKIP_MESSAGE}',skip:this.checked},'*')}catch(e){}">
               <span>${escapeAttr(preview.skipLabel)}</span>
           </label>`
        : '';

    return `<div class="p71-pv no-print">
        <span class="p71-pv-title">${escapeAttr(preview.title)}</span>
        <span class="p71-pv-actions">
            ${skip}
            <button type="button" class="p71-pv-btn p71-pv-btn--ghost" onclick="window.close()">${escapeAttr(preview.closeLabel)}</button>
            <button type="button" class="p71-pv-btn p71-pv-btn--primary" onclick="window.focus();window.print()">${escapeAttr(preview.printLabel)}</button>
        </span>
    </div>`;
}

/** Toolbar styling. Screen-only — `@media print` hides the bar outright. */
function previewCss(): string {
    return `
        .p71-pv {
            position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; flex-wrap: wrap;
            padding: 8px 12px;
            background: #ffffff; border-bottom: 1px solid #e5e7eb;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            font-family: Arial, Helvetica, sans-serif; font-size: 13px;
        }
        .p71-pv-title { font-weight: 700; color: #111827; }
        .p71-pv-actions { display: flex; align-items: center; gap: 10px; }
        .p71-pv-skip { display: flex; align-items: center; gap: 5px; color: #4b5563; font-size: 12px; cursor: pointer; }
        .p71-pv-btn {
            border-radius: 6px; padding: 6px 14px; font-size: 13px; font-weight: 600;
            cursor: pointer; border: 1px solid transparent; min-height: 32px;
        }
        .p71-pv-btn--ghost { background: #fff; border-color: #d1d5db; color: #374151; }
        .p71-pv-btn--ghost:hover { background: #f9fafb; }
        .p71-pv-btn--primary { background: #2563eb; color: #fff; }
        .p71-pv-btn--primary:hover { background: #1d4ed8; }
        /* Clear the fixed bar so the top of the document is not hidden under it. */
        body { padding-top: 52px; }
        @media print {
            .p71-pv { display: none !important; }
            body { padding-top: 0; }
        }`;
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
