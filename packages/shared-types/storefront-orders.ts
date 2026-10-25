/**
 * Where a web order is in its life. Staff move it along from the Online tab of
 * Sales › Orders; the shopper reads the same value on their account page and in
 * the email or text each move sends them.
 *
 * Ordered as an order travels, so a list of them reads as a timeline. CANCELLED
 * is last because it can follow any of the others but leads nowhere.
 */
export const STOREFRONT_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

export type StorefrontOrderStatus = (typeof STOREFRONT_ORDER_STATUSES)[number];

export function isStorefrontOrderStatus(value: unknown): value is StorefrontOrderStatus {
    return typeof value === 'string' && (STOREFRONT_ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * The short reference a shopper quotes and staff look up: the last eight
 * characters of the order's id, upper-cased.
 *
 * The tail, not the head — a cuid opens with its timestamp, so two orders
 * placed the same afternoon share their first several characters and differ
 * only at the end. One function for every surface (email, SMS, account page,
 * staff list) so the reference the customer reads is the one staff can find.
 */
export function storefrontOrderRef(orderId: string): string {
    return orderId.slice(-8).toUpperCase();
}
