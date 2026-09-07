import { isCreditLedgerEvent, isDebitLedgerEvent, withRunningBalances } from './ledger-utils';
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

    it('charges a manual fee against the balance', () => {
        const base = {
            tenant_id: 't1',
            tenant_name: 'Acme',
            status: 'posted',
            provider_name: 'manual',
            currency: 'BDT',
            reference_id: null,
            payload: null,
        };

        const rows = withRunningBalances([
            { ...base, id: '1', event_type: 'manual_payment', amount: 500, created_at: '2024-01-01T00:00:00Z' },
            { ...base, id: '2', event_type: 'manual_fee', amount: 200, created_at: '2024-01-02T00:00:00Z' },
        ] as LedgerEvent[]);

        expect(rows[0].running_balance).toBe(300);
        expect(rows[1].running_balance).toBe(500);
    });
});

describe('ledger event classification', () => {
    it('splits credits from charges', () => {
        expect(isCreditLedgerEvent('manual_payment')).toBe(true);
        expect(isCreditLedgerEvent('sms_credit_sale_payment')).toBe(true);
        expect(isDebitLedgerEvent('manual_fee')).toBe(true);
        expect(isDebitLedgerEvent('subscription_fee')).toBe(true);
        expect(isCreditLedgerEvent('manual_fee')).toBe(false);
    });
});