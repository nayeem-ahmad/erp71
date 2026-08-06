import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { autoPostFromRules } from '../accounting/posting.utils';
import { classifyPaymentMode } from '../sales/classify-payment-mode';

/**
 * Paying an approved payroll run — HRIS Phase 7.
 *
 * Two jobs, deliberately separate:
 *
 * 1. **Post it.** Each line emits a `salary_accrual` (Dr Salary & Wages /
 *    Cr Salary Payable, tagged with the employee party) and then a
 *    `salary_payment` settling it. Both event types already exist and already
 *    work; this phase drives them from a run instead of from a human filling in
 *    a form 40 times. That is what closes the `PayrollLine` gap logged in
 *    `MONEY_MODEL_CONTRACT`.
 *
 * 2. **Export it.** A file the bank or the mobile-money provider can consume,
 *    grouped by method.
 *
 * ### What is accrued, and the limitation behind it
 *
 * The accrual is **net pay**, not gross. The textbook entry splits gross into
 * net payable plus one liability per deduction (PF payable, tax payable), and
 * `autoPostFromRules` writes exactly two `VoucherDetail` rows — the same
 * multi-leg limitation already logged against perpetual inventory in TODO.md.
 * Accruing net is the honest subset: the payable equals what will actually
 * leave the bank, so Salary Payable reconciles to zero after disbursement
 * rather than carrying a permanent phantom balance. The employer's separate
 * obligation for withheld PF and tax is **not** modelled, and that is written
 * down here rather than approximated.
 */
@Injectable()
export class PayrollDisbursementService {
    constructor(
        private readonly db: DatabaseService,
        private readonly encryption: EncryptionService,
    ) {}

    private payPeriod(year: number, month: number) {
        return `${year}-${String(month).padStart(2, '0')}`;
    }

    /** Month end — the date the pay relates to, for the fiscal-period guard. */
    private periodDate(year: number, month: number) {
        return new Date(Date.UTC(year, month, 0));
    }

