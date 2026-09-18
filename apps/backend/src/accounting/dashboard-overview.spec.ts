import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { AccountCategory, AccountType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

/**
 * The accounting dashboard reads one endpoint rather than seven report
 * endpoints, so these cover the derivations that used to live in those reports:
 * balances as of the window end, aging buckets by voucher date, the trial
 * balance check, and the period flows.
 */
describe('AccountingService — dashboard overview', () => {
    let service: AccountingService;

    const ACCOUNTS = [
        { id: 'cash', name: 'Cash in Hand', code: '1101', type: AccountType.ASSET, category: AccountCategory.CASH },
        { id: 'bank', name: 'Bank Account', code: '1102', type: AccountType.ASSET, category: AccountCategory.BANK },
        { id: 'ar', name: 'Accounts Receivable', code: '1201', type: AccountType.ASSET, category: AccountCategory.GENERAL },
        { id: 'ap', name: 'Accounts Payable', code: '2101', type: AccountType.LIABILITY, category: AccountCategory.GENERAL },
        { id: 'sales', name: 'Sales Revenue', code: '4101', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
        { id: 'salaries', name: 'Salaries', code: '5101', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
        { id: 'rent', name: 'Rent', code: '5102', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
    ];

    const db = {
        account: { findMany: jest.fn() },
        voucher: { findMany: jest.fn(), count: jest.fn() },
        voucherDetail: { groupBy: jest.fn(), findMany: jest.fn() },
        postingEvent: { count: jest.fn() },
        recurringVoucher: { count: jest.fn() },
        fiscalPeriod: { count: jest.fn() },
        accountingSettings: { findUnique: jest.fn() },
    };

    const sum = (accountId: string, debit: number, credit: number) => ({
        account_id: accountId,
        _sum: { debit_amount: debit, credit_amount: credit },
    });

    beforeEach(async () => {
        jest.resetAllMocks();
        db.accountingSettings.findUnique.mockResolvedValue(null);
        db.account.findMany.mockResolvedValue(ACCOUNTS);
        db.voucher.findMany.mockResolvedValue([]);
        db.voucher.count.mockResolvedValue(0);
        db.voucherDetail.findMany.mockResolvedValue([]);
        db.postingEvent.count.mockResolvedValue(0);
        db.recurringVoucher.count.mockResolvedValue(0);
        db.fiscalPeriod.count.mockResolvedValue(0);

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

    it('reports position from cumulative balances and performance from the window', async () => {
        db.voucherDetail.groupBy
            // cumulative to the end of the window
            .mockResolvedValueOnce([
                sum('cash', 50_000, 12_000),
                sum('bank', 400_000, 100_000),
                sum('ar', 90_000, 20_000),
                sum('ap', 5_000, 45_000),
                sum('sales', 0, 600_000),
                sum('salaries', 158_000, 0),
                sum('rent', 84_000, 0),
            ])
            // inside the window
            .mockResolvedValueOnce([
                sum('sales', 0, 600_000),
                sum('salaries', 158_000, 0),
                sum('rent', 84_000, 0),
            ]);

        const result = await service.getAccountingDashboardOverview('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-31',
        });

        // 38,000 cash + 300,000 bank
        expect(result.position.cash_and_bank).toBe(338_000);
        expect(result.position.accounts_receivable).toBe(70_000);
        expect(result.position.accounts_payable).toBe(40_000);
        // assets 38,000 + 300,000 + 70,000
        expect(result.position.total_assets).toBe(408_000);
        expect(result.position.net_worth).toBe(368_000);

        expect(result.performance.revenue).toBe(600_000);
        expect(result.performance.expenses).toBe(242_000);
        expect(result.performance.net_profit).toBe(358_000);
        expect(result.performance.net_margin_pct).toBeCloseTo(59.67, 1);

        // Largest expense first, so the donut and the ranked list agree.
        expect(result.expense_mix.map((row) => row.id)).toEqual(['salaries', 'rent']);
    });

    it('flags an unbalanced trial balance with the difference', async () => {
        db.voucherDetail.groupBy
            .mockResolvedValueOnce([sum('cash', 10_000, 0), sum('sales', 0, 8_760)])
            .mockResolvedValueOnce([]);

        const result = await service.getAccountingDashboardOverview('tenant-1', {});

        expect(result.books_health.trial_balance.is_balanced).toBe(false);
        expect(result.books_health.trial_balance.difference).toBe(1_240);
    });

    it('ages what is still open, settling the oldest item first', async () => {
        const asOf = new Date('2026-03-31T23:59:59.999Z');
        const daysBefore = (days: number) => new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000);

        db.voucherDetail.groupBy.mockResolvedValue([]);
        db.voucherDetail.findMany.mockResolvedValue([
            // Receivables are raised by the debit…
            { account_id: 'ar', debit_amount: 10_000, credit_amount: 0, voucher: { date: daysBefore(5) } },
            { account_id: 'ar', debit_amount: 4_000, credit_amount: 0, voucher: { date: daysBefore(45) } },
            { account_id: 'ar', debit_amount: 2_500, credit_amount: 0, voucher: { date: daysBefore(120) } },
            // …and settled by the credit. This used to be skipped as "not itself
            // an aged item", which left the buckets summing to 16,500 against a
            // balance of 13,500 — the report contradicting the figure beside it.
            { account_id: 'ar', debit_amount: 0, credit_amount: 3_000, voucher: { date: daysBefore(2) } },
            // …payables are the mirror: raised by the credit.
            { account_id: 'ap', debit_amount: 0, credit_amount: 7_000, voucher: { date: daysBefore(70) } },
        ]);

        const result = await service.getAccountingDashboardOverview('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-31',
        });

        // The 3,000 receipt clears the whole 120-day debt and 500 of the 45-day
        // one, which is what the shopkeeper would do with it on paper.
        expect(result.aging.receivable).toEqual({
            current: 10_000,
            overdue_31_60: 3_500,
            overdue_61_90: 0,
            overdue_90_plus: 0,
        });
        // Nothing has been paid against the bill, so the payable ages in full.
        expect(result.aging.payable).toEqual({
            current: 0,
            overdue_31_60: 0,
            overdue_61_90: 7_000,
            overdue_90_plus: 0,
        });
    });

    it('keeps the aged receivable equal to the receivable balance', async () => {
        // The invariant the old ager broke: buckets that do not add up to the
        // balance are two different answers to the same question.
        const asOf = new Date('2026-03-31T23:59:59.999Z');
        const daysBefore = (days: number) => new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000);

        db.voucherDetail.groupBy
            .mockResolvedValueOnce([sum('ar', 16_500, 3_000)])
            .mockResolvedValueOnce([]);
        db.voucherDetail.findMany.mockResolvedValue([
            { account_id: 'ar', debit_amount: 10_000, credit_amount: 0, voucher: { date: daysBefore(5) } },
            { account_id: 'ar', debit_amount: 4_000, credit_amount: 0, voucher: { date: daysBefore(45) } },
            { account_id: 'ar', debit_amount: 2_500, credit_amount: 0, voucher: { date: daysBefore(120) } },
            { account_id: 'ar', debit_amount: 0, credit_amount: 3_000, voucher: { date: daysBefore(2) } },
        ]);

        const result = await service.getAccountingDashboardOverview('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-31',
        });

        const aged = result.aging.receivable;
        const summed = aged.current + aged.overdue_31_60 + aged.overdue_61_90 + aged.overdue_90_plus;
        expect(summed).toBe(result.position.accounts_receivable);
        expect(summed).toBe(13_500);
    });

    it('counts everything the books-health strip surfaces', async () => {
        db.voucherDetail.groupBy.mockResolvedValue([]);
        db.accountingSettings.findUnique.mockResolvedValue({
            require_voucher_approval: true,
            auto_approve_system_vouchers: true,
            reports_approved_only: false,
        });
        db.voucher.count.mockResolvedValue(7);
        db.postingEvent.count.mockResolvedValue(3);
        db.recurringVoucher.count.mockResolvedValue(2);
        db.fiscalPeriod.count.mockResolvedValue(4);

        const result = await service.getAccountingDashboardOverview('tenant-1', {});

        expect(result.books_health.pending_vouchers).toBe(7);
        expect(result.books_health.voucher_approval_enabled).toBe(true);
        expect(result.books_health.failed_postings).toBe(3);
        expect(result.books_health.recurring_due).toBe(2);
        expect(result.books_health.unlocked_closed_periods).toBe(4);
        expect(db.postingEvent.count).toHaveBeenCalledWith({
            where: { tenant_id: 'tenant-1', status: 'failed' },
        });
    });

    it('returns null balances when no receivable or payable account exists', async () => {
        db.account.findMany.mockResolvedValue([ACCOUNTS[0], ACCOUNTS[4]]);
        db.voucherDetail.groupBy.mockResolvedValue([]);

        const result = await service.getAccountingDashboardOverview('tenant-1', {});

        expect(result.position.accounts_receivable).toBeNull();
        expect(result.position.accounts_payable).toBeNull();
        expect(result.aging.receivable).toBeNull();
        expect(result.aging.payable).toBeNull();
        // No aging accounts means the row-level read is skipped entirely.
        expect(db.voucherDetail.findMany).not.toHaveBeenCalled();
    });

    it('sums each recent voucher from its debit side', async () => {
        db.voucherDetail.groupBy.mockResolvedValue([]);
        db.voucher.findMany.mockResolvedValue([
            {
                id: 'v-1',
                voucher_number: 'JV-0231',
                voucher_type: 'journal',
                date: new Date('2026-03-20T00:00:00.000Z'),
                description: 'March payroll',
                approval_status: 'PENDING',
                details: [{ debit_amount: 8_000 }, { debit_amount: 4_000 }, { debit_amount: 0 }],
            },
        ]);

        const result = await service.getAccountingDashboardOverview('tenant-1', {});

        expect(result.recent_vouchers[0]).toMatchObject({
            voucher_number: 'JV-0231',
            approval_status: 'PENDING',
            amount: 12_000,
        });
    });
});
