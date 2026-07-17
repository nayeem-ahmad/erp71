import { BadRequestException, NotFoundException } from '@nestjs/common';

type DbLike = any;

const TRANSACTION_DEFAULT_FIELD: Record<string, string> = {
    product: 'default_product_warehouse_id',
    purchase: 'default_purchase_warehouse_id',
    sale: 'default_sales_warehouse_id',
    shrinkage: 'default_shrinkage_warehouse_id',
    transferSource: 'default_transfer_source_warehouse_id',
    transferDestination: 'default_transfer_destination_warehouse_id',
};

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
    transactionType?: 'product' | 'purchase' | 'sale' | 'shrinkage' | 'transferSource' | 'transferDestination',
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
        unitCost?: number;
        note?: string;
        /**
         * Backdates InventoryMovement.created_at. Omitted by every real caller
         * (movements stamp now); used by the demo-data generator to backfill a
         * six-month history so the stock ledger agrees with backdated sales.
         */
        occurredAt?: Date;
    },
) {
    const { tenantId, productId, warehouseId, quantityDelta, movementType, referenceType, referenceId, unitCost, note, occurredAt } = params;

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
                quantity: { gte: decrementBy },
            },
            data: {
                quantity: { decrement: decrementBy },
            },
        });

        if (updateResult.count === 0) {
            throw new BadRequestException(`Insufficient stock for product ${productId}`);
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
            unit_cost: unitCost,
            note,
            ...(occurredAt ? { created_at: occurredAt } : {}),
        },
    });

    return balanceAfter;
}