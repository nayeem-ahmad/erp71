import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { AccountType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { unassignedSubgroupLabel } from './report-level.utils';

/**
 * Reporting detail level (account / subgroup / group) across the three COA-grained
 * statements. The load-bearing assertion everywhere is that totals are invariant:
 * only the row granularity may change when the level changes.
 */

const groups = {
    currentAssets: { id: 'g-ca', name: 'Current Assets', code: '11' },
    liabilities: { id: 'g-liab', name: 'Current Liabilities', code: '21' },
    equity: { id: 'g-eq', name: 'Equity', code: '31' },
    revenue: { id: 'g-rev', name: 'Revenue', code: '41' },
    expenses: { id: 'g-exp', name: 'Expenses', code: '51' },
};

const subgroups = {
    bank: { id: 'sg-bank', name: 'Bank', code: '1101' },
    cash: { id: 'sg-cash', name: 'Cash', code: '1102' },
    payables: { id: 'sg-ap', name: 'Payables', code: '2101' },
    sales: { id: 'sg-sales', name: 'Sales', code: '4101' },
    opex: { id: 'sg-opex', name: 'Operating', code: '5101' },
};

type Fixture = {
    id: string;
    name: string;
    code: string | null;
    type: string;
    group: { id: string; name: string; code: string };
    subgroup: { id: string; name: string; code: string } | null;
    debit: number;
    credit: number;
    storeId: string;
};

/**
 * A deliberately balanced book (3,600 dr / 3,600 cr) that exercises every edge:
 * two accounts sharing a subgroup, accounts with no subgroup at all, and a contra
 * account (Sales Returns) that offsets its subgroup sibling.
 */
const FIXTURE: Fixture[] = [
    { id: 'a-bank1', name: 'City Bank', code: '110101', type: AccountType.ASSET, group: groups.currentAssets, subgroup: subgroups.bank, debit: 1000, credit: 0, storeId: 'store-a' },
    { id: 'a-bank2', name: 'Brac Bank', code: '110102', type: AccountType.ASSET, group: groups.currentAssets, subgroup: subgroups.bank, debit: 500, credit: 0, storeId: 'store-a' },
    { id: 'a-cash', name: 'Cash In Hand', code: '110201', type: AccountType.ASSET, group: groups.currentAssets, subgroup: subgroups.cash, debit: 200, credit: 0, storeId: 'store-a' },
    { id: 'a-adv', name: 'Advance To Supplier', code: '110001', type: AccountType.ASSET, group: groups.currentAssets, subgroup: null, debit: 100, credit: 0, storeId: 'store-a' },
    { id: 'a-ap', name: 'Accounts Payable', code: '210101', type: AccountType.LIABILITY, group: groups.liabilities, subgroup: subgroups.payables, debit: 0, credit: 800, storeId: 'store-a' },
    { id: 'a-cap', name: 'Owner Capital', code: '310001', type: AccountType.EQUITY, group: groups.equity, subgroup: null, debit: 0, credit: 800, storeId: 'store-a' },
    { id: 'a-sales', name: 'Sales Revenue', code: '410101', type: AccountType.REVENUE, group: groups.revenue, subgroup: subgroups.sales, debit: 0, credit: 1200, storeId: 'store-a' },
    { id: 'a-sales-b', name: 'Sales Revenue', code: '410101', type: AccountType.REVENUE, group: groups.revenue, subgroup: subgroups.sales, debit: 0, credit: 800, storeId: 'store-b' },
    { id: 'a-returns', name: 'Sales Returns', code: '410102', type: AccountType.REVENUE, group: groups.revenue, subgroup: subgroups.sales, debit: 300, credit: 0, storeId: 'store-a' },
    { id: 'a-rent', name: 'Rent', code: '510101', type: AccountType.EXPENSE, group: groups.expenses, subgroup: subgroups.opex, debit: 600, credit: 0, storeId: 'store-a' },
    { id: 'a-salary', name: 'Salary', code: '510102', type: AccountType.EXPENSE, group: groups.expenses, subgroup: subgroups.opex, debit: 500, credit: 0, storeId: 'store-b' },
    { id: 'a-misc', name: 'Miscellaneous', code: '510001', type: AccountType.EXPENSE, group: groups.expenses, subgroup: null, debit: 400, credit: 0, storeId: 'store-a' },
];

const LEVELS = ['account', 'subgroup', 'group'] as const;

describe('accounting reports — detail level', () => {
    let service: AccountingService;

    const db = {
        account: { findMany: jest.fn() },
        voucherDetail: { findMany: jest.fn() },
        store: { findMany: jest.fn() },
    };

    beforeEach(async () => {
        jest.resetAllMocks();

        db.account.findMany.mockImplementation(({ where }: any) => {
            const types: string[] | undefined = where?.type?.in;
            return Promise.resolve(
                types ? FIXTURE.filter((account) => types.includes(account.type)) : FIXTURE,
            );
        });
        db.voucherDetail.findMany.mockResolvedValue(
            FIXTURE.map((account) => ({
                account_id: account.id,
                debit_amount: account.debit,
                credit_amount: account.credit,
                voucher: { store_id: account.storeId },
            })),
        );
        db.store.findMany.mockResolvedValue([
            { id: 'store-a', name: 'Gulshan' },
            { id: 'store-b', name: 'Banani' },
        ]);

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

    describe('trial balance', () => {
        const trialBalance = (level?: string) =>
            service.getTrialBalance('tenant-1', { scope: 'company', level }, true) as Promise<any>;

        it('defaults to account level and echoes the level back', async () => {
            const result = await trialBalance();

            expect(result.level).toBe('account');
            expect(result.rows).toHaveLength(FIXTURE.length);
        });

        it('rejects an unknown level', async () => {
            await expect(trialBalance('ledger')).rejects.toThrow(BadRequestException);
        });

        it('collapses to one row per subgroup, with an unassigned bucket per group', async () => {
            const result = await trialBalance('subgroup');

            expect(result.rows.map((row: any) => row.account.name)).toEqual([
                'Bank',
                'Cash',
                unassignedSubgroupLabel('Current Assets'),
                'Payables',
                unassignedSubgroupLabel('Equity'),
                'Sales',
                'Operating',
                unassignedSubgroupLabel('Expenses'),
            ]);

            const bank = result.rows.find((row: any) => row.account.name === 'Bank');
            expect(bank.debit_balance).toBe(1500);
            expect(bank.debit_total).toBe(1500);
        });

        // Code order, not alphabetical: Revenue (41) precedes Expenses (51).
        it('collapses to one row per group', async () => {
            const result = await trialBalance('group');

            expect(result.rows.map((row: any) => row.account.name)).toEqual([
                'Current Assets',
                'Current Liabilities',
                'Equity',
                'Revenue',
                'Expenses',
            ]);
            expect(result.rows.find((row: any) => row.account.name === 'Current Assets').debit_balance).toBe(1800);
            expect(result.rows.find((row: any) => row.account.name === 'Revenue').credit_balance).toBe(1700);
        });

        it('stays balanced at every level', async () => {
            for (const level of LEVELS) {
                const result = await trialBalance(level);
                expect(result.is_balanced).toBe(true);
                expect(result.totals.debit).toBe(result.totals.credit);
            }
        });

        it('nets a contra account against its subgroup instead of reporting it gross', async () => {
            const byAccount = await trialBalance('account');
            const bySubgroup = await trialBalance('subgroup');

            // Sales Returns is presented on the debit side of its own row...
            expect(byAccount.rows.find((row: any) => row.account.id === 'a-returns').debit_balance).toBe(300);
            expect(byAccount.totals.debit).toBe(3600);

            // ...but nets away inside the Sales subgroup, shrinking both columns by 300.
            const sales = bySubgroup.rows.find((row: any) => row.account.name === 'Sales');
            expect(sales.debit_balance).toBe(0);
            expect(sales.credit_balance).toBe(1700);
            expect(bySubgroup.totals.debit).toBe(3300);
            expect(bySubgroup.totals.credit).toBe(3300);
        });

        it('carries group and subgroup identity on every rolled-up row', async () => {
            const result = await trialBalance('subgroup');
            const unassigned = result.rows.find((row: any) => row.account.is_unassigned);

            expect(unassigned.account.group).toEqual(groups.currentAssets);
            expect(unassigned.account.subgroup).toBeNull();
            expect(result.rows.find((row: any) => row.account.name === 'Bank').account.subgroup)
                .toEqual(subgroups.bank);
        });
    });

    describe('profit & loss', () => {
        const profitLoss = (level?: string) =>
            service.getProfitLoss('tenant-1', { scope: 'company', level }, true) as Promise<any>;

        it('keeps revenue, expense and net profit totals identical at every level', async () => {
            for (const level of LEVELS) {
                const result = await profitLoss(level);

                expect(result.revenue.total).toBe(1700);
                expect(result.expenses.total).toBe(1500);
                expect(result.net_profit).toBe(200);
                expect(result.revenue.groups[0].total).toBe(1700);
                expect(result.expenses.groups[0].total).toBe(1500);
            }
        });

        it('lists one row per account at account level', async () => {
            const result = await profitLoss('account');

            expect(result.revenue.groups[0].rows.map((row: any) => row.name)).toEqual([
                'Sales Revenue',
                'Sales Revenue',
                'Sales Returns',
            ]);
        });

        it('merges a subgroup into a single row at subgroup level', async () => {
            const result = await profitLoss('subgroup');

            expect(result.revenue.groups[0].rows).toEqual([
                expect.objectContaining({ id: 'sg-sales', name: 'Sales', balance: 1700 }),
            ]);
            expect(result.expenses.groups[0].rows.map((row: any) => row.name)).toEqual([
                'Operating',
                unassignedSubgroupLabel('Expenses'),
            ]);
        });

        it('emits group headers with no rows at group level', async () => {
            const result = await profitLoss('group');

            expect(result.revenue.groups).toEqual([
                expect.objectContaining({ group: groups.revenue, rows: [], total: 1700 }),
            ]);
            expect(result.expenses.groups[0].rows).toEqual([]);
        });
    });

    describe('balance sheet', () => {
        const balanceSheet = (level?: string) =>
            service.getBalanceSheet('tenant-1', { scope: 'company', level }, true) as Promise<any>;

        it('keeps totals identical and balanced at every level', async () => {
            for (const level of LEVELS) {
                const result = await balanceSheet(level);

                expect(result.assets.total).toBe(1800);
                expect(result.liabilities.total).toBe(800);
                expect(result.equity.net_profit).toBe(200);
                expect(result.equity.total).toBe(1000);
                expect(result.total_liabilities_and_equity).toBe(1800);
                expect(result.is_balanced).toBe(true);
            }
        });

        it('rolls assets into subgroup rows including the unassigned bucket', async () => {
            const result = await balanceSheet('subgroup');

            expect(result.assets.groups[0].rows).toEqual([
                expect.objectContaining({ name: 'Bank', balance: 1500 }),
                expect.objectContaining({ name: 'Cash', balance: 200 }),
                expect.objectContaining({
                    name: unassignedSubgroupLabel('Current Assets'),
                    balance: 100,
                    is_unassigned: true,
                }),
            ]);
        });

        it('drops rows at group level', async () => {
            const result = await balanceSheet('group');

            expect(result.assets.groups[0]).toEqual(
                expect.objectContaining({ group: groups.currentAssets, rows: [], total: 1800 }),
            );
        });
    });

    describe('compare scope', () => {
        const compareArgs = { scope: 'compare', storeIds: 'store-a,store-b', includeCompanyBucket: false };

        it('rolls up profit & loss per column without disturbing the totals', async () => {
            const byAccount: any = await service.getProfitLoss('tenant-1', { ...compareArgs }, true);
            const bySubgroup: any = await service.getProfitLoss('tenant-1', { ...compareArgs, level: 'subgroup' }, true);
            const byGroup: any = await service.getProfitLoss('tenant-1', { ...compareArgs, level: 'group' }, true);

            for (const result of [byAccount, bySubgroup, byGroup]) {
                expect(result.net_profit).toEqual({ 'store-a': -100, 'store-b': 300, total: 200 });
                expect(result.sections[0].subtotals).toEqual({ 'store-a': 900, 'store-b': 800, total: 1700 });
                expect(result.sections[1].subtotals).toEqual({ 'store-a': 1000, 'store-b': 500, total: 1500 });
            }

            expect(byAccount.sections[0].groups[0].rows).toHaveLength(3);
            expect(bySubgroup.sections[0].groups[0].rows).toEqual([
                expect.objectContaining({
                    account: expect.objectContaining({ id: 'sg-sales', name: 'Sales' }),
                    amounts: { 'store-a': 900, 'store-b': 800, total: 1700 },
                }),
            ]);
            expect(byGroup.sections[0].groups[0].rows).toEqual([]);
            expect(byGroup.sections[0].groups[0].subtotals).toEqual({ 'store-a': 900, 'store-b': 800, total: 1700 });
        });

        it('nets the trial balance per column before choosing a side', async () => {
            const byAccount: any = await service.getTrialBalance('tenant-1', { ...compareArgs }, true);
            const byGroup: any = await service.getTrialBalance('tenant-1', { ...compareArgs, level: 'group' }, true);

            expect(byAccount.rows.find((row: any) => row.account.id === 'a-returns').debit_amounts['store-a']).toBe(300);

            const revenue = byGroup.rows.find((row: any) => row.account.name === 'Revenue');
            expect(revenue.debit_amounts).toEqual({ 'store-a': 0, 'store-b': 0, total: 0 });
            expect(revenue.credit_amounts).toEqual({ 'store-a': 900, 'store-b': 800, total: 1700 });
            expect(byGroup.level).toBe('group');
        });

        it('keeps the balance sheet balanced per column at group level', async () => {
            const result: any = await service.getBalanceSheet('tenant-1', { ...compareArgs, level: 'group' }, true);

            expect(result.total_assets).toEqual({ 'store-a': 1800, 'store-b': 0, total: 1800 });
            expect(result.total_liabilities_and_equity).toEqual({
                'store-a': 1500,
                'store-b': 300,
                total: 1800,
            });
        });
    });
});
