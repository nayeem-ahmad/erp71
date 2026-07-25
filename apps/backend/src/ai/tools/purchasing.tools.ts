import { StorePermission } from '@erp71/shared-types';
import {
    asComparison,
    COMPARE_PROP,
    DATE_RANGE_PROPS,
    money,
    page,
    PAGING_PROPS,
    pct,
    resolveStoreId,
    STORE_PROP,
    type ChatTool,
} from './types';

export const PURCHASING_TOOLS: ChatTool[] = [
    {
        name: 'purchase_summary',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail', 'inventory'],
        description:
            'Total purchases from suppliers for a date range: gross purchases, purchase returns, net purchases, order ' +
            'count and average order value. Use for procurement and supplier spend questions. ' +
            'Pass compareTo to get the change against a prior period in the same call.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...STORE_PROP, ...COMPARE_PROP },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const compareTo = asComparison(args.compareTo);

            if (!compareTo) {
                const result = await deps.purchaseReports.getPurchaseSummary(ctx.tenantId, {
                    from: args.from,
                    to: args.to,
                    storeId,
                });
                return {
                    ...(note ? { note } : {}),
                    period: { from: args.from, to: args.to },
                    ...projectPurchaseSummary(result.summary),
                };
            }

            const trend = await deps.purchaseReports.getPurchaseTrend(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
                granularity: 'day',
                compareTo,
            });
            const comparison = trend.comparison as any;
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                ...projectPurchaseSummary(trend.summary),
                comparison: comparison
                    ? {
                          mode: comparison.mode,
                          period: comparison.period,
                          ...projectPurchaseSummary(comparison.summary),
                          change: {
                              netPurchases: money(comparison.change.netPurchases),
                              netPurchasesPct: pct(comparison.change.netPurchasesPct),
                              orderCount: comparison.change.orderCount,
                              orderCountPct: pct(comparison.change.orderCountPct),
                          },
                      }
                    : null,
            };
        },
    },

    {
        name: 'purchase_trend',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail', 'inventory'],
        description:
            'Supplier spend over time as day, week or month buckets. Use for "is our buying going up", ' +
            '"what did we spend each month", or any procurement question spanning several periods.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                ...COMPARE_PROP,
                granularity: {
                    type: 'string',
                    enum: ['day', 'week', 'month'],
                    description: 'Bucket width. Defaults to month, which is the useful grain for procurement.',
                },
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const granularity = args.granularity === 'day' || args.granularity === 'week' ? args.granularity : 'month';

            const result = await deps.purchaseReports.getPurchaseTrend(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
                granularity,
                compareTo: asComparison(args.compareTo),
            });
            const paged = page(result.buckets, args);

            return {
                ...(note ? { note } : {}),
                period: result.period,
                granularity: result.granularity,
                ...projectPurchaseSummary(result.summary),
                totalBuckets: paged.totalRows,
                truncated: paged.truncated,
                rows: paged.rows.map((b) => ({
                    bucket: b.bucket,
                    orders: b.orders,
                    netPurchases: money(b.netPurchases),
                })),
            };
        },
    },

    {
        name: 'purchase_breakdown',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail', 'inventory'],
        description:
            'Purchases for a date range split by supplier or by product. Use for "who do we buy most from", ' +
            '"what are we buying", supplier concentration and procurement mix questions.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                ...PAGING_PROPS,
                groupBy: {
                    type: 'string',
                    enum: ['supplier', 'product'],
                    description: 'The dimension to split by. Defaults to supplier.',
                },
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const groupBy = args.groupBy === 'product' ? 'product' : 'supplier';

            if (groupBy === 'product') {
                const result = await deps.purchaseReports.getPurchasesByProduct(ctx.tenantId, {
                    from: args.from,
                    to: args.to,
                    storeId,
                });
                const paged = page(result.rows, args);
                return {
                    ...(note ? { note } : {}),
                    period: { from: args.from, to: args.to },
                    groupBy,
                    totalSpend: money(result.summary.totalSpend),
                    totalUnits: result.summary.totalUnits,
                    productCount: result.summary.productCount,
                    ...paged,
                    rows: paged.rows.map((r: any) => ({
                        name: r.product?.name ?? 'Unknown',
                        group: r.product?.group?.name ?? null,
                        unitsOrdered: r.unitsOrdered,
                        spend: money(r.spend),
                        spendSharePct: pct(r.spendShare),
                    })),
                };
            }

            const result = await deps.purchaseReports.getPurchasesBySupplier(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
            });
            const paged = page(result.rows, args);
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                groupBy,
                totalSpend: money(result.summary.totalSpend),
                totalOrders: result.summary.totalOrders,
                supplierCount: result.summary.supplierCount,
                ...paged,
                rows: paged.rows.map((r: any) => ({
                    name: r.supplier?.name ?? 'Unknown supplier',
                    phone: r.supplier?.phone ?? null,
                    orders: r.orderCount,
                    spend: money(r.spend),
                    avgOrderValue: money(r.avgOrderValue),
                    spendSharePct: pct(r.spendShare),
                })),
            };
        },
    },
];

function projectPurchaseSummary(summary: any) {
    return {
        totalPurchases: money(summary.totalPurchases),
        totalReturns: money(summary.totalReturns),
        netPurchases: money(summary.netPurchases),
        orderCount: summary.orderCount,
        avgOrderValue: money(summary.avgOrderValue),
    };
}
