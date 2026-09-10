import { Test, TestingModule } from '@nestjs/testing';
import { CURRENT_TERMS_VERSION } from '@erp71/shared-types';
import { CallHandler, ExecutionContext, INestApplication, NestInterceptor, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service';
import { TransformInterceptor } from '../src/common/transform.interceptor';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

jest.setTimeout(30000);

class PassthroughInterceptor implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle();
    }
}

class UnwrapDataInterceptor implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(map((value: any) => value?.data ?? value));
    }
}

describe('Inventory Operations (e2e)', () => {
    let app: INestApplication;
    let db: DatabaseService;
    let authToken: string;
    let tenantId: string;
    let storeId: string;
    let productId: string;
    let sourceWarehouseId: string;
    let destWarehouseId: string;
    let loginPayload: any;
    let signupPayload: any;
    let userId: string;
    let shrinkageReasonId: string;

    const bodyOf = (response: any) => response.body?.data ?? response.body;

    beforeAll(async () => {
        process.env.JWT_SECRET = 'fallback-secret-for-dev-only';
        const { AppModule } = await import('../src/app.module');

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideInterceptor(TransformInterceptor)
            .useValue(new PassthroughInterceptor())
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe());
        app.useGlobalInterceptors(new UnwrapDataInterceptor());
        await app.init();

        db = moduleFixture.get<DatabaseService>(DatabaseService);

        // The legacy `packages/database/migrations/*.sql` files are NOT applied here
        // any more. `06_posting_rules_events.sql` did
        // `DROP TYPE IF EXISTS "PostingRuleEventType"` and recreated it with the ten
        // values it had when it was written; the Prisma schema is up to 24. Running
        // it left the database's enum missing everything added since, so every
        // subsequent signup 500'd on `postingRule.findFirst()` with
        // `22P02 invalid input value for enum` — which is what failed 69 cases
        // across these suites, and why they failed even against a live, seeded
        // Postgres. Those three suites also share one database, so whichever ran
        // first clobbered the others. The Prisma schema owns every one of these
        // tables now; provision with `prisma migrate deploy` / `db push` instead.

        await db.$executeRawUnsafe(
            'TRUNCATE TABLE posting_events, posting_rules, voucher_details, vouchers, voucher_sequences, accounts, account_subgroups, account_groups, "ProductStock", "Product", "Warehouse", "Store", "User", "Tenant" CASCADE',
        );

    });

    afterAll(async () => {
        await db.$disconnect();
        await app.close();
    });

    describe('Setup', () => {
        it('should register user and setup store', async () => {
            const signupRes = await request(app.getHttpServer())
                .post('/auth/signup')
                .send({
                    email: 'inv-test@example.com',
                    password: 'password123',
                    name: 'Inventory Tester',
                    tenantName: 'Inventory Tenant',
                    storeName: 'Inventory Store',
                    mobile: '01700000000',
                    acceptedTermsVersion: CURRENT_TERMS_VERSION,
                })
                .expect(201);

            signupPayload = bodyOf(signupRes);
            userId = signupPayload.user.id;

            const loginRes = await request(app.getHttpServer())
                .post('/auth/login')
                .send({ email: 'inv-test@example.com', password: 'password123' })
                .expect(201);

            loginPayload = bodyOf(loginRes);

            authToken = loginPayload?.access_token ?? signupPayload?.access_token;

            const membership = await db.tenantUser.findFirst({
                where: { user_id: userId },
                orderBy: { id: 'asc' },
            });
            expect(membership).toBeTruthy();
            tenantId = membership!.tenant_id;

            const access = await db.userStoreAccess.findFirst({
                where: { user_id: userId, tenant_id: tenantId },
                orderBy: { store_id: 'asc' },
            });
            expect(access).toBeTruthy();
            storeId = access!.store_id;

            const settings = await db.inventorySettings.upsert({
                where: { tenant_id: tenantId },
                update: {},
                create: { tenant_id: tenantId },
            });
            expect(settings).toBeTruthy();

            const createdShrinkageReason = await db.inventoryReason.create({
                data: {
                    tenant_id: tenantId,
                    type: 'SHRINKAGE',
                    code: 'DAMAGED',
                    label: 'Damaged',
                    is_active: true,
                },
            });
            shrinkageReasonId = createdShrinkageReason.id;

            await db.inventoryReason.create({
                data: {
                    tenant_id: tenantId,
                    type: 'DISCREPANCY',
                    code: 'COUNT',
                    label: 'Count Variance',
                    is_active: true,
                },
            });

            expect(authToken).toBeTruthy();
            expect(tenantId).toBeTruthy();
            expect(storeId).toBeTruthy();

            await request(app.getHttpServer())
                .get('/auth/me')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });

        it('should resolve default warehouse for the store', async () => {
            let warehouse = await db.warehouse.findFirst({ where: { store_id: storeId } });
            if (!warehouse) {
                warehouse = await db.warehouse.create({
                    data: {
                        tenant_id: tenantId,
                        store_id: storeId,
                        name: 'Main Warehouse',
                        code: 'WH-MAIN',
                    },
                });
            }
            sourceWarehouseId = warehouse.id;

            // Create a second warehouse to use as transfer destination
            const dest = await db.warehouse.create({
                data: {
                    tenant_id: tenantId,
                    store_id: storeId,
                    name: 'Secondary Warehouse',
                    code: 'WH-SEC',
                },
            });
            destWarehouseId = dest.id;
        });

        it('should create a product with initial stock', async () => {
            const res = await request(app.getHttpServer())
                .post('/products')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({ name: 'Inventory Item', sku: 'INV-001', price: 10.00, initialStock: 100 })
                .expect(201);

            productId = bodyOf(res).id;
        });
    });

    describe('Warehouse Transfers', () => {
        let transferId: string;

        it('should create a transfer with SENT status and decrement source stock', async () => {
            const stockBefore = await db.productStock.findFirst({
                where: { product_id: productId, warehouse_id: sourceWarehouseId },
            });
            const quantityBefore = stockBefore!.quantity;

            const res = await request(app.getHttpServer())
                .post('/warehouse-transfers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    sourceWarehouseId,
                    destinationWarehouseId: destWarehouseId,
                    status: 'SENT',
                    items: [{ productId, quantity: 10 }],
                });

            const transfer = bodyOf(res);

            expect(res.status).toBe(201);
            expect(transfer).toHaveProperty('id');
            expect(transfer).toHaveProperty('transfer_number');
            expect(transfer.status).toBe('SENT');
            transferId = transfer.id;

            const stockAfter = await db.productStock.findFirst({
                where: { product_id: productId, warehouse_id: sourceWarehouseId },
            });
            expect(stockAfter!.quantity).toBe(quantityBefore - 10);
        });

        it('should reject a transfer with the same source and destination', async () => {
            const res = await request(app.getHttpServer())
                .post('/warehouse-transfers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    sourceWarehouseId,
                    destinationWarehouseId: sourceWarehouseId,
                    status: 'SENT',
                    items: [{ productId, quantity: 5 }],
                });

            expect(res.status).toBe(400);
        });

        it('should receive a transfer and increment destination stock', async () => {
            const destStockBefore = await db.productStock.findFirst({
                where: { product_id: productId, warehouse_id: destWarehouseId },
            });
            const quantityBefore = destStockBefore?.quantity ?? 0;

            const res = await request(app.getHttpServer())
                .post(`/warehouse-transfers/${transferId}/receive`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    items: [{ productId, quantityReceived: 6 }],
                });

            const received = bodyOf(res);

            expect(res.status).toBe(201);
            expect(received.status).toMatch(/PARTIALLY_RECEIVED|RECEIVED/);

            const destStockAfter = await db.productStock.findFirst({
                where: { product_id: productId, warehouse_id: destWarehouseId },
            });
            expect(destStockAfter!.quantity).toBe(quantityBefore + 6);
        });

        it('should list all transfers for the tenant', async () => {
            const res = await request(app.getHttpServer())
                .get('/warehouse-transfers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const transfers = bodyOf(res);

            expect(res.status).toBe(200);
            expect(Array.isArray(transfers)).toBe(true);
            expect(transfers.length).toBeGreaterThan(0);
            expect(transfers[0]).toHaveProperty('transfer_number');
        });

        it('should fetch a single transfer by ID', async () => {
            const res = await request(app.getHttpServer())
                .get(`/warehouse-transfers/${transferId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const transfer = bodyOf(res);

            expect(res.status).toBe(200);
            expect(transfer.id).toBe(transferId);
            expect(transfer).toHaveProperty('items');
        });

        it('should filter transfers by status', async () => {
            const res = await request(app.getHttpServer())
                .get('/warehouse-transfers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .query({ status: 'SENT' });

            const transfers = bodyOf(res);

            expect(res.status).toBe(200);
            // Our transfer moved to PARTIALLY_RECEIVED so this should be empty or not include it
            const found = transfers.find((t: any) => t.id === transferId);
            expect(found).toBeUndefined();
        });
    });

    describe('Inventory Shrinkage', () => {
        it('should record inventory shrinkage and decrement stock', async () => {
            const stockBefore = await db.productStock.findFirst({
                where: { product_id: productId, warehouse_id: sourceWarehouseId },
            });
            const quantityBefore = stockBefore!.quantity;

            const res = await request(app.getHttpServer())
                .post('/inventory-shrinkage')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    warehouseId: sourceWarehouseId,
                    reasonId: shrinkageReasonId,
                    notes: 'Damaged in storage',
                    items: [{ productId, quantity: 3 }],
                });

            const shrinkage = bodyOf(res);

            expect(res.status).toBe(201);
            expect(shrinkage).toHaveProperty('id');
            expect(shrinkage.items).toHaveLength(1);

            const stockAfter = await db.productStock.findFirst({
                where: { product_id: productId, warehouse_id: sourceWarehouseId },
            });
            expect(stockAfter!.quantity).toBe(quantityBefore - 3);
        });

        it('should list all shrinkage records for the tenant', async () => {
            const res = await request(app.getHttpServer())
                .get('/inventory-shrinkage')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const shrinkages = bodyOf(res);

            expect(res.status).toBe(200);
            expect(Array.isArray(shrinkages)).toBe(true);
            expect(shrinkages.length).toBeGreaterThan(0);
        });
    });

    describe('Stock Takes', () => {
        let sessionId: string;

        it('should create a stock-take session with a snapshot of current stock', async () => {
            const res = await request(app.getHttpServer())
                .post('/stock-takes')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    warehouseId: sourceWarehouseId,
                    startImmediately: true,
                });

            const session = bodyOf(res);

            expect(res.status).toBe(201);
            expect(session).toHaveProperty('id');
            expect(session).toHaveProperty('session_number');
            expect(session.status).toBe('COUNTING');
            expect(session).toHaveProperty('summary');
            expect(session.summary.totalExpectedQuantity).toBeGreaterThan(0);
            sessionId = session.id;
        });

        it('should update count lines for the stock-take session', async () => {
            const sessionDetail = await request(app.getHttpServer())
                .get(`/stock-takes/${sessionId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .expect(200);

            const session = bodyOf(sessionDetail);
            const line = session.lines[0];
            const expectedQty = line.expected_quantity;

            const res = await request(app.getHttpServer())
                .patch(`/stock-takes/${sessionId}/counts`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    lines: [{ productId: line.product_id, countedQuantity: expectedQty }],
                });

            const updated = bodyOf(res);

            expect(res.status).toBe(200);
            expect(updated.summary).toBeDefined();
        });

        it('should list all stock-take sessions for the tenant', async () => {
            const res = await request(app.getHttpServer())
                .get('/stock-takes')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const sessions = bodyOf(res);

            expect(res.status).toBe(200);
            expect(Array.isArray(sessions)).toBe(true);
            expect(sessions.length).toBeGreaterThan(0);
            expect(sessions[0]).toHaveProperty('session_number');
        });

        it('should post a stock-take session with zero variance without requiring approval', async () => {
            // Update all lines to match expected so no variance triggers approval
            const sessionDetail = await request(app.getHttpServer())
                .get(`/stock-takes/${sessionId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .expect(200);

            const session = bodyOf(sessionDetail);

            await request(app.getHttpServer())
                .patch(`/stock-takes/${sessionId}/counts`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    lines: session.lines.map((l: any) => ({
                        productId: l.product_id,
                        countedQuantity: l.expected_quantity,
                    })),
                });

            const res = await request(app.getHttpServer())
                .post(`/stock-takes/${sessionId}/post`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const posted = bodyOf(res);

            expect(res.status).toBe(201);
            expect(posted.status).toBe('POSTED');
        });
    });

    /**
     * The warehouse a document names is the one its stock actually moves
     * through, and the one a reversal unwinds against. Proven end to end rather
     * than against a mocked client, because the value of the stored column is
     * precisely that it survives a round trip through the database.
     */
    describe('Warehouse selection on a sale', () => {
        let splitSaleId: string;
        let secondProductId: string;

        const movementsFor = (saleId: string, type: string) => db.inventoryMovement.findMany({
            where: { tenant_id: tenantId, reference_type: 'SALE', reference_id: saleId, movement_type: type },
            select: { product_id: true, warehouse_id: true, quantity_delta: true },
        });

        it('stocks a second product in both warehouses', async () => {
            const res = await request(app.getHttpServer())
                .post('/products')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({ name: 'Split Line Item', sku: 'SPLIT-001', price: 20.00, initialStock: 0 })
                .expect(201);

            secondProductId = bodyOf(res).id;

            // Enough in each warehouse for the sale below to draw from either.
            for (const warehouseId of [sourceWarehouseId, destWarehouseId]) {
                await db.productStock.upsert({
                    where: {
                        tenant_id_product_id_warehouse_id: {
                            tenant_id: tenantId,
                            product_id: secondProductId,
                            warehouse_id: warehouseId,
                        },
                    },
                    create: {
                        tenant_id: tenantId,
                        product_id: secondProductId,
                        warehouse_id: warehouseId,
                        quantity: 50,
                    },
                    update: { quantity: 50 },
                });
            }
        });

        it('posts each line out of the warehouse it names and records both levels', async () => {
            const res = await request(app.getHttpServer())
                .post('/sales')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    warehouseId: sourceWarehouseId,
                    totalAmount: 50,
                    amountPaid: 50,
                    items: [
                        { productId, quantity: 1, priceAtSale: 10 },
                        { productId: secondProductId, quantity: 2, priceAtSale: 20, warehouseId: destWarehouseId },
                    ],
                    payments: [{ paymentMethod: 'Cash', amount: 50 }],
                })
                .expect(201);

            splitSaleId = bodyOf(res).id;

            const sale = await db.sale.findUniqueOrThrow({
                where: { id: splitSaleId },
                include: { items: true },
            });
            expect(sale.warehouse_id).toBe(sourceWarehouseId);

            // The line that said nothing stores nothing and follows the sale;
            // the one that overrode stores exactly what it overrode with.
            const follower = sale.items.find((item) => item.product_id === productId);
            const override = sale.items.find((item) => item.product_id === secondProductId);
            expect(follower!.warehouse_id).toBeNull();
            expect(override!.warehouse_id).toBe(destWarehouseId);

            const movements = await movementsFor(splitSaleId, 'SALE');
            expect(movements).toHaveLength(2);
            expect(movements).toEqual(expect.arrayContaining([
                { product_id: productId, warehouse_id: sourceWarehouseId, quantity_delta: -1 },
                { product_id: secondProductId, warehouse_id: destWarehouseId, quantity_delta: -2 },
            ]));
        });

        it('restocks each line into the warehouse it was sold out of when the sale is deleted', async () => {
            // The regression this guards: before the sale recorded a warehouse,
            // a delete re-resolved the tenant default and could restock a
            // warehouse the goods had never been in.
            const beforeDest = await db.productStock.findFirstOrThrow({
                where: { product_id: secondProductId, warehouse_id: destWarehouseId },
            });

            await request(app.getHttpServer())
                .delete(`/sales/${splitSaleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .expect(200);

            const reversals = await movementsFor(splitSaleId, 'SALE_DELETE_REVERSAL');
            expect(reversals).toEqual(expect.arrayContaining([
                { product_id: productId, warehouse_id: sourceWarehouseId, quantity_delta: 1 },
                { product_id: secondProductId, warehouse_id: destWarehouseId, quantity_delta: 2 },
            ]));

            const afterDest = await db.productStock.findFirstOrThrow({
                where: { product_id: secondProductId, warehouse_id: destWarehouseId },
            });
            expect(afterDest.quantity).toBe(beforeDest.quantity + 2);
        });

        it('refuses a line warehouse that belongs to another store', async () => {
            const otherStore = await db.store.create({
                data: { tenant_id: tenantId, name: 'Other Branch', address: 'Elsewhere' },
            });
            const otherWarehouse = await db.warehouse.create({
                data: {
                    tenant_id: tenantId,
                    store_id: otherStore.id,
                    name: 'Other Branch Warehouse',
                    code: 'WH-OTHER',
                },
            });

            // Reaching another branch's warehouse from a line would move stock
            // between branches without a transfer.
            const res = await request(app.getHttpServer())
                .post('/sales')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    totalAmount: 10,
                    amountPaid: 10,
                    items: [{ productId, quantity: 1, priceAtSale: 10, warehouseId: otherWarehouse.id }],
                    payments: [{ paymentMethod: 'Cash', amount: 10 }],
                });

            expect(res.status).toBe(400);
        });
    });
});
