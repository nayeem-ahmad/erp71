import type { InvoicePrintPrefs } from '@erp71/shared-types';
import { takaInWords } from './amount-in-words';
import type { InvoiceDues } from './customer-credit';
import { formatBDT, getActiveTimeZone } from './format';
import { paymentMethodLabel } from './payment-method-label';
import { COMPACT_SCOPE, escapeHtml as esc } from './print';
import type { InvoiceData } from './sales-invoice-printer';

/**
 * The detailed invoice: the full trade layout a business hands a trade
 * customer — one boxed block with the customer on one side and the invoice
 * (number, order, date, who sold and who entered it) on the other, a warranty
 * column, and tax and discount broken out beside the totals.
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
    const newDue = toPaisa(data.total - dues.paid);
    return [
        row(advance ? 'Advance Balance (৳)' : 'Previous Due (৳)', amount(dues.previousDue)),
        // What this invoice leaves unpaid, so the block adds up on its own:
        // previous due + new due = total due. Paid beyond the total, the excess
        // went on the account and is shown as such.
        newDue < -0.005
            ? row('Paid in Excess (৳)', amount(newDue))
            : row('New Due (৳)', amount(newDue)),
        // Still in credit after this sale: say so rather than print a negative due.
        row(settled ? 'Advance Remaining (৳)' : 'Total Due (৳)', amount(settled ? -dues.totalDue : dues.totalDue), 'rule'),
    ].join('');
}

/**
 * The boxed block under the letterhead: who the customer is on the left, with
 * the labels' colons in one column, and the invoice on the right — its number,
 * order and date, the employee it is credited to and who entered it.
 *
 * A line with nothing to say is left out rather than printed blank, so a
 * walk-in's box is their name and the invoice's own lines.
 */
function infoBoxHtml(data: InvoiceData): string {
    const customer: [string, string | undefined][] = [
        ['Customer ID', data.customerCode],
        ['Name', data.customerName || 'Walk-in Customer'],
        ['Address', data.shippingAddress || data.customerAddress],
        ['Mobile', data.customerPhone],
    ];
    const invoice: [string, string | undefined][] = [
        ['Invoice No.', data.referenceNumber],
        ['Order No.', data.orderNumber],
        ['Invoice Date', data.date],
        ['Sales By', data.salesBy],
        ['Entry By', data.preparedBy],
    ];
    const present = (lines: [string, string | undefined][]) =>
        lines.filter((line): line is [string, string] => !!line[1]);

    return `<div class="d-info">
        <div class="d-info-l">${present(customer).map(([label, value]) =>
            `<span class="d-info-k">${label}</span><span class="d-info-c">:</span><span>${esc(value)}</span>`,
        ).join('')}</div>
        <div class="d-info-r">${present(invoice).map(([label, value]) =>
            `<div><strong>${label}:</strong> ${esc(value)}</div>`,
        ).join('')}</div>
    </div>`;
}

/**
 * The invoice in two parts. `body` is the item table, which runs over as
 * many pages as the items need; `end` is the totals, note and
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
    const showWarranty = layout.warranty_column === 'always'
        || (layout.warranty_column === 'when-used' && data.items.some((item) => !!item.warranty));

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

    // SL, item, quantity, unit price and total, and the two optional columns.
    const columns = 5 + (showWarranty ? 1 : 0) + (showDiscount ? 1 : 0);
    const ruled = layout.table_borders === 'columns';

    // The box is the first row of the item table's head, so it repeats with
    // the column headings at the top of every page a long invoice runs to.
    // Not in the letterhead's head with the strip it replaced: Chrome repeats
    // no table head taller than about a quarter of the page, and letterhead
    // and box together are — the whole head then printed on page one only.
    // Apart, each is under the limit and both repeat.
    const body = `
    <div class="invoice-body inv-d inv-d--top">
    <table class="d-table${ruled ? ' d-table--ruled' : ''}">
        <thead>
            <tr class="d-info-row"><td colspan="${columns}">${infoBoxHtml(data)}</td></tr>
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
        ${ruled ? `<tfoot><tr class="d-close"><td colspan="${columns}"></td></tr></tfoot>` : ''}
    </table>
    </div>`;

    const end = `
    <div class="invoice-body inv-d inv-d--end">
    ${layout.amount_in_words ? `<p class="d-words"><strong>In Word:</strong> ${takaInWords(data.total)}</p>` : ''}
    <div class="d-sums">
        <div class="d-left">
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
 * The foot of the page: the thank-you. A letterhead footer the tenant designed
 * replaces it, as it replaces every printer's own. Who entered the sale is in
 * the box under the letterhead, and the print time and who printed ride in the
 * page margin with the page number (see `pageStamp`), so they print whatever
 * the footer.
 */
