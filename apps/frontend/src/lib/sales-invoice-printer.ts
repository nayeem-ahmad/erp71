import {
    DEFAULT_INVOICE_PRINT_PREFS,
    type InvoicePadding,
    type InvoicePrintPrefs,
} from '@erp71/shared-types';
import { formatBDT } from './format';
import { takaInWords } from './amount-in-words';
import { invoiceDues, type InvoiceDues } from './customer-credit';
import {
    detailedBodyHtml,
    detailedFooterHtml,
    detailedStyles,
    formatPrintStamp,
    withInvoiceQr,
} from './sales-invoice-detailed';
import { paymentMethodLabel } from './payment-method-label';
import { COMPACT_SCOPE, isThermalPaper, openPrintWindow, paperSizeLabel, renderHeaderHtml } from './print';
import type {
    DeepPartial,
    HeaderContext,
    PaperSize,
    PrintHeaderConfig,
    PrintPreviewOptions,
    PrintSheet,
} from './print';

export { PAPER_SIZES, paperSizeLabel } from './print';
export type { PaperSize } from './print';

export interface InvoiceItem {
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    discount?: number; // discount amount for this line
    /** "6 months" — what the detailed layout's Warranty column says for the line. */
    warranty?: string;
}

export interface InvoicePayment {
    method: string;
    amount: number;
    /**
     * The instrument behind the payment — "CHQ-889001 · City Bank". Printed
     * beside the method so the invoice says which cheque settled it, which is
     * the whole point of having recorded one.
     */
    reference?: string;
}

export interface InvoiceData {
    referenceNumber: string;
    date: string;
    companyName?: string;
    /** The branch the sale belongs to — fills the {{store_name}} token. */
    storeName?: string;
    companyAddress?: string;
    companyPhone?: string;
    /** Tenant header design; falls back to the built-in default when omitted. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    /** Where the goods go — the detailed layout's Shipping Address block. */
    shippingAddress?: string;
    /** The sales order this invoice was raised from — the detailed layout's Order No. */
    orderNumber?: string;
    /** Who prepared the invoice — the detailed layout's footer, and `{{prepared_by}}`. */
    preparedBy?: string;
    /**
     * When it was printed, already formatted. Left out, the moment of printing
     * is used; a caller sets it only to pin the stamp, as a test does.
     */
    printedAt?: string;
    /**
     * A QR code (a data URL) that opens this invoice in the app, printed in the
     * detailed layout's header. Left out where the invoice has no page to open
     * yet — a sale not saved — and the code is simply not printed.
     */
    qrDataUrl?: string;
    items: InvoiceItem[];
    payments: InvoicePayment[];
    subtotal: number;
    discountAmount?: number;
    discountPercent?: number;
    vat?: number;
    /**
     * Tax already *inside* the prices and the total, as a posted sale holds it
     * (`Sale.vat_amount` + `sd_amount`). Not the same as `vat`, which is tax
     * still to be added to the subtotal on the entry screen. The two never both
     * apply; the detailed layout writes its totals differently for each.
     */
    taxIncluded?: number;
    transportCost?: number;
    laborCost?: number;
    rounding?: number;
    total: number;
    /** Paid against this invoice; the payments' sum when left out. */
    amountPaid?: number;
    /**
     * What the customer owed before this invoice. With it the totals close on
     * the invoice's own due, this previous due and the total due — the two
     * added together. Left out for a walk-in, who owes nothing on account.
     */
    previousDue?: number | null;
    note?: string;
}

