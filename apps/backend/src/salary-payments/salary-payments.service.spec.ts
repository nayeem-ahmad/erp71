import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SalaryPaymentsService } from './salary-payments.service';
import { DatabaseService } from '../database/database.service';
import { autoPostFromRules, reversePostedVoucher } from '../accounting/posting.utils';

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({
        postingStatus: 'posted',
        voucherId: 'v1',
        voucherNumber: 'CP-00001',
    }),
    reversePostedVoucher: jest.fn().mockResolvedValue({ reversed: true, voucherId: 'rev1' }),
}));

jest.mock('@retail-saas/database', () => ({
    ...jest.requireActual('@retail-saas/database'),
    bootstrapDefaultAccountingForTenant: jest.fn().mockResolvedValue(undefined),
}));

const mockAutoPost = autoPostFromRules as jest.Mock;
const mockReverse = reversePostedVoucher as jest.Mock;

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
            employee: {
                findFirst: jest.fn(),
            },
            postingRule: {
                findFirst: jest.fn().mockResolvedValue({ id: 'rule-1' }),
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
        db.postingRule.findFirst.mockResolvedValue({ id: 'rule-1' });
        mockAutoPost.mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'v1',
            voucherNumber: 'CP-00001',
        });
        mockReverse.mockResolvedValue({ reversed: true, voucherId: 'rev1' });
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

        it('records a salary payment and auto-posts a journal voucher', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'e1', tenant_id: 't1' });
            db.salaryPayment.findUnique.mockResolvedValue(null);
            db.salaryPayment.create.mockResolvedValue({
                id: 'p1',
                amount: 5000,
                pay_period: '2026-06',
                payment_method: 'CASH',
                payment_date: new Date('2026-06-30'),
                employee: { id: 'e1', name: 'Alice' },
            });

            const result: any = await service.create('t1', 'u1', dto as any);

            expect(db.salaryPayment.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 't1',
                        employee_id: 'e1',
                        pay_period: '2026-06',
                        payment_method: 'CASH',
                        created_by: 'u1',
                    }),
                }),
            );
            expect(mockAutoPost).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'salary_payment',
                    conditionKey: 'payment_mode',
                    conditionValue: 'cash',
                    sourceModule: 'salary',
                    sourceType: 'salary_payment',
                    sourceId: 'p1',
                    amount: 5000,
                }),
            );
            expect(result.posting_status).toBe('posted');
            expect(result.voucher_number).toBe('CP-00001');
        });

        it('posts against the bank account for non-cash methods', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'e1', tenant_id: 't1' });
            db.salaryPayment.findUnique.mockResolvedValue(null);
            db.salaryPayment.create.mockResolvedValue({
                id: 'p1',
                amount: 5000,
                pay_period: '2026-06',
                payment_method: 'BANK',
                payment_date: new Date('2026-06-30'),
                employee: { id: 'e1', name: 'Alice' },
            });

            await service.create('t1', 'u1', { ...dto, paymentMethod: 'BANK' } as any);

            expect(mockAutoPost).toHaveBeenCalledWith(
                expect.objectContaining({ conditionValue: 'bank' }),
            );
        });

        it('lazily bootstraps posting rules when missing', async () => {
            const { bootstrapDefaultAccountingForTenant } = require('@retail-saas/database');
            db.employee.findFirst.mockResolvedValue({ id: 'e1', tenant_id: 't1' });
            db.salaryPayment.findUnique.mockResolvedValue(null);
            db.postingRule.findFirst.mockResolvedValue(null);
            db.salaryPayment.create.mockResolvedValue({
                id: 'p1',
                amount: 5000,
                pay_period: '2026-06',
                payment_method: 'CASH',
                payment_date: new Date('2026-06-30'),
                employee: { id: 'e1', name: 'Alice' },
            });

            await service.create('t1', 'u1', dto as any);

            expect(bootstrapDefaultAccountingForTenant).toHaveBeenCalledWith(db, 't1');
        });

        it('rejects unknown employees', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.create('t1', 'u1', dto as any)).rejects.toThrow(BadRequestException);
        });

        it('prevents a duplicate payment for the same employee and period', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'e1', tenant_id: 't1' });
            db.salaryPayment.findUnique.mockResolvedValue({ id: 'existing' });
            await expect(service.create('t1', 'u1', dto as any)).rejects.toThrow(ConflictException);
        });
    });

    describe('update', () => {
        it('blocks changing to a period that already has a payment', async () => {
            db.salaryPayment.findFirst.mockResolvedValue({
                id: 'p1',
                tenant_id: 't1',
                employee_id: 'e1',
                pay_period: '2026-05',
            });
            db.salaryPayment.findUnique.mockResolvedValue({ id: 'other' });

            await expect(service.update('t1', 'p1', { payPeriod: '2026-06' } as any)).rejects.toThrow(
                ConflictException,
            );
        });

        it('reverses and re-posts the voucher when the amount changes', async () => {
            db.salaryPayment.findFirst.mockResolvedValue({
                id: 'p1',
                tenant_id: 't1',
                employee_id: 'e1',
                pay_period: '2026-06',
                amount: 5000,
                payment_method: 'CASH',
                payment_date: new Date('2026-06-30'),
            });
            db.salaryPayment.update.mockResolvedValue({
                id: 'p1',
                amount: 6000,
                pay_period: '2026-06',
                payment_method: 'CASH',
                payment_date: new Date('2026-06-30'),
                employee: { id: 'e1', name: 'Alice' },
            });

            const result: any = await service.update('t1', 'p1', { amount: 6000 } as any);

            expect(mockReverse).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'salary_payment', sourceId: 'p1', resetEvent: true }),
            );
            expect(mockAutoPost).toHaveBeenCalledWith(
                expect.objectContaining({ sourceId: 'p1', amount: 6000 }),
            );
            expect(result.posting_status).toBe('posted');
        });

        it('does not touch the ledger when only notes change', async () => {
            db.salaryPayment.findFirst.mockResolvedValue({
                id: 'p1',
                tenant_id: 't1',
                employee_id: 'e1',
                pay_period: '2026-06',
                amount: 5000,
                payment_method: 'CASH',
                payment_date: new Date('2026-06-30'),
            });
            db.salaryPayment.update.mockResolvedValue({ id: 'p1', notes: 'Bonus included' });

            await service.update('t1', 'p1', { notes: 'Bonus included' } as any);

            expect(mockReverse).not.toHaveBeenCalled();
            expect(mockAutoPost).not.toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('reverses the journal voucher then deletes the payment', async () => {
            db.salaryPayment.findFirst.mockResolvedValue({
                id: 'p1',
                tenant_id: 't1',
                pay_period: '2026-06',
            });
            db.salaryPayment.delete.mockResolvedValue({ id: 'p1' });

            await service.remove('t1', 'p1');

            expect(mockReverse).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'salary_payment', sourceId: 'p1' }),
            );
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
});
