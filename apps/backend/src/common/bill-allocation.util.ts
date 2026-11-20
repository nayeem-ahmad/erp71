import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type DbLike = Prisma.TransactionClient | { productionJobCost: any; projectCostEntry: any };

/**
 * How much of each service bill line has already been drawn — by production
 * jobs and by projects together.
 *
 * One bill can be split across several jobs and projects (a printer's invoice
 * for three titles, a transporter's for two sites), but its line total caps
 * every share drawn from it. Both modules read the cap through here, so a bill
 * cannot be spent once in Manufacturing and again in Projects.
 */
export async function allocatedByPurchaseItem(
    db: DbLike,
    tenantId: string,
    purchaseItemIds: string[],
): Promise<Map<string, number>> {
    const allocated = new Map<string, number>();
    if (purchaseItemIds.length === 0) return allocated;

    const [jobs, projects] = await Promise.all([
        (db as any).productionJobCost.groupBy({
            by: ['sourcePurchaseItemId'],
            where: { tenantId, sourcePurchaseItemId: { in: purchaseItemIds } },
            _sum: { amount: true },
        }),
        (db as any).projectCostEntry.groupBy({
            by: ['source_purchase_item_id'],
            where: { tenant_id: tenantId, source_purchase_item_id: { in: purchaseItemIds } },
            _sum: { amount: true },
        }),
    ]);
    for (const row of jobs) {
        allocated.set(row.sourcePurchaseItemId, (allocated.get(row.sourcePurchaseItemId) ?? 0) + Number(row._sum.amount ?? 0));
    }
    for (const row of projects) {
        allocated.set(
            row.source_purchase_item_id,
            (allocated.get(row.source_purchase_item_id) ?? 0) + Number(row._sum.amount ?? 0),
        );
    }
    return allocated;
}

/** What is left to draw from one line; refuses an amount that would overdraw it. */
export function assertWithinLine(lineTotal: number, alreadyAllocated: number, amount: number): void {
    const remaining = lineTotal - alreadyAllocated;
    if (amount - remaining > 0.005) {
        throw new BadRequestException(
            `This allocation (${amount.toFixed(2)}) exceeds the remaining unallocated amount (${remaining.toFixed(2)}) on this bill line.`,
        );
    }
}
