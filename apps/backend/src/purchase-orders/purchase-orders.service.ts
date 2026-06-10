import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './purchase-order.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

@Injectable()
export class PurchaseOrdersService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreatePurchaseOrderDto) {
        const store = await this.db.store.findFirst({
            where: { id: dto.storeId, tenant_id: tenantId },
        });
        if (!store) throw new NotFoundException('Store not found');

        const productIds = dto.items.map((i) => i.productId);
        const products = await this.db.product.findMany({
            where: { tenant_id: tenantId, id: { in: productIds } },
        });
        if (products.length !== dto.items.length) {
            throw new BadRequestException('One or more products not found.');
        }

        if (dto.supplierId) {
            const supplier = await this.db.supplier.findFirst({
                where: { id: dto.supplierId, tenant_id: tenantId, deleted_at: null },
            });
            if (!supplier) throw new BadRequestException('Supplier not found.');
        }

        const subtotal = dto.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
        const tax = dto.taxAmount ?? 0;
        const discount = dto.discountAmount ?? 0;
        const freight = dto.freightAmount ?? 0;
        const total = subtotal + tax + freight - discount;

        const count = await this.db.purchaseOrder.count({ where: { tenant_id: tenantId } });
        const poNumber = `PO-${String(count + 1).padStart(5, '0')}`;

        return this.db.purchaseOrder.create({
            data: {
                tenant_id: tenantId,
                store_id: dto.storeId,
                supplier_id: dto.supplierId,
                po_number: poNumber,
                expected_date: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
                subtotal_amount: subtotal,
                tax_amount: tax,
                discount_amount: discount,
                freight_amount: freight,
                total_amount: total,
                notes: dto.notes,
                items: {
                    create: dto.items.map((i) => ({
                        product_id: i.productId,
                        quantity: i.quantity,
                        unit_cost: i.unitCost,
                        line_total: i.quantity * i.unitCost,
                    })),
                },
            },
            include: {
                supplier: true,
                store: { select: { name: true } },
                items: { include: { product: true } },
            },
        });
    }

    async findAll(tenantId: string) {
        return this.db.purchaseOrder.findMany({
            where: { tenant_id: tenantId },
            include: {
                supplier: true,
                store: { select: { name: true } },
                items: { include: { product: true } },
            },
            orderBy: { created_at: 'desc' },
        });
    }

    async findOne(tenantId: string, id: string) {
        const po = await this.db.purchaseOrder.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                supplier: true,
                store: { select: { name: true } },
                items: { include: { product: true } },
            },
        });
        if (!po) throw new NotFoundException('Purchase order not found');
        return po;
    }

    async updateStatus(tenantId: string, id: string, dto: UpdatePurchaseOrderStatusDto) {
        const po = await this.db.purchaseOrder.findFirst({
            where: { id, tenant_id: tenantId },
            include: { items: true },
        });
        if (!po) throw new NotFoundException('Purchase order not found');

        if (po.status === 'RECEIVED') {
            throw new BadRequestException('This purchase order has already been received.');
        }
        if (po.status === 'CANCELLED') {
            throw new BadRequestException('Cancelled purchase orders cannot be updated.');
        }

        if (dto.status === 'RECEIVED') {
            return this.db.$transaction(async (tx) => {
                const warehouseId = await resolveWarehouseId(tx, tenantId, po.store_id, undefined, 'purchase');

                for (const item of po.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.product_id,
                        warehouseId,
                        quantityDelta: item.quantity,
                        movementType: 'PURCHASE_RECEIPT',
                        referenceType: 'PURCHASE_ORDER',
                        referenceId: po.id,
                        unitCost: Number(item.unit_cost),
                    });
                }

                await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'purchase',
                    conditionKey: 'payment_mode',
                    conditionValue: 'credit',
                    sourceModule: 'purchase-orders',
                    sourceType: 'purchase_order',
                    sourceId: po.id,
                    amount: Number(po.total_amount),
                    description: `Auto-posted PO ${po.po_number}`,
                    referenceNumber: po.po_number,
                });

                return tx.purchaseOrder.update({
                    where: { id },
                    data: { status: 'RECEIVED', received_at: new Date() },
                    include: {
                        supplier: true,
                        store: { select: { name: true } },
                        items: { include: { product: true } },
                    },
                });
            });
        }

        return this.db.purchaseOrder.update({
            where: { id },
            data: { status: dto.status },
            include: {
                supplier: true,
                store: { select: { name: true } },
                items: { include: { product: true } },
            },
        });
    }

    async getInvoiceData(tenantId: string, id: string) {
        const [po, tenant] = await Promise.all([
            this.db.purchaseOrder.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    supplier: true,
                    store: { select: { name: true } },
                    items: { include: { product: true } },
                },
            }),
            this.db.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    name: true,
                    brand_primary_color: true,
                    brand_logo_url: true,
                    brand_business_name: true,
                    vat_registration_no: true,
                    business_tin: true,
                },
            }),
        ]);
        if (!po) throw new NotFoundException('Purchase order not found');
        return { purchaseOrder: po, tenant };
    }
}
