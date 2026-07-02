import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { paginate } from '../common/pagination.dto';
import {
    CreateSupplierDto,
    ListSupplierCreditPaymentsQueryDto,
    RecordSupplierCreditPaymentDto,
    SupplierPaymentDirectionDto,
    UpdateSupplierCreditPaymentDto,
    UpdateSupplierDto,
} from './supplier.dto';
import { runImport, ImportResult } from '../common/import.util';

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

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name'],
            castRow: (raw) => ({
                name: String(raw.name ?? '').trim(),
                phone: raw.phone ? String(raw.phone).trim() || null : null,
                email: raw.email ? String(raw.email).trim() || null : null,
                address: raw.address ? String(raw.address).trim() || null : null,
                contact_person: raw.contact_person ? String(raw.contact_person).trim() || null : null,
            }),
            findDuplicate: async (row) => {
                const existing = await this.db.supplier.findUnique({
                    where: { tenant_id_name: { tenant_id: tenantId, name: row.name } },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                await this.db.supplier.create({
                    data: { tenant_id: tenantId, name: row.name, phone: row.phone, email: row.email, address: row.address },
                });
            },
            update: async (id, row) => {
                await this.db.supplier.update({
                    where: { id },
                    data: { name: row.name, phone: row.phone, email: row.email, address: row.address },
                });
            },
        });
    }

    private dueDelta(type: 'PAYMENT' | 'PAYOUT', amount: number): number {
        return type === 'PAYMENT' ? -amount : amount;
    }

    private ledgerDueDelta(type: string, amount: number): number {
        switch (type) {
            case 'CREDIT_PURCHASE':
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

    private directionFromType(type: string): SupplierPaymentDirectionDto {
        return type === 'PAYOUT' ? SupplierPaymentDirectionDto.RECEIVE : SupplierPaymentDirectionDto.PAY;
    }

    private typeFromDirection(direction: SupplierPaymentDirectionDto): 'PAYMENT' | 'PAYOUT' {
        return direction === SupplierPaymentDirectionDto.PAY ? 'PAYMENT' : 'PAYOUT';
    }

    private async generatePaymentNumber(
        tenantId: string,
        tx: any,
        txType: 'PAYMENT' | 'PAYOUT',
    ): Promise<string> {
        const prefix = txType === 'PAYOUT' ? 'SPO-' : 'SPY-';
        const last = await tx.supplierCreditTransaction.findFirst({
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

    private async findCreditPaymentOrThrow(tenantId: string, paymentId: string) {
        const payment = await this.db.supplierCreditTransaction.findFirst({
            where: {
                id: paymentId,
                tenant_id: tenantId,
                type: { in: ['PAYMENT', 'PAYOUT'] },
            },
            include: {
                supplier: { select: { id: true, name: true, phone: true, due_balance: true } },
                creator: { select: { id: true, name: true } },
            },
        });
        if (!payment) throw new NotFoundException('Supplier payment not found');
        return payment;
    }

    async getCreditLedger(
        tenantId: string,
        id: string,
        params?: { page?: number; limit?: number; from?: string; to?: string },
    ) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, phone: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 100, 500);
        const skip = (page - 1) * limit;

        const where: any = { supplier_id: id, tenant_id: tenantId };
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
            const priorTx = await this.db.supplierCreditTransaction.findFirst({
                where: {
                    supplier_id: id,
                    tenant_id: tenantId,
                    created_at: { lt: periodStart },
                },
                orderBy: { created_at: 'desc' },
                select: { balance_after: true },
            });
            opening_balance = priorTx ? Number(priorTx.balance_after) : 0;
        }

        const [total, transactions] = await Promise.all([
            this.db.supplierCreditTransaction.count({ where }),
            this.db.supplierCreditTransaction.findMany({
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
            supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
            due_balance: Number(supplier.due_balance),
            opening_balance,
            closing_balance,
            transactions: items,
            total,
            page,
            limit,
            pages,
        };
    }

    async listCreditPayments(
        tenantId: string,
        query: ListSupplierCreditPaymentsQueryDto,
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = {
            tenant_id: tenantId,
            type: { in: ['PAYMENT', 'PAYOUT'] },
        };

        if (query.supplierId) {
            where.supplier_id = query.supplierId;
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
                { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
                { supplier: { phone: { contains: query.search } } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.supplierCreditTransaction.findMany({
                where,
                include: {
                    supplier: { select: { id: true, name: true, phone: true } },
                    creator: { select: { id: true, name: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.supplierCreditTransaction.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async getCreditPayment(tenantId: string, paymentId: string) {
        return this.findCreditPaymentOrThrow(tenantId, paymentId);
    }

    async updateCreditPayment(tenantId: string, paymentId: string, dto: UpdateSupplierCreditPaymentDto) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);
        const supplierId = payment.supplier_id;

        const newDirection = dto.direction ?? this.directionFromType(oldType);
        const newType = this.typeFromDirection(newDirection);
        const newAmount = dto.amount ?? oldAmount;
        const newNotes = dto.notes !== undefined ? dto.notes : payment.notes;

        if (newAmount <= 0) throw new BadRequestException('Amount must be positive');

        return this.db.$transaction(async (tx) => {
            const supplier = await tx.supplier.findFirst({
                where: { id: supplierId, tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, due_balance: true },
            });
            if (!supplier) throw new NotFoundException('Supplier not found');

            const reverseDelta = -this.dueDelta(oldType, oldAmount);
            let currentDue = Number(supplier.due_balance) + reverseDelta;
            const balanceAfter = currentDue + this.dueDelta(newType, newAmount);

            const updated = await tx.supplierCreditTransaction.update({
                where: { id: paymentId },
                data: {
                    type: newType,
                    amount: newAmount,
                    balance_after: balanceAfter,
                    notes: newNotes,
                },
                include: {
                    supplier: { select: { id: true, name: true, phone: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.supplier.update({
                where: { id: supplierId },
                data: { due_balance: balanceAfter },
            });

            return updated;
        });
    }

    async deleteCreditPayment(tenantId: string, paymentId: string) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);

        return this.db.$transaction(async (tx) => {
            const supplier = await tx.supplier.findFirst({
                where: { id: payment.supplier_id, tenant_id: tenantId },
                select: { id: true, due_balance: true },
            });
            if (!supplier) throw new NotFoundException('Supplier not found');

            const reverseDelta = -this.dueDelta(oldType, oldAmount);
            const newDue = Number(supplier.due_balance) + reverseDelta;

            await tx.supplierCreditTransaction.delete({ where: { id: paymentId } });

            await tx.supplier.update({
                where: { id: payment.supplier_id },
                data: { due_balance: newDue },
            });

            return { deleted: true, id: paymentId };
        });
    }

    async recordCreditPayment(
        tenantId: string,
        id: string,
        userId: string,
        dto: RecordSupplierCreditPaymentDto,
    ) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const direction = dto.direction ?? SupplierPaymentDirectionDto.PAY;
        const txType = this.typeFromDirection(direction);

        if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');

        const currentDue = Number(supplier.due_balance);
        const balanceAfter = currentDue + this.dueDelta(txType, dto.amount);

        return this.db.$transaction(async (tx) => {
            const payment_number = await this.generatePaymentNumber(tenantId, tx, txType);

            const payment = await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    supplier_id: id,
                    type: txType,
                    amount: dto.amount,
                    balance_after: balanceAfter,
                    payment_number,
                    notes: dto.notes,
                    created_by: userId,
                },
                include: {
                    supplier: { select: { id: true, name: true, phone: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.supplier.update({
                where: { id },
                data: { due_balance: balanceAfter },
            });

            return payment;
        });
    }
}