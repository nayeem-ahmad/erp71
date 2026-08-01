import { formatBDT } from './format';
import { openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, PaperSize, PrintHeaderConfig } from './print';

export interface VoucherPrintLine {
    accountName: string;
    accountCode?: string | null;
    debit: number;
    credit: number;
    comment?: string | null;
}

export interface VoucherPrintData {
    businessName?: string;
    /** Tenant header design; falls back to the built-in default when omitted. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    voucherNumber: string;
    voucherType: string;
    date: string;
    referenceNumber?: string | null;
    description?: string | null;
    totalAmount: number;
    lines: VoucherPrintLine[];
    labels: {
        title: string;
        voucherNumber: string;
        date: string;
        type: string;
        reference: string;
        narration: string;
        account: string;
        debit: string;
        credit: string;
        total: string;
        footer: string;
    };
}

const VOUCHER_STYLES = `
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
    .meta { width: 100%; margin-bottom: 16px; }
    .meta td { padding: 3px 0; vertical-align: top; }
    .meta .label { color: #666; width: 110px; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.lines th, table.lines td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    table.lines th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; }
    .num { text-align: right; white-space: nowrap; }
    .muted { color: #666; font-size: 10px; }
    .total { margin-top: 12px; text-align: right; font-weight: bold; }
    .footer { margin-top: 24px; text-align: center; color: #666; font-size: 10px; }
`;

function escHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

export function printVoucher(data: VoucherPrintData, paperSize: PaperSize = 'A4'): void {
    const linesHtml = data.lines.map((line) => `
        <tr>
            <td>${escHtml(line.accountName)}${line.accountCode ? ` <span class="muted">(${escHtml(line.accountCode)})</span>` : ''}</td>
            <td class="num">${line.debit > 0 ? escHtml(formatBDT(line.debit)) : ''}</td>
            <td class="num">${line.credit > 0 ? escHtml(formatBDT(line.credit)) : ''}</td>
        </tr>
    `).join('');

    const headerHtml = renderHeaderHtml(
        data.headerConfig,
        {
            docTitle: data.labels.title,
            companyName: data.businessName,
        },
        paperSize,
    );

    const bodyHtml = `
    <table class="meta">
        <tr><td class="label">${escHtml(data.labels.voucherNumber)}</td><td>${escHtml(data.voucherNumber)}</td></tr>
        <tr><td class="label">${escHtml(data.labels.date)}</td><td>${escHtml(data.date)}</td></tr>
        <tr><td class="label">${escHtml(data.labels.type)}</td><td>${escHtml(data.voucherType.replaceAll('_', ' '))}</td></tr>
        ${data.referenceNumber ? `<tr><td class="label">${escHtml(data.labels.reference)}</td><td>${escHtml(data.referenceNumber)}</td></tr>` : ''}
        ${data.description ? `<tr><td class="label">${escHtml(data.labels.narration)}</td><td>${escHtml(data.description)}</td></tr>` : ''}
    </table>
    <table class="lines">
        <thead>
            <tr>
                <th>${escHtml(data.labels.account)}</th>
                <th class="num">${escHtml(data.labels.debit)}</th>
                <th class="num">${escHtml(data.labels.credit)}</th>
            </tr>
        </thead>
        <tbody>${linesHtml}</tbody>
    </table>
    <div class="total">${escHtml(data.labels.total)}: ${escHtml(formatBDT(data.totalAmount))}</div>`;

    openPrintWindow({
        title: `${data.labels.title} ${data.voucherNumber}`,
        paperSize,
        headerConfig: data.headerConfig,
        headerHtml,
        bodyHtml,
        footerHtml: `<div class="footer">${escHtml(data.labels.footer)}</div>`,
        styles: VOUCHER_STYLES,
        repeatHeader: true,
    });
}
