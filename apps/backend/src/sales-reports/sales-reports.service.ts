import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    addDays,
    bucketLabel,
    bucketStart,
    percentChange,
    resolveComparisonRange,
    toDhakaParts,
    WEEKDAY_NAMES,
    type DateRange,
    type Granularity,
} from '../common/period.util';
import {
    GetBranchReportDto,
    GetConsolidatedReportDto,
    GetCostCoverageDto,
    GetCustomerRetentionDto,
    GetGrossProfitBySalespersonDto,
    GetMarginBridgeDto,
    GetMarginExceptionsDto,
    GetMonthlySalesByCustomerDto,
    GetReturnsAnalysisDto,
    GetSalesBreakdownDto,
    GetSalesByCategoryDto,
    GetSalesByCustomerDto,
    GetSalesByProductDto,
    GetSalesSummaryDto,
    GetSalesTrendDto,
    GetTopMoversDto,
    type SalesBreakdownDimension,
} from './sales-reports.dto';
import {
    groupMargin,
    marginBridge,
    returnLines,
    saleLines,
    summariseMargin,
    type MarginLine,
    type ReturnForMargin,
    type SaleForMargin,
} from './gross-profit.utils';

/**
 * Which figures an aggregate was built from. Line-item and invoice totals do
 * not agree when an invoice carries an order-level discount, and payment
 * records do not agree with either when an invoice is only part-paid — so every
 * breakdown says which one it used rather than leaving the caller to assume.
 */
export type RevenueBasis = 'sale_line_items' | 'invoice_totals' | 'payment_records';

/**
 * Grouping keys for the two buckets that have no id of their own. Sentinels
 * rather than null keys, because a Map keyed on null collides with a product
 * that genuinely has no group.
 */
const WALK_IN_KEY = '__walkin__';
const UNCATEGORIZED_KEY = '__uncategorized__';
const UNATTRIBUTED_KEY = '__unattributed__';
const WALK_IN_CUSTOMER = { id: null, name: 'Walk-in Customer', phone: null, customer_code: null };

/** Coverage for a bucket that produced no margin lines at all. */
const EMPTY_COVERAGE = {
    costedLines: 0,
    uncostedLines: 0,
    costedRevenue: 0,
    uncostedRevenue: 0,
    costedRevenuePct: null as number | null,
};

export interface BreakdownRow {
    key: string;
    label: string;
    revenue: number;
    orders: number;
    units: number | null;
    cogs: number | null;
}

export interface BreakdownAggregate {
    basis: RevenueBasis;
    rows: BreakdownRow[];
    totalRevenue: number;
    totalOrders: number;
}

@Injectable()
export class SalesReportsService {
    constructor(private db: DatabaseService) {}

    /**
     * Sales and returns in a window, shaped for the margin helpers.
     *
     * Every gross-profit report loads the same two things, and each one used to
     * write its own query — which is how three of them ended up folding an
     * uncosted line in as free stock while a fourth handled it correctly. One
     * loader, one shape, one set of rules on top.
     */
    private async loadMarginSource(
        tenantId: string,
        query: { from?: string; to?: string; storeId?: string },
    ): Promise<{ sales: SaleForMargin[]; returns: ReturnForMargin[]; rawSales: any[]; rawReturns: any[] }> {
        const saleWhere = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            ...(query.storeId ? { store_id: query.storeId } : {}),
            ...buildSaleDateWindow(query.from, query.to),
        };

