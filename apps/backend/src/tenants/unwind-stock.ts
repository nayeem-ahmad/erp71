import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Deletes stock movements and takes back out of stock what they put in.
 *
 * `ProductStock.quantity` and the cost pool's `qty_on_hand` are running totals
 * of these movements. Deleting the movements alone left the totals standing,
 * so a cleared tenant kept its old stock, and re-importing the same documents
 * counted every one of them twice. Unwinding by the movements' own sums, rather
 * than zeroing, leaves any stock that never came from a movement as it was.
 */
export async function deleteMovementsAndUnwindStock(
    tx: Tx,
    tenantId: string,
    where: Prisma.InventoryMovementWhereInput,
): Promise<void> {
    const sums = await tx.inventoryMovement.groupBy({
        by: ['product_id', 'warehouse_id'],
        where,
        _sum: { quantity_delta: true },
    });

    const byProduct = new Map<string, number>();
    for (const row of sums) {
        const delta = row._sum.quantity_delta ?? 0;
        if (delta === 0) continue;
        await tx.productStock.updateMany({
            where: { tenant_id: tenantId, product_id: row.product_id, warehouse_id: row.warehouse_id },
            data: { quantity: { decrement: delta } },
        });
        byProduct.set(row.product_id, (byProduct.get(row.product_id) ?? 0) + delta);
    }
    for (const [productId, delta] of byProduct) {
        if (delta === 0) continue;
        await tx.productCost.updateMany({
            where: { tenant_id: tenantId, product_id: productId },
            data: { qty_on_hand: { decrement: delta } },
        });
    }

    await tx.inventoryMovement.deleteMany({ where });
}
