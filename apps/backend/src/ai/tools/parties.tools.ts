import { StorePermission } from '@erp71/shared-types';
import { isoDate, money, page, PAGING_PROPS, pct, type ChatTool } from './types';

export const PARTY_TOOLS: ChatTool[] = [
    {
        name: 'customer_lookup',
        permission: StorePermission.VIEW_CRM_INTERACTIONS,
        modules: ['retail', 'crm'],
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
            const pageResult = await deps.customers.findAll(ctx.tenantId, {
                search: String(args.search),
                limit: 5,
                timezone: ctx.timezone,
            });
            const matches = pageResult.items ?? [];
            if (matches.length === 0) {
                return { matchCount: 0, rows: [], note: `No customer matched "${args.search}".` };
            }
            const analytics = await Promise.all(
                matches.slice(0, 5).map((c: any) => deps.customers.getAnalytics(ctx.tenantId, c.id)),
            );
            return {
                matchCount: matches.length,
                rows: analytics.map((a: any, i: number) => ({
                    id: matches[i].id,
                    name: matches[i].name,
                    phone: matches[i].phone ?? null,
                    totalSpent: money(a.total_spent),
                    orderCount: a.order_count,
                    avgOrderValue: money(a.avg_order_value),
                    dueBalance: money(a.due_balance),
                    loyaltyPoints: a.loyalty_points,
                    segment: a.segment,
                    lastPurchaseDate: isoDate(a.last_purchase_date),
                    daysSinceLastPurchase: a.days_since_last_purchase,
                })),
            };
        },
    },

    {
        name: 'customer_purchase_history',
        permission: StorePermission.VIEW_CRM_INTERACTIONS,
        modules: ['retail', 'crm'],
        description:
            'The individual invoices one customer has bought, newest first. Use after customer_lookup when asked ' +
            '"what did they buy", "when did they last order", or to itemise a customer\'s spend. ' +
            'Pass the customerId returned by customer_lookup or resolve_entity.',
        parameters: {
            type: 'object',
            properties: {
                customerId: { type: 'string', description: 'The customer id, from customer_lookup or resolve_entity.' },
                ...PAGING_PROPS,
            },
            required: ['customerId'],
        },
        handler: async (ctx, args, deps) => {
            const history: any = await deps.customers.getPurchaseHistory(ctx.tenantId, String(args.customerId), {
                limit: 100,
            });
            const paged = page(history.data ?? [], args);
            return {
                ...paged,
                // `total` is the customer's whole history; `totalRows` is only
                // what this call fetched, so say which is which.
                lifetimeInvoiceCount: history.total,
                rows: paged.rows.map((r: any) => ({
                    invoice: r.serial_number ?? r.reference_number ?? r.id,
                    date: isoDate(r.sale_date ?? r.created_at),
                    amount: money(r.total_amount),
                    paid: money(r.amount_paid),
                    outstanding: money(Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0)),
                    itemCount: Array.isArray(r.items) ? r.items.length : null,
                })),
            };
        },
    },

    {
        name: 'receivables_aging',
        permission: StorePermission.VIEW_CUSTOMER_CREDIT,
        modules: ['retail', 'crm'],
        description:
            'Outstanding customer credit (money owed TO the business), bucketed by age: 0-30, 31-60, 61-90 and 90+ days. ' +
            'Use for "who owes us money", receivables, dues and overdue questions.',
        parameters: { type: 'object', properties: { ...PAGING_PROPS } },
        handler: async (ctx, args, deps) => {
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
            const paged = page([...rows].sort((a: any, b: any) => b.total - a.total), args);
            return {
                totalOutstanding: money(totals.total),
                buckets: {
                    days_0_30: money(totals.bucket_0_30),
                    days_31_60: money(totals.bucket_31_60),
                    days_61_90: money(totals.bucket_61_90),
                    days_90_plus: money(totals.bucket_90_plus),
                },
                customersWithDues: rows.length,
                ...paged,
                rows: paged.rows.map((r: any) => ({
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
        name: 'payables_aging',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['accounting'],
        description:
            'Money the business OWES suppliers, aged into current, 31-60, 61-90 and 90+ day buckets, from the ledger. ' +
            'Use for "who do we owe", "what bills are overdue", payables and creditor questions. ' +
            'This is the mirror of receivables_aging — do not confuse the two.',
        parameters: {
            type: 'object',
            properties: {
                asOfDate: { type: 'string', description: 'Age the balances as at this date (YYYY-MM-DD). Defaults to today.' },
                ...PAGING_PROPS,
            },
        },
        handler: async (ctx, args, deps) => {
            const result: any = await deps.accounting.getApAging(ctx.tenantId, { asOfDate: args.asOfDate });
            const paged = page(
                [...(result.accounts ?? [])].sort((a: any, b: any) => b.balance - a.balance),
                args,
            );
            return {
                asOf: result.as_of,
                totalOwed: money(result.totals?.balance),
                buckets: {
                    current: money(result.totals?.current),
                    days_31_60: money(result.totals?.overdue_31_60),
                    days_61_90: money(result.totals?.overdue_61_90),
                    days_90_plus: money(result.totals?.overdue_90_plus),
                },
                note: result.note,
                ...paged,
                rows: paged.rows.map((a: any) => ({
                    account: a.name,
                    balance: money(a.balance),
                    current: money(a.buckets?.current),
                    days_31_60: money(a.buckets?.overdue_31_60),
                    days_61_90: money(a.buckets?.overdue_61_90),
                    days_90_plus: money(a.buckets?.overdue_90_plus),
                })),
            };
        },
    },

    {
        name: 'supplier_lookup',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail', 'inventory'],
        description:
            'What the business owes one supplier and which of their bills are still open, with any unallocated advance. ' +
            'Use for "how much do we owe X", "what bills are pending with X". Search by supplier name.',
        parameters: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Supplier name or phone number to search for.' },
                ...PAGING_PROPS,
            },
            required: ['search'],
        },
        handler: async (ctx, args, deps) => {
            const matches = await deps.data.resolveEntity(ctx.tenantId, 'supplier', String(args.search), 5);
            if (matches.length === 0) {
                return { matchCount: 0, rows: [], note: `No supplier matched "${args.search}".` };
            }

            // Only the best match gets the full bill list: pulling open bills for
            // five suppliers is five more queries and a much larger payload for a
            // question that named one supplier.
            const summary: any = await deps.suppliers.getBillingSummary(ctx.tenantId, matches[0].id);
            const paged = page(summary.open_bills ?? [], args);

            return {
                matchCount: matches.length,
                otherMatches: matches.slice(1).map((m) => m.label),
                supplier: summary.supplier?.name,
                dueBalance: money(summary.due_balance),
                unallocatedAdvance: money(summary.unallocated_advance),
                openBillCount: (summary.open_bills ?? []).length,
                ...paged,
                rows: paged.rows.map((b: any) => ({
                    bill: b.purchase_number,
                    date: isoDate(b.created_at),
                    total: money(b.total_amount),
                    paid: money(b.paid_amount),
                    balanceDue: money(b.balance_due),
                    status: b.payment_status,
                })),
            };
        },
    },

    {
        name: 'customer_segments',
        permission: StorePermission.VIEW_CRM_INTERACTIONS,
        modules: ['retail', 'crm'],
        description:
            'How the customer base splits across segments (VIP, Regular, and so on) with counts and shares. ' +
            'Use for "how many VIP customers do we have", customer mix and base-composition questions.',
        parameters: { type: 'object', properties: {} },
        handler: async (ctx, _args, deps) => {
            const result: any = await deps.customers.getSegmentStats(ctx.tenantId);
            return {
                totalCustomers: result.total,
                rows: (result.breakdown ?? []).map((r: any) => ({
                    segment: r.segment,
                    count: r.count,
                    sharePct: pct(r.percentage),
                })),
            };
        },
    },
];
