/**
 * A downloadable PDF of a shared quotation, drawn on the seller's letterhead.
 *
 * Why a real file rather than the print dialog: the page keeps its Print button
 * — the browser's own "Save as PDF" is the most faithful renderer there is, and
 * it is the only one that draws Bengali correctly. But a buyer who is sent a
 * link on WhatsApp and asked to forward "the PDF" to their bank needs a file,
 * and a print dialog does not produce one on most phones without several steps
 * that end in a screenshot. So this builds the file directly, with jsPDF, the
 * way `components/data-table/export-utils.ts` already builds every other PDF in
 * the app.
 *
 * It inherits that path's one limitation: jsPDF's built-in fonts are WinAnsi,
 * so text outside Latin-1 — a product name typed in Bangla — does not survive.
 * That is why the Print button stays and is offered first; see TODO.md.
 *
 * The letterhead is not re-invented here. `resolveHeaderConfig` and
 * `applyTokens` are the same functions the HTML renderer uses, so a tenant who
 * edits their template in settings sees the change in the downloaded PDF, on
 * the printed page and on screen, without three places to keep in step.
 */

import {
    applyTokens,
    resolveHeaderConfig,
    type DeepPartial,
    type HeaderContext,
    type HeaderLine,
    type PrintHeaderConfig,
} from './print';

/** A4 portrait in mm, matching the `@page` rule the print path uses. */
const PAGE = { width: 210, height: 297, margin: 15 };
/** pt → mm. jsPDF positions in mm but sizes type in points. */
const PT = 0.3528;
/** Longest we wait on the logo before producing the PDF without it. */
const LOGO_TIMEOUT_MS = 4000;

export type QuotationPdfItem = {
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

export type QuotationPdfTerm = { label: string; value: string };

export type QuotationPdfData = {
    /** "Quotation" or "Proforma Invoice" — also the heading in the doc block. */
    title: string;
    documentNumber: string;
    /** Already formatted for display; this module never parses dates. */
    issuedOn: string;
    validUntil: string;
    customerName: string;
    /** ISO code. Printed as a code, never as ৳ — see `money`. */
    currency: string;
    items: QuotationPdfItem[];
    totalLabel: string;
    total: number;
    /** Rendered under the total when the document asks for a deposit. */
    advance?: { label: string; amount: number };
    terms?: QuotationPdfTerm[];
    bank?: QuotationPdfTerm[];
    notes?: string | null;
    letterhead?: {
        config?: DeepPartial<PrintHeaderConfig>;
        context?: HeaderContext;
    } | null;
    /** Section headings, so the caller owns every user-visible string. */
    labels: {
        preparedFor: string;
        issued: string;
        validUntil: string;
        item: string;
        quantity: string;
        unitPrice: string;
        lineTotal: string;
        terms: string;
        remitTo: string;
        notes: string;
    };
};

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

type Rgb = [number, number, number];

/** Hex → RGB, falling back rather than throwing on anything unexpected. */
function rgb(value: string | undefined, fallback: Rgb): Rgb {
    const hex = value?.trim() ?? '';
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
    const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (short) return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)];
    if (full) return [parseInt(full[1], 16), parseInt(full[2], 16), parseInt(full[3], 16)];
    return fallback;
}

/**
 * `৳` and other non-Latin-1 currency symbols do not exist in jsPDF's built-in
 * fonts, so the ISO code leads instead — which is also what a buyer's bank
 * wants to read on a proforma denominated in a currency that is not its own.
 */
function money(value: number, currency: string): string {
    const amount = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
    return `${currency} ${amount}`;
}

/**
 * Loads the logo as a data URL, or resolves undefined.
 *
 * Every failure mode ends the same way — a PDF without a logo rather than no
 * PDF at all: a host that sends no CORS header taints the canvas, an asset that
 * has been deleted never fires `load`, and a slow connection may not finish at
 * all. Cloudinary, where these are uploaded, does send `Access-Control-Allow-Origin`.
 */
function loadLogo(url: string | undefined): Promise<{ dataUrl: string; ratio: number } | undefined> {
    if (!url || !/^(https?:\/\/|data:image\/)/i.test(url)) return Promise.resolve(undefined);

    return new Promise((resolve) => {
        const image = new Image();
        const done = (result?: { dataUrl: string; ratio: number }) => {
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => done(undefined), LOGO_TIMEOUT_MS);

        image.crossOrigin = 'anonymous';
        image.onerror = () => done(undefined);
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                const context = canvas.getContext('2d');
                if (!context || !canvas.width || !canvas.height) return done(undefined);
                context.drawImage(image, 0, 0);
                done({ dataUrl: canvas.toDataURL('image/png'), ratio: canvas.width / canvas.height });
            } catch {
                // Tainted canvas — the host served the image without CORS.
                done(undefined);
            }
        };
        image.src = url;
    });
}

