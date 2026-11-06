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
import { GetSalesLineItemsDto, type SalesLineItemSort } from './sales-reports.dto';
import {
    applyColumnFilters,
    containsInsensitive,
    type FilterableMap,
    numberEquals,
} from '../common/column-filter.util';
import { numberConditionFilter, readIdListQuery, readNumberConditionQuery } from '../common/number-condition.util';
import { idsOrNoneClause } from '../common/sales-document-list-filters';

/**
 * How each sortable column orders the lines. `lineOrder` appends the line id to
 * every one of these: without a unique last key Postgres may return ties in any
 * order, and a line sitting on a page boundary can then show up on two pages or
 * on none.
 */
const SALE_LINE_SORTS: Record<
    SalesLineItemSort,
    (dir: LineItemSortDirection) => Prisma.SaleItemOrderByWithRelationInput[]
> = {
    date: (dir) => [{ sale: { sale_date: dir } }, { sale: { serial_number: dir } }],
    invoice: (dir) => [{ sale: { serial_number: dir } }],
    customer: (dir) => [{ sale: { customer: { name: dir } } }, { sale: { sale_date: 'desc' } }],
    product: (dir) => [{ product: { name: dir } }, { sale: { sale_date: 'desc' } }],
    quantity: (dir) => [{ quantity: dir }, { sale: { sale_date: 'desc' } }],
    unitPrice: (dir) => [{ price_at_sale: dir }, { sale: { sale_date: 'desc' } }],
};

/**
 * Columns of the line-items table that take an advanced filter, by the table's
 * column id. Amount and returned are worked out per line, so they take none.
 */
const SALE_LINE_FILTERABLE: FilterableMap<Prisma.SaleItemWhereInput> = {
    invoice: (v) => ({
        sale: { OR: [{ serial_number: containsInsensitive(v) }, { reference_number: containsInsensitive(v) }] },
    }),
    customer: (v) => ({ sale: { customer: { name: containsInsensitive(v) } } }),
    branch: (v) => ({ sale: { store: { name: containsInsensitive(v) } } }),
    product: (v) => ({ product: { OR: [{ name: containsInsensitive(v) }, { sku: containsInsensitive(v) }] } }),
    quantity: numberEquals('quantity'),
    unitPrice: numberEquals('price_at_sale'),
};

function lineOrder(query: GetSalesLineItemsDto): Prisma.SaleItemOrderByWithRelationInput[] {
    // Newest first unless asked otherwise — the question this report usually
    // answers is "what did we sell lately".
    const keys = query.sortBy
        ? SALE_LINE_SORTS[query.sortBy](query.sortDir === 'desc' ? 'desc' : 'asc')
        : SALE_LINE_SORTS.date('desc');
    return [...keys, { id: 'asc' }];
}

/**
 * The filter, in two halves: what a sale has to be, and what a line of it has
 * to be. Kept apart because the invoice count asks the question the other way
 * round — sales that have a matching line — and has to lead with the sale's own
 * tenant scope to use its indexes.
 *
 * One filter for the page of rows and every total beside it, so the figures
 * above the table always describe the same lines as the rows under them.
 */
export function salesLineFilter(tenantId: string, query: GetSalesLineItemsDto, timezone: string) {
    const saleDate = zonedDayRange(query.from, query.to, timezone);
    const search = searchTerm(query.search);
    // `none` asks for walk-in sales, which carry no customer at all.
    const customers = idsOrNoneClause('customer_id', readIdListQuery(query.customerId)) as
        | Prisma.SaleWhereInput
        | undefined;
    const productIds = readIdListQuery(query.productId);
    const unitPrice = readNumberConditionQuery(query.unitPrice, 'unitPrice');
    const quantity = readNumberConditionQuery(query.quantity, 'quantity');

    // Completed sales only — a draft is not a sale yet and a cancelled one has
    // been reversed. The same line every other sales report draws.
    const sale: Prisma.SaleWhereInput = {
        tenant_id: tenantId,
        status: 'COMPLETED',
        ...(query.storeId ? { store_id: query.storeId } : {}),
        ...(customers ?? {}),
        ...(saleDate ? { sale_date: saleDate } : {}),
    };

    const searchLine: Prisma.SaleItemWhereInput = {
        ...(productIds ? { product_id: productIds.length === 1 ? productIds[0] : { in: productIds } } : {}),
        ...(unitPrice ? { price_at_sale: numberConditionFilter(unitPrice) } : {}),
        ...(quantity ? { quantity: numberConditionFilter(quantity) } : {}),
        // Anything ever returned against the line, whenever it came back — the
        // same returns the row's Returned column adds up.
        ...(query.returned === 'yes' ? { returns: { some: {} } } : {}),
        ...(query.returned === 'no' ? { returns: { none: {} } } : {}),
        ...(search
            ? {
                  OR: [
                      { product: { name: { contains: search, mode: 'insensitive' } } },
                      { product: { sku: { contains: search, mode: 'insensitive' } } },
                      { sale: { serial_number: { contains: search, mode: 'insensitive' } } },
                      { sale: { reference_number: { contains: search, mode: 'insensitive' } } },
                      { sale: { customer: { name: { contains: search, mode: 'insensitive' } } } },
                      // Shops find a regular by the number they rang from.
                      { sale: { customer: { phone: { contains: search } } } },
                  ],
              }
            : {}),
    };
    // On the line half, so the totals and the invoice count narrow with the rows.
    const line = applyColumnFilters(searchLine, query.filters, SALE_LINE_FILTERABLE);

    return { sale, line, where: { ...line, sale } satisfies Prisma.SaleItemWhereInput };
}

