import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { bootstrapDefaultAccountingForTenant } from '@retail-saas/database';
import { DatabaseService } from '../database/database.service';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { autoPostFromRules, reversePostedVoucher } from '../accounting/posting.utils';
import {
    CreateSalaryPaymentDto,
    ListSalaryPaymentsQueryDto,
    SalaryPaymentSummaryQueryDto,
    UpdateSalaryPaymentDto,
} from './salary-payments.dto';

const SALARY_SOURCE_MODULE = 'salary';
const SALARY_SOURCE_TYPE = 'salary_payment';

@Injectable()
export class SalaryPaymentsService {
    constructor(private db: DatabaseService) {}

    /** Maps a payment method to the posting-rule condition value (cash vs. bank). */
    private paymentMode(method: string): 'cash' | 'bank' {
        return method?.toUpperCase() === 'CASH' ? 'cash' : 'bank';
    }

    /** Lazily provision the Salary & Wages account + posting rules for tenants created before this feature. */
    private async ensureSalaryPostingRules(tx: Prisma.TransactionClient, tenantId: string) {
        const rule = await tx.postingRule.findFirst({
            where: { tenant_id: tenantId, event_type: 'salary_payment' },
            select: { id: true },
        });
        if (!rule) {
            await bootstrapDefaultAccountingForTenant(tx, tenantId);
        }
    }

    async list(
        tenantId: string,
        query: ListSalaryPaymentsQueryDto,
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;
        const where = this.buildWhere(tenantId, query);

        const [items, total] = await Promise.all([
            this.db.salaryPayment.findMany({
                where,
                include: this.paymentInclude(),
                orderBy: [{ payment_date: 'desc' }, { created_at: 'desc' }],
                skip,
                take: limit,
            }),
            this.db.salaryPayment.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const payment = await this.db.salaryPayment.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.paymentInclude(),
        });
        if (!payment) {
            throw new NotFoundException('Salary payment not found.');
        }
        return payment;
    }

