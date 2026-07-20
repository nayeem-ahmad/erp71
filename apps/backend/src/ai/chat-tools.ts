import { StorePermission } from '@erp71/shared-types';
import { CustomersService } from '../customers/customers.service';
import { ExpensesService } from '../expenses/expenses.service';
import { InventoryReportsService } from '../inventory-reports/inventory-reports.service';
import { PurchaseReportsService } from '../purchase-reports/purchase-reports.service';
import { SalesReportsService } from '../sales-reports/sales-reports.service';

/**
 * The read-only tool menu the data chatbot may call.
 *
 * Every handler delegates to the same service method the REST endpoint uses, so
 * rounding, soft-delete filtering and date-window semantics match exactly what
 * the corresponding report page shows. Two rules are load-bearing:
 *
 *  1. `tenantId` is never a tool parameter — it comes from the JWT via
 *     `ChatToolContext`. Tenant isolation is therefore structural, not a
 *     property of the prompt. `chat-tools.spec.ts` asserts this.
 *  2. Results are projected down and row-capped before they go back to the
 *     model: a raw report row carries whole Prisma entities, and every row we
 *     return is billed again as input tokens on the next round-trip.
 */

/** Max rows any single tool may hand back to the model. */
export const MAX_TOOL_ROWS = 20;

export interface ChatToolDeps {
    salesReports: SalesReportsService;
    inventoryReports: InventoryReportsService;
    purchaseReports: PurchaseReportsService;
    customers: CustomersService;
    expenses: ExpensesService;
}

export interface ChatToolContext {
    tenantId: string;
    userId: string;
    userRole?: string;
    /** Currently selected store, used as the default scope for store-aware tools. */
    storeId?: string;
    /** Every store in the tenant — the allow-list for a model-supplied `storeId`. */
    stores: Array<{ id: string; name: string }>;
}

export interface ChatTool {
    name: string;
    /** Written for the model: say what it returns *and* when to reach for it. */
    description: string;
    /** Withheld from the tool list entirely when the caller lacks this. */
    permission: StorePermission;
    parameters: Record<string, unknown>;
    handler: (ctx: ChatToolContext, args: Record<string, any>, deps: ChatToolDeps) => Promise<unknown>;
}

const DATE_RANGE_PROPS = {
    from: { type: 'string', description: 'Start date, inclusive, as YYYY-MM-DD.' },
    to: { type: 'string', description: 'End date, inclusive, as YYYY-MM-DD.' },
};

const STORE_PROP = {
    storeId: {
        type: 'string',
        description:
            'Restrict to one branch by its id, taken from the branch list in the system prompt. ' +
            'Omit for the whole business. Never invent an id.',
    },
};

/** 2dp is the most precision any BDT figure in this app carries. */
function money(value: unknown): number {
    return Math.round(Number(value ?? 0) * 100) / 100;
}

function pct(value: unknown): number {
    return Math.round(Number(value ?? 0) * 10) / 10;
}

/**
 * Caps a row list and tells the model it was capped, so it can say "the top 20
 * of 143" instead of silently presenting a truncated list as complete.
 */
function capRows<T>(rows: T[], limit = MAX_TOOL_ROWS): { rows: T[]; totalRows: number; truncated: boolean } {
    return {
        rows: rows.slice(0, limit),
        totalRows: rows.length,
        truncated: rows.length > limit,
    };
}

/**
 * Only lets through a store id that actually belongs to this tenant. A bad id is
 * dropped (widening to tenant-wide) rather than passed to Prisma, and the model
 * is told, so it does not report a filtered figure as branch-specific.
 */
function resolveStoreId(ctx: ChatToolContext, requested?: string): { storeId?: string; note?: string } {
    if (!requested) return {};
    const match = ctx.stores.find((s) => s.id === requested);
    if (match) return { storeId: match.id };
    return {
        note: `Unknown branch id "${requested}" — this result covers the whole business, not one branch.`,
    };
}

