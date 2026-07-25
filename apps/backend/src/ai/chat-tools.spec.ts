import { StorePermission } from '@erp71/shared-types';
import { CHAT_TOOLS, CHAT_TOOLS_BY_NAME, MAX_TOOL_ROWS, toOpenRouterTools, type ChatToolContext, type ChatToolDeps } from './chat-tools';

const ctx: ChatToolContext = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    userRole: 'OWNER',
    storeId: 'store-1',
    stores: [
        { id: 'store-1', name: 'Gulshan' },
        { id: 'store-2', name: 'Dhanmondi' },
    ],
};

function makeDeps(overrides: Partial<Record<keyof ChatToolDeps, any>> = {}): ChatToolDeps {
    return {
        salesReports: {
            getSalesSummary: jest.fn(),
            getSalesTrend: jest.fn(),
            getSalesBreakdown: jest.fn(),
            getTopMovers: jest.fn(),
            getReturnsAnalysis: jest.fn(),
            getCustomerRetention: jest.fn(),
        },
        inventoryReports: {
            getReorderSuggestions: jest.fn(),
            getInventoryValuation: jest.fn(),
            getStockAging: jest.fn(),
            getShrinkageSummary: jest.fn(),
        },
        purchaseReports: {
            getPurchaseSummary: jest.fn(),
            getPurchaseTrend: jest.fn(),
            getPurchasesByProduct: jest.fn(),
            getPurchasesBySupplier: jest.fn(),
        },
        customers: {
            findAll: jest.fn(),
            getAnalytics: jest.fn(),
            getDueAgingReport: jest.fn(),
            getPurchaseHistory: jest.fn(),
            getSegmentStats: jest.fn(),
        },
        suppliers: { getBillingSummary: jest.fn() },
        expenses: { getSummary: jest.fn() },
        accounting: {
            getProfitLoss: jest.fn(),
            getBalanceSheet: jest.fn(),
            getCashFlow: jest.fn(),
            getTrialBalance: jest.fn(),
            getFinancialRatios: jest.fn(),
            getApAging: jest.fn(),
            getBudgetVsActual: jest.fn(),
            getVatTaxReport: jest.fn(),
        },
        data: {
            resolveEntity: jest.fn(),
            listDocuments: jest.fn(),
            getOpenPipeline: jest.fn(),
            getCashPosition: jest.fn(),
            getWorkforceSummary: jest.fn(),
            getStockMovements: jest.fn(),
            getLoyaltySummary: jest.fn(),
            getDataCoverage: jest.fn(),
        },
        ...overrides,
    } as unknown as ChatToolDeps;
}

const run = (name: string, args: Record<string, any>, deps: ChatToolDeps) =>
    CHAT_TOOLS_BY_NAME[name].handler(ctx, args, deps);

describe('chat tool registry', () => {
    /**
     * Tenant isolation is structural, not prompt-dependent: if a tool ever
     * accepted a tenant id as a model-supplied argument, a hallucinated or
     * injected value could cross tenants. This test is the guard on that.
     */
    it('exposes no tenant-scoping parameter to the model', () => {
        for (const tool of CHAT_TOOLS) {
            const props = Object.keys((tool.parameters as any).properties ?? {});
            for (const prop of props) {
                expect(prop.toLowerCase()).not.toContain('tenant');
            }
        }
    });

    it('gives every tool a permission, a description and a JSON Schema object', () => {
        for (const tool of CHAT_TOOLS) {
            expect(Object.values(StorePermission)).toContain(tool.permission);
            expect(tool.description.length).toBeGreaterThan(40);
            expect((tool.parameters as any).type).toBe('object');
        }
    });

    it('emits unique names in the OpenRouter wire format', () => {
        const wire = toOpenRouterTools(CHAT_TOOLS);
        const names = wire.map((w) => w.function.name);
        expect(new Set(names).size).toBe(names.length);
        expect(wire.every((w) => w.type === 'function')).toBe(true);
    });

    /**
     * Every `required` entry must exist in `properties`. A required parameter
     * with no schema is accepted by the wire format and then rejected by the
     * model provider at call time, which surfaces as a dead tool rather than a
     * validation error anyone can trace.
     */
    it('declares a schema for every required parameter', () => {
        for (const tool of CHAT_TOOLS) {
            const params = tool.parameters as any;
            for (const required of params.required ?? []) {
                expect(Object.keys(params.properties ?? {})).toContain(required);
            }
        }
    });

    it('tags module-specific tools so an accounting-only tenant can be filtered', () => {
        expect(CHAT_TOOLS_BY_NAME.sales_summary.modules).toContain('retail');
        // The general-purpose lookups carry no module and stay available always.
        expect(CHAT_TOOLS_BY_NAME.resolve_entity.modules).toBeUndefined();
    });
});

