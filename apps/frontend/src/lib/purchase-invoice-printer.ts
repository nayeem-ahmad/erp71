import { formatBDT } from './format';
import { paymentMethodLabel } from './payment-method-label';
import { COMPACT_SCOPE, openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, HeaderContext, PaperSize, PrintHeaderConfig, PrintPreviewOptions } from './print';

export type { PaperSize } from './print';

export interface PurchaseInvoiceItem {
    name: string;
    sku?: string;
    quantity: number;
    unitCost: number;
}

export interface PurchaseInvoicePayment {
    method: string;
    amount: number;
    /** Cheque / transfer details printed beside the method. */
    reference?: string;
}

export interface PurchaseInvoiceLabels {
    docTitle: string;
    supplier: string;
    noSupplier: string;
    purchaseNo: string;
    date: string;
    branch: string;
    item: string;
    qty: string;
    unitCost: string;
    lineTotal: string;
    subtotal: string;
    tax: string;
    freight: string;
    discount: string;
    total: string;
    payment: string;
    notePrefix: string;
    footer: string;
}

export interface PurchaseInvoiceData {
    purchaseNumber: string;
    referenceNumber?: string | null;
    date: string;
    companyName?: string;
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    supplierName?: string;
    supplierPhone?: string;
    supplierAddress?: string;
    storeName?: string;
    items: PurchaseInvoiceItem[];
    payments: PurchaseInvoicePayment[];
    subtotal: number;
    tax?: number;
    discount?: number;
    freight?: number;
    total: number;
    note?: string;
    labels: PurchaseInvoiceLabels;
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

        .invoice-body { ${isThermal ? 'padding:0;' : 'padding:6mm 4mm;'} }

