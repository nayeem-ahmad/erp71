import { formatBDT, formatDate } from './format';
import {
    COMPACT_SCOPE,
    SIMPLE_DOC_STYLES,
    escapeHtml,
    openPrintWindow,
    renderHeaderHtml,
    sheetPaper,
    type DeepPartial,
    type HeaderContext,
    type PaperSize,
    type PrintHeaderConfig,
} from './print';

/**
 * The purchase order a supplier is sent, on the tenant's Purchase Order
 * letterhead.
 *
 * It used to be the on-screen page printed with `window.print()` and a forced
 * A4 — branding colours, no template, no branch. It now goes through the print
 * window like every other document, so the branch's template and the paper
 * this browser prints on both apply.
 */

/** GET /purchase-orders/:id/invoice's `purchaseOrder`, as far as this prints it. */
export interface PrintablePurchaseOrder {
    po_number: string;
    created_at: string;
    expected_date?: string | null;
    status?: string;
    notes?: string | null;
    subtotal_amount: string | number;
    tax_amount: string | number;
    discount_amount: string | number;
    freight_amount: string | number;
    total_amount: string | number;
    store?: { name?: string | null; address?: string | null } | null;
    supplier?: {
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        address?: string | null;
    } | null;
    items: {
        id?: string;
        quantity: number;
        unit_cost: string | number;
        line_total: string | number;
        product?: { name?: string | null; sku?: string | null } | null;
    }[];
}

export interface PurchaseOrderPrintContext {
    /** The order's branch template, already resolved for `PURCHASE_ORDER`. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    companyName?: string;
    /** This browser's paper; a till roll prints the order on A4. */
    paperSize: PaperSize;
    locale: string;
    labels: {
        title: string;
        poNumber: string;
        date: string;
        expectedDate: string;
        supplier: string;
        noSupplier: string;
        description: string;
        sku: string;
        qty: string;
        unitCost: string;
        lineTotal: string;
        subtotal: string;
        tax: string;
        freight: string;
        discount: string;
        total: string;
        note: string;
    };
}

const PURCHASE_ORDER_STYLES = `${SIMPLE_DOC_STYLES}
    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
    .meta-box { padding: 12px; background: #f9f9f9; border-radius: 8px; font-size: 12px; line-height: 1.5; }
    .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; display: block; margin-bottom: 4px; }
    .num { text-align: right; }
    .totals { width: auto; margin-left: auto; min-width: 240px; }
    .totals td { border-bottom: 0; padding: 4px 12px; }
    ${COMPACT_SCOPE} .meta-grid { gap: 8px; margin-bottom: 6px; }
    ${COMPACT_SCOPE} .meta-box { padding: 6px 8px; }
    ${COMPACT_SCOPE} .totals td { padding: 1px 6px; }`;

function amount(value: string | number): number {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Null when the browser blocked the window. */
export function printPurchaseOrder(po: PrintablePurchaseOrder, ctx: PurchaseOrderPrintContext): Window | null {
    const { labels, locale } = ctx;
    const esc = (value: string | null | undefined) => escapeHtml(value ?? '');
    const money = (value: string | number) => esc(formatBDT(amount(value), { locale }));
    const paperSize = sheetPaper(ctx.paperSize);
    const date = formatDate(po.created_at, locale);

    const context: HeaderContext = {
        docTitle: labels.title,
        docNumber: po.po_number,
        docDate: date,
        companyName: ctx.companyName,
        storeName: po.store?.name ?? undefined,
        address: po.store?.address ?? undefined,
    };

    const supplier = po.supplier
        ? [po.supplier.name, po.supplier.phone, po.supplier.email, po.supplier.address]
            .filter(Boolean)
            .map((line, i) => (i === 0 ? `<strong>${esc(line)}</strong>` : esc(line)))
            .join('<br>')
        : esc(labels.noSupplier);

    const rows = po.items.map((item) => `
        <tr>
            <td>${esc(item.product?.name ?? '—')}</td>
            <td>${esc(item.product?.sku ?? '—')}</td>
            <td class="num">${item.quantity}</td>
            <td class="num">${money(item.unit_cost)}</td>
            <td class="num">${money(item.line_total)}</td>
        </tr>`).join('');

    // Only the adjustments the order carries, as the screen shows them.
    const adjustments = [
        [labels.tax, amount(po.tax_amount), ''],
        [labels.freight, amount(po.freight_amount), ''],
        [labels.discount, amount(po.discount_amount), '−'],
    ] as const;
    const totals = `
        <tr><td>${esc(labels.subtotal)}</td><td class="num">${money(po.subtotal_amount)}</td></tr>
        ${adjustments
            .filter(([, value]) => value > 0)
            .map(([label, value, sign]) => `<tr><td>${esc(label)}</td><td class="num">${sign}${money(value)}</td></tr>`)
            .join('')}
        <tr class="total-row"><td>${esc(labels.total)}</td><td class="num">${money(po.total_amount)}</td></tr>`;

    return openPrintWindow({
        context,
        title: `${labels.title} ${po.po_number}`,
        paperSize,
        headerConfig: ctx.headerConfig,
        headerHtml: renderHeaderHtml(ctx.headerConfig, context, paperSize),
        styles: PURCHASE_ORDER_STYLES,
        repeatHeader: true,
        compactable: true,
        bodyHtml: `
            <div class="meta-grid">
                <div class="meta-box">
                    <span class="meta-label">${esc(labels.supplier)}</span>
                    ${supplier}
                </div>
                <div class="meta-box">
                    <span class="meta-label">${esc(labels.poNumber)}</span>${esc(po.po_number)}<br>
                    <span class="meta-label">${esc(labels.date)}</span>${esc(date)}<br>
                    <span class="meta-label">${esc(labels.expectedDate)}</span>${po.expected_date ? esc(formatDate(po.expected_date, locale)) : '—'}
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>${esc(labels.description)}</th>
                        <th>${esc(labels.sku)}</th>
                        <th class="num">${esc(labels.qty)}</th>
                        <th class="num">${esc(labels.unitCost)}</th>
                        <th class="num">${esc(labels.lineTotal)}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <table class="totals"><tbody>${totals}</tbody></table>
            ${po.notes ? `<div class="note-section"><strong>${esc(labels.note)}</strong> ${esc(po.notes)}</div>` : ''}`,
        footerHtml: `<div class="footer">${esc(labels.title)} · ${esc(po.po_number)}</div>`,
    });
}
