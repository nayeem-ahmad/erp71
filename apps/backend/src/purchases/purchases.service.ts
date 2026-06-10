import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseDto } from './purchase.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';

@Injectable()
export class PurchasesService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreatePurchaseDto) {
        const store = await this.db.store.findFirst({
            where: { id: dto.storeId, tenant_id: tenantId },
        });

        if (!store) {
            throw new NotFoundException('Store not found');
        }

        const products = await this.db.product.findMany({
            where: {
                tenant_id: tenantId,
                id: { in: dto.items.map((item) => item.productId) },
            },
        });

        if (products.length !== dto.items.length) {
            throw new BadRequestException('One or more products do not exist for this tenant.');
        }

        const subtotal = dto.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
        const taxAmount = dto.taxAmount ?? 0;
        const discountAmount = dto.discountAmount ?? 0;
        const freightAmount = dto.freightAmount ?? 0;
        const totalAmount = subtotal + taxAmount + freightAmount - discountAmount;

        return this.db.$transaction(async (tx) => {
            const warehouseId = await resolveWarehouseId(tx, tenantId, store.id, dto.warehouseId, 'purchase');
            let supplierId = dto.supplierId;

            if (dto.newSupplier) {
                const existingSupplier = await tx.supplier.findUnique({
                    where: { tenant_id_name: { tenant_id: tenantId, name: dto.newSupplier.name } },
                });

                if (existingSupplier) {
                    supplierId = existingSupplier.id;
                } else {
                    const supplier = await tx.supplier.create({
                        data: {
                            tenant_id: tenantId,
                            name: dto.newSupplier.name,
                            phone: dto.newSupplier.phone,
                            email: dto.newSupplier.email,
                            address: dto.newSupplier.address,
                        },
                    });
                    supplierId = supplier.id;
                }
            } else if (supplierId) {
                const supplier = await tx.supplier.findFirst({
                    where: { id: supplierId, tenant_id: tenantId },
                });

                if (!supplier) {
                    throw new BadRequestException('Supplier not found for this tenant.');
                }
            }

            const count = await tx.purchase.count({ where: { tenant_id: tenantId } });
            const purchaseNumber = `PUR-${String(count + 1).padStart(5, '0')}`;

            const purchase = await tx.purchase.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    supplier_id: supplierId,
                    purchase_number: purchaseNumber,
                    subtotal_amount: subtotal,
                    tax_amount: taxAmount,
                    discount_amount: discountAmount,
                    freight_amount: freightAmount,
                    total_amount: totalAmount,
                    notes: dto.notes,
                },
            });

            for (const item of dto.items) {
                await tx.purchaseItem.create({
                    data: {
                        purchase_id: purchase.id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        unit_cost: item.unitCost,
                        line_total: item.quantity * item.unitCost,
                    },
                });

                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.productId,
                    warehouseId,
                    quantityDelta: item.quantity,
                    movementType: 'PURCHASE_RECEIPT',
                    referenceType: 'PURCHASE',
                    referenceId: purchase.id,
                    unitCost: item.unitCost,
                });
            }

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'purchase',
                conditionKey: 'payment_mode',
                conditionValue: 'credit',
                sourceModule: 'purchases',
                sourceType: 'purchase',
                sourceId: purchase.id,
                amount: Number(purchase.total_amount),
                description: `Auto-posted purchase ${purchase.purchase_number}`,
                referenceNumber: purchase.purchase_number,
            });

            const purchaseWithItems = await tx.purchase.findFirst({
                where: { id: purchase.id, tenant_id: tenantId },
                include: {
                    supplier: true,
                    items: {
                        include: { product: true, returnItems: true },
                    },
                },
            });

            return {
                ...purchaseWithItems,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    async findAll(tenantId: string) {
        const purchases = await this.db.purchase.findMany({
            where: { tenant_id: tenantId },
            include: {
                supplier: true,
                items: {
                    include: { product: true, returnItems: true },
                },
            },
            orderBy: { created_at: 'desc' },
        });

        const purchaseIds = purchases.map((purchase) => purchase.id);
        const vouchers = purchaseIds.length > 0
            ? await this.db.voucher.findMany({
                where: {
                    tenant_id: tenantId,
                    source_module: 'purchases',
                    source_type: 'purchase',
                    source_id: { in: purchaseIds },
                },
                select: {
                    source_id: true,
                    id: true,
                    voucher_number: true,
                    voucher_type: true,
                },
            })
            : [];

        const voucherByPurchaseId = new Map(vouchers.map((voucher) => [voucher.source_id, voucher]));

        return purchases.map((purchase) => {
            const voucher = voucherByPurchaseId.get(purchase.id);
            return {
                ...purchase,
                posting_status: voucher ? 'posted' : 'skipped',
                voucher_id: voucher?.id ?? null,
                voucher_number: voucher?.voucher_number ?? null,
                voucher_type: voucher?.voucher_type ?? null,
            };
        });
    }

    async getInvoiceData(tenantId: string, id: string) {
        const [purchase, tenant] = await Promise.all([
            this.db.purchase.findFirst({
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

        if (!purchase) throw new NotFoundException('Purchase not found');

        return { purchase, tenant };
    }

    async findOne(tenantId: string, id: string) {
        const purchase = await this.db.purchase.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                supplier: true,
                items: {
                    include: { product: true, returnItems: true },
                },
            },
        });

        if (!purchase) {
            throw new NotFoundException('Purchase not found');
        }

        const voucher = await this.db.voucher.findFirst({
            where: {
                tenant_id: tenantId,
                source_module: 'purchases',
                source_type: 'purchase',
                source_id: purchase.id,
            },
            select: {
                id: true,
                voucher_number: true,
                voucher_type: true,
            },
        });

        return {
            ...purchase,
            posting_status: voucher ? 'posted' : 'skipped',
            voucher_id: voucher?.id ?? null,
            voucher_number: voucher?.voucher_number ?? null,
            voucher_type: voucher?.voucher_type ?? null,
        };
    }
}