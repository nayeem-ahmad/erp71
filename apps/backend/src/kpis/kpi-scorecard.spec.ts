import { KPI_IDS } from '@erp71/shared-types';
import { TenantKpiService } from './tenant-kpi.service';
import { PlatformKpiService } from './platform-kpi.service';

/**
 * Assembly of the two scorecards: every KPI present in order, the ones that
 * cannot be computed marked as planned or not applicable, and the customer
 * KPIs reading the right windows. The formulas themselves are covered in
 * `kpi-math.spec.ts`.
 */

const ratios = (overrides: Record<string, number | null> = {}) => ({
    ratios: {
        net_profit_margin_pct: 12.5,
        net_profit: 2500,
        revenue: 20000,
        dso_days: 18,
        credit_sales: 5000,
        period_days: 30,
        ...overrides,
    },
});

const cash = (overrides: Record<string, number> = {}) => ({
    operating: 4000,
    investing: -1000,
    financing: 0,
    net: 3000,
    opening_cash_balance: 10000,
    closing_cash_balance: 13000,
    ...overrides,
});

function accountingMock() {
    return {
        getFinancialRatios: jest.fn().mockResolvedValue(ratios()),
        getCashMovements: jest.fn().mockResolvedValue(cash()),
        getPendingVoucherCount: jest.fn().mockResolvedValue({ count: 2, approvalEnabled: true }),
    };
}

/** Customer ids who bought in a window, keyed by the window's `gte` date. */
function groupByFor(buyers: Record<string, Array<[string, number]>>) {
    return jest.fn(({ where, _min }: any) => {
        if (_min) {
            return Promise.resolve([
                { customer_id: 'a', _min: { sale_date: new Date('2025-04-01') }, _max: { sale_date: new Date('2026-04-20') } },
            ]);
        }
        const from = where.sale_date?.gte?.toISOString().slice(0, 10);
        return Promise.resolve((buyers[from] ?? []).map(([customer_id, amount]) => ({ customer_id, _sum: { total_amount: amount } })));
    });
}

