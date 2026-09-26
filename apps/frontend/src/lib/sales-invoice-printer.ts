import { formatBDT } from './format';
import { invoiceDues } from './customer-credit';
import { paymentMethodLabel } from './payment-method-label';
import { COMPACT_SCOPE, openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, HeaderContext, PaperSize, PrintHeaderConfig, PrintPreviewOptions } from './print';

export { PAPER_SIZES, paperSizeLabel } from './print';
export type { PaperSize } from './print';

export interface InvoiceItem {
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    discount?: number; // discount amount for this line
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
    companyAddress?: string;
    companyPhone?: string;
    /** Tenant header design; falls back to the built-in default when omitted. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    items: InvoiceItem[];
    payments: InvoicePayment[];
    subtotal: number;
    discountAmount?: number;
    discountPercent?: number;
    vat?: number;
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

function buildStyles(isThermal: boolean): string {
    return `
        body { font-family: ${isThermal ? "'Courier New', Courier, monospace" : 'Arial, Helvetica, sans-serif'}; }

        /* Breathing room around the content. Stated here rather than on @page
           so it adds to the page margin instead of replacing it — a roll gets
           none, where padding would only waste paper. */
        .invoice-body { ${isThermal ? 'padding:0;' : 'padding:6mm 4mm;'} }

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

        .footer { text-align:center; font-size:${isThermal ? '10px' : '12px'}; color:#888; margin-top:${isThermal ? '10px' : '24px'}; ${isThermal ? '' : 'border-top:1px solid #e5e7eb; padding-top:14px;'} }
        ${isThermal ? '' : compactStyles()}
    `;
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
        ${c} .footer { font-size:10px; margin-top:8px; padding-top:6px; }`;
}

/**
 * The memo's closing lines under the total: paid, this invoice's due, what the
 * customer owed before it, and the total due. Printed only for a customer who
 * owes something either way, so a settled invoice looks as it always has.
 */
function buildDueRows(data: InvoiceData): string {
    const paid = data.amountPaid ?? data.payments.reduce((sum, p) => sum + p.amount, 0);
    const dues = invoiceDues(data.total, paid, data.previousDue);
    if (!dues) return '';

    return `
            <tr><td>Paid</td><td>${formatBDT(dues.paid)}</td></tr>
            ${dues.invoiceDue > 0.005 ? `<tr><td>Due</td><td>${formatBDT(dues.invoiceDue)}</td></tr>` : ''}
            <tr><td>Previous Due</td><td>${formatBDT(dues.previousDue)}</td></tr>
            <tr class="total-due"><td>Total Due</td><td>${formatBDT(dues.totalDue)}</td></tr>`;
}

function buildBody(data: InvoiceData, isThermal: boolean): string {
    const itemRows = data.items.map((item) => {
        const lineTotal = item.quantity * item.unitPrice - (item.discount ?? 0);
        return `<tr>
            <td class="item-name">${esc(item.name)}${item.sku ? `<br><span class="sku">${esc(item.sku)}</span>` : ''}</td>
            <td class="item-qty">${item.quantity}</td>
            <td class="item-price">${formatBDT(item.unitPrice)}</td>
            <td class="${item.discount ? 'item-disc' : 'item-disc item-disc--empty'}">${item.discount ? formatBDT(item.discount) : '—'}</td>
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

    <table class="items-table">
        <thead>
            <tr>
                <th class="item-name">Item</th>
                <th class="item-qty">Qty</th>
                <th class="item-price">Unit Price</th>
                <th class="item-disc">Discount</th>
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
            ${buildDueRows(data)}
        </table>
    </div>

    <hr class="divider">

    <div class="payments-section">
        <h3>Payment</h3>
        <table class="payments-table">${paymentRows}</table>
    </div>

    ${data.note ? `<div class="note-box"><strong>Note:</strong> ${esc(data.note)}</div>` : ''}
    </div>`;
}

export function printSalesInvoice(
    data: InvoiceData,
    paperSize: PaperSize = 'A4',
    preview?: PrintPreviewOptions,
): void {
    const isThermal = paperSize === 'Thermal80' || paperSize === 'Thermal58';

    const headerContext: HeaderContext = {
        docTitle: 'Invoice',
        docNumber: data.referenceNumber,
        docDate: data.date,
        companyName: data.companyName || 'RETAIL STORE',
        address: data.companyAddress,
        phone: data.companyPhone,
    };
    const headerHtml = renderHeaderHtml(data.headerConfig, headerContext, paperSize);

    openPrintWindow({
        context: headerContext,
        title: `Invoice ${data.referenceNumber}`,
        paperSize,
        headerConfig: data.headerConfig,
        headerHtml,
        bodyHtml: buildBody(data, isThermal),
        footerHtml: '<div class="footer">Thank you for your business!</div>',
        styles: buildStyles(isThermal),
        // Long item lists spill onto page 2 — keep the letterhead on every page.
        repeatHeader: !isThermal,
        // A long item list is exactly what compact is for.
        compactable: true,
        preview,
    });
}
