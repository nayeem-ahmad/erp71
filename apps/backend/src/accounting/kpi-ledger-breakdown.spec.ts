import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { AccountType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

/**
 * The ledger breakdown behind gross margin, CAC and EBITDA on the KPI
 * scorecard: expenses summed by KPI class, set by hand or guessed from the
 * account and its parents.
 */
const account = (id: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({
    id, name, code: null, type, kpi_class: null, group: { name: 'Operating Expenses' }, subgroup: null, ...extra,
});

const accounts = [
    account('sales', 'Sales Revenue', AccountType.REVENUE, { group: { name: 'Revenue' } }),
    account('purchases', 'Purchases', AccountType.EXPENSE, { subgroup: { name: 'Cost of Sales' } }),
    account('ads', 'Facebook Ads', AccountType.EXPENSE, { kpi_class: 'sales_marketing' }),
    account('dep', 'Depreciation Expense', AccountType.EXPENSE),
    account('rent', 'Rent', AccountType.EXPENSE),
    // Named like depreciation, but switched off by hand.
    account('odd', 'Depreciation Adjustment', AccountType.EXPENSE, { kpi_class: 'operating' }),
];

const lines = [
    { account_id: 'sales', debit_amount: 0, credit_amount: 50000 },
    { account_id: 'purchases', debit_amount: 20000, credit_amount: 0 },
    { account_id: 'ads', debit_amount: 3000, credit_amount: 0 },
    { account_id: 'dep', debit_amount: 1000, credit_amount: 0 },
    { account_id: 'rent', debit_amount: 5000, credit_amount: 0 },
    { account_id: 'odd', debit_amount: 400, credit_amount: 0 },
];

describe('getKpiLedgerBreakdown', () => {
    let service: AccountingService;
    const db = {
        account: { findMany: jest.fn() },
        voucherDetail: { findMany: jest.fn() },
        accountingSettings: { findUnique: jest.fn() },
    };

    beforeEach(async () => {
        jest.resetAllMocks();
        db.accountingSettings.findUnique.mockResolvedValue(null);
        db.account.findMany.mockResolvedValue(accounts);
        db.voucherDetail.findMany.mockResolvedValue(lines);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => any) => fn() } },
            ],
        }).compile();
        service = module.get(AccountingService);
    });

    it('sums expenses by KPI class, by hand or by name and parent', async () => {
        const result = await service.getKpiLedgerBreakdown('t1', { from: '2026-04-01', to: '2026-04-30' });

        expect(result).toMatchObject({ revenue: 50000, expenses: 29400, net_profit: 20600 });
        expect(result.by_class).toEqual({
            cost_of_sales: 20000,
            sales_marketing: 3000,
            interest: 0,
            tax: 0,
            depreciation: 1000,
            amortization: 0,
        });
        expect(result.accounts_by_class.sales_marketing).toBe(1);
        expect(result.accounts_by_class.interest).toBe(0);
    });

    it('narrows to one branch when asked', async () => {
        await service.getKpiLedgerBreakdown('t1', { from: '2026-04-01', to: '2026-04-30' }, 'store-1');
        expect(db.voucherDetail.findMany.mock.calls[0][0].where.voucher.store_id).toBe('store-1');
    });
});
