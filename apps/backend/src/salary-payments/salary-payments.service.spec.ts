jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' }),
    voidAutoPostedVoucher: jest.fn().mockResolvedValue(undefined),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalaryPaymentsService } from './salary-payments.service';
import { autoPostFromRules } from '../accounting/posting.utils';
import { DatabaseService } from '../database/database.service';

describe('SalaryPaymentsService', () => {
    let service: SalaryPaymentsService;
    let db: any;

    beforeEach(async () => {
        db = {
            salaryPayment: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                count: jest.fn(),
            },
            salaryAccrual: {
                findUnique: jest.fn(),
                create: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
            },
            employee: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SalaryPaymentsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<SalaryPaymentsService>(SalaryPaymentsService);
        jest.clearAllMocks();
    });

    describe('list', () => {
        it('returns a paginated result scoped to the tenant', async () => {
            const items = [{ id: 'p1', amount: 5000 }];
            db.salaryPayment.findMany.mockResolvedValue(items);
            db.salaryPayment.count.mockResolvedValue(1);

            const result = await service.list('t1', { page: 1, limit: 20 } as any);

            expect(db.salaryPayment.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 't1' } }),
            );
            expect(result.items).toEqual(items);
            expect(result.total).toBe(1);
        });

        it('applies employee, period and date filters', async () => {
            db.salaryPayment.findMany.mockResolvedValue([]);
            db.salaryPayment.count.mockResolvedValue(0);

            await service.list('t1', {
                employeeId: 'e1',
                payPeriod: '2026-06',
                from: '2026-06-01',
                to: '2026-06-30',
            } as any);

            const where = db.salaryPayment.findMany.mock.calls[0][0].where;
            expect(where.employee_id).toBe('e1');
            expect(where.pay_period).toBe('2026-06');
            expect(where.payment_date.gte).toBeInstanceOf(Date);
            expect(where.payment_date.lte).toBeInstanceOf(Date);
        });
    });

    describe('findOne', () => {
        it('throws when the payment does not exist', async () => {
            db.salaryPayment.findFirst.mockResolvedValue(null);
            await expect(service.findOne('t1', 'missing')).rejects.toThrow(NotFoundException);
        });
    });

    describe('create', () => {
        const dto = {
            employeeId: 'e1',
            amount: 5000,
            payPeriod: '2026-06',
            paymentDate: '2026-06-30',
        };

        const paymentRow = {
            id: 'p1', employee_id: 'e1', amount: 5000, pay_period: '2026-06',
            payment_date: new Date('2026-06-30'), payment_method: 'CASH',
        };

        it('records a salary payment and posts Dr Salary Payable / Cr Cash tagged to the employee', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'e1', tenant_id: 't1' });
            db.salaryPayment.create.mockResolvedValue(paymentRow);

            const result: any = await service.create('t1', 'u1', dto as any);

            expect(db.salaryPayment.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 't1', employee_id: 'e1', pay_period: '2026-06',
                        payment_method: 'CASH', created_by: 'u1',
                    }),
                }),
            );
            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'salary_payment',
                conditionKey: 'payment_mode',
                conditionValue: 'cash',
                sourceId: 'p1',
                amount: 5000,
                partyType: 'EMPLOYEE',
                partyId: 'e1',
            }));
            expect(result.posting_status).toBe('posted');
            expect(result.voucher_id).toBe('v-1');
        });

        it('rejects unknown employees', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.create('t1', 'u1', dto as any)).rejects.toThrow(BadRequestException);
        });

        it('allows a second payment for the same employee and period (instalment/advance)', async () => {
            // The one-payment-per-period constraint is gone; each payment settles
            // part of the accrued payable.
            db.employee.findFirst.mockResolvedValue({ id: 'e1', tenant_id: 't1' });
            db.salaryPayment.create.mockResolvedValue({ ...paymentRow, id: 'p2', amount: 2000 });

            await expect(service.create('t1', 'u1', { ...dto, amount: 2000 } as any)).resolves.toBeDefined();
            expect(autoPostFromRules).toHaveBeenCalled();
        });
    });

    describe('update', () => {
        const existing = { id: 'p1', tenant_id: 't1', employee_id: 'e1', pay_period: '2026-06' };
        const updatedRow = {
            id: 'p1', employee_id: 'e1', amount: 6000, pay_period: '2026-06',
            payment_date: new Date('2026-06-30'), payment_method: 'CASH',
        };

        it('void-and-reposts so the voucher tracks the new amount', async () => {
            const { voidAutoPostedVoucher } = require('../accounting/posting.utils');
            db.salaryPayment.findFirst.mockResolvedValue(existing);
            db.salaryPayment.update.mockResolvedValue(updatedRow);

            const result: any = await service.update('t1', 'p1', { amount: 6000 } as any);

            expect(db.salaryPayment.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'p1' }, data: { amount: 6000 } }),
            );
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, 't1', 'salary_payment', 'p1');
            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({ amount: 6000, sourceId: 'p1' }));
            expect(result.posting_status).toBe('posted');
        });
    });

    describe('remove', () => {
        it('voids the settlement voucher before deleting the payment', async () => {
            const { voidAutoPostedVoucher } = require('../accounting/posting.utils');
            db.salaryPayment.findFirst.mockResolvedValue({ id: 'p1', tenant_id: 't1' });
            db.salaryPayment.delete.mockResolvedValue({ id: 'p1' });

            await service.remove('t1', 'p1');

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, 't1', 'salary_payment', 'p1');
            expect(db.salaryPayment.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
        });
    });

    describe('getSummary', () => {
        it('aggregates totals by period and employee', async () => {
            db.salaryPayment.findMany.mockResolvedValue([
                {
                    employee_id: 'e1',
                    amount: 5000,
                    pay_period: '2026-05',
                    employee: { id: 'e1', name: 'Alice', employee_code: 'EMP-00001' },
                },
                {
                    employee_id: 'e1',
                    amount: 5500,
                    pay_period: '2026-06',
                    employee: { id: 'e1', name: 'Alice', employee_code: 'EMP-00001' },
                },
                {
                    employee_id: 'e2',
                    amount: 3000,
                    pay_period: '2026-06',
                    employee: { id: 'e2', name: 'Bob', employee_code: 'EMP-00002' },
                },
            ]);

            const summary = await service.getSummary('t1', {});

            expect(summary.total).toBe(13500);
            expect(summary.count).toBe(3);
            expect(summary.byPeriod).toEqual([
                { period: '2026-05', amount: 5000 },
                { period: '2026-06', amount: 8500 },
            ]);
            expect(summary.byEmployee[0]).toEqual({
                employeeId: 'e1',
                name: 'Alice',
                employeeCode: 'EMP-00001',
                amount: 10500,
                count: 2,
            });
        });
    });

    describe('runMonthlyAccrual', () => {
        const alice = { id: 'e1', name: 'Alice', employee_code: 'EMP-00001', basic_salary: 30000, status: 'ACTIVE' };

        beforeEach(() => {
            (autoPostFromRules as jest.Mock).mockClear();
            (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' });
        });

        it('accrues each active employee: Dr Salary & Wages / Cr Salary Payable, tagged to the employee', async () => {
            db.employee.findMany.mockResolvedValue([alice]);
            db.salaryAccrual.findUnique.mockResolvedValue(null);
            db.salaryAccrual.create.mockResolvedValue({ id: 'acc-1' });

            const result = await service.runMonthlyAccrual('t1', 'u1', { year: 2026, month: 6 });

            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'salary_accrual',
                conditionKey: 'none',
                sourceModule: 'salary-payments',
                sourceId: 'acc-1',
                amount: 30000,
                partyType: 'EMPLOYEE',
                partyId: 'e1',
            }));
            // Dated to the last day of the pay period (Jun 2026 → Jun 30).
            const call = (autoPostFromRules as jest.Mock).mock.calls[0][0];
            expect((call.date as Date).toISOString().slice(0, 10)).toBe('2026-06-30');
            expect(db.salaryAccrual.update).toHaveBeenCalledWith({ where: { id: 'acc-1' }, data: { voucher_id: 'v-1' } });
            expect(result.processed).toBe(1);
        });

        it('runs the whole period in one transaction and only for ACTIVE, non-deleted employees', async () => {
            db.employee.findMany.mockResolvedValue([alice]);
            db.salaryAccrual.findUnique.mockResolvedValue(null);
            db.salaryAccrual.create.mockResolvedValue({ id: 'acc-1' });

            await service.runMonthlyAccrual('t1', 'u1', { year: 2026, month: 6 });

            expect(db.$transaction).toHaveBeenCalledTimes(1);
            expect(db.employee.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 't1', status: 'ACTIVE', deleted_at: null } }),
            );
        });

        it('skips and reports an employee with no basic_salary — never posts a zero accrual', async () => {
            db.employee.findMany.mockResolvedValue([{ ...alice, basic_salary: null }]);
            db.salaryAccrual.findUnique.mockResolvedValue(null);

            const result = await service.runMonthlyAccrual('t1', 'u1', { year: 2026, month: 6 });

            expect(autoPostFromRules).not.toHaveBeenCalled();
            expect(db.salaryAccrual.create).not.toHaveBeenCalled();
            expect(result.processed).toBe(0);
            expect(result.skipped).toEqual([{ id: 'e1', name: 'Alice', reason: 'NO_BASIC_SALARY' }]);
        });

        it('is idempotent: skips an employee already accrued for the period', async () => {
            db.employee.findMany.mockResolvedValue([alice]);
            db.salaryAccrual.findUnique.mockResolvedValue({ id: 'existing' });

            const result = await service.runMonthlyAccrual('t1', 'u1', { year: 2026, month: 6 });

            expect(db.salaryAccrual.create).not.toHaveBeenCalled();
            expect(autoPostFromRules).not.toHaveBeenCalled();
            expect(result.processed).toBe(0);
        });

        it('propagates a posting failure so the transaction rolls back', async () => {
            db.employee.findMany.mockResolvedValue([alice]);
            db.salaryAccrual.findUnique.mockResolvedValue(null);
            db.salaryAccrual.create.mockResolvedValue({ id: 'acc-1' });
            (autoPostFromRules as jest.Mock).mockRejectedValue(new Error('FISCAL_PERIOD_LOCKED'));

            await expect(service.runMonthlyAccrual('t1', 'u1', { year: 2026, month: 6 }))
                .rejects.toThrow('FISCAL_PERIOD_LOCKED');
        });
    });
});
