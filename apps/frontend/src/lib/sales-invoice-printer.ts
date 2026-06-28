import { formatBDT } from './format';

export type PaperSize = 'A4' | 'A5' | 'Letter' | 'Thermal80' | 'Thermal58';

export const PAPER_SIZES: PaperSize[] = ['A4', 'A5', 'Letter', 'Thermal80', 'Thermal58'];

export interface InvoiceItem {
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    discount?: number; // discount amount for this line
}

export interface InvoicePayment {
    method: string;
    amount: number;
}

export interface InvoiceData {
    referenceNumber: string;
    date: string;
    companyName?: string;
    companyAddress?: string;
    companyPhone?: string;
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    items: InvoiceItem[];
    payments: InvoicePayment[];
    subtotal: number;
    discountAmount?: number;
    discountPercent?: number;
    vat?: number;
    transportCost?: number;
    laborCost?: number;
    rounding?: number;
    total: number;
    note?: string;
}

const PAGE_CSS: Record<PaperSize, string> = {
    A4:        '@page { size: A4 portrait; margin: 15mm; }',
    A5:        '@page { size: A5 portrait; margin: 10mm; }',
    Letter:    '@page { size: letter portrait; margin: 15mm; }',
    Thermal80: '@page { size: 80mm auto; margin: 4mm; }',
    Thermal58: '@page { size: 58mm auto; margin: 3mm; }',
};

