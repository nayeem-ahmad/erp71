import { StorePermission } from '@erp71/shared-types';
import {
    asComparison,
    COMPARE_PROP,
    DATE_RANGE_PROPS,
    isoDate,
    MAX_TOOL_ROWS,
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

    {
        name: 'purchase_line_items',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail', 'inventory'],
        description:
            'The bill lines behind a purchase total: which bill, which supplier, which product, qty and amount. ' +
            'Use when a summary is not enough and you need to name the bills a figure came from. ' +
            'Filter by product, supplier or free text. Does not replace purchase_summary.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                productId: { type: 'string', description: 'Restrict to one product id from resolve_entity.' },
                supplierId: { type: 'string', description: 'Restrict to one supplier id from resolve_entity.' },
                search: { type: 'string', description: 'Free-text match on product, bill number or supplier.' },
                ...PAGING_PROPS,
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const limit = Math.min(Math.max(Number(args.limit) || MAX_TOOL_ROWS, 1), MAX_TOOL_ROWS);
            const offset = Math.max(Number(args.offset) || 0, 0);
            const result = await deps.purchaseLineItems.getPurchaseLineItems(
                ctx.tenantId,
                {
                    from: args.from,
                    to: args.to,
                    storeId,
                    limit,
                    page: Math.floor(offset / limit) + 1,
                    ...(args.productId ? { productId: String(args.productId) } : {}),
                    ...(args.supplierId ? { supplierId: String(args.supplierId) } : {}),
                    ...(args.search ? { search: String(args.search) } : {}),
                },
                ctx.timezone,
            );
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                summary: {
                    lineCount: result.summary.lineCount,
                    billCount: result.summary.billCount,
                    quantity: result.summary.quantity,
                    amount: money(result.summary.amount),
                    returnedQuantity: result.summary.returnedQuantity,
                    returnedAmount: money(result.summary.returnedAmount),
                },
                totalRows: result.pagination?.total ?? result.rows.length,
                page: result.pagination?.page ?? 1,
                rows: result.rows.map(projectPurchaseLine),
            };
        },
    },
];

function projectPurchaseLine(row: any) {
    const purchase = row.purchase;
    const product = row.product;
    const unitPrice = row.unitPrice ?? row.unitCost ?? row.unit_cost;
    const amount = row.amount ?? row.line_total ?? Number(row.quantity ?? 0) * Number(unitPrice ?? 0);
    const supplier = row.supplier ?? purchase?.supplier;
    return {
        billNumber: row.billNumber ?? row.purchaseNumber ?? purchase?.purchase_number ?? null,
        date: isoDate(row.date ?? purchase?.purchase_date),
        supplier: typeof supplier === 'string' ? supplier : supplier?.name ?? null,
        product: typeof product === 'string' ? product : product?.name ?? null,
        sku: typeof product === 'string' ? null : product?.sku ?? null,
        quantity: row.quantity,
        unitPrice: money(unitPrice),
        amount: money(amount),
        returnedQuantity: row.returnedQuantity ?? 0,
    };
}

function projectPurchaseSummary(summary: any) {
    return {
        totalPurchases: money(summary.totalPurchases),
        totalReturns: money(summary.totalReturns),
        netPurchases: money(summary.netPurchases),
        orderCount: summary.orderCount,
        avgOrderValue: money(summary.avgOrderValue),
    };
}
