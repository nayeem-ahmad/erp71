import { DEFAULT_INVOICE_PRINT_PREFS, type InvoicePrintPrefs } from '@erp71/shared-types';
import { takaInWords } from './amount-in-words';
import { formatCurrency, formatDate } from './format';
import { escapeHtml as esc, openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, HeaderContext, PrintHeaderConfig } from './print';
import { warrantyLabel } from './sale-print-actions';
import {
    TAKA,
    detailedCustomerFields,
    detailedEndHtml,
    detailedFooterHtml,
    detailedInfoBoxHtml,
    detailedItemsHtml,
    detailedRow as row,
    formatPrintStamp,
    type DetailedField,
    type DetailedMoney,
} from './sales-invoice-detailed';
import { THANK_YOU, detailedSheetStyles, type InvoiceItem } from './sales-invoice-printer';

/**
 * The sales quotation — and the proforma invoice, which is a quotation with
 * commercial terms — printed on the detailed invoice's design: the letterhead
 * with a QR code, the customer and the document boxed together, the item table
 * with its warranty column, and the money beside the closing block.
 *
 * It takes the member's invoice choices that make sense on a quotation — the
 * padding, warranty column, table rules, total in words, signature lines and
 * footer text — so the quotation a customer is handed and the invoice that
 * follows it read as one set of paper.
 *
 * What a quotation does not have, it does not print: no payments, no dues, no
 * account balance. A proforma's terms take the account block's place.
 */

/**
 * The shape this module needs off a quotation. The list's rows and the detail
 * endpoint both satisfy it; the proforma terms are absent on an ordinary quote.
 */
export interface PrintableQuotation {
    id: string;
    quote_number: string;
    version: number;
    created_at: string;
    valid_until?: string | null;
    total_amount: string | number;
    /** VAT added on top of lines entered before VAT; part of `total_amount`. */
    vat_amount?: string | number | null;
    doc_kind?: string | null;
    /** ISO code; a proforma may be written in a currency other than taka. */
    currency?: string | null;
    incoterm?: string | null;
    port_of_loading?: string | null;
    port_of_discharge?: string | null;
    country_of_origin?: string | null;
    delivery_lead_time_days?: number | null;
    advance_percent?: string | number | null;
    payment_terms?: string | null;
    notes?: string | null;
    store_id?: string | null;
    customer?: {
        name?: string | null;
        phone?: string | null;
        address?: string | null;
        customer_code?: string | null;
    } | null;
    items: {
        quantity: number;
        unit_price: string | number;
        product?: {
            name?: string | null;
            sku?: string | null;
            warranty_enabled?: boolean;
            warranty_duration_days?: number | null;
        } | null;
    }[];
}

/** Letterhead and the print line, already resolved by the caller. */
export interface QuotationPrintContext {
    companyName?: string;
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    locale: string;
    unknownProductLabel: string;
    /** The signed-in user printing, named on the print line. */
    printedBy?: string;
    /** When it was printed, already formatted; the moment of printing when omitted. */
    printedAt?: string;
    /** A code that opens the quotation in the app; not printed when omitted. */
    qrDataUrl?: string;
}

const toPaisa = (value: number) => Math.round(value * 100) / 100;

