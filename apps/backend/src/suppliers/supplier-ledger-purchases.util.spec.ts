import { enrichSupplierLedgerWithPurchases } from './supplier-ledger-purchases.util';
import type { PartyLedger, PartyLedgerRow } from '../accounting/party-ledger.util';

function row(partial: Partial<PartyLedgerRow> & Pick<PartyLedgerRow, 'id' | 'type' | 'created_at'>): PartyLedgerRow {
    return {
        amount: 0,
        debit: 0,
        credit: 0,
        sale_total: null,
        purchase_total: null,
        amount_paid: null,
        source_type: null,
        source_id: null,
        balance_before: 0,
        balance_after: 0,
        notes: null,
        payment_number: null,
        ...partial,
    };
}

function ledger(transactions: PartyLedgerRow[], opening = 0): PartyLedger {
    return {
        opening_balance: opening,
        closing_balance: transactions.at(-1)?.balance_after ?? opening,
        transactions,
        total: transactions.length,
    };
}

function purchase(partial: {
    id: string;
    purchase_number?: string;
    total_amount: number;
    paid_amount: number;
    purchase_date: string;
    status?: string;
    notes?: string | null;
}) {
    return {
        purchase_number: partial.id.toUpperCase(),
        status: 'RECORDED',
        notes: null,
        ...partial,
        purchase_date: new Date(partial.purchase_date),
    };
}

function buildDb(purchases: unknown[]) {
    return {
        purchase: { findMany: jest.fn().mockResolvedValue(purchases) },
    } as any;
}