function esc(str: string): string {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

const THANK_YOU = 'Thank you for your business!';

/** The member's padding choice, vertical then horizontal. */
const BODY_PADDING: Record<InvoicePadding, string> = {
    narrow: '2mm 1mm',
    normal: '6mm 4mm',
    wide: '12mm 8mm',
};

function buildStyles(isThermal: boolean, layout: InvoicePrintPrefs): string {
    return `
        body { font-family: ${isThermal ? "'Courier New', Courier, monospace" : 'Arial, Helvetica, sans-serif'}; }

        /* Breathing room around the content. Stated here rather than on @page
           so it adds to the page margin instead of replacing it — a roll gets
           none, where padding would only waste paper. */
        .invoice-body { ${isThermal ? 'padding:0;' : `padding:${BODY_PADDING[layout.padding]};`} }

        /* Meta grid */
        .meta-grid { ${isThermal ? 'margin:4px 0;' : 'display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;'} }
        .meta-block { ${isThermal ? 'margin:3px 0;' : 'background:#f8fafc; border-radius:8px; padding:12px 16px;'} }
        .meta-block h3 { font-size:${isThermal ? '10px' : '11px'}; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${isThermal ? '#444' : '#6b7280'}; margin-bottom:5px; }
        .meta-block p  { font-size:${isThermal ? '10px' : '13px'}; color:#222; margin-bottom:2px; }

        /* Divider */
        .divider { border:none; border-top:1px ${isThermal ? 'dashed #000' : 'solid #e5e7eb'}; margin:${isThermal ? '6px 0' : '0 0 20px 0'}; }

        /* Items table */
        .items-table { width:100%; border-collapse:collapse; margin-bottom:${isThermal ? '6px' : '20px'}; }
        .items-table thead th {
            font-size:${isThermal ? '9px' : '11px'}; font-weight:bold; text-transform:uppercase;
            letter-spacing:0.5px; color:${isThermal ? '#000' : '#6b7280'};
            border-bottom:${isThermal ? '1px solid #000' : '2px solid #e5e7eb'};
            padding:${isThermal ? '3px 0' : '8px 10px'}; text-align:left;
        }
        /* Each header follows the alignment of its own column. A number pushed
           to one edge under a label sitting at the other reads as two unrelated
           columns, which is what made the table look misaligned — the fix is
           matching alignment, not rules drawn between the columns. */
        .items-table thead th.item-qty   { text-align:center; }
        .items-table thead th.item-price { text-align:right; }
        .items-table thead th.item-disc  { text-align:right; }
        .items-table thead th.item-total { text-align:right; }
        .items-table tbody td {
            padding:${isThermal ? '2px 0' : '7px 10px'};
            vertical-align:top;
            border-bottom:1px solid ${isThermal ? 'transparent' : '#f3f4f6'};
            font-size:${isThermal ? '10px' : '13px'};
        }
        .item-name  { width:${isThermal ? '40%' : '36%'}; }
        .item-qty   { width:${isThermal ? '10%' : '8%'}; text-align:center; }
        .item-price { width:${isThermal ? '18%' : '16%'}; text-align:right; }
        .item-disc  { width:${isThermal ? '15%' : '18%'}; text-align:right; color:#ef4444; }
        /* The em-dash means "no discount". In red it reads as a deducted
           amount, so the placeholder takes the body colour and only a real
           discount stays marked. */
        .item-disc--empty { color:inherit; }
        .item-total { width:${isThermal ? '17%' : '18%'}; text-align:right; font-weight:bold; }
        .sku        { font-size:9px; color:#888; }
        .item-sl    { width:${isThermal ? '8%' : '6%'}; text-align:center; color:#6b7280; }
        .items-table thead th.item-sl { text-align:center; }
        ${isThermal ? '' : tableStyles()}

        /* Totals */
        .totals-wrap { ${isThermal ? '' : 'display:flex; justify-content:flex-end; margin-bottom:20px;'} }
        .totals-table { width:${isThermal ? '100%' : '300px'}; border-collapse:collapse; }
        .totals-table td { padding:${isThermal ? '2px 0' : '5px 10px'}; font-size:${isThermal ? '10px' : '13px'}; }
        .totals-table td:last-child { text-align:right; font-weight:bold; }
        .totals-table .neg td:last-child { color:#ef4444; }
        /* The total carries its weight through size and boldness rather than an
           accent colour — on paper a lone blue row reads as decoration, and the
           rule above it matches the document's other dividers. */
        .grand-total td {
            font-size:${isThermal ? '13px' : '15px'}; font-weight:bold;
            border-top:2px solid ${isThermal ? '#000' : '#e5e7eb'};
            padding-top:${isThermal ? '4px' : '8px'};
            color:${isThermal ? '#000' : '#111827'};
        }
        /* What the customer owes once this invoice stands — the figure a credit
           customer reads first, so it is ruled off like the total above. */
        .total-due td {
            font-weight:bold;
            border-top:1px solid ${isThermal ? '#000' : '#e5e7eb'};
            color:${isThermal ? '#000' : '#111827'};
        }

        /* Payments */
        .payments-section { ${isThermal ? 'margin:6px 0;' : 'background:#f8fafc; border-radius:8px; padding:12px 16px; margin-bottom:20px;'} }
        .payments-section h3 { font-size:${isThermal ? '10px' : '11px'}; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${isThermal ? '#444' : '#6b7280'}; margin-bottom:5px; }
        .payments-table { width:100%; border-collapse:collapse; }
        .pay-label  { font-size:${isThermal ? '10px' : '13px'}; color:#444; padding:${isThermal ? '2px 0' : '3px 0'}; }
        .pay-ref    { font-size:${isThermal ? '9px' : '11px'}; color:#777; }
        .pay-amount { text-align:right; font-weight:bold; font-size:${isThermal ? '10px' : '13px'}; padding:${isThermal ? '2px 0' : '3px 0'}; }

        /* Note */
        .note-box {
            font-size:${isThermal ? '10px' : '12px'}; color:#555;
            ${isThermal
                ? 'border:1px dashed #aaa; padding:4px 6px; margin:6px 0;'
                : 'background:#fef9c3; border:1px solid #fde68a; border-radius:6px; padding:10px 14px; margin-bottom:20px;'}
        }

        /* The total spelled out, so the figure cannot be misread or altered. */
        .amount-words { font-size:${isThermal ? '10px' : '12px'}; color:#374151; margin:${isThermal ? '4px 0' : '0 0 20px 0'}; }

        /* Two ruled lines to sign on, pushed apart to either edge. */
        .signatures { display:flex; justify-content:space-between; gap:40px; margin-top:48px; }
        .signature { flex:0 0 40%; border-top:1px solid #6b7280; padding-top:4px; text-align:center; font-size:11px; color:#374151; }

        /* The member's own closing text, kept inside the body so it prints
           even under a letterhead whose footer band replaces the default. */
        .invoice-note { text-align:center; white-space:pre-line; font-size:${isThermal ? '10px' : '12px'}; color:#555; margin-top:${isThermal ? '10px' : '24px'}; }

        .footer { text-align:center; font-size:${isThermal ? '10px' : '12px'}; color:#888; margin-top:${isThermal ? '10px' : '24px'}; ${isThermal ? '' : 'border-top:1px solid #e5e7eb; padding-top:14px;'} }
        ${isThermal ? '' : compactStyles()}
        ${isThermal || layout.layout !== 'detailed' ? '' : detailedStyles()}
    `;
}

/**
 * The item table's optional looks. Every one is keyed on its own modifier
 * class, so the default table carries none and prints exactly as it did.
 * Sheet paper only: on a roll a grey fill prints as dither.
 */
function tableStyles(): string {
    return `
        .items-table--striped tbody tr:nth-child(even) td { background:#f3f4f6; }
        .items-table--grid { border:1px solid #d1d5db; }
        .items-table--grid thead th, .items-table--grid tbody td { border:1px solid #d1d5db; }
        .items-table--shaded-header thead th { background:#f3f4f6; color:#111827; border-bottom:1px solid #d1d5db; }`;
}

/**
 * The compact invoice: as many item rows on a sheet as stay comfortable to
 * read. Cells, gaps and type all tighten, and the SKU moves up beside the item
 * name — on its own line it doubles the height of every row that has one.
 *
 * Inert until `html.p71-compact` is set, and never emitted for a roll, which
 * does not compact (see `PrintDensity`).
 */
function compactStyles(): string {
    const c = COMPACT_SCOPE;
    return `
        ${c} .invoice-body { padding:1mm 0; }
        ${c} .meta-grid { gap:8px; margin-bottom:8px; }
        ${c} .meta-block { padding:5px 10px; border-radius:6px; }
        ${c} .meta-block h3 { font-size:10px; margin-bottom:2px; }
        ${c} .meta-block p { font-size:11px; margin-bottom:0; }
        ${c} .divider { margin:0 0 6px 0; }
        ${c} .items-table { margin-bottom:6px; }
        ${c} .items-table thead th { font-size:10px; padding:3px 6px; }
        ${c} .items-table tbody td { font-size:11px; padding:2px 6px; }
        ${c} .item-name br, ${c} .pay-label br { display:none; }
        ${c} .item-name .sku, ${c} .pay-label .pay-ref { margin-left:6px; }
        ${c} .totals-wrap { margin-bottom:6px; }
        ${c} .totals-table td { font-size:11px; padding:1px 6px; }
        ${c} .grand-total td { font-size:13px; padding-top:3px; }
        ${c} .payments-section { padding:5px 10px; margin-bottom:6px; border-radius:6px; }
        ${c} .payments-section h3 { font-size:10px; margin-bottom:2px; }
        ${c} .pay-label, ${c} .pay-amount { font-size:11px; padding:1px 0; }
        ${c} .pay-ref { font-size:10px; }
        ${c} .note-box { font-size:11px; padding:5px 8px; margin-bottom:6px; }
        ${c} .amount-words { font-size:11px; margin-bottom:6px; }
        ${c} .signatures { margin-top:28px; }
        ${c} .invoice-note { font-size:10px; margin-top:8px; }
        ${c} .footer { font-size:10px; margin-top:8px; padding-top:6px; }`;
}

/**
 * What the customer owed going in and owes now, or null when there is no
 * account behind the invoice (or nothing is owed either way and the member did
 * not ask to always see the balance). Shared by both layouts.
 */
function resolveDues(data: InvoiceData, layout: InvoicePrintPrefs): InvoiceDues | null {
    const paid = data.amountPaid ?? data.payments.reduce((sum, p) => sum + p.amount, 0);
    let dues: InvoiceDues | null = invoiceDues(data.total, paid, data.previousDue);

    // Null with an account behind it means nothing is owed either way.
    if (!dues && layout.balance === 'always' && data.previousDue != null && Number.isFinite(data.previousDue)) {
        dues = { paid, invoiceDue: 0, previousDue: data.previousDue, totalDue: data.previousDue };
    }
    return dues;
}

/**
 * The memo's closing lines under the total: paid, this invoice's due, what the
 * customer owed before it, and the total due.
 *
 * Which of them print is the member's `balance` choice. By default
 * (`when-owed`) they print only for a customer who owes something either way,
 * so a settled invoice looks as it always has. `always` shows the running
 * balance even at zero; `never` keeps it off the paper but still says what this
 * invoice leaves unpaid. A walk-in has no account, so prints none of it.
 */
function buildDueRows(data: InvoiceData, layout: InvoicePrintPrefs): string {
    const dues = resolveDues(data, layout);
    if (!dues) return '';

    const owesOnThisInvoice = dues.invoiceDue > 0.005;
    const dueRow = owesOnThisInvoice ? `<tr><td>Due</td><td>${formatBDT(dues.invoiceDue)}</td></tr>` : '';

    if (layout.balance === 'never') {
        return owesOnThisInvoice
            ? `
            <tr><td>Paid</td><td>${formatBDT(dues.paid)}</td></tr>
            ${dueRow}`
            : '';
    }

    return `
            <tr><td>Paid</td><td>${formatBDT(dues.paid)}</td></tr>
            ${dueRow}
            <tr><td>Previous Due</td><td>${formatBDT(dues.previousDue)}</td></tr>
            <tr class="total-due"><td>Total Due</td><td>${formatBDT(dues.totalDue)}</td></tr>`;
}

/**
 * The member's closing text, or nothing. `null` is the built-in thank-you,
 * which stays in the document footer where it always printed (and where a
 * designed letterhead footer still replaces it); anything the member wrote
 * prints in the body instead, so it is never hidden by a letterhead.
 */
function memberNoteHtml(layout: InvoicePrintPrefs): string {
    return layout.footer_text ? `<div class="invoice-note">${esc(layout.footer_text)}</div>` : '';
}

function buildBody(data: InvoiceData, isThermal: boolean, layout: InvoicePrintPrefs): string {
    const serial = layout.serial_column;
    const showDiscount = !layout.hide_empty_discount || data.items.some((item) => !!item.discount);
    const tableClass =
        isThermal || layout.table_style === 'minimal'
            ? 'items-table'
            : `items-table items-table--${layout.table_style}`;

    const itemRows = data.items.map((item, index) => {
        const lineTotal = item.quantity * item.unitPrice - (item.discount ?? 0);
        return `<tr>
            ${serial ? `<td class="item-sl">${index + 1}</td>` : ''}
            <td class="item-name">${esc(item.name)}${item.sku ? `<br><span class="sku">${esc(item.sku)}</span>` : ''}</td>
            <td class="item-qty">${item.quantity}</td>
            <td class="item-price">${formatBDT(item.unitPrice)}</td>
            ${showDiscount ? `<td class="${item.discount ? 'item-disc' : 'item-disc item-disc--empty'}">${item.discount ? formatBDT(item.discount) : '—'}</td>` : ''}
            <td class="item-total">${formatBDT(lineTotal)}</td>
        </tr>`;
    }).join('');

    const paymentRows = data.payments.map((p) =>
        `<tr><td class="pay-label">${esc(paymentMethodLabel(p.method))}${
            p.reference ? `<br><span class="pay-ref">${esc(p.reference)}</span>` : ''
        }</td><td class="pay-amount">${formatBDT(p.amount)}</td></tr>`
    ).join('');

    return `
    <div class="invoice-body">
    <div class="meta-grid">
        ${data.customerName ? `
        <div class="meta-block">
            <h3>Bill To</h3>
            <p>${esc(data.customerName)}</p>
            ${data.customerPhone ? `<p>${esc(data.customerPhone)}</p>` : ''}
            ${data.customerAddress ? `<p>${esc(data.customerAddress)}</p>` : ''}
        </div>` : ''}
        ${!isThermal ? `
        <div class="meta-block">
            <h3>Invoice Details</h3>
            <p>Invoice #: <strong>${esc(data.referenceNumber)}</strong></p>
            <p>Date: ${esc(data.date)}</p>
        </div>` : ''}
    </div>

    <hr class="divider">

    <table class="${tableClass}">
        <thead>
            <tr>
                ${serial ? '<th class="item-sl">SL</th>' : ''}
                <th class="item-name">Item</th>
                <th class="item-qty">Qty</th>
                <th class="item-price">Unit Price</th>
                ${showDiscount ? '<th class="item-disc">Discount</th>' : ''}
                <th class="item-total">Total</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
    </table>

    <hr class="divider">

    <div class="totals-wrap">
        <table class="totals-table">
            <tr><td>Subtotal</td><td>${formatBDT(data.subtotal)}</td></tr>
            ${data.discountAmount ? `<tr class="neg"><td>Discount${data.discountPercent ? ` (${data.discountPercent}%)` : ''}</td><td>-${formatBDT(data.discountAmount)}</td></tr>` : ''}
            ${data.vat ? `<tr><td>VAT</td><td>${formatBDT(data.vat)}</td></tr>` : ''}
            ${data.transportCost ? `<tr><td>Transport</td><td>${formatBDT(data.transportCost)}</td></tr>` : ''}
            ${data.laborCost ? `<tr><td>Labour</td><td>${formatBDT(data.laborCost)}</td></tr>` : ''}
            ${data.rounding ? `<tr><td>Rounding</td><td>${formatBDT(data.rounding)}</td></tr>` : ''}
            <tr class="grand-total"><td>TOTAL</td><td>${formatBDT(data.total)}</td></tr>
            ${buildDueRows(data, layout)}
        </table>
    </div>
    ${layout.amount_in_words ? `<p class="amount-words"><strong>In words:</strong> ${takaInWords(data.total)}</p>` : ''}

    <hr class="divider">

    <div class="payments-section">
        <h3>Payment</h3>
        <table class="payments-table">${paymentRows}</table>
    </div>

    ${data.note ? `<div class="note-box"><strong>Note:</strong> ${esc(data.note)}</div>` : ''}
    ${layout.signature_lines && !isThermal ? `
    <div class="signatures">
        <div class="signature">Customer's Signature</div>
        <div class="signature">Authorised Signature</div>
    </div>` : ''}
    ${memberNoteHtml(layout)}
    </div>`;
}

/**
 * One invoice's header, body and footer — the parts a single print and a batch
 * both lay out, so an invoice cannot print one way alone and another in a
 * batch.
 */
function invoiceSheet(
    data: InvoiceData,
    paperSize: PaperSize,
    layout: InvoicePrintPrefs,
    printedAt: string,
): PrintSheet {
    const thermal = isThermalPaper(paperSize);
    const detailed = !thermal && layout.layout === 'detailed';
    const stamp = data.printedAt ?? printedAt;
    const context: HeaderContext = {
        docTitle: 'Invoice',
        docNumber: data.referenceNumber,
        docDate: data.date,
        companyName: data.companyName || 'RETAIL STORE',
        storeName: data.storeName,
        address: data.companyAddress,
        phone: data.companyPhone,
        preparedBy: data.preparedBy,
        printDate: stamp,
    };

    if (detailed) {
        const paid = data.amountPaid ?? data.payments.reduce((sum, p) => sum + p.amount, 0);
        return {
            context,
            headerConfig: data.headerConfig,
            headerHtml: renderHeaderHtml(withInvoiceQr(data.headerConfig, data.qrDataUrl), context, paperSize),
            bodyHtml: detailedBodyHtml(data, layout, paid, resolveDues(data, layout)),
            // The member's own closing text takes the thank-you's place; an
            // empty one leaves the left of the foot blank.
            footerHtml: detailedFooterHtml(data, layout.footer_text ?? THANK_YOU, stamp),
        };
    }

    return {
        context,
        headerConfig: data.headerConfig,
        headerHtml: renderHeaderHtml(data.headerConfig, context, paperSize),
        bodyHtml: buildBody(data, thermal, layout),
        footerHtml: layout.footer_text === null ? `<div class="footer">${THANK_YOU}</div>` : '',
    };
}

/**
 * @param layout The printing member's own layout choices (see
 *   `useInvoicePrintPrefs`); the built-in layout when omitted.
 */
export function printSalesInvoice(
    data: InvoiceData,
    paperSize: PaperSize = 'A4',
    preview?: PrintPreviewOptions,
    layout: InvoicePrintPrefs = DEFAULT_INVOICE_PRINT_PREFS,
): void {
    const isThermal = isThermalPaper(paperSize);

    openPrintWindow({
        ...invoiceSheet(data, paperSize, layout, formatPrintStamp()),
        title: `Invoice ${data.referenceNumber}`,
        paperSize,
        styles: buildStyles(isThermal, layout),
        // Long item lists spill onto page 2 — keep the letterhead on every page.
        repeatHeader: !isThermal,
        pinFooter: !isThermal && layout.layout === 'detailed',
        // A long item list is exactly what compact is for.
        compactable: true,
        preview,
    });
}

/**
 * Every selected invoice in one print job, each starting on its own page with
 * its own letterhead — a batch can span branches. Null when there was nothing
 * to print or the browser blocked the window.
 */
export function printSalesInvoices(
    invoices: InvoiceData[],
    paperSize: PaperSize = 'A4',
    preview?: PrintPreviewOptions,
    layout: InvoicePrintPrefs = DEFAULT_INVOICE_PRINT_PREFS,
): Window | null {
    if (invoices.length === 0) return null;
    const isThermal = isThermalPaper(paperSize);

    const printedAt = formatPrintStamp();

    return openPrintWindow({
        sheets: invoices.map((data) => invoiceSheet(data, paperSize, layout, printedAt)),
        title: `Invoices (${invoices.length}) — ${paperSizeLabel(paperSize)}`,
        paperSize,
        // The template's CSS is global, so a job carries one: the first
        // invoice's. Each sheet's own letterhead content still prints.
        headerConfig: invoices[0].headerConfig,
        styles: buildStyles(isThermal, layout),
        repeatHeader: !isThermal,
        pinFooter: !isThermal && layout.layout === 'detailed',
        compactable: true,
        preview,
    });
}
