import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { issueDocumentNumber, numberTakenIn } from '../database/document-number.utils';
import { createdAtRange } from '../common/created-range.util';
import { applyInventoryMovement, assertWarehouseBelongsToTenant } from '../database/inventory.utils';
import { resolveProductCosts } from '../database/product-cost.utils';
import { CreateInventoryShrinkageDto, ShrinkageDirection, UpdateInventoryShrinkageDto } from './inventory-shrinkage.dto';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';

/**
 * Everything that differs between writing stock off and putting a surplus back.
 *
 * Held in one table so the two directions cannot drift apart: each numbers
 * its own series (SHR-00007 and FND-00001 are the seventh write-off and the
 * first surplus, not one muddled sequence), and a reason type is only
 * meaningful because the other direction cannot reach it.
 */
const DIRECTION_RULES: Record<
    ShrinkageDirection,
    {
        reasonType: string;
        docType: 'SHRINKAGE' | 'STOCK_FOUND';
        movementType: string;
        /** What a correction or a delete writes to take this document's stock back. */
        reversalType: string;
        sign: 1 | -1;
        label: string;
    }
> = {
    // Stock leaves. The movement is QUANTITY_ONLY (see product-cost.utils.ts),
    // so the goods leave at the weighted average rather than at anything this
    // document says.
    LOSS: {
        reasonType: 'SHRINKAGE',
        docType: 'SHRINKAGE',
        movementType: 'SHRINKAGE',
        reversalType: 'SHRINKAGE_REVERSAL',
        sign: -1,
        label: 'stock discrepancy',
    },
    // Stock arrives — but not from anywhere, which is exactly why STOCK_FOUND
    // must stay off the REVALUE list. Nobody knows what found goods cost, and
    // the honest answer is that they join the pool at the average the rest of
    // that product is already held at. Adding it to COST_BEHAVIOUR later would
    // let a counter revalue inventory by typing a number into a stock screen.
    FOUND: {
        reasonType: 'FOUND',
        docType: 'STOCK_FOUND',
        movementType: 'STOCK_FOUND',
        reversalType: 'STOCK_FOUND_REVERSAL',
        sign: 1,
        label: 'stock found',
    },
};

/** Ghost-doc guard: the two directions differ only in this, resolved from the stored row. */
function directionOf(record: { direction?: string | null }): ShrinkageDirection {
    return record.direction === 'FOUND' ? 'FOUND' : 'LOSS';
}

@Injectable()
export class InventoryShrinkageService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateInventoryShrinkageDto) {
        this.assertUniqueLines(dto.items.map((item) => item.productId));

        const direction: ShrinkageDirection = dto.direction ?? 'LOSS';
        const rules = DIRECTION_RULES[direction];