export const CHAT_TOOLS: ChatTool[] = [
    {
        name: 'sales_summary',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        description:
            'Total sales revenue, returns, net revenue, transaction count, average order value, COGS and gross profit ' +
            'for a date range. Use for "how much did we sell", revenue, profit and margin questions.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...STORE_PROP },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.salesReports.getSalesSummary(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
            });
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                totalRevenue: money(result.summary.totalRevenue),
                totalReturns: money(result.summary.totalReturns),
                netRevenue: money(result.summary.netRevenue),
                transactionCount: result.summary.transactionCount,
                avgOrderValue: money(result.summary.avgOrderValue),
                totalCogs: money(result.summary.totalCogs),
                grossProfit: money(result.summary.grossProfit),
                grossMarginPct: pct(result.summary.grossMarginPct),
                daysWithSales: result.rows.length,
            };
        },
    },

    {
        name: 'top_products',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        description:
            'Best-selling products for a date range, ranked by revenue, with units sold, revenue share and gross margin. ' +
            'Use for "what sells best", "top items", or per-product profitability.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                limit: { type: 'number', description: `How many products to return (max ${MAX_TOOL_ROWS}).` },
            },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.salesReports.getSalesByProduct(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
            });
            const limit = Math.min(Number(args.limit) || 10, MAX_TOOL_ROWS);
            const capped = capRows(result.rows, limit);
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                totalRevenue: money(result.summary.totalRevenue),
                totalUnitsSold: result.summary.totalUnitsSold,
                productCount: result.summary.productCount,
                ...capped,
                rows: capped.rows.map((r: any) => ({
                    product: r.product?.name ?? 'Unknown',
                    group: r.product?.group?.name ?? null,
                    unitsSold: r.unitsSold,
                    revenue: money(r.revenue),
                    revenueSharePct: pct(r.revenueShare),
                    grossProfit: money(r.grossProfit),
                    grossMarginPct: pct(r.grossMarginPct),
                })),
            };
        },
    },

    {
        name: 'low_stock',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        description:
            'Products at or below their reorder point, with quantity on hand, quantity already in transit and a suggested ' +
            'reorder quantity. Use for "what do I need to restock", low stock and reorder questions.',
        parameters: {
            type: 'object',
            properties: {
                warehouseId: { type: 'string', description: 'Restrict to one warehouse by id. Omit for all warehouses.' },
            },
        },
        handler: async (ctx, args, deps) => {
            const rows = await deps.inventoryReports.getReorderSuggestions(ctx.tenantId, {
                warehouseId: args.warehouseId,
            });
            const needsReorder = rows.filter((r: any) => r.suggestedQuantity > 0);
            const unconfigured = rows.length - needsReorder.length;
            const capped = capRows(
                [...needsReorder].sort((a: any, b: any) => b.suggestedQuantity - a.suggestedQuantity),
            );
            return {
                ...capped,
                productsWithoutStockPolicy: unconfigured,
                rows: capped.rows.map((r: any) => ({
                    product: r.product?.name ?? 'Unknown',
                    group: r.product?.group?.name ?? null,
                    onHand: r.onHand,
                    inTransit: r.inTransit,
                    targetStock: r.targetStock,
                    suggestedQuantity: r.suggestedQuantity,
                    leadTimeDays: r.leadTimeDays,
                })),
            };
        },
    },

    {
        name: 'stock_on_hand',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        description:
            'Current stock quantity and inventory value, overall and per product. Use for "how much stock do we have", ' +
            '"what is my inventory worth", or the quantity of one specific product (pass productName).',
        parameters: {
            type: 'object',
            properties: {
                warehouseId: { type: 'string', description: 'Restrict to one warehouse by id.' },
                productName: {
                    type: 'string',
                    description: 'Filter to products whose name contains this text. Use when asked about one product.',
                },
            },
        },
        handler: async (ctx, args, deps) => {
            const result = await deps.inventoryReports.getInventoryValuation(ctx.tenantId, {
                warehouseId: args.warehouseId,
            });
            const search = String(args.productName ?? '').trim().toLowerCase();
            const matched = search
                ? result.rows.filter((r: any) => (r.product?.name ?? '').toLowerCase().includes(search))
                : result.rows.filter((r: any) => r.quantity > 0);
            const capped = capRows([...matched].sort((a: any, b: any) => b.stockValue - a.stockValue));
            return {
                totalQuantity: result.summary.totalQuantity,
                totalStockValue: money(result.summary.totalStockValue),
                productsInStock: result.summary.productCount,
                ...capped,
                rows: capped.rows.map((r: any) => ({
                    product: r.product?.name ?? 'Unknown',
                    group: r.product?.group?.name ?? null,
                    quantity: r.quantity,
                    unitValue: money(r.unitValue),
                    stockValue: money(r.stockValue),
                })),
            };
        },
    },

    {
        name: 'customer_lookup',
        permission: StorePermission.VIEW_CRM_INTERACTIONS,
        description:
            'Find customers by name, phone or customer code and return their lifetime spend, order count, average order ' +
            'value, outstanding due balance and days since last purchase. Use for any question about a named customer.',
        parameters: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Customer name, phone number or customer code to search for.' },
            },
            required: ['search'],
        },
        handler: async (ctx, args, deps) => {
            const page = await deps.customers.findAll(ctx.tenantId, { search: String(args.search), limit: 5 });
            const matches = page.items ?? [];
            if (matches.length === 0) {
                return { matchCount: 0, rows: [], note: `No customer matched "${args.search}".` };
            }
            const analytics = await Promise.all(
                matches.slice(0, 5).map((c: any) => deps.customers.getAnalytics(ctx.tenantId, c.id)),
            );
            return {
                matchCount: matches.length,
                rows: analytics.map((a: any, i: number) => ({
                    name: matches[i].name,
                    phone: matches[i].phone ?? null,
                    totalSpent: money(a.total_spent),
                    orderCount: a.order_count,
                    avgOrderValue: money(a.avg_order_value),
                    dueBalance: money(a.due_balance),
                    loyaltyPoints: a.loyalty_points,
                    segment: a.segment,
                    lastPurchaseDate: a.last_purchase_date
                        ? new Date(a.last_purchase_date).toISOString().slice(0, 10)
                        : null,
                    daysSinceLastPurchase: a.days_since_last_purchase,
                })),
            };
        },
    },

    {
        name: 'receivables_aging',
        permission: StorePermission.VIEW_CUSTOMER_CREDIT,
        description:
            'Outstanding customer credit (money owed to the business), bucketed by age: 0-30, 31-60, 61-90 and 90+ days. ' +
            'Use for "who owes us money", receivables, dues and overdue questions.',
        parameters: { type: 'object', properties: {} },
        handler: async (ctx, _args, deps) => {
            const rows = await deps.customers.getDueAgingReport(ctx.tenantId);
            const totals = rows.reduce(
                (acc: any, r: any) => ({
                    total: acc.total + r.total,
                    bucket_0_30: acc.bucket_0_30 + r.bucket_0_30,
                    bucket_31_60: acc.bucket_31_60 + r.bucket_31_60,
                    bucket_61_90: acc.bucket_61_90 + r.bucket_61_90,
                    bucket_90_plus: acc.bucket_90_plus + r.bucket_90_plus,
                }),
                { total: 0, bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 },
            );
            const capped = capRows([...rows].sort((a: any, b: any) => b.total - a.total));
            return {
                totalOutstanding: money(totals.total),
                buckets: {
                    days_0_30: money(totals.bucket_0_30),
                    days_31_60: money(totals.bucket_31_60),
                    days_61_90: money(totals.bucket_61_90),
                    days_90_plus: money(totals.bucket_90_plus),
                },
                customersWithDues: rows.length,
                ...capped,
                rows: capped.rows.map((r: any) => ({
                    customer: r.customer?.name ?? 'Unknown',
                    phone: r.customer?.phone ?? null,
                    total: money(r.total),
                    days_0_30: money(r.bucket_0_30),
                    days_31_60: money(r.bucket_31_60),
                    days_61_90: money(r.bucket_61_90),
                    days_90_plus: money(r.bucket_90_plus),
                })),
            };
        },
    },

    {
        name: 'expense_summary',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        description:
            'Total business expenses for a date range, broken down by category with each category\'s share of spend. ' +
            'Use for "what did we spend", cost and overhead questions.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...STORE_PROP },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result: any = await deps.expenses.getSummary(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
            });
            const capped = capRows(result.byCategory ?? []);
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                totalExpenses: money(result.total),
                ...capped,
                rows: capped.rows.map((r: any) => ({
                    category: r.name,
                    amount: money(r.amount),
                    sharePct: pct(r.sharePct),
                })),
            };
        },
    },

    {
        name: 'purchase_summary',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        description:
            'Total purchases from suppliers for a date range: gross purchases, purchase returns, net purchases, order ' +
            'count and average order value. Use for procurement and supplier spend questions.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...STORE_PROP },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.purchaseReports.getPurchaseSummary(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
            });
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                totalPurchases: money(result.summary.totalPurchases),
                totalReturns: money(result.summary.totalReturns),
                netPurchases: money(result.summary.netPurchases),
                orderCount: result.summary.orderCount,
                avgOrderValue: money(result.summary.avgOrderValue),
            };
        },
    },
];

export const CHAT_TOOLS_BY_NAME: Record<string, ChatTool> = Object.fromEntries(
    CHAT_TOOLS.map((tool) => [tool.name, tool]),
);

/** OpenRouter/OpenAI `tools` wire format for the subset the caller may use. */
export function toOpenRouterTools(tools: ChatTool[]) {
    return tools.map((tool) => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}
