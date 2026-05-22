import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GetConsolidatedReportDto, GetSalesByProductDto, GetSalesSummaryDto } from './sales-reports.dto';

@Injectable()
export class SalesReportsService {
    constructor(private db: DatabaseService) {}

    async getSalesSummary(tenantId: string, query: GetSalesSummaryDto) {
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
                created_at: true,
            },
            orderBy: { created_at: 'asc' },
        });

        const returns = await this.db.salesReturn.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.storeId ? { store_id: query.storeId } : {}),
                ...dateFilter,
            },
            select: {
                total_refund: true,
                created_at: true,
            },
        });

        const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total_amount), 0);
        const totalReturns = returns.reduce((sum, r) => sum + Number(r.total_refund), 0);
        const transactionCount = sales.length;
        const netRevenue = totalRevenue - totalReturns;
        const avgOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;

        // Build daily breakdown map
        const dayMap = new Map<string, { transactions: number; grossRevenue: number; returns: number }>();

        for (const sale of sales) {
            const day = sale.created_at.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { transactions: 0, grossRevenue: 0, returns: 0 };
            existing.transactions += 1;
            existing.grossRevenue += Number(sale.total_amount);
            dayMap.set(day, existing);
        }

        for (const ret of returns) {
            const day = ret.created_at.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { transactions: 0, grossRevenue: 0, returns: 0 };
            existing.returns += Number(ret.total_refund);
            dayMap.set(day, existing);
        }

        const rows = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({
                date,
                transactions: data.transactions,
                grossRevenue: data.grossRevenue,
                returns: data.returns,
                netRevenue: data.grossRevenue - data.returns,
            }));

        return {
            summary: {
                totalRevenue,
                totalReturns,
                netRevenue,
                transactionCount,
                avgOrderValue,
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
            include: {
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
            }
        >();

        for (const item of saleItems) {
            const existing = productMap.get(item.product_id) ?? {
                product: item.product,
                unitsSold: 0,
                revenue: 0,
            };
            existing.unitsSold += item.quantity;
            existing.revenue += item.quantity * Number(item.price_at_sale);
            productMap.set(item.product_id, existing);
        }

        const rows = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
        const totalUnitsSold = rows.reduce((sum, r) => sum + r.unitsSold, 0);

        return {
            summary: {
                totalRevenue,
                totalUnitsSold,
                productCount: rows.length,
            },
            rows: rows.map((r) => ({
                ...r,
                revenueShare: totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0,
            })),
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
