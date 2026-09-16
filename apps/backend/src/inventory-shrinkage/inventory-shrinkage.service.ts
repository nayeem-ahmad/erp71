import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { createdAtRange } from '../common/created-range.util';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { CreateInventoryShrinkageDto, ShrinkageDirection } from './inventory-shrinkage.dto';
import { autoPostFromRules } from '../accounting/posting.utils';

/**
 * Everything that differs between writing stock off and putting a surplus back.
 *
 * Held in one table so the two directions cannot drift apart: a reference
 * series is only unique because nothing else uses its prefix, and a reason type
 * is only meaningful because the other direction cannot reach it.
 */
const DIRECTION_RULES: Record<
    ShrinkageDirection,
    { reasonType: string; referencePrefix: string; movementType: string; sign: 1 | -1; label: string }
> = {
    // Stock leaves. The movement is QUANTITY_ONLY (see product-cost.utils.ts),
    // so the goods leave at the weighted average rather than at anything this
    // document says.
    LOSS: { reasonType: 'SHRINKAGE', referencePrefix: 'SHR', movementType: 'SHRINKAGE', sign: -1, label: 'shrinkage' },
    // Stock arrives — but not from anywhere, which is exactly why STOCK_FOUND
    // must stay off the REVALUE list. Nobody knows what found goods cost, and
    // the honest answer is that they join the pool at the average the rest of
    // that product is already held at. Adding it to COST_BEHAVIOUR later would
    // let a counter revalue inventory by typing a number into a stock screen.
    FOUND: { reasonType: 'FOUND', referencePrefix: 'FND', movementType: 'STOCK_FOUND', sign: 1, label: 'stock found' },
};

@Injectable()
export class InventoryShrinkageService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateInventoryShrinkageDto) {
        this.assertUniqueLines(dto.items.map((item) => item.productId));

        const direction: ShrinkageDirection = dto.direction ?? 'LOSS';
        const rules = DIRECTION_RULES[direction];

        return this.db.$transaction(async (tx) => {
            await assertWarehouseBelongsToTenant(tx, tenantId, dto.warehouseId);
            await this.assertActiveReason(tx, tenantId, dto.reasonId, rules.reasonType);

            // Counted per direction so the two series number independently:
            // SHR-00007 and FND-00001 are the seventh write-off and the first
            // surplus, not the seventh and eighth of one muddled sequence.
            const count = await tx.inventoryShrinkage.count({
                where: { tenant_id: tenantId, direction },
            });
            const referenceNumber = `${rules.referencePrefix}-${String(count + 1).padStart(5, '0')}`;

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
                    quantityDelta: rules.sign * item.quantity,
                    movementType: rules.movementType,
                    referenceType: 'INVENTORY_SHRINKAGE',
                    referenceId: referenceNumber,
                    // No unitCost: written-off stock leaves at the weighted
                    // average, which the movement is stamped with. This used to
                    // pass the product's *selling* price, overstating every
                    // shrinkage write-off by the whole margin on it. Found stock
                    // joins at that same average for the same reason.
                    note: item.note,
                });
            }

            const shrinkage = await tx.inventoryShrinkage.create({
                data: {
                    tenant_id: tenantId,
                    warehouse_id: dto.warehouseId,
                    reason_id: dto.reasonId,
                    direction,
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
                conditionValue: shrinkage.reason?.code ?? rules.reasonType,
                sourceModule: 'inventory',
                sourceType: direction === 'FOUND' ? 'stock_found' : 'shrinkage',
                sourceId: shrinkage.id,
                amount: shrinkageAmount || 0,
                description: `Auto-posted ${rules.label} ${shrinkage.reference_number}`,
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

    async findAll(
        tenantId: string,
        opts?: { createdFrom?: string; createdTo?: string; timezone: string; direction?: ShrinkageDirection },
    ) {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        return this.db.inventoryShrinkage.findMany({
            where: {
                tenant_id: tenantId,
                ...(opts?.direction ? { direction: opts.direction } : {}),
                ...(created ? { created_at: created } : {}),
            },
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

    /**
     * The reason must belong to *this direction's* catalogue, not merely exist.
     * Without the `type` check a FOUND entry could be filed under "Theft" by
     * anyone posting straight to the API, and the shrinkage report would then
     * show a reason whose stock went the other way.
     */
    private async assertActiveReason(tx: any, tenantId: string, reasonId: string, type: string) {
        const reason = await tx.inventoryReason.findFirst({
            where: { id: reasonId, tenant_id: tenantId, type, is_active: true },
        });
        if (!reason) {
            throw new BadRequestException(`Select an active ${type} reason for this entry.`);
        }
    }
}
