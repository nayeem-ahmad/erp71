import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { CreateCustomerDto, UpdateCustomerDto, RecordCreditPaymentDto } from './customer.dto';
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
        params?: { page?: number; limit?: number },
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, due_balance: true, credit_limit: true, credit_enabled: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const [total, transactions] = await Promise.all([
            this.db.customerCreditTransaction.count({ where: { customer_id: id, tenant_id: tenantId } }),
            this.db.customerCreditTransaction.findMany({
                where: { customer_id: id, tenant_id: tenantId },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: { creator: { select: { id: true, name: true } } },
            }),
        ]);

        return {
            due_balance: Number(customer.due_balance),
            credit_limit: customer.credit_limit ? Number(customer.credit_limit) : null,
            credit_enabled: customer.credit_enabled,
            ...paginate(transactions, total, page, limit),
        };
    }

    async recordCreditPayment(tenantId: string, id: string, userId: string, dto: RecordCreditPaymentDto) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, due_balance: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const currentDue = Number(customer.due_balance);
        if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');
        if (dto.amount > currentDue) throw new BadRequestException('Payment exceeds due balance');

        const balanceAfter = currentDue - dto.amount;

        const [tx] = await this.db.$transaction([
            this.db.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: id,
                    type: 'PAYMENT',
                    amount: dto.amount,
                    balance_after: balanceAfter,
                    notes: dto.notes,
                    created_by: userId,
                },
            }),
            this.db.customer.update({
                where: { id },
                data: { due_balance: balanceAfter },
            }),
        ]);

        return tx;
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
