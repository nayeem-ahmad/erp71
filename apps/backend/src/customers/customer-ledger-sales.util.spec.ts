import { enrichCustomerLedgerWithSales } from './customer-ledger-sales.util';
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

function sale(partial: {
    id: string;
    serial_number?: string;
    total_amount: number;
    amount_paid: number;
    sale_date: string;
    status?: string;
    note?: string | null;
}) {
    return {
        serial_number: partial.id.toUpperCase(),
        status: 'COMPLETED',
        note: null,
        ...partial,
        sale_date: new Date(partial.sale_date),
    };
}

function buildDb(sales: unknown[]) {
    return {
        sale: { findMany: jest.fn().mockResolvedValue(sales) },
    } as any;
}

describe('enrichCustomerLedgerWithSales', () => {
    it('attaches invoice total and paid onto a credit-sale AR row', async () => {
        const gl = ledger([
            row({
                id: 'vd-1',
                type: 'CREDIT_SALE',
                amount: 6000,
                debit: 6000,
                credit: 0,
                source_type: 'sale',
                source_id: 'sale-1',
                created_at: new Date('2026-05-02'),
                balance_after: 6000,
            }),
        ]);
        const db = buildDb([sale({ id: 'sale-1', serial_number: 'INV-001', total_amount: 10000, amount_paid: 4000, sale_date: '2026-05-02' })]);

        const result = await enrichCustomerLedgerWithSales(db, 't1', 'cust-1', gl, {});

        expect(result.transactions).toEqual([
            expect.objectContaining({
                id: 'vd-1',
                type: 'CREDIT_SALE',
                debit: 6000,
                credit: 0,
                sale_total: 10000,
                amount_paid: 4000,
                payment_number: 'INV-001',
                balance_after: 6000,
            }),
        ]);
        expect(result.closing_balance).toBe(6000);
    });

    it('injects a fully paid completed sale that never posted to AR', async () => {
        const gl = ledger([]);
        const db = buildDb([sale({ id: 'sale-cash', serial_number: 'INV-002', total_amount: 2000, amount_paid: 2000, sale_date: '2026-05-03' })]);

        const result = await enrichCustomerLedgerWithSales(db, 't1', 'cust-1', gl, {});

        expect(result.transactions).toEqual([
            expect.objectContaining({
                id: 'sale:sale-cash',
                type: 'SALE',
                debit: 0,
                credit: 0,
                sale_total: 2000,
                amount_paid: 2000,
                payment_number: 'INV-002',
                balance_after: 0,
            }),
        ]);
        expect(result.closing_balance).toBe(0);
        expect(result.total).toBe(1);
    });

    it('omits a fully paid sale outside the date window', async () => {
        const gl = ledger([]);
        const db = buildDb([]);

        const result = await enrichCustomerLedgerWithSales(db, 't1', 'cust-1', gl, { from: '2026-05-01', to: '2026-05-31' });

        expect(db.sale.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                sale_date: {
                    gte: new Date('2026-05-01T00:00:00.000Z'),
                    lte: new Date('2026-05-31T23:59:59.999Z'),
                },
            }),
        }));
        expect(result.transactions).toEqual([]);
    });

    it('omits cancelled and draft sales', async () => {
        const gl = ledger([]);
        const db = buildDb([]);

        await enrichCustomerLedgerWithSales(db, 't1', 'cust-1', gl, {});

        expect(db.sale.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'COMPLETED' }),
        }));
    });

    it('keeps running balance on AR movement and leaves a cash sale unchanged', async () => {
        const gl = ledger([
            row({
                id: 'vd-sale',
                type: 'CREDIT_SALE',
                amount: 6000,
                debit: 6000,
                credit: 0,
                source_type: 'sale',
                source_id: 'sale-credit',
                created_at: new Date('2026-05-02'),
                balance_after: 6000,
            }),
            row({
                id: 'vd-pay',
                type: 'PAYMENT',
                amount: 6000,
                debit: 0,
                credit: 6000,
                source_type: 'customer_payment',
                source_id: 'pay-1',
                created_at: new Date('2026-05-10'),
                balance_before: 6000,
                balance_after: 0,
            }),
        ]);
        const db = buildDb([
            sale({ id: 'sale-credit', serial_number: 'INV-001', total_amount: 10000, amount_paid: 4000, sale_date: '2026-05-02' }),
            sale({ id: 'sale-cash', serial_number: 'INV-002', total_amount: 2000, amount_paid: 2000, sale_date: '2026-05-03' }),
        ]);

        const result = await enrichCustomerLedgerWithSales(db, 't1', 'cust-1', gl, {});

        expect(result.transactions.map((tx) => ({
            id: tx.id,
            type: tx.type,
            debit: tx.debit,
            credit: tx.credit,
            balance_after: tx.balance_after,
        }))).toEqual([
            { id: 'vd-sale', type: 'CREDIT_SALE', debit: 6000, credit: 0, balance_after: 6000 },
            { id: 'sale:sale-cash', type: 'SALE', debit: 0, credit: 0, balance_after: 6000 },
            { id: 'vd-pay', type: 'PAYMENT', debit: 0, credit: 6000, balance_after: 0 },
        ]);
        expect(result.closing_balance).toBe(0);
    });
});
