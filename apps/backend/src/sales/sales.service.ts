import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSaleDto, UpdateSaleDto } from './sale.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules } from '../accounting/posting.utils';
import { cursorPaginate, CursorPaginatedResult } from '../common/pagination.dto';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class SalesService {
    private readonly logger = new Logger(SalesService.name);

    constructor(
        private db: DatabaseService,
        private emailService: EmailService,
        private smsService: SmsService,
    ) { }

    async create(tenantId: string, dto: CreateSaleDto) {
        const result = await this.db.$transaction(async (tx) => {
            const warehouseId = await resolveWarehouseId(tx, tenantId, dto.storeId, dto.warehouseId, 'sale');
            const saleProducts = await tx.product.findMany({
                where: {
                    tenant_id: tenantId,
                    id: { in: dto.items.map((item) => item.productId) },
                },
                select: { id: true, name: true, warranty_enabled: true },
            });

            const productById = new Map(saleProducts.map((product) => [product.id, product]));
            this.validateWarrantySerials(dto.items, productById);

            // 1. Generate Serial Number (Simplified for v0.1)
            const serialNumber = `SL-${Date.now()}`;

            // 2. Create Sale Record
            const sale = await tx.sale.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    counter_id: dto.counterId ?? null,
                    customer_id: dto.customerId,
                    serial_number: serialNumber,
                    total_amount: dto.totalAmount,
                    amount_paid: dto.amountPaid,
                    status: 'COMPLETED',
                    note: dto.note,
                    payments: dto.payments ? {
                        create: dto.payments.map(p => ({
                            payment_method: p.paymentMethod,
                            amount: p.amount
                        }))
                    } : undefined
                },
            });

            // 3. Process Items and update stock
            for (const item of dto.items) {
                const product = productById.get(item.productId);
                // Create Sale Item
                await tx.saleItem.create({
                    data: {
                        sale_id: sale.id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        price_at_sale: item.priceAtSale,
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
                    unitCost: item.priceAtSale,
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
            if (dto.customerId) {
                await tx.customer.update({
                    where: { id: dto.customerId },
                    data: {
                        total_spent: { increment: dto.totalAmount }
                    }
                });
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
            });

            return {
                ...sale,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });

        // Fire-and-forget receipt email (after transaction commits)
        if (dto.customerId) {
            this.sendReceiptEmail(tenantId, dto.customerId, Number(result.total_amount), result.serial_number);
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

                // Create new items and decrement stock
                for (const item of dto.items) {
                    await tx.saleItem.create({
                        data: {
                            sale_id: id,
                            product_id: item.productId,
                            quantity: item.quantity,
                            price_at_sale: item.priceAtSale,
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
                        unitCost: item.priceAtSale,
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
}
