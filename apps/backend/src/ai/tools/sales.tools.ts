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

/** How the assistant should describe a figure's provenance when it matters. */
const BASIS_NOTE: Record<string, string> = {
    sale_line_items: 'Revenue summed from sale lines (before invoice-level discounts).',
    invoice_totals: 'Revenue summed from invoice totals.',
    payment_records: 'Amounts summed from recorded payments, so part-paid invoices contribute only what was paid.',
};

export const SALES_TOOLS: ChatTool[] = [
    {
        name: 'sales_summary',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail'],
        description:
            'Total sales revenue, returns, net revenue, transaction count, average order value, COGS and gross profit ' +
            'for a date range. Use for "how much did we sell", revenue, profit and margin questions. ' +
            'Pass compareTo to get the change against a prior period in the same call.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...STORE_PROP, ...COMPARE_PROP },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const compareTo = asComparison(args.compareTo);

            // With no comparison this is the plain summary, so it delegates to
            // the same method the report page calls. With one, the trend method
            // does the period arithmetic — never the model.
            if (!compareTo) {
                const result = await deps.salesReports.getSalesSummary(ctx.tenantId, {
                    from: args.from,
                    to: args.to,
                    storeId,
                });
                return {
                    ...(note ? { note } : {}),
                    period: { from: args.from, to: args.to },
                    ...projectSalesSummary(result.summary),
                    daysWithSales: result.rows.length,
                };
            }

            const trend = await deps.salesReports.getSalesTrend(ctx.tenantId, {
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
                ...projectSalesSummary(trend.summary),
                comparison: comparison
                    ? {
                          mode: comparison.mode,
                          period: comparison.period,
                          ...projectSalesSummary(comparison.summary),
                          change: {
                              netRevenue: money(comparison.change.netRevenue),
                              netRevenuePct: pct(comparison.change.netRevenuePct),
                              transactionCount: comparison.change.transactionCount,
                              transactionCountPct: pct(comparison.change.transactionCountPct),
                              avgOrderValue: money(comparison.change.avgOrderValue),
                              grossProfit: money(comparison.change.grossProfit),
                              grossProfitPct: pct(comparison.change.grossProfitPct),
                          },
                      }
                    : null,
            };
        },
    },

    {
        name: 'sales_trend',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail'],
        description:
            'Revenue over time as a series of day, week or month buckets, with the change between consecutive buckets. ' +
            'Use for "are sales growing", "which month was best/worst", "show me the trend", or any question spanning ' +
            'several periods. Ask for one series rather than calling sales_summary once per period.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                ...COMPARE_PROP,
                granularity: {
                    type: 'string',
                    enum: ['day', 'week', 'month'],
                    description: 'Bucket width. Defaults to day. Use month for ranges longer than about three months.',
                },
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const granularity =
                args.granularity === 'week' || args.granularity === 'month' ? args.granularity : 'day';

            const result = await deps.salesReports.getSalesTrend(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
                granularity,
                compareTo: asComparison(args.compareTo),
            });

            const buckets = result.buckets as any[];
            const withActivity = buckets.filter((b) => b.transactions > 0);
            const best = withActivity.reduce<any>((top, b) => (!top || b.netRevenue > top.netRevenue ? b : top), null);
            const worst = withActivity.reduce<any>((low, b) => (!low || b.netRevenue < low.netRevenue ? b : low), null);

            // Long ranges at day granularity blow the row cap, and the model does
            // not need 180 rows to describe a shape — it needs the extremes and a
            // representative tail.
            const paged = page(buckets, { limit: args.limit });

            return {
                ...(note ? { note } : {}),
                period: result.period,
                granularity: result.granularity,
                summary: projectSalesSummary(result.summary),
                best: best ? { bucket: best.bucket, netRevenue: money(best.netRevenue) } : null,
                worst: worst ? { bucket: worst.bucket, netRevenue: money(worst.netRevenue) } : null,
                comparison: result.comparison
                    ? {
                          mode: (result.comparison as any).mode,
                          period: (result.comparison as any).period,
                          netRevenue: money((result.comparison as any).summary.netRevenue),
                          netRevenueChangePct: pct((result.comparison as any).change.netRevenuePct),
                      }
                    : null,
                totalBuckets: paged.totalRows,
                truncated: paged.truncated,
                rows: paged.rows.map((b: any) => ({
                    bucket: b.bucket,
                    transactions: b.transactions,
                    netRevenue: money(b.netRevenue),
                    grossProfit: money(b.grossProfit),
                    grossMarginPct: pct(b.grossMarginPct),
                    changeFromPreviousPct: pct(b.changeFromPreviousPct),
                })),
            };
        },
    },

    {
        name: 'sales_breakdown',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail'],
        description:
            'Sales for a date range split by one dimension: product, category, brand, branch, customer, payment_method, ' +
            'staff, hour_of_day or day_of_week. Use for "what sells best", "which branch earns most", "who are our ' +
            'biggest customers", "how do people pay", "who sold the most", "what is our busiest hour". ' +
            'Pass compareTo to include each row\'s prior-period figure.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                ...COMPARE_PROP,
                ...PAGING_PROPS,
                groupBy: {
                    type: 'string',
                    enum: [
                        'product',
                        'category',
                        'brand',
                        'branch',
                        'customer',
                        'payment_method',
                        'staff',
                        'hour_of_day',
                        'day_of_week',
                    ],
                    description: 'The dimension to split by.',
                },
            },
            required: ['from', 'to', 'groupBy'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.salesReports.getSalesBreakdown(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
                groupBy: args.groupBy,
                compareTo: asComparison(args.compareTo),
                // The service pages the projected rows; ask it for the full
                // ranking so the cap here is the only one that applies.
                limit: 500,
            });

            const paged = page(result.rows as any[], args);

            return {
                ...(note ? { note } : {}),
                period: result.period,
                groupBy: result.groupBy,
                basisNote: BASIS_NOTE[result.revenueBasis] ?? null,
                totalRevenue: money(result.summary.totalRevenue),
                totalOrders: result.summary.totalOrders,
                groupCount: result.summary.groupCount,
                ...(result.comparison ? { comparisonPeriod: result.comparison.period } : {}),
                totalRows: paged.totalRows,
                returned: paged.returned,
                offset: paged.offset,
                hasMore: paged.hasMore,
                truncated: paged.truncated,
                rows: paged.rows.map((row: any) => ({
                    name: row.label,
                    revenue: money(row.revenue),
                    revenueSharePct: pct(row.revenueSharePct),
                    orders: row.orders,
                    ...(row.units === null ? {} : { unitsSold: row.units }),
                    ...(row.grossProfit === null
                        ? {}
                        : { grossProfit: money(row.grossProfit), grossMarginPct: pct(row.grossMarginPct) }),
                    ...(row.previousRevenue === undefined
                        ? {}
                        : {
                              previousRevenue: money(row.previousRevenue),
                              revenueChange: money(row.revenueChange),
                              revenueChangePct: pct(row.revenueChangePct),
                          }),
                })),
            };
        },
    },

    {
        name: 'top_movers',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail'],
        description:
            'What changed most between a period and the one before it, in both directions, by product, category, brand, ' +
            'branch or customer. Use this to explain WHY a total went up or down — "why did sales drop", ' +
            '"what is growing", "which customers stopped buying". One call replaces comparing two breakdowns by hand.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                ...COMPARE_PROP,
                dimension: {
                    type: 'string',
                    enum: ['product', 'category', 'brand', 'branch', 'customer'],
                    description: 'What to compare. Defaults to product.',
                },
                limit: { type: 'number', description: 'How many gainers and how many decliners to return (max 20).' },
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);

            const result = await deps.salesReports.getTopMovers(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
                dimension: args.dimension,
                compareTo: asComparison(args.compareTo),
                limit,
            });

            const projectMover = (m: any) => ({
                name: m.label,
                revenue: money(m.revenue),
                previousRevenue: money(m.previousRevenue),
                revenueChange: money(m.revenueChange),
                revenueChangePct: pct(m.revenueChangePct),
                status: m.status,
            });

            return {
                ...(note ? { note } : {}),
                period: result.period,
                comparisonPeriod: result.comparisonPeriod,
                dimension: result.dimension,
                totals: {
                    revenue: money(result.totals.revenue),
                    previousRevenue: money(result.totals.previousRevenue),
                    revenueChange: money(result.totals.revenueChange),
                    revenueChangePct: pct(result.totals.revenueChangePct),
                },
                gainers: result.gainers.map(projectMover),
                decliners: result.decliners.map(projectMover),
            };
        },
    },

    {
        name: 'returns_analysis',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail'],
        description:
            'Sales returns for a date range: total refunded, the return rate against revenue, and the breakdown by ' +
            'reason, product and branch. Use for "how much are we refunding", "why are things being returned", ' +
            '"which product gets returned most".',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...STORE_PROP },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.salesReports.getReturnsAnalysis(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
            });

            const projectTally = (rows: any[], take = 8) =>
                rows.slice(0, take).map((r) => ({
                    name: r.label,
                    amount: money(r.amount),
                    sharePct: pct(r.sharePct),
                    units: r.units,
                }));

            return {
                ...(note ? { note } : {}),
                period: result.period,
                totalRefund: money(result.summary.totalRefund),
                returnCount: result.summary.returnCount,
                unitsReturned: result.summary.unitsReturned,
                grossRevenue: money(result.summary.grossRevenue),
                returnRatePct: pct(result.summary.returnRatePct),
                avgRefund: money(result.summary.avgRefund),
                byReason: projectTally(result.byReason),
                byProduct: projectTally(result.byProduct),
                byBranch: projectTally(result.byBranch),
            };
        },
    },

    {
        name: 'customer_retention',
        permission: StorePermission.VIEW_CRM_INTERACTIONS,
        modules: ['retail', 'crm'],
        description:
            'How many customers bought in a period, split into first-time and returning, plus how many have lapsed. ' +
            'Use for "are customers coming back", "how many new customers", "who stopped buying", churn and repeat-rate ' +
            'questions. Walk-in sales are reported separately because they carry no customer record.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                lapsedAfterDays: {
                    type: 'number',
                    description: 'Days without a purchase before a customer counts as lapsed. Defaults to 90.',
                },
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.salesReports.getCustomerRetention(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
                lapsedAfterDays: Number(args.lapsedAfterDays) || undefined,
            });

            return {
                ...(note ? { note } : {}),
                period: result.period,
                lapsedAfterDays: result.lapsedAfterDays,
                activeCustomers: result.summary.activeCustomers,
                newCustomers: result.summary.newCustomers,
                returningCustomers: result.summary.returningCustomers,
                lapsedCustomers: result.summary.lapsedCustomers,
                repeatRatePct: pct(result.summary.repeatRatePct),
                identifiedRevenue: money(result.summary.identifiedRevenue),
                newCustomerRevenue: money(result.summary.newCustomerRevenue),
                returningCustomerRevenue: money(result.summary.returningCustomerRevenue),
                returningRevenueSharePct: pct(result.summary.returningRevenueSharePct),
                avgRevenuePerActiveCustomer: money(result.summary.avgRevenuePerActiveCustomer),
                walkIn: {
                    orders: result.walkIn.orders,
                    revenue: money(result.walkIn.revenue),
                    note: result.walkIn.note,
                },
            };
        },
    },
];

function projectSalesSummary(summary: any) {
    return {
        totalRevenue: money(summary.totalRevenue),
        totalReturns: money(summary.totalReturns),
        netRevenue: money(summary.netRevenue),
        transactionCount: summary.transactionCount,
        avgOrderValue: money(summary.avgOrderValue),
        totalCogs: money(summary.totalCogs),
        grossProfit: money(summary.grossProfit),
        grossMarginPct: pct(summary.grossMarginPct),
    };
}