describe('sales_summary', () => {
    const summaryResult = {
        summary: {
            totalRevenue: 1234.5678,
            totalReturns: 34.5,
            netRevenue: 1200.0678,
            transactionCount: 12,
            avgOrderValue: 102.8806,
            totalCogs: 700.123,
            grossProfit: 499.9448,
            grossMarginPct: 41.6592,
        },
        rows: [{ date: '2026-07-01' }],
    };

    it('passes the tenant id from context, never from args', async () => {
        const getSalesSummary = jest.fn().mockResolvedValue(summaryResult);
        const deps = makeDeps({ salesReports: { getSalesSummary } });

        await run('sales_summary', { from: '2026-07-01', to: '2026-07-31', tenantId: 'other-tenant' }, deps);

        expect(getSalesSummary).toHaveBeenCalledWith('tenant-1', {
            from: '2026-07-01',
            to: '2026-07-31',
            storeId: undefined,
        });
    });

    it('rounds money to 2dp and percentages to 1dp', async () => {
        const deps = makeDeps({ salesReports: { getSalesSummary: jest.fn().mockResolvedValue(summaryResult) } });
        const result: any = await run('sales_summary', { from: '2026-07-01', to: '2026-07-31' }, deps);

        expect(result.totalRevenue).toBe(1234.57);
        expect(result.avgOrderValue).toBe(102.88);
        expect(result.grossMarginPct).toBe(41.7);
    });

    it('forwards a store id that belongs to the tenant', async () => {
        const getSalesSummary = jest.fn().mockResolvedValue(summaryResult);
        const deps = makeDeps({ salesReports: { getSalesSummary } });

        const result: any = await run('sales_summary', { from: '2026-07-01', to: '2026-07-31', storeId: 'store-2' }, deps);

        expect(getSalesSummary).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ storeId: 'store-2' }));
        expect(result.note).toBeUndefined();
    });

    it('drops an unknown store id and tells the model the result is unfiltered', async () => {
        const getSalesSummary = jest.fn().mockResolvedValue(summaryResult);
        const deps = makeDeps({ salesReports: { getSalesSummary } });

        const result: any = await run(
            'sales_summary',
            { from: '2026-07-01', to: '2026-07-31', storeId: 'store-from-another-tenant' },
            deps,
        );

        expect(getSalesSummary).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ storeId: undefined }));
        expect(result.note).toMatch(/Unknown branch id/);
    });

    /**
     * The whole point of compareTo: the prior window is computed by the report
     * layer, so the model never does date arithmetic and never issues a second
     * lookup it might mis-align.
     */
    it('routes a comparison through the trend method in one call', async () => {
        const getSalesSummary = jest.fn();
        const getSalesTrend = jest.fn().mockResolvedValue({
            summary: summaryResult.summary,
            comparison: {
                mode: 'previous_period',
                period: { from: '2026-06-01', to: '2026-06-30' },
                summary: { ...summaryResult.summary, netRevenue: 1000 },
                change: {
                    netRevenue: 200.0678, netRevenuePct: 20.006, transactionCount: 2,
                    transactionCountPct: 20, avgOrderValue: 1, grossProfit: 50, grossProfitPct: 11.11,
                },
            },
        });
        const deps = makeDeps({ salesReports: { getSalesSummary, getSalesTrend } });

        const result: any = await run(
            'sales_summary',
            { from: '2026-07-01', to: '2026-07-31', compareTo: 'previous_period' },
            deps,
        );

        expect(getSalesSummary).not.toHaveBeenCalled();
        expect(getSalesTrend).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ compareTo: 'previous_period' }));
        expect(result.comparison.change.netRevenuePct).toBe(20);
    });

    it('ignores a comparison mode the report layer does not understand', async () => {
        const getSalesSummary = jest.fn().mockResolvedValue(summaryResult);
        const getSalesTrend = jest.fn();
        const deps = makeDeps({ salesReports: { getSalesSummary, getSalesTrend } });

        await run('sales_summary', { from: '2026-07-01', to: '2026-07-31', compareTo: 'last_decade' }, deps);

        expect(getSalesTrend).not.toHaveBeenCalled();
        expect(getSalesSummary).toHaveBeenCalled();
    });
});

