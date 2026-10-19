import type { Payment } from '@/lib/hooks/useNewSaleCart';

// Backend classifies a payment for accounting by substring-matching the method
// string (bank/card/wallet/credit → "bank", else "cash"). Keep the submitted
// `method` canonical so accounting posting stays correct regardless of the
// friendly name the tenant gave a defined method.
// Keyed by the `type` values actually stored on PaymentMethod, which are the
// backend PaymentMethodType enum values ('Cash' | 'Mobile Wallet' | 'Card' |
// 'Bank'). Legacy uppercase keys are kept so rows written before the settings
// form was aligned to the enum still classify correctly.
const TYPE_TO_CANONICAL: Record<string, string> = {
    'Cash': 'Cash',
    'Mobile Wallet': 'Mobile Wallet',
    'Card': 'Card',
    'Bank': 'Bank',
    CASH: 'Cash',
    MOBILE_WALLET: 'Mobile Wallet',
    CARD: 'Card',
    BANK: 'Bank',
};

export const canonicalFor = (type: string) => TYPE_TO_CANONICAL[type] ?? 'Cash';

/** The method by that name, ignoring case; the exact spelling wins a tie. */
function findByName<M extends { name: string }>(methods: M[], name: string | undefined): M | undefined {
    if (!name) return undefined;
    const lower = name.toLowerCase();
    const sameName = methods.filter((m) => m.name.toLowerCase() === lower);
    return sameName.find((m) => m.name === name) ?? sameName[0];
}

/**
 * The method a saved payment was taken on, so editing a document puts its
 * money back in the right box. `PaymentRecord.payment_method` holds three
 * spellings — POS writes `CASH` / `BKASH` / `CARD`, the entry screens wrote
 * the four type strings, older rows hold names such as `bKash` — so a payment
 * is matched, in order, by:
 *
 * 1. `paymentMethodId`;
 * 2. its saved name (`label`, else `method`), ignoring case. This also reads
 *    the legacy `BKASH` / `NAGAD` as the methods named bKash and Nagad;
 * 3. legacy `CASH` as the Cash-type method;
 * 4. the first active method whose type is the payment's, ignoring case.
 *
 * Steps 3 and 4 are skipped for a payment that carries an id: its method
 * exists but is not on this list (moved to another branch), and another of the
 * same type would be a different till. Pass `methods` with the ones on offer
 * first, so a guess lands on a method the branch still takes.
 */
export function matchPaymentToMethod<M extends { id: string; name: string; type: string; is_active?: boolean }>(
    methods: M[],
    p: Payment,
): M | undefined {
    if (p.paymentMethodId) {
        const byId = methods.find((m) => m.id === p.paymentMethodId);
        if (byId) return byId;
    }

    const saved = p.label || p.method;
    const byName = findByName(methods, saved);
    if (byName || p.paymentMethodId) return byName;

    if (saved?.toLowerCase() === 'cash') {
        const cash = methods.find((m) => canonicalFor(m.type) === 'Cash');
        if (cash) return cash;
    }

    const type = (TYPE_TO_CANONICAL[p.method] ?? p.method ?? '').toLowerCase();
    return methods.find((m) => m.is_active !== false && canonicalFor(m.type).toLowerCase() === type);
}
