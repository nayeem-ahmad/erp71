import type { InvoicePrintPrefs } from '@erp71/shared-types';
import { takaInWords } from './amount-in-words';
import type { InvoiceDues } from './customer-credit';
import { formatBDT, getActiveTimeZone } from './format';
import { paymentMethodLabel } from './payment-method-label';
import { COMPACT_SCOPE, escapeHtml as esc } from './print';
import type { InvoiceData } from './sales-invoice-printer';

/**
 * The detailed invoice: the full trade layout a business hands a trade
 * customer — a labelled invoice / order / date strip, bill-to beside the
 * payment status, a warranty column, tax and discount broken out beside the
 * totals, and a footer that says who prepared it and when it was printed.
 *
 * Sheet paper only. It shares everything around the body with the standard
 * invoice — the letterhead, the footer pinning, density, the batch job — so
 * `sales-invoice-printer.ts` only swaps the body, the stylesheet and the footer.
 *
 * The figures are the standard invoice's own, never re-derived: this file only
 * decides where each one is written. In particular the tax is *read* from the
 * sale (see `InvoiceData.taxIncluded`), never recomputed from a rate.
 */

/** Plain number for a cell whose column header already says ৳. */
function amount(value: number): string {
    return formatBDT(value).replace(/^\S+\s*/, '');
}

const toPaisa = (value: number) => Math.round(value * 100) / 100;

/** What this invoice's payment status reads: Paid, Partial or Due. */
export function paymentStatus(total: number, paid: number): 'Paid' | 'Partial' | 'Due' {
    if (toPaisa(total - paid) <= 0.005) return 'Paid';
    return paid > 0.005 ? 'Partial' : 'Due';
}

/**
 * "06-10-2026 1:02:59 PM" — the moment of printing, in the workspace's zone so
 * the stamp agrees with the dates elsewhere in the app.
 */
export function formatPrintStamp(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: getActiveTimeZone(),
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod').toUpperCase()}`;
}

/** One labelled row of the totals blocks. */
function row(label: string, value: string, className = ''): string {
    return `<tr${className ? ` class="${className}"` : ''}><td>${label}</td><td>${value}</td></tr>`;
}

/**
 * The block on the right: the invoice's own money, top to bottom.
 *
 * A sale already posted keeps its prices tax-inclusive. When it carries tax,
 * the sub total is the total *less* the stored tax, and a discount — already
 * deducted from that total — is listed as information rather than subtracted
 * twice. When it carries none there is nothing to back out, so the block reads
 * sub total, discount, total, and foots as it stands. An invoice built on the
 * entry screen still has its tax and discount to add and take off.
 */
function invoiceTotalsRows(data: InvoiceData, paid: number): string {
    const inclusive = data.taxIncluded !== undefined;
    const tax = inclusive ? data.taxIncluded! : (data.vat ?? 0);
    const hasTax = tax > 0.005;
    const rows: string[] = [];

    if (inclusive && hasTax) {
        rows.push(row('Sub Total (excl. tax) (৳):', amount(data.total - tax)));
        rows.push(row('Total Tax (৳):', amount(tax)));

        // The lines add up to more than the total: the difference is the
        // reduction taken off the invoice. Less, and it was added to it.
        const gap = toPaisa(data.subtotal - data.total);
        if (gap > 0.005) rows.push(row('Discount, already deducted (৳):', amount(gap), 'memo'));
        else if (gap < -0.005) rows.push(row('Adjustment, included (৳):', amount(-gap), 'memo'));
    } else if (inclusive) {
        // No tax inside the total, so nothing needs backing out: the sub total
        // is the lines themselves — what the column above adds up to — and the
        // reduction is taken off it, so the block foots on its face.
        rows.push(row('Sub Total (৳):', amount(data.subtotal)));
        const gap = toPaisa(data.subtotal - data.total);
        if (gap > 0.005) rows.push(row('Discount (৳):', `-${amount(gap)}`, 'neg'));
        else if (gap < -0.005) rows.push(row('Adjustment (৳):', amount(-gap)));
    } else {
        rows.push(row('Sub Total (৳):', amount(data.subtotal)));
        if (hasTax) rows.push(row('Total Tax (৳):', amount(tax)));
        if (data.discountAmount) {
            rows.push(row(
                `Discount${data.discountPercent ? ` (${data.discountPercent}%)` : ''} (৳):`,
                `-${amount(data.discountAmount)}`,
                'neg',
            ));
        }
        if (data.transportCost) rows.push(row('Transport (৳):', amount(data.transportCost)));
        if (data.laborCost) rows.push(row('Labour (৳):', amount(data.laborCost)));
        if (data.rounding) rows.push(row('Rounding (৳):', amount(data.rounding)));
    }

    rows.push(row('Total (৳):', amount(data.total), 'rule'));
    rows.push(row('Paid (৳):', amount(paid)));
    rows.push(row('Due (৳):', amount(Math.max(0, toPaisa(data.total - paid))), 'rule'));
    return rows.join('');
}