function esc(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function paymentLabel(method: string): string {
    const map: Record<string, string> = {
        CASH: 'Cash',
        CARD: 'Credit Card',
        BKASH: 'bKash',
        NAGAD: 'Nagad',
        BANK_TRANSFER: 'Bank Transfer',
        MOBILE_PAYMENT: 'Mobile Payment',
        OTHER: 'Other',
    };
    return map[method] ?? method;
}

function buildHtml(data: InvoiceData, paperSize: PaperSize): string {
    const isThermal = paperSize === 'Thermal80' || paperSize === 'Thermal58';

    const itemRows = data.items.map((item) => {
        const lineTotal = item.quantity * item.unitPrice - (item.discount ?? 0);
        return `<tr>
            <td class="item-name">${esc(item.name)}${item.sku ? `<br><span class="sku">${esc(item.sku)}</span>` : ''}</td>
            <td class="item-qty">${item.quantity}</td>
            <td class="item-price">${formatBDT(item.unitPrice)}</td>
            <td class="item-disc">${item.discount ? formatBDT(item.discount) : '—'}</td>
            <td class="item-total">${formatBDT(lineTotal)}</td>
        </tr>`;
    }).join('');

    const paymentRows = data.payments.map((p) =>
        `<tr><td class="pay-label">${esc(paymentLabel(p.method))}</td><td class="pay-amount">${formatBDT(p.amount)}</td></tr>`
    ).join('');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice ${esc(data.referenceNumber)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: ${isThermal ? "'Courier New', Courier, monospace" : 'Arial, Helvetica, sans-serif'};
            font-size: ${isThermal ? '11px' : '13px'};
            color: #111;
            background: #fff;
        }
        .wrap { padding: ${isThermal ? '6px' : '0'}; max-width: ${isThermal ? '100%' : '780px'}; margin: 0 auto; }

        /* Header */
        .inv-header {
            ${isThermal
                ? 'text-align: center; margin-bottom: 6px;'
                : 'display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1d4ed8; padding-bottom:16px; margin-bottom:20px;'}
        }
        .company-name { font-size:${isThermal ? '15px' : '22px'}; font-weight:bold; ${isThermal ? '' : 'color:#1d4ed8;'} margin-bottom:3px; }
        .company-sub  { font-size:${isThermal ? '10px' : '12px'}; color:#555; }
        .inv-title    { font-size:${isThermal ? '13px' : '28px'}; font-weight:bold; ${isThermal ? 'margin:3px 0;' : 'color:#1d4ed8; text-align:right; letter-spacing:2px;'} }
        .inv-ref      { font-size:${isThermal ? '10px' : '13px'}; color:#555; ${isThermal ? 'text-align:center;' : 'text-align:right; margin-top:3px;'} }

        /* Meta grid */
        .meta-grid { ${isThermal ? 'margin:4px 0;' : 'display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;'} }
        .meta-block { ${isThermal ? 'margin:3px 0;' : 'background:#f8fafc; border-radius:8px; padding:12px 16px;'} }
        .meta-block h3 { font-size:${isThermal ? '10px' : '11px'}; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${isThermal ? '#444' : '#6b7280'}; margin-bottom:5px; }
        .meta-block p  { font-size:${isThermal ? '10px' : '13px'}; color:#222; margin-bottom:2px; }

        /* Divider */
        .divider { border:none; border-top:1px ${isThermal ? 'dashed #000' : 'solid #e5e7eb'}; margin:${isThermal ? '6px 0' : '0 0 20px 0'}; }

        /* Items table */
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
        .item-name  { width:${isThermal ? '40%' : '36%'}; }
        .item-qty   { width:${isThermal ? '10%' : '8%'}; text-align:center; }
        .item-price { width:${isThermal ? '18%' : '16%'}; text-align:right; }
        .item-disc  { width:${isThermal ? '15%' : '18%'}; text-align:right; color:#ef4444; }
        .item-total { width:${isThermal ? '17%' : '18%'}; text-align:right; font-weight:bold; }
        .sku        { font-size:9px; color:#888; }

        /* Totals */
        .totals-wrap { ${isThermal ? '' : 'display:flex; justify-content:flex-end; margin-bottom:20px;'} }
        .totals-table { width:${isThermal ? '100%' : '300px'}; border-collapse:collapse; }
        .totals-table td { padding:${isThermal ? '2px 0' : '5px 10px'}; font-size:${isThermal ? '10px' : '13px'}; }
        .totals-table td:last-child { text-align:right; font-weight:bold; }
        .totals-table .neg td:last-child { color:#ef4444; }
        .grand-total td {
            font-size:${isThermal ? '13px' : '15px'}; font-weight:bold;
            border-top:2px solid ${isThermal ? '#000' : '#1d4ed8'};
            padding-top:${isThermal ? '4px' : '8px'};
            color:${isThermal ? '#000' : '#1d4ed8'};
        }

        /* Payments */
        .payments-section { ${isThermal ? 'margin:6px 0;' : 'background:#f8fafc; border-radius:8px; padding:12px 16px; margin-bottom:20px;'} }
        .payments-section h3 { font-size:${isThermal ? '10px' : '11px'}; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${isThermal ? '#444' : '#6b7280'}; margin-bottom:5px; }
        .payments-table { width:100%; border-collapse:collapse; }
        .pay-label  { font-size:${isThermal ? '10px' : '13px'}; color:#444; padding:${isThermal ? '2px 0' : '3px 0'}; }
        .pay-amount { text-align:right; font-weight:bold; font-size:${isThermal ? '10px' : '13px'}; padding:${isThermal ? '2px 0' : '3px 0'}; }

        /* Note */
        .note-box {
            font-size:${isThermal ? '10px' : '12px'}; color:#555;
            ${isThermal
                ? 'border:1px dashed #aaa; padding:4px 6px; margin:6px 0;'
                : 'background:#fef9c3; border:1px solid #fde68a; border-radius:6px; padding:10px 14px; margin-bottom:20px;'}
        }

        .footer { text-align:center; font-size:${isThermal ? '10px' : '12px'}; color:#888; margin-top:${isThermal ? '10px' : '24px'}; ${isThermal ? '' : 'border-top:1px solid #e5e7eb; padding-top:14px;'} }

        ${PAGE_CSS[paperSize]}
        @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
    </style>
</head>
<body>
<div class="wrap">

    <div class="inv-header">
        <div>
            <div class="company-name">${esc(data.companyName || 'RETAIL STORE')}</div>
            ${data.companyAddress ? `<div class="company-sub">${esc(data.companyAddress)}</div>` : ''}
            ${data.companyPhone ? `<div class="company-sub">Tel: ${esc(data.companyPhone)}</div>` : ''}
        </div>
        ${isThermal
            ? `<div class="inv-title">INVOICE</div>
               <div class="inv-ref"># ${esc(data.referenceNumber)}</div>
               <div class="inv-ref">${esc(data.date)}</div>`
            : `<div>
                 <div class="inv-title">INVOICE</div>
                 <div class="inv-ref"># ${esc(data.referenceNumber)}</div>
                 <div class="inv-ref">Date: ${esc(data.date)}</div>
               </div>`
        }
    </div>

    ${isThermal ? '<hr class="divider">' : ''}

    <div class="meta-grid">
        ${data.customerName ? `
        <div class="meta-block">
            <h3>Bill To</h3>
            <p>${esc(data.customerName)}</p>
            ${data.customerPhone ? `<p>${esc(data.customerPhone)}</p>` : ''}
            ${data.customerAddress ? `<p>${esc(data.customerAddress)}</p>` : ''}
        </div>` : ''}
        ${!isThermal ? `
        <div class="meta-block">
            <h3>Invoice Details</h3>
            <p>Invoice #: <strong>${esc(data.referenceNumber)}</strong></p>
            <p>Date: ${esc(data.date)}</p>
        </div>` : ''}
    </div>

    <hr class="divider">

    <table class="items-table">
        <thead>
            <tr>
                <th class="item-name">Item</th>
                <th class="item-qty">Qty</th>
                <th class="item-price">Unit Price</th>
                <th class="item-disc">Discount</th>
                <th class="item-total">Total</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
    </table>

    <hr class="divider">

    <div class="totals-wrap">
        <table class="totals-table">
            <tr><td>Subtotal</td><td>${formatBDT(data.subtotal)}</td></tr>
            ${data.discountAmount ? `<tr class="neg"><td>Discount${data.discountPercent ? ` (${data.discountPercent}%)` : ''}</td><td>-${formatBDT(data.discountAmount)}</td></tr>` : ''}
            ${data.vat ? `<tr><td>VAT</td><td>${formatBDT(data.vat)}</td></tr>` : ''}
            ${data.transportCost ? `<tr><td>Transport</td><td>${formatBDT(data.transportCost)}</td></tr>` : ''}
            ${data.laborCost ? `<tr><td>Labour</td><td>${formatBDT(data.laborCost)}</td></tr>` : ''}
            ${data.rounding ? `<tr><td>Rounding</td><td>${formatBDT(data.rounding)}</td></tr>` : ''}
            <tr class="grand-total"><td>TOTAL</td><td>${formatBDT(data.total)}</td></tr>
        </table>
    </div>

    <hr class="divider">

    <div class="payments-section">
        <h3>Payment</h3>
        <table class="payments-table">${paymentRows}</table>
    </div>

    ${data.note ? `<div class="note-box"><strong>Note:</strong> ${esc(data.note)}</div>` : ''}

    <div class="footer">Thank you for your business!</div>
</div>
<script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
}

export function printSalesInvoice(data: InvoiceData, paperSize: PaperSize = 'A4'): void {
    const isThermal = paperSize === 'Thermal80' || paperSize === 'Thermal58';
    const width = isThermal
        ? (paperSize === 'Thermal58' ? '320' : '420')
        : paperSize === 'A5' ? '670' : '950';
    const height = isThermal ? '700' : paperSize === 'A5' ? '600' : '850';

    const html = buildHtml(data, paperSize);
    const win = window.open('', '_blank', `width=${width},height=${height}`);
    if (!win) return;
    win.document.write(html);
    win.document.close();
}
