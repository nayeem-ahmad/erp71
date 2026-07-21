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
            getSalesByProduct: jest.fn(),
        },
        inventoryReports: {
            getReorderSuggestions: jest.fn(),
            getInventoryValuation: jest.fn(),
        },
        purchaseReports: { getPurchaseSummary: jest.fn() },
        customers: { findAll: jest.fn(), getAnalytics: jest.fn(), getDueAgingReport: jest.fn() },
        expenses: { getSummary: jest.fn() },
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
});

describe('top_products', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
        product: { name: `Product ${i}`, group: { name: 'Group A' } },
        unitsSold: 40 - i,
        revenue: (40 - i) * 100,
        cogs: 0,
        revenueShare: 1,
        grossProfit: (40 - i) * 100,
        grossMarginPct: 100,
    }));
    const deps = () =>
        makeDeps({
            salesReports: {
                getSalesByProduct: jest.fn().mockResolvedValue({
                    summary: { totalRevenue: 1000, totalUnitsSold: 100, productCount: 40 },
                    rows,
                }),
            },
        });

    it('caps the row count and flags the truncation', async () => {
        const result: any = await run('top_products', { from: '2026-07-01', to: '2026-07-31', limit: 999 }, deps());

        expect(result.rows).toHaveLength(MAX_TOOL_ROWS);
        expect(result.truncated).toBe(true);
        expect(result.totalRows).toBe(40);
    });

    it('projects rows down to scalar fields instead of whole Prisma entities', async () => {
        const result: any = await run('top_products', { from: '2026-07-01', to: '2026-07-31', limit: 1 }, deps());

        expect(Object.keys(result.rows[0]).sort()).toEqual(
            ['grossMarginPct', 'grossProfit', 'group', 'product', 'revenue', 'revenueSharePct', 'unitsSold'].sort(),
        );
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