export function detailedFooterHtml(thankYou: string): string {
    return `<div class="p71-doc-ft d-foot">
        <div class="d-foot-l">${esc(thankYou)}</div>
    </div>`;
}

export function detailedStyles(): string {
    const c = COMPACT_SCOPE;
    return `
        /* Detailed invoice */
        .inv-d { font-size:13px; color:#111; }
        /* The body and the closing block are two blocks of one invoice: the
           padding between them is the body's own, not doubled. */
        .inv-d--top { padding-bottom:0; }
        .inv-d--end { padding-top:0; }

        /* The customer and the invoice in one rounded box, spanning the item
           table it heads. The customer side is a label / colon / value grid, so
           the colons stand in one column and every value starts just after
           them; the invoice side is set flush to the box's far edge. */
        .d-table .d-info-row > td { padding:0 0 12px; background:none; }
        .d-info {
            display:flex; justify-content:space-between; align-items:flex-start; gap:16px;
            border:1.5px solid #6b7280; border-radius:6px;
            padding:6px 12px; font-size:13px; line-height:1.5; color:#111;
        }
        .d-info-l { display:grid; grid-template-columns:max-content max-content 1fr; column-gap:6px; min-width:0; }
        .d-info-l > span { overflow-wrap:anywhere; }
        .d-info-k { font-weight:bold; }
        .d-info-r { text-align:right; flex-shrink:0; }

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

        /* Thin rules around the item table and between its columns, when the
           member asks for them. On the cells, never the table: the box above
           the headings is a row of the same table and stays outside the rules.
           The table is closed by an empty repeating foot rather than the last
           row's own border, so a page that breaks mid-table is closed too. */
        .d-table--ruled > thead > tr:not(.d-info-row) > th, .d-table--ruled > tbody > tr > td { border-left:1px solid #9ca3af; border-right:1px solid #9ca3af; }
        .d-table--ruled > thead > tr:not(.d-info-row) > th { border-top:1px solid #9ca3af; border-bottom:1px solid #9ca3af; }
        .d-table--ruled > tbody > tr:last-child > td { border-bottom:0; }
        .d-table--ruled > tfoot > tr.d-close > td { padding:0; height:0; border-top:1px solid #9ca3af; }

        .d-sums { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; padding:0 6px; margin-bottom:16px; }
        .d-left { width:44%; }
        .d-right { width:46%; }
        /* Across the full width, above the two blocks, so they start level. */
        .d-words { margin:0 6px 10px; font-size:13px; }
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
           rows (the table's own thead), and the box repeats with the
           letterhead. */
        .d-table tr, .d-sums, .note-box, .signatures, .d-foot { break-inside:avoid; }

        /* The page foot: the thank-you. */
        .d-foot { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; font-size:11px; color:#111; padding-top:8px; }

        ${c} .d-table .d-info-row > td { padding:0 0 6px; }
        ${c} .d-info { padding:3px 8px; font-size:11px; line-height:1.4; }
        ${c} .inv-d, ${c} .d-table td, ${c} .d-table th, ${c} .d-block td { font-size:11px; }
        ${c} .d-table th { padding:3px 6px; }
        ${c} .d-table td { padding:2px 6px; }
        ${c} .d-block td { padding:1px 0; }
        ${c} .d-sums { margin-bottom:8px; }
        ${c} .d-words { margin-bottom:6px; }
        ${c} .d-foot { font-size:10px; padding-top:4px; }
`;
}
