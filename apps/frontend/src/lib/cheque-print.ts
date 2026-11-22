/**
 * Printing onto a bank cheque leaf.
 *
 * Bangladeshi cheques follow the Bangladesh Bank BACH standard: a leaf about
 * 8 × 3.66 inches (203 × 93 mm), the date as eight boxes top right, the payee
 * line across the middle, the amount in words underneath and the figure in a
 * box on the right. Banks differ by a few millimetres, so the whole layout can
 * be nudged and the nudge is remembered per bank on this device.
 *
 * Kept apart from `lib/print`: that module prints pages of A4 and receipt
 * paper with headers and footers; a cheque is a fixed-size slip where every
 * field sits at an absolute position.
 */
import { takaInWords } from './amount-in-words';

export const CHEQUE_WIDTH_MM = 203;
export const CHEQUE_HEIGHT_MM = 93;

/** Where each field sits on a standard BACH leaf, in millimetres from the top-left corner. */
export const DEFAULT_CHEQUE_LAYOUT = {
    /** First of the eight date boxes; each box is `dateBoxWidth` wide. */
    date: { x: 148, y: 9 },
    dateBoxWidth: 5.6,
    payee: { x: 24, y: 25 },
    words1: { x: 32, y: 34 },
    words2: { x: 12, y: 42 },
    figure: { x: 158, y: 41 },
    /** The "A/C Payee Only" crossing, top left. */
    crossing: { x: 8, y: 6 },
    /** Characters of the amount in words that fit on the first line. */
    words1Chars: 58,
} as const;

export interface ChequePrintData {
    partyName: string;
    amount: number;
    /** `YYYY-MM-DD`. */
    chequeDate: string;
    accountPayee: boolean;
    bankName: string;
}

export interface ChequePrintOptions {
    offsetX: number;
    offsetY: number;
    /** Draw the leaf's outline and field labels, for a test print on plain paper. */
    showGuide: boolean;
    /** The words printed in the crossing; English, as banks expect. */
    acPayeeLabel: string;
}

/** The figure as a bank reads it: lakh grouping, two decimals, closed with "/=". */
export function chequeAmountFigure(amount: number): string {
    const grouped = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        Math.abs(amount),
    );
    return `${grouped}/=`;
}

/** DDMMYYYY, one digit per date box. */
export function chequeDateDigits(chequeDate: string): string[] {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chequeDate);
    if (!match) return [];
    const [, year, month, day] = match;
    return `${day}${month}${year}`.split('');
}

/**
 * The amount in words split over the two lines a cheque gives it, at a word
 * boundary, so a long amount never runs off the leaf mid-word.
 */