function num(value: string | number | null | undefined): number {
    const parsed = typeof value === 'number' ? value : parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Taka, or the proforma's own currency named by its code in the headers. */
function moneyFor(currency: string): DetailedMoney {
    if (currency === 'BDT') return TAKA;
    return {
        unit: currency,
        format: (value) => formatCurrency(value, { currency }).replace(/^\S+\s*/, ''),
    };
}

/**
 * The money, top to bottom: the lines, the VAT a quotation entered before VAT
 * adds on top, and the total. Anything else between the lines and the stored
 * total is shown for what it is, so the block always foots on its face.
 */
function totalsRows(items: InvoiceItem[], vat: number, total: number, money: DetailedMoney): string {
    const unit = esc(money.unit);
    const subtotal = toPaisa(items.reduce((sum, item) => sum + item.quantity * item.unitPrice - (item.discount ?? 0), 0));
    const rows = [row(`Sub Total (${unit}):`, money.format(subtotal))];
    if (vat > 0.005) rows.push(row(`VAT (${unit}):`, money.format(vat)));

    const gap = toPaisa(subtotal + vat - total);
    if (gap > 0.005) rows.push(row(`Discount (${unit}):`, `-${money.format(gap)}`, 'neg'));
    else if (gap < -0.005) rows.push(row(`Adjustment (${unit}):`, money.format(-gap)));

    rows.push(row(`Total (${unit}):`, money.format(total), 'rule'));
    return rows.join('');
}

/** A proforma's commercial terms — whichever were filled in — or nothing. */
function termsHtml(quote: PrintableQuotation): string {
    const days = quote.delivery_lead_time_days;
    const advance = num(quote.advance_percent);
    const lines: DetailedField[] = [
        ['Incoterm', quote.incoterm ?? undefined],
        ['Port of Loading', quote.port_of_loading ?? undefined],
        ['Port of Discharge', quote.port_of_discharge ?? undefined],
        ['Country of Origin', quote.country_of_origin ?? undefined],
        ['Delivery', days ? `${days} day${days === 1 ? '' : 's'} from order` : undefined],
        ['Advance', advance > 0 ? `${advance}%` : undefined],
        ['Payment Terms', quote.payment_terms ?? undefined],
    ];
    const present = lines.filter((line): line is [string, string] => !!line[1]);
    if (present.length === 0) return '';
    return `<table class="d-block d-terms">${present.map(([label, value]) => row(label, esc(value))).join('')}</table>`;
}

/**
 * The terms sit where an invoice keeps the customer's account, and can run to
 * a sentence — so, unlike the figures, they wrap and read from the left.
 */
const QUOTATION_STYLES = `
        .d-terms td { vertical-align:top; }
        .d-terms td:first-child { font-weight:bold; padding-right:10px; white-space:nowrap; }
        .d-terms td:last-child { text-align:left; white-space:normal; overflow-wrap:anywhere; }
`;

/**
 * Prints the quotation on A4 — a quotation is a trade document, never a till
 * roll. Null when the browser blocked the window.
 *
 * @param layout The printing member's invoice layout (see
 *   `useInvoicePrintPrefs`); the built-in one when omitted. Its `layout` choice
 *   is not consulted: a quotation always prints the detailed design.
 */
export function printSalesQuotation(
    quote: PrintableQuotation,
    ctx: QuotationPrintContext,
    layout: InvoicePrintPrefs = DEFAULT_INVOICE_PRINT_PREFS,
): Window | null {
    const proforma = quote.doc_kind === 'PROFORMA';
    const title = proforma ? 'Proforma Invoice' : 'Quotation';
    const currency = (quote.currency || 'BDT').toUpperCase();
    const money = moneyFor(currency);
    const date = formatDate(quote.created_at, ctx.locale);
    const printedAt = ctx.printedAt ?? formatPrintStamp();
    const who = ctx.printedBy?.trim();
    const total = num(quote.total_amount);

    const items: InvoiceItem[] = quote.items.map((item) => ({
        name: item.product?.name || ctx.unknownProductLabel,
        sku: item.product?.sku ?? undefined,
        quantity: item.quantity,
        unitPrice: num(item.unit_price),
        warranty: warrantyLabel(item.product),
    }));

    const context: HeaderContext = {
        docTitle: title,
        docNumber: quote.quote_number,
        docDate: date,
        companyName: ctx.companyName,
        printDate: printedAt,
    };

    const infoBox = detailedInfoBoxHtml(
        detailedCustomerFields({
            code: quote.customer?.customer_code ?? undefined,
            name: quote.customer?.name ?? undefined,
            address: quote.customer?.address ?? undefined,
            phone: quote.customer?.phone ?? undefined,
        }),
        [
            [proforma ? 'Proforma No.' : 'Quotation No.', quote.quote_number],
            // A revision keeps the number, so the version is what tells them apart.
            ['Version', quote.version > 1 ? String(quote.version) : undefined],
            ['Date', date],
            ['Valid Until', quote.valid_until ? formatDate(quote.valid_until, ctx.locale) : undefined],
        ],
    );

    return openPrintWindow({
        context,
        headerConfig: ctx.headerConfig,
        // The QR code in place of the number and date, which the box says.
        headerHtml: renderHeaderHtml(ctx.headerConfig, { ...context, docQr: ctx.qrDataUrl, hideDocMeta: true }, 'A4'),
        bodyHtml: detailedItemsHtml(items, layout, infoBox, money),
        endHtml: detailedEndHtml({
            // Spelled out in taka only — the words name the currency.
            words: layout.amount_in_words && currency === 'BDT' ? takaInWords(total) : undefined,
            left: proforma ? termsHtml(quote) : '',
            right: `<table class="d-block">${totalsRows(items, num(quote.vat_amount), total, money)}</table>`,
            note: quote.notes ?? undefined,
            signatures: layout.signature_lines,
        }),
        footerHtml: detailedFooterHtml(layout.footer_text ?? THANK_YOU),
        title: `${title} ${quote.quote_number}`,
        paperSize: 'A4',
        styles: detailedSheetStyles(layout) + QUOTATION_STYLES,
        repeatHeader: true,
        pinFooter: true,
        pageStamp: { text: `Printed ${printedAt}${who ? ` by ${who}` : ''}`, pageNumbers: true },
        compactable: true,
        bodyTypeScale: true,
    });
}