/**
 * The block on the left: what the customer owed going in and what they owe now.
 * Absent for a walk-in, who has no account, and when the member keeps the
 * running balance off the paper.
 */
function accountRows(data: InvoiceData, dues: InvoiceDues): string {
    // A negative balance is credit the customer holds with the shop, which the
    // sale draws down — "Previous Due: -11,220" reads like an error.
    const advance = dues.previousDue < -0.005;
    const settled = dues.totalDue < -0.005;
    return [
        row(advance ? 'Advance Balance (৳)' : 'Previous Due (৳)', amount(dues.previousDue)),
        row('Sale Amount (৳)', amount(data.total)),
        row('Collected Amount (৳)', amount(dues.paid)),
        // Still in credit after this sale: say so rather than print a negative due.
        row(settled ? 'Advance Remaining (৳)' : 'Total Due (৳)', amount(settled ? -dues.totalDue : dues.totalDue), 'rule'),
    ].join('');
}

/**
 * Invoice no, order no and date on one ruled strip.
 *
 * Returned apart from the body so it can ride in the repeating letterhead:
 * every continuation page of a long invoice then says which invoice it
 * belongs to, and page one reads exactly as the strip under the letterhead.
 */
export function detailedStripHtml(data: InvoiceData): string {
    return `<div class="d-strip">
        <div><strong>Invoice No:</strong> ${esc(data.referenceNumber)}</div>
        <div><strong>Order No:</strong> ${data.orderNumber ? esc(data.orderNumber) : ''}</div>
        <div><strong>Invoice Date:</strong> ${esc(data.date)}</div>
    </div>`;
}

/**
 * The invoice in two parts. `body` is the parties and the item table, which
 * runs over as many pages as the items need; `end` is the totals, note and
 * signatures, which stay together and — see `PrintSheet.endHtml` — travel with
 * the page-bottom footer.
 */