/** Turns the template's line list into drawable text, dropping empty ones. */
function resolvedLines(
    lines: HeaderLine[] | undefined,
    context: HeaderContext,
): Array<{ line: HeaderLine; text: string }> {
    return (lines ?? [])
        .map((line) => ({ line, ...applyTokens(line.text ?? '', context) }))
        .filter((entry) => !entry.empty)
        .map(({ line, text }) => ({ line, text }));
}

/* ------------------------------------------------------------------ */
/*  Document                                                           */
/* ------------------------------------------------------------------ */

/**
 * Builds and saves the file. Named for what the user sees happen: a file lands
 * in their downloads called `Q-1001.pdf`.
 */
export async function downloadQuotationPdf(data: QuotationPdfData): Promise<void> {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
    ]);

    const config = resolveHeaderConfig(data.letterhead?.config, 'A4');
    const context: HeaderContext = {
        docTitle: data.title,
        docNumber: data.documentNumber,
        docDate: data.issuedOn,
        ...(data.letterhead?.context ?? {}),
    };

    const accent = rgb(config.title.color, [29, 78, 216]);
    const ink: Rgb = [17, 24, 39];
    const muted: Rgb = [85, 85, 85];

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const right = PAGE.width - PAGE.margin;
    const contentWidth = right - PAGE.margin;

    const logo = config.layout === 'text-only'
        ? undefined
        : await loadLogo(config.logo.url);

    let y = PAGE.margin;

    /** Moves to a new page when `needed` mm would run past the bottom margin. */
    const ensureSpace = (needed: number) => {
        if (y + needed <= PAGE.height - PAGE.margin) return;
        doc.addPage();
        y = PAGE.margin;
    };

    const text = (
        value: string,
        x: number,
        options: { size?: number; color?: Rgb; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right' } = {},
    ) => {
        const size = options.size ?? config.baseFontSizePt;
        const style = options.bold && options.italic ? 'bolditalic' : options.bold ? 'bold' : options.italic ? 'italic' : 'normal';
        doc.setFont('helvetica', style);
        doc.setFontSize(size);
        doc.setTextColor(...(options.color ?? ink));
        doc.text(value, x, y, { align: options.align ?? 'left', baseline: 'top' });
        return size * PT * 1.35;
    };

    /* ---- letterhead ------------------------------------------------ */

    const centred = config.layout === 'logo-above' || config.layout === 'logo-center';
    const mirrored = config.layout === 'logo-right';
    const brandX = centred ? PAGE.width / 2 : mirrored ? right : PAGE.margin;
    const docX = centred ? PAGE.width / 2 : mirrored ? PAGE.margin : right;
    const align = centred ? 'center' : mirrored ? 'right' : 'left';
    const docAlign = centred ? 'center' : mirrored ? 'left' : 'right';

    let logoWidth = 0;

    if (logo) {
        const height = Math.min(Math.max(config.logo.heightMm, 3), 60);
        logoWidth = Math.min(height * logo.ratio, 60);
        const stacked = config.layout === 'logo-above';
        const logoX = stacked || centred
            ? PAGE.width / 2 - logoWidth / 2
            : mirrored
              ? right - logoWidth
              : PAGE.margin;
        doc.addImage(logo.dataUrl, 'PNG', logoX, y, logoWidth, height);
        if (stacked) {
            y += height + 2;
            logoWidth = 0;
        }
    }

    // Beside the logo on the side-by-side layouts, under it on the stacked one.
    const textX = logoWidth && !centred
        ? mirrored
            ? right - logoWidth - 3
            : PAGE.margin + logoWidth + 3
        : brandX;
    const brandTextTop = y;

    if (config.company.show) {
        const name = config.company.nameOverride?.trim() || context.companyName?.trim();
        if (name) {
            y += text(name, textX, {
                size: config.company.fontSizePt,
                bold: config.company.bold,
                color: rgb(config.company.color, accent),
                align,
            });
        }
    }

    for (const { line, text: value } of resolvedLines(config.lines, context)) {
        y += text(value, textX, {
            size: line.fontSizePt ?? config.baseFontSizePt,
            bold: line.bold,
            italic: line.italic,
            color: rgb(line.color, muted),
            align,
        });
    }

    const brandBottom = Math.max(y, brandTextTop + (logo && !centred ? config.logo.heightMm : 0));

    /* ---- document block -------------------------------------------- */

    if (config.title.show) {
        y = centred ? brandBottom + 2 : brandTextTop;
        y += text(config.title.uppercase ? data.title.toUpperCase() : data.title, docX, {
            size: config.title.fontSizePt,
            bold: true,
            color: accent,
            align: docAlign,
        });
        if (data.documentNumber) {
            y += text(`# ${data.documentNumber}`, docX, { color: muted, align: docAlign });
        }
        if (data.issuedOn) {
            y += text(data.issuedOn, docX, { color: muted, align: docAlign });
        }
    }

    y = Math.max(y, brandBottom) + config.spacingMm;

    if (config.rule.show) {
        doc.setDrawColor(...rgb(config.rule.color, accent));
        doc.setLineWidth(Math.max(config.rule.thicknessPx, 1) * 0.26);
        doc.line(PAGE.margin, y, right, y);
        y += config.spacingMm;
    }

    /* ---- parties ---------------------------------------------------- */

    const partiesTop = y;
    text(data.labels.preparedFor, PAGE.margin, { size: 8, color: muted });
    y += 8 * PT * 1.35;
    y += text(data.customerName || '—', PAGE.margin, { size: 11, bold: true });

    let metaY = partiesTop;
    const meta = [
        `${data.labels.issued}: ${data.issuedOn}`,
        `${data.labels.validUntil}: ${data.validUntil}`,
    ];
    for (const entry of meta) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...muted);
        doc.text(entry, right, metaY, { align: 'right', baseline: 'top' });
        metaY += 9 * PT * 1.35;
    }

    y = Math.max(y, metaY) + 4;

    /* ---- line items -------------------------------------------------- */

    autoTable(doc, {
        startY: y,
        margin: { left: PAGE.margin, right: PAGE.margin },
        head: [[data.labels.item, data.labels.quantity, data.labels.unitPrice, data.labels.lineTotal]],
        body: data.items.map((item) => [
            item.product_name,
            String(item.quantity),
            money(item.unit_price, data.currency),
            money(item.line_total, data.currency),
        ]),
        styles: { fontSize: 9, cellPadding: 2, textColor: ink },
        headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
            1: { halign: 'right', cellWidth: 20 },
            2: { halign: 'right', cellWidth: 32 },
            3: { halign: 'right', cellWidth: 34 },
        },
        theme: 'striped',
    });

    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 4;

    /* ---- totals ------------------------------------------------------ */

    const totalsLeft = right - 70;
    ensureSpace(16);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(totalsLeft, y, right, y);
    y += 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    doc.text(data.totalLabel, totalsLeft, y, { baseline: 'top' });
    doc.text(money(data.total, data.currency), right, y, { align: 'right', baseline: 'top' });
    y += 11 * PT * 1.5;

    if (data.advance) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...muted);
        doc.text(data.advance.label, totalsLeft, y, { baseline: 'top' });
        doc.setTextColor(...ink);
        doc.text(money(data.advance.amount, data.currency), right, y, { align: 'right', baseline: 'top' });
        y += 9 * PT * 1.6;
    }

    y += 4;

    /* ---- terms, bank, notes ------------------------------------------ */

    /** Two columns of label/value, the same pairs the page shows on screen. */
    const definitionBlock = (heading: string, entries: QuotationPdfTerm[]) => {
        if (entries.length === 0) return;
        ensureSpace(14);
        y += text(heading.toUpperCase(), PAGE.margin, { size: 8, bold: true, color: muted }) + 1;

        const columnWidth = contentWidth / 2;
        // Two pairs to a row, each column wrapping independently — a long
        // payment term next to a two-word incoterm must not clip.
        for (let index = 0; index < entries.length; index += 2) {
            ensureSpace(12);
            const rowTop = y;
            let rowBottom = rowTop;
            for (const [column, entry] of entries.slice(index, index + 2).entries()) {
                const x = PAGE.margin + column * columnWidth;
                y = rowTop;
                y += text(entry.label, x, { size: 8, color: muted });
                for (const part of doc.splitTextToSize(entry.value, columnWidth - 4) as string[]) {
                    y += text(part, x, { size: 9 });
                }
                rowBottom = Math.max(rowBottom, y);
            }
            y = rowBottom + 1.5;
        }
        y += 3;
    };

    definitionBlock(data.labels.terms, data.terms ?? []);
    definitionBlock(data.labels.remitTo, data.bank ?? []);

    if (data.notes?.trim()) {
        ensureSpace(14);
        y += text(data.labels.notes.toUpperCase(), PAGE.margin, { size: 8, bold: true, color: muted }) + 1;
        for (const part of doc.splitTextToSize(data.notes.trim(), contentWidth) as string[]) {
            ensureSpace(6);
            y += text(part, PAGE.margin, { size: 9, color: muted });
        }
        y += 3;
    }

    /* ---- tenant footer ------------------------------------------------ */

    const footerLines = config.footer?.show ? resolvedLines(config.footer.lines, context) : [];
    if (footerLines.length > 0) {
        ensureSpace(6 + footerLines.length * 5);
        y += config.footer.spacingMm;
        if (config.footer.rule?.show) {
            doc.setDrawColor(...rgb(config.footer.rule.color, [209, 213, 219]));
            doc.setLineWidth(Math.max(config.footer.rule.thicknessPx, 1) * 0.26);
            doc.line(PAGE.margin, y, right, y);
            y += config.footer.spacingMm;
        }
        for (const { line, text: value } of footerLines) {
            const lineAlign = line.align ?? 'left';
            const x = lineAlign === 'center' ? PAGE.width / 2 : lineAlign === 'right' ? right : PAGE.margin;
            y += text(value, x, {
                size: line.fontSizePt ?? config.baseFontSizePt,
                bold: line.bold,
                italic: line.italic,
                color: rgb(line.color, muted),
                align: lineAlign,
            });
        }
    }

    doc.save(`${data.documentNumber || data.title}.pdf`);
}
