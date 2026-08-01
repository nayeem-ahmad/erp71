import { formatBDT } from './format';
import { MONEY_RECEIPT_STYLES } from './customer-payment-receipt';
import { openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, PaperSize, PrintHeaderConfig } from './print';

export interface SupplierPaymentReceiptData {
    businessName?: string;
    /** Tenant header design; falls back to the built-in default when omitted. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    paymentNumber: string;
    date: string;
    direction: 'pay' | 'receive';
    supplierName: string;
    supplierPhone?: string;
    amount: number;
    balanceAfter?: number;
    notes?: string;
    recordedBy?: string;
    labels: {
        paymentVoucher: string;
        moneyReceipt: string;
        serial: string;
        date: string;
        supplier: string;
        amount: string;
        balanceAfter: string;
        notes: string;
        recordedBy: string;
        payTitle: string;
        receiveTitle: string;
        footer: string;
    };
}

export function printSupplierPaymentReceipt(
    data: SupplierPaymentReceiptData,
    paperSize: PaperSize = 'Thermal80',
): void {
    const isPay = data.direction === 'pay';
    const title = isPay ? data.labels.paymentVoucher : data.labels.moneyReceipt;
    const subtitle = isPay ? data.labels.payTitle : data.labels.receiveTitle;

    const headerHtml = renderHeaderHtml(
        data.headerConfig,
        {
            docTitle: title,
            companyName: data.businessName || 'RETAIL STORE',
        },
        paperSize,
    );

    const bodyHtml = `
    <div class="doc-subtitle">${escHtml(subtitle)}</div>
    <hr class="divider">
    <table class="info-table">
        <tr><td>${escHtml(data.labels.serial)}</td><td>${escHtml(data.paymentNumber)}</td></tr>
        <tr><td>${escHtml(data.labels.date)}</td><td>${escHtml(data.date)}</td></tr>
        <tr><td>${escHtml(data.labels.supplier)}</td><td>${escHtml(data.supplierName)}${data.supplierPhone ? `<br>${escHtml(data.supplierPhone)}` : ''}</td></tr>
        ${data.recordedBy ? `<tr><td>${escHtml(data.labels.recordedBy)}</td><td>${escHtml(data.recordedBy)}</td></tr>` : ''}
    </table>
    <div class="amount-box">
        <div class="amount-label">${escHtml(data.labels.amount)}</div>
        <div class="amount-value">${formatBDT(data.amount)}</div>
    </div>
    ${data.balanceAfter !== undefined ? `<table class="info-table"><tr><td>${escHtml(data.labels.balanceAfter)}</td><td>${formatBDT(data.balanceAfter)}</td></tr></table>` : ''}
    ${data.notes ? `<div class="note-box">${escHtml(data.labels.notes)}: ${escHtml(data.notes)}</div>` : ''}
    <div class="signatures">
        <div class="signature"><div class="signature-line">${escHtml(data.labels.supplier)}</div></div>
        <div class="signature"><div class="signature-line">${escHtml(data.labels.recordedBy)}</div></div>
    </div>`;

    openPrintWindow({
        title: `${title} ${data.paymentNumber}`,
        paperSize,
        headerConfig: data.headerConfig,
        headerHtml,
        bodyHtml,
        footerHtml: `<div class="footer">${escHtml(data.labels.footer)}</div>`,
        styles: MONEY_RECEIPT_STYLES,
    });
}

function escHtml(str: string): string {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
