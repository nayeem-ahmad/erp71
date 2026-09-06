import { computeLedgerBalance, isEditableLedgerEvent, ledgerEventDelta } from './ledger-balance.util';

describe('ledger-balance.util', () => {
    it('sums manual payments and refunds', () => {
        expect(ledgerEventDelta('manual_payment', 100)).toBe(100);
        expect(ledgerEventDelta('manual_refund', 30)).toBe(-30);
    });

    it('treats subscription and manual fees as charges', () => {
        expect(ledgerEventDelta('subscription_fee', 499)).toBe(-499);
        expect(ledgerEventDelta('manual_fee', 250)).toBe(-250);
    });

    it('only lets admins rewrite the entries admins typed in', () => {
        expect(isEditableLedgerEvent('manual_payment')).toBe(true);
        expect(isEditableLedgerEvent('manual_refund')).toBe(true);
        expect(isEditableLedgerEvent('manual_fee')).toBe(true);
        expect(isEditableLedgerEvent('subscription_fee')).toBe(false);
        expect(isEditableLedgerEvent('sms_credit_sale_payment')).toBe(false);
        expect(isEditableLedgerEvent('ai_credit_sale_payment')).toBe(false);
    });

    it('computes running ledger balance', () => {
        const balance = computeLedgerBalance([
            { event_type: 'manual_payment', amount: 1000 },
            { event_type: 'subscription_fee', amount: 499 },
            { event_type: 'manual_fee', amount: 200 },
            { event_type: 'manual_refund', amount: 50 },
        ]);
        expect(balance).toBe(251);
    });
});