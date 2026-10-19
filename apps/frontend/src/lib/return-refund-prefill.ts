import { canonicalFor } from '@/components/document-entry/payment-match';
import type { Payment } from '@/lib/hooks/useNewSaleCart';
import { instrumentFromRecord, pickInstrument, type PaymentInstrumentRecord } from '@/lib/payment-instrument';

const round2 = (value: number) => Math.round(value * 100) / 100;

interface RefundPrefillInput {
    context: 'sale_return' | 'purchase_return';
    /** What the return comes to. */
    total: number;
    /** The original sale's payments, in the order they were recorded; the first one is used. */
    originalTenders: Payment[];
    /** The customer's or supplier's current due. `null` means the document has no party. */
    partyDue: number | null;
    /** The first method the signed-in user's strip shows, or null when the branch offers none. */
    firstVisible: { id: string; name: string; type: string } | null;
}

/**
 * The tenders a return opens with, chosen so that a cashier who changes nothing
 * gets what the return did before tenders could be picked.
 *
 * - **Sales return.** With a party, the customer's due is settled first: what
 *   the due cannot take (`total − min(total, due)`) goes back as a refund, in
 *   the way the original sale was paid, else in the user's first visible
 *   method. With no due the whole total is refunded. With no party there is no
 *   due to settle against, so the whole total is refunded in the first visible
 *   method — the server refuses a partial refund then.
 * - **Purchase return.** With a supplier nothing is received: the whole total
 *   comes off what is payable. With none, the supplier's payable cannot take
 *   it, so the whole total is received in the first visible method.
 *
 * An advance (a negative due) counts as no due. The original tender's cheque
 * or reference details are not carried over: the refund is a new payment, not
 * a copy of the old one.
 *
 * With no method to name at all the branch has nothing configured, which is
 * what the strip's generic cash box is for — the row is a plain cash one.
 */
export function refundPrefill(input: RefundPrefillInput): Payment[] {
    const { context, total, originalTenders, partyDue, firstVisible } = input;
    if (!(total > 0)) return [];
    if (context === 'purchase_return' && partyDue != null) return [];

    const due = partyDue != null ? Math.max(0, partyDue) : 0;
    const refund = round2(total - Math.min(total, due));
    if (refund <= 0) return [];

    // Only a sale has a way of being paid to repeat; a party-less return has
    // no customer whose sale that would be, so it follows the user's strip.
    const original = context === 'sale_return' && partyDue != null ? originalTenders[0] : undefined;
    if (original) {
        const { method, label, paymentMethodId } = original;
        return [{ method, ...(label ? { label } : {}), ...(paymentMethodId ? { paymentMethodId } : {}), amount: refund }];
    }
    if (firstVisible) {
        return [
            { method: canonicalFor(firstVisible.type), label: firstVisible.name, paymentMethodId: firstVisible.id, amount: refund },
        ];
    }
    return [{ method: 'Cash', amount: refund }];
}

/** A stored payment row — a sale's, a purchase's or a return's. */
interface PaymentRecordRow extends PaymentInstrumentRecord {
    payment_method: string;
    payment_method_name?: string | null;
    payment_method_id?: string | null;
    amount: number | string;
}

/** Stored payment rows as the tenders the strip works in. */
export function paymentsFromRecords(rows: PaymentRecordRow[] | null | undefined): Payment[] {
    return (rows ?? []).map((row) => ({
        method: row.payment_method,
        label: row.payment_method_name ?? undefined,
        paymentMethodId: row.payment_method_id ?? undefined,
        amount: Number(row.amount ?? 0),
        ...instrumentFromRecord(row),
    }));
}

/**
 * The tenders as the return endpoints take them. The DTO is whitelisted, so
 * the strip's own fields (`label`, `accountId`) must not go — the server
 * resolves both from the method — and the cheque details go only where set.
 */
export function returnPaymentsPayload(payments: Payment[]) {
    return payments
        .filter((p) => p.amount > 0)
        .map((p) => ({
            paymentMethod: p.method,
            paymentMethodId: p.paymentMethodId,
            amount: p.amount,
            ...pickInstrument(p),
        }));
}
