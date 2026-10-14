import {
    canCancelExchange,
    exchangeSettlementSentence,
    previewExchangeSettlement,
    type ExchangeSettlementCopy,
} from './exchange-settlement';

const copy: ExchangeSettlementCopy = {
    even: 'Even swap. No money moves.',
    pay: 'Customer pays {amount} by {tender}.',
    refund: 'Customer receives {amount} by {tender}.',
    dueUp: 'Customer due increases by {amount}.',
    dueDown: 'Customer due decreases by {amount}.',
    dueAndRefund: 'Due decreases by {due}. Customer receives {amount} by {tender}.',
    tender: { cash: 'cash', bank: 'bank', bkash: 'bKash', nagad: 'Nagad', credit: 'credit' },
};

const fill = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
    );

const sentence = (
    input: Parameters<typeof exchangeSettlementSentence>[0],
) => exchangeSettlementSentence(input, copy, (amount) => `৳${amount}`, fill);

describe('previewExchangeSettlement', () => {
    it('treats an even swap as no movement', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 100,
            replacementTotal: 100,
            saleTotal: 100,
            amountPaid: 100,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: 0,
            settlementMode: 'cash',
            dueDelta: 0,
            cashDelta: 0,
            tenderDelta: 0,
        });
        expect(sentence({ difference: 0, dueDelta: 0, tenderDelta: 0, settlementMode: 'cash' }))
            .toBe('Even swap. No money moves.');
    });

    it('keeps an even swap on an open due in credit with nothing moving', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 80,
            replacementTotal: 80,
            saleTotal: 200,
            amountPaid: 50,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: 0,
            settlementMode: 'credit',
            dueDelta: 0,
            cashDelta: 0,
            tenderDelta: 0,
        });
    });

    it('charges cash when the replacement costs more on a paid invoice', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 100,
            replacementTotal: 150,
            saleTotal: 200,
            amountPaid: 200,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: 50,
            settlementMode: 'cash',
            dueDelta: 0,
            cashDelta: 50,
            tenderDelta: 50,
        });
    });

    it('refunds cash when the replacement costs less on a paid invoice', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 150,
            replacementTotal: 100,
            saleTotal: 200,
            amountPaid: 200,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: -50,
            settlementMode: 'cash',
            dueDelta: 0,
            cashDelta: -50,
            tenderDelta: -50,
        });
    });

    it('does not move the drawer for a bKash difference', () => {
        const higher = previewExchangeSettlement({
            returnedTotal: 100,
            replacementTotal: 140,
            saleTotal: 140,
            amountPaid: 140,
            firstPaymentMethod: 'bKash',
        });
        expect(higher).toEqual({
            difference: 40,
            settlementMode: 'bkash',
            dueDelta: 0,
            cashDelta: 0,
            tenderDelta: 40,
        });

        const lower = previewExchangeSettlement({
            returnedTotal: 140,
            replacementTotal: 100,
            saleTotal: 140,
            amountPaid: 140,
            firstPaymentMethod: 'BKASH Personal',
        });
        expect(lower.cashDelta).toBe(0);
        expect(lower.settlementMode).toBe('bkash');
        expect(lower.tenderDelta).toBe(-40);
    });

    it('increases the due when the customer still owes and the replacement costs more', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 100,
            replacementTotal: 180,
            saleTotal: 1000,
            amountPaid: 400,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: 80,
            settlementMode: 'credit',
            dueDelta: 80,
            cashDelta: 0,
            tenderDelta: 0,
        });
        expect(sentence({ difference: 80, dueDelta: 80, tenderDelta: 0, settlementMode: 'credit' }))
            .toBe('Customer due increases by ৳80.');
    });

    it('reduces the due when the refund fits inside the balance', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 150,
            replacementTotal: 100,
            saleTotal: 1000,
            amountPaid: 400,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: -50,
            settlementMode: 'credit',
            dueDelta: -50,
            cashDelta: 0,
            tenderDelta: 0,
        });
        expect(sentence({ difference: -50, dueDelta: -50, tenderDelta: 0, settlementMode: 'credit' }))
            .toBe('Customer due decreases by ৳50.');
    });

    it('refunds the remainder in cash when it is larger than the due', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 200,
            replacementTotal: 100,
            saleTotal: 200,
            amountPaid: 160,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: -100,
            settlementMode: 'cash',
            dueDelta: -40,
            cashDelta: -60,
            tenderDelta: -60,
        });
        expect(sentence({ difference: -100, dueDelta: -40, tenderDelta: -60, settlementMode: 'cash' }))
            .toBe('Due decreases by ৳40. Customer receives ৳60 by cash.');
    });

    it('settles a fully paid credit tender in cash', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 80,
            replacementTotal: 100,
            saleTotal: 100,
            amountPaid: 100,
            firstPaymentMethod: 'Credit',
        })).toEqual({
            difference: 20,
            settlementMode: 'cash',
            dueDelta: 0,
            cashDelta: 20,
            tenderDelta: 20,
        });
    });

    it('allows a zero replacement price', () => {
        expect(previewExchangeSettlement({
            returnedTotal: 100,
            replacementTotal: 0,
            saleTotal: 100,
            amountPaid: 100,
            firstPaymentMethod: 'Cash',
        })).toEqual({
            difference: -100,
            settlementMode: 'cash',
            dueDelta: 0,
            cashDelta: -100,
            tenderDelta: -100,
        });
    });

    it('says the customer pays or receives by the tender', () => {
        expect(sentence({ difference: 40, dueDelta: 0, tenderDelta: 40, settlementMode: 'bkash' }))
            .toBe('Customer pays ৳40 by bKash.');
        expect(sentence({ difference: -30, dueDelta: 0, tenderDelta: -30, settlementMode: 'nagad' }))
            .toBe('Customer receives ৳30 by Nagad.');
    });
});

describe('canCancelExchange', () => {
    it('is false without CANCEL_ENTRY', () => {
        expect(canCancelExchange('CASHIER', ['CREATE_RETURN'], 'COMPLETED')).toBe(false);
        expect(canCancelExchange('CASHIER', undefined, 'COMPLETED')).toBe(false);
    });

    it('is false when the exchange is cancelled', () => {
        expect(canCancelExchange('OWNER', [], 'CANCELLED')).toBe(false);
        expect(canCancelExchange('MANAGER', ['CANCEL_ENTRY'], 'CANCELLED')).toBe(false);
    });

    it('is true for the owner of a live exchange', () => {
        expect(canCancelExchange('OWNER', [], 'COMPLETED')).toBe(true);
    });

    it('is true for a member who holds CANCEL_ENTRY', () => {
        expect(canCancelExchange('CASHIER', ['CANCEL_ENTRY'], 'COMPLETED')).toBe(true);
    });
});
