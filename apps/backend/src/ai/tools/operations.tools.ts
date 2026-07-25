import { StorePermission } from '@erp71/shared-types';
import { DATE_RANGE_PROPS, money, page, PAGING_PROPS, pct, resolveStoreId, STORE_PROP, type ChatTool } from './types';

export const OPERATIONS_TOOLS: ChatTool[] = [
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
