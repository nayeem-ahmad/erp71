import { formatBDT } from './format';
import { paymentMethodLabel } from './payment-method-label';
import { openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, HeaderContext, PaperSize, PrintHeaderConfig } from './print';

/**
 * মূসক-৬.৩ · কর চালানপত্র on a thermal roll.
 *
 * The A4 rendering of this form lives in `components/mushak/MushakDocument.tsx`
 * and lays the ten gazetted columns out side by side. That cannot be done at
 * 80mm, let alone 58mm, so this renders the same document as a stacked block
 * per line: description, then quantity × unit value, then the SD and VAT rates
 * with their amounts, then the line's tax-inclusive total.
 *
 * Nothing statutory is dropped to make it fit — a narrow roll changes the
 * layout, never the content. The wording is copied from the A4 form so the two
 * cannot drift into saying different things about the same supply.
 *
 * All figures arrive already computed from `GET /mushak/6.3/:saleId`. This file
 * does no tax arithmetic: `computeSaleTax` on the server is the single source,
 * and duplicating it here is exactly how a printed slip starts disagreeing with
 * the filed return.
 */

export interface MushakReceiptIssuer {
    name: string | null;
    bin: string | null;
    address: string | null;
    economicActivity: string | null;
    officerName: string | null;
    officerDesignation: string | null;
}

export interface MushakReceiptParty {
    name: string | null;
    bin: string | null;
    nid: string | null;
    address: string | null;
}

export interface MushakReceiptLine {
    serial: number;
    description: string;
    sku: string | null;
    unitBn: string;
    unitEn: string;
    quantity: number;
    unitValue: number;
    totalValue: number;
    sdRate: number;
    sdAmount: number;
    vatRate: number;
    vatAmount: number;
    inclusiveTotal: number;
}

export interface MushakReceiptPayment {
    method: string;
    amount: number;
}

export interface MushakReceiptData {
    form: string;
    issuer: MushakReceiptIssuer;
    buyer: MushakReceiptParty;
    invoice: {
        saleId: string;
        number: string;
        serialNumber: string;
        issuedAt: string;
        status: string;
        cancelled: boolean;
        destination: string | null;
        vehicleNo: string | null;
        branch: string | null;
    };
    lines: MushakReceiptLine[];
    totals: { totalValue: number; sdAmount: number; vatAmount: number; inclusiveTotal: number };
    estimated: boolean;
    /** Pre-formatted in the workspace's timezone by the caller. */
    date: string;
    /** Payment lines are not part of the 6.3, but a counter slip needs them. */
    payments?: MushakReceiptPayment[];
    amountPaid?: number;
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    storeName?: string;
}

const MUSHAK_RECEIPT_STYLES = `
    body {
        font-family: 'Courier New', Courier, monospace;
        font-size: 11px;
        color: #000;
    }

    .divider { border: none; border-top: 1px dashed #000; margin: 5px 0; }
    .rule-solid { border: none; border-top: 1px solid #000; margin: 5px 0; }

    .gov { text-align: center; line-height: 1.35; }
    .gov .authority { font-size: 10px; }
    .gov .form-title { font-size: 12px; font-weight: bold; margin-top: 2px; }
    .gov .form-title-en { font-size: 9px; }
    .gov .form-code {
        display: inline-block;
        border: 1px solid #000;
        padding: 1px 5px;
        margin-top: 3px;
        font-size: 11px;
        font-weight: bold;
    }

    .banner {
        border: 1px solid #000;
        text-align: center;
        font-weight: bold;
        font-size: 11px;
        padding: 3px 2px;
        margin: 5px 0;
        text-transform: uppercase;
    }

    .kv { width: 100%; border-collapse: collapse; }
    .kv td { padding: 1px 0; vertical-align: top; font-size: 10px; }
    .kv td:first-child { white-space: nowrap; padding-right: 6px; width: 42%; }
    .kv .val { font-weight: bold; word-break: break-word; }
    .kv .bn { font-size: 9px; }

    .section-label {
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        margin: 5px 0 2px;
    }

    .line-block { padding: 4px 0; border-bottom: 1px dotted #999; }
    .line-head { font-weight: bold; font-size: 11px; word-break: break-word; }
    .line-sku { font-size: 9px; color: #444; }
    .line-grid { width: 100%; border-collapse: collapse; margin-top: 2px; }
    .line-grid td { font-size: 10px; padding: 1px 0; }
    .line-grid td:last-child { text-align: right; white-space: nowrap; }
    .line-total td { font-weight: bold; border-top: 1px dotted #999; padding-top: 2px; }

    .totals { width: 100%; border-collapse: collapse; margin: 4px 0; }
    .totals td { padding: 2px 0; font-size: 11px; }
    .totals td:last-child { text-align: right; font-weight: bold; white-space: nowrap; }
    .totals .grand td {
        font-size: 13px;
        font-weight: bold;
        border-top: 1px solid #000;
        border-bottom: 1px solid #000;
        padding: 3px 0;
    }

    .sign { margin-top: 14px; }
    .sign .sign-line { border-top: 1px solid #000; margin-top: 18px; padding-top: 2px; font-size: 9px; }
    .sign .seal { font-size: 9px; color: #555; margin-top: 6px; }

    .footnote { font-size: 9px; text-align: center; margin-top: 6px; line-height: 1.4; }

    /* 58mm: the same content, tighter. Nothing statutory is removed. */
    .narrow body, body.narrow { font-size: 10px; }
    body.narrow .kv td { font-size: 9px; }
    body.narrow .kv td:first-child { width: 46%; }
    body.narrow .line-grid td { font-size: 9px; }
    body.narrow .totals td { font-size: 10px; }
    body.narrow .totals .grand td { font-size: 12px; }
    body.narrow .gov .form-title { font-size: 11px; }
`;