        const [rawSales, rawReturns] = await Promise.all([
            this.db.sale.findMany({
                where: saleWhere,
                select: {
                    id: true,
                    serial_number: true,
                    total_amount: true,
                    sale_date: true,
                    store_id: true,
                    counter_id: true,
                    created_by: true,
                    customer_id: true,
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    items: {
                        select: {
                            product_id: true,
                            quantity: true,
                            price_at_sale: true,
                            unit_cost_at_sale: true,
                        },
                    },
                },
                orderBy: { sale_date: 'asc' },
            }),
            this.db.salesReturn.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...buildReturnDateWindow(query.from, query.to),
                },
                select: {
                    id: true,
                    created_at: true,
                    store_id: true,
                    total_refund: true,
                    // The customer who is getting the refund is the one on the
                    // original sale — a return row carries no customer of its
                    // own, so per-customer margin has to reach through it.
                    sale: { select: { customer_id: true, counter_id: true, created_by: true } },
                    items: {
                        select: {
                            product_id: true,
                            quantity: true,
                            refund_amount: true,
                            unit_cost_at_return: true,
                        },
                    },
                },
            }),
        ]);

        return {
            rawSales,
            rawReturns,
            sales: rawSales.map((sale: any) => ({
                id: sale.id,
                totalAmount: Number(sale.total_amount),
                items: sale.items.map((item: any) => ({
                    productId: item.product_id,
                    quantity: item.quantity,
                    priceAtSale: Number(item.price_at_sale),
                    unitCostAtSale: item.unit_cost_at_sale === null ? null : Number(item.unit_cost_at_sale),
                })),
            })),
            returns: rawReturns.map((ret: any) => ({
                id: ret.id,
                items: ret.items.map((item: any) => ({
                    productId: item.product_id,
                    quantity: item.quantity,
                    refundAmount: Number(item.refund_amount),
                    unitCostAtReturn:
                        item.unit_cost_at_return === null ? null : Number(item.unit_cost_at_return),
                })),
            })),
        };
    }

    async getSalesSummary(tenantId: string, query: GetSalesSummaryDto) {
        const { sales, returns, rawSales, rawReturns } = await this.loadMarginSource(tenantId, query);

        const totalRevenue = rawSales.reduce((sum: number, s: any) => sum + Number(s.total_amount), 0);
        const totalReturns = rawReturns.reduce((sum: number, r: any) => sum + Number(r.total_refund), 0);
        const transactionCount = rawSales.length;
        const avgOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;

        // Day is taken in Dhaka time, not UTC: a sale rung up at 1am local falls
        // on the previous day under toISOString, which puts the evening's takings
        // in the wrong row for every tenant this product serves.
        const dayOf = (date: Date) => toDhakaParts(date).date;
        const saleDay = new Map(rawSales.map((s: any) => [s.id, dayOf(s.sale_date)]));
        const returnDay = new Map(rawReturns.map((r: any) => [r.id, dayOf(r.created_at)]));

        const lines = [
            ...saleLines(sales, (_item, sale) => ({
                key: saleDay.get(sale.id) ?? '',
                label: saleDay.get(sale.id) ?? '',
            })),
        ];
        // Returns are keyed by their own date, so a refund lands on the day it
        // was given rather than the day of the sale it reverses.
        for (const ret of returns) {
            const day = returnDay.get(ret.id) ?? '';
            lines.push(
                ...returnLines([ret], () => ({ key: day, label: day })),
            );
        }

        const totals = summariseMargin(lines);
        const perDay = groupMargin(lines);
        const transactionsByDay = new Map<string, number>();
        for (const day of saleDay.values()) {
            transactionsByDay.set(day, (transactionsByDay.get(day) ?? 0) + 1);
        }

        // Invoice totals and refunds per day, kept alongside the margin figures
        // because the trend report buckets on them and a reader comparing this
        // to the till expects to see both the gross take and what went back.
        const grossByDay = new Map<string, number>();
        for (const sale of rawSales as any[]) {
            const day = saleDay.get(sale.id)!;
            grossByDay.set(day, (grossByDay.get(day) ?? 0) + Number(sale.total_amount));
        }
        const refundsByDay = new Map<string, number>();
        for (const ret of rawReturns as any[]) {
            const day = returnDay.get(ret.id)!;
            refundsByDay.set(day, (refundsByDay.get(day) ?? 0) + Number(ret.total_refund));
        }

        // Revenue comes from invoice totals, margin from allocated lines.
        //
        // The invoice is what the customer was charged and is authoritative for
        // the top line; the lines exist to attribute that revenue to products
        // and costs. `discountRatio` makes the two agree, so this is not two
        // answers to one question — but where they could ever diverge, the
        // invoice is the one that matches the till.
        const dayKeys = new Set([...perDay.map((d) => d.key), ...grossByDay.keys(), ...refundsByDay.keys()]);
        const marginByDay = new Map(perDay.map((d) => [d.key, d]));

        const rows = [...dayKeys]
            .map((date) => {
                const margin = marginByDay.get(date);
                const grossRevenue = grossByDay.get(date) ?? 0;
                const returnsForDay = refundsByDay.get(date) ?? 0;
                return {
                    date,
                    transactions: transactionsByDay.get(date) ?? 0,
                    grossRevenue,
                    returns: returnsForDay,
                    netRevenue: grossRevenue - returnsForDay,
                    cogs: margin?.cogs ?? 0,
                    costedRevenue: margin?.coverage.costedRevenue ?? 0,
                    grossProfit: margin?.grossProfit ?? null,
                    grossMarginPct: margin?.grossMarginPct ?? null,
                    coverage: margin?.coverage ?? EMPTY_COVERAGE,
                };
            })
            .sort((a, b) => a.date.localeCompare(b.date));

        return {
            summary: {
                totalRevenue,
                totalReturns,
                netRevenue: totalRevenue - totalReturns,
                transactionCount,
                avgOrderValue,
                totalCogs: totals.cogs,
                grossProfit: totals.grossProfit,
                grossMarginPct: totals.grossMarginPct,
                coverage: totals.coverage,
            },
            rows,
        };
    }

    /**
     * Gross profit per product. Groups the same lines every other margin report
     * is built from, so the totals here reconcile with the summary above.
     */
    async getGrossProfitByProduct(tenantId: string, query: GetSalesByProductDto) {
        const { sales, returns } = await this.loadMarginSource(tenantId, query);
        const names = await this.productNames(tenantId, [...sales, ...returns]);
        const label = (productId: string) => names.get(productId) ?? 'Unknown product';

        const lines = [
            ...saleLines(sales, (item) => ({ key: item.productId, label: label(item.productId) })),
            ...returnLines(returns, (item) => ({ key: item.productId, label: label(item.productId) })),
        ];

        const groups = groupMargin(lines);
        return {
            summary: summariseMargin(lines),
            rows: groups.map((g) => ({
                productId: g.key,
                productName: g.label,
                unitsSold: g.units,
                revenue: g.netRevenue,
                cogs: g.cogs,
                grossProfit: g.grossProfit,
                grossMarginPct: g.grossMarginPct,
                coverage: g.coverage,
            })),
        };
    }

    /** Product names for every product touched by these sales and returns. */
    private async productNames(
        tenantId: string,
        sources: Array<{ items: Array<{ productId: string }> }>,
    ): Promise<Map<string, string>> {
        const ids = [...new Set(sources.flatMap((s) => s.items.map((i) => i.productId)))];
        if (ids.length === 0) return new Map();
        const products = await this.db.product.findMany({
            where: { tenant_id: tenantId, id: { in: ids } },
            select: { id: true, name: true },
        });
        return new Map(products.map((p) => [p.id, p.name]));
    }

    async getSalesByProduct(tenantId: string, query: GetSalesByProductDto) {
        const dateFilter = buildSaleDateWindow(query.from, query.to);

        const saleItems = await this.db.saleItem.findMany({
            where: {
                sale: {
                    tenant_id: tenantId,
                    status: 'COMPLETED',
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...dateFilter,
                },
                ...(query.groupId || query.subgroupId
                    ? {
                          product: {
                              ...(query.groupId ? { group_id: query.groupId } : {}),
                              ...(query.subgroupId ? { subgroup_id: query.subgroupId } : {}),
                          },
                      }
                    : {}),
            },
            select: {
                product_id: true,
                quantity: true,
                price_at_sale: true,
                unit_cost_at_sale: true,
                product: {
                    include: {
                        group: true,
                        subgroup: true,
                    },
                },
            },
        });

        // Aggregate by product
        const productMap = new Map<
            string,
            {
                product: (typeof saleItems)[0]['product'];
                unitsSold: number;
                revenue: number;
                cogs: number;
            }
        >();

        for (const item of saleItems) {
            const existing = productMap.get(item.product_id) ?? {
                product: item.product,
                unitsSold: 0,
                revenue: 0,
                cogs: 0,
            };
            existing.unitsSold += item.quantity;
            existing.revenue += item.quantity * Number(item.price_at_sale);
            existing.cogs += item.unit_cost_at_sale !== null
                ? item.quantity * Number(item.unit_cost_at_sale)
                : 0;
            productMap.set(item.product_id, existing);
        }

        const rows = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
        const totalUnitsSold = rows.reduce((sum, r) => sum + r.unitsSold, 0);
        const totalCogs = rows.reduce((sum, r) => sum + r.cogs, 0);
        const totalGrossProfit = totalRevenue - totalCogs;

        return {
            summary: {
                totalRevenue,
                totalUnitsSold,
                productCount: rows.length,
                totalCogs,
                grossProfit: totalGrossProfit,
                grossMarginPct: totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0,
            },
            rows: rows.map((r) => {
                const grossProfit = r.revenue - r.cogs;
                return {
                    ...r,
                    revenueShare: totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0,
                    grossProfit,
                    grossMarginPct: r.revenue > 0 ? (grossProfit / r.revenue) * 100 : 0,
                };
            }),
        };
    }

    async getSalesByCategory(tenantId: string, query: GetSalesByCategoryDto) {
        const { sales, returns } = await this.loadMarginSource(tenantId, query);

        // Which group each product belongs to. Uncategorised products are a
        // real bucket, not an error — most catalogs have a long tail of them.
        const productIds = [
            ...new Set([...sales, ...returns].flatMap((s) => s.items.map((i) => i.productId))),
        ];
        const products = productIds.length
            ? await this.db.product.findMany({
                  where: { tenant_id: tenantId, id: { in: productIds } },
                  select: { id: true, group_id: true, group: { select: { id: true, name: true } } },
              })
            : [];
        const groupOf = new Map(
            products.map((p) => [
                p.id,
                { key: p.group_id ?? UNCATEGORIZED_KEY, label: p.group?.name ?? 'Uncategorized' },
            ]),
        );
        const keyOf = (item: { productId: string }) =>
            groupOf.get(item.productId) ?? { key: UNCATEGORIZED_KEY, label: 'Uncategorized' };

        const lines = [...saleLines(sales, keyOf), ...returnLines(returns, keyOf)];
        const totals = summariseMargin(lines);

        // Sorted by revenue rather than gross profit: this one feeds a share-of-
        // sales chart, where ordering by profit would make the slices disagree
        // with their own labels.
        const sorted = groupMargin(lines).sort((a, b) => b.netRevenue - a.netRevenue);

        const TOP_N = 5;
        const toRow = (group: (typeof sorted)[number], categoryId: string | null) => ({
            categoryId,
            categoryName: group.label,
            revenue: group.netRevenue,
            cogs: group.cogs,
            grossProfit: group.grossProfit,
            grossMarginPct: group.grossMarginPct,
            units: group.units,
            coverage: group.coverage,
            share: totals.netRevenue > 0 ? (group.netRevenue / totals.netRevenue) * 100 : 0,
        });

        const rows = sorted
            .slice(0, TOP_N)
            .map((group) => toRow(group, group.key === UNCATEGORIZED_KEY ? null : group.key));

        const rest = sorted.slice(TOP_N);
        if (rest.length > 0) {
            // "Other" is summarised from its own lines rather than by adding up
            // the group rows, so its margin and coverage are computed over the
            // same rules as everything else instead of averaging averages.
            const restKeys = new Set(rest.map((g) => g.key));
            const restLines = lines.filter((l) => restKeys.has(l.key));
            const otherTotals = summariseMargin(restLines);
            rows.push({
                categoryId: null,
                categoryName: 'Other',
                revenue: otherTotals.netRevenue,
                cogs: otherTotals.cogs,
                grossProfit: otherTotals.grossProfit,
                grossMarginPct: otherTotals.grossMarginPct,
                units: restLines.reduce((sum, l) => sum + l.quantity, 0),
                coverage: otherTotals.coverage,
                share: totals.netRevenue > 0 ? (otherTotals.netRevenue / totals.netRevenue) * 100 : 0,
            });
        }

        return {
            summary: {
                totalRevenue: totals.netRevenue,
                categoryCount: sorted.length,
                cogs: totals.cogs,
                grossProfit: totals.grossProfit,
                grossMarginPct: totals.grossMarginPct,
                coverage: totals.coverage,
            },
            rows,
        };
    }

    async getConsolidatedReport(tenantId: string, query: GetConsolidatedReportDto) {
        const dateFilter = buildSaleDateWindow(query.from, query.to);

        // Fetch all completed sales in the period with store and items
        const sales = await this.db.sale.findMany({
            where: {
                tenant_id: tenantId,
                status: 'COMPLETED',
                ...dateFilter,
            },
            select: {
                id: true,
                store_id: true,
                total_amount: true,
                store: { select: { id: true, name: true } },
                items: {
                    select: {
                        product_id: true,
                        quantity: true,
                        price_at_sale: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });

        if (sales.length === 0) {
            return {
                period: { from: query.from ?? null, to: query.to ?? null },
                overall: {
                    revenue: 0,
                    transactions: 0,
                    avg_order: 0,
                    top_product: null,
                },
                by_store: [],
            };
        }

        // Aggregate by store
        const storeMap = new Map<
            string,
            { store_name: string; revenue: number; transactions: number }
        >();

        for (const sale of sales) {
            const entry = storeMap.get(sale.store_id) ?? {
                store_name: sale.store.name,
                revenue: 0,
                transactions: 0,
            };
            entry.revenue += Number(sale.total_amount);
            entry.transactions += 1;
            storeMap.set(sale.store_id, entry);
        }

        // Find top product by total revenue across all sales
        const productRevMap = new Map<string, { name: string; revenue: number }>();
        for (const sale of sales) {
            for (const item of sale.items) {
                const itemRevenue = item.quantity * Number(item.price_at_sale);
                const entry = productRevMap.get(item.product_id) ?? {
                    name: item.product.name,
                    revenue: 0,
                };
                entry.revenue += itemRevenue;
                productRevMap.set(item.product_id, entry);
            }
        }

        let topProduct: string | null = null;
        let topProductRevenue = 0;
        for (const [, prod] of productRevMap) {
            if (prod.revenue > topProductRevenue) {
                topProductRevenue = prod.revenue;
                topProduct = prod.name;
            }
        }

        const totalRevenue = Array.from(storeMap.values()).reduce((sum, s) => sum + s.revenue, 0);
        const totalTransactions = Array.from(storeMap.values()).reduce(
            (sum, s) => sum + s.transactions,
            0,
        );
        const avgOrder = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

        const byStore = Array.from(storeMap.entries())
            .map(([store_id, data]) => ({
                store_id,
                store_name: data.store_name,
                revenue: data.revenue,
                transactions: data.transactions,
                avg_order: data.transactions > 0 ? data.revenue / data.transactions : 0,
                revenue_share: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
            }))
            .sort((a, b) => b.revenue - a.revenue);

        return {
            period: { from: query.from ?? null, to: query.to ?? null },
            overall: {
                revenue: totalRevenue,
                transactions: totalTransactions,
                avg_order: avgOrder,
                top_product: topProduct,
            },
            by_store: byStore,
        };
    }
    /**
     * Revenue and gross profit per customer.
     *
     * The gross-profit half is the point: a customer on negotiated wholesale
     * pricing can be among the largest by revenue and still be sold to at a
     * loss, and until this carried COGS there was no report in the system that
     * would say so.
     */
    async getSalesByCustomer(tenantId: string, query: GetSalesByCustomerDto) {
        const { sales, returns, rawSales, rawReturns } = await this.loadMarginSource(tenantId, query);

        const customerOf = new Map<string, { key: string; label: string; customer: any }>();
        const orderCounts = new Map<string, number>();
        for (const sale of rawSales as any[]) {
            const key = sale.customer_id ?? WALK_IN_KEY;
            if (!customerOf.has(sale.id)) {
                customerOf.set(sale.id, {
                    key,
                    label: sale.customer?.name ?? 'Walk-in Customer',
                    customer: sale.customer ?? WALK_IN_CUSTOMER,
                });
            }
            orderCounts.set(key, (orderCounts.get(key) ?? 0) + 1);
        }
        // A refund belongs to whoever bought the goods, so returns reach through
        // to the original sale's customer. A parentless return has none, and
        // lands on walk-in alongside the cash sales it resembles.
        const returnCustomer = new Map<string, { key: string; label: string; customer: any }>();
        for (const ret of rawReturns as any[]) {
            const key = ret.sale?.customer_id ?? WALK_IN_KEY;
            returnCustomer.set(ret.id, {
                key,
                label: 'Walk-in Customer',
                customer: WALK_IN_CUSTOMER,
            });
        }

        const lines: MarginLine[] = [];
        for (const sale of sales) {
            const owner = customerOf.get(sale.id)!;
            lines.push(...saleLines([sale], () => ({ key: owner.key, label: owner.label })));
        }
        for (const ret of returns) {
            const owner = returnCustomer.get(ret.id)!;
            lines.push(...returnLines([ret], () => ({ key: owner.key, label: owner.label })));
        }

        // Customer records for labelling, including customers who only appear on
        // the return side of the window.
        const customerById = new Map<string, any>();
        for (const entry of customerOf.values()) {
            if (entry.customer?.id) customerById.set(entry.key, entry.customer);
        }
        const missing = [...new Set(lines.map((l) => l.key))].filter(
            (key) => key !== WALK_IN_KEY && !customerById.has(key),
        );
        if (missing.length > 0) {
            const rows = await this.db.customer.findMany({
                where: { tenant_id: tenantId, id: { in: missing } },
                select: { id: true, name: true, phone: true, customer_code: true },
            });
            for (const row of rows) customerById.set(row.id, row);
        }

        const totals = summariseMargin(lines);
        const groups = groupMargin(lines);

        const rows = groups.map((group) => {
            const customer = group.key === WALK_IN_KEY ? WALK_IN_CUSTOMER : customerById.get(group.key) ?? null;
            const orderCount = orderCounts.get(group.key) ?? 0;
            return {
                customer,
                orderCount,
                revenue: group.netRevenue,
                avgOrderValue: orderCount > 0 ? group.netRevenue / orderCount : 0,
                cogs: group.cogs,
                grossProfit: group.grossProfit,
                grossMarginPct: group.grossMarginPct,
                coverage: group.coverage,
            };
        });

        const totalOrders = rawSales.length;

        return {
            summary: {
                totalRevenue: totals.netRevenue,
                totalOrders,
                customerCount: rows.length,
                avgOrderValue: totalOrders > 0 ? totals.netRevenue / totalOrders : 0,
                cogs: totals.cogs,
                grossProfit: totals.grossProfit,
                grossMarginPct: totals.grossMarginPct,
                coverage: totals.coverage,
            },
            rows,
        };
    }

    async getBranchReport(tenantId: string, query: GetBranchReportDto) {
        const saleDateFilter = buildSaleDateWindow(query.from, query.to);
        const returnDateFilter = buildReturnDateWindow(query.from, query.to);

        const store = await this.db.store.findFirst({
            where: { id: query.storeId, tenant_id: tenantId },
        });

        if (!store) {
            throw new NotFoundException('Store not found');
        }

        const [branchSales, branchReturns, companyTotals, saleItems] = await Promise.all([
            this.db.sale.findMany({
                where: { tenant_id: tenantId, status: 'COMPLETED', store_id: query.storeId, ...saleDateFilter },
                select: { id: true, total_amount: true, sale_date: true },
            }),
            this.db.salesReturn.findMany({
                where: { tenant_id: tenantId, store_id: query.storeId, ...returnDateFilter },
                select: { total_refund: true, created_at: true },
            }),
            this.db.sale.aggregate({
                where: { tenant_id: tenantId, status: 'COMPLETED', ...saleDateFilter },
                _sum: { total_amount: true },
                _count: { id: true },
            }),
            this.db.saleItem.findMany({
                where: {
                    sale: { tenant_id: tenantId, status: 'COMPLETED', store_id: query.storeId, ...saleDateFilter },
                },
                select: {
                    product_id: true,
                    quantity: true,
                    price_at_sale: true,
                    unit_cost_at_sale: true,
                    product: { select: { id: true, name: true } },
                },
            }),
        ]);

        const branchRevenue = branchSales.reduce((sum, s) => sum + Number(s.total_amount), 0);
        const branchReturnsTotal = branchReturns.reduce((sum, r) => sum + Number(r.total_refund), 0);
        const branchTransactions = branchSales.length;
        const companyRevenue = Number(companyTotals._sum.total_amount ?? 0);
        const revenueShare = companyRevenue > 0 ? (branchRevenue / companyRevenue) * 100 : 0;
        const branchNetRevenue = branchRevenue - branchReturnsTotal;
        const branchCogs = saleItems.reduce(
            (sum, i) => sum + (i.unit_cost_at_sale !== null ? Number(i.unit_cost_at_sale) * i.quantity : 0),
            0,
        );
        const branchGrossProfit = branchNetRevenue - branchCogs;

        const productMap = new Map<string, { name: string; unitsSold: number; revenue: number; cogs: number }>();
        for (const item of saleItems) {
            const existing = productMap.get(item.product_id) ?? {
                name: item.product.name,
                unitsSold: 0,
                revenue: 0,
                cogs: 0,
            };
            existing.unitsSold += item.quantity;
            existing.revenue += item.quantity * Number(item.price_at_sale);
            existing.cogs += item.unit_cost_at_sale !== null
                ? item.quantity * Number(item.unit_cost_at_sale)
                : 0;
            productMap.set(item.product_id, existing);
        }
        const topProducts = Array.from(productMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5)
            .map((p) => ({ ...p, grossProfit: p.revenue - p.cogs }));

        const dayMap = new Map<string, { transactions: number; grossRevenue: number; returns: number }>();
        for (const sale of branchSales) {
            const day = sale.sale_date.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { transactions: 0, grossRevenue: 0, returns: 0 };
            existing.transactions += 1;
            existing.grossRevenue += Number(sale.total_amount);
            dayMap.set(day, existing);
        }
        for (const ret of branchReturns) {
            const day = ret.created_at.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { transactions: 0, grossRevenue: 0, returns: 0 };
            existing.returns += Number(ret.total_refund);
            dayMap.set(day, existing);
        }
        const daily = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({
                date,
                transactions: data.transactions,
                gross_revenue: data.grossRevenue,
                returns: data.returns,
                net_revenue: data.grossRevenue - data.returns,
            }));

        return {
            store: { id: store.id, name: store.name },
            period: { from: query.from ?? null, to: query.to ?? null },
            summary: {
                revenue: branchRevenue,
                transactions: branchTransactions,
                returns: branchReturnsTotal,
                net_revenue: branchNetRevenue,
                avg_order: branchTransactions > 0 ? branchRevenue / branchTransactions : 0,
                cogs: branchCogs,
                gross_profit: branchGrossProfit,
                gross_margin_pct: branchNetRevenue > 0 ? (branchGrossProfit / branchNetRevenue) * 100 : 0,
            },
            company_comparison: {
                company_revenue: companyRevenue,
                company_transactions: companyTotals._count.id,
                revenue_share: revenueShare,
            },
            top_products: topProducts,
            daily,
        };
    }

    async getMonthlySalesByCustomer(tenantId: string, query: GetMonthlySalesByCustomerDto) {
        const dateFilter = buildSaleDateWindow(query.from, query.to);

        const sales = await this.db.sale.findMany({
            where: {
                tenant_id: tenantId,
                status: 'COMPLETED',
                ...(query.customerId ? { customer_id: query.customerId } : {}),
                ...dateFilter,
            },
            select: {
                id: true,
                total_amount: true,
                customer_id: true,
                sale_date: true,
                customer: { select: { id: true, name: true, phone: true } },
            },
            orderBy: { sale_date: 'asc' },
        });

        const monthSet = new Set<string>();
        const customerMap = new Map<string, {
            customer: any;
            months: Map<string, { revenue: number; orderCount: number }>;
        }>();

        for (const sale of sales) {
            const monthKey = sale.sale_date.toISOString().slice(0, 7);
            monthSet.add(monthKey);

            const customerKey = sale.customer_id ?? '__walkin__';
            const entry = customerMap.get(customerKey) ?? {
                customer: sale.customer ?? { id: null, name: 'Walk-in Customer', phone: null },
                months: new Map(),
            };
            const monthData = entry.months.get(monthKey) ?? { revenue: 0, orderCount: 0 };
            monthData.revenue += Number(sale.total_amount);
            monthData.orderCount += 1;
            entry.months.set(monthKey, monthData);
            customerMap.set(customerKey, entry);
        }

        const months = Array.from(monthSet).sort();

        const rows = Array.from(customerMap.values())
            .map((entry) => ({
                customer: entry.customer,
                total: months.reduce((sum, m) => sum + (entry.months.get(m)?.revenue ?? 0), 0),
                monthly: months.map((m) => ({
                    month: m,
                    revenue: entry.months.get(m)?.revenue ?? 0,
                    orderCount: entry.months.get(m)?.orderCount ?? 0,
                })),
            }))
            .sort((a, b) => b.total - a.total);

        return { months, rows };
    }

    // ── Time series ──────────────────────────────────────────────────────────

    /**
     * Revenue as a series of day/week/month buckets, optionally against a prior
     * window.
     *
     * Buckets are folded from `getSalesSummary`'s daily rows rather than
     * re-queried, so a trend can never disagree with the summary above it. Empty
     * buckets are filled with zeros — a "which month was worst" question is
     * wrong if a month with no sales is simply missing from the series.
     */
    async getSalesTrend(tenantId: string, query: GetSalesTrendDto) {
        const granularity: Granularity = query.granularity ?? 'day';
        const range: DateRange = { from: query.from, to: query.to };

        const current = await this.getSalesSummary(tenantId, {
            from: range.from,
            to: range.to,
            storeId: query.storeId,
        });

        const buckets = buildBuckets(range, granularity, current.rows);

        let comparison: unknown = null;
        if (query.compareTo) {
            const previousRange = resolveComparisonRange(range, query.compareTo);
            if (previousRange) {
                const previous = await this.getSalesSummary(tenantId, {
                    from: previousRange.from,
                    to: previousRange.to,
                    storeId: query.storeId,
                });
                comparison = {
                    mode: query.compareTo,
                    period: previousRange,
                    summary: previous.summary,
                    change: buildSummaryChange(current.summary, previous.summary),
                };
            }
        }

        return {
            period: range,
            granularity,
            storeId: query.storeId ?? null,
            summary: current.summary,
            buckets,
            comparison,
        };
    }

    // ── Breakdown ────────────────────────────────────────────────────────────

    /**
     * One aggregation entry point for every dimension a shop owner asks sales to
     * be sliced by. Adding a dimension here reaches the REST API and the AI
     * assistant at once, which is the point — a per-dimension endpoint per
     * question does not scale past the first few questions.
     */
    async getSalesBreakdown(tenantId: string, query: GetSalesBreakdownDto) {
        const range: DateRange = { from: query.from, to: query.to };
        const limit = query.limit ?? 50;
        const offset = query.offset ?? 0;

        const current = await this.aggregateBreakdown(tenantId, range, query.groupBy, query.storeId);

        let previousByKey = new Map<string, BreakdownRow>();
        let previousRange: DateRange | null = null;
        if (query.compareTo) {
            previousRange = resolveComparisonRange(range, query.compareTo);
            if (previousRange) {
                const previous = await this.aggregateBreakdown(tenantId, previousRange, query.groupBy, query.storeId);
                previousByKey = new Map(previous.rows.map((row) => [row.key, row]));
            }
        }

        const ranked = sortBreakdownRows(current.rows, query.groupBy);
        const page = ranked.slice(offset, offset + limit);

        return {
            period: range,
            groupBy: query.groupBy,
            revenueBasis: current.basis,
            storeId: query.storeId ?? null,
            summary: {
                totalRevenue: current.totalRevenue,
                totalOrders: current.totalOrders,
                groupCount: current.rows.length,
            },
            comparison: previousRange ? { mode: query.compareTo, period: previousRange } : null,
            paging: { limit, offset, totalRows: current.rows.length, hasMore: offset + limit < current.rows.length },
            rows: page.map((row) => {
                const previous = previousByKey.get(row.key) ?? null;
                return {
                    ...row,
                    revenueSharePct: current.totalRevenue > 0 ? (row.revenue / current.totalRevenue) * 100 : 0,
                    avgOrderValue: row.orders > 0 ? row.revenue / row.orders : 0,
                    grossProfit: row.cogs === null ? null : row.revenue - row.cogs,
                    grossMarginPct:
                        row.cogs === null || row.revenue <= 0 ? null : ((row.revenue - row.cogs) / row.revenue) * 100,
                    ...(previousRange
                        ? {
                              previousRevenue: previous?.revenue ?? 0,
                              revenueChange: row.revenue - (previous?.revenue ?? 0),
                              revenueChangePct: percentChange(row.revenue, previous?.revenue ?? 0),
                          }
                        : {}),
                };
            }),
        };
    }

    /**
     * The biggest period-over-period swings on a dimension, in both directions.
     *
     * This is the "why did the number change" report: without it, explaining a
     * revenue drop means pulling two breakdowns and diffing them by hand, which
     * is exactly the kind of arithmetic a caller should not be doing.
     */
    async getTopMovers(tenantId: string, query: GetTopMoversDto) {
        const dimension = query.dimension ?? 'product';
        const mode = query.compareTo ?? 'previous_period';
        const limit = query.limit ?? 10;
        const range: DateRange = { from: query.from, to: query.to };
        const previousRange = resolveComparisonRange(range, mode);

        const current = await this.aggregateBreakdown(tenantId, range, dimension, query.storeId);
        const previous = previousRange
            ? await this.aggregateBreakdown(tenantId, previousRange, dimension, query.storeId)
            : { basis: current.basis, rows: [], totalRevenue: 0, totalOrders: 0 };

        const previousByKey = new Map(previous.rows.map((row) => [row.key, row]));
        const currentByKey = new Map(current.rows.map((row) => [row.key, row]));
        const allKeys = new Set([...currentByKey.keys(), ...previousByKey.keys()]);

        const movers = Array.from(allKeys).map((key) => {
            const now = currentByKey.get(key);
            const before = previousByKey.get(key);
            const revenue = now?.revenue ?? 0;
            const previousRevenue = before?.revenue ?? 0;
            return {
                key,
                label: now?.label ?? before?.label ?? 'Unknown',
                revenue,
                previousRevenue,
                revenueChange: revenue - previousRevenue,
                revenueChangePct: percentChange(revenue, previousRevenue),
                status: !before ? 'new' : !now || revenue === 0 ? 'disappeared' : 'continuing',
            };
        });

        const byChange = [...movers].sort((a, b) => b.revenueChange - a.revenueChange);

        return {
            period: range,
            comparisonPeriod: previousRange,
            comparisonMode: mode,
            dimension,
            revenueBasis: current.basis,
            storeId: query.storeId ?? null,
            totals: {
                revenue: current.totalRevenue,
                previousRevenue: previous.totalRevenue,
                revenueChange: current.totalRevenue - previous.totalRevenue,
                revenueChangePct: percentChange(current.totalRevenue, previous.totalRevenue),
            },
            gainers: byChange.filter((m) => m.revenueChange > 0).slice(0, limit),
            decliners: byChange
                .filter((m) => m.revenueChange < 0)
                .reverse()
                .slice(0, limit),
        };
    }

    // ── Returns ──────────────────────────────────────────────────────────────

    /**
     * Refunds for a period with the return rate they represent, sliced by
     * reason, product and branch. The rate is the number that matters: ৳50,000
     * of returns means nothing without the revenue it came out of.
     */
    async getReturnsAnalysis(tenantId: string, query: GetReturnsAnalysisDto) {
        const range: DateRange = { from: query.from, to: query.to };

        const [returns, sales] = await Promise.all([
            this.db.salesReturn.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...buildReturnDateWindow(range.from, range.to),
                },
                select: {
                    id: true,
                    total_refund: true,
                    reason: true,
                    created_at: true,
                    store: { select: { id: true, name: true } },
                    items: {
                        select: {
                            quantity: true,
                            refund_amount: true,
                            product: { select: { id: true, name: true } },
                        },
                    },
                },
            }),
            this.getSalesSummary(tenantId, { from: range.from, to: range.to, storeId: query.storeId }),
        ]);

        const totalRefund = returns.reduce((sum, r) => sum + Number(r.total_refund), 0);
        const unitsReturned = returns.reduce(
            (sum, r) => sum + r.items.reduce((s, i) => s + i.quantity, 0),
            0,
        );

        const byReason = tally(
            returns.map((r) => ({
                key: (r.reason ?? '').trim() || 'Unspecified',
                label: (r.reason ?? '').trim() || 'Unspecified',
                amount: Number(r.total_refund),
                count: 1,
                units: r.items.reduce((s, i) => s + i.quantity, 0),
            })),
        );

        const byBranch = tally(
            returns.map((r) => ({
                key: r.store.id,
                label: r.store.name,
                amount: Number(r.total_refund),
                count: 1,
                units: r.items.reduce((s, i) => s + i.quantity, 0),
            })),
        );

        const byProduct = tally(
            returns.flatMap((r) =>
                r.items.map((i) => ({
                    key: i.product.id,
                    label: i.product.name,
                    amount: Number(i.refund_amount),
                    count: 1,
                    units: i.quantity,
                })),
            ),
        );

        const grossRevenue = sales.summary.totalRevenue;

        return {
            period: range,
            storeId: query.storeId ?? null,
            summary: {
                totalRefund,
                returnCount: returns.length,
                unitsReturned,
                grossRevenue,
                returnRatePct: grossRevenue > 0 ? (totalRefund / grossRevenue) * 100 : 0,
                avgRefund: returns.length > 0 ? totalRefund / returns.length : 0,
            },
            byReason,
            byProduct,
            byBranch,
        };
    }

    // ── Retention ────────────────────────────────────────────────────────────

    /**
     * Splits the period's identified customers into first-time, returning and
     * lapsed, with the revenue each group brought.
     *
     * Walk-in sales are reported separately rather than folded in: they carry no
     * customer record, so counting them as "new customers" every time would
     * inflate acquisition to meaninglessness in a shop that mostly serves
     * walk-ins — which is most shops on this platform.
     */
    async getCustomerRetention(tenantId: string, query: GetCustomerRetentionDto) {
        const range: DateRange = { from: query.from, to: query.to };
        const lapsedAfterDays = query.lapsedAfterDays ?? 90;

        const scope = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            ...(query.storeId ? { store_id: query.storeId } : {}),
        };

        const [windowSales, lifetime] = await Promise.all([
            this.db.sale.findMany({
                where: { ...scope, ...buildSaleDateWindow(range.from, range.to) },
                select: { customer_id: true, total_amount: true },
            }),
            this.db.sale.groupBy({
                by: ['customer_id'],
                where: { ...scope, customer_id: { not: null } },
                _min: { sale_date: true },
                _max: { sale_date: true },
                _count: { _all: true },
            }),
        ]);

        const firstSeen = new Map<string, string>();
        const lastSeen = new Map<string, string>();
        for (const row of lifetime) {
            if (!row.customer_id) continue;
            if (row._min.sale_date) firstSeen.set(row.customer_id, row._min.sale_date.toISOString().slice(0, 10));
            if (row._max.sale_date) lastSeen.set(row.customer_id, row._max.sale_date.toISOString().slice(0, 10));
        }

        const active = new Map<string, { orders: number; revenue: number }>();
        let walkInOrders = 0;
        let walkInRevenue = 0;
        for (const sale of windowSales) {
            if (!sale.customer_id) {
                walkInOrders += 1;
                walkInRevenue += Number(sale.total_amount);
                continue;
            }
            const entry = active.get(sale.customer_id) ?? { orders: 0, revenue: 0 };
            entry.orders += 1;
            entry.revenue += Number(sale.total_amount);
            active.set(sale.customer_id, entry);
        }

        let newCustomers = 0;
        let newRevenue = 0;
        let returningCustomers = 0;
        let returningRevenue = 0;
        for (const [customerId, stats] of active) {
            const first = firstSeen.get(customerId);
            const isNew = !first || first >= range.from;
            if (isNew) {
                newCustomers += 1;
                newRevenue += stats.revenue;
            } else {
                returningCustomers += 1;
                returningRevenue += stats.revenue;
            }
        }

        // "Lapsed" is measured as of the end of the requested window, not today,
        // so asking about a past period gives that period's answer.
        const lapsedCutoff = addDays(range.to, -lapsedAfterDays);
        let lapsedCustomers = 0;
        for (const [customerId, last] of lastSeen) {
            if (last < lapsedCutoff && !active.has(customerId)) lapsedCustomers += 1;
        }

        const activeRevenue = newRevenue + returningRevenue;

        return {
            period: range,
            storeId: query.storeId ?? null,
            lapsedAfterDays,
            lapsedCutoffDate: lapsedCutoff,
            summary: {
                activeCustomers: active.size,
                newCustomers,
                returningCustomers,
                lapsedCustomers,
                repeatRatePct: active.size > 0 ? (returningCustomers / active.size) * 100 : 0,
                identifiedRevenue: activeRevenue,
                newCustomerRevenue: newRevenue,
                returningCustomerRevenue: returningRevenue,
                returningRevenueSharePct: activeRevenue > 0 ? (returningRevenue / activeRevenue) * 100 : 0,
                avgRevenuePerActiveCustomer: active.size > 0 ? activeRevenue / active.size : 0,
            },
            walkIn: {
                orders: walkInOrders,
                revenue: walkInRevenue,
                note: 'Walk-in sales carry no customer record and cannot be attributed to new or returning customers.',
            },
        };
    }

    /**
     * Every sale line whose margin fell below a floor, worst first.
     *
     * The exception report the other margin reports imply but never surface: an
     * average hides the line sold at half cost, and a product-level roll-up
     * hides which till rang it up. `anomaly-detection.service.ts` already spots
     * below-cost lines as an AI signal; this is the same question asked plainly,
     * with a threshold the reader chooses.
     *
     * Uncosted lines are excluded rather than reported at 0% — a line nobody has
     * priced is not evidence of anything, and including it would bury the real
     * exceptions under noise. The count is returned so their absence is visible.
     */
    async getMarginExceptions(tenantId: string, query: GetMarginExceptionsDto) {
        const { sales, returns, rawSales } = await this.loadMarginSource(tenantId, query);
        const floorPct = query.marginFloorPct ?? 0;
        const limit = Math.min(query.limit ?? 100, 500);

        const names = await this.productNames(tenantId, [...sales, ...returns]);
        const saleMeta = new Map(
            (rawSales as any[]).map((s) => [
                s.id,
                { serial: s.serial_number as string | undefined, date: s.sale_date as Date, createdBy: s.created_by as string | null, storeId: s.store_id as string },
            ]),
        );

        type Exception = {
            saleId: string;
            saleDate: Date;
            productId: string;
            productName: string;
            quantity: number;
            revenue: number;
            cogs: number;
            grossProfit: number;
            grossMarginPct: number;
            soldBelowCost: boolean;
            createdBy: string | null;
        };

        const exceptions: Exception[] = [];
        let uncostedLines = 0;

        for (const sale of sales) {
            // Same discount allocation as everywhere else — judging a line
            // against its list price would clear lines that were in fact
            // discounted below cost, which is exactly the case worth catching.
            const lines = saleLines([sale], (item) => ({ key: item.productId, label: '' }));
            sale.items.forEach((item, index) => {
                const line = lines[index];
                if (line.cost === null) {
                    uncostedLines += 1;
                    return;
                }
                if (line.revenue <= 0) {
                    // A giveaway has no margin to be below a floor; it is a
                    // pricing decision, not an exception.
                    return;
                }
                const grossProfit = line.revenue - line.cost;
                const marginPct = (grossProfit / line.revenue) * 100;
                if (marginPct >= floorPct) return;

                const meta = saleMeta.get(sale.id);
                exceptions.push({
                    saleId: sale.id,
                    saleDate: meta?.date ?? new Date(0),
                    productId: item.productId,
                    productName: names.get(item.productId) ?? 'Unknown product',
                    quantity: item.quantity,
                    revenue: line.revenue,
                    cogs: line.cost,
                    grossProfit,
                    grossMarginPct: marginPct,
                    soldBelowCost: grossProfit < 0,
                    createdBy: meta?.createdBy ?? null,
                });
            });
        }

        exceptions.sort((a, b) => a.grossMarginPct - b.grossMarginPct);
        const worst = exceptions.slice(0, limit);

        const byUser = new Map<string, { userId: string | null; lines: number; lostMargin: number }>();
        for (const ex of exceptions) {
            const key = ex.createdBy ?? '__unattributed__';
            const entry = byUser.get(key) ?? { userId: ex.createdBy, lines: 0, lostMargin: 0 };
            entry.lines += 1;
            // How far under the floor this line came in — the size of the
            // problem, not merely that there was one.
            entry.lostMargin += (floorPct / 100) * ex.revenue - ex.grossProfit;
            byUser.set(key, entry);
        }

        const userIds = [...byUser.values()].map((u) => u.userId).filter((id): id is string => Boolean(id));
        const users = userIds.length
            ? await this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
            : [];
        const userName = new Map(users.map((u) => [u.id, u.name]));

        return {
            summary: {
                marginFloorPct: floorPct,
                exceptionCount: exceptions.length,
                belowCostCount: exceptions.filter((e) => e.soldBelowCost).length,
                exceptionRevenue: exceptions.reduce((sum, e) => sum + e.revenue, 0),
                // Nothing was necessarily lost — a deliberate loss-leader is
                // still a decision — so this is "margin forgone against the
                // floor", not a loss.
                marginForgone: exceptions.reduce(
                    (sum, e) => sum + ((floorPct / 100) * e.revenue - e.grossProfit),
                    0,
                ),
                uncostedLines,
                truncated: exceptions.length > worst.length,
            },
            rows: worst,
            byUser: [...byUser.values()]
                .map((u) => ({
                    userId: u.userId,
                    userName: u.userId ? userName.get(u.userId) ?? 'Unknown user' : 'Unattributed',
                    lines: u.lines,
                    marginForgone: u.lostMargin,
                }))
                .sort((a, b) => b.marginForgone - a.marginForgone),
        };
    }

    /**
     * Gross profit by whoever rang the sale up, and by till.
     *
     * `Sale.created_by` and `Sale.counter_id` have always been recorded and
     * nothing ever aggregated margin against them, so commission and
     * performance conversations had only revenue to work with — which rewards
     * discounting.
     */
    async getGrossProfitBySalesperson(tenantId: string, query: GetGrossProfitBySalespersonDto) {
        const { sales, returns, rawSales, rawReturns } = await this.loadMarginSource(tenantId, query);
        const groupBy = query.groupBy ?? 'user';

        const keyForSale = new Map<string, string>();
        for (const sale of rawSales as any[]) {
            keyForSale.set(sale.id, (groupBy === 'counter' ? sale.counter_id : sale.created_by) ?? UNATTRIBUTED_KEY);
        }
        const keyForReturn = new Map<string, string>();
        for (const ret of rawReturns as any[]) {
            // Attributed to whoever made the original sale, not whoever
            // processed the refund: the margin being reversed is theirs.
            keyForReturn.set(
                ret.id,
                (groupBy === 'counter' ? ret.sale?.counter_id : ret.sale?.created_by) ?? UNATTRIBUTED_KEY,
            );
        }

        const lines: MarginLine[] = [];
        const orderCounts = new Map<string, number>();
        for (const sale of sales) {
            const key = keyForSale.get(sale.id) ?? UNATTRIBUTED_KEY;
            orderCounts.set(key, (orderCounts.get(key) ?? 0) + 1);
            lines.push(...saleLines([sale], () => ({ key, label: key })));
        }
        for (const ret of returns) {
            const key = keyForReturn.get(ret.id) ?? UNATTRIBUTED_KEY;
            lines.push(...returnLines([ret], () => ({ key, label: key })));
        }

        const ids = [...new Set(lines.map((l) => l.key))].filter((k) => k !== UNATTRIBUTED_KEY);
        const labels = new Map<string, string>();
        if (ids.length > 0) {
            if (groupBy === 'counter') {
                const counters = await this.db.posCounter.findMany({
                    where: { tenant_id: tenantId, id: { in: ids } },
                    select: { id: true, name: true },
                });
                for (const c of counters) labels.set(c.id, c.name);
            } else {
                const users = await this.db.user.findMany({
                    where: { id: { in: ids } },
                    select: { id: true, name: true },
                });
                for (const u of users) labels.set(u.id, u.name);
            }
        }

        const totals = summariseMargin(lines);
        return {
            summary: { groupBy, ...totals },
            rows: groupMargin(lines).map((group) => ({
                id: group.key === UNATTRIBUTED_KEY ? null : group.key,
                name:
                    group.key === UNATTRIBUTED_KEY
                        ? 'Unattributed'
                        : labels.get(group.key) ?? (groupBy === 'counter' ? 'Unknown counter' : 'Unknown user'),
                orders: orderCounts.get(group.key) ?? 0,
                units: group.units,
                revenue: group.netRevenue,
                cogs: group.cogs,
                grossProfit: group.grossProfit,
                grossMarginPct: group.grossMarginPct,
                coverage: group.coverage,
            })),
        };
    }

    /**
     * Why gross profit moved between two periods, split into volume, price,
     * cost and mix — overall and per product.
     *
     * "Margin fell three points" is not actionable. "Margin fell three points
     * because supplier cost rose on flat volume" is a conversation with a
     * supplier; "because we discounted" is a conversation with the shop floor.
     */
    async getMarginBridge(tenantId: string, query: GetMarginBridgeDto) {
        const current = await this.loadMarginSource(tenantId, query);
        const previous = await this.loadMarginSource(tenantId, {
            from: query.compareFrom,
            to: query.compareTo,
            storeId: query.storeId,
        });

        const names = await this.productNames(tenantId, [
            ...current.sales,
            ...current.returns,
            ...previous.sales,
            ...previous.returns,
        ]);
        const keyOf = (item: { productId: string }) => ({
            key: item.productId,
            label: names.get(item.productId) ?? 'Unknown product',
        });

        const linesFor = (src: typeof current) => [
            ...saleLines(src.sales, keyOf),
            ...returnLines(src.returns, keyOf),
        ];
        const currentLines = linesFor(current);
        const previousLines = linesFor(previous);

        // The bridge is arithmetic on costed lines only. An uncosted line has no
        // cost to attribute a change to, so folding it in would show movement in
        // the cost effect that is really just a gap in the data.
        const costedOnly = (lines: MarginLine[]) => lines.filter((l) => l.cost !== null);
        const toBridgeInput = (lines: MarginLine[]) => ({
            units: lines.reduce((sum, l) => sum + l.quantity, 0),
            revenue: lines.reduce((sum, l) => sum + l.revenue, 0),
            cogs: lines.reduce((sum, l) => sum + (l.cost ?? 0), 0),
        });

        const overall = marginBridge(
            toBridgeInput(costedOnly(previousLines)),
            toBridgeInput(costedOnly(currentLines)),
        );

        const byProductKey = new Set([
            ...costedOnly(currentLines).map((l) => l.key),
            ...costedOnly(previousLines).map((l) => l.key),
        ]);
        const rows = [...byProductKey]
            .map((key) => {
                const curr = costedOnly(currentLines).filter((l) => l.key === key);
                const prev = costedOnly(previousLines).filter((l) => l.key === key);
                return {
                    productId: key,
                    productName: names.get(key) ?? 'Unknown product',
                    ...marginBridge(toBridgeInput(prev), toBridgeInput(curr)),
                };
            })
            // Largest movers first in either direction — a collapse matters as
            // much as a jump, so the sort is on magnitude.
            .sort((a, b) => Math.abs(b.totalChange) - Math.abs(a.totalChange));

        return {
            summary: {
                current: summariseMargin(currentLines),
                previous: summariseMargin(previousLines),
                bridge: overall,
            },
            rows,
        };
    }

    /**
     * How much of what was sold has a cost behind it, and which products are
     * missing one.
     *
     * The report that makes the others defensible: a margin computed over a
     * third of the basket is not a margin, and this is the list someone works
     * through to fix that. Every other gross-profit report carries a `coverage`
     * block; this one is that block, itemised.
     */
    async getCostCoverage(tenantId: string, query: GetCostCoverageDto) {
        const { sales, returns } = await this.loadMarginSource(tenantId, query);
        const names = await this.productNames(tenantId, [...sales, ...returns]);
        const keyOf = (item: { productId: string }) => ({
            key: item.productId,
            label: names.get(item.productId) ?? 'Unknown product',
        });

        const lines = [...saleLines(sales, keyOf), ...returnLines(returns, keyOf)];
        const totals = summariseMargin(lines);

        const rows = groupMargin(lines)
            .map((group) => ({
                productId: group.key,
                productName: group.label,
                units: group.units,
                revenue: group.netRevenue,
                costedLines: group.coverage.costedLines,
                uncostedLines: group.coverage.uncostedLines,
                uncostedRevenue: group.coverage.uncostedRevenue,
                costedRevenuePct: group.coverage.costedRevenuePct,
            }))
            .filter((row) => row.uncostedLines > 0)
            // Ordered by the revenue that cannot be explained, so the product
            // worth pricing first is at the top rather than the one with the
            // most lines.
            .sort((a, b) => b.uncostedRevenue - a.uncostedRevenue);

        return {
            summary: {
                ...totals.coverage,
                netRevenue: totals.netRevenue,
                productsMissingCost: rows.length,
            },
            rows,
        };
    }

    // ── Shared aggregation ───────────────────────────────────────────────────

    private async aggregateBreakdown(
        tenantId: string,
        range: DateRange,
        groupBy: SalesBreakdownDimension,
        storeId?: string,
    ): Promise<BreakdownAggregate> {
        const saleWhere = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            ...(storeId ? { store_id: storeId } : {}),
            ...buildSaleDateWindow(range.from, range.to),
        };

        if (groupBy === 'product' || groupBy === 'category' || groupBy === 'brand') {
            return this.aggregateByLine(saleWhere, groupBy);
        }
        if (groupBy === 'payment_method') {
            return this.aggregateByPaymentMethod(saleWhere);
        }
        return this.aggregateByInvoice(saleWhere, groupBy);
    }

    private async aggregateByLine(
        saleWhere: Record<string, unknown>,
        groupBy: 'product' | 'category' | 'brand',
    ): Promise<BreakdownAggregate> {
        const items = await this.db.saleItem.findMany({
            where: { sale: saleWhere },
            select: {
                sale_id: true,
                quantity: true,
                price_at_sale: true,
                unit_cost_at_sale: true,
                product: {
                    select: {
                        id: true,
                        name: true,
                        group: { select: { id: true, name: true } },
                        brand: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const buckets = new Map<string, { label: string; revenue: number; units: number; cogs: number; sales: Set<string> }>();

        for (const item of items) {
            let key: string;
            let label: string;
            if (groupBy === 'product') {
                key = item.product?.id ?? '__unknown__';
                label = item.product?.name ?? 'Unknown product';
            } else if (groupBy === 'category') {
                key = item.product?.group?.id ?? '__uncategorized__';
                label = item.product?.group?.name ?? 'Uncategorized';
            } else {
                key = item.product?.brand?.id ?? '__unbranded__';
                label = item.product?.brand?.name ?? 'No brand';
            }

            const entry = buckets.get(key) ?? { label, revenue: 0, units: 0, cogs: 0, sales: new Set<string>() };
            entry.revenue += item.quantity * Number(item.price_at_sale);
            entry.units += item.quantity;
            entry.cogs += item.unit_cost_at_sale !== null ? item.quantity * Number(item.unit_cost_at_sale) : 0;
            entry.sales.add(item.sale_id);
            buckets.set(key, entry);
        }

        const rows: BreakdownRow[] = Array.from(buckets.entries()).map(([key, entry]) => ({
            key,
            label: entry.label,
            revenue: entry.revenue,
            orders: entry.sales.size,
            units: entry.units,
            cogs: entry.cogs,
        }));

        return {
            basis: 'sale_line_items',
            rows,
            totalRevenue: rows.reduce((sum, r) => sum + r.revenue, 0),
            totalOrders: new Set(items.map((i) => i.sale_id)).size,
        };
    }

    private async aggregateByInvoice(
        saleWhere: Record<string, unknown>,
        groupBy: 'branch' | 'customer' | 'staff' | 'hour_of_day' | 'day_of_week',
    ): Promise<BreakdownAggregate> {
        const sales = await this.db.sale.findMany({
            where: saleWhere,
            select: {
                id: true,
                total_amount: true,
                sale_date: true,
                created_by: true,
                store: { select: { id: true, name: true } },
                customer: { select: { id: true, name: true } },
            },
        });

        // Staff is stored as a bare user id on the sale, so names need a second
        // lookup; without it the model would be handed raw uuids to read aloud.
        const staffNames = new Map<string, string>();
        if (groupBy === 'staff') {
            const ids = Array.from(new Set(sales.map((s) => s.created_by).filter((id): id is string => Boolean(id))));
            if (ids.length > 0) {
                const users = await this.db.user.findMany({
                    where: { id: { in: ids } },
                    select: { id: true, name: true, email: true },
                });
                for (const user of users) staffNames.set(user.id, user.name || user.email);
            }
        }

        const buckets = new Map<string, { label: string; revenue: number; orders: number }>();

        for (const sale of sales) {
            let key: string;
            let label: string;
            switch (groupBy) {
                case 'branch':
                    key = sale.store.id;
                    label = sale.store.name;
                    break;
                case 'customer':
                    key = sale.customer?.id ?? '__walkin__';
                    label = sale.customer?.name ?? 'Walk-in customer';
                    break;
                case 'staff':
                    key = sale.created_by ?? '__unattributed__';
                    label = sale.created_by ? staffNames.get(sale.created_by) ?? 'Removed user' : 'Not recorded';
                    break;
                case 'hour_of_day': {
                    const { hour } = toDhakaParts(sale.sale_date);
                    key = String(hour).padStart(2, '0');
                    label = `${key}:00–${key}:59`;
                    break;
                }
                default: {
                    const { weekday } = toDhakaParts(sale.sale_date);
                    key = String(weekday);
                    label = WEEKDAY_NAMES[weekday];
                }
            }

            const entry = buckets.get(key) ?? { label, revenue: 0, orders: 0 };
            entry.revenue += Number(sale.total_amount);
            entry.orders += 1;
            buckets.set(key, entry);
        }

        const rows: BreakdownRow[] = Array.from(buckets.entries()).map(([key, entry]) => ({
            key,
            label: entry.label,
            revenue: entry.revenue,
            orders: entry.orders,
            units: null,
            cogs: null,
        }));

        return {
            basis: 'invoice_totals',
            rows,
            totalRevenue: rows.reduce((sum, r) => sum + r.revenue, 0),
            totalOrders: sales.length,
        };
    }

    private async aggregateByPaymentMethod(saleWhere: Record<string, unknown>): Promise<BreakdownAggregate> {
        const payments = await this.db.paymentRecord.findMany({
            where: { sale: saleWhere },
            select: { sale_id: true, payment_method: true, amount: true },
        });

        const buckets = new Map<string, { revenue: number; sales: Set<string> }>();
        for (const payment of payments) {
            const key = (payment.payment_method ?? '').trim() || 'Unrecorded';
            const entry = buckets.get(key) ?? { revenue: 0, sales: new Set<string>() };
            entry.revenue += Number(payment.amount);
            entry.sales.add(payment.sale_id);
            buckets.set(key, entry);
        }

        const rows: BreakdownRow[] = Array.from(buckets.entries()).map(([key, entry]) => ({
            key,
            label: key,
            revenue: entry.revenue,
            orders: entry.sales.size,
            units: null,
            cogs: null,
        }));

        return {
            basis: 'payment_records',
            rows,
            totalRevenue: rows.reduce((sum, r) => sum + r.revenue, 0),
            totalOrders: new Set(payments.map((p) => p.sale_id)).size,
        };
    }
}

/** Ranks a breakdown: chronological dimensions by clock, everything else by size. */
function sortBreakdownRows(rows: BreakdownRow[], groupBy: SalesBreakdownDimension): BreakdownRow[] {
    if (groupBy === 'hour_of_day' || groupBy === 'day_of_week') {
        return [...rows].sort((a, b) => a.key.localeCompare(b.key));
    }
    return [...rows].sort((a, b) => b.revenue - a.revenue);
}

type DailyRow = {
    date: string;
    transactions: number;
    grossRevenue: number;
    returns: number;
    netRevenue: number;
    cogs: number;
    /** Revenue on lines that have a cost — the base gross profit is measured over. */
    costedRevenue: number;
    /** Null on a day where nothing sold had a cost basis. */
    grossProfit: number | null;
};

/**
 * Folds daily rows into the requested bucket width, emitting a zero row for
 * every bucket in the range that had no activity.
 */
function buildBuckets(range: DateRange, granularity: Granularity, rows: DailyRow[]) {
    const buckets = new Map<string, DailyRow & { bucket: string }>();

    const emptyBucket = (start: string) => ({
        bucket: bucketLabel(start, granularity),
        date: start,
        transactions: 0,
        grossRevenue: 0,
        returns: 0,
        netRevenue: 0,
        cogs: 0,
        costedRevenue: 0,
        // Null until a day with a cost basis lands in this bucket. An empty
        // bucket has no margin to report, and zero would draw a point on the
        // chart claiming the business broke even that week.
        grossProfit: null as number | null,
    });

    for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
        const start = bucketStart(day, granularity);
        if (!buckets.has(start)) buckets.set(start, emptyBucket(start));
        // Guard against a malformed range spinning forever.
        if (buckets.size > 5000) break;
    }

    for (const row of rows) {
        const start = bucketStart(row.date, granularity);
        const entry = buckets.get(start) ?? emptyBucket(start);
        entry.transactions += row.transactions;
        entry.grossRevenue += row.grossRevenue;
        entry.returns += row.returns;
        entry.netRevenue += row.netRevenue;
        entry.cogs += row.cogs;
        entry.costedRevenue += row.costedRevenue;
        if (row.grossProfit !== null) {
            entry.grossProfit = (entry.grossProfit ?? 0) + row.grossProfit;
        }
        buckets.set(start, entry);
    }

    const ordered = Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([start, entry]) => ({ ...entry, periodStart: start }));

    return ordered.map((entry, index) => {
        const previous = index > 0 ? ordered[index - 1] : null;
        return {
            bucket: entry.bucket,
            periodStart: entry.periodStart,
            transactions: entry.transactions,
            grossRevenue: entry.grossRevenue,
            returns: entry.returns,
            netRevenue: entry.netRevenue,
            cogs: entry.cogs,
            costedRevenue: entry.costedRevenue,
            grossProfit: entry.grossProfit,
            // Over costed revenue, matching summariseMargin. Dividing by net
            // revenue would dilute the margin by however much uncosted stock
            // happened to sell that period.
            grossMarginPct:
                entry.grossProfit === null || entry.costedRevenue <= 0
                    ? null
                    : (entry.grossProfit / entry.costedRevenue) * 100,
            changeFromPreviousPct: previous ? percentChange(entry.netRevenue, previous.netRevenue) : null,
        };
    });
}

type SalesSummaryTotals = {
    totalRevenue: number;
    netRevenue: number;
    transactionCount: number;
    avgOrderValue: number;
    grossProfit: number;
};

function buildSummaryChange(current: SalesSummaryTotals, previous: SalesSummaryTotals) {
    return {
        totalRevenue: current.totalRevenue - previous.totalRevenue,
        totalRevenuePct: percentChange(current.totalRevenue, previous.totalRevenue),
        netRevenue: current.netRevenue - previous.netRevenue,
        netRevenuePct: percentChange(current.netRevenue, previous.netRevenue),
        transactionCount: current.transactionCount - previous.transactionCount,
        transactionCountPct: percentChange(current.transactionCount, previous.transactionCount),
        avgOrderValue: current.avgOrderValue - previous.avgOrderValue,
        avgOrderValuePct: percentChange(current.avgOrderValue, previous.avgOrderValue),
        grossProfit: current.grossProfit - previous.grossProfit,
        grossProfitPct: percentChange(current.grossProfit, previous.grossProfit),
    };
}

/** Sums repeated `{key,label,amount,count,units}` entries and ranks by amount. */
function tally(entries: Array<{ key: string; label: string; amount: number; count: number; units: number }>) {
    const map = new Map<string, { key: string; label: string; amount: number; count: number; units: number }>();
    for (const entry of entries) {
        const existing = map.get(entry.key) ?? { key: entry.key, label: entry.label, amount: 0, count: 0, units: 0 };
        existing.amount += entry.amount;
        existing.count += entry.count;
        existing.units += entry.units;
        map.set(entry.key, existing);
    }
    const rows = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return rows.map((row) => ({ ...row, sharePct: total > 0 ? (row.amount / total) * 100 : 0 }));
}

export function buildSaleDateWindow(from?: string, to?: string) {
    return buildWindow('sale_date', from, to);
}

export function buildReturnDateWindow(from?: string, to?: string) {
    return buildWindow('created_at', from, to);
}

function buildWindow(field: 'sale_date' | 'created_at', from?: string, to?: string) {
    const where: Record<string, any> = {};
    if (from || to) {
        where[field] = {};
        if (from) {
            const date = new Date(from);
            if (!Number.isNaN(date.getTime())) where[field].gte = date;
        }
        if (to) {
            const date = endOfDayIfDateOnly(to);
            if (date) where[field].lte = date;
        }
    }
    return where;
}

/**
 * A bare `YYYY-MM-DD` upper bound means "through the end of that day".
 *
 * Parsing it with `new Date()` yields midnight, so `lte` excluded every sale
 * made on the last day of the range — a 30-day report was really 29 days plus a
 * single instant, and "sales this month" never included today. Callers that
 * pass a full timestamp still get exactly the bound they asked for.
 */
function endOfDayIfDateOnly(value: string): Date | null {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
    const date = new Date(dateOnly ? `${value.trim()}T23:59:59.999Z` : value);
    return Number.isNaN(date.getTime()) ? null : date;
}
