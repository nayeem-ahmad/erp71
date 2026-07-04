import { withRunningBalances } from './ledger-utils';
import type { LedgerEvent } from './types';

describe('withRunningBalances', () => {
    it('computes per-tenant running balance newest-first', () => {
        const events: LedgerEvent[] = [
            {
                id: '1',
                tenant_id: 't1',
                tenant_name: 'Acme',
                event_type: 'manual_payment',
                status: 'succeeded',
                provider_name: 'manual',
                amount: 100,
                currency: 'BDT',
                reference_id: null,
                payload: null,
                created_at: '2024-01-01T00:00:00Z',
            },
            {
                id: '2',
                tenant_id: 't1',
                tenant_name: 'Acme',
                event_type: 'manual_refund',
                status: 'succeeded',
                provider_name: 'manual',
                amount: 30,
                currency: 'BDT',
                reference_id: null,
                payload: null,
                created_at: '2024-01-02T00:00:00Z',
            },
        ];

        const rows = withRunningBalances(events);
        expect(rows[0].running_balance).toBe(70);
        expect(rows[1].running_balance).toBe(100);
    });
});