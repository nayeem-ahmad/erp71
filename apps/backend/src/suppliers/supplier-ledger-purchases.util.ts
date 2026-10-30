import { Prisma, PrismaClient } from '@prisma/client';
import { endOfDay, startOfDay, type PartyLedger, type PartyLedgerRow } from '../accounting/party-ledger.util';

type Client = PrismaClient | Prisma.TransactionClient;

type RecordedPurchase = {
    id: string;
    purchase_number: string;
    total_amount: Prisma.Decimal | number;
    paid_amount: Prisma.Decimal | number;
    notes: string | null;
    purchase_date: Date;
};

/**
 * Puts every recorded purchase for the supplier onto the GL-derived ledger:
 * bill total/paid on the AP increase row, and a zero-due PURCHASE row when
 * a recorded bill never posted to Purchase Payable. Running balance stays
 * GL-derived. The at-counter paid-leg (same source_id, credit) is left blank
 * on total/paid so the footer does not double-count.
 */
export async function enrichSupplierLedgerWithPurchases(
    db: Client,
    tenantId: string,
    supplierId: string,
    ledger: PartyLedger,
    range?: { from?: string; to?: string },
): Promise<PartyLedger> {
    const purchaseDate: { gte?: Date; lte?: Date } = {};
    if (range?.from) purchaseDate.gte = startOfDay(range.from);
    if (range?.to) purchaseDate.lte = endOfDay(range.to);

    const purchases: RecordedPurchase[] = await db.purchase.findMany({
        where: {
            tenant_id: tenantId,
            supplier_id: supplierId,
            status: 'RECORDED',
            ...(purchaseDate.gte || purchaseDate.lte ? { purchase_date: purchaseDate } : {}),
        },
        select: {
            id: true,
            purchase_number: true,
            total_amount: true,
            paid_amount: true,
            notes: true,
            purchase_date: true,
        },
    });

    const purchasesById = new Map(purchases.map((bill) => [bill.id, bill]));
    const onLedger = new Set<string>();

    const enriched: PartyLedgerRow[] = ledger.transactions.map((tx) => {
        if (tx.source_type !== 'purchase' || !tx.source_id) return tx;
        const bill = purchasesById.get(tx.source_id);
        if (!bill) return tx;
        if (tx.debit <= 0) return tx;
        onLedger.add(bill.id);
        return {
            ...tx,
            purchase_total: Number(bill.total_amount),
            amount_paid: Number(bill.paid_amount),
            payment_number: bill.purchase_number || tx.payment_number,
            notes: tx.notes ?? bill.notes,
        };
    });

    for (const bill of purchases) {
        if (onLedger.has(bill.id)) continue;
        enriched.push({
            id: `purchase:${bill.id}`,
            type: 'PURCHASE',
            amount: 0,
            debit: 0,
            credit: 0,
            sale_total: null,
            purchase_total: Number(bill.total_amount),
            amount_paid: Number(bill.paid_amount),
            source_type: 'purchase',
            source_id: bill.id,
            balance_before: 0,
            balance_after: 0,
            notes: bill.notes,
            payment_number: bill.purchase_number,
            created_at: bill.purchase_date,
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
