import { PaymentMethodType, PAYMENT_METHOD_TYPE_VALUES } from '@erp71/shared-types';

/**
 * The label to print for a stored payment method, on every document that shows
 * one.
 *
 * `PaymentRecord.payment_method` is a free-form string and what it holds
 * depends on when the row was written: almost everything now stores the display
 * string itself ('Cash', 'bKash', 'Mobile Wallet'), while older rows store the
 * uppercase key ('CASH', 'BKASH'). Both have to print the same words, or one
 * payment type reads as two across a tenant's invoices and receipts.
 *
 * Canonical spellings come from `PaymentMethodType` rather than a copy of them.
 * The invoice, POS receipt and Mushak printers each carried their own identical
 * map, and all three had drifted the same way: 'CARD' printed "Credit Card"
 * while a modern 'Card' row printed "Card", and each listed
 * BANK_TRANSFER/MOBILE_PAYMENT/OTHER, which the enum cannot produce. Keeping
 * one function is what stops the next copy drifting again.
 */
export function paymentMethodLabel(method: string): string {
    // The stored display string, in whatever case the row happens to hold.
    const canonical = PAYMENT_METHOD_TYPE_VALUES.find(
        (value) => value.toLowerCase() === method.toLowerCase(),
    );
    if (canonical) return canonical;

    // The enum key ('MOBILE_WALLET'), which older rows and some callers use.
    const byKey = (PaymentMethodType as Record<string, string>)[method.toUpperCase()];
    if (byKey) return byKey;

    // Local wallet brands and key spellings that predate the shared enum.
    const legacy: Record<string, string> = {
        BKASH: 'bKash',
        NAGAD: 'Nagad',
        BANK_TRANSFER: 'Bank',
        MOBILE_PAYMENT: 'Mobile Wallet',
    };

    // A tenant may name a method anything; its own name beats a guess.
    return legacy[method.toUpperCase()] ?? method;
}
