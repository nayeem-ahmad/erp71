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
    GetCustomerRetentionDto,
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

/**
 * Which figures an aggregate was built from. Line-item and invoice totals do
 * not agree when an invoice carries an order-level discount, and payment
 * records do not agree with either when an invoice is only part-paid — so every
 * breakdown says which one it used rather than leaving the caller to assume.
 */
export type RevenueBasis = 'sale_line_items' | 'invoice_totals' | 'payment_records';

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

    async getSalesSummary(tenantId: string, query: GetSalesSummaryDto) {
        const saleDateFilter = buildSaleDateWindow(query.from, query.to);
        const returnDateFilter = buildReturnDateWindow(query.from, query.to);

        const saleFilter = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            ...(query.storeId ? { store_id: query.storeId } : {}),
            ...saleDateFilter,
        };

        const [sales, returns, saleItems] = await Promise.all([
            this.db.sale.findMany({
                where: saleFilter,
                select: { id: true, total_amount: true, sale_date: true },
                orderBy: { sale_date: 'asc' },
            }),
            this.db.salesReturn.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...returnDateFilter,
                },
                select: { total_refund: true, created_at: true },
            }),
            this.db.saleItem.findMany({
                where: { sale: saleFilter },
                select: {
                    quantity: true,
                    unit_cost_at_sale: true,
                    sale: { select: { sale_date: true } },
                },
            }),
        ]);

        const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total_amount), 0);
        const totalReturns = returns.reduce((sum, r) => sum + Number(r.total_refund), 0);
        const transactionCount = sales.length;
        const netRevenue = totalRevenue - totalReturns;
        const avgOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;
        const totalCogs = (saleItems ?? []).reduce(
            (sum, i) => sum + (i.unit_cost_at_sale !== null ? Number(i.unit_cost_at_sale) * i.quantity : 0),
            0,
        );
        const grossProfit = netRevenue - totalCogs;

        // Build daily breakdown map
        const dayMap = new Map<string, { transactions: number; grossRevenue: number; returns: number; cogs: number }>();

        for (const sale of sales) {
            const day = sale.sale_date.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { transactions: 0, grossRevenue: 0, returns: 0, cogs: 0 };
            existing.transactions += 1;
            existing.grossRevenue += Number(sale.total_amount);
            dayMap.set(day, existing);
        }

        for (const ret of returns) {
            const day = ret.created_at.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { transactions: 0, grossRevenue: 0, returns: 0, cogs: 0 };
            existing.returns += Number(ret.total_refund);
            dayMap.set(day, existing);
        }

        for (const item of (saleItems ?? [])) {
            const day = item.sale.sale_date.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { transactions: 0, grossRevenue: 0, returns: 0, cogs: 0 };
            existing.cogs += item.unit_cost_at_sale !== null ? Number(item.unit_cost_at_sale) * item.quantity : 0;
            dayMap.set(day, existing);
        }

        const rows = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => {
                const dayNetRevenue = data.grossRevenue - data.returns;
                const dayGrossProfit = dayNetRevenue - data.cogs;
                return {
                    date,
                    transactions: data.transactions,
                    grossRevenue: data.grossRevenue,
                    returns: data.returns,
                    netRevenue: dayNetRevenue,
                    cogs: data.cogs,
                    grossProfit: dayGrossProfit,
                };
            });

        return {
            summary: {
                totalRevenue,
                totalReturns,
                netRevenue,
                transactionCount,
                avgOrderValue,
                totalCogs,
                grossProfit,
                grossMarginPct: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
            },
            rows,
        };
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
        const dateFilter = buildSaleDateWindow(query.from, query.to);

        const saleItems = await this.db.saleItem.findMany({
            where: {
                sale: {
                    tenant_id: tenantId,
                    status: 'COMPLETED',
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...dateFilter,
                },
            },
            select: {
                quantity: true,
                price_at_sale: true,
                product: {
                    select: {
                        group_id: true,
                        group: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const catMap = new Map<string, { categoryId: string | null; categoryName: string; revenue: number }>();
        for (const item of saleItems) {
            const groupId = item.product?.group_id ?? null;
            const key = groupId ?? '__uncategorized__';
            const name = item.product?.group?.name ?? 'Uncategorized';
            const existing = catMap.get(key) ?? { categoryId: groupId, categoryName: name, revenue: 0 };
            existing.revenue += item.quantity * Number(item.price_at_sale);
            catMap.set(key, existing);
        }

        const sorted = Array.from(catMap.values()).sort((a, b) => b.revenue - a.revenue);
        const totalRevenue = sorted.reduce((sum, r) => sum + r.revenue, 0);

        const TOP_N = 5;
        const rows = sorted.slice(0, TOP_N).map((r) => ({
            ...r,
            share: totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0,
        }));

        const rest = sorted.slice(TOP_N);
        if (rest.length > 0) {
            const otherRevenue = rest.reduce((sum, r) => sum + r.revenue, 0);
            rows.push({
                categoryId: null,
                categoryName: 'Other',
                revenue: otherRevenue,
                share: totalRevenue > 0 ? (otherRevenue / totalRevenue) * 100 : 0,
            });
        }

        return { summary: { totalRevenue, categoryCount: sorted.length }, rows };
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
    async getSalesByCustomer(tenantId: string, query: GetSalesByCustomerDto) {
        const dateFilter = buildSaleDateWindow(query.from, query.to);

        const sales = await this.db.sale.findMany({
            where: {
                tenant_id: tenantId,
                status: 'COMPLETED',
                ...(query.storeId ? { store_id: query.storeId } : {}),
                ...dateFilter,
            },
            select: {
                id: true,
                total_amount: true,
                customer_id: true,
                customer: { select: { id: true, name: true, phone: true, customer_code: true } },
            },
        });

        const customerMap = new Map<string, {
            customer: any;
            orderCount: number;
            revenue: number;
        }>();

        for (const sale of sales) {
            const key = sale.customer_id ?? '__walkin__';
            const existing = customerMap.get(key) ?? {
                customer: sale.customer ?? { id: null, name: 'Walk-in Customer', phone: null, customer_code: null },
                orderCount: 0,
                revenue: 0,
            };
            existing.orderCount += 1;
            existing.revenue += Number(sale.total_amount);
            customerMap.set(key, existing);
        }

        const rows = Array.from(customerMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .map((r) => ({
                customer: r.customer,
                orderCount: r.orderCount,
                revenue: r.revenue,
                avgOrderValue: r.orderCount > 0 ? r.revenue / r.orderCount : 0,
            }));

        const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
        const totalOrders = rows.reduce((sum, r) => sum + r.orderCount, 0);

        return {
            summary: {
                totalRevenue,
                totalOrders,
                customerCount: rows.length,
                avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
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
    grossProfit: number;
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
        grossProfit: 0,
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
        entry.grossProfit += row.grossProfit;
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
            grossProfit: entry.grossProfit,
            grossMarginPct: entry.netRevenue > 0 ? (entry.grossProfit / entry.netRevenue) * 100 : 0,
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
