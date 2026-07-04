/** Ledger balance delta for tenant payment ledger (positive = tenant credit / overpayment). */
export function ledgerEventDelta(eventType: string, amount: number | null | undefined): number {
    const value = amount ?? 0;
    switch (eventType) {
        case 'manual_payment':
        case 'sms_credit_sale_payment':
        case 'ai_credit_sale_payment':
            return value;
        case 'manual_refund':
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