        return this.db.$transaction(async (tx) => {
            const warehouse = await assertWarehouseBelongsToTenant(tx, tenantId, dto.warehouseId);
            await this.assertActiveReason(tx, tenantId, dto.reasonId, rules.reasonType);

            // Checked against both directions' numbers: they share the column.
            const referenceNumber = await issueDocumentNumber(tx, {
                tenantId,
                docType: rules.docType,
                storeId: warehouse.store_id,
                isTaken: numberTakenIn(tx.inventoryShrinkage, tenantId, 'reference_number'),
            });

            // Existence and tenant ownership of every line's product. The rows
            // themselves are no longer read for a price — the cost comes from
            // the pool below.
            await this.assertProductsExist(tx, tenantId, dto.items);

            // What the goods cost, not what they sell for. Resolved before the
            // movements run, so it is the average the stock leaves at — an issue
            // does not move the average, so reading it up front and decrementing
            // afterwards agree. A product the pool has never seen is left
            // uncosted rather than stored at zero.
            const costs = await resolveProductCosts(tx, {
                tenantId,
                storeId: warehouse.store_id,
                productIds: dto.items.map((item) => item.productId),
            });

            await this.applyLines(tx, tenantId, dto.warehouseId, referenceNumber, dto.items, rules);

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
                            // The cost the stock was held at, snapshotted so a
                            // later price change cannot restate this write-off.
                            unit_cost: costs.get(item.productId) ?? null,
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

    /**
     * Correct a posted entry.
     *
     * The old lines' stock is taken back first and the corrected lines applied
     * after, the same order purchase edit uses — an entry whose goods have
     * partly sold would otherwise dip below zero half way through the
     * correction. Direction and warehouse are read off the stored row, never
     * the request: they decide the reference series and where the stock moved,
     * so changing them would replace the document rather than correct it.
     *
     * The auto-posted voucher is voided and re-posted on its original date, so
     * the correction lands beside the entry it corrects. The void itself
     * refuses when that date sits in a locked fiscal period.
     */
    async update(tenantId: string, id: string, dto: UpdateInventoryShrinkageDto) {
        this.assertUniqueLines(dto.items.map((item) => item.productId));

        return this.db.$transaction(async (tx) => {
            const existing = await tx.inventoryShrinkage.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true, warehouse: true },
            });

            if (!existing) {
                throw new NotFoundException('Stock discrepancy entry not found.');
            }

            const direction = directionOf(existing);
            const rules = DIRECTION_RULES[direction];

            await this.assertActiveReason(tx, tenantId, dto.reasonId, rules.reasonType);
            await this.assertProductsExist(tx, tenantId, dto.items);

            await this.reverseStock(tx, tenantId, existing, rules);

            // Resolved after the reversal and before the new lines: both
            // movements are QUANTITY_ONLY, so the pool is untouched either way
            // and this is the average the corrected goods leave at.
            const costs = await resolveProductCosts(tx, {
                tenantId,
                storeId: existing.warehouse?.store_id,
                productIds: dto.items.map((item) => item.productId),
            });

            await this.applyLines(tx, tenantId, existing.warehouse_id, existing.reference_number, dto.items, rules);

            await tx.inventoryShrinkageItem.deleteMany({ where: { shrinkage_id: id } });
            const updated = await tx.inventoryShrinkage.update({
                where: { id },
                data: {
                    reason_id: dto.reasonId,
                    notes: dto.notes,
                    items: {
                        create: dto.items.map((item) => ({
                            product_id: item.productId,
                            quantity: item.quantity,
                            unit_cost: costs.get(item.productId) ?? null,
                            note: item.note,
                        })),
                    },
                },
                include: this.shrinkageInclude(),
            });

            const amount = updated.items.reduce(
                (sum, item) => sum + Number(item.unit_cost ?? 0) * item.quantity,
                0,
            );

            // Read the old voucher's date before voiding it, so the re-post can
            // stay in the period the entry was originally written in.
            const original = await tx.postingEvent.findFirst({
                where: {
                    tenant_id: tenantId,
                    source_module: 'inventory',
                    source_type: direction === 'FOUND' ? 'stock_found' : 'shrinkage',
                    source_id: id,
                },
                include: { voucher: { select: { date: true } } },
            });
            const date = original?.voucher?.date ?? undefined;

            await voidAutoPostedVoucher(tx, tenantId, 'inventory_adjustment', id);
            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'inventory_adjustment',
                conditionKey: 'reason_type',
                conditionValue: updated.reason?.code ?? rules.reasonType,
                sourceModule: 'inventory',
                sourceType: direction === 'FOUND' ? 'stock_found' : 'shrinkage',
                sourceId: id,
                amount: amount || 0,
                description: `Auto-posted ${rules.label} ${updated.reference_number}`,
                referenceNumber: updated.reference_number,
                storeId: updated.warehouse?.store_id,
                date,
            });

