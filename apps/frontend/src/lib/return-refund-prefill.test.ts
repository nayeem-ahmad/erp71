import { refundPrefill, returnPaymentsPayload, paymentsFromRecords } from './return-refund-prefill';
import type { Payment } from './hooks/useNewSaleCart';

const CASH = { id: 'pm-cash', name: 'Cash', type: 'Cash' };
const BKASH = { id: 'pm-bkash', name: 'bKash', type: 'Mobile Wallet' };
const BKASH_TENDER: Payment = { method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 500 };

describe('refundPrefill', () => {
    describe('sale_return', () => {
        it('refunds the part of the total the customer does not owe, in the sale\'s first tender', () => {
            const result = refundPrefill({
                context: 'sale_return',
                total: 300,
                originalTenders: [BKASH_TENDER, { method: 'Cash', amount: 10 }],
                partyDue: 100,
                firstVisible: CASH,
            });
            expect(result).toEqual([
                { method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 200 },
            ]);
        });

        it('refunds nothing when the due covers the whole total', () => {
            expect(
                refundPrefill({
                    context: 'sale_return',
                    total: 300,
                    originalTenders: [BKASH_TENDER],
                    partyDue: 900,
                    firstVisible: CASH,
                }),
            ).toEqual([]);
        });

        it('falls back to the first visible method when the sale had no tender', () => {
            expect(
                refundPrefill({
                    context: 'sale_return',
                    total: 300,
                    originalTenders: [],
                    partyDue: 100,
                    firstVisible: BKASH,
                }),
            ).toEqual([
                { method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 200 },
            ]);
        });

        it('refunds the whole total in the sale\'s tender when the customer owes nothing', () => {
            const result = refundPrefill({
                context: 'sale_return',
                total: 300,
                originalTenders: [BKASH_TENDER],
                partyDue: 0,
                firstVisible: CASH,
            });
            expect(result).toEqual([
                { method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 300 },
            ]);
        });

        it('treats an advance (negative due) as no due', () => {
            const result = refundPrefill({
                context: 'sale_return',
                total: 300,
                originalTenders: [],
                partyDue: -50,
                firstVisible: CASH,
            });
            expect(result).toEqual([{ method: 'Cash', label: 'Cash', paymentMethodId: 'pm-cash', amount: 300 }]);
        });

        it('puts the whole total in the first visible method with no customer', () => {
            expect(
                refundPrefill({
                    context: 'sale_return',
                    total: 300,
                    originalTenders: [BKASH_TENDER],
                    partyDue: null,
                    firstVisible: CASH,
                }),
            ).toEqual([{ method: 'Cash', label: 'Cash', paymentMethodId: 'pm-cash', amount: 300 }]);
        });

        it('uses plain cash when the branch offers no methods at all', () => {
            expect(
                refundPrefill({ context: 'sale_return', total: 300, originalTenders: [], partyDue: null, firstVisible: null }),
            ).toEqual([{ method: 'Cash', amount: 300 }]);
        });

        it('drops the original tender\'s instrument details — the refund is a new instrument', () => {
            const [row] = refundPrefill({
                context: 'sale_return',
                total: 100,
                originalTenders: [{ method: 'Bank', amount: 100, referenceNo: 'CHQ-1', bankName: 'City' }],
                partyDue: 0,
                firstVisible: CASH,
            });
            expect(row).toEqual({ method: 'Bank', amount: 100 });
        });

        it('returns nothing for a zero total', () => {
            expect(
                refundPrefill({ context: 'sale_return', total: 0, originalTenders: [], partyDue: 0, firstVisible: CASH }),
            ).toEqual([]);
        });
    });

    describe('purchase_return', () => {
        it('receives nothing when there is a supplier — the whole total goes against the payable', () => {
            expect(
                refundPrefill({ context: 'purchase_return', total: 80, originalTenders: [BKASH_TENDER], partyDue: 0, firstVisible: CASH }),
            ).toEqual([]);
        });

        it('puts the whole total in the first visible method with no supplier', () => {
            expect(
                refundPrefill({ context: 'purchase_return', total: 80, originalTenders: [], partyDue: null, firstVisible: BKASH }),
            ).toEqual([{ method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 80 }]);
        });
    });
});

describe('returnPaymentsPayload', () => {
    it('sends exactly the fields the DTO takes — never label or accountId', () => {
        const payload = returnPaymentsPayload([
            { method: 'Bank', label: 'Main Bank', paymentMethodId: 'pm-bank', accountId: 'acc-1', amount: 40, referenceNo: 'CHQ-9', instrumentDate: '2026-10-20' },
            { method: 'Cash', label: 'Cash', amount: 10 },
        ]);
        expect(payload).toEqual([
            { paymentMethod: 'Bank', paymentMethodId: 'pm-bank', amount: 40, referenceNo: 'CHQ-9', instrumentDate: '2026-10-20' },
            { paymentMethod: 'Cash', paymentMethodId: undefined, amount: 10 },
        ]);
        expect(Object.keys(payload[0])).not.toContain('label');
        expect(Object.keys(payload[0])).not.toContain('accountId');
    });

    it('drops zero-amount rows', () => {
        expect(returnPaymentsPayload([{ method: 'Cash', amount: 0 }])).toEqual([]);
    });
});

describe('paymentsFromRecords', () => {
    it('maps stored rows to tenders', () => {
        expect(
            paymentsFromRecords([
                { payment_method: 'Mobile Wallet', payment_method_name: 'bKash', payment_method_id: 'pm-bkash', amount: '120.50', reference_no: 'TX1' },
                { payment_method: 'Cash', payment_method_name: null, payment_method_id: null, amount: 5 },
            ]),
        ).toEqual([
            expect.objectContaining({ method: 'Mobile Wallet', label: 'bKash', paymentMethodId: 'pm-bkash', amount: 120.5, referenceNo: 'TX1' }),
            expect.objectContaining({ method: 'Cash', label: undefined, paymentMethodId: undefined, amount: 5 }),
        ]);
    });

    it('is empty for no rows', () => {
        expect(paymentsFromRecords(undefined)).toEqual([]);
    });
});
