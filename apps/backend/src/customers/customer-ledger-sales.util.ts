import { Prisma, PrismaClient } from '@prisma/client';
import { endOfDay, startOfDay, type PartyLedger, type PartyLedgerRow } from '../accounting/party-ledger.util';

type Client = PrismaClient | Prisma.TransactionClient;

type CompletedSale = {
    id: string;
    serial_number: string;
    total_amount: Prisma.Decimal | number;
    amount_paid: Prisma.Decimal | number;
    note: string | null;
    sale_date: Date;
};

/**
 * Puts every completed sale for the customer onto the GL-derived ledger:
 * invoice total/paid on AR sale rows, and a zero-due SALE row for cash sales
 * that never posted to Accounts Receivable. Running balance stays GL-derived.
 */
export async function enrichCustomerLedgerWithSales(
    db: Client,
    tenantId: string,
    customerId: string,
    ledger: PartyLedger,
    range?: { from?: string; to?: string },
): Promise<PartyLedger> {
    const saleDate: { gte?: Date; lte?: Date } = {};
    if (range?.from) saleDate.gte = startOfDay(range.from);
    if (range?.to) saleDate.lte = endOfDay(range.to);

    const sales: CompletedSale[] = await db.sale.findMany({
        where: {
            tenant_id: tenantId,
            customer_id: customerId,
            status: 'COMPLETED',
            ...(saleDate.gte || saleDate.lte ? { sale_date: saleDate } : {}),
        },
        select: {
            id: true,
            serial_number: true,
            total_amount: true,
            amount_paid: true,
            note: true,
            sale_date: true,
        },
    });

    const salesById = new Map(sales.map((sale) => [sale.id, sale]));
    const onLedger = new Set<string>();

    const enriched: PartyLedgerRow[] = ledger.transactions.map((tx) => {
        if (tx.source_type !== 'sale' || !tx.source_id) return tx;
        const sale = salesById.get(tx.source_id);
        if (!sale) return tx;
        onLedger.add(sale.id);
        return {
            ...tx,
            sale_total: Number(sale.total_amount),
            amount_paid: Number(sale.amount_paid),
            payment_number: sale.serial_number || tx.payment_number,
            notes: tx.notes ?? sale.note,
        };
    });

    for (const sale of sales) {
        if (onLedger.has(sale.id)) continue;
        enriched.push({
            id: `sale:${sale.id}`,
            type: 'SALE',
            amount: 0,
            debit: 0,
            credit: 0,
            sale_total: Number(sale.total_amount),
            purchase_total: null,
            amount_paid: Number(sale.amount_paid),
            source_type: 'sale',
            source_id: sale.id,
            balance_before: 0,
            balance_after: 0,
            notes: sale.note,
            payment_number: sale.serial_number,
            created_at: sale.sale_date,
        });
    }

    enriched.sort((a, b) => {
        const byDate = a.created_at.getTime() - b.created_at.getTime();
        if (byDate !== 0) return byDate;
        return a.id.localeCompare(b.id);
    });

    let running = ledger.opening_balance;
    const transactions = enriched.map((tx) => {
        const balance_before = running;
        running += tx.debit - tx.credit;
        return { ...tx, balance_before, balance_after: running };
    });

    return {
        opening_balance: ledger.opening_balance,
        closing_balance: transactions.length > 0 ? transactions[transactions.length - 1].balance_after : ledger.opening_balance,
        transactions,
        total: transactions.length,
    };
}