describe('TenantKpiService.getScorecard', () => {
    function build(buyers: Record<string, Array<[string, number]>> = {}) {
        const db = {
            sale: { findMany: jest.fn().mockResolvedValue([]), groupBy: groupByFor(buyers) },
            salesReturn: { findMany: jest.fn().mockResolvedValue([]) },
            salesExchange: { findMany: jest.fn().mockResolvedValue([]) },
            lead: {
                findMany: jest.fn().mockResolvedValue([
                    { created_at: new Date('2026-04-01T00:00:00Z'), closed_at: new Date('2026-04-11T00:00:00Z') },
                ]),
            },
            employee: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const accounting = accountingMock();
        return { service: new TenantKpiService(db as any, accounting as any), db, accounting };
    }

    it('returns all eighteen KPIs in order, with the SaaS-only and not-yet-recorded ones marked', async () => {
        const { service } = build();
        const card = await service.getScorecard('t1', { from: '2026-04-01', to: '2026-04-30' }, undefined, 'Asia/Dhaka');

        expect(card.kpis.map((k) => k.id)).toEqual([...KPI_IDS]);
        const byId = Object.fromEntries(card.kpis.map((k) => [k.id, k]));
        expect(byId.burn_multiple.status).toBe('not_applicable');
        expect(byId.quick_ratio.status).toBe('not_applicable');
        expect(byId.customer_acquisition_cost).toMatchObject({ status: 'planned', phase: 3, needs: 'expense_classification' });
        expect(byId.net_promoter_score).toMatchObject({ status: 'planned', phase: 4 });
        expect(card.previousPeriod).toEqual({ from: '2026-03-02', to: '2026-03-31' });
        expect(card.unpostedVouchers).toBe(2);
    });

    it('reads net margin, DSO and operating cash flow from the books', async () => {
        const { service } = build();
        const card = await service.getScorecard('t1', { from: '2026-04-01', to: '2026-04-30' }, undefined, 'Asia/Dhaka');
        const byId = Object.fromEntries(card.kpis.map((k) => [k.id, k]));

        expect(byId.net_profit_margin).toMatchObject({ status: 'ok', value: 12.5, notes: ['ledger_based'] });
        expect(byId.days_sales_outstanding.value).toBe(18);
        expect(byId.operating_cash_flow.value).toBe(4000);
        // Cash grew over the trailing window, so there is no burn to divide by.
        expect(byId.cash_runway).toMatchObject({ status: 'ok', value: null });
        expect(byId.cash_runway.notes).toContain('cash_positive');
        expect(byId.sales_cycle_length.value).toBe(10);
    });

    it('measures churn and retention on named customers', async () => {
        const { service } = build({
            // The 90 days before the period: a, b and c were buying.
            '2026-01-01': [['a', 100], ['b', 100], ['c', 100]],
            // The 90 days ending with the period: only a and b.
            '2026-01-31': [['a', 100], ['b', 100]],
            // Last period a and b spent 1,000 each; this period only a, 1,500.
            '2026-03-02': [['a', 1000], ['b', 1000]],
            '2026-04-01': [['a', 1500]],
        });
        const card = await service.getScorecard('t1', { from: '2026-04-01', to: '2026-04-30' }, undefined, 'Asia/Dhaka');
        const byId = Object.fromEntries(card.kpis.map((k) => [k.id, k]));

        expect(byId.churn_rate).toMatchObject({ value: 33.3, basis: { lostCustomers: 1, startingCustomers: 3 } });
        expect(byId.net_revenue_retention.value).toBe(75);
        expect(byId.avg_revenue_per_account.value).toBe(1500);
        expect(byId.churn_rate.notes).toEqual(['named_customers_only', 'lapse_after_90_days']);
    });

    it('marks a KPI with nothing to divide by as no data rather than zero', async () => {
        const { service } = build();
        const card = await service.getScorecard('t1', { from: '2026-04-01', to: '2026-04-30' }, undefined, 'Asia/Dhaka');
        const byId = Object.fromEntries(card.kpis.map((k) => [k.id, k]));

        expect(byId.revenue_growth).toMatchObject({ status: 'no_data', value: null });
        expect(byId.churn_rate).toMatchObject({ status: 'no_data', value: null });
        expect(byId.employee_turnover).toMatchObject({ status: 'no_data', value: null });
    });

    it('passes the branch to every source', async () => {
        const { service, db, accounting } = build();
        await service.getScorecard('t1', { from: '2026-04-01', to: '2026-04-30' }, 'store-1', 'Asia/Dhaka');

        expect(accounting.getFinancialRatios).toHaveBeenCalledWith('t1', expect.anything(), 'store-1');
        expect(accounting.getCashMovements).toHaveBeenCalledWith('t1', expect.anything(), 'store-1');
        expect(db.sale.groupBy.mock.calls[0][0].where.store_id).toBe('store-1');
        expect(db.lead.findMany.mock.calls[0][0].where.store_id).toBe('store-1');
        expect(db.employee.findMany.mock.calls[0][0].where.store_id).toBe('store-1');
    });
});

describe('PlatformKpiService.getScorecard', () => {
    // Three MRR days: before the previous period (Mar 2), before this one (Mar 31), and Apr 30.
    const MRR_DAYS: Record<string, Map<string, number>> = {
        '2026-03-01': new Map([['a', 1000], ['b', 1000]]),
        '2026-03-31': new Map([['a', 1000], ['b', 1000], ['c', 500]]),
        '2026-04-30': new Map([['a', 1500], ['b', 0], ['c', 500], ['d', 2000]]),
    };

    function build({
        workspace = { id: 'platform-ws' } as { id: string } | null,
        booksOn = true,
        historyFrom = '2026-01-01',
        netCash = 3000,
    } = {}) {
        const db = {
            tenantSubscription: {
                findMany: jest.fn().mockResolvedValue([
                    { activated_at: new Date('2026-04-15T00:00:00Z'), tenant: { created_at: new Date('2026-04-01T00:00:00Z') } },
                ]),
            },
            employee: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const accounting = accountingMock();
        accounting.getFinancialRatios
            .mockResolvedValueOnce(ratios({ revenue: 30000 }))
            .mockResolvedValueOnce(ratios({ revenue: 20000 }));
        const settings = { isFeatureEnabled: jest.fn().mockResolvedValue(booksOn) };
        accounting.getCashMovements.mockResolvedValue(cash({ net: netCash }));
        const ws = { find: jest.fn().mockResolvedValue(workspace) };
        const mrr = {
            mrrOn: jest.fn(async (day: string) => (day < historyFrom
                ? { covered: false, byTenant: new Map() }
                : { covered: true, byTenant: MRR_DAYS[day] ?? new Map() })),
            paidOnOrBefore: jest.fn(async () => new Set(['a', 'b'])),
        };
        return {
            service: new PlatformKpiService(db as any, accounting as any, settings as any, ws as any, mrr as any),
            accounting,
            mrr,
        };
    }

    it('reads the money KPIs from the platform books', async () => {
        const { service, accounting } = build();
        const card = await service.getScorecard({ from: '2026-04-01', to: '2026-04-30' });
        const byId = Object.fromEntries(card.kpis.map((k) => [k.id, k]));

        expect(accounting.getFinancialRatios).toHaveBeenCalledWith('platform-ws', expect.anything());
        expect(byId.revenue_growth.value).toBe(50);
        expect(byId.sales_cycle_length).toMatchObject({ value: 14, notes: ['signup_to_activation'] });
        expect(card.kpis.filter((k) => k.status === 'planned').map((k) => k.id)).toEqual([
            'gross_margin', 'customer_acquisition_cost', 'customer_lifetime_value', 'ltv_to_cac', 'net_promoter_score', 'ebitda',
        ]);
    });

    it('computes the subscription KPIs from MRR on the day before the period and its last day', async () => {
        const { service, mrr } = build({ netCash: -9000 });
        const card = await service.getScorecard({ from: '2026-04-01', to: '2026-04-30' });
        const byId = Object.fromEntries(card.kpis.map((k) => [k.id, k]));

        expect(mrr.mrrOn).toHaveBeenCalledWith('2026-03-31');
        expect(mrr.mrrOn).toHaveBeenCalledWith('2026-04-30');
        // Start ৳2,500 over a, b, c. b churned (৳1,000), a expanded (৳500), d is new (৳2,000).
        expect(byId.churn_rate).toMatchObject({ status: 'ok', value: 33.3, notes: ['subscription_mrr'] });
        expect(byId.net_revenue_retention.value).toBe(80);
        expect(byId.avg_revenue_per_account.value).toBe(1333.33);
        // (2,000 new + 500 expansion) / 1,000 churned.
        expect(byId.quick_ratio.value).toBe(2.5);
        // ৳9,000 burned for (4,000 − 2,500) × 12 = ৳18,000 of net new ARR.
        expect(byId.burn_multiple).toMatchObject({ status: 'ok', value: 0.5, basis: { netBurn: 9000, netNewArr: 18000 } });
        // Last period: c joined, nobody left.
        expect(byId.churn_rate.previous).toBe(0);
    });

    it('says when the platform is not burning cash instead of a burn multiple', async () => {
        const { service } = build({ netCash: 5000 });
        const card = await service.getScorecard({ from: '2026-04-01', to: '2026-04-30' });
        const burn = card.kpis.find((k) => k.id === 'burn_multiple')!;

        expect(burn).toMatchObject({ status: 'ok', value: null });
        expect(burn.notes).toContain('not_burning');
    });

    it('marks the subscription KPIs as short of history before the first snapshot', async () => {
        const { service } = build({ historyFrom: '2026-04-15' });
        const card = await service.getScorecard({ from: '2026-04-01', to: '2026-04-30' });
        const churn = card.kpis.find((k) => k.id === 'churn_rate')!;

        expect(churn).toMatchObject({ status: 'no_data', notes: ['mrr_history_short'] });
    });

    it('says the books are unavailable when platform accounting is off', async () => {
        const { service, accounting } = build({ booksOn: false });
        const card = await service.getScorecard({ from: '2026-04-01', to: '2026-04-30' });
        const byId = Object.fromEntries(card.kpis.map((k) => [k.id, k]));

        expect(accounting.getFinancialRatios).not.toHaveBeenCalled();
        expect(byId.net_profit_margin).toMatchObject({ status: 'no_data', notes: ['books_unavailable'] });
        expect(byId.sales_cycle_length.status).toBe('ok');
    });
});
