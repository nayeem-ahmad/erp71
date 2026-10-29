import { DEFAULT_INVOICE_PRINT_PREFS, type InvoicePrintPrefs } from '@erp71/shared-types';
import { COMPACT_SCOPE, isThermalPaper, openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, HeaderContext, PaperSize, PrintHeaderConfig, PrintPreviewOptions } from './print';
import {
    detailedFooterHtml,
    detailedInfoBoxHtml,
    detailedStyles,
    formatPrintStamp,
} from './sales-invoice-detailed';

export { PAPER_SIZES, paperSizeLabel } from './print';
export type { PaperSize } from './print';

/**
 * A delivery challan is the invoice minus the money: what left the shop, who
 * it is going to, and three signature lines. The delivery rider carries it and
 * the customer signs it on receipt, so it must never show what anything cost —
 * the rider is not owed the shop's margins and the customer settles against
 * the invoice, not this.
 *
 * That rule is held by the *types*, not by remembering to hide a column: there
 * is no price, rate, discount, VAT or total field anywhere in `ChallanItem` or
 * `DeliveryChallanData`, and this module deliberately does not import
 * `formatBDT`. A caller cannot leak a figure onto the challan by passing one.
 *
 * On sheet paper the body is the detailed invoice's design — the boxed
 * customer / document block, the shaded item table — with quantity columns in
 * place of the money ones. A till roll keeps the compact layout it always had.
 */
export interface ChallanItem {
    name: string;
    sku?: string;
    quantity: number;
    /** Unit the quantity is counted in — "pcs", "kg". Printed as given. */
    unit?: string;
}

/** Printed strings, supplied by the caller so the challan follows the UI locale. */
export interface ChallanLabels {
    title: string;
    challanNo: string;
    invoiceNo: string;
    date: string;
    deliverTo: string;
    challanDetails: string;
    /** Customer name label on the detailed sheet box. */
    name: string;
    /** Customer phone label on the detailed sheet box. */
    mobile: string;
    address: string;
    driver: string;
    vehicle: string;
    sl: string;
    item: string;
    sku: string;
    quantity: string;
    unit: string;
    totalQuantity: string;
    note: string;
    deliveredBy: string;
    carriedBy: string;
    receivedBy: string;
    signatureAndDate: string;
    footer: string;
    noPriceHint: string;
}

export interface DeliveryChallanData {
    /** The challan's own number — the sale's reference, so the two match up. */
    challanNumber: string;
    /**
     * The invoice this challan accompanies. Printed only when it differs from
     * the challan number — a shop that numbers the two alike gets one line, not
     * the same string twice under two labels.
     */
    invoiceNumber?: string;
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
    /** Where the goods go, which is not always the customer's billing address. */
    deliveryAddress?: string;
    driverName?: string;
    driverPhone?: string;
    vehicleNo?: string;
    items: ChallanItem[];
    note?: string;
    labels: ChallanLabels;
    /** Who is printing it — the signed-in user — named after the print time. */
    printedBy?: string;
    /**
     * When it was printed, already formatted. Left out, the moment of printing
     * is used; a caller sets it only to pin the stamp, as a test does.
     */
    printedAt?: string;
}

