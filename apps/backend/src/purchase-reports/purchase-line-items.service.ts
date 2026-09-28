import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { zonedDayRange } from '../common/tenant-time.util';
import {
    lineItemPage,
    lineItemPagination,
    roundMoney,
    searchTerm,
    type LineItemSortDirection,
} from '../common/line-item-search';
import { ACTIVE_PURCHASE } from '../purchases/purchase-status';
import { GetPurchaseLineItemsDto, type PurchaseLineItemSort } from './purchase-reports.dto';

/**
 * How each sortable column orders the lines, before `lineOrder` appends the
 * line id — the unique last key that keeps a line from landing on two pages,
 * or none, when it ties with its neighbours on the first.
 */
const PURCHASE_LINE_SORTS: Record<
    PurchaseLineItemSort,
    (dir: LineItemSortDirection) => Prisma.PurchaseItemOrderByWithRelationInput[]
> = {
    date: (dir) => [{ purchase: { created_at: dir } }, { purchase: { purchase_number: dir } }],
    bill: (dir) => [{ purchase: { purchase_number: dir } }],
    supplier: (dir) => [{ purchase: { supplier: { name: dir } } }, { purchase: { created_at: 'desc' } }],
    product: (dir) => [{ product: { name: dir } }, { purchase: { created_at: 'desc' } }],
    quantity: (dir) => [{ quantity: dir }, { purchase: { created_at: 'desc' } }],
    unitCost: (dir) => [{ unit_cost: dir }, { purchase: { created_at: 'desc' } }],
    amount: (dir) => [{ line_total: dir }, { purchase: { created_at: 'desc' } }],
};

function lineOrder(query: GetPurchaseLineItemsDto): Prisma.PurchaseItemOrderByWithRelationInput[] {
    const keys = query.sortBy
        ? PURCHASE_LINE_SORTS[query.sortBy](query.sortDir === 'desc' ? 'desc' : 'asc')
        : PURCHASE_LINE_SORTS.date('desc');
    return [...keys, { id: 'asc' }];
}

/**
 * The filter in two halves, as on the sales side: what the purchase has to be,
 * and what a line of it has to be. The bill count asks for purchases with a
 * matching line and needs the purchase's own tenant scope up front.
 */
export function purchaseLineFilter(tenantId: string, query: GetPurchaseLineItemsDto, timezone: string) {
    const createdAt = zonedDayRange(query.from, query.to, timezone);
    const search = searchTerm(query.search);

    // A cancelled bill has had its stock, payable and ledger reversed, so its
    // lines are not purchases any more — the same exclusion every purchase
    // figure makes.
    const purchase: Prisma.PurchaseWhereInput = {
        tenant_id: tenantId,
        ...ACTIVE_PURCHASE,
        ...(query.storeId ? { store_id: query.storeId } : {}),
        ...(query.supplierId ? { supplier_id: query.supplierId } : {}),
        ...(createdAt ? { created_at: createdAt } : {}),
    };

    const line: Prisma.PurchaseItemWhereInput = {
        ...(query.productId ? { product_id: query.productId } : {}),
        ...(search
            ? {
                  OR: [
                      { product: { name: { contains: search, mode: 'insensitive' } } },
                      { product: { sku: { contains: search, mode: 'insensitive' } } },
                      { purchase: { purchase_number: { contains: search, mode: 'insensitive' } } },
                      // The supplier's own bill number, which is what their
                      // statement quotes.
                      { purchase: { reference_number: { contains: search, mode: 'insensitive' } } },
                      { purchase: { supplier: { name: { contains: search, mode: 'insensitive' } } } },
                      { purchase: { supplier: { phone: { contains: search } } } },
                  ],
              }
            : {}),
    };

    return { purchase, line, where: { ...line, purchase } satisfies Prisma.PurchaseItemWhereInput };
}

