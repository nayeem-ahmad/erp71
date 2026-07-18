import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { autoPostFromRules } from '../accounting/posting.utils';
import {
    CreateSalaryPaymentDto,
    ListSalaryPaymentsQueryDto,
    RunSalaryAccrualDto,
    SalaryPaymentSummaryQueryDto,
    UpdateSalaryPaymentDto,
} from './salary-payments.dto';

@Injectable()
export class SalaryPaymentsService {
    constructor(private db: DatabaseService) {}

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

        return this.db.salaryPayment.create({
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
    }

    /**
     * Accrues one month's salary for every active employee: posts
     * Dr Salary & Wages / Cr Salary Payable per employee, tagged with the
     * employee party so Salary Payable becomes a per-employee ledger. The cash
     * payment (create, below) settles that payable later.
     *
     * Mirrors runDepreciation: one transaction for the whole run, idempotent per
     * (employee, period) via SalaryAccrual's unique key, dated to the period end
     * so autoPostFromRules' fiscal-period guard blocks accruing into a locked
     * month. Employees without a basic_salary are skipped and reported.
     */
    async runMonthlyAccrual(tenantId: string, userId: string, dto: RunSalaryAccrualDto) {
        const payPeriod = `${dto.year}-${String(dto.month).padStart(2, '0')}`;
        const periodDate = new Date(Date.UTC(dto.year, dto.month, 0));

        const employees = await this.db.employee.findMany({
            where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null },
        });

        return this.db.$transaction(async (tx) => {
            const results = [];
            const skipped = [];
            for (const employee of employees) {
                const amount = Number(employee.basic_salary ?? 0);
                if (amount <= 0) {
                    skipped.push({ id: employee.id, name: employee.name, reason: 'NO_BASIC_SALARY' });
                    continue;
                }

                const existing = await tx.salaryAccrual.findUnique({
                    where: { tenant_id_employee_id_pay_period: { tenant_id: tenantId, employee_id: employee.id, pay_period: payPeriod } },
                });
                if (existing) continue;

                const accrual = await tx.salaryAccrual.create({
                    data: { tenant_id: tenantId, employee_id: employee.id, pay_period: payPeriod, amount, created_by: userId },
                });

                const posting = await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'salary_accrual',
                    conditionKey: 'none',
                    conditionValue: null,
                    sourceModule: 'salary-payments',
                    sourceType: 'salary_accrual',
                    sourceId: accrual.id,
                    amount,
                    description: `Salary accrual ${payPeriod} — ${employee.name}`,
                    referenceNumber: employee.employee_code,
                    date: periodDate,
                    partyType: 'EMPLOYEE',
                    partyId: employee.id,
                });

                if (posting.voucherId) {
                    await tx.salaryAccrual.update({ where: { id: accrual.id }, data: { voucher_id: posting.voucherId } });
                }

                results.push({
                    employee: { id: employee.id, name: employee.name, employee_code: employee.employee_code },
                    amount,
                    accrual_id: accrual.id,
                    posting_status: posting.postingStatus,
                    voucher_id: posting.voucherId ?? null,
                });
            }

            return { period: payPeriod, processed: results.length, skipped, results };
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

        return this.db.salaryPayment.update({
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
    }

    async remove(tenantId: string, id: string) {
        await this.findOne(tenantId, id);
        return this.db.salaryPayment.delete({ where: { id } });
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
