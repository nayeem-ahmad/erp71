import { Test, TestingModule } from '@nestjs/testing';
import { SalesReportsService, buildSaleDateWindow, buildReturnDateWindow } from './sales-reports.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException } from '@nestjs/common';

describe('buildSaleDateWindow / buildReturnDateWindow', () => {
    /**
     * A bare `YYYY-MM-DD` upper bound has to mean "through the end of that day".
     * Parsed literally it is midnight, which excluded every sale made on the
     * last day of the range — so "sales this month" never included today.
     */
    it('builds a sale_date window that includes the whole final day', () => {
        expect(buildSaleDateWindow('2026-01-01', '2026-01-31')).toEqual({
            sale_date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31T23:59:59.999Z') },
        });
    });

    it('respects an explicit timestamp bound instead of widening it', () => {
        expect(buildSaleDateWindow('2026-01-01', '2026-01-31T12:00:00.000Z')).toEqual({
            sale_date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31T12:00:00.000Z') },
        });
    });

    it('keeps created_at window for returns', () => {
        expect(buildReturnDateWindow('2026-01-01', undefined)).toEqual({
            created_at: { gte: new Date('2026-01-01') },
        });
    });

    it('returns an empty object when no from/to provided', () => {
        expect(buildSaleDateWindow()).toEqual({});
        expect(buildReturnDateWindow()).toEqual({});
    });

    it('drops an unparseable upper bound rather than filtering on Invalid Date', () => {
        expect(buildSaleDateWindow('2026-01-01', 'not-a-date')).toEqual({
            sale_date: { gte: new Date('2026-01-01') },
        });
    });
});

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
            paymentRecord: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            user: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            // Looked up for labels by the margin reports: product names,
            // customers seen only on the return side, and whoever rang a sale up.
            customer: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            posCounter: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            product: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
            $queryRaw: jest.fn(),
        };

        db.saleItem.findMany.mockResolvedValue([]);

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

        // `items` is always present on a real row — the loader selects it — so
        // the fixtures carry it too. Empty by default: these cases assert the
        // invoice-level figures, and the margin ones have their own fixtures.
        let saleSeq = 0;
        const makeSale = (date: string, amount: number, items: any[] = []) => ({
            id: `sale-${date}-${(saleSeq += 1)}`,
            serial_number: `SL-${saleSeq}`,
            total_amount: amount,
            sale_date: new Date(date),
            store_id: 'store-1',
            counter_id: null,
            created_by: null,
            customer_id: null,
            customer: null,
            items,
        });

        let returnSeq = 0;
        const makeReturn = (date: string, refund: number, items: any[] = []) => ({
            id: `ret-${date}-${(returnSeq += 1)}`,
            total_refund: refund,
            created_at: new Date(date),
            store_id: 'store-1',
            sale: null,
            items,
        });

        it('returns zero summary when no sales or returns', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {}, 'Asia/Dhaka');

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
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {}, 'Asia/Dhaka');

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
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {}, 'Asia/Dhaka');

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
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {}, 'Asia/Dhaka');

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
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {}, 'Asia/Dhaka');

            expect(result.rows[0].date).toBe('2026-01-01');
            expect(result.rows[1].date).toBe('2026-01-02');
            expect(result.rows[2].date).toBe('2026-01-03');
        });

        it('passes storeId filter to queries', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getSalesSummary(tenantId, { storeId: 'store-1' }, 'Asia/Dhaka');

            expect(db.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ store_id: 'store-1' }),
                }),
            );
        });

        it('passes date filter when from/to provided', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getSalesSummary(tenantId, { from: '2026-01-01', to: '2026-01-31' }, 'Asia/Dhaka');

            expect(db.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        sale_date: expect.objectContaining({
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
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getSalesSummary(tenantId, {}, 'Asia/Dhaka');

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].date).toBe('2026-01-05');
            expect(result.rows[0].returns).toBe(300);
            expect(result.rows[0].transactions).toBe(0);
        });

        it('filters sales summary by sale_date, not created_at', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getSalesSummary(tenantId, { from: '2026-01-01', to: '2026-01-31' } as any, 'Asia/Dhaka');

            const whereArg = db.sale.findMany.mock.calls[0][0].where;
            expect(whereArg).toHaveProperty('sale_date');
            expect(whereArg).not.toHaveProperty('created_at');
        });

        it('keeps salesReturn query filtered by created_at, not sale_date', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);

            await service.getSalesSummary(tenantId, { from: '2026-01-01', to: '2026-01-31' } as any, 'Asia/Dhaka');

            const whereArg = db.salesReturn.findMany.mock.calls[0][0].where;
            expect(whereArg).toHaveProperty('created_at');
            expect(whereArg).not.toHaveProperty('sale_date');
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

    // ── getSalesByCategory ────────────────────────────────────────────────────

    describe('getSalesByCategory', () => {
        const line = (productId: string, qty: number, price: number, cost: number | null) => ({
            product_id: productId,
            quantity: qty,
            price_at_sale: price,
            unit_cost_at_sale: cost,
        });
        const sale = (id: string, total: number, items: any[]) => ({
            id,
            serial_number: id,
            total_amount: total,
            sale_date: new Date('2026-01-01'),
            store_id: 'store-1',
            counter_id: null,
            created_by: null,
            customer_id: null,
            customer: null,
            items,
        });

        it('aggregates revenue and gross profit by product group, with an Other rollup', async () => {
            db.sale.findMany.mockResolvedValue([
                sale('s1', 600, [
                    line('p1', 2, 100, 60),
                    line('p2', 1, 300, 200),
                    line('p3', 1, 100, 40),
                ]),
            ]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.product.findMany.mockResolvedValue([
                { id: 'p1', group_id: 'g1', group: { id: 'g1', name: 'Electronics' } },
                { id: 'p2', group_id: 'g2', group: { id: 'g2', name: 'Lighting' } },
                { id: 'p3', group_id: null, group: null },
            ]);

            const result = await service.getSalesByCategory('tenant-1', {});

            expect(result.summary.totalRevenue).toBe(600);
            expect(result.summary.categoryCount).toBe(3);

            const electronics = result.rows.find((r: any) => r.categoryName === 'Electronics');
            expect(electronics).toMatchObject({ categoryId: 'g1', revenue: 200, cogs: 120, grossProfit: 80 });
            expect(electronics!.share).toBeCloseTo(33.333, 2);

            // A product with no group is its own bucket, reported as such
            // rather than dropped or folded into the first real group.
            const uncategorized = result.rows.find((r: any) => r.categoryName === 'Uncategorized');
            expect(uncategorized).toMatchObject({ categoryId: null, revenue: 100, grossProfit: 60 });
        });

        it('reports no margin for a category whose products have no cost basis', async () => {
            // The bug this guards: folding an uncosted line in as cost 0 made
            // this category read as 100% margin and pulled the total up with it.
            db.sale.findMany.mockResolvedValue([
                sale('s1', 200, [line('p1', 1, 100, 60), line('p2', 1, 100, null)]),
            ]);
            db.salesReturn.findMany.mockResolvedValue([]);
            db.product.findMany.mockResolvedValue([
                { id: 'p1', group_id: 'g1', group: { id: 'g1', name: 'Costed' } },
                { id: 'p2', group_id: 'g2', group: { id: 'g2', name: 'Uncosted' } },
            ]);

            const result = await service.getSalesByCategory('tenant-1', {});

            const uncosted = result.rows.find((r: any) => r.categoryName === 'Uncosted');
            expect(uncosted!.grossProfit).toBeNull();
            expect(uncosted!.revenue).toBe(100);
            expect(result.summary.grossProfit).toBe(40);
            expect(result.summary.coverage.costedRevenuePct).toBe(50);
        });

        it('returns empty rows and zero total when there are no sales', async () => {
            db.sale.findMany.mockResolvedValue([]);
            db.salesReturn.findMany.mockResolvedValue([]);

            const result = await service.getSalesByCategory('tenant-1', {});

            expect(result.rows).toEqual([]);
            expect(result.summary.totalRevenue).toBe(0);
            expect(result.summary.categoryCount).toBe(0);
            expect(result.summary.grossProfit).toBeNull();
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

        const line = (productId: string, qty: number, price: number, cost: number | null) => ({
            product_id: productId,
            quantity: qty,
            price_at_sale: price,
            unit_cost_at_sale: cost,
        });
        const sale = (id: string, total: number, customer: any, items: any[]) => ({
            id,
            serial_number: id,
            total_amount: total,
            sale_date: new Date('2026-01-01'),
            store_id: 'store-1',
            counter_id: null,
            created_by: null,
            customer_id: customer?.id ?? null,
            customer,
            items,
        });
        const alice = { id: 'cust-1', name: 'Alice', phone: '01700000001', customer_code: 'C001' };
        const bob = { id: 'cust-2', name: 'Bob', phone: '01700000002', customer_code: 'C002' };

        beforeEach(() => {
            db.salesReturn.findMany.mockResolvedValue([]);
            db.customer.findMany.mockResolvedValue([]);
        });

        it('returns zero summary with no sales', async () => {
            db.sale.findMany.mockResolvedValue([]);

            const result = await service.getSalesByCustomer(tenantId, {});

            expect(result.summary.totalRevenue).toBe(0);
            expect(result.summary.totalOrders).toBe(0);
            expect(result.summary.customerCount).toBe(0);
            expect(result.summary.avgOrderValue).toBe(0);
            expect(result.rows).toHaveLength(0);
        });

        it('aggregates orders, revenue and gross profit by customer', async () => {
            db.sale.findMany.mockResolvedValue([
                sale('sale-1', 1000, alice, [line('p1', 10, 100, 60)]),
                sale('sale-2', 500, alice, [line('p1', 5, 100, 60)]),
                sale('sale-3', 2000, bob, [line('p1', 20, 100, 60)]),
            ]);

            const result = await service.getSalesByCustomer(tenantId, {});

            expect(result.summary.totalRevenue).toBe(3500);
            expect(result.summary.customerCount).toBe(2);

            const row = result.rows.find((r: any) => r.customer.id === 'cust-1');
            expect(row.orderCount).toBe(2);
            expect(row.revenue).toBe(1500);
            expect(row.avgOrderValue).toBe(750);
            expect(row.cogs).toBe(900);
            expect(row.grossProfit).toBe(600);
            expect(row.grossMarginPct).toBe(40);
        });

        it('exposes a large customer who is being sold to at a loss', async () => {
            // The question this report exists to answer. Bob buys twice what
            // Alice does and loses money on every unit; ranked by revenue he
            // looks like the better account.
            db.sale.findMany.mockResolvedValue([
                sale('sale-1', 1000, alice, [line('p1', 10, 100, 60)]),
                sale('sale-2', 2000, bob, [line('p1', 40, 50, 60)]),
            ]);

            const result = await service.getSalesByCustomer(tenantId, {});

            const bobRow = result.rows.find((r: any) => r.customer.id === 'cust-2');
            expect(bobRow.revenue).toBe(2000);
            expect(bobRow.grossProfit).toBe(-400);
            // Sorted by gross profit, so the loss-making account is last
            // however much revenue it carries.
            expect(result.rows[result.rows.length - 1].customer.id).toBe('cust-2');
        });

        it('nets a refund against the customer who bought the goods', async () => {
            db.sale.findMany.mockResolvedValue([sale('sale-1', 1000, alice, [line('p1', 10, 100, 60)])]);
            db.salesReturn.findMany.mockResolvedValue([
                {
                    id: 'ret-1',
                    created_at: new Date('2026-01-02'),
                    store_id: 'store-1',
                    total_refund: 200,
                    sale: { customer_id: 'cust-1', counter_id: null, created_by: null },
                    items: [
                        { product_id: 'p1', quantity: 2, refund_amount: 200, unit_cost_at_return: 60 },
                    ],
                },
            ]);

            const result = await service.getSalesByCustomer(tenantId, {});

            const row = result.rows.find((r: any) => r.customer?.id === 'cust-1');
            // 1000 − 200 revenue, 600 − 120 cost. Before returns reversed COGS
            // this reported 800 − 600 = 200 profit instead of 320.
            expect(row.revenue).toBe(800);
            expect(row.cogs).toBe(480);
            expect(row.grossProfit).toBe(320);
        });

        it('groups walk-in sales under a single walk-in row', async () => {
            db.sale.findMany.mockResolvedValue([
                sale('sale-1', 500, null, [line('p1', 5, 100, 60)]),
                sale('sale-2', 300, null, [line('p1', 3, 100, 60)]),
            ]);

            const result = await service.getSalesByCustomer(tenantId, {});

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].customer.name).toBe('Walk-in Customer');
            expect(result.rows[0].orderCount).toBe(2);
            expect(result.rows[0].revenue).toBe(800);
        });

        it('allocates an order-level discount before attributing revenue', async () => {
            // List value 1000, customer paid 800. Attributing the list price
            // would credit Alice with revenue she never handed over and show a
            // margin the sale did not earn.
            db.sale.findMany.mockResolvedValue([sale('sale-1', 800, alice, [line('p1', 10, 100, 60)])]);

            const result = await service.getSalesByCustomer(tenantId, {});

            expect(result.rows[0].revenue).toBe(800);
            expect(result.rows[0].cogs).toBe(600);
            expect(result.rows[0].grossProfit).toBe(200);
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
                { id: 'sale-1', total_amount: 1000, sale_date: new Date('2026-01-01') },
                { id: 'sale-2', total_amount: 500, sale_date: new Date('2026-01-02') },
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
                { id: 'sale-1', total_amount: 500, sale_date: new Date('2026-01-01') },
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
                { id: 'sale-1', total_amount: 1000, sale_date: new Date('2026-01-01') },
                { id: 'sale-2', total_amount: 500, sale_date: new Date('2026-01-01') },
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
                        sale_date: expect.objectContaining({ gte: expect.any(Date) }),
                    }),
                }),
            );
            expect(db.salesReturn.findMany).toHaveBeenCalledWith(
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
                    sale_date: new Date('2026-01-15'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
                {
                    id: 'sale-2',
                    total_amount: 500,
                    customer_id: 'cust-1',
                    sale_date: new Date('2026-02-10'),
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
                    sale_date: new Date('2026-01-15'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
                {
                    id: 'sale-2',
                    total_amount: 300,
                    customer_id: 'cust-1',
                    sale_date: new Date('2026-01-20'),
                    customer: { id: 'cust-1', name: 'Alice', phone: '01700000001' },
                },
                {
                    id: 'sale-3',
                    total_amount: 500,
                    customer_id: 'cust-1',
                    sale_date: new Date('2026-02-05'),
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
                    sale_date: new Date('2026-01-01'),
                    customer: { id: 'cust-1', name: 'Alice', phone: null },
                },
                {
                    id: 'sale-2',
                    total_amount: 800,
                    customer_id: 'cust-2',
                    sale_date: new Date('2026-01-05'),
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
                    sale_date: new Date('2026-01-01'),
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
                    sale_date: new Date('2026-01-01'),
                    customer: { id: 'cust-1', name: 'Alice', phone: null },
                },
                {
                    id: 'sale-2',
                    total_amount: 200,
                    customer_id: 'cust-2',
                    sale_date: new Date('2026-02-01'),
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

    // ── getSalesTrend ─────────────────────────────────────────────────────────

    describe('getSalesTrend', () => {
        const tenantId = 'tenant-1';

        const sale = (date: string, amount: number) => ({
            id: `sale-${date}-${amount}`,
            serial_number: `SL-${date}-${amount}`,
            total_amount: amount,
            sale_date: new Date(date),
            store_id: 'store-1',
            counter_id: null,
            created_by: null,
            customer_id: null,
            customer: null,
            // No lines: these cases assert bucketing of invoice totals, and an
            // uncosted basket is exactly the shape that used to report a 100%
            // margin, so leaving it empty keeps that guarded.
            items: [],
        });

        beforeEach(() => {
            db.salesReturn.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);
        });

        /**
         * A month with no sales must appear as a zero bucket, not vanish.
         * "Which month was worst" is wrong if the worst month is missing.
         */
        it('emits a zero bucket for every period with no activity', async () => {
            db.sale.findMany.mockResolvedValue([sale('2026-01-15', 500)]);

            const result = await service.getSalesTrend(tenantId, {
                from: '2026-01-01',
                to: '2026-03-31',
                granularity: 'month',
            }, 'Asia/Dhaka');

            expect(result.buckets.map((b) => b.bucket)).toEqual(['2026-01', '2026-02', '2026-03']);
            expect(result.buckets[1].netRevenue).toBe(0);
            expect(result.buckets[1].transactions).toBe(0);
        });

        it('folds daily rows into month buckets', async () => {
            db.sale.findMany.mockResolvedValue([
                sale('2026-01-05', 100),
                sale('2026-01-20', 200),
                sale('2026-02-10', 50),
            ]);

            const result = await service.getSalesTrend(tenantId, {
                from: '2026-01-01',
                to: '2026-02-28',
                granularity: 'month',
            }, 'Asia/Dhaka');

            expect(result.buckets[0].netRevenue).toBe(300);
            expect(result.buckets[0].transactions).toBe(2);
            expect(result.buckets[1].netRevenue).toBe(50);
        });

        it('reports the change between consecutive buckets, null for the first', async () => {
            db.sale.findMany.mockResolvedValue([sale('2026-01-05', 100), sale('2026-02-05', 150)]);

            const result = await service.getSalesTrend(tenantId, {
                from: '2026-01-01',
                to: '2026-02-28',
                granularity: 'month',
            }, 'Asia/Dhaka');

            expect(result.buckets[0].changeFromPreviousPct).toBeNull();
            expect(result.buckets[1].changeFromPreviousPct).toBe(50);
        });

        it('fetches the comparison window and returns its change', async () => {
            db.sale.findMany
                .mockResolvedValueOnce([sale('2026-02-05', 150)])
                .mockResolvedValueOnce([sale('2026-01-05', 100)]);

            const result: any = await service.getSalesTrend(tenantId, {
                from: '2026-02-01',
                to: '2026-02-28',
                granularity: 'month',
                compareTo: 'previous_period',
            }, 'Asia/Dhaka');

            expect(result.comparison.period).toEqual({ from: '2026-01-04', to: '2026-01-31' });
            expect(result.comparison.summary.totalRevenue).toBe(100);
            expect(result.comparison.change.netRevenuePct).toBe(50);
        });

        it('leaves comparison null when none was requested', async () => {
            db.sale.findMany.mockResolvedValue([]);

            const result = await service.getSalesTrend(tenantId, { from: '2026-01-01', to: '2026-01-31' }, 'Asia/Dhaka');

            expect(result.comparison).toBeNull();
        });
    });

    // ── getSalesBreakdown ─────────────────────────────────────────────────────

    describe('getSalesBreakdown', () => {
        const tenantId = 'tenant-1';

        it('groups sale lines by product and states the line-item basis', async () => {
            db.saleItem.findMany.mockResolvedValue([
                { sale_id: 's1', quantity: 2, price_at_sale: 100, unit_cost_at_sale: 60, product: { id: 'p1', name: 'Rice', group: null, brand: null } },
                { sale_id: 's2', quantity: 1, price_at_sale: 100, unit_cost_at_sale: 60, product: { id: 'p1', name: 'Rice', group: null, brand: null } },
                { sale_id: 's1', quantity: 1, price_at_sale: 50, unit_cost_at_sale: 20, product: { id: 'p2', name: 'Oil', group: null, brand: null } },
            ]);

            const result = await service.getSalesBreakdown(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                groupBy: 'product',
            }, 'Asia/Dhaka');

            expect(result.revenueBasis).toBe('sale_line_items');
            expect(result.rows[0]).toMatchObject({ label: 'Rice', revenue: 300, units: 3, orders: 2 });
            expect(result.rows[0].grossProfit).toBe(120);
            expect(result.summary.totalRevenue).toBe(350);
        });

        it('groups whole invoices by branch and states the invoice basis', async () => {
            db.sale.findMany.mockResolvedValue([
                { id: 's1', total_amount: 100, sale_date: new Date('2026-07-01T06:00:00Z'), created_by: null, store: { id: 'st1', name: 'Gulshan' }, customer: null },
                { id: 's2', total_amount: 300, sale_date: new Date('2026-07-02T06:00:00Z'), created_by: null, store: { id: 'st2', name: 'Dhanmondi' }, customer: null },
            ]);

            const result = await service.getSalesBreakdown(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                groupBy: 'branch',
            }, 'Asia/Dhaka');

            expect(result.revenueBasis).toBe('invoice_totals');
            expect(result.rows.map((r) => r.label)).toEqual(['Dhanmondi', 'Gulshan']);
            expect(result.rows[0].revenueSharePct).toBe(75);
            // Invoice-level rows have no unit or cost figures to report.
            expect(result.rows[0].units).toBeNull();
            expect(result.rows[0].grossProfit).toBeNull();
        });

        /**
         * A sale at 22:00 UTC is 04:00 the next morning in Dhaka. Bucketing on
         * the raw UTC hour would report the shop's quietest hour as its busiest.
         */
        it('buckets hour_of_day in Dhaka local time and orders by the clock', async () => {
            db.sale.findMany.mockResolvedValue([
                { id: 's1', total_amount: 100, sale_date: new Date('2026-07-01T16:00:00Z'), created_by: null, store: { id: 'st1', name: 'A' }, customer: null },
                { id: 's2', total_amount: 100, sale_date: new Date('2026-07-01T04:00:00Z'), created_by: null, store: { id: 'st1', name: 'A' }, customer: null },
            ]);

            const result = await service.getSalesBreakdown(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                groupBy: 'hour_of_day',
            }, 'Asia/Dhaka');

            expect(result.rows.map((r) => r.key)).toEqual(['10', '22']);
            expect(result.rows[1].label).toBe('22:00–22:59');
        });

        it('splits by payment method from payment records, not invoice totals', async () => {
            db.paymentRecord.findMany.mockResolvedValue([
                { sale_id: 's1', payment_method: 'bKash', amount: 60 },
                { sale_id: 's1', payment_method: 'Cash', amount: 40 },
                { sale_id: 's2', payment_method: 'bKash', amount: 200 },
            ]);

            const result = await service.getSalesBreakdown(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                groupBy: 'payment_method',
            }, 'Asia/Dhaka');

            expect(result.revenueBasis).toBe('payment_records');
            expect(result.rows[0]).toMatchObject({ label: 'bKash', revenue: 260, orders: 2 });
            expect(result.summary.totalOrders).toBe(2);
        });

        it('names the staff member behind a sale rather than returning a raw id', async () => {
            db.sale.findMany.mockResolvedValue([
                { id: 's1', total_amount: 100, sale_date: new Date('2026-07-01T06:00:00Z'), created_by: 'u1', store: { id: 'st1', name: 'A' }, customer: null },
                { id: 's2', total_amount: 50, sale_date: new Date('2026-07-01T06:00:00Z'), created_by: null, store: { id: 'st1', name: 'A' }, customer: null },
            ]);
            db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Rahim', email: 'r@x.com' }]);

            const result = await service.getSalesBreakdown(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                groupBy: 'staff',
            }, 'Asia/Dhaka');

            expect(result.rows.map((r) => r.label)).toEqual(['Rahim', 'Not recorded']);
        });

        it('pages the ranking and reports whether more rows remain', async () => {
            db.saleItem.findMany.mockResolvedValue(
                Array.from({ length: 5 }, (_, i) => ({
                    sale_id: `s${i}`,
                    quantity: 1,
                    price_at_sale: 100 - i,
                    unit_cost_at_sale: null,
                    product: { id: `p${i}`, name: `P${i}`, group: null, brand: null },
                })),
            );

            const result = await service.getSalesBreakdown(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                groupBy: 'product',
                limit: 2,
                offset: 2,
            }, 'Asia/Dhaka');

            expect(result.rows.map((r) => r.label)).toEqual(['P2', 'P3']);
            expect(result.paging).toEqual({ limit: 2, offset: 2, totalRows: 5, hasMore: true });
        });

        it('attaches each row\'s prior-period figure when compareTo is set', async () => {
            db.saleItem.findMany
                .mockResolvedValueOnce([
                    { sale_id: 's1', quantity: 1, price_at_sale: 300, unit_cost_at_sale: null, product: { id: 'p1', name: 'Rice', group: null, brand: null } },
                ])
                .mockResolvedValueOnce([
                    { sale_id: 's0', quantity: 1, price_at_sale: 200, unit_cost_at_sale: null, product: { id: 'p1', name: 'Rice', group: null, brand: null } },
                ]);

            const result: any = await service.getSalesBreakdown(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                groupBy: 'product',
                compareTo: 'previous_period',
            }, 'Asia/Dhaka');

            expect(result.rows[0].previousRevenue).toBe(200);
            expect(result.rows[0].revenueChange).toBe(100);
            expect(result.rows[0].revenueChangePct).toBe(50);
        });
    });

    // ── getTopMovers ──────────────────────────────────────────────────────────

    describe('getTopMovers', () => {
        const tenantId = 'tenant-1';

        const line = (saleId: string, productId: string, name: string, revenue: number) => ({
            sale_id: saleId,
            quantity: 1,
            price_at_sale: revenue,
            unit_cost_at_sale: null,
            product: { id: productId, name, group: null, brand: null },
        });

        it('separates gainers from decliners and ranks each by size of change', async () => {
            db.saleItem.findMany
                .mockResolvedValueOnce([line('s1', 'p1', 'Rice', 300), line('s2', 'p2', 'Oil', 100)])
                .mockResolvedValueOnce([line('s0', 'p1', 'Rice', 100), line('s3', 'p2', 'Oil', 400)]);

            const result = await service.getTopMovers(tenantId, { from: '2026-07-01', to: '2026-07-31' }, 'Asia/Dhaka');

            expect(result.gainers[0]).toMatchObject({ label: 'Rice', revenueChange: 200 });
            expect(result.decliners[0]).toMatchObject({ label: 'Oil', revenueChange: -300 });
            expect(result.totals.revenueChange).toBe(-100);
        });

        /**
         * A product that only exists on one side of the comparison is the most
         * interesting kind of mover, so it must not be dropped by the join.
         */
        it('keeps products that appear in only one of the two periods', async () => {
            db.saleItem.findMany
                .mockResolvedValueOnce([line('s1', 'p_new', 'New SKU', 500)])
                .mockResolvedValueOnce([line('s0', 'p_gone', 'Discontinued', 200)]);

            const result = await service.getTopMovers(tenantId, { from: '2026-07-01', to: '2026-07-31' }, 'Asia/Dhaka');

            expect(result.gainers[0]).toMatchObject({ label: 'New SKU', status: 'new' });
            expect(result.decliners[0]).toMatchObject({ label: 'Discontinued', status: 'disappeared' });
        });

        it('reports null rather than Infinity when a mover grew from nothing', async () => {
            db.saleItem.findMany
                .mockResolvedValueOnce([line('s1', 'p1', 'New SKU', 500)])
                .mockResolvedValueOnce([]);

            const result = await service.getTopMovers(tenantId, { from: '2026-07-01', to: '2026-07-31' }, 'Asia/Dhaka');

            expect(result.gainers[0].revenueChangePct).toBeNull();
        });
    });

    // ── getReturnsAnalysis ────────────────────────────────────────────────────

    describe('getReturnsAnalysis', () => {
        const tenantId = 'tenant-1';

        it('expresses refunds as a rate against the revenue they came out of', async () => {
            db.salesReturn.findMany.mockResolvedValue([
                {
                    id: 'r1',
                    total_refund: 100,
                    reason: 'Damaged',
                    created_at: new Date('2026-07-05'),
                    store: { id: 'st1', name: 'Gulshan' },
                    items: [{ quantity: 2, refund_amount: 100, product: { id: 'p1', name: 'Rice' } }],
                },
            ]);
            db.sale.findMany.mockResolvedValue([
                {
                    id: 's1', total_amount: 1000, serial_number: 'SL-1', sale_date: new Date('2026-07-01'),
                    store_id: 'st1', counter_id: null, created_by: null, customer_id: null, customer: null, items: [],
                },
            ]);
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getReturnsAnalysis(tenantId, { from: '2026-07-01', to: '2026-07-31' }, 'Asia/Dhaka');

            expect(result.summary.totalRefund).toBe(100);
            expect(result.summary.grossRevenue).toBe(1000);
            expect(result.summary.returnRatePct).toBe(10);
            expect(result.summary.unitsReturned).toBe(2);
        });

        it('labels a missing reason rather than grouping under an empty string', async () => {
            db.salesReturn.findMany.mockResolvedValue([
                {
                    id: 'r1', total_refund: 50, reason: null, created_at: new Date('2026-07-05'),
                    store: { id: 'st1', name: 'Gulshan' },
                    items: [{ quantity: 1, refund_amount: 50, product: { id: 'p1', name: 'Rice' } }],
                },
                {
                    id: 'r2', total_refund: 25, reason: '   ', created_at: new Date('2026-07-06'),
                    store: { id: 'st1', name: 'Gulshan' },
                    items: [{ quantity: 1, refund_amount: 25, product: { id: 'p1', name: 'Rice' } }],
                },
            ]);
            db.sale.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getReturnsAnalysis(tenantId, { from: '2026-07-01', to: '2026-07-31' }, 'Asia/Dhaka');

            expect(result.byReason).toHaveLength(1);
            expect(result.byReason[0]).toMatchObject({ label: 'Unspecified', amount: 75, sharePct: 100 });
        });

        it('avoids dividing by zero when nothing was sold', async () => {
            db.salesReturn.findMany.mockResolvedValue([]);
            db.sale.findMany.mockResolvedValue([]);
            db.saleItem.findMany.mockResolvedValue([]);

            const result = await service.getReturnsAnalysis(tenantId, { from: '2026-07-01', to: '2026-07-31' }, 'Asia/Dhaka');

            expect(result.summary.returnRatePct).toBe(0);
            expect(result.summary.avgRefund).toBe(0);
        });
    });

    // ── getCustomerRetention ──────────────────────────────────────────────────

    describe('getCustomerRetention', () => {
        const tenantId = 'tenant-1';

        it('splits active customers into first-time and returning', async () => {
            db.sale.findMany.mockResolvedValue([
                { customer_id: 'c1', total_amount: 100 },
                { customer_id: 'c2', total_amount: 300 },
            ]);
            db.sale.groupBy.mockResolvedValue([
                // c1 first bought inside the window — a new customer.
                { customer_id: 'c1', _min: { sale_date: new Date('2026-07-10') }, _max: { sale_date: new Date('2026-07-10') }, _count: { _all: 1 } },
                // c2 has been buying since last year — returning.
                { customer_id: 'c2', _min: { sale_date: new Date('2025-01-01') }, _max: { sale_date: new Date('2026-07-15') }, _count: { _all: 9 } },
            ]);

            const result = await service.getCustomerRetention(tenantId, { from: '2026-07-01', to: '2026-07-31' });

            expect(result.summary.activeCustomers).toBe(2);
            expect(result.summary.newCustomers).toBe(1);
            expect(result.summary.returningCustomers).toBe(1);
            expect(result.summary.repeatRatePct).toBe(50);
            expect(result.summary.returningCustomerRevenue).toBe(300);
            expect(result.summary.returningRevenueSharePct).toBe(75);
        });

        /**
         * Walk-ins carry no customer record. Counting them as new customers
         * would report near-100% acquisition in a shop that mostly serves
         * walk-ins, which is most shops on this platform.
         */
        it('reports walk-in sales separately instead of counting them as new customers', async () => {
            db.sale.findMany.mockResolvedValue([
                { customer_id: null, total_amount: 500 },
                { customer_id: null, total_amount: 250 },
            ]);
            db.sale.groupBy.mockResolvedValue([]);

            const result = await service.getCustomerRetention(tenantId, { from: '2026-07-01', to: '2026-07-31' });

            expect(result.summary.activeCustomers).toBe(0);
            expect(result.summary.newCustomers).toBe(0);
            expect(result.walkIn).toMatchObject({ orders: 2, revenue: 750 });
        });

        it('counts a customer as lapsed only when they are also absent from the window', async () => {
            db.sale.findMany.mockResolvedValue([{ customer_id: 'c_active', total_amount: 100 }]);
            db.sale.groupBy.mockResolvedValue([
                { customer_id: 'c_active', _min: { sale_date: new Date('2025-01-01') }, _max: { sale_date: new Date('2026-07-10') }, _count: { _all: 5 } },
                { customer_id: 'c_gone', _min: { sale_date: new Date('2024-01-01') }, _max: { sale_date: new Date('2025-01-01') }, _count: { _all: 2 } },
            ]);

            const result = await service.getCustomerRetention(tenantId, {
                from: '2026-07-01',
                to: '2026-07-31',
                lapsedAfterDays: 90,
            });

            expect(result.summary.lapsedCustomers).toBe(1);
            expect(result.lapsedCutoffDate).toBe('2026-05-02');
        });
    });

    // ── Gross profit reports ──────────────────────────────────────────────────

    describe('gross-profit reports', () => {
        const tenantId = 'tenant-1';

        const line = (productId: string, qty: number, price: number, cost: number | null) => ({
            product_id: productId,
            quantity: qty,
            price_at_sale: price,
            unit_cost_at_sale: cost,
        });
        const sale = (id: string, total: number, items: any[], over: any = {}) => ({
            id,
            serial_number: id,
            total_amount: total,
            sale_date: new Date('2026-02-10'),
            store_id: 'store-1',
            counter_id: null,
            created_by: null,
            customer_id: null,
            customer: null,
            items,
            ...over,
        });

        beforeEach(() => {
            db.salesReturn.findMany.mockResolvedValue([]);
            db.product.findMany.mockResolvedValue([
                { id: 'p1', name: 'Rice' },
                { id: 'p2', name: 'Oil' },
            ]);
        });

        describe('getGrossProfitByProduct', () => {
            it('ranks products by gross profit, not revenue', async () => {
                // Oil turns over more money and earns less. Ranked by revenue
                // it leads; the point of this report is that it does not.
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 1100, [line('p1', 10, 20, 5), line('p2', 10, 90, 85)]),
                ]);

                const result = await service.getGrossProfitByProduct(tenantId, {} as any);

                expect(result.rows[0]).toMatchObject({ productId: 'p1', grossProfit: 150 });
                expect(result.rows[1]).toMatchObject({ productId: 'p2', grossProfit: 50 });
            });

            it('excludes an uncosted product from the margin but keeps its revenue', async () => {
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 300, [line('p1', 1, 100, 60), line('p2', 1, 200, null)]),
                ]);

                const result = await service.getGrossProfitByProduct(tenantId, {} as any);

                expect(result.summary.grossProfit).toBe(40);
                expect(result.summary.netRevenue).toBe(300);
                expect(result.summary.coverage.uncostedRevenue).toBe(200);
            });
        });

        describe('getMarginExceptions', () => {
            it('reports only lines below the floor, worst first', async () => {
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 300, [
                        line('p1', 1, 100, 90), // 10% margin
                        line('p2', 1, 100, 50), // 50% margin — above the floor
                        line('p1', 1, 100, 120), // sold below cost
                    ]),
                ]);

                const result = await service.getMarginExceptions(tenantId, { marginFloorPct: 20 } as any);

                expect(result.rows).toHaveLength(2);
                expect(result.rows[0]).toMatchObject({ grossMarginPct: -20, soldBelowCost: true });
                expect(result.rows[1]).toMatchObject({ grossMarginPct: 10, soldBelowCost: false });
                expect(result.summary.belowCostCount).toBe(1);
            });

            it('defaults the floor to zero, catching only goods sold at or under cost', async () => {
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 200, [line('p1', 1, 100, 99), line('p2', 1, 100, 101)]),
                ]);

                const result = await service.getMarginExceptions(tenantId, {} as any);

                expect(result.rows).toHaveLength(1);
                expect(result.rows[0].productId).toBe('p2');
            });

            it('judges a line against the discounted price, not the list price', async () => {
                // List 100, cost 80 — fine on paper. The invoice was discounted
                // to 70, so it actually went out under cost, and judging on list
                // price would clear exactly the case worth catching.
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 70, [line('p1', 1, 100, 80)]),
                ]);

                const result = await service.getMarginExceptions(tenantId, {} as any);

                expect(result.rows).toHaveLength(1);
                expect(result.rows[0]).toMatchObject({ revenue: 70, cogs: 80, soldBelowCost: true });
            });

            it('counts uncosted lines separately rather than reporting them at 0%', async () => {
                // Reporting them would bury the real exceptions under lines
                // that are not evidence of anything.
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 100, [line('p1', 1, 100, null)]),
                ]);

                const result = await service.getMarginExceptions(tenantId, {} as any);

                expect(result.rows).toHaveLength(0);
                expect(result.summary.uncostedLines).toBe(1);
            });

            it('attributes exceptions to whoever rang them up', async () => {
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 100, [line('p1', 1, 100, 120)], { created_by: 'user-1' }),
                ]);
                db.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Karim' }]);

                const result = await service.getMarginExceptions(tenantId, {} as any);

                expect(result.byUser[0]).toMatchObject({ userId: 'user-1', userName: 'Karim', lines: 1 });
            });
        });

        describe('getGrossProfitBySalesperson', () => {
            it('groups margin by the user who made the sale', async () => {
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 100, [line('p1', 1, 100, 60)], { created_by: 'user-1' }),
                    sale('s2', 200, [line('p1', 2, 100, 60)], { created_by: 'user-2' }),
                ]);
                db.user.findMany.mockResolvedValue([
                    { id: 'user-1', name: 'Karim' },
                    { id: 'user-2', name: 'Rahim' },
                ]);

                const result = await service.getGrossProfitBySalesperson(tenantId, {} as any);

                expect(result.rows[0]).toMatchObject({ name: 'Rahim', grossProfit: 80, orders: 1 });
                expect(result.rows[1]).toMatchObject({ name: 'Karim', grossProfit: 40 });
            });

            it('labels sales with no recorded user as unattributed', async () => {
                db.sale.findMany.mockResolvedValue([sale('s1', 100, [line('p1', 1, 100, 60)])]);

                const result = await service.getGrossProfitBySalesperson(tenantId, {} as any);

                expect(result.rows[0]).toMatchObject({ id: null, name: 'Unattributed' });
            });

            it('charges a refund back to whoever made the original sale', async () => {
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 500, [line('p1', 5, 100, 60)], { created_by: 'user-1' }),
                ]);
                db.salesReturn.findMany.mockResolvedValue([
                    {
                        id: 'r1',
                        created_at: new Date('2026-02-11'),
                        store_id: 'store-1',
                        total_refund: 200,
                        sale: { customer_id: null, counter_id: null, created_by: 'user-1' },
                        items: [{ product_id: 'p1', quantity: 2, refund_amount: 200, unit_cost_at_return: 60 }],
                    },
                ]);
                db.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Karim' }]);

                const result = await service.getGrossProfitBySalesperson(tenantId, {} as any);

                // 500 − 200 revenue against 300 − 120 cost.
                expect(result.rows[0]).toMatchObject({ revenue: 300, cogs: 180, grossProfit: 120 });
            });
        });

        describe('getMarginBridge', () => {
            it('splits a change into volume, price and cost effects', async () => {
                db.sale.findMany
                    // Current window: 20 units at 100, cost 70.
                    .mockResolvedValueOnce([sale('s2', 2000, [line('p1', 20, 100, 70)])])
                    // Comparison window: 10 units at 100, cost 60.
                    .mockResolvedValueOnce([sale('s1', 1000, [line('p1', 10, 100, 60)])]);

                const result = await service.getMarginBridge(tenantId, {
                    from: '2026-02-01', to: '2026-02-28',
                    compareFrom: '2026-01-01', compareTo: '2026-01-31',
                } as any);

                const bridge = result.summary.bridge;
                expect(bridge.previousGrossProfit).toBe(400);
                expect(bridge.currentGrossProfit).toBe(600);
                expect(bridge.volumeEffect).toBe(400);
                expect(bridge.costEffect).toBe(-200);
                expect(bridge.priceEffect).toBe(0);
            });

            it('sums its effects to the total change', async () => {
                db.sale.findMany
                    .mockResolvedValueOnce([sale('s2', 1730, [line('p1', 17, 60, 41), line('p2', 71, 10, 6)])])
                    .mockResolvedValueOnce([sale('s1', 940, [line('p1', 8, 80, 53), line('p2', 30, 10, 7)])]);

                const result = await service.getMarginBridge(tenantId, {
                    from: '2026-02-01', to: '2026-02-28',
                    compareFrom: '2026-01-01', compareTo: '2026-01-31',
                } as any);

                const b = result.summary.bridge;
                expect(b.volumeEffect + b.priceEffect + b.costEffect + b.mixEffect).toBeCloseTo(b.totalChange, 2);
            });
        });

        describe('getCostCoverage', () => {
            it('lists only products with lines missing a cost, worst revenue first', async () => {
                db.sale.findMany.mockResolvedValue([
                    sale('s1', 400, [line('p1', 1, 100, 60), line('p2', 1, 300, null)]),
                ]);

                const result = await service.getCostCoverage(tenantId, {} as any);

                expect(result.rows).toHaveLength(1);
                expect(result.rows[0]).toMatchObject({
                    productId: 'p2',
                    uncostedLines: 1,
                    uncostedRevenue: 300,
                });
                expect(result.summary.costedRevenuePct).toBe(25);
                expect(result.summary.productsMissingCost).toBe(1);
            });

            it('reports full coverage as an empty list', async () => {
                db.sale.findMany.mockResolvedValue([sale('s1', 100, [line('p1', 1, 100, 60)])]);

                const result = await service.getCostCoverage(tenantId, {} as any);

                expect(result.rows).toEqual([]);
                expect(result.summary.costedRevenuePct).toBe(100);
            });
        });
    });
});