export function detailedBodyHtml(
    data: InvoiceData,
    layout: InvoicePrintPrefs,
    paid: number,
    dues: InvoiceDues | null,
): { body: string; end: string } {
    const showDiscount = data.items.some((item) => !!item.discount);
    const showWarranty = !layout.hide_empty_warranty || data.items.some((item) => !!item.warranty);
    const qr = data.qrDataUrl && /^data:image\//i.test(data.qrDataUrl) ? data.qrDataUrl : '';

    const itemRows = data.items.map((item, index) => {
        const lineTotal = item.quantity * item.unitPrice - (item.discount ?? 0);
        return `<tr>
            <td class="d-sl">${index + 1}</td>
            <td class="d-item">${esc(item.name)}</td>
            ${showWarranty ? `<td class="d-warranty">${item.warranty ? esc(item.warranty) : ''}</td>` : ''}
            <td class="d-num">${item.quantity}</td>
            <td class="d-num">${amount(item.unitPrice)}</td>
            ${showDiscount ? `<td class="d-num">${item.discount ? amount(item.discount) : ''}</td>` : ''}
            <td class="d-num">${amount(lineTotal)}</td>
        </tr>`;
    }).join('');

    const payments = data.payments.length > 0
        ? `<p class="d-paid-by">Paid by: ${data.payments.map((p) =>
            `${esc(paymentMethodLabel(p.method))} ${amount(p.amount)}${p.reference ? ` (${esc(p.reference)})` : ''}`,
        ).join(' · ')}</p>`
        : '';

    const body = `
    <div class="invoice-body inv-d inv-d--top">
    <div class="d-parties${qr ? ' d-parties--qr' : ''}">
        <div class="d-party">
            <h3>Bill To</h3>
            <div class="d-kv"><span>Name:</span><span>${data.customerName ? esc(data.customerName) : 'Walk-in Customer'}</span></div>
            ${data.customerPhone ? `<div class="d-kv"><span>Phone No:</span><span>${esc(data.customerPhone)}</span></div>` : ''}
        </div>
        <div class="d-party">
            <h3>Shipping Address</h3>
            ${data.shippingAddress ? `<p class="d-addr">${esc(data.shippingAddress)}</p>` : ''}
            <div class="d-kv"><span>Payment Status:</span><span>${paymentStatus(data.total, paid)}</span></div>
        </div>
        ${qr ? `<div class="d-qr"><img src="${esc(qr)}" alt="Invoice QR code"></div>` : ''}
    </div>

    <table class="d-table">
        <thead>
            <tr>
                <th class="d-sl">SL</th>
                <th class="d-item">Item</th>
                ${showWarranty ? '<th class="d-warranty">Warranty</th>' : ''}
                <th class="d-num">Quantity</th>
                <th class="d-num">Unit Price (৳)</th>
                ${showDiscount ? '<th class="d-num">Discount (৳)</th>' : ''}
                <th class="d-num">Total (৳)</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
    </table>
    </div>`;

    const end = `
    <div class="invoice-body inv-d inv-d--end">
    <div class="d-sums">
        <div class="d-left">
            ${layout.amount_in_words ? `<p class="d-words"><strong>In Word:</strong> ${takaInWords(data.total)}</p>` : ''}
            ${dues && layout.balance !== 'never' ? `<table class="d-block">${accountRows(data, dues)}</table>` : ''}
            ${payments}
        </div>
        <div class="d-right">
            <table class="d-block">${invoiceTotalsRows(data, paid)}</table>
        </div>
    </div>

    ${data.note ? `<div class="note-box"><strong>Note:</strong> ${esc(data.note)}</div>` : ''}
    ${layout.signature_lines ? `
    <div class="signatures">
        <div class="signature">Customer's Signature</div>
        <div class="signature">Authorised Signature</div>
    </div>` : ''}
    </div>`;

    return { body, end };
}

/**
 * The foot of the page: the thank-you at the left, who prepared the invoice and
 * when it was printed at the right. A letterhead footer the tenant designed
 * replaces it, as it replaces every printer's own — `{{prepared_by}}` and
 * `{{print_date}}` let that footer say the same.
 */
export function detailedFooterHtml(
    data: InvoiceData,
    thankYou: string,
    printedAt: string,
): string {
    return `<div class="p71-doc-ft d-foot">
        <div class="d-foot-l">${esc(thankYou)}</div>
        <div class="d-foot-r">
            <div>Prepared By- ${data.preparedBy ? esc(data.preparedBy) : ''}</div>
            <div>Print Date: ${esc(printedAt)}</div>
        </div>
    </div>`;
}

/** Horizontal inset of the invoice body per padding choice, in mm — the strip, which rides in the letterhead, lines up with it. */
const BODY_INSET_MM: Record<InvoicePrintPrefs['padding'], number> = { narrow: 1, normal: 4, wide: 8 };