describe('sales_breakdown', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
        key: `p${i}`,
        label: `Product ${i}`,
        revenue: (40 - i) * 100,
        revenueSharePct: 1,
        orders: 2,
        units: 40 - i,
        cogs: 0,
        grossProfit: (40 - i) * 100,
        grossMarginPct: 100,
        avgOrderValue: 50,
    }));

    const deps = () =>
        makeDeps({
            salesReports: {
                getSalesBreakdown: jest.fn().mockResolvedValue({
                    period: { from: '2026-07-01', to: '2026-07-31' },
                    groupBy: 'product',
                    revenueBasis: 'sale_line_items',
                    summary: { totalRevenue: 1000, totalOrders: 80, groupCount: 40 },
                    comparison: null,
                    rows,
                }),
            },
        });

    it('caps the row count and flags the truncation', async () => {
        const result: any = await run(
            'sales_breakdown',
            { from: '2026-07-01', to: '2026-07-31', groupBy: 'product', limit: 999 },
            deps(),
        );

        expect(result.rows).toHaveLength(MAX_TOOL_ROWS);
        expect(result.truncated).toBe(true);
        expect(result.totalRows).toBe(40);
        expect(result.hasMore).toBe(true);
    });

    /**
     * Paging is what makes "show me the next 20" work. Without it the model
     * re-runs the same query, gets the same rows, and insists it already
     * answered.
     */
    it('pages past a truncated result with offset', async () => {
        const result: any = await run(
            'sales_breakdown',
            { from: '2026-07-01', to: '2026-07-31', groupBy: 'product', limit: 20, offset: 20 },
            deps(),
        );

        expect(result.offset).toBe(20);
        expect(result.rows).toHaveLength(20);
        expect(result.rows[0].name).toBe('Product 20');
        expect(result.hasMore).toBe(false);
    });

    it('projects rows down to scalar fields instead of whole Prisma entities', async () => {
        const result: any = await run(
            'sales_breakdown',
            { from: '2026-07-01', to: '2026-07-31', groupBy: 'product', limit: 1 },
            deps(),
        );

        expect(Object.keys(result.rows[0]).sort()).toEqual(
            ['grossMarginPct', 'grossProfit', 'name', 'orders', 'revenue', 'revenueSharePct', 'unitsSold'].sort(),
        );
    });

    /**
     * Line-item and invoice totals do not agree when invoices carry discounts.
     * Telling the model which basis produced a figure is what stops it
     * presenting two incompatible numbers as a contradiction.
     */
    it('states the revenue basis so incompatible figures are not compared', async () => {
        const result: any = await run(
            'sales_breakdown',
            { from: '2026-07-01', to: '2026-07-31', groupBy: 'product' },
            deps(),
        );

        expect(result.basisNote).toMatch(/sale lines/i);
    });

    it('omits comparison fields entirely when no comparison was requested', async () => {
        const result: any = await run(
            'sales_breakdown',
            { from: '2026-07-01', to: '2026-07-31', groupBy: 'product', limit: 1 },
            deps(),
        );

        expect(result.rows[0]).not.toHaveProperty('previousRevenue');
        expect(result).not.toHaveProperty('comparisonPeriod');
    });
});

describe('top_movers', () => {
    it('returns gainers and decliners with the totals they roll up to', async () => {
        const getTopMovers = jest.fn().mockResolvedValue({
            period: { from: '2026-07-01', to: '2026-07-31' },
            comparisonPeriod: { from: '2026-06-01', to: '2026-06-30' },
            dimension: 'product',
            totals: { revenue: 900, previousRevenue: 1000, revenueChange: -100, revenueChangePct: -10 },
            gainers: [{ label: 'Rice', revenue: 300, previousRevenue: 100, revenueChange: 200, revenueChangePct: 200, status: 'continuing' }],
            decliners: [{ label: 'Oil', revenue: 100, previousRevenue: 400, revenueChange: -300, revenueChangePct: -75, status: 'continuing' }],
        });
        const deps = makeDeps({ salesReports: { getTopMovers } });

        const result: any = await run('top_movers', { from: '2026-07-01', to: '2026-07-31' }, deps);

        expect(result.totals.revenueChangePct).toBe(-10);
        expect(result.gainers[0].name).toBe('Rice');
        expect(result.decliners[0].revenueChange).toBe(-300);
    });

    it('bounds the requested limit rather than passing it through', async () => {
        const getTopMovers = jest.fn().mockResolvedValue({
            period: {}, comparisonPeriod: {}, dimension: 'product',
            totals: { revenue: 0, previousRevenue: 0, revenueChange: 0, revenueChangePct: null },
            gainers: [], decliners: [],
        });
        const deps = makeDeps({ salesReports: { getTopMovers } });

        await run('top_movers', { from: 'a', to: 'b', limit: 5000 }, deps);

        expect(getTopMovers).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ limit: 20 }));
    });
});

