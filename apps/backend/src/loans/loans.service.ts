import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ensureLoanPostingSetup } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { autoPostFromRules } from '../accounting/posting.utils';
import {
    CreateLoanDto,
    CreateLoanPaymentDto,
    ListLoansQueryDto,
    UpdateLoanDto,
} from './loans.dto';

@Injectable()
export class LoansService {
    constructor(private db: DatabaseService) {}

    async listLoans(tenantId: string, query: ListLoansQueryDto): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;
        const where = this.buildLoanWhere(tenantId, query);

        const [items, total] = await Promise.all([
            this.db.loan.findMany({
                where,
                include: {
                    store: { select: { id: true, name: true } },
                    payments: { select: { amount: true } },
                },
                orderBy: [{ status: 'asc' }, { start_date: 'desc' }, { created_at: 'desc' }],
                skip,
                take: limit,
            }),
            this.db.loan.count({ where }),
        ]);

        return paginate(items.map((loan) => this.withBalance(loan)), total, page, limit);
    }

    async getLoan(tenantId: string, id: string) {
        const loan = await this.db.loan.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                store: { select: { id: true, name: true } },
                payments: { orderBy: { payment_date: 'desc' } },
            },
        });
        if (!loan) {
            throw new NotFoundException('Loan not found.');
        }
        return this.withBalance(loan);
    }

    async createLoan(tenantId: string, userId: string, dto: CreateLoanDto) {
        if (dto.storeId) {
            await this.assertStoreExists(tenantId, dto.storeId);
        }

        const direction = dto.direction ?? 'PAYABLE';

        const { loan, posting } = await this.db.$transaction(async (tx) => {
            const created = await tx.loan.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId ?? null,
                    counterparty: dto.counterparty.trim(),
                    direction,
                    principal: dto.principal,
                    interest_rate: dto.interestRate ?? null,
                    start_date: new Date(dto.startDate),
                    due_date: dto.dueDate ? new Date(dto.dueDate) : null,
                    reference: dto.reference?.trim() || null,
                    notes: dto.notes?.trim() || null,
                    created_by: userId,
                },
                include: { payments: { select: { amount: true } } },
            });

            // Make sure loan accounts + posting rules exist for this tenant
            // (lazy for tenants provisioned before the loans feature shipped).
            await ensureLoanPostingSetup(tx, tenantId);

            const result = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'loan_disbursement',
                conditionKey: 'loan_direction',
                conditionValue: direction,
                sourceModule: 'loans',
                sourceType: 'loan',
                sourceId: created.id,
                amount: Number(created.principal),
                description: `Loan disbursement — ${created.counterparty}`,
                referenceNumber: created.reference ?? undefined,
                date: created.start_date,
            });

            return { loan: created, posting: result };
        });

        return {
            ...this.withBalance(loan),
            posting_status: posting.postingStatus,
            voucher_id: posting.voucherId ?? null,
            voucher_number: posting.voucherNumber ?? null,
        };
    }

    async updateLoan(tenantId: string, id: string, dto: UpdateLoanDto) {
        await this.assertLoanExists(tenantId, id);
        if (dto.storeId) {
            await this.assertStoreExists(tenantId, dto.storeId);
        }

        await this.db.loan.update({
            where: { id },
            data: {
                ...(dto.counterparty !== undefined ? { counterparty: dto.counterparty.trim() } : {}),
                ...(dto.direction !== undefined ? { direction: dto.direction } : {}),
                ...(dto.principal !== undefined ? { principal: dto.principal } : {}),
                ...(dto.interestRate !== undefined ? { interest_rate: dto.interestRate } : {}),
                ...(dto.startDate !== undefined ? { start_date: new Date(dto.startDate) } : {}),
                ...(dto.dueDate !== undefined
                    ? { due_date: dto.dueDate ? new Date(dto.dueDate) : null }
                    : {}),
                ...(dto.storeId !== undefined ? { store_id: dto.storeId } : {}),
                ...(dto.status !== undefined ? { status: dto.status } : {}),
                ...(dto.reference !== undefined ? { reference: dto.reference?.trim() || null } : {}),
                ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            },
        });

        return this.getLoan(tenantId, id);
    }

    async deleteLoan(tenantId: string, id: string) {
        await this.assertLoanExists(tenantId, id);
        // LoanPayment rows cascade-delete with the loan.
        return this.db.loan.delete({ where: { id } });
    }

    async addPayment(tenantId: string, userId: string, loanId: string, dto: CreateLoanPaymentDto) {
        const loan = await this.assertLoanExists(tenantId, loanId);

        const paid = await this.totalPaid(loanId);
        const outstanding = Number(loan.principal) - paid;
        if (dto.amount > outstanding + 0.005) {
            throw new BadRequestException(
                `Payment exceeds the outstanding balance (${outstanding.toFixed(2)}).`,
            );
        }

        await this.db.$transaction(async (tx) => {
            const payment = await tx.loanPayment.create({
                data: {
                    tenant_id: tenantId,
                    loan_id: loanId,
                    amount: dto.amount,
                    payment_date: new Date(dto.paymentDate),
                    payment_method: dto.paymentMethod ?? 'CASH',
                    notes: dto.notes?.trim() || null,
                    created_by: userId,
                },
            });

            // Auto-close the loan once it is fully repaid.
            const newPaid = paid + dto.amount;
            if (newPaid >= Number(loan.principal) - 0.005 && loan.status !== 'CLOSED') {
                await tx.loan.update({ where: { id: loanId }, data: { status: 'CLOSED' } });
            }

            await ensureLoanPostingSetup(tx, tenantId);

            await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'loan_repayment',
                conditionKey: 'loan_direction',
                conditionValue: loan.direction,
                sourceModule: 'loans',
                sourceType: 'loan_payment',
                sourceId: payment.id,
                amount: dto.amount,
                description: `Loan repayment — ${loan.counterparty}`,
                referenceNumber: loan.reference ?? undefined,
                date: payment.payment_date,
            });
        });

        return this.getLoan(tenantId, loanId);
    }

    async deletePayment(tenantId: string, loanId: string, paymentId: string) {
        await this.assertLoanExists(tenantId, loanId);
        const payment = await this.db.loanPayment.findFirst({
            where: { id: paymentId, loan_id: loanId, tenant_id: tenantId },
        });
        if (!payment) {
            throw new NotFoundException('Loan payment not found.');
        }

        await this.db.loanPayment.delete({ where: { id: paymentId } });
        // Removing a payment may re-open a previously closed loan.
        await this.db.loan.update({ where: { id: loanId }, data: { status: 'ACTIVE' } });

        return this.getLoan(tenantId, loanId);
    }

    async getSummary(tenantId: string) {
        const loans = await this.db.loan.findMany({
            where: { tenant_id: tenantId },
            include: { payments: { select: { amount: true } } },
        });

        const summary = {
            payable: { count: 0, principal: 0, paid: 0, outstanding: 0 },
            receivable: { count: 0, principal: 0, paid: 0, outstanding: 0 },
            activeCount: 0,
            closedCount: 0,
        };

        for (const loan of loans) {
            const bucket = loan.direction === 'RECEIVABLE' ? summary.receivable : summary.payable;
            const principal = Number(loan.principal);
            const paid = loan.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            bucket.count += 1;
            bucket.principal += principal;
            bucket.paid += paid;
            bucket.outstanding += Math.max(principal - paid, 0);
            if (loan.status === 'CLOSED') summary.closedCount += 1;
            else summary.activeCount += 1;
        }

        return summary;
    }

    private withBalance(loan: any) {
        const paid = Array.isArray(loan.payments)
            ? loan.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0)
            : 0;
        const principal = Number(loan.principal);
        return {
            ...loan,
            total_paid: paid,
            outstanding: Math.max(principal - paid, 0),
        };
    }

    private async totalPaid(loanId: string) {
        const aggregate = await this.db.loanPayment.aggregate({
            where: { loan_id: loanId },
            _sum: { amount: true },
        });
        return Number(aggregate._sum.amount ?? 0);
    }

    private buildLoanWhere(tenantId: string, query: ListLoansQueryDto) {
        const where: Record<string, any> = { tenant_id: tenantId };
        if (query.direction) where.direction = query.direction;
        if (query.status) where.status = query.status;
        if (query.storeId) where.store_id = query.storeId;
        if (query.search?.trim()) {
            where.counterparty = { contains: query.search.trim(), mode: 'insensitive' };
        }
        return where;
    }

    private async assertLoanExists(tenantId: string, id: string) {
        const loan = await this.db.loan.findFirst({ where: { id, tenant_id: tenantId } });
        if (!loan) {
            throw new NotFoundException('Loan not found.');
        }
        return loan;
    }

    private async assertStoreExists(tenantId: string, storeId: string) {
        const store = await this.db.store.findFirst({ where: { id: storeId, tenant_id: tenantId } });
        if (!store) {
            throw new NotFoundException('Store not found.');
        }
        return store;
    }
}
