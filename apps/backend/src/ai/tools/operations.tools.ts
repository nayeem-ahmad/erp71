import { StorePermission } from '@erp71/shared-types';
import { startOfZonedToday, zonedDateString } from '../../common/tenant-time.util';
import {
    asDate,
    DATE_RANGE_PROPS,
    isoDate,
    MAX_TOOL_ROWS,
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

function projectFollowUp(row: any) {
    return {
        party: row.customer?.name ?? row.lead?.name ?? null,
        due_at: isoTimestamp(row.due_at),
        status: row.status,
        assignee: row.assignee?.name ?? null,
    };
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
        name: 'manufacturing_summary',
        permission: StorePermission.EDIT_PRODUCTS,
        modules: ['manufacturing'],
        description:
            'Production jobs, manufactured-product P&L, or manufacturing analytics. Pass kind: jobs (open and recent ' +
            'jobs), product_pl (cost vs revenue per manufactured product), or analytics (completed volume and cost ' +
            'headlines). Use for "what is in production", "are we making money on what we manufacture".',
        parameters: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: ['jobs', 'product_pl', 'analytics'],
                    description: 'Which manufacturing view to return.',
                },
                status: { type: 'string', description: 'For kind=jobs, restrict to a job status such as IN_PROGRESS.' },
                ...PAGING_PROPS,
            },
            required: ['kind'],
        },
        handler: async (ctx, args, deps) => {
            const kind = args.kind;
            if (kind !== 'jobs' && kind !== 'product_pl' && kind !== 'analytics') {
                return { error: 'kind must be jobs, product_pl, or analytics' };
            }
            if (kind === 'jobs') {
                const limit = Math.min(Math.max(Number(args.limit) || MAX_TOOL_ROWS, 1), MAX_TOOL_ROWS);
                const offset = Math.max(Number(args.offset) || 0, 0);
                const result = await deps.manufacturing.listJobs(
                    ctx.tenantId,
                    Math.floor(offset / limit) + 1,
                    limit,
                    args.status ? String(args.status) : undefined,
                );
                const items = result.items ?? [];
                return {
                    kind,
                    totalRows: result.total ?? items.length,
                    page: result.page ?? 1,
                    rows: items.map((job: any) => ({
                        product: job.recipe?.product?.name ?? job.productName ?? null,
                        sku: job.recipe?.product?.sku ?? job.productSku ?? null,
                        quantity: job.quantity,
                        status: job.status,
                        totalJobCost: money(job.totalJobCost),
                    })),
                };
            }
            if (kind === 'product_pl') {
                const result = await deps.manufacturing.getProductPL(ctx.tenantId);
                const paged = page(result.products ?? [], args);
                return {
                    kind,
                    totals: {
                        quantityProduced: result.totals.quantityProduced,
                        totalProductionCost: money(result.totals.totalProductionCost),
                        revenue: money(result.totals.revenue),
                        grossProfit: money(result.totals.grossProfit),
                    },
                    ...paged,
                    rows: paged.rows.map((p: any) => ({
                        product: p.productName ?? p.product ?? null,
                        sku: p.productSku ?? p.sku ?? null,
                        quantityProduced: p.quantityProduced,
                        productionCost: money(p.totalProductionCost ?? p.productionCost),
                        revenue: money(p.revenue),
                        grossProfit: money(p.grossProfit),
                    })),
                };
            }
            const result = await deps.manufacturing.getAnalytics(ctx.tenantId, ctx.timezone);
            const paged = page(result.volumeTrend ?? [], args);
            return {
                kind,
                totalCompletedJobs: result.totalCompletedJobs,
                totalUnitsProduced: result.totalUnitsProduced,
                totalMaterialCost: money(result.totalMaterialCost),
                avgUnitProductionCost: money(result.avgUnitProductionCost),
                ...paged,
                rows: paged.rows.map((row: any) => ({
                    date: row.date,
                    quantityProduced: row.quantityProduced,
                })),
            };
        },
    },

    {
        name: 'storefront_orders',
        permission: StorePermission.CREATE_SALE,
        modules: ['storefront'],
        description:
            'Online storefront orders: who ordered, status, item count and total. Use for "what online orders came in", ' +
            '"pending web orders", storefront order questions. This is the public shop, not POS sales.',
        parameters: {
            type: 'object',
            properties: { ...STORE_PROP, ...PAGING_PROPS },
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const limit = Math.min(Math.max(Number(args.limit) || MAX_TOOL_ROWS, 1), MAX_TOOL_ROWS);
            const offset = Math.max(Number(args.offset) || 0, 0);
            const pageNum = Math.floor(offset / limit) + 1;
            const result = await deps.storefront.getOrders(ctx.tenantId, pageNum, limit, storeId);
            const items = result.items ?? [];
            return {
                ...(note ? { note } : {}),
                totalRows: result.total ?? items.length,
                page: result.page ?? pageNum,
                rows: items.map((order: any) => ({
                    id: order.id,
                    created_at: isoDate(order.created_at),
                    status: order.status,
                    customer: order.customerName ?? order.customer_name ?? null,
                    phone: order.customerPhone ?? order.customer_phone ?? null,
                    itemCount: Array.isArray(order.items) ? order.items.length : order.itemCount ?? 0,
                    total: money(order.total ?? order.totalAmount),
                })),
            };
        },
    },

    {
        name: 'import_status',
        permission: StorePermission.VIEW_IMPORTS,
        modules: ['imports'],
        description:
            'Open import shipments or the LC register: reference, supplier, status, ETA, LC number and days to ' +
            'expiry. Pass kind: shipments (open shipments unless a status is given) or lc_register (letters of ' +
            'credit, optionally those expiring within withinDays). Use for "what shipments are still open", ' +
            '"which LCs expire soon". Duty figures are not in this tool.',
        parameters: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: ['shipments', 'lc_register'],
                    description: 'Which import view to return.',
                },
                status: {
                    type: 'string',
                    description: 'For kind=shipments, restrict to one shipment status. Omit to list open shipments.',
                },
                withinDays: {
                    type: 'number',
                    description: 'For kind=lc_register, only LCs expiring within this many days.',
                },
                ...STORE_PROP,
                ...PAGING_PROPS,
            },
            required: ['kind'],
        },
        handler: async (ctx, args, deps) => {
            const kind = args.kind;
            if (kind !== 'shipments' && kind !== 'lc_register') {
                return { error: 'kind must be shipments or lc_register' };
            }
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            if (kind === 'shipments') {
                const limit = Math.min(Math.max(Number(args.limit) || MAX_TOOL_ROWS, 1), MAX_TOOL_ROWS);
                const offset = Math.max(Number(args.offset) || 0, 0);
                const status = args.status ? String(args.status) : undefined;
                const result = await deps.imports.findAll(ctx.tenantId, {
                    storeId,
                    page: Math.floor(offset / limit) + 1,
                    limit,
                    ...(status ? { status } : { openOnly: 'true' }),
                });
                const items = result.items ?? [];
                return {
                    ...(note ? { note } : {}),
                    kind,
                    totalRows: result.total ?? items.length,
                    page: result.page ?? 1,
                    rows: items.map((shipment: any) => ({
                        reference_number: shipment.reference_number,
                        supplier: shipment.supplier?.name ?? (typeof shipment.supplier === 'string' ? shipment.supplier : null),
                        status: shipment.status,
                        eta: isoDate(shipment.eta),
                        lc_number: shipment.lc_number ?? null,
                    })),
                };
            }
            const withinDays = args.withinDays === undefined || args.withinDays === null
                ? undefined
                : Number(args.withinDays);
            const rows = await deps.imports.lcRegister(
                ctx.tenantId,
                Number.isFinite(withinDays) ? withinDays : undefined,
                storeId,
            );
            const paged = page(rows ?? [], args);
            return {
                ...(note ? { note } : {}),
                kind,
                ...paged,
                rows: paged.rows.map((row: any) => ({
                    lc_number: row.lc_number,
                    supplier: row.supplier ?? null,
                    status: row.status,
                    expiry: isoDate(row.lc_expiry_date ?? row.expiry),
                    daysToExpiry: row.daysToExpiry ?? row.days_to_expiry ?? null,
                    invoice_value_bdt: money(row.invoice_value_bdt),
                })),
            };
        },
    },

    {
        name: 'crm_pipeline',
        permission: StorePermission.VIEW_LEADS,
        modules: ['crm'],
        description:
            'Lead lists, campaigns, and follow-ups. Pass kind: leads (open counts plus matching rows), campaigns ' +
            '(name, created date, recipient count), or follow_ups (due today by default, or overdue). Use for ' +
            '"how many open leads", "what campaigns did we send", "which follow-ups are overdue". ' +
            'open_pipeline kind=leads is only the committed-but-unfinished count; this tool is the list.',
        parameters: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: ['leads', 'campaigns', 'follow_ups'],
                    description: 'Which CRM view to return.',
                },
                search: { type: 'string', description: 'For kind=leads, match name, mobile or email.' },
                status: { type: 'string', description: 'For kind=leads, restrict to one lead status.' },
                scope: {
                    type: 'string',
                    enum: ['today', 'overdue'],
                    description: 'For kind=follow_ups. Omit for due today.',
                },
                ...PAGING_PROPS,
            },
            required: ['kind'],
        },
        handler: async (ctx, args, deps) => {
            const kind = args.kind;
            if (kind !== 'leads' && kind !== 'campaigns' && kind !== 'follow_ups') {
                return { error: 'kind must be leads, campaigns, or follow_ups' };
            }
            const limit = Math.min(Math.max(Number(args.limit) || MAX_TOOL_ROWS, 1), MAX_TOOL_ROWS);
            const offset = Math.max(Number(args.offset) || 0, 0);
            const pageNum = Math.floor(offset / limit) + 1;

            if (kind === 'leads') {
                const [summary, result] = await Promise.all([
                    deps.crmLeads.getStatusSummary(ctx.tenantId),
                    deps.crmLeads.findAll(ctx.tenantId, {
                        timezone: ctx.timezone,
                        search: args.search ? String(args.search) : undefined,
                        status: args.status ? String(args.status) : undefined,
                        page: pageNum,
                        limit,
                    }),
                ]);
                const items = result.items ?? [];
                return {
                    kind,
                    counts: summary.counts,
                    open: summary.open,
                    totalRows: result.total ?? items.length,
                    page: result.page ?? pageNum,
                    rows: items.map((lead: any) => ({
                        name: lead.name,
                        status: lead.status,
                        mobile: lead.mobile ?? null,
                        source: lead.sourceOption?.name ?? lead.source ?? null,
                        next_step_date: isoDate(lead.next_step_date),
                    })),
                };
            }

            if (kind === 'campaigns') {
                const result = await deps.crmCampaigns.findAll(ctx.tenantId, {
                    timezone: ctx.timezone,
                    page: pageNum,
                    limit,
                });
                const items = result.items ?? [];
                return {
                    kind,
                    totalRows: result.total ?? items.length,
                    page: result.page ?? pageNum,
                    rows: items.map((campaign: any) => ({
                        name: campaign.name,
                        created_at: isoDate(campaign.created_at),
                        recipientCount: campaign._count?.recipients ?? campaign.recipientCount ?? 0,
                    })),
                };
            }

            const summary = await deps.crmFollowUps.getTodaySummary(ctx.tenantId, ctx.timezone);
            const scope = args.scope === 'overdue' ? 'overdue' : 'today';
            if (scope === 'today') {
                const result = await deps.crmFollowUps.findAll(ctx.tenantId, {
                    dueToday: true,
                    timezone: ctx.timezone,
                    page: pageNum,
                    limit,
                });
                const items = result.items ?? [];
                return {
                    kind,
                    scope,
                    dueToday: summary.dueToday,
                    overdue: summary.overdue,
                    total: summary.total,
                    totalRows: result.total ?? items.length,
                    page: result.page ?? pageNum,
                    rows: items.map(projectFollowUp),
                };
            }

            const result = await deps.crmFollowUps.findAll(ctx.tenantId, {
                status: 'PENDING',
                timezone: ctx.timezone,
                limit: 100,
            });
            const todayStart = startOfZonedToday(ctx.timezone);
            const overdueRows = (result.items ?? []).filter((row: any) => {
                const due = row.due_at instanceof Date ? row.due_at : new Date(row.due_at);
                return !Number.isNaN(due.getTime()) && due < todayStart;
            });
            const paged = page(overdueRows, args);
            return {
                kind,
                scope,
                dueToday: summary.dueToday,
                overdue: summary.overdue,
                total: summary.total,
                ...paged,
                rows: paged.rows.map(projectFollowUp),
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