describe('low_stock', () => {
    it('returns only products needing a reorder, worst shortfall first', async () => {
        const deps = makeDeps({
            inventoryReports: {
                getReorderSuggestions: jest.fn().mockResolvedValue([
                    { product: { name: 'A' }, onHand: 1, inTransit: 0, targetStock: 5, suggestedQuantity: 4 },
                    { product: { name: 'B' }, onHand: 0, inTransit: 0, targetStock: 20, suggestedQuantity: 20 },
                    { product: { name: 'C' }, onHand: 9, inTransit: 0, targetStock: null, suggestedQuantity: 0 },
                ]),
            },
        });

        const result: any = await run('low_stock', {}, deps);

        expect(result.rows.map((r: any) => r.product)).toEqual(['B', 'A']);
        expect(result.productsWithoutStockPolicy).toBe(1);
    });
});

describe('stock_aging', () => {
    it('separates never-sold stock from merely stale stock', async () => {
        const deps = makeDeps({
            inventoryReports: {
                getStockAging: jest.fn().mockResolvedValue({
                    summary: {
                        slowMovingAfterDays: 60,
                        productsInStock: 3,
                        totalStockValue: 10000.456,
                        slowMovingProducts: 2,
                        slowMovingValue: 7000.123,
                        slowMovingShareOfValuePct: 70.0012,
                        neverSoldProducts: 1,
                        valuationBasis: 'CURRENT_SELLING_PRICE',
                    },
                    buckets: [{ bucket: 'never_sold', label: 'Never sold', productCount: 1, quantity: 5, stockValue: 5000 }],
                    rows: [
                        { product: { name: 'Dead SKU', group: null }, quantity: 5, stockValue: 5000, daysSinceLastSale: null, lastSoldAt: null },
                        { product: { name: 'Slow SKU', group: null }, quantity: 2, stockValue: 2000, daysSinceLastSale: 120, lastSoldAt: '2026-03-27' },
                    ],
                }),
            },
        });

        const result: any = await run('stock_aging', {}, deps);

        expect(result.neverSoldProducts).toBe(1);
        expect(result.slowMovingValue).toBe(7000.12);
        expect(result.slowMovingShareOfValuePct).toBe(70);
        expect(result.rows[0].daysSinceLastSale).toBeNull();
        expect(result.valuationNote).toMatch(/selling price/);
    });
});

describe('customer_lookup', () => {
    it('reports no match without calling analytics', async () => {
        const getAnalytics = jest.fn();
        const deps = makeDeps({
            customers: { findAll: jest.fn().mockResolvedValue({ items: [] }), getAnalytics },
        });

        const result: any = await run('customer_lookup', { search: 'nobody' }, deps);

        expect(result.matchCount).toBe(0);
        expect(getAnalytics).not.toHaveBeenCalled();
    });

    it('merges analytics onto each match and formats the last purchase date', async () => {
        const deps = makeDeps({
            customers: {
                findAll: jest.fn().mockResolvedValue({ items: [{ id: 'c1', name: 'Karim Traders', phone: '01700000000' }] }),
                getAnalytics: jest.fn().mockResolvedValue({
                    total_spent: 5000.555,
                    order_count: 8,
                    avg_order_value: 625.069,
                    due_balance: 1200.4,
                    loyalty_points: 30,
                    segment: 'REGULAR',
                    last_purchase_date: new Date('2026-07-10T09:00:00Z'),
                    days_since_last_purchase: 11,
                }),
            },
        });

        const result: any = await run('customer_lookup', { search: 'Karim' }, deps);

        expect(result.rows[0]).toMatchObject({
            name: 'Karim Traders',
            totalSpent: 5000.56,
            dueBalance: 1200.4,
            lastPurchaseDate: '2026-07-10',
        });
    });
});

