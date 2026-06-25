import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { paginate } from '../common/pagination.dto';
import { CreateSupplierDto, RecordSupplierCreditPaymentDto, UpdateSupplierDto } from './supplier.dto';

@Injectable()
export class SuppliersService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateSupplierDto) {
        const existing = await this.db.supplier.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
        });

        if (existing) {
            throw new BadRequestException('A supplier with this name already exists.');
        }

        return this.db.supplier.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
                address: dto.address,
            },
        });
    }

    async findAll(tenantId: string, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) => this.db.supplier.findMany(args as any),
            count: (args) => this.db.supplier.count(args as any),
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { name: 'asc' },
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        return supplier;
    }

    async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        if (dto.name && dto.name !== supplier.name) {
            const duplicate = await this.db.supplier.findUnique({
                where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
            });
            if (duplicate) {
                throw new BadRequestException('A supplier with this name already exists.');
            }
        }

        return this.db.supplier.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
                ...(dto.email !== undefined ? { email: dto.email } : {}),
                ...(dto.address !== undefined ? { address: dto.address } : {}),
            },
        });
    }

    async remove(tenantId: string, id: string) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        await this.db.supplier.update({
            where: { id },
            data: { deleted_at: new Date() },
        });

        return { success: true };
    }

    async getCreditLedger(
        tenantId: string,
        id: string,
        params?: { page?: number; limit?: number },
    ) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const [total, transactions] = await Promise.all([
            this.db.supplierCreditTransaction.count({ where: { supplier_id: id, tenant_id: tenantId } }),
            this.db.supplierCreditTransaction.findMany({
                where: { supplier_id: id, tenant_id: tenantId },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: { creator: { select: { id: true, name: true } } },
            }),
        ]);

        return {
            due_balance: Number(supplier.due_balance),
            ...paginate(transactions, total, page, limit),
        };
    }

    async recordCreditPayment(
        tenantId: string,
        id: string,
        userId: string,
        dto: RecordSupplierCreditPaymentDto,
    ) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const currentDue = Number(supplier.due_balance);
        if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');
        if (dto.amount > currentDue) throw new BadRequestException('Payment exceeds payable balance');

        const balanceAfter = currentDue - dto.amount;

        const [tx] = await this.db.$transaction([
            this.db.supplierCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    supplier_id: id,
                    type: 'PAYMENT',
                    amount: dto.amount,
                    balance_after: balanceAfter,
                    notes: dto.notes,
                    created_by: userId,
                },
            }),
            this.db.supplier.update({
                where: { id },
                data: { due_balance: balanceAfter },
            }),
        ]);

        return tx;
    }
}