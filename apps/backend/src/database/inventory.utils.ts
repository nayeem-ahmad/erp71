import { BadRequestException, NotFoundException } from '@nestjs/common';
import { applyCostMovement } from './product-cost.utils';

type DbLike = any;

const TRANSACTION_DEFAULT_FIELD = {
    product: 'default_product_warehouse_id',
    purchase: 'default_purchase_warehouse_id',
    sale: 'default_sales_warehouse_id',
    shrinkage: 'default_shrinkage_warehouse_id',
    transferSource: 'default_transfer_source_warehouse_id',
    transferDestination: 'default_transfer_destination_warehouse_id',
} as const;

/** The keys of TRANSACTION_DEFAULT_FIELD, as the resolvers below accept them. */
export type WarehouseTransactionType = keyof typeof TRANSACTION_DEFAULT_FIELD;

export async function ensureDefaultWarehouse(tx: DbLike, tenantId: string, storeId?: string) {
    const existing = await tx.warehouse.findFirst({
        where: {
            tenant_id: tenantId,
            ...(storeId ? { store_id: storeId } : {}),
            is_active: true,
        },
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    });

    if (existing) {
        return existing;
    }

    const store = storeId
        ? await tx.store.findFirst({ where: { id: storeId, tenant_id: tenantId } })
        : await tx.store.findFirst({ where: { tenant_id: tenantId }, orderBy: { created_at: 'asc' } });

    if (!store) {
        throw new NotFoundException('Store not found');
    }

    const codeRoot = `WH-${store.id.slice(0, 8).toUpperCase()}`;
    const duplicateCount = await tx.warehouse.count({
        where: { tenant_id: tenantId, code: { startsWith: codeRoot } },
    });

    return tx.warehouse.create({
        data: {
            tenant_id: tenantId,
            store_id: store.id,
            name: `${store.name} Main Warehouse`,
            code: duplicateCount === 0 ? codeRoot : `${codeRoot}-${duplicateCount + 1}`,
            is_default: true,
            is_active: true,
        },
    });
}

export async function resolveWarehouseId(
    tx: DbLike,
    tenantId: string,
    storeId: string,
    explicitWarehouseId?: string,
    transactionType?: WarehouseTransactionType,
) {
    if (explicitWarehouseId) {
        const warehouse = await tx.warehouse.findFirst({
            where: {
                id: explicitWarehouseId,
                tenant_id: tenantId,
                store_id: storeId,
                is_active: true,
            },
        });

        if (!warehouse) {
            throw new BadRequestException('Warehouse not found for this store.');
        }

        return warehouse.id;
    }

    if (transactionType) {
        const settings = await tx.inventorySettings.findUnique({
            where: { tenant_id: tenantId },
        });

        const configuredWarehouseId = settings?.[TRANSACTION_DEFAULT_FIELD[transactionType]];
        if (configuredWarehouseId) {
            const warehouse = await tx.warehouse.findFirst({
                where: {
                    id: configuredWarehouseId,
                    tenant_id: tenantId,
                    store_id: storeId,
                    is_active: true,
                },
            });

            if (!warehouse) {
                throw new BadRequestException('Configured default warehouse is inactive or belongs to a different store.');
            }

            return warehouse.id;
        }
    }

    const warehouse = await ensureDefaultWarehouse(tx, tenantId, storeId);
    return warehouse.id;
}

/**
 * Where the lines of one document move stock.
 *
 * `entryWarehouseId` is the document's own warehouse — resolved exactly as
 * `resolveWarehouseId` always did, so a caller that sends nothing still lands
 * on the tenant's configured default. `warehouseIdFor` then maps each line's
 * optional override onto a real warehouse id, falling back to the document's.
 *
 * Both are returned because both are persisted: the header so an edit or a
 * delete can unwind against the warehouse the document actually used, the line
 * so a document split across warehouses survives the round trip.
 */
export interface EntryWarehouses {
    entryWarehouseId: string;
    warehouseIdFor(lineWarehouseId?: string | null): string;
}

/**
 * Resolve a document's warehouse plus any per-line overrides in one pass.
 *
 * Overrides are validated as a set rather than line by line: one query for the
 * distinct ids, so a fifty-line purchase costs the same as a one-line one. Each
 * must be active and belong to the same store as the document — the same rule
 * `resolveWarehouseId` applies to an explicit header warehouse, because a line
 * that could reach another branch's warehouse would move stock across branches
 * without a transfer.
 */
