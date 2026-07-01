import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { CreateInventoryShrinkageDto } from './inventory-shrinkage.dto';
import { autoPostFromRules } from '../accounting/posting.utils';

@Injectable()
export class InventoryShrinkageService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateInventoryShrinkageDto) {
        this.assertUniqueLines(dto.items.map((item) => item.productId));

        return this.db.$transaction(async (tx) => {
            await assertWarehouseBelongsToTenant(tx, tenantId, dto.warehouseId);
            await this.assertActiveReason(tx, tenantId, dto.reasonId, 'SHRINKAGE');

            const count = await tx.inventoryShrinkage.count({ where: { tenant_id: tenantId } });
            const referenceNumber = `SHR-${String(count + 1).padStart(5, '0')}`;

            const products = await tx.product.findMany({
                where: { tenant_id: tenantId, id: { in: dto.items.map((item) => item.productId) } },
            });

            if (products.length !== dto.items.length) {
                throw new BadRequestException('One or more products were not found for this tenant.');
            }

            const productsById = new Map(products.map((product) => [product.id, product]));

            for (const item of dto.items) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.productId,
                    warehouseId: dto.warehouseId,
                    quantityDelta: -item.quantity,
                    movementType: 'SHRINKAGE',
                    referenceType: 'INVENTORY_SHRINKAGE',
                    referenceId: referenceNumber,
                    unitCost: Number(productsById.get(item.productId)?.price ?? 0),
                    note: item.note,
                });
            }

            const shrinkage = await tx.inventoryShrinkage.create({
                data: {
                    tenant_id: tenantId,
                    warehouse_id: dto.warehouseId,
                    reason_id: dto.reasonId,
                    reference_number: referenceNumber,
                    notes: dto.notes,
                    items: {
                        create: dto.items.map((item) => ({
                            product_id: item.productId,
                            quantity: item.quantity,
                            unit_cost: productsById.get(item.productId)?.price,
                            note: item.note,
                        })),
                    },
                },
                include: this.shrinkageInclude(),
            });

            const shrinkageAmount = shrinkage.items.reduce(
                (sum, item) => sum + Number(item.unit_cost ?? 0) * item.quantity,
                0,
            );

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'inventory_adjustment',
                conditionKey: 'reason_type',
                conditionValue: shrinkage.reason?.code ?? 'SHRINKAGE',
                sourceModule: 'inventory',
                sourceType: 'shrinkage',
                sourceId: shrinkage.id,
                amount: shrinkageAmount || 0,
                description: `Auto-posted shrinkage ${shrinkage.reference_number}`,
                referenceNumber: shrinkage.reference_number,
                storeId: shrinkage.warehouse?.store_id,
            });

            return {
                ...shrinkage,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    async findAll(tenantId: string) {
        return this.db.inventoryShrinkage.findMany({
            where: { tenant_id: tenantId },
            include: this.shrinkageInclude(),
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
    }

    async findOne(tenantId: string, id: string) {
        const shrinkage = await this.db.inventoryShrinkage.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.shrinkageInclude(),
        });

        if (!shrinkage) {
            throw new NotFoundException('Shrinkage record not found.');
        }

        return shrinkage;
    }

    private shrinkageInclude() {
        return {
            warehouse: true,
            reason: true,
            items: {
                include: { product: true },
                orderBy: { product: { name: 'asc' as const } },
            },
        };
    }

    private assertUniqueLines(productIds: string[]) {
        if (new Set(productIds).size !== productIds.length) {
            throw new BadRequestException('Duplicate product lines are not allowed.');
        }
    }

    private async assertActiveReason(tx: any, tenantId: string, reasonId: string, type: string) {
        const reason = await tx.inventoryReason.findFirst({
            where: { id: reasonId, tenant_id: tenantId, type, is_active: true },
        });
        if (!reason) {
            throw new BadRequestException('Active inventory reason not found for this workflow.');
        }
    }
}