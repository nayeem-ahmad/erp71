import type { LedgerEvent } from './types';

/** Entry types that add to the tenant's balance; everything else charges it. */
export const CREDIT_LEDGER_EVENT_TYPES = [
    'manual_payment',
    'sms_credit_sale_payment',
    'ai_credit_sale_payment',
] as const;

export const DEBIT_LEDGER_EVENT_TYPES = [
    'manual_refund',
    'manual_fee',
    'subscription_fee',
] as const;

export function isCreditLedgerEvent(eventType: string): boolean {
    return (CREDIT_LEDGER_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function isDebitLedgerEvent(eventType: string): boolean {
    return (DEBIT_LEDGER_EVENT_TYPES as readonly string[]).includes(eventType);
}

function ledgerDelta(event: LedgerEvent): number {
    const amount = event.amount ?? 0;
    if (isCreditLedgerEvent(event.event_type)) return amount;
    if (isDebitLedgerEvent(event.event_type)) return -amount;
    return 0;
}

/** Compute per-tenant running balance; returns rows newest-first for display. */
export function withRunningBalances(events: LedgerEvent[]): LedgerEvent[] {
    const sortedAsc = [...events].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const balanceByTenant = new Map<string, number>();
    const enriched = sortedAsc.map((event) => {
        const tenantKey = event.tenant_id ?? 'unknown';
        const previous = balanceByTenant.get(tenantKey) ?? 0;
        const balance = previous + ledgerDelta(event);
        balanceByTenant.set(tenantKey, balance);
        return { ...event, running_balance: balance };
    });

    return enriched.reverse();
}