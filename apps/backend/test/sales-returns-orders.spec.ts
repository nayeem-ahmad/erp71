import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler, ExecutionContext, INestApplication, NestInterceptor, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service';
import { TransformInterceptor } from '../src/common/transform.interceptor';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
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

describe('Sales Returns & Orders (e2e)', () => {
    let app: INestApplication;
    let db: DatabaseService;
    let authToken: string;
    let tenantId: string;
    let storeId: string;
    let productId: string;
    let saleId: string;
    let saleItemId: string;
    let loginPayload: any;
    let signupPayload: any;

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
            'TRUNCATE TABLE posting_events, posting_rules, voucher_details, vouchers, voucher_sequences, accounts, account_subgroups, account_groups, "SaleItem", "Sale", "ProductStock", "Product", "Store", "User", "Tenant" CASCADE',
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
                    email: 'ret-test@example.com',
                    password: 'password123',
                    name: 'Returns Tester',
                    tenantName: 'Returns Tenant',
                    storeName: 'Returns Store',
                    mobile: '01700000000',
                })
                .expect(201);

            signupPayload = bodyOf(signupRes);

            const loginRes = await request(app.getHttpServer())
                .post('/auth/login')
                .send({ email: 'ret-test@example.com', password: 'password123' })
                .expect(201);

            loginPayload = bodyOf(loginRes);

            authToken = loginPayload?.access_token ?? signupPayload?.access_token;
            const tenantSource = loginPayload?.tenants?.[0] ?? signupPayload?.tenants?.[0];
            tenantId = tenantSource.id;
            storeId = tenantSource.stores[0].id;

            expect(authToken).toBeTruthy();
            expect(tenantId).toBeTruthy();
            expect(storeId).toBeTruthy();
        });

        it('should create a product with initial stock', async () => {
            const res = await request(app.getHttpServer())
                .post('/products')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({ name: 'Test Widget', sku: 'TW-001', price: 20.00, initialStock: 50 })
                .expect(201);

            const productBody = bodyOf(res);
            productId = productBody.id;
        });

        it('should process a sale to create returnable items', async () => {
            const res = await request(app.getHttpServer())
                .post('/sales')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    totalAmount: 60.00,
                    amountPaid: 60.00,
                    items: [{ productId, quantity: 3, priceAtSale: 20.00 }],
                })
                .expect(201);

            const saleBody = bodyOf(res);
            saleId = saleBody.id;
            saleItemId = saleBody.items?.[0]?.id;
            if (!saleItemId) {
                const persistedSaleItem = await db.saleItem.findFirst({
                    where: { sale_id: saleId },
                    orderBy: { id: 'asc' },
                    select: { id: true },
                });
                expect(persistedSaleItem).toBeTruthy();
                saleItemId = persistedSaleItem!.id;
            }
        });
    });

    describe('Sales Returns', () => {
        it('should create a sales return and increment stock', async () => {
            const productBefore = await db.product.findUnique({
                where: { id: productId },
                include: { stocks: true },
            });
            const stockBefore = productBefore!.stocks[0]!.quantity;

            const res = await request(app.getHttpServer())
                .post('/sales-returns')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    saleId,
                    items: [{ saleItemId, quantity: 2 }],
                });

            const salesReturn = bodyOf(res);

            expect(res.status).toBe(201);
            expect(salesReturn).toHaveProperty('id');
            expect(salesReturn).toHaveProperty('return_number');
            expect(salesReturn.items).toHaveLength(1);
            expect(salesReturn.items[0].quantity).toBe(2);

            const productAfter = await db.product.findUnique({
                where: { id: productId },
                include: { stocks: true },
            });
            expect(productAfter!.stocks[0]!.quantity).toBe(stockBefore + 2);
        });

        it('should reject a return that exceeds remaining returnable quantity', async () => {
            // Already returned 2 of 3; only 1 remains returnable
            const res = await request(app.getHttpServer())
                .post('/sales-returns')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    saleId,
                    items: [{ saleItemId, quantity: 2 }], // 2 > 1 remaining
                });

            expect(res.status).toBe(400);
        });

        it('should reject a return for a non-existent sale', async () => {
            const res = await request(app.getHttpServer())
                .post('/sales-returns')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    saleId: 'non-existent-sale-id',
                    items: [{ saleItemId, quantity: 1 }],
                });

            expect(res.status).toBe(400);
        });

        it('should list all sales returns for the tenant', async () => {
            const res = await request(app.getHttpServer())
                .get('/sales-returns')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const salesReturns = bodyOf(res);

            expect(res.status).toBe(200);
            expect(Array.isArray(salesReturns)).toBe(true);
            expect(salesReturns.length).toBeGreaterThan(0);
            expect(salesReturns[0]).toHaveProperty('return_number');
            expect(salesReturns[0]).toHaveProperty('sale');
        });

        it('should fetch a single sales return by ID', async () => {
            const allReturns = await request(app.getHttpServer())
                .get('/sales-returns')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const returnId = bodyOf(allReturns)[0].id;

            const res = await request(app.getHttpServer())
                .get(`/sales-returns/${returnId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const salesReturn = bodyOf(res);

            expect(res.status).toBe(200);
            expect(salesReturn.id).toBe(returnId);
            expect(salesReturn).toHaveProperty('items');
            expect(salesReturn).toHaveProperty('sale');
        });
    });

    describe('Sales Orders', () => {
        let orderId: string;

        it('should create a new sales order', async () => {
            const res = await request(app.getHttpServer())
                .post('/sales-orders')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    totalAmount: 100,
                    items: [{ productId, quantity: 5, priceAtOrder: 20 }],
                });

            const order = bodyOf(res);

            expect(res.status).toBe(201);
            expect(order).toHaveProperty('id');
            expect(order).toHaveProperty('order_number');
            orderId = order.id;
        });

        it('should list all sales orders for the tenant', async () => {
            const res = await request(app.getHttpServer())
                .get('/sales-orders')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const orders = bodyOf(res);

            expect(res.status).toBe(200);
            expect(Array.isArray(orders)).toBe(true);
            expect(orders.length).toBeGreaterThan(0);
        });

        it('should fetch a single sales order by ID', async () => {
            const res = await request(app.getHttpServer())
                .get(`/sales-orders/${orderId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const order = bodyOf(res);

            expect(res.status).toBe(200);
            expect(order.id).toBe(orderId);
            expect(order).toHaveProperty('items');
        });

        it('should reject access to an order from a different tenant', async () => {
            // Create a second tenant
            const setup2 = await request(app.getHttpServer())
                .post('/auth/signup')
                .send({
                    email: 'other-tenant@example.com',
                    password: 'password123',
                    name: 'Other Tenant User',
                    tenantName: 'Other Tenant',
                    storeName: 'Other Store',
                    mobile: '01700000001',
                })
                .expect(201);

            const setup2Body = bodyOf(setup2);
            const otherTenantId = setup2Body.tenants[0].id;

            const res = await request(app.getHttpServer())
                .get(`/sales-orders/${orderId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', otherTenantId);

            // Should be 404 (not found for that tenant) or 403
            expect([401, 403, 404]).toContain(res.status);
        });
    });

    describe('Sales Quotations', () => {
        let quotationId: string;

        it('should create a sales quotation', async () => {
            const res = await request(app.getHttpServer())
                .post('/sales-quotations')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    totalAmount: 40,
                    items: [{ productId, quantity: 2, unitPrice: 20 }],
                });

            const quotation = bodyOf(res);

            expect(res.status).toBe(201);
            expect(quotation).toHaveProperty('id');
            expect(quotation).toHaveProperty('quote_number');
            quotationId = quotation.id;
        });

        it('should list quotations for the tenant', async () => {
            const res = await request(app.getHttpServer())
                .get('/sales-quotations')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const quotations = bodyOf(res);

            expect(res.status).toBe(200);
            expect(Array.isArray(quotations)).toBe(true);
            expect(quotations.length).toBeGreaterThan(0);
        });

        it('should fetch a single quotation by ID', async () => {
            const res = await request(app.getHttpServer())
                .get(`/sales-quotations/${quotationId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const quotation = bodyOf(res);

            expect(res.status).toBe(200);
            expect(quotation.id).toBe(quotationId);
        });
    });

    describe('Customers', () => {
        let customerId: string;

        it('should create a customer', async () => {
            const res = await request(app.getHttpServer())
                .post('/customers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({ name: 'Alice Smith', phone: '01800000001', email: 'alice@example.com' });

            const customer = bodyOf(res);

            expect(res.status).toBe(201);
            expect(customer).toHaveProperty('id');
            expect(customer.name).toBe('Alice Smith');
            customerId = customer.id;
        });

        it('should reject a duplicate phone number', async () => {
            const res = await request(app.getHttpServer())
                .post('/customers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({ name: 'Bob Jones', phone: '01800000001' }); // same phone

            expect(res.status).toBe(400);
        });

        it('should list all customers for the tenant', async () => {
            const res = await request(app.getHttpServer())
                .get('/customers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const customers = bodyOf(res);
            const customerItems = Array.isArray(customers) ? customers : customers.items;

            expect(res.status).toBe(200);
            expect(Array.isArray(customerItems)).toBe(true);
            expect(customerItems.some((c: any) => c.id === customerId)).toBe(true);
        });

        it('should fetch a single customer by ID', async () => {
            const res = await request(app.getHttpServer())
                .get(`/customers/${customerId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const customer = bodyOf(res);

            expect(res.status).toBe(200);
            expect(customer.id).toBe(customerId);
            expect(customer.name).toBe('Alice Smith');
        });

        it('should return 404 for a non-existent customer', async () => {
            const res = await request(app.getHttpServer())
                .get('/customers/non-existent-id')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId);

            expect(res.status).toBe(404);
        });

        it('should associate a customer with a sale and track total_spent', async () => {
            const saleRes = await request(app.getHttpServer())
                .post('/sales')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    customerId,
                    totalAmount: 40.00,
                    amountPaid: 40.00,
                    items: [{ productId, quantity: 2, priceAtSale: 20.00 }],
                });

            expect(saleRes.status).toBe(201);

            const customerRes = await request(app.getHttpServer())
                .get(`/customers/${customerId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const customer = bodyOf(customerRes);

            expect(Number.parseFloat(customer.total_spent)).toBe(40);
        });
    });
});