        .meta-grid { ${isThermal ? 'margin:4px 0;' : 'display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;'} }
        .meta-block { ${isThermal ? 'margin:3px 0;' : 'background:#f8fafc; border-radius:8px; padding:12px 16px;'} }
        .meta-block h3 { font-size:${isThermal ? '10px' : '11px'}; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${isThermal ? '#444' : '#6b7280'}; margin-bottom:5px; }
        .meta-block p  { font-size:${isThermal ? '10px' : '13px'}; color:#222; margin-bottom:2px; }

        .divider { border:none; border-top:1px ${isThermal ? 'dashed #000' : 'solid #e5e7eb'}; margin:${isThermal ? '6px 0' : '0 0 20px 0'}; }

        .items-table { width:100%; border-collapse:collapse; margin-bottom:${isThermal ? '6px' : '20px'}; }
        .items-table thead th {
            font-size:${isThermal ? '9px' : '11px'}; font-weight:bold; text-transform:uppercase;
            letter-spacing:0.5px; color:${isThermal ? '#000' : '#6b7280'};
            border-bottom:${isThermal ? '1px solid #000' : '2px solid #e5e7eb'};
            padding:${isThermal ? '3px 0' : '8px 10px'}; text-align:left;
        }
        .items-table thead th.item-qty   { text-align:center; }
        .items-table thead th.item-price { text-align:right; }
        .items-table thead th.item-total { text-align:right; }
        .items-table tbody td {
            padding:${isThermal ? '2px 0' : '7px 10px'};
            vertical-align:top;
            border-bottom:1px solid ${isThermal ? 'transparent' : '#f3f4f6'};
            font-size:${isThermal ? '10px' : '13px'};
        }
        .item-name  { width:${isThermal ? '46%' : '44%'}; }
        .item-qty   { width:${isThermal ? '12%' : '12%'}; text-align:center; }
        .item-price { width:${isThermal ? '21%' : '22%'}; text-align:right; }
        .item-total { width:${isThermal ? '21%' : '22%'}; text-align:right; font-weight:bold; }
        .sku        { font-size:9px; color:#888; }

        .totals-wrap { ${isThermal ? '' : 'display:flex; justify-content:flex-end; margin-bottom:20px;'} }
        .totals-table { width:${isThermal ? '100%' : '300px'}; border-collapse:collapse; }
        .totals-table td { padding:${isThermal ? '2px 0' : '5px 10px'}; font-size:${isThermal ? '10px' : '13px'}; }
        .totals-table td:last-child { text-align:right; font-weight:bold; }
        .totals-table .neg td:last-child { color:#ef4444; }
        .grand-total td {
            font-size:${isThermal ? '13px' : '15px'}; font-weight:bold;
            border-top:2px solid ${isThermal ? '#000' : '#e5e7eb'};
            padding-top:${isThermal ? '4px' : '8px'};
            color:${isThermal ? '#000' : '#111827'};
        }

        .payments-section { ${isThermal ? 'margin:6px 0;' : 'background:#f8fafc; border-radius:8px; padding:12px 16px; margin-bottom:20px;'} }
        .payments-section h3 { font-size:${isThermal ? '10px' : '11px'}; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${isThermal ? '#444' : '#6b7280'}; margin-bottom:5px; }
        .payments-table { width:100%; border-collapse:collapse; }
        .pay-label  { font-size:${isThermal ? '10px' : '13px'}; color:#444; padding:${isThermal ? '2px 0' : '3px 0'}; }
        .pay-ref    { font-size:${isThermal ? '9px' : '11px'}; color:#777; }
        .pay-amount { text-align:right; font-weight:bold; font-size:${isThermal ? '10px' : '13px'}; padding:${isThermal ? '2px 0' : '3px 0'}; }

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

function buildBody(data: PurchaseInvoiceData, isThermal: boolean): string {
    const { labels } = data;
    const itemRows = data.items.map((item) => {
        const lineTotal = item.quantity * item.unitCost;
        return `<tr>
            <td class="item-name">${esc(item.name)}${item.sku ? `<br><span class="sku">${esc(item.sku)}</span>` : ''}</td>
            <td class="item-qty">${item.quantity}</td>
            <td class="item-price">${formatBDT(item.unitCost)}</td>
            <td class="item-total">${formatBDT(lineTotal)}</td>
        </tr>`;
    }).join('');

    const paymentRows = data.payments.map((p) =>
        `<tr><td class="pay-label">${esc(paymentMethodLabel(p.method))}${
            p.reference ? `<br><span class="pay-ref">${esc(p.reference)}</span>` : ''
        }</td><td class="pay-amount">${formatBDT(p.amount)}</td></tr>`
    ).join('');

    const supplierBlock = data.supplierName
        ? `<p>${esc(data.supplierName)}</p>
            ${data.supplierPhone ? `<p>${esc(data.supplierPhone)}</p>` : ''}
            ${data.supplierAddress ? `<p>${esc(data.supplierAddress)}</p>` : ''}`
        : `<p>${esc(labels.noSupplier)}</p>`;

    return `
    <div class="invoice-body">
    <div class="meta-grid">
        <div class="meta-block">
            <h3>${esc(labels.supplier)}</h3>
            ${supplierBlock}
        </div>
        ${!isThermal ? `
        <div class="meta-block">
            <h3>${esc(labels.docTitle)}</h3>
            <p>${esc(labels.purchaseNo)}: <strong>${esc(data.purchaseNumber)}</strong></p>
            <p>${esc(labels.date)}: ${esc(data.date)}</p>
            ${data.storeName ? `<p>${esc(labels.branch)}: ${esc(data.storeName)}</p>` : ''}
            ${data.referenceNumber ? `<p>${esc(data.referenceNumber)}</p>` : ''}
        </div>` : ''}
    </div>

    <hr class="divider">

    <table class="items-table">
        <thead>
            <tr>
                <th class="item-name">${esc(labels.item)}</th>
                <th class="item-qty">${esc(labels.qty)}</th>
                <th class="item-price">${esc(labels.unitCost)}</th>
                <th class="item-total">${esc(labels.lineTotal)}</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
    </table>

    <hr class="divider">

    <div class="totals-wrap">
        <table class="totals-table">
            <tr><td>${esc(labels.subtotal)}</td><td>${formatBDT(data.subtotal)}</td></tr>
            ${data.tax ? `<tr><td>${esc(labels.tax)}</td><td>${formatBDT(data.tax)}</td></tr>` : ''}
            ${data.freight ? `<tr><td>${esc(labels.freight)}</td><td>${formatBDT(data.freight)}</td></tr>` : ''}
            ${data.discount ? `<tr class="neg"><td>${esc(labels.discount)}</td><td>-${formatBDT(data.discount)}</td></tr>` : ''}
            <tr class="grand-total"><td>${esc(labels.total)}</td><td>${formatBDT(data.total)}</td></tr>
        </table>
    </div>

    ${data.payments.length > 0 ? `
    <hr class="divider">
    <div class="payments-section">
        <h3>${esc(labels.payment)}</h3>
        <table class="payments-table">${paymentRows}</table>
    </div>` : ''}

    ${data.note ? `<div class="note-box"><strong>${esc(labels.notePrefix)}</strong> ${esc(data.note)}</div>` : ''}
    </div>`;
}

export function printPurchaseInvoice(
    data: PurchaseInvoiceData,
    paperSize: PaperSize = 'A4',
    preview?: PrintPreviewOptions,
): void {
    const isThermal = paperSize === 'Thermal80' || paperSize === 'Thermal58';

    const headerContext: HeaderContext = {
        docTitle: data.labels.docTitle,
        docNumber: data.purchaseNumber,
        docDate: data.date,
        companyName: data.companyName || 'RETAIL STORE',
    };
    const headerHtml = renderHeaderHtml(data.headerConfig, headerContext, paperSize);

    openPrintWindow({
        context: headerContext,
        title: `${data.labels.docTitle} ${data.purchaseNumber}`,
        paperSize,
        headerConfig: data.headerConfig,
        headerHtml,
        bodyHtml: buildBody(data, isThermal),
        footerHtml: `<div class="footer">${esc(data.labels.footer)}</div>`,
        styles: buildStyles(isThermal),
        repeatHeader: !isThermal,
        compactable: true,
        preview,
    });
}
