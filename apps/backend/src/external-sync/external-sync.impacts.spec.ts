import {
    applyPaymentImpacts,
    applyPurchaseImpacts,
    applySaleImpacts,
    applySaleReturnImpacts,
    isAlreadyPosted,
} from './external-sync.impacts';

const applyInventoryMovement: jest.Mock = jest.fn();
const resolveWarehouseId: jest.Mock = jest.fn(async () => 'wh-1');
const autoPostFromRules: jest.Mock = jest.fn(async () => ({ postingStatus: 'posted' }));
const resolvePaymentMethodAccountId: jest.Mock = jest.fn(async () => 'acct-cash');

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: (...args: any[]) => applyInventoryMovement(...args),
    resolveWarehouseId: (...args: any[]) => resolveWarehouseId(...args),
}));
jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: (...args: any[]) => autoPostFromRules(...args),
    postingIdempotencyKey: (tenantId: string, eventType: string, sourceId: string) =>
        `${tenantId}:${eventType}:${sourceId}`,
}));
jest.mock('../accounting/payment-account.util', () => ({
    resolvePaymentMethodAccountId: (...args: any[]) => resolvePaymentMethodAccountId(...args),
}));

function makeTx(overrides: any = {}) {
    return {
        customer: { findUnique: jest.fn(async () => ({ due_balance: 1000 })), update: jest.fn() },
        supplier: { findUnique: jest.fn(async () => ({ due_balance: 500 })), update: jest.fn() },
        customerCreditTransaction: { create: jest.fn(), update: jest.fn() },
        supplierCreditTransaction: { create: jest.fn(), update: jest.fn() },
        ...overrides,
    } as any;
}

const SALE_DATE = new Date('2026-05-12T00:00:00.000Z');

