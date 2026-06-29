import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler, ExecutionContext, INestApplication, NestInterceptor, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { VoucherType } from '@erp71/shared-types';
import { AccountingService } from '../src/accounting/accounting.service';
import { DatabaseService } from '../src/database/database.service';
import { TransformInterceptor } from '../src/common/transform.interceptor';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

jest.setTimeout(20000);

class PassthroughInterceptor implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle();
    }
}

class UnwrapDataInterceptor implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            map((value: any) => {
                if (
                    value &&
                    typeof value === 'object' &&
                    !Array.isArray(value) &&
                    Object.keys(value).length === 1 &&
                    'data' in value
                ) {
                    return value.data;
                }

                return value;
            }),
        );
    }
}

describe('Integration Tests (e2e)', () => {
    let app: INestApplication;
    let accountingService: AccountingService;
    let db: DatabaseService;
    let authToken: string;
    let tenantId: string;
    let storeId: string;
    let secondTenantId: string;
    let purchaseId: string;
    let purchaseItemId: string;
    let voucherId: string;
    let cashAccountId: string;
    let loginPayload: any;
    let signupPayload: any;
    let secondAuthToken: string;

    const bodyOf = (response: any) => response.body?.data ?? response.body;

    const applyMigration = async (relativePath: string) => {
        const migrationPath = path.resolve(__dirname, relativePath);
        const sql = readFileSync(migrationPath, 'utf8');
        const statements = sql
            .split(/;\s*\n/g)
            .map((statement) => statement.trim())
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
        accountingService = moduleFixture.get<AccountingService>(AccountingService);

        await applyMigration('../../../packages/database/migrations/03_accounting_coa.sql');
        await applyMigration('../../../packages/database/migrations/04_voucher_sequences.sql');
        await applyMigration('../../../packages/database/migrations/05_vouchers.sql');
        await applyMigration('../../../packages/database/migrations/06_posting_rules_events.sql');

        // Clean database before tests
        // Note: In a real scenario, use a TDB or separate schema
        await db.$executeRawUnsafe('TRUNCATE TABLE posting_events, posting_rules, voucher_details, vouchers, voucher_sequences, accounts, account_subgroups, account_groups, "SaleItem", "Sale", "ProductStock", "Product", "Store", "User", "Tenant" CASCADE');
    });

    afterAll(async () => {
        await db.$disconnect();
        await app.close();
    });

    describe('Auth & Store Setup', () => {
        it('should signup a new user', async () => {
            const response = await request(app.getHttpServer())
                .post('/auth/signup')
                .send({
                    email: 'test@example.com',
                    password: 'password123',
                    name: 'Test User',
                    tenantName: 'Integration Tenant',
                    storeName: 'Integration Store',
                });

            const payload = bodyOf(response);
            signupPayload = payload;

            expect(response.status).toBe(201);
            expect(payload).toHaveProperty('user');
            expect(payload.user.email).toBe('test@example.com');
        });

        it('should login and return a token', async () => {
            const response = await request(app.getHttpServer())
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123',
                });

            loginPayload = bodyOf(response);

            expect(response.status).toBe(201);
            expect(loginPayload).toHaveProperty('access_token');
            authToken = loginPayload?.access_token ?? signupPayload?.access_token;
        });

        it('should setup a store', async () => {
            const tenantSource = loginPayload?.tenants?.[0] ?? signupPayload?.tenants?.[0];
            expect(tenantSource).toBeTruthy();
            tenantId = tenantSource.id;
            storeId = tenantSource.stores[0].id;

            const premiumPlan = await db.subscriptionPlan.findUnique({ where: { code: 'PREMIUM' } });
            if (!premiumPlan) {
                throw new Error('Missing PREMIUM subscription plan for integration test setup.');
            }
            await db.tenantSubscription.update({
                where: { tenant_id: tenantId },
                data: { plan_id: premiumPlan.id },
            });

            expect(authToken).toBeTruthy();
            expect(tenantId).toBeTruthy();
            expect(storeId).toBeTruthy();
        });
    });

    describe('Product Management', () => {
        it('should create a new product', async () => {
            const response = await request(app.getHttpServer())
                .post('/products')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    name: 'Coffee Beans',
                    sku: 'CB-001',
                    price: 15.5,
                    category: 'Beverages',
                    initialStock: 100,
                });

            const product = bodyOf(response);

            expect(response.status).toBe(201);
            expect(product).toHaveProperty('id');
        });

        it('should get all products for the store', async () => {
            const response = await request(app.getHttpServer())
                .get('/products')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId);

            const productsResponse = bodyOf(response);
            const products = Array.isArray(productsResponse) ? productsResponse : productsResponse.items;

            expect(response.status).toBe(200);
            expect(Array.isArray(products)).toBe(true);
            expect(products.length).toBeGreaterThan(0);
            expect(products[0].name).toBe('Coffee Beans');
        });
    });

    describe('Accounting Voucher Numbering', () => {
        it('should preview the next voucher number by type', async () => {
            const response = await request(app.getHttpServer())
                .get('/accounting/vouchers/next-number')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .query({ voucherType: VoucherType.CASH_PAYMENT });

            const preview = bodyOf(response);

            expect(response.status).toBe(200);
            expect(preview.voucherNumber).toBe('CP-00001');
        });

        it('should generate unique same-tenant voucher numbers under concurrent requests', async () => {
            const results = await Promise.all([
                accountingService.generateNextVoucherNumber(tenantId, VoucherType.CASH_PAYMENT),
                accountingService.generateNextVoucherNumber(tenantId, VoucherType.CASH_PAYMENT),
                accountingService.generateNextVoucherNumber(tenantId, VoucherType.CASH_PAYMENT),
            ]);

            const voucherNumbers = results.map((result) => result.voucherNumber).sort((left, right) => left.localeCompare(right));
            expect(voucherNumbers).toEqual(['CP-00001', 'CP-00002', 'CP-00003']);
        });

        it('should keep voucher numbering independent across tenants', async () => {
            const signupResponse = await request(app.getHttpServer())
                .post('/auth/signup')
                .send({
                    email: 'second@example.com',
                    password: 'password123',
                    name: 'Second User',
                    tenantName: 'Second Tenant',
                    storeName: 'Second Store',
                });

            const signupPayload = bodyOf(signupResponse);

            expect(signupResponse.status).toBe(201);
            secondTenantId = signupPayload.tenants[0].id;
            secondAuthToken = signupPayload.access_token;

            const premiumPlan = await db.subscriptionPlan.findUnique({ where: { code: 'PREMIUM' } });
            if (!premiumPlan) {
                throw new Error('Missing PREMIUM subscription plan for second-tenant integration test setup.');
            }
            await db.tenantSubscription.update({
                where: { tenant_id: secondTenantId },
                data: { plan_id: premiumPlan.id },
            });

            const number = await accountingService.generateNextVoucherNumber(secondTenantId, VoucherType.CASH_PAYMENT);

            expect(number.voucherNumber).toBe('CP-00001');
        });
    });

    describe('Accounting Voucher API', () => {
        it('should create a balanced cash payment voucher with nested details', async () => {
            const cashAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'Cash in Hand' },
            });
            const expenseAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'General Operating Expense' },
            });

            expect(cashAccount).toBeTruthy();
            expect(expenseAccount).toBeTruthy();

            cashAccountId = cashAccount?.id ?? '';

            const response = await request(app.getHttpServer())
                .post('/accounting/vouchers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({
                    voucherType: VoucherType.CASH_PAYMENT,
                    date: '2026-03-01',
                    description: 'Office expense settlement',
                    referenceNumber: 'CP-REF-1',
                    details: [
                        { accountId: cashAccount?.id, debitAmount: 0, creditAmount: 125 },
                        { accountId: expenseAccount?.id, debitAmount: 125, creditAmount: 0 },
                    ],
                });

            const voucher = bodyOf(response);

            expect(response.status).toBe(201);
            expect(voucher.voucher_number).toMatch(/^CP-\d{5}$/);
            expect(voucher.details).toHaveLength(2);
            expect(voucher.details[0].account).toHaveProperty('name');
            voucherId = voucher.id;
        });

        it('should reject unbalanced vouchers', async () => {
            const cashAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'Cash in Hand' },
            });
            const expenseAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'General Operating Expense' },
            });

            const response = await request(app.getHttpServer())
                .post('/accounting/vouchers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({
                    voucherType: VoucherType.CASH_PAYMENT,
                    details: [
                        { accountId: cashAccount?.id, debitAmount: 0, creditAmount: 125 },
                        { accountId: expenseAccount?.id, debitAmount: 100, creditAmount: 0 },
                    ],
                });

            const errorBody = bodyOf(response);

            expect(response.status).toBe(400);
            expect(errorBody.message).toBe('Voucher debits and credits must balance.');
        });

        it('should list vouchers with pagination metadata and filter by type', async () => {
            const response = await request(app.getHttpServer())
                .get('/accounting/vouchers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .query({ voucherType: VoucherType.CASH_PAYMENT, page: 1, limit: 10 });

            const vouchers = response.body?.meta ? response.body : response.body?.data ?? response.body;

            expect(response.status).toBe(200);
            expect(vouchers.meta).toMatchObject({ page: 1, limit: 10, total: 1 });
            expect(vouchers.data).toHaveLength(1);
            expect(vouchers.data[0].voucher_number).toMatch(/^CP-\d{5}$/);
            expect(vouchers.data[0].total_amount).toBe(125);
        });

        it('should return a single voucher with full detail rows', async () => {
            const response = await request(app.getHttpServer())
                .get(`/accounting/vouchers/${voucherId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId);

            const voucher = bodyOf(response);

            expect(response.status).toBe(200);
            expect(voucher.id).toBe(voucherId);
            expect(voucher.details).toHaveLength(2);
            expect(voucher.details[0].account).toHaveProperty('name');
        });
    });

    describe('Accounting Ledger API', () => {
        it('should return a ledger with opening balance and running balance for an asset account', async () => {
            const revenueAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'Sales Revenue' },
            });

            const cashReceiptResponse = await request(app.getHttpServer())
                .post('/accounting/vouchers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({
                    voucherType: VoucherType.CASH_RECEIVE,
                    date: '2026-03-05',
                    description: 'Customer collection',
                    referenceNumber: 'CR-REF-1',
                    details: [
                        { accountId: cashAccountId, debitAmount: 300, creditAmount: 0 },
                        { accountId: revenueAccount?.id, debitAmount: 0, creditAmount: 300 },
                    ],
                });

            expect(cashReceiptResponse.status).toBe(201);

            const response = await request(app.getHttpServer())
                .get(`/accounting/reports/ledger/${cashAccountId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .query({ from: '2026-03-05', to: '2026-03-31' });

            const ledger = bodyOf(response);

            expect(response.status).toBe(200);
            expect(ledger.account.id).toBe(cashAccountId);
            expect(ledger.normal_balance_side).toBe('debit');
            expect(ledger.opening_balance).toBe(125);
            expect(ledger.opening_balance_side).toBe('credit');
            expect(ledger.closing_balance).toBe(175);
            expect(ledger.closing_balance_side).toBe('debit');
            expect(ledger.totals).toMatchObject({ debit: 300, credit: 0 });
            expect(ledger.data).toHaveLength(1);
            expect(ledger.data[0]).toMatchObject({
                voucher_type: VoucherType.CASH_RECEIVE,
                debit_amount: 300,
                credit_amount: 0,
                running_balance: 175,
                running_balance_side: 'debit',
            });
        });

        it('should return accounting dashboard KPIs derived from posted vouchers', async () => {
            const response = await request(app.getHttpServer())
                .get('/accounting/dashboard/kpis')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .query({ from: '2026-03-01', to: '2026-03-31' });

            const kpisResponse = bodyOf(response);

            expect(response.status).toBe(200);
            expect(kpisResponse.filters).toEqual({ from: '2026-03-01', to: '2026-03-31' });
            expect(kpisResponse.kpis).toEqual({
                cash_inflow: 300,
                cash_outflow: 125,
                net_cash_movement: 175,
                gross_revenue: 300,
                operating_expense: 125,
                accounts_receivable: null,
                accounts_payable: 0,
                tax_liability: null,
            });
        });

        it('should return accounting dashboard trend points and comparison totals', async () => {
            const response = await request(app.getHttpServer())
                .get('/accounting/dashboard/trends')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .query({ from: '2026-03-01', to: '2026-03-05' });

            const trends = bodyOf(response);

            expect(response.status).toBe(200);
            expect(trends.filters).toEqual({ from: '2026-03-01', to: '2026-03-05' });
            expect(trends.granularity).toBe('day');
            expect(trends.has_activity).toBe(true);
            expect(trends.points).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    date: '2026-03-01',
                    cash_inflow: 0,
                    cash_outflow: 125,
                    net_profit: -125,
                }),
                expect.objectContaining({
                    date: '2026-03-05',
                    cash_inflow: 300,
                    cash_outflow: 0,
                    net_profit: 300,
                }),
            ]));
            expect(trends.comparison).toEqual({
                net_profit: 175,
                gross_margin: null,
                gross_margin_status: 'unavailable',
                gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
            });
        });

        it('should return receivable, payable, and tax liability balances when configured accounts exist', async () => {
            const revenueAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'Sales Revenue' },
            });
            const expenseAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'General Operating Expense' },
            });
            const assetGroup = await db.accountGroup.findFirst({
                where: { tenant_id: tenantId, name: 'Current Assets' },
            });
            const liabilityGroup = await db.accountGroup.findFirst({
                where: { tenant_id: tenantId, name: 'Current Liabilities' },
            });
            const payableAccount = await db.account.findFirst({
                where: { tenant_id: tenantId, name: 'Purchase Payable' },
            });

            if (!assetGroup || !liabilityGroup) {
                throw new Error('Missing seeded accounting groups for KPI integration test.');
            }

            const receivableAccount = await db.account.create({
                data: {
                    tenant_id: tenantId,
                    group_id: assetGroup.id,
                    name: 'Accounts Receivable',
                    code: '1030',
                    type: 'asset',
                    category: 'general',
                },
            });
            const taxLiabilityAccount = await db.account.create({
                data: {
                    tenant_id: tenantId,
                    group_id: liabilityGroup.id,
                    name: 'VAT Payable',
                    code: '2020',
                    type: 'liability',
                    category: 'general',
                },
            });

            await request(app.getHttpServer())
                .post('/accounting/vouchers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({
                    voucherType: VoucherType.JOURNAL,
                    date: '2026-04-02',
                    description: 'Credit sale',
                    details: [
                        { accountId: receivableAccount.id, debitAmount: 90, creditAmount: 0 },
                        { accountId: revenueAccount?.id, debitAmount: 0, creditAmount: 90 },
                    ],
                })
                .expect(201);

            await request(app.getHttpServer())
                .post('/accounting/vouchers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({
                    voucherType: VoucherType.JOURNAL,
                    date: '2026-04-04',
                    description: 'Expense accrued',
                    details: [
                        { accountId: expenseAccount?.id, debitAmount: 20, creditAmount: 0 },
                        { accountId: payableAccount?.id, debitAmount: 0, creditAmount: 20 },
                    ],
                })
                .expect(201);

            await request(app.getHttpServer())
                .post('/accounting/vouchers')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .send({
                    voucherType: VoucherType.JOURNAL,
                    date: '2026-04-05',
                    description: 'VAT accrual',
                    details: [
                        { accountId: expenseAccount?.id, debitAmount: 15, creditAmount: 0 },
                        { accountId: taxLiabilityAccount.id, debitAmount: 0, creditAmount: 15 },
                    ],
                })
                .expect(201);

            const response = await request(app.getHttpServer())
                .get('/accounting/dashboard/kpis')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .query({ from: '2026-04-01', to: '2026-04-30' });

            const kpisResponse = bodyOf(response);

            expect(response.status).toBe(200);
            expect(kpisResponse.kpis).toEqual({
                cash_inflow: 0,
                cash_outflow: 0,
                net_cash_movement: 0,
                gross_revenue: 90,
                operating_expense: 35,
                accounts_receivable: 90,
                accounts_payable: 20,
                tax_liability: 15,
            });
        });

        it('should return null for optional metrics when receivable or tax liability accounts are not configured', async () => {
            const response = await request(app.getHttpServer())
                .get('/accounting/dashboard/kpis')
                .set('Authorization', `Bearer ${secondAuthToken}`)
                .set('x-tenant-id', secondTenantId)
                .query({ from: '2026-04-01', to: '2026-04-30' });

            const kpisResponse = bodyOf(response);

            expect(response.status).toBe(200);
            expect(kpisResponse.kpis.accounts_receivable).toBeNull();
            expect(kpisResponse.kpis.accounts_payable).toBe(0);
            expect(kpisResponse.kpis.tax_liability).toBeNull();
        });

        it('should reject invalid KPI date ranges', async () => {
            const response = await request(app.getHttpServer())
                .get('/accounting/dashboard/kpis')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .query({ from: '2026-03-31', to: '2026-03-01' });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('The from date must be on or before the to date.');
        });

        it('should reject cross-tenant access to another tenant account ledger', async () => {
            const response = await request(app.getHttpServer())
                .get(`/accounting/reports/ledger/${cashAccountId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', secondTenantId);

            expect(response.status).toBe(401);
        });
    });

    describe('POS Sales', () => {
        it('should process a sale and decrement stock', async () => {
            // 1. Get product first to ensure we have ID
            const product = await db.product.findFirst({
                where: { sku: 'CB-001' },
                include: { stocks: true }
            });
            const initialStock = product?.stocks[0]?.quantity || 0;

            // 2. Process sale
            const response = await request(app.getHttpServer())
                .post('/sales')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId: storeId,
                    totalAmount: 31,
                    amountPaid: 31,
                    items: [
                        {
                            productId: product?.id,
                            quantity: 2,
                            priceAtSale: 15.5,
                        }
                    ]
                });

            const sale = bodyOf(response);

            expect(response.status).toBe(201);
            expect(sale).toHaveProperty('id');

            // 3. Verify stock decrement
            const productAfter = await db.product.findUnique({
                where: { id: product?.id },
                include: { stocks: true }
            });
            expect(productAfter?.stocks[0]?.quantity).toBe(initialStock - 2);
        });

        it('should fail if stock is insufficient', async () => {
            const product = await db.product.findFirst({ where: { sku: 'CB-001' } });

            const response = await request(app.getHttpServer())
                .post('/sales')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId: storeId,
                    totalAmount: 15500,
                    amountPaid: 15500,
                    items: [
                        {
                            productId: product?.id,
                            quantity: 1000, // Exceeds stock
                            priceAtSale: 15.5,
                        }
                    ]
                });

            expect(response.status).toBe(400); // Insufficient stock throws BadRequestException (400)
        });
    });

    describe('Purchases', () => {
        it('should record a purchase, create a supplier inline, and increment stock', async () => {
            const product = await db.product.findFirst({
                where: { sku: 'CB-001' },
                include: { stocks: true },
            });
            const initialStock = product?.stocks[0]?.quantity || 0;

            const response = await request(app.getHttpServer())
                .post('/purchases')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    newSupplier: {
                        name: 'Fresh Farms',
                        phone: '01700000000',
                    },
                    items: [
                        {
                            productId: product?.id,
                            quantity: 5,
                            unitCost: 9.25,
                        },
                    ],
                    freightAmount: 2,
                    taxAmount: 1,
                    discountAmount: 0.5,
                });

            const purchase = bodyOf(response);

            expect(response.status).toBe(201);
            expect(purchase).toHaveProperty('purchase_number');
            expect(purchase.supplier.name).toBe('Fresh Farms');
            expect(purchase.items[0]).toHaveProperty('id');

            purchaseId = purchase.id;
            purchaseItemId = purchase.items[0].id;

            const productAfter = await db.product.findUnique({
                where: { id: product?.id },
                include: { stocks: true },
            });

            expect(productAfter?.stocks[0]?.quantity).toBe(initialStock + 5);
        });
    });

    describe('Purchase Returns', () => {
        it('should create a purchase return and decrement stock', async () => {
            const product = await db.product.findFirst({
                where: { sku: 'CB-001' },
                include: { stocks: true },
            });
            const initialStock = product?.stocks[0]?.quantity || 0;

            const response = await request(app.getHttpServer())
                .post('/purchase-returns')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    purchaseId,
                    referenceNumber: 'RET-REF-1',
                    items: [
                        {
                            purchaseItemId,
                            quantity: 3,
                        },
                    ],
                });

            const purchaseReturn = bodyOf(response);

            expect(response.status).toBe(201);
            expect(purchaseReturn).toHaveProperty('return_number');
            expect(purchaseReturn.reference_number).toBe('RET-REF-1');

            const productAfter = await db.product.findUnique({
                where: { id: product?.id },
                include: { stocks: true },
            });

            expect(productAfter?.stocks[0]?.quantity).toBe(initialStock - 3);
        });

        it('should reject a purchase return that exceeds remaining returnable quantity', async () => {
            const response = await request(app.getHttpServer())
                .post('/purchase-returns')
                .set('Authorization', `Bearer ${authToken}`)
                .set('x-tenant-id', tenantId)
                .set('x-store-id', storeId)
                .send({
                    storeId,
                    purchaseId,
                    items: [
                        {
                            purchaseItemId,
                            quantity: 3,
                        },
                    ],
                });

            expect(response.status).toBe(400);
        });
    });
});