/**
 * Every line of every completed sale, searchable by period, customer, product,
 * branch and free text — the question the per-product and per-customer
 * summaries cannot answer, which is *which* invoices a figure came from.
 *
 * Values are the invoice lines as they were printed: quantity × unit price.
 * An invoice-level discount stays on the invoice and is not spread back over
 * its lines, so a total here can exceed what the same sales brought in on the
 * Sales Summary — that report reads invoice totals.
 */
@Injectable()
export class SalesLineItemsService {
    constructor(private readonly db: DatabaseService) {}

    async getSalesLineItems(tenantId: string, query: GetSalesLineItemsDto, timezone: string) {
        const { page, limit, skip } = lineItemPage(query);
        const { sale, line, where } = salesLineFilter(tenantId, query, timezone);

        const [lines, totals, priceGroups, invoiceCount, returned, filters] = await Promise.all([
            this.db.saleItem.findMany({
                where,
                orderBy: lineOrder(query),
                skip,
                take: limit,
                select: {
                    id: true,
                    quantity: true,
                    price_at_sale: true,
                    product: { select: { id: true, name: true, sku: true, unit_type: true } },
                    sale: {
                        select: {
                            id: true,
                            serial_number: true,
                            reference_number: true,
                            sale_date: true,
                            store: { select: { id: true, name: true } },
                            customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                        },
                    },
                    // Every return recorded against the line, whenever it came
                    // back — the report is about what happened to the line, not
                    // only what happened inside the window.
                    returns: { select: { quantity: true, refund_amount: true } },
                },
            }),
            this.db.saleItem.aggregate({ where, _count: { _all: true }, _sum: { quantity: true } }),
            // A line's value is quantity × price, which no aggregate can sum.
            // Grouped by price instead: one row per distinct unit price, which on
            // a real catalog is a small fraction of the lines, and the arithmetic
            // stays under the same filter as everything else here.
            this.db.saleItem.groupBy({ by: ['price_at_sale'], where, _sum: { quantity: true } }),
            this.db.sale.count({ where: { ...sale, items: { some: line } } }),
            this.db.salesReturnItem.aggregate({
                where: { sale_item: { is: where } },
                _sum: { quantity: true, refund_amount: true },
            }),
            this.resolveFilters(tenantId, query),
        ]);

        const amount = priceGroups.reduce(
            (sum, group) => sum + Number(group.price_at_sale) * Number(group._sum.quantity ?? 0),
            0,
        );
        const lineCount = totals._count._all;

        return {
            summary: {
                lineCount,
                invoiceCount,
                quantity: Number(totals._sum.quantity ?? 0),
                amount: roundMoney(amount),
                returnedQuantity: Number(returned._sum.quantity ?? 0),
                returnedAmount: roundMoney(Number(returned._sum.refund_amount ?? 0)),
            },
            filters: { from: query.from ?? null, to: query.to ?? null, ...filters },
            rows: lines.map((item) => {
                const unitPrice = Number(item.price_at_sale);
                return {
                    id: item.id,
                    saleId: item.sale.id,
                    invoiceNumber: item.sale.serial_number,
                    referenceNumber: item.sale.reference_number,
                    date: item.sale.sale_date,
                    store: item.sale.store,
                    customer: item.sale.customer,
                    product: item.product,
                    quantity: item.quantity,
                    unitPrice,
                    amount: roundMoney(item.quantity * unitPrice),
                    returnedQuantity: item.returns.reduce((sum, ret) => sum + ret.quantity, 0),
                    returnedAmount: roundMoney(
                        item.returns.reduce((sum, ret) => sum + Number(ret.refund_amount), 0),
                    ),
                };
            }),
            pagination: lineItemPagination(page, limit, lineCount),
        };
    }

    /**
     * Names for the ids the search was narrowed by, so a page opened from a
     * link can label its filter chips. Tenant-scoped: an id from another
     * workspace resolves to nothing, exactly as it matches nothing.
     *
     * `customer` and `product` name the first one asked for, as before a set
     * could be asked for; `customers` and `products` name them all.
     */
    private async resolveFilters(tenantId: string, query: GetSalesLineItemsDto) {
        const customerIds = (readIdListQuery(query.customerId) ?? []).filter((id) => id !== 'none');
        const productIds = readIdListQuery(query.productId) ?? [];
        const [store, customers, products] = await Promise.all([
            query.storeId
                ? this.db.store.findFirst({
                      where: { id: query.storeId, tenant_id: tenantId },
                      select: { id: true, name: true },
                  })
                : null,
            customerIds.length
                ? this.db.customer.findMany({
                      where: { id: { in: customerIds }, tenant_id: tenantId },
                      select: { id: true, name: true, phone: true, customer_code: true },
                  })
                : [],
            // Deliberately not filtered on `deleted_at`: a product taken off the
            // catalogue still has lines, and they are what someone is looking for.
            productIds.length
                ? this.db.product.findMany({
                      where: { id: { in: productIds }, tenant_id: tenantId },
                      select: { id: true, name: true, sku: true },
                  })
                : [],
        ]);
        const first = <T extends { id: string }>(rows: T[], ids: string[]) =>
            ids.length ? rows.find((row) => row.id === ids[0]) ?? null : null;
        return {
            store,
            customer: first(customers, customerIds),
            product: first(products, productIds),
            customers,
            products,
        };
    }
}