export async function resolveEntryWarehouses(
    tx: DbLike,
    tenantId: string,
    storeId: string,
    entryWarehouseId: string | undefined,
    lineWarehouseIds: Array<string | null | undefined>,
    transactionType?: WarehouseTransactionType,
): Promise<EntryWarehouses> {
    const resolvedEntryId = await resolveWarehouseId(
        tx,
        tenantId,
        storeId,
        entryWarehouseId,
        transactionType,
    );

    const overrideIds = [
        ...new Set(
            lineWarehouseIds.filter(
                (id): id is string => Boolean(id) && id !== resolvedEntryId,
            ),
        ),
    ];

    if (overrideIds.length > 0) {
        const warehouses = await tx.warehouse.findMany({
            where: {
                id: { in: overrideIds },
                tenant_id: tenantId,
                store_id: storeId,
                is_active: true,
            },
            select: { id: true },
        });

        if (warehouses.length !== overrideIds.length) {
            throw new BadRequestException(
                'One or more line warehouses are inactive or belong to a different store.',
            );
        }
    }

    return {
        entryWarehouseId: resolvedEntryId,
        warehouseIdFor: (lineWarehouseId?: string | null) => lineWarehouseId || resolvedEntryId,
    };
}

/**
 * Narrow a set of warehouse ids down to the ones stock may still be booked
 * against for a store.
 *
 * Used where a document inherits a warehouse from the one it reverses: a
 * return really should put the goods back where the sale took them from, but a
 * warehouse deactivated since is no longer a valid destination, and refusing
 * the refund over it would be the wrong trade. Ids dropped here fall back to
 * the caller's usual default. Caller-supplied ids are *not* run through this —
 * those are validated strictly, because a warehouse someone picked by hand and
 * cannot have is a mistake worth reporting.
 */
export async function usableWarehouseIds(
    tx: DbLike,
    tenantId: string,
    storeId: string,
    warehouseIds: Array<string | null | undefined>,
): Promise<Set<string>> {
    const candidates = [...new Set(warehouseIds.filter((id): id is string => Boolean(id)))];
    if (candidates.length === 0) {
        return new Set();
    }

    const warehouses = await tx.warehouse.findMany({
        where: {
            id: { in: candidates },
            tenant_id: tenantId,
            store_id: storeId,
            is_active: true,
        },
        select: { id: true },
    });

    return new Set(warehouses.map((warehouse: { id: string }) => warehouse.id));
}

/**
 * Where a posted document's stock has to go back to when it is edited or
 * deleted.
 *
 * A line stores a warehouse only when it overrode its document's, so the answer
 * is the line's, then the document's. Rows written before these columns existed
 * have neither, and for those the tenant's configured default is the right
 * answer — it is the value the original movement resolved at the time. That
 * fallback is looked up at most once and only if a line actually needs it, so
 * the common case costs no query at all.
 */
export function reversalWarehouseResolver(
    tx: DbLike,
    tenantId: string,
    storeId: string,
    documentWarehouseId: string | null | undefined,
    transactionType?: WarehouseTransactionType,
): (lineWarehouseId?: string | null) => Promise<string> {
    let fallbackId = documentWarehouseId ?? null;

    return async (lineWarehouseId?: string | null) => {
        if (lineWarehouseId) {
            return lineWarehouseId;
        }

        fallbackId ??= await resolveWarehouseId(tx, tenantId, storeId, undefined, transactionType);
        return fallbackId;
    };
}

export async function assertWarehouseBelongsToTenant(tx: DbLike, tenantId: string, warehouseId: string) {
    const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, tenant_id: tenantId },
    });

    if (!warehouse) {
        throw new BadRequestException('Warehouse not found for this tenant.');
    }

    if (!warehouse.is_active) {
        throw new BadRequestException('Warehouse is inactive.');
    }

    return warehouse;
}

