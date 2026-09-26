import { Prisma, PrismaClient } from '@prisma/client';
import { customerLedgerDueDelta } from '../customers/customer-credit.utils';

type Client = PrismaClient | Prisma.TransactionClient;

/** Just enough of a sale to find where it sits on its customer's ledger. */
export interface SaleLedgerPosition {
    id: string;
    status: string;
    customer_id: string | null;
    created_at: Date;
}

/** Money is kept to the paisa; float sums of Decimal columns are not. */
function toPaisa(value: number): number {
    const rounded = Math.round(value * 100) / 100;
    // -0 would print as "-0.00".
    return rounded === 0 ? 0 : rounded;
}

/**
 * What the sale's customer owed immediately before it — the "previous due" a
 * memo prints, with this invoice's unpaid part added on to give the total due.
 *
 * `null` when there is nobody to owe anything (a walk-in sale), or when the
 * sale no longer stands: cancelling one takes its due back off the customer,
 * so an invoice saying they still owe it would be wrong.
 *
 * Worked back from the live balance rather than stored on the sale: the
 * customer's `due_balance` now, less every ledger row that belongs to this sale
 * or was booked after it. At the counter that is exact, because nothing has
 * happened since — it is simply the balance the sale was added to. A reprint
 * weeks later prints the same figure, because each later payment and sale is
 * taken back out again. And it needs no backfill: every sale already posted
 * gets one. What does move it is a correction to the history *before* the sale,
 * such as an earlier sale cancelled, which is right: that due was never owed.
 *
 * Where the sale sits on the ledger is its own CREDIT_SALE row when it has one,
 * which is the moment it was actually posted — a draft finalised a day after it
 * was parked included. A sale paid in full left no row, so its creation time
 * stands in; for a draft paid in full that is when it was parked, not posted.
 *
 * A draft has posted nothing, so its previous due is simply today's balance.
 */
export async function resolveSalePreviousDue(
    db: Client,
    tenantId: string,
    sale: SaleLedgerPosition,
    customerDueNow: number,
): Promise<number | null> {
    if (!sale.customer_id || sale.status === 'CANCELLED') return null;
    if (sale.status === 'DRAFT') return toPaisa(customerDueNow);

    // Scoped to the sale's current customer: an entry edited over to someone
    // else leaves its credit row with the first customer, and that row says
    // nothing about what the second one owed.
    const ownRows = await db.customerCreditTransaction.findMany({
        where: {
            tenant_id: tenantId,
            customer_id: sale.customer_id,
            reference_type: 'SALE',
            reference_id: sale.id,
        },
        select: { id: true, type: true, amount: true, created_at: true },
    });

    const postedAt = ownRows.reduce(
        (earliest, row) => (row.created_at < earliest ? row.created_at : earliest),
        ownRows[0]?.created_at ?? sale.created_at,
    );

    const laterByType = await db.customerCreditTransaction.groupBy({
        by: ['type'],
        where: {
            tenant_id: tenantId,
            customer_id: sale.customer_id,
            created_at: { gt: postedAt },
            // Already counted below, whenever they were written.
            id: { notIn: ownRows.map((row) => row.id) },
        },
        _sum: { amount: true },
    });

    const movedSince =
        ownRows.reduce((sum, row) => sum + customerLedgerDueDelta(row.type, Number(row.amount)), 0)
        + laterByType.reduce(
            (sum, group) => sum + customerLedgerDueDelta(group.type, Number(group._sum.amount ?? 0)),
            0,
        );

    return toPaisa(customerDueNow - movedSince);
}
