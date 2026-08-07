import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayrollDisbursementService } from './payroll-disbursement.service';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({ voucherId: 'v-1', postingStatus: 'POSTED' }),
    voidAutoPostedVoucher: jest.fn(),
}));

const { autoPostFromRules } = jest.requireMock('../accounting/posting.utils');

const employee = (id: string, name: string) => ({ id, name, employee_code: `EMP-${id}` });

const line = (id: string, net: number) => ({
    employee_id: id,
    net_pay: net,
    employee: employee(id, `Person ${id}`),
});

describe('PayrollDisbursementService', () => {
    let service: PayrollDisbursementService;
    let db: any;

    const APPROVED = {
        id: 'run-1', tenant_id: 't1', year: 2026, month: 8, kind: 'REGULAR', status: 'APPROVED',
        lines: [line('e1', 20000), line('e2', 15000)],
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        autoPostFromRules.mockResolvedValue({ voucherId: 'v-1', postingStatus: 'POSTED' });

        db = {
            payrollRun: {
                findFirst: jest.fn().mockResolvedValue(APPROVED),
                update: jest.fn().mockResolvedValue({}),
            },
            salaryAccrual: {
                upsert: jest.fn().mockImplementation(async () => ({ id: 'acc-1' })),
                update: jest.fn().mockResolvedValue({}),
            },
            salaryPayment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }) },
            employeeBankAccount: { findMany: jest.fn().mockResolvedValue([]) },
        };
        db.$transaction = jest.fn(async (cb: any) => cb(db));

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PayrollDisbursementService,
                { provide: DatabaseService, useValue: db },
                {
                    provide: EncryptionService,
                    useValue: { encrypt: jest.fn(), decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')) },
                },
            ],
        }).compile();
        service = module.get(PayrollDisbursementService);
    });

    describe('disburse', () => {
        it('posts an accrual and a payment for each line', async () => {
            // This is what closes the PayrollLine gap in MONEY_MODEL_CONTRACT:
            // the run now drives the two events rather than a human filling a
            // form 40 times.
            await service.disburse('t1', 'run-1', 'user-1', {});

            const events = autoPostFromRules.mock.calls.map((call: any[]) => call[0].eventType);
            expect(events).toEqual([
                'salary_accrual', 'salary_payment', 'salary_accrual', 'salary_payment',
            ]);
        });

        it('tags each posting with the employee party', async () => {
            // Salary Payable is a per-employee control account; without the
            // party tag the subsidiary ledger is empty.
            await service.disburse('t1', 'run-1', 'user-1', {});
            const first = autoPostFromRules.mock.calls[0][0];
            expect(first.partyType).toBe('EMPLOYEE');
            expect(first.partyId).toBe('e1');
        });

        it('accrues net pay, and dates the accrual to month end', async () => {
            // Net rather than gross is the documented limitation: two voucher
            // legs cannot express gross split across payable plus PF and tax.
            // Accruing net keeps Salary Payable reconciling to zero.
            await service.disburse('t1', 'run-1', 'user-1', {});

            expect(db.salaryAccrual.upsert.mock.calls[0][0].create.amount).toBe(20000);
            const accrualCall = autoPostFromRules.mock.calls[0][0];
            expect(accrualCall.amount).toBe(20000);
            expect(accrualCall.date.toISOString().slice(0, 10)).toBe('2026-08-31');
        });

        it('is idempotent per employee and period', async () => {
            // Re-running a partly-failed disbursement must not double the
            // expense; SalaryAccrual's unique key is what enforces it.
            await service.disburse('t1', 'run-1', 'user-1', {});
            expect(db.salaryAccrual.upsert.mock.calls[0][0].where).toEqual({
                tenant_id_employee_id_pay_period: {
                    tenant_id: 't1', employee_id: 'e1', pay_period: '2026-08',
                },
            });
        });

        it('skips a zero-net line without posting a zero voucher', async () => {
            db.payrollRun.findFirst.mockResolvedValue({
                ...APPROVED, lines: [line('e1', 0), line('e2', 15000)],
            });

            const result = await service.disburse('t1', 'run-1', 'user-1', {});

            expect(result.results[0].skipped).toBe('zero net pay');
            expect(autoPostFromRules).toHaveBeenCalledTimes(2); // only e2
        });

        it('marks the run paid', async () => {
            await service.disburse('t1', 'run-1', 'user-1', { payment_date: '2026-09-01' });
            const data = db.payrollRun.update.mock.calls[0][0].data;
            expect(data.status).toBe('PAID');
            expect(data.paid_at.toISOString().slice(0, 10)).toBe('2026-09-01');
        });

        it('runs the whole disbursement in one transaction', async () => {
            // A half-posted run leaves Salary Payable carrying balances for
            // people nobody paid, with no record of which.
            await service.disburse('t1', 'run-1', 'user-1', {});
            expect(db.$transaction).toHaveBeenCalledTimes(1);
        });

        it('refuses a draft run', async () => {
            db.payrollRun.findFirst.mockResolvedValue({ ...APPROVED, status: 'DRAFT' });
            await expect(service.disburse('t1', 'run-1', 'user-1', {}))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses to pay a run twice', async () => {
            db.payrollRun.findFirst.mockResolvedValue({ ...APPROVED, status: 'PAID' });
            await expect(service.disburse('t1', 'run-1', 'user-1', {}))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses a run with no lines', async () => {
            db.payrollRun.findFirst.mockResolvedValue({ ...APPROVED, lines: [] });
            await expect(service.disburse('t1', 'run-1', 'user-1', {}))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses a run from another tenant', async () => {
            db.payrollRun.findFirst.mockResolvedValue(null);
            await expect(service.disburse('t1', 'run-x', 'user-1', {}))
                .rejects.toThrow(NotFoundException);
        });
    });

    describe('buildDisbursementFile', () => {
        const withAccounts = (accounts: any[]) =>
            db.employeeBankAccount.findMany.mockResolvedValue(accounts);

        it('groups by payment method and decrypts the account number', async () => {
            withAccounts([
                { employee_id: 'e1', method: 'BANK', bank_name: 'BRAC', account_number: 'enc:123', account_name: 'A' },
                { employee_id: 'e2', method: 'BKASH', wallet_number: 'enc:01700000000' },
            ]);

            const file = await service.buildDisbursementFile('t1', 'run-1');

            expect(file.groups.BANK[0].account_number).toBe('123');
            expect(file.groups.BKASH[0].wallet_number).toBe('01700000000');
            expect(file.total).toBe(35000);
        });

        it('puts cash in its own group so the total still reconciles', async () => {
            withAccounts([
                { employee_id: 'e1', method: 'CASH' },
                { employee_id: 'e2', method: 'CASH' },
            ]);

            const file = await service.buildDisbursementFile('t1', 'run-1');

            expect(file.groups.CASH).toHaveLength(2);
            expect(file.unpayable).toHaveLength(0);
            expect(file.total).toBe(35000);
        });

        it('reports an employee with no payment details rather than dropping them', async () => {
            // A silently short file is how somebody does not get paid.
            withAccounts([{ employee_id: 'e1', method: 'BANK', account_number: 'enc:123' }]);

            const file = await service.buildDisbursementFile('t1', 'run-1');

            expect(file.unpayable).toHaveLength(1);
            expect(file.unpayable[0].employee_code).toBe('EMP-e2');
            expect(file.unpayable[0].reason).toMatch(/No payment details/);
        });

        it('reports a bank row missing its account number', async () => {
            withAccounts([{ employee_id: 'e1', method: 'BANK', account_number: null }]);
            const file = await service.buildDisbursementFile('t1', 'run-1');
            expect(file.unpayable[0].reason).toMatch(/account number missing/i);
        });

        it('reports a wallet row missing its number', async () => {
            withAccounts([{ employee_id: 'e1', method: 'NAGAD', wallet_number: null }]);
            const file = await service.buildDisbursementFile('t1', 'run-1');
            expect(file.unpayable[0].reason).toMatch(/Wallet number missing/);
        });

        it('excludes zero-net lines from the file entirely', async () => {
            db.payrollRun.findFirst.mockResolvedValue({ ...APPROVED, lines: [line('e1', 0)] });
            withAccounts([{ employee_id: 'e1', method: 'CASH' }]);

            const file = await service.buildDisbursementFile('t1', 'run-1');

            expect(file.total).toBe(0);
            expect(file.payable_count).toBe(0);
        });

        it('refuses to export a draft', async () => {
            db.payrollRun.findFirst.mockResolvedValue({ ...APPROVED, status: 'DRAFT' });
            await expect(service.buildDisbursementFile('t1', 'run-1'))
                .rejects.toThrow(BadRequestException);
        });

        it('allows exporting an already-paid run for the record', async () => {
            db.payrollRun.findFirst.mockResolvedValue({ ...APPROVED, status: 'PAID' });
            await expect(service.buildDisbursementFile('t1', 'run-1')).resolves.toBeDefined();
        });
    });
});
