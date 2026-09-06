/**
 * Ledger entries an admin typed in themselves, so an admin may retype them.
 *
 * Everything else on the ledger is posted by a machine and owns state this
 * endpoint cannot reach: `subscription_fee` carries the billing cron's
 * idempotency key (delete it and the next run re-posts the same period), and
 * the credit-sale payments are the money half of an SMS/AI credit grant that
 * has already landed in the tenant's balance. Correct those with an offsetting
 * manual entry rather than by rewriting history.
 */
export const EDITABLE_LEDGER_EVENT_TYPES = [
    'manual_payment',
    'manual_refund',
    'manual_fee',
] as const;

export type EditableLedgerEventType = (typeof EDITABLE_LEDGER_EVENT_TYPES)[number];

export function isEditableLedgerEvent(eventType: string): eventType is EditableLedgerEventType {
    return (EDITABLE_LEDGER_EVENT_TYPES as readonly string[]).includes(eventType);
}

/** Ledger balance delta for tenant payment ledger (positive = tenant credit / overpayment). */
export function ledgerEventDelta(eventType: string, amount: number | null | undefined): number {
    const value = amount ?? 0;
    switch (eventType) {
        case 'manual_payment':
        case 'sms_credit_sale_payment':
        case 'ai_credit_sale_payment':
            return value;
        case 'manual_refund':
        case 'manual_fee':
        case 'subscription_fee':
            return -value;
        default:
            return 0;
    }
}

export function computeLedgerBalance(
    events: Array<{ event_type: string; amount: number | null | undefined }>,
): number {
    return events.reduce((sum, event) => sum + ledgerEventDelta(event.event_type, event.amount), 0);
}