    /**
     * Post and settle an approved run.
     *
     * One transaction for the whole run, mirroring `runMonthlyAccrual`. A run
     * half-posted would leave Salary Payable carrying balances for employees
     * nobody had paid, with no record of which.
     */
    async disburse(
        tenantId: string,
        runId: string,
        userId: string,
        dto: { payment_date?: string; payment_method?: string },
    ) {
        const run = await this.db.payrollRun.findFirst({
            where: { id: runId, tenant_id: tenantId },
            include: { lines: { include: { employee: { select: { id: true, name: true, employee_code: true } } } } },
        });
        if (!run) throw new NotFoundException('Payroll run not found.');
        if (run.status !== 'APPROVED') {
            throw new BadRequestException('Only an approved payroll run can be disbursed.');
        }
        if (run.lines.length === 0) {
            throw new BadRequestException('This payroll run has no lines to pay.');
        }

        const paymentDate = dto.payment_date ? new Date(dto.payment_date) : new Date();
        const paymentMethod = dto.payment_method ?? 'BANK';
        const payPeriod = this.payPeriod(run.year, run.month);
        const periodDate = this.periodDate(run.year, run.month);

        return this.db.$transaction(async (tx) => {
            const results: any[] = [];

            for (const line of run.lines) {
                const net = Number(line.net_pay);
                // A zero-net line is a real outcome (deductions consumed the
                // month). Posting a zero voucher would be noise, so it is
                // recorded as processed and skipped.
                if (net <= 0) {
                    results.push({ employee: line.employee, amount: 0, skipped: 'zero net pay' });
                    continue;
                }

                // Idempotent on (employee, period) via SalaryAccrual's unique
                // key: re-running a partially-failed disbursement must not
                // double the expense.
                const accrual = await tx.salaryAccrual.upsert({
                    where: {
                        tenant_id_employee_id_pay_period: {
                            tenant_id: tenantId, employee_id: line.employee_id, pay_period: payPeriod,
                        },
                    },
                    create: {
                        tenant_id: tenantId,
                        employee_id: line.employee_id,
                        pay_period: payPeriod,
                        amount: net,
                        created_by: userId,
                    },
                    update: { amount: net },
                });

                const accrualPosting = await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'salary_accrual',
                    conditionKey: 'none',
                    conditionValue: null,
                    sourceModule: 'payroll',
                    sourceType: 'salary_accrual',
                    sourceId: accrual.id,
                    amount: net,
                    description: `Payroll ${payPeriod} — ${line.employee.name}`,
                    referenceNumber: line.employee.employee_code,
                    date: periodDate,
                    partyType: 'EMPLOYEE',
                    partyId: line.employee_id,
                });

                if (accrualPosting.voucherId) {
                    await tx.salaryAccrual.update({
                        where: { id: accrual.id },
                        data: { voucher_id: accrualPosting.voucherId },
                    });
                }

                const payment = await tx.salaryPayment.create({
                    data: {
                        tenant_id: tenantId,
                        employee_id: line.employee_id,
                        amount: net,
                        pay_period: payPeriod,
                        payment_date: paymentDate,
                        payment_method: paymentMethod,
                        notes: `Payroll run ${payPeriod}`,
                        created_by: userId,
                    },
                });

                const paymentPosting = await autoPostFromRules({
                    tx,
                    tenantId,
                    eventType: 'salary_payment',
                    conditionKey: 'payment_mode',
                    conditionValue: classifyPaymentMode(paymentMethod),
                    sourceModule: 'payroll',
                    sourceType: 'salary_payment',
                    sourceId: payment.id,
                    amount: net,
                    description: `Salary payment ${payPeriod} — ${line.employee.name}`,
                    date: paymentDate,
                    partyType: 'EMPLOYEE',
                    partyId: line.employee_id,
                });

                results.push({
                    employee: line.employee,
                    amount: net,
                    accrual_id: accrual.id,
                    payment_id: payment.id,
                    accrual_posting: accrualPosting.postingStatus,
                    payment_posting: paymentPosting.postingStatus,
                });
            }

            await tx.payrollRun.update({
                where: { id: runId },
                data: { status: 'PAID', paid_at: paymentDate },
            });

            return { run_id: runId, period: payPeriod, paid: results.length, results };
        });
    }

    /**
     * The disbursement file, grouped by payment method.
     *
     * Account and wallet numbers are decrypted here and nowhere else — this is
     * the one path that legitimately needs them, which is why they live on
     * their own model rather than on `Employee`.
     *
     * An employee with no bank details lands in `unpayable` rather than being
     * dropped: a silently short file is how somebody does not get paid.
     */
    async buildDisbursementFile(tenantId: string, runId: string) {
        const run = await this.db.payrollRun.findFirst({
            where: { id: runId, tenant_id: tenantId },
            include: {
                lines: {
                    include: { employee: { select: { id: true, name: true, employee_code: true } } },
                    orderBy: { employee: { name: 'asc' } },
                },
            },
        });
        if (!run) throw new NotFoundException('Payroll run not found.');
        if (run.status === 'DRAFT') {
            throw new BadRequestException('Approve the payroll run before exporting a disbursement file.');
        }

        const accounts = await this.db.employeeBankAccount.findMany({
            where: { tenant_id: tenantId, employee_id: { in: run.lines.map((line) => line.employee_id) } },
        });
        const byEmployee = new Map(accounts.map((account) => [account.employee_id, account]));

        const groups: Record<string, any[]> = {};
        const unpayable: any[] = [];
        let total = 0;

        for (const line of run.lines) {
            const net = Number(line.net_pay);
            if (net <= 0) continue;

            const account = byEmployee.get(line.employee_id);
            if (!account || account.method === 'CASH') {
                // CASH is not unpayable — it is paid over the counter and
                // belongs in its own group so the total still reconciles.
                if (account?.method === 'CASH') {
                    (groups.CASH ??= []).push({
                        employee_code: line.employee.employee_code,
                        employee_name: line.employee.name,
                        amount: net,
                    });
                    total += net;
                } else {
                    unpayable.push({
                        employee_code: line.employee.employee_code,
                        employee_name: line.employee.name,
                        amount: net,
                        reason: 'No payment details recorded',
                    });
                }
                continue;
            }

            const entry: Record<string, unknown> = {
                employee_code: line.employee.employee_code,
                employee_name: line.employee.name,
                amount: net,
            };

            if (account.method === 'BANK') {
                entry.bank_name = account.bank_name;
                entry.branch_name = account.branch_name;
                entry.account_name = account.account_name ?? line.employee.name;
                entry.account_number = account.account_number
                    ? this.encryption.decrypt(account.account_number)
                    : null;
                entry.routing_number = account.routing_number;
                if (!entry.account_number) {
                    unpayable.push({ ...entry, reason: 'Bank account number missing' });
                    continue;
                }
            } else {
                entry.wallet_number = account.wallet_number
                    ? this.encryption.decrypt(account.wallet_number)
                    : null;
                if (!entry.wallet_number) {
                    unpayable.push({ ...entry, reason: 'Wallet number missing' });
                    continue;
                }
            }

            (groups[account.method] ??= []).push(entry);
            total += net;
        }

        return {
            run: { id: run.id, year: run.year, month: run.month, kind: run.kind, status: run.status },
            period: this.payPeriod(run.year, run.month),
            groups,
            unpayable,
            total,
            payable_count: Object.values(groups).reduce((sum, rows) => sum + rows.length, 0),
        };
    }
}
