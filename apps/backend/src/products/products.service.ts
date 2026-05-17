import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProductDto, UpdateProductDto } from './product.dto';
import { applyInventoryMovement, assertWarehouseBelongsToTenant, ensureDefaultWarehouse } from '../database/inventory.utils';

@Injectable()
export class ProductsService {
    constructor(private db: DatabaseService) { }

    async create(tenantId: string, dto: CreateProductDto) {
        return this.db.$transaction(async (tx) => {
            const categoryIds = await this.validateCategorySelection(tx, tenantId, dto.groupId, dto.subgroupId);
            const product = await tx.product.create({
                data: {
                    tenant_id: tenantId,
                    name: dto.name,
                    sku: dto.sku || null,
                    price: dto.price,
                    warranty_enabled: dto.warrantyEnabled ?? false,
                    warranty_duration_days: dto.warrantyDurationDays ?? null,
                    reorder_level: dto.reorderLevel ?? null,
                    safety_stock: dto.safetyStock ?? null,
                    lead_time_days: dto.leadTimeDays ?? null,
                    image_url: dto.image_url,
                    unit_type: dto.unitType ?? 'none',
                    group_id: categoryIds.groupId,
                    subgroup_id: categoryIds.subgroupId,
                },
                include: this.productInclude(),
            });

            if ((dto.initialStock ?? 0) > 0) {
                const settings = await tx.inventorySettings.findUnique({
                    where: { tenant_id: tenantId },
                });
                const warehouse = settings?.default_product_warehouse_id
                    ? await assertWarehouseBelongsToTenant(tx, tenantId, settings.default_product_warehouse_id)
                    : await ensureDefaultWarehouse(tx, tenantId);
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: product.id,
                    warehouseId: warehouse.id,
                    quantityDelta: dto.initialStock ?? 0,
                    movementType: 'INITIAL_STOCK',
                    referenceType: 'PRODUCT',
                    referenceId: product.id,
                    unitCost: dto.price,
                });
            }

            return tx.product.findFirst({
                where: { id: product.id, tenant_id: tenantId },
                include: this.productInclude(),
            });
        });
    }

    async findAll(
        tenantId: string,
        filters?: { groupId?: string; subgroupId?: string; uncategorized?: boolean },
    ) {
        return this.db.product.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                ...(filters?.uncategorized
                    ? { group_id: null, subgroup_id: null }
                    : {
                          ...(filters?.groupId ? { group_id: filters.groupId } : {}),
                          ...(filters?.subgroupId ? { subgroup_id: filters.subgroupId } : {}),
                      }),
            },
            include: this.productInclude(),
            orderBy: { name: 'asc' },
        });
    }

    async findOne(tenantId: string, id: string) {
        const product = await this.db.product.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: this.productInclude(),
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        return product;
    }

    async update(tenantId: string, id: string, dto: UpdateProductDto) {
        await this.findOne(tenantId, id);

        const categoryIds = await this.validateCategorySelection(txLike(this.db), tenantId, dto.groupId, dto.subgroupId);

        return this.db.product.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.sku !== undefined ? { sku: dto.sku || null } : {}),
                ...(dto.price !== undefined ? { price: dto.price } : {}),
                ...(dto.warrantyEnabled !== undefined ? { warranty_enabled: dto.warrantyEnabled } : {}),
                ...(dto.warrantyDurationDays !== undefined
                    ? { warranty_duration_days: dto.warrantyDurationDays }
                    : {}),
                ...(dto.reorderLevel !== undefined ? { reorder_level: dto.reorderLevel } : {}),
                ...(dto.safetyStock !== undefined ? { safety_stock: dto.safetyStock } : {}),
                ...(dto.leadTimeDays !== undefined ? { lead_time_days: dto.leadTimeDays } : {}),
                ...(dto.image_url !== undefined ? { image_url: dto.image_url || null } : {}),
                ...(dto.unitType !== undefined ? { unit_type: dto.unitType } : {}),
                ...(dto.groupId !== undefined ? { group_id: categoryIds.groupId } : {}),
                ...(dto.subgroupId !== undefined ? { subgroup_id: categoryIds.subgroupId } : {}),
            },
            include: this.productInclude(),
        });
    }

    async remove(tenantId: string, id: string) {
        await this.findOne(tenantId, id);
        return this.db.product.updateMany({
            where: { id, tenant_id: tenantId, deleted_at: null },
            data: { deleted_at: new Date() },
        });
    }

    async getStats(tenantId: string) {
        const result = await this.db.$queryRaw<[{ low_stock_count: bigint }]>`
            SELECT COUNT(*) AS low_stock_count
            FROM (
                SELECT p.id
                FROM "Product" p
                LEFT JOIN "ProductStock" ps ON ps.product_id = p.id
                WHERE p.tenant_id = ${tenantId}
                  AND p.deleted_at IS NULL
                  AND p.reorder_level IS NOT NULL
                GROUP BY p.id, p.reorder_level
                HAVING COALESCE(SUM(ps.quantity), 0) <= p.reorder_level
            ) sub
        `;
        return { lowStockCount: Number(result[0].low_stock_count) };
    }

    private async validateCategorySelection(db: any, tenantId: string, groupId?: string, subgroupId?: string) {
        let resolvedGroupId = groupId;
        let resolvedSubgroupId = subgroupId;

        if (resolvedGroupId) {
            const group = await db.productGroup.findFirst({ where: { id: resolvedGroupId, tenant_id: tenantId } });
            if (!group) {
                throw new BadRequestException('Product group not found for this tenant.');
            }
        }

        if (resolvedSubgroupId) {
            const subgroup = await db.productSubgroup.findFirst({
                where: { id: resolvedSubgroupId, tenant_id: tenantId },
            });

            if (!subgroup) {
                throw new BadRequestException('Product subgroup not found for this tenant.');
            }

            if (resolvedGroupId && subgroup.group_id !== resolvedGroupId) {
                throw new BadRequestException('Selected subgroup does not belong to the selected group.');
            }

            if (!resolvedGroupId) {
                resolvedGroupId = subgroup.group_id;
            }
        }

        return { groupId: resolvedGroupId ?? null, subgroupId: resolvedSubgroupId ?? null };
    }

    private productInclude() {
        return {
            group: true,
            subgroup: {
                include: { group: true },
            },
            stocks: {
                include: { warehouse: true },
                orderBy: [{ warehouse: { is_default: 'desc' as const } }, { warehouse: { name: 'asc' as const } }],
            },
        };
    }
}

function txLike(db: DatabaseService) {
    return db as any;
}