/** Western digits to Bengali, for the form code the way the gazette prints it. */
function toBengaliDigits(value: string | number): string {
    const digits = '০১২৩৪৫৬৭৮৯';
    return String(value).replace(/\d/g, (d) => digits[Number(d)]);
}

function escHtml(str: string): string {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/** A rate reads better as `15%` than `15.00`, and the gazette prints it so. */
function formatRate(rate: number): string {
    const rounded = Math.round(rate * 100) / 100;
    return `${rounded}%`;
}

/** A bilingual key/value row. Blank values are dropped, not printed empty. */
function kvRow(bn: string, en: string, value: string | null | undefined): string {
    if (!value) return '';
    return `
        <tr>
            <td><span class="bn">${bn}</span><br>${escHtml(en)}</td>
            <td class="val">${escHtml(value)}</td>
        </tr>`;
}

/**
 * The document body, separated from `openPrintWindow` so it can be asserted on
 * directly in tests without a browser print dialog.
 */
export function buildMushakReceiptBody(data: MushakReceiptData, paperSize: PaperSize): string {
    const { issuer, buyer, invoice, lines, totals } = data;

    const lineBlocks = lines.map((line) => `
        <div class="line-block">
            <div class="line-head">${line.serial}. ${escHtml(line.description)}</div>
            ${line.sku ? `<div class="line-sku">${escHtml(line.sku)}</div>` : ''}
            <table class="line-grid">
                <tr>
                    <td><span class="bn">পরিমাণ</span> Qty (${escHtml(line.unitEn)}) × <span class="bn">একক মূল্য</span></td>
                    <td>${line.quantity} × ${formatBDT(line.unitValue)}</td>
                </tr>
                <tr>
                    <td><span class="bn">মোট মূল্য</span> Total value</td>
                    <td>${formatBDT(line.totalValue)}</td>
                </tr>
                ${line.sdAmount > 0 || line.sdRate > 0 ? `
                <tr>
                    <td><span class="bn">সম্পূরক শুল্ক</span> SD @ ${formatRate(line.sdRate)}</td>
                    <td>${formatBDT(line.sdAmount)}</td>
                </tr>` : ''}
                <tr>
                    <td><span class="bn">মূসক</span> VAT @ ${formatRate(line.vatRate)}</td>
                    <td>${formatBDT(line.vatAmount)}</td>
                </tr>
                <tr class="line-total">
                    <td><span class="bn">শুল্ক ও করসহ মূল্য</span> Incl. tax</td>
                    <td>${formatBDT(line.inclusiveTotal)}</td>
                </tr>
            </table>
        </div>`).join('');

    const paymentRows = (data.payments ?? []).map((p) => `
        <tr>
            <td>${escHtml(paymentMethodLabel(p.method))}</td>
            <td>${formatBDT(p.amount)}</td>
        </tr>`).join('');

    const hasDelivery = Boolean(invoice.destination || invoice.vehicleNo);

    return `
    <div class="gov">
        <div class="authority">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</div>
        <div class="authority">জাতীয় রাজস্ব বোর্ড</div>
        <div class="form-title">কর চালানপত্র</div>
        <div class="form-title-en">Tax Invoice</div>
        <div class="form-code">মূসক-${toBengaliDigits(data.form)}</div>
    </div>

    ${invoice.cancelled ? '<div class="banner">Cancelled / বাতিল</div>' : ''}
    ${data.estimated ? '<div class="banner">Estimated — reconstructed figures</div>' : ''}

    <hr class="rule-solid">

    <div class="section-label">Issued by / সরবরাহকারী</div>
    <table class="kv">
        ${kvRow('নিবন্ধিত ব্যক্তির নাম', 'Registered person', issuer.name)}
        ${kvRow('বিআইএন', 'BIN', issuer.bin)}
        ${kvRow('চালানপত্র ইস্যুর ঠিকানা', 'Address of issue', issuer.address)}
        ${kvRow('অর্থনৈতিক কার্যক্রম', 'Economic activity', issuer.economicActivity)}
    </table>

    <hr class="divider">

    <div class="section-label">Supplied to / ক্রেতা</div>
    <table class="kv">
        ${kvRow('নাম', 'Name', buyer.name)}
        ${kvRow('বিআইএন', 'BIN', buyer.bin)}
        ${kvRow('জাতীয় পরিচয়পত্র নম্বর', 'NID', buyer.nid)}
        ${kvRow('ঠিকানা', 'Address', buyer.address)}
    </table>

    <hr class="divider">

    <table class="kv">
        ${kvRow('চালানপত্র নম্বর', 'Invoice no.', invoice.number)}
        ${kvRow('ইস্যুর তারিখ ও সময়', 'Date & time of issue', data.date)}
        ${hasDelivery ? kvRow('গন্তব্যস্থল', 'Destination', invoice.destination) : ''}
        ${hasDelivery ? kvRow('যানবাহনের প্রকৃতি ও নম্বর', 'Vehicle', invoice.vehicleNo) : ''}
    </table>

    <hr class="rule-solid">

    <div class="section-label">Supplies / সরবরাহ</div>
    ${lineBlocks}

    <table class="totals">
        <tr>
            <td><span class="bn">মোট মূল্য</span> Total value</td>
            <td>${formatBDT(totals.totalValue)}</td>
        </tr>
        ${totals.sdAmount > 0 ? `
        <tr>
            <td><span class="bn">সম্পূরক শুল্ক</span> Supplementary duty</td>
            <td>${formatBDT(totals.sdAmount)}</td>
        </tr>` : ''}
        <tr>
            <td><span class="bn">মূসক</span> VAT</td>
            <td>${formatBDT(totals.vatAmount)}</td>
        </tr>
        <tr class="grand">
            <td><span class="bn">সর্বমোট</span> TOTAL</td>
            <td>${formatBDT(totals.inclusiveTotal)}</td>
        </tr>
    </table>

    ${paymentRows ? `
    <table class="totals">
        ${paymentRows}
        ${typeof data.amountPaid === 'number' ? `
        <tr>
            <td>${data.amountPaid >= totals.inclusiveTotal ? 'Change' : 'Balance Due'}</td>
            <td>${formatBDT(Math.abs(data.amountPaid - totals.inclusiveTotal))}</td>
        </tr>` : ''}
    </table>` : ''}

    <div class="sign">
        <div class="sign-line">
            প্রতিষ্ঠানের দায়িত্বপ্রাপ্ত ব্যক্তির স্বাক্ষর (Authorised signature)
        </div>
        <table class="kv">
            ${kvRow('নাম', 'Name', issuer.officerName)}
            ${kvRow('পদবি', 'Designation', issuer.officerDesignation)}
        </table>
        <div class="seal">সীলমোহর (Seal)</div>
    </div>`;
}

export async function printMushakReceipt(
    data: MushakReceiptData,
    paperSize: PaperSize = 'Thermal80',
): Promise<void> {
    const headerContext: HeaderContext = {
        docTitle: 'Mushak 6.3 — Tax Invoice',
        companyName: data.issuer.name || data.storeName || 'RETAIL STORE',
        storeName: data.storeName,
    };

    openPrintWindow({
        context: headerContext,
        title: `Mushak 6.3 ${data.invoice.serialNumber}`,
        paperSize,
        headerConfig: data.headerConfig,
        // The statutory form carries its own issuer block, so the tenant's
        // branded print header is deliberately omitted: two competing headers
        // on a 58mm roll is how the BIN ends up scrolled off the top.
        headerHtml: '',
        bodyHtml: buildMushakReceiptBody(data, paperSize),
        footerHtml: '',
        styles: MUSHAK_RECEIPT_STYLES,
    });
}
