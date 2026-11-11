import { StorePermission } from '@erp71/shared-types';
import { zonedDateString } from '../../common/tenant-time.util';
import {
    asDate,
    DATE_RANGE_PROPS,
    money,
    page,
    PAGING_PROPS,
    pct,
    resolveRequiredStoreId,
    resolveStoreId,
    STORE_PROP,
    type ChatTool,
} from './types';

function nullableMoney(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    return money(value);
}

function isoTimestamp(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const OPERATIONS_TOOLS: ChatTool[] = [
    {
        name: 'daily_report',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail'],
        description:
            'Closed calendar-day snapshot for one branch: net sales, cash movement, tenders, till, money out, dues, ' +
            'top products, stock exception counts and the attention checklist. Always per branch — a missing branch ' +
            'id is an error, never an all-branches report. Omit date for today in the shop timezone. ' +
            'Use for "today\'s report", "how did Gulshan do yesterday", daily close questions.',
        parameters: {
            type: 'object',
            properties: {
                date: {
                    type: 'string',
                    description: 'Calendar day as YYYY-MM-DD. Omit for today in the shop timezone.',
                },
                storeId: {
                    type: 'string',
                    description:
                        'Branch id from the branch list in the system prompt. Required when several branches exist ' +
                        'and none is currently selected. Daily report is always for one branch — never invent an id.',
                },
            },
        },
        handler: async (ctx, args, deps) => {
            const resolved = resolveRequiredStoreId(ctx, args.storeId);
            if ('error' in resolved) return resolved;

            const date = asDate(args.date) ?? zonedDateString(new Date(), ctx.timezone);
            const storeName = ctx.stores.find((s) => s.id === resolved.storeId)?.name ?? '';
            const tenantName = await deps.data.tenantName(ctx.tenantId);
            const report = await deps.dailyReport.getReport({
                tenantId: ctx.tenantId,
                storeId: resolved.storeId,
                tenantName,
                storeName,
                date,
                timezone: ctx.timezone,
                locale: 'en',
            });

            return {
                ...(resolved.note ? { note: resolved.note } : {}),
                date: report.date,
                storeName: report.storeName,
                headlines: report.headlines,
                sales: report.sales,
                tenders: report.tenders,
                till: report.till
                    ? {
                          sessions: report.till.sessions.map((session) => ({
                              cashier: session.cashierName,
                              counter: session.counterName,
                              status: session.status,
                              opening: session.openingCash,
                              expected: session.expectedCash,
                              closing: session.closingCash,
                              variance: session.variance,
                          })),
                          rollup: report.till.rollup,
                          openSessionCount: report.till.openSessionCount,
                          unassignedSalesCount: report.till.unassignedSalesCount,
                      }
                    : null,
                moneyOut: report.moneyOut,
                dues: report.dues,
                topProducts: report.topProducts,
                stock: report.stock
                    ? {
                          reorderCount: report.stock.reorderCount,
                          zeroCount: report.stock.zeroCount,
                          shrinkageCount: report.stock.shrinkageCount,
                          shrinkageAmount: report.stock.shrinkageAmount,
                      }
                    : null,
                checklist: (report.checklist ?? []).map((item) => ({
                    code: item.code,
                    count: item.count,
                    href: item.href,
                })),
            };
        },
    },

    {
        name: 'cashier_sessions',
        permission: StorePermission.CREATE_SALE,
        modules: ['retail'],
        description:
            'Today only: every till still open and every till closed today, with sales, expected cash and variance. ' +
            'There is no date parameter — yesterday\'s closed shifts are not in this result. ' +
            'Use for "are any tills still open", "who is short today", till variance questions.',
        parameters: {
            type: 'object',
            properties: { ...STORE_PROP },
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const overview = await deps.cashierSessions.getOverview(ctx.tenantId, storeId, ctx.timezone);
            const projectRow = (row: any) => ({
                cashier: row.cashier?.name ?? null,
                counter: row.counter?.name ?? null,
                branch: row.store?.name ?? null,
                sales_count: row.sales_count,
                sales_total: money(row.sales_total),
                expected_cash: nullableMoney(row.expected_cash),
                closing_cash: nullableMoney(row.closing_cash),
                variance: nullableMoney(row.variance),
                opened_at: isoTimestamp(row.opened_at),
                closed_at: isoTimestamp(row.closed_at),
            });
            const open = page(overview.open ?? []);
            const closedToday = page(overview.closed_today ?? []);
            return {
                ...(note ? { note } : {}),
                store_id: overview.store_id,
                totals: {
                    open_count: overview.totals.open_count,
                    closed_count: overview.totals.closed_count,
                    sales_total: money(overview.totals.sales_total),
                    expected_cash: money(overview.totals.expected_cash),
                    short: money(overview.totals.short),
                    over: money(overview.totals.over),
                },
                open: { ...open, rows: open.rows.map(projectRow) },
                closed_today: { ...closedToday, rows: closedToday.rows.map(projectRow) },
            };
        },
    },

    {
        name: 'open_pipeline',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        modules: ['retail', 'crm'],
        description:
            'Work that is committed but not finished: open sales orders, purchase orders, quotations, leads or ' +
            'deliveries, with their count, value and due dates. Use for any forward-looking question — ' +
            '"what is pending", "what is due this week", "what stock is on order", "how many quotes are outstanding". ' +
            'Every other tool reports what already happened; this one reports what has not.',
        parameters: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: ['sales_orders', 'purchase_orders', 'quotations', 'leads', 'deliveries'],
                    description: 'Which kind of open work to list.',
                },
                ...STORE_PROP,
                ...PAGING_PROPS,
            },
            required: ['kind'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.data.getOpenPipeline(ctx.tenantId, args.kind, storeId, 50);
            const paged = page(result.rows, args);
            return {
                ...(note ? { note } : {}),
                kind: result.kind,
                openCount: result.openCount,
                totalValue: result.totalValue === null ? null : money(result.totalValue),
                ...('unpaidValue' in result ? { unpaidValue: money((result as any).unpaidValue) } : {}),
                byStatus: result.byStatus,
                totalRows: paged.totalRows,
                returned: paged.returned,
                offset: paged.offset,
                hasMore: paged.hasMore,
                truncated: paged.truncated,
                rows: paged.rows.map((r) => ({
                    name: r.label,
                    status: r.status,
                    amount: r.amount === null ? null : money(r.amount),
                    dueDate: r.dueDate,
                    detail: r.detail,
                })),
            };
        },
    },

    {
        name: 'workforce_summary',
        permission: StorePermission.MANAGE_USERS,
        modules: ['hr'],
        description:
            'Headcount, attendance and payroll for a date range: active staff, present/absent/leave counts, salary paid ' +
            'and top earners. Use for "how many staff do we have", "what did payroll cost", "what is our attendance ' +
            'rate", absence and salary questions.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const result = await deps.data.getWorkforceSummary(ctx.tenantId, args.from, args.to);
            return {
                period: { from: args.from, to: args.to },
                activeEmployees: result.headcount.active,
                headcountByStatus: result.headcount.byStatus,
                attendanceRecords: result.attendance.recordCount,
                attendanceByStatus: result.attendance.byStatus,
                presentRatePct: pct(result.attendance.presentRatePct),
                payrollPaid: money(result.payroll.totalPaid),
                payrollPaymentCount: result.payroll.paymentCount,
                topEarners: result.payroll.topEarners.map((e) => ({
                    employee: e.employee,
                    designation: e.designation,
                    paid: money(e.paid),
                })),
            };
        },
    },

    {
        name: 'loyalty_summary',
        permission: StorePermission.VIEW_CRM_INTERACTIONS,
        modules: ['retail', 'crm'],
        description:
            'Loyalty points outstanding across the customer base, what they would be worth if redeemed, and who holds ' +
            'the most. Use for "how many points are outstanding", "what is our loyalty liability", ' +
            '"who has the most points".',
        parameters: { type: 'object', properties: { ...PAGING_PROPS } },
        handler: async (ctx, args, deps) => {
            const result = await deps.data.getLoyaltySummary(ctx.tenantId, 20);
            const paged = page(result.topHolders, args);
            return {
                enabled: result.enabled,
                totalPointsOutstanding: result.totalPointsOutstanding,
                customersWithPoints: result.customersWithPoints,
                estimatedRedemptionValue:
                    result.estimatedRedemptionValue === null ? null : money(result.estimatedRedemptionValue),
                settings: result.settings,
                ...paged,
                rows: paged.rows.map((h) => ({
                    customer: h.customer,
                    phone: h.phone,
                    points: h.points,
                    lifetimeSpend: money(h.lifetimeSpend),
                })),
            };
        },
    },
];
