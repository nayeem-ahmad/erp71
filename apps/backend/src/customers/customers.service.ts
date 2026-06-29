import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ensureCustomerPaymentPostingSetup } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import {
    CreateCustomerDto,
    UpdateCustomerDto,
    RecordCreditPaymentDto,
    UpdateCreditPaymentDto,
    ListCustomerCreditPaymentsQueryDto,
    CustomerPaymentDirectionDto,
} from './customer.dto';
import { paginate, PaginatedResult } from '../common/pagination.dto';

@Injectable()
export class CustomersService {
    constructor(
        private db: DatabaseService,
        private encryption: EncryptionService,
    ) {}

    private encryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.encrypt(value);
    }

    private decryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.decrypt(value);
    }

    private decryptCustomer<T extends { nid?: string | null }>(customer: T): T {
        return { ...customer, nid: this.decryptNid(customer.nid) };
    }

    private async generateCustomerCode(tenantId: string): Promise<string> {
        const last = await this.db.customer.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { customer_code: 'desc' },
            select: { customer_code: true },
        });

        if (!last) return 'CUST-00001';

        const match = last.customer_code.match(/CUST-(\d+)/);
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
        return `CUST-${String(nextNum).padStart(5, '0')}`;
    }

    private dueDelta(type: 'PAYMENT' | 'PAYOUT', amount: number): number {
        return type === 'PAYOUT' ? amount : -amount;
    }

    private ledgerDueDelta(type: string, amount: number): number {
        switch (type) {
            case 'CREDIT_SALE':
            case 'PAYOUT':
                return amount;
            case 'PAYMENT':
                return -amount;
            case 'ADJUSTMENT':
                return amount;
            default:
                return 0;
        }
    }

    private directionFromType(type: string): CustomerPaymentDirectionDto {
        return type === 'PAYOUT' ? CustomerPaymentDirectionDto.PAY : CustomerPaymentDirectionDto.RECEIVE;
    }

    private typeFromDirection(direction: CustomerPaymentDirectionDto): 'PAYMENT' | 'PAYOUT' {
        return direction === CustomerPaymentDirectionDto.PAY ? 'PAYOUT' : 'PAYMENT';
    }

    private async enrichPaymentsWithVouchers(tenantId: string, items: any[]) {
        if (items.length === 0) return items;

        const events = await this.db.postingEvent.findMany({
            where: {
                tenant_id: tenantId,
                source_module: 'customers',
                source_id: { in: items.map((item) => item.id) },
                event_type: 'customer_payment',
            },
            include: { voucher: { select: { id: true, voucher_number: true } } },
        });

        const voucherByPaymentId = new Map(
            events.map((event) => [event.source_id, event.voucher]),
        );

        return items.map((item) => {
            const voucher = voucherByPaymentId.get(item.id);
            return {
                ...item,
                voucher_id: voucher?.id ?? null,
                accounting_voucher_number: voucher?.voucher_number ?? null,
            };
        });
    }

    private async findCreditPaymentOrThrow(tenantId: string, paymentId: string) {
        const payment = await this.db.customerCreditTransaction.findFirst({
            where: {
                id: paymentId,
                tenant_id: tenantId,
                type: { in: ['PAYMENT', 'PAYOUT'] },
            },
            include: {
                customer: { select: { id: true, name: true, phone: true, customer_code: true, due_balance: true } },
                creator: { select: { id: true, name: true } },
            },
        });
        if (!payment) throw new NotFoundException('Customer payment not found');
        return payment;
    }

    private async generatePaymentNumber(
        tenantId: string,
        tx: any,
        txType: 'PAYMENT' | 'PAYOUT',
    ): Promise<string> {
        const prefix = txType === 'PAYOUT' ? 'CPO-' : 'CPY-';
        const last = await tx.customerCreditTransaction.findFirst({
            where: {
                tenant_id: tenantId,
                type: txType,
                payment_number: { startsWith: prefix },
            },
            orderBy: { payment_number: 'desc' },
            select: { payment_number: true },
        });

        if (!last?.payment_number) return `${prefix}00001`;

        const match = last.payment_number.match(new RegExp(`${prefix.replace('-', '\\-')}(\\d+)`));
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
        return `${prefix}${String(nextNum).padStart(5, '0')}`;
    }

    async create(tenantId: string, dto: CreateCustomerDto) {
        const existing = await this.db.customer.findUnique({
            where: {
                tenant_id_phone: {
                    tenant_id: tenantId,
                    phone: dto.phone,
                }
            }
        });

        if (existing) {
            throw new BadRequestException('A customer with this phone number already exists.');
        }

        const customer_code = await this.generateCustomerCode(tenantId);

        const { nid, ...rest } = dto;
        const record = await this.db.customer.create({
            data: {
                tenant_id: tenantId,
                customer_code,
                ...rest,
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
            },
            include: {
                customerGroup: true,
                territory: true,
            }
        });
        return this.decryptCustomer(record);
    }

    async findAll(tenantId: string, opts?: { page?: number; limit?: number; search?: string }): Promise<PaginatedResult<any>> {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (opts?.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search } },
                { customer_code: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.customer.findMany({
                where,
                include: { customerGroup: true, territory: true },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.customer.count({ where }),
        ]);

        return paginate(items.map(c => this.decryptCustomer(c)), total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: {
                customerGroup: true,
                territory: true,
                sales: {
                    include: { items: { include: { product: true } } },
                    orderBy: { created_at: 'desc' }
                }
            }
        });

        if (!customer) throw new NotFoundException('Customer not found');
        return this.decryptCustomer(customer);
    }

    async getPurchaseHistory(
        tenantId: string,
        id: string,
        params?: { page?: number; limit?: number; from?: string; to?: string },
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { customer_id: id };
        if (params?.from || params?.to) {
            where.created_at = {};
            if (params?.from) where.created_at.gte = new Date(params.from);
            if (params?.to) where.created_at.lte = new Date(params.to);
        }

        const [total, sales] = await Promise.all([
            this.db.sale.count({ where }),
            this.db.sale.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: {
                    items: {
                        include: { product: { select: { id: true, name: true } } },
                    },
                    payments: { select: { payment_method: true, amount: true } },
                },
            }),
        ]);

        return {
            data: sales,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async getSegmentStats(tenantId: string) {
        const customers = await this.db.customer.findMany({
            where: { tenant_id: tenantId },
            select: { segment_category: true },
        });

        const counts: Record<string, number> = {};
        for (const c of customers) {
            const seg = c.segment_category || 'Regular';
            counts[seg] = (counts[seg] || 0) + 1;
        }

        const total = customers.length;
        return {
            total,
            breakdown: Object.entries(counts).map(([segment, count]) => ({
                segment,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0,
            })),
        };
    }

    async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId },
        });

        if (!customer) throw new NotFoundException('Customer not found');

        if (dto.phone && dto.phone !== customer.phone) {
            const duplicate = await this.db.customer.findUnique({
                where: {
                    tenant_id_phone: {
                        tenant_id: tenantId,
                        phone: dto.phone,
                    }
                }
            });
            if (duplicate) {
                throw new BadRequestException('A customer with this phone number already exists.');
            }
        }

        const { nid, ...rest } = dto;
        const record = await this.db.customer.update({
            where: { id },
            data: {
                ...rest,
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
            },
            include: {
                customerGroup: true,
                territory: true,
            }
        });
        return this.decryptCustomer(record);
    }

    async getAnalytics(tenantId: string, id: string) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: {
                id: true, name: true, total_spent: true, created_at: true,
                segment_category: true, loyalty_points: true, due_balance: true,
            },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const [salesCount, lastSale] = await Promise.all([
            this.db.sale.count({ where: { customer_id: id } }),
            this.db.sale.findFirst({
                where: { customer_id: id },
                orderBy: { created_at: 'desc' },
                select: { created_at: true, total_amount: true },
            }),
        ]);

        const totalSpent = Number(customer.total_spent);
        const avgOrderValue = salesCount > 0 ? totalSpent / salesCount : 0;
        const daysSinceLastPurchase = lastSale
            ? Math.floor((Date.now() - lastSale.created_at.getTime()) / 86_400_000)
            : null;

        return {
            customer_id: id,
            total_spent: totalSpent,
            order_count: salesCount,
            avg_order_value: avgOrderValue,
            last_purchase_date: lastSale?.created_at ?? null,
            days_since_last_purchase: daysSinceLastPurchase,
            loyalty_points: customer.loyalty_points,
            due_balance: Number(customer.due_balance),
            segment: customer.segment_category,
        };
    }

    async getCreditLedger(
        tenantId: string,
        id: string,
        params?: { page?: number; limit?: number; from?: string; to?: string },
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, phone: true, due_balance: true, credit_limit: true, credit_enabled: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 100, 500);
        const skip = (page - 1) * limit;

        const where: any = { customer_id: id, tenant_id: tenantId };
        let periodStart: Date | null = null;

        if (params?.from || params?.to) {
            where.created_at = {};
            if (params.from) {
                periodStart = new Date(params.from);
                periodStart.setUTCHours(0, 0, 0, 0);
                where.created_at.gte = periodStart;
            }
            if (params.to) {
                const to = new Date(params.to);
                to.setUTCHours(23, 59, 59, 999);
                where.created_at.lte = to;
            }
        }

        let opening_balance = 0;
        if (periodStart) {
            const priorTx = await this.db.customerCreditTransaction.findFirst({
                where: {
                    customer_id: id,
                    tenant_id: tenantId,
                    created_at: { lt: periodStart },
                },
                orderBy: { created_at: 'desc' },
                select: { balance_after: true },
            });
            opening_balance = priorTx ? Number(priorTx.balance_after) : 0;
        }

        const [total, transactions] = await Promise.all([
            this.db.customerCreditTransaction.count({ where }),
            this.db.customerCreditTransaction.findMany({
                where,
                orderBy: { created_at: 'asc' },
                skip,
                take: limit,
                include: { creator: { select: { id: true, name: true } } },
            }),
        ]);

        const items = transactions.map((tx) => {
            const amount = Number(tx.amount);
            const balanceAfter = Number(tx.balance_after);
            return {
                ...tx,
                amount,
                balance_after: balanceAfter,
                balance_before: balanceAfter - this.ledgerDueDelta(tx.type, amount),
            };
        });

        const closing_balance = items.length > 0
            ? Number(items[items.length - 1].balance_after)
            : opening_balance;

        const pages = Math.ceil(total / limit);
        return {
            customer: { id: customer.id, name: customer.name, phone: customer.phone },
            due_balance: Number(customer.due_balance),
            opening_balance,
            closing_balance,
            credit_limit: customer.credit_limit ? Number(customer.credit_limit) : null,
            credit_enabled: customer.credit_enabled,
            transactions: items,
            total,
            page,
            limit,
            pages,
        };
    }

    async listCreditPayments(
        tenantId: string,
        query: ListCustomerCreditPaymentsQueryDto,
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = {
            tenant_id: tenantId,
            type: { in: ['PAYMENT', 'PAYOUT'] },
        };

        if (query.customerId) {
            where.customer_id = query.customerId;
        }

        if (query.from || query.to) {
            where.created_at = {};
            if (query.from) {
                const from = new Date(query.from);
                from.setUTCHours(0, 0, 0, 0);
                where.created_at.gte = from;
            }
            if (query.to) {
                const to = new Date(query.to);
                to.setUTCHours(23, 59, 59, 999);
                where.created_at.lte = to;
            }
        }

        if (query.search) {
            where.OR = [
                { payment_number: { contains: query.search, mode: 'insensitive' } },
                { notes: { contains: query.search, mode: 'insensitive' } },
                { customer: { name: { contains: query.search, mode: 'insensitive' } } },
                { customer: { phone: { contains: query.search } } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.customerCreditTransaction.findMany({
                where,
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.customerCreditTransaction.count({ where }),
        ]);

        const enriched = await this.enrichPaymentsWithVouchers(tenantId, items);
        return paginate(enriched, total, page, limit);
    }

    async getCreditPayment(tenantId: string, paymentId: string) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const [enriched] = await this.enrichPaymentsWithVouchers(tenantId, [payment]);
        return enriched;
    }

    async updateCreditPayment(tenantId: string, paymentId: string, dto: UpdateCreditPaymentDto) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);
        const customerId = payment.customer_id;

        const newDirection = dto.direction ?? this.directionFromType(oldType);
        const newType = this.typeFromDirection(newDirection);
        const newAmount = dto.amount ?? oldAmount;
        const newNotes = dto.notes !== undefined ? dto.notes : payment.notes;

        if (newAmount <= 0) throw new BadRequestException('Amount must be positive');

        return this.db.$transaction(async (tx) => {
            const customer = await tx.customer.findFirst({
                where: { id: customerId, tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, due_balance: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');

            const reverseDelta = -this.dueDelta(oldType, oldAmount);
            let currentDue = Number(customer.due_balance) + reverseDelta;

            await voidAutoPostedVoucher(tx, tenantId, 'customer_payment', paymentId);

            const balanceAfter = currentDue + this.dueDelta(newType, newAmount);
            const isPayout = newType === 'PAYOUT';

            const updated = await tx.customerCreditTransaction.update({
                where: { id: paymentId },
                data: {
                    type: newType,
                    amount: newAmount,
                    balance_after: balanceAfter,
                    notes: newNotes,
                },
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.customer.update({
                where: { id: customerId },
                data: { due_balance: balanceAfter },
            });

            await ensureCustomerPaymentPostingSetup(tx, tenantId);

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'customer_payment',
                conditionKey: 'payment_direction',
                conditionValue: newDirection,
                sourceModule: 'customers',
                sourceType: isPayout ? 'customer_payout' : 'customer_payment',
                sourceId: paymentId,
                amount: newAmount,
                description: isPayout
                    ? `Customer payout — ${customer.name}`
                    : `Customer payment — ${customer.name}`,
                referenceNumber: payment.payment_number ?? paymentId,
            });

            return {
                ...updated,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                accounting_voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    async deleteCreditPayment(tenantId: string, paymentId: string) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);

        return this.db.$transaction(async (tx) => {
            const customer = await tx.customer.findFirst({
                where: { id: payment.customer_id, tenant_id: tenantId },
                select: { id: true, due_balance: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');

            const reverseDelta = -this.dueDelta(oldType, oldAmount);
            const newDue = Number(customer.due_balance) + reverseDelta;

            await voidAutoPostedVoucher(tx, tenantId, 'customer_payment', paymentId);

            await tx.customerCreditTransaction.delete({ where: { id: paymentId } });

            await tx.customer.update({
                where: { id: payment.customer_id },
                data: { due_balance: newDue },
            });

            return { deleted: true, id: paymentId };
        });
    }

    async recordCreditPayment(tenantId: string, id: string, userId: string, dto: RecordCreditPaymentDto) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, due_balance: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const direction = dto.direction ?? CustomerPaymentDirectionDto.RECEIVE;
        const isPayout = direction === CustomerPaymentDirectionDto.PAY;
        const txType = isPayout ? 'PAYOUT' : 'PAYMENT';

        if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');

        const currentDue = Number(customer.due_balance);
        const balanceAfter = isPayout ? currentDue + dto.amount : currentDue - dto.amount;

        return this.db.$transaction(async (tx) => {
            await ensureCustomerPaymentPostingSetup(tx, tenantId);

            const payment_number = await this.generatePaymentNumber(tenantId, tx, txType);

            const payment = await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: id,
                    type: txType,
                    amount: dto.amount,
                    balance_after: balanceAfter,
                    payment_number,
                    notes: dto.notes,
                    created_by: userId,
                },
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.customer.update({
                where: { id },
                data: { due_balance: balanceAfter },
            });

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'customer_payment',
                conditionKey: 'payment_direction',
                conditionValue: direction,
                sourceModule: 'customers',
                sourceType: txType === 'PAYOUT' ? 'customer_payout' : 'customer_payment',
                sourceId: payment.id,
                amount: dto.amount,
                description: isPayout
                    ? `Customer payout — ${customer.name}`
                    : `Customer payment — ${customer.name}`,
                referenceNumber: payment_number,
            });

            return {
                ...payment,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    async getDueAgingReport(tenantId: string) {
        const now = new Date();

        const transactions = await this.db.customerCreditTransaction.findMany({
            where: { tenant_id: tenantId, type: 'CREDIT_SALE' },
            include: { customer: { select: { id: true, name: true, phone: true } } },
            orderBy: { created_at: 'asc' },
        });

        const customerDues: Record<string, {
            customer: { id: string; name: string; phone: string };
            bucket_0_30: number;
            bucket_31_60: number;
            bucket_61_90: number;
            bucket_90_plus: number;
            total: number;
        }> = {};

        for (const tx of transactions) {
            const cid = tx.customer_id;
            if (!customerDues[cid]) {
                customerDues[cid] = {
                    customer: tx.customer as any,
                    bucket_0_30: 0,
                    bucket_31_60: 0,
                    bucket_61_90: 0,
                    bucket_90_plus: 0,
                    total: 0,
                };
            }

            const days = Math.floor((now.getTime() - tx.created_at.getTime()) / 86_400_000);
            const amount = Number(tx.amount);

            if (days <= 30) customerDues[cid].bucket_0_30 += amount;
            else if (days <= 60) customerDues[cid].bucket_31_60 += amount;
            else if (days <= 90) customerDues[cid].bucket_61_90 += amount;
            else customerDues[cid].bucket_90_plus += amount;

            customerDues[cid].total += amount;
        }

        return Object.values(customerDues).filter(d => d.total > 0);
    }
}