describe('external-sync impacts', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('sales', () => {
        const base = {
            tenantId: 't1',
            storeId: 's1',
            saleId: 'sale-1',
            serialNumber: 'XR-2601666',
            customerId: 'cust-1',
            paymentMode: 'cash' as const,
            saleDate: SALE_DATE,
            items: [{ product_id: 'p1', quantity: 3 }],
        };

        it('decrements stock at the sale date, not import time', async () => {
            await applySaleImpacts({ tx: makeTx(), ...base, totalAmount: 100, amountPaid: 100 });

            expect(applyInventoryMovement).toHaveBeenCalledTimes(1);
            const [, params] = applyInventoryMovement.mock.calls[0];
            expect(params.quantityDelta).toBe(-3);
            expect(params.movementType).toBe('SALE');
            // Backdating is what makes a replayed history land in the right period.
            expect(params.occurredAt).toBe(SALE_DATE);
        });

        it('posts a fully paid sale once, dated, against the payment-mode account', async () => {
            await applySaleImpacts({ tx: makeTx(), ...base, totalAmount: 100, amountPaid: 100 });

            expect(autoPostFromRules).toHaveBeenCalledTimes(1);
            const input = autoPostFromRules.mock.calls[0][0];
            expect(input.eventType).toBe('sale');
            expect(input.conditionValue).toBe('cash');
            expect(input.amount).toBe(100);
            expect(input.date).toBe(SALE_DATE);
            expect(input.overrideDebitAccountId).toBe('acct-cash');
        });

        it('raises the customer due and writes a CREDIT_SALE row for the unpaid part', async () => {
            const tx = makeTx();
            await applySaleImpacts({ tx, ...base, totalAmount: 100, amountPaid: 40 });

            const credit = tx.customerCreditTransaction.create.mock.calls[0][0].data;
            expect(credit.type).toBe('CREDIT_SALE');
            expect(credit.amount).toBe(60);
            // 1000 existing due + 60 unpaid
            expect(credit.balance_after).toBe(1060);
            expect(tx.customer.update).toHaveBeenCalledWith({
                where: { id: 'cust-1' },
                data: { due_balance: 1060 },
            });
        });

        it('posts both legs of a part-paid credit sale, keyed apart', async () => {
            await applySaleImpacts({ tx: makeTx(), ...base, totalAmount: 100, amountPaid: 40 });

            expect(autoPostFromRules).toHaveBeenCalledTimes(2);
            const [credit, paid] = autoPostFromRules.mock.calls.map((c) => c[0]);

            expect(credit.conditionValue).toBe('credit');
            expect(credit.amount).toBe(60);
            expect(credit.legKey).toBeUndefined();

            // Without a distinct legKey the second posting shares the first's
            // idempotency key and is silently swallowed.
            expect(paid.legKey).toBe('paid');
            expect(paid.amount).toBe(40);
        });

        it('does not touch customer balances for a walk-in credit sale', async () => {
            const tx = makeTx();
            await applySaleImpacts({ tx, ...base, customerId: null, totalAmount: 100, amountPaid: 0 });

            expect(tx.customerCreditTransaction.create).not.toHaveBeenCalled();
            expect(tx.customer.update).not.toHaveBeenCalled();
        });
    });

    describe('purchases', () => {
        it('increments stock and raises the supplier due for the unpaid part', async () => {
            const tx = makeTx();
            await applyPurchaseImpacts({
                tx,
                tenantId: 't1',
                storeId: 's1',
                purchaseId: 'pur-1',
                purchaseNumber: 'XR-2601096',
                supplierId: 'sup-1',
                totalAmount: 1000,
                paidAmount: 250,
                purchaseDate: SALE_DATE,
                items: [{ product_id: 'p1', quantity: 10, unit_cost: 100 }],
            });

            const [, params] = applyInventoryMovement.mock.calls[0];
            expect(params.quantityDelta).toBe(10);
            expect(params.unitCost).toBe(100);

            const credit = tx.supplierCreditTransaction.create.mock.calls[0][0].data;
            expect(credit.type).toBe('CREDIT_PURCHASE');
            expect(credit.amount).toBe(750);
            expect(credit.balance_after).toBe(1250);

            expect(autoPostFromRules.mock.calls[0][0].partyType).toBe('SUPPLIER');
        });
    });

    describe('payments', () => {
        it('settles a customer due and recomputes balance_after from our own balance', async () => {
            const tx = makeTx();
            await applyPaymentImpacts({
                tx,
                tenantId: 't1',
                party: 'CUSTOMER',
                partyId: 'cust-1',
                transactionId: 'ct-1',
                paymentNumber: 'XR-TR02071',
                type: 'PAYMENT',
                amount: 400,
                method: 'cash',
                date: SALE_DATE,
            });

            // 1000 - 400; the provider's previous_due figure is overwritten so
            // ours and theirs cannot drift.
            expect(tx.customer.update).toHaveBeenCalledWith({
                where: { id: 'cust-1' },
                data: { due_balance: 600 },
            });
            expect(tx.customerCreditTransaction.update).toHaveBeenCalledWith({
                where: { id: 'ct-1' },
                data: { balance_after: 600 },
            });
            expect(autoPostFromRules.mock.calls[0][0].eventType).toBe('customer_payment');
            expect(autoPostFromRules.mock.calls[0][0].conditionValue).toBe('receive');
        });

        it('moves the balance the other way for a refund', async () => {
            const tx = makeTx();
            await applyPaymentImpacts({
                tx,
                tenantId: 't1',
                party: 'CUSTOMER',
                partyId: 'cust-1',
                transactionId: 'ct-1',
                paymentNumber: 'XR-TR1',
                type: 'PAYOUT',
                amount: 400,
                method: 'cash',
                date: SALE_DATE,
            });

            expect(tx.customer.update).toHaveBeenCalledWith({
                where: { id: 'cust-1' },
                data: { due_balance: 1400 },
            });
            expect(autoPostFromRules.mock.calls[0][0].conditionValue).toBe('pay');
        });

        it('reduces what we owe when we pay a supplier', async () => {
            const tx = makeTx();
            await applyPaymentImpacts({
                tx,
                tenantId: 't1',
                party: 'SUPPLIER',
                partyId: 'sup-1',
                transactionId: 'st-1',
                paymentNumber: 'XR-TR00186',
                type: 'PAYMENT',
                amount: 200,
                method: 'bank',
                date: SALE_DATE,
            });

            expect(tx.supplier.update).toHaveBeenCalledWith({
                where: { id: 'sup-1' },
                data: { due_balance: 300 },
            });
            expect(autoPostFromRules.mock.calls[0][0].eventType).toBe('supplier_payment');
        });
    });

    describe('sale returns', () => {
        it('restocks and posts the refund at the return date', async () => {
            await applySaleReturnImpacts({
                tx: makeTx(),
                tenantId: 't1',
                storeId: 's1',
                returnId: 'ret-1',
                returnNumber: 'XR-2601342',
                totalRefund: 440,
                returnDate: SALE_DATE,
                items: [{ product_id: 'p1', quantity: 2 }],
            });

            const [, params] = applyInventoryMovement.mock.calls[0];
            expect(params.quantityDelta).toBe(2);
            expect(params.movementType).toBe('SALES_RETURN');
            expect(autoPostFromRules.mock.calls[0][0].eventType).toBe('sale_return');
            expect(autoPostFromRules.mock.calls[0][0].amount).toBe(440);
        });
    });

    describe('isAlreadyPosted', () => {
        it('is true only for a posted event', async () => {
            const posted = { postingEvent: { findUnique: jest.fn(async () => ({ status: 'posted' })) } };
            const failed = { postingEvent: { findUnique: jest.fn(async () => ({ status: 'failed' })) } };
            const missing = { postingEvent: { findUnique: jest.fn(async () => null) } };

            await expect(isAlreadyPosted(posted as any, 't1', 'sale', 's1')).resolves.toBe(true);
            await expect(isAlreadyPosted(failed as any, 't1', 'sale', 's1')).resolves.toBe(false);
            await expect(isAlreadyPosted(missing as any, 't1', 'sale', 's1')).resolves.toBe(false);
        });
    });
});
