import {
    computeLedgerBalance,
    isEditableLedgerEvent,
    ledgerEventDelta,
    VOIDED_SUBSCRIPTION_FEE_EVENT_TYPE,
} from './ledger-balance.util';

describe('ledger-balance.util', () => {
    it('sums manual payments and refunds', () => {
        expect(ledgerEventDelta('manual_payment', 100)).toBe(100);
        expect(ledgerEventDelta('manual_refund', 30)).toBe(-30);
    });

    it('treats subscription and manual fees as charges', () => {
        expect(ledgerEventDelta('subscription_fee', 499)).toBe(-499);
        expect(ledgerEventDelta('manual_fee', 250)).toBe(-250);
    });

    it('opens the manual entries and the subscription fee to correction', () => {
        expect(isEditableLedgerEvent('manual_payment')).toBe(true);
        expect(isEditableLedgerEvent('manual_refund')).toBe(true);
        expect(isEditableLedgerEvent('manual_fee')).toBe(true);
        expect(isEditableLedgerEvent('subscription_fee')).toBe(true);
    });

    it('keeps credit-sale payments locked — their credits are already spendable', () => {
        expect(isEditableLedgerEvent('sms_credit_sale_payment')).toBe(false);
        expect(isEditableLedgerEvent('ai_credit_sale_payment')).toBe(false);
    });

    it('gives a voided subscription fee no weight in the balance', () => {
        expect(ledgerEventDelta(VOIDED_SUBSCRIPTION_FEE_EVENT_TYPE, 499)).toBe(0);
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