import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GetBranchReportDto, GetConsolidatedReportDto, GetMonthlySalesByCustomerDto, GetSalesByCustomerDto, GetSalesByProductDto, GetSalesSummaryDto } from './sales-reports.dto';

@Injectable()
export class SalesReportsService {
    constructor(private db: DatabaseService) {}

    async getSalesSummary(tenantId: string, query: GetSalesSummaryDto) {
        const dateFilter = buildDateWindow(query.from, query.to);

        const saleFilter = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            ...(query.storeId ? { store_id: query.storeId } : {}),
            ...dateFilter,
        };

        const [sales, returns, saleItems] = await Promise.all([
            this.db.sale.findMany({
                where: saleFilter,
                select: { id: true, total_amount: true, created_at: true },
                orderBy: { created_at: 'asc' },
            }),
            this.db.salesReturn.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...dateFilter,
                },
                select: { total_refund: true, created_at: true },
            }),
            this.db.saleItem.findMany({
                where: { sale: saleFilter },
                select: {
                    quantity: true,
                    unit_cost_at_sale: true,
                    sale: { select: { created_at: true } },
                },
            }),
        ]);

        const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total_amount), 0);
        const totalReturns = returns.reduce((sum, r) => sum + Number(r.total_refund), 0);
        const transactionCount = sales.length;
        const netRevenue = totalRevenue - totalReturns;
        const avgOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;
        const totalCogs = saleItems.reduce(
            (sum, i) => sum + (i.unit_cost_at_sale !== null ? Number(i.unit_cost_at_sale) * i.quantity : 0),
            0,
        );
        const grossProfit = netRevenue - totalCogs;

        // Build daily breakdown map
        const dayMap = new Map<string, { transactions: number; grossRevenue: number; returns: number; cogs: number }>();

        for (const sale of sales) {
            const day = sale.created_at.toISOString().slice(0, 10);
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

        for (const item of saleItems) {
            const day = item.sale.created_at.toISOString().slice(0, 10);
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
        const dateFilter = buildDateWindow(query.from, query.to);

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

    async getConsolidatedReport(tenantId: string, query: GetConsolidatedReportDto) {
        const dateFilter = buildDateWindow(query.from, query.to);

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
        const dateFilter = buildDateWindow(query.from, query.to);

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
        const dateFilter = buildDateWindow(query.from, query.to);

        const store = await this.db.store.findFirst({
            where: { id: query.storeId, tenant_id: tenantId },
        });

        if (!store) {
            throw new NotFoundException('Store not found');
        }

        const [branchSales, branchReturns, companyTotals, saleItems] = await Promise.all([
            this.db.sale.findMany({
                where: { tenant_id: tenantId, status: 'COMPLETED', store_id: query.storeId, ...dateFilter },
                select: { id: true, total_amount: true, created_at: true },
            }),
            this.db.salesReturn.findMany({
                where: { tenant_id: tenantId, store_id: query.storeId, ...dateFilter },
                select: { total_refund: true, created_at: true },
            }),
            this.db.sale.aggregate({
                where: { tenant_id: tenantId, status: 'COMPLETED', ...dateFilter },
                _sum: { total_amount: true },
                _count: { id: true },
            }),
            this.db.saleItem.findMany({
                where: {
                    sale: { tenant_id: tenantId, status: 'COMPLETED', store_id: query.storeId, ...dateFilter },
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
            const day = sale.created_at.toISOString().slice(0, 10);
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
        const dateFilter = buildDateWindow(query.from, query.to);

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
                created_at: true,
                customer: { select: { id: true, name: true, phone: true } },
            },
            orderBy: { created_at: 'asc' },
        });

        const monthSet = new Set<string>();
        const customerMap = new Map<string, {
            customer: any;
            months: Map<string, { revenue: number; orderCount: number }>;
        }>();

        for (const sale of sales) {
            const monthKey = sale.created_at.toISOString().slice(0, 7);
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
}

function buildDateWindow(from?: string, to?: string) {
    const where: Record<string, any> = {};
    if (from || to) {
        where.created_at = {};
        if (from) {
            const date = new Date(from);
            if (!Number.isNaN(date.getTime())) where.created_at.gte = date;
        }
        if (to) {
            const date = new Date(to);
            if (!Number.isNaN(date.getTime())) where.created_at.lte = date;
        }
    }
    return where;
}
