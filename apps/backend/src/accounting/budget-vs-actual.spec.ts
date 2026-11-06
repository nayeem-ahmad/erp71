import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { AccountType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

/**
 * Budget vs actual reads one row per account. The bug this guards against:
 * a year of monthly budgets listed each month as its own row, and every row
 * carried the account's full-year actual, so the actual was counted once per
 * budgeted month.
 */

const group = { id: 'g-exp', name: 'Expenses' };
const accounts = {
    depreciation: { id: 'a-dep', name: 'Depreciation', code: '5105', type: AccountType.EXPENSE, group },
    rent: { id: 'a-rent', name: 'Rent', code: '5101', type: AccountType.EXPENSE, group },
    sales: { id: 'a-sales', name: 'Sales', code: '4101', type: AccountType.REVENUE, group: { id: 'g-rev', name: 'Revenue' } },
};

type BudgetFixture = { account: typeof accounts[keyof typeof accounts]; month: number | null; amount: number; updatedAt?: string };
type EntryFixture = { accountId: string; date: string; debit: number; credit: number; storeId?: string };

const budgetRow = (b: BudgetFixture, year = 2026) => ({
    id: `${b.account.id}-${b.month ?? 'y'}-${b.updatedAt ?? ''}`,
    tenant_id: 'tenant-1',
    account_id: b.account.id,
    fiscal_year: year,
    month: b.month,
    amount: b.amount,
    updated_at: new Date(b.updatedAt ?? '2026-01-01T00:00:00Z'),
    account: b.account,
});

describe('getBudgetVsActual', () => {
    let service: AccountingService;
    let budgets: BudgetFixture[];
    let entries: EntryFixture[];

    const db = {
        accountBudget: { findMany: jest.fn() },
        voucherDetail: { findMany: jest.fn() },
        // No settings row → approval off, so every voucher counts.
        accountingSettings: { findUnique: jest.fn() },
    };

    beforeEach(async () => {
        jest.resetAllMocks();
        db.accountingSettings.findUnique.mockResolvedValue(null);
        budgets = [];
        entries = [];

        // Behaves like the query: the month filter, when given, keeps that month only.
        db.accountBudget.findMany.mockImplementation(({ where }: any) => Promise.resolve(
            budgets
                .filter((b) => !('month' in where) || b.month === where.month)
                .map((b) => budgetRow(b)),
        ));
        // Behaves like the query: account, date window and branch.
        db.voucherDetail.findMany.mockImplementation(({ where }: any) => {
            const { gte, lte } = where.voucher.date;
            return Promise.resolve(entries
                .filter((e) => where.account_id.in.includes(e.accountId))
                .filter((e) => new Date(e.date) >= gte && new Date(e.date) <= lte)
                .filter((e) => !where.voucher.store_id || e.storeId === where.voucher.store_id)
                .map((e) => ({ account_id: e.accountId, debit_amount: e.debit, credit_amount: e.credit })));
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => any) => fn() } },
            ],
        }).compile();

        service = module.get(AccountingService);
    });

    const report = (query: { fiscalYear: number; month?: number; approvedOnly?: boolean }, storeId?: string) =>
        service.getBudgetVsActual('tenant-1', query as any, storeId) as Promise<any>;

    it('folds a year of monthly budgets into one row and counts the actual once', async () => {
        budgets = [1, 2, 3, 4, 5, 6, 7].map((month) => ({ account: accounts.depreciation, month, amount: 1000 }));
        entries = [
            { accountId: accounts.depreciation.id, date: '2026-01-31T00:00:00Z', debit: 2500, credit: 0 },
            { accountId: accounts.depreciation.id, date: '2026-05-31T00:00:00Z', debit: 2500, credit: 0 },
            // Another year never counts.
            { accountId: accounts.depreciation.id, date: '2025-12-31T00:00:00Z', debit: 9999, credit: 0 },
        ];

        const result = await report({ fiscalYear: 2026 });

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
            account: { id: accounts.depreciation.id },
            budget: 7000,
            actual: 5000,
            variance: 2000,
            variance_pct: 28.57,
            months: 7,
        });
        expect(result.totals).toEqual({ budget: 7000, actual: 5000, variance: 2000 });
        // One actuals query, for the account once.
        expect(db.voucherDetail.findMany).toHaveBeenCalledTimes(1);
        expect(db.voucherDetail.findMany.mock.calls[0][0].where.account_id.in).toEqual([accounts.depreciation.id]);
    });

    it('compares a month against that month’s actual only', async () => {
        budgets = [
            { account: accounts.depreciation, month: 3, amount: 1000 },
            { account: accounts.depreciation, month: 4, amount: 1000 },
        ];
        entries = [
            { accountId: accounts.depreciation.id, date: '2026-02-28T23:00:00Z', debit: 500, credit: 0 },
            { accountId: accounts.depreciation.id, date: '2026-03-01T00:00:00Z', debit: 700, credit: 0 },
            { accountId: accounts.depreciation.id, date: '2026-03-31T23:59:59Z', debit: 600, credit: 0 },
            { accountId: accounts.depreciation.id, date: '2026-04-01T00:00:00Z', debit: 400, credit: 0 },
        ];

        const result = await report({ fiscalYear: 2026, month: 3 });

        expect(db.accountBudget.findMany.mock.calls[0][0].where).toMatchObject({ fiscal_year: 2026, month: 3 });
        const window = db.voucherDetail.findMany.mock.calls[0][0].where.voucher.date;
        expect(window.gte).toEqual(new Date('2026-03-01T00:00:00.000Z'));
        expect(window.lte).toEqual(new Date('2026-03-31T23:59:59.999Z'));
        expect(result.month).toBe(3);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({ budget: 1000, actual: 1300, variance: -300, variance_pct: -30, months: 1 });
        expect(result.totals).toEqual({ budget: 1000, actual: 1300, variance: -300 });
    });

    it('uses an annual budget row for the year as is', async () => {
        budgets = [{ account: accounts.rent, month: null, amount: 120000 }];
        entries = [
            { accountId: accounts.rent.id, date: '2026-02-01T00:00:00Z', debit: 10000, credit: 0 },
            { accountId: accounts.rent.id, date: '2026-11-01T00:00:00Z', debit: 10000, credit: 0 },
        ];

        const result = await report({ fiscalYear: 2026 });

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({ budget: 120000, actual: 20000, variance: 100000, months: null });
    });

    it('prefers an annual row over monthly rows for the same account in the year view', async () => {
        budgets = [
            { account: accounts.rent, month: null, amount: 120000 },
            { account: accounts.rent, month: 1, amount: 9000 },
            { account: accounts.rent, month: 2, amount: 11000 },
        ];
        entries = [{ accountId: accounts.rent.id, date: '2026-01-15T00:00:00Z', debit: 10000, credit: 0 }];

        const year = await report({ fiscalYear: 2026 });
        expect(year.rows).toHaveLength(1);
        expect(year.rows[0]).toMatchObject({ budget: 120000, actual: 10000, months: null });

        // The month view still reads the monthly row.
        const january = await report({ fiscalYear: 2026, month: 1 });
        expect(january.rows[0]).toMatchObject({ budget: 9000, actual: 10000, variance: -1000, months: 1 });
    });

    it('takes the annual row set last when two exist', async () => {
        budgets = [
            { account: accounts.rent, month: null, amount: 50000, updatedAt: '2026-01-01T00:00:00Z' },
            { account: accounts.rent, month: null, amount: 80000, updatedAt: '2026-03-01T00:00:00Z' },
        ];

        const result = await report({ fiscalYear: 2026 });

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].budget).toBe(80000);
    });

    it('keeps accounts apart, ordered by code, with totals and over-budget on the corrected figures', async () => {
        budgets = [
            ...[1, 2, 3].map((month) => ({ account: accounts.depreciation, month, amount: 1000 })),
            { account: accounts.rent, month: null, amount: 10000 },
            ...[1, 2].map((month) => ({ account: accounts.sales, month, amount: 50000 })),
        ];
        entries = [
            { accountId: accounts.depreciation.id, date: '2026-02-01T00:00:00Z', debit: 4000, credit: 0 },
            { accountId: accounts.rent.id, date: '2026-02-01T00:00:00Z', debit: 6000, credit: 0 },
            // Revenue is credit-normal.
            { accountId: accounts.sales.id, date: '2026-01-10T00:00:00Z', debit: 0, credit: 70000 },
            { accountId: accounts.sales.id, date: '2026-02-10T00:00:00Z', debit: 5000, credit: 0 },
        ];

        const result = await report({ fiscalYear: 2026 });

        expect(result.rows.map((row: any) => row.account.code)).toEqual(['4101', '5101', '5105']);
        const byId = Object.fromEntries(result.rows.map((row: any) => [row.account.id, row]));
        expect(byId[accounts.sales.id]).toMatchObject({ budget: 100000, actual: 65000, variance: 35000, months: 2 });
        expect(byId[accounts.rent.id]).toMatchObject({ budget: 10000, actual: 6000, variance: 4000, months: null });
        expect(byId[accounts.depreciation.id]).toMatchObject({ budget: 3000, actual: 4000, variance: -1000, months: 3 });
        expect(result.rows.filter((row: any) => row.variance < 0)).toHaveLength(1);

        const sum = (key: string) => result.rows.reduce((total: number, row: any) => total + row[key], 0);
        expect(result.totals).toEqual({ budget: sum('budget'), actual: sum('actual'), variance: sum('budget') - sum('actual') });
        expect(result.totals).toEqual({ budget: 113000, actual: 75000, variance: 38000 });
    });

    it('scopes actuals to the branch and keeps approved-only', async () => {
        budgets = [{ account: accounts.rent, month: 1, amount: 10000 }];
        entries = [
            { accountId: accounts.rent.id, date: '2026-01-05T00:00:00Z', debit: 3000, credit: 0, storeId: 'store-a' },
            { accountId: accounts.rent.id, date: '2026-01-06T00:00:00Z', debit: 4000, credit: 0, storeId: 'store-b' },
        ];

        const result = await report({ fiscalYear: 2026, approvedOnly: true }, 'store-a');

        const voucherWhere = db.voucherDetail.findMany.mock.calls[0][0].where.voucher;
        expect(voucherWhere).toMatchObject({ tenant_id: 'tenant-1', store_id: 'store-a', approval_status: 'APPROVED' });
        expect(result.rows[0]).toMatchObject({ budget: 10000, actual: 3000 });
    });

    it('returns an empty report when nothing is budgeted', async () => {
        const result = await report({ fiscalYear: 2026 });

        expect(result).toEqual({ fiscal_year: 2026, month: null, rows: [], totals: { budget: 0, actual: 0, variance: 0 } });
        expect(db.voucherDetail.findMany).not.toHaveBeenCalled();
    });
});
