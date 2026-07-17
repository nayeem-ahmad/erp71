export type PaymentMode = 'cash' | 'bank' | 'bkash' | 'nagad' | 'credit';

/**
 * Maps a payment method name to the `payment_mode` condition value used by the
 * posting rules (see packages/database/prisma/bootstrap-accounting.ts).
 *
 * Wallets are NOT collapsed into 'bank' - bKash and Nagad post to their own
 * accounts, which is what a Bangladeshi retailer expects to see.
 *
 * Limitation: payment methods are tenant-configurable (PaymentMethod), so a
 * custom method whose name matches nothing here falls back to 'cash'. The real
 * fix is resolving the account from PaymentMethod.account_id rather than
 * substring-matching a user-editable name; that changes autoPostFromRules'
 * account-resolution contract and is tracked separately.
 */
export function classifyPaymentMode(method: string): PaymentMode {
    const normalized = method.toLowerCase();

    if (normalized.includes('bkash')) {
        return 'bkash';
    }
    if (normalized.includes('nagad')) {
        return 'nagad';
    }
    if (normalized.includes('credit')) {
        return 'credit';
    }
    if (
        normalized.includes('bank')
        || normalized.includes('card')
        || normalized.includes('wallet')
        || normalized.includes('transfer')
    ) {
        return 'bank';
    }
    return 'cash';
}
