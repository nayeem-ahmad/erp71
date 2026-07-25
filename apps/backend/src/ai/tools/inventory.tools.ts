import { StorePermission } from '@erp71/shared-types';
import { DATE_RANGE_PROPS, money, page, PAGING_PROPS, pct, type ChatTool } from './types';

const WAREHOUSE_PROP = {
    warehouseId: {
        type: 'string',
        description:
            'Restrict to one warehouse by id. Get the id from resolve_entity first — never invent one. ' +
            'Omit for all warehouses.',
    },
};

export const INVENTORY_TOOLS: ChatTool[] = [
    {
        name: 'low_stock',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        modules: ['inventory'],
        description:
            'Products at or below their reorder point, with quantity on hand, quantity already in transit and a suggested ' +
            'reorder quantity. Use for "what do I need to restock", low stock and reorder questions.',
        parameters: {
            type: 'object',
            properties: { ...WAREHOUSE_PROP, ...PAGING_PROPS },
        },
        handler: async (ctx, args, deps) => {
            const rows = await deps.inventoryReports.getReorderSuggestions(ctx.tenantId, {
                warehouseId: args.warehouseId,
            });
            const needsReorder = rows.filter((r: any) => r.suggestedQuantity > 0);
            const unconfigured = rows.length - needsReorder.length;
            const paged = page(
                [...needsReorder].sort((a: any, b: any) => b.suggestedQuantity - a.suggestedQuantity),
                args,
            );
            return {
                ...paged,
                productsWithoutStockPolicy: unconfigured,
                rows: paged.rows.map((r: any) => ({
                    product: r.product?.name ?? 'Unknown',
                    group: r.product?.group?.name ?? null,
                    onHand: r.onHand,
                    inTransit: r.inTransit,
                    targetStock: r.targetStock,
                    suggestedQuantity: r.suggestedQuantity,
                    leadTimeDays: r.leadTimeDays,
                })),
            };
        },
    },

    {
        name: 'stock_on_hand',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        modules: ['inventory'],
        description:
            'Current stock quantity and inventory value, overall and per product. Use for "how much stock do we have", ' +
            '"what is my inventory worth", or the quantity of one specific product (pass productName).',
        parameters: {
            type: 'object',
            properties: {
                ...WAREHOUSE_PROP,
                ...PAGING_PROPS,
                productName: {
                    type: 'string',
                    description: 'Filter to products whose name contains this text. Use when asked about one product.',
                },
            },
        },
        handler: async (ctx, args, deps) => {
            const result = await deps.inventoryReports.getInventoryValuation(ctx.tenantId, {
                warehouseId: args.warehouseId,
            });
            const search = String(args.productName ?? '').trim().toLowerCase();
            const matched = search
                ? result.rows.filter((r: any) => (r.product?.name ?? '').toLowerCase().includes(search))
                : result.rows.filter((r: any) => r.quantity > 0);
            const paged = page([...matched].sort((a: any, b: any) => b.stockValue - a.stockValue), args);
            return {
                totalQuantity: result.summary.totalQuantity,
                totalStockValue: money(result.summary.totalStockValue),
                productsInStock: result.summary.productCount,
                ...paged,
                rows: paged.rows.map((r: any) => ({
                    product: r.product?.name ?? 'Unknown',
                    group: r.product?.group?.name ?? null,
                    quantity: r.quantity,
                    unitValue: money(r.unitValue),
                    stockValue: money(r.stockValue),
                })),
            };
        },
    },

    {
        name: 'stock_aging',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        modules: ['inventory'],
        description:
            'Stock that is not selling: quantity and value grouped by how long since the item last sold, plus the ' +
            'slowest-moving products. Use for "what is not selling", "dead stock", "which products are stuck", ' +
            '"how much capital is tied up in slow stock".',
        parameters: {
            type: 'object',
            properties: {
                ...WAREHOUSE_PROP,
                ...PAGING_PROPS,
                slowMovingAfterDays: {
                    type: 'number',
                    description: 'Days without a sale before stock counts as slow-moving. Defaults to 60.',
                },
            },
        },
        handler: async (ctx, args, deps) => {
            const result = await deps.inventoryReports.getStockAging(ctx.tenantId, {
                warehouseId: args.warehouseId,
                slowMovingAfterDays: Number(args.slowMovingAfterDays) || undefined,
            });
            const paged = page(result.rows, args);
            return {
                slowMovingAfterDays: result.summary.slowMovingAfterDays,
                productsInStock: result.summary.productsInStock,
                totalStockValue: money(result.summary.totalStockValue),
                slowMovingProducts: result.summary.slowMovingProducts,
                slowMovingValue: money(result.summary.slowMovingValue),
                slowMovingShareOfValuePct: pct(result.summary.slowMovingShareOfValuePct),
                neverSoldProducts: result.summary.neverSoldProducts,
                valuationNote: 'Stock is valued at the current selling price, not cost.',
                buckets: result.buckets.map((b) => ({
                    ageBucket: b.label,
                    productCount: b.productCount,
                    quantity: b.quantity,
                    stockValue: money(b.stockValue),
                })),
                totalRows: paged.totalRows,
                returned: paged.returned,
                offset: paged.offset,
                hasMore: paged.hasMore,
                truncated: paged.truncated,
                rows: paged.rows.map((r) => ({
                    product: r.product.name,
                    group: r.product.group?.name ?? null,
                    quantity: r.quantity,
                    stockValue: money(r.stockValue),
                    daysSinceLastSale: r.daysSinceLastSale,
                    lastSoldAt: r.lastSoldAt,
                })),
            };
        },
    },

    {
        name: 'stock_movements',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        modules: ['inventory'],
        description:
            'The stock ledger: every recorded change in quantity with its reason (SALE, PURCHASE_RECEIPT, TRANSFER_IN, ' +
            'TRANSFER_OUT, SHRINKAGE, and so on), newest first. Use for "why did stock drop", "where did these units go", ' +
            '"what happened to this product". Resolve the product id with resolve_entity first.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_RANGE_PROPS,
                ...WAREHOUSE_PROP,
                ...PAGING_PROPS,
                productId: { type: 'string', description: 'Restrict to one product by id, from resolve_entity.' },
                movementType: {
                    type: 'string',
                    description: 'Restrict to one movement reason, e.g. SALE, PURCHASE_RECEIPT, SHRINKAGE, TRANSFER_OUT.',
                },
            },
        },
        handler: async (ctx, args, deps) => {
            const result = await deps.data.getStockMovements(ctx.tenantId, {
                productId: args.productId,
                warehouseId: args.warehouseId,
                from: args.from,
                to: args.to,
                movementType: args.movementType,
                // Fetch a page's worth plus enough to know whether more exist.
                limit: 200,
            });
            const paged = page(result.rows, args);
            return {
                unitsIn: result.totals.unitsIn,
                unitsOut: result.totals.unitsOut,
                netChange: result.totals.netChange,
                totalsNote: 'Totals cover the movements returned by this query, not the product\'s whole history.',
                ...paged,
            };
        },
    },

    {
        name: 'shrinkage_summary',
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        modules: ['inventory'],
        description:
            'Stock written off as damaged, lost, expired or stolen in a date range, with the value and the reasons. ' +
            'Use for "how much stock did we lose", shrinkage, wastage and damage questions.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...WAREHOUSE_PROP, ...PAGING_PROPS },
        },
        handler: async (ctx, args, deps) => {
            const result = await deps.inventoryReports.getShrinkageSummary(ctx.tenantId, {
                from: args.from,
                to: args.to,
                warehouseId: args.warehouseId,
            });
            const paged = page(result.rows, args);
            return {
                period: { from: args.from ?? null, to: args.to ?? null },
                totalQuantity: result.summary.totalQuantity,
                totalValue: money(result.summary.totalValue),
                valuationNote: 'Losses are valued at the current selling price, not cost.',
                ...paged,
                rows: paged.rows.map((r: any) => ({
                    warehouse: r.warehouseName,
                    reason: r.reasonLabel,
                    quantity: r.quantity,
                    value: money(r.value),
                })),
            };
        },
    },
];
