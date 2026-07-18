import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { autoPostFromRules } from '../accounting/posting.utils';
import { buildPartyLedger } from '../accounting/party-ledger.util';
import { DatabaseService } from '../database/database.service';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { paginate } from '../common/pagination.dto';
import {
    AllocateSupplierPaymentDto,
    CreateSupplierDto,
    ListSupplierCreditPaymentsQueryDto,
    PaymentAllocationInputDto,
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

    private paymentStatusFor(paidAmount: number, totalAmount: number): string {
        if (paidAmount <= 0.005) return 'UNPAID';
        if (paidAmount >= totalAmount - 0.005) return 'PAID';
        return 'PARTIAL';
    }

    /** Validates and applies a set of allocations against open bills for one supplier, inside an existing transaction. */
    private async applyAllocations(
        tx: any,
        tenantId: string,
        supplierId: string,
        transactionId: string,
        allocations: PaymentAllocationInputDto[],
        remainingOnTransaction: number,
    ) {
        const requestedTotal = allocations.reduce((sum, a) => sum + a.amount, 0);
        if (requestedTotal - remainingOnTransaction > 0.005) {
            throw new BadRequestException(
                `Allocation total (${requestedTotal.toFixed(2)}) exceeds the unapplied amount on this payment (${remainingOnTransaction.toFixed(2)}).`,
            );
        }

        const purchaseIds = allocations.map((a) => a.purchaseId);
        const purchases = await tx.purchase.findMany({
            where: { id: { in: purchaseIds }, tenant_id: tenantId, supplier_id: supplierId },
            select: { id: true, total_amount: true, paid_amount: true, purchase_number: true },
        });
        const purchaseById = new Map<string, any>(purchases.map((p: any) => [p.id, p]));

        for (const allocation of allocations) {
            const purchase = purchaseById.get(allocation.purchaseId);
            if (!purchase) {
                throw new BadRequestException('One or more bills do not belong to this supplier.');
            }
            const balanceDue = Number(purchase.total_amount) - Number(purchase.paid_amount);
            if (allocation.amount - balanceDue > 0.005) {
                throw new BadRequestException(
                    `Allocation of ${allocation.amount.toFixed(2)} exceeds the balance due (${balanceDue.toFixed(2)}) on bill ${purchase.purchase_number}.`,
                );
            }
        }

        for (const allocation of allocations) {
            const purchase = purchaseById.get(allocation.purchaseId);
            const newPaidAmount = Number(purchase.paid_amount) + allocation.amount;

            await tx.supplierPaymentAllocation.create({
                data: {
                    tenant_id: tenantId,
                    transaction_id: transactionId,
                    purchase_id: allocation.purchaseId,
                    amount: allocation.amount,
                },
            });

            await tx.purchase.update({
                where: { id: allocation.purchaseId },
                data: {
                    paid_amount: newPaidAmount,
                    payment_status: this.paymentStatusFor(newPaidAmount, Number(purchase.total_amount)),
                },
            });
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

        const purchaseIds = transactions
            .filter((tx) => tx.type === 'CREDIT_PURCHASE' && tx.reference_type === 'PURCHASE' && tx.reference_id)
            .map((tx) => tx.reference_id as string);
        const paymentTransactionIds = transactions.filter((tx) => tx.type === 'PAYMENT').map((tx) => tx.id);

        const [bills, allocations] = await Promise.all([
            purchaseIds.length > 0
                ? this.db.purchase.findMany({
                      where: { id: { in: purchaseIds }, tenant_id: tenantId },
                      select: { id: true, payment_status: true, paid_amount: true, total_amount: true },
                  })
                : Promise.resolve([]),
            paymentTransactionIds.length > 0
                ? this.db.supplierPaymentAllocation.findMany({
                      where: { tenant_id: tenantId, transaction_id: { in: paymentTransactionIds } },
                      select: {
                          transaction_id: true,
                          amount: true,
                          purchase: { select: { id: true, purchase_number: true } },
                      },
                  })
                : Promise.resolve([]),
        ]);

        const billById = new Map(bills.map((b: any) => [b.id, b]));
        const allocationsByTransaction = new Map<string, any[]>();
        for (const allocation of allocations) {
            const list = allocationsByTransaction.get(allocation.transaction_id) ?? [];
            list.push({
                purchaseId: allocation.purchase.id,
                purchaseNumber: allocation.purchase.purchase_number,
                amount: Number(allocation.amount),
            });
            allocationsByTransaction.set(allocation.transaction_id, list);
        }

        const items = transactions.map((tx) => {
            const amount = Number(tx.amount);
            const balanceAfter = Number(tx.balance_after);
            const base = {
                ...tx,
                amount,
                balance_after: balanceAfter,
                balance_before: balanceAfter - this.ledgerDueDelta(tx.type, amount),
            };

            if (tx.type === 'CREDIT_PURCHASE' && tx.reference_type === 'PURCHASE' && tx.reference_id) {
                const bill = billById.get(tx.reference_id);
                if (bill) {
                    return {
                        ...base,
                        bill: {
                            payment_status: bill.payment_status,
                            paid_amount: Number(bill.paid_amount),
                            total_amount: Number(bill.total_amount),
                            balance_due: Number(bill.total_amount) - Number(bill.paid_amount),
                        },
                    };
                }
            }

            if (tx.type === 'PAYMENT') {
                const txAllocations = allocationsByTransaction.get(tx.id) ?? [];
                const allocatedTotal = txAllocations.reduce((sum, a) => sum + a.amount, 0);
                return {
                    ...base,
                    allocations: txAllocations,
                    unapplied_amount: amount - allocatedTotal,
                };
            }

            return base;
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

    /**
     * The supplier ledger derived from the GENERAL LEDGER — the Purchase Payable
     * voucher lines tagged to this supplier — rather than from
     * SupplierCreditTransaction. Same shape as getCreditLedger so the UI can swap
     * to it; kept alongside so the two can be diffed before the parallel table is
     * retired.
     */
    async getGlLedger(tenantId: string, id: string, params?: { from?: string; to?: string }) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, phone: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const ledger = await buildPartyLedger(this.db, tenantId, 'SUPPLIER', id, {
            from: params?.from,
            to: params?.to,
            increaseLabel: 'CREDIT_PURCHASE',
            decreaseLabel: 'PAYMENT',
        });

        return {
            supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
            due_balance: Number(supplier.due_balance),
            opening_balance: ledger.opening_balance,
            closing_balance: ledger.closing_balance,
            transactions: ledger.transactions,
            total: ledger.total,
            source: 'general_ledger' as const,
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

        const paymentIds = items.filter((i) => i.type === 'PAYMENT').map((i) => i.id);
        const allocatedByTransaction = new Map<string, number>();
        if (paymentIds.length > 0) {
            const grouped = await this.db.supplierPaymentAllocation.groupBy({
                by: ['transaction_id'],
                where: { tenant_id: tenantId, transaction_id: { in: paymentIds } },
                _sum: { amount: true },
            });
            for (const g of grouped) {
                allocatedByTransaction.set(g.transaction_id, Number(g._sum.amount ?? 0));
            }
        }

        const itemsWithAllocation = items.map((item) => {
            if (item.type !== 'PAYMENT') return item;
            const allocated = allocatedByTransaction.get(item.id) ?? 0;
            return {
                ...item,
                allocated_amount: allocated,
                unapplied_amount: Number(item.amount) - allocated,
            };
        });

        return paginate(itemsWithAllocation, total, page, limit);
    }

    async getCreditPayment(tenantId: string, paymentId: string) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        if (payment.type !== 'PAYMENT') return payment;

        const allocatedSum = await this.db.supplierPaymentAllocation.aggregate({
            where: { tenant_id: tenantId, transaction_id: paymentId },
            _sum: { amount: true },
        });
        const allocated = Number(allocatedSum._sum.amount ?? 0);
        return { ...payment, allocated_amount: allocated, unapplied_amount: Number(payment.amount) - allocated };
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

        const allocatedSum = await this.db.supplierPaymentAllocation.aggregate({
            where: { tenant_id: tenantId, transaction_id: paymentId },
            _sum: { amount: true },
        });
        const allocatedTotal = Number(allocatedSum._sum.amount ?? 0);
        if (allocatedTotal > 0.005) {
            if (newType !== 'PAYMENT') {
                throw new BadRequestException('Remove this payment\'s bill allocations before changing its direction.');
            }
            if (newAmount - allocatedTotal < -0.005) {
                throw new BadRequestException(
                    `Cannot reduce this payment below its already-allocated amount (${allocatedTotal.toFixed(2)}). Remove allocations first.`,
                );
            }
        }

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

        const allocationCount = await this.db.supplierPaymentAllocation.count({
            where: { tenant_id: tenantId, transaction_id: paymentId },
        });
        if (allocationCount > 0) {
            throw new BadRequestException('Remove this payment\'s bill allocations before deleting it.');
        }

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

        if (dto.allocations?.length && txType !== 'PAYMENT') {
            throw new BadRequestException('Only payments made to the supplier (not receipts) can be allocated to bills.');
        }

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

            if (dto.allocations?.length) {
                await this.applyAllocations(tx, tenantId, id, payment.id, dto.allocations, dto.amount);
            }

            // Purchases credit Purchase Payable; without this nothing ever debits
            // it, so the payable grows forever and the balance sheet overstates
            // liabilities. PAYMENT (we pay the supplier) reduces the payable;
            // PAYOUT (we receive from the supplier) increases it — mirroring
            // dueDelta above, so the voucher and due_balance cannot disagree.
            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'supplier_payment',
                conditionKey: 'payment_direction',
                conditionValue: txType === 'PAYMENT' ? 'pay' : 'receive',
                sourceModule: 'suppliers',
                sourceType: 'supplier_payment',
                sourceId: payment.id,
                amount: dto.amount,
                description: `Auto-posted supplier ${txType === 'PAYMENT' ? 'payment' : 'receipt'} — ${supplier.name}`,
                referenceNumber: payment_number,
                date: payment.created_at,
                partyType: 'SUPPLIER',
                partyId: id,
            });

            return {
                ...payment,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    /** Matches part or all of an existing (previously unapplied) supplier payment to specific bill(s). */
    async allocatePayment(tenantId: string, transactionId: string, dto: AllocateSupplierPaymentDto) {
        const transaction = await this.db.supplierCreditTransaction.findFirst({
            where: { id: transactionId, tenant_id: tenantId, type: 'PAYMENT' },
        });
        if (!transaction) throw new NotFoundException('Supplier payment not found');

        const alreadyAllocated = await this.db.supplierPaymentAllocation.aggregate({
            where: { tenant_id: tenantId, transaction_id: transactionId },
            _sum: { amount: true },
        });
        const remaining = Number(transaction.amount) - Number(alreadyAllocated._sum.amount ?? 0);

        return this.db.$transaction(async (tx) => {
            await this.applyAllocations(tx, tenantId, transaction.supplier_id, transactionId, dto.allocations, remaining);
            return this.getCreditPayment(tenantId, transactionId);
        });
    }

    /** Reverses a single bill allocation, freeing that amount back up as an unapplied advance. */
    async removeAllocation(tenantId: string, allocationId: string) {
        const allocation = await this.db.supplierPaymentAllocation.findFirst({
            where: { id: allocationId, tenant_id: tenantId },
            include: { purchase: { select: { id: true, total_amount: true, paid_amount: true } } },
        });
        if (!allocation) throw new NotFoundException('Allocation not found');

        return this.db.$transaction(async (tx) => {
            await tx.supplierPaymentAllocation.delete({ where: { id: allocationId } });

            const newPaidAmount = Number(allocation.purchase.paid_amount) - Number(allocation.amount);
            await tx.purchase.update({
                where: { id: allocation.purchase.id },
                data: {
                    paid_amount: newPaidAmount,
                    payment_status: this.paymentStatusFor(newPaidAmount, Number(allocation.purchase.total_amount)),
                },
            });

            return { removed: true, id: allocationId };
        });
    }

    /** Open bills and unapplied advance total for a supplier - the working view for matching payments to bills. */
    async getBillingSummary(tenantId: string, supplierId: string) {
        const supplier = await this.db.supplier.findFirst({
            where: { id: supplierId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const openBills = await this.db.purchase.findMany({
            where: { tenant_id: tenantId, supplier_id: supplierId, payment_status: { not: 'PAID' } },
            select: {
                id: true,
                purchase_number: true,
                total_amount: true,
                paid_amount: true,
                payment_status: true,
                created_at: true,
            },
            orderBy: { created_at: 'asc' },
        });

        const paymentTransactions = await this.db.supplierCreditTransaction.findMany({
            where: { tenant_id: tenantId, supplier_id: supplierId, type: 'PAYMENT' },
            include: { allocations: { select: { amount: true } } },
        });

        const unallocatedAdvance = paymentTransactions.reduce((sum, txn) => {
            const allocated = txn.allocations.reduce((s, a) => s + Number(a.amount), 0);
            const remaining = Number(txn.amount) - allocated;
            return sum + Math.max(0, remaining);
        }, 0);

        return {
            supplier: { id: supplier.id, name: supplier.name },
            due_balance: Number(supplier.due_balance),
            unallocated_advance: unallocatedAdvance,
            open_bills: openBills.map((bill: any) => ({
                ...bill,
                total_amount: Number(bill.total_amount),
                paid_amount: Number(bill.paid_amount),
                balance_due: Number(bill.total_amount) - Number(bill.paid_amount),
            })),
        };
    }
}