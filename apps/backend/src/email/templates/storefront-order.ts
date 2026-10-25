/**
 * What a shop's web customer is told about their order: once when it is placed,
 * and again each time staff move it along.
 *
 * English only, like the sale receipt the counter sends — the shopper's language
 * is not known for a guest checkout, and a signed-in shopper's
 * `preferred_locale` is the ERP's setting, not a choice they made at this shop.
 *
 * Pure functions so the copy is testable without a mail transport, and so the
 * SMS and the email cannot disagree about what a status means.
 */
import { storefrontOrderRef, type StorefrontOrderStatus } from '@erp71/shared-types';
import { formatTaka } from '../../common/format-taka';

export type StorefrontOrderEvent = 'PLACED' | Exclude<StorefrontOrderStatus, 'PENDING'>;

export interface StorefrontOrderMessageVars {
    event: StorefrontOrderEvent;
    orderId: string;
    customerName: string;
    storeName: string;
    totalAmount: number;
    items: { name: string; quantity: number; unitPrice: number }[];
    deliveryAddress: string | null;
    deliveryArea: string | null;
    /** The shopper's account page; null when the shop has no storefront address. */
    accountLink: string | null;
}

const HEADLINES: Record<StorefrontOrderEvent, string> = {
    PLACED: 'We have your order',
    CONFIRMED: 'Your order is confirmed',
    SHIPPED: 'Your order is on its way',
    DELIVERED: 'Your order has been delivered',
    CANCELLED: 'Your order has been cancelled',
};

const LINES: Record<StorefrontOrderEvent, string> = {
    PLACED: 'Thank you for shopping with us. We will confirm your order shortly.',
    CONFIRMED: 'The shop has confirmed your order and is getting it ready.',
    SHIPPED: 'Your order has left the shop and is on its way to you.',
    DELIVERED: 'Your order has been delivered. We hope you enjoy it.',
    CANCELLED: 'This order has been cancelled. If you did not expect this, please contact the shop.',
};

/** Short phrases for the text message, which has one segment's worth of room. */
const SMS_PHRASES: Record<StorefrontOrderEvent, string> = {
    PLACED: 'has been received',
    CONFIRMED: 'is confirmed',
    SHIPPED: 'is on its way',
    DELIVERED: 'has been delivered',
    CANCELLED: 'has been cancelled',
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** One line, clipped, so a long name cannot push the text into another segment. */
function clip(value: string, fallback: string, max = 40): string {
    const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, max);
    return cleaned || fallback;
}

export function renderStorefrontOrderEmail(vars: StorefrontOrderMessageVars): { subject: string; html: string } {
    const ref = storefrontOrderRef(vars.orderId);
    const store = escapeHtml(vars.storeName);
    const headline = HEADLINES[vars.event];

    const rows = vars.items
        .map(
            (item) =>
                `<tr><td style="padding:4px 8px">${escapeHtml(item.name)}</td>`
                + `<td style="padding:4px 8px;text-align:right">${item.quantity}</td>`
                + `<td style="padding:4px 8px;text-align:right">${escapeHtml(formatTaka(item.unitPrice * item.quantity))}</td></tr>`,
        )
        .join('');

    const address = [vars.deliveryAddress, vars.deliveryArea].filter(Boolean).join(', ');

    const html = `<h2>${escapeHtml(headline)}</h2>
<p>Dear ${escapeHtml(clip(vars.customerName, 'Customer', 80))},</p>
<p>${escapeHtml(LINES[vars.event])}</p>
<p><strong>Order #${ref}</strong> from ${store}</p>
<table style="border-collapse:collapse;font-size:14px">
  <thead><tr><th style="padding:4px 8px;text-align:left">Item</th><th style="padding:4px 8px;text-align:right">Qty</th><th style="padding:4px 8px;text-align:right">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="2" style="padding:4px 8px;text-align:right"><strong>Total</strong></td><td style="padding:4px 8px;text-align:right"><strong>${escapeHtml(formatTaka(vars.totalAmount))}</strong></td></tr></tfoot>
</table>
${address ? `<p><strong>Delivery address:</strong> ${escapeHtml(address)}</p>` : ''}
${vars.accountLink ? `<p><a href="${escapeHtml(vars.accountLink)}">View your orders</a></p>` : ''}
<p>— ${store}</p>`;

    return { subject: `${headline} — order #${ref} at ${clip(vars.storeName, 'our shop', 60)}`, html };
}

/** The text message, written to fit one segment for an ordinary name and shop. */
export function renderStorefrontOrderSms(
    vars: Pick<StorefrontOrderMessageVars, 'event' | 'orderId' | 'customerName' | 'storeName' | 'totalAmount'>,
): string {
    const name = clip(vars.customerName, 'Customer', 20);
    const shop = clip(vars.storeName, 'us', 30);
    const ref = storefrontOrderRef(vars.orderId);
    return `Dear ${name}, your order #${ref} (BDT ${vars.totalAmount.toFixed(2)}) ${SMS_PHRASES[vars.event]}. - ${shop}`;
}
