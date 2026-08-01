import { formatBDT } from './format';
import { openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, PaperSize, PrintHeaderConfig } from './print';

export interface CustomerPaymentReceiptData {
    businessName?: string;
    /** Tenant header design; falls back to the built-in default when omitted. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    paymentNumber: string;
    date: string;
    direction: 'receive' | 'pay';
    customerName: string;
    customerPhone?: string;
    customerCode?: string;
    amount: number;
    balanceAfter?: number;
    notes?: string;
    recordedBy?: string;
    voucherNumber?: string | null;
    labels: {
        moneyReceipt: string;
        paymentVoucher: string;
        serial: string;
        date: string;
        customer: string;
        amount: string;
        balanceAfter: string;
        notes: string;
        recordedBy: string;
        voucher: string;
        receiveTitle: string;
        payTitle: string;
        footer: string;
    };
}

export const MONEY_RECEIPT_STYLES = `
    body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; }
    .doc-subtitle { text-align: center; font-size: 10px; color: #555; margin-bottom: 8px; }
    .divider { border: none; border-top: 1px dashed #000; margin: 8px 0; }
    .info-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    .info-table td { padding: 3px 0; vertical-align: top; }
    .info-table td:first-child { font-weight: bold; width: 38%; padding-right: 8px; }
    .amount-box { border: 2px solid #000; padding: 10px; margin: 10px 0; text-align: center; }
    .amount-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #444; }
    .amount-value { font-size: 20px; font-weight: bold; margin-top: 4px; }
    .note-box { border: 1px dashed #aaa; padding: 6px; margin: 8px 0; font-size: 11px; color: #333; }
    .footer { text-align: center; font-size: 10px; margin-top: 16px; color: #555; }
    .signatures { display: flex; justify-content: space-between; margin-top: 28px; gap: 16px; }
    .signature { flex: 1; text-align: center; font-size: 10px; }
    .signature-line { border-top: 1px solid #000; margin-top: 32px; padding-top: 4px; }
`;

export function printCustomerPaymentReceipt(
    data: CustomerPaymentReceiptData,
    paperSize: PaperSize = 'Thermal80',
): void {
    const isPayout = data.direction === 'pay';
    const title = isPayout ? data.labels.paymentVoucher : data.labels.moneyReceipt;
    const subtitle = isPayout ? data.labels.payTitle : data.labels.receiveTitle;

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
        <tr>
            <td>${escHtml(data.labels.customer)}</td>
            <td>
                ${escHtml(data.customerName)}
                ${data.customerPhone ? `<br>${escHtml(data.customerPhone)}` : ''}
                ${data.customerCode ? `<br>${escHtml(data.customerCode)}` : ''}
            </td>
        </tr>
        ${data.recordedBy ? `<tr><td>${escHtml(data.labels.recordedBy)}</td><td>${escHtml(data.recordedBy)}</td></tr>` : ''}
        ${data.voucherNumber ? `<tr><td>${escHtml(data.labels.voucher)}</td><td>${escHtml(data.voucherNumber)}</td></tr>` : ''}
    </table>

    <div class="amount-box">
        <div class="amount-label">${escHtml(data.labels.amount)}</div>
        <div class="amount-value">${formatBDT(data.amount)}</div>
    </div>

    ${data.balanceAfter !== undefined ? `
    <table class="info-table">
        <tr><td>${escHtml(data.labels.balanceAfter)}</td><td>${formatBDT(data.balanceAfter)}</td></tr>
    </table>
    ` : ''}

    ${data.notes ? `<div class="note-box">${escHtml(data.labels.notes)}: ${escHtml(data.notes)}</div>` : ''}

    <div class="signatures">
        <div class="signature">
            <div class="signature-line">${escHtml(data.labels.customer)}</div>
        </div>
        <div class="signature">
            <div class="signature-line">${escHtml(data.labels.recordedBy)}</div>
        </div>
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
