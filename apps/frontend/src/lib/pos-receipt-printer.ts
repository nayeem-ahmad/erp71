import * as QRCode from 'qrcode';
import { formatBDT } from './format';
import { openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, PaperSize, PrintHeaderConfig } from './print';

export interface ReceiptItem {
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
}

export interface ReceiptPayment {
    method: string;
    amount: number;
}

export interface ReceiptData {
    invoiceId: string;
    serialNumber: string;
    date: string;
    storeName?: string;
    /** Tenant header design; falls back to the built-in default when omitted. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    customerName?: string;
    items: ReceiptItem[];
    payments: ReceiptPayment[];
    subtotal: number;
    tax: number;
    total: number;
    amountPaid: number;
    changeDue?: number;
    note?: string;
}

const RECEIPT_STYLES = `
    body {
        font-family: 'Courier New', Courier, monospace;
        font-size: 12px;
        color: #000;
    }

    .divider { border: none; border-top: 1px dashed #000; margin: 6px 0; }

    .invoice-info { margin: 6px 0; }
    .invoice-info tr td:first-child { font-weight: bold; padding-right: 8px; white-space: nowrap; }

    .items-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    .items-table thead tr td {
        font-weight: bold;
        font-size: 10px;
        text-transform: uppercase;
        border-bottom: 1px solid #000;
        padding-bottom: 3px;
        letter-spacing: 0.5px;
    }
    .item-name { width: 45%; }
    .item-qty  { width: 10%; text-align: center; }
    .item-price { width: 22%; text-align: right; }
    .item-total { width: 23%; text-align: right; }
    .items-table tbody tr td { padding: 3px 0; vertical-align: top; }
    .sku { font-size: 9px; color: #666; }

    .totals-table { width: 100%; border-collapse: collapse; margin: 4px 0; }
    .totals-table td { padding: 2px 0; }
    .totals-table td:first-child { color: #444; }
    .totals-table td:last-child { text-align: right; font-weight: bold; }
    .grand-total td { font-size: 14px; font-weight: bold; border-top: 1px solid #000; padding-top: 4px; }

    .payments-table { width: 100%; border-collapse: collapse; margin: 4px 0; }
    .pay-method { color: #444; }
    .pay-amount { text-align: right; font-weight: bold; }
    .change-row { font-weight: bold; }
    .change-row td { padding-top: 3px; }

    .note-box { border: 1px dashed #aaa; padding: 5px 6px; margin: 6px 0; font-size: 11px; color: #333; }

    .qr-section { text-align: center; margin: 10px 0 4px; }
    .qr-section img { display: block; margin: 0 auto 4px; }
    .qr-label { font-size: 9px; color: #666; letter-spacing: 0.5px; text-transform: uppercase; }
    .qr-id { font-size: 8px; color: #888; word-break: break-all; margin-top: 2px; }

    .footer { text-align: center; font-size: 11px; margin-top: 10px; letter-spacing: 0.5px; }
`;

export async function printPOSReceipt(
    data: ReceiptData,
    paperSize: PaperSize = 'Thermal80',
): Promise<void> {
    const qrDataUrl = await QRCode.toDataURL(data.invoiceId, {
        width: 140,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
    });

    const itemRows = data.items.map(item => `
        <tr>
            <td class="item-name">${escHtml(item.name)}${item.sku ? `<br><span class="sku">${escHtml(item.sku)}</span>` : ''}</td>
            <td class="item-qty">${item.quantity}</td>
            <td class="item-price">${formatBDT(item.unitPrice)}</td>
            <td class="item-total">${formatBDT(item.quantity * item.unitPrice)}</td>
        </tr>
    `).join('');

    const paymentRows = data.payments.map(p => `
        <tr>
            <td class="pay-method">${escHtml(formatPaymentMethod(p.method))}</td>
            <td class="pay-amount">${formatBDT(p.amount)}</td>
        </tr>
    `).join('');

    const headerHtml = renderHeaderHtml(
        data.headerConfig,
        {
            docTitle: 'Sales Invoice',
            companyName: data.storeName || 'RETAIL STORE',
            storeName: data.storeName,
        },
        paperSize,
    );

    const bodyHtml = `
    <hr class="divider">

    <table class="invoice-info">
        <tr><td>Invoice#</td><td>${escHtml(data.serialNumber)}</td></tr>
        <tr><td>Date</td><td>${escHtml(data.date)}</td></tr>
        ${data.customerName ? `<tr><td>Customer</td><td>${escHtml(data.customerName)}</td></tr>` : ''}
    </table>

    <hr class="divider">

    <table class="items-table">
        <thead>
            <tr>
                <td class="item-name">Item</td>
                <td class="item-qty">Qty</td>
                <td class="item-price">Price</td>
                <td class="item-total">Total</td>
            </tr>
        </thead>
        <tbody>
            ${itemRows}
        </tbody>
    </table>

    <hr class="divider">

    <table class="totals-table">
        <tr><td>Subtotal</td><td>${formatBDT(data.subtotal)}</td></tr>
        <tr><td>Tax</td><td>${formatBDT(data.tax)}</td></tr>
        <tr class="grand-total"><td>TOTAL</td><td>${formatBDT(data.total)}</td></tr>
    </table>

    <hr class="divider">

    <table class="payments-table">
        ${paymentRows}
        <tr class="change-row">
            <td>${data.amountPaid >= data.total ? 'Change' : 'Balance Due'}</td>
            <td class="pay-amount">${formatBDT(Math.abs(data.amountPaid - data.total))}</td>
        </tr>
    </table>

    ${data.note ? `<div class="note-box">Note: ${escHtml(data.note)}</div>` : ''}

    <hr class="divider">

    <div class="qr-section">
        <img src="${qrDataUrl}" width="140" height="140" alt="Invoice QR Code">
        <div class="qr-label">Scan to verify invoice</div>
        <div class="qr-id">${escHtml(data.invoiceId)}</div>
    </div>

    <hr class="divider">`;

    openPrintWindow({
        title: `Receipt ${data.serialNumber}`,
        paperSize,
        headerConfig: data.headerConfig,
        headerHtml,
        bodyHtml,
        footerHtml: '<div class="footer">*** Thank you for your purchase! ***</div>',
        styles: RECEIPT_STYLES,
    });
}

function escHtml(str: string): string {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function formatPaymentMethod(method: string): string {
    const map: Record<string, string> = {
        CASH: 'Cash',
        CARD: 'Credit Card',
        BKASH: 'bKash',
        BANK_TRANSFER: 'Bank Transfer',
        MOBILE_PAYMENT: 'Mobile Payment',
        OTHER: 'Other',
    };
    return map[method] ?? method;
}
