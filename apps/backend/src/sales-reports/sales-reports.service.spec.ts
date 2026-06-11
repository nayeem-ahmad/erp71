import { Test, TestingModule } from '@nestjs/testing';
import { SalesReportsService } from './sales-reports.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException } from '@nestjs/common';

describe('SalesReportsService', () => {
    let service: SalesReportsService;
    let db: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        db = {
            sale: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
                aggregate: jest.fn(),
                groupBy: jest.fn(),
            },
            salesReturn: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
                aggregate: jest.fn(),
            },
            saleItem: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            store: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
            $queryRaw: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SalesReportsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<SalesReportsService>(SalesReportsService);
    });

    // ── getSalesSummary ───────────────────────────────────────────────────────

    describe('getSalesSummary', () => {
        const tenantId = 'tenant-1';

        const makeSale = (date: string, amount: number) => ({
            id: `sale-${date}`,
            total_amount: amount,
            created_at: new Date(date),
        });

        const makeReturn = (date: string, refund: number) => ({
            total_refund: refund,
            created_at: new Date(date),
        });

        it('returns zero summary when no sales or returns', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {});

            expect(result.summary.totalRevenue).toBe(0);
            expect(result.summary.totalReturns).toBe(0);
            expect(result.summary.netRevenue).toBe(0);
            expect(result.summary.transactionCount).toBe(0);
            expect(result.summary.avgOrderValue).toBe(0);
            expect(result.rows).toHaveLength(0);
        });

        it('calculates summary correctly with sales only', async () => {
            db.sale.findMany.mockResolvedValue([
                makeSale('2026-01-01', 1000),
                makeSale('2026-01-01', 500),
                makeSale('2026-01-02', 2000),
            ]);
            db.salesReturn.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {});

            expect(result.summary.totalRevenue).toBe(3500);
            expect(result.summary.totalReturns).toBe(0);
            expect(result.summary.netRevenue).toBe(3500);
            expect(result.summary.transactionCount).toBe(3);
            expect(result.summary.avgOrderValue).toBeCloseTo(3500 / 3);
        });

        it('subtracts returns from net revenue', async () => {
            db.sale.findMany.mockResolvedValue([
                makeSale('2026-01-01', 1000),
            ]);
            db.salesReturn.findMany.mockResolvedValue([
                makeReturn('2026-01-01', 200),
            ]);

            const result = await service.getSalesSummary(tenantId, {});

            expect(result.summary.totalRevenue).toBe(1000);
            expect(result.summary.totalReturns).toBe(200);
            expect(result.summary.netRevenue).toBe(800);
        });

        it('builds daily breakdown rows correctly', async () => {
            db.sale.findMany.mockResolvedValue([
                makeSale('2026-01-01', 1000),
                makeSale('2026-01-02', 500),
            ]);
            db.salesReturn.findMany.mockResolvedValue([
                makeReturn('2026-01-01', 100),
            ]);

            const result = await service.getSalesSummary(tenantId, {});

            expect(result.rows).toHaveLength(2);
            const day1 = result.rows.find((r: any) => r.date === '2026-01-01');
            expect(day1).toBeDefined();
            expect(day1.grossRevenue).toBe(1000);
            expect(day1.returns).toBe(100);
            expect(day1.netRevenue).toBe(900);
            expect(day1.transactions).toBe(1);
        });

        it('sorts rows by date ascending', async () => {
            db.sale.findMany.mockResolvedValue([
                makeSale('2026-01-03', 100),
                makeSale('2026-01-01', 200),
                makeSale('2026-01-02', 300),
            ]);
            db.salesReturn.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {});

            expect(result.rows[0].date).toBe('2026-01-01');
            expect(result.rows[1].date).toBe('2026-01-02');
            expect(result.rows[2].date).toBe('2026-01-03');
        });

        it('passes storeId filter to queries', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);

            await service.getSalesSummary(tenantId, { storeId: 'store-1' });

            expect(db.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ store_id: 'store-1' }),
                }),
            );
        });

        it('passes date filter when from/to provided', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);

            await service.getSalesSummary(tenantId, { from: '2026-01-01', to: '2026-01-31' });

            expect(db.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        created_at: expect.objectContaining({
                            gte: expect.any(Date),
                            lte: expect.any(Date),
                        }),
                    }),
                }),
            );
        });

        it('handles return on a day with no sales', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([
                makeReturn('2026-01-05', 300),
            ]);

            const result = await service.getSalesSummary(tenantId, {});

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].date).toBe('2026-01-05');
            expect(result.rows[0].returns).toBe(300);
            expect(result.rows[0].transactions).toBe(0);
        });
    });

    // ── getSalesByProduct ─────────────────────────────────────────────────────

    describe('getSalesByProduct', () => {
        const tenantId = 'tenant-1';

        const makeItem = (productId: string, name: string, quantity: number, price: number) => ({
            product_id: productId,
            quantity,
            price_at_sale: price,
            product: {
                id: productId,
                name,
                group: { id: 'grp-1', name: 'Electronics' },
                subgroup: null,
            },
        });

        it('returns zero summary when no sale items', async () => {
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getSalesByProduct(tenantId, {});

            expect(result.summary.totalRevenue).toBe(0);
            expect(result.summary.totalUnitsSold).toBe(0);
            expect(result.summary.productCount).toBe(0);
            expect(result.rows).toHaveLength(0);
        });

        it('aggregates units sold and revenue by product', async () => {
            db.saleItem.findMany.mockResolvedValue([
                makeItem('prod-1', 'Phone', 3, 500),
                makeItem('prod-1', 'Phone', 2, 500),
                makeItem('prod-2', 'Case', 5, 50),
            ]);

            const result = await service.getSalesByProduct(tenantId, {});

            expect(result.summary.productCount).toBe(2);
            const phone = result.rows.find((r: any) => r.product.id === 'prod-1');
            expect(phone.unitsSold).toBe(5);
            expect(phone.revenue).toBe(2500);
        });

        it('sorts rows by revenue descending', async () => {
            db.saleItem.findMany.mockResolvedValue([
                makeItem('prod-2', 'Case', 5, 50),
                makeItem('prod-1', 'Phone', 3, 500),
            ]);

            const result = await service.getSalesByProduct(tenantId, {});

            expect(result.rows[0].product.id).toBe('prod-1'); // higher revenue first
        });

        it('calculates revenue share correctly', async () => {
            db.saleItem.findMany.mockResolvedValue([
                makeItem('prod-1', 'A', 1, 800),
                makeItem('prod-2', 'B', 1, 200),
            ]);

            const result = await service.getSalesByProduct(tenantId, {});

            const itemA = result.rows.find((r: any) => r.product.id === 'prod-1');
            const itemB = result.rows.find((r: any) => r.product.id === 'prod-2');
            expect(itemA.revenueShare).toBeCloseTo(80);
            expect(itemB.revenueShare).toBeCloseTo(20);
        });

        it('revenue share is 0 when total revenue is 0', async () => {
            db.saleItem.findMany.mockResolvedValue([
                makeItem('prod-1', 'A', 0, 0),
            ]);

            const result = await service.getSalesByProduct(tenantId, {});
            expect(result.rows[0].revenueShare).toBe(0);
        });

        it('passes groupId filter to query', async () => {
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getSalesByProduct(tenantId, { groupId: 'grp-1' });

            expect(db.saleItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        product: expect.objectContaining({ group_id: 'grp-1' }),
                    }),
                }),
            );
        });

        it('passes subgroupId filter to query', async () => {
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getSalesByProduct(tenantId, { subgroupId: 'sub-1' });

            expect(db.saleItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        product: expect.objectContaining({ subgroup_id: 'sub-1' }),
                    }),
                }),
            );
        });

        it('does not include product filter when neither groupId nor subgroupId', async () => {
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getSalesByProduct(tenantId, {});

            const callArgs = db.saleItem.findMany.mock.calls[0][0];
            expect(callArgs.where.product).toBeUndefined();
        });
    });

    // ── getConsolidatedReport ─────────────────────────────────────────────────

    describe('getConsolidatedReport', () => {
        const tenantId = 'tenant-1';

        it('returns empty report when no sales', async () => {
            db.sale.findMany.mockResolvedValue([]);

            const result = await service.getConsolidatedReport(tenantId, {});

            expect(result.overall.revenue).toBe(0);
            expect(result.overall.transactions).toBe(0);
            expect(result.overall.top_product).toBeNull();
            expect(result.by_store).toHaveLength(0);
        });

        it('aggregates revenue and transactions by store', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    store_id: 'store-a',
                    total_amount: 1000,
                    store: { id: 'store-a', name: 'Store A' },
                    items: [],
                },
                {
                    id: 'sale-2',
                    store_id: 'store-a',
                    total_amount: 500,
                    store: { id: 'store-a', name: 'Store A' },
                    items: [],
                },
                {
                    id: 'sale-3',
                    store_id: 'store-b',
                    total_amount: 2000,
                    store: { id: 'store-b', name: 'Store B' },
                    items: [],
                },
            ]);

            const result = await service.getConsolidatedReport(tenantId, {});

            expect(result.overall.revenue).toBe(3500);
            expect(result.overall.transactions).toBe(3);
            expect(result.by_store).toHaveLength(2);

            const storeA = result.by_store.find((s: any) => s.store_id === 'store-a');
            expect(storeA.revenue).toBe(1500);
            expect(storeA.transactions).toBe(2);
        });

        it('sorts by_store by revenue descending', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    store_id: 'store-a',
                    total_amount: 100,
                    store: { id: 'store-a', name: 'Store A' },
                    items: [],
                },
                {
                    id: 'sale-2',
                    store_id: 'store-b',
                    total_amount: 900,
                    store: { id: 'store-b', name: 'Store B' },
                    items: [],
                },
            ]);

            const result = await service.getConsolidatedReport(tenantId, {});
            expect(result.by_store[0].store_id).toBe('store-b');
        });

        it('identifies top product by revenue', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    store_id: 'store-a',
                    total_amount: 1500,
                    store: { id: 'store-a', name: 'Store A' },
                    items: [
                        { product_id: 'p1', quantity: 2, price_at_sale: 300, product: { name: 'Phone' } },
                        { product_id: 'p2', quantity: 1, price_at_sale: 900, product: { name: 'Tablet' } },
                    ],
                },
            ]);

            const result = await service.getConsolidatedReport(tenantId, {});
            expect(result.overall.top_product).toBe('Tablet'); // 900 > 600
        });

        it('calculates avg_order and revenue_share correctly', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    store_id: 'store-a',
                    total_amount: 800,
                    store: { id: 'store-a', name: 'Store A' },
                    items: [],
                },
                {
                    id: 'sale-2',
                    store_id: 'store-b',
                    total_amount: 200,
                    store: { id: 'store-b', name: 'Store B' },
                    items: [],
                },
            ]);

            const result = await service.getConsolidatedReport(tenantId, {});

            expect(result.overall.avg_order).toBe(500);
            const storeA = result.by_store.find((s: any) => s.store_id === 'store-a');
            expect(storeA.revenue_share).toBeCloseTo(80);
        });

        it('passes period dates through', async () => {
            db.sale.findMany.mockResolvedValue([]);

            const result = await service.getConsolidatedReport(tenantId, { from: '2026-01-01', to: '2026-01-31' });

            expect(result.period.from).toBe('2026-01-01');
            expect(result.period.to).toBe('2026-01-31');
        });
    });

    // ── getSalesByCustomer ────────────────────────────────────────────────────

    describe('getSalesByCustomer', () => {
        const tenantId = 'tenant-1';

        it('returns zero summary with no sales', async () => {
            db.sale.findMany.mockResolvedValue([]);

            const result = await service.getSalesByCustomer(tenantId, {});

            expect(result.summary.totalRevenue).toBe(0);
            expect(result.summary.totalOrders).toBe(0);
            expect(result.summary.customerCount).toBe(0);
            expect(result.summary.avgOrderValue).toBe(0);
            expect(result.rows).toHaveLength(0);
        });

        it('aggregates orders and revenue by customer', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 1000,
                    customer_id: 'cust-1',
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001', customer_code: 'C001' },
                },
                {
                    id: 'sale-2',
                    total_amount: 500,
                    customer_id: 'cust-1',
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001', customer_code: 'C001' },
                },
                {
                    id: 'sale-3',
                    total_amount: 2000,
                    customer_id: 'cust-2',
                    customer: { id: 'cust-2', name: 'Bob', phone: '01700000002', customer_code: 'C002' },
                },
            ]);

            const result = await service.getSalesByCustomer(tenantId, {});

            expect(result.summary.totalRevenue).toBe(3500);
            expect(result.summary.customerCount).toBe(2);

            const alice = result.rows.find((r: any) => r.customer.id === 'cust-1');
            expect(alice.orderCount).toBe(2);
            expect(alice.revenue).toBe(1500);
            expect(alice.avgOrderValue).toBe(750);
        });

        it('groups walk-in sales under __walkin__ key', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 500,
                    customer_id: null,
                    customer: null,
                },
                {
                    id: 'sale-2',
                    total_amount: 300,
                    customer_id: null,
                    customer: null,
                },
            ]);

            const result = await service.getSalesByCustomer(tenantId, {});

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].customer.name).toBe('Walk-in Customer');
            expect(result.rows[0].orderCount).toBe(2);
            expect(result.rows[0].revenue).toBe(800);
        });

        it('sorts rows by revenue descending', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 100,
                    customer_id: 'cust-1',
                    customer: { id: 'cust-1', name: 'Alice', phone: null, customer_code: null },
                },
                {
                    id: 'sale-2',
                    total_amount: 900,
                    customer_id: 'cust-2',
                    customer: { id: 'cust-2', name: 'Bob', phone: null, customer_code: null },
                },
            ]);

            const result = await service.getSalesByCustomer(tenantId, {});
            expect(result.rows[0].customer.id).toBe('cust-2');
        });

        it('passes storeId filter to query', async () => {
            db.sale.findMany.mockResolvedValue([]);

            await service.getSalesByCustomer(tenantId, { storeId: 'store-1' });

            expect(db.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ store_id: 'store-1' }),
                }),
            );
        });
    });

    // ── getBranchReport ───────────────────────────────────────────────────────

    describe('getBranchReport', () => {
        const tenantId = 'tenant-1';
        const query = { storeId: 'store-1' };

        const mockStore = { id: 'store-1', name: 'Main Branch' };

        it('throws NotFoundException when store not found', async () => {
            db.store.findFirst.mockResolvedValue(null);

            const promise = service.getBranchReport(tenantId, query as any);
            await expect(promise).rejects.toThrow(NotFoundException);
            await expect(promise).rejects.toThrow('Store not found');
        });

        it('returns branch report with empty data', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: null }, _count: { id: 0 } });
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getBranchReport(tenantId, query as any);

            expect(result.store.id).toBe('store-1');
            expect(result.store.name).toBe('Main Branch');
            expect(result.summary.revenue).toBe(0);
            expect(result.summary.transactions).toBe(0);
            expect(result.top_products).toHaveLength(0);
            expect(result.daily).toHaveLength(0);
        });

        it('calculates branch revenue and returns', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([
                { id: 'sale-1', total_amount: 1000, created_at: new Date('2026-01-01') },
                { id: 'sale-2', total_amount: 500, created_at: new Date('2026-01-02') },
            ]);
            db.salesReturn.findMany.mockResolvedValue([
                { total_refund: 200, created_at: new Date('2026-01-01') },
            ]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: 2000 }, _count: { id: 4 } });
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getBranchReport(tenantId, query as any);

            expect(result.summary.revenue).toBe(1500);
            expect(result.summary.returns).toBe(200);
            expect(result.summary.net_revenue).toBe(1300);
            expect(result.summary.transactions).toBe(2);
            expect(result.summary.avg_order).toBe(750);
        });

        it('calculates revenue share vs company', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([
                { id: 'sale-1', total_amount: 500, created_at: new Date('2026-01-01') },
            ]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: 2000 }, _count: { id: 4 } });
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getBranchReport(tenantId, query as any);

            expect(result.company_comparison.company_revenue).toBe(2000);
            expect(result.company_comparison.revenue_share).toBe(25); // 500/2000 * 100
        });

        it('handles zero company revenue (no division by zero)', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: null }, _count: { id: 0 } });
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getBranchReport(tenantId, query as any);
            expect(result.company_comparison.revenue_share).toBe(0);
        });

        it('identifies top 5 products by revenue', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: 0 }, _count: { id: 0 } });
            db.saleItem.findMany.mockResolvedValue([
                { product_id: 'p1', quantity: 1, price_at_sale: 600, product: { id: 'p1', name: 'A' } },
                { product_id: 'p2', quantity: 1, price_at_sale: 500, product: { id: 'p2', name: 'B' } },
                { product_id: 'p3', quantity: 1, price_at_sale: 400, product: { id: 'p3', name: 'C' } },
                { product_id: 'p4', quantity: 1, price_at_sale: 300, product: { id: 'p4', name: 'D' } },
                { product_id: 'p5', quantity: 1, price_at_sale: 200, product: { id: 'p5', name: 'E' } },
                { product_id: 'p6', quantity: 1, price_at_sale: 100, product: { id: 'p6', name: 'F' } },
            ]);

            const result = await service.getBranchReport(tenantId, query as any);
            expect(result.top_products).toHaveLength(5);
            expect(result.top_products[0].name).toBe('A');
            expect(result.top_products[4].name).toBe('E');
        });

        it('builds daily breakdown for branch', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([
                { id: 'sale-1', total_amount: 1000, created_at: new Date('2026-01-01') },
                { id: 'sale-2', total_amount: 500, created_at: new Date('2026-01-01') },
            ]);
            db.salesReturn.findMany.mockResolvedValue([
                { total_refund: 100, created_at: new Date('2026-01-01') },
            ]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: 1500 }, _count: { id: 2 } });
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getBranchReport(tenantId, query as any);

            expect(result.daily).toHaveLength(1);
            expect(result.daily[0].date).toBe('2026-01-01');
            expect(result.daily[0].transactions).toBe(2);
            expect(result.daily[0].gross_revenue).toBe(1500);
            expect(result.daily[0].returns).toBe(100);
            expect(result.daily[0].net_revenue).toBe(1400);
        });

        it('handles return day not in sales', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([
                { total_refund: 200, created_at: new Date('2026-01-05') },
            ]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: null }, _count: { id: 0 } });
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getBranchReport(tenantId, query as any);

            expect(result.daily).toHaveLength(1);
            expect(result.daily[0].returns).toBe(200);
        });

        it('passes date filters to all queries', async () => {
            db.store.findFirst.mockResolvedValue(mockStore);
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: null }, _count: { id: 0 } });
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getBranchReport(tenantId, { storeId: 'store-1', from: '2026-01-01', to: '2026-01-31' } as any);

            expect(db.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        created_at: expect.objectContaining({ gte: expect.any(Date) }),
                    }),
                }),
            );
        });
    });

    // ── getMonthlySalesByCustomer ─────────────────────────────────────────────

    describe('getMonthlySalesByCustomer', () => {
        const tenantId = 'tenant-1';

        it('returns empty months and rows when no sales', async () => {
            db.sale.findMany.mockResolvedValue([]);

            const result = await service.getMonthlySalesByCustomer(tenantId, {});

            expect(result.months).toHaveLength(0);
            expect(result.rows).toHaveLength(0);
        });

        it('builds months array from sale dates', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 1000,
                    customer_id: 'cust-1',
                    created_at: new Date('2026-01-15'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
                {
                    id: 'sale-2',
                    total_amount: 500,
                    customer_id: 'cust-1',
                    created_at: new Date('2026-02-10'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
            ]);

            const result = await service.getMonthlySalesByCustomer(tenantId, {});

            expect(result.months).toEqual(['2026-01', '2026-02']);
        });

        it('aggregates revenue per customer per month', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 1000,
                    customer_id: 'cust-1',
                    created_at: new Date('2026-01-15'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
                {
                    id: 'sale-2',
                    total_amount: 300,
                    customer_id: 'cust-1',
                    created_at: new Date('2026-01-20'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
                {
                    id: 'sale-3',
                    total_amount: 500,
                    customer_id: 'cust-1',
                    created_at: new Date('2026-02-05'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
            ]);

            const result = await service.getMonthlySalesByCustomer(tenantId, {});

            expect(result.rows).toHaveLength(1);
            const alice = result.rows[0];
            expect(alice.total).toBe(1800);
            expect(alice.monthly).toHaveLength(2);
            const jan = alice.monthly.find((m: any) => m.month === '2026-01');
            expect(jan.revenue).toBe(1300);
            expect(jan.orderCount).toBe(2);
            const feb = alice.monthly.find((m: any) => m.month === '2026-02');
            expect(feb.revenue).toBe(500);
        });

        it('sorts rows by total revenue descending', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 200,
                    customer_id: 'cust-1',
                    created_at: new Date('2026-01-01'),
                    customer: { id: 'cust-1', name: 'Alice', phone: null },
                },
                {
                    id: 'sale-2',
                    total_amount: 800,
                    customer_id: 'cust-2',
                    created_at: new Date('2026-01-05'),
                    customer: { id: 'cust-2', name: 'Bob', phone: null },
                },
            ]);

            const result = await service.getMonthlySalesByCustomer(tenantId, {});
            expect(result.rows[0].customer.id).toBe('cust-2');
        });

        it('handles walk-in customers (null customer_id)', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 500,
                    customer_id: null,
                    created_at: new Date('2026-01-01'),
                    customer: null,
                },
            ]);

            const result = await service.getMonthlySalesByCustomer(tenantId, {});

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].customer.name).toBe('Walk-in Customer');
        });

        it('fills zero revenue for months where customer had no orders', async () => {
            db.sale.findMany.mockResolvedValue([
                {
                    id: 'sale-1',
                    total_amount: 1000,
                    customer_id: 'cust-1',
                    created_at: new Date('2026-01-01'),
                    customer: { id: 'cust-1', name: 'Alice', phone: null },
                },
                {
                    id: 'sale-2',
                    total_amount: 200,
                    customer_id: 'cust-2',
                    created_at: new Date('2026-02-01'),
                    customer: { id: 'cust-2', name: 'Bob', phone: null },
                },
            ]);

            const result = await service.getMonthlySalesByCustomer(tenantId, {});

            expect(result.months).toEqual(['2026-01', '2026-02']);
            const alice = result.rows.find((r: any) => r.customer.id === 'cust-1');
            const feb = alice.monthly.find((m: any) => m.month === '2026-02');
            expect(feb.revenue).toBe(0);
            expect(feb.orderCount).toBe(0);
        });

        it('passes customerId filter to query', async () => {
            db.sale.findMany.mockResolvedValue([]);

            await service.getMonthlySalesByCustomer(tenantId, { customerId: 'cust-1' });

            expect(db.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ customer_id: 'cust-1' }),
                }),
            );
        });

        it('does not include customer_id filter when not provided', async () => {
            db.sale.findMany.mockResolvedValue([]);

            await service.getMonthlySalesByCustomer(tenantId, {});

            const callArgs = db.sale.findMany.mock.calls[0][0];
            expect(callArgs.where.customer_id).toBeUndefined();
        });
    });
});