describe('receivables_aging', () => {
    it('totals the buckets across customers and ranks by amount owed', async () => {
        const deps = makeDeps({
            customers: {
                getDueAgingReport: jest.fn().mockResolvedValue([
                    {
                        customer: { name: 'Small', phone: '1' },
                        bucket_0_30: 100, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0, total: 100,
                    },
                    {
                        customer: { name: 'Big', phone: '2' },
                        bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 900, total: 900,
                    },
                ]),
            },
        });

        const result: any = await run('receivables_aging', {}, deps);

        expect(result.totalOutstanding).toBe(1000);
        expect(result.buckets.days_90_plus).toBe(900);
        expect(result.rows.map((r: any) => r.customer)).toEqual(['Big', 'Small']);
    });
});

describe('payables_aging', () => {
    it('reports money owed to suppliers, aged, from the ledger', async () => {
        const deps = makeDeps({
            accounting: {
                getApAging: jest.fn().mockResolvedValue({
                    as_of: '2026-07-25',
                    totals: { balance: 5000.126, current: 3000, overdue_31_60: 1000, overdue_61_90: 500, overdue_90_plus: 500 },
                    accounts: [{
                        name: 'Accounts Payable',
                        balance: 5000.126,
                        buckets: { current: 3000, overdue_31_60: 1000, overdue_61_90: 500, overdue_90_plus: 500 },
                    }],
                    note: 'Aging is based on voucher date.',
                }),
            },
        });

        const result: any = await run('payables_aging', {}, deps);

        expect(result.totalOwed).toBe(5000.13);
        expect(result.buckets.days_90_plus).toBe(500);
        expect(result.rows[0].account).toBe('Accounts Payable');
    });
});

describe('financial_statement', () => {
    it("passes the caller's consolidated-access flag through to the ledger", async () => {
        const getProfitLoss = jest.fn().mockResolvedValue({
            filters: { from: '2026-07-01', to: '2026-07-31' },
            revenue: { total: 1000, groups: [] },
            expenses: { total: 400, groups: [] },
            net_profit: 600,
        });
        const deps = makeDeps({ accounting: { getProfitLoss } });

        await CHAT_TOOLS_BY_NAME.financial_statement.handler(
            { ...ctx, hasConsolidatedAccess: true },
            { statement: 'profit_loss', from: '2026-07-01', to: '2026-07-31' },
            deps,
        );

        expect(getProfitLoss).toHaveBeenCalledWith('tenant-1', expect.any(Object), true);
    });

    it('defaults to a non-consolidated scope when the caller lacks that permission', async () => {
        const getBalanceSheet = jest.fn().mockResolvedValue({
            as_of: '2026-07-25',
            assets: { total: 1, groups: [] },
            liabilities: { total: 0, groups: [] },
            equity: { total: 1, net_profit: 0, groups: [] },
            is_balanced: true,
        });
        const deps = makeDeps({ accounting: { getBalanceSheet } });

        await run('financial_statement', { statement: 'balance_sheet' }, deps);

        expect(getBalanceSheet).toHaveBeenCalledWith('tenant-1', expect.any(Object), false);
    });

    it('computes a net margin only when there is revenue to divide by', async () => {
        const deps = makeDeps({
            accounting: {
                getProfitLoss: jest.fn().mockResolvedValue({
                    filters: {}, revenue: { total: 0, groups: [] }, expenses: { total: 500, groups: [] }, net_profit: -500,
                }),
            },
        });

        const result: any = await run('financial_statement', { statement: 'profit_loss' }, deps);

        expect(result.netMarginPct).toBeNull();
        expect(result.netProfit).toBe(-500);
    });
});

describe('budget_vs_actual', () => {
    it('says a budget was never set rather than reporting a zero variance', async () => {
        const deps = makeDeps({
            accounting: {
                getBudgetVsActual: jest.fn().mockResolvedValue({
                    fiscal_year: 2026, month: null, rows: [], totals: { budget: 0, actual: 0, variance: 0 },
                }),
            },
        });

        const result: any = await run('budget_vs_actual', { fiscalYear: 2026 }, deps);

        expect(result.rows).toEqual([]);
        expect(result.note).toMatch(/No budget has been set/);
    });

    it('ranks the worst overspend first', async () => {
        const deps = makeDeps({
            accounting: {
                getBudgetVsActual: jest.fn().mockResolvedValue({
                    fiscal_year: 2026,
                    month: 7,
                    totals: { budget: 1000, actual: 1400, variance: -400 },
                    rows: [
                        { account: { name: 'Rent' }, budget: 500, actual: 500, variance: 0 },
                        { account: { name: 'Fuel' }, budget: 500, actual: 900, variance: -400 },
                    ],
                }),
            },
        });

        const result: any = await run('budget_vs_actual', { fiscalYear: 2026, month: 7 }, deps);

        expect(result.rows[0].account).toBe('Fuel');
    });
});

