import { computePaymentKpis } from './payment-kpis';
import type { MoneyFlow, PartyPayment } from './types';

const row = (over: Partial<PartyPayment> & { flow: MoneyFlow }): PartyPayment & { flow: MoneyFlow } => ({
    id: Math.random().toString(36),
    amount: 0,
    created_at: '2026-10-01T05:00:00Z',
    ...over,
});

const directionOf = (p: PartyPayment) => (p as PartyPayment & { flow: MoneyFlow }).flow;

describe('computePaymentKpis', () => {
    const payments = [
        row({ flow: 'receive', amount: '12000', payment_method_name: 'bKash' }),
        row({ flow: 'receive', amount: '4500', discount_amount: '50', payment_method_name: 'Cash' }),
        row({ flow: 'receive', amount: 3500, payment_method_name: 'Cash' }),
        row({ flow: 'receive', amount: 1000 }),
        row({ flow: 'pay', amount: '2000', payment_method_name: 'Cash' }),
    ];

    it('splits money in from money out instead of netting them into one figure', () => {
        const kpis = computePaymentKpis(payments, directionOf, 'receive');

        expect(kpis.inTotal).toBe(21000);
        expect(kpis.inCount).toBe(4);
        expect(kpis.outTotal).toBe(2000);
        expect(kpis.outCount).toBe(1);
        expect(kpis.discountTotal).toBe(50);
        expect(kpis.discountCount).toBe(1);
    });

    it('nets in the primary direction: collected for customers, paid for suppliers', () => {
        expect(computePaymentKpis(payments, directionOf, 'receive').net).toBe(19000);
        expect(computePaymentKpis(payments, directionOf, 'pay').net).toBe(-19000);
    });

    it('breaks the primary direction down by method, largest first, unrecorded as null', () => {
        const kpis = computePaymentKpis(payments, directionOf, 'receive');

        expect(kpis.byMethod).toEqual([
            { name: 'bKash', amount: 12000 },
            { name: 'Cash', amount: 8000 },
            { name: null, amount: 1000 },
        ]);
    });

    it('counts a discount only on the primary direction', () => {
        const kpis = computePaymentKpis(
            [row({ flow: 'pay', amount: 100, discount_amount: 5 })],
            directionOf,
            'receive',
        );

        expect(kpis.discountTotal).toBe(0);
    });

    it('is all zeros for an empty period', () => {
        expect(computePaymentKpis([], directionOf, 'pay')).toEqual({
            inTotal: 0, inCount: 0, outTotal: 0, outCount: 0, discountTotal: 0, discountCount: 0, net: 0, byMethod: [],
        });
    });
});
