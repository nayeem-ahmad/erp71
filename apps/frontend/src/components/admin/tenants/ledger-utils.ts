import type { LedgerEvent } from './types';

function ledgerDelta(event: LedgerEvent): number {
    if (event.event_type === 'manual_payment') return event.amount ?? 0;
    if (event.event_type === 'manual_refund') return -(event.amount ?? 0);
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