describe('resolve_entity', () => {
    /**
     * The failure this prevents: with no way to look an id up, the model's next
     * best move is to invent a plausible uuid, which the product and warehouse
     * filters accept silently.
     */
    it('tells the model not to guess when nothing matched', async () => {
        const deps = makeDeps({ data: { resolveEntity: jest.fn().mockResolvedValue([]) } });

        const result: any = await run('resolve_entity', { type: 'product', query: 'nonexistent' }, deps);

        expect(result.matchCount).toBe(0);
        expect(result.note).toMatch(/Do not guess an id/);
    });

    it('flags ambiguity instead of silently picking the first match', async () => {
        const deps = makeDeps({
            data: {
                resolveEntity: jest.fn().mockResolvedValue([
                    { id: 'p1', label: 'Rice 5kg', detail: 'SKU-1' },
                    { id: 'p2', label: 'Rice 10kg', detail: 'SKU-2' },
                ]),
            },
        });

        const result: any = await run('resolve_entity', { type: 'product', query: 'rice' }, deps);

        expect(result.matchCount).toBe(2);
        expect(result.note).toMatch(/More than one match/);
        expect(result.rows.map((r: any) => r.id)).toEqual(['p1', 'p2']);
    });

    it('scopes the lookup to the context tenant', async () => {
        const resolveEntity = jest.fn().mockResolvedValue([]);
        const deps = makeDeps({ data: { resolveEntity } });

        await run('resolve_entity', { type: 'customer', query: 'Karim', tenantId: 'other' }, deps);

        expect(resolveEntity).toHaveBeenCalledWith('tenant-1', 'customer', 'Karim', 10);
    });
});

describe('list_documents', () => {
    it('warns when the fetch limit was hit so a list is not read as complete', async () => {
        const rows = Array.from({ length: 100 }, (_, i) => ({
            number: `INV-${i}`, date: '2026-07-01', party: 'X', branch: 'Gulshan', amount: 10, outstanding: 0, status: 'COMPLETED',
        }));
        const deps = makeDeps({ data: { listDocuments: jest.fn().mockResolvedValue(rows) } });

        const result: any = await run('list_documents', { type: 'sale' }, deps);

        expect(result.fetchLimitNote).toMatch(/100-document fetch limit/);
        expect(result.rows).toHaveLength(MAX_TOOL_ROWS);
    });

    it('leaves the warning off when everything fitted', async () => {
        const deps = makeDeps({
            data: {
                listDocuments: jest.fn().mockResolvedValue([
                    { number: 'INV-1', date: '2026-07-01', party: 'Karim', branch: 'Gulshan', amount: 500.126, outstanding: 100 },
                ]),
            },
        });

        const result: any = await run('list_documents', { type: 'sale' }, deps);

        expect(result.fetchLimitNote).toBeNull();
        expect(result.rows[0].amount).toBe(500.13);
    });
});

describe('open_pipeline', () => {
    it('reports committed-but-unfinished work with its value', async () => {
        const deps = makeDeps({
            data: {
                getOpenPipeline: jest.fn().mockResolvedValue({
                    kind: 'purchase_orders',
                    openCount: 3,
                    totalValue: 45000.456,
                    byStatus: { SENT: 2, DRAFT: 1 },
                    rows: [{ id: 'po1', label: 'PO-1 · Acme', status: 'SENT', amount: 20000, dueDate: '2026-08-01', detail: null }],
                }),
            },
        });

        const result: any = await run('open_pipeline', { kind: 'purchase_orders' }, deps);

        expect(result.openCount).toBe(3);
        expect(result.totalValue).toBe(45000.46);
        expect(result.byStatus).toEqual({ SENT: 2, DRAFT: 1 });
    });

    it('keeps a null value null rather than reporting ৳0', async () => {
        const deps = makeDeps({
            data: {
                getOpenPipeline: jest.fn().mockResolvedValue({
                    kind: 'leads', openCount: 4, totalValue: null, byStatus: { NEW: 4 },
                    rows: [{ id: 'l1', label: 'Walk-in', status: 'NEW', amount: null, dueDate: null, detail: 'Call back' }],
                }),
            },
        });

        const result: any = await run('open_pipeline', { kind: 'leads' }, deps);

        expect(result.totalValue).toBeNull();
        expect(result.rows[0].amount).toBeNull();
    });
});
