import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSaleDto, UpdateSaleDto } from './sale.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';
import { previewSaleLoyaltyRedemption, recordSaleLoyalty } from '../loyalty/loyalty-sale.utils';
import { cursorPaginate, CursorPaginatedResult } from '../common/pagination.dto';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { CrmCampaignsService } from '../crm-campaigns/crm-campaigns.service';

@Injectable()
export class SalesService {
    private readonly logger = new Logger(SalesService.name);

    constructor(
        private db: DatabaseService,
        private emailService: EmailService,
        private smsService: SmsService,
        private crmCampaigns: CrmCampaignsService,
    ) { }

    async create(tenantId: string, userId: string, dto: CreateSaleDto) {
        const result = await this.db.$transaction(async (tx) => {
            const warehouseId = await resolveWarehouseId(tx, tenantId, dto.storeId, dto.warehouseId, 'sale');
            const productIds = dto.items.map((item) => item.productId);

            const [saleProducts, productPrices] = await Promise.all([
                tx.product.findMany({
                    where: { tenant_id: tenantId, id: { in: productIds } },
                    select: { id: true, name: true, warranty_enabled: true },
                }),
                tx.productPrice.findMany({
                    where: {
                        tenant_id: tenantId,
                        product_id: { in: productIds },
                        cost: { not: null },
                        OR: [{ store_id: dto.storeId }, { store_id: null }],
                    },
                    orderBy: { effective_from: 'desc' },
                    select: { product_id: true, store_id: true, cost: true },
                }),
            ]);

            // Build cost map — store-specific price overrides global
            const costByProductId = new Map<string, number>();
            for (const pp of productPrices) {
                if (!costByProductId.has(pp.product_id) || pp.store_id === dto.storeId) {
                    costByProductId.set(pp.product_id, Number(pp.cost));
                }
            }

            const productById = new Map(saleProducts.map((product) => [product.id, product]));
            this.validateWarrantySerials(dto.items, productById);

            const itemsSubtotal = dto.items.reduce(
                (sum, item) => sum + item.quantity * item.priceAtSale,
                0,
            );
            const discountAmount = dto.discountAmount ?? 0;
            const preLoyaltyTotal = Math.max(0, itemsSubtotal - discountAmount);

            let loyaltyPreview = { loyaltyDiscount: 0, pointsRedeemed: 0 };
            if (dto.customerId && dto.pointsToRedeem && dto.pointsToRedeem > 0) {
                loyaltyPreview = await previewSaleLoyaltyRedemption(
                    tx,
                    tenantId,
                    dto.customerId,
                    preLoyaltyTotal,
                    dto.pointsToRedeem,
                );
            }
            const { loyaltyDiscount } = loyaltyPreview;

            const computedTotal = Math.max(0, preLoyaltyTotal - loyaltyDiscount);
            if (Math.abs(computedTotal - dto.totalAmount) > 0.02) {
                throw new BadRequestException(
                    `Sale total mismatch. Expected ৳${computedTotal.toFixed(2)} after discounts and loyalty.`,
                );
            }

            // 1. Generate Serial Number (Simplified for v0.1)
            const serialNumber = `SL-${Date.now()}`;

            // 2. Generate and validate reference number
            const referenceNumber = dto.referenceNumber
                ? await this.validateReferenceNumber(tenantId, dto.referenceNumber)
                : await this.generateReferenceNumber(tenantId, tx);

            // 3. Create Sale Record
            const sale = await tx.sale.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    counter_id: dto.counterId ?? null,
                    customer_id: dto.customerId,
                    serial_number: serialNumber,
                    reference_number: referenceNumber,
                    total_amount: computedTotal,
                    amount_paid: dto.amountPaid,
                    status: 'COMPLETED',
                    note: dto.note,
                    created_by: userId,
                    payments: dto.payments ? {
                        create: dto.payments.map(p => ({
                            payment_method: p.paymentMethod,
                            amount: p.amount,
                            account_id: p.accountId || null
                        }))
                    } : undefined
                },
            });