describe('enrichSupplierLedgerWithPurchases', () => {
    it('attaches bill total and paid onto a CREDIT_PURCHASE row', async () => {
        const gl = ledger([
            row({
                id: 'vd-bill',
                type: 'CREDIT_PURCHASE',
                amount: 10000,
                debit: 10000,
                credit: 0,
                source_type: 'purchase',
                source_id: 'pur-1',
                created_at: new Date('2026-05-02'),
                balance_after: 10000,
            }),
        ]);
        const db = buildDb([purchase({
            id: 'pur-1',
            purchase_number: 'PUR-001',
            total_amount: 10000,
            paid_amount: 4000,
            purchase_date: '2026-05-02',
        })]);

        const result = await enrichSupplierLedgerWithPurchases(db, 't1', 'sup-1', gl, {});

        expect(result.transactions).toEqual([
            expect.objectContaining({
                id: 'vd-bill',
                type: 'CREDIT_PURCHASE',
                debit: 10000,
                credit: 0,
                purchase_total: 10000,
                amount_paid: 4000,
                payment_number: 'PUR-001',
                balance_after: 10000,
            }),
        ]);
        expect(result.closing_balance).toBe(10000);
    });

    it('leaves the at-counter paid-leg blank on purchase total and paid', async () => {
        const gl = ledger([
            row({
                id: 'vd-bill',
                type: 'CREDIT_PURCHASE',
                amount: 10000,
                debit: 10000,
                credit: 0,
                source_type: 'purchase',
                source_id: 'pur-1',
                created_at: new Date('2026-05-02'),
                balance_after: 10000,
            }),
            row({
                id: 'vd-paid',
                type: 'PAYMENT',
                amount: 10000,
                debit: 0,
                credit: 10000,
                source_type: 'purchase',
                source_id: 'pur-1',
                created_at: new Date('2026-05-02'),
                balance_before: 10000,
                balance_after: 0,
            }),
        ]);
        const db = buildDb([purchase({
            id: 'pur-1',
            purchase_number: 'PUR-001',
            total_amount: 10000,
            paid_amount: 10000,
            purchase_date: '2026-05-02',
        })]);

        const result = await enrichSupplierLedgerWithPurchases(db, 't1', 'sup-1', gl, {});

        expect(result.transactions).toEqual([
            expect.objectContaining({
                id: 'vd-bill',
                purchase_total: 10000,
                amount_paid: 10000,
            }),
            expect.objectContaining({
                id: 'vd-paid',
                type: 'PAYMENT',
                credit: 10000,
                purchase_total: null,
                amount_paid: null,
            }),
        ]);
        expect(result.closing_balance).toBe(0);
        expect(result.total).toBe(2);
    });

    it('injects a recorded purchase that never posted to AP', async () => {
        const gl = ledger([]);
        const db = buildDb([purchase({
            id: 'pur-orphan',
            purchase_number: 'PUR-002',
            total_amount: 2000,
            paid_amount: 2000,
            purchase_date: '2026-05-03',
        })]);

        const result = await enrichSupplierLedgerWithPurchases(db, 't1', 'sup-1', gl, {});

        expect(result.transactions).toEqual([
            expect.objectContaining({
                id: 'purchase:pur-orphan',
                type: 'PURCHASE',
                debit: 0,
                credit: 0,
                purchase_total: 2000,
                amount_paid: 2000,
                payment_number: 'PUR-002',
                balance_after: 0,
            }),
        ]);
        expect(result.closing_balance).toBe(0);
        expect(result.total).toBe(1);
    });

    it('omits a recorded purchase outside the date window', async () => {
        const gl = ledger([]);
        const db = buildDb([]);

        const result = await enrichSupplierLedgerWithPurchases(db, 't1', 'sup-1', gl, { from: '2026-05-01', to: '2026-05-31' });

        expect(db.purchase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                purchase_date: {
                    gte: new Date('2026-05-01T00:00:00.000Z'),
                    lte: new Date('2026-05-31T23:59:59.999Z'),
                },
            }),
        }));
        expect(result.transactions).toEqual([]);
    });

    it('omits cancelled purchases', async () => {
        const gl = ledger([]);
        const db = buildDb([]);

        await enrichSupplierLedgerWithPurchases(db, 't1', 'sup-1', gl, {});

        expect(db.purchase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'RECORDED' }),
        }));
    });

    it('keeps running balance on AP movement and does not inject a bill that already posted', async () => {
        const gl = ledger([
            row({
                id: 'vd-bill',
                type: 'CREDIT_PURCHASE',
                amount: 10000,
                debit: 10000,
                credit: 0,
                source_type: 'purchase',
                source_id: 'pur-1',
                created_at: new Date('2026-05-02'),
                balance_after: 10000,
            }),
            row({
                id: 'vd-paid',
                type: 'PAYMENT',
                amount: 4000,
                debit: 0,
                credit: 4000,
                source_type: 'purchase',
                source_id: 'pur-1',
                created_at: new Date('2026-05-02'),
                balance_before: 10000,
                balance_after: 6000,
            }),
            row({
                id: 'vd-later',
                type: 'PAYMENT',
                amount: 6000,
                debit: 0,
                credit: 6000,
                source_type: 'supplier_payment',
                source_id: 'pay-1',
                created_at: new Date('2026-05-10'),
                balance_before: 6000,
                balance_after: 0,
            }),
        ]);
        const db = buildDb([
            purchase({
                id: 'pur-1',
                purchase_number: 'PUR-001',
                total_amount: 10000,
                paid_amount: 4000,
                purchase_date: '2026-05-02',
            }),
            purchase({
                id: 'pur-orphan',
                purchase_number: 'PUR-002',
                total_amount: 2000,
                paid_amount: 2000,
                purchase_date: '2026-05-03',
            }),
        ]);

        const result = await enrichSupplierLedgerWithPurchases(db, 't1', 'sup-1', gl, {});

        expect(result.transactions.map((tx) => ({
            id: tx.id,
            type: tx.type,
            debit: tx.debit,
            credit: tx.credit,
            purchase_total: tx.purchase_total,
            amount_paid: tx.amount_paid,
            balance_after: tx.balance_after,
        }))).toEqual([
            { id: 'vd-bill', type: 'CREDIT_PURCHASE', debit: 10000, credit: 0, purchase_total: 10000, amount_paid: 4000, balance_after: 10000 },
            { id: 'vd-paid', type: 'PAYMENT', debit: 0, credit: 4000, purchase_total: null, amount_paid: null, balance_after: 6000 },
            { id: 'purchase:pur-orphan', type: 'PURCHASE', debit: 0, credit: 0, purchase_total: 2000, amount_paid: 2000, balance_after: 6000 },
            { id: 'vd-later', type: 'PAYMENT', debit: 0, credit: 6000, purchase_total: null, amount_paid: null, balance_after: 0 },
        ]);
        expect(result.closing_balance).toBe(0);
    });
});
