import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto';
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
}