/**
 * Every line of every purchase that still stands, searchable by period,
 * supplier, product, branch and free text.
 *
 * Values are the bill lines as entered: quantity, unit cost and the line total.
 * Bill-level discount, tax and freight stay on the bill and are not spread back
 * over its lines, so a total here can differ from what the Purchase Summary
 * reports for the same bills — that one reads bill totals.
 */
@Injectable()
export class PurchaseLineItemsService {
    constructor(private readonly db: DatabaseService) {}

    async getPurchaseLineItems(tenantId: string, query: GetPurchaseLineItemsDto, timezone: string) {
        const { page, limit, skip } = lineItemPage(query);
        const { purchase, line, where } = purchaseLineFilter(tenantId, query, timezone);

        const [lines, totals, billCount, returned, filters] = await Promise.all([
            this.db.purchaseItem.findMany({
                where,
                orderBy: lineOrder(query),
                skip,
                take: limit,
                select: {
                    id: true,
                    quantity: true,
                    unit_cost: true,
                    line_total: true,
                    product: { select: { id: true, name: true, sku: true, unit_type: true } },
                    purchase: {
                        select: {
                            id: true,
                            purchase_number: true,
                            reference_number: true,
                            created_at: true,
                            store: { select: { id: true, name: true } },
                            supplier: { select: { id: true, name: true, phone: true } },
                        },
                    },
                    // Every return recorded against the line, whenever it went
                    // back — not only returns inside the window.
                    returnItems: { select: { quantity: true, line_total: true } },
                },
            }),
            this.db.purchaseItem.aggregate({
                where,
                _count: { _all: true },
                _sum: { quantity: true, line_total: true },
            }),
            this.db.purchase.count({ where: { ...purchase, items: { some: line } } }),
            this.db.purchaseReturnItem.aggregate({
                where: { purchaseItem: { is: where } },
                _sum: { quantity: true, line_total: true },
            }),
            this.resolveFilters(tenantId, query),
        ]);

        const lineCount = totals._count._all;

        return {
            summary: {
                lineCount,
                billCount,
                quantity: Number(totals._sum.quantity ?? 0),
                amount: roundMoney(Number(totals._sum.line_total ?? 0)),
                returnedQuantity: Number(returned._sum.quantity ?? 0),
                returnedAmount: roundMoney(Number(returned._sum.line_total ?? 0)),
            },
            filters: { from: query.from ?? null, to: query.to ?? null, ...filters },
            rows: lines.map((item) => ({
                id: item.id,
                purchaseId: item.purchase.id,
                purchaseNumber: item.purchase.purchase_number,
                referenceNumber: item.purchase.reference_number,
                date: item.purchase.created_at,
                store: item.purchase.store,
                supplier: item.purchase.supplier,
                product: item.product,
                quantity: item.quantity,
                unitCost: Number(item.unit_cost),
                amount: roundMoney(Number(item.line_total)),
                returnedQuantity: item.returnItems.reduce((sum, ret) => sum + ret.quantity, 0),
                returnedAmount: roundMoney(
                    item.returnItems.reduce((sum, ret) => sum + Number(ret.line_total), 0),
                ),
            })),
            pagination: lineItemPagination(page, limit, lineCount),
        };
    }

    /** Names for the ids the search was narrowed by, tenant-scoped. */
    private async resolveFilters(tenantId: string, query: GetPurchaseLineItemsDto) {
        const [store, supplier, product] = await Promise.all([
            query.storeId
                ? this.db.store.findFirst({
                      where: { id: query.storeId, tenant_id: tenantId },
                      select: { id: true, name: true },
                  })
                : null,
            query.supplierId
                ? this.db.supplier.findFirst({
                      where: { id: query.supplierId, tenant_id: tenantId },
                      select: { id: true, name: true, phone: true },
                  })
                : null,
            // Not filtered on `deleted_at`: a delisted product's lines are still
            // what someone reconciling an old bill needs to find.
            query.productId
                ? this.db.product.findFirst({
                      where: { id: query.productId, tenant_id: tenantId },
                      select: { id: true, name: true, sku: true },
                  })
                : null,
        ]);
        return { store, supplier, product };
    }
}
