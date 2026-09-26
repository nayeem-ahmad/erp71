import { COMPACT_SCOPE, openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, HeaderContext, PaperSize, PrintHeaderConfig, PrintPreviewOptions } from './print';

export { PAPER_SIZES, paperSizeLabel } from './print';
export type { PaperSize } from './print';

/**
 * A delivery challan is the invoice minus the money: what left the shop, who
 * it is going to, and two signature lines. The delivery rider carries it and
 * the customer signs it on receipt, so it must never show what anything cost —
 * the rider is not owed the shop's margins and the customer settles against
 * the invoice, not this.
 *
 * That rule is held by the *types*, not by remembering to hide a column: there
 * is no price, rate, discount, VAT or total field anywhere in `ChallanItem` or
 * `DeliveryChallanData`, and this module deliberately does not import
 * `formatBDT`. A caller cannot leak a figure onto the challan by passing one.
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

        /* Meta grid */
        .meta-grid { ${isThermal ? 'margin:4px 0;' : 'display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;'} }
        .meta-block { ${isThermal ? 'margin:3px 0;' : 'background:#f8fafc; border-radius:8px; padding:12px 16px;'} }
        .meta-block h3 { font-size:${isThermal ? '10px' : '11px'}; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${isThermal ? '#444' : '#6b7280'}; margin-bottom:5px; }
        .meta-block p  { font-size:${isThermal ? '10px' : '13px'}; color:#222; margin-bottom:2px; }

        /* Divider */
        .divider { border:none; border-top:1px ${isThermal ? 'dashed #000' : 'solid #e5e7eb'}; margin:${isThermal ? '6px 0' : '0 0 20px 0'}; }

        /* Items table — quantities only, no money columns */
        .items-table { width:100%; border-collapse:collapse; margin-bottom:${isThermal ? '6px' : '20px'}; }
        .items-table thead th {
            font-size:${isThermal ? '9px' : '11px'}; font-weight:bold; text-transform:uppercase;
            letter-spacing:0.5px; color:${isThermal ? '#000' : '#6b7280'};
            border-bottom:${isThermal ? '1px solid #000' : '2px solid #e5e7eb'};
            padding:${isThermal ? '3px 0' : '8px 10px'}; text-align:left;
        }
        .items-table tbody td {
            padding:${isThermal ? '2px 0' : '7px 10px'};
            vertical-align:top;
            border-bottom:1px solid ${isThermal ? 'transparent' : '#f3f4f6'};
            font-size:${isThermal ? '10px' : '13px'};
        }
        .item-sl   { width:${isThermal ? '8%' : '6%'}; color:#888; }
        .item-name { width:${isThermal ? '52%' : '58%'}; }
        .item-qty  { width:${isThermal ? '20%' : '18%'}; text-align:right; font-weight:bold; }
        .item-unit { width:${isThermal ? '20%' : '18%'}; color:#555; }
        .sku       { font-size:9px; color:#888; }

        /* Quantity summary — the only total a challan carries */
        .qty-summary { ${isThermal ? 'margin:4px 0;' : 'display:flex; justify-content:flex-end; margin-bottom:20px;'} }
        .qty-summary table { width:${isThermal ? '100%' : '260px'}; border-collapse:collapse; }
        .qty-summary td {
            padding:${isThermal ? '3px 0' : '6px 10px'}; font-size:${isThermal ? '11px' : '14px'}; font-weight:bold;
            border-top:2px solid ${isThermal ? '#000' : '#1d4ed8'};
        }
        .qty-summary td:last-child { text-align:right; }

        /* Note */
        .note-box {
            font-size:${isThermal ? '10px' : '12px'}; color:#555;
            ${isThermal
                ? 'border:1px dashed #aaa; padding:4px 6px; margin:6px 0;'
                : 'background:#fef9c3; border:1px solid #fde68a; border-radius:6px; padding:10px 14px; margin-bottom:20px;'}
        }

        /* Signature band — the point of the document */
        .sign-band {
            ${isThermal ? '' : 'display:grid; grid-template-columns:repeat(3, 1fr); gap:24px;'}
            margin-top:${isThermal ? '14px' : '48px'};
            page-break-inside: avoid;
        }
        .sign-box { ${isThermal ? 'margin-bottom:14px;' : ''} text-align:center; }
        .sign-name { font-size:${isThermal ? '10px' : '12px'}; color:#222; min-height:${isThermal ? '12px' : '16px'}; }
        .sign-line { border-top:1px solid #333; margin:${isThermal ? '14px 0 3px' : '4px 0 6px'}; }
        .sign-role { font-size:${isThermal ? '10px' : '12px'}; font-weight:bold; color:#222; }
        .sign-hint { font-size:${isThermal ? '9px' : '10px'}; color:#888; }

        .no-price { text-align:center; font-size:${isThermal ? '9px' : '11px'}; color:#888; margin-top:${isThermal ? '8px' : '18px'}; font-style:italic; }
        .footer { text-align:center; font-size:${isThermal ? '10px' : '12px'}; color:#888; margin-top:${isThermal ? '8px' : '18px'}; ${isThermal ? '' : 'border-top:1px solid #e5e7eb; padding-top:14px;'} }
        ${isThermal ? '' : compactStyles()}
    `;
}

/**
 * The compact challan — the invoice's treatment: tighter rows, one size
 * smaller type, the SKU beside the item name. The signature band keeps enough
 * room above its lines to sign on; that space is the point of the document.
 *
 * Inert until `html.p71-compact` is set, and never emitted for a roll.
 */
function compactStyles(): string {
    const c = COMPACT_SCOPE;
    return `
        ${c} .meta-grid { gap:8px; margin-bottom:8px; }
        ${c} .meta-block { padding:5px 10px; border-radius:6px; }
        ${c} .meta-block h3 { font-size:10px; margin-bottom:2px; }
        ${c} .meta-block p { font-size:11px; margin-bottom:0; }
        ${c} .divider { margin:0 0 6px 0; }
        ${c} .items-table { margin-bottom:6px; }
        ${c} .items-table thead th { font-size:10px; padding:3px 6px; }
        ${c} .items-table tbody td { font-size:11px; padding:2px 6px; }
        ${c} .item-name br { display:none; }
        ${c} .item-name .sku { margin-left:6px; }
        ${c} .qty-summary { margin-bottom:6px; }
        ${c} .qty-summary td { font-size:12px; padding:2px 6px; }
        ${c} .note-box { font-size:11px; padding:5px 8px; margin-bottom:6px; }
        ${c} .sign-band { margin-top:32px; }
        ${c} .no-price { font-size:10px; margin-top:8px; }
        ${c} .footer { font-size:10px; margin-top:8px; padding-top:6px; }`;
}

function buildBody(data: DeliveryChallanData, isThermal: boolean): string {
    const l = data.labels;

    const itemRows = data.items.map((item, index) => `<tr>
            <td class="item-sl">${index + 1}</td>
            <td class="item-name">${esc(item.name)}${item.sku ? `<br><span class="sku">${esc(item.sku)}</span>` : ''}</td>
            <td class="item-qty">${item.quantity}</td>
            <td class="item-unit">${item.unit ? esc(item.unit) : '—'}</td>
        </tr>`).join('');

    const totalQuantity = data.items.reduce((sum, item) => sum + item.quantity, 0);

    const separateInvoiceNo =
        data.invoiceNumber && data.invoiceNumber !== data.challanNumber
            ? data.invoiceNumber
            : null;

    const deliveryLines = [
        data.customerName,
        data.customerPhone,
        data.deliveryAddress,
    ].filter(Boolean) as string[];

    const carrierLines = [
        data.driverName ? `${l.driver}: ${data.driverName}` : null,
        data.driverPhone,
        data.vehicleNo ? `${l.vehicle}: ${data.vehicleNo}` : null,
    ].filter(Boolean) as string[];

    return `
    <div class="meta-grid">
        ${deliveryLines.length ? `
        <div class="meta-block">
            <h3>${esc(l.deliverTo)}</h3>
            ${deliveryLines.map((line) => `<p>${esc(line)}</p>`).join('')}
        </div>` : ''}
        ${!isThermal ? `
        <div class="meta-block">
            <h3>${esc(l.challanDetails)}</h3>
            <p>${esc(l.challanNo)}: <strong>${esc(data.challanNumber)}</strong></p>
            ${separateInvoiceNo ? `<p>${esc(l.invoiceNo)}: ${esc(separateInvoiceNo)}</p>` : ''}
            <p>${esc(l.date)}: ${esc(data.date)}</p>
            ${carrierLines.map((line) => `<p>${esc(line)}</p>`).join('')}
        </div>` : ''}
        ${isThermal && carrierLines.length ? `
        <div class="meta-block">
            ${carrierLines.map((line) => `<p>${esc(line)}</p>`).join('')}
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
            <tr><td>${esc(l.totalQuantity)}</td><td>${totalQuantity}</td></tr>
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

export function printDeliveryChallan(
    data: DeliveryChallanData,
    paperSize: PaperSize = 'A4',
    preview?: PrintPreviewOptions,
): void {
    const isThermal = paperSize === 'Thermal80' || paperSize === 'Thermal58';

    const headerContext: HeaderContext = {
        docTitle: data.labels.title,
        docNumber: data.challanNumber,
        docDate: data.date,
        companyName: data.companyName || 'RETAIL STORE',
        address: data.companyAddress,
        phone: data.companyPhone,
    };
    const headerHtml = renderHeaderHtml(data.headerConfig, headerContext, paperSize);

    openPrintWindow({
        context: headerContext,
        title: `${data.labels.title} ${data.challanNumber}`,
        paperSize,
        headerConfig: data.headerConfig,
        headerHtml,
        bodyHtml: buildBody(data, isThermal),
        footerHtml: `<div class="footer">${esc(data.labels.footer)}</div>`,
        styles: buildStyles(isThermal),
        // Long item lists spill onto page 2 — keep the letterhead on every page.
        repeatHeader: !isThermal,
        compactable: true,
        preview,
    });
}
