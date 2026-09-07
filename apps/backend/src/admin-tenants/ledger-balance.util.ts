/**
 * Ledger entries an admin may correct in place.
 *
 * The three `manual_*` types were typed in by an admin to begin with. The
 * `subscription_fee` is machine-posted but editable anyway, because a wrong
 * plan price or a mis-set discount lands there and an admin needs to fix the
 * charge rather than paper over it — with one caveat the delete path handles:
 * the billing cron keys each fee `subscription_fee:{tenantId}:{periodKey}` and
 * never advances `current_period_end` itself, so that row is the *only* thing
 * stopping a re-post on the next daily run. Deleting one therefore voids it in
 * place (see `VOIDED_SUBSCRIPTION_FEE_EVENT_TYPE`) rather than removing the row.
 *
 * The credit-sale payments stay locked: each is the money half of an SMS/AI
 * credit grant that has already landed in the tenant's balance, and nothing
 * here can claw those credits back. Correct one with an offsetting entry.
 */
export const EDITABLE_LEDGER_EVENT_TYPES = [
    'manual_payment',
    'manual_refund',
    'manual_fee',
    'subscription_fee',
] as const;

/**
 * Tombstone left behind when an admin deletes a subscription fee: it keeps the
 * cron's `(provider_name, external_event_id)` pair claimed so the period is
 * never re-posted, while contributing nothing to the balance and staying out of
 * the ledger listing. The deletion itself is recorded in the audit log.
 */
export const VOIDED_SUBSCRIPTION_FEE_EVENT_TYPE = 'subscription_fee_voided';

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
