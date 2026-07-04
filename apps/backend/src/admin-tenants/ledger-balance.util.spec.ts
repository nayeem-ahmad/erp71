import { computeLedgerBalance, ledgerEventDelta } from './ledger-balance.util';

describe('ledger-balance.util', () => {
    it('sums manual payments and refunds', () => {
        expect(ledgerEventDelta('manual_payment', 100)).toBe(100);
        expect(ledgerEventDelta('manual_refund', 30)).toBe(-30);
    });

    it('treats subscription fee as a charge', () => {
        expect(ledgerEventDelta('subscription_fee', 499)).toBe(-499);
    });

    it('computes running ledger balance', () => {
        const balance = computeLedgerBalance([
            { event_type: 'manual_payment', amount: 1000 },
            { event_type: 'subscription_fee', amount: 499 },
            { event_type: 'manual_refund', amount: 50 },
        ]);
        expect(balance).toBe(451);
    });
});