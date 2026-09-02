import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service';
import { DatabaseService } from '../database/database.service';

describe('ManufacturingService', () => {
    let service: ManufacturingService;
    let db: any;

    const recipe = {
        id: 'recipe-1',
        tenantId: 'tenant-1',
        productId: 'product-out',
        outputQty: 2,
        notes: null,
        product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' },
        components: [
            {
                id: 'comp-1',
                recipeId: 'recipe-1',
                productId: 'product-flour',
                quantity: 5,
                product: { id: 'product-flour', name: 'Flour', sku: 'FLR-1' },
            },
            {
                id: 'comp-2',
                recipeId: 'recipe-1',
                productId: 'product-yeast',
                quantity: 1,
                product: { id: 'product-yeast', name: 'Yeast', sku: 'YST-1' },
            },
        ],
    };

    beforeEach(async () => {
        db = {
            bomRecipe: { findFirst: jest.fn() },
            // Every stock movement maintains the weighted-average cost pool.
            // findUnique resolving null is the no-basis-yet case, which is what
            // a fresh product in a unit test actually looks like.
            productCost: {
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn().mockResolvedValue({}),
            },
            productStock: {
                aggregate: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUnique: jest.fn().mockResolvedValue({ quantity: 100 }),
                upsert: jest.fn().mockResolvedValue({ quantity: 20 }),
            },
            productionJob: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
            productionWastage: { create: jest.fn().mockResolvedValue({}) },
            productionJobCost: {
                create: jest.fn().mockResolvedValue({}),
                aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                delete: jest.fn().mockResolvedValue({}),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            purchaseItem: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            saleItem: { findMany: jest.fn().mockResolvedValue([]) },
            product: {
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn().mockResolvedValue({ type: 'GOODS' }),
            },
            productPrice: { findMany: jest.fn().mockResolvedValue([]) },
            inventorySettings: { findUnique: jest.fn().mockResolvedValue(null) },
            warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh-1' }) },
            inventoryMovement: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ManufacturingService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<ManufacturingService>(ManufacturingService);
    });

    describe('getRequirementsPreview()', () => {
        it('reports sufficient when stock covers every component', async () => {
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 50 } }) // flour: need 5*10=50
                .mockResolvedValueOnce({ _sum: { quantity: 10 } }); // yeast: need 1*10=10

            const preview = await service.getRequirementsPreview('tenant-1', 'recipe-1', 10);

            expect(preview.sufficient).toBe(true);
            expect(preview.outputQty).toBe(20);
            expect(preview.components).toEqual([
                expect.objectContaining({ productId: 'product-flour', requiredQty: 50, availableQty: 50, sufficient: true }),
                expect.objectContaining({ productId: 'product-yeast', requiredQty: 10, availableQty: 10, sufficient: true }),
            ]);
        });

        it('flags components with insufficient stock without throwing', async () => {
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 20 } }) // flour: need 50, have 20
                .mockResolvedValueOnce({ _sum: { quantity: 10 } }); // yeast: need 10, have 10

            const preview = await service.getRequirementsPreview('tenant-1', 'recipe-1', 10);

            expect(preview.sufficient).toBe(false);
            expect(preview.components[0]).toEqual(
                expect.objectContaining({ productId: 'product-flour', requiredQty: 50, availableQty: 20, sufficient: false }),
            );
            expect(preview.components[1].sufficient).toBe(true);
        });
    });

    describe('startJob()', () => {
        const job = {
            id: 'job-1',
            tenantId: 'tenant-1',
            recipeId: 'recipe-1',
            productId: 'product-out',
            quantity: 10,
            status: 'DRAFT',
            recipe,
        };

        it('starts the job when all components have sufficient stock', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 50 } })
                .mockResolvedValueOnce({ _sum: { quantity: 10 } });
            db.productionJob.update.mockResolvedValue({ ...job, status: 'IN_PROGRESS' });

            const result = await service.startJob('tenant-1', 'job-1');

            expect(result.status).toBe('IN_PROGRESS');
            expect(db.productionJob.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'job-1' }, data: expect.objectContaining({ status: 'IN_PROGRESS' }) }),
            );
        });

        it('throws BadRequestException when a component is short on stock', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productStock.aggregate
                .mockResolvedValueOnce({ _sum: { quantity: 20 } })
                .mockResolvedValueOnce({ _sum: { quantity: 10 } });

            await expect(service.startJob('tenant-1', 'job-1')).rejects.toThrow(BadRequestException);
            expect(db.productionJob.update).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when the job is not in DRAFT status', async () => {
            db.productionJob.findFirst.mockResolvedValue({ ...job, status: 'IN_PROGRESS' });

            await expect(service.startJob('tenant-1', 'job-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('completeJob()', () => {
        const job = {
            id: 'job-1',
            tenantId: 'tenant-1',
            recipeId: 'recipe-1',
            productId: 'product-out',
            quantity: 10,
            status: 'IN_PROGRESS',
            recipe,
        };

        it('consumes BOM components and credits output stock with no wastage', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });

            const result = await service.completeJob('tenant-1', 'job-1');

            expect(result.status).toBe('COMPLETED');
            expect(db.inventoryMovement.create).toHaveBeenCalledTimes(3); // 2 components + 1 output
            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ movement_type: 'MANUFACTURING_OUTPUT', quantity_delta: 20 }),
                }),
            );
            expect(db.productionWastage.create).not.toHaveBeenCalled();
        });

        it('records wastage as an additional consumption movement and a ProductionWastage row', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            db.product.findMany.mockResolvedValue([{ id: 'product-flour' }]);

            await service.completeJob('tenant-1', 'job-1', [
                { productId: 'product-flour', quantity: 3, note: 'Spilled during mixing' },
            ]);

            expect(db.inventoryMovement.create).toHaveBeenCalledTimes(4); // 2 components + 1 wastage + 1 output
            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        movement_type: 'MANUFACTURING_WASTAGE',
                        product_id: 'product-flour',
                        quantity_delta: -3,
                    }),
                }),
            );
            expect(db.productionWastage.create).toHaveBeenCalledWith({
                data: {
                    tenantId: 'tenant-1',
                    jobId: 'job-1',
                    productId: 'product-flour',
                    quantity: 3,
                    note: 'Spilled during mixing',
                },
            });
        });

        /** Puts a weighted-average cost on each named product's pool. */
        const withPools = (avgByProduct: Record<string, number>) => {
            db.productCost.findMany.mockResolvedValue(
                Object.entries(avgByProduct).map(([product_id, avg_cost]) => ({ product_id, avg_cost })),
            );
            db.productCost.findUnique.mockImplementation(({ where }: any) => {
                const avg = avgByProduct[where.tenant_id_product_id.product_id];
                return Promise.resolve(avg === undefined ? null : { avg_cost: avg, qty_on_hand: 1000 });
            });
        };

        it('consumes raw materials at their weighted-average cost', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            // The catalog says flour costs 9. What the flour on hand actually
            // cost is 2.50, and that is what leaves the pool.
            db.productPrice.findMany.mockResolvedValue([{ product_id: 'product-flour', cost: 9 }]);
            withPools({ 'product-flour': 2.5, 'product-yeast': 1 });

            await service.completeJob('tenant-1', 'job-1');

            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ product_id: 'product-flour', unit_cost: 2.5 }),
                }),
            );
        });

        it('values finished goods at what the job cost, not the output catalog price', async () => {
            // 5 flour x 10 @ 2.50 + 1 yeast x 10 @ 1.00 = 135 over 20 units made
            // = 6.75 each. The output product's own price-list cost of 10 is a
            // number someone typed into the catalog and describes no part of
            // this production run — booking the goods in at it would hand every
            // manufactured item a margin it never earned.
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            db.productPrice.findMany.mockResolvedValue([{ product_id: 'product-out', cost: 10 }]);
            withPools({ 'product-flour': 2.5, 'product-yeast': 1 });
            db.productionJobCost.aggregate.mockResolvedValue({ _sum: { amount: 135 } });

            await service.completeJob('tenant-1', 'job-1');

            expect(db.productionJobCost.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ costType: 'RAW_MATERIAL', amount: 135 }),
                }),
            );
            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ movement_type: 'MANUFACTURING_OUTPUT', unit_cost: 6.75 }),
                }),
            );
        });

        it('leaves the pool alone when a job has no cost lines to value output with', async () => {
            // Nothing priced, so nothing to say. Booking the output in at zero
            // would claim it was free to make.
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            db.productionJobCost.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

            await service.completeJob('tenant-1', 'job-1');

            expect(db.inventoryMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ movement_type: 'MANUFACTURING_OUTPUT', unit_cost: null }),
                }),
            );
        });

        it('throws BadRequestException when a wastage product does not belong to the tenant', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.product.findMany.mockResolvedValue([]); // product not found for this tenant

            await expect(
                service.completeJob('tenant-1', 'job-1', [{ productId: 'not-mine', quantity: 1 }]),
            ).rejects.toThrow(BadRequestException);
            expect(db.productionJob.update).not.toHaveBeenCalled();
        });

        it('throws BadRequestException when the job is not IN_PROGRESS', async () => {
            db.productionJob.findFirst.mockResolvedValue({ ...job, status: 'DRAFT' });

            await expect(service.completeJob('tenant-1', 'job-1')).rejects.toThrow(BadRequestException);
        });

        it('rolls up raw-material cost into a ProductionJobCost line and sets totalJobCost/costPerUnit', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJob.update.mockResolvedValue({ ...job, status: 'COMPLETED' });
            db.productPrice.findMany.mockResolvedValue([{ product_id: 'product-flour', cost: 2.5 }]);
            // flour: 5 * 10 qty = 50 units * 2.5 = 125; yeast has no cost entry -> 0
            db.productionJobCost.aggregate.mockResolvedValue({ _sum: { amount: 125 } });

            await service.completeJob('tenant-1', 'job-1');

            expect(db.productionJobCost.create).toHaveBeenCalledWith({
                data: {
                    tenantId: 'tenant-1',
                    jobId: 'job-1',
                    costType: 'RAW_MATERIAL',
                    amount: 125,
                    notes: 'Auto-computed from BOM consumption + wastage at completion',
                },
            });
            expect(db.productionJob.update).toHaveBeenLastCalledWith({
                where: { id: 'job-1' },
                data: { status: 'COMPLETED', completedAt: expect.any(Date), totalJobCost: 125, costPerUnit: 6.25 },
            });
        });
    });

    describe('job cost lines', () => {
        const job = {
            id: 'job-1',
            tenantId: 'tenant-1',
            recipeId: 'recipe-1',
            productId: 'product-out',
            quantity: 10,
            status: 'IN_PROGRESS',
            recipe,
        };

        it('adds a non-material cost line and recomputes job totals', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJobCost.create.mockResolvedValue({ id: 'cost-1', costType: 'PRINTING', amount: 500 });
            db.productionJobCost.aggregate.mockResolvedValue({ _sum: { amount: 500 } });

            await service.addJobCost('tenant-1', 'job-1', { costType: 'PRINTING', amount: 500 });

            expect(db.productionJobCost.create).toHaveBeenCalledWith({
                data: {
                    tenantId: 'tenant-1',
                    jobId: 'job-1',
                    costType: 'PRINTING',
                    amount: 500,
                    sourcePurchaseItemId: null,
                    notes: null,
                },
            });
            expect(db.productionJob.update).toHaveBeenCalledWith({
                where: { id: 'job-1' },
                data: { totalJobCost: 500, costPerUnit: 25 },
            });
        });

        it('rejects removing a RAW_MATERIAL cost line directly', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.productionJobCost.findFirst.mockResolvedValue({ id: 'cost-1', costType: 'RAW_MATERIAL' });

            await expect(service.removeJobCost('tenant-1', 'job-1', 'cost-1')).rejects.toThrow(BadRequestException);
        });

        it('allocates a bill line to a job cost without exceeding its remaining unallocated amount', async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.purchaseItem.findFirst.mockResolvedValue({ id: 'pi-1', line_total: 1000 });
            db.productionJobCost.aggregate
                .mockResolvedValueOnce({ _sum: { amount: 400 } }) // already allocated to this bill line
                .mockResolvedValueOnce({ _sum: { amount: 500 } }); // job total after adding this cost
            db.productionJobCost.create.mockResolvedValue({ id: 'cost-1' });

            await service.addJobCost('tenant-1', 'job-1', {
                costType: 'PRINTING',
                amount: 500,
                sourcePurchaseItemId: 'pi-1',
            });

            expect(db.productionJobCost.create).toHaveBeenCalledWith({
                data: {
                    tenantId: 'tenant-1',
                    jobId: 'job-1',
                    costType: 'PRINTING',
                    amount: 500,
                    sourcePurchaseItemId: 'pi-1',
                    notes: null,
                },
            });
        });

        it("rejects an allocation exceeding the bill line's remaining unallocated amount", async () => {
            db.productionJob.findFirst.mockResolvedValue(job);
            db.purchaseItem.findFirst.mockResolvedValue({ id: 'pi-1', line_total: 1000 });
            db.productionJobCost.aggregate.mockResolvedValueOnce({ _sum: { amount: 700 } });

            await expect(
                service.addJobCost('tenant-1', 'job-1', {
                    costType: 'PRINTING',
                    amount: 500,
                    sourcePurchaseItemId: 'pi-1',
                }),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('listCostSources()', () => {
        it('lists service purchase items with remaining unallocated amount, excluding fully-allocated ones', async () => {
            db.purchaseItem.findMany.mockResolvedValue([
                {
                    id: 'pi-1',
                    line_total: 1000,
                    product: { id: 'svc-1', name: 'Printing Service' },
                    purchase: {
                        id: 'purch-1',
                        purchase_number: 'PUR-00010',
                        created_at: new Date('2026-01-01'),
                        supplier: { id: 'sup-1', name: 'ACME Printers' },
                    },
                },
                {
                    id: 'pi-2',
                    line_total: 500,
                    product: { id: 'svc-1', name: 'Printing Service' },
                    purchase: {
                        id: 'purch-2',
                        purchase_number: 'PUR-00011',
                        created_at: new Date('2026-01-02'),
                        supplier: { id: 'sup-1', name: 'ACME Printers' },
                    },
                },
            ]);
            db.productionJobCost.groupBy.mockResolvedValue([
                { sourcePurchaseItemId: 'pi-1', _sum: { amount: 400 } },
                { sourcePurchaseItemId: 'pi-2', _sum: { amount: 500 } },
            ]);

            const result = await service.listCostSources('tenant-1');

            expect(result).toEqual([
                expect.objectContaining({ id: 'pi-1', lineTotal: 1000, allocatedAmount: 400, remainingAmount: 600 }),
            ]);
        });
    });

    describe('cost-plus pricing', () => {
        const completedJob = {
            id: 'job-1',
            tenantId: 'tenant-1',
            recipeId: 'recipe-1',
            productId: 'product-out',
            quantity: 10,
            status: 'COMPLETED',
            costPerUnit: 20,
            recipe,
        };

        it('suggests a price from cost per unit plus a target margin', async () => {
            db.productionJob.findFirst.mockResolvedValue(completedJob);
            db.product.findFirst = jest.fn().mockResolvedValue({ id: 'product-out', name: 'Bread Loaf', price: 22 });

            const suggestion = await service.getPricingSuggestion('tenant-1', 'job-1', 25);

            expect(suggestion).toEqual(expect.objectContaining({
                costPerUnit: 20,
                marginPct: 25,
                suggestedPrice: 25,
                currentPrice: 22,
            }));
        });

        it('throws when the job has no cost per unit yet', async () => {
            db.productionJob.findFirst.mockResolvedValue({ ...completedJob, costPerUnit: null });

            await expect(service.getPricingSuggestion('tenant-1', 'job-1', 25)).rejects.toThrow(BadRequestException);
        });

        it('applies the suggested price to the output product', async () => {
            db.productionJob.findFirst.mockResolvedValue(completedJob);
            db.product.findFirst = jest.fn().mockResolvedValue({ id: 'product-out', name: 'Bread Loaf', price: 22 });
            db.product.update = jest.fn().mockResolvedValue({});

            await service.applySuggestedPrice('tenant-1', 'job-1', 25);

            expect(db.product.update).toHaveBeenCalledWith({
                where: { id: 'product-out' },
                data: { price: 25 },
            });
        });
    });

    describe('getProductPL()', () => {
        it('returns an empty report when there are no completed jobs', async () => {
            db.productionJob.findMany.mockResolvedValue([]);

            const result = await service.getProductPL('tenant-1');

            expect(result).toEqual({
                products: [],
                totals: { quantityProduced: 0, totalProductionCost: 0, revenue: 0, grossProfit: 0 },
            });
        });

        it('rolls up production cost and sales revenue per output product', async () => {
            db.productionJob.findMany.mockResolvedValue([
                {
                    productId: 'product-out',
                    quantity: 10,
                    totalJobCost: 200,
                    recipe: { outputQty: 2, product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' } },
                },
                {
                    productId: 'product-out',
                    quantity: 5,
                    totalJobCost: 120,
                    recipe: { outputQty: 2, product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' } },
                },
            ]);
            db.saleItem.findMany.mockResolvedValue([
                { product_id: 'product-out', quantity: 10, price_at_sale: 25 },
                { product_id: 'product-out', quantity: 5, price_at_sale: 25 },
            ]);

            const result = await service.getProductPL('tenant-1');

            expect(result.products).toEqual([
                expect.objectContaining({
                    productId: 'product-out',
                    jobsCompleted: 2,
                    quantityProduced: 30, // (10*2) + (5*2)
                    totalProductionCost: 320,
                    unitsSold: 15,
                    revenue: 375, // 15 * 25
                    grossProfit: 55,
                }),
            ]);
            expect(result.totals).toEqual({
                quantityProduced: 30,
                totalProductionCost: 320,
                revenue: 375,
                grossProfit: 55,
            });
        });
    });

    describe('getAnalytics()', () => {
        it('returns zeroed-out totals when there are no completed jobs', async () => {
            db.productionJob.findMany.mockResolvedValue([]);

            const result = await service.getAnalytics('tenant-1');

            expect(result).toEqual({
                totalCompletedJobs: 0,
                totalUnitsProduced: 0,
                totalMaterialCost: 0,
                avgUnitProductionCost: 0,
                jobs: [],
                volumeTrend: [],
            });
        });

        it('computes planned/wastage/actual cost, unit cost, and a volume trend across completed jobs', async () => {
            const completedJobs = [
                {
                    id: 'job-1',
                    tenantId: 'tenant-1',
                    quantity: 10,
                    completedAt: new Date('2026-07-01T10:00:00Z'),
                    created_at: new Date('2026-06-30T10:00:00Z'),
                    recipe: { outputQty: 2, product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' } },
                },
                {
                    id: 'job-2',
                    tenantId: 'tenant-1',
                    quantity: 5,
                    completedAt: new Date('2026-07-02T10:00:00Z'),
                    created_at: new Date('2026-07-01T10:00:00Z'),
                    recipe: { outputQty: 2, product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' } },
                },
            ];
            db.productionJob.findMany.mockResolvedValue(completedJobs);
            db.inventoryMovement.findMany.mockResolvedValue([
                { reference_id: 'job-1', movement_type: 'MANUFACTURING_CONSUMPTION', quantity_delta: -50, unit_cost: 2 }, // 100
                { reference_id: 'job-1', movement_type: 'MANUFACTURING_WASTAGE', quantity_delta: -3, unit_cost: 2 }, // 6
                { reference_id: 'job-2', movement_type: 'MANUFACTURING_CONSUMPTION', quantity_delta: -25, unit_cost: 2 }, // 50
            ]);

            const result = await service.getAnalytics('tenant-1');

            expect(result.totalCompletedJobs).toBe(2);
            expect(result.totalUnitsProduced).toBe(30); // (10*2) + (5*2)
            expect(result.totalMaterialCost).toBe(156); // 106 + 50
            expect(result.avgUnitProductionCost).toBeCloseTo(156 / 30);

            expect(result.jobs).toEqual([
                expect.objectContaining({
                    jobId: 'job-1',
                    quantityProduced: 20,
                    plannedMaterialCost: 100,
                    wastageCost: 6,
                    actualMaterialCost: 106,
                    unitProductionCost: 106 / 20,
                }),
                expect.objectContaining({
                    jobId: 'job-2',
                    quantityProduced: 10,
                    plannedMaterialCost: 50,
                    wastageCost: 0,
                    actualMaterialCost: 50,
                    unitProductionCost: 5,
                }),
            ]);

            expect(result.volumeTrend).toEqual([
                { date: '2026-07-01', quantityProduced: 20 },
                { date: '2026-07-02', quantityProduced: 10 },
            ]);
        });

        it('buckets the volume trend on the workspace calendar day, not the UTC one', async () => {
            db.productionJob.findMany.mockResolvedValue([
                {
                    id: 'job-late',
                    tenantId: 'tenant-1',
                    quantity: 3,
                    // 1 July 23:00 in Dhaka is already 2 July in UTC.
                    completedAt: new Date('2026-07-01T17:00:00Z'),
                    created_at: new Date('2026-07-01T10:00:00Z'),
                    recipe: { outputQty: 2, product: { id: 'product-out', name: 'Bread Loaf', sku: 'BRD-1' } },
                },
            ]);
            db.inventoryMovement.findMany.mockResolvedValue([]);

            const result = await service.getAnalytics('tenant-1', 'Asia/Dhaka');

            expect(result.volumeTrend).toEqual([{ date: '2026-07-01', quantityProduced: 6 }]);
        });
    });

    describe('listJobs()', () => {
        it('hydrates each job recipe with its components, which the completion dialog needs', async () => {
            db.productionJob.findMany.mockResolvedValue([]);
            db.productionJob.count = jest.fn().mockResolvedValue(0);

            await service.listJobs('tenant-1', 1, 20);

            const args = db.productionJob.findMany.mock.calls[0][0];
            expect(args.include.recipe.include.components).toEqual({
                include: { product: { select: { id: true, name: true, sku: true } } },
            });
        });
    });

    describe('deleteBom()', () => {
        it('refuses a recipe that production jobs still reference, instead of tripping a FK error', async () => {
            db.bomRecipe.findFirst.mockResolvedValue(recipe);
            db.productionJob.count = jest.fn().mockResolvedValue(3);
            db.bomRecipe.delete = jest.fn();

            await expect(service.deleteBom('tenant-1', 'recipe-1')).rejects.toThrow(BadRequestException);
            expect(db.bomRecipe.delete).not.toHaveBeenCalled();
        });
    });

    describe('createBom()', () => {
        it('rejects a second recipe for a product that already has one', async () => {
            db.product.findFirst = jest.fn().mockResolvedValue({ id: 'product-out' });
            db.bomRecipe.findFirst.mockResolvedValue({ id: 'recipe-1' });

            await expect(
                service.createBom('tenant-1', { productId: 'product-out', outputQty: 1, components: [] } as any),
            ).rejects.toThrow(BadRequestException);
        });
    });
});
