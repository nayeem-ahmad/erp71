/**
 * The single way this app opens a print window.
 *
 * Every printed document used to hand-roll `window.open` + `document.write` +
 * `print()`, each with its own `@page` rules and its own race against images
 * loading. This module owns all three.
 */

import { headerCss } from './header';
import { isThermalPaper, type DeepPartial, type PaperSize, type PrintHeaderConfig } from './types';

const PAGE_CSS: Record<PaperSize, string> = {
    A4: '@page { size: A4 portrait; margin: 15mm; }',
    A5: '@page { size: A5 portrait; margin: 10mm; }',
    Letter: '@page { size: letter portrait; margin: 15mm; }',
    Thermal80: '@page { size: 80mm auto; margin: 4mm; }',
    Thermal58: '@page { size: 58mm auto; margin: 3mm; }',
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
    footerHtml?: string;
    /** Document-specific CSS, appended last so it wins over the base rules. */
    styles?: string;
    /** Header config the CSS is generated from — pass what produced headerHtml. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    /**
     * Repeat the header at the top of every printed page. Uses a table/thead
     * wrapper because Chrome only repeats table headers — `position: fixed`
     * does not survive pagination.
     */
    repeatHeader?: boolean;
    autoPrint?: boolean;
}

/** Builds the full HTML document. Exported for tests and the settings preview. */
export function buildPrintDocument(opts: PrintDocumentOptions): string {
    const thermal = isThermalPaper(opts.paperSize);
    const header = opts.headerHtml ?? '';
    const footer = opts.footerHtml ?? '';

    const content = opts.repeatHeader && header
        ? `<table class="p71-doc">
            <thead><tr><td>${header}</td></tr></thead>
            <tbody><tr><td>${opts.bodyHtml}${footer}</td></tr></tbody>
        </table>`
        : `${header}${opts.bodyHtml}${footer}`;

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
        .p71-wrap { ${thermal ? 'padding: 6px;' : 'max-width: 780px; margin: 0 auto;'} }
        .p71-doc { width: 100%; border-collapse: collapse; }
        .p71-doc > thead > tr > td,
        .p71-doc > tbody > tr > td { padding: 0; border: 0; }
        ${headerCss(opts.headerConfig, opts.paperSize)}
        ${PAGE_CSS[opts.paperSize]}
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
