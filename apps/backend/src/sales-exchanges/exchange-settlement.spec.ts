import { legsFromStoredSettlement, settleExchange } from './exchange-settlement';

const paid = (extra: Partial<Parameters<typeof settleExchange>[0]> = {}) =>
    settleExchange({
        returnedTotal: 1000,
        replacementTotal: 1000,
        saleTotal: 1000,
        amountPaid: 1000,
        firstPaymentMethod: 'CASH',
        ...extra,
    });

describe('settleExchange', () => {
    it('moves nothing on an even swap', () => {
        expect(paid()).toMatchObject({
            difference: 0,
            dueDelta: 0,
            cashDelta: 0,
            tenderDelta: 0,
            legs: [],
        });
    });

    it('treats a paisa rounding dust as zero', () => {
        expect(paid({ replacementTotal: 1000.004 }).difference).toBe(0);
    });

    it('takes a higher cash price in cash', () => {
        const settled = paid({ replacementTotal: 1200 });
        expect(settled).toMatchObject({
            difference: 200,
            settlementMode: 'cash',
            dueDelta: 0,
            cashDelta: 200,
            tenderDelta: 200,
        });
        expect(settled.legs).toEqual([
            { eventType: 'sale', mode: 'cash', amount: 200 },
        ]);
    });

    it('gives a lower cash price back in cash', () => {
        const settled = paid({ replacementTotal: 800 });
        expect(settled).toMatchObject({
            difference: -200,
            settlementMode: 'cash',
            cashDelta: -200,
        });
        expect(settled.legs).toEqual([
            { eventType: 'sale_return', mode: 'cash', amount: 200 },
        ]);
    });

    it('keeps a bKash difference out of the drawer', () => {
        const settled = paid({ replacementTotal: 1200, firstPaymentMethod: 'bKash Personal' });
        expect(settled).toMatchObject({
            settlementMode: 'bkash',
            cashDelta: 0,
            tenderDelta: 200,
        });
        expect(settled.legs).toEqual([
            { eventType: 'sale', mode: 'bkash', amount: 200 },
        ]);
    });

    it('raises the due when the invoice is still owed and the replacement costs more', () => {
        const settled = settleExchange({
            returnedTotal: 400,
            replacementTotal: 600,
            saleTotal: 1000,
            amountPaid: 400,
            firstPaymentMethod: 'CASH',
        });
        expect(settled).toMatchObject({
            difference: 200,
            settlementMode: 'credit',
            dueDelta: 200,
            cashDelta: 0,
            tenderDelta: 0,
        });
        expect(settled.legs).toEqual([
            { eventType: 'sale', mode: 'credit', amount: 200 },
        ]);
    });

    it('lowers the due when the refund fits inside what is still owed', () => {
        const settled = settleExchange({
            returnedTotal: 600,
            replacementTotal: 400,
            saleTotal: 1000,
            amountPaid: 400,
            firstPaymentMethod: 'CASH',
        });
        expect(settled).toMatchObject({
            difference: -200,
            dueDelta: -200,
            cashDelta: 0,
            settlementMode: 'credit',
        });
        expect(settled.legs).toEqual([
            { eventType: 'sale_return', mode: 'credit', amount: 200 },
        ]);
    });

    it('splits a refund larger than the due into a due leg and a tender leg', () => {
        const settled = settleExchange({
            returnedTotal: 800,
            replacementTotal: 100,
            saleTotal: 1000,
            amountPaid: 400,
            firstPaymentMethod: 'CASH',
        });
        expect(settled).toMatchObject({
            difference: -700,
            dueDelta: -600,
            cashDelta: -100,
            tenderDelta: -100,
            settlementMode: 'cash',
        });
        expect(settled.legs).toEqual([
            { eventType: 'sale_return', mode: 'credit', amount: 600, legKey: 'due' },
            { eventType: 'sale_return', mode: 'cash', amount: 100, legKey: 'tender' },
        ]);
    });

    it('settles a cleared credit sale in cash', () => {
        const settled = paid({
            replacementTotal: 1200,
            firstPaymentMethod: 'CREDIT',
        });
        expect(settled).toMatchObject({
            settlementMode: 'cash',
            dueDelta: 0,
            cashDelta: 200,
        });
    });

    it('settles in cash when the invoice was fully paid and has no payment row', () => {
        const settled = paid({ replacementTotal: 900, firstPaymentMethod: null });
        expect(settled).toMatchObject({ settlementMode: 'cash', cashDelta: -100, dueDelta: 0 });
    });

    it('keeps an even swap on a still-owed invoice as credit with no legs', () => {
        const settled = settleExchange({
            returnedTotal: 500,
            replacementTotal: 500,
            saleTotal: 1000,
            amountPaid: 200,
            firstPaymentMethod: 'CASH',
        });
        expect(settled).toMatchObject({
            difference: 0,
            settlementMode: 'credit',
            dueDelta: 0,
            legs: [],
        });
    });
});

describe('legsFromStoredSettlement', () => {
    it('replays a due increase as a credit sale, not a cash sale', () => {
        expect(legsFromStoredSettlement({
            difference: 200,
            dueDelta: 200,
            settlementMode: 'credit',
        })).toEqual([{ eventType: 'sale', mode: 'credit', amount: 200 }]);
    });

    it('replays the two legs of a refund larger than the due', () => {
        expect(legsFromStoredSettlement({
            difference: -700,
            dueDelta: -600,
            settlementMode: 'cash',
        })).toEqual([
            { eventType: 'sale_return', mode: 'credit', amount: 600, legKey: 'due' },
            { eventType: 'sale_return', mode: 'cash', amount: 100, legKey: 'tender' },
        ]);
    });

    it('replays a bKash collection with no leg key', () => {
        expect(legsFromStoredSettlement({
            difference: 150,
            dueDelta: 0,
            settlementMode: 'bkash',
        })).toEqual([{ eventType: 'sale', mode: 'bkash', amount: 150 }]);
    });
});