export async function applyInventoryMovement(
    tx: DbLike,
    params: {
        tenantId: string;
        productId: string;
        warehouseId: string;
        quantityDelta: number;
        movementType: string;
        referenceType?: string;
        referenceId?: string;
        /**
         * What the *document* says these goods cost — a bill line, a job's
         * computed cost per unit. Only movement types classified REVALUE or
         * REVERSE_RECEIPT in product-cost.utils.ts act on it; for everything
         * else the weighted-average pool supplies the cost instead, and this is
         * ignored. That is deliberate: several callers historically passed a
         * selling price here.
         */
        unitCost?: number;
        note?: string;
        /**
         * Backdates InventoryMovement.created_at. Omitted by every real caller
         * (movements stamp now); used by the demo-data generator to backfill a
         * six-month history so the stock ledger agrees with backdated sales.
         */
        occurredAt?: Date;
        /**
         * Lets a decrement take the balance below zero instead of refusing.
         *
         * Only for replaying history that already happened elsewhere: a
         * migrated sale is a fact, and the purchase that stocked its product
         * may predate the imported window entirely. Refusing the movement there
         * drops the whole document, which is how an import came to leave 943
         * sales out of the ledger while their payments still landed. Live entry
         * must never pass this — a shortfall there is a real error.
         */
        allowNegative?: boolean;
    },
) {
    const { tenantId, productId, warehouseId, quantityDelta, movementType, referenceType, referenceId, unitCost, note, occurredAt, allowNegative } = params;

    if (quantityDelta === 0) {
        throw new BadRequestException('Inventory movement delta cannot be zero.');
    }

    // Service products (printing, binding, transport, ...) are never stock-tracked -
    // skip the movement/stock update entirely rather than failing on missing stock rows.
    const product = await tx.product.findUnique({
        where: { id: productId },
        select: { type: true },
    });
    if (product?.type === 'SERVICE') {
        return 0;
    }

    let balanceAfter: number;

    if (quantityDelta > 0) {
        const stock = await tx.productStock.upsert({
            where: {
                tenant_id_product_id_warehouse_id: {
                    tenant_id: tenantId,
                    product_id: productId,
                    warehouse_id: warehouseId,
                },
            },
            update: {
                quantity: { increment: quantityDelta },
            },
            create: {
                tenant_id: tenantId,
                product_id: productId,
                warehouse_id: warehouseId,
                quantity: quantityDelta,
            },
        });

        balanceAfter = stock.quantity;
    } else {
        const decrementBy = Math.abs(quantityDelta);
        const updateResult = await tx.productStock.updateMany({
            where: {
                tenant_id: tenantId,
                product_id: productId,
                warehouse_id: warehouseId,
                // The guard is the `gte` here, so dropping it is what permits a
                // negative balance for a replay.
                ...(allowNegative ? {} : { quantity: { gte: decrementBy } }),
            },
            data: {
                quantity: { decrement: decrementBy },
            },
        });

        if (updateResult.count === 0) {
            if (!allowNegative) {
                throw new BadRequestException(`Insufficient stock for product ${productId}`);
            }
            // No stock row exists yet — the product has never been received
            // here. Create it already negative so the ledger still balances
            // against the movement written below.
            await tx.productStock.create({
                data: {
                    tenant_id: tenantId,
                    product_id: productId,
                    warehouse_id: warehouseId,
                    quantity: -decrementBy,
                },
            });
        }

        const stock = await tx.productStock.findUnique({
            where: {
                tenant_id_product_id_warehouse_id: {
                    tenant_id: tenantId,
                    product_id: productId,
                    warehouse_id: warehouseId,
                },
            },
        });

        balanceAfter = stock?.quantity ?? 0;
    }

    // Update the weighted-average pool before writing the movement, because the
    // pool decides what this movement cost. A receipt is stamped with the price
    // on its own document; an issue is stamped with the average it left at, and
    // that stamp is the COGS every gross-profit report reads.
    const { movementUnitCost } = await applyCostMovement(tx, {
        tenantId,
        productId,
        quantityDelta,
        movementType,
        unitCost,
    });

    await tx.inventoryMovement.create({
        data: {
            tenant_id: tenantId,
            product_id: productId,
            warehouse_id: warehouseId,
            movement_type: movementType,
            reference_type: referenceType,
            reference_id: referenceId,
            quantity_delta: quantityDelta,
            balance_after: balanceAfter,
            unit_cost: movementUnitCost,
            note,
            ...(occurredAt ? { created_at: occurredAt } : {}),
        },
    });

    return balanceAfter;
}