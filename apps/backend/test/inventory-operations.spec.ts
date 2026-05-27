import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler, ExecutionContext, INestApplication, NestInterceptor, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service';
import { TransformInterceptor } from '../src/common/transform.interceptor';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { readFileSync } from 'fs';
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

    const applyMigration = async (relativePath: string) => {
        const migrationPath = path.resolve(__dirname, relativePath);
        const sql = readFileSync(migrationPath, 'utf8');
        const statements = sql
            .split(/;\s*\n/g)
            .map((s) => s.trim())
            .filter(Boolean);
        for (const statement of statements) {
            await db.$executeRawUnsafe(`${statement};`);
        }
    };

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

        await applyMigration('../../../packages/database/migrations/03_accounting_coa.sql');
        await applyMigration('../../../packages/database/migrations/04_voucher_sequences.sql');
        await applyMigration('../../../packages/database/migrations/05_vouchers.sql');
        await applyMigration('../../../packages/database/migrations/06_posting_rules_events.sql');

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
});
