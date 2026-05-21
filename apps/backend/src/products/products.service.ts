import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProductDto, UpdateProductDto } from './product.dto';
import { CsvProductRow } from './import-products.dto';
import { applyInventoryMovement, assertWarehouseBelongsToTenant, ensureDefaultWarehouse } from '../database/inventory.utils';
import { paginate, PaginatedResult, cursorPaginate, CursorPaginatedResult } from '../common/pagination.dto';
import { RedisService } from '../cache/redis.service';

const CACHE_TTL = 60; // seconds

@Injectable()
export class ProductsService {
    constructor(
        private db: DatabaseService,
        private redis: RedisService,
    ) { }

    async create(tenantId: string, dto: CreateProductDto) {
        const result = await this.db.$transaction(async (tx) => {
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

        await this.redis.invalidatePattern(`products:${tenantId}:`);
        return result;
    }

    async findAll(
        tenantId: string,
        filters?: { groupId?: string; subgroupId?: string; uncategorized?: boolean; page?: number; limit?: number },
    ): Promise<PaginatedResult<any>> {
        const page = filters?.page ?? 1;
        const limit = Math.min(filters?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const cacheKey = `products:${tenantId}:offset:${JSON.stringify({ page, limit, ...filters })}`;
        const cached = await this.redis.get<PaginatedResult<any>>(cacheKey);
        if (cached) return cached;

        const where = this.buildWhere(tenantId, filters);

        const [items, total] = await Promise.all([
            this.db.product.findMany({ where, include: this.productInclude(), orderBy: { name: 'asc' }, skip, take: limit }),
            this.db.product.count({ where }),
        ]);

        const result = paginate(items, total, page, limit);
        await this.redis.set(cacheKey, result, CACHE_TTL);
        return result;
    }

    async findAllCursor(
        tenantId: string,
        filters?: { groupId?: string; subgroupId?: string; uncategorized?: boolean; cursor?: string; limit?: number },
    ): Promise<CursorPaginatedResult<any>> {
        const limit = Math.min(filters?.limit ?? 20, 100);

        const cacheKey = `products:${tenantId}:cursor:${JSON.stringify({ limit, cursor: filters?.cursor, ...filters })}`;
        const cached = await this.redis.get<CursorPaginatedResult<any>>(cacheKey);
        if (cached) return cached;

        const where = this.buildWhere(tenantId, filters);

        // Fetch limit+1 to detect whether a next page exists
        const items = await this.db.product.findMany({
            where,
            include: this.productInclude(),
            orderBy: { name: 'asc' },
            take: limit + 1,
            ...(filters?.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
        });

        const result = cursorPaginate(items, limit);
        await this.redis.set(cacheKey, result, CACHE_TTL);
        return result;
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

        const result = await this.db.product.update({
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

        await this.redis.invalidatePattern(`products:${tenantId}:`);
        return result;
    }

    async remove(tenantId: string, id: string) {
        const product = await this.db.product.findFirst({ where: { id, tenant_id: tenantId, deleted_at: null } });
        if (!product) throw new NotFoundException('Product not found');
        const result = await this.db.product.update({
            where: { id },
            data: { deleted_at: new Date() },
        });
        await this.redis.invalidatePattern(`products:${tenantId}:`);
        return result;
    }

    async importFromCsv(
        tenantId: string,
        rows: CsvProductRow[],
    ): Promise<{ created: number; skipped: number; errors: string[] }> {
        let created = 0;
        let skipped = 0;
        const errors: string[] = [];

        // Fetch inventory settings once for the whole import
        const settings = await this.db.inventorySettings.findUnique({
            where: { tenant_id: tenantId },
        });

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowLabel = `Row ${i + 2}`; // +2 because row 1 is the header

            try {
                if (!row.name || String(row.name).trim() === '') {
                    errors.push(`${rowLabel}: missing required field "name"`);
                    continue;
                }

                const name = String(row.name).trim();
                const sku = row.sku ? String(row.sku).trim() || null : null;

                // If SKU is provided, attempt upsert (skip if product already exists)
                if (sku) {
                    const existing = await this.db.product.findFirst({
                        where: { tenant_id: tenantId, sku, deleted_at: null },
                    });
                    if (existing) {
                        skipped++;
                        continue;
                    }
                }

                const price = Number(row.selling_price) || 0;
                const initialStock = Number(row.stock_quantity) || 0;

                await this.db.$transaction(async (tx) => {
                    const product = await tx.product.create({
                        data: {
                            tenant_id: tenantId,
                            name,
                            sku,
                            price,
                            reorder_level: row.reorder_point != null ? Number(row.reorder_point) : null,
                            unit_type: row.unit ? String(row.unit).trim() : 'none',
                        },
                    });

                    if (initialStock > 0) {
                        const warehouse = settings?.default_product_warehouse_id
                            ? await assertWarehouseBelongsToTenant(tx, tenantId, settings.default_product_warehouse_id)
                            : await ensureDefaultWarehouse(tx, tenantId);

                        await applyInventoryMovement(tx, {
                            tenantId,
                            productId: product.id,
                            warehouseId: warehouse.id,
                            quantityDelta: initialStock,
                            movementType: 'INITIAL_STOCK',
                            referenceType: 'PRODUCT',
                            referenceId: product.id,
                            unitCost: row.cost_price != null ? Number(row.cost_price) : price,
                        });
                    }
                });

                created++;
            } catch (err: any) {
                errors.push(`${rowLabel}: ${err?.message ?? 'unknown error'}`);
            }
        }

        await this.redis.invalidatePattern(`products:${tenantId}:`);
        return { created, skipped, errors };
    }

    private buildWhere(tenantId: string, filters?: { groupId?: string; subgroupId?: string; uncategorized?: boolean }) {
        return {
            tenant_id: tenantId,
            deleted_at: null,
            ...(filters?.uncategorized
                ? { group_id: null, subgroup_id: null }
                : {
                      ...(filters?.groupId ? { group_id: filters.groupId } : {}),
                      ...(filters?.subgroupId ? { subgroup_id: filters.subgroupId } : {}),
                  }),
        };
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