            // 3. Process Items and update stock
            for (const item of dto.items) {
                const product = productById.get(item.productId);
                const unitCostAtSale = costByProductId.get(item.productId) ?? null;

                // Create Sale Item
                await tx.saleItem.create({
                    data: {
                        sale_id: sale.id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        price_at_sale: item.priceAtSale,
                        unit_cost_at_sale: unitCostAtSale,
                    },
                });

                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.productId,
                    warehouseId,
                    quantityDelta: -item.quantity,
                    movementType: 'SALE',
                    referenceType: 'SALE',
                    referenceId: sale.id,
                    unitCost: unitCostAtSale ?? item.priceAtSale,
                });

                if (product?.warranty_enabled) {
                    for (const unitSerial of item.serialNumbers ?? []) {
                        const existingSerial = await tx.productSerial.findUnique({
                            where: {
                                tenant_id_product_id_serial_number: {
                                    tenant_id: tenantId,
                                    product_id: item.productId,
                                    serial_number: unitSerial,
                                },
                            },
                        });

                        if (existingSerial?.status === 'SOLD' && existingSerial.source_id !== sale.id) {
                            throw new BadRequestException(
                                `Serial number ${unitSerial} for ${product.name} has already been sold.`,
                            );
                        }

                        if (existingSerial) {
                            await tx.productSerial.update({
                                where: { id: existingSerial.id },
                                data: {
                                    store_id: dto.storeId,
                                    status: 'SOLD',
                                    source_type: 'SALE',
                                    source_id: sale.id,
                                    sold_at: new Date(),
                                },
                            });
                        } else {
                            await tx.productSerial.create({
                                data: {
                                    tenant_id: tenantId,
                                    store_id: dto.storeId,
                                    product_id: item.productId,
                                    serial_number: unitSerial,
                                    status: 'SOLD',
                                    source_type: 'SALE',
                                    source_id: sale.id,
                                    sold_at: new Date(),
                                },
                            });
                        }
                    }
                }
            }
            let loyaltyResult = { ...loyaltyPreview, pointsEarned: 0 };
            if (dto.customerId) {
                await tx.customer.update({
                    where: { id: dto.customerId },
                    data: {
                        total_spent: { increment: computedTotal },
                    },
                });

                loyaltyResult = await recordSaleLoyalty(
                    tx,
                    tenantId,
                    dto.customerId,
                    sale.id,
                    preLoyaltyTotal,
                    loyaltyPreview,
                );
            }

            const primaryPaymentMethod = dto.payments?.[0]?.paymentMethod?.toLowerCase() || 'cash';
            const paymentMode = primaryPaymentMethod.includes('bank') || primaryPaymentMethod.includes('card') || primaryPaymentMethod.includes('wallet')
                ? 'bank'
                : primaryPaymentMethod.includes('credit')
                    ? 'credit'
                    : 'cash';

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'sale',
                conditionKey: 'payment_mode',
                conditionValue: paymentMode,
                sourceModule: 'sales',
                sourceType: 'sale',
                sourceId: sale.id,
                amount: Number(sale.total_amount),
                description: `Auto-posted sale ${sale.serial_number}`,
                referenceNumber: sale.serial_number,
                storeId: dto.storeId,
            });

            return {
                ...sale,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
                loyalty: loyaltyResult,
            };
        });

        // Fire-and-forget receipt email (after transaction commits)
        if (dto.customerId) {
            this.sendReceiptEmail(tenantId, dto.customerId, Number(result.total_amount), result.serial_number);
            void this.crmCampaigns.attributeSale(tenantId, dto.customerId, Number(result.total_amount))
                .catch((err) => this.logger.warn(`CRM attribution failed for customer ${dto.customerId}: ${err}`));
        }

        return result;
    }

    private sendReceiptEmail(tenantId: string, customerId: string, totalAmount: number, serialNumber: string): void {
        Promise.all([
            this.db.customer.findUnique({
                where: { id: customerId },
                select: { email: true, name: true, phone: true },
            }),
            this.db.tenant.findUnique({
                where: { id: tenantId },
                select: { name: true, sms_on_sale: true },
            }),
        ])
            .then(([customer, tenant]) => {
                if (!tenant) return;

                const tasks: Promise<void>[] = [];

                if (customer?.email) {
                    tasks.push(
                        this.emailService.sendBillingInvoice(
                            customer.email,
                            tenant.name,
                            totalAmount,
                            'BDT',
                        ),
                    );
                }

                if (tenant.sms_on_sale && customer?.phone) {
                    tasks.push(
                        this.smsService.sendSaleReceipt(
                            customer.phone,
                            customer.name ?? 'Customer',
                            totalAmount,
                            serialNumber,
                            tenantId,
                        ),
                    );
                }

                return Promise.all(tasks);
            })
            .catch((e) => this.logger.warn(`Failed to send receipt notifications for customer ${customerId}: ${e}`));
    }

    async findAll(
        tenantId: string,
        opts?: { cursor?: string; limit?: number },
    ): Promise<CursorPaginatedResult<any>> {
        const limit = Math.min(opts?.limit ?? 20, 100);

        const sales = await this.db.sale.findMany({
            where: { tenant_id: tenantId },
            include: {
                items: { include: { product: true } },
                payments: true,
                customer: true,
            },
            orderBy: { created_at: 'desc' },
            take: limit + 1,
            ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
        });

        const saleIds = sales.map((sale) => sale.id);
        const vouchers = saleIds.length > 0
            ? await this.db.voucher.findMany({
                where: {
                    tenant_id: tenantId,
                    source_module: 'sales',
                    source_type: 'sale',
                    source_id: { in: saleIds },
                },
                select: {
                    source_id: true,
                    id: true,
                    voucher_number: true,
                    voucher_type: true,
                },
            })
            : [];

        const voucherBySaleId = new Map(vouchers.map((voucher) => [voucher.source_id, voucher]));

        const enriched = sales.map((sale) => {
            const voucher = voucherBySaleId.get(sale.id);
            return {
                ...sale,
                posting_status: voucher ? 'posted' : 'skipped',
                voucher_id: voucher?.id ?? null,
                voucher_number: voucher?.voucher_number ?? null,
                voucher_type: voucher?.voucher_type ?? null,
            };
        });

        return cursorPaginate(enriched, limit);
    }

    async findOne(tenantId: string, id: string) {
        const sale = await this.db.sale.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                items: { include: { product: true, returns: true } },
                payments: true,
                customer: true,
            },
        });

        if (!sale) {
            throw new NotFoundException('Sale not found');
        }

        const voucher = await this.db.voucher.findFirst({
            where: {
                tenant_id: tenantId,
                source_module: 'sales',
                source_type: 'sale',
                source_id: sale.id,
            },
            select: {
                id: true,
                voucher_number: true,
                voucher_type: true,
            },
        });

        return {
            ...sale,
            posting_status: voucher ? 'posted' : 'skipped',
            voucher_id: voucher?.id ?? null,
            voucher_number: voucher?.voucher_number ?? null,
            voucher_type: voucher?.voucher_type ?? null,
        };
    }

    async update(tenantId: string, id: string, dto: UpdateSaleDto) {
        return this.db.$transaction(async (tx) => {
            const sale = await tx.sale.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true, payments: true },
            });

            if (!sale) {
                throw new NotFoundException('Sale not found');
            }

            // 1. If items are being replaced, reverse old stock and apply new
            if (dto.items) {
                const warehouseId = await resolveWarehouseId(tx, tenantId, sale.store_id, undefined, 'sale');
                // Reverse stock for old items
                for (const oldItem of sale.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: oldItem.product_id,
                        warehouseId,
                        quantityDelta: oldItem.quantity,
                        movementType: 'SALE_EDIT_REVERSAL',
                        referenceType: 'SALE',
                        referenceId: id,
                    });
                }

                // Delete old items
                await tx.saleItem.deleteMany({ where: { sale_id: id } });

                // Fetch current cost for new items
                const editProductIds = dto.items.map((i) => i.productId);
                const editPrices = await tx.productPrice.findMany({
                    where: {
                        tenant_id: tenantId,
                        product_id: { in: editProductIds },
                        cost: { not: null },
                        OR: [{ store_id: sale.store_id }, { store_id: null }],
                    },
                    orderBy: { effective_from: 'desc' },
                    select: { product_id: true, store_id: true, cost: true },
                });
                const editCostMap = new Map<string, number>();
                for (const pp of editPrices) {
                    if (!editCostMap.has(pp.product_id) || pp.store_id === sale.store_id) {
                        editCostMap.set(pp.product_id, Number(pp.cost));
                    }
                }

                // Create new items and decrement stock
                for (const item of dto.items) {
                    const unitCostAtSale = editCostMap.get(item.productId) ?? null;

                    await tx.saleItem.create({
                        data: {
                            sale_id: id,
                            product_id: item.productId,
                            quantity: item.quantity,
                            price_at_sale: item.priceAtSale,
                            unit_cost_at_sale: unitCostAtSale,
                        },
                    });

                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.productId,
                        warehouseId,
                        quantityDelta: -item.quantity,
                        movementType: 'SALE_EDIT',
                        referenceType: 'SALE',
                        referenceId: id,
                        unitCost: unitCostAtSale ?? item.priceAtSale,
                    });
                }

            }

            // 2. If payments are being replaced
            if (dto.payments) {
                await tx.paymentRecord.deleteMany({ where: { sale_id: id } });
                for (const p of dto.payments) {
                    await tx.paymentRecord.create({
                        data: {
                            sale_id: id,
                            payment_method: p.paymentMethod,
                            amount: p.amount,
                        },
                    });
                }
            }

            // 3. Recalculate totals if items changed
            const totalAmount = dto.items
                ? dto.items.reduce((sum, i) => sum + i.quantity * i.priceAtSale, 0)
                : undefined;
            const amountPaid = dto.payments
                ? dto.payments.reduce((sum, p) => sum + p.amount, 0)
                : undefined;

            // 4. Handle customer total_spent adjustment
            if (dto.customerId !== undefined && dto.customerId !== sale.customer_id) {
                // Decrement old customer
                if (sale.customer_id) {
                    await tx.customer.update({
                        where: { id: sale.customer_id },
                        data: { total_spent: { decrement: Number(sale.total_amount) } },
                    });
                }
                // Increment new customer
                if (dto.customerId) {
                    await tx.customer.update({
                        where: { id: dto.customerId },
                        data: { total_spent: { increment: totalAmount ?? Number(sale.total_amount) } },
                    });
                }
            } else if (totalAmount !== undefined && sale.customer_id) {
                // Same customer but total changed
                const diff = totalAmount - Number(sale.total_amount);
                if (diff !== 0) {
                    await tx.customer.update({
                        where: { id: sale.customer_id },
                        data: { total_spent: { increment: diff } },
                    });
                }
            }

            // 5. Update sale record
            return tx.sale.update({
                where: { id },
                data: {
                    ...(dto.customerId !== undefined && { customer_id: dto.customerId || null }),
                    ...(dto.status && { status: dto.status }),
                    ...(dto.note !== undefined && { note: dto.note }),
                    ...(totalAmount !== undefined && { total_amount: totalAmount }),
                    ...(amountPaid !== undefined && { amount_paid: amountPaid }),
                },
                include: {
                    items: { include: { product: true } },
                    payments: true,
                },
            });
        });
    }

    async getInvoiceData(tenantId: string, id: string) {
        const [sale, tenant] = await Promise.all([
            this.db.sale.findFirst({
                where: { id, tenant_id: tenantId },
                include: {
                    items: { include: { product: true } },
                    payments: true,
                    customer: true,
                    store: { select: { name: true } },
                },
            }),
            this.db.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    name: true,
                    default_vat_rate: true,
                    vat_registration_no: true,
                    business_tin: true,
                    brand_primary_color: true,
                    brand_logo_url: true,
                    brand_business_name: true,
                },
            }),
        ]);

        if (!sale) throw new NotFoundException('Sale not found');

        return { sale, tenant };
    }

    private validateWarrantySerials(
        items: CreateSaleDto['items'],
        productById: Map<string, { id: string; name: string; warranty_enabled: boolean }>,
    ) {
        for (const item of items) {
            const product = productById.get(item.productId);
            if (!product) {
                throw new BadRequestException(`Product not found for sale item: ${item.productId}`);
            }

            if (!product.warranty_enabled) {
                continue;
            }

            const normalizedSerials = (item.serialNumbers ?? [])
                .map((value) => value.trim())
                .filter((value) => value.length > 0);

            if (normalizedSerials.length !== item.quantity) {
                throw new BadRequestException(
                    `Warranty product "${product.name}" requires ${item.quantity} serial number(s).`,
                );
            }

            const unique = new Set(normalizedSerials);
            if (unique.size !== normalizedSerials.length) {
                throw new BadRequestException(`Warranty product "${product.name}" has duplicate serial numbers.`);
            }

            item.serialNumbers = normalizedSerials;
        }
    }

    async validateReferenceNumber(tenantId: string, referenceNumber: string | undefined) {
        if (!referenceNumber) return null;

        const existing = await this.db.sale.findFirst({
            where: { tenant_id: tenantId, reference_number: referenceNumber },
        });

        if (existing) {
            throw new BadRequestException('Reference number already exists');
        }

        return referenceNumber;
    }

    async generateReferenceNumber(tenantId: string, tx: any): Promise<string> {
        const settings = await tx.salesSettings.findUnique({ where: { tenant_id: tenantId } });
        const format = settings?.reference_number_format || 'YYMM-#';

        // Generate based on format
        if (format.includes('YYMM')) {
            const now = new Date();
            const yy = String(now.getFullYear()).slice(-2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const template = format.replace('YYMM', `${yy}${mm}`); // e.g. '2606-#'
            // The literal prefix is everything before the '#' placeholder. Matching
            // on `template` directly would include the '#' and never match a stored
            // reference, so the sequence always reset to 001 and collided.
            const literalPrefix = template.slice(0, template.indexOf('#'));

            // Take the highest existing sequence for this YYMM prefix and add one.
            // The prefix already scopes the period (e.g. 2606- = June 2026), so do not
            // filter by created_at — yesterday's 2606-005 must yield 2606-006 today.
            const existing = await tx.sale.findMany({
                where: {
                    tenant_id: tenantId,
                    reference_number: { startsWith: literalPrefix },
                },
                select: { reference_number: true },
            });

            let maxSeq = 0;
            for (const { reference_number } of existing) {
                const seq = parseInt(reference_number.slice(literalPrefix.length), 10);
                if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
            }

            return `${literalPrefix}${String(maxSeq + 1).padStart(3, '0')}`;
        }

        throw new BadRequestException('Invalid reference number format in settings');
    }
}
