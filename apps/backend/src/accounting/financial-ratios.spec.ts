import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { AccountCategory, AccountType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

/**
 * Two bugs this guards against:
 *
 * 1. Gross margin was `net profit / revenue`, the same figure as net margin
 *    printed twice. It now comes from the cost stamped on each sold line, as
 *    in the sales gross-profit reports.
 * 2. DSO was `receivables / all revenue × 30`. Cash sales never sit in
 *    receivables, so a mostly-cash shop looked like it collected in a day, and
 *    a 90-day period was still multiplied by 30. It is now
 *    `receivables / credit sales × days in the period`.
 */

const accounts = [
    { id: 'cash', name: 'Cash', code: '1101', type: AccountType.ASSET, category: AccountCategory.CASH },
    { id: 'ar', name: 'Accounts Receivable', code: '1201', type: AccountType.ASSET, category: AccountCategory.GENERAL },
    { id: 'sales', name: 'Sales Revenue', code: '4101', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
    { id: 'rent', name: 'Rent', code: '5101', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
];

// April (30 days): ৳9,000 cash sales, ৳3,000 on credit of which ৳1,000 was
// collected, ৳6,000 rent. Net profit ৳6,000 on ৳12,000 revenue = 50%.
const lines = [
    { account_id: 'cash', debit_amount: 9000, credit_amount: 0 },
    { account_id: 'sales', debit_amount: 0, credit_amount: 9000 },
    { account_id: 'ar', debit_amount: 3000, credit_amount: 0 },
    { account_id: 'sales', debit_amount: 0, credit_amount: 3000 },
    { account_id: 'cash', debit_amount: 1000, credit_amount: 0 },
    { account_id: 'ar', debit_amount: 0, credit_amount: 1000 },
    { account_id: 'rent', debit_amount: 6000, credit_amount: 0 },
    { account_id: 'cash', debit_amount: 0, credit_amount: 6000 },
];

// One sale: 10 units at ৳100 list, cost ৳60 each, so 40% gross margin.
const sale = {
    id: 's1',
    total_amount: 1000,
    sale_date: new Date('2026-04-10T05:00:00Z'),
    customer_id: null,
    items: [{ product_id: 'p1', quantity: 10, price_at_sale: 100, unit_cost_at_sale: 60 }],
};

describe('getFinancialRatios', () => {
    let service: AccountingService;

    const db = {
        account: { findMany: jest.fn() },
        voucherDetail: { findMany: jest.fn() },
        accountingSettings: { findUnique: jest.fn() },
        sale: { findMany: jest.fn() },
        salesReturn: { findMany: jest.fn() },
        salesExchange: { findMany: jest.fn() },
    };

    beforeEach(async () => {
        jest.resetAllMocks();
        db.accountingSettings.findUnique.mockResolvedValue(null);
        db.account.findMany.mockResolvedValue(accounts);
        db.voucherDetail.findMany.mockResolvedValue(lines);
        db.sale.findMany.mockResolvedValue([sale]);
        db.salesReturn.findMany.mockResolvedValue([]);
        db.salesExchange.findMany.mockResolvedValue([]);

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

    it('states gross margin from the cost of the goods sold, not from net profit', async () => {
        const { ratios } = await service.getFinancialRatios('t1', { from: '2026-04-01', to: '2026-04-30', asOfDate: '2026-04-30' });

        expect(ratios.net_profit_margin_pct).toBe(50);
        expect(ratios.gross_margin_pct).toBe(40);
        expect(ratios.gross_margin_coverage_pct).toBe(100);
    });

    it('measures DSO against credit sales over the days in the period', async () => {
        const { ratios } = await service.getFinancialRatios('t1', { from: '2026-04-01', to: '2026-04-30', asOfDate: '2026-04-30' });

        // ৳2,000 still owed of ৳3,000 billed on credit, over 30 days.
        expect(ratios.credit_sales).toBe(3000);
        expect(ratios.period_days).toBe(30);
        expect(ratios.dso_days).toBe(20);
    });

    it('has no gross margin when nothing sold has a cost', async () => {
        db.sale.findMany.mockResolvedValue([{ ...sale, items: [{ ...sale.items[0], unit_cost_at_sale: null }] }]);
        const { ratios } = await service.getFinancialRatios('t1', { from: '2026-04-01', to: '2026-04-30' });

        expect(ratios.gross_margin_pct).toBeNull();
    });
});