    async create(tenantId: string, userId: string, dto: CreateSalaryPaymentDto) {
        await this.assertEmployeeExists(tenantId, dto.employeeId);

        const duplicate = await this.db.salaryPayment.findUnique({
            where: {
                tenant_id_employee_id_pay_period: {
                    tenant_id: tenantId,
                    employee_id: dto.employeeId,
                    pay_period: dto.payPeriod,
                },
            },
        });
        if (duplicate) {
            throw new ConflictException(
                'A salary payment for this employee and pay period already exists.',
            );
        }

        return this.db.$transaction(async (tx) => {
            const payment = await tx.salaryPayment.create({
                data: {
                    tenant_id: tenantId,
                    employee_id: dto.employeeId,
                    amount: dto.amount,
                    pay_period: dto.payPeriod,
                    payment_date: new Date(dto.paymentDate),
                    payment_method: dto.paymentMethod ?? 'CASH',
                    notes: dto.notes,
                    created_by: userId,
                },
                include: this.paymentInclude(),
            });

            await this.ensureSalaryPostingRules(tx, tenantId);
            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'salary_payment',
                conditionKey: 'payment_mode',
                conditionValue: this.paymentMode(payment.payment_method),
                sourceModule: SALARY_SOURCE_MODULE,
                sourceType: SALARY_SOURCE_TYPE,
                sourceId: payment.id,
                amount: Number(payment.amount),
                description: `Salary payment — ${payment.employee?.name ?? ''} (${payment.pay_period})`.trim(),
                referenceNumber: payment.pay_period,
                date: payment.payment_date,
            });

            return {
                ...payment,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    async update(tenantId: string, id: string, dto: UpdateSalaryPaymentDto) {
        const existing = await this.findOne(tenantId, id);

        if (dto.payPeriod && dto.payPeriod !== existing.pay_period) {
            const duplicate = await this.db.salaryPayment.findUnique({
                where: {
                    tenant_id_employee_id_pay_period: {
                        tenant_id: tenantId,
                        employee_id: existing.employee_id,
                        pay_period: dto.payPeriod,
                    },
                },
            });
            if (duplicate) {
                throw new ConflictException(
                    'A salary payment for this employee and pay period already exists.',
                );
            }
        }

        // Changes to amount, method or date alter the journal entry and require re-posting.
        const financialChange =
            (dto.amount !== undefined && Number(dto.amount) !== Number(existing.amount)) ||
            (dto.paymentMethod !== undefined && dto.paymentMethod !== existing.payment_method) ||
            (dto.paymentDate !== undefined &&
                new Date(dto.paymentDate).getTime() !== existing.payment_date.getTime());

        return this.db.$transaction(async (tx) => {
            const payment = await tx.salaryPayment.update({
                where: { id },
                data: {
                    ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
                    ...(dto.payPeriod !== undefined ? { pay_period: dto.payPeriod } : {}),
                    ...(dto.paymentDate !== undefined
                        ? { payment_date: new Date(dto.paymentDate) }
                        : {}),
                    ...(dto.paymentMethod !== undefined ? { payment_method: dto.paymentMethod } : {}),
                    ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
                },
                include: this.paymentInclude(),
            });

            if (!financialChange) {
                return payment;
            }

            // Reverse the existing voucher and post a fresh one reflecting the new values.
            await reversePostedVoucher({
                tx,
                tenantId,
                eventType: 'salary_payment',
                sourceId: id,
                description: `Reversal (edit) of salary payment ${existing.pay_period}`,
                resetEvent: true,
            });
            await this.ensureSalaryPostingRules(tx, tenantId);
            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'salary_payment',
                conditionKey: 'payment_mode',
                conditionValue: this.paymentMode(payment.payment_method),
                sourceModule: SALARY_SOURCE_MODULE,
                sourceType: SALARY_SOURCE_TYPE,
                sourceId: payment.id,
                amount: Number(payment.amount),
                description: `Salary payment — ${payment.employee?.name ?? ''} (${payment.pay_period})`.trim(),
                referenceNumber: payment.pay_period,
                date: payment.payment_date,
            });

            return {
                ...payment,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.findOne(tenantId, id);
        return this.db.$transaction(async (tx) => {
            // Auto-reverse the journal entry so the ledger stays balanced.
            await reversePostedVoucher({
                tx,
                tenantId,
                eventType: 'salary_payment',
                sourceId: id,
                description: `Reversal of deleted salary payment ${existing.pay_period}`,
            });
            return tx.salaryPayment.delete({ where: { id } });
        });
    }

    async getSummary(tenantId: string, query: SalaryPaymentSummaryQueryDto) {
        const where = this.buildDateWhere(tenantId, query.from, query.to);

        const payments = await this.db.salaryPayment.findMany({
            where,
            include: { employee: { select: { id: true, name: true, employee_code: true } } },
            orderBy: { payment_date: 'asc' },
        });

        const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);

        const monthMap = new Map<string, number>();
        for (const p of payments) {
            monthMap.set(p.pay_period, (monthMap.get(p.pay_period) ?? 0) + Number(p.amount));
        }
        const byPeriod = Array.from(monthMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([period, amount]) => ({ period, amount }));

        const employeeMap = new Map<
            string,
            { employeeId: string; name: string; employeeCode: string; amount: number; count: number }
        >();
        for (const p of payments) {
            const existing = employeeMap.get(p.employee_id) ?? {
                employeeId: p.employee.id,
                name: p.employee.name,
                employeeCode: p.employee.employee_code,
                amount: 0,
                count: 0,
            };
            existing.amount += Number(p.amount);
            existing.count += 1;
            employeeMap.set(p.employee_id, existing);
        }
        const byEmployee = Array.from(employeeMap.values()).sort((a, b) => b.amount - a.amount);

        return {
            total,
            count: payments.length,
            byPeriod,
            byEmployee,
        };
    }

    private paymentInclude() {
        return {
            employee: {
                select: { id: true, name: true, employee_code: true, phone: true },
            },
        };
    }

    private buildWhere(tenantId: string, query: ListSalaryPaymentsQueryDto) {
        const where: Record<string, any> = { tenant_id: tenantId };
        if (query.employeeId) where.employee_id = query.employeeId;
        if (query.payPeriod) where.pay_period = query.payPeriod;

        const dateFilter = this.buildDateRangeFilter(query.from, query.to);
        if (dateFilter) where.payment_date = dateFilter;

        return where;
    }

    private buildDateWhere(tenantId: string, from?: string, to?: string) {
        const where: Record<string, any> = { tenant_id: tenantId };
        const dateFilter = this.buildDateRangeFilter(from, to);
        if (dateFilter) where.payment_date = dateFilter;
        return where;
    }

    private buildDateRangeFilter(from?: string, to?: string) {
        if (!from && !to) return undefined;

        const filter: Record<string, Date> = {};
        if (from) {
            const date = new Date(from);
            if (!Number.isNaN(date.getTime())) filter.gte = date;
        }
        if (to) {
            const date = new Date(to);
            if (!Number.isNaN(date.getTime())) filter.lte = date;
        }

        return Object.keys(filter).length > 0 ? filter : undefined;
    }

    private async assertEmployeeExists(tenantId: string, employeeId: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) {
            throw new BadRequestException('Employee not found.');
        }
        return employee;
    }
}
