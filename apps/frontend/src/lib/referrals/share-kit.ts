import * as QRCode from 'qrcode';
import { openPrintWindow } from '@/lib/print';

/**
 * The things a referral partner actually does with their link.
 *
 * Copy-to-clipboard is a desktop assumption. The partner this programme is built
 * for walks into a shop or forwards a message on WhatsApp, so the two artefacts
 * that matter are a message they can send and a code someone can point a phone at.
 * Both are built here rather than in the page so the pitch, the QR and the printed
 * sheet cannot drift from one another.
 */

export interface OnePagerLabels {
    title: string;
    intro: string;
    codeLabel: string;
    linkLabel: string;
    scanHint: string;
    discountLine: string;
    contactLine: string;
}

export function buildSignupUrl(origin: string, referralCode: string): string {
    // /r/<code> records the click, then forwards to /signup?ref=<code>.
    return `${origin}/r/${encodeURIComponent(referralCode)}`;
}

export function buildPitch(template: string, signupUrl: string): string {
    return template.replace(/\{link\}/g, signupUrl);
}

/**
 * `wa.me` rather than the `whatsapp://` scheme: the https form works on desktop
 * web, Android and iOS, and degrades to a WhatsApp landing page instead of a dead
 * link when the app is not installed.
 */
export function buildWhatsAppUrl(message: string): string {
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function buildQrDataUrl(signupUrl: string, size = 320): Promise<string> {
    return QRCode.toDataURL(signupUrl, {
        width: size,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
    });
}

/**
 * Saves the QR as a PNG the partner can put in a WhatsApp status, a Facebook post
 * or a printed sign.
 */
export function downloadQrPng(dataUrl: string, referralCode: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `erp71-referral-${referralCode}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export interface OnePagerData {
    refereeName: string;
    referralCode: string;
    signupUrl: string;
    qrDataUrl: string;
    /** The discount the referred business gets, as a percentage. */
    signupDiscount: number;
    contactEmail: string;
}

/**
 * A printable A4 sheet: the code, a QR big enough to scan across a counter, and
 * what the shop owner gets out of it.
 *
 * Goes through `openPrintWindow` rather than jsPDF because the copy can be in
 * Bangla, and a print window renders it with the host's own fonts. jsPDF would
 * need an embedded Bangla subset and would otherwise print boxes — the same
 * trade-off already recorded for the invoice templates.
 */
export function printOnePager(data: OnePagerData, labels: OnePagerLabels): Window | null {
    const bodyHtml = `
<div class="op">
    <h1>${escapeHtml(labels.title)}</h1>
    <p class="intro">${escapeHtml(labels.intro)}</p>

    <div class="code-block">
        <span class="code-label">${escapeHtml(labels.codeLabel)}</span>
        <span class="code">${escapeHtml(data.referralCode)}</span>
    </div>

    <div class="qr-row">
        <img src="${data.qrDataUrl}" alt="${escapeHtml(data.signupUrl)}" class="qr" />
        <div class="qr-side">
            <p class="scan">${escapeHtml(labels.scanHint)}</p>
            <p class="link-label">${escapeHtml(labels.linkLabel)}</p>
            <p class="link">${escapeHtml(data.signupUrl)}</p>
        </div>
    </div>

    <p class="discount">${escapeHtml(
        labels.discountLine.replace('{pct}', String(data.signupDiscount)),
    )}</p>
    <p class="contact">${escapeHtml(
        labels.contactLine
            .replace('{name}', data.refereeName)
            .replace('{email}', data.contactEmail),
    )}</p>
</div>`;

    return openPrintWindow({
        title: `ERP71 — ${data.referralCode}`,
        paperSize: 'A4',
        bodyHtml,
        autoPrint: true,
        styles: `
            .op { text-align: center; padding: 24px 12px; }
            .op h1 { font-size: 30px; margin-bottom: 10px; }
            .op .intro { font-size: 15px; color: #374151; margin-bottom: 26px; }
            .op .code-block {
                border: 2px dashed #2563eb; border-radius: 10px;
                padding: 14px 20px; display: inline-block; margin-bottom: 26px;
            }
            .op .code-label {
                display: block; font-size: 12px; letter-spacing: 1px;
                text-transform: uppercase; color: #6b7280; margin-bottom: 4px;
            }
            .op .code {
                font-family: 'Courier New', monospace; font-size: 34px;
                font-weight: 700; letter-spacing: 3px; color: #1d4ed8;
            }
            .op .qr-row {
                display: flex; align-items: center; justify-content: center;
                gap: 26px; margin-bottom: 26px; text-align: left;
            }
            .op .qr { width: 190px; height: 190px; }
            .op .qr-side { max-width: 280px; }
            .op .scan { font-size: 17px; font-weight: 700; margin-bottom: 12px; }
            .op .link-label {
                font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
                color: #6b7280;
            }
            .op .link { font-size: 13px; word-break: break-all; color: #1d4ed8; }
            .op .discount {
                font-size: 17px; font-weight: 700; color: #047857;
                background: #ecfdf5; border-radius: 8px; padding: 12px; margin-bottom: 18px;
            }
            .op .contact { font-size: 13px; color: #4b5563; }
        `,
    });
}