export function splitChequeWords(words: string, firstLineChars: number = DEFAULT_CHEQUE_LAYOUT.words1Chars): [string, string] {
    if (words.length <= firstLineChars) return [words, ''];
    const cut = words.lastIndexOf(' ', firstLineChars);
    const at = cut > 0 ? cut : firstLineChars;
    return [words.slice(0, at).trim(), words.slice(at).trim()];
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** The whole print document for one cheque. Pure, so the preview and the print are the same HTML. */
export function buildChequeHtml(data: ChequePrintData, options: ChequePrintOptions): string {
    const L = DEFAULT_CHEQUE_LAYOUT;
    const dx = Number.isFinite(options.offsetX) ? options.offsetX : 0;
    const dy = Number.isFinite(options.offsetY) ? options.offsetY : 0;
    const at = (point: { x: number; y: number }) => `left:${point.x + dx}mm;top:${point.y + dy}mm;`;

    const [line1, line2] = splitChequeWords(takaInWords(data.amount));
    const digits = chequeDateDigits(data.chequeDate);
    const dateBoxes = digits
        .map(
            (digit, index) =>
                `<span class="field digit" style="left:${L.date.x + dx + index * L.dateBoxWidth}mm;top:${L.date.y + dy}mm;width:${L.dateBoxWidth}mm">${digit}</span>`,
        )
        .join('');

    const crossing = data.accountPayee
        ? `<div class="crossing" style="${at(L.crossing)}"><span>${escapeHtml(options.acPayeeLabel)}</span></div>`
        : '';

    const guide = options.showGuide
        ? `<div class="guide"></div>
           <span class="label" style="${at({ x: L.payee.x - 14, y: L.payee.y })}">Pay</span>
           <span class="label" style="${at({ x: L.words1.x - 20, y: L.words1.y })}">Taka</span>
           <span class="box" style="${at({ x: L.figure.x - 3, y: L.figure.y - 1.5 })}"></span>`
        : '';

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Cheque ${escapeHtml(data.partyName)}</title>
<style>
@page { size: ${CHEQUE_WIDTH_MM}mm ${CHEQUE_HEIGHT_MM}mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: ${CHEQUE_WIDTH_MM}mm; height: ${CHEQUE_HEIGHT_MM}mm; position: relative; overflow: hidden;
  font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; background: #fff; }
.field { position: absolute; white-space: nowrap; line-height: 1; }
.digit { text-align: center; font-size: 12pt; letter-spacing: 0; }
.figure { font-size: 12pt; font-weight: bold; }
.crossing { position: absolute; width: 34mm; height: 9mm; border-top: 0.35mm solid #000; border-bottom: 0.35mm solid #000;
  transform: rotate(-12deg); transform-origin: left top; display: flex; align-items: center; justify-content: center;
  font-size: 9pt; font-weight: bold; }
.guide { position: absolute; inset: 0; border: 0.3mm dashed #888; }
.label { position: absolute; font-size: 7pt; color: #888; }
.box { position: absolute; width: 40mm; height: 8mm; border: 0.3mm dashed #888; }
@media print { .guide, .label, .box { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
${guide}
${crossing}
${dateBoxes}
<span class="field" style="${at(L.payee)}">${escapeHtml(data.partyName)}</span>
<span class="field" style="${at(L.words1)}">${escapeHtml(line1)}</span>
${line2 ? `<span class="field" style="${at(L.words2)}">${escapeHtml(line2)}</span>` : ''}
<span class="field figure" style="${at(L.figure)}">${escapeHtml(chequeAmountFigure(data.amount))}</span>
</body></html>`;
}

/** Opens the cheque in its own window and prints it. Null when the browser blocked the window. */
export function printCheque(data: ChequePrintData, options: ChequePrintOptions): Window | null {
    const win = window.open('', '_blank', 'width=900,height=500');
    if (!win) return null;
    win.document.write(buildChequeHtml(data, options));
    win.document.close();
    win.focus();
    // Give the window a moment to lay the slip out before the dialog opens.
    setTimeout(() => {
        try {
            win.print();
        } catch {
            /* the operator can still press Ctrl+P in the window */
        }
    }, 250);
    return win;
}

const OFFSET_STORAGE_KEY = 'erp71.chequeOffsets';

/** Per-bank nudge, kept on this device: printers feed differently, and so do banks' leaves. */
export function readChequeOffset(bankName: string): { offsetX: number; offsetY: number } {
    try {
        const all = JSON.parse(window.localStorage.getItem(OFFSET_STORAGE_KEY) ?? '{}') as Record<string, { x: number; y: number }>;
        const saved = all[bankName.trim().toLowerCase()];
        return { offsetX: Number(saved?.x) || 0, offsetY: Number(saved?.y) || 0 };
    } catch {
        return { offsetX: 0, offsetY: 0 };
    }
}

export function saveChequeOffset(bankName: string, offsetX: number, offsetY: number): void {
    try {
        const all = JSON.parse(window.localStorage.getItem(OFFSET_STORAGE_KEY) ?? '{}') as Record<string, { x: number; y: number }>;
        all[bankName.trim().toLowerCase()] = { x: offsetX, y: offsetY };
        window.localStorage.setItem(OFFSET_STORAGE_KEY, JSON.stringify(all));
    } catch {
        /* storage unavailable: the nudge just is not remembered */
    }
}