function esc(str: string): string {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function separateInvoiceNo(data: DeliveryChallanData): string | null {
    return data.invoiceNumber && data.invoiceNumber !== data.challanNumber
        ? data.invoiceNumber
        : null;
}

function totalQuantityOf(data: DeliveryChallanData): number {
    return data.items.reduce((sum, item) => sum + item.quantity, 0);
}

function carrierLines(data: DeliveryChallanData): string[] {
    const l = data.labels;
    return [
        data.driverName ? `${l.driver}: ${data.driverName}` : null,
        data.driverPhone,
        data.vehicleNo ? `${l.vehicle}: ${data.vehicleNo}` : null,
    ].filter(Boolean) as string[];
}

function buildThermalStyles(): string {
    return `
        body { font-family: 'Courier New', Courier, monospace; }

        .meta-grid { margin:4px 0; }
        .meta-block { margin:3px 0; }
        .meta-block h3 { font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:#444; margin-bottom:5px; }
        .meta-block p  { font-size:10px; color:#222; margin-bottom:2px; }

        .divider { border:none; border-top:1px dashed #000; margin:6px 0; }

        .items-table { width:100%; border-collapse:collapse; margin-bottom:6px; }
        .items-table thead th {
            font-size:9px; font-weight:bold; text-transform:uppercase;
            letter-spacing:0.5px; color:#000;
            border-bottom:1px solid #000;
            padding:3px 0; text-align:left;
        }
        .items-table tbody td {
            padding:2px 0;
            vertical-align:top;
            border-bottom:1px solid transparent;
            font-size:10px;
        }
        .item-sl   { width:8%; color:#888; }
        .item-name { width:52%; }
        .item-qty  { width:20%; text-align:right; font-weight:bold; }
        .item-unit { width:20%; color:#555; }
        .sku       { font-size:9px; color:#888; }

        .qty-summary { margin:4px 0; }
        .qty-summary table { width:100%; border-collapse:collapse; }
        .qty-summary td {
            padding:3px 0; font-size:11px; font-weight:bold;
            border-top:2px solid #000;
        }
        .qty-summary td:last-child { text-align:right; }

        .note-box {
            font-size:10px; color:#555;
            border:1px dashed #aaa; padding:4px 6px; margin:6px 0;
        }

        .sign-band { margin-top:14px; page-break-inside: avoid; }
        .sign-box { margin-bottom:14px; text-align:center; }
        .sign-name { font-size:10px; color:#222; min-height:12px; }
        .sign-line { border-top:1px solid #333; margin:14px 0 3px; }
        .sign-role { font-size:10px; font-weight:bold; color:#222; }
        .sign-hint { font-size:9px; color:#888; }

        .no-price { text-align:center; font-size:9px; color:#888; margin-top:8px; font-style:italic; }
        .footer { text-align:center; font-size:10px; color:#888; margin-top:8px; }
    `;
}

function buildThermalBody(data: DeliveryChallanData): string {
    const l = data.labels;

    const itemRows = data.items.map((item, index) => `<tr>
            <td class="item-sl">${index + 1}</td>
            <td class="item-name">${esc(item.name)}${item.sku ? `<br><span class="sku">${esc(item.sku)}</span>` : ''}</td>
            <td class="item-qty">${item.quantity}</td>
            <td class="item-unit">${item.unit ? esc(item.unit) : '—'}</td>
        </tr>`).join('');

    const deliveryLines = [
        data.customerName,
        data.customerPhone,
        data.deliveryAddress,
    ].filter(Boolean) as string[];

    const carrier = carrierLines(data);

    return `
    <div class="meta-grid">
        ${deliveryLines.length ? `
        <div class="meta-block">
            <h3>${esc(l.deliverTo)}</h3>
            ${deliveryLines.map((line) => `<p>${esc(line)}</p>`).join('')}
        </div>` : ''}
        ${carrier.length ? `
        <div class="meta-block">
            ${carrier.map((line) => `<p>${esc(line)}</p>`).join('')}
        </div>` : ''}
    </div>

    <hr class="divider">

    <table class="items-table">
        <thead>
            <tr>
                <th class="item-sl">${esc(l.sl)}</th>
                <th class="item-name">${esc(l.item)}</th>
                <th class="item-qty">${esc(l.quantity)}</th>
                <th class="item-unit">${esc(l.unit)}</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
    </table>

    <div class="qty-summary">
        <table>
            <tr><td>${esc(l.totalQuantity)}</td><td>${totalQuantityOf(data)}</td></tr>
        </table>
    </div>

    ${data.note ? `<div class="note-box"><strong>${esc(l.note)}:</strong> ${esc(data.note)}</div>` : ''}

    <div class="sign-band">
        <div class="sign-box">
            <div class="sign-name">${data.companyName ? esc(data.companyName) : ''}</div>
            <div class="sign-line"></div>
            <p class="sign-role">${esc(l.deliveredBy)}</p>
            <p class="sign-hint">${esc(l.signatureAndDate)}</p>
        </div>
        <div class="sign-box">
            <div class="sign-name">${data.driverName ? esc(data.driverName) : ''}</div>
            <div class="sign-line"></div>
            <p class="sign-role">${esc(l.carriedBy)}</p>
            <p class="sign-hint">${esc(l.signatureAndDate)}</p>
        </div>
        <div class="sign-box">
            <div class="sign-name">${data.customerName ? esc(data.customerName) : ''}</div>
            <div class="sign-line"></div>
            <p class="sign-role">${esc(l.receivedBy)}</p>
            <p class="sign-hint">${esc(l.signatureAndDate)}</p>
        </div>
    </div>

    <p class="no-price">${esc(l.noPriceHint)}</p>`;
}

/** The member's padding choice, vertical then horizontal — same as the invoice. */
const BODY_PADDING: Record<InvoicePrintPrefs['padding'], string> = {
    narrow: '2mm 1mm',
    normal: '6mm 4mm',
    wide: '12mm 8mm',
};

/**
 * The detailed invoice's chrome, plus a unit column, three signature lines
 * and the no-price notice. Compact keeps room to sign.
 */
function challanSheetStyles(layout: InvoicePrintPrefs): string {
    const c = COMPACT_SCOPE;
    const signSpace = layout.signature_space_mm == null
        ? ''
        : `.d-sign-band, ${c} .d-sign-band { margin-top:${layout.signature_space_mm}mm; }`;
    return `
        body { font-family: Arial, Helvetica, sans-serif; }
        .invoice-body { padding:${BODY_PADDING[layout.padding]}; }
        ${detailedStyles()}
        .d-table th.d-unit, .d-table td.d-unit { width:12%; text-align:center; }
        .d-table th.d-num, .d-table td.d-num { width:12%; }
        .d-item .sku { font-size:11px; color:#555; }
        .d-sign-band {
            display:grid; grid-template-columns:repeat(3, 1fr); gap:24px;
            margin-top:48px; page-break-inside:avoid; break-inside:avoid;
        }
        .d-sign-name { font-size:12px; color:#222; min-height:16px; }
        .d-sign-line { border-top:1px solid #6b7280; padding-top:4px; font-size:11px; color:#374151; }
        .d-sign-hint { font-size:10px; color:#888; margin-top:2px; }
        .no-price { text-align:center; font-size:11px; color:#888; margin-top:18px; font-style:italic; }

        ${c} .invoice-body { padding:1mm 0; }
        ${c} .d-sign-band { margin-top:32px; }
        ${c} .d-item br { display:none; }
        ${c} .d-item .sku { margin-left:6px; }
        ${c} .no-price { font-size:10px; margin-top:8px; }
        ${signSpace}
    `;
}

function driverValue(data: DeliveryChallanData): string | undefined {
    if (!data.driverName && !data.driverPhone) return undefined;
    if (data.driverName && data.driverPhone) return `${data.driverName} · ${data.driverPhone}`;
    return data.driverName || data.driverPhone;
}

function buildDetailedParts(data: DeliveryChallanData, layout: InvoicePrintPrefs): { body: string; end: string } {
    const l = data.labels;
    const invoiceNo = separateInvoiceNo(data);
    const ruled = layout.table_borders === 'columns';
    const columns = 4;

    const infoBox = detailedInfoBoxHtml(
        [
            [l.name, data.customerName],
            [l.mobile, data.customerPhone],
            [l.address, data.deliveryAddress],
        ],
        [
            [l.challanNo, data.challanNumber],
            [l.invoiceNo, invoiceNo ?? undefined],
            [l.date, data.date],
            [l.driver, driverValue(data)],
            [l.vehicle, data.vehicleNo],
        ],
    );

    const itemRows = data.items.map((item, index) => `<tr>
            <td class="d-sl">${index + 1}</td>
            <td class="d-item">${esc(item.name)}${item.sku ? `<br><span class="sku">${esc(item.sku)}</span>` : ''}</td>
            <td class="d-num">${item.quantity}</td>
            <td class="d-unit">${item.unit ? esc(item.unit) : '—'}</td>
        </tr>`).join('');

    const body = `
    <div class="invoice-body inv-d inv-d--top">
    <table class="d-table${ruled ? ' d-table--ruled' : ''}">
        <thead>
            <tr class="d-info-row"><td colspan="${columns}">${infoBox}</td></tr>
            <tr>
                <th class="d-sl">${esc(l.sl)}</th>
                <th class="d-item">${esc(l.item)}</th>
                <th class="d-num">${esc(l.quantity)}</th>
                <th class="d-unit">${esc(l.unit)}</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        ${ruled ? `<tfoot><tr class="d-close"><td colspan="${columns}"></td></tr></tfoot>` : ''}
    </table>
    </div>`;

    const end = `
    <div class="invoice-body inv-d inv-d--end">
    <div class="d-sums">
        <div class="d-left"></div>
        <div class="d-right">
            <table class="d-block">
                <tr class="rule"><td>${esc(l.totalQuantity)}</td><td>${totalQuantityOf(data)}</td></tr>
            </table>
        </div>
    </div>
    ${data.note ? `<div class="note-box"><strong>${esc(l.note)}:</strong> ${esc(data.note)}</div>` : ''}
    <div class="d-sign-band">
        <div class="d-sign-box">
            <div class="d-sign-name">${data.companyName ? esc(data.companyName) : ''}</div>
            <div class="d-sign-line">${esc(l.deliveredBy)}</div>
            <p class="d-sign-hint">${esc(l.signatureAndDate)}</p>
        </div>
        <div class="d-sign-box">
            <div class="d-sign-name">${data.driverName ? esc(data.driverName) : ''}</div>
            <div class="d-sign-line">${esc(l.carriedBy)}</div>
            <p class="d-sign-hint">${esc(l.signatureAndDate)}</p>
        </div>
        <div class="d-sign-box">
            <div class="d-sign-name">${data.customerName ? esc(data.customerName) : ''}</div>
            <div class="d-sign-line">${esc(l.receivedBy)}</div>
            <p class="d-sign-hint">${esc(l.signatureAndDate)}</p>
        </div>
    </div>
    <p class="no-price">${esc(l.noPriceHint)}</p>
    </div>`;

    return { body, end };
}

function headerContextOf(data: DeliveryChallanData, printedAt: string): HeaderContext {
    return {
        docTitle: data.labels.title,
        docNumber: data.challanNumber,
        docDate: data.date,
        companyName: data.companyName || 'RETAIL STORE',
        storeName: data.storeName,
        address: data.companyAddress,
        phone: data.companyPhone,
        printDate: printedAt,
    };
}

/**
 * @param layout The printing member's invoice padding, table rules and
 *   signature gap; the built-in ones when omitted. Sheet paper always prints
 *   the detailed design — a challan is a trade document, the same way a
 *   quotation is. A roll keeps the compact layout it always had.
 */
export function printDeliveryChallan(
    data: DeliveryChallanData,
    paperSize: PaperSize = 'A4',
    preview?: PrintPreviewOptions,
    layout: InvoicePrintPrefs = DEFAULT_INVOICE_PRINT_PREFS,
): void {
    if (isThermalPaper(paperSize)) {
        const headerContext = headerContextOf(data, data.printedAt ?? formatPrintStamp());
        openPrintWindow({
            context: headerContext,
            title: `${data.labels.title} ${data.challanNumber}`,
            paperSize,
            headerConfig: data.headerConfig,
            headerHtml: renderHeaderHtml(data.headerConfig, headerContext, paperSize),
            bodyHtml: buildThermalBody(data),
            footerHtml: `<div class="footer">${esc(data.labels.footer)}</div>`,
            styles: buildThermalStyles(),
            compactable: false,
            preview,
        });
        return;
    }

    const printedAt = data.printedAt ?? formatPrintStamp();
    const who = data.printedBy?.trim();
    const context = headerContextOf(data, printedAt);
    const { body, end } = buildDetailedParts(data, layout);

    openPrintWindow({
        context,
        headerConfig: data.headerConfig,
        headerHtml: renderHeaderHtml(data.headerConfig, { ...context, hideDocMeta: true }, paperSize),
        bodyHtml: body,
        endHtml: end,
        footerHtml: detailedFooterHtml(data.labels.footer),
        title: `${data.labels.title} ${data.challanNumber}`,
        paperSize,
        styles: challanSheetStyles(layout),
        repeatHeader: true,
        pinFooter: true,
        pageStamp: { text: `Printed ${printedAt}${who ? ` by ${who}` : ''}`, pageNumbers: true },
        compactable: true,
        bodyTypeScale: true,
        preview,
    });
}
