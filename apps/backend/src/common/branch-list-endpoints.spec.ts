import { ForbiddenException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import {
    INVENTORY_REPORT_READ,
    PURCHASE_READ,
    SALES_READ,
    SHRINKAGE_STAFF,
    STOCK_TAKE_STAFF,
} from '../auth/permission-sets';
import { SalesController } from '../sales/sales.controller';
import { SalesService } from '../sales/sales.service';
import { SalesOrdersController } from '../sales-orders/sales-orders.controller';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { SalesQuotationsController } from '../sales-quotations/sales-quotations.controller';
import { SalesQuotationsService } from '../sales-quotations/sales-quotations.service';
import { SalesReturnsController } from '../sales-returns/sales-returns.controller';
import { SalesReturnsService } from '../sales-returns/sales-returns.service';
import { WarrantyClaimsController } from '../warranty-claims/warranty-claims.controller';
import { WarrantyClaimsService } from '../warranty-claims/warranty-claims.service';
import { PurchasesController } from '../purchases/purchases.controller';
import { PurchasesService } from '../purchases/purchases.service';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { PurchaseQuotationsController } from '../purchase-quotations/purchase-quotations.controller';
import { PurchaseQuotationsService } from '../purchase-quotations/purchase-quotations.service';
import { PurchaseReturnsController } from '../purchase-returns/purchase-returns.controller';
import { PurchaseReturnsService } from '../purchase-returns/purchase-returns.service';
import { ImportsController } from '../imports/imports.controller';
import { ImportsService } from '../imports/imports.service';
import { StockTakesController } from '../stock-takes/stock-takes.controller';
import { StockTakesService } from '../stock-takes/stock-takes.service';
import { InventoryShrinkageController } from '../inventory-shrinkage/inventory-shrinkage.controller';
import { InventoryShrinkageService } from '../inventory-shrinkage/inventory-shrinkage.service';
import { WarehouseTransfersController } from '../warehouse-transfers/warehouse-transfers.controller';
import { WarehouseTransfersService } from '../warehouse-transfers/warehouse-transfers.service';
import { ProductDemandsController } from '../product-demands/product-demands.controller';
import { ProductDemandsService } from '../product-demands/product-demands.service';
import { InventoryController } from '../inventory/inventory.controller';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Phase 4 of the branch filter: every transaction list takes `storeId` (a
 * branch or `all`), runs it through BranchScopeService with the route's own
 * read permissions, and narrows its `where` to the branch — directly, or
 * through the warehouse for inventory documents.
 */
const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;

type ControllerCase = {
    name: string;
    make: (service: any, branchScope: any) => any;
    call: (controller: any, storeId: string | undefined) => Promise<unknown>;
    method: string;
    permissions: readonly StorePermission[];
    /** Where the resolved id lands in the service call. */
    received: (args: any[]) => unknown;
};

const optsAt = (index: number) => (args: any[]) => args[index]?.storeId;

const controllerCases: ControllerCase[] = [
    {
        name: 'GET /sales',
        make: (s, b) => new SalesController(s, b),
        call: (c, id) => c.findAll(tenant, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, id),
        method: 'findAll',
        permissions: SALES_READ,
        received: optsAt(1),
    },
    {
        name: 'GET /sales-orders',
        make: (s, b) => new SalesOrdersController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: SALES_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /sales-quotations',
        make: (s, b) => new SalesQuotationsController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: SALES_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /sales-returns',
        make: (s, b) => new SalesReturnsController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: SALES_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /warranty-claims',
        make: (s, b) => new WarrantyClaimsController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: SALES_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /purchases',
        make: (s, b) => new PurchasesController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: PURCHASE_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /purchase-orders',
        make: (s, b) => new PurchaseOrdersController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: PURCHASE_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /purchase-quotations',
        make: (s, b) => new PurchaseQuotationsController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: PURCHASE_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /purchase-returns',
        make: (s, b) => new PurchaseReturnsController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: PURCHASE_READ,
        received: optsAt(3),
    },
    {
        name: 'GET /imports',
        make: (s, b) => new ImportsController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: [StorePermission.VIEW_IMPORTS, StorePermission.MANAGE_IMPORTS],
        received: optsAt(1),
    },
    {
        name: 'GET /imports/lc-register',
        make: (s, b) => new ImportsController(s, b),
        call: (c, id) => c.lcRegister(tenant, '30', id),
        method: 'lcRegister',
        permissions: [StorePermission.VIEW_IMPORTS, StorePermission.MANAGE_IMPORTS],
        received: (args) => args[2],
    },
    {
        name: 'GET /imports/duty-report',
        make: (s, b) => new ImportsController(s, b),
        call: (c, id) => c.dutyReport(tenant, '2026-09-01', '2026-09-30', id),
        method: 'dutyReport',
        permissions: [StorePermission.VIEW_IMPORTS, StorePermission.MANAGE_IMPORTS],
        received: optsAt(1),
    },
    {
        name: 'GET /stock-takes',
        make: (s, b) => new StockTakesController(s, b),
        call: (c, id) => c.findAll(tenant, { page: 1, limit: 20, storeId: id }),
        method: 'findAll',
        permissions: STOCK_TAKE_STAFF,
        received: optsAt(3),
    },
    {
        name: 'GET /inventory-shrinkage',
        make: (s, b) => new InventoryShrinkageController(s, b),
        call: (c, id) => c.findAll(tenant, undefined, undefined, undefined, id),
        method: 'findAll',
        permissions: SHRINKAGE_STAFF,
        received: optsAt(1),
    },
    {
        name: 'GET /warehouse-transfers',
        make: (s, b) => new WarehouseTransfersController(s, b),
        call: (c, id) => c.findAll(tenant, { storeId: id }),
        method: 'findAll',
        permissions: [StorePermission.VIEW_PRODUCT_CATALOG],
        received: optsAt(1),
    },
    {
        name: 'GET /product-demands',
        make: (s, b) => new ProductDemandsController(s, b),
        call: (c, id) => c.findAll(tenant, { storeId: id }),
        method: 'findAll',
        permissions: [StorePermission.VIEW_PRODUCT_CATALOG],
        received: optsAt(1),
    },
    {
        name: 'GET /inventory/ledger',
        make: (s, b) => new InventoryController(s, b),
        call: (c, id) => c.getLedger(tenant, { storeId: id }),
        method: 'getLedger',
        permissions: INVENTORY_REPORT_READ,
        received: optsAt(1),
    },
];

describe('branch-aware transaction lists — controllers', () => {
    describe.each(controllerCases)('$name', ({ make, call, method, permissions, received }) => {
        const service: Record<string, jest.Mock> = { [method]: jest.fn().mockResolvedValue([]) };
        const branchScope = { resolveStoreId: jest.fn() };
        const controller = make(service, branchScope);

        beforeEach(() => jest.clearAllMocks());

        it("hands the service the resolved branch, checked with the route's read permissions", async () => {
            branchScope.resolveStoreId.mockResolvedValue('s2');
            await call(controller, 's2');
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's2', { permissions });
            expect(received(service[method].mock.calls[0])).toBe('s2');
        });

        it("passes the whole tenant through for 'all'", async () => {
            branchScope.resolveStoreId.mockResolvedValue(undefined);
            await call(controller, 'all');
            expect(service[method]).toHaveBeenCalled();
            expect(received(service[method].mock.calls[0])).toBeUndefined();
        });

        it('refuses a branch the caller cannot use before listing', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(call(controller, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
            expect(service[method]).not.toHaveBeenCalled();
        });
    });
});

/**
 * A database whose every model answers empty and records what it was asked:
 * enough for each list to run its query and for the test to read the `where`.
 */
function recordingDb() {
    const models = new Map<string, Record<string, jest.Mock>>();
    const empty = (op: string) => {
        if (op === 'count') return 0;
        if (op === 'findFirst' || op === 'findUnique') return null;
        if (op === 'aggregate') return { _sum: {}, _count: { _all: 0 } };
        return [];
    };
    const db: any = new Proxy(
        {},
        {
            get(_target, model: string) {
                if (model === '$transaction') return async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(db));
                if (model === '$queryRaw') return jest.fn().mockResolvedValue([]);
                if (!models.has(model)) {
                    models.set(
                        model,
                        new Proxy({} as Record<string, jest.Mock>, {
                            get(ops, op: string) {
                                if (!ops[op]) ops[op] = jest.fn().mockResolvedValue(empty(op));
                                return ops[op];
                            },
                        }),
                    );
                }
                return models.get(model);
            },
        },
    );
    return { db, model: (name: string) => models.get(name) as Record<string, jest.Mock> };
}

