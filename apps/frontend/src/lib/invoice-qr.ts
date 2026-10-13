import * as QRCode from 'qrcode';
import { routes } from './routes';

/**
 * The address a printed invoice's QR code opens: the sale's own invoice page.
 *
 * It carries no data of its own — only the sale's id. Whoever scans it lands on
 * the app, signs in if they have not, and is shown the invoice only if the API
 * lets their role read sales, so the paper can be photographed or lost without
 * giving anything away.
 */
export function invoiceUrl(saleId: string, origin: string = window.location.origin): string {
    return `${origin}${routes.sales.invoice(saleId)}`;
}

/**
 * The QR code for a sale's invoice as a PNG data URL, or `undefined` if one
 * could not be drawn. An invoice must always print, so a failure here only
 * leaves the code off the page.
 */
export async function invoiceQrDataUrl(saleId: string): Promise<string | undefined> {
    return qrDataUrl(invoiceUrl(saleId));
}

/**
 * The same for a printed quotation: a code that opens the quotation's page in
 * the app, on the same terms — sign in, and see it only if allowed to.
 */
export async function quotationQrDataUrl(quoteId: string): Promise<string | undefined> {
    return qrDataUrl(`${window.location.origin}${routes.sales.quoteDetail(quoteId)}`);
}

/** The same for a printed purchase receipt: a code that opens the purchase. */
export async function purchaseQrDataUrl(purchaseId: string): Promise<string | undefined> {
    return qrDataUrl(`${window.location.origin}${routes.purchases.purchaseDetail(purchaseId)}`);
}

async function qrDataUrl(url: string): Promise<string | undefined> {
    try {
        return await QRCode.toDataURL(url, { margin: 1, width: 240 });
    } catch {
        return undefined;
    }
}
