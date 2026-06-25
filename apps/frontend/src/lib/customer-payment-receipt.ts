import { formatBDT } from './format';

export interface CustomerPaymentReceiptData {
    businessName?: string;
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

export function printCustomerPaymentReceipt(data: CustomerPaymentReceiptData): void {
    const isPayout = data.direction === 'pay';
    const title = isPayout ? data.labels.paymentVoucher : data.labels.moneyReceipt;
    const subtitle = isPayout ? data.labels.payTitle : data.labels.receiveTitle;

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escHtml(title)} ${escHtml(data.paymentNumber)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            color: #000;
            background: #fff;
            padding: 12px;
            width: 320px;
        }
        .business-name {
            text-align: center;
            font-size: 16px;
            font-weight: bold;
            letter-spacing: 1px;
            margin-bottom: 2px;
        }
        .doc-title {
            text-align: center;
            font-size: 13px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 2px;
        }
        .doc-subtitle {
            text-align: center;
            font-size: 10px;
            color: #555;
            margin-bottom: 8px;
        }
        .divider {
            border: none;
            border-top: 1px dashed #000;
            margin: 8px 0;
        }
        .info-table {
            width: 100%;
            border-collapse: collapse;
            margin: 6px 0;
        }
        .info-table td {
            padding: 3px 0;
            vertical-align: top;
        }
        .info-table td:first-child {
            font-weight: bold;
            width: 38%;
            padding-right: 8px;
        }
        .amount-box {
            border: 2px solid #000;
            padding: 10px;
            margin: 10px 0;
            text-align: center;
        }
        .amount-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #444;
        }
        .amount-value {
            font-size: 20px;
            font-weight: bold;
            margin-top: 4px;
        }
        .note-box {
            border: 1px dashed #aaa;
            padding: 6px;
            margin: 8px 0;
            font-size: 11px;
            color: #333;
        }
        .footer {
            text-align: center;
            font-size: 10px;
            margin-top: 16px;
            color: #555;
        }
        .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 28px;
            gap: 16px;
        }
        .signature {
            flex: 1;
            text-align: center;
            font-size: 10px;
        }
        .signature-line {
            border-top: 1px solid #000;
            margin-top: 32px;
            padding-top: 4px;
        }
        @media print {
            body { width: 100%; padding: 0; }
            @page { margin: 6mm; size: 80mm auto; }
        }
    </style>
</head>
<body>
    <div class="business-name">${escHtml(data.businessName || 'RETAIL STORE')}</div>
    <div class="doc-title">${escHtml(title)}</div>
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
    </div>

    <div class="footer">${escHtml(data.labels.footer)}</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=400,height=700');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
}

function escHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}