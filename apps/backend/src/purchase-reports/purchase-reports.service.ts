import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { addDays, bucketLabel, bucketStart, percentChange, resolveComparisonRange, type DateRange, type Granularity } from '../common/period.util';
import { GetPurchaseSummaryDto, GetPurchaseTrendDto, GetPurchasesByProductDto, GetPurchasesBySupplierDto } from './purchase-reports.dto';

@Injectable()
export class PurchaseReportsService {
    constructor(private db: DatabaseService) {}

    async getPurchaseSummary(tenantId: string, query: GetPurchaseSummaryDto) {
        const dateFilter = buildDateWindow(query.from, query.to);

        const [purchases, returns] = await Promise.all([
            this.db.purchase.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...dateFilter,
                },
                select: { id: true, total_amount: true, created_at: true },
                orderBy: { created_at: 'asc' },
            }),
            this.db.purchaseReturn.findMany({
                where: {
                    tenant_id: tenantId,
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...dateFilter,
                },
                select: { total_amount: true, created_at: true },
            }),
        ]);

        const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.total_amount), 0);
        const totalReturns = returns.reduce((sum, r) => sum + Number(r.total_amount), 0);
        const netPurchases = totalPurchases - totalReturns;
        const orderCount = purchases.length;
        const avgOrderValue = orderCount > 0 ? totalPurchases / orderCount : 0;

        const dayMap = new Map<string, { orders: number; grossPurchases: number; returns: number }>();

        for (const p of purchases) {
            const day = p.created_at.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { orders: 0, grossPurchases: 0, returns: 0 };
            existing.orders += 1;
            existing.grossPurchases += Number(p.total_amount);
            dayMap.set(day, existing);
        }

        for (const r of returns) {
            const day = r.created_at.toISOString().slice(0, 10);
            const existing = dayMap.get(day) ?? { orders: 0, grossPurchases: 0, returns: 0 };
            existing.returns += Number(r.total_amount);
            dayMap.set(day, existing);
        }

        const rows = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({
                date,
                orders: data.orders,
                grossPurchases: data.grossPurchases,
                returns: data.returns,
                netPurchases: data.grossPurchases - data.returns,
            }));

        return {
            summary: {
                totalPurchases,
                totalReturns,
                netPurchases,
                orderCount,
                avgOrderValue,
            },
            rows,
        };
    }

    /**
     * Supplier spend as a time series, optionally against a prior window.
     *
     * Folded from `getPurchaseSummary`'s daily rows for the same reason the
     * sales trend is: two independent aggregations of the same period will
     * eventually disagree, and the report beside it is the one users trust.
     */
    async getPurchaseTrend(tenantId: string, query: GetPurchaseTrendDto) {
        const granularity: Granularity = query.granularity ?? 'day';
        const range: DateRange = { from: query.from, to: query.to };

        const current = await this.getPurchaseSummary(tenantId, {
            from: range.from,
            to: range.to,
            storeId: query.storeId,
        });

        const buckets = new Map<string, { grossPurchases: number; returns: number; orders: number }>();
        for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
            const start = bucketStart(day, granularity);
            if (!buckets.has(start)) buckets.set(start, { grossPurchases: 0, returns: 0, orders: 0 });
            if (buckets.size > 5000) break;
        }
        for (const row of current.rows) {
            const start = bucketStart(row.date, granularity);
            const entry = buckets.get(start) ?? { grossPurchases: 0, returns: 0, orders: 0 };
            entry.grossPurchases += row.grossPurchases;
            entry.returns += row.returns;
            entry.orders += row.orders;
            buckets.set(start, entry);
        }

        const ordered = Array.from(buckets.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([start, entry]) => ({
                bucket: bucketLabel(start, granularity),
                periodStart: start,
                orders: entry.orders,
                grossPurchases: entry.grossPurchases,
                returns: entry.returns,
                netPurchases: entry.grossPurchases - entry.returns,
            }));

        let comparison: unknown = null;
        if (query.compareTo) {
            const previousRange = resolveComparisonRange(range, query.compareTo);
            if (previousRange) {
                const previous = await this.getPurchaseSummary(tenantId, {
                    from: previousRange.from,
                    to: previousRange.to,
                    storeId: query.storeId,
                });
                comparison = {
                    mode: query.compareTo,
                    period: previousRange,
                    summary: previous.summary,
                    change: {
                        netPurchases: current.summary.netPurchases - previous.summary.netPurchases,
                        netPurchasesPct: percentChange(current.summary.netPurchases, previous.summary.netPurchases),
                        orderCount: current.summary.orderCount - previous.summary.orderCount,
                        orderCountPct: percentChange(current.summary.orderCount, previous.summary.orderCount),
                    },
                };
            }
        }

        return {
            period: range,
            granularity,
            storeId: query.storeId ?? null,
            summary: current.summary,
            buckets: ordered,
            comparison,
        };
    }

    async getPurchasesByProduct(tenantId: string, query: GetPurchasesByProductDto) {
        const dateFilter = buildDateWindow(query.from, query.to);

        const items = await this.db.purchaseItem.findMany({
            where: {
                purchase: {
                    tenant_id: tenantId,
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
                    include: { group: true, subgroup: true },
                },
            },
        });

        const productMap = new Map<
            string,
            { product: (typeof items)[0]['product']; unitsOrdered: number; spend: number }
        >();

        for (const item of items) {
            const existing = productMap.get(item.product_id) ?? {
                product: item.product,
                unitsOrdered: 0,
                spend: 0,
            };
            existing.unitsOrdered += item.quantity;
            existing.spend += Number(item.line_total);
            productMap.set(item.product_id, existing);
        }

        const rows = Array.from(productMap.values()).sort((a, b) => b.spend - a.spend);
        const totalSpend = rows.reduce((sum, r) => sum + r.spend, 0);
        const totalUnits = rows.reduce((sum, r) => sum + r.unitsOrdered, 0);

        return {
            summary: {
                totalSpend,
                totalUnits,
                productCount: rows.length,
            },
            rows: rows.map((r) => ({
                ...r,
                spendShare: totalSpend > 0 ? (r.spend / totalSpend) * 100 : 0,
            })),
        };
    }

    async getPurchasesBySupplier(tenantId: string, query: GetPurchasesBySupplierDto) {
        const dateFilter = buildDateWindow(query.from, query.to);

        const purchases = await this.db.purchase.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.storeId ? { store_id: query.storeId } : {}),
                ...dateFilter,
            },
            select: {
                id: true,
                total_amount: true,
                supplier_id: true,
                supplier: { select: { id: true, name: true, phone: true } },
            },
        });

        const supplierMap = new Map<
            string,
            { supplier: any; orderCount: number; spend: number }
        >();

        for (const p of purchases) {
            const key = p.supplier_id ?? '__unknown__';
            const existing = supplierMap.get(key) ?? {
                supplier: p.supplier ?? { id: null, name: 'Unknown Supplier', phone: null },
                orderCount: 0,
                spend: 0,
            };
            existing.orderCount += 1;
            existing.spend += Number(p.total_amount);
            supplierMap.set(key, existing);
        }

        const rows = Array.from(supplierMap.values()).sort((a, b) => b.spend - a.spend);
        const totalSpend = rows.reduce((sum, r) => sum + r.spend, 0);
        const totalOrders = rows.reduce((sum, r) => sum + r.orderCount, 0);

        return {
            summary: {
                totalSpend,
                totalOrders,
                supplierCount: rows.length,
                avgOrderValue: totalOrders > 0 ? totalSpend / totalOrders : 0,
            },
            rows: rows.map((r) => ({
                ...r,
                avgOrderValue: r.orderCount > 0 ? r.spend / r.orderCount : 0,
                spendShare: totalSpend > 0 ? (r.spend / totalSpend) * 100 : 0,
            })),
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
            // A bare YYYY-MM-DD upper bound covers the whole day; parsed as-is it
            // would be midnight and drop everything purchased on the last day.
            const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(to.trim());
            const date = new Date(dateOnly ? `${to.trim()}T23:59:59.999Z` : to);
            if (!Number.isNaN(date.getTime())) where.created_at.lte = date;
        }
    }
    return where;
}
