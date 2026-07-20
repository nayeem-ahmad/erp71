import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSaleDto, FinalizeSaleDto, UpdateSaleDto } from './sale.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { autoPostFromRules, type AutoPostResult } from '../accounting/posting.utils';
import { classifyPaymentMode } from './classify-payment-mode';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';
import { resolvePaymentMethodAccountId } from '../accounting/payment-account.util';
import { previewSaleLoyaltyRedemption, recordSaleLoyalty } from '../loyalty/loyalty-sale.utils';
import { cursorPaginate, CursorPaginatedResult } from '../common/pagination.dto';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { CrmCampaignsService } from '../crm-campaigns/crm-campaigns.service';
import {
    assertCustomerCreditForSale,
    creditDueAmount,
} from '../customers/customer-credit.utils';

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
        if (dto.isDraft) {
            return this.createDraft(tenantId, userId, dto);
        }

        const result = await this.db.$transaction(async (tx) => {
            const prep = await this.prepareSale(tx, tenantId, dto);

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
                    total_amount: prep.computedTotal,
                    amount_paid: dto.amountPaid,
                    sale_date: dto.saleDate ? new Date(dto.saleDate) : new Date(),
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

            return this.applySalePostings(tx, tenantId, userId, dto, sale, prep);
        });

        // Fire-and-forget receipt email (after transaction commits)
        if (dto.customerId) {
            this.sendReceiptEmail(tenantId, dto.customerId, Number(result.total_amount), result.serial_number);
            void this.crmCampaigns.attributeSale(tenantId, dto.customerId, Number(result.total_amount))
                .catch((err) => this.logger.warn(`CRM attribution failed for customer ${dto.customerId}: ${err}`));
        }

        return result;
    }

    /**
     * Everything a sale must validate and resolve *before* any row is written:
     * warehouse, product costs, warranty serials, totals, loyalty preview and
     * the customer's credit headroom. Shared by create() and finalizeDraft() so
     * a draft is held to exactly the same rules as a direct sale.
     */
    private async prepareSale(tx: any, tenantId: string, dto: CreateSaleDto) {
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

        const productById = new Map<string, { id: string; name: string; warranty_enabled: boolean }>(
            saleProducts.map((product: any) => [product.id, product]),
        );
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

        const balanceDue = creditDueAmount(computedTotal, dto.amountPaid);
        if (dto.amountPaid - computedTotal > 0.02) {
            throw new BadRequestException(
                `Payment amount exceeds sale total by ৳${(dto.amountPaid - computedTotal).toFixed(2)}.`,
            );
        }

        let creditCustomerDueBalance = 0;

        if (balanceDue > 0.005) {
            if (!dto.customerId) {
                throw new BadRequestException(
                    'Select a customer to keep due on this sale.',
                );
            }

            const creditCustomer = await tx.customer.findFirst({
                where: { id: dto.customerId, tenant_id: tenantId, deleted_at: null },
                select: { id: true, due_balance: true, credit_limit: true },
            });

            if (!creditCustomer) {
                throw new NotFoundException('Customer not found');
            }

            creditCustomerDueBalance = Number(creditCustomer.due_balance);
            assertCustomerCreditForSale(
                {
                    due_balance: creditCustomerDueBalance,
                    credit_limit: creditCustomer.credit_limit != null
                        ? Number(creditCustomer.credit_limit)
                        : null,
                },
                balanceDue,
            );
        }

        return {
            warehouseId,
            productById,
            costByProductId,
            preLoyaltyTotal,
            computedTotal,
            loyaltyPreview,
            balanceDue,
            creditCustomerDueBalance,
        };
    }

    /**
     * Everything that happens *after* the Sale row exists: sale lines, stock,
     * warranty serials, loyalty, the customer's due balance and the accounting
     * voucher. Shared by create() and finalizeDraft().
     */
    private async applySalePostings(
        tx: any,
        tenantId: string,
        userId: string,
        dto: CreateSaleDto,
        sale: any,
        prep: Awaited<ReturnType<SalesService['prepareSale']>>,
    ) {
        const {
            warehouseId,
            productById,
            costByProductId,
            preLoyaltyTotal,
            computedTotal,
            loyaltyPreview,
            balanceDue,
            creditCustomerDueBalance,
        } = prep;

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

        if (balanceDue > 0.005 && dto.customerId) {
            const balanceAfter = creditCustomerDueBalance + balanceDue;
            await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: dto.customerId,
                    type: 'CREDIT_SALE',
                    amount: balanceDue,
                    balance_after: balanceAfter,
                    reference_type: 'SALE',
                    reference_id: sale.id,
                    created_by: userId,
                },
            });
            await tx.customer.update({
                where: { id: dto.customerId },
                data: { due_balance: balanceAfter },
            });
        }

        let posting: AutoPostResult = { postingStatus: 'skipped' };

        if (balanceDue > 0.005) {
            posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'sale',
                conditionKey: 'payment_mode',
                conditionValue: 'credit',
                sourceModule: 'sales',
                sourceType: 'sale',
                sourceId: sale.id,
                amount: balanceDue,
                description: `Auto-posted credit portion — sale ${sale.serial_number}`,
                referenceNumber: sale.serial_number,
                storeId: dto.storeId,
                partyType: 'CUSTOMER',
                partyId: dto.customerId,
            });

            if (dto.amountPaid > 0.005) {
                const primaryPaymentMethod = dto.payments?.[0]?.paymentMethod ?? 'cash';
                // A partial down-payment on a credit sale: cash actually came in,
                // so it must post too. legKey 'paid' gives it a distinct
                // idempotency key from the credit (receivable) leg above, which
                // otherwise shares this Sale's key and silently swallowed it.
                // The mode account is the debit leg (Dr <mode> / Cr Revenue), so
                // a configured PaymentMethod account overrides that side.
                await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'sale',
                    conditionKey: 'payment_mode',
                    conditionValue: classifyPaymentMode(primaryPaymentMethod),
                    sourceModule: 'sales',
                    sourceType: 'sale',
                    sourceId: sale.id,
                    legKey: 'paid',
                    amount: dto.amountPaid,
                    description: `Auto-posted paid portion — sale ${sale.serial_number}`,
                    referenceNumber: sale.serial_number,
                    storeId: dto.storeId,
                    overrideDebitAccountId: await resolvePaymentMethodAccountId(tx, tenantId, primaryPaymentMethod),
                });
            }
        } else {
            const primaryPaymentMethod = dto.payments?.[0]?.paymentMethod ?? 'cash';
            const paymentMode = classifyPaymentMode(primaryPaymentMethod);

            posting = await autoPostFromRules({
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
                overrideDebitAccountId: await resolvePaymentMethodAccountId(tx, tenantId, primaryPaymentMethod),
            });
        }

        return {
            ...sale,
            posting_status: posting.postingStatus,
            voucher_id: posting.voucherId ?? null,
            voucher_number: posting.voucherNumber ?? null,
            voucher_type: posting.voucherType ?? null,
            loyalty: loyaltyResult,
        };
    }

    /**
     * A draft is parked, not posted. Only the sale, its lines and the intended
     * payments are stored — no inventory movement, credit/stock validation,
     * loyalty, customer balance change, accounting voucher, or receipt
     * notification. Sales reports all filter on COMPLETED, so drafts stay out
     * of revenue figures until the entry is finalised.
     */
    private async createDraft(tenantId: string, userId: string, dto: CreateSaleDto) {
        return this.db.$transaction(async (tx) => {
            const productIds = [...new Set(dto.items.map((item) => item.productId))];
            const foundProducts = await tx.product.count({
                where: { tenant_id: tenantId, id: { in: productIds }, deleted_at: null },
            });
            if (foundProducts !== productIds.length) {
                throw new BadRequestException('One or more products on this draft no longer exist.');
            }

            const referenceNumber = dto.referenceNumber
                ? await this.validateReferenceNumber(tenantId, dto.referenceNumber)
                : await this.generateReferenceNumber(tenantId, tx);

            const sale = await tx.sale.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    counter_id: dto.counterId ?? null,
                    customer_id: dto.customerId,
                    serial_number: `SL-${Date.now()}`,
                    reference_number: referenceNumber,
                    total_amount: dto.totalAmount,
                    amount_paid: dto.amountPaid,
                    sale_date: dto.saleDate ? new Date(dto.saleDate) : new Date(),
                    status: 'DRAFT',
                    note: dto.note,
                    created_by: userId,
                    payments: dto.payments ? {
                        create: dto.payments.map((p) => ({
                            payment_method: p.paymentMethod,
                            amount: p.amount,
                            account_id: p.accountId || null,
                        })),
                    } : undefined,
                },
            });

            for (const item of dto.items) {
                await tx.saleItem.create({
                    data: {
                        sale_id: sale.id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        price_at_sale: item.priceAtSale,
                    },
                });
            }

            return {
                ...sale,
                posting_status: 'skipped',
                voucher_id: null,
                voucher_number: null,
                voucher_type: null,
                loyalty: { loyaltyDiscount: 0, pointsRedeemed: 0, pointsEarned: 0 },
            };
        });
    }

    /**
     * Turn a parked DRAFT into a real sale: the same validation, stock movement,
     * loyalty, credit and accounting work a direct sale goes through, applied to
     * the existing Sale row so its serial and reference number survive. Optional
     * overrides let the user adjust lines/payments on the way out — warranty
     * serials can *only* arrive here, since a draft never captured them.
     */
    async finalizeDraft(tenantId: string, userId: string, id: string, dto: FinalizeSaleDto = {}) {
        const result = await this.db.$transaction(async (tx) => {
            const draft = await tx.sale.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true, payments: true },
            });

            if (!draft) {
                throw new NotFoundException('Sale not found');
            }
            if (draft.status !== 'DRAFT') {
                throw new BadRequestException('Only draft sales can be finalized.');
            }

            const items = dto.items ?? draft.items.map((item) => ({
                productId: item.product_id,
                quantity: item.quantity,
                priceAtSale: Number(item.price_at_sale),
            }));
            const payments = dto.payments ?? draft.payments.map((p) => ({
                paymentMethod: p.payment_method,
                amount: Number(p.amount),
                accountId: p.account_id ?? undefined,
            }));

            if (items.length === 0) {
                throw new BadRequestException('Add at least one item before finalizing this draft.');
            }

            const itemsSubtotal = items.reduce((sum, item) => sum + item.quantity * item.priceAtSale, 0);
            const totalAmount = dto.totalAmount ?? Number(draft.total_amount);
            const amountPaid = dto.amountPaid
                ?? (dto.payments
                    ? dto.payments.reduce((sum, p) => sum + p.amount, 0)
                    : Number(draft.amount_paid));
            // A draft stores whatever total the entry screen sent, with no
            // discount breakdown. Re-derive the discount from it so the shared
            // total check sees a consistent pair instead of rejecting the draft
            // the moment it is posted.
            const discountAmount = dto.discountAmount ?? Math.max(0, itemsSubtotal - totalAmount);

            const saleDto: CreateSaleDto = {
                storeId: draft.store_id,
                counterId: draft.counter_id ?? undefined,
                customerId: dto.customerId !== undefined
                    ? (dto.customerId ?? undefined)
                    : (draft.customer_id ?? undefined),
                items,
                payments,
                totalAmount,
                amountPaid,
                discountAmount,
                pointsToRedeem: dto.pointsToRedeem,
                note: dto.note ?? draft.note ?? undefined,
                saleDate: dto.saleDate,
            };

            // Validate everything before a single row changes.
            const prep = await this.prepareSale(tx, tenantId, saleDto);

            // Replace the parked lines and payments with what is being posted.
            // applySalePostings recreates the items (with unit cost attached).
            await tx.saleItem.deleteMany({ where: { sale_id: id } });
            await tx.paymentRecord.deleteMany({ where: { sale_id: id } });
            for (const p of payments) {
                await tx.paymentRecord.create({
                    data: {
                        sale_id: id,
                        payment_method: p.paymentMethod,
                        amount: p.amount,
                        account_id: p.accountId || null,
                    },
                });
            }

            const sale = await tx.sale.update({
                where: { id },
                data: {
                    customer_id: saleDto.customerId ?? null,
                    status: 'COMPLETED',
                    total_amount: prep.computedTotal,
                    amount_paid: amountPaid,
                    note: saleDto.note ?? null,
                    ...(dto.saleDate ? { sale_date: new Date(dto.saleDate) } : {}),
                },
            });

            return this.applySalePostings(tx, tenantId, userId, saleDto, sale, prep);
        });

        // Fire-and-forget receipt email (after transaction commits)
        if (result.customer_id) {
            this.sendReceiptEmail(tenantId, result.customer_id, Number(result.total_amount), result.serial_number);
            void this.crmCampaigns.attributeSale(tenantId, result.customer_id, Number(result.total_amount))
                .catch((err) => this.logger.warn(`CRM attribution failed for customer ${result.customer_id}: ${err}`));
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
        opts?: { cursor?: string; limit?: number; createdBy?: string },
    ): Promise<CursorPaginatedResult<any>> {
        const limit = Math.min(opts?.limit ?? 20, 100);

        const sales = await this.db.sale.findMany({
            where: {
                tenant_id: tenantId,
                ...(opts?.createdBy ? { created_by: opts.createdBy } : {}),
            },
            include: {
                items: { include: { product: true } },
                payments: true,
                customer: true,
            },
            orderBy: { created_at: 'desc' },
            take: limit + 1,
            ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
        });

        const summaries = await loadPostingSummaries(
            this.db,
            tenantId,
            'sales',
            'sale',
            sales.map((sale) => sale.id),
        );

        const enriched = sales.map((sale) => ({
            ...sale,
            ...(summaries.get(sale.id) ?? NO_POSTING_EVENT),
        }));

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

        return {
            ...sale,
            ...(await loadPostingSummary(this.db, tenantId, 'sales', 'sale', sale.id)),
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

            // A draft holds no stock and has posted nothing, so editing it must
            // not move inventory — and it can only become a real sale through
            // finalizeDraft(), which runs the full validation and posting path.
            const isDraft = sale.status === 'DRAFT';
            if (isDraft && dto.status && dto.status !== 'DRAFT') {
                throw new BadRequestException(
                    'Finalize this draft instead of changing its status directly.',
                );
            }

            // 1. If items are being replaced, reverse old stock and apply new
            if (dto.items) {
                const warehouseId = await resolveWarehouseId(tx, tenantId, sale.store_id, undefined, 'sale');
                // Reverse stock for old items (a draft never decremented any)
                for (const oldItem of isDraft ? [] : sale.items) {
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

                    if (!isDraft) {
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

            // 4. Handle customer total_spent adjustment (a draft never added to it)
            if (isDraft) {
                // nothing to reconcile — finalizeDraft() books the spend
            } else if (dto.customerId !== undefined && dto.customerId !== sale.customer_id) {
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
                    ...(dto.saleDate ? { sale_date: new Date(dto.saleDate) } : {}),
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