export function detailedStyles(layout: InvoicePrintPrefs): string {
    const c = COMPACT_SCOPE;
    const inset = BODY_INSET_MM[layout.padding];
    return `
        /* Detailed invoice */
        .inv-d { font-size:13px; color:#111; }
        /* The body and the closing block are two blocks of one invoice: the
           padding between them is the body's own, not doubled. */
        .inv-d--top { padding-bottom:0; }
        .inv-d--end { padding-top:0; }
        .inv-d h3 { font-size:14px; font-weight:bold; margin-bottom:4px; }

        /* Invoice no / order no / date on one ruled strip. */
        .d-strip {
            margin:10px ${inset}mm 0;
            display:flex; justify-content:space-between; gap:12px;
            border-top:3px solid #d1d5db; border-bottom:3px solid #d1d5db;
            padding:7px 6px; margin-bottom:16px; font-size:14px; color:#111;
        }
        .d-strip strong { margin-right:8px; }

        .d-parties { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:16px; padding:0 6px; }
        .d-parties--qr { grid-template-columns:1fr 1fr auto; }
        .d-qr img { display:block; width:19mm; height:19mm; }
        .d-kv { display:flex; gap:24px; margin-bottom:2px; }
        .d-kv span:first-child { min-width:92px; }
        .d-addr { margin-bottom:4px; }
        .d-party:last-child .d-kv span:first-child { min-width:0; margin-right:8px; }

        .d-table { width:100%; border-collapse:collapse; margin-bottom:10px; }
        .d-table th {
            background:#d1d5db; color:#111; font-size:13px; font-weight:bold;
            padding:7px 8px; text-align:left;
        }
        .d-table td { padding:6px 8px; font-size:13px; vertical-align:top; }
        .d-table tbody tr:nth-child(even) td { background:#d1d5db; }
        .d-table tbody tr:last-child td { border-bottom:1px solid #d1d5db; }
        .d-table .d-sl { width:5%; text-align:left; }
        .d-table .d-warranty { width:14%; }
        .d-table th.d-num, .d-table td.d-num { text-align:right; white-space:nowrap; }

        .d-sums { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; padding:0 6px; margin-bottom:16px; }
        .d-left { width:44%; }
        .d-right { width:46%; }
        .d-words { margin-bottom:10px; font-size:13px; }
        .d-block { width:100%; border-collapse:collapse; }
        .d-block td { padding:3px 0; font-size:13px; }
        .d-block td:last-child { text-align:right; white-space:nowrap; }
        .d-right .d-block td:first-child { text-align:right; padding-right:14px; }
        .d-block .rule td { border-top:1.5px solid #111; padding-top:4px; }
        .d-block .neg td:last-child { color:#ef4444; }
        .d-block .memo td { color:#6b7280; font-style:italic; }
        .d-paid-by { margin-top:8px; font-size:11px; color:#555; }

        /* Where a long invoice breaks. A row, the totals, the signatures and the
           foot each stay whole; the column headings repeat above every page's
           rows (the table's own thead), and the strip repeats with the
           letterhead. */
        .d-table tr, .d-parties, .d-sums, .note-box, .signatures, .d-foot { break-inside:avoid; }

        /* The page foot: thank-you left, preparer and print time right. */
        .d-foot { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; font-size:11px; color:#111; padding-top:8px; }
        .d-foot-r { text-align:left; line-height:1.9; }

        ${c} .d-strip { padding:4px 6px; margin-bottom:8px; font-size:12px; }
        ${c} .d-parties { margin-bottom:8px; gap:12px; }
        ${c} .inv-d, ${c} .d-table td, ${c} .d-table th, ${c} .d-block td { font-size:11px; }
        ${c} .d-table th { padding:3px 6px; }
        ${c} .d-table td { padding:2px 6px; }
        ${c} .d-block td { padding:1px 0; }
        ${c} .d-sums { margin-bottom:8px; }
        ${c} .d-foot { font-size:10px; padding-top:4px; }
        ${c} .d-foot-r { line-height:1.5; }`;
}