type ServiceCase = {
    name: string;
    run: (db: any, storeId: string) => Promise<unknown>;
    model: string;
    expected: Record<string, unknown>;
};

const opts = (storeId: string) => ({ timezone: 'Asia/Dhaka', storeId });
const branch = { store_id: 's2' };
const viaWarehouse = { warehouse: branch };

const serviceCases: ServiceCase[] = [
    { name: 'sales', run: (db, id) => new SalesService(db, {} as any, {} as any, {} as any).findAll('t1', opts(id)), model: 'sale', expected: branch },
    { name: 'sales orders', run: (db, id) => new SalesOrdersService(db).findAll('t1', 1, 20, opts(id)), model: 'salesOrder', expected: branch },
    {
        name: 'sales quotations',
        run: (db, id) => new SalesQuotationsService(db, {} as any, {} as any, {} as any).findAll('t1', 1, 20, opts(id)),
        model: 'quotation',
        expected: branch,
    },
    { name: 'sales returns', run: (db, id) => new SalesReturnsService(db).findAll('t1', 1, 20, opts(id)), model: 'salesReturn', expected: branch },
    { name: 'warranty claims', run: (db, id) => new WarrantyClaimsService(db).findAll('t1', 1, 20, opts(id)), model: 'warrantyClaim', expected: branch },
    { name: 'purchases', run: (db, id) => new PurchasesService(db).findAll('t1', 1, 20, opts(id)), model: 'purchase', expected: branch },
    { name: 'purchase orders', run: (db, id) => new PurchaseOrdersService(db).findAll('t1', 1, 20, opts(id)), model: 'purchaseOrder', expected: branch },
    {
        name: 'purchase quotations',
        run: (db, id) => new PurchaseQuotationsService(db).findAll('t1', 1, 20, opts(id)),
        model: 'purchaseQuotation',
        expected: branch,
    },
    { name: 'purchase returns', run: (db, id) => new PurchaseReturnsService(db).findAll('t1', 1, 20, opts(id)), model: 'purchaseReturn', expected: branch },
    { name: 'import shipments', run: (db, id) => new ImportsService(db, {} as any).findAll('t1', { storeId: id } as any), model: 'importShipment', expected: branch },
    { name: 'LC register', run: (db, id) => new ImportsService(db, {} as any).lcRegister('t1', undefined, id), model: 'importShipment', expected: branch },
    {
        name: 'duty report',
        run: (db, id) => new ImportsService(db, {} as any).dutyReport('t1', { storeId: id }),
        model: 'importCost',
        expected: { shipment: branch },
    },
    { name: 'stock takes', run: (db, id) => new StockTakesService(db).findAll('t1', 1, 20, opts(id)), model: 'stockTakeSession', expected: viaWarehouse },
    {
        name: 'inventory shrinkage',
        run: (db, id) => new InventoryShrinkageService(db).findAll('t1', opts(id)),
        model: 'inventoryShrinkage',
        expected: viaWarehouse,
    },
    {
        name: 'warehouse transfers (either end)',
        run: (db, id) => new WarehouseTransfersService(db).findAll('t1', { storeId: id }),
        model: 'warehouseTransfer',
        expected: { OR: [{ sourceWarehouse: branch }, { destinationWarehouse: branch }] },
    },
    { name: 'product demands', run: (db, id) => new ProductDemandsService(db).findAll('t1', { storeId: id }), model: 'productDemand', expected: viaWarehouse },
    { name: 'stock ledger', run: (db, id) => new InventoryService(db).getLedger('t1', { storeId: id }), model: 'inventoryMovement', expected: viaWarehouse },
];

describe('branch-aware transaction lists — services', () => {
    it.each(serviceCases)('$name narrows its where to the branch', async ({ run, model, expected }) => {
        const { db, model: modelOf } = recordingDb();
        await run(db, 's2');
        const where = modelOf(model).findMany.mock.calls[0][0].where;
        expect(where).toEqual(expect.objectContaining({ tenant_id: 't1', ...expected }));
    });

    it.each(serviceCases)('$name reads every branch with no branch resolved', async ({ run, model, expected }) => {
        const { db, model: modelOf } = recordingDb();
        await run(db, undefined as unknown as string);
        const where = modelOf(model).findMany.mock.calls[0][0].where;
        for (const key of Object.keys(expected)) expect(where[key]).toBeUndefined();
    });
});