            return {
                ...updated,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    /**
     * Delete a posted entry, putting its stock and its voucher back first.
     *
     * Stock first, then the books: if the goods cannot be returned — a found
     * surplus that has since been sold, say — the movement guard refuses and
     * the whole transaction rolls back, so the ledger is never left without the
     * entry that explains it.
     */
    async remove(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const existing = await tx.inventoryShrinkage.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true, warehouse: true },
            });

            if (!existing) {
                throw new NotFoundException('Stock discrepancy entry not found.');
            }

            const rules = DIRECTION_RULES[directionOf(existing)];

            await this.reverseStock(tx, tenantId, existing, rules);
            await voidAutoPostedVoucher(tx, tenantId, 'inventory_adjustment', id);
            await tx.inventoryShrinkage.delete({ where: { id } });

            return { deleted: true, id };
        });
    }

    async findAll(
        tenantId: string,
        opts?: { createdFrom?: string; createdTo?: string; timezone: string; direction?: ShrinkageDirection; storeId?: string },
    ) {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        return this.db.inventoryShrinkage.findMany({
            where: {
                tenant_id: tenantId,
                ...(opts?.storeId ? { warehouse: { store_id: opts.storeId } } : {}),
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
            include: this.shrinkageInclude({ withStock: true }),
        });

        if (!shrinkage) {
            throw new NotFoundException('Stock discrepancy entry not found.');
        }

        return shrinkage;
    }

    /**
     * `withStock` adds each product's stock rows, which the entry form needs to
     * show what the warehouse holds while a posted entry is being corrected.
     * The list does not ask for it: a page of entries times every warehouse's
     * stock is a lot of rows for a grid that never shows the figure.
     */
    private shrinkageInclude({ withStock = false }: { withStock?: boolean } = {}) {
        return {
            warehouse: true,
            reason: true,
            items: {
                include: { product: withStock ? { include: { stocks: true } } : true },
                orderBy: { product: { name: 'asc' as const } },
            },
        };
    }

    private assertUniqueLines(productIds: string[]) {
        if (new Set(productIds).size !== productIds.length) {
            throw new BadRequestException('Duplicate product lines are not allowed.');
        }
    }

    /** Existence and tenant ownership of every product a line names. */
    private async assertProductsExist(tx: any, tenantId: string, items: { productId: string }[]) {
        const products = await tx.product.findMany({
            where: { tenant_id: tenantId, id: { in: items.map((item) => item.productId) } },
        });

        if (products.length !== items.length) {
            throw new BadRequestException('One or more products were not found for this tenant.');
        }
    }

    /**
     * Write the document's own stock movements.
     *
     * No unitCost is passed: written-off stock leaves at the weighted average,
     * which the movement is stamped with. This used to pass the product's
     * *selling* price, overstating every write-off by the whole margin on it.
     * Found stock joins at that same average for the same reason.
     */
    private async applyLines(
        tx: any,
        tenantId: string,
        warehouseId: string,
        referenceNumber: string,
        items: Array<{ productId: string; quantity: number; note?: string }>,
        rules: (typeof DIRECTION_RULES)[ShrinkageDirection],
    ) {
        for (const item of items) {
            await applyInventoryMovement(tx, {
                tenantId,
                productId: item.productId,
                warehouseId,
                quantityDelta: rules.sign * item.quantity,
                movementType: rules.movementType,
                referenceType: 'INVENTORY_SHRINKAGE',
                referenceId: referenceNumber,
                note: item.note,
            });
        }
    }

    /**
     * Take a stored entry's stock back. Mirrors `applyLines` with the sign
     * flipped and a reversal movement type, so the ledger shows the correction
     * rather than losing the original movement.
     */
    private async reverseStock(
        tx: any,
        tenantId: string,
        existing: { warehouse_id: string; reference_number: string; items: Array<{ product_id: string; quantity: number }> },
        rules: (typeof DIRECTION_RULES)[ShrinkageDirection],
    ) {
        for (const item of existing.items) {
            await applyInventoryMovement(tx, {
                tenantId,
                productId: item.product_id,
                warehouseId: existing.warehouse_id,
                quantityDelta: -rules.sign * item.quantity,
                movementType: rules.reversalType,
                referenceType: 'INVENTORY_SHRINKAGE',
                referenceId: existing.reference_number,
            });
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
            throw new BadRequestException(
                `Select an active ${type === 'SHRINKAGE' ? 'stock discrepancy' : 'stock found'} reason for this entry.`,
            );
        }
    }
